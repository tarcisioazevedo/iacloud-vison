/**
 * EventClipBuilder — monta playlist HLS (.m3u8) para um DetectionEvent.
 *
 * Reaproveita os RecordingSegment já existentes em R2 (sem re-encode).
 * Inclui buffer pré/pós configurável pra capturar contexto.
 *
 * Saída: texto m3u8 com EXTINF + URLs presignadas dos .ts.
 * O player só consome HLS — não há conversão de codec, é puro stitch.
 *
 * Inspirado em Frigate event recordings (pre_capture + post_capture).
 */

import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { NotFoundError } from '../lib/errors'
import { playbackService } from './playback.service'

const PRE_BUFFER_SEC  = 3
const POST_BUFFER_SEC = 3

export async function buildEventM3u8(eventId: string): Promise<{
  m3u8: string
  cameraId: string
  startTime: Date
  endTime: Date | null
  segmentCount: number
}> {
  const evt = await prisma.detectionEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      cameraId: true,
      startTime: true,
      endTime: true,
      camera: { select: { siteId: true, site: { select: { clienteFinal: { select: { integradorId: true } } } } } },
    },
  })
  if (!evt) throw new NotFoundError('DetectionEvent')

  const integradorId = evt.camera.site?.clienteFinal?.integradorId
  if (!integradorId) throw new NotFoundError('integrador')

  // Janela: [startTime - PRE, endTime + POST]. Se endTime null (event ainda
  // ativo), usa now() como teto.
  const from = new Date(evt.startTime.getTime() - PRE_BUFFER_SEC * 1000)
  const toBase = evt.endTime ?? new Date()
  const to = new Date(toBase.getTime() + POST_BUFFER_SEC * 1000)

  // Busca segments que SOBREPÕEM a janela.
  const segments = await prisma.recordingSegment.findMany({
    where: {
      cameraId: evt.cameraId,
      uploadStatus: 'UPLOADED',
      startedAt: { lt: to },
      endedAt:   { gt: from },
    },
    orderBy: { startedAt: 'asc' },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      durationSec: true,
      storagePath: true,
    },
  })

  if (segments.length === 0) {
    return {
      m3u8: buildEmptyPlaylist(),
      cameraId: evt.cameraId,
      startTime: evt.startTime,
      endTime: evt.endTime,
      segmentCount: 0,
    }
  }

  // Calcula targetduration (maior duração arredondada pra cima)
  const targetDuration = Math.max(
    1,
    Math.ceil(Math.max(...segments.map(s => s.durationSec ?? 10))),
  )

  // Emite ticket cobrindo o range do clip — reusa o endpoint `/playback/:cam/segments/:sid.ts`
  // (mesma cadeia que o PlaybackPlayer), evitando expor presigned R2 com checksum
  // que bate em CORS no browser. Reuse de auth + mesma rota de streaming.
  const { ticket } = playbackService.issueTicket(evt.cameraId, from.getTime(), to.getTime())

  const lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-PROGRAM-DATE-TIME:${segments[0].startedAt.toISOString()}`,
  ]

  for (const seg of segments) {
    const dur = seg.durationSec ?? 10
    const url = `/playback/${evt.cameraId}/segments/${seg.id}.ts?ticket=${encodeURIComponent(ticket)}`
    lines.push(`#EXTINF:${dur.toFixed(3)},`)
    lines.push(url)
  }

  lines.push('#EXT-X-ENDLIST')

  logger.info({
    eventId, cameraId: evt.cameraId,
    segmentCount: segments.length, from, to,
  }, 'event_clip_built')

  return {
    m3u8: lines.join('\n'),
    cameraId: evt.cameraId,
    startTime: evt.startTime,
    endTime: evt.endTime,
    segmentCount: segments.length,
  }
}

function buildEmptyPlaylist(): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:1',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-ENDLIST',
  ].join('\n')
}
