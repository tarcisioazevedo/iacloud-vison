/**
 * day-utils — helpers de data/hora no fuso local do browser.
 *
 * Motivação: gravações são indexadas por UTC no backend (RecordingSegment.startedAt),
 * mas o operador pensa e busca em horário local (BRT = UTC-3). Todas as
 * conversões de "dia" ou "posição na timeline" devem usar horário local
 * para evitar deslocamento de 3h nas telas de revisão.
 *
 * Regra: nenhuma função aqui usa getUTC*() nem strings com sufixo 'Z'
 * para representar limites de dia. Epoch ms (ex: Date.now()) são neutros
 * e podem ser usados livremente.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Offset do browser em minutos (negativo = oeste de UTC). Ex: BRT = -180. */
export function getTzOffsetMin(): number {
  // getTimezoneOffset() retorna +180 para UTC-3 (BRT) — negamos para obter -180.
  return -new Date().getTimezoneOffset()
}

/** Converte Date → YYYY-MM-DD no fuso local do browser. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Data de hoje em YYYY-MM-DD no fuso local do browser. */
export function todayLocalIso(): string {
  return isoDate(new Date())
}

/**
 * Epoch ms da meia-noite LOCAL para um dia YYYY-MM-DD.
 * Usar este valor onde antes havia `new Date(`${day}T00:00:00.000Z`).getTime()`.
 *
 * Ex (BRT, UTC-3): localDayStartMs('2026-05-12')
 *   = new Date('2026-05-12T00:00:00').getTime()
 *   = 2026-05-12T03:00:00Z em epoch ms ✓
 */
export function localDayStartMs(day: string): number {
  return new Date(`${day}T00:00:00`).getTime()  // sem 'Z' → interpreta como local
}

/**
 * Shift de dia: retorna YYYY-MM-DD deslocado por delta dias no fuso local.
 * Usa meio-dia (T12:00:00) como âncora para evitar ambiguidade em DST.
 */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + delta)
  return isoDate(d)
}

/**
 * Segundos desde a meia-noite LOCAL para uma Date. Resultado: 0..86399.
 * Usar onde antes havia `d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()`.
 */
export function localSecOfDay(d: Date): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
}

/**
 * Mesma coisa que `localSecOfDay` mas a partir de um epoch ms.
 * Conveniente para `localSecOfDayMs(Date.now())`.
 */
export function localSecOfDayMs(epochMs: number): number {
  return localSecOfDay(new Date(epochMs))
}

/**
 * Formata uma Date como "YYYY-MM-DDTHH:MM" no fuso local.
 * Valor correto para `<input type="datetime-local">`.
 * Usar onde antes havia `d.toISOString().slice(0, 16)` (que devolve UTC).
 */
export function toDatetimeLocal(d: Date): string {
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
