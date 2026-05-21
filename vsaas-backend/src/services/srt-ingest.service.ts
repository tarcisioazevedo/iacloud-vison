/**
 * MediaMTX Path Ingest Service — detecta publishers ativos no MediaMTX
 * (qualquer protocolo) e mantém Camera.status + rtmpIngestLastFrameAt
 * atualizados.
 *
 * Por que é necessário:
 *   - Câmeras CLOUD_DIRECT (RTMP_PUSH, SRT_PUSH, RTSP_PUSH e RTSP_PULL via
 *     MediaMTX) entregam stream direto ao MediaMTX. Sem este service, nada
 *     atualiza rtmpIngestLastFrameAt → cloud-direct-recorder filtra por
 *     `rtmpIngestLastFrameAt > now-30s` e nunca dispara → câmera ativa,
 *     IA detecta, MAS gravação não roda.
 *
 * Tipos de source MediaMTX cobertos:
 *   - 'srtConn'      SRT publish (cliente empurra)
 *   - 'rtmpConn'     RTMP publish (cliente empurra)
 *   - 'rtspSession'  RTSP publish (cliente empurra)
 *   - 'rtspSource'   RTSP pull (MediaMTX puxa de IP cam)
 *
 * Fluxo:
 *   1. GET http://mediamtx:9997/v3/paths/list a cada SYNC_INTERVAL_MS
 *   2. Para cada path com source.type em PUSH_SOURCE_TYPES e online=true:
 *      a. Busca câmera CLOUD_DIRECT com rtspMainUrl contendo o path name
 *      b. Se acha: update status='ACTIVE', rtmpIngestLastFrameAt=NOW()
 *         + dispara cloudDirectRecorder.startRecording se não estiver gravando
 *      c. Se não acha: loga warn (SRT pirata ou não cadastrado)
 *   3. Para paths que sumiram (eram srtConn, agora offline/ausentes):
 *      a. update status='INACTIVE' na câmera correspondente
 *      b. cloudDirectRecorder.stopRecording
 *
 * Correlação path ↔ câmera:
 *   Camera.rtspMainUrl = 'rtsp://mediamtx:8556/<path_name>'
 *   Extraímos o <path_name> da URL e comparamos com o path.name da API.
 *
 * Custo: 1 HTTP GET local (≈ 1-5 KB) a cada SRT_SYNC_INTERVAL_MS (default 2s).
 * Muito mais leve que o ingest.service.ts (500ms), pois SRT_PUSH é raro no MVP.
 */

import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { cloudDirectRecorder } from './cloud-direct-recorder.service'

const MEDIAMTX_API = (process.env.MEDIAMTX_INTERNAL_URL ?? 'http://mediamtx:8889')
  .replace(/:\d+$/, ':9997')

const SRT_SYNC_INTERVAL_MS = Number(process.env.SRT_INGEST_SYNC_MS ?? 2000)

// Tipos de source no MediaMTX que indicam stream ativo. Cobre os 3 ingestModes
// suportados no schema Camera: SRT_PUSH, RTMP_PUSH, RTSP_PULL.
const PUSH_SOURCE_TYPES = new Set([
  'srtConn',    // SRT publish (cliente empurra)
  'rtmpConn',   // RTMP publish (cliente empurra)
  'rtspSource', // RTSP pull (MediaMTX puxa de IP cam)
])

// ingestMode aceitos no banco que mapeiam para os source.type acima.
// Apenas os 3 valores que existem no enum IngestMode do schema Prisma.
const ACCEPTED_INGEST_MODES = ['SRT_PUSH', 'RTMP_PUSH', 'RTSP_PULL'] as const

// Rastreia paths ativos entre ticks: pathName → { cameraId, firstSeenAt, inboundBytesLast, sourceType }
const activeSrtPaths = new Map<string, { cameraId: string; firstSeenAt: number; inboundBytesLast: number; sourceType: string }>()

let timer: NodeJS.Timeout | null = null

/**
 * Extrai o path name do MediaMTX de uma rtspMainUrl.
 * Ex: 'rtsp://mediamtx:8556/test-larix-srt' → 'test-larix-srt'
 *     'rtsp://mediamtx:8556/box-abc/cam-xyz/main' → 'box-abc/cam-xyz/main'
 */
function extractPathName(rtspMainUrl: string): string | null {
  try {
    const url = new URL(rtspMainUrl)
    // Remove leading slash
    return url.pathname.replace(/^\//, '') || null
  } catch {
    return null
  }
}

/**
 * Cache em memória: mediaMtxPathName → cameraId.
 * Populado on-demand na primeira vez que um path é visto.
 */
const pathToCameraId = new Map<string, string>()

async function resolvePathToCameraId(pathName: string): Promise<string | null> {
  const cached = pathToCameraId.get(pathName)
  if (cached) return cached

  // Busca câmera CLOUD_DIRECT com qualquer ingestMode push-based, rtspMainUrl
  // apontando pra mediamtx no path em questão.
  const cams = await prisma.camera.findMany({
    where: {
      active: true,
      ingestMode: { in: [...ACCEPTED_INGEST_MODES] },
      deploymentMode: 'CLOUD_DIRECT',
    },
    select: { id: true, rtspMainUrl: true },
  })

  for (const c of cams) {
    if (!c.rtspMainUrl) continue
    const extracted = extractPathName(c.rtspMainUrl)
    if (extracted === pathName) {
      pathToCameraId.set(pathName, c.id)
      return c.id
    }
  }

  // Fallback: câmeras CLOUD_DIRECT sem ingestMode explícito (retrocompatível)
  // que tenham rtspMainUrl apontando para mediamtx
  const fallbackCams = await prisma.camera.findMany({
    where: {
      active: true,
      deploymentMode: 'CLOUD_DIRECT',
      rtspMainUrl: { contains: pathName },
    },
    select: { id: true, rtspMainUrl: true },
  })

  for (const c of fallbackCams) {
    if (!c.rtspMainUrl) continue
    const extracted = extractPathName(c.rtspMainUrl)
    if (extracted === pathName) {
      pathToCameraId.set(pathName, c.id)
      return c.id
    }
  }

  return null
}

async function srtSyncTick(): Promise<void> {
  let paths: Array<{
    name: string
    online: boolean
    source: { type: string; id: string } | null
    inboundBytes: number
    bytesReceived: number
  }>

  try {
    const resp = await fetch(`${MEDIAMTX_API}/v3/paths/list`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!resp.ok) return
    const data = await resp.json() as { items: typeof paths }
    paths = data.items ?? []
  } catch {
    return // MediaMTX down ou rede — silencia
  }

  // Paths com publisher ativo agora (RTMP/SRT/RTSP)
  const srtOnlineNow = new Set<string>()

  for (const path of paths) {
    // Só nos interessam paths online com source push/pull suportado
    if (!path.online || !path.source) continue
    const sourceType = path.source.type
    if (!PUSH_SOURCE_TYPES.has(sourceType)) continue

    srtOnlineNow.add(path.name)
    const inboundBytes = path.bytesReceived ?? path.inboundBytes ?? 0

    const prev = activeSrtPaths.get(path.name)
    if (!prev) {
      // Novo publisher detectado
      const cameraId = await resolvePathToCameraId(path.name)
      if (!cameraId) {
        logger.warn({ pathName: path.name, sourceType }, 'mediamtx_ingest_unknown_path')
        // Registra como unknown pra não repetir o log todo tick
        activeSrtPaths.set(path.name, { cameraId: '', firstSeenAt: Date.now(), inboundBytesLast: inboundBytes, sourceType })
        continue
      }

      activeSrtPaths.set(path.name, { cameraId, firstSeenAt: Date.now(), inboundBytesLast: inboundBytes, sourceType })

      await prisma.camera.update({
        where: { id: cameraId },
        data: {
          status: 'ACTIVE',
          rtmpIngestLastFrameAt: new Date(),
          lastOnlineAt: new Date(),
        },
      }).catch(err => logger.warn({ err, cameraId }, 'mediamtx_ingest_db_update_failed'))

      logger.info({ pathName: path.name, cameraId, sourceType }, 'mediamtx_ingest_publish_start')

      // SSE broadcast — UI vê câmera ficar ACTIVE imediatamente
      try {
        const { broadcastSse } = await import('../lib/sse-bus')
        const ctx = await prisma.camera.findUnique({
          where: { id: cameraId },
          select: { name: true, site: { select: { clienteFinal: { select: { integradorId: true } } } } },
        })
        if (ctx?.site?.clienteFinal?.integradorId) {
          // Label amigavel por tipo de stream
          const proto = sourceType === 'srtConn' ? 'SRT'
                      : sourceType === 'rtmpConn' ? 'RTMP'
                      : sourceType === 'rtspSession' ? 'RTSP'
                      : sourceType === 'rtspSource' ? 'RTSP (pull)'
                      : sourceType
          broadcastSse({ scope: 'integrador', integradorId: ctx.site.clienteFinal.integradorId } as any, {
            type: 'camera_state',
            severity: 'INFO',
            title: `Câmera online (${proto})`,
            body: `${ctx.name} começou a transmitir via ${proto}.`,
            cameraId,
            cameraName: ctx.name,
            ts: Date.now(),
            meta: { event: 'PUBLISH_START', pathName: path.name, sourceType },
          } as any)
        }
      } catch { /* SSE opcional */ }

      // Inicia gravação cloud-direct
      if (!await cloudDirectRecorder.isRecordingAnywhere(cameraId) &&
          !await cloudDirectRecorder.isRestartPendingAnywhere(cameraId)) {
        const integradorId = await cloudDirectRecorder.resolveIntegradorId(cameraId)
        if (integradorId) {
          // Para cloud-direct-recorder, o "streamName" é o go2rtcStreamId.
          // A câmera SRT_PUSH usa go2rtcStreamId (o stream no go2rtc que puxa
          // via RTSP do mediamtx). Busca go2rtcStreamId da câmera.
          const cam = await prisma.camera.findUnique({
            where: { id: cameraId },
            select: { go2rtcStreamId: true },
          })
          if (cam?.go2rtcStreamId) {
            cloudDirectRecorder.startRecording(cameraId, cam.go2rtcStreamId, integradorId).catch(err =>
              logger.warn({ err, cameraId }, 'mediamtx_ingest_recorder_start_failed'),
            )
          }
        }
      }
    } else if (prev.cameraId && inboundBytes > prev.inboundBytesLast) {
      // Já conhecido e recebendo bytes → heartbeat
      activeSrtPaths.set(path.name, { ...prev, inboundBytesLast: inboundBytes })
      await prisma.camera.update({
        where: { id: prev.cameraId },
        data: { rtmpIngestLastFrameAt: new Date(), lastOnlineAt: new Date() },
      }).catch(() => {})
    }
  }

  // Paths SRT que sumiram → offline
  for (const [pathName, prev] of activeSrtPaths.entries()) {
    if (srtOnlineNow.has(pathName)) continue
    if (!prev.cameraId) {
      // Unknown path que sumiu — limpa cache
      activeSrtPaths.delete(pathName)
      pathToCameraId.delete(pathName)
      continue
    }

    logger.info({ pathName, cameraId: prev.cameraId, sourceType: prev.sourceType, durationMs: Date.now() - prev.firstSeenAt }, 'mediamtx_ingest_publish_end')

    await prisma.camera.update({
      where: { id: prev.cameraId },
      data: { status: 'INACTIVE' },
    }).catch(() => {})

    cloudDirectRecorder.stopRecording(prev.cameraId)

    try {
      const { broadcastSse } = await import('../lib/sse-bus')
      const ctx = await prisma.camera.findUnique({
        where: { id: prev.cameraId },
        select: { name: true, site: { select: { clienteFinal: { select: { integradorId: true } } } } },
      })
      if (ctx?.site?.clienteFinal?.integradorId) {
        const proto = prev.sourceType === 'srtConn' ? 'SRT'
                    : prev.sourceType === 'rtmpConn' ? 'RTMP'
                    : prev.sourceType === 'rtspSession' ? 'RTSP'
                    : prev.sourceType === 'rtspSource' ? 'RTSP (pull)'
                    : prev.sourceType
        broadcastSse({ scope: 'integrador', integradorId: ctx.site.clienteFinal.integradorId } as any, {
          type: 'camera_state',
          severity: 'WARNING',
          title: `Câmera desconectou (${proto})`,
          body: `${ctx.name} parou de transmitir.`,
          cameraId: prev.cameraId,
          cameraName: ctx.name,
          ts: Date.now(),
          meta: { event: 'PUBLISH_END', pathName, sourceType: prev.sourceType, sessionDurationMs: Date.now() - prev.firstSeenAt },
        } as any)
      }
    } catch { /* SSE opcional */ }

    activeSrtPaths.delete(pathName)
    pathToCameraId.delete(pathName)
  }
}

export const srtIngestService = {
  start(): void {
    if (timer) return
    timer = setInterval(() => {
      srtSyncTick().catch(err => logger.warn({ err }, 'mediamtx_ingest_tick_failed'))
    }, SRT_SYNC_INTERVAL_MS)
    // Roda imediatamente na inicialização pra não esperar o primeiro tick
    srtSyncTick().catch(() => {})
    logger.info({
      intervalMs: SRT_SYNC_INTERVAL_MS,
      mediamtx: MEDIAMTX_API,
      sourceTypes: [...PUSH_SOURCE_TYPES],
    }, 'mediamtx_ingest_started')
  },

  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
    activeSrtPaths.clear()
    pathToCameraId.clear()
  },

  /** Invalida cache de path (chamar quando rtspMainUrl de câmera mudar). */
  invalidatePathCache(pathName?: string): void {
    if (pathName) {
      pathToCameraId.delete(pathName)
    } else {
      pathToCameraId.clear()
    }
  },
}
