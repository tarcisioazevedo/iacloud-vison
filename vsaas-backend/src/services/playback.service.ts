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
  cameraId:    string
  fromMs:      number   // epoch ms (mais leve que ISO string em JWT)
  toMs:        number
  isLiveRange?: boolean  // true = range tocando o live edge (inclui PENDING)
  iat:         number
  exp:         number
}

export const playbackService = {
  /**
   * Emite ticket JWT pra um range específico de gravação. O frontend
   * usa esse ticket nos requests de manifest.m3u8 + segments/.ts.
   * Retorna também a URL do manifest pré-montada pro convenience.
   */
  issueTicket(cameraId: string, fromMs: number, toMs: number): { ticket: string; manifestUrl: string } {
    const nowEpoch = Date.now()
    // Cap toMs no presente: não emitir tickets pra futuros puros
    const cappedToMs = Math.min(toMs, nowEpoch)
    // Range tocando os últimos 60s = live edge (inclui segmentos PENDING)
    const isLiveRange = toMs >= nowEpoch - 60_000

    const now = Math.floor(nowEpoch / 1000)
    const payload: PlaybackTicket = {
      cameraId,
      fromMs,
      toMs:        cappedToMs,
      isLiveRange,
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
    // G6 fix (2026-05-09): paginação por cursor pra suportar manifest >8h.
    // Antes: take 5000 truncava silenciosamente em ~8.3h (segments de 6s).
    // Agora: itera em batches até esgotar o range autorizado pelo ticket
    // (cap 24h). Hard-cap de 25k segments (~41h) como defesa em profundidade.
    const HARD_CAP = 25_000
    const BATCH_SIZE = 2_000
    interface SegRow { id: string; startedAt: Date; endedAt: Date; durationSec: number }
    const segments: SegRow[] = []
    let cursor: { startedAt: Date; id: string } | null = null

    while (segments.length < HARD_CAP) {
      const batch: SegRow[] = await prisma.recordingSegment.findMany({
        where: {
          cameraId: ticket.cameraId,
          startedAt: { lte: new Date(ticket.toMs) },
          endedAt:   { gte: new Date(ticket.fromMs) },
          // Segmentos recuperáveis. Em modo DVR (isLiveRange) incluímos também
          // PENDING — são segmentos recém-gravados ainda subindo pro R2.
          // O endpoint de segmentos aguarda até 5s pelo upload antes de servir.
          uploadStatus: { in: ticket.isLiveRange
            ? ['UPLOADED', 'LOCAL_ONLY', 'PENDING']
            : ['UPLOADED', 'LOCAL_ONLY']
          },
          // Cursor: pega só após o último visto (mesmo startedAt + id maior,
          // ou startedAt maior).
          ...(cursor ? {
            OR: [
              { startedAt: { gt: cursor.startedAt } },
              { startedAt: cursor.startedAt, id: { gt: cursor.id } },
            ],
          } : {}),
        },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, startedAt: true, endedAt: true, durationSec: true },
        take: BATCH_SIZE,
      })
      if (batch.length === 0) break
      segments.push(...batch)
      const last: SegRow = batch[batch.length - 1]
      cursor = { startedAt: last.startedAt, id: last.id }
      if (batch.length < BATCH_SIZE) break  // último batch parcial
    }

    if (segments.length === 0) {
      throw new NotFoundError('Sem gravações no período')
    }

    const camera = await prisma.camera.findUnique({
      where: { id: ticket.cameraId },
      select: { deploymentMode: true }
    })
    const isEdgeBox = camera?.deploymentMode === 'EDGE_BOX'
    const FIX_DEPLOY_DATE = new Date('2026-05-18T14:30:00Z')

    // Aviso quando bate hard-cap. Não acontece em uso normal (ticket ≤ 24h
    // = ~14.4k segments de 6s). Se ocorre, sintoma de janela maior que o
    // cap do /playback/token ou segments < 6s no DB.
    if (segments.length >= HARD_CAP) {
      // Pino pega isto via logger central — usar require pra evitar ciclo
      // de import em playback.service.
      const { logger } = await import('../lib/logger')
      logger.warn({
        cameraId: ticket.cameraId,
        rangeMs: ticket.toMs - ticket.fromMs,
        segments: segments.length,
      }, 'playback_manifest_hit_hard_cap')
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
      const isLegacyReset = s.startedAt < FIX_DEPLOY_DATE
      const hasGap = prevEnd && (s.startedAt.getTime() - prevEnd.getTime() > 2000)

      // Apenas injeta DISCONTINUITY se:
      // 1. Há um gap de tempo real (> 2s)
      // 2. Ou é uma gravação antiga (feita quando o backend ainda forçava PTS=0)
      // 3. Ou vem de uma Edge Box (que ainda roda FFMPEG local com reset_timestamps=1)
      if (!isFirst && (hasGap || isLegacyReset || isEdgeBox)) {
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
        uploadStatus: { in: ['UPLOADED', 'LOCAL_ONLY'] },
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
    /// Soma real de segundos gravados (clampado dentro do dia). Diferencia-se
    /// de `coverageMin*60` quando há micro-gaps entre segments — `coverageMin`
    /// conta minuto com 1 segment como "1" (mesmo que tenha só 6s de vídeo),
    /// `realCoverageSec` reflete o vídeo de fato disponível pra playback.
    realCoverageSec: number
    /// Buracos de gravação > 5 min, ordenados por início. Frontend pode
    /// destacar visualmente pra alertar o operador que aquele intervalo
    /// não tem footage. Cada gap: ms desde meia-noite UTC do dia.
    gaps: Array<{ startMs: number; endMs: number; durSec: number }>
    motionMin:       number
    events:          Array<{ at: string; type: string; severity: string; label?: string | null }>
    bookmarks:       Array<{ at: string; endAt: string | null; color: string; title: string }>
  }> {
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    const dayStartMs = dayStart.getTime()
    const dayEndMs   = dayEnd.getTime()

    // 1. Segments do dia (com flag de motion pra alimentar a 2ª faixa) +
    //    sprites do dia em paralelo. Sprites entram como "evidência de
    //    gravação" no cálculo de gaps — Box pode subir sprite mesmo se o
    //    pipeline de segments falhou (são pipelines independentes), e
    //    marcar hora como "gap" quando há sprite confunde o operador.
    const dayIso = dayStart.toISOString().slice(0, 10)  // YYYY-MM-DD
    const [segments, sprites] = await Promise.all([
      prisma.recordingSegment.findMany({
        where: {
          cameraId,
          startedAt: { lt: dayEnd },
          endedAt:   { gt: dayStart },
          // P0 fix (2026-05-18): timeline só mostra minutos com footage real.
          // Segmentos FAILED/PENDING aparecem no scrubber mas não são recuperáveis
          // — geram expectativa de footage onde não há nada.
          uploadStatus: { in: ['UPLOADED', 'LOCAL_ONLY'] },
        },
        select: { startedAt: true, endedAt: true, hasMotion: true },
        orderBy: { startedAt: 'asc' },
      }),
      prisma.spriteSheet.findMany({
        where: {
          cameraId,
          day: dayIso,
          uploadedAt: { not: null },
        },
        select: { hour: true, sizeBytes: true, frameCount: true },
      }),
    ])

    // Horas UTC com evidência de gravação via sprite. Threshold sizeBytes
    // > 100KB filtra sprites "vazios" (frames duplicados/escuros) — sprite
    // cheio fica ~400KB, vazio ~14KB. frameCount sozinho não diferencia
    // (Box gera 120 mesmo sem footage real, repetindo frame preto).
    const hoursWithSpriteEvidence = new Set<number>()
    for (const sp of sprites) {
      if (Number(sp.sizeBytes) > 100_000) {
        hoursWithSpriteEvidence.add(sp.hour)
      }
    }

    const recBuckets    = new Array(1440).fill(false) as boolean[]
    const motionBuckets = new Array(1440).fill(false) as boolean[]
    const intensity     = new Array(1440).fill(0)     as number[]

    // Soma real de ms gravados, clampada dentro do dia.
    let realCoverageMs = 0

    for (const s of segments) {
      const startMs = s.startedAt.getTime()
      const endMs   = s.endedAt.getTime()
      const clampedStart = Math.max(startMs, dayStartMs)
      const clampedEnd   = Math.min(endMs,   dayEndMs)
      if (clampedEnd > clampedStart) {
        realCoverageMs += clampedEnd - clampedStart
      }

      const startMin = Math.max(0, Math.floor((startMs - dayStartMs) / 60_000))
      const endMin   = Math.min(1440, Math.ceil((endMs - dayStartMs) / 60_000))
      for (let m = startMin; m < endMin; m++) {
        recBuckets[m] = true
        intensity[m]++
        if (s.hasMotion) motionBuckets[m] = true
      }
    }

    // Detecta macro-gaps (> 5 min) entre segments consecutivos — só faz
    // sentido quando há gravação no dia. Útil pra UI alertar "aqui não tem
    // footage" antes do operador clicar e tomar tela preta.
    const GAP_THRESHOLD_SEC = 5 * 60
    const rawGaps: Array<{ startMs: number; endMs: number }> = []
    if (segments.length > 0) {
      // Gap inicial: entre meia-noite e primeiro segment (se > threshold).
      const firstStart = segments[0].startedAt.getTime()
      if (firstStart - dayStartMs > GAP_THRESHOLD_SEC * 1000) {
        rawGaps.push({ startMs: dayStartMs, endMs: firstStart })
      }
      // Gaps entre segments consecutivos.
      for (let i = 1; i < segments.length; i++) {
        const prevEnd = segments[i - 1].endedAt.getTime()
        const curStart = segments[i].startedAt.getTime()
        if (curStart - prevEnd > GAP_THRESHOLD_SEC * 1000) {
          rawGaps.push({ startMs: prevEnd, endMs: curStart })
        }
      }
      // Gap final: entre último segment e fim do dia. SÓ se o dia já passou
      // (evita marcar "futuro sem gravação" como gap em dia corrente).
      const lastEnd = segments[segments.length - 1].endedAt.getTime()
      const isPastDay = dayEndMs < Date.now() - 60_000
      if (isPastDay && dayEndMs - lastEnd > GAP_THRESHOLD_SEC * 1000) {
        rawGaps.push({ startMs: lastEnd, endMs: dayEndMs })
      }
    }

    // Subdivide cada gap removendo horas UTC com evidência de gravação
    // via sprite. Sprite com >100KB é prova de footage real (Box gerou
    // imagens não-vazias). Operador via timeline NÃO deve ver hachura
    // vermelha sobre hora cujo sprite-preview mostra imagens.
    //
    // Algoritmo: pra cada gap [start, end], percorre as horas que ele
    // toca; horas com sprite-evidence "cortam" o gap em sub-gaps.
    // Re-aplica threshold de 5min a cada sub-gap pra não emitir resíduos.
    const gaps: Array<{ startMs: number; endMs: number; durSec: number }> = []
    for (const g of rawGaps) {
      if (hoursWithSpriteEvidence.size === 0) {
        // Caminho rápido: sem sprites, gap original como antes.
        const dur = Math.floor((g.endMs - g.startMs) / 1000)
        if (dur >= GAP_THRESHOLD_SEC) {
          gaps.push({ startMs: g.startMs, endMs: g.endMs, durSec: dur })
        }
        continue
      }
      const hStart = Math.floor((g.startMs - dayStartMs) / 3_600_000)
      const hEnd   = Math.floor((g.endMs   - 1 - dayStartMs) / 3_600_000)
      let cursor = g.startMs
      for (let h = hStart; h <= hEnd; h++) {
        if (!hoursWithSpriteEvidence.has(h)) continue
        // Hora `h` tem footage — emite sub-gap até o início dela e pula.
        const hStartMs = dayStartMs + h * 3_600_000
        const hEndMs   = hStartMs   + 3_600_000
        if (hStartMs > cursor) {
          const dur = Math.floor((hStartMs - cursor) / 1000)
          if (dur >= GAP_THRESHOLD_SEC) {
            gaps.push({ startMs: cursor, endMs: hStartMs, durSec: dur })
          }
        }
        cursor = Math.max(cursor, hEndMs)
      }
      // Resto do gap após última hora pulada (ou gap inteiro se nenhuma).
      if (cursor < g.endMs) {
        const dur = Math.floor((g.endMs - cursor) / 1000)
        if (dur >= GAP_THRESHOLD_SEC) {
          gaps.push({ startMs: cursor, endMs: g.endMs, durSec: dur })
        }
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
      realCoverageSec: Math.round(realCoverageMs / 1000),
      gaps,
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
