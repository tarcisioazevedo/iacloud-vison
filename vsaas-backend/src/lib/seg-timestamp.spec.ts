/**
 * parseSegTimestamp tests — U07
 *
 * Cobre: strftime parsing UTC, fallback, edge cases (meia-noite, fim de ano).
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { parseSegTimestamp } from './seg-timestamp'

describe('parseSegTimestamp', () => {
  it('parseia formato canônico em UTC', () => {
    const d = parseSegTimestamp('20260512_143015.ts')
    expect(d.toISOString()).toBe('2026-05-12T14:30:15.000Z')
  })

  it('parseia mesmo com sufixo UUID', () => {
    const d = parseSegTimestamp('20260512_143015_a32e8321-6a00.ts')
    expect(d.toISOString()).toBe('2026-05-12T14:30:15.000Z')
  })

  it('meia-noite UTC', () => {
    expect(parseSegTimestamp('20260512_000000.ts').toISOString())
      .toBe('2026-05-12T00:00:00.000Z')
  })

  it('último segundo do ano', () => {
    expect(parseSegTimestamp('20261231_235959.ts').toISOString())
      .toBe('2026-12-31T23:59:59.000Z')
  })

  it('fallback pra agora quando nome inválido', () => {
    const FIXED_NOW = new Date('2026-05-12T12:00:00.000Z')
    expect(parseSegTimestamp('garbage.ts', () => FIXED_NOW))
      .toEqual(FIXED_NOW)
  })

  it('fallback pra agora em nome vazio', () => {
    const FIXED_NOW = new Date('2030-01-01T00:00:00.000Z')
    expect(parseSegTimestamp('', () => FIXED_NOW))
      .toEqual(FIXED_NOW)
  })

  it('NÃO interpreta como fuso local — sempre UTC mesmo se host BRT', () => {
    // Se houvesse bug de fuso, esse seg pareceria 11:30 BRT (UTC-3)
    const d = parseSegTimestamp('20260512_143015.ts')
    expect(d.getUTCHours()).toBe(14)
    expect(d.getUTCMinutes()).toBe(30)
  })

  it('property: round-trip de Date → strftime → parseSegTimestamp = mesmo Date', () => {
    fc.assert(fc.property(
      fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2050-12-31T23:59:59Z') }),
      (date) => {
        // Trunca pra segundo (strftime não tem ms)
        date.setUTCMilliseconds(0)
        const Y = date.getUTCFullYear()
        const M = String(date.getUTCMonth() + 1).padStart(2, '0')
        const D = String(date.getUTCDate()).padStart(2, '0')
        const h = String(date.getUTCHours()).padStart(2, '0')
        const m = String(date.getUTCMinutes()).padStart(2, '0')
        const s = String(date.getUTCSeconds()).padStart(2, '0')
        const name = `${Y}${M}${D}_${h}${m}${s}.ts`
        const parsed = parseSegTimestamp(name)
        expect(parsed.getTime()).toBe(date.getTime())
      },
    ), { numRuns: 300 })
  })
})
