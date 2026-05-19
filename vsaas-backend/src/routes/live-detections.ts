/**
 * Live Detections SSE — overlay de bounding boxes em tempo real no LivePlayer.
 *
 * Fluxo:
 *   1. Frontend abre EventSource em GET /live/detections/:cameraId/stream
 *   2. Backend autentica via JWT (Bearer header passa) e valida que usuário
 *      tem acesso à câmera (mesmo integrador OU SUPER_ADMIN)
 *   3. Backend assina canal Redis "icv:live-detections:{cameraId}"
 *   4. Cada mensagem publicada pelo ai-worker é repassada como SSE
 *
 * Throttle:
 *   O worker já limita publicações a 5/s por câmera (LIVE_PUB_MIN_INTERVAL_MS).
 *   Aqui não throttle adicional — repasse direto.
 *
 * Cleanup:
 *   - Cliente desconecta → req.on('close') → unsubscribe Redis
 *   - SIGTERM → SSE keepalive corta naturalmente
 *
 * Subscriber compartilhado:
 *   ioredis subscribe é por CONEXÃO. Para evitar abrir 1 conexão por cliente,
 *   mantemos UM subscriber por cameraId no processo, multiplexando para os
 *   clientes locais. Quando o último client cai, faz unsubscribe.
 *
 * Segurança:
 *   - JWT obrigatório (requireAuth)
 *   - Verifica acesso multi-tenant via Camera.site.clienteFinal.integradorId
 *   - Cliente NÃO recebe payloads de outras câmeras (canal isolado por id)
 */
import { Router, Request, Response } from 'express'
import Redis from 'ioredis'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { ForbiddenError, NotFoundError } from '../lib/errors'
import { resolveIntegradorId } from '../middleware/tenant-context'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379'

export const liveDetectionsRouter = Router()

// ── Subscriber compartilhado por câmera ─────────────────────────────────────
// Multiplexa 1 conexão Redis para N clientes SSE da mesma câmera.

interface SseClient {
  id:    string
  res:   Response
}

const clients: Map<string, Set<SseClient>> = new Map()  // cameraId → clients

let _subscriber: Redis | null = null

function getSubscriber(): Redis {
  if (_subscriber) return _subscriber
  _subscriber = new Redis(REDIS_URL, {
    keyPrefix: '',  // pmessage não respeita keyPrefix em subscribers
    lazyConnect: false,
    maxRetriesPerRequest: null,  // subscriber deve reconectar para sempre
    retryStrategy: (times) => Math.min(times * 500, 5000),
  })

  _subscriber.on('error', (err) => {
    logger.warn({ err: err.message }, 'live_detections_subscriber_error')
  })

  _subscriber.on('message', (channel: string, message: string) => {
    // canal vem como "icv:live-detections:{cameraId}"
    const cameraId = channel.split(':').pop() ?? ''
    const set = clients.get(cameraId)
    if (!set || set.size === 0) return

    // SSE event: data: <json>\n\n
    const payload = `data: ${message}\n\n`
    for (const c of set) {
      try {
        c.res.write(payload)
      } catch (err) {
        // Cliente desconectou abruptamente — será limpo no req.on('close')
      }
    }
  })

  logger.info({ url: REDIS_URL }, 'live_detections_subscriber_connected')
  return _subscriber
}

function subscribeCamera(cameraId: string): void {
  const channel = `icv:live-detections:${cameraId}`
  getSubscriber().subscribe(channel).catch((err) => {
    logger.warn({ err: err.message, cameraId }, 'live_detections_subscribe_failed')
  })
}

function unsubscribeCamera(cameraId: string): void {
  const channel = `icv:live-detections:${cameraId}`
  getSubscriber().unsubscribe(channel).catch(() => {})
}

// ── Verificação de acesso à câmera ─────────────────────────────────────────
async function assertCameraAccess(req: Request, cameraId: string): Promise<void> {
  const jwt = req.jwtPayload!
  if (jwt.role === 'SUPER_ADMIN' || jwt.role === 'ADMIN_GLOBAL') return

  const integradorId = resolveIntegradorId(req)
  if (!integradorId) {
    throw new ForbiddenError('Sem tenant resolvido')
  }

  // Camera → Site → ClienteFinal → Integrador
  const cam = await prisma.camera.findFirst({
    where: {
      id: cameraId,
      site: { clienteFinal: { integradorId } },
    },
    select: { id: true, aiEnabled: true },
  })

  if (!cam) {
    throw new NotFoundError('Câmera não encontrada ou sem acesso')
  }
}

// ── GET /live/detections/:cameraId/stream ──────────────────────────────────
liveDetectionsRouter.get(
  '/:cameraId/stream',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const cameraId = req.params.cameraId
    await assertCameraAccess(req, cameraId)

    // Headers SSE
    res.setHeader('Content-Type',  'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection',    'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    // Hello inicial
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, cameraId, ts: Date.now() })}\n\n`)

    const clientId = `${cameraId}:${req.jwtPayload?.sub}:${Date.now()}`
    const client: SseClient = { id: clientId, res }

    let set = clients.get(cameraId)
    if (!set) {
      set = new Set()
      clients.set(cameraId, set)
      subscribeCamera(cameraId)
    }
    set.add(client)

    logger.debug({ cameraId, clientId, total: set.size }, 'live_detections_client_connected')

    // Keepalive — SSE precisa de bytes a cada N segundos para evitar proxy timeout
    const keepalive = setInterval(() => {
      try {
        res.write(`: keepalive ${Date.now()}\n\n`)
      } catch {
        // Cliente caiu silenciosamente
      }
    }, 25_000)

    const cleanup = () => {
      clearInterval(keepalive)
      const s = clients.get(cameraId)
      if (s) {
        s.delete(client)
        if (s.size === 0) {
          clients.delete(cameraId)
          unsubscribeCamera(cameraId)
          logger.debug({ cameraId }, 'live_detections_last_client_left')
        }
      }
    }

    req.on('close', cleanup)
    req.on('aborted', cleanup)
  }),
)

// ── Diagnóstico ────────────────────────────────────────────────────────────
liveDetectionsRouter.get('/_status', requireAuth, (req, res) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'ADMIN_GLOBAL') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const summary = Array.from(clients.entries()).map(([cameraId, set]) => ({
    cameraId,
    clients: set.size,
  }))
  res.json({
    totalCameras: clients.size,
    totalClients: Array.from(clients.values()).reduce((s, set) => s + set.size, 0),
    cameras: summary,
  })
})
