/**
 * clock-skew unit tests — Sprint γ-Day1 (2026-05-12)
 *
 * Cobre os 4 caminhos de classifyClockSkew + edge cases via fast-check.
 *
 * Bug histórico que estes testes blindam (commit d7ea6ed9):
 *   - Edge box "Lab" enviava segments com startedAt 4h no passado.
 *   - Sem este classify, retention SQL apagava o "passado", playback
 *     "-10s" achava manifest vazio, sprites em hora errada.
 *
 * IDs U01-U03 do plano de QA (camada 17 TDD).
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  classifyClockSkew,
  MAX_SKEW_FUTURE_MS,
  REWRITE_PAST_AFTER_MS,
  MAX_SKEW_PAST_WARN_MS,
} from './clock-skew'

// Fixture: now fixo pra reprodutibilidade. Não usa Date.now() em nenhum lugar.
const NOW_MS = new Date('2026-05-12T12:00:00.000Z').getTime()

function iso(deltaMs: number): string {
  return new Date(NOW_MS + deltaMs).toISOString()
}

describe('classifyClockSkew', () => {
  // ── U01.a — caminho OK ────────────────────────────────────────────────
  it('aceita timestamp dentro de ±5min sem warning', () => {
    expect(classifyClockSkew(iso(0),       6, NOW_MS).kind).toBe('ok')
    expect(classifyClockSkew(iso(-60_000), 6, NOW_MS).kind).toBe('ok')   // 1min passado
    expect(classifyClockSkew(iso(60_000),  6, NOW_MS).kind).toBe('ok')   // 1min futuro
    expect(classifyClockSkew(iso(-4*60_000), 6, NOW_MS).kind).toBe('ok') // 4min passado
  })

  // ── U01.b — caminho warn ──────────────────────────────────────────────
  it('warn quando skew passado entre 5min e 15min', () => {
    const r = classifyClockSkew(iso(-10 * 60_000), 6, NOW_MS)
    expect(r.kind).toBe('warn')
    if (r.kind === 'warn') {
      expect(r.skewSec).toBe(600)
      expect(r.normalized.getTime()).toBe(NOW_MS - 10 * 60_000) // mantém original
    }
  })

  // ── U02 — rewriten path (cenário real do bug) ─────────────────────────
  it('reescreve quando skew passado > 15min (cenário Edge Box "Lab" 4h drift)', () => {
    const FOUR_HOURS = 4 * 60 * 60 * 1000
    const r = classifyClockSkew(iso(-FOUR_HOURS), 10, NOW_MS)
    expect(r.kind).toBe('rewritten')
    if (r.kind === 'rewritten') {
      expect(r.skewSec).toBe(14400)
      expect(r.normalized.getTime()).toBe(NOW_MS - 10_000) // = now - durationSec
      expect(r.original.getTime()).toBe(NOW_MS - FOUR_HOURS)
    }
  })

  // ── U03 — rejection path ──────────────────────────────────────────────
  it('rejeita quando timestamp do futuro > 5min', () => {
    const r = classifyClockSkew(iso(10 * 60_000), 6, NOW_MS)
    expect(r.kind).toBe('reject')
    if (r.kind === 'reject') expect(r.reasonSec).toBe(600)
  })

  it('rejeita ISO string inválido', () => {
    expect(classifyClockSkew('not-a-date',           6, NOW_MS).kind).toBe('reject')
    expect(classifyClockSkew('',                     6, NOW_MS).kind).toBe('reject')
    expect(classifyClockSkew('2026-13-99T99:99:99Z', 6, NOW_MS).kind).toBe('reject')
  })

  // ── Boundary conditions ───────────────────────────────────────────────
  it('boundary: exato 5min futuro é ok (não rejeita)', () => {
    expect(classifyClockSkew(iso(MAX_SKEW_FUTURE_MS), 6, NOW_MS).kind).toBe('ok')
  })

  it('boundary: 5min+1ms futuro é reject', () => {
    expect(classifyClockSkew(iso(MAX_SKEW_FUTURE_MS + 1), 6, NOW_MS).kind).toBe('reject')
  })

  it('boundary: exato 5min passado é ok (não warn)', () => {
    expect(classifyClockSkew(iso(-MAX_SKEW_PAST_WARN_MS), 6, NOW_MS).kind).toBe('ok')
  })

  it('boundary: 15min+1ms passado é rewritten (não warn)', () => {
    const r = classifyClockSkew(iso(-(REWRITE_PAST_AFTER_MS + 1)), 6, NOW_MS)
    expect(r.kind).toBe('rewritten')
  })

  // ── Property-based: invariante de rewritten ───────────────────────────
  it('property: rewritten sempre produz normalized = now - durationSec, qualquer skew >15min', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: REWRITE_PAST_AFTER_MS + 1, max: 24 * 60 * 60_000 }), // 15min..24h
        fc.integer({ min: 1, max: 60 }),                                        // 1..60s
        (skewMs, durationSec) => {
          const r = classifyClockSkew(iso(-skewMs), durationSec, NOW_MS)
          expect(r.kind).toBe('rewritten')
          if (r.kind === 'rewritten') {
            expect(r.normalized.getTime()).toBe(NOW_MS - durationSec * 1000)
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  // ── Property-based: reject futuro nunca produz normalized ─────────────
  it('property: skew futuro >5min nunca produz normalized', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_SKEW_FUTURE_MS + 1, max: 24 * 60 * 60_000 }),
        (skewMs) => {
          const r = classifyClockSkew(iso(skewMs), 6, NOW_MS)
          expect(r.kind).toBe('reject')
          expect((r as any).normalized).toBeUndefined()
        },
      ),
      { numRuns: 200 },
    )
  })
})
