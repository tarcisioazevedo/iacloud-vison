/**
 * Recording Effective Mode Service — resolve o modo de gravação que está
 * em vigor para uma câmera num dado momento, considerando o RecordingSchedule
 * (faixas semanais por dia/hora) sobre o `Camera.recordMode` default.
 *
 * Política:
 *   1. Lê RecordingSchedule para a câmera.
 *      - Se houver entrada cobrindo (dayOfWeek, hour) atual: usa o `mode` dela.
 *      - Mapeamento Schedule.mode → RecordingMode efetivo:
 *          ALWAYS            → ALL
 *          MOTION            → MOTION
 *          EVENT             → MOTION   (event-only é tratado downstream pelo motion-gate)
 *          MOTION_AND_EVENT  → MOTION
 *          DISABLED          → DISABLED
 *   2. Se NENHUMA entrada cobre o momento: usa `Camera.recordMode` (fallback).
 *      → Se cliente NÃO configurou nenhuma faixa, gravação segue o modo default
 *        (back-compat). Se configurou ao menos uma faixa, ranges fora dela
 *        viram DISABLED automaticamente (Schedule é "lista permissiva" quando
 *        existe).
 *
 * Sem cache em memória — query é simples, indexada, e cron/reconcile rodam a
 * cada 30s no máximo. Cache aqui só introduziria stale state.
 */
import { prisma } from '../lib/prisma'

/** Retorna hora local (0-23) e dia da semana local (0=Dom..6=Sáb) no timezone da câmera. */
function localHourDow(date: Date, timezone: string): { hour: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour:    'numeric',
    hour12:  false,
  }).formatToParts(date)
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
  const dowStr = parts.find(p => p.type === 'weekday')?.value ?? 'Sun'
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { hour, dow: DOW[dowStr] ?? 0 }
}

export type EffectiveRecordingMode = 'ALL' | 'MOTION' | 'ACTIVE_OBJECTS' | 'DISABLED'

export interface EffectiveModeContext {
  /** Recordings ON neste momento? Resultado short-circuit pra supervisores. */
  shouldRecord: boolean
  /** Modo efetivo final (após resolução de schedule). */
  effective:    EffectiveRecordingMode
  /** Modo configurado base (Camera.recordMode). */
  baseMode:     EffectiveRecordingMode
  /** Schedule encontrado pra hora atual (null = nenhum). */
  matchedScheduleEntry: {
    dayOfWeek: number
    hourStart: number
    hourEnd:   number
    mode:      string
  } | null
  /** True quando a câmera tem ao menos 1 faixa de schedule configurada. */
  hasSchedule:  boolean
}

const SCHEDULE_TO_RECORDING: Record<string, EffectiveRecordingMode> = {
  ALWAYS:            'ALL',
  MOTION:            'MOTION',
  EVENT:             'MOTION',
  MOTION_AND_EVENT:  'MOTION',
  DISABLED:          'DISABLED',
}

interface ResolvedCameraInput {
  recordEnabled: boolean
  recordMode:    EffectiveRecordingMode
}

export async function getEffectiveRecordingMode(
  cameraId: string,
  at: Date = new Date(),
  cameraOverride?: ResolvedCameraInput,
): Promise<EffectiveModeContext> {
  const cam = cameraOverride ?? await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { recordEnabled: true, recordMode: true },
  })

  const baseMode = (cam?.recordMode as EffectiveRecordingMode) ?? 'DISABLED'

  if (!cam || !cam.recordEnabled || baseMode === 'DISABLED') {
    return {
      shouldRecord: false,
      effective:    'DISABLED',
      baseMode,
      matchedScheduleEntry: null,
      hasSchedule:  false,
    }
  }

  // Lê todas as entradas de schedule da câmera (limite implícito 168 entradas).
  // Filtra client-side pra preferir dia específico antes de "todos os dias" (7).
  const entries = await prisma.recordingSchedule.findMany({
    where: { cameraId },
    select: { dayOfWeek: true, hourStart: true, hourEnd: true, mode: true },
  })

  const hasSchedule = entries.length > 0
  if (!hasSchedule) {
    return {
      shouldRecord: true,
      effective:    baseMode,
      baseMode,
      matchedScheduleEntry: null,
      hasSchedule:  false,
    }
  }

  // Resolve o timezone da câmera (ClienteFinal → timezone IANA).
  // As horas do schedule são armazenadas em horário local do operador.
  const tzRow = await prisma.camera.findUnique({
    where:  { id: cameraId },
    select: { site: { select: { clienteFinal: { select: { timezone: true } } } } },
  })
  const timezone = tzRow?.site?.clienteFinal?.timezone ?? 'America/Sao_Paulo'
  const { hour, dow } = localHourDow(at, timezone)

  // Match: dayOfWeek do dia OU 7 (todos), e hora dentro de [hourStart, hourEnd).
  // Preferência: entrada com dayOfWeek específico antes da entrada de "7".
  const candidates = entries
    .filter(e => (e.dayOfWeek === dow || e.dayOfWeek === 7))
    .filter(e => hour >= e.hourStart && hour < e.hourEnd)
    .sort((a, b) => {
      if (a.dayOfWeek === b.dayOfWeek) return b.hourStart - a.hourStart
      return a.dayOfWeek === 7 ? 1 : -1
    })

  const matched = candidates[0] ?? null

  if (!matched) {
    // Câmera tem schedule mas momento atual não é coberto → DISABLED.
    return {
      shouldRecord: false,
      effective:    'DISABLED',
      baseMode,
      matchedScheduleEntry: null,
      hasSchedule:  true,
    }
  }

  const fromSchedule = SCHEDULE_TO_RECORDING[matched.mode] ?? baseMode
  return {
    shouldRecord: fromSchedule !== 'DISABLED',
    effective:    fromSchedule,
    baseMode,
    matchedScheduleEntry: matched,
    hasSchedule:  true,
  }
}
