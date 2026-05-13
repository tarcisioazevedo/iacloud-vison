import { useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, UserPlus, Search, Upload, Trash2, ShieldAlert, ShieldCheck,
  Sparkles, X, Camera, Target, RefreshCw, Fingerprint, Check,
  AlertTriangle, Clock, ChevronRight, Tag,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PremiumHero } from '../components/hierarchy'
import { KpiCard } from '../components/cards/KpiCard'
import {
  useFaceIdentities, useFaceIdentity, useFaceEvents,
  createFaceIdentity, updateFaceIdentity, deleteFaceIdentity,
  enrollFace, deleteFaceEmbedding, matchFace,
} from '../api/client'
import { cn } from '../lib/utils'
import { ExportCsvButton } from '../components/ExportCsvButton'
import type { CsvColumn } from '../lib/csv'

// ──────────────────────────────────────────────────────────────
// Helpers

const CATEGORY_STYLES: Record<string, { label: string; bg: string; text: string; icon: any }> = {
  EMPLOYEE:  { label: 'Funcionário',  bg: 'bg-cyan-100 border-cyan-200 dark:bg-cyan-500/15 dark:border-cyan-500/30',   text: 'text-cyan-700 dark:text-cyan-400',   icon: ShieldCheck },
  VIP:       { label: 'VIP',           bg: 'bg-violet-100 border-violet-200 dark:bg-violet-500/15 dark:border-violet-500/30', text: 'text-violet-700 dark:text-violet-400', icon: Sparkles    },
  VISITOR:   { label: 'Visitante',     bg: 'bg-slate-100 border-slate-200 dark:bg-slate-500/15 dark:border-slate-500/30', text: 'text-slate-700 dark:text-slate-400',  icon: Users       },
  BLACKLIST: { label: 'Bloqueado',     bg: 'bg-rose-100 border-rose-200 dark:bg-rose-500/15 dark:border-rose-500/30',   text: 'text-rose-700 dark:text-rose-400',   icon: ShieldAlert  },
  WATCHLIST: { label: 'Monitorado',    bg: 'bg-amber-100 border-amber-200 dark:bg-amber-500/15 dark:border-amber-500/30', text: 'text-amber-700 dark:text-amber-400',  icon: AlertTriangle },
}

const DEFAULT_CATEGORY = { label: 'Desconhecido', bg: 'bg-slate-100 border-slate-200 dark:bg-slate-500/15 dark:border-slate-500/30', text: 'text-slate-700 dark:text-slate-400', icon: Users }

function formatRelative(iso: string) {
  const date = new Date(iso).getTime()
  const diff = Date.now() - date
  if (diff < 60_000) return 'agora'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ──────────────────────────────────────────────────────────────
// Main page

export function FacesPage() {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showMatch, setShowMatch] = useState(false)

  const { data: identitiesData, mutate } = useFaceIdentities(
    categoryFilter ? { category: categoryFilter } : undefined,
  )
  const identities: any[] = identitiesData?.items ?? identitiesData ?? []

  const filtered = useMemo(() => {
    if (!search) return identities
    const q = search.toLowerCase()
    return identities.filter(i =>
      i.name?.toLowerCase().includes(q) ||
      i.externalId?.toLowerCase().includes(q) ||
      i.notes?.toLowerCase().includes(q),
    )
  }, [identities, search])

  const stats = useMemo(() => {
    const byCat: Record<string, number> = {}
    let totalEmbeddings = 0
    for (const i of identities) {
      byCat[i.category] = (byCat[i.category] ?? 0) + 1
      totalEmbeddings += i._count?.embeddings ?? i.embeddings?.length ?? 0
    }
    return {
      total: identities.length,
      embeddings: totalEmbeddings,
      blacklist: byCat.BLACKLIST ?? 0,
      vip: (byCat.VIP ?? 0) + (byCat.EMPLOYEE ?? 0),
    }
  }, [identities])

  const csvColumns: CsvColumn<any>[] = [
    { header: 'ID',            accessor: i => i.id },
    { header: 'Nome',          accessor: i => i.name ?? '' },
    { header: 'ID externo',    accessor: i => i.externalId ?? '' },
    { header: 'Categoria',     accessor: i => i.category ?? '' },
    { header: 'Embeddings',    accessor: i => i._count?.embeddings ?? (i.embeddings?.length ?? 0) },
    { header: 'Notas',         accessor: i => i.notes ?? '' },
    { header: 'Cadastrada em', accessor: i => i.createdAt },
    { header: 'Ativa',         accessor: i => (i.active ?? true) ? 'sim' : 'não' },
  ]

  return (
    <div className="space-y-4">
      {/* Hero premium (Onda 6.F) */}
      <PremiumHero
        emoji="😊"
        title="Reconhecimento Facial"
        subtitle={`${filtered.length} identidade${filtered.length !== 1 ? 's' : ''} cadastrada${filtered.length !== 1 ? 's' : ''} · embeddings multimodais 1408D`}
        accent="cyan"
        tags={[
          { label: 'Vertex AI', color: 'violet' },
          { label: '1408D', color: 'cyan' },
          { label: 'GenAI', color: 'emerald' },
        ]}
      />

      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          <ExportCsvButton basename="identidades_faciais" rows={filtered} columns={csvColumns} />
          <button
            onClick={() => setShowMatch(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-100 border border-violet-200 text-violet-700 hover:bg-violet-200 dark:bg-violet-500/15 dark:border-violet-500/30 dark:text-violet-300 dark:hover:bg-violet-500/25 text-sm font-medium transition"
          >
            <Target className="w-4 h-4" />
            Testar Match
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 text-white hover:opacity-90 text-sm font-semibold shadow-cyan-glow transition"
          >
            <UserPlus className="w-4 h-4" />
            Nova Identidade
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard title="Identidades" value={stats.total} icon={<Users />}       accent="cyan"    delay={0.0} />
        <KpiCard title="Embeddings"   value={stats.embeddings} icon={<Fingerprint />} accent="violet" delay={0.1} />
        <KpiCard title="VIP/Funcion."  value={stats.vip}  icon={<Sparkles />}    accent="emerald" delay={0.2} />
        <KpiCard title="Bloqueados"   value={stats.blacklist} icon={<ShieldAlert />} accent="rose"    delay={0.3} />
      </div>

      {/* Filters */}
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, ID externo, notas..."
              className="w-full pl-10 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 dark:bg-space-800/60 dark:border-white/10 dark:text-white dark:placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCategoryFilter('')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                categoryFilter === ''
                  ? 'bg-cyan-100 border-cyan-300 text-cyan-700 dark:bg-cyan-500/20 dark:border-cyan-500/40 dark:text-cyan-300'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 dark:bg-space-800/40 dark:border-white/10 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              Todas
            </button>
            {Object.entries(CATEGORY_STYLES).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setCategoryFilter(k)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                  categoryFilter === k
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

      {/* Grid + Side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        <div>
          {filtered.length === 0 ? (
            <GlassCard className="p-12 text-center">
              <Users className="w-12 h-12 mx-auto text-slate-400 dark:text-slate-600 mb-3" />
              <p className="text-sm text-slate-600 dark:text-slate-400">Nenhuma identidade encontrada</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 text-xs font-semibold text-cyan-700 hover:text-cyan-900 dark:text-cyan-400 dark:hover:text-cyan-300"
              >
                Cadastrar primeira identidade →
              </button>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((i, idx) => (
                <IdentityCard
                  key={i.id}
                  identity={i}
                  delay={idx * 0.03}
                  selected={selectedId === i.id}
                  onSelect={() => setSelectedId(i.id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <IdentityDetail
            id={selectedId}
            onDeleted={() => { setSelectedId(null); mutate() }}
            onUpdate={() => mutate()}
          />
          <RecentMatches />
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showCreate && (
          <CreateIdentityModal
            onClose={() => setShowCreate(false)}
            onCreated={(id) => { setShowCreate(false); mutate(); setSelectedId(id) }}
          />
        )}
        {showMatch && <MatchTestModal onClose={() => setShowMatch(false)} />}
      </AnimatePresence>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Identity card

function IdentityCard({
  identity, delay, selected, onSelect,
}: { identity: any; delay: number; selected: boolean; onSelect: () => void }) {
  const cat = CATEGORY_STYLES[identity.category] ?? DEFAULT_CATEGORY
  const Icon = cat.icon
  const embeddings = identity._count?.embeddings ?? identity.embeddings?.length ?? 0
  const firstEmbedding = identity.embeddings?.[0]

  return (
    <GlassCard
      hover
      delay={delay}
      onClick={onSelect}
      className={cn(
        'p-4 transition',
        selected && 'ring-2 ring-cyan-500/40 border-cyan-500/40',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 dark:bg-space-800 dark:border-white/10 shrink-0 flex items-center justify-center">
          {firstEmbedding?.imageUrl ? (
            <img src={firstEmbedding.imageUrl} className="w-full h-full object-cover" />
          ) : (
            <Users className="w-6 h-6 text-slate-400 dark:text-slate-600" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{identity.name}</p>
              {identity.externalId && (
                <p className="text-[10px] font-mono text-slate-500 dark:text-slate-500 truncate">{identity.externalId}</p>
              )}
            </div>
            <div className={cn('shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-bold flex items-center gap-1', cat.bg, cat.text)}>
              <Icon className="w-3 h-3" />
              {cat.label}
            </div>
          </div>

          <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-500">
            <span className="flex items-center gap-1">
              <Fingerprint className="w-3 h-3" />
              {embeddings} amostras
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatRelative(identity.createdAt)}
            </span>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}

// ──────────────────────────────────────────────────────────────
// Identity detail

function IdentityDetail({
  id, onDeleted, onUpdate,
}: { id: string | null; onDeleted: () => void; onUpdate: () => void }) {
  const { data: identity, mutate } = useFaceIdentity(id)
  const [enrolling, setEnrolling] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!id) {
    return (
      <GlassCard className="p-6 text-center">
        <Target className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600 mb-2" />
        <p className="text-xs text-slate-500 dark:text-slate-500">Selecione uma identidade para ver os detalhes</p>
      </GlassCard>
    )
  }
  if (!identity) {
    return <GlassCard className="p-6"><div className="text-xs text-slate-500 dark:text-slate-500 animate-pulse">Carregando...</div></GlassCard>
  }

  const cat = CATEGORY_STYLES[identity.category] ?? DEFAULT_CATEGORY
  const Icon = cat.icon

  async function handleEnroll(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f || !id) return
    setEnrolling(true)
    try {
      const b64 = await fileToBase64(f)
      await enrollFace(id, b64)
      await mutate()
      onUpdate()
    } catch (err: any) {
      alert('Falha no enroll: ' + (err.response?.data?.error ?? err.message))
    } finally {
      setEnrolling(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDeleteEmbedding(embId: string) {
    if (!confirm('Remover esta amostra?')) return
    await deleteFaceEmbedding(embId)
    mutate()
  }

  async function handleDelete() {
    if (!confirm(`Excluir a identidade "${identity.name}" e todas as amostras?`)) return
    await deleteFaceIdentity(identity.id)
    onDeleted()
  }

  async function handleCategoryChange(cat: string) {
    await updateFaceIdentity(identity.id, { category: cat })
    mutate()
    onUpdate()
  }

  return (
    <GlassCard className="p-5" glow="cyan">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-slate-900 dark:text-white truncate">{identity.name}</p>
          {identity.externalId && (
            <p className="text-[10px] font-mono text-slate-500 dark:text-slate-500 truncate">{identity.externalId}</p>
          )}
        </div>
        <div className={cn('shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-bold flex items-center gap-1', cat.bg, cat.text)}>
          <Icon className="w-3 h-3" />
          {cat.label}
        </div>
      </div>

      {identity.notes && (
        <p className="text-xs text-slate-700 dark:text-slate-400 mb-4 p-2 rounded-lg bg-slate-50 border border-slate-200 dark:bg-space-800/40 dark:border-white/5">{identity.notes}</p>
      )}

      {/* Category change */}
      <div className="mb-4">
        <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider">Categoria</label>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {Object.entries(CATEGORY_STYLES).map(([k, v]) => (
            <button
              key={k}
              onClick={() => handleCategoryChange(k)}
              className={cn(
                'px-2 py-1 rounded-md text-[10px] font-medium border transition',
                identity.category === k ? `${v.bg} ${v.text}` : 'border-slate-200 text-slate-500 hover:text-slate-900 dark:border-white/10 dark:text-slate-500 dark:hover:text-slate-200',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Embeddings grid */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider">
            Amostras ({identity.embeddings?.length ?? 0})
          </label>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={enrolling}
            className="text-[10px] font-semibold text-cyan-700 hover:text-cyan-900 dark:text-cyan-400 dark:hover:text-cyan-300 flex items-center gap-1 disabled:opacity-50"
          >
            {enrolling ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            {enrolling ? 'Processando...' : 'Adicionar foto'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleEnroll} className="hidden" />
        </div>

        {(!identity.embeddings || identity.embeddings.length === 0) ? (
          <div className="p-4 rounded-lg border border-dashed border-slate-300 dark:border-white/10 text-center text-[10px] text-slate-500 dark:text-slate-500">
            Nenhuma amostra cadastrada. Faça upload de uma foto para gerar o embedding.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {identity.embeddings.map((e: any) => (
              <div key={e.id} className="relative group aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200 dark:bg-space-800 dark:border-white/10">
                {e.imageUrl ? (
                  <img src={e.imageUrl} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Fingerprint className="w-5 h-5 text-slate-400 dark:text-slate-600" />
                  </div>
                )}
                <button
                  onClick={() => handleDeleteEmbedding(e.id)}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded bg-rose-500/80 text-white hover:bg-rose-500 transition"
                >
                  <X className="w-3 h-3" />
                </button>
                {e.quality !== undefined && (
                  <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white text-center py-0.5 font-mono">
                    Q: {(e.quality * 100).toFixed(0)}%
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={handleDelete}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-rose-100 border border-rose-200 text-rose-700 hover:bg-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 dark:hover:bg-rose-500/20 text-xs font-medium transition"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Excluir identidade
      </button>
    </GlassCard>
  )
}

// ──────────────────────────────────────────────────────────────
// Recent matches (events)

function RecentMatches() {
  const { data } = useFaceEvents({ limit: '10' })
  const events: any[] = data?.items ?? data ?? []

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-violet-700 dark:text-violet-400" />
          Matches recentes
        </p>
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-500 text-center py-4">Nenhum evento registrado</p>
      ) : (
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
          {events.map((ev: any) => {
            const cat = CATEGORY_STYLES[ev.identity?.category ?? ''] ?? DEFAULT_CATEGORY
            const scorePct = Math.round((ev.score ?? 0) * 100)
            return (
              <div
                key={ev.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-300 dark:bg-space-800/40 dark:border-white/5 dark:hover:border-slate-200 dark:border-white/10 transition"
              >
                <div className={cn('w-7 h-7 rounded-md flex items-center justify-center shrink-0', cat.bg)}>
                  <Fingerprint className={cn('w-3.5 h-3.5', cat.text)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{ev.identity?.name ?? 'Desconhecido'}</p>
                  <p className="text-[9px] font-mono text-slate-500 dark:text-slate-500 truncate">
                    {ev.camera?.name ?? '—'} · {formatRelative(ev.capturedAt)}
                  </p>
                </div>
                <span className={cn(
                  'text-[10px] font-bold font-mono px-1.5 py-0.5 rounded',
                  scorePct >= 85 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' :
                  scorePct >= 70 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' :
                  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
                )}>
                  {scorePct}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </GlassCard>
  )
}

// ──────────────────────────────────────────────────────────────
// Create identity modal

function CreateIdentityModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({
    name: '', externalId: '', category: 'EMPLOYEE', notes: '',
  })
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function handleFile(f: File) {
    setFile(f)
    const url = URL.createObjectURL(f)
    setPreview(url)
  }

  async function handleSubmit() {
    if (!form.name.trim()) { alert('Nome é obrigatório'); return }
    setSaving(true)
    try {
      const identity = await createFaceIdentity(form)
      if (file) {
        const b64 = await fileToBase64(file)
        await enrollFace(identity.id, b64)
      }
      onCreated(identity.id)
    } catch (err: any) {
      alert('Erro: ' + (err.response?.data?.error ?? err.message))
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
        className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 dark:bg-space-900 dark:border-white/10 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/5">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">Nova Identidade</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-500">Vertex AI + embedding multimodal</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 rounded text-slate-600 dark:text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider">Nome *</label>
            <input
              autoFocus
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="João Silva"
              className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 dark:bg-space-800/60 dark:border-white/10 dark:text-white dark:placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider">ID Externo</label>
              <input
                value={form.externalId}
                onChange={e => setForm({ ...form, externalId: e.target.value })}
                placeholder="EMP-00123"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 dark:bg-space-800/60 dark:border-white/10 dark:text-white dark:placeholder-slate-500 font-mono focus:border-cyan-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider">Categoria</label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-900 dark:bg-space-800/60 dark:border-white/10 dark:text-white focus:border-cyan-500/50 focus:outline-none"
              >
                {Object.entries(CATEGORY_STYLES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider">Notas</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Observações internas"
              className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 dark:bg-space-800/60 dark:border-white/10 dark:text-white dark:placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none resize-none"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider">Foto inicial (opcional)</label>
            <div className="mt-1 flex items-center gap-3">
              {preview ? (
                <div className="relative">
                  <img src={preview} className="w-20 h-20 rounded-lg object-cover border border-slate-200 dark:border-white/10" />
                  <button
                    onClick={() => { setFile(null); setPreview(null) }}
                    className="absolute -top-1 -right-1 p-0.5 rounded-full bg-rose-500 text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <label className="w-20 h-20 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-white/15 text-slate-500 hover:text-slate-900 hover:border-slate-400 dark:text-slate-500 dark:hover:text-slate-600 dark:text-slate-300 dark:hover:border-white/30 cursor-pointer transition">
                  <Upload className="w-4 h-4 mb-1" />
                  <span className="text-[9px]">Upload</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                    className="hidden"
                  />
                </label>
              )}
              <p className="text-[10px] text-slate-500 dark:text-slate-500">
                JPG, PNG. Rosto centralizado, boa iluminação.<br />
                Vertex gera um vetor 1408D L2-normalizado.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 dark:border-white/5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.name.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-white text-xs font-semibold shadow-cyan-glow disabled:opacity-50 hover:opacity-90 transition"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {saving ? 'Cadastrando...' : 'Cadastrar'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ──────────────────────────────────────────────────────────────
// Match test modal

function MatchTestModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [results, setResults] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [topK, setTopK] = useState(5)
  const [minScore, setMinScore] = useState(0.65)

  function handleFile(f: File) {
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setResults(null)
  }

  async function handleRun() {
    if (!file) return
    setLoading(true)
    try {
      const b64 = await fileToBase64(file)
      const clienteFinalId = localStorage.getItem('icv_clienteFinalId') ?? ''
      const res = await matchFace({ imageBase64: b64, clienteFinalId, topK, minScore })
      setResults(res.matches ?? [])
    } catch (err: any) {
      alert('Erro: ' + (err.response?.data?.error ?? err.message))
    } finally {
      setLoading(false)
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
        className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 dark:bg-space-900 dark:border-white/10 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/5">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Target className="w-4 h-4 text-violet-700 dark:text-violet-400" />
              Teste de Match Facial
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-500">Vertex AI · cosine similarity · top-K</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 rounded text-slate-600 dark:text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-5">
          {/* Input */}
          <div className="space-y-3">
            {preview ? (
              <div className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-white/10">
                <img src={preview} className="w-full h-full object-cover" />
                <button
                  onClick={() => { setFile(null); setPreview(null); setResults(null) }}
                  className="absolute top-2 right-2 p-1 rounded-full bg-rose-500/80 text-white hover:bg-rose-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center aspect-square rounded-xl border border-dashed border-slate-300 dark:border-white/15 text-slate-500 hover:text-slate-900 hover:border-slate-400 dark:text-slate-500 dark:hover:text-slate-600 dark:text-slate-300 dark:hover:border-white/30 cursor-pointer transition">
                <Camera className="w-8 h-8 mb-2" />
                <span className="text-xs font-medium">Selecione uma imagem</span>
                <span className="text-[9px] mt-1 opacity-60">JPG / PNG</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                  className="hidden"
                />
              </label>
            )}

            <div>
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider flex items-center justify-between">
                Top K <span className="text-cyan-700 dark:text-cyan-400 font-mono">{topK}</span>
              </label>
              <input
                type="range" min={1} max={20} value={topK}
                onChange={e => setTopK(Number(e.target.value))}
                className="w-full mt-1 accent-cyan-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider flex items-center justify-between">
                Score mínimo <span className="text-cyan-700 dark:text-cyan-400 font-mono">{minScore.toFixed(2)}</span>
              </label>
              <input
                type="range" min={0.4} max={0.99} step={0.01} value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                className="w-full mt-1 accent-cyan-500"
              />
            </div>

            <button
              onClick={handleRun}
              disabled={!file || loading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-white text-xs font-semibold shadow-cyan-glow disabled:opacity-50 hover:opacity-90 transition"
            >
              {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
              {loading ? 'Analisando...' : 'Buscar matches'}
            </button>
          </div>

          {/* Results */}
          <div className="min-h-[320px]">
            <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider mb-2">
              Resultados {results && `(${results.length})`}
            </p>
            {!results ? (
              <div className="flex items-center justify-center h-[320px] rounded-xl border border-dashed border-slate-300 dark:border-white/10 text-center">
                <p className="text-xs text-slate-500 dark:text-slate-500">Suba uma imagem e clique em "Buscar matches"</p>
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[320px] rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/5 text-center">
                <AlertTriangle className="w-8 h-8 text-rose-700 dark:text-rose-400 mb-2" />
                <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">Nenhum match acima do score mínimo</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-1">Tente reduzir o score mínimo ou cadastrar mais amostras</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                {results.map((r: any, idx: number) => {
                  const cat = CATEGORY_STYLES[r.identity?.category ?? ''] ?? DEFAULT_CATEGORY
                  const Icon = cat.icon
                  const pct = Math.round(r.score * 100)
                  return (
                    <motion.div
                      key={r.embeddingId}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.04 }}
                      className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200 dark:bg-space-800/50 dark:border-white/10"
                    >
                      <div className={cn('w-9 h-9 rounded-lg border flex items-center justify-center shrink-0', cat.bg)}>
                        <Icon className={cn('w-4 h-4', cat.text)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{r.identity?.name ?? '—'}</p>
                        <p className="text-[10px] font-mono text-slate-500 dark:text-slate-500 truncate">{r.identity?.externalId ?? '—'}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={cn(
                          'text-sm font-bold font-mono',
                          pct >= 85 ? 'text-emerald-700 dark:text-emerald-400' :
                          pct >= 70 ? 'text-amber-700 dark:text-amber-400' : 'text-rose-700 dark:text-rose-400',
                        )}>{pct}%</div>
                        <div className="text-[9px] text-slate-500 dark:text-slate-500">{cat.label}</div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
