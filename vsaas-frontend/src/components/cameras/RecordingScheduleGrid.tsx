/**
 * RecordingScheduleGrid — grade visual 7×24 (dias × horas) para configurar
 * o modo de gravação por faixa horária. Click+drag pinta múltiplas células.
 *
 * Modos: ALWAYS (verde) · MOTION (amarelo) · EVENT (laranja)
 *        MOTION_AND_EVENT (violeta) · DISABLED (cinza)
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, Save, AlertCircle, CheckCircle2, Trash2, Eraser, Paintbrush,
} from 'lucide-react'
import {
  useRecordingSchedule, saveRecordingSchedule, clearRecordingSchedule,
  formatApiError,
  type RecordingScheduleMode, type RecordingScheduleEntry,
} from '../../api/client'
import { confirm } from '../ConfirmDialog'

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const
const HOURS = Array.from({ length: 24 }, (_, i) => i)

const MODE_META: Record<RecordingScheduleMode, { label: string; bg: string; fg: string }> = {
  ALWAYS:           { label: 'Sempre',  bg: 'bg-emerald-500', fg: 'text-emerald-700 dark:text-emerald-300' },
  MOTION:           { label: 'Motion',  bg: 'bg-amber-500',   fg: 'text-amber-700 dark:text-amber-300' },
  EVENT:            { label: 'Evento',  bg: 'bg-orange-500',  fg: 'text-orange-700 dark:text-orange-300' },
  MOTION_AND_EVENT: { label: 'M + E',   bg: 'bg-violet-500',  fg: 'text-violet-700 dark:text-violet-300' },
  DISABLED:         { label: 'OFF',     bg: 'bg-slate-300 dark:bg-slate-700', fg: 'text-slate-600 dark:text-slate-400' },
}

interface Props { cameraId: string }

// Matriz 7×24 → modo por célula. Default DISABLED (sem agendamento).
type Grid = RecordingScheduleMode[][]

function emptyGrid(): Grid {
  return Array.from({ length: 7 }, () => Array(24).fill('DISABLED' as RecordingScheduleMode))
}

/**
 * Converte entries do backend (faixas hourStart-hourEnd) para grid de células.
 * Cada entry expande de hourStart até hourEnd-1.
 */
function entriesToGrid(entries: RecordingScheduleEntry[]): Grid {
  const grid = emptyGrid()
  for (const e of entries) {
    const days = e.dayOfWeek === 7 ? [0, 1, 2, 3, 4, 5, 6] : [e.dayOfWeek]
    for (const d of days) {
      for (let h = e.hourStart; h < Math.min(e.hourEnd, 24); h++) {
        if (d >= 0 && d < 7 && h >= 0 && h < 24) grid[d][h] = e.mode
      }
    }
  }
  return grid
}

/**
 * Compacta a grid em entries. Para cada dia, varre horas e cria 1 entry por
 * faixa contígua de mesmo modo (skipping DISABLED para reduzir payload).
 */
function gridToEntries(grid: Grid): Omit<RecordingScheduleEntry, 'id'>[] {
  const entries: Omit<RecordingScheduleEntry, 'id'>[] = []
  for (let d = 0; d < 7; d++) {
    let h = 0
    while (h < 24) {
      if (grid[d][h] === 'DISABLED') { h++; continue }
      const mode = grid[d][h]
      let end = h + 1
      while (end < 24 && grid[d][end] === mode) end++
      entries.push({ dayOfWeek: d, hourStart: h, hourEnd: end, mode })
      h = end
    }
  }
  return entries
}

export function RecordingScheduleGrid({ cameraId }: Props) {
  const { data, isLoading, mutate } = useRecordingSchedule(cameraId)
  const [grid, setGrid] = useState<Grid>(emptyGrid)
  const [activeMode, setActiveMode] = useState<RecordingScheduleMode>('ALWAYS')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // Painting state
  const isPaintingRef = useRef(false)
  const paintModeRef = useRef<RecordingScheduleMode>('ALWAYS')

  useEffect(() => {
    if (data?.entries) {
      setGrid(entriesToGrid(data.entries))
      setDirty(false)
    }
  }, [data])

  // Encerra paint global no mouseup (se soltar fora da grid)
  useEffect(() => {
    const onUp = () => { isPaintingRef.current = false }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  function paint(d: number, h: number, mode: RecordingScheduleMode) {
    setGrid(prev => {
      if (prev[d][h] === mode) return prev
      const next = prev.map(row => [...row]) as Grid
      next[d][h] = mode
      return next
    })
    setDirty(true)
    setFeedback(null)
  }

  function fillRow(d: number) {
    setGrid(prev => {
      const next = prev.map(row => [...row]) as Grid
      next[d] = Array(24).fill(activeMode)
      return next
    })
    setDirty(true)
  }

  function fillCol(h: number) {
    setGrid(prev => {
      const next = prev.map(row => [...row]) as Grid
      for (let d = 0; d < 7; d++) next[d][h] = activeMode
      return next
    })
    setDirty(true)
  }

  function fillAll() {
    setGrid(Array.from({ length: 7 }, () => Array(24).fill(activeMode)) as Grid)
    setDirty(true)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setFeedback(null)
    try {
      const entries = gridToEntries(grid)
      await saveRecordingSchedule(cameraId, entries)
      await mutate()
      setDirty(false)
      setFeedback(`Agendamento salvo (${entries.length} faixa${entries.length === 1 ? '' : 's'})`)
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    const ok = await confirm({
      title: 'Limpar todo o agendamento?',
      description: 'Toda a configuração de gravação desta câmera será removida.',
      destructive: true,
      confirmLabel: 'Limpar',
    })
    if (!ok) return
    setSaving(true)
    try {
      await clearRecordingSchedule(cameraId)
      setGrid(emptyGrid())
      await mutate()
      setDirty(false)
      setFeedback('Agendamento limpo')
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  // Stats — quantas células de cada modo
  const stats = useMemo(() => {
    const counts: Record<RecordingScheduleMode, number> = {
      ALWAYS: 0, MOTION: 0, EVENT: 0, MOTION_AND_EVENT: 0, DISABLED: 0,
    }
    for (const row of grid) for (const m of row) counts[m]++
    return counts
  }, [grid])

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
            Agendamento de Gravação
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-500 mt-0.5">
            Defina o modo por faixa de hora e dia da semana — clique e arraste para pintar
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleClear}
            disabled={saving || isLoading}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 flex items-center gap-1 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Limpar tudo
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="px-3 py-1.5 text-xs rounded-lg bg-cyan-500 text-white hover:bg-cyan-600 flex items-center gap-1 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar {dirty && '*'}
          </button>
        </div>
      </div>

      {/* Feedback */}
      {error && (
        <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}
      {feedback && (
        <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {feedback}
        </div>
      )}

      {/* Toolbar — modo ativo (cor de pintura) */}
      <div className="flex items-center gap-2 flex-wrap p-2 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10">
        <Paintbrush className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Pincel:</span>
        {(Object.keys(MODE_META) as RecordingScheduleMode[]).map(m => (
          <button
            key={m}
            onClick={() => setActiveMode(m)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition flex items-center gap-1.5 border ${
              activeMode === m
                ? 'border-cyan-500 ring-2 ring-cyan-500/30 bg-white dark:bg-white/5'
                : 'border-transparent hover:bg-white/50 dark:hover:bg-slate-50 dark:bg-white/5'
            } ${MODE_META[m].fg}`}
          >
            <span className={`w-3 h-3 rounded-sm ${MODE_META[m].bg}`} />
            {MODE_META[m].label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-slate-400 flex items-center gap-1">
          <Eraser className="w-3 h-3" /> Use o pincel <strong>OFF</strong> para apagar
        </span>
      </div>

      {/* Grade 7×24 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando agendamento…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[10px] select-none">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white dark:bg-space-900 z-10 w-12"></th>
                {HOURS.map(h => (
                  <th
                    key={h}
                    onClick={() => fillCol(h)}
                    title={`Pintar coluna ${h}h com ${MODE_META[activeMode].label}`}
                    className="px-0.5 py-1 font-mono text-slate-400 dark:text-slate-500 hover:text-cyan-500 cursor-pointer"
                  >
                    {h.toString().padStart(2, '0')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, d) => (
                <tr key={day}>
                  <th
                    onClick={() => fillRow(d)}
                    title={`Pintar ${day} com ${MODE_META[activeMode].label}`}
                    className="sticky left-0 bg-white dark:bg-space-900 z-10 w-12 px-2 py-1 text-right font-semibold text-slate-500 dark:text-slate-400 hover:text-cyan-500 cursor-pointer"
                  >
                    {day}
                  </th>
                  {HOURS.map(h => {
                    const cellMode = grid[d][h]
                    return (
                      <td
                        key={h}
                        onMouseDown={e => {
                          e.preventDefault()
                          isPaintingRef.current = true
                          paintModeRef.current = activeMode
                          paint(d, h, activeMode)
                        }}
                        onMouseEnter={() => {
                          if (isPaintingRef.current) paint(d, h, paintModeRef.current)
                        }}
                        title={`${day} ${h}h — ${MODE_META[cellMode].label}`}
                        className={`h-6 cursor-pointer transition border border-white dark:border-space-900 ${MODE_META[cellMode].bg} ${
                          cellMode === 'DISABLED' ? 'opacity-50 hover:opacity-80' : 'hover:brightness-110'
                        }`}
                      />
                    )
                  })}
                </tr>
              ))}
              {/* Linha "Todos os dias" */}
              <tr>
                <th
                  onClick={fillAll}
                  title={`Pintar tudo com ${MODE_META[activeMode].label}`}
                  className="sticky left-0 bg-cyan-50 dark:bg-cyan-500/10 z-10 w-12 px-2 py-1 text-right text-[9px] font-bold text-cyan-700 dark:text-cyan-400 hover:text-cyan-600 cursor-pointer"
                >
                  TODOS
                </th>
                <td colSpan={24} className="text-center text-[9px] text-slate-400 italic py-1">
                  Clique aqui para preencher toda a grade · clique no nome do dia/coluna para pintar a linha/coluna
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-3 text-[10px] text-slate-500 flex-wrap">
        <span className="font-semibold uppercase tracking-wider">Total horas:</span>
        {(Object.keys(MODE_META) as RecordingScheduleMode[]).filter(m => stats[m] > 0).map(m => (
          <span key={m} className="flex items-center gap-1">
            <span className={`w-2.5 h-2.5 rounded-sm ${MODE_META[m].bg}`} />
            {MODE_META[m].label}: <strong>{stats[m]}h</strong>
          </span>
        ))}
        {stats.DISABLED === 168 && (
          <span className="text-amber-500">Nenhuma faixa configurada — câmera grava conforme <code>recordMode</code> padrão</span>
        )}
      </div>
    </div>
  )
}
