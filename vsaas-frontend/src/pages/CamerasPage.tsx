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
  Grid3x3, List,
  Copy, Check,
} from 'lucide-react'
import { GlassCard, GlassCard as GlassCardLocal } from '../components/cards/GlassCard'
import { KpiCard } from '../components/cards/KpiCard'
import { useCameras, testCamera, deleteCamera } from '../api/client'
import { AddCameraWizard } from '../components/cameras/AddCameraWizard'
import { CameraGridCard } from '../components/cameras/CameraGridCard'
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
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
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
    <div className="space-y-4">
      {/* Hero premium — paridade Onda 6.D */}
      <GlassCardLocal className="p-5 bg-gradient-to-br from-rose-500/10 via-violet-500/5 to-transparent border-rose-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center shadow-lg shadow-rose-500/20 text-2xl">
              📹
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Câmeras <span className="text-base font-normal text-slate-500">({stats.total})</span>
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Frigate-inspired · motion · zonas · detectores · face · LPR · semântica.
                Suporta câmeras gerenciadas por edge box (recomendado) ou avulsas (cloud direct).
              </p>
              <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono uppercase">
                  EDGE_BOX
                </span>
                <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 font-mono uppercase">
                  CLOUD_DIRECT
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => mutate()}
            className={[
              'px-3 py-2 rounded-lg border transition',
              'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900',
              'dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-slate-400 dark:hover:text-white',
            ].join(' ')}
            title="Recarregar"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <ExportCsvButton basename="cameras" rows={filtered} columns={csvColumns} />
          <div className="flex gap-0 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-2 ${viewMode === 'grid'
                ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400'
                : 'bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-500'}`}
            ><Grid3x3 className="w-4 h-4" /></button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-2 ${viewMode === 'list'
                ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400'
                : 'bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-500'}`}
            ><List className="w-4 h-4" /></button>
          </div>
          <button
            onClick={() => setShowWizard(true)}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-rose-500 to-violet-500 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-rose-500/30 hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" /> Nova Câmera
          </button>
        </div>
        </div>
      </GlassCardLocal>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<Camera />}       title="Total"         value={stats.total ?? 0}        accent="cyan" />
        <KpiCard icon={<CheckCircle2 />} title="Ativas"        value={stats.active ?? 0}       accent="emerald" />
        <KpiCard icon={<AlertCircle />}  title="Com Erro"      value={stats.error ?? 0}        accent="rose" />
        <KpiCard icon={<Activity />}     title="Provisionando" value={stats.provisioning ?? 0} accent="amber" />
      </div>

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
          <Select label="Status" value={filters.status} onChange={v => setFilters(f => ({ ...f, status: v }))}
            options={['', 'ACTIVE', 'PROVISIONING', 'PAUSED', 'ERROR', 'INACTIVE']} />
          <Select label="Pipeline" value={filters.pipeline} onChange={v => setFilters(f => ({ ...f, pipeline: v }))}
            options={['', 'EDGE_YOLO', 'VERTEX_STREAMING', 'VISION_API_BATCH']} />
          <Select label="Tier" value={filters.tier} onChange={v => setFilters(f => ({ ...f, tier: v }))}
            options={['', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM']} />
        </div>
      </GlassCard>

      {/* Grid */}
      {viewMode === 'grid' ? (
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
          <table className="w-full text-sm">
            <thead className={[
              'text-[11px] uppercase tracking-wider',
              'bg-slate-50 text-slate-500',
              'dark:bg-white/5 dark:text-slate-500',
            ].join(' ')}>
              <tr>
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
                <tr key={cam.id} className="transition cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => navigate(`/cameras/${cam.id}`)}>
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
          </table>
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
          ? 'text-rose-600 hover:bg-rose-100 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-white/10 dark:hover:text-rose-300'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white'
      }`}
    >
      <Icon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
    </button>
  )
}

function Select({ label, value, onChange, options }: any) {
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
