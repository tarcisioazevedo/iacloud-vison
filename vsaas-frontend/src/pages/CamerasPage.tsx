/**
 * CamerasPage — grid sofisticado de câmeras com filtros, stats, thumbnails e ações.
 * Inspirado no dashboard do Frigate com cards live + status + quick-actions.
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import {
  Camera, Plus, Search, RefreshCw, Activity, AlertCircle,
  CheckCircle2, PlayCircle, Trash2,
  Grid3x3, List, ListTree,
  Copy, Check,
} from 'lucide-react'
import { GlassCard, GlassCard as GlassCardLocal } from '../components/cards/GlassCard'
import { KpiCard } from '../components/cards/KpiCard'
import { useCameras, testCamera, deleteCamera } from '../api/client'
import { AddCameraWizard } from '../components/cameras/AddCameraWizard'
import { CameraGridCard } from '../components/cameras/CameraGridCard'
import { CameraTreeView } from '../components/cameras/CameraTreeView'
import { ExportCsvButton } from '../components/ExportCsvButton'
import type { CsvColumn } from '../lib/csv'

// STATUS_STYLES é usado pela list view abaixo. As cores de pipeline /
// ícones por pipeline foram movidas para CameraGridCard (única outra usuária).
// Cada status tem versão sólida-suave (light) e translúcida (dark).
const STATUS_STYLES: Record<string, string> = {
  ACTIVE:
    'bg-emerald-100 text-emerald-700 border-emerald-200 ' +
    'dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30',
  PROVISIONING:
    'bg-amber-100 text-amber-700 border-amber-200 ' +
    'dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30',
  PAUSED:
    'bg-slate-100 text-slate-600 border-slate-200 ' +
    'dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30',
  ERROR:
    'bg-rose-100 text-rose-700 border-rose-200 ' +
    'dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30',
  INACTIVE:
    'bg-slate-100 text-slate-500 border-slate-200 ' +
    'dark:bg-slate-600/15 dark:text-slate-500 dark:border-slate-600/30',
}

export function CamerasPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState({ q: '', status: '', pipeline: '', tier: '' })
  const [showWizard, setShowWizard] = useState(false)
  const [viewMode, setViewMode] = useState<'tree' | 'grid' | 'list'>(() => {
    const saved = localStorage.getItem('cameras_view_mode')
    return (saved === 'grid' || saved === 'list' || saved === 'tree') ? saved : 'tree'
  })
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, any>>({})
  // Snapshot por card agora vive dentro de CameraGridCard (auto-refresh quando
  // visível + manual via botão). Não precisamos mais de cache global aqui.

  const { data, mutate, isLoading } = useCameras(filters)
  // Backend GET /cameras retorna { cameras: [...], stats: {...}, total: N }.
  // Antes (legado) o front esperava `items` — não existe nesse endpoint,
  // resultando em lista sempre vazia mesmo com câmeras cadastradas.
  const cameras: any[] = data?.cameras ?? []
  // Backend usa `online/offline/pending/error/maintenance` no stats.
  // O legado pegava `active/provisioning` que nunca chegavam → cards a 0.
  const stats = {
    total:        data?.stats?.total       ?? data?.total ?? 0,
    active:       data?.stats?.online      ?? 0,
    error:        data?.stats?.error       ?? 0,
    provisioning: data?.stats?.pending     ?? 0,
  }

  const filtered = useMemo(() => {
    if (!filters.q) return cameras
    const q = filters.q.toLowerCase()
    return cameras.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.location?.toLowerCase().includes(q) ||
      c.site?.name?.toLowerCase().includes(q),
    )
  }, [cameras, filters.q])

  async function handleTest(id: string) {
    setTestingId(id)
    try {
      const result = await testCamera(id)
      setTestResults(prev => ({ ...prev, [id]: result }))
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [id]: { success: false, errorMessage: err.message } }))
    }
    setTestingId(null)
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remover câmera "${name}"? (soft delete)`)) return
    await deleteCamera(id)
    mutate()
  }

  // Colunas CSV — reflete o que é útil operacionalmente
  const csvColumns: CsvColumn<any>[] = [
    { header: 'ID',            accessor: c => c.id },
    { header: 'Nome',          accessor: c => c.name },
    { header: 'Status',        accessor: c => c.status },
    { header: 'Pipeline',      accessor: c => c.pipeline },
    { header: 'Tier',          accessor: c => c.tier ?? '' },
    { header: 'Localização',   accessor: c => c.location ?? '' },
    { header: 'Site',          accessor: c => c.site?.name ?? '' },
    { header: 'Cliente',       accessor: c => c.site?.clienteFinal?.name ?? '' },
    { header: 'RTSP',          accessor: c => c.rtspMainUrl ?? '' },
    { header: 'FPS',           accessor: c => c.fps ?? '' },
    { header: 'Resolução',     accessor: c => c.resolution ?? '' },
    { header: 'Criada em',     accessor: c => c.createdAt },
    { header: 'Última snapshot', accessor: c => c.lastSnapshotAt ?? '' },
  ]

  return (
    <div className="space-y-3">
      {/* Hero compacto — 1 linha quando possível, deixa espaço pra lista */}
      <GlassCardLocal className="p-3 bg-gradient-to-br from-rose-500/10 via-violet-500/5 to-transparent border-rose-500/20">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center shadow shadow-rose-500/20 text-base shrink-0">
              📹
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-slate-900 dark:text-white">
                  Câmeras <span className="text-xs font-normal text-slate-500">({stats.total})</span>
                </h1>
                {/* Stats inline ao lado do título */}
                <span className="text-[10px] text-emerald-400 font-mono">●{stats.active} ativas</span>
                {stats.error > 0 && <span className="text-[10px] text-rose-400 font-mono">●{stats.error} erro</span>}
                {stats.provisioning > 0 && <span className="text-[10px] text-amber-400 font-mono">●{stats.provisioning} provisionando</span>}
                <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/30 font-mono uppercase">EDGE_BOX</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] bg-violet-500/15 text-violet-400 border border-violet-500/30 font-mono uppercase">CLOUD_DIRECT</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap shrink-0">
            <button
              onClick={() => mutate()}
              className={[
                'px-2.5 py-1.5 rounded-lg border transition',
                'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900',
                'dark:bg-white/5 dark:hover:bg-slate-100 dark:bg-white/10 dark:border-white/10 dark:text-slate-400 dark:hover:text-white',
              ].join(' ')}
              title="Recarregar"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <ExportCsvButton basename="cameras" rows={filtered} columns={csvColumns} />
            <button
              onClick={() => setShowWizard(true)}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-violet-500 text-white font-bold text-xs flex items-center gap-1.5 shadow shadow-rose-500/30 hover:opacity-90 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Nova Câmera
            </button>
          </div>
        </div>
      </GlassCardLocal>

      {/* Filters */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              value={filters.q}
              onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
              placeholder="Buscar por nome, local, site…"
              className={[
                'w-full pl-10 pr-3 py-2 rounded-lg border text-sm focus:outline-none',
                'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-cyan-500',
                'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500 dark:focus:border-cyan-500/50',
              ].join(' ')}
            />
          </div>
          {/* Toggle de view modes — antes dos dropdowns de filtro */}
          <div className="flex gap-0 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 shrink-0">
            <button
              onClick={() => { setViewMode('tree'); localStorage.setItem('cameras_view_mode', 'tree') }}
              title="Árvore (Cliente · Site · Câmera) com miniatura ao vivo"
              className={`px-3 py-2 transition ${viewMode === 'tree'
                ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400'
                : 'bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-white/5 dark:text-slate-500 dark:hover:bg-slate-100 dark:bg-white/10'}`}
            ><ListTree className="w-4 h-4" /></button>
            <button
              onClick={() => { setViewMode('grid'); localStorage.setItem('cameras_view_mode', 'grid') }}
              title="Grid (cards grandes)"
              className={`px-3 py-2 transition ${viewMode === 'grid'
                ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400'
                : 'bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-white/5 dark:text-slate-500 dark:hover:bg-slate-100 dark:bg-white/10'}`}
            ><Grid3x3 className="w-4 h-4" /></button>
            <button
              onClick={() => { setViewMode('list'); localStorage.setItem('cameras_view_mode', 'list') }}
              title="Tabela compacta"
              className={`px-3 py-2 transition ${viewMode === 'list'
                ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400'
                : 'bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-white/5 dark:text-slate-500 dark:hover:bg-slate-100 dark:bg-white/10'}`}
            ><List className="w-4 h-4" /></button>
          </div>
          <Select label="Status" value={filters.status} onChange={v => setFilters(f => ({ ...f, status: v }))}
            options={['', 'ACTIVE', 'PROVISIONING', 'PAUSED', 'ERROR', 'INACTIVE']} />
          <Select label="Pipeline" value={filters.pipeline} onChange={v => setFilters(f => ({ ...f, pipeline: v }))}
            options={['', 'EDGE_YOLO', 'VERTEX_STREAMING', 'VISION_API_BATCH']} />
          <Select label="Tier" value={filters.tier} onChange={v => setFilters(f => ({ ...f, tier: v }))}
            options={['', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM']} />
        </div>
      </GlassCard>

      {/* View — tree (default) | grid | list */}
      {viewMode === 'tree' ? (
        filtered.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <Camera className="w-12 h-12 opacity-30 mb-2" />
            <p className="text-sm">Nenhuma câmera encontrada</p>
            <button onClick={() => setShowWizard(true)} className="mt-3 text-sm hover:underline text-cyan-700 dark:text-cyan-400">
              Adicionar primeira câmera
            </button>
          </div>
        ) : (
          <CameraTreeView
            cameras={filtered}
            onTest={handleTest}
            onDelete={handleDelete}
            testingId={testingId}
          />
        )
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(cam => (
            <CameraGridCard
              key={cam.id}
              cam={cam}
              onNavigate={navigate}
              onTest={handleTest}
              onDelete={handleDelete}
              testing={testingId === cam.id}
              testResult={testResults[cam.id]}
              IdChip={CameraIdChip}
              Chip={Chip}
              IconBtn={IconBtn}
            />
          ))}

          {filtered.length === 0 && !isLoading && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-500">
              <Camera className="w-12 h-12 opacity-30 mb-2" />
              <p className="text-sm">Nenhuma câmera encontrada</p>
              <button onClick={() => setShowWizard(true)} className="mt-3 text-sm hover:underline text-cyan-700 dark:text-cyan-400">
                Adicionar primeira câmera
              </button>
            </div>
          )}
        </div>
      ) : (
        /* List view */
        <GlassCard className="overflow-hidden p-0">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
            <thead className={[
              'text-[11px] uppercase tracking-wider',
              'bg-slate-50 text-slate-500',
              'dark:bg-white/5 dark:text-slate-500',
            ].join(' ')}>
              <tr>
                <th className="px-3 py-3 text-left w-20">Preview</th>
                <th className="px-4 py-3 text-left">Nome</th>
                <th className="px-4 py-3 text-left">Site</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pipeline</th>
                <th className="px-4 py-3">Features</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/5">
              {filtered.map(cam => (
                <tr key={cam.id} className="transition cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5"
                  onClick={() => navigate(`/cameras/${cam.id}`)}>
                  <td className="px-3 py-2">
                    <ListThumb cam={cam} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{cam.name}</span>
                      <span onClick={e => e.stopPropagation()}>
                        <CameraIdChip id={cam.id} />
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">{cam.location}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">{cam.site?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS_STYLES[cam.status] ?? ''}`}>
                      {cam.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs font-mono text-slate-600 dark:text-slate-400">{cam.pipeline}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 justify-center">
                      {cam.aiEnabled && <Chip color="emerald">AI</Chip>}
                      {cam.motionEnabled && <Chip color="amber">motion</Chip>}
                      {cam.faceRecognitionEnabled && <Chip color="cyan">face</Chip>}
                      {cam.lprEnabled && <Chip color="violet">LPR</Chip>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center text-xs font-bold text-slate-600 dark:text-slate-400">{cam.tier}</td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <IconBtn icon={PlayCircle} onClick={() => handleTest(cam.id)} loading={testingId === cam.id} tooltip="Testar" />
                    <IconBtn icon={Trash2}     onClick={() => handleDelete(cam.id, cam.name)} tooltip="Remover" danger />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </GlassCard>
      )}

      {/* Wizard modal */}
      <AnimatePresence>
        {showWizard && (
          <AddCameraWizard onClose={() => { setShowWizard(false); mutate() }} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Pílula com os 8 primeiros caracteres do UUID + clique pra copiar full ID.
 * Resolve o problema de "duas câmeras com mesmo nome" — operador pode
 * desambiguar visualmente e citar o ID em ticket de suporte.
 *
 * Mostra estado "✓" por 1.5s após copiar (feedback de sucesso).
 * Faz e.stopPropagation no click pra não disparar a navegação do card/linha.
 */
function CameraIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    // Browsers modernos: clipboard.writeText. Fallback silencioso pra
    // contextos sem permissão (HTTP local sem TLS), apenas mostra o ID.
    navigator.clipboard?.writeText(id).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => { /* swallow — ainda assim mostramos o badge */ },
    )
  }
  return (
    <button
      onClick={handleCopy}
      title={`ID completo: ${id} (clique para copiar)`}
      className={`group flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider transition shrink-0 ${
        copied
          ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40'
          : 'bg-slate-100 text-slate-500 border-slate-200 hover:text-cyan-700 hover:border-cyan-300 dark:bg-white/5 dark:border-white/10 dark:hover:text-cyan-400 dark:hover:border-cyan-500/30'
      }`}
    >
      <span>#{id.slice(0, 8)}</span>
      {copied
        ? <Check className="w-2.5 h-2.5" />
        : <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
    </button>
  )
}

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  // Cada cor tem versão sólida-suave (light) e translúcida (dark).
  const map: Record<string, string> = {
    amber:
      'bg-amber-100 text-amber-700 border-amber-200 ' +
      'dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30',
    cyan:
      'bg-cyan-100 text-cyan-700 border-cyan-200 ' +
      'dark:bg-cyan-500/15 dark:text-cyan-400 dark:border-cyan-500/30',
    violet:
      'bg-violet-100 text-violet-700 border-violet-200 ' +
      'dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/30',
    rose:
      'bg-rose-100 text-rose-700 border-rose-200 ' +
      'dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30',
    emerald:
      'bg-emerald-100 text-emerald-700 border-emerald-200 ' +
      'dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30',
    slate:
      'bg-slate-100 text-slate-600 border-slate-200 ' +
      'dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${map[color]}`}>
      {children}
    </span>
  )
}

function IconBtn({ icon: Icon, onClick, tooltip, danger, loading }: any) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`p-1.5 rounded transition ${
        danger
          ? 'text-rose-600 hover:bg-rose-100 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-slate-100 dark:bg-white/10 dark:hover:text-rose-300'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-100 dark:bg-white/10 dark:hover:text-white'
      }`}
    >
      <Icon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
    </button>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={[
        'px-3 py-2 rounded-lg border text-xs focus:outline-none',
        'bg-slate-50 border-slate-200 text-slate-700 focus:border-cyan-500',
        'dark:bg-white/5 dark:border-white/10 dark:text-white dark:focus:border-cyan-500/50',
      ].join(' ')}
    >
      <option value="">{label}</option>
      {options.filter(Boolean).map((o: string) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ListThumb — miniatura compacta usada na list view (tabela).
// Mesma lógica de fetch da TreeView: prioriza snapshot persistido (Box→R2),
// fallback ffmpeg quando ACTIVE. Refresh 30s quando visível.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect as _useEffect, useRef as _useRef, useState as _useState } from 'react'
import { getCameraSnapshotUrl as _getSnap, getLiveToken as _getTk, BASE_URL as _BASE } from '../api/client'

function ListThumb({ cam }: { cam: any }) {
  const ref = _useRef<HTMLDivElement>(null)
  const [vis, setVis] = _useState(false)
  const [url, setUrl] = _useState<string | null>(null)
  const [err, setErr] = _useState(false)
  const tRef = _useRef<{ ticket: string; expiresAt: number } | null>(null)
  const tmRef = _useRef<ReturnType<typeof setInterval> | null>(null)

  const hasSnap = !!cam.lastSnapshotUrl
  const canFf = cam.status === 'ACTIVE' && !hasSnap

  _useEffect(() => {
    if (!ref.current) return
    const obs = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { rootMargin: '50px' })
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  _useEffect(() => {
    if (!vis || (!hasSnap && !canFf)) return
    let stop = false
    async function tick() {
      if (hasSnap) {
        const r = await _getSnap(cam.id)
        if (stop) return
        if (r?.url) {
          setUrl(r.url + (r.url.includes('?') ? '&' : '?') + '_=' + Date.now())
          setErr(false); return
        }
      }
      if (canFf) {
        const cur = tRef.current
        let ticket = cur && Date.now() < cur.expiresAt ? cur.ticket : null
        if (!ticket) {
          try {
            const t = await _getTk(cam.id, 'snapshot')
            tRef.current = { ticket: t.ticket, expiresAt: Date.now() + 50_000 }
            ticket = t.ticket
          } catch { setErr(true); return }
        }
        if (stop) return
        setUrl(`${_BASE}/live/${cam.id}/snapshot-jpeg?ticket=${encodeURIComponent(ticket)}&_=${Date.now()}`)
        setErr(false)
        return
      }
      setErr(true)
    }
    tick()
    tmRef.current = setInterval(tick, 30_000)
    return () => { stop = true; if (tmRef.current) clearInterval(tmRef.current) }
  }, [vis, hasSnap, canFf, cam.id])

  return (
    <div ref={ref} className="relative w-16 h-10 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden border border-slate-300/50 dark:border-white/10">
      {url && !err ? (
        <img src={url} alt={cam.name} onError={() => setErr(true)} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Camera className="w-4 h-4 text-slate-400 opacity-40" />
        </div>
      )}
    </div>
  )
}
