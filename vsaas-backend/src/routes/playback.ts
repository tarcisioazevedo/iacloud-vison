/**
 * Playback Routes — endpoints HLS pra revisão de gravações.
 *
 *   POST /playback/token              — emite ticket pra range
 *                                       Body: { cameraId, fromIso, toIso }
 *   GET  /playback/:id/manifest.m3u8  — manifest HLS dinâmico (auth via ticket)
 *   GET  /playback/:id/segments/:sid.ts — serve segmento .ts (auth via ticket)
 *   GET  /playback/:id/timeline       — heatmap de minutos com gravação
 *                                       Query: ?day=YYYY-MM-DD (ISO date)
 *
 * Auth model:
 *   - POST /token: requireAuth + escopo de tenant (requireCameraForUser)
 *   - GET manifest/segments: ticket-only (sem JWT Authorization). Justificativa:
 *     <video src=...> não envia headers Bearer. Ticket no query string já
 *     foi emitido pelo POST /token autenticado.
 *   - GET timeline: requireAuth (operador no UI escolhe data, não vai num
 *     <video>; pode usar JWT normal).
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { requireCameraForUser } from '../lib/tenant-scope'
import { playbackService } from '../services/playback.service'
import { recordingStorage } from '../services/recording-storage.service'
import { getIntegradorIdForCamera } from '../lib/camera-tenant-cache'
import { UnauthorizedError, NotFoundError, ValidationError } from '../lib/errors'
import { logger } from '../lib/logger'

export const playbackRouter = Router()

// ─── POST /playback/token ──────────────────────────────────────────────────
// Emite ticket JWT pro range pedido. Operador chama isso uma vez ao abrir
// a página de Recordings, com a janela do dia (ou range custom). Frontend
// reusa o mesmo ticket pra manifest + segmentos.

const TokenBody = z.object({
  cameraId: z.string().uuid(),
  fromIso:  z.string().datetime(),
  toIso:    z.string().datetime(),
}).refine(b => new Date(b.toIso) > new Date(b.fromIso), {
  message: 'toIso deve ser depois de fromIso',
})

playbackRouter.post('/token', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const body = TokenBody.parse(req.body)
  // Tenant scope — só emite ticket pra câmera que o usuário pode ver.
  await requireCameraForUser(body.cameraId, req.jwtPayload, { select: { id: true } })

  const fromMs = new Date(body.fromIso).getTime()
  const toMs   = new Date(body.toIso).getTime()
  // Limita janela máxima a 24h pra evitar manifest gigante (10k+ segmentos).
  if (toMs - fromMs > 25 * 60 * 60 * 1000) {
    throw new ValidationError('Range máximo: 24 horas')
  }

  const result = playbackService.issueTicket(body.cameraId, fromMs, toMs)
  res.json({
    ticket:      result.ticket,
    manifestUrl: result.manifestUrl,
    fromIso:     body.fromIso,
    toIso:       body.toIso,
  })
}))

// ─── GET /playback/:id/manifest.m3u8 ─────────────────────────────────────
// Auth: ticket no query string (compatível com <video src=...>).

function extractTicket(req: Request): string {
  const t = req.query.ticket
  if (typeof t !== 'string' || !t) {
    throw new UnauthorizedError('Ticket ausente')
  }
  return t
}

playbackRouter.get('/:id/manifest.m3u8', asyncHandler(async (req: Request, res: Response) => {
  const ticket = extractTicket(req)
  const decoded = playbackService.verifyTicket(ticket, req.params.id)

  // Base URL absoluta pra reconstruir URLs dos segmentos no manifest.
  // Em prod com proxy reverso, usa X-Forwarded-* — Express trustproxy
  // já cuida disso. Aqui montamos manualmente pra ter controle.
  const proto = req.headers['x-forwarded-proto']?.toString() ?? req.protocol
  const host  = req.headers['x-forwarded-host']?.toString()  ?? req.get('host')
  const baseUrl = `${proto}://${host}`

  try {
    const manifest = await playbackService.buildManifest(decoded, baseUrl)
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    // Cache adaptativo:
    //   - Range fechado no passado (toMs < now-5min): manifest é VOD imutável.
    //     Fica 1 dia em cache do browser; reabrir o range no mesmo dia não bate
    //     mais o backend.
    //   - Range "live tail" (toMs ≥ now-5min): mantém max-age curto pra ver
    //     novos segments em revalidação.
    const isPastRange = decoded.toMs < Date.now() - 5 * 60_000
    res.setHeader(
      'Cache-Control',
      isPastRange ? 'private, max-age=86400, immutable' : 'private, max-age=5',
    )
    res.send(manifest)
  } catch (err) {
    if (err instanceof NotFoundError) {
      // 200 com manifest vazio em vez de 404 — alguns players quebram em 404.
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      res.send('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ENDLIST\n')
      return
    }
    throw err
  }
}))

// ─── GET /playback/:id/segments/:sid.ts ──────────────────────────────────
// Serve o arquivo .ts do segmento. Auth via mesmo ticket do manifest.
// Validação: o segmento precisa pertencer à câmera do ticket E cair no
// range temporal autorizado.

playbackRouter.get('/:id/segments/:sid.ts', asyncHandler(async (req: Request, res: Response) => {
  const ticket = extractTicket(req)
  const decoded = playbackService.verifyTicket(ticket, req.params.id)

  // Hardening Iteração 2 — perf: select enxuto sem JOIN aninhado.
  // O integradorId vem do cache `getIntegradorIdForCamera` (TTL 5 min) —
  // 95% dos hits não tocam Postgres pra resolver bucket.
  const seg = await prisma.recordingSegment.findUnique({
    where: { id: req.params.sid },
    select: {
      cameraId: true,
      startedAt: true,
      endedAt: true,
      storagePath: true,
      sizeBytes: true,
    },
  })
  if (!seg) throw new NotFoundError('Segmento')
  if (seg.cameraId !== decoded.cameraId) throw new UnauthorizedError('Segmento de outra câmera')

  // Range check: segmento precisa intersectar com a janela autorizada.
  if (seg.endedAt.getTime() < decoded.fromMs || seg.startedAt.getTime() > decoded.toMs) {
    throw new UnauthorizedError('Segmento fora do range do ticket')
  }

  // Resolve integradorId via cache (fallback: 'default')
  const integradorId = await getIntegradorIdForCamera(seg.cameraId)

  const stat = await recordingStorage.stat(integradorId, seg.storagePath)
  if (!stat) {
    // Segmento sumiu (retention rodou entre manifest e download)
    throw new NotFoundError('Arquivo do segmento expirado')
  }

  res.setHeader('Content-Type', 'video/mp2t')
  res.setHeader('Content-Length', String(stat.size))
  // Cache longo: o conteúdo do segmento é imutável (write-once).
  // Player cacheia em RAM/disk → seek ida/volta sem re-baixar.
  res.setHeader('Cache-Control', 'private, max-age=3600, immutable')

  // Tenta local, fallback R2/S3 (multi-tenant)
  const stream = await recordingStorage.getReadStream(integradorId, seg.storagePath)
  if (!stream) {
    throw new NotFoundError('Arquivo do segmento não encontrado')
  }
  stream.pipe(res)
  stream.on('error', (err) => {
    logger.warn({ err, segId: req.params.sid }, 'playback_segment_stream_failed')
    if (!res.headersSent) res.status(500).end()
  })
}))

// ─── GET /playback/:id/timeline ──────────────────────────────────────────
// Retorna marcadores de minuto-a-minuto pro UI desenhar o scrubber com
// regiões de "tem gravação" vs "sem gravação".
// Auth: requireAuth normal (resposta JSON, vai via fetch axios).

playbackRouter.get('/:id/timeline', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })

  const day = req.query.day
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new ValidationError('day deve estar no formato YYYY-MM-DD')
  }
  const dayStart = new Date(`${day}T00:00:00.000Z`)
  if (isNaN(dayStart.getTime())) throw new ValidationError('day inválido')

  // V2: motion + intensity + events + bookmarks numa só chamada.
  // Mantemos `bitmap` no payload pra retrocompat com clients antigos (ele
  // fica idêntico ao recordingBitmap).
  const data = await playbackService.dayTimelineV2(req.params.id, dayStart)

  // Cache adaptativo: dia anterior ao corrente já fechou, payload é
  // imutável → 24h immutable. Hoje continua revalidando a cada 30s
  // (gravação ainda está progredindo).
  const dayEndMs = dayStart.getTime() + 24 * 60 * 60_000
  const isPastDay = dayEndMs < Date.now() - 5 * 60_000
  res.setHeader(
    'Cache-Control',
    isPastDay ? 'private, max-age=86400, immutable' : 'private, max-age=30',
  )

  res.json({
    cameraId:        req.params.id,
    dayUtc:          dayStart.toISOString(),
    minutes:         1440,
    // ── compat antigo ────────────────────────────────────────────────
    bitmap:          data.recordingBitmap,
    coverageMin:     data.coverageMin,
    // ── v2 ──────────────────────────────────────────────────────────
    recordingBitmap: data.recordingBitmap,
    motionBitmap:    data.motionBitmap,
    intensity:       data.intensity,
    motionMin:       data.motionMin,
    events:          data.events,
    bookmarks:       data.bookmarks,
  })
}))

// ─── GET /playback/:id/index ────────────────────────────────────────────
// Lista os dias que tem alguma gravação pra essa câmera nos últimos 30 dias.
// Usado pelo date picker do UI pra desabilitar dias sem gravação.

playbackRouter.get('/:id/index', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })

  // Query agregada: distinct days no Postgres usando date_trunc.
  // Limite 60 dias atrás (cobre retenção máxima padrão).
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
  const rows = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT date_trunc('day', "startedAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS count
    FROM "RecordingSegment"
    WHERE "cameraId" = ${req.params.id}
      AND "startedAt" >= ${since}
    GROUP BY day
    ORDER BY day DESC
    LIMIT 60
  `
  res.json({
    days: rows.map(r => ({
      day:    r.day.toISOString().slice(0, 10),
      count:  Number(r.count),
    })),
  })
}))
