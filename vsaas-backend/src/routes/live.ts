/**
 * Live Streaming Proxy Routes
 *
 * Estas rotas NÃO usam requireAuth (JWT Bearer header) porque:
 *   - O browser consome WHEP via fetch() para negociação SDP, e depois
 *     mantém a conexão WebRTC direta entre browser <-> backend <-> edge.
 *   - <img src="/live/:id/mjpeg?ticket=..."> não envia Authorization header.
 *
 * Em vez disso, validam um `ticket` JWT de curta duração (60s), emitido
 * previamente pela rota autenticada GET /cameras/:id/live-token.
 *
 * POST /live/:id/whep?ticket=...   ← negociação SDP → proxy para go2rtc do edge
 * GET  /live/:id/mjpeg?ticket=...  ← proxy MJPEG (fallback quando WebRTC falha)
 */
import { Router, Request, Response, NextFunction } from 'express'
import http from 'http'
import https from 'https'
import { URL } from 'url'
import { liveService } from '../services/live.service'
import { captureSnapshot, FfmpegSnapshotError } from '../services/ffmpeg-snapshot.service'
import { ValidationError, UnauthorizedError } from '../lib/errors'
import { logger } from '../lib/logger'

export const liveRouter = Router()

// ─── Helpers ──────────────────────────────────────────────────────────────

function extractTicket(req: Request): string {
  const t = (req.query.ticket as string) ||
            (typeof req.query.t === 'string' ? req.query.t : '')
  if (!t) throw new UnauthorizedError('Ticket ausente')
  return t
}

/**
 * Proxy genérico HTTP(S) baixo nível (sem dependência extra).
 * Usado para streams longos (MJPEG) e chunked responses.
 */
function proxyRequest(
  targetUrl: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body: string | Buffer | null,
  res: Response,
  onError: (err: Error) => void,
): void {
  const url = new URL(targetUrl)
  const client = url.protocol === 'https:' ? https : http

  const upstream = client.request(
    {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
      timeout: 15_000,
    },
    (upRes) => {
      res.status(upRes.statusCode ?? 502)
      // Repassa headers relevantes (content-type é crítico para MJPEG/SDP)
      const passthroughHeaders = ['content-type', 'cache-control', 'connection', 'transfer-encoding']
      for (const h of passthroughHeaders) {
        const v = upRes.headers[h]
        if (v) res.setHeader(h, v as string)
      }
      upRes.pipe(res)
      upRes.on('end', () => {
        if (!res.writableEnded) res.end()
      })
    },
  )

  upstream.on('error', err => {
    logger.warn({ err: err.message, targetUrl }, 'live_proxy_upstream_error')
    onError(err)
  })
  upstream.on('timeout', () => {
    upstream.destroy(new Error('upstream_timeout'))
  })

  // Fecha upstream se cliente desconectar
  res.on('close', () => {
    if (!upstream.destroyed) upstream.destroy()
  })

  if (body) upstream.write(body)
  upstream.end()
}

// ─── POST /live/:id/whep ─────────────────────────────────────────────────
// Body: SDP offer (application/sdp)
// Response: SDP answer (application/sdp)

liveRouter.post(
  '/:id/whep',
  // raw body parser para SDP
  (req, _res, next) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      ;(req as any).rawBody = Buffer.concat(chunks).toString('utf-8')
      next()
    })
    req.on('error', next)
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticket = extractTicket(req)
      const decoded = liveService.verifyTicket(ticket, 'whep')
      if (decoded.cameraId !== req.params.id) throw new UnauthorizedError('Ticket não corresponde à câmera')

      // Resolve go2rtc: se ticket tem edgeNodeId, usa edge; se null, cai
      // pro embarcado (EMBEDDED_GO2RTC_URL). Decisão foi feita no
      // issueTicket — aqui só executamos.
      const edge = await liveService.resolveGo2rtcByTicket(decoded)

      const sdp = (req as any).rawBody as string
      if (!sdp) throw new ValidationError('SDP offer ausente')

      // go2rtc WHEP endpoint: POST /api/webrtc?src={streamId}
      const target = `${edge.baseUrl}/api/webrtc?src=${encodeURIComponent(decoded.streamId)}`

      const headers: Record<string, string> = {
        'content-type': 'application/sdp',
        'content-length': Buffer.byteLength(sdp).toString(),
      }
      if (edge.authHeader) headers['authorization'] = edge.authHeader

      proxyRequest(target, 'POST', headers, sdp, res, err => {
        if (!res.headersSent) res.status(502).json({ error: 'UPSTREAM_ERROR', message: err.message })
      })
    } catch (err) { next(err) }
  },
)

// ─── GET /live/:id/snapshot-jpeg ─────────────────────────────────────────
// Retorna 1 frame JPEG da câmera, capturado pelo ffmpeg local do container
// (sem depender de transcoder no go2rtc). Útil para:
//   - Thumbnail no card de câmera (CamerasPage)
//   - Snapshot manual no botão "Capturar" da CameraDetailPage
//   - Fallback de preview quando WebRTC/MJPEG do edge não está disponível
//
// Cache-Control: max-age=2 — permite reuso de thumb por 2s (útil quando UI
// faz polling SWR ~ a cada 5s). Não force-no-cache: é só um JPEG.
//
// Tenant: o ticket emitido por GET /cameras/:id/live-token?kind=snapshot já
// validou escopo. Aqui apenas verificamos o ticket e se cameraId bate.

liveRouter.get('/:id/snapshot-jpeg', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticket = extractTicket(req)
    const decoded = liveService.verifyTicket(ticket, 'snapshot')
    if (decoded.cameraId !== req.params.id) {
      throw new UnauthorizedError('Ticket não corresponde à câmera')
    }

    const { url } = await liveService.resolveCameraStreamUrlByTicket(decoded.cameraId)

    let buf: Buffer
    try {
      buf = await captureSnapshot(url)
    } catch (err) {
      if (err instanceof FfmpegSnapshotError) {
        const httpCode =
          err.code === 'INVALID_URL'      ? 400 :
          err.code === 'TIMEOUT'          ? 504 :
          err.code === 'TOO_LARGE'        ? 502 :
          err.code === 'NO_OUTPUT'        ? 502 :
          /* FFMPEG_FAILED */               502
        logger.warn(
          {
            cameraId: decoded.cameraId,
            errCode: err.code,
            stderrTail: err.stderrTail?.slice(-200),
          },
          'snapshot_jpeg_failed',
        )
        res.status(httpCode).json({
          error: 'SNAPSHOT_FAILED',
          code: err.code,
          message: err.message,
        })
        return
      }
      throw err
    }

    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Content-Length', buf.length.toString())
    res.setHeader('Cache-Control', 'private, max-age=2')
    res.setHeader('X-Camera-Id', decoded.cameraId)
    res.status(200).end(buf)
  } catch (err) {
    next(err)
  }
})

// ─── GET /live/:id/mjpeg ─────────────────────────────────────────────────
// Retorna um multipart/x-mixed-replace do MJPEG do go2rtc

liveRouter.get('/:id/mjpeg', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticket = extractTicket(req)
    const decoded = liveService.verifyTicket(ticket, 'mjpeg')
    if (decoded.cameraId !== req.params.id) throw new UnauthorizedError('Ticket não corresponde à câmera')

    const edge = await liveService.resolveGo2rtcByTicket(decoded)

    // go2rtc MJPEG: GET /api/stream.mjpeg?src={streamId}
    const target = `${edge.baseUrl}/api/stream.mjpeg?src=${encodeURIComponent(decoded.streamId)}`

    const headers: Record<string, string> = {}
    if (edge.authHeader) headers['authorization'] = edge.authHeader

    proxyRequest(target, 'GET', headers, null, res, err => {
      if (!res.headersSent) res.status(502).json({ error: 'UPSTREAM_ERROR', message: err.message })
    })
  } catch (err) { next(err) }
})
