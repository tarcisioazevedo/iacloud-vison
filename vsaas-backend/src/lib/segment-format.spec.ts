/**
 * detectSegmentFormat unit tests — Sprint γ-Day1
 *
 * ID U06 do plano QA.
 *
 * Bug histórico que estes testes blindam (G19 fix):
 *   - Edge box gerava .mp4 com ftyp (normal) ao invés de mpegts ou fMP4.
 *   - HLS.js falhava silenciosamente; playback "Falha" sem clue.
 *   - detectSegmentFormat rejeita no /register antes do INSERT.
 */
import { describe, it, expect } from 'vitest'
import { detectSegmentFormat } from '../routes/iacv-box-segments'

function buildMpegTsBuffer(size = 376): Buffer {
  const buf = Buffer.alloc(size, 0x00)
  buf[0]   = 0x47  // sync byte 1
  buf[188] = 0x47  // sync byte 2 (188 bytes depois)
  return buf
}

function buildMp4Buffer(boxType: string, size = 32): Buffer {
  const buf = Buffer.alloc(size, 0x00)
  // bytes 0-3 = box size (big-endian uint32)
  buf.writeUInt32BE(size, 0)
  // bytes 4-7 = box type ASCII
  buf.write(boxType, 4, 'ascii')
  return buf
}

describe('detectSegmentFormat', () => {
  it('aceita MPEG-TS válido (2 sync bytes 0x47)', () => {
    expect(detectSegmentFormat(buildMpegTsBuffer()).format).toBe('mpegts')
  })

  it('aceita MPEG-TS curto (só 1º sync byte visível)', () => {
    const buf = Buffer.alloc(100, 0x00)
    buf[0] = 0x47
    expect(detectSegmentFormat(buf).format).toBe('mpegts')
  })

  it('detecta fMP4 (styp) como válido pra HLS', () => {
    expect(detectSegmentFormat(buildMp4Buffer('styp')).format).toBe('mp4_fragmented')
  })

  it('rejeita MP4 com ftyp (normal) — HLS.js NÃO toca (bug G19)', () => {
    const r = detectSegmentFormat(buildMp4Buffer('ftyp'))
    expect(r.format).toBe('mp4_invalid')
    expect(r.reason).toMatch(/mpegts|fMP4|CMAF/i)
  })

  it('rejeita MP4 com moov (normal)', () => {
    expect(detectSegmentFormat(buildMp4Buffer('moov')).format).toBe('mp4_invalid')
  })

  it('rejeita buffer muito pequeno', () => {
    expect(detectSegmentFormat(Buffer.alloc(8)).format).toBe('unknown')
  })

  it('rejeita magic bytes desconhecidos (provável arquivo aleatório/corrompido)', () => {
    const buf = Buffer.alloc(200, 0x00)
    buf.write('NOPENOPE', 0, 'ascii')
    const r = detectSegmentFormat(buf)
    expect(r.format).toBe('unknown')
    expect(r.reason).toMatch(/magic bytes desconhecidos/)
  })

  it('rejeita MPEG-TS com 1º sync byte mas SEM 2º (truncado/corrompido)', () => {
    const buf = Buffer.alloc(300, 0xff)
    buf[0] = 0x47
    // buf[188] != 0x47 (= 0xff)
    expect(detectSegmentFormat(buf).format).toBe('unknown')
  })
})
