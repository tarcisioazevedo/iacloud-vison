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
      (req as any).rawBody = Buffer.concat(chunks).toString('utf-8')
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

      // Pre-flight: verifica se o stream existe E tem producer ativo no go2rtc.
      // Sem isso o WebRTC retorna 500 críptico — operador vê "WHEP 500" em vez
      // de saber que a câmera não está pushing.
      try {
        const checkUrl = `${edge.baseUrl}/api/streams?src=${encodeURIComponent(decoded.streamId)}`
        const checkHeaders: Record<string, string> = {}
        if (edge.authHeader) checkHeaders['authorization'] = edge.authHeader
        const probe = await fetch(checkUrl, { signal: AbortSignal.timeout(2500), headers: checkHeaders })
        if (probe.ok) {
          const info: any = await probe.json().catch(() => null)
          const producers = info?.producers ?? []
          // Considera "online" se houver ao menos 1 producer com bytes_recv > 0
          // (placeholder rtsp://127.0.0.1:19999 sempre existe — não conta).
          const hasLiveProducer = producers.some((p: any) =>
            (p.bytes_recv ?? 0) > 0 || p.format_name === 'rtmp' || p.protocol === 'rtmp' || p.url?.startsWith('rtsp://') || p.url?.startsWith('srt://'),
          )
          if (!hasLiveProducer) {
            res.status(503).json({
              error:   'STREAM_OFFLINE',
              message: 'Câmera não está enviando vídeo no momento. Aguardando reconexão do push RTMP.',
              hint:    'Verifique se a câmera está ligada, conectada à internet e configurada para push RTMP para este endpoint.',
            })
            return
          }
        }
      } catch { /* probe falhou — segue tentando WHEP, melhor 500 do que falsos positivos */ }

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

// ─── POST /live/:id/whep-mediamtx ─────────────────────────────────────────
// WHEP via MediaMTX SFU local — fluxo de baixa latência (SRT uplink + WebRTC saída)
//
// Diferença para /whep:
//   /whep:           browser → backend → tunnel CF → go2rtc remoto da Box (latência alta)
//   /whep-mediamtx:  browser → backend → MediaMTX SFU local da Cloud → ICE direto browser
//                    (mídia UDP nativo, ~3-5x menos latência em redes com perda)
//
// Pré-requisito: Box deve estar pushando SRT para `srt.iacloud.com.br:8890`
// com pathName = `<edgeNodeId>/<streamName>/main`. Veja /iacv-box/srt-config.
//
// Path no MediaMTX = mesmo formato do streamid SRT publish (sem "publish:" e sem credenciais)
const MEDIAMTX_INTERNAL_URL = process.env.MEDIAMTX_INTERNAL_URL ?? 'http://mediamtx:8889'

liveRouter.post(
  '/:id/whep-mediamtx',
  // raw body parser para SDP (igual à rota /whep)
  (req, _res, next) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      (req as any).rawBody = Buffer.concat(chunks).toString('utf-8')
      next()
    })
    req.on('error', next)
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticket = extractTicket(req)
      const decoded = liveService.verifyTicket(ticket, 'whep')
      if (decoded.cameraId !== req.params.id) throw new UnauthorizedError('Ticket não corresponde à câmera')

      // Quality opcional: ?quality=main (default) | sub
      const quality = (req.query.quality as string) === 'sub' ? 'sub' : 'main'

      // pathName MediaMTX: depende do modelo de deployment.
      //   EDGE_BOX:    "<edgeNodeId>/<streamId>/<quality>" (Box publica esse path via SRT)
      //   CLOUD_DIRECT: streamId direto = go2rtcStreamId da Camera (ex: "live/cam2/vsaas2026"),
      //                que casa exatamente com o path onde o RTMP/SRT publisher externo postou.
      // Usar decoded.cameraId aqui (UUID) era bug — MediaMTX nunca teve esse path.
      const pathName = decoded.edgeNodeId
        ? `${decoded.edgeNodeId}/${decoded.streamId}/${quality}`
        : (decoded.streamId || decoded.cameraId)

      const sdp = (req as any).rawBody as string
      if (!sdp) throw new ValidationError('SDP offer ausente')

      // MediaMTX WHEP endpoint: POST /<pathName>/whep
      const target = `${MEDIAMTX_INTERNAL_URL}/${pathName}/whep`

      const headers: Record<string, string> = {
        'content-type': 'application/sdp',
        'content-length': Buffer.byteLength(sdp).toString(),
      }

      proxyRequest(target, 'POST', headers, sdp, res, err => {
        if (!res.headersSent) {
          res.status(502).json({
            error: 'UPSTREAM_ERROR',
            message: err.message,
            hint: 'MediaMTX path may not exist — Box may not be publishing SRT yet',
          })
        }
      })
    } catch (err) { next(err) }
  },
)

// ─── POST /live/:id/talkback-mediamtx ─────────────────────────────────────
// WHIP via MediaMTX SFU local — cria rota dinâmica de talkback para SRT.
// Browser envia WHIP via backend (para evitar Mixed Content) → MediaMTX.
liveRouter.post(
  '/:id/talkback-mediamtx',
  (req, _res, next) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      (req as any).rawBody = Buffer.concat(chunks).toString('utf-8')
      next()
    })
    req.on('error', next)
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticket = extractTicket(req)
      const decoded = liveService.verifyTicket(ticket, 'whep')
      if (decoded.cameraId !== req.params.id) throw new UnauthorizedError('Ticket não corresponde à câmera')

      const pathName = decoded.edgeNodeId ? `${decoded.edgeNodeId}/${decoded.streamId}/main` : decoded.streamId || decoded.cameraId

      const sdp = (req as any).rawBody as string
      if (!sdp) throw new ValidationError('SDP offer ausente')

      // WHIP endpoint no MediaMTX
      const target = `${MEDIAMTX_INTERNAL_URL}/${pathName}-talkback/whip`

      const headers: Record<string, string> = {
        'content-type': 'application/sdp',
        'content-length': Buffer.byteLength(sdp).toString(),
      }

      proxyRequest(target, 'POST', headers, sdp, res, err => {
        if (!res.headersSent) {
          res.status(502).json({ error: 'UPSTREAM_ERROR', message: err.message })
        }
      })
    } catch (err) { next(err) }
  },
)

// ─── GET /live/:id/availability ────────────────────────────────────────────
// Frontend consulta para descobrir QUAIS fontes estão disponíveis para esta câmera.
// Permite o LivePlayer escolher dinamicamente:
//   - 'mediamtx' = SRT do Box chegando, melhor latência (preferred)
//   - 'go2rtc' = Box atrás de tunnel CF (fallback, mais latência)
//   - 'snapshot' = só JPEG (último recurso)
//
// Sem ticket — só auth normal. Read-only, leve.

liveRouter.get('/:id/availability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cameraId = req.params.id
    const cam = await import('../lib/prisma').then(m => m.prisma.camera.findUnique({
      where: { id: cameraId },
      select: {
        id: true,
        go2rtcStreamId: true,
        rtspMainUrl: true,
        edgeNodeId: true,
        deploymentMode: true,
        edgeNode: {
          select: {
            go2rtcEndpoint: true,
            lastTelemetryRaw: true,    // contém `srt: { configured, publishingCameras, ... }`
            lastHeartbeat:    true,    // pra detectar heartbeat stale (>5min = ignorar)
          },
        },
      },
    })) as any

    if (!cam) {
      res.status(404).json({ error: 'CAMERA_NOT_FOUND' })
      return
    }

    const streamName = cam.go2rtcStreamId ?? cameraId.slice(0, 8)
    const sources: Record<string, { available: boolean; latencyHint?: string; reason?: string }> = {}

    // 1) MediaMTX (preferred) — usa heartbeat.srt como fonte primária (~30s update)
    //    e MediaMTX API como verificação real (consistência com publish ativo)
    const isCloudDirect = cam.deploymentMode === 'CLOUD_DIRECT'
    if (cam.edgeNodeId || isCloudDirect) {
      const pathName = isCloudDirect ? streamName : `${cam.edgeNodeId}/${streamName}/main`

      // 1a) Box reportou srt.configured no heartbeat? (rápido, sem fetch externo)
      const tel = (cam.edgeNode?.lastTelemetryRaw ?? null) as null | {
        srt?: { configured?: boolean; publishingCameras?: string[]; lastError?: string | null }
      }
      const heartbeatRecent = cam.edgeNode?.lastHeartbeat
        ? (Date.now() - new Date(cam.edgeNode.lastHeartbeat).getTime()) < 5 * 60 * 1000
        : false
      const boxClaimsSrt = !!(heartbeatRecent && tel?.srt?.configured) || isCloudDirect
      const boxLastError = tel?.srt?.lastError ?? null

      // 1b) Verificação real no MediaMTX local — autoritativa
      try {
        const mtxApiUrl = MEDIAMTX_INTERNAL_URL.replace(':8889', ':9997')
        const mtxResp = await fetch(`${mtxApiUrl}/v3/paths/get/${encodeURIComponent(pathName)}`, {
          signal: AbortSignal.timeout(2000),
        })
        if (mtxResp.ok) {
          const data = await mtxResp.json() as { ready?: boolean; readers?: unknown[] }
          sources.mediamtx = {
            available: !!data.ready,
            latencyHint: '300-500ms (SRT+WebRTC)',
            reason: data.ready
              ? undefined
              : boxLastError ? `box_blocked: ${boxLastError}` : 'no_publisher',
          }
        } else if (boxClaimsSrt) {
          // Heartbeat diz configured=true mas MediaMTX não tem path — desync transitório
          sources.mediamtx = { available: false, reason: 'box_pushing_but_mtx_no_path_yet' }
        } else {
          // Path não existe E Box não reporta SRT configurado (ou heartbeat stale)
          sources.mediamtx = {
            available: false,
            reason: boxLastError ?? (heartbeatRecent ? 'box_not_publishing' : 'heartbeat_stale'),
          }
        }
        
      } catch {
        sources.mediamtx = { available: false, reason: 'mediamtx_unreachable' }
      }
      
      // --- PATCH: Força disponibilidade mediamtx para Cloud Direct ---
      // (preferred e computado adiante via cascata; basta marcar available=true)
      if (isCloudDirect) {
        sources.mediamtx.available = true
      }

    } else {
      sources.mediamtx = { available: false, reason: 'no_edge_node' }
    }

    // 2) go2rtc via tunnel CF (fallback) — checa se EdgeNode tem endpoint
    sources.go2rtc = {
      available: !!cam.edgeNode?.go2rtcEndpoint,
      latencyHint: '600-1200ms (WebRTC sobre CF Tunnel)',
      reason: cam.edgeNode?.go2rtcEndpoint ? undefined : 'no_tunnel',
    }

    // 3) snapshot (sempre disponível como último recurso, se RTSP existe ou tunnel HTTP)
    sources.snapshot = {
      available: !!(cam.rtspMainUrl || cam.edgeNode?.go2rtcEndpoint),
      latencyHint: '5s polling',
    }

    // Fonte preferred = primeira disponível na ordem
    const preferred =
      sources.mediamtx.available ? 'mediamtx' :
      sources.go2rtc.available   ? 'go2rtc'   :
      sources.snapshot.available ? 'snapshot' :
      'none'

    res.json({
      cameraId,
      preferred,
      sources,
    })
  } catch (err) { next(err) }
})

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

    // Tunnel-aware: prefere go2rtc HTTP via tunnel se EdgeNode tem endpoint configurado
    // (resolve câmera em LAN privada do cliente, sem rota direta da Cloud)
    const source = await liveService.resolveSnapshotSourceByTicket(decoded.cameraId)

    let buf: Buffer
    try {
      if (source.kind === 'http') {
        // Fetch direto do go2rtc remoto via tunnel CF — mais rápido que ffmpeg
        const headers: Record<string, string> = { 'Accept': 'image/jpeg' }
        if (source.authHeader) headers['Authorization'] = source.authHeader
        let resp: globalThis.Response
        try {
          resp = await fetch(source.url, { signal: AbortSignal.timeout(10_000), headers })
        } catch (err: any) {
          if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.code === 23) {
            throw new FfmpegSnapshotError(
              'Timeout ao capturar snapshot via go2rtc/tunnel',
              'TIMEOUT',
              err?.message,
            )
          }
          throw err
        }
        if (!resp.ok) {
          // 2026-05-12 — P1-5: detecta Cloudflare HTML error page.
          // Quando o tunnel CF está OFF (origem inacessível), CF retorna
          // HTML 521/522/523 com `<!doctype html>...`. Log limpo + código
          // específico TUNNEL_OFFLINE pra UI mostrar mensagem útil em vez
          // de "FFMPEG_FAILED + 200 bytes de HTML".
          const tail = await resp.text().catch(() => '')
          const looksLikeHtml = /^\s*<(!doctype|html)/i.test(tail)
          const isTunnelDown = looksLikeHtml &&
            (resp.status === 521 || resp.status === 522 ||
             resp.status === 523 || resp.status === 525 || resp.status === 530)
          throw new FfmpegSnapshotError(
            isTunnelDown
              ? `Tunnel da box offline (Cloudflare ${resp.status}) — ` +
                `verifique se o cloudflared do edge box está rodando`
              : `go2rtc /api/frame.jpeg returned ${resp.status}`,
            isTunnelDown ? 'TUNNEL_OFFLINE' : 'FFMPEG_FAILED',
            // Não vaza o HTML inteiro no stderrTail — só preserva primeiros 80 chars
            // pra debug, sem inflar log.
            looksLikeHtml ? `[HTML error page, status=${resp.status}]` : tail.slice(0, 200),
          )
        }
        // Sanity: alguns proxies devolvem 200 com HTML quando origem retorna
        // 5xx. Pré-detectamos via magic bytes JPEG.
        buf = Buffer.from(await resp.arrayBuffer())
        if (buf.length > 3 && (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff)) {
          const preview = buf.slice(0, 80).toString('utf8')
          const looksLikeHtml = /<(!doctype|html)/i.test(preview)
          if (looksLikeHtml) {
            throw new FfmpegSnapshotError(
              'Origem retornou HTML (provavelmente página de erro do CDN/tunnel)',
              'TUNNEL_OFFLINE',
              `[HTML body, status=${resp.status}]`,
            )
          }
        }
      } else {
        // Fallback: ffmpeg + RTSP direto (legacy, só funciona se Cloud roteia até a câmera)
        buf = await captureSnapshot(source.url)
      }
    } catch (err) {
      if (err instanceof FfmpegSnapshotError) {
        const httpCode =
          err.code === 'INVALID_URL'      ? 400 :
          err.code === 'TIMEOUT'          ? 504 :
          err.code === 'TOO_LARGE'        ? 502 :
          err.code === 'NO_OUTPUT'        ? 502 :
          err.code === 'TUNNEL_OFFLINE'   ? 503 :   // Service Unavailable — operador entende
          /* FFMPEG_FAILED */               502
        // 2026-05-12: log enxuto pra TUNNEL_OFFLINE — operador não precisa de
        // 200 bytes de stderrTail repetidos. Log único por tipo de erro.
        logger.warn(
          {
            cameraId: decoded.cameraId,
            errCode: err.code,
            stderrTail: err.code === 'TUNNEL_OFFLINE' ? undefined : err.stderrTail?.slice(-200),
          },
          err.code === 'TUNNEL_OFFLINE' ? 'snapshot_tunnel_offline' : 'snapshot_jpeg_failed',
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

// ─── POST /live/:id/talkback  ─────────────────────────────────────────────────
// Áudio bidirecional: browser envia áudio do microfone para a câmera.
//
// Fluxo:
//   1. Frontend obtém ticket WHEP normal via GET /cameras/:id/live-token?kind=whep
//   2. Cria RTCPeerConnection com transceivers:
//        audio: sendrecv (envia mic, recebe back-channel da câmera)
//        video: inactive (sem vídeo para não conflitar com o WHEP principal)
//   3. POST /live/:id/talkback?ticket=<ticket> com SDP offer
//   4. Backend verifica ticket (kind=whep) e proxy para go2rtc /api/webrtc
//      → go2rtc detecta sendrecv e ativa back-channel RTSP (se câmera suportar)
//
// Câmeras sem suporte a back-channel RTSP vão aceitar a conexão mas ignorar
// o áudio. O frontend deve tolerar silêncio sem tratar como erro.
liveRouter.post(
  '/:id/talkback',
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
      // Reutiliza ticket WHEP — mesmo nível de autorização que assistir o stream.
      const decoded = liveService.verifyTicket(ticket, 'whep')
      if (decoded.cameraId !== req.params.id) throw new UnauthorizedError('Ticket não corresponde à câmera')

      const edge = await liveService.resolveGo2rtcByTicket(decoded)

      const sdp = (req as any).rawBody as string
      if (!sdp) {
        res.status(400).json({ error: 'MISSING_SDP', message: 'SDP offer ausente' })
        return
      }

      // Mesmo endpoint WHEP — go2rtc detecta sendrecv no audio transceiver
      // e ativa back-channel RTSP (se câmera suportar).
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
