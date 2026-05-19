/**
 * PlaybackMosaicPage — wrapper de seleção + invocação do PlaybackMosaic.
 *
 * UX:
 *  1. Usuário escolhe câmeras (multi-select)
 *  2. Usuário escolhe range de data/hora
 *  3. Clica "Iniciar Mosaico"
 *  4. PlaybackMosaic é montado em fullscreen overlay
 */
import { useState } from 'react'
import { Camera, Play, Calendar, Layout as LayoutIcon, Check } from 'lucide-react'
import { useCameras } from '../api/client'
import { PlaybackMosaic } from '../components/player/PlaybackMosaic'
import { ExportProgressModal } from '../components/player/ExportProgressModal'
import { toDatetimeLocal } from '../lib/day-utils'

export function PlaybackMosaicPage() {
  const { data: camerasData, isLoading } = useCameras({ limit: '100' })
  const cameras: Array<{ id: string; name: string; status: string }> = camerasData?.cameras ?? []

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [from, setFrom] = useState<string>(() =>
    toDatetimeLocal(new Date(Date.now() - 60 * 60 * 1000))
  )
  const [to, setTo] = useState<string>(() => toDatetimeLocal(new Date()))
  const [active, setActive] = useState(false)
  const [exportJob, setExportJob] = useState<{ jobId: string } | null>(null)
  const [showExport, setShowExport] = useState<{ cameraIds: string[]; from: Date; to: Date } | null>(null)

  function toggleCamera(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(cameras.slice(0, 16).map(c => c.id)))
  }

  function clear() {
    setSelected(new Set())
  }

  async function handleStartExport(cameraIds: string[], fromD: Date, toD: Date) {
    setShowExport(null)
    try {
      const resp = await fetch('/api/exports/mosaic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('icv_token')}`,
        },
        body: JSON.stringify({
          cameraIds, from: fromD.toISOString(), to: toD.toISOString(),
          layout: '2x2', includeCertificate: true,
        }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      setExportJob({ jobId: data.jobId })
    } catch (err: any) {
      alert(`Erro ao iniciar exportação: ${err.message}`)
    }
  }

  const cameraIds = Array.from(selected)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-space-950 p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <LayoutIcon className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            Mosaico Sincronizado de Reprodução
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Selecione múltiplas câmeras e um período. Reprodução sincronizada via soft-sync (playbackRate).
          </p>
        </div>

        {/* Range selector */}
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 mb-4 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" /> Período
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">De</span>
              <input
                type="datetime-local"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Até</span>
              <input
                type="datetime-local"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
              />
            </label>
          </div>
        </div>

        {/* Câmeras */}
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5" /> Câmeras ({selected.size} selecionada{selected.size === 1 ? '' : 's'})
            </p>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline"
              >
                Selecionar primeiras 16
              </button>
              <button
                onClick={clear}
                className="text-[11px] text-slate-500 hover:underline"
              >
                Limpar
              </button>
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-slate-400 py-4 text-center">Carregando câmeras...</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[40vh] overflow-y-auto">
              {cameras.map(cam => {
                const isSelected = selected.has(cam.id)
                const online = cam.status === 'ONLINE'
                return (
                  <button
                    key={cam.id}
                    onClick={() => toggleCamera(cam.id)}
                    className={`p-2.5 rounded-lg border text-left transition flex items-center gap-2 ${
                      isSelected
                        ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10'
                        : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-cyan-400'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                      isSelected ? 'border-cyan-500 bg-cyan-500' : 'border-slate-300 dark:border-white/20'
                    }`}>
                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{cam.name}</p>
                      <p className={`text-[10px] ${online ? 'text-emerald-500' : 'text-slate-400'}`}>{cam.status}</p>
                    </div>
                  </button>
                )
              })}
              {cameras.length === 0 && (
                <p className="col-span-full text-center text-sm text-slate-400 py-4">Nenhuma câmera disponível</p>
              )}
            </div>
          )}
        </div>

        {/* Botão iniciar */}
        <button
          onClick={() => setActive(true)}
          disabled={selected.size === 0}
          className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
        >
          <Play className="w-5 h-5" />
          Iniciar Mosaico ({selected.size} câmera{selected.size === 1 ? '' : 's'})
        </button>
      </div>

      {/* Mosaico ativo */}
      {active && cameraIds.length > 0 && (
        <PlaybackMosaic
          cameraIds={cameraIds}
          from={new Date(from)}
          to={new Date(to)}
          onClose={() => setActive(false)}
          onExport={(ids, fromD, toD) => setShowExport({ cameraIds: ids, from: fromD, to: toD })}
        />
      )}

      {/* Confirmar export */}
      {showExport && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-space-900 rounded-xl p-5 space-y-3 border border-slate-200 dark:border-white/10">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Exportar Mosaico</h3>
            <p className="text-xs text-slate-500">
              Vai gerar um arquivo MP4 com {showExport.cameraIds.length} câmeras lado a lado, do
              período {showExport.from.toLocaleString('pt-BR')} até {showExport.to.toLocaleString('pt-BR')}.
              <br /><br />
              O arquivo será assinado digitalmente (HMAC-SHA256) e a operação registrada no audit log.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowExport(null)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleStartExport(showExport.cameraIds, showExport.from, showExport.to)}
                className="px-3 py-1.5 text-xs rounded-lg bg-violet-500 text-white hover:bg-violet-600"
              >
                Confirmar e Exportar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progresso de export */}
      {exportJob && (
        <ExportProgressModal
          jobId={exportJob.jobId}
          onClose={() => setExportJob(null)}
        />
      )}
    </div>
  )
}
