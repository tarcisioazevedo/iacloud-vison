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

function authHeaders(): HeadersInit {
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
 * Reconcilia todos os paths EDGE_BOX ativos no mediamtx.
 * Chamado no startup do backend e após restart do mediamtx (detectado pelo
 * health endpoint retornar 2xx após um período down).
 *
 * Busca câmeras ativas com edgeNodeId + go2rtcStreamId (= stream name).
 * Registra até MAX_BATCH de uma vez pra não sobrecarregar mediamtx no boot.
 */
export async function reconcileAllPaths(): Promise<void> {
  try {
    const cams = await prisma.camera.findMany({
      where: {
        active:        true,
        edgeNodeId:    { not: null },
        go2rtcStreamId: { not: null },
      },
      select: { id: true, edgeNodeId: true, go2rtcStreamId: true },
    })

    if (cams.length === 0) return

    logger.info({ count: cams.length }, 'mediamtx_paths_reconcile_start')
    let ok = 0
    let fail = 0
    for (const cam of cams) {
      const success = await registerCameraPath(
        cam.edgeNodeId!,
        cam.go2rtcStreamId!,
      )
      if (success) ok++; else fail++
    }
    logger.info({ ok, fail }, 'mediamtx_paths_reconcile_done')
  } catch (err) {
    // Erro de banco — não propaga (boot não deve falhar por isso)
    logger.warn({ err }, 'mediamtx_paths_reconcile_db_error')
  }
}
