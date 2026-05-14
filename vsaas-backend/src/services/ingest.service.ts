/**
 * Ingest Service — pipeline de RTMP push do cliente para o VSaaS.
 *
 * Fluxo runtime:
 *   1. Câmera (Hikvision/Dahua/etc) configurada com URL e stream key
 *      empurra RTMP outbound TCP pro nosso `rtmp://INGEST_HOST/live/<key>`.
 *   2. go2rtc embarcado (porta 1935) aceita o push e cria stream com
 *      nome `<key>` automaticamente (`live/<key>` vira `<key>` no nome).
 *   3. Este serviço roda um polling a cada SYNC_INTERVAL_MS contra
 *      `GET /api/streams` do go2rtc. Para cada stream visto:
 *        a. Tenta resolver `cameraId` via decifragem das `rtmpIngestKeyEnc`
 *           cadastradas (linear; cache em memória deflagra na primeira
 *           varredura, custo amortizado).
 *        b. Se bate → AUTH_OK + atualiza `rtmpIngestLastFrameAt` na câmera
 *           e seta `Camera.go2rtcStreamId` pra que o WHEP funcione.
 *        c. Se não bate → AUTH_FAIL no log + DELETE no go2rtc (rejeita
 *           stream pirata pra não consumir banda/CPU).
 *
 * Por que polling em vez de webhook do go2rtc:
 *   - go2rtc 1.9.x não tem `on_publish` callback HTTP. Ele tem `exec:`
 *     mas é frágil para validação assíncrona com banco.
 *   - 5s de latência detectando push é aceitável (UX: "câmera apareceu
 *     online em ~5s"). Próxima geração: nginx-rtmp na frente com
 *     callback síncrono pra rejeitar antes do go2rtc nem ver.
 *
 * Por que AUTH_FAIL chama DELETE no go2rtc:
 *   - Sem isso, qualquer um pode encher o go2rtc com streams "pirata"
 *     pra consumir RAM/CPU do servidor (DoS leve).
 *   - DELETE é idempotente — apenas livra o pipeline; cliente RTMP
 *     que tentar reconnect cai no mesmo destino e perde de novo.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { decryptSecret } from './../lib/crypto'
import { cloudDirectRecorder } from './cloud-direct-recorder.service'
import { REPLICA_ID } from '../lib/recorder-state'
import { getRedis } from '../lib/redis'

const EMBEDDED_GO2RTC_URL = (process.env.EMBEDDED_GO2RTC_URL ?? 'http://172.17.0.1:1984').replace(/\/$/, '')
const EMBEDDED_GO2RTC_AUTH = process.env.EMBEDDED_GO2RTC_AUTH ?? ''

// 2s (antes 5s): reduz latência de detecção de PUBLISH_START/END. Importa pra
// CLOUD_DIRECT porque o startRecording só dispara depois do AUTH_OK ser visto
// por esse tick — 5s de polling = até 5s de gap na ponta de cada segmento novo.
// Custo: 1 GET HTTP local no go2rtc (≈ 1-2 KB) a cada 2s, irrelevante.
const SYNC_INTERVAL_MS = Number(process.env.RTMP_INGEST_SYNC_MS ?? 2000)

// ── Distributed leader lock para syncTick ────────────────────────────────
// Com múltiplas réplicas, apenas 1 deve executar o syncTick em cada intervalo.
// Sem isso: 3 réplicas × PUBLISH_START/END por câmera = log poluído + race
// conditions no stopRecording (réplica B tenta parar ffmpeg rodando na A).
//
// Protocolo:
//   1. SET icv:ingest:leader <REPLICA_ID> NX EX 8  → sou o líder para este tick
//   2. Se NX falhou: GET icv:ingest:leader → sou o líder antigo? → renovar TTL.
//   3. Se não sou o líder → skip syncTick.
//   TTL=8s (> SYNC_INTERVAL_MS=2s). Líderes refrescam a cada tick.
//   Se líder morre: TTL expira em 8s → próxima réplica vira líder.
const INGEST_LEADER_TTL_S = 8

async function acquireIngestLeader(): Promise<boolean> {
  try {
    const redis = getRedis()
    // Tenta virar líder (NX = só se não existir)
    // ioredis v5: ordem correta é EX primeiro, depois NX
    const acquired = await redis.set('ingest:leader', REPLICA_ID, 'EX', INGEST_LEADER_TTL_S, 'NX')
    if (acquired === 'OK') return true
    // Checa se já somos o líder atual e renova TTL
    const current = await redis.get('ingest:leader')
    if (current === REPLICA_ID) {
      await redis.expire('ingest:leader', INGEST_LEADER_TTL_S)
      return true
    }
    return false
  } catch {
    // Redis down → fallback: todas as réplicas rodam syncTick.
    // Resultado: log duplicado mas sem perda de funcionalidade.
    return true
  }
}

/** Cache em memória: streamName → cameraId. Reseta no restart. */
const keyToCameraId = new Map<string, string>()

let timer: NodeJS.Timeout | null = null

function authHeaders(): HeadersInit {
  return EMBEDDED_GO2RTC_AUTH
    ? { Authorization: `Basic ${Buffer.from(EMBEDDED_GO2RTC_AUTH).toString('base64')}` }
    : {}
}

/**
 * Resolve um stream name (que veio do path RTMP) pra um cameraId.
 * Faz lookup em cache; se não acha, varre as câmeras com modo RTMP_PUSH
 * habilitado e tenta decifrar a key. Cache populado on-demand.
 *
 * Retorna null se nenhuma câmera bate (push de origem desconhecida).
 */
async function resolveStreamToCameraId(streamName: string): Promise<string | null> {
  const cached = keyToCameraId.get(streamName)
  if (cached) return cached

  // Carrega só câmeras em modo PUSH com key configurada.
  // Em escala (>10k câmeras), trocar por índice em hash da key.
  const cams = await prisma.camera.findMany({
    where: {
      ingestMode: 'RTMP_PUSH',
      rtmpIngestKeyEnc: { not: null },
    },
    select: { id: true, rtmpIngestKeyEnc: true, go2rtcStreamId: true },
  })
  for (const c of cams) {
    const k = decryptSecret(c.rtmpIngestKeyEnc)
    if (k && k === streamName) {
      keyToCameraId.set(streamName, c.id)
      return c.id
    }
  }
  return null
}

/** Helper para gravar entrada no IngestLog (defensivo contra falhas de DB). */
async function log(
  event: 'PUBLISH_START' | 'PUBLISH_END' | 'AUTH_OK' | 'AUTH_FAIL' | 'UNKNOWN_PATH' | 'ERROR',
  streamPath: string,
  opts: {
    cameraId?: string | null
    remoteAddr?: string | null
    bytesIn?: number | null
    detailsJson?: Record<string, unknown> | null
  } = {},
) {
  try {
    await prisma.ingestLog.create({
      data: {
        event,
        streamPath,
        cameraId: opts.cameraId ?? null,
        remoteAddr: opts.remoteAddr ?? null,
        bytesIn: opts.bytesIn != null ? BigInt(opts.bytesIn) : null,
        detailsJson: (opts.detailsJson as never) ?? null,
      },
    })
  } catch (err) {
    logger.warn({ err, event, streamPath }, 'ingest_log_failed')
  }
}

/** Estado por streamName entre ticks — pra detectar publish_start vs continued. */
const seenStreams = new Map<string, { firstSeenAt: number; bytesLast: number }>()

/**
 * Tick de sincronização — lê go2rtc, vincula streams a câmeras, registra
 * eventos novos. Idempotente. Chamado a cada SYNC_INTERVAL_MS.
 */
async function syncTick() {
  // Com múltiplas réplicas, só o líder executa o syncTick completo.
  // Evita PUBLISH_START/END duplicados e race em stopRecording.
  // Fallback: se Redis down, todas as réplicas executam (degradação graciosa).
  const isLeader = await acquireIngestLeader()
  if (!isLeader) return

  let data: Record<string, any>
  try {
    const resp = await fetch(`${EMBEDDED_GO2RTC_URL}/api/streams`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
      headers: authHeaders(),
    })
    if (!resp.ok) return
    data = await resp.json()
  } catch {
    return // go2rtc em restart ou rede momentaneamente fora — silencia
  }

  const seenNow = new Set<string>()
  for (const [streamName, info] of Object.entries(data ?? {})) {
    seenNow.add(streamName)

    // Filtra: só nos interessam streams com producer RTMP ativo (push do cliente).
    // go2rtc 1.9.x expõe format_name="rtmp" no producer quando é push.
    // Streams PULL (EDGE_BOX) têm apenas producers com url rtsp:// externos.
    // Note: o workaround fake-RTSP adiciona um producer rtsp://127.x ao array,
    // por isso não podemos mais usar "não tem rtsp" como critério exclusivo.
    const producers = (info as any)?.producers ?? []
    const isPushed = producers.some((p: any) => p?.format_name === 'rtmp' || p?.protocol === 'rtmp')
    if (!isPushed) continue

    // Soma bytes_recv pra detectar streams "fantasma" (conectam mas não enviam)
    const bytesIn = producers.reduce((s: number, p: any) => s + (p?.bytes_recv ?? 0), 0)
    const rtmpProducer = producers.find((p: any) => p?.format_name === 'rtmp' || p?.protocol === 'rtmp')
    const remoteAddr = rtmpProducer?.remote_addr ?? producers[0]?.remote_addr ?? null

    const previously = seenStreams.get(streamName)
    if (!previously) {
      // Novo push detectado — resolve pra câmera e registra
      const cameraId = await resolveStreamToCameraId(streamName)
      if (cameraId) {
        await log('PUBLISH_START', `live/${streamName}`, { cameraId, remoteAddr, bytesIn })
        await log('AUTH_OK',       `live/${streamName}`, { cameraId, remoteAddr })
        // Vincula stream à câmera no go2rtc (caso ainda não esteja) +
        // marca câmera como ACTIVE — frames chegando = pipeline saudável.
        // Sem isso o painel mostrava INACTIVE/PENDING_CONFIG mesmo gravando.
        await prisma.camera.update({
          where: { id: cameraId },
          data: {
            go2rtcStreamId: streamName,
            rtmpIngestLastFrameAt: new Date(),
            status: 'ACTIVE',
          },
        })
        // SSE broadcast (Onda 2 / P2 #21): UI vê câmera ficar ACTIVE em ~5s
        // sem precisar de refresh manual. Targeting via integradorId.
        try {
          const { broadcastSse } = await import('../lib/sse-bus')
          const ctx = await prisma.camera.findUnique({
            where: { id: cameraId },
            select: { name: true, site: { select: { clienteFinal: { select: { integradorId: true, id: true } } } } },
          })
          if (ctx?.site?.clienteFinal?.integradorId) {
            broadcastSse({ scope: 'integrador', integradorId: ctx.site.clienteFinal.integradorId } as any, {
              type: 'camera_state',
              severity: 'INFO',
              title: 'Câmera online',
              body:  `${ctx.name} começou a transmitir.`,
              cameraId, cameraName: ctx.name, ts: Date.now(),
              meta: { event: 'PUBLISH_START', remoteAddr },
            } as any)
          }
        } catch { /* SSE opcional */ }
        // Inicia gravação cloud-direct → R2 para câmeras CLOUD_DIRECT.
        // Usa isRecordingAnywhere + isRestartPendingAnywhere para garantir
        // que NÃO haja duplicata mesmo com N réplicas rodando.
        if (!await cloudDirectRecorder.isRecordingAnywhere(cameraId) &&
            !await cloudDirectRecorder.isRestartPendingAnywhere(cameraId)) {
          const integradorId = await cloudDirectRecorder.resolveIntegradorId(cameraId)
          if (!integradorId) {
            logger.error({ cameraId, streamName },
              'cloud_direct_skip_tenancy_misconfigured')
          } else {
            cloudDirectRecorder.startRecording(cameraId, streamName, integradorId).catch(err =>
              logger.warn({ err, cameraId, streamName }, 'cloud_direct_recorder_start_failed'),
            )
          }
        }
      } else {
        await log('AUTH_FAIL', `live/${streamName}`, { remoteAddr, bytesIn,
          detailsJson: { reason: 'unknown_stream_key' } })
        // DELETE no go2rtc — rejeita stream sem dono.
        try {
          await fetch(
            `${EMBEDDED_GO2RTC_URL}/api/streams?src=${encodeURIComponent(streamName)}`,
            { method: 'DELETE', signal: AbortSignal.timeout(2000), headers: authHeaders() },
          )
        } catch {/* ignore */}
      }
    } else {
      // Já conhecido. Se está enviando bytes, atualiza heartbeat da câmera.
      const cameraId = await resolveStreamToCameraId(streamName)
      if (cameraId && bytesIn > previously.bytesLast) {
        await prisma.camera.update({
          where: { id: cameraId },
          data: { rtmpIngestLastFrameAt: new Date() },
        }).catch(() => {})
      }
    }
    seenStreams.set(streamName, { firstSeenAt: previously?.firstSeenAt ?? Date.now(), bytesLast: bytesIn })
  }

  // Streams que sumiram desde o último tick → PUBLISH_END
  for (const [streamName, prev] of seenStreams.entries()) {
    if (seenNow.has(streamName)) continue
    const cameraId = keyToCameraId.get(streamName) ?? null
    await log('PUBLISH_END', `live/${streamName}`, {
      cameraId,
      bytesIn: prev.bytesLast,
      detailsJson: { sessionDurationMs: Date.now() - prev.firstSeenAt },
    })
    // Para gravação cloud-direct quando câmera desconecta + marca INACTIVE.
    // Operador no painel vê o stream caiu e investiga.
    if (cameraId) {
      cloudDirectRecorder.stopRecording(cameraId)
      await prisma.camera.update({
        where: { id: cameraId },
        data: { status: 'INACTIVE' },
      }).catch(() => {})
      // SSE broadcast — UI vê câmera ficar offline imediatamente
      try {
        const { broadcastSse } = await import('../lib/sse-bus')
        const ctx = await prisma.camera.findUnique({
          where: { id: cameraId },
          select: { name: true, site: { select: { clienteFinal: { select: { integradorId: true } } } } },
        })
        if (ctx?.site?.clienteFinal?.integradorId) {
          broadcastSse({ scope: 'integrador', integradorId: ctx.site.clienteFinal.integradorId } as any, {
            type: 'camera_state',
            severity: 'WARNING',
            title: 'Câmera desconectou',
            body:  `${ctx.name} parou de transmitir.`,
            cameraId, cameraName: ctx.name, ts: Date.now(),
            meta: { event: 'PUBLISH_END', sessionDurationMs: Date.now() - prev.firstSeenAt },
          } as any)
        }
      } catch { /* SSE opcional */ }
    }
    seenStreams.delete(streamName)
  }

  // Re-registra câmeras RTMP_PUSH ausentes do go2rtc.
  // go2rtc evicta entradas API quando o RTSP placeholder falha (não persiste).
  // A cada tick garantimos que câmeras ativas (push <15min) estão registradas.
  reregisterDormantStreams(data).catch(() => {})
}

async function reregisterDormantStreams(currentStreams: Record<string, any>) {
  const registered = new Set(Object.keys(currentStreams))
  // Inclui câmeras que pushearam nas últimas 24h OU criadas nas últimas 2h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recentlyCreated = new Date(Date.now() - 2 * 60 * 60 * 1000)
  const cams = await prisma.camera.findMany({
    where: {
      ingestMode: 'RTMP_PUSH', deploymentMode: 'CLOUD_DIRECT', active: true,
      rtmpIngestKeyEnc: { not: null },
      OR: [{ rtmpIngestLastFrameAt: { gt: since } }, { createdAt: { gt: recentlyCreated } }],
    },
    select: { id: true, rtmpIngestKeyEnc: true },
  })
  let reregistered = 0
  for (const cam of cams) {
    const key = decryptSecret(cam.rtmpIngestKeyEnc!)
    if (!key || registered.has(key)) continue
    try {
      // go2rtc 1.9.x: formato correto é query params, não body JSON
      const regUrl = `${EMBEDDED_GO2RTC_URL}/api/streams?name=${encodeURIComponent(key)}&src=${encodeURIComponent('rtsp://127.0.0.1:19999/placeholder')}`
      await fetch(regUrl, {
        method: 'PUT',
        headers: authHeaders(),
        signal: AbortSignal.timeout(2000),
      })
      reregistered++
    } catch { /* ignore */ }
  }
  if (reregistered > 0) logger.debug({ reregistered }, 'ingest_go2rtc_streams_reregistered')
}

export const ingestService = {
  /** Chamar uma vez ao subir o backend; idempotente em re-imports (HMR safe). */
  start(): void {
    if (timer) return
    timer = setInterval(() => {
      syncTick().catch(err => logger.warn({ err }, 'ingest_sync_tick_failed'))
    }, SYNC_INTERVAL_MS)
    logger.info({ intervalMs: SYNC_INTERVAL_MS, go2rtc: EMBEDDED_GO2RTC_URL }, 'ingest_sync_started')
  },

  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
    keyToCameraId.clear()
    seenStreams.clear()
  },

  /** Invalida cache para uma câmera específica (chamar no PATCH). */
  invalidateKeyCache(streamKey: string | null): void {
    if (streamKey) keyToCameraId.delete(streamKey)
    // Conservador: limpamos tudo pra evitar entries stale apontando pra
    // câmera que mudou de key. Repopula no próximo tick.
    keyToCameraId.clear()
  },
}
