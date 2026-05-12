/**
 * ExportRangeModal — modal que dispara POST /exports/recording.
 *
 * Recebe cameraId + range default (do dia visualizado), permite refinar
 * janela com inputs de hora, aciona o job, e devolve o jobId pro caller
 * abrir ExportProgressModal.
 *
 * Limites do backend (routes/exports.ts):
 *   - Range máximo: 6h (validação backend)
 *   - includeCertificate default true (anexa MediaCertificate assinado)
 */
import { useState } from 'react'
import { Loader2, Download, X, ShieldCheck, AlertTriangle } from 'lucide-react'
import { api, formatApiError } from '../../api/client'

interface Props {
  cameraId:    string
  cameraName?: string
  dayUtc:      string          // YYYY-MM-DD
  /** Range inicial em segundos desde meia-noite UTC (do scrubber atual). */
  defaultStartSec?: number
  defaultEndSec?:   number
  onJobCreated: (jobId: string) => void
  onClose:      () => void
}

function secToHhMm(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function hhMmToSec(hhMm: string): number {
  const [h, m] = hhMm.split(':').map(Number)
  return (h || 0) * 3600 + (m || 0) * 60
}

export function ExportRangeModal({
  cameraId, cameraName, dayUtc,
  defaultStartSec = 0, defaultEndSec = 600,
  onJobCreated, onClose,
}: Props) {
  // Defaults: 10min começando no ponto atual do scrubber
  const [startHhMm, setStartHhMm] = useState(secToHhMm(defaultStartSec))
  const [endHhMm, setEndHhMm]     = useState(secToHhMm(Math.min(defaultEndSec, defaultStartSec + 600)))
  const [includeCert, setIncludeCert] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startSec = hhMmToSec(startHhMm)
  const endSec   = hhMmToSec(endHhMm)
  const rangeSec = endSec - startSec
  const rangeMin = Math.round(rangeSec / 60)
  const overMax  = rangeSec > 6 * 3600
  const invalid  = endSec <= startSec || overMax

  async function submit() {
    if (invalid) return
    setSubmitting(true)
    setError(null)
    try {
      const fromIso = `${dayUtc}T${startHhMm}:00.000Z`
      const toIso   = `${dayUtc}T${endHhMm}:00.000Z`
      const r = await api.post('/exports/recording', {
        cameraId,
        from: fromIso,
        to:   toIso,
        includeCertificate: includeCert,
      })
      if (r.data?.jobId) {
        onJobCreated(r.data.jobId)
        onClose()
      } else {
        setError('Backend não retornou jobId')
      }
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl border border-cyan-500/30 dark:border-cyan-500/30 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Download className="w-4 h-4 text-cyan-500" />
              Exportar trecho da gravação
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {cameraName ? `${cameraName} · ` : ''}{dayUtc}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Início (UTC)</span>
              <input
                type="time"
                value={startHhMm}
                onChange={e => setStartHhMm(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 rounded border bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500/50"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Fim (UTC)</span>
              <input
                type="time"
                value={endHhMm}
                onChange={e => setEndHhMm(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 rounded border bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500/50"
              />
            </label>
          </div>

          {/* Duração */}
          <div className={
            invalid
              ? 'p-2.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 flex items-start gap-2'
              : 'p-2.5 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/30 flex items-start gap-2'
          }>
            {invalid
              ? <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              : <Download className="w-4 h-4 text-cyan-500 shrink-0 mt-0.5" />}
            <div className="text-xs">
              {endSec <= startSec ? (
                <p className="text-rose-600 dark:text-rose-300">Hora final deve ser depois da inicial</p>
              ) : overMax ? (
                <p className="text-rose-600 dark:text-rose-300">
                  Range máximo: 6 horas (você selecionou {Math.round(rangeSec / 3600)}h)
                </p>
              ) : (
                <p className="text-slate-700 dark:text-slate-300">
                  Duração: <strong>{rangeMin} min</strong>
                  <span className="text-slate-500"> · tamanho estimado: ~{Math.round(rangeMin * 12)} MB (FHD 6s/seg)</span>
                </p>
              )}
            </div>
          </div>

          {/* Certificado */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeCert}
              onChange={e => setIncludeCert(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1 text-xs">
              <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Incluir certificado digital
              </p>
              <p className="text-slate-500 mt-0.5">
                Anexa SHA-256 + carimbo de tempo. Usado em evidência judicial / LGPD.
              </p>
            </div>
          </label>

          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-600 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={invalid || submitting}
            className="px-4 py-1.5 text-xs rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {submitting ? 'Enviando...' : 'Exportar'}
          </button>
        </div>
      </div>
    </div>
  )
}
