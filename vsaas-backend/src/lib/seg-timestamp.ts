/**
 * seg-timestamp — parseia nome de arquivo strftime gerado pelo ffmpeg
 * em UTC Date.
 *
 * Formato do filename (ffmpeg `-strftime 1 -segment_format mpegts`):
 *
 *     YYYYMMDD_HHMMSS[.ts|_<uuid>.ts]
 *
 * Ex:  20260512_143015.ts
 *      20260512_143015_a32e8321-6a00-4f2e.ts (após rename canonical)
 *
 * Sprint γ-Day1 (2026-05-12): extraído de cloud-direct-recorder pra
 * testabilidade unitária. Comportamento mantido idêntico, incluindo o
 * fallback `new Date()` quando o nome não bate o pattern.
 */

const STRFTIME_RE = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/

/**
 * Pura. `nowFactory` injetável pra reprodutibilidade nos testes do fallback.
 */
export function parseSegTimestamp(
  filename: string,
  nowFactory: () => Date = () => new Date(),
): Date {
  const m = filename.match(STRFTIME_RE)
  if (!m) return nowFactory()
  // ISO 8601 com Z → forçar UTC parsing sem ambiguidade de fuso local
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
}
