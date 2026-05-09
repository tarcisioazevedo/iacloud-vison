/**
 * Recording No-Upload Watchdog — alerta quando câmera enabled
 * fica >3min sem fazer upload de segments para a cloud.
 *
 * Por que existe (gap do camera-watchdog atual):
 *   `camera-watchdog.service` dispara CAMERA_DOWN baseado em `lastOnlineAt`,
 *   atualizado por QUALQUER atividade da box (heartbeat, snapshot, evento).
 *   Cenário NÃO COBERTO:
 *     - Box continua mandando heartbeat ✅
 *     - Mas o uploader/ffmpeg da box morreu ❌
 *     - Ou o RTSP local da câmera caiu ❌
 *     → Gravação para silenciosamente sem nenhum CAMERA_DOWN
 *
 * Este watchdog observa a métrica REAL que importa pra gravação:
 * o último `RecordingSegment.uploadedAt` por câmera.
 *
 * Estratégia:
 *   - Tick a cada 60s
 *   - Pra cada câmera com recordEnabled+EDGE_BOX, busca último uploadedAt
 *   - Se diff > THRESHOLD (3min) → estado = NO_UPLOAD
 *   - Se diff ≤ THRESHOLD → estado = OK
 *   - Estado em memória (lastState Map) detecta TRANSIÇÕES — alerta uma vez.
 *
 * Transições:
 *   OK → NO_UPLOAD          → dispatch CAMERA_NO_UPLOAD
 *   NO_UPLOAD → OK          → dispatch CAMERA_UPLOAD_RECOVERED
 *   (estado igual ao tick anterior → no-op, alertService cuida do cooldown)
 *
 * Persistência:
 *   Não salvamos estado em DB — em restart, primeiro tick re-classifica.
 *   Cooldown do alertService impede alerta duplicado se cair antes de 1h.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { alertService } from './alert.service'
import { getCameraContext } from './camera-context.service'

const TICK_MS         = 60_000              // 1 min
const NO_UPLOAD_THRESHOLD_MS = 3 * 60_000   // 3 min sem upload → alerta
const ENABLED         = process.env.RECORDING_ENABLED !== 'false'

type State = 'OK' | 'NO_UPLOAD' | 'NEVER_UPLOADED'

interface Snapshot {
  state:        State
  /** Quando a transição pra esse estado aconteceu (pra calcular duração no recovery). */
  since:        Date
  /** Último uploadedAt visto — pra mensagem do alerta. */
  lastUploadAt: Date | null
}

const lastState = new Map<string, Snapshot>()
let timer: NodeJS.Timeout | null = null

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`
  return `${Math.round(ms / 86_400_000)}d`
}

async function tick(): Promise<void> {
  // G8 fix (2026-05-09): cobre EDGE_BOX e CLOUD_DIRECT.
  // - EDGE_BOX: pula se a box está OFFLINE/SUSPENDED (camera-watchdog cuida).
  // - CLOUD_DIRECT: pula se rtmpIngestLastFrameAt > 60s (push parou — esse
  //   sintoma é coberto pelo camera-watchdog via heartbeat). Só queremos
  //   alertar quando push CHEGA mas segments param de virar UPLOADED
  //   (ffmpeg cloud-direct morreu repetido, R2 inacessível, etc).
  const cams = await prisma.camera.findMany({
    where: {
      recordEnabled: true,
      recordMode:    { not: 'DISABLED' },
      active:        true,
    },
    select: {
      id: true,
      deploymentMode: true,
      ingestMode: true,
      rtmpIngestLastFrameAt: true,
      edgeNode: { select: { status: true } },
    },
  })

  const PUSH_FRESH_THRESHOLD_MS = 60_000   // cloud-direct: push fresco em <60s

  for (const cam of cams) {
    if (cam.deploymentMode === 'EDGE_BOX') {
      // EDGE_BOX: pula se a box está OFFLINE/SUSPENDED (camera-watchdog cuida).
      if (cam.edgeNode?.status !== 'ONLINE') continue
    } else if (cam.deploymentMode === 'CLOUD_DIRECT') {
      // CLOUD_DIRECT: só alerta se push está fresco. Se push parou,
      // camera-watchdog reporta CAMERA_DOWN — não duplicar alerta.
      const lastPush = cam.rtmpIngestLastFrameAt?.getTime() ?? 0
      if (Date.now() - lastPush > PUSH_FRESH_THRESHOLD_MS) continue
    } else {
      continue
    }

    // Último upload confirmado (UPLOADED). Note: PENDING/FAILED não conta —
    // queremos saber se REALMENTE houve um upload bem-sucedido recente.
    const lastUpload = await prisma.recordingSegment.findFirst({
      where: { cameraId: cam.id, uploadStatus: 'UPLOADED' },
      orderBy: { uploadedAt: 'desc' },
      select: { uploadedAt: true },
    })

    const ageMs = lastUpload?.uploadedAt
      ? Date.now() - lastUpload.uploadedAt.getTime()
      : Infinity

    const newState: State = !lastUpload
      ? 'NEVER_UPLOADED'
      : ageMs > NO_UPLOAD_THRESHOLD_MS
        ? 'NO_UPLOAD'
        : 'OK'

    const prev = lastState.get(cam.id)

    // Caso 1: NEVER → NO_UPLOAD (a câmera estava sem upload e segue sem)
    // Caso 2: OK → NO_UPLOAD (parou agora) → DISPATCH
    // Caso 3: NO_UPLOAD → OK (recovery) → DISPATCH
    // Caso 4: estado igual → no-op
    if (!prev || prev.state === newState) {
      lastState.set(cam.id, {
        state: newState,
        since: prev?.since ?? new Date(),
        lastUploadAt: lastUpload?.uploadedAt ?? null,
      })
      continue
    }

    // ── Transição detectada ──────────────────────────────────────────────
    const ctx = await getCameraContext(cam.id)
    if (!ctx?.clienteFinalId) {
      logger.warn({ cameraId: cam.id }, 'no_upload_watchdog_no_context')
      continue
    }

    const dashboardUrl = (process.env.PUBLIC_FRONTEND_URL?.replace(/\/login$/, '') ?? 'http://localhost:5173') + '/recordings'

    if (newState === 'NO_UPLOAD' && prev.state === 'OK') {
      // ── OK → NO_UPLOAD: gravação parou ──────────────────────────────────
      const lastUploadAtStr = lastUpload?.uploadedAt
        ? lastUpload.uploadedAt.toLocaleString('pt-BR')
        : 'nunca'

      await alertService.dispatch({
        type:           'CAMERA_NO_UPLOAD',
        severity:       'CRITICAL',
        clienteFinalId: ctx.clienteFinalId,
        cameraId:       cam.id,
        alertKey:       `camera_no_upload:${cam.id}`,
        payload: {
          severity:         'CRITICAL',
          cameraName:       ctx.cameraName,
          siteName:         ctx.siteName ?? '—',
          clienteName:      ctx.clienteFinalName ?? '—',
          edgeNodeSerial:   ctx.edgeNodeSerial ?? '—',
          lastUploadAt:     lastUploadAtStr,
          noUploadDuration: ageMs === Infinity ? 'sempre' : fmtDuration(ageMs),
          dashboardUrl,
        },
      }).catch(err => logger.warn({ err, cameraId: cam.id }, 'no_upload_dispatch_failed'))

      logger.warn({
        cameraId: cam.id, cameraName: ctx.cameraName,
        siteName: ctx.siteName, integradorName: ctx.integradorName,
        ageMs, lastUploadAt: lastUpload?.uploadedAt,
      }, 'recording_no_upload_alert')
    }

    if (newState === 'OK' && prev.state === 'NO_UPLOAD') {
      // ── NO_UPLOAD → OK: recovery ────────────────────────────────────────
      const downMs = Date.now() - prev.since.getTime()
      await alertService.dispatch({
        type:           'CAMERA_UPLOAD_RECOVERED',
        severity:       'INFO',
        clienteFinalId: ctx.clienteFinalId,
        cameraId:       cam.id,
        alertKey:       `camera_upload_recovered:${cam.id}`,
        payload: {
          severity:         'INFO',
          cameraName:       ctx.cameraName,
          siteName:         ctx.siteName ?? '—',
          clienteName:      ctx.clienteFinalName ?? '—',
          edgeNodeSerial:   ctx.edgeNodeSerial ?? '—',
          noUploadDuration: fmtDuration(downMs),
          recoveredAt:      new Date().toLocaleString('pt-BR'),
          dashboardUrl,
        },
      }).catch(err => logger.warn({ err, cameraId: cam.id }, 'recovered_dispatch_failed'))

      logger.info({
        cameraId: cam.id, cameraName: ctx.cameraName,
        downMs,
      }, 'recording_upload_recovered')
    }

    lastState.set(cam.id, {
      state: newState,
      since: new Date(),
      lastUploadAt: lastUpload?.uploadedAt ?? null,
    })
  }
}

export const recordingNoUploadWatchdog = {
  start(): void {
    if (!ENABLED) {
      logger.info('recording_no_upload_watchdog_disabled')
      return
    }
    if (timer) return
    logger.info({
      tickMs: TICK_MS,
      thresholdMs: NO_UPLOAD_THRESHOLD_MS,
    }, 'recording_no_upload_watchdog_starting')

    // Primeiro tick: SÓ inicializa estado, NÃO dispara alertas
    // (evita avalanche de alertas no boot quando todas câmeras parecem
    // estar sem upload por causa do reset do estado em memória).
    initBaseline().catch(err => logger.error({ err }, 'no_upload_init_failed'))

    timer = setInterval(() => {
      tick().catch(err => logger.error({ err }, 'no_upload_tick_failed'))
    }, TICK_MS)
  },

  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
    lastState.clear()
  },

  /** Pra debug. */
  _state(): Map<string, Snapshot> { return lastState },
}

/** Inicializa o estado sem disparar alertas (boot). */
async function initBaseline(): Promise<void> {
  // G8 fix: baseline cobre EDGE_BOX + CLOUD_DIRECT (mesmo escopo do tick).
  const cams = await prisma.camera.findMany({
    where: {
      recordEnabled: true,
      recordMode: { not: 'DISABLED' },
      active: true,
    },
    select: { id: true },
  })

  for (const cam of cams) {
    const lastUpload = await prisma.recordingSegment.findFirst({
      where: { cameraId: cam.id, uploadStatus: 'UPLOADED' },
      orderBy: { uploadedAt: 'desc' },
      select: { uploadedAt: true },
    })
    const ageMs = lastUpload?.uploadedAt
      ? Date.now() - lastUpload.uploadedAt.getTime()
      : Infinity
    const state: State = !lastUpload
      ? 'NEVER_UPLOADED'
      : ageMs > NO_UPLOAD_THRESHOLD_MS
        ? 'NO_UPLOAD'
        : 'OK'
    lastState.set(cam.id, {
      state,
      since: new Date(),
      lastUploadAt: lastUpload?.uploadedAt ?? null,
    })
  }
  logger.info({ baselineCameras: cams.length }, 'recording_no_upload_watchdog_baseline')
}
