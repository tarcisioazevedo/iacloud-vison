/**
 * ExportProgressModal — modal que polleia GET /exports/:jobId/status
 * mostrando progresso (%), tempo restante, e link de download quando pronto.
 */
import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle, Download, X, ShieldCheck, Clock } from 'lucide-react'

interface JobState {
  id:        string
  status:    'queued' | 'running' | 'done' | 'error'
  progress:  number  // 0-1
  etaMs?:    number
  error?:    string
  result?: {
    url?:        string
    sha256?:     string
    certId?:     string
    sizeBytes?:  number | string
  }
}

interface Props {
  jobId: string
  onClose: () => void
}

export function ExportProgressModal({ jobId, onClose }: Props) {
  const [job, setJob] = useState<JobState | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function poll() {
      try {
        const resp = await fetch(`/api/exports/${jobId}/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('icv_token')}` },
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data: JobState = await resp.json()
        if (active) setJob(data)
      } catch (err: any) {
        if (active) setPollError(err.message)
      }
    }

    poll()
    const interval = setInterval(poll, 1500)
    return () => { active = false; clearInterval(interval) }
  }, [jobId])

  const isDone = job?.status === 'done'
  const isError = job?.status === 'error'
  const isRunning = job?.status === 'running' || job?.status === 'queued'

  const downloadUrl = job?.result?.url
    ? (job.result.url.startsWith('/') ? `/api${job.result.url}` : job.result.url)
    : null

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-space-900 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {isDone   && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            {isError  && <AlertCircle className="w-4 h-4 text-rose-500" />}
            {isRunning && <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />}
            {isDone   ? 'Exportação Concluída' : isError ? 'Erro na Exportação' : 'Exportando Vídeo...'}
          </h3>
          {(isDone || isError) && (
            <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {pollError && (
            <p className="text-xs text-rose-500 bg-rose-50 dark:bg-rose-500/10 p-2 rounded">
              Erro ao consultar status: {pollError}
            </p>
          )}

          {!job && !pollError && (
            <p className="text-sm text-slate-400 text-center py-4">Aguardando primeiro status...</p>
          )}

          {job && (
            <>
              <p className="text-xs text-slate-500">Job: <code className="font-mono">{job.id.slice(0, 8)}</code></p>

              {/* Progress bar */}
              {isRunning && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>{job.status === 'queued' ? 'Na fila...' : `${Math.round((job.progress ?? 0) * 100)}%`}</span>
                    {job.etaMs != null && job.etaMs > 0 && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Restam {formatDuration(job.etaMs)}
                      </span>
                    )}
                  </div>
                  <div className="h-2 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all duration-300"
                      style={{ width: `${Math.max(2, (job.progress ?? 0) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Done */}
              {isDone && job.result && (
                <div className="space-y-3">
                  <div className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                    {job.result.sizeBytes != null && (
                      <p>Tamanho: <strong>{formatBytes(Number(job.result.sizeBytes))}</strong></p>
                    )}
                    {job.result.sha256 && (
                      <p className="font-mono break-all">SHA-256: {job.result.sha256.slice(0, 32)}...</p>
                    )}
                    {job.result.certId && (
                      <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Assinatura digital aplicada · cert <code>{job.result.certId.slice(0, 8)}</code>
                      </p>
                    )}
                  </div>

                  {downloadUrl && (
                    <a
                      href={downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="block w-full px-4 py-2.5 rounded-lg bg-cyan-500 text-white text-sm font-semibold text-center hover:bg-cyan-600 flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" /> Baixar Arquivo
                    </a>
                  )}
                </div>
              )}

              {/* Error */}
              {isError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-300 text-xs">
                  {job.error ?? 'Erro desconhecido durante a exportação'}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const s = sec % 60
  return `${min}m ${s}s`
}
