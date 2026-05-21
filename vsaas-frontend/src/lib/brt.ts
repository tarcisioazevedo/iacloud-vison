/**
 * brt.ts — formatação de datas/horas SEMPRE em fuso BRT (America/Sao_Paulo).
 *
 * Por quê: produto BR-only, mas browsers podem estar com fuso errado
 * (VPN, container, config incorreta). Forçar BRT garante que síndico,
 * gerente e operador vejam sempre a mesma hora, independente de onde
 * acessam.
 *
 * Substitui chamadas diretas a `toLocaleString('pt-BR')` e similares.
 *
 * Uso:
 *   import { brtTime, brtDateTime, brtSecOfDay } from '../lib/brt'
 *   brtTime(date)        // "13:40:09"
 *   brtDateTime(date)    // "21/05/2026 13:40"
 *   brtSecOfDay(date)    // 49209  (segundos desde meia-noite BRT)
 */

export const BRT_TZ = 'America/Sao_Paulo'

function fmt(d: Date | number | string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  if (d == null) return ''
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', { timeZone: BRT_TZ, ...opts }).format(date)
}

/** "13:40:09" */
export function brtTime(d: Date | number | string | null | undefined): string {
  return fmt(d, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/** "13:40" (sem segundos) */
export function brtTimeShort(d: Date | number | string | null | undefined): string {
  return fmt(d, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "21/05/2026" */
export function brtDate(d: Date | number | string | null | undefined): string {
  return fmt(d, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** "21/05/2026 13:40" */
export function brtDateTime(d: Date | number | string | null | undefined): string {
  return fmt(d, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** "21/05/2026 13:40:09" (com segundos) */
export function brtDateTimeFull(d: Date | number | string | null | undefined): string {
  return fmt(d, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

/** "21 mai 2026" */
export function brtDateLong(d: Date | number | string | null | undefined): string {
  return fmt(d, { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Componentes BRT (substitui d.getHours/getDate/etc) ─────────────────────

interface BrtParts {
  year: number
  month: number  // 1-12 (não 0-11)
  day: number
  hour: number
  minute: number
  second: number
}

/**
 * Retorna os componentes (ano, mês, dia, hora, min, seg) da data em BRT.
 * Use no lugar de d.getFullYear()/getMonth()/etc quando precisar dos valores
 * BRT em vez do fuso do browser.
 */
export function brtParts(d: Date | number | string): BrtParts {
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
  return {
    year:   get('year'),
    month:  get('month'),
    day:    get('day'),
    // Intl pode retornar "24" para meia-noite — normaliza para 0.
    hour:   get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

/** "YYYY-MM-DD" da data em BRT (substitui isoDate/todayLocalIso). */
export function brtIsoDate(d: Date | number | string = new Date()): string {
  const p = brtParts(d)
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`
}

/** Hoje em BRT como "YYYY-MM-DD". */
export function brtToday(): string {
  return brtIsoDate(new Date())
}

/** Segundos desde meia-noite BRT (0..86399). Substitui localSecOfDay. */
export function brtSecOfDay(d: Date | number | string): number {
  const p = brtParts(d)
  return p.hour * 3600 + p.minute * 60 + p.second
}

/**
 * Epoch ms da meia-noite BRT para um dia "YYYY-MM-DD".
 * BRT é UTC-3 fixo desde 2019 (sem DST). Meia-noite BRT = 03:00 UTC.
 * Substitui localDayStartMs.
 */
export function brtDayStartMs(isoDay: string): number {
  return Date.parse(`${isoDay}T03:00:00.000Z`)
}

/** Shift de dia BRT (substitui shiftDay). */
export function brtShiftDay(isoDay: string, delta: number): string {
  const d = new Date(`${isoDay}T12:00:00-03:00`)
  d.setDate(d.getDate() + delta)
  return brtIsoDate(d)
}

/** "datetime-local" input value em BRT (sem timezone). */
export function brtDatetimeLocal(d: Date | number | string): string {
  const p = brtParts(d)
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`
}

/** Tempo relativo ("há 3 min", "há 1h"). Útil pra notificações. */
export function brtTimeAgo(d: Date | number | string): string {
  const ms = Date.now() - new Date(d).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 5) return 'agora'
  if (sec < 60) return `há ${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `há ${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `há ${hr}h`
  const d2 = Math.floor(hr / 24)
  return `há ${d2}d`
}
