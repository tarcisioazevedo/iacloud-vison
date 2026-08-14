/**
 * BookmarkPicker — modal de criação/edição de bookmark.
 *
 * Modo criação: passa `defaultStartAt`/`defaultEndAt`. Modo edição: passa `initial`
 * (com id; é o que diferencia).
 *
 * Form:
 *   - Title (required)
 *   - Color (palette de 8 cores)
 *   - Start datetime (required)
 *   - End datetime (optional)
 *   - Notes (textarea)
 *   - Botões: Salvar / Excluir (só edição) / Cancelar
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bookmark as BookmarkIcon, X, Save, Trash2, AlertTriangle } from 'lucide-react'
import {
  createBookmark, updateBookmark, deleteBookmark,
  type Bookmark,
  formatApiError,
} from '../../api/client'
import { cn } from '../../lib/utils'
import { confirm } from '../ConfirmDialog'

export interface BookmarkPickerProps {
  cameraId: string
  /** Se passado (com id), modo edição. */
  initial?: Partial<Bookmark>
  defaultStartAt: Date
  defaultEndAt?: Date
  onSaved: (b: Bookmark) => void
  onClose: () => void
}

const COLOR_PALETTE: { name: string; hex: string }[] = [
  { name: 'Amarelo',  hex: '#facc15' },
  { name: 'Laranja',  hex: '#fb923c' },
  { name: 'Vermelho', hex: '#ef4444' },
  { name: 'Rosa',     hex: '#ec4899' },
  { name: 'Violeta',  hex: '#a78bfa' },
  { name: 'Azul',     hex: '#3b82f6' },
  { name: 'Ciano',    hex: '#00C0D0' },
  { name: 'Verde',    hex: '#22c55e' },
]

/** Converte Date → string yyyy-MM-ddThh:mm (formato do <input type=datetime-local>). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Inversa: string local → Date. */
function fromLocalInput(s: string): Date {
  return new Date(s)
}

export function BookmarkPicker({
  cameraId,
  initial,
  defaultStartAt,
  defaultEndAt,
  onSaved,
  onClose,
}: BookmarkPickerProps) {
  const isEdit = !!initial?.id

  const [title, setTitle] = useState(initial?.title ?? '')
  const [color, setColor] = useState(initial?.color ?? COLOR_PALETTE[0].hex)
  const [startStr, setStartStr] = useState(
    toLocalInput(initial?.startAt ? new Date(initial.startAt) : defaultStartAt),
  )
  const [endStr, setEndStr] = useState(
    initial?.endAt
      ? toLocalInput(new Date(initial.endAt))
      : defaultEndAt ? toLocalInput(defaultEndAt) : '',
  )
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Auto-foco no input título
  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.getElementById('bookmark-picker-title') as HTMLInputElement | null
      el?.focus()
      el?.select()
    }, 50)
    return () => clearTimeout(t)
  }, [])

  // ESC fecha
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSave() {
    setErr(null)
    if (!title.trim()) { setErr('Informe um título'); return }
    if (!startStr) { setErr('Informe o horário inicial'); return }

    const startAt = fromLocalInput(startStr)
    const endAt = endStr ? fromLocalInput(endStr) : null
    if (endAt && endAt.getTime() < startAt.getTime()) {
      setErr('Horário final precisa ser após o inicial')
      return
    }

    setSaving(true)
    try {
      let saved: Bookmark
      if (isEdit && initial?.id) {
        saved = await updateBookmark(initial.id, {
          title: title.trim(),
          color,
          startAt,
          endAt: endAt ?? null,
          notes: notes.trim() || null,
        })
      } else {
        saved = await createBookmark({
          cameraId,
          title: title.trim(),
          color,
          startAt,
          endAt: endAt ?? null,
          notes: notes.trim() || null,
          segmentId: initial?.segmentId ?? null,
        })
      }
      onSaved(saved)
      onClose()
    } catch (e: unknown) {
      setErr(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!initial?.id) return
    const ok = await confirm({
      title: 'Excluir este bookmark?',
      destructive: true,
      confirmLabel: 'Excluir',
    })
    if (!ok) return
    setErr(null)
    setDeleting(true)
    try {
      await deleteBookmark(initial.id)
      onClose()
    } catch (e: unknown) {
      setErr(formatApiError(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BookmarkIcon
                className="w-4 h-4"
                style={{ color, fill: color }}
              />
              <h3 className="font-bold text-slate-900 dark:text-white">
                {isEdit ? 'Editar bookmark' : 'Novo bookmark'}
              </h3>
            </div>
            <button onClick={onClose} aria-label="Fechar">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          {/* Título */}
          <label className="block mb-3">
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              Título
            </span>
            <input
              id="bookmark-picker-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Pessoa entrando após o expediente"
              maxLength={120}
              className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white"
            />
          </label>

          {/* Color palette */}
          <div className="mb-3">
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              Cor
            </span>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setColor(c.hex)}
                  title={c.name}
                  className={cn(
                    'w-7 h-7 rounded-full transition border-2',
                    color === c.hex
                      ? 'border-slate-900 dark:border-white scale-110'
                      : 'border-transparent hover:scale-105',
                  )}
                  style={{ background: c.hex }}
                />
              ))}
            </div>
          </div>

          {/* Datas */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                Início
              </span>
              <input
                type="datetime-local"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                Fim (opcional)
              </span>
              <input
                type="datetime-local"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white"
              />
            </label>
          </div>

          {/* Notes */}
          <label className="block mb-3">
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              Notas
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Contexto, ação a tomar, etc."
              className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white resize-none"
            />
          </label>

          {err && (
            <p className="text-xs text-rose-500 mb-3 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {err}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 mt-2">
            <div>
              {isEdit && (
                <button
                  onClick={handleDelete}
                  disabled={deleting || saving}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Excluir
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={saving || deleting}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || deleting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
