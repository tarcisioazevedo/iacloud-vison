/**
 * clock-skew — defesa contra timestamps com drift do edge box.
 *
 * Extraído de routes/iacv-box-segments.ts em 2026-05-12 (Sprint γ-Day1)
 * pra ganhar testabilidade unitária via Vitest + fast-check.
 *
 * Política:
 *   - skew futuro >5min → reject (clock pra frente é sempre suspeito)
 *   - skew passado >15min → reescreve startedAt pra now-durationSec
 *   - skew passado 5-15min → log warn, aceita timestamp original
 *   - skew <5min em qualquer direção → aceita silenciosamente
 *
 * Por que reescrever em vez de rejeitar passado:
 *   Durante deploy multi-cliente não podemos derrubar gravação porque o
 *   box do cliente tá com NTP off. Melhor salvar com timestamp aproximado
 *   do server (visível na timeline) e alertar via log pro suporte pedir
 *   ajuste de hora no box.
 *
 * Refs:
 *   - Sintoma observado em prod (commit d7ea6ed9)
 *   - Sprite analog: lib/sprite-clock-skew.ts (mesma lógica, day/hour recomputo)
 */

export const MAX_SKEW_FUTURE_MS    = 5 * 60_000
export const MAX_SKEW_PAST_WARN_MS = 5 * 60_000
export const REWRITE_PAST_AFTER_MS = 15 * 60_000

export type ClockSkewResult =
  | { kind: 'ok';         normalized: Date }
  | { kind: 'warn';       normalized: Date; skewSec: number }
  | { kind: 'rewritten';  normalized: Date; skewSec: number; original: Date }
  | { kind: 'reject';     reasonSec: number }

/**
 * Pura. Não loga, não throws — devolve `ClockSkewResult` discriminado.
 * Caller decide o que fazer com `reject` (HTTP 400) e `rewritten` (logger.warn).
 *
 * @param claimedStartedAtIso  ISO string vinda do box
 * @param durationSec          duração reportada do segment
 * @param nowMs                Date.now() injetável (pra testar sem mockar relógio)
 */
export function classifyClockSkew(
  claimedStartedAtIso: string,
  durationSec: number,
  nowMs: number = Date.now(),
): ClockSkewResult {
  const claimed = new Date(claimedStartedAtIso)
  if (isNaN(claimed.getTime())) {
    return { kind: 'reject', reasonSec: 0 }
  }
  const skewMs = nowMs - claimed.getTime()

  // Futuro >5min: rejeita
  if (skewMs < -MAX_SKEW_FUTURE_MS) {
    return { kind: 'reject', reasonSec: Math.round(-skewMs / 1000) }
  }

  // Passado >15min: reescreve pra now - durationSec
  if (skewMs > REWRITE_PAST_AFTER_MS) {
    return {
      kind:        'rewritten',
      normalized:  new Date(nowMs - durationSec * 1000),
      skewSec:     Math.round(skewMs / 1000),
      original:    claimed,
    }
  }

  // Passado 5-15min: warn, mantém original
  if (skewMs > MAX_SKEW_PAST_WARN_MS) {
    return {
      kind:       'warn',
      normalized: claimed,
      skewSec:    Math.round(skewMs / 1000),
    }
  }

  // Drift aceitável (<5min em qualquer direção)
  return { kind: 'ok', normalized: claimed }
}
