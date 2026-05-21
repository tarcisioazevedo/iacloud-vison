/**
 * day-utils — helpers de data/hora em fuso BRT (America/Sao_Paulo), FIXO.
 *
 * IMPORTANTE: a partir de 2026-05-21 mudamos de "fuso local do browser" para
 * "BRT fixo" — isso garante que síndico/operador/admin vejam SEMPRE a mesma
 * hora, independente de configuração do browser/VPN/container.
 *
 * Implementação real está em ./brt.ts. Este arquivo é wrapper pra manter
 * compatibilidade com chamadas existentes (RecordingsPage, etc).
 *
 * Regra: gravações são indexadas em UTC no backend (RecordingSegment.startedAt);
 * todas as conversões de "dia" ou "posição na timeline" usam BRT.
 */

import {
  brtIsoDate,
  brtToday,
  brtDayStartMs,
  brtSecOfDay,
  brtShiftDay,
  brtDatetimeLocal,
  brtParts,
} from './brt'

/** Offset BRT em minutos. BRT é UTC-3 fixo (sem DST desde 2019) → -180. */
export function getTzOffsetMin(): number {
  return -180
}

/** Date → "YYYY-MM-DD" em BRT. */
export function isoDate(d: Date): string {
  return brtIsoDate(d)
}

/** Hoje em BRT como "YYYY-MM-DD". */
export function todayLocalIso(): string {
  return brtToday()
}

/** Epoch ms da meia-noite BRT para um dia "YYYY-MM-DD". */
export function localDayStartMs(day: string): number {
  return brtDayStartMs(day)
}

/** Shift de dia em BRT. */
export function shiftDay(day: string, delta: number): string {
  return brtShiftDay(day, delta)
}

/** Segundos desde meia-noite BRT (0..86399). */
export function localSecOfDay(d: Date): number {
  return brtSecOfDay(d)
}

/** Mesma coisa mas a partir de epoch ms. */
export function localSecOfDayMs(epochMs: number): number {
  return brtSecOfDay(epochMs)
}

/** Date → "YYYY-MM-DDTHH:MM" em BRT (para <input type="datetime-local">). */
export function toDatetimeLocal(d: Date): string {
  return brtDatetimeLocal(d)
}

// Re-export pra uso direto.
export { brtParts }
