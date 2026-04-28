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

const EMBEDDED_GO2RTC_URL = (process.env.EMBEDDED_GO2RTC_URL ?? 'http://172.17.0.1:1984').replace(/\/$/, '')
const EMBEDDED_GO2RTC_AUTH = process.env.EMBEDDED_GO2RTC_AUTH ?? ''

const SYNC_INTERVAL_MS = Number(process.env.RTMP_INGEST_SYNC_MS ?? 5000)

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

    // Filtra: só nos interessam streams que VIERAM de push RTMP do cliente,
    // não os que CRIAMOS via PUT /api/streams (esses já têm rtspUrl como
    // primeiro producer). Heurística: stream sem `producers[*].url` que
    // começa com `rtsp://` é um push (publish input).
    const producers = (info as any)?.producers ?? []
    const isPushed = producers.length > 0
      && producers.every((p: any) => !p?.url || /^rtmp:\/\//i.test(p.url) || p.url === '')
      && !producers.some((p: any) => p?.url?.startsWith?.('rtsp://'))
    if (!isPushed) continue

    // Soma bytes_recv pra detectar streams "fantasma" (conectam mas não enviam)
    const bytesIn = producers.reduce((s: number, p: any) => s + (p?.bytes_recv ?? 0), 0)
    const remoteAddr = producers[0]?.remote_addr ?? null

    const previously = seenStreams.get(streamName)
    if (!previously) {
      // Novo push detectado — resolve pra câmera e registra
      const cameraId = await resolveStreamToCameraId(streamName)
      if (cameraId) {
        await log('PUBLISH_START', `live/${streamName}`, { cameraId, remoteAddr, bytesIn })
        await log('AUTH_OK',       `live/${streamName}`, { cameraId, remoteAddr })
        // Vincula stream à câmera no go2rtc (caso ainda não esteja)
        await prisma.camera.update({
          where: { id: cameraId },
          data: {
            go2rtcStreamId: streamName,
            rtmpIngestLastFrameAt: new Date(),
          },
        })
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
    seenStreams.delete(streamName)
  }
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
