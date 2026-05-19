/** Dispara vibração tátil se o browser suportar. */
export function haptic(ms: number | number[] = 50) {
  try { navigator.vibrate?.(ms) } catch { /* ignore */ }
}
