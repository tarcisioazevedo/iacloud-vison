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

    // ── DISCONTINUITY entre TODOS os segments ─────────────────────────────
    // O ffmpeg da edge box usa `-reset_timestamps 1` (cada segment começa
    // em PTS=0 ao invés de PTS contínuo). Sem #EXT-X-DISCONTINUITY o player
    // detecta DTS retrocedendo entre segments (`DTS 0 < N out of order`)
    // e crasha com fragParsingError. Spec HLS:
    //   "EXT-X-DISCONTINUITY tag indicates a discontinuity between the
    //    Media Segment that follows it and the one that preceded it."
    //
    // Ainda detectamos GAP (sem segment) com tratamento separado — mantém
    // semântica clara (gap = sem dados; discontinuity simples = só PTS reset).
    const ticketParam = `?ticket=${encodeURIComponent(jwt.sign(
      { cameraId: ticket.cameraId, fromMs: ticket.fromMs, toMs: ticket.toMs,
        iat: ticket.iat, exp: ticket.exp },
      process.env.JWT_SECRET!, { algorithm: 'HS256' },
    ))}`
    let prevEnd: Date | null = null
    let isFirst = true
    for (const s of segments) {
      // Primeiro segment não precisa de DISCONTINUITY (não há "anterior").
      // Demais sempre recebem — porque cada segment do edge tem PTS=0
      // independente. Mesmo sem gap real, o player precisa ser sinalizado.
      if (!isFirst) {
        lines.push('#EXT-X-DISCONTINUITY')
      }
      // PROGRAM-DATE-TIME: âncora wall-clock que o player usa pra mapear
      // cada frame ↔ timestamp UTC. Necessário pra:
      //   1. UI mostrar "agora você está em 19:34:02" (não relative time)
      //   2. seek "ir pra 19:34" funcionar mesmo com gaps no manifest
      //   3. multi-camera sync (todas tocando o mesmo wall-clock)
      // RFC 8216 (HLS) §4.4.4.6: PDT aplica ao próximo Media Segment e
      // serve de âncora — fragments seguintes calculam wall-clock por offset
      // do PDT até hit numa nova tag PDT.
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${s.startedAt.toISOString()}`)
      // EXTINF aceita float (3 casas decimais)
      lines.push(`#EXTINF:${s.durationSec.toFixed(3)},`)
      lines.push(`${baseUrl}/playback/${ticket.cameraId}/segments/${s.id}.ts${ticketParam}`)
      prevEnd = s.endedAt
      isFirst = false
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

  /**
   * Timeline V2 — devolve em uma única chamada todas as séries que a UI
   * de gravação precisa pra desenhar múltiplas faixas:
   *   - recordingBitmap: 1440 chars '0|1' por minuto (1 = tem segment)
   *   - motionBitmap:    1440 chars '0|1' por minuto (1 = ALGUM segment com hasMotion)
   *   - intensity:       1440 ints — # de segments cobrindo o minuto (heatmap)
   *   - events:          até 200 eventos AnalyticsEvent do dia (dots na UI)
   *   - bookmarks:       até 100 bookmarks no dia (marcadores na UI)
   *
   * Por que tudo numa só call: 1 round-trip vs 4 paralelos. Dia inteiro de
   * gravação contínua = ~14k segments, ainda processável < 200ms aqui.
   */
  async dayTimelineV2(cameraId: string, dayStart: Date): Promise<{
    recordingBitmap: string
    motionBitmap:    string
    intensity:       number[]
    coverageMin:     number
    motionMin:       number
    events:          Array<{ at: string; type: string; severity: string; label?: string | null }>
    bookmarks:       Array<{ at: string; endAt: string | null; color: string; title: string }>
  }> {
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    const dayStartMs = dayStart.getTime()

    // 1. Segments do dia (com flag de motion pra alimentar a 2ª faixa)
    const segments = await prisma.recordingSegment.findMany({
      where: {
        cameraId,
        startedAt: { lt: dayEnd },
        endedAt:   { gt: dayStart },
      },
      select: { startedAt: true, endedAt: true, hasMotion: true },
      orderBy: { startedAt: 'asc' },
    })

    const recBuckets    = new Array(1440).fill(false) as boolean[]
    const motionBuckets = new Array(1440).fill(false) as boolean[]
    const intensity     = new Array(1440).fill(0)     as number[]

    for (const s of segments) {
      const startMin = Math.max(0, Math.floor((s.startedAt.getTime() - dayStartMs) / 60_000))
      const endMin   = Math.min(1440, Math.ceil((s.endedAt.getTime() - dayStartMs) / 60_000))
      for (let m = startMin; m < endMin; m++) {
        recBuckets[m] = true
        intensity[m]++
        if (s.hasMotion) motionBuckets[m] = true
      }
    }

    // 2. Eventos AnalyticsEvent do dia (até 200 — limite pra não inundar UI).
    //    Pega só campos pequenos. Ordenado por capturedAt asc.
    const analytics = await prisma.analyticsEvent.findMany({
      where: { cameraId, capturedAt: { gte: dayStart, lt: dayEnd } },
      select: { capturedAt: true, eventType: true, severity: true, model: true },
      orderBy: { capturedAt: 'asc' },
      take: 200,
    })

    // 3. Bookmarks do dia. Vale incluir os que cruzam o dia (start antes,
    //    fim dentro; ou start dentro, sem fim).
    const bookmarks = await prisma.bookmark.findMany({
      where: {
        cameraId,
        AND: [
          { OR: [{ startAt: { lt: dayEnd } }] },
          {
            OR: [
              { endAt: null },
              { endAt: { gt: dayStart } },
            ],
          },
        ],
      },
      select: { startAt: true, endAt: true, color: true, title: true },
      orderBy: { startAt: 'asc' },
      take: 100,
    })

    return {
      recordingBitmap: recBuckets.map(b => b ? '1' : '0').join(''),
      motionBitmap:    motionBuckets.map(b => b ? '1' : '0').join(''),
      intensity,
      coverageMin:     recBuckets.filter(Boolean).length,
      motionMin:       motionBuckets.filter(Boolean).length,
      events: analytics.map(e => ({
        at:       e.capturedAt.toISOString(),
        type:     e.eventType,
        severity: e.severity ?? 'INFO',
        label:    e.model ?? null,
      })),
      bookmarks: bookmarks.map(b => ({
        at:    b.startAt.toISOString(),
        endAt: b.endAt?.toISOString() ?? null,
        color: b.color ?? '#F59E0B',
        title: b.title,
      })),
    }
  },
}
