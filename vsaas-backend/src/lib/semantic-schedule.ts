/**
 * Janela de horário para SemanticRule.
 *
 * Reusa o campo `scheduleCron String?` da tabela (sem migration), mas armazena
 * um JSON estruturado em vez de cron raw — UX muito melhor pra cliente final
 * que não conhece sintaxe cron.
 *
 * Formato persistido:
 *   `{"startHour":22,"endHour":6,"days":[1,2,3,4,5]}`
 *
 *   - startHour, endHour: 0..23 (hora local BRT)
 *   - days: 0=Domingo .. 6=Sábado (padrão JavaScript getDay())
 *   - Quando startHour > endHour → janela cruza meia-noite (ex.: 22h–06h)
 *   - null/undefined no campo do DB → regra sempre ativa (legacy)
 *
 * Backward-compat: se o conteúdo NÃO for JSON válido, ignora silenciosamente
 * (regras antigas com cron raw continuam sem janela, sem quebrar).
 */
import { z } from 'zod'

export const ScheduleWindowSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour:   z.number().int().min(0).max(23),
  days:      z.array(z.number().int().min(0).max(6)).min(1).max(7),
})
export type ScheduleWindow = z.infer<typeof ScheduleWindowSchema>

/** Serializa pra string. Retorna null se window for null/undefined. */
export function serializeSchedule(window: ScheduleWindow | null | undefined): string | null {
  if (!window) return null
  return JSON.stringify(window)
}

/** Parseia string do DB. Retorna null se for null, vazio ou inválido. */
export function parseSchedule(raw: string | null | undefined): ScheduleWindow | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const ok = ScheduleWindowSchema.safeParse(parsed)
    return ok.success ? ok.data : null
  } catch {
    return null // legacy cron raw — sem janela
  }
}

/**
 * Checa se `now` está dentro da janela.
 * Compara em horário BRT (America/Sao_Paulo) — mesmo TZ usado no resto do
 * sistema (notification-dispatcher etc.).
 */
export function isInsideSchedule(window: ScheduleWindow, now: Date = new Date()): boolean {
  // Converte para BRT extraindo componentes via toLocaleString
  const brtString = now.toLocaleString('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
  })
  // brtString: "Wed, 23"  (weekday curto + hora 2 dígitos)
  // Extrai weekday e hora separadamente — mais seguro com regex
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  const match = brtString.match(/^(\w+),\s*(\d{2})$/)
  if (!match) return true // fallback: deixa passar se parse falhar
  const dow = dowMap[match[1]]
  const hour = parseInt(match[2], 10)
  if (dow === undefined || Number.isNaN(hour)) return true

  if (!window.days.includes(dow)) return false

  if (window.startHour <= window.endHour) {
    // Janela "normal" (ex.: 08–18) — hora deve estar entre start (inclusivo) e end (exclusivo)
    return hour >= window.startHour && hour < window.endHour
  } else {
    // Janela cruzando meia-noite (ex.: 22–06) — hora >= start OU hora < end
    return hour >= window.startHour || hour < window.endHour
  }
}
