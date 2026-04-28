/**
 * Playback Service — geração de manifest HLS dinâmico + ticket JWT.
 *
 * Diferente de live-streaming HLS (que tem manifest "rolling" com poucos
 * segmentos visíveis), aqui geramos manifest **VOD** (Video On Demand):
 * lista TODOS os segmentos do range pedido, com `#EXT-X-PLAYLIST-TYPE:VOD`
 * e `#EXT-X-ENDLIST` no final. Player (hls.js) entende como gravação
 * fechada e habilita scrubbing arbitrário.
 *
 * Auth no playback:
 *   - <video> não envia Authorization header. Precisamos de ticket no
 *     query string (mesmo padrão do snapshot/whep).
 *   - Ticket carrega: cameraId + range válido (startedAt..endedAt).
 *     Endpoint do segmento valida que o segmento pedido cai no range
 *     do ticket — anti-IDOR cross-period.
 *   - TTL do ticket: 30 minutos (suficiente pra revisar dia inteiro
 *     com pausas; se expirar, cliente pede outro).
 *
 * Por que não passar tudo via query string sem ticket:
 *   - JWT > query params arbitrários porque é assinado: cliente não pode
 *     forjar "me deixa baixar segmento de outra câmera".
 */
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { ForbiddenError, UnauthorizedError, NotFoundError } from '../lib/errors'

const PLAYBACK_TOKEN_TTL_SEC = 30 * 60   // 30 minutos

export interface PlaybackTicket {
  cameraId: string
  fromMs:   number   // epoch ms (mais leve que ISO string em JWT)
  toMs:     number
  iat:      number
  exp:      number
}

export const playbackService = {
  /**
   * Emite ticket JWT pra um range específico de gravação. O frontend
   * usa esse ticket nos requests de manifest.m3u8 + segments/.ts.
   * Retorna também a URL do manifest pré-montada pro convenience.
   */
  issueTicket(cameraId: string, fromMs: number, toMs: number): { ticket: string; manifestUrl: string } {
    const now = Math.floor(Date.now() / 1000)
    const payload: PlaybackTicket = {
      cameraId,
      fromMs,
      toMs,
      iat: now,
      exp: now + PLAYBACK_TOKEN_TTL_SEC,
    }
    const ticket = jwt.sign(payload, process.env.JWT_SECRET!, { algorithm: 'HS256' })
    return {
      ticket,
      manifestUrl: `/playback/${cameraId}/manifest.m3u8?ticket=${encodeURIComponent(ticket)}`,
    }
  },

  /**
   * Valida ticket. Lança 401 se inválido/expirado, 403 se mismatch de
   * cameraId.
   */
  verifyTicket(token: string, expectedCameraId?: string): PlaybackTicket {
    let decoded: PlaybackTicket
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!, {
        algorithms: ['HS256'],
      }) as PlaybackTicket
    } catch {
      throw new UnauthorizedError('Ticket de playback inválido ou expirado')
    }
    if (expectedCameraId && decoded.cameraId !== expectedCameraId) {
      throw new ForbiddenError('Ticket não corresponde à câmera')
    }
    return decoded
  },

  /**
   * Gera o manifest HLS .m3u8 textual pro range do ticket.
   *
   * Retorna string com formato:
   *   #EXTM3U
   *   #EXT-X-VERSION:3
   *   #EXT-X-PLAYLIST-TYPE:VOD
   *   #EXT-X-TARGETDURATION:7              ← max(durationSec)
   *   #EXT-X-MEDIA-SEQUENCE:0
   *   #EXTINF:6.0,
   *   /playback/<cameraId>/segments/<segId>.ts?ticket=...
   *   #EXTINF:5.97,
   *   /playback/<cameraId>/segments/<segId>.ts?ticket=...
   *   #EXT-X-ENDLIST
   *
   * IMPORTANTE — gaps na gravação:
   *   Se há um buraco no meio (ex: câmera offline 5min e voltou), o player
   *   trata como "vídeo continua" e pula o gap. Isso é OK pra revisão
   *   (operador vê "saltou de 14:32 pra 14:37"). Frigate-like avançado
   *   colocaria #EXT-X-DISCONTINUITY entre segmentos com gap > N segundos.
   *   Adicionamos a marcação se gap > 3*durationAlvo.
   */
  async buildManifest(ticket: PlaybackTicket, baseUrl: string): Promise<string> {
    const segments = await prisma.recordingSegment.findMany({
      where: {
        cameraId: ticket.cameraId,
        startedAt: { lte: new Date(ticket.toMs) },
        endedAt:   { gte: new Date(ticket.fromMs) },
      },
      orderBy: { startedAt: 'asc' },
      take: 5000,   // ~8h de gravação 6s/seg. Player comum aguenta.
    })

    if (segments.length === 0) {
      throw new NotFoundError('Sem gravações no período')
    }

    const targetDuration = Math.ceil(
      Math.max(...segments.map(s => s.durationSec)),
    )

    const lines: string[] = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      `#EXT-X-TARGETDURATION:${targetDuration}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
    ]

    // Gap detection — se gap entre fim do segmento N e início do N+1 for
    // > 3× duration alvo, sinaliza descontinuidade (player vai resetar
    // codec state — necessário se houver mudança de resolução também).
    const ticketParam = `?ticket=${encodeURIComponent(jwt.sign(
      { cameraId: ticket.cameraId, fromMs: ticket.fromMs, toMs: ticket.toMs,
        iat: ticket.iat, exp: ticket.exp },
      process.env.JWT_SECRET!, { algorithm: 'HS256' },
    ))}`
    let prevEnd: Date | null = null
    for (const s of segments) {
      if (prevEnd) {
        const gapSec = (s.startedAt.getTime() - prevEnd.getTime()) / 1000
        if (gapSec > targetDuration * 3) {
          lines.push('#EXT-X-DISCONTINUITY')
        }
      }
      // EXTINF aceita float (3 casas decimais)
      lines.push(`#EXTINF:${s.durationSec.toFixed(3)},`)
      lines.push(`${baseUrl}/playback/${ticket.cameraId}/segments/${s.id}.ts${ticketParam}`)
      prevEnd = s.endedAt
    }

    lines.push('#EXT-X-ENDLIST')
    return lines.join('\n') + '\n'
  },

  /**
   * Lista ranges com gravação dentro de um dia, agrupados em "buckets" de
   * minutos. Usado pelo timeline scrubber pra desenhar onde tem ou não
   * gravação visível (heatmap básico).
   *
   * Retorna array de {minute, hasRecording} pra todos os 1440 minutos do dia.
   * Bucket de 1min é granular o suficiente pro UI sem virar tabela enorme.
   */
  async dayTimeline(cameraId: string, dayStart: Date): Promise<Array<{ m: number; rec: boolean }>> {
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    const segments = await prisma.recordingSegment.findMany({
      where: {
        cameraId,
        startedAt: { lt: dayEnd },
        endedAt:   { gt: dayStart },
      },
      select: { startedAt: true, endedAt: true },
      orderBy: { startedAt: 'asc' },
    })

    // Marca cada minuto que tem pelo menos 1 segmento sobrepondo.
    const buckets = new Array(1440).fill(false) as boolean[]
    const dayStartMs = dayStart.getTime()
    for (const s of segments) {
      const startMin = Math.max(0, Math.floor((s.startedAt.getTime() - dayStartMs) / 60_000))
      const endMin   = Math.min(1440, Math.ceil((s.endedAt.getTime() - dayStartMs) / 60_000))
      for (let m = startMin; m < endMin; m++) buckets[m] = true
    }
    return buckets.map((rec, m) => ({ m, rec }))
  },
}
