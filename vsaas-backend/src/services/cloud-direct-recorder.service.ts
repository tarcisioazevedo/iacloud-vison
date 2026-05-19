/**
 * Cloud-Direct Recorder — grava câmeras RTMP_PUSH / CLOUD_DIRECT direto no R2.
 *
 * Fluxo:
 *   1. Câmera push RTMP → go2rtc:1935  (ingest.service detecta AUTH_OK)
 *   2. ingest.service chama cloudDirectRecorder.startRecording()
 *   3. ffmpeg lê RTSP de go2rtc:8554/{streamKey} e segmenta em /recordings/cloud-direct/{cameraId}/
 *   4. Polling a cada 2s detecta segmentos completos (todos exceto o último)
 *   5. Cada segmento completo → upload R2 → delete local → RecordingSegment no DB
 *   6. Quando câmera para (PUBLISH_END), ingest.service chama stopRecording()
 *
 * Zero disco em produção:
 *   A pasta /recordings é montada como tmpfs no Docker Swarm (RAM pura).
 *   Segmento de 6s FHD H.264 ≈ 10-15 MB → a cada tick, o segmento anterior
 *   já está no R2 e deletado do tmpfs. Pico de uso = 1 segmento em escrita
 *   por câmera (≈ 15 MB × N câmeras). Para 50 câmeras = ~750 MB tmpfs.
 *
 * Por que polling e não fs.watch:
 *   fs.watch tem comportamento inconsistente em tmpfs (inotify) para detectar
 *   "arquivo fechado". Polling de 2s em diretório pequeno é O(n) com n ≤ 6
 *   arquivos — custo desprezível vs confiabilidade.
 *
 * Segurança:
 *   - segDir por cameraId (UUID) — sem path traversal
 *   - ffmpeg lê apenas RTSP interno (rede Docker, não exposta)
 *   - Credenciais R2 via env (não passadas ao ffmpeg)
 */
import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { r2Storage } from './r2-storage.service'
import { getCameraContext } from './camera-context.service'
import { getEffectiveRecordingMode } from './recording-effective-mode.service'
import { isRecordingPaused } from './recording-tmpfs-watchdog.service'
import { detectCodec, ffmpegCopyArgs, hasAudioStream, ffmpegAudioArgs } from './ffprobe-codec.service'

const BASE_PATH      = process.env.RECORDINGS_BASE_PATH       ?? '/recordings'
const SEGMENT_SEC    = Number(process.env.RECORDING_SEGMENT_SECONDS ?? 6)
const GO2RTC_RTSP    = (process.env.GO2RTC_RTSP_URL ?? 'rtsp://go2rtc:8554').replace(/\/$/, '')
const ENABLED        = process.env.RECORDING_ENABLED !== 'false'
const POLL_MS        = Number(process.env.RECORDING_POLL_MS ?? 4_000)

interface RecorderState {
  cameraId:       string
  streamKey:      string
  integradorId:   string
  proc:           ChildProcess
  segDir:         string
  pollTimer:      NodeJS.Timeout
  /** Timer que renova TTL do active key no Redis a cada 30s. */
  heartbeatTimer: NodeJS.Timeout
  /** Codec detectado via ffprobe — anotado em RecordingSegment.codec. */
  codec:          'h264' | 'h265' | 'unknown'
}

const active = new Map<string, RecorderState>()

/**
 * restartPending — câmeras cuja gravação encerrou e vão reiniciar em 3s.
 *
 * Por que Set separado em vez de sentinel no active Map:
 *   - active sempre contém RecorderState completo (proc, pollTimer, etc.)
 *   - restartPending é preocupação ortogonal: "restart em voo"
 *   - isRecording() = active.has() — estado real "ffmpeg rodando agora"
 *   - isRestartPending() = restartPending.has() — "vai reiniciar em breve"
 *   - Callers (ingest.service, tickReconcileSchedule) checam AMBOS antes
 *     de chamar startRecording — elimina a janela de 3s onde teríamos
 *     o segundo startRecording chamado em paralelo.
 *
 * Ciclo de vida:
 *   startRecording → active.set (sentinel parcial antes de qualquer await)
 *   proc.on('exit', willAutoRestart=true) → active.delete + restartPending.add
 *   setTimeout(3s) → restartPending.delete + active.set (novo proc)
 */
const restartPending = new Set<string>()

/**
 * crashCounts — backoff exponencial por câmera para auto-restart do ffmpeg.
 *
 * Sem backoff, uma câmera com stream corrompido ou codec incompatível pode
 * spawnar dezenas de ffmpegs por minuto em loop infinito, consumindo CPU.
 *
 * Protocolo:
 *   - Cada exit não-solicitado com código 0 incrementa o contador.
 *   - Delay = min(3s × 2^n, 60s). Após 5min sem crash, reseta o contador.
 *   - Contador é limpo quando stopRecording() é chamado explicitamente
 *     (câmera foi desconectada de propósito — próximo push começa do zero).
 *
 * Exemplos de delay:
 *   crash 1 →  3s, crash 2 →  6s, crash 3 → 12s,
 *   crash 4 → 24s, crash 5 → 48s, crash 6+ → 60s (cap)
 *
 * Cap 60s (antes 5min): câmera com flap intermitente (modem rebootando, NAT
 * reabrindo) não merece esperar 5min ociosa. 60s é tempo suficiente pra um
 * stream legitimamente quebrado não bater em loop tight, mas curto pra
 * recuperar gaps na faixa escura da timeline.
 */
const crashCounts = new Map<string, { count: number; lastCrashAt: number }>()

// ── Helpers ─────────────────────────────────────────────────────────────────

// parseSegTimestamp extraída pra ../lib/seg-timestamp em Sprint γ-Day1.
// Veja src/lib/seg-timestamp.spec.ts pra cobertura.
import { parseSegTimestamp } from '../lib/seg-timestamp'
import {
  REPLICA_ID,
  acquireStartLock,
  releaseStartLock,
  setActive,
  refreshActive,
  clearActive,
  isActiveAnywhere,
  setPending,
  clearPending,
  isPendingAnywhere,
  listActiveCameraIds,
  type ActiveRecordingMeta,
} from '../lib/recorder-state'

/**
 * Pipeline de upload (G1 fix — 2026-05-09):
 *
 *   1. Renomeia arquivo do tmpfs pro layout canônico
 *      `{cameraId}/{YYYY-MM-DD}/{HH-MM-SS}_{uuid}.ts` (mesmo do recording-storage).
 *   2. INSERT RecordingSegment com uploadStatus=PENDING + storagePath canônico.
 *   3. Tenta upload R2.
 *   4a. Sucesso → UPDATE UPLOADED + unlink local.
 *   4b. Falha   → mantém arquivo local. Worker reprocessa a partir de PENDING.
 *
 * Por que mover o arquivo:
 *   recordingStorage.uploadToCloud(integradorId, storagePath) assume
 *   localPath = BASE_PATH + storagePath. Sem mover, o worker não acharia
 *   o arquivo local pra retry.
 */
async function uploadSegment(
  segDir: string,
  filename: string,
  cameraId: string,
  integradorId: string,
  durationSecOverride?: number,
): Promise<void> {
  const localPath = join(segDir, filename)

  let sizeBytes: number
  try {
    sizeBytes = (await fs.stat(localPath)).size
  } catch {
    return // arquivo sumiu (cleanup anterior) — ok
  }

  if (sizeBytes === 0) {
    await fs.unlink(localPath).catch(() => {})
    return
  }

  const startedAt  = parseSegTimestamp(filename)
  // durationSecOverride vem do CSV do ffmpeg (duração real medida). Fallback
  // para SEGMENT_SEC (constante) quando o CSV não está disponível — ex: segmento
  // processado via pollSegments no flush final ao sair.
  const durationSec = durationSecOverride ?? SEGMENT_SEC
  const endedAt    = new Date(startedAt.getTime() + durationSec * 1_000)
  const segmentId  = randomUUID()

  // Layout canônico: sempre UTC para consistência com startedAt no DB.
  // ANTES usava getHours() (hora local TZ env) — criava desalinhamento em
  // viradas de meia-noite local: arquivo em diretório de "ontem" mas DB com
  // startedAt de "hoje". Agora extraímos diretamente do ISO UTC.
  const iso      = startedAt.toISOString()   // "2026-05-12T02:00:00.000Z"
  const datePart = iso.slice(0, 10)          // "2026-05-12"
  const timePart = iso.slice(11, 19).replace(/:/g, '-')  // "02-00-00"
  const storagePath = `${cameraId}/${datePart}/${timePart}_${segmentId}.ts`
  const canonicalLocal = join(BASE_PATH, storagePath)

  // ── 1. Move pro layout canônico ──────────────────────────────────────────
  try {
    await fs.mkdir(join(BASE_PATH, cameraId, datePart), { recursive: true })
    await fs.rename(localPath, canonicalLocal)
  } catch (err) {
    logger.warn({ err, localPath, canonicalLocal }, 'cloud_direct_rename_failed')
    return
  }

  // ── 2. INSERT PENDING ────────────────────────────────────────────────────
  // G3 fix: lê recordMode pra decidir motion-gate.
  const cam = await prisma.camera.findUnique({
    where:  { id: cameraId },
    select: { recordMode: true },
  }).catch(() => null)
  const isMotionGated = cam?.recordMode === 'MOTION' || cam?.recordMode === 'ACTIVE_OBJECTS'
  const motionGateGraceMs = Number(process.env.MOTION_GATE_GRACE_MS ?? 5 * 60_000)
  const deleteAfterReviewAt = isMotionGated
    ? new Date(Date.now() + motionGateGraceMs)
    : null

  // G10 fix: codec do RecorderState (detectado via ffprobe no startRecording).
  const recState = active.get(cameraId)
  const detectedCodec = recState?.codec === 'h265' ? 'h265' : 'h264'

  try {
    await prisma.recordingSegment.create({
      data: {
        id:             segmentId,
        cameraId,
        startedAt,
        endedAt,
        durationSec,
        sizeBytes:      BigInt(sizeBytes),
        storagePath,
        codec:          detectedCodec,
        uploadStatus:   'PENDING',
        uploadAttempts: 0,
        // hasMotion: false (default no schema) — flips via markSegmentMotion
        deleteAfterReviewAt,
      },
    })

    // 2026-05-12 — marca câmera ACTIVE + atualiza lastOnlineAt.
    // Sem isso, watchdog flipa pra ERROR (vide recording-ingest.service.ts fix).
    // 2026-05-14 — também atualiza lastSegmentStartedAt: timestamp real do
    // segmento mais recente gravado (não confundir com lastOnlineAt, que é
    // heartbeat genérico). Permite diagnóstico de "push ativo mas sem
    // segmentos sendo persistidos" (R2 caiu, tmpfs cheio, etc.).
    // Fire-and-forget — falha aqui não deve quebrar o upload.
    prisma.camera.update({
      where: { id: cameraId },
      data:  {
        lastOnlineAt: new Date(),
        lastSegmentStartedAt: startedAt,
        status: 'ACTIVE',
      },
    }).catch(err => logger.warn({ err, cameraId }, 'camera_lastOnline_update_failed'))
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Duplicado (cameraId, startedAt) — idempotente. Apaga arquivo, sai.
      await fs.unlink(canonicalLocal).catch(() => {})
      return
    }
    logger.warn({ err, cameraId, storagePath }, 'cloud_direct_segment_insert_err')
    await fs.unlink(canonicalLocal).catch(() => {})
    return
  }

  // Retroactive Snapping: "snap" previous segment's endedAt to this segment's startedAt
  const prev = await prisma.recordingSegment.findFirst({
    where: { cameraId, startedAt: { lt: startedAt } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true, endedAt: true, durationSec: true },
  })
  if (prev) {
    const gapMs = startedAt.getTime() - prev.endedAt.getTime()
    if (gapMs > -5000 && gapMs <= 15000) {
      const actualDurationSec = (startedAt.getTime() - prev.startedAt.getTime()) / 1000
      await prisma.recordingSegment.updateMany({
        where: { id: prev.id },
        data: { endedAt: startedAt, durationSec: actualDurationSec },
      }).catch(() => {})
      logger.debug({ segmentId: prev.id, gapMs, actualDurationSec }, 'recording_segment_gap_snapped_prev')
    }
  }

  const next = await prisma.recordingSegment.findFirst({
    where: { cameraId, startedAt: { gt: startedAt } },
    orderBy: { startedAt: 'asc' },
    select: { id: true, startedAt: true },
  })
  if (next) {
    const gapMs = next.startedAt.getTime() - endedAt.getTime()
    if (gapMs > -5000 && gapMs <= 15000) {
      const actualDurationSec = (next.startedAt.getTime() - startedAt.getTime()) / 1000
      await prisma.recordingSegment.updateMany({
        where: { id: segmentId },
        data: { endedAt: next.startedAt, durationSec: actualDurationSec },
      }).catch(() => {})
      logger.debug({ segmentId, gapMs, actualDurationSec }, 'recording_segment_gap_snapped_next')
    }
  }

  // ── 3. Tenta upload R2 ───────────────────────────────────────────────────
  const uploaded = await r2Storage.uploadFile(integradorId, canonicalLocal, storagePath)

  // ── 4. Atualiza estado ───────────────────────────────────────────────────
  if (uploaded) {
    await prisma.recordingSegment.updateMany({
      where: { id: segmentId },
      data: {
        uploadStatus:   'UPLOADED',
        uploadedAt:     new Date(),
        uploadBucket:   `icv-${integradorId}`,
        uploadAttempts: 1,
      },
    }).catch(err => logger.warn({ err, segmentId }, 'cloud_direct_status_update_err'))
    await fs.unlink(canonicalLocal).catch(() => {})
    logger.debug({ cameraId, storagePath, sizeBytes }, 'cloud_direct_seg_uploaded')
  } else {
    await prisma.recordingSegment.updateMany({
      where: { id: segmentId },
      data: {
        uploadAttempts: 1,
        uploadError:    'cloud_direct first attempt failed',
      },
    }).catch(() => {})
    logger.warn({ cameraId, storagePath }, 'cloud_direct_seg_upload_failed_will_retry')
    // Arquivo permanece em canonicalLocal — worker pega.
  }
}

/** Poll: lista dir, faz upload de todos os .ts exceto o último (ainda em escrita) */
async function pollSegments(state: RecorderState): Promise<void> {
  let files: string[]
  try {
    files = (await fs.readdir(state.segDir))
      .filter(f => f.endsWith('.ts'))
      .sort()
  } catch {
    return
  }

  // O arquivo com nome mais alto (strftime order) é o que ffmpeg está escrevendo agora.
  // Todos os anteriores estão fechados → upload seguro.
  const done = files.slice(0, -1)
  for (const f of done) {
    await uploadSegment(state.segDir, f, state.cameraId, state.integradorId)
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export const cloudDirectRecorder = {
  async startRecording(
    cameraId:     string,
    streamKey:    string,
    integradorId: string,
  ): Promise<boolean> {
    if (!ENABLED) return false

    // Bloqueia gravação se CF tem cancelamento ativo
    const cam = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: { site: { select: { clienteFinal: { select: { canceledAt: true } } } } },
    })
    if (cam?.site?.clienteFinal?.canceledAt) {
      logger.info({ cameraId }, 'recording_blocked_cf_canceled')
      return false
    }

    // ── Guard local (fast path síncrono, mesma réplica) ───────────────────
    // Evita round-trip Redis para o caso mais comum: mesma réplica já gravando.
    if (active.has(cameraId) || restartPending.has(cameraId)) return true

    // ── Guard distribuído (Redis, multi-réplica) ──────────────────────────
    // acquireStartLock é atômico via Lua — verifica active + pending + adquire
    // o starting lock em uma única operação no Redis. Garante que só 1 réplica
    // inicia a gravação mesmo com N processos concorrentes.
    const lockAcquired = await acquireStartLock(cameraId)
    if (!lockAcquired) return true  // outra réplica está iniciando/gravando

    // Reserva slot em `active` localmente ANTES dos awaits longos (detectCodec
    // ~2-6s). O lock Redis já nos protege de outras réplicas; o Map local
    // protege contra re-entrada concorrente no mesmo processo.
    active.set(cameraId, { cameraId, streamKey, integradorId } as any)

    // G4 fix: tmpfs cheio → não inicia novos ffmpeg.
    if (isRecordingPaused()) {
      logger.warn({ cameraId }, 'cloud_direct_skip_tmpfs_paused')
      active.delete(cameraId)
      await releaseStartLock(cameraId)
      return false
    }

    // G2 fix: respeita RecordingSchedule. Se modo efetivo = DISABLED no
    // momento atual, não inicia gravação. O reconcile-tick reinicia quando
    // a janela permitida começar.
    const eff = await getEffectiveRecordingMode(cameraId).catch(() => null)
    if (eff && !eff.shouldRecord) {
      logger.info({ cameraId, baseMode: eff.baseMode, hasSchedule: eff.hasSchedule },
        'cloud_direct_skip_outside_schedule')
      active.delete(cameraId)
      await releaseStartLock(cameraId)
      return false
    }

    const segDir   = join(BASE_PATH, 'cloud-direct', cameraId)
    const rtspUrl  = `${GO2RTC_RTSP}/${streamKey}`
    const pattern  = join(segDir, '%Y%m%d_%H%M%S.ts')

    try {
      await fs.mkdir(segDir, { recursive: true })
    } catch (err) {
      logger.warn({ err, cameraId, segDir }, 'cloud_direct_mkdir_failed')
      active.delete(cameraId)
      await releaseStartLock(cameraId)
      return false
    }

    // G10+G19 fix: detecta codec + presença de áudio antes do spawn.
    // Em paralelo via Promise.all pra economizar ~3s no boot.
    const [codec, hasAudio] = await Promise.all([
      detectCodec(rtspUrl),
      hasAudioStream(rtspUrl),
    ])
    const codecArgs = ffmpegCopyArgs(codec)
    const audioArgs = ffmpegAudioArgs(hasAudio)

    logger.info({ cameraId, streamKey, codec, hasAudio }, 'cloud_direct_ffmpeg_starting')

    // -timeout 10s: aborta leitura RTSP que trava (rede caiu sem FIN, NAT
    // fechou silenciosamente, go2rtc parou de entregar frames). Sem isso, o
    // ffmpeg fica pendurado em recv() até o TCP timeout do kernel (~2-15min),
    // deixando o slot active ocupado e bloqueando o auto-restart. Saindo em
    // ≤10s, o watchdog/backoff retoma a gravação rápido e a faixa escura na
    // timeline encolhe. Valor em microssegundos (libavformat).
    // NOTA: -rw_timeout foi removido no ffmpeg 8.x — substituído por -timeout.
    const proc = spawn('ffmpeg', [
      '-loglevel',          'error',
      '-rtsp_transport',    'tcp',
      '-timeout',           '10000000',
      '-i',                 rtspUrl,
      ...codecArgs,
      ...audioArgs,
      '-f',                 'segment',
      '-segment_time',      String(SEGMENT_SEC),
      '-segment_format',    'mpegts',
      '-segment_list',      'pipe:1',   // emite CSV de segmentos fechados no stdout
      '-segment_list_type', 'csv',      // formato: filename,start_time,end_time
      '-reset_timestamps',  '1',        // PTS reinicia em 0 em cada segmento (HLS spec)
      '-strftime',          '1',
      pattern,
    ], { detached: false, stdio: ['ignore', 'pipe', 'pipe'] })

    // durations: mapa filename → durationSec lida do CSV do ffmpeg.
    // Usada pelo uploadSegment pra registrar duração real (não constante).
    const segDurations = new Map<string, number>()

    let stdoutBuf = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8')
      let lineEnd: number
      while ((lineEnd = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, lineEnd).trim()
        stdoutBuf = stdoutBuf.slice(lineEnd + 1)
        if (!line) continue
        // CSV: "20260512_020000.ts,0.000000,6.020000"
        const parts = line.split(',')
        if (parts.length >= 3) {
          const basename = parts[0].split('/').pop() ?? parts[0]
          const t0 = parseFloat(parts[1])
          const t1 = parseFloat(parts[2])
          if (!isNaN(t0) && !isNaN(t1) && t1 > t0) {
            segDurations.set(basename, t1 - t0)
          }
          // Upload imediato ao receber a linha (segmento fechado) em vez de
          // esperar o próximo poll. Reduz latência de gravação→DB de 4s → ~0s.
          // `segDir` fechado no escopo — state ainda não existe aqui.
          uploadSegment(segDir, basename, cameraId, integradorId, segDurations.get(basename))
            .catch(err => logger.warn({ err, cameraId, basename }, 'cloud_direct_seg_upload_err'))
        }
      }
    })

    proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) logger.debug({ cameraId, msg }, 'cloud_direct_ffmpeg')
    })

    // Flag pra distinguir "stop solicitado" vs "ffmpeg morreu sozinho".
    // Quando user chama stopRecording, marca → exit handler não auto-restart.
    let stopRequested = false
    ;(proc as any).__stopRequested = () => { stopRequested = true }

    proc.on('exit', (code, signal) => {
      logger.info({ cameraId, streamKey, code, signal, stopRequested }, 'cloud_direct_ffmpeg_exit')

      // ── Limpeza imediata do active ────────────────────────────────────────
      // γ-Day4 fix definitivo do 2× ffmpeg bug:
      //
      // ANTES (γ-Day3.5 tentativa): mantínhamos slot `active` como sentinel
      // com restartScheduled=true durante a janela de 3s. Funciona pra bloquear
      // ingest.service, mas:
      //   1. active continha state inválido (sem proc) — stopAll explodia
      //   2. Acoplamento implícito: startRecording tinha q checar a flag
      //   3. Não cobria re-reentrada via tickReconcileSchedule (60s)
      //
      // AGORA: active.delete() IMEDIATO em qualquer exit (limpo).
      //   - restartPending.add(cameraId) cobre a janela 3s explicitamente
      //   - isRecording(id) continua false (slot liberado) — semântica correta
      //   - isRestartPending(id) = true — guards em ingest.service + reconcile
      //   - startRecording() checa AMBOS: active.has || restartPending.has
      //
      const willAutoRestart = !stopRequested && code === 0
      const s = active.get(cameraId)
      if (s) {
        clearInterval(s.pollTimer)
        clearInterval(s.heartbeatTimer)  // para heartbeat Redis
        // Upload dos segmentos restantes no disco ao sair (flush final)
        pollSegments(s).catch(() => {})
      }
      active.delete(cameraId)  // limpa SEMPRE — sem sentinels no active map
      clearActive(cameraId).catch(() => {})  // limpa Redis imediatamente

      // Auto-restart com backoff exponencial: ffmpeg morreu sozinho (não solicitado,
      // exit 0) E push real continua no go2rtc. Cobre: go2rtc reiniciou, segment
      // rotation crash, rede instável entre recorder ↔ go2rtc.
      //
      // Backoff: 3s × 2^n, máximo 60s. Reset do contador após 5min sem crash.
      if (willAutoRestart) {
        // Calcula delay com backoff
        const now = Date.now()
        const cc = crashCounts.get(cameraId)
        const resetThresholdMs = 5 * 60_000  // reseta contador se ficou 5min sem crash
        const crashCount = (cc && now - cc.lastCrashAt < resetThresholdMs) ? cc.count + 1 : 1
        crashCounts.set(cameraId, { count: crashCount, lastCrashAt: now })
        const delayMs = Math.min(3000 * Math.pow(2, crashCount - 1), 60_000)

        if (crashCount > 1) {
          logger.warn({ cameraId, streamKey, crashCount, delayMs },
            'cloud_direct_auto_restart_backoff')
        }

        restartPending.add(cameraId)     // guard local (síncrono, mesma réplica)
        setPending(cameraId).catch(() => {})  // guard Redis (cross-réplica)
        setTimeout(async () => {
          restartPending.delete(cameraId)     // libera guard local
          await clearPending(cameraId).catch(() => {})  // libera guard Redis
          try {
            const cam = await prisma.camera.findUnique({
              where: { id: cameraId },
              select: { rtmpIngestLastFrameAt: true, deploymentMode: true, ingestMode: true },
            })
            if (!cam) return
            const lastFrame = cam.rtmpIngestLastFrameAt?.getTime() ?? 0
            const ageSec = (Date.now() - lastFrame) / 1000
            if (ageSec < 30 && cam.deploymentMode === 'CLOUD_DIRECT' &&
                (cam.ingestMode === 'RTMP_PUSH' || cam.ingestMode === 'SRT_PUSH')) {
              logger.info({ cameraId, streamKey, lastFrameAgeSec: ageSec, crashCount, delayMs },
                'cloud_direct_auto_restart_recording')
              cloudDirectRecorder.startRecording(cameraId, streamKey, integradorId).catch(err =>
                logger.warn({ err, cameraId, streamKey }, 'cloud_direct_auto_restart_failed'),
              )
            }
          } catch (err) {
            logger.warn({ err, cameraId }, 'cloud_direct_auto_restart_check_failed')
          }
        }, delayMs)
      }
    })

    const state: RecorderState = {
      cameraId, streamKey, integradorId, proc, segDir,
      pollTimer: null as any, heartbeatTimer: null as any, codec,
    }
    state.pollTimer = setInterval(() => {
      pollSegments(state).catch(err => logger.warn({ err, cameraId }, 'cloud_direct_poll_err'))
    }, POLL_MS)

    // Publica no Redis que esta câmera está ativa nesta réplica.
    // startedAt reflete o momento do spawn (não do acquireStartLock).
    const meta: ActiveRecordingMeta = {
      replicaId: REPLICA_ID, streamKey, integradorId, codec, segDir,
      startedAt: Date.now(),
    }
    await setActive(cameraId, meta)
    await releaseStartLock(cameraId)  // lock de início não é mais necessário

    // Heartbeat: renova TTL do active key a cada 30s.
    // Se este processo morrer, o TTL (90s) expira e outras réplicas
    // poderão iniciar nova gravação no próximo reconcile tick.
    state.heartbeatTimer = setInterval(() => {
      refreshActive(cameraId).catch(() => {})
    }, 30_000)

    active.set(cameraId, state)
    logger.info({ cameraId, streamKey, rtspUrl, segDir, replicaId: REPLICA_ID },
      'cloud_direct_recording_started')
    return true
  },

  stopRecording(cameraId: string): void {
    const state = active.get(cameraId)
    if (!state) return
    // Marca stop solicitado pra exit handler NÃO auto-restartar.
    if ((state.proc as any).__stopRequested) (state.proc as any).__stopRequested()
    clearInterval(state.pollTimer)
    clearInterval(state.heartbeatTimer)
    crashCounts.delete(cameraId)  // reseta backoff — próximo push começa zerado
    state.proc.kill('SIGTERM')
    // Não deletamos do active aqui — o handler proc.on('exit') faz isso
    // e ainda roda o poll final para capturar o último segmento.
    // Redis active key é limpo no exit handler.
    logger.info({ cameraId }, 'cloud_direct_recording_stop_requested')
  },

  /**
   * Verifica se câmera está gravando NESTA réplica (síncrono, fast path).
   * Para checar cross-réplica, usar isRecordingAnywhere (async).
   */
  isRecording(cameraId: string): boolean {
    return active.has(cameraId)
  },

  /**
   * Verifica se câmera está gravando em QUALQUER réplica (async, Redis).
   * Inclui fast-path local para evitar round-trip quando é esta réplica.
   */
  async isRecordingAnywhere(cameraId: string): Promise<boolean> {
    if (active.has(cameraId)) return true
    return isActiveAnywhere(cameraId)
  },

  /** true se auto-restart está em voo (3s window pós-exit). Callers devem
   *  checar AMBOS isRecording + isRestartPending antes de chamar startRecording.
   *  Versão síncrona (local) — usada para same-process checks. */
  isRestartPending(cameraId: string): boolean {
    return restartPending.has(cameraId)
  },

  /** Versão async do isRestartPending — inclui cross-réplica via Redis. */
  async isRestartPendingAnywhere(cameraId: string): Promise<boolean> {
    if (restartPending.has(cameraId)) return true
    return isPendingAnywhere(cameraId)
  },

  stopAll(): void {
    for (const [cameraId] of active) this.stopRecording(cameraId)
  },

  /**
   * killOrphans — mata ffmpeg processes de gravações anteriores órfãs.
   *
   * Quando o processo Node.js reinicia DENTRO do mesmo container (crash
   * + restart via healthcheck, não via Swarm rolling update), ffmpegs
   * filhos ficam vivos com ppid 1 (orphan). O active Map está vazio no
   * novo boot, então ingest.service os ignoraria e spawnaria duplicatas.
   *
   * pkill -f identifica pelo argumento de output path que contém o
   * padrão cloud-direct no segDir — único a esses ffmpegs.
   * Fire-and-forget: se pkill não existe (env estranho) apenas loga.
   */
  killOrphans(): void {
    // Mata APENAS ffmpegs órfãos (ppid=1) que escrevem em cloud-direct.
    //
    // Por que ppid=1:
    //   ffmpegs filhos do processo Node atual têm ppid = PID do Node.
    //   Quando o processo Node reinicia (crash + restart pelo Swarm),
    //   os ffmpegs que eram filhos ficam com ppid=1 (adotados pelo init).
    //   O novo processo Node arranca com active Map vazio → sem o kill,
    //   os órfãos continuariam gravando sem supervisão e seriam duplicados
    //   quando ingest.service disparasse startRecording novamente.
    //
    // Por que NÃO matar ffmpegs com ppid != 1:
    //   Com rolling update `start-first`, a nova réplica sobe ENQUANTO a
    //   antiga ainda está rodando. Os ffmpegs da réplica antiga têm ppid
    //   do processo Node antigo (não 1). Matá-los causaria gap de gravação.
    //   Filtrando por ppid=1 só atacamos os realmente órfãos.
    try {
      const { execSync } = require('child_process')
      const killed = execSync(
        `
          for pid in $(pgrep -x ffmpeg 2>/dev/null); do
            ppid=$(awk '/^PPid:/{print $2}' /proc/$pid/status 2>/dev/null)
            if [ "$ppid" = "1" ] && grep -q 'cloud-direct' /proc/$pid/cmdline 2>/dev/null; then
              kill "$pid" 2>/dev/null && echo "killed-orphan-$pid" || true
            fi
          done
        `,
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
      ).toString().trim()
      if (killed) {
        logger.info({ killed }, 'cloud_direct_orphan_kill_done')
      } else {
        logger.info('cloud_direct_orphan_kill_none_found')
      }
    } catch (err) {
      logger.warn({ err }, 'cloud_direct_orphan_kill_failed')
    }
  },

  /**
   * Resolve integradorId de uma câmera via getCameraContext (com cache 5min).
   * G12 fix: retorna null se não achar (em vez de 'default').
   * Caller deve abortar gravação e logar tenancy_misconfigured.
   */
  async resolveIntegradorId(cameraId: string): Promise<string | null> {
    const ctx = await getCameraContext(cameraId).catch(() => null)
    return ctx?.integradorId ?? null
  },

  /**
   * Reconcile-tick: percorre câmeras ativas e para gravação das que estão
   * fora da janela de schedule. Inicia também as que estão dentro mas não
   * iniciaram (ex: virou meia-noite e schedule abriu).
   * Chamado a cada 60s pelo timer registrado em start().
   */
  async tickReconcileSchedule(): Promise<void> {
    if (!ENABLED) return
    const now = new Date()

    // 1. Para gravações ativas que saíram da janela.
    for (const [cameraId] of active) {
      const eff = await getEffectiveRecordingMode(cameraId, now).catch(() => null)
      if (eff && !eff.shouldRecord) {
        logger.info({ cameraId }, 'cloud_direct_stopping_outside_schedule')
        this.stopRecording(cameraId)
      }
    }

    // 2. Inicia gravações para câmeras com push ativo + dentro da janela
    //    + não-rodando. Filtra recente: rtmpIngestLastFrameAt < 30s.
    //    Usa isRecordingAnywhere (Redis) para evitar duplicatas cross-réplica.
    const since = new Date(Date.now() - 30_000)
    const candidates = await prisma.camera.findMany({
      where: {
        deploymentMode: 'CLOUD_DIRECT',
        ingestMode:     { in: ['RTMP_PUSH', 'SRT_PUSH'] },
        active:         true,
        recordEnabled:  true,
        rtmpIngestLastFrameAt: { gt: since },
      },
      select: { id: true, go2rtcStreamId: true },
    })
    // Busca conjunto de câmeras ativas em Redis de uma vez (batch).
    // Evita N round-trips individuais ao Redis por câmera candidata.
    const activeAnywhere = await listActiveCameraIds()

    for (const cam of candidates) {
      if (!cam.go2rtcStreamId) continue
      // Fast-path local (síncrono)
      if (active.has(cam.id) || restartPending.has(cam.id)) continue
      // Cross-réplica: estava na lista de ativos do Redis?
      if (activeAnywhere.has(cam.id)) continue
      const eff = await getEffectiveRecordingMode(cam.id, now).catch(() => null)
      if (!eff?.shouldRecord) continue
      // Re-check local pós-await (protege race no mesmo processo)
      if (active.has(cam.id) || restartPending.has(cam.id)) continue
      const integradorId = await this.resolveIntegradorId(cam.id)
      if (!integradorId) continue   // G12 — sem tenant, não grava
      // Final re-check local
      if (active.has(cam.id) || restartPending.has(cam.id)) continue
      this.startRecording(cam.id, cam.go2rtcStreamId, integradorId).catch(() => {})
    }
  },
}

// Schedule reconcile timer — registrado em app.ts no boot.
let scheduleTimer: NodeJS.Timeout | null = null
export function startCloudDirectScheduleReconcile(): void {
  if (scheduleTimer) return
  if (!ENABLED) return
  scheduleTimer = setInterval(() => {
    cloudDirectRecorder.tickReconcileSchedule().catch(err =>
      logger.warn({ err }, 'cloud_direct_schedule_tick_failed'),
    )
  }, 60_000)
  logger.info('cloud_direct_schedule_reconcile_started')
}
export function stopCloudDirectScheduleReconcile(): void {
  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null }
}

