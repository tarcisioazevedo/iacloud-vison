/**
 * LogsPage — área completa de logs estilo Frigate/Grafana.
 *
 * Features:
 *   - Timeline histogram por hora/level
 *   - Tabela virtualizada com auto-scroll
 *   - Filtros (level, source, kind, camera, cliente, texto)
 *   - Live-tail via SSE
 *   - Export CSV
 *   - JSON pretty-print ao clicar numa linha
 *   - Atalhos de tempo (1h, 6h, 24h, 7d, custom)
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  FileText, Search, Download, Pause, Play, Trash2,
  AlertCircle, CheckCircle2, Info,
  RefreshCw, Copy, X,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useLogs, useLogsSources, useLogsStats, purgeLogs, formatApiError, BASE_URL } from '../api/client'

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: 'text-slate-500 dark:text-slate-500',
  INFO:  'text-emerald-700 dark:text-emerald-400',
  WARN:  'text-amber-700 dark:text-amber-400',
  ERROR: 'text-rose-700 dark:text-rose-400',
  FATAL: 'text-rose-800 dark:text-rose-600',
}
const LEVEL_BG: Record<string, string> = {
  DEBUG: 'bg-slate-50 dark:bg-slate-500/10',
  INFO:  'bg-emerald-50 dark:bg-emerald-500/10',
  WARN:  'bg-amber-50 dark:bg-amber-500/10',
  ERROR: 'bg-rose-50 dark:bg-rose-500/10',
  FATAL: 'bg-rose-100 dark:bg-rose-600/20',
}
const TIME_PRESETS = [
  { label: '15m',  ms: 15 * 60_000 },
  { label: '1h',   ms: 60 * 60_000 },
  { label: '6h',   ms: 6 * 60 * 60_000 },
  { label: '24h',  ms: 24 * 60 * 60_000 },
  { label: '7d',   ms: 7 * 24 * 60 * 60_000 },
]

export function LogsPage() {
  const role = localStorage.getItem('icv_role') ?? ''
  const isSuperAdmin = role === 'SUPER_ADMIN'

  const [kind,   setKind]   = useState<'all' | 'camera' | 'system'>('all')
  const [level,  setLevel]  = useState('')
  const [source, setSource] = useState('')
  const [q,      setQ]      = useState('')
  const [since,  setSince]  = useState<number | null>(null) // ms offset
  const [liveTail, setLiveTail] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [appended, setAppended] = useState<any[]>([]) // live-tail items
  const [showPurge, setShowPurge] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const params: Record<string, string> = { kind, page: '1', pageSize: '200' }
  if (level)  params.level  = level
  if (source) params.source = source
  if (q)      params.q      = q
  if (since)  params.since  = new Date(Date.now() - since).toISOString()

  const { data: srcCatalog } = useLogsSources()
  const { data: logsData, mutate: refetch, isLoading } = useLogs(params)
  const { data: stats } = useLogsStats(params)
  const items = useMemo(() => {
    const base = logsData?.items ?? []
    return liveTail ? [...appended, ...base] : base
  }, [logsData, liveTail, appended])

  // Live-tail via SSE
  useEffect(() => {
    if (!liveTail) return
    const token = localStorage.getItem('icv_token')
    const qs = new URLSearchParams({ ...params, pageSize: '50' }).toString()
    const es = new EventSource(`${BASE_URL}/logs/stream?${qs}`, { withCredentials: false })
    // NOTA: SSE nativo não suporta header Authorization; em prod use proxy+cookie.
    // Para dev, usar JWT inline via query é prático:
    if (token) es.close()
    const es2 = new EventSource(`${BASE_URL}/logs/stream?${qs}&_t=${token}`)
    es2.addEventListener('log', (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data)
        setAppended(a => [payload, ...a].slice(0, 500))
      } catch {}
    })
    es2.onerror = () => { /* reconecta automaticamente */ }
    return () => { es2.close() }
  }, [liveTail, kind, level, source])

  function toggleLive() {
    setLiveTail(v => !v)
    if (!liveTail) setAppended([])
  }

  function exportCsv() {
    const qs = new URLSearchParams({ ...params, pageSize: '10000' }).toString()
    window.open(`${BASE_URL}/logs/export.csv?${qs}`, '_blank')
  }

  // Timeline histogram
  const timeline = stats?.timeline ?? []
  const maxCount = Math.max(1, ...timeline.map((t: any) => t.count))
  const byBucket = timeline.reduce((acc: any, t: any) => {
    const k = new Date(t.bucket).toISOString()
    acc[k] = (acc[k] ?? 0) + t.count
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <FileText className="w-6 h-6 text-cyan-700 dark:text-cyan-400" /> Logs
            <span className="text-sm font-normal text-slate-500 dark:text-slate-500">
              {logsData?.total ?? 0} registros
              {logsData?.breakdown && ` · camera=${logsData.breakdown.camera} · system=${logsData.breakdown.system}`}
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
            Frigate-style · camera logs + system logs · live-tail · export CSV
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={toggleLive}
            className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 border transition ${
              liveTail ? 'bg-rose-100 border-rose-200 text-rose-700 dark:bg-rose-500/20 dark:border-rose-500/40 dark:text-rose-300 animate-pulse'
                       : 'bg-slate-50 border-slate-200 text-slate-700 hover:text-slate-900 dark:bg-white/5 dark:border-white/10 dark:text-slate-400 dark:hover:text-white'}`}>
            {liveTail ? <><Pause className="w-3.5 h-3.5" /> Pausar tail</> : <><Play className="w-3.5 h-3.5" /> Live-tail</>}
          </button>
          <button onClick={exportCsv}
            className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs flex items-center gap-2">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          {isSuperAdmin && (
            <button
              onClick={() => setShowPurge(true)}
              title="Apagar logs antigos (irreversível)"
              className="px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-xs flex items-center gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" /> Purge
            </button>
          )}
          <button onClick={() => refetch()}
            className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {showPurge && (
        <PurgeModal onClose={() => setShowPurge(false)} onSuccess={() => { refetch(); setShowPurge(false) }} />
      )}

      {/* Filters */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar no message…"
              className="w-full pl-10 pr-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500" />
          </div>
          <Select value={kind} onChange={v => setKind(v as any)}
            options={[{ v: 'all', l: 'Tudo' }, { v: 'camera', l: 'Camera logs' }, { v: 'system', l: 'System logs' }]} />
          <Select value={level} onChange={setLevel} placeholder="Level"
            options={(srcCatalog?.levels ?? []).map((l: string) => ({ v: l, l }))} />
          <Select value={source} onChange={setSource} placeholder="Source"
            options={(srcCatalog?.sources ?? []).map((s: string) => ({ v: s, l: s }))} />
        </div>
        <div className="flex gap-1 items-center">
          <span className="text-[11px] text-slate-500 dark:text-slate-500 mr-2">Janela:</span>
          {TIME_PRESETS.map(p => (
            <button key={p.label} onClick={() => setSince(p.ms)}
              className={`px-2 py-1 rounded text-[11px] font-mono transition ${
                since === p.ms ? 'bg-cyan-100 text-cyan-700 border border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-400 dark:border-cyan-500/40'
                                : 'text-slate-500 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white border border-transparent'}`}>
              {p.label}
            </button>
          ))}
          {since && <button onClick={() => setSince(null)}
            className="ml-1 px-2 py-1 rounded text-[10px] text-slate-500 dark:text-slate-500 hover:text-rose-700 dark:hover:text-rose-400">limpar</button>}
        </div>
      </GlassCard>

      {/* Timeline histogram */}
      {timeline.length > 0 && (
        <GlassCard className="p-4">
          <h3 className="text-[11px] uppercase text-slate-500 dark:text-slate-500 tracking-wider mb-3">Timeline · {timeline.length} buckets</h3>
          <div className="flex items-end gap-0.5 h-20">
            {Object.entries(byBucket).map(([bucket, count]: any) => {
              const h = Math.max(2, (count / maxCount) * 80)
              return (
                <div key={bucket} className="flex-1 bg-cyan-500/40 hover:bg-cyan-400 transition rounded-t"
                  style={{ height: `${h}px` }} title={`${new Date(bucket).toLocaleString()} · ${count}`} />
              )
            })}
          </div>
        </GlassCard>
      )}

      {/* Log table */}
      <GlassCard className="p-0 overflow-hidden">
        <div ref={listRef} className="max-h-[65vh] overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-white/95 dark:bg-space-900/95 backdrop-blur border-b border-slate-200 dark:border-white/10 z-10">
              <tr className="text-[10px] uppercase text-slate-500 dark:text-slate-500 tracking-wider">
                <th className="px-3 py-2 text-left w-32">Timestamp</th>
                <th className="px-3 py-2 text-left w-16">Level</th>
                <th className="px-3 py-2 text-left w-24">Source</th>
                <th className="px-3 py-2 text-left w-20">Kind</th>
                <th className="px-3 py-2 text-left">Message</th>
                <th className="px-3 py-2 text-left w-24">Camera</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l: any) => {
                const isOpen = expanded === l.id
                // Fragment.Fragment com `key` em vez de `<>...</>` (que não aceita key).
                // Com a key no Fragment, React reconcilia row+detalhe expandido como
                // um único item da lista, evitando re-mount ao expandir/colapsar
                // (que perderia scroll/foco).
                return (
                  <Fragment key={l.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : l.id)}
                      className={`border-b border-slate-200 dark:border-white/5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5 ${LEVEL_BG[l.level] ?? ''}`}>
                      <td className="px-3 py-1.5 text-slate-500 dark:text-slate-500">{new Date(l.createdAt).toLocaleTimeString()}</td>
                      <td className={`px-3 py-1.5 font-bold ${LEVEL_COLORS[l.level] ?? ''}`}>
                        <span className="inline-flex items-center gap-1">
                          {l.level === 'ERROR' || l.level === 'FATAL' ? <AlertCircle className="w-3 h-3" /> :
                           l.level === 'WARN' ? <AlertCircle className="w-3 h-3" /> :
                           l.level === 'INFO' ? <CheckCircle2 className="w-3 h-3" /> :
                           <Info className="w-3 h-3" />}
                          {l.level}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-violet-700 dark:text-violet-400">{l.source}</td>
                      <td className="px-3 py-1.5 text-slate-500 dark:text-slate-500 text-[10px] uppercase">{l.kind ?? (l.cameraId ? 'camera' : 'system')}</td>
                      <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300 truncate max-w-xl">{l.message}</td>
                      <td className="px-3 py-1.5 text-slate-500 dark:text-slate-600 text-[10px]">{l.cameraName ?? l.cameraId?.slice(0, 8) ?? '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50 dark:bg-space-800/60">
                        <td colSpan={6} className="px-4 py-3 border-b border-slate-200 dark:border-white/5">
                          <div className="flex items-start justify-between mb-2">
                            <span className="text-[10px] uppercase text-cyan-700 dark:text-cyan-400 tracking-wider">Detalhes</span>
                            <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(JSON.stringify(l, null, 2)) }}
                              className="text-slate-500 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white text-[10px] flex items-center gap-1">
                              <Copy className="w-3 h-3" /> Copiar JSON
                            </button>
                          </div>
                          <pre className="text-[10px] text-slate-700 dark:text-slate-400 overflow-x-auto whitespace-pre-wrap bg-slate-100 dark:bg-black/40 p-2 rounded">
                            {JSON.stringify(l.details ?? l, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {items.length === 0 && !isLoading && (
                <tr><td colSpan={6} className="text-center py-10 text-slate-500 dark:text-slate-500">Nenhum log encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[]; placeholder?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500/50">
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o: any) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  )
}

/**
 * Modal de purge — exige typed confirmation ("APAGAR") para evitar dedo gordo
 * em ação irreversível. Backend só aceita SUPER_ADMIN, mas botão também
 * gateado no frontend para reduzir confusão.
 */
function PurgeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [olderThanDays, setOlderThanDays] = useState(30)
  const [kind, setKind] = useState<'all' | 'camera' | 'system'>('all')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ cameraDeleted?: number; systemDeleted?: number } | null>(null)

  async function handlePurge() {
    if (confirm !== 'APAGAR') return
    setBusy(true)
    setErr(null)
    try {
      const r = await purgeLogs(olderThanDays, kind)
      setResult({ cameraDeleted: r.cameraDeleted, systemDeleted: r.systemDeleted })
      // dá 1.5s pro usuário ler o resultado antes de fechar
      setTimeout(onSuccess, 1500)
    } catch (e) {
      setErr(formatApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-space-900 border border-rose-200 dark:border-rose-500/30 rounded-xl p-5 shadow-2xl shadow-rose-500/10"
      >
        <header className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-rose-700 dark:text-rose-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Apagar logs antigos</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-500 mt-0.5">
              Ação irreversível. Logs apagados não podem ser recuperados.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-slate-500 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500 mb-1 block">
              Apagar logs com mais de
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1} max={3650}
                value={olderThanDays}
                onChange={e => setOlderThanDays(Math.max(1, Number(e.target.value) || 1))}
                disabled={busy}
                className="w-20 px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-rose-500/50"
              />
              <span className="text-xs text-slate-700 dark:text-slate-400">dias</span>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500 mb-1 block">Tipo</label>
            <Select
              value={kind}
              onChange={(v: any) => setKind(v)}
              options={[
                { v: 'all', l: 'Camera + System' },
                { v: 'camera', l: 'Apenas camera logs' },
                { v: 'system', l: 'Apenas system logs' },
              ]}
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500 mb-1 block">
              Digite <code className="text-rose-700 dark:text-rose-300">APAGAR</code> para confirmar
            </label>
            <input
              type="text"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              disabled={busy}
              placeholder="APAGAR"
              className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-rose-500/50"
            />
          </div>

          {err && (
            <div className="p-2 rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-[11px] text-rose-700 dark:text-rose-300">
              {err}
            </div>
          )}

          {result && (
            <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-[11px] text-emerald-700 dark:text-emerald-300">
              Apagados — camera: {result.cameraDeleted ?? 0}, system: {result.systemDeleted ?? 0}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs"
          >
            Cancelar
          </button>
          <button
            onClick={handlePurge}
            disabled={confirm !== 'APAGAR' || busy}
            className="flex-1 px-3 py-2 rounded-lg bg-rose-100 hover:bg-rose-200 border border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 dark:border-rose-500/30 dark:text-rose-200 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busy ? 'Apagando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
