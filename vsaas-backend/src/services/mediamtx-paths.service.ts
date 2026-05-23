/**
 * MediaMTX Paths Service
 *
 * Registra paths por câmera no mediamtx com `alwaysAvailable: true` e
 * `alwaysAvailableFile: /assets/camera-offline.mp4`.
 *
 * Por que é necessário:
 *   - mediamtx v1.16+ suporta alwaysAvailableFile, mas SOMENTE em paths
 *     nomeados específicos — não em pathDefaults/all_others (wildcard).
 *   - Sem isso: viewer vê erro RTSP 404 / HLS 404 quando box está offline.
 *   - Com isso: viewer vê o vídeo "Câmera Offline" em loop enquanto aguarda.
 *
 * Fluxo:
 *   1. Backend sobe → reconcileAllPaths() registra todos os paths EDGE_BOX.
 *   2. Câmera/box provisionada → registerCameraPath() registra o path.
 *   3. Mediamtx reinicia → reconcileAllPaths() no próximo healthcheck ou
 *      re-registro automático no próximo tick do camera-watchdog.
 *
 * Path name format: `${edgeNodeId}/${streamName}/main`
 *   Exemplo: `box-abc123de/cam-f4a1b2c3/main`
 *   (mesmo formato que live.ts usa para consultar mediamtx API)
 *
 * Tolerância a falhas:
 *   - Mediamtx down → log warn, sem throw. A câmera funciona normalmente
 *     quando o publisher estiver ativo; só perde o placeholder.
 *   - Path já existe (409) → ignorado (idempotente via PATCH).
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const MEDIAMTX_API = (process.env.MEDIAMTX_INTERNAL_URL ?? 'http://mediamtx:8889')
  .replace(':8889', ':9997')
const OFFLINE_FILE = '/assets/camera-offline.mp4'
const TIMEOUT_MS   = 3000

function authHeaders(): Record<string, string> {
  return {}  // API acessível apenas da rede interna Docker (auth por IP no config)
}

/**
 * Registra (ou atualiza) um path no mediamtx com o placeholder de offline.
 * Idempotente — chama PATCH /v3/config/paths/patch/:name para não sobrescrever
 * configurações existentes que a box possa ter feito.
 */
export async function registerCameraPath(
  edgeNodeId: string,
  streamName: string,
): Promise<boolean> {
  const pathName = `${edgeNodeId}/${streamName}/main`
  try {
    // Tenta criar o path (POST). Se já existe (409), faz patch em vez disso.
    const body = JSON.stringify({
      alwaysAvailable:     true,
      alwaysAvailableFile: OFFLINE_FILE,
    })

    const postResp = await fetch(
      `${MEDIAMTX_API}/v3/config/paths/add/${encodeURIComponent(pathName)}`,
      {
        method:  'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body,
        signal:  AbortSignal.timeout(TIMEOUT_MS),
      },
    )

    if (postResp.status === 409 || postResp.status === 400) {
      // mediamtx retorna 400 (não 409) quando path já existe.
      // Faz patch para garantir que alwaysAvailable está ativo no path existente.
      const patchResp = await fetch(
        `${MEDIAMTX_API}/v3/config/paths/patch/${encodeURIComponent(pathName)}`,
        {
          method:  'PATCH',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body,
          signal:  AbortSignal.timeout(TIMEOUT_MS),
        },
      )
      if (!patchResp.ok) {
        logger.warn(
          { pathName, status: patchResp.status },
          'mediamtx_path_patch_failed',
        )
        return false
      }
    } else if (!postResp.ok) {
      logger.warn(
        { pathName, status: postResp.status },
        'mediamtx_path_register_failed',
      )
      return false
    }

    logger.debug({ pathName }, 'mediamtx_path_registered')
    return true
  } catch (err) {
    // mediamtx down ou rede — apenas loga, não quebra o fluxo principal
    logger.warn({ err, pathName }, 'mediamtx_path_register_error')
    return false
  }
}

/** Sentinel gravado em Camera.ffmpegInputArgs quando precisa transcoding pra WebRTC.
 *  Streams com B-frames (has_b_frames > 0) ou áudio não-Opus quebram o WebRTC do
 *  navegador. Mediamtx só remuxa — não transcoda. Solução: ffmpeg sidecar via
 *  runOnInit re-encoda H264 Baseline (sem B-frames, sem áudio) antes de publicar
 *  no path. Custo: ~50-100% CPU/câmera 1080p sem GPU. */
export const WEBRTC_TRANSCODE_SENTINEL = 'webrtc-transcode'

/**
 * Registra um path no mediamtx que faz PULL de um RTSP externo (CLOUD_DIRECT).
 *
 * Diferente de `registerCameraPath` (que cria placeholder `publisher` aguardando
 * Box empurrar SRT), aqui o mediamtx é quem conecta no RTSP e remuxa pra HLS/WebRTC.
 *
 * Convenção de nome: `cam-{cameraId8}` — primeiros 8 chars do UUID da câmera.
 * O backend resolve esse path em `liveService` via `camera.go2rtcStreamId`.
 *
 * Modos:
 *   - `transcode=false` (default): mediamtx faz PULL direto + remux.
 *     Funciona pra streams H264 sem B-frames + sem áudio AAC.
 *   - `transcode=true`: cria path como `publisher` + spawn ffmpeg via runOnInit
 *     que lê RTSP externo, re-encoda H264 Baseline (-bf 0) sem áudio (-an) e
 *     publica no path. Necessário pra streams com B-frames (Hikvision/Dahua em
 *     CBR default) ou áudio AAC (browser WebRTC só aceita Opus).
 *
 * `sourceOnDemand` default = false → mantém pull contínuo. Em prod, considerar
 * trocar pra `true` quando UI tiver indicador de "aquecendo stream" (HLS leva
 * 5-10s pra começar entregando segmento depois do connect).
 */
export async function registerCloudDirectRtspPath(
  cameraId: string,
  rtspUrl:  string,
  opts: { transcode?: boolean } = {},
): Promise<{ pathName: string; ok: boolean; transcoding: boolean }> {
  const pathName = `cam-${cameraId.slice(0, 8)}`
  const transcode = opts.transcode === true

  try {
    const body = transcode
      ? JSON.stringify({
          source:           'publisher',
          // ffmpeg lê RTSP externo, remove B-frames + áudio, republica em loopback.
          // runOnInitRestart=true garante respawn se ffmpeg cair (rede, fonte, etc).
          // Porta 8556 é o rtspAddress do mediamtx (NÃO 8554 — esse é cliente externo).
          runOnInit:        `ffmpeg -hide_banner -loglevel warning -rtsp_transport tcp -i ${rtspUrl} -c:v libx264 -bf 0 -profile:v baseline -preset ultrafast -tune zerolatency -g 30 -keyint_min 30 -sc_threshold 0 -an -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8556/${pathName}`,
          runOnInitRestart: true,
        })
      : JSON.stringify({
          source:                     rtspUrl,
          sourceOnDemand:             false,           // pull contínuo — UI aparece em ~1s
          sourceProtocol:             'tcp',            // TCP mais confiável que UDP em NAT
          sourceOnDemandStartTimeout: '15s',
          sourceOnDemandCloseAfter:   '30s',
        })

    const postResp = await fetch(
      `${MEDIAMTX_API}/v3/config/paths/add/${encodeURIComponent(pathName)}`,
      {
        method:  'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body,
        signal:  AbortSignal.timeout(TIMEOUT_MS),
      },
    )

    // Já existe → patch pra atualizar URL/config (suporta troca de RTSP +
    // ligar/desligar transcoding sem perder o pathName).
    if (postResp.status === 400 || postResp.status === 409) {
      const patchResp = await fetch(
        `${MEDIAMTX_API}/v3/config/paths/patch/${encodeURIComponent(pathName)}`,
        {
          method:  'PATCH',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body,
          signal:  AbortSignal.timeout(TIMEOUT_MS),
        },
      )
      if (!patchResp.ok) {
        logger.warn({ pathName, status: patchResp.status, transcode }, 'mediamtx_pull_path_patch_failed')
        return { pathName, ok: false, transcoding: transcode }
      }
    } else if (!postResp.ok) {
      logger.warn({ pathName, status: postResp.status, transcode }, 'mediamtx_pull_path_register_failed')
      return { pathName, ok: false, transcoding: transcode }
    }

    logger.info({ pathName, cameraId, transcoding: transcode }, 'mediamtx_pull_path_registered')
    return { pathName, ok: true, transcoding: transcode }
  } catch (err) {
    logger.warn({ err, pathName }, 'mediamtx_pull_path_register_error')
    return { pathName, ok: false, transcoding: transcode }
  }
}

/**
 * Remove um path do mediamtx (chamar ao deletar câmera ou trocar edge box).
 */
export async function removeCameraPath(
  edgeNodeId: string,
  streamName: string,
): Promise<void> {
  const pathName = `${edgeNodeId}/${streamName}/main`
  try {
    await fetch(
      `${MEDIAMTX_API}/v3/config/paths/delete/${encodeURIComponent(pathName)}`,
      {
        method: 'DELETE',
        headers: authHeaders(),
        signal:  AbortSignal.timeout(TIMEOUT_MS),
      },
    )
    logger.debug({ pathName }, 'mediamtx_path_removed')
  } catch {
    // Ignorado — path inexistente ou mediamtx down
  }
}

/**
 * Remove path CLOUD_DIRECT do mediamtx (chamar ao deletar câmera).
 */
export async function removeCloudDirectRtspPath(cameraId: string): Promise<void> {
  const pathName = `cam-${cameraId.slice(0, 8)}`
  try {
    await fetch(
      `${MEDIAMTX_API}/v3/config/paths/delete/${encodeURIComponent(pathName)}`,
      {
        method:  'DELETE',
        headers: authHeaders(),
        signal:  AbortSignal.timeout(TIMEOUT_MS),
      },
    )
    logger.debug({ pathName }, 'mediamtx_pull_path_removed')
  } catch {
    // Ignorado — path inexistente ou mediamtx down
  }
}

/**
 * Detecta via ffprobe se um RTSP precisa de transcoding pra WebRTC funcionar
 * no navegador. Streams com B-frames OU áudio AAC quebram WebRTC (browser só
 * aceita H264 sem B-frames + áudio Opus). Mediamtx só faz remux, não transcoda.
 *
 * Timeout 15s — câmera offline retorna `false` (assume que não precisa) pra
 * não bloquear o registro inicial. Caso reaprenda depois quando ficar online,
 * basta re-chamar.
 */
export async function probeNeedsTranscoding(rtspUrl: string): Promise<boolean> {
  try {
    const { spawn } = await import('node:child_process')
    return await new Promise<boolean>((resolve) => {
      const proc = spawn('ffprobe', [
        '-v', 'error',
        '-rtsp_transport', 'tcp',
        '-show_streams',
        '-of', 'json',
        rtspUrl,
      ], { stdio: ['ignore', 'pipe', 'ignore'] })

      let stdout = ''
      proc.stdout.on('data', chunk => { stdout += chunk.toString() })

      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve(false)  // timeout → assume que não precisa, registra simples
      }, 15_000)

      proc.on('close', () => {
        clearTimeout(timer)
        try {
          const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_name?: string; codec_type?: string; has_b_frames?: number }> }
          const streams = parsed.streams ?? []
          const video = streams.find(s => s.codec_type === 'video')
          const audio = streams.find(s => s.codec_type === 'audio')

          const hasBFrames = !!video?.has_b_frames && video.has_b_frames > 0
          // Áudio AAC (mp4a.40.2) também quebra LL-HLS muxer do mediamtx.
          const audioIncompatible = !!audio && audio.codec_name !== 'opus'

          resolve(hasBFrames || audioIncompatible)
        } catch {
          resolve(false)  // parse falhou → não precisa
        }
      })
      proc.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  } catch {
    return false
  }
}

/**
 * Reconcilia todos os paths ativos no mediamtx (EDGE_BOX + CLOUD_DIRECT).
 * Chamado no startup do backend e após restart do mediamtx (detectado pelo
 * health endpoint retornar 2xx após um período down).
 *
 * Cobre 2 modelos de deployment:
 *   - EDGE_BOX: registerCameraPath() — placeholder publisher + alwaysAvailable
 *   - CLOUD_DIRECT + RTSP_PULL: registerCloudDirectRtspPath() — source rtsp:// + remux,
 *     OU publisher + runOnInit (ffmpeg sidecar) quando ffmpegInputArgs===WEBRTC_TRANSCODE_SENTINEL.
 *
 * O caso CLOUD_DIRECT é crítico pra evitar perda de imagem em restart do
 * mediamtx — antes deste reconcile, restart do mediamtx perdia toda config
 * de paths (incluindo o runOnInit do transcoding) e câmeras com B-frames
 * ficavam pretas até intervenção manual.
 */
export async function reconcileAllPaths(): Promise<void> {
  try {
    const [edgeCams, cloudCams] = await Promise.all([
      prisma.camera.findMany({
        where: {
          active:        true,
          edgeNodeId:    { not: null },
          go2rtcStreamId: { not: null },
        },
        select: { id: true, edgeNodeId: true, go2rtcStreamId: true },
      }),
      prisma.camera.findMany({
        where: {
          active:         true,
          deploymentMode: 'CLOUD_DIRECT',
          ingestMode:     'RTSP_PULL',
        },
        select: { id: true, rtspMainUrl: true, ffmpegInputArgs: true, name: true, go2rtcStreamId: true },
      }).then(rows => rows.filter(r => r.rtspMainUrl && r.go2rtcStreamId)),
    ])

    const total = edgeCams.length + cloudCams.length
    if (total === 0) return

    logger.info({ edge: edgeCams.length, cloudDirect: cloudCams.length }, 'mediamtx_paths_reconcile_start')
    let ok = 0
    let fail = 0

    for (const cam of edgeCams) {
      const success = await registerCameraPath(cam.edgeNodeId!, cam.go2rtcStreamId!)
      if (success) ok++; else fail++
    }

    for (const cam of cloudCams) {
      const transcode = cam.ffmpegInputArgs === WEBRTC_TRANSCODE_SENTINEL
      const result = await registerCloudDirectRtspPath(cam.id, cam.rtspMainUrl!, { transcode })
      if (result.ok) ok++; else fail++
    }

    logger.info({ ok, fail, total }, 'mediamtx_paths_reconcile_done')
  } catch (err) {
    // Erro de banco — não propaga (boot não deve falhar por isso)
    logger.warn({ err }, 'mediamtx_paths_reconcile_db_error')
  }
}
