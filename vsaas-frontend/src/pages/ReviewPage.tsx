import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Bell, AlertTriangle, CheckCircle2, Clock, Eye, Check, X,
  Filter, ShieldAlert, Sparkles, Camera, ChevronDown, ChevronRight,
  Archive, Flame, Zap, Users, Car, Fingerprint, ShieldCheck,
  Activity, BookOpen, RefreshCw, UserPlus, MapPin, PlayCircle,
  Volume2, Scan, LayoutList, Send, Mail, MessageCircle,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PremiumHero } from '../components/hierarchy'
import { KpiCard } from '../components/cards/KpiCard'
import {
  useReviewItems, useReviewStats,
  acknowledgeReview, resolveReview, bulkAckReview, dismissReview,
} from '../api/client'
import { cn } from '../lib/utils'
import { ExportCsvButton } from '../components/ExportCsvButton'
import type { CsvColumn } from '../lib/csv'

// ── Categorias estilo Monuv (9 tabs) ──────────────────────────────────────
// Cada categoria mapeia para uma lista de triggerTypes do backend.
// Usadas para filtrar client-side além do filtro de status/severity server-side.

interface Category {
  id: string
  label: string
  icon: any
  triggerTypes: string[]      // triggerType values (vazio = todos)
  color: string
}

const CATEGORIES: Category[] = [
  { id: 'ALL',        label: 'Todos',                icon: LayoutList,    triggerTypes: [],                                          color: 'text-slate-700 dark:text-slate-300' },
  { id: 'PRESENCE',   label: 'Presença',             icon: Users,         triggerTypes: ['ZONE_OCCUPANCY', 'FACE_MATCH', 'OBJECT_CLASS'], color: 'text-cyan-700 dark:text-cyan-400' },
  { id: 'ABSENCE',    label: 'Ausência',             icon: Clock,         triggerTypes: ['LOITERING'],                                 color: 'text-amber-700 dark:text-amber-400' },
  { id: 'ANOMALY',    label: 'Anomalia',             icon: ShieldAlert,   triggerTypes: ['AUDIO_DETECT', 'FACE_UNKNOWN'],              color: 'text-rose-700 dark:text-rose-400' },
  { id: 'MOTION',     label: 'Movimento',            icon: Activity,      triggerTypes: ['MOTION_AREA'],                               color: 'text-violet-700 dark:text-violet-400' },
  { id: 'LPR',        label: 'LPR',                  icon: Car,           triggerTypes: ['LPR_BLACKLIST'],                             color: 'text-emerald-700 dark:text-emerald-400' },
  { id: 'CAMERA',     label: 'Alerta câmera',        icon: Camera,        triggerTypes: ['CAMERA_TAMPER', 'CAMERA_OFFLINE'],           color: 'text-amber-700 dark:text-amber-400' },
  { id: 'PANIC',      label: 'Pânico',               icon: Zap,           triggerTypes: ['PANIC_BUTTON'],                              color: 'text-rose-700 dark:text-rose-400' },
  { id: 'ARM',        label: 'Arme/Desarme',         icon: ShieldCheck,   triggerTypes: ['ARM_DISARM'],                                color: 'text-cyan-700 dark:text-cyan-400' },
  { id: 'SCENE',      label: 'Mudança de cena',      icon: Scan,          triggerTypes: ['SCENE_CHANGE'],                              color: 'text-violet-700 dark:text-violet-400' },
]

// ── Workflow de status (alinhado ao backend Prisma) ───────────────────────
// Mapeamento semântico estilo Monuv: Pendente → Em andamento → Concluído/Cancelado
// Backend: PENDING | ACKNOWLEDGED | RESOLVED | DISMISSED

const WORKFLOW: { key: string; label: string; description: string; color: string; dotColor: string }[] = [
  { key: 'PENDING',      label: 'Pendente',      description: 'Aguardando triagem',     color: 'text-rose-700 bg-rose-100 border-rose-200 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/40',    dotColor: 'bg-rose-500 dark:bg-rose-400' },
  { key: 'ACKNOWLEDGED', label: 'Em andamento',  description: 'Em análise pela equipe', color: 'text-amber-700 bg-amber-100 border-amber-200 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/40',   dotColor: 'bg-amber-500 dark:bg-amber-400' },
  { key: 'RESOLVED',     label: 'Concluído',     description: 'Resolvido/tratado',      color: 'text-emerald-700 bg-emerald-100 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/40', dotColor: 'bg-emerald-500 dark:bg-emerald-400' },
  { key: 'DISMISSED',    label: 'Cancelado',     description: 'Falso positivo/filtrado', color: 'text-slate-700 bg-slate-100 border-slate-200 dark:text-slate-300 dark:bg-slate-500/15 dark:border-slate-500/30',   dotColor: 'bg-slate-500 dark:bg-slate-400' },
]

// ── Assignment + Geoloc (persistência frontend por enquanto) ───────────────
// Armazenamos localmente no browser annotations por reviewItem até termos backend.
// Chave: icv_review_ann_v1 → { [itemId]: { assignedTo, inProgressAt, geo: {lat, lng}, ... } }

interface ItemAnnotation {
  assignedTo?: string
  inProgressAt?: string
  inProgressBy?: string
  geo?: { lat: number; lng: number; acc?: number }
}
const ANN_KEY = 'icv_review_ann_v1'
function loadAnnotations(): Record<string, ItemAnnotation> {
  try { return JSON.parse(localStorage.getItem(ANN_KEY) ?? '{}') } catch { return {} }
}
function saveAnnotations(m: Record<string, ItemAnnotation>) {
  localStorage.setItem(ANN_KEY, JSON.stringify(m))
}
function captureGeolocation(): Promise<{ lat: number; lng: number; acc: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      ()  => resolve(null),
      { timeout: 5000, maximumAge: 60_000 },
    )
  })
}

// ──────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  CRITICAL: { label: 'Crítico', bg: 'bg-rose-100 border-rose-200 dark:bg-rose-500/15 dark:border-rose-500/40',   text: 'text-rose-700 dark:text-rose-400',   ring: 'ring-rose-500/30' },
  HIGH:     { label: 'Alto',    bg: 'bg-amber-100 border-amber-200 dark:bg-amber-500/15 dark:border-amber-500/40', text: 'text-amber-700 dark:text-amber-400',  ring: 'ring-amber-500/30' },
  MEDIUM:   { label: 'Médio',   bg: 'bg-cyan-100 border-cyan-200 dark:bg-cyan-500/15 dark:border-cyan-500/30',   text: 'text-cyan-700 dark:text-cyan-400',   ring: 'ring-cyan-500/30' },
  LOW:      { label: 'Baixo',   bg: 'bg-slate-100 border-slate-200 dark:bg-slate-500/15 dark:border-slate-500/30', text: 'text-slate-700 dark:text-slate-400',  ring: 'ring-slate-500/30' },
}

const STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  PENDING:      { label: 'Pendente',      bg: 'bg-rose-100 border-rose-200 dark:bg-rose-500/15 dark:border-rose-500/30',       text: 'text-rose-700 dark:text-rose-400'    },
  ACKNOWLEDGED: { label: 'Em andamento',  bg: 'bg-amber-100 border-amber-200 dark:bg-amber-500/15 dark:border-amber-500/30',     text: 'text-amber-700 dark:text-amber-400'   },
  RESOLVED:     { label: 'Concluído',     bg: 'bg-emerald-100 border-emerald-200 dark:bg-emerald-500/15 dark:border-emerald-500/30', text: 'text-emerald-700 dark:text-emerald-400' },
  DISMISSED:    { label: 'Cancelado',     bg: 'bg-slate-100 border-slate-200 dark:bg-slate-500/15 dark:border-slate-500/30',     text: 'text-slate-500 dark:text-slate-500'   },
}

const TRIGGER_ICONS: Record<string, any> = {
  ZONE_OCCUPANCY: Users,
  LOITERING:      Clock,
  TRIPWIRE:       Zap,
  PPE_VIOLATION:  ShieldAlert,
  FACE_MATCH:     Fingerprint,
  FACE_UNKNOWN:   Fingerprint,
  LPR_BLACKLIST:  Car,
  AUDIO_DETECT:   Activity,
  MOTION_AREA:    Activity,
  OBJECT_CLASS:   Eye,
  QUEUE_OVERFLOW: Users,
}

const KIND_STYLES: Record<string, { label: string; icon: any; color: string }> = {
  ALERT:     { label: 'Alerta',     icon: Flame,        color: 'text-rose-700 dark:text-rose-400'  },
  DETECTION: { label: 'Detecção',   icon: Eye,          color: 'text-cyan-700 dark:text-cyan-400'  },
}

function formatRelative(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60_000) return 'agora'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}min`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / 86_400_000)}d`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// ──────────────────────────────────────────────────────────────

export function ReviewPage() {
  const [categoryId, setCategoryId] = useState<string>('ALL')
  const [severity, setSeverity] = useState('')
  const [status, setStatus] = useState('PENDING')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<Record<string, ItemAnnotation>>(loadAnnotations)

  const category = CATEGORIES.find(c => c.id === categoryId)!

  const params: Record<string, string> = { pageSize: '50' }
  if (severity) params.severity = severity
  if (status) params.status = status

  const { data, mutate, isValidating } = useReviewItems(params)
  const rawItems: any[] = data?.items ?? data ?? []

  // Filtra por categoria client-side (triggerTypes ou metadata)
  const items = useMemo(() => {
    if (category.triggerTypes.length === 0) return rawItems
    return rawItems.filter(i => {
      const trig = i.triggerType ?? i.metadata?.triggerType
      return trig && category.triggerTypes.includes(trig)
    })
  }, [rawItems, category])

  const { data: statsData } = useReviewStats(7)

  function persistAnnotation(id: string, patch: Partial<ItemAnnotation>) {
    setAnnotations(prev => {
      const next = { ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }
      saveAnnotations(next)
      return next
    })
  }

  async function startProgress(id: string, user: string) {
    const geo = await captureGeolocation()
    persistAnnotation(id, {
      inProgressAt: new Date().toISOString(),
      inProgressBy: user,
      assignedTo:   user,
      ...(geo ? { geo } : {}),
    })
    await acknowledgeReview(id)  // backend: marca como ACKNOWLEDGED ("Em andamento")
    mutate()
  }
  async function assignUser(id: string, user: string) {
    persistAnnotation(id, { assignedTo: user })
  }

  const stats = useMemo(() => ({
    newCount: statsData?.newCount ?? items.filter(i => i.status === 'PENDING').length,
    total: statsData?.total ?? 0,
    avgResolveSec: statsData?.avgResolveSec ?? 0,
    critical: statsData?.byCriticalCount ?? items.filter(i => i.severity === 'CRITICAL').length,
  }), [items, statsData])

  const allSelected = items.length > 0 && items.every(i => selected.has(i.id))

  const reviewCsvColumns: CsvColumn<any>[] = [
    { header: 'Data/hora',     accessor: i => i.startedAt ?? i.createdAt },
    { header: 'Título',        accessor: i => i.title ?? i.description ?? '' },
    { header: 'Severidade',    accessor: i => i.severity ?? '' },
    { header: 'Status',        accessor: i => i.status ?? '' },
    { header: 'Tipo',          accessor: i => i.kind ?? '' },
    { header: 'Trigger',       accessor: i => i.triggerType ?? '' },
    { header: 'Câmera',        accessor: i => i.camera?.name ?? '' },
    { header: 'Zona',          accessor: i => i.zone?.name ?? '' },
    { header: 'Score',         accessor: i => i.score ?? '' },
    { header: 'GenAI summary', accessor: i => i.genaiSummary ?? '' },
    { header: 'Atribuído a',   accessor: i => annotations[i.id]?.assignedTo ?? '' },
    { header: 'Em andamento desde', accessor: i => annotations[i.id]?.inProgressAt ?? '' },
    { header: 'Geoloc lat',    accessor: i => annotations[i.id]?.geo?.lat ?? '' },
    { header: 'Geoloc lng',    accessor: i => annotations[i.id]?.geo?.lng ?? '' },
    { header: 'Resolvido em',  accessor: i => i.resolvedAt ?? '' },
    { header: 'Resolução',     accessor: i => i.resolution ?? '' },
  ]

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(items.map(i => i.id)))
  }
  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  async function handleBulkAck() {
    if (selected.size === 0) return
    await bulkAckReview(Array.from(selected))
    setSelected(new Set())
    mutate()
  }

  async function handleAck(id: string) {
    await acknowledgeReview(id)
    mutate()
  }
  async function handleResolve(id: string, resolution?: string) {
    await resolveReview(id, resolution)
    mutate()
  }
  async function handleDismiss(id: string) {
    if (!confirm('Descartar este item?')) return
    await dismissReview(id)
    mutate()
  }

  function formatDuration(sec: number) {
    if (sec < 60) return `${Math.round(sec)}s`
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
  }

  return (
    <div className="space-y-6">
      {/* Hero premium (Onda 6.F) */}
      <PremiumHero
        emoji="🔔"
        title="Fila de Revisão"
        subtitle={`${items.length} evento${items.length !== 1 ? 's' : ''} · alertas priorizados com GenAI summary e triagem assistida`}
        accent="rose"
        tags={[
          { label: 'GenAI', color: 'violet' },
          { label: 'Real-time', color: 'rose' },
          { label: 'Multi-canal', color: 'cyan' },
        ]}
      />

      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          <NotifyChannelsIndicator />
          <button
            onClick={() => mutate()}
            className={cn('flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 dark:bg-space-800/60 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-50 dark:bg-white/5 text-sm font-medium transition', isValidating && 'animate-pulse')}
          >
            <RefreshCw className={cn('w-4 h-4', isValidating && 'animate-spin')} />
            Atualizar
          </button>
          <ExportCsvButton basename="revisao_eventos" rows={items} columns={reviewCsvColumns} />
          {selected.size > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={handleBulkAck}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500 text-white hover:bg-amber-600 text-sm font-semibold transition"
            >
              <Check className="w-4 h-4" />
              Marcar ciente ({selected.size})
            </motion.button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard title="Novos (não lidos)" value={stats.newCount} icon={<Bell />}        accent="rose"    delay={0.0} />
        <KpiCard title="Críticos (7d)"      value={stats.critical} icon={<Flame />}       accent="amber"   delay={0.1} />
        <KpiCard title="Total (7d)"          value={stats.total}    icon={<BookOpen />}    accent="cyan"    delay={0.2} />
        <KpiCard
          title="Tempo médio resolução"
          value={Math.round(stats.avgResolveSec)}
          unit="s"
          subtitle={stats.avgResolveSec > 60 ? formatDuration(stats.avgResolveSec) : undefined}
          icon={<Clock />}
          accent="emerald"
          delay={0.3}
        />
      </div>

      {/* Tabs de categoria (estilo Monuv — 9 canais) */}
      <GlassCard className="p-2 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon
            const active = cat.id === categoryId
            const badge = cat.triggerTypes.length === 0
              ? rawItems.length
              : rawItems.filter(i => cat.triggerTypes.includes(i.triggerType ?? i.metadata?.triggerType)).length
            return (
              <button
                key={cat.id}
                onClick={() => setCategoryId(cat.id)}
                className={cn(
                  'px-3 py-2 rounded-lg text-xs font-semibold border transition flex items-center gap-1.5 whitespace-nowrap',
                  active
                    ? 'bg-cyan-100 border-cyan-300 text-cyan-700 dark:bg-cyan-500/20 dark:border-cyan-500/40 dark:text-cyan-300'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 dark:bg-space-800/40 dark:border-white/10 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:border-white/20',
                )}
              >
                <Icon className={cn('w-3.5 h-3.5', active ? 'text-cyan-700 dark:text-cyan-300' : cat.color)} />
                {cat.label}
                {badge > 0 && (
                  <span className={cn(
                    'px-1.5 py-0.5 rounded-full text-[9px] font-mono',
                    active ? 'bg-cyan-200 text-cyan-800 dark:bg-cyan-500/30 dark:text-cyan-100' : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-400',
                  )}>
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </GlassCard>

      {/* Workflow pipeline (Pendente → Em andamento → Concluído → Cancelado) */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500 flex items-center gap-1.5">
            <PlayCircle className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400" />
            Fluxo de trabalho
          </p>
          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-slate-500 dark:text-slate-600" />
            <span className="text-[10px] text-slate-500 dark:text-slate-500">filtro de etapa</span>
          </div>
        </div>
        <div className="flex items-stretch gap-2">
          {WORKFLOW.map((w, idx) => {
            const isActive = status === w.key
            const count = rawItems.filter(i => i.status === w.key).length
            return (
              <button
                key={w.key}
                onClick={() => setStatus(isActive ? '' : w.key)}
                className={cn(
                  'flex-1 min-w-[140px] p-3 rounded-lg border transition text-left group',
                  isActive
                    ? w.color + ' shadow-inner'
                    : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700 dark:bg-space-800/30 dark:border-white/5 dark:hover:border-white/20 dark:text-slate-300',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('w-2 h-2 rounded-full shrink-0', isActive ? w.dotColor : 'bg-slate-400 group-hover:bg-slate-600 dark:bg-slate-600 dark:group-hover:bg-slate-400')} />
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-500">{idx + 1}/4</span>
                  <span className="ml-auto text-xs font-mono font-bold">{count}</span>
                </div>
                <p className={cn('mt-1 text-sm font-semibold', isActive ? '' : 'text-slate-900 dark:text-white')}>{w.label}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5 leading-tight">{w.description}</p>
              </button>
            )
          })}
        </div>
      </GlassCard>

      {/* Severity filter (secundário) */}
      <GlassCard className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500 mr-1">Severidade:</span>
          <button
            onClick={() => setSeverity('')}
            className={cn(
              'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition',
              severity === '' ? 'bg-cyan-100 border-cyan-300 text-cyan-700 dark:bg-cyan-500/20 dark:border-cyan-500/40 dark:text-cyan-300' : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 dark:bg-space-800/40 dark:border-white/10 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            Todas
          </button>
          {Object.entries(SEVERITY_STYLES).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setSeverity(severity === k ? '' : k)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition',
                severity === k ? `${v.bg} ${v.text}` : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 dark:bg-space-800/40 dark:border-white/10 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {v.label}
            </button>
          ))}
          {category.id !== 'ALL' && (
            <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-500">
              Categoria: <span className="text-cyan-700 dark:text-cyan-300 font-semibold">{category.label}</span>
              {' · '}
              <button onClick={() => setCategoryId('ALL')} className="underline hover:text-slate-900 dark:hover:text-slate-600 dark:text-slate-300">limpar</button>
            </span>
          )}
        </div>
      </GlassCard>

      {/* List */}
      {items.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600 dark:text-emerald-500 mb-3" />
          <p className="text-sm text-slate-700 dark:text-slate-300 font-semibold">Tudo em ordem!</p>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">Nenhum item pendente com os filtros atuais</p>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {/* Select all */}
          <GlassCard className="px-4 py-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-cyan-500" />
              Selecionar todos ({items.length})
            </label>
          </GlassCard>

          {items.map((item, idx) => (
            <ReviewRow
              key={item.id}
              item={item}
              annotation={annotations[item.id]}
              delay={Math.min(idx * 0.02, 0.3)}
              selected={selected.has(item.id)}
              onToggle={() => toggle(item.id)}
              expanded={expanded === item.id}
              onExpand={() => setExpanded(expanded === item.id ? null : item.id)}
              onStart={(user) => startProgress(item.id, user)}
              onAssign={(user) => assignUser(item.id, user)}
              onResolve={(r) => handleResolve(item.id, r)}
              onDismiss={() => handleDismiss(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Review row

function ReviewRow({
  item, annotation, delay, selected, onToggle, expanded, onExpand,
  onStart, onAssign, onResolve, onDismiss,
}: {
  item: any; annotation?: ItemAnnotation; delay: number; selected: boolean; onToggle: () => void;
  expanded: boolean; onExpand: () => void;
  onStart: (user: string) => void;
  onAssign: (user: string) => void;
  onResolve: (r?: string) => void; onDismiss: () => void;
}) {
  const sev = SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.LOW
  const st = STATUS_STYLES[item.status] ?? STATUS_STYLES.PENDING
  const kind = KIND_STYLES[item.kind] ?? KIND_STYLES.DETECTION
  const KindIcon = kind.icon
  const TriggerIcon = TRIGGER_ICONS[item.triggerType] ?? Bell

  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignName, setAssignName] = useState(annotation?.assignedTo ?? '')

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <GlassCard
        className={cn(
          'overflow-hidden',
          selected && 'ring-2',
          selected && sev.ring,
          item.status === 'PENDING' && item.severity === 'CRITICAL' && 'ring-1 ring-rose-500/40',
        )}
      >
        <div className="p-3 flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            onClick={e => e.stopPropagation()}
            className="mt-1.5 accent-cyan-500 shrink-0"
          />

          {/* Severity pill */}
          <div className={cn('shrink-0 w-12 flex flex-col items-center gap-1')}>
            <div className={cn('w-10 h-10 rounded-lg border flex items-center justify-center', sev.bg)}>
              <TriggerIcon className={cn('w-5 h-5', sev.text)} />
            </div>
            <span className={cn('text-[9px] font-bold uppercase', sev.text)}>{sev.label}</span>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <KindIcon className={cn('w-3.5 h-3.5', kind.color)} />
              <span className={cn('text-[10px] font-bold uppercase', kind.color)}>{kind.label}</span>
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-500">{item.triggerType}</span>
              <span className={cn('px-2 py-0.5 rounded-md border text-[9px] font-bold', st.bg, st.text)}>
                {st.label}
              </span>
              {item.ruleName && (
                <span className="text-[10px] text-slate-500 dark:text-slate-500 truncate">· {item.ruleName}</span>
              )}
            </div>

            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white truncate">
              {item.title ?? item.description ?? 'Evento detectado'}
            </p>

            {item.genaiSummary && (
              <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-slate-700 dark:text-slate-300 bg-violet-50 border border-violet-200 dark:bg-violet-500/5 dark:border-violet-500/15 rounded p-2">
                <Sparkles className="w-3 h-3 text-violet-700 dark:text-violet-400 shrink-0 mt-0.5" />
                <p className="line-clamp-2">{item.genaiSummary}</p>
              </div>
            )}

            <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-500 flex-wrap">
              <span className="flex items-center gap-1">
                <Camera className="w-3 h-3" />
                {item.camera?.name ?? '—'}
              </span>
              {item.zone?.name && (
                <span className="flex items-center gap-1 text-cyan-700 dark:text-cyan-400">
                  <span>zona:</span>{item.zone.name}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTime(item.startedAt ?? item.createdAt)}
                <span className="opacity-60">· {formatRelative(item.startedAt ?? item.createdAt)}</span>
              </span>
              {item.score !== undefined && item.score !== null && (
                <span className="font-mono">score: {Math.round(item.score * 100)}%</span>
              )}
              {annotation?.assignedTo && (
                <span className="flex items-center gap-1 text-cyan-700 bg-cyan-100 border border-cyan-200 dark:text-cyan-300 dark:bg-cyan-500/10 dark:border-cyan-500/25 px-1.5 py-0.5 rounded">
                  <UserPlus className="w-3 h-3" />
                  {annotation.assignedTo}
                </span>
              )}
              {annotation?.geo && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${annotation.geo.lat},${annotation.geo.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-emerald-700 bg-emerald-100 border border-emerald-200 hover:bg-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/10 dark:border-emerald-500/25 dark:hover:bg-emerald-500/20 px-1.5 py-0.5 rounded"
                  onClick={e => e.stopPropagation()}
                  title={`Geolocalização capturada (±${Math.round(annotation.geo.acc ?? 0)}m) — abrir no Maps`}
                >
                  <MapPin className="w-3 h-3" />
                  {annotation.geo.lat.toFixed(4)}, {annotation.geo.lng.toFixed(4)}
                </a>
              )}
              {annotation?.inProgressAt && (
                <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
                  <PlayCircle className="w-3 h-3" />
                  em andamento desde {formatRelative(annotation.inProgressAt)}
                </span>
              )}
            </div>
          </div>

          {/* Thumb */}
          {item.thumbnailUrl && (
            <div className="shrink-0 w-20 h-14 rounded-lg overflow-hidden bg-space-800 border border-slate-200 dark:border-white/10">
              <img src={item.thumbnailUrl} className="w-full h-full object-cover" />
            </div>
          )}

          {/* Actions */}
          <div className="shrink-0 flex flex-col gap-1">
            <button
              onClick={onExpand}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 dark:hover:bg-slate-100 dark:bg-white/10 dark:text-slate-400 dark:hover:text-slate-200"
              title={expanded ? 'Recolher' : 'Expandir'}
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            {item.status === 'PENDING' && (
              <button
                onClick={() => onStart(assignName || 'me')}
                className="p-1.5 rounded hover:bg-amber-100 text-slate-600 hover:text-amber-700 dark:hover:bg-amber-500/20 dark:text-slate-400 dark:hover:text-amber-400"
                title="Iniciar atendimento (captura geolocalização)"
              >
                <PlayCircle className="w-3.5 h-3.5" />
              </button>
            )}
            {item.status !== 'RESOLVED' && item.status !== 'DISMISSED' && (
              <button
                onClick={() => setAssigning(a => !a)}
                className={cn(
                  'p-1.5 rounded hover:bg-cyan-100 text-slate-600 hover:text-cyan-700 dark:hover:bg-cyan-500/20 dark:text-slate-400 dark:hover:text-cyan-400',
                  assigning && 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
                )}
                title="Atribuir responsável"
              >
                <UserPlus className="w-3.5 h-3.5" />
              </button>
            )}
            {item.status !== 'RESOLVED' && item.status !== 'DISMISSED' && (
              <button
                onClick={() => setResolving(true)}
                className="p-1.5 rounded hover:bg-emerald-100 text-slate-600 hover:text-emerald-700 dark:hover:bg-emerald-500/20 dark:text-slate-400 dark:hover:text-emerald-400"
                title="Resolver"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onDismiss}
              className="p-1.5 rounded hover:bg-rose-100 text-slate-600 hover:text-rose-700 dark:hover:bg-rose-500/20 dark:text-slate-400 dark:hover:text-rose-400"
              title="Descartar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Assignment inline editor */}
        <AnimatePresence>
          {assigning && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-4 pb-3 border-t border-slate-200 dark:border-white/5 pt-3"
            >
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <UserPlus className="w-3 h-3 text-cyan-700 dark:text-cyan-400" />
                Atribuir responsável
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  autoFocus
                  value={assignName}
                  onChange={e => setAssignName(e.target.value)}
                  placeholder="Ex.: operador-01 ou nome@empresa.com"
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 dark:bg-space-800/60 dark:border-white/10 dark:text-white dark:placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none"
                />
                <button
                  onClick={() => { onAssign(assignName.trim() || 'me'); setAssigning(false) }}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg bg-cyan-500 text-white text-xs font-semibold hover:bg-cyan-600"
                >
                  <Check className="w-3.5 h-3.5" />
                  Atribuir
                </button>
                <button
                  onClick={() => setAssigning(false)}
                  className="px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Cancelar
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-500">
                Persistência local (browser). Migração para backend multi-tenant na próxima sprint.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Resolve prompt */}
        <AnimatePresence>
          {resolving && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-4 pb-3 border-t border-slate-200 dark:border-white/5 pt-3"
            >
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider">Resolução</label>
              <textarea
                autoFocus
                rows={2}
                value={resolution}
                onChange={e => setResolution(e.target.value)}
                placeholder="Ex.: Falso positivo — reflexo em vidro"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 dark:bg-space-800/60 dark:border-white/10 dark:text-white dark:placeholder-slate-500 focus:border-emerald-500/50 focus:outline-none resize-none"
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  onClick={() => { setResolving(false); setResolution('') }}
                  className="px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => { onResolve(resolution || undefined); setResolving(false); setResolution('') }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Marcar resolvido
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expanded */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-4 pb-3 border-t border-slate-200 dark:border-white/5 pt-3 space-y-3"
            >
              {item.description && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider mb-1">Descrição</p>
                  <p className="text-xs text-slate-700 dark:text-slate-300">{item.description}</p>
                </div>
              )}
              {item.evidenceUrls && item.evidenceUrls.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider mb-1">Evidências</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {item.evidenceUrls.map((url: string, i: number) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer" className="aspect-video rounded-lg overflow-hidden bg-space-800 border border-slate-200 dark:border-white/10 hover:border-cyan-500/40 transition">
                        <img src={url} className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {item.metadata && Object.keys(item.metadata).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider mb-1">Metadata</p>
                  <pre className="text-[10px] font-mono text-slate-600 bg-slate-50 border border-slate-200 dark:text-slate-400 dark:bg-space-800/40 dark:border-white/5 p-2 rounded overflow-auto max-h-40">
                    {JSON.stringify(item.metadata, null, 2)}
                  </pre>
                </div>
              )}
              {item.acknowledgedAt && (
                <p className="text-[10px] text-slate-500 dark:text-slate-500">
                  Ciente em {formatTime(item.acknowledgedAt)} {item.acknowledgedBy && `por ${item.acknowledgedBy}`}
                </p>
              )}
              {item.resolvedAt && (
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                  Resolvido em {formatTime(item.resolvedAt)}
                  {item.resolution && <> — {item.resolution}</>}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ── NotifyChannelsIndicator ──────────────────────────────────────────────
// Pílula no header mostrando quais canais (e-mail/WhatsApp/Telegram) estão
// ativos e link para Configurações para ajustar credenciais e roteamento.
//
// Lê o scaffold em localStorage `icv_notify_channels_v1`. Enquanto o
// backend não implementa envio, o indicador apenas informa o estado.
function NotifyChannelsIndicator() {
  const status = useMemo(() => {
    try {
      const raw = localStorage.getItem('icv_notify_channels_v1')
      if (!raw) return { email: false, whatsapp: false, telegram: false }
      const c = JSON.parse(raw)
      return {
        email:    !!c?.email?.enabled,
        whatsapp: !!c?.whatsapp?.enabled,
        telegram: !!c?.telegram?.enabled,
      }
    } catch { return { email: false, whatsapp: false, telegram: false } }
  }, [])

  const active = (status.email ? 1 : 0) + (status.whatsapp ? 1 : 0) + (status.telegram ? 1 : 0)

  return (
    <Link
      to="/settings"
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition',
        active > 0
          ? 'bg-emerald-100 border-emerald-200 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/15'
          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-space-800/60 dark:border-white/10 dark:text-slate-400 dark:hover:bg-slate-50 dark:bg-white/5',
      )}
      title="Configurar canais de notificação (e-mail, WhatsApp, Telegram)"
    >
      <div className="flex items-center -space-x-1">
        <Mail          className={cn('w-3.5 h-3.5', status.email    ? 'text-cyan-700 dark:text-cyan-300'    : 'text-slate-500 dark:text-slate-500')} />
        <MessageCircle className={cn('w-3.5 h-3.5', status.whatsapp ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-500')} />
        <Send          className={cn('w-3.5 h-3.5', status.telegram ? 'text-sky-700 dark:text-sky-300'     : 'text-slate-500 dark:text-slate-500')} />
      </div>
      <span className="hidden sm:inline">
        {active === 0 ? 'Configurar canais' : `${active} canal${active === 1 ? '' : 'is'} ativo${active === 1 ? '' : 's'}`}
      </span>
    </Link>
  )
}
