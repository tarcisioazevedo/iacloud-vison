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
 *
 * NOTA DE FUSO: ffmpeg usa C strftime() que lê TZ do env. O Alpine Linux
 * base NÃO tem tzdata instalado → TZ env é ignorado pelo C runtime → ffmpeg
 * SEMPRE gera filenames em UTC, independente do TZ do container.
 * Por isso o 'Z' é NECESSÁRIO: força parsing como UTC, evitando dupla
 * subtração (filename já é UTC, sem Z V8 subtrai offset local = -3h a mais).
 * storagePath usa getHours() (hora LOCAL) separadamente, não depende daqui.
 */
export function parseSegTimestamp(
  filename: string,
  nowFactory: () => Date = () => new Date(),
): Date {
  const m = filename.match(STRFTIME_RE)
  if (!m) return nowFactory()
  // 'Z' obrigatório: ffmpeg Alpine sempre gera UTC (sem tzdata no sistema)
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
}
