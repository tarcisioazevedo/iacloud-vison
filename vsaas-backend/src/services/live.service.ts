/**
 * Live Streaming Service
 *
 * - Emite tickets JWT efêmeros para acesso a streams (WHEP/MJPEG)
 * - Resolve o endpoint go2rtc do EdgeNode responsável pela câmera
 * - Centraliza lógica de autorização de stream (tenant scope)
 */
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors'
import type { JwtPayload } from '../middleware/auth'
import { decryptSecret } from '../lib/crypto'
import { logger } from '../lib/logger'

const LIVE_TOKEN_TTL_SEC = 60 // ticket válido por 60s — suficiente para negociar SDP

const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

/**
 * URL base do go2rtc EMBARCADO/DEFAULT — usado quando a câmera não tem
 * edge node associado, mas ainda queremos servir live (WHEP/MJPEG) sem
 * obrigar o operador a provisionar hardware. Padrão `http://172.17.0.1:1984`
 * porque em dev usamos o go2rtc do Frigate-devcontainer rodando no host
 * (acessível pelo gateway do bridge Docker default).
 *
 * Em produção, aponte para um go2rtc embarcado no próprio container do
 * backend (sidecar) ou um go2rtc compartilhado. Setar string vazia
 * desabilita o fallback e mantém o comportamento estrito (só edge).
 */
const EMBEDDED_GO2RTC_URL = (process.env.EMBEDDED_GO2RTC_URL ?? 'http://172.17.0.1:1984').replace(/\/$/, '')
const EMBEDDED_GO2RTC_AUTH = process.env.EMBEDDED_GO2RTC_AUTH ?? '' // "user:pass" se houver

/**
 * Cache de streams já criados no go2rtc embarcado nesta instância.
 * Evita PUT /api/streams a cada ticket. Quando o backend reinicia
 * limpamos — go2rtc também perde stream se reiniciado, então
 * re-criar é seguro. Não persistido em DB de propósito (transitório).
 */
const ensuredStreamsCache = new Set<string>()

export interface LiveTicket {
  cameraId: string
  // null para 'snapshot' (não usa go2rtc do edge — vai direto na RTSP).
  edgeNodeId: string | null
  streamId: string          // nome do stream no go2rtc (ignorado em snapshot)
  // 'whep' = WebRTC, 'mjpeg' = stream contínuo, 'snapshot' = frame único JPEG
  kind: 'whep' | 'mjpeg' | 'snapshot'
  iat: number
  exp: number
}

export interface LiveAccessResult {
  ticket: string            // JWT assinado, curta duração
  streamId: string          // id no go2rtc
  liveMode: 'AUTO' | 'WHEP_ONLY' | 'MJPEG_ONLY' | 'DISABLED'
  iceServers: { urls: string | string[]; username?: string; credential?: string }[]
  camera: {
    id: string
    name: string
    resolution: string | null
    fps: number | null
  }
}

export const liveService = {
  /**
   * Verifica se o usuário (JWT do frontend) pode acessar a câmera,
   * resolve o edge node + stream, emite ticket JWT de curta duração.
   */
  async issueTicket(userJwt: JwtPayload, cameraId: string, kind: 'whep' | 'mjpeg' | 'snapshot'): Promise<LiveAccessResult> {
    const camera = await prisma.camera.findUnique({
      where: { id: cameraId },
      include: {
        site: {
          select: {
            clienteFinalId: true,
            clienteFinal: { select: { integradorId: true } },
          },
        },
        edgeNode: {
          select: {
            id: true,
            status: true,
            go2rtcEndpoint: true,
            webrtcPublicHost: true,
          },
        },
      },
    })
    if (!camera) throw new NotFoundError('Câmera')

    // Tenant scope
    const clienteFinalId = camera.site.clienteFinalId
    const integradorId = camera.site.clienteFinal.integradorId

    if (userJwt.role !== 'SUPER_ADMIN') {
      if (userJwt.clienteFinalId && userJwt.clienteFinalId !== clienteFinalId) {
        throw new ForbiddenError('Câmera fora do escopo')
      }
      if (!userJwt.clienteFinalId && userJwt.integradorId && userJwt.integradorId !== integradorId) {
        throw new ForbiddenError('Câmera fora do escopo')
      }
    }

    if (camera.liveMode === 'DISABLED') {
      throw new ForbiddenError('Live desabilitado nesta câmera')
    }

    // ── Lógica de roteamento de stream ─────────────────────────────────
    // Para snapshot (frame único via ffmpeg) NÃO exigimos edge node nem
    // go2rtc — o backend abre o RTSP direto.
    //
    // Para WHEP/MJPEG (stream contínuo) há 3 cenários, em ordem de
    // preferência:
    //   1) Câmera tem edge node ONLINE com go2rtc próprio → usa esse
    //      (stream pode ser pré-configurado lá ou criado on-demand)
    //   2) Câmera SEM edge, mas EMBEDDED_GO2RTC_URL configurada →
    //      usa o go2rtc embarcado/compartilhado, criando o stream
    //      on-demand via PUT /api/streams (precisa rtspMainUrl)
    //   3) Nenhum dos dois → 403 (live indisponível, mas snapshot ainda
    //      funciona via /live/:id/snapshot-jpeg)
    //
    // useEmbedded controla qual rota seguir; o ticket carrega
    // edgeNodeId=null nesse caso e o proxy WHEP/MJPEG resolve por
    // EMBEDDED_GO2RTC_URL via resolveGo2rtcByTicket().
    let useEmbedded = false

    const isRtmpPush = (camera as { ingestMode?: string }).ingestMode === 'RTMP_PUSH'

    if (kind !== 'snapshot') {
      if (camera.edgeNode && camera.edgeNode.status !== 'OFFLINE') {
        // (1) edge OK — fluxo padrão
      } else if (EMBEDDED_GO2RTC_URL && (camera.rtspMainUrl || (isRtmpPush && camera.go2rtcStreamId))) {
        // (2) sem edge mas temos go2rtc embarcado e (RTSP da câmera OU RTMP_PUSH com streamId)
        useEmbedded = true
      } else if (!camera.edgeNode) {
        throw new ForbiddenError('Câmera sem edge node associado — live indisponível')
      } else {
        throw new ForbiddenError('Edge node offline')
      }
    } else if (!camera.rtspMainUrl && !isRtmpPush) {
      throw new ForbiddenError('Câmera sem rtspMainUrl — snapshot indisponível')
    }

    // streamId no go2rtc:
    //   - explícito via camera.go2rtcStreamId (preferido — bate com config
    //     externa do edge, ex: "Camera_Simulada" do Frigate)
    //   - fallback estável `cam-${camera.id}` (usado quando criamos on-demand
    //     no go2rtc embarcado)
    const streamId = camera.go2rtcStreamId ?? `cam-${camera.id}`

    // (2b) Cria/garante o stream no go2rtc embarcado antes de devolver
    // ticket. Se falhar, ainda devolvemos — o erro real vai ser refletido
    // no proxy WHEP/MJPEG, com mensagem técnica útil.
    //
    // RTMP_PUSH: câmeras em modo RTMP push NÃO devem ter stream criado com
    // URL fonte — o go2rtc já tem o stream definido (config) e aguarda a
    // câmera empurrar. Criar stream com rtspMainUrl causaria loop (go2rtc
    // tentando puxar de si mesmo).
    //
    // RTMP push (outbound): se a câmera tem `rtmpPushEnabled` E `rtmpPushUrlEnc`,
    // decifra a URL e passa como 2o src pra `ensureEmbeddedStream`.
    const isRtmpPushIngest = (camera as { ingestMode?: string }).ingestMode === 'RTMP_PUSH'
    if (useEmbedded && !isRtmpPushIngest) {
      try {
        const { url: rtspUrlResolved } = await this.resolveCameraStreamUrlByTicket(camera.id)
        const rtmpPushUrl =
          (camera as { rtmpPushEnabled?: boolean }).rtmpPushEnabled
            ? decryptSecret((camera as { rtmpPushUrlEnc?: string | null }).rtmpPushUrlEnc ?? null)
            : null
        await this.ensureEmbeddedStream(streamId, rtspUrlResolved, rtmpPushUrl)
      } catch (err: any) {
        logger.warn({ err: err?.message, cameraId: camera.id, streamId }, 'embedded_stream_ensure_failed')
        // não throwa — deixa o cliente tentar e ver erro 502 com detalhe
      }
    }
    const now = Math.floor(Date.now() / 1000)

    const payload: LiveTicket = {
      cameraId: camera.id,
      // Quando useEmbedded=true (sem edge ou edge offline), gravamos null no
      // ticket — o proxy WHEP/MJPEG vê null e roteia para EMBEDDED_GO2RTC_URL.
      edgeNodeId: useEmbedded ? null : (camera.edgeNodeId ?? null),
      streamId,
      kind,
      iat: now,
      exp: now + LIVE_TOKEN_TTL_SEC,
    }

    const ticket = jwt.sign(payload, process.env.JWT_SECRET!, { algorithm: 'HS256' })

    // ICE: camera.webrtcIceServers > default Google STUN
    const iceServers = (camera.webrtcIceServers as any[] | null) ?? DEFAULT_ICE

    return {
      ticket,
      streamId,
      liveMode: camera.liveMode as any,
      iceServers,
      camera: {
        id: camera.id,
        name: camera.name,
        resolution: camera.resolution,
        fps: camera.fps,
      },
    }
  },

  /**
   * Valida um ticket JWT e retorna o payload.
   * Lança erro se inválido ou expirado.
   */
  verifyTicket(token: string, expectedKind?: 'whep' | 'mjpeg' | 'snapshot'): LiveTicket {
    let decoded: LiveTicket
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as LiveTicket
    } catch {
      throw new UnauthorizedError('Ticket inválido ou expirado')
    }
    if (expectedKind && decoded.kind !== expectedKind) {
      throw new ForbiddenError(`Ticket inválido para ${expectedKind}`)
    }
    return decoded
  },

  /**
   * Resolve a URL RTSP completa de uma câmera (com senha decifrada quando
   * presente em rtspPasswordEnc). Usado por captureSnapshot que dispara
   * ffmpeg local pra extrair frame único.
   *
   * Lança ForbiddenError se a câmera não tem URL ou se for fora do tenant.
   */
  async resolveCameraStreamUrl(
    cameraId: string,
    userJwt: JwtPayload,
  ): Promise<{ url: string; cameraName: string }> {
    const cam = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: {
        id: true,
        name: true,
        rtspMainUrl: true,
        rtspUsername: true,
        rtspPasswordEnc: true,
        liveMode: true,
        site: {
          select: {
            clienteFinalId: true,
            clienteFinal: { select: { integradorId: true } },
          },
        },
      },
    })
    if (!cam) throw new NotFoundError('Câmera')

    // Tenant scope idêntico ao issueTicket — defesa em profundidade.
    if (userJwt.role !== 'SUPER_ADMIN') {
      const cf = cam.site.clienteFinalId
      const integ = cam.site.clienteFinal.integradorId
      if (userJwt.clienteFinalId && userJwt.clienteFinalId !== cf) {
        throw new ForbiddenError('Câmera fora do escopo')
      }
      if (!userJwt.clienteFinalId && userJwt.integradorId && userJwt.integradorId !== integ) {
        throw new ForbiddenError('Câmera fora do escopo')
      }
    }

    if (cam.liveMode === 'DISABLED') {
      throw new ForbiddenError('Live desabilitado nesta câmera')
    }
    if (!cam.rtspMainUrl) {
      throw new ForbiddenError('Câmera sem rtspMainUrl configurada')
    }

    // Se já tem credenciais embutidas na URL (rtsp://user:pass@host),
    // respeita. Caso contrário, injeta a partir de username + senha
    // decifrada (rtspPasswordEnc usa AES-256-GCM via lib/crypto).
    let finalUrl = cam.rtspMainUrl
    const hasInlineAuth = /^rtsps?:\/\/[^/@]+:[^/@]+@/i.test(finalUrl)
    if (!hasInlineAuth && cam.rtspUsername) {
      const password = decryptSecret(cam.rtspPasswordEnc) ?? ''
      try {
        const u = new URL(finalUrl)
        u.username = encodeURIComponent(cam.rtspUsername)
        u.password = encodeURIComponent(password)
        finalUrl = u.toString()
      } catch {
        // URL malformada — devolve original; o ffmpeg vai falhar
        // explicitamente lá adiante.
      }
    }

    return { url: finalUrl, cameraName: cam.name }
  },

  /**
   * Variante usada pelo endpoint /live/:id/snapshot-jpeg, onde a autorização
   * já foi feita pelo ticket emitido em issueTicket(). Não revalida tenant
   * (defesa em profundidade já aconteceu na emissão); apenas monta a URL
   * final com credenciais.
   */
  async resolveCameraStreamUrlByTicket(cameraId: string): Promise<{ url: string; cameraName: string }> {
    const cam = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: {
        id: true,
        name: true,
        rtspMainUrl: true,
        rtspUsername: true,
        rtspPasswordEnc: true,
      },
    })
    if (!cam) throw new NotFoundError('Câmera')
    if (!cam.rtspMainUrl) {
      throw new ForbiddenError('Câmera sem rtspMainUrl configurada')
    }

    let finalUrl = cam.rtspMainUrl
    const hasInlineAuth = /^rtsps?:\/\/[^/@]+:[^/@]+@/i.test(finalUrl)
    if (!hasInlineAuth && cam.rtspUsername) {
      const password = decryptSecret(cam.rtspPasswordEnc) ?? ''
      try {
        const u = new URL(finalUrl)
        u.username = encodeURIComponent(cam.rtspUsername)
        u.password = encodeURIComponent(password)
        finalUrl = u.toString()
      } catch {
        /* segue com URL crua se mal formada */
      }
    }
    return { url: finalUrl, cameraName: cam.name }
  },

  /**
   * Tunnel-aware snapshot source resolver.
   *
   * Se o EdgeNode tem `go2rtcEndpoint` configurado (tunnel ativo), prefere
   * buscar o JPEG via HTTP no go2rtc remoto (`<endpoint>/api/frame.jpeg?src=<streamId>`)
   * — bypassing ffmpeg local e RTSP direto (que falha quando câmera está em LAN privada).
   *
   * Fallback para `rtspMainUrl` direto quando:
   *   - EdgeNode não tem go2rtcEndpoint
   *   - Câmera não tem `go2rtcStreamId` (sem mapeamento Frigate/go2rtc)
   *
   * Retorna `{ kind: 'http', url }` (snapshot via fetch) ou `{ kind: 'rtsp', url }` (snapshot via ffmpeg).
   */
  async resolveSnapshotSourceByTicket(cameraId: string): Promise<{
    kind: 'http' | 'rtsp'
    url: string
    cameraName: string
    authHeader?: string
  }> {
    const cam = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: {
        id: true,
        name: true,
        rtspMainUrl: true,
        rtspUsername: true,
        rtspPasswordEnc: true,
        go2rtcStreamId: true,
        edgeNode: { select: { go2rtcEndpoint: true, go2rtcAuth: true } },
      },
    })
    if (!cam) throw new NotFoundError('Câmera')

    // Caminho preferido: tunnel HTTP via go2rtc remoto
    if (cam.edgeNode?.go2rtcEndpoint && cam.go2rtcStreamId) {
      const baseUrl = cam.edgeNode.go2rtcEndpoint.replace(/\/$/, '')
      const url = `${baseUrl}/api/frame.jpeg?src=${encodeURIComponent(cam.go2rtcStreamId)}`
      const authHeader = cam.edgeNode.go2rtcAuth
        ? `Basic ${Buffer.from(cam.edgeNode.go2rtcAuth).toString('base64')}`
        : undefined
      return { kind: 'http', url, cameraName: cam.name, authHeader }
    }

    // Fallback: ffmpeg + RTSP direto (só funciona se Cloud tem rota até a câmera)
    if (!cam.rtspMainUrl) {
      throw new ForbiddenError('Câmera sem rtspMainUrl configurada')
    }
    let finalUrl = cam.rtspMainUrl
    const hasInlineAuth = /^rtsps?:\/\/[^/@]+:[^/@]+@/i.test(finalUrl)
    if (!hasInlineAuth && cam.rtspUsername) {
      const password = decryptSecret(cam.rtspPasswordEnc) ?? ''
      try {
        const u = new URL(finalUrl)
        u.username = encodeURIComponent(cam.rtspUsername)
        u.password = encodeURIComponent(password)
        finalUrl = u.toString()
      } catch { /* URL crua */ }
    }
    return { kind: 'rtsp', url: finalUrl, cameraName: cam.name }
  },

  /**
   * Resolve a URL base do go2rtc do edge associado.
   * Retorna { baseUrl, authHeader? } pronto para proxy.
   */
  async resolveEdgeGo2rtc(edgeNodeId: string): Promise<{ baseUrl: string; authHeader?: string }> {
    const edge = await prisma.edgeNode.findUnique({
      where: { id: edgeNodeId },
      select: { go2rtcEndpoint: true, go2rtcAuth: true, status: true },
    })
    if (!edge) throw new NotFoundError('Edge node')
    if (!edge.go2rtcEndpoint) throw new ForbiddenError('go2rtc não configurado neste edge')
    if (edge.status === 'OFFLINE') throw new ForbiddenError('Edge offline')

    return {
      baseUrl: edge.go2rtcEndpoint.replace(/\/$/, ''),
      authHeader: edge.go2rtcAuth ? `Basic ${Buffer.from(edge.go2rtcAuth).toString('base64')}` : undefined,
    }
  },

  /**
   * Retorna a base URL do go2rtc EMBARCADO (default do backend) ou
   * lança erro descrevendo que está desabilitado.
   *
   * Uso: rota /live/:id/whep|mjpeg quando ticket.edgeNodeId === null.
   */
  resolveEmbeddedGo2rtc(): { baseUrl: string; authHeader?: string } {
    if (!EMBEDDED_GO2RTC_URL) {
      throw new ForbiddenError('go2rtc embarcado desabilitado (EMBEDDED_GO2RTC_URL ausente)')
    }
    return {
      baseUrl: EMBEDDED_GO2RTC_URL,
      authHeader: EMBEDDED_GO2RTC_AUTH
        ? `Basic ${Buffer.from(EMBEDDED_GO2RTC_AUTH).toString('base64')}`
        : undefined,
    }
  },

  /**
   * Roteador final: dado um ticket, escolhe entre go2rtc do edge ou go2rtc
   * embarcado. Substitui resolveEdgeGo2rtc() nas rotas que precisam aceitar
   * ambos os modos (WHEP/MJPEG).
   */
  async resolveGo2rtcByTicket(ticket: LiveTicket): Promise<{ baseUrl: string; authHeader?: string }> {
    if (ticket.edgeNodeId) {
      return this.resolveEdgeGo2rtc(ticket.edgeNodeId)
    }
    return this.resolveEmbeddedGo2rtc()
  },

  /**
   * Garante que o stream `streamId` existe no go2rtc embarcado, criando-o
   * se necessário via PUT /api/streams?name=...&src=...
   *
   * O go2rtc aceita src como URL RTSP/RTSPS/HTTP — o que enviamos. Após
   * criação, o stream fica em memória do go2rtc e fica disponível em
   * /api/webrtc, /api/stream.mjpeg, rtsp://host:8554/<name>.
   *
   * Cache em memória evita PUT em toda emissão de ticket. Se o go2rtc for
   * reiniciado, perdemos o stream e o próximo ticket recria — eventualmente
   * consistente.
   *
   * Se o usuário trocar a URL/senha da câmera, o cache fica obsoleto. Para
   * forçar recriação, removemos do cache no PATCH /cameras/:id (TODO).
   */
  async ensureEmbeddedStream(
    streamId: string,
    rtspUrl: string,
    /** Destino RTMP push opcional (rtmp://… ou rtmps://…). Quando presente,
     *  go2rtc faz copy do H.264 do rtspUrl pro destino sem transcode (CPU ~0).
     *  go2rtc detecta o protocolo pelo prefixo da URL — não precisa flag. */
    rtmpPushUrl?: string | null,
  ): Promise<void> {
    if (!EMBEDDED_GO2RTC_URL) return
    if (ensuredStreamsCache.has(streamId)) return

    // go2rtc 1.9.x API quirks:
    //   - PUT /api/streams CRIA — falha 400 se já existe.
    //   - DELETE /api/streams?src=NAME remove.
    //   - GET /api/streams?src=NAME retorna {} (vazio) ou {NAME:{...}}.
    //
    // Estratégia: DELETE silencioso (idempotente), seguido de PUT com
    // os producers necessários. Mais simples e robusto do que tentar
    // diferenciar create vs update.
    const auth: HeadersInit = EMBEDDED_GO2RTC_AUTH
      ? { Authorization: `Basic ${Buffer.from(EMBEDDED_GO2RTC_AUTH).toString('base64')}` }
      : {}

    // Limpa qualquer stream com o mesmo nome (não falha se 404)
    try {
      await fetch(
        `${EMBEDDED_GO2RTC_URL}/api/streams?src=${encodeURIComponent(streamId)}`,
        { method: 'DELETE', signal: AbortSignal.timeout(3000), headers: auth },
      )
    } catch {
      /* idempotente — segue para criar */
    }

    // Cria stream com producers (todos no mesmo `name`):
    //
    //   1. rtspUrl                       — producer principal (H.264 nativo)
    //                                      consumido por WHEP/WebRTC sem transcode
    //   2. (opcional) rtmpPushUrl        — destino de PUSH. go2rtc trata src
    //                                      RTMP como CONSUMER por padrão; tudo
    //                                      que entra do producer #1 é copiado
    //                                      pra cá. Sem transcode, zero CPU.
    //
    // (MJPEG fallback: NÃO criamos transcoder ffmpeg automático aqui — em
    //  go2rtc 1.9.x precisa de sintaxe específica e tem codec mismatch com
    //  H264+AAC. O frontend cai no snapshot-poll via /live/:id/snapshot-jpeg
    //  quando WHEP falha, sem depender de MJPEG do go2rtc.)
    const params = new URLSearchParams()
    params.set('name', streamId)
    params.append('src', rtspUrl)
    if (rtmpPushUrl) {
      // Validação leve — caller também valida, mas defesa em profundidade.
      if (/^rtmps?:\/\//i.test(rtmpPushUrl)) {
        params.append('src', rtmpPushUrl)
      } else {
        logger.warn({ streamId }, 'embedded_stream_rtmp_url_invalid_skipped')
      }
    }
    const url = `${EMBEDDED_GO2RTC_URL}/api/streams?${params.toString()}`
    const resp = await fetch(url, {
      method: 'PUT',
      signal: AbortSignal.timeout(5000),
      headers: auth,
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(
        `go2rtc PUT /api/streams falhou: ${resp.status} ${resp.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      )
    }

    ensuredStreamsCache.add(streamId)
    logger.info(
      { streamId, srcCount: rtmpPushUrl ? 2 : 1, rtmpPush: !!rtmpPushUrl },
      'embedded_stream_created',
    )
  },

  /** Remove streamId do cache (chamar ao mudar credenciais ou URL da câmera). */
  invalidateEmbeddedStream(streamId: string): void {
    ensuredStreamsCache.delete(streamId)
  },
}
