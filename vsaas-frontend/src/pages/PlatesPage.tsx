import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Car, Plus, Search, Trash2, X, ShieldAlert, ShieldCheck,
  Sparkles, AlertTriangle, Clock, Edit3, Check,
  CheckCircle2, XCircle, Camera, Filter, Users,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PremiumHero } from '../components/hierarchy'
import { KpiCard } from '../components/cards/KpiCard'
import { useUiToast } from '../components/Toast'
import {
  usePlates, usePlateEvents, usePlateStats,
  createPlate, updatePlate, deletePlate,
} from '../api/client'
import { cn } from '../lib/utils'
import { ExportCsvButton } from '../components/ExportCsvButton'
import type { CsvColumn } from '../lib/csv'
import { confirm } from '../components/ConfirmDialog'

// ──────────────────────────────────────────────────────────────
// Helpers

const CATEGORY_STYLES: Record<string, { label: string; bg: string; text: string; icon: any }> = {
  AUTHORIZED: { label: 'Autorizado',  bg: 'bg-emerald-100 border-emerald-200 dark:bg-emerald-500/15 dark:border-emerald-500/30', text: 'text-emerald-700 dark:text-emerald-400', icon: ShieldCheck   },
  RESIDENT:   { label: 'Morador',     bg: 'bg-cyan-100 border-cyan-200 dark:bg-cyan-500/15 dark:border-cyan-500/30',       text: 'text-cyan-700 dark:text-cyan-400',    icon: Users         },
  VIP:        { label: 'VIP',         bg: 'bg-violet-100 border-violet-200 dark:bg-violet-500/15 dark:border-violet-500/30',   text: 'text-violet-700 dark:text-violet-400',  icon: Sparkles      },
  VISITOR:    { label: 'Visitante',   bg: 'bg-slate-100 border-slate-200 dark:bg-slate-500/15 dark:border-slate-500/30',     text: 'text-slate-700 dark:text-slate-400',   icon: Car           },
  BLACKLIST:  { label: 'Bloqueado',   bg: 'bg-rose-100 border-rose-200 dark:bg-rose-500/15 dark:border-rose-500/30',       text: 'text-rose-700 dark:text-rose-400',    icon: ShieldAlert   },
  WATCHLIST:  { label: 'Monitorado',  bg: 'bg-amber-100 border-amber-200 dark:bg-amber-500/15 dark:border-amber-500/30',     text: 'text-amber-700 dark:text-amber-400',   icon: AlertTriangle },
}

const DEFAULT_CAT = { label: 'Desconhecido', bg: 'bg-slate-100 border-slate-200 dark:bg-slate-500/15 dark:border-slate-500/30', text: 'text-slate-700 dark:text-slate-400', icon: Car }

function formatRelative(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60_000) return 'agora'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}min`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / 86_400_000)}d`
}

function formatPlate(p: string) {
  const clean = p.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (clean.length === 7) {
    // Mercosul: AAA0A00 ou clássica: AAA0000
    return clean.slice(0, 3) + '-' + clean.slice(3)
  }
  return clean
}

// ──────────────────────────────────────────────────────────────
// Main page

export function PlatesPage() {
  const [tab, setTab] = useState<'cadaster' | 'events'>('cadaster')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)

  const { data: platesData, mutate } = usePlates(catFilter ? { category: catFilter } : undefined)
  const plates: any[] = platesData?.items ?? platesData ?? []
  const { data: statsData } = usePlateStats(7)

  const filtered = useMemo(() => {
    if (!search) return plates
    const q = search.toUpperCase().replace(/[^A-Z0-9]/g, '')
    return plates.filter(p =>
      p.plate?.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(q) ||
      p.ownerName?.toUpperCase().includes(q) ||
      p.vehicleDescription?.toUpperCase().includes(q),
    )
  }, [plates, search])

  const stats = useMemo(() => {
    const byCat: Record<string, number> = {}
    for (const p of plates) byCat[p.category] = (byCat[p.category] ?? 0) + 1
    return {
      total: plates.length,
      authorized: (byCat.AUTHORIZED ?? 0) + (byCat.RESIDENT ?? 0) + (byCat.VIP ?? 0),
      blacklist: byCat.BLACKLIST ?? 0,
      events7d: statsData?.totalEvents ?? 0,
    }
  }, [plates, statsData])

  const platesCsvColumns: CsvColumn<any>[] = [
    { header: 'Placa',         accessor: p => formatPlate(p.plate ?? '') },
    { header: 'Categoria',     accessor: p => p.category },
    { header: 'Dono',          accessor: p => p.ownerName ?? '' },
    { header: 'Veículo',       accessor: p => p.vehicleDescription ?? '' },
    { header: 'Contato',       accessor: p => p.contactPhone ?? '' },
    { header: 'Notas',         accessor: p => p.notes ?? '' },
    { header: 'Cadastrada em', accessor: p => p.createdAt },
    { header: 'Ativa',         accessor: p => (p.active ?? true) ? 'sim' : 'não' },
  ]

  return (
    <div className="space-y-4">
      {/* Hero premium (Onda 6.F) */}
      <PremiumHero
        emoji="🚗"
        title="Placas Veiculares (LPR)"
        subtitle={`${filtered.length} placa${filtered.length !== 1 ? 's' : ''} cadastrada${filtered.length !== 1 ? 's' : ''} · cadastro + log de eventos LPR`}
        accent="amber"
        tags={[
          { label: 'OCR', color: 'amber' },
          { label: 'Levenshtein', color: 'rose' },
          { label: 'Mercosul + ABNT', color: 'emerald' },
        ]}
      />

      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          {tab === 'cadaster' && (
            <ExportCsvButton basename="placas_cadastro" rows={filtered} columns={platesCsvColumns} />
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-white hover:opacity-90 text-sm font-semibold transition"
          >
            <Plus className="w-4 h-4" />
            Nova Placa
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard title="Placas cadastradas" value={stats.total}      icon={<Car />}         accent="cyan"    delay={0.0} />
        <KpiCard title="Autorizadas"         value={stats.authorized} icon={<ShieldCheck />} accent="emerald" delay={0.1} />
        <KpiCard title="Bloqueadas"          value={stats.blacklist}  icon={<ShieldAlert />} accent="rose"    delay={0.2} />
        <KpiCard title="Eventos (7d)"        value={stats.events7d}   icon={<Camera />}      accent="amber"   delay={0.3} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {(['cadaster', 'events'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 rounded-lg text-xs font-semibold border transition',
              tab === t
                ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-500/15 dark:border-amber-500/40 dark:text-amber-300'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 dark:bg-space-800/40 dark:border-white/10 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            {t === 'cadaster' ? 'Cadastro' : 'Eventos LPR'}
          </button>
        ))}
      </div>

      {tab === 'cadaster' ? (
        <>
          {/* Filters */}
          <GlassCard className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[240px] relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-500" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar placa, dono, veículo..."
                  className="w-full pl-10 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 dark:bg-space-800/60 dark:border-white/10 dark:text-white dark:placeholder-slate-500 focus:border-amber-500/50 focus:outline-none font-mono uppercase"
                />
              </div>

              <div className="flex items-center gap-1 flex-wrap">
                <button
                  onClick={() => setCatFilter('')}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                    catFilter === ''
                      ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-300'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 dark:bg-space-800/40 dark:border-white/10 dark:text-slate-400 dark:hover:text-slate-200',
                  )}
                >
                  Todas
                </button>
                {Object.entries(CATEGORY_STYLES).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setCatFilter(k)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                      catFilter === k
                        ? `${v.bg} ${v.text}`
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 dark:bg-space-800/40 dark:border-white/10 dark:text-slate-400 dark:hover:text-slate-200',
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </GlassCard>

          {/* Plates grid */}
          {filtered.length === 0 ? (
            <GlassCard className="p-12 text-center">
              <Car className="w-12 h-12 mx-auto text-slate-400 dark:text-slate-600 mb-3" />
              <p className="text-sm text-slate-600 dark:text-slate-400">Nenhuma placa encontrada</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 text-xs font-semibold text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300"
              >
                Cadastrar primeira placa →
              </button>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map((p, idx) => (
                <PlateCard
                  key={p.id}
                  plate={p}
                  delay={idx * 0.02}
                  onEdit={() => setEditing(p)}
                  onDelete={async () => {
                    const ok = await confirm({
                      title: `Excluir ${p.plate}?`,
                      destructive: true,
                      confirmLabel: 'Excluir',
                    })
                    if (!ok) return
                    await deletePlate(p.id)
                    mutate()
                  }}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <PlateEventsView />
      )}

      {/* Modals */}
      <AnimatePresence>
        {showCreate && (
          <PlateFormModal
            onClose={() => setShowCreate(false)}
            onSaved={() => { setShowCreate(false); mutate() }}
          />
        )}
        {editing && (
          <PlateFormModal
            plate={editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); mutate() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Plate card

function PlateCard({
  plate, delay, onEdit, onDelete,
}: { plate: any; delay: number; onEdit: () => void; onDelete: () => void }) {
  const cat = CATEGORY_STYLES[plate.category] ?? DEFAULT_CAT
  const Icon = cat.icon

  return (
    <GlassCard hover delay={delay} className="p-4 group">
      <div className="flex items-start justify-between mb-3">
        <div className={cn('px-2 py-0.5 rounded-md border text-[10px] font-bold flex items-center gap-1', cat.bg, cat.text)}>
          <Icon className="w-3 h-3" />
          {cat.label}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={onEdit}
            className="p-1 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 dark:hover:bg-slate-100 dark:bg-white/10 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <Edit3 className="w-3 h-3" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded hover:bg-rose-100 text-slate-600 hover:text-rose-700 dark:hover:bg-rose-500/15 dark:text-slate-400 dark:hover:text-rose-400"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Plate display — Mercosul style (preserve dark gradient — plate visual) */}
      <div className="mb-3 p-3 rounded-lg bg-gradient-to-br from-space-800 to-space-900 border border-slate-200 dark:border-white/10 text-center">
        <div className="text-[8px] font-bold text-slate-600 mb-0.5 tracking-widest">BRASIL</div>
        <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-[0.2em]">
          {formatPlate(plate.plate)}
        </div>
      </div>

      {plate.ownerName && (
        <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{plate.ownerName}</p>
      )}
      {plate.vehicleDescription && (
        <p className="text-[10px] text-slate-500 dark:text-slate-500 truncate">{plate.vehicleDescription}</p>
      )}
      {plate.notes && (
        <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-1 line-clamp-2">{plate.notes}</p>
      )}

      <div className="mt-2 pt-2 border-t border-slate-200 dark:border-white/5 flex items-center justify-between text-[9px] text-slate-500 dark:text-slate-500">
        <span className="flex items-center gap-1">
          <Camera className="w-3 h-3" />
          {plate._count?.events ?? 0} eventos
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatRelative(plate.createdAt)}
        </span>
      </div>
    </GlassCard>
  )
}

// ──────────────────────────────────────────────────────────────
// Events view

function PlateEventsView() {
  const [category, setCategory] = useState('')
  const [matched, setMatched] = useState<'all' | 'matched' | 'unmatched'>('all')

  const params: Record<string, string> = { limit: '100' }
  if (category) params.category = category
  if (matched === 'matched') params.matched = 'true'
  if (matched === 'unmatched') params.matched = 'false'

  const { data } = usePlateEvents(params)
  const events: any[] = data?.items ?? data ?? []

  const eventsCsvColumns: CsvColumn<any>[] = [
    { header: 'Data/hora',   accessor: e => e.createdAt ?? e.capturedAt },
    { header: 'Placa OCR',   accessor: e => formatPlate(e.plateOcr ?? '') },
    { header: 'Placa casada',accessor: e => e.matchedPlate ? formatPlate(e.matchedPlate.plate) : '' },
    { header: 'Categoria',   accessor: e => e.matchedPlate?.category ?? '' },
    { header: 'Confiança OCR', accessor: e => e.ocrConfidence ?? '' },
    { header: 'Câmera',      accessor: e => e.camera?.name ?? '' },
    { header: 'Match',       accessor: e => e.matchedPlate ? 'sim' : 'não' },
    { header: 'Levenshtein', accessor: e => e.levenshteinDistance ?? '' },
  ]

  return (
    <>
      {/* Filters */}
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Filter className="w-4 h-4 text-slate-500 mr-1" />
            {(['all', 'matched', 'unmatched'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMatched(m)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                  matched === m
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'bg-space-800/40 border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-200',
                )}
              >
                {m === 'all' ? 'Todos' : m === 'matched' ? 'Reconhecidos' : 'Desconhecidos'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setCategory('')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                category === ''
                  ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                  : 'bg-space-800/40 border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-200',
              )}
            >
              Todas categorias
            </button>
            {Object.entries(CATEGORY_STYLES).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setCategory(k)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                  category === k ? `${v.bg} ${v.text}` : 'bg-space-800/40 border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-200',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="ml-auto">
            <ExportCsvButton basename="placas_eventos" rows={events} columns={eventsCsvColumns} />
          </div>
        </div>
      </GlassCard>

      {events.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <Camera className="w-12 h-12 mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">Nenhum evento LPR ainda</p>
        </GlassCard>
      ) : (
        <div className="space-y-1.5">
          {events.map((ev, idx) => {
            const cat = CATEGORY_STYLES[ev.category ?? ev.matchedPlate?.category ?? ''] ?? DEFAULT_CAT
            const Icon = cat.icon
            const isMatched = !!ev.matchedPlateId
            return (
              <motion.div
                key={ev.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(idx * 0.01, 0.3) }}
              >
                <GlassCard className="p-3" hover>
                  <div className="flex items-center gap-3">
                    <div className={cn('w-10 h-10 rounded-lg border flex items-center justify-center shrink-0', cat.bg)}>
                      <Icon className={cn('w-4 h-4', cat.text)} />
                    </div>

                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="font-mono font-black text-lg text-slate-900 dark:text-white tracking-wider shrink-0">
                        {formatPlate(ev.plate ?? ev.detectedPlate ?? '???????')}
                      </div>

                      <div className="flex-1 min-w-0 text-[10px] text-slate-500">
                        <div className="flex items-center gap-2">
                          <Camera className="w-3 h-3" />
                          <span className="truncate">{ev.camera?.name ?? '—'}</span>
                          {isMatched && ev.matchedPlate?.ownerName && (
                            <>
                              <span className="opacity-40">·</span>
                              <span className="text-slate-600 dark:text-slate-300 font-medium">{ev.matchedPlate.ownerName}</span>
                            </>
                          )}
                        </div>
                        {ev.vehicleDescription && (
                          <p className="truncate">{ev.vehicleDescription}</p>
                        )}
                      </div>
                    </div>

                    {/* Match status */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isMatched ? (
                        <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {ev.matchDistance === 0 ? 'Exato' : `dist ${ev.matchDistance}`}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[10px] text-slate-500">
                          <XCircle className="w-3.5 h-3.5" />
                          Desconhecida
                        </div>
                      )}
                      {ev.ocrConfidence !== null && ev.ocrConfidence !== undefined && (
                        <span className={cn(
                          'text-[10px] font-bold font-mono px-1.5 py-0.5 rounded',
                          ev.ocrConfidence >= 0.85 ? 'bg-emerald-500/20 text-emerald-300' :
                          ev.ocrConfidence >= 0.7  ? 'bg-amber-500/20 text-amber-300' :
                          'bg-rose-500/20 text-rose-300',
                        )}>
                          {Math.round(ev.ocrConfidence * 100)}%
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                        {formatRelative(ev.capturedAt)}
                      </span>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Create/edit modal

function PlateFormModal({
  plate, onClose, onSaved,
}: { plate?: any; onClose: () => void; onSaved: () => void }) {
  const toast = useUiToast()
  const isEdit = !!plate
  const [form, setForm] = useState({
    plate: plate?.plate ?? '',
    category: plate?.category ?? 'AUTHORIZED',
    ownerName: plate?.ownerName ?? '',
    vehicleDescription: plate?.vehicleDescription ?? '',
    notes: plate?.notes ?? '',
    validFrom: plate?.validFrom ? plate.validFrom.slice(0, 10) : '',
    validUntil: plate?.validUntil ? plate.validUntil.slice(0, 10) : '',
    active: plate?.active ?? true,
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    const clean = form.plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (clean.length < 5) { toast.warning('Placa inválida'); return }
    setSaving(true)
    try {
      const body: any = {
        plate: clean,
        category: form.category,
        active: form.active,
      }
      if (form.ownerName) body.ownerName = form.ownerName
      if (form.vehicleDescription) body.vehicleDescription = form.vehicleDescription
      if (form.notes) body.notes = form.notes
      if (form.validFrom) body.validFrom = new Date(form.validFrom).toISOString()
      if (form.validUntil) body.validUntil = new Date(form.validUntil).toISOString()

      if (isEdit) await updatePlate(plate.id, body)
      else await createPlate(body)

      onSaved()
    } catch (err: any) {
      toast.error('Erro: ' + (err.response?.data?.error ?? err.message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-space-900 border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/5">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{isEdit ? 'Editar Placa' : 'Nova Placa'}</p>
            <p className="text-[10px] text-slate-500">Cadastro LPR</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-50 dark:bg-white/5 rounded text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Placa *</label>
            <input
              autoFocus
              value={form.plate}
              onChange={e => setForm({ ...form, plate: e.target.value.toUpperCase() })}
              placeholder="ABC1D23"
              maxLength={8}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-space-800/60 border border-slate-200 dark:border-white/10 text-center text-xl font-black font-mono text-slate-900 dark:text-white tracking-[0.2em] focus:border-amber-500/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Categoria</label>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {Object.entries(CATEGORY_STYLES).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setForm({ ...form, category: k })}
                  className={cn(
                    'px-2 py-1 rounded-md text-[10px] font-medium border transition flex items-center gap-1',
                    form.category === k ? `${v.bg} ${v.text}` : 'border-slate-200 dark:border-white/10 text-slate-500 hover:text-slate-200',
                  )}
                >
                  <v.icon className="w-3 h-3" />
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Proprietário</label>
              <input
                value={form.ownerName}
                onChange={e => setForm({ ...form, ownerName: e.target.value })}
                placeholder="Nome"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-space-800/60 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:border-amber-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Veículo</label>
              <input
                value={form.vehicleDescription}
                onChange={e => setForm({ ...form, vehicleDescription: e.target.value })}
                placeholder="Honda Civic preto"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-space-800/60 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:border-amber-500/50 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Válida de</label>
              <input
                type="date"
                value={form.validFrom}
                onChange={e => setForm({ ...form, validFrom: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-space-800/60 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:border-amber-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Válida até</label>
              <input
                type="date"
                value={form.validUntil}
                onChange={e => setForm({ ...form, validUntil: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-space-800/60 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:border-amber-500/50 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Notas</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-space-800/60 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:border-amber-500/50 focus:outline-none resize-none"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.active}
              onChange={e => setForm({ ...form, active: e.target.checked })}
              className="accent-amber-500"
            />
            <span className="text-sm text-slate-600 dark:text-slate-300">Placa ativa</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 dark:border-white/5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.plate.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 text-white text-xs font-semibold disabled:opacity-50 hover:opacity-90 transition"
          >
            <Check className="w-3.5 h-3.5" />
            {saving ? 'Salvando...' : (isEdit ? 'Salvar' : 'Cadastrar')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
