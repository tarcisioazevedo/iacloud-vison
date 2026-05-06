/**
 * AdminWhitelabelTiersPage — SUPER_ADMIN gerencia tier + capabilities por integrador.
 *
 * v2 (2026-05-06):
 *   - Filtros: busca por nome/email, filtro por tier, filtro por capability
 *   - Toggle Cards / Lista
 *   - Drill-down modal com detalhes (audit log, deals, clientes)
 *   - Botões de tier props-driven (re-render correto após mutate)
 *   - Cards de defaults com gradient match
 */
import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Palette, AlertCircle, Check, X, Crown, ExternalLink, DollarSign, RefreshCw,
  Search, LayoutGrid, List, Filter, Eye, Calendar, Users, ChevronRight,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'
import {
  api, useWhitelabelList,
  type WhitelabelTier, type WhitelabelCapabilities, type WhitelabelStatus,
} from '../api/client'

const TIERS: WhitelabelTier[] = ['NONE', 'BASIC', 'PRO', 'ENTERPRISE']

const TIER_STYLES: Record<WhitelabelTier, { badge: string; gradient: string; border: string; ring: string }> = {
  NONE: {
    badge: 'bg-slate-200 dark:bg-space-800 text-slate-500 border border-slate-300 dark:border-white/10',
    gradient: 'bg-gradient-to-br from-slate-500/10 to-transparent',
    border: 'border-slate-300 dark:border-white/10',
    ring: 'ring-slate-400',
  },
  BASIC: {
    badge: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30',
    gradient: 'bg-gradient-to-br from-cyan-500/15 via-cyan-500/5 to-transparent',
    border: 'border-cyan-500/30',
    ring: 'ring-cyan-500',
  },
  PRO: {
    badge: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30',
    gradient: 'bg-gradient-to-br from-violet-500/15 via-violet-500/5 to-transparent',
    border: 'border-violet-500/30',
    ring: 'ring-violet-500',
  },
  ENTERPRISE: {
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
    gradient: 'bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent',
    border: 'border-amber-500/30',
    ring: 'ring-amber-500',
  },
}

const CAP_LABELS: Record<keyof WhitelabelCapabilities, { title: string; emoji: string; hint: string }> = {
  branding: { title: 'Branding', emoji: '🎨', hint: 'Logo + cores próprias' },
  domain: { title: 'Domínio', emoji: '🌐', hint: 'Subdomínio ou domínio próprio' },
  pricing: { title: 'Pricing', emoji: '💰', hint: 'Planos próprios (override do master)' },
  email: { title: 'E-mail', emoji: '📧', hint: 'SMTP próprio (Fase 2)' },
  clientCustomization: { title: 'Cascade Cliente', emoji: '👥', hint: 'Cliente final customiza (Modelo D)' },
}

type ViewMode = 'cards' | 'list'

export function AdminWhitelabelTiersPage() {
  const { data: integradores, mutate, isLoading, error } = useWhitelabelList()
  const [editing, setEditing] = useState<string | null>(null)
  const [drilling, setDrilling] = useState<WhitelabelStatus | null>(null)

  // Filtros
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<WhitelabelTier | 'ALL'>('ALL')
  const [capFilter, setCapFilter] = useState<keyof WhitelabelCapabilities | 'ALL'>('ALL')
  const [view, setView] = useState<ViewMode>('cards')

  const filtered = useMemo(() => {
    if (!integradores) return []
    return integradores.filter(i => {
      // busca por nome/email/tradeName
      if (search) {
        const s = search.toLowerCase()
        const hay = `${i.name} ${i.tradeName ?? ''} ${i.email}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      if (tierFilter !== 'ALL' && i.whitelabelTier !== tierFilter) return false
      if (capFilter !== 'ALL' && !i.capabilitiesResolved[capFilter]) return false
      return true
    })
  }, [integradores, search, tierFilter, capFilter])

  const summary = useMemo(() => {
    if (!integradores) return { total: 0, byTier: { NONE: 0, BASIC: 0, PRO: 0, ENTERPRISE: 0 } as Record<WhitelabelTier, number> }
    return {
      total: integradores.length,
      byTier: TIERS.reduce(
        (acc, t) => ({ ...acc, [t]: integradores.filter(i => i.whitelabelTier === t).length }),
        {} as Record<WhitelabelTier, number>,
      ),
    }
  }, [integradores])

  return (
    <div className="space-y-4">
      {/* Header */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg">
              <Palette className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">White-label · Gestão do Canal</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Cada integrador tem um tier comercial (NONE/BASIC/PRO/ENTERPRISE).
                Capabilities granulares são derivadas do tier mas podem ser sobrescritas individualmente.
              </p>
            </div>
          </div>
          <Link to="/admin/pricing" className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold whitespace-nowrap">
            <DollarSign className="w-3.5 h-3.5" /> Pricing CMS
          </Link>
        </div>
      </GlassCard>

      {/* KPIs por tier */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KpiCard label="Total integradores" value={summary.total} active={tierFilter === 'ALL'} onClick={() => setTierFilter('ALL')} />
        {TIERS.map(t => (
          <KpiCard
            key={t}
            label={t}
            value={summary.byTier[t]}
            tier={t}
            active={tierFilter === t}
            onClick={() => setTierFilter(tierFilter === t ? 'ALL' : t)}
          />
        ))}
      </div>

      {/* Defaults por tier — cards preenchidos */}
      <GlassCard className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Defaults de capability por tier
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TIERS.map(t => (
            <div key={t} className={cn(
              'p-4 rounded-xl border transition',
              TIER_STYLES[t].gradient,
              TIER_STYLES[t].border,
              tierFilter === t && cn('ring-2 ring-offset-2 ring-offset-slate-50 dark:ring-offset-space-900', TIER_STYLES[t].ring),
            )}>
              <div className="flex items-center gap-2 mb-3">
                <span className={cn('px-2 py-0.5 rounded-full font-mono text-[10px]', TIER_STYLES[t].badge)}>{t}</span>
                {t === 'PRO' && <Crown className="w-3.5 h-3.5 text-violet-500" />}
                {t === 'ENTERPRISE' && <Crown className="w-3.5 h-3.5 text-amber-500" />}
              </div>
              <p className="text-[10px] text-slate-700 dark:text-slate-300 leading-relaxed mb-3 min-h-[36px]">
                {t === 'NONE' && 'Sem white-label. Marca IACV.'}
                {t === 'BASIC' && 'Branding (logo + cores).'}
                {t === 'PRO' && 'Branding + Domínio + Pricing + Email.'}
                {t === 'ENTERPRISE' && 'PRO + Cliente final customiza (cascade Modelo D).'}
              </p>
              <div className="flex flex-wrap gap-1">
                {tierDefaultCaps(t).map(k => (
                  <span key={k} className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                    {CAP_LABELS[k].emoji}
                  </span>
                ))}
                {tierDefaultCaps(t).length === 0 && <span className="text-[9px] text-slate-400 italic">nenhuma</span>}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Toolbar — busca + filtros + view toggle */}
      <GlassCard className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Buscar por nome, email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-50 dark:bg-space-800 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] font-semibold text-slate-500 uppercase">Capability</span>
            <select
              value={capFilter}
              onChange={e => setCapFilter(e.target.value as any)}
              className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-space-800 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white focus:border-cyan-400 focus:outline-none"
            >
              <option value="ALL">Todas</option>
              {(Object.keys(CAP_LABELS) as (keyof WhitelabelCapabilities)[]).map(k => (
                <option key={k} value={k}>{CAP_LABELS[k].title}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-space-800 border border-slate-200 dark:border-white/10">
            <button
              onClick={() => setView('cards')}
              title="Cards"
              className={cn('p-1.5 rounded transition', view === 'cards'
                ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white')}
            ><LayoutGrid className="w-3.5 h-3.5" /></button>
            <button
              onClick={() => setView('list')}
              title="Lista"
              className={cn('p-1.5 rounded transition', view === 'list'
                ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white')}
            ><List className="w-3.5 h-3.5" /></button>
          </div>

          {(search || tierFilter !== 'ALL' || capFilter !== 'ALL') && (
            <button
              onClick={() => { setSearch(''); setTierFilter('ALL'); setCapFilter('ALL') }}
              className="px-2 py-1 rounded-lg text-[10px] text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10"
            >
              <X className="w-3 h-3 inline" /> Limpar filtros
            </button>
          )}

          <span className="text-[11px] text-slate-500 ml-auto">
            {filtered.length}{filtered.length !== summary.total && <> de {summary.total}</>} integradores
          </span>
        </div>
      </GlassCard>

      {isLoading && <GlassCard className="p-6 text-center text-sm text-slate-500">Carregando…</GlassCard>}
      {error && (
        <GlassCard className="p-6 text-center">
          <AlertCircle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
          <p className="text-sm text-rose-600 dark:text-rose-400">Falha ao carregar integradores.</p>
        </GlassCard>
      )}

      {filtered.length === 0 && !isLoading && (
        <GlassCard className="p-8 text-center">
          <Search className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Nenhum integrador com os filtros atuais.</p>
        </GlassCard>
      )}

      {/* Cards view */}
      {view === 'cards' && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(i => (
            <IntegradorCard
              key={i.id}
              integ={i}
              isEditing={editing === i.id}
              onEdit={() => setEditing(editing === i.id ? null : i.id)}
              onDrill={() => setDrilling(i)}
              onChange={() => mutate()}
            />
          ))}
        </div>
      )}

      {/* List view */}
      {view === 'list' && filtered.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-space-800/60 text-slate-500">
              <tr>
                <th className="text-left p-3 font-semibold">Integrador</th>
                <th className="text-center p-3 font-semibold">Tier</th>
                <th className="text-center p-3 font-semibold">Capabilities</th>
                <th className="text-center p-3 font-semibold">Clientes</th>
                <th className="text-center p-3 font-semibold">Domínio</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(i => <IntegradorRow key={i.id} integ={i} onChange={() => mutate()} onDrill={() => setDrilling(i)} />)}
            </tbody>
          </table>
        </GlassCard>
      )}

      {drilling && <DrillModal integ={drilling} onClose={() => setDrilling(null)} onChange={() => mutate()} />}
    </div>
  )
}

function tierDefaultCaps(tier: WhitelabelTier): (keyof WhitelabelCapabilities)[] {
  const all = ['branding', 'domain', 'pricing', 'email', 'clientCustomization'] as (keyof WhitelabelCapabilities)[]
  if (tier === 'NONE') return []
  if (tier === 'BASIC') return ['branding']
  if (tier === 'PRO') return ['branding', 'domain', 'pricing', 'email']
  return all
}

function KpiCard({ label, value, tier, active, onClick }: {
  label: string; value: number; tier?: WhitelabelTier
  active?: boolean; onClick?: () => void
}) {
  const style = tier ? TIER_STYLES[tier] : null
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-3 rounded-xl border text-left transition cursor-pointer',
        style ? cn(style.gradient, style.border) : 'border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-space-900/40',
        active && 'ring-2 ring-offset-2 ring-offset-slate-50 dark:ring-offset-space-900',
        active && (style ? style.ring : 'ring-slate-400'),
        'hover:scale-[1.02]',
      )}
    >
      <p className="text-[10px] uppercase font-semibold text-slate-500">{label}</p>
      <p className={cn('text-2xl font-bold mt-1',
        tier === 'BASIC' && 'text-cyan-600 dark:text-cyan-400',
        tier === 'PRO' && 'text-violet-600 dark:text-violet-400',
        tier === 'ENTERPRISE' && 'text-amber-600 dark:text-amber-400',
        tier === 'NONE' && 'text-slate-500',
        !tier && 'text-slate-900 dark:text-white',
      )}>{value}</p>
    </button>
  )
}

// ─── CARD VIEW ──────────────────────────────────────────────────────────
function IntegradorCard({ integ, isEditing, onEdit, onDrill, onChange }: {
  integ: WhitelabelStatus
  isEditing: boolean
  onEdit: () => void
  onDrill: () => void
  onChange: () => void
}) {
  return (
    <GlassCard className={cn('p-4', TIER_STYLES[integ.whitelabelTier].gradient)}>
      <CardHeader integ={integ} onDrill={onDrill} onEdit={onEdit} isEditing={isEditing} />
      <CapsBadges integ={integ} />
      {isEditing && <EditPanel integ={integ} onChange={onChange} />}
    </GlassCard>
  )
}

function CardHeader({ integ, onDrill, onEdit, isEditing }: {
  integ: WhitelabelStatus; onDrill: () => void; onEdit: () => void; isEditing: boolean
}) {
  const explicit = integ.whitelabelCapabilities ?? {}
  const hasOverrides = Object.keys(explicit).length > 0

  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{integ.tradeName ?? integ.name}</p>
          <span className={cn('px-2 py-0.5 rounded-full font-mono text-[10px]', TIER_STYLES[integ.whitelabelTier].badge)}>
            {integ.whitelabelTier}
          </span>
          {hasOverrides && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[9px] font-semibold border border-amber-500/30">
              override
            </span>
          )}
          {!integ.active && (
            <span className="px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-400 text-[9px] font-semibold border border-rose-500/30">
              suspenso
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-500">{integ.email}</p>
        {integ.cfSubdomain && (
          <p className="text-[10px] text-cyan-600 dark:text-brand-sky font-mono mt-0.5">
            <ExternalLink className="w-2.5 h-2.5 inline" /> {integ.cfSubdomain}.iacloud.com.br
          </p>
        )}
        {integ.clientesFinaisCount !== undefined && (
          <p className="text-[10px] text-slate-500 mt-0.5">
            <Users className="w-2.5 h-2.5 inline" /> {integ.clientesFinaisCount} cliente{integ.clientesFinaisCount === 1 ? '' : 's'}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button
          onClick={onDrill}
          title="Ver detalhes"
          className="p-1.5 rounded-lg border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onEdit}
          className="px-3 py-1 rounded-lg text-[10px] font-semibold border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5"
        >
          {isEditing ? 'Fechar' : 'Editar'}
        </button>
      </div>
    </div>
  )
}

function CapsBadges({ integ }: { integ: WhitelabelStatus }) {
  const resolved = integ.capabilitiesResolved
  const activeCount = Object.values(resolved).filter(Boolean).length
  return (
    <>
      <div className="flex flex-wrap gap-1 mb-2">
        {(Object.keys(CAP_LABELS) as (keyof WhitelabelCapabilities)[]).map(k => (
          <span key={k} className={cn(
            'px-2 py-0.5 rounded-full text-[10px] font-mono',
            resolved[k]
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
              : 'bg-slate-100 dark:bg-space-800 text-slate-400 border border-slate-200 dark:border-white/10',
          )}>
            {resolved[k] ? '✓' : '✗'} {CAP_LABELS[k].title}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-slate-500">{activeCount}/5 capabilities ativas</p>
    </>
  )
}

// ─── EDIT PANEL — botões de tier funcionando, props-driven ─────────────
function EditPanel({ integ, onChange }: { integ: WhitelabelStatus; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  async function saveTier(newTier: WhitelabelTier) {
    if (newTier === integ.whitelabelTier) return  // já está nesse tier
    setBusy(true); setErr(null); setOkMsg(null)
    try {
      await api.put(`/admin/whitelabel/${integ.id}/tier`, { tier: newTier })
      setOkMsg(`Tier alterado para ${newTier}`)
      onChange()
      setTimeout(() => setOkMsg(null), 2500)
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e.message)
    } finally { setBusy(false) }
  }
  async function patchCap(cap: keyof WhitelabelCapabilities, value: boolean) {
    setBusy(true); setErr(null); setOkMsg(null)
    try {
      await api.patch(`/admin/whitelabel/${integ.id}/capabilities`, { [cap]: value })
      setOkMsg(`${CAP_LABELS[cap].title} → ${value ? 'ON' : 'OFF'}`)
      onChange()
      setTimeout(() => setOkMsg(null), 2000)
    } catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }
  async function resetCaps() {
    if (!confirm('Resetar capabilities para defaults do tier?')) return
    setBusy(true); setErr(null); setOkMsg(null)
    try {
      await api.delete(`/admin/whitelabel/${integ.id}/capabilities`)
      setOkMsg('Capabilities resetadas pros defaults')
      onChange()
      setTimeout(() => setOkMsg(null), 2500)
    } catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setBusy(false) }
  }

  const explicit = (integ.whitelabelCapabilities ?? {}) as Partial<WhitelabelCapabilities>
  const hasOverrides = Object.keys(explicit).length > 0

  return (
    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/10 space-y-4">
      {okMsg && (
        <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs">
          <Check className="w-3 h-3 inline mr-1" />{okMsg}
        </div>
      )}

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Tier comercial {busy && <RefreshCw className="w-3 h-3 inline animate-spin ml-1" />}
        </p>
        <div className="grid grid-cols-4 gap-1">
          {TIERS.map(t => {
            const isCurrent = integ.whitelabelTier === t
            return (
              <button
                key={t}
                disabled={busy}
                onClick={() => saveTier(t)}
                className={cn(
                  'px-3 py-2 rounded-lg text-[11px] font-semibold transition disabled:opacity-50',
                  isCurrent
                    ? cn(TIER_STYLES[t].badge, 'ring-2 ring-offset-1 ring-offset-slate-50 dark:ring-offset-space-900', TIER_STYLES[t].ring)
                    : 'bg-slate-100 dark:bg-space-800 text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10',
                )}
              >
                {isCurrent && <Check className="w-3 h-3 inline mr-0.5" />}
                {t}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Override granular</p>
          <button
            onClick={resetCaps}
            disabled={busy || !hasOverrides}
            className="text-[10px] text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
          >
            <RefreshCw className="w-3 h-3 inline mr-1" />Reset (defaults do tier)
          </button>
        </div>
        <div className="space-y-1">
          {(Object.keys(CAP_LABELS) as (keyof WhitelabelCapabilities)[]).map(k => {
            const final = integ.capabilitiesResolved[k]
            const isOverridden = explicit[k] !== undefined
            return (
              <div key={k} className="flex items-center justify-between p-2 rounded border border-slate-200 dark:border-white/10">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    {CAP_LABELS[k].emoji} {CAP_LABELS[k].title}
                    {isOverridden && <span className="ml-1 text-[9px] text-amber-500">override</span>}
                  </p>
                  <p className="text-[10px] text-slate-500">{CAP_LABELS[k].hint}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button disabled={busy} onClick={() => patchCap(k, true)} className={cn(
                    'px-2 py-1 rounded text-[10px] font-mono transition',
                    final
                      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40'
                      : 'border border-slate-200 dark:border-white/10 text-slate-500 hover:text-emerald-700',
                  )}><Check className="w-3 h-3 inline" /></button>
                  <button disabled={busy} onClick={() => patchCap(k, false)} className={cn(
                    'px-2 py-1 rounded text-[10px] font-mono transition',
                    !final
                      ? 'bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-500/40'
                      : 'border border-slate-200 dark:border-white/10 text-slate-500 hover:text-rose-700',
                  )}><X className="w-3 h-3 inline" /></button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {err && <div className="p-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}
    </div>
  )
}

// ─── LIST VIEW ──────────────────────────────────────────────────────────
function IntegradorRow({ integ, onChange, onDrill }: {
  integ: WhitelabelStatus; onChange: () => void; onDrill: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function saveTier(newTier: WhitelabelTier) {
    if (newTier === integ.whitelabelTier) return
    setBusy(true)
    try { await api.put(`/admin/whitelabel/${integ.id}/tier`, { tier: newTier }); onChange() }
    catch { /* noop */ }
    finally { setBusy(false) }
  }

  const resolved = integ.capabilitiesResolved
  const activeCount = Object.values(resolved).filter(Boolean).length
  const explicit = integ.whitelabelCapabilities ?? {}
  const hasOverrides = Object.keys(explicit).length > 0

  return (
    <tr className="border-t border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
      <td className="p-3">
        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate max-w-[200px]">{integ.tradeName ?? integ.name}</p>
        <p className="text-[10px] text-slate-500">{integ.email}</p>
        {!integ.active && <span className="text-[9px] text-rose-600 dark:text-rose-400">suspenso</span>}
      </td>
      <td className="p-2">
        <select
          disabled={busy}
          value={integ.whitelabelTier}
          onChange={e => saveTier(e.target.value as WhitelabelTier)}
          className={cn(
            'px-2 py-1 rounded font-mono text-[10px] font-semibold border focus:outline-none focus:ring-2 cursor-pointer disabled:opacity-50',
            TIER_STYLES[integ.whitelabelTier].badge,
            TIER_STYLES[integ.whitelabelTier].ring,
          )}
        >
          {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {hasOverrides && <span className="block text-[9px] text-amber-500 mt-0.5">override</span>}
      </td>
      <td className="p-3">
        <div className="flex items-center justify-center gap-0.5">
          {(Object.keys(CAP_LABELS) as (keyof WhitelabelCapabilities)[]).map(k => (
            <span
              key={k}
              title={`${CAP_LABELS[k].title}: ${resolved[k] ? 'ON' : 'OFF'}`}
              className={cn(
                'w-6 h-6 rounded text-xs flex items-center justify-center',
                resolved[k]
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-100 dark:bg-space-800 text-slate-400 border border-slate-200 dark:border-white/10',
              )}
            >{CAP_LABELS[k].emoji}</span>
          ))}
        </div>
        <p className="text-[9px] text-slate-500 text-center mt-1">{activeCount}/5</p>
      </td>
      <td className="p-3 text-center font-mono">{integ.clientesFinaisCount ?? '—'}</td>
      <td className="p-3 text-center text-[10px] text-cyan-600 dark:text-brand-sky font-mono">
        {integ.cfSubdomain ? `${integ.cfSubdomain}.iacloud.com.br` : '—'}
      </td>
      <td className="p-3 text-right">
        <button
          onClick={onDrill}
          className="px-2 py-1 rounded text-[10px] border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5"
        >
          <ChevronRight className="w-3 h-3 inline" /> Detalhes
        </button>
      </td>
    </tr>
  )
}

// ─── DRILL-DOWN MODAL ──────────────────────────────────────────────────
function DrillModal({ integ, onClose, onChange }: {
  integ: WhitelabelStatus; onClose: () => void; onChange: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-3xl mt-8 bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl">
        <div className={cn('p-5 rounded-t-2xl flex items-start justify-between gap-3', TIER_STYLES[integ.whitelabelTier].gradient)}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{integ.tradeName ?? integ.name}</h3>
              <span className={cn('px-2 py-0.5 rounded-full font-mono text-[10px]', TIER_STYLES[integ.whitelabelTier].badge)}>
                {integ.whitelabelTier}
              </span>
            </div>
            <p className="text-xs text-slate-500">{integ.email}</p>
            {integ.cfSubdomain && (
              <a href={`https://${integ.cfSubdomain}.iacloud.com.br/pricing`} target="_blank" rel="noreferrer"
                className="text-xs text-cyan-600 dark:text-brand-sky font-mono mt-1 inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> {integ.cfSubdomain}.iacloud.com.br/pricing
              </a>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Resumo</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="Clientes finais" value={integ.clientesFinaisCount ?? 0} icon={Users} />
              <Stat label="Capabilities ativas" value={`${Object.values(integ.capabilitiesResolved).filter(Boolean).length}/5`} />
              <Stat label="Override?" value={Object.keys(integ.whitelabelCapabilities ?? {}).length > 0 ? 'sim' : 'não'} />
              <Stat label="Status" value={integ.active ? 'ativo' : 'suspenso'} tone={integ.active ? 'emerald' : 'rose'} />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Edição completa</p>
            <EditPanel integ={integ} onChange={onChange} />
          </div>

          <div className="flex gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
            <Link to={`/admin/tenants/${integ.id}`} className="flex-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold text-center">
              Cockpit do Tenant
            </Link>
            <Link to={`/audit?integradorId=${integ.id}`} className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs font-semibold text-center hover:bg-slate-100 dark:hover:bg-white/5">
              Audit log
            </Link>
            <Link to="/health-scores" className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs font-semibold text-center hover:bg-slate-100 dark:hover:bg-white/5">
              Health Scores
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: any; icon?: any; tone?: 'emerald' | 'rose' }) {
  return (
    <div className="p-2 rounded-lg border border-slate-200 dark:border-white/10">
      <p className="text-[9px] uppercase font-semibold text-slate-500 mb-0.5">{label}</p>
      <p className={cn('text-base font-bold',
        tone === 'emerald' && 'text-emerald-700 dark:text-emerald-400',
        tone === 'rose' && 'text-rose-700 dark:text-rose-400',
        !tone && 'text-slate-900 dark:text-white',
      )}>{Icon && <Icon className="w-3.5 h-3.5 inline mr-1" />}{value}</p>
    </div>
  )
}
