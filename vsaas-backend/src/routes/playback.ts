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
import { r2Storage } from '../services/r2-storage.service'
import { getIntegradorIdForCamera } from '../lib/camera-tenant-cache'
import { UnauthorizedError, NotFoundError, ValidationError } from '../lib/errors'
import { logger } from '../lib/logger'

export const playbackRouter = Router()

// Onda 6 / P2 #26 — rate limit por (cameraId, IP) nas rotas de playback
// para impedir abuse: 1 cliente mal-intencionado pode hammerar /segments
// e consumir egress do R2 desnecessariamente.
//
// Limite: 300 reqs/min (≈ 5/s) por (cameraId, IP) — suficiente para 1 player
// HLS normal (poll de segments + manifest), insuficiente para script malicioso.
import rateLimit from 'express-rate-limit'
const playbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      300,
  keyGenerator: (req) => `${req.params.id ?? 'global'}:${req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'PLAYBACK_RATE_LIMIT', message: 'Muitas requisições para esta câmera. Tente novamente em alguns segundos.' },
})
playbackRouter.use('/:id/segments/:sid.ts', playbackLimiter)
playbackRouter.use('/:id/manifest.m3u8',    playbackLimiter)

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
  const cam = await requireCameraForUser(body.cameraId, req.jwtPayload, { select: { id: true, name: true } })

  const fromMs = new Date(body.fromIso).getTime()
  const toMs   = new Date(body.toIso).getTime()
  if (toMs - fromMs > 25 * 60 * 60 * 1000) {
    throw new ValidationError('Range máximo: 24 horas')
  }

  const result = playbackService.issueTicket(body.cameraId, fromMs, toMs)

  // Onda 7 / P3 #23 — audit log de visualização para cadeia de custódia LGPD.
  // Grava (userId, cameraId, range, ipAddr) sem bloquear a resposta.
  try {
    const { auditAction } = await import('../lib/audit-helpers')
    auditAction(prisma, {
      action:     'PLAYBACK_VIEWED',
      resource:   'Camera',
      resourceId: cam.id,
      metadata: {
        cameraName: cam.name,
        fromIso: body.fromIso,
        toIso:   body.toIso,
        rangeMs: toMs - fromMs,
      },
      req,
    }).catch(() => { /* não fatal */ })
  } catch { /* ignore */ }

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
  const seg = await prisma.recordingSegment.findFirst({
    where: { id: req.params.sid },
    select: {
      cameraId: true,
      startedAt: true,
      endedAt: true,
      storagePath: true,
      sizeBytes: true,
      uploadBucket: true,
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

  // G14 fix (2026-05-09): Content-Length vem do RecordingSegment.sizeBytes
  // (já lido acima), não duplica chamada R2/S3 stat(). Antes: 2 RTT por
  // segment (stat + GET); agora 1 RTT (GET stream direto).
  // sizeBytes pode estar 0 em segment recém-criado pré-upload — nesse caso
  // não envia Content-Length (player aceita streaming sem ele em HLS).
  res.setHeader('Content-Type', 'video/mp2t')
  const sizeNum = Number(seg.sizeBytes ?? 0)
  if (sizeNum > 0) res.setHeader('Content-Length', String(sizeNum))
  // Cache longo: o conteúdo do segmento é imutável (write-once).
  // Player cacheia em RAM/disk → seek ida/volta sem re-baixar.
  res.setHeader('Cache-Control', 'private, max-age=3600, immutable')

  // Tenta local, fallback R2/S3 (multi-tenant). getReadStream faz HEAD
  // implícito quando vem do cloud — se objeto sumiu, retorna null.
  // G17: knownBucket evita existsSync local quando segment já está no R2.
  const stream = await recordingStorage.getReadStream(
    integradorId, seg.storagePath, { knownBucket: seg.uploadBucket },
  )
  if (!stream) {
    // Segmento sumiu (retention rodou entre manifest e download)
    throw new NotFoundError('Arquivo do segmento expirado')
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
    // ── v3: cobertura real + macro-gaps ─────────────────────────────
    // realCoverageSec: total de segundos de vídeo recuperável (soma das
    // durações dos segments). Diferente de coverageMin*60 quando há
    // micro-gaps (ex: 6s ON + 4s OFF → coverageMin diz 100% mas real é 60%).
    realCoverageSec: data.realCoverageSec,
    realCoveragePct: Math.round((data.realCoverageSec / 86400) * 1000) / 10,  // 0.0..100.0
    // gaps: buracos > 5min ordenados por início. Cada item: ms desde meia-noite UTC.
    gaps:            data.gaps,
  })
}))

// ─── GET /playback/:id/sprites ───────────────────────────────────────────
// Manifest de sprite-sheets do dia (1 row por hora com gravação).
// Frontend baixa todos os manifests UMA vez e usa CSS background-position
// pra mostrar preview no hover da timeline (padrão YouTube).
//
// Query: ?day=YYYY-MM-DD
//
// Resposta:
//   {
//     cameraId, dayUtc, hours: [
//       { hour: 14, url, frameInterval, cols, rows, frameWidth, frameHeight,
//         frameCount, firstFrameAt, sizeBytes }
//     ]
//   }
//
// URL é presigned R2 com TTL de 1h. Frontend cacheia o manifest (SWR), o
// browser cacheia o JPG (Cache-Control: max-age longo). Hover não bate
// network depois do primeiro carregamento do dia.
//
// Auth: requireAuth (resposta JSON via fetch — não vai no <img>).

playbackRouter.get('/:id/sprites', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })

  const day = req.query.day
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new ValidationError('day deve estar no formato YYYY-MM-DD')
  }

  const rows = await prisma.spriteSheet.findMany({
    where: {
      cameraId: req.params.id,
      day,
      uploadedAt: { not: null },  // só manifests com upload confirmado
    },
    orderBy: { hour: 'asc' },
    select: {
      hour: true, storagePath: true, sizeBytes: true,
      frameCount: true, gridCols: true, gridRows: true,
      frameWidth: true, frameHeight: true, frameIntervalSec: true,
      firstFrameAt: true,
    },
  })

  // Resolve integradorId via cache (mesmo padrão dos segments).
  const integradorId = await getIntegradorIdForCamera(req.params.id)

  // Presigned URL com TTL 1h. Mais curto que 24h (segurança) e mais longo
  // que minutos (evita re-pedir manifest a cada hover na mesma sessão).
  // Frontend SWR refetcha quando expirar.
  const PRESIGN_TTL_SEC = 3600
  const hours = await Promise.all(rows.map(async row => {
    const url = r2Storage.isEnabled()
      ? await r2Storage.getPresignedUrl(integradorId, row.storagePath, PRESIGN_TTL_SEC)
      : null
    return {
      hour:          row.hour,
      url,
      frameInterval: row.frameIntervalSec,
      cols:          row.gridCols,
      rows:          row.gridRows,
      frameWidth:    row.frameWidth,
      frameHeight:   row.frameHeight,
      frameCount:    row.frameCount,
      firstFrameAt:  row.firstFrameAt.toISOString(),
      sizeBytes:     Number(row.sizeBytes),
    }
  }))

  // Cache curto: dia já passado → manifest é praticamente imutável
  // (nenhum sprite novo vai chegar pra horas do passado), mas o presigned
  // URL expira em 1h, então não faz sentido cachear muito além disso.
  const dayEndMs = new Date(`${day}T00:00:00.000Z`).getTime() + 24 * 60 * 60_000
  const isPastDay = dayEndMs < Date.now() - 5 * 60_000
  res.setHeader('Cache-Control', isPastDay ? 'private, max-age=1800' : 'private, max-age=60')

  res.json({
    cameraId: req.params.id,
    dayUtc:   `${day}T00:00:00.000Z`,
    hours:    hours.filter(h => h.url),  // remove horas sem URL (R2 off)
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
