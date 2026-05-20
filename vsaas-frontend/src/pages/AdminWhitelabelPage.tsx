/**
 * AdminWhitelabelPage — White-label unificado (SUPER_ADMIN).
 *
 * 5 abas em uma única tela:
 *   1. Identidade    — logo IACloud, paleta default
 *   2. Domínios      — visão global de todos cfSubdomain provisionados
 *   3. Templates     — defaults de email/push/whatsapp
 *   4. Governança    — quais campos integrador pode customizar
 *   5. Canal         — tiers e capabilities por integrador (ex-AdminWhitelabelTiersPage)
 */
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import {
  Palette, Globe, Mail, ShieldCheck, ChevronRight, ExternalLink,
  AlertTriangle, CheckCircle, RefreshCw, Building2,
  AlertCircle, Check, X, Crown, DollarSign,
  Search, LayoutGrid, List, Filter, Eye, Users,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api, useWhitelabelList, type WhitelabelTier, type WhitelabelCapabilities, type WhitelabelStatus } from '../api/client'
import { cn } from '../lib/utils'

const fetcher = (u: string) => api.get(u).then(r => r.data)

// ── Tabs ──────────────────────────────────────────────────────────────────────
type TabId = 'identidade' | 'dominios' | 'templates' | 'governanca' | 'canal'

const TABS: { id: TabId; label: string; icon: any; color: string }[] = [
  { id: 'identidade', label: 'Identidade Visual', icon: Palette,     color: 'violet' },
  { id: 'dominios',   label: 'Domínios',          icon: Globe,       color: 'cyan'   },
  { id: 'templates',  label: 'Templates',         icon: Mail,        color: 'amber'  },
  { id: 'governanca', label: 'Governança',        icon: ShieldCheck, color: 'emerald'},
  { id: 'canal',      label: 'Canal & Tiers',     icon: Crown,       color: 'violet' },
]

// ── Tiers (ex-AdminWhitelabelTiersPage) ───────────────────────────────────────
const TIERS: WhitelabelTier[] = ['NONE', 'BASIC', 'PRO', 'ENTERPRISE']

const TIER_STYLES: Record<WhitelabelTier, { badge: string; gradient: string; border: string; ring: string }> = {
  NONE: {
    badge:    'bg-slate-200 dark:bg-space-800 text-slate-500 border border-slate-300 dark:border-white/10',
    gradient: 'bg-gradient-to-br from-slate-500/10 to-transparent',
    border:   'border-slate-300 dark:border-white/10',
    ring:     'ring-slate-400',
  },
  BASIC: {
    badge:    'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30',
    gradient: 'bg-gradient-to-br from-cyan-500/15 via-cyan-500/5 to-transparent',
    border:   'border-cyan-500/30',
    ring:     'ring-cyan-500',
  },
  PRO: {
    badge:    'bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30',
    gradient: 'bg-gradient-to-br from-violet-500/15 via-violet-500/5 to-transparent',
    border:   'border-violet-500/30',
    ring:     'ring-violet-500',
  },
  ENTERPRISE: {
    badge:    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
    gradient: 'bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent',
    border:   'border-amber-500/30',
    ring:     'ring-amber-500',
  },
}

const CAP_LABELS: Record<keyof WhitelabelCapabilities, { title: string; emoji: string; hint: string }> = {
  branding:           { title: 'Branding',        emoji: '🎨', hint: 'Logo + cores próprias' },
  domain:             { title: 'Domínio',          emoji: '🌐', hint: 'Subdomínio ou domínio próprio' },
  pricing:            { title: 'Pricing',          emoji: '💰', hint: 'Planos próprios (override do master)' },
  email:              { title: 'E-mail',           emoji: '📧', hint: 'SMTP próprio (Fase 2)' },
  clientCustomization:{ title: 'Cascade Cliente',  emoji: '👥', hint: 'Cliente final customiza (Modelo D)' },
}

type ViewMode = 'cards' | 'list'

function tierDefaultCaps(tier: WhitelabelTier): (keyof WhitelabelCapabilities)[] {
  const all = ['branding', 'domain', 'pricing', 'email', 'clientCustomization'] as (keyof WhitelabelCapabilities)[]
  if (tier === 'NONE')  return []
  if (tier === 'BASIC') return ['branding']
  if (tier === 'PRO')   return ['branding', 'domain', 'pricing', 'email']
  return all
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
export function AdminWhitelabelPage() {
  const [params, setParams] = useSearchParams()
  const initialTab = (params.get('tab') as TabId) || 'dominios'
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)

  useEffect(() => {
    setActiveTab((params.get('tab') as TabId) || 'dominios')
  }, [params])

  function changeTab(t: TabId) {
    setActiveTab(t)
    setParams(p => { const np = new URLSearchParams(p); np.set('tab', t); return np }, { replace: true })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg">
            <Palette className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              White-label
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30 font-mono uppercase">
                marca · domínios · canal
              </span>
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              Configurações globais da plataforma + gestão de tiers e capabilities por integrador.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => changeTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg whitespace-nowrap transition-all border',
                isActive
                  ? `bg-${tab.color}-500/20 text-${tab.color}-300 border-${tab.color}-500/30 shadow-lg`
                  : 'text-slate-500 hover:text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:bg-white/5 border-transparent',
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="text-sm font-medium">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Conteúdo */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {activeTab === 'identidade' && <IdentidadeTab />}
          {activeTab === 'dominios'   && <DominiosTab />}
          {activeTab === 'templates'  && <TemplatesTab />}
          {activeTab === 'governanca' && <GovernancaTab />}
          {activeTab === 'canal'      && <CanalTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 1 — IDENTIDADE
// ═══════════════════════════════════════════════════════════════════════════════
function IdentidadeTab() {
  return (
    <div className="space-y-4">
      <GlassCard className="p-12 text-center">
        <Palette className="w-16 h-16 mx-auto text-violet-400 mb-4" />
        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">Identidade Visual da Plataforma</h3>
        <p className="text-sm text-slate-400 max-w-md mx-auto mb-4">
          Editor de logo, paleta de cores e tipografia padrão da VSaaS.
          Será sobrescrito pela identidade do integrador quando ele customizar.
        </p>
        <p className="text-xs text-amber-300">Em construção — slot reservado para Fase Branding</p>
      </GlassCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 2 — DOMÍNIOS
// ═══════════════════════════════════════════════════════════════════════════════
function DominiosTab() {
  const { data, isLoading, mutate } = useSWR('/admin/integradores', fetcher)
  const integradores = data?.integradores ?? []
  const withDomain    = integradores.filter((i: any) => i.cfSubdomain)
  const withoutDomain = integradores.filter((i: any) => !i.cfSubdomain)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StatSimple color="cyan"    label="Total integradores" value={integradores.length} />
        <StatSimple color="emerald" label="Com domínio"        value={withDomain.length} />
        <StatSimple color="slate"   label="Sem domínio"        value={withoutDomain.length} />
      </div>

      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" /> Domínios provisionados
          </h3>
          <button onClick={() => mutate()} className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/5">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-1">{[0,1,2].map(i => <div key={i} className="h-12 bg-white/5 rounded animate-pulse" />)}</div>
        ) : withDomain.length === 0 ? (
          <p className="text-xs text-slate-500 py-8 text-center">Nenhum domínio white-label provisionado ainda</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-500 border-b border-white/5">
                <tr>
                  <th className="px-3 py-2 text-left">Integrador</th>
                  <th className="px-3 py-2 text-left">Subdomain</th>
                  <th className="px-3 py-2 text-left">URL</th>
                  <th className="px-3 py-2 text-center">DNS</th>
                  <th className="px-3 py-2 text-center">SSL</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {withDomain.map((i: any) => (
                  <tr key={i.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-sm font-medium text-slate-900 dark:text-white">{i.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300 font-mono">{i.cfSubdomain}</td>
                    <td className="px-3 py-2 text-xs text-cyan-400">
                      <a href={`https://${i.cfSubdomain}.vsaas.com.br`} target="_blank" rel="noreferrer"
                        className="hover:underline flex items-center gap-1">
                        {i.cfSubdomain}.vsaas.com.br <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                    <td className="px-3 py-2 text-center"><CheckCircle className="w-4 h-4 text-emerald-400 inline" /></td>
                    <td className="px-3 py-2 text-center"><CheckCircle className="w-4 h-4 text-emerald-400 inline" /></td>
                    <td className="px-3 py-2 text-right">
                      <Link to={`/admin/tenants/${i.id}?tab=config`} className="text-cyan-400 hover:text-cyan-300 text-xs">
                        Configurar →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {withoutDomain.length > 0 && (
        <GlassCard className="p-4 border-amber-500/30 bg-amber-500/5">
          <h4 className="text-sm font-bold text-amber-300 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {withoutDomain.length} integrador(es) sem domínio
          </h4>
          <p className="text-xs text-slate-400 mb-3">
            Estes tenants ainda não provisionaram domínio próprio — usam o padrão app.vsaas.com.br.
          </p>
          <div className="flex flex-wrap gap-2">
            {withoutDomain.slice(0, 10).map((i: any) => (
              <Link key={i.id} to={`/admin/tenants/${i.id}?tab=config`}
                className="px-2 py-1 rounded text-[10px] bg-white/5 hover:bg-amber-500/10 text-slate-300 hover:text-amber-300 border border-white/10">
                {i.name} →
              </Link>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 3 — TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════
function TemplatesTab() {
  const TEMPLATES = [
    { name: 'lead_confirmation',  label: 'Confirmação de cadastro de demo',   status: 'ativo' },
    { name: 'lead_demo_approved', label: 'Demo aprovada (com magic link)',    status: 'ativo' },
    { name: 'lead_demo_rejected', label: 'Demo rejeitada (cordial)',           status: 'ativo' },
    { name: 'lead_notification',  label: 'Notificação de novo lead (admins)',  status: 'ativo' },
    { name: 'invite',             label: 'Convite de usuário',                 status: 'ativo' },
    { name: 'license_key',        label: 'Chave de licença Edge Box',          status: 'ativo' },
    { name: 'alert_digest',       label: 'Resumo diário de alertas',           status: 'ativo' },
  ]

  return (
    <div className="space-y-3">
      <GlassCard className="p-4 border-amber-500/20">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Mail className="w-4 h-4 text-amber-400" /> Templates de email padrão
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Defaults da plataforma (carregados de SystemConfig em runtime). Integradores podem sobrescrever no painel deles.
        </p>
      </GlassCard>

      <div className="grid gap-2">
        {TEMPLATES.map(t => (
          <GlassCard key={t.name} className="p-3 flex items-center justify-between hover:bg-white/[0.02] transition">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{t.label}</p>
              <p className="text-[10px] text-slate-500 font-mono">{t.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {t.status}
              </span>
              <button className="text-cyan-400 hover:text-cyan-300 text-xs">Editar →</button>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 4 — GOVERNANÇA
// ═══════════════════════════════════════════════════════════════════════════════
function GovernancaTab() {
  return (
    <GlassCard className="p-12 text-center">
      <ShieldCheck className="w-16 h-16 mx-auto text-emerald-400 mb-4" />
      <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">Governança White-label</h3>
      <p className="text-sm text-slate-400 max-w-md mx-auto mb-4">
        Defina quais campos cada plano (Starter / Pro / Enterprise) permite customizar:
        logo, cores, domínio, templates de email, branding completo, etc.
      </p>
      <p className="text-xs text-amber-300">Em construção — slot reservado</p>
    </GlassCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 5 — CANAL & TIERS (ex-AdminWhitelabelTiersPage, 100% preservado)
// ═══════════════════════════════════════════════════════════════════════════════
function CanalTab() {
  const { data: integradores, mutate, isLoading, error } = useWhitelabelList()
  const [editing,    setEditing]    = useState<string | null>(null)
  const [drilling,   setDrilling]   = useState<WhitelabelStatus | null>(null)
  const [search,     setSearch]     = useState('')
  const [tierFilter, setTierFilter] = useState<WhitelabelTier | 'ALL'>('ALL')
  const [capFilter,  setCapFilter]  = useState<keyof WhitelabelCapabilities | 'ALL'>('ALL')
  const [view,       setView]       = useState<ViewMode>('cards')

  const filtered = useMemo(() => {
    if (!integradores) return []
    return integradores.filter(i => {
      if (search) {
        const s = search.toLowerCase()
        const hay = `${i.name} ${i.tradeName ?? ''} ${i.email}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      if (tierFilter !== 'ALL' && i.whitelabelTier !== tierFilter) return false
      if (capFilter  !== 'ALL' && !i.capabilitiesResolved[capFilter]) return false
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
      {/* KPIs por tier */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <TierKpiCard label="Total" value={summary.total} active={tierFilter === 'ALL'} onClick={() => setTierFilter('ALL')} />
        {TIERS.map(t => (
          <TierKpiCard
            key={t}
            label={t}
            value={summary.byTier[t]}
            tier={t}
            active={tierFilter === t}
            onClick={() => setTierFilter(tierFilter === t ? 'ALL' : t)}
          />
        ))}
      </div>

      {/* Defaults por tier */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Defaults de capability por tier
          </p>
          <Link to="/admin/pricing" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold">
            <DollarSign className="w-3.5 h-3.5" /> Pricing CMS
          </Link>
        </div>
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
                {t === 'PRO'        && <Crown className="w-3.5 h-3.5 text-violet-500" />}
                {t === 'ENTERPRISE' && <Crown className="w-3.5 h-3.5 text-amber-500" />}
              </div>
              <p className="text-[10px] text-slate-700 dark:text-slate-300 leading-relaxed mb-3 min-h-[36px]">
                {t === 'NONE'       && 'Sem white-label. Marca VSaaS.'}
                {t === 'BASIC'      && 'Branding (logo + cores).'}
                {t === 'PRO'        && 'Branding + Domínio + Pricing + Email.'}
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

      {/* Toolbar */}
      <GlassCard className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Buscar por nome, email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] font-semibold text-slate-500 uppercase">Capability</span>
            <select
              value={capFilter}
              onChange={e => setCapFilter(e.target.value as any)}
              className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-white focus:border-cyan-400 focus:outline-none"
            >
              <option value="ALL">Todas</option>
              {(Object.keys(CAP_LABELS) as (keyof WhitelabelCapabilities)[]).map(k => (
                <option key={k} value={k}>{CAP_LABELS[k].title}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/5 border border-white/10">
            <button
              onClick={() => setView('cards')}
              title="Cards"
              className={cn('p-1.5 rounded transition', view === 'cards'
                ? 'bg-violet-500/20 text-violet-300'
                : 'text-slate-500 hover:text-white')}
            ><LayoutGrid className="w-3.5 h-3.5" /></button>
            <button
              onClick={() => setView('list')}
              title="Lista"
              className={cn('p-1.5 rounded transition', view === 'list'
                ? 'bg-violet-500/20 text-violet-300'
                : 'text-slate-500 hover:text-white')}
            ><List className="w-3.5 h-3.5" /></button>
          </div>

          {(search || tierFilter !== 'ALL' || capFilter !== 'ALL') && (
            <button
              onClick={() => { setSearch(''); setTierFilter('ALL'); setCapFilter('ALL') }}
              className="px-2 py-1 rounded-lg text-[10px] text-slate-500 hover:text-white border border-white/10"
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
          <p className="text-sm text-rose-400">Falha ao carregar integradores.</p>
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
            <thead className="bg-white/5 text-slate-500">
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
              {filtered.map(i => (
                <IntegradorRow key={i.id} integ={i} onChange={() => mutate()} onDrill={() => setDrilling(i)} />
              ))}
            </tbody>
          </table>
        </GlassCard>
      )}

      {drilling && <DrillModal integ={drilling} onClose={() => setDrilling(null)} onChange={() => mutate()} />}
    </div>
  )
}

// ── TierKpiCard ───────────────────────────────────────────────────────────────
function TierKpiCard({ label, value, tier, active, onClick }: {
  label: string; value: number; tier?: WhitelabelTier
  active?: boolean; onClick?: () => void
}) {
  const style = tier ? TIER_STYLES[tier] : null
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-3 rounded-xl border text-left transition cursor-pointer hover:scale-[1.02]',
        style ? cn(style.gradient, style.border) : 'border-white/10 bg-white/5',
        active && 'ring-2 ring-offset-2 ring-offset-slate-50 dark:ring-offset-space-900',
        active && (style ? style.ring : 'ring-slate-400'),
      )}
    >
      <p className="text-[10px] uppercase font-semibold text-slate-500">{label}</p>
      <p className={cn('text-2xl font-bold mt-1',
        tier === 'BASIC'      && 'text-cyan-600 dark:text-cyan-400',
        tier === 'PRO'        && 'text-violet-600 dark:text-violet-400',
        tier === 'ENTERPRISE' && 'text-amber-600 dark:text-amber-400',
        tier === 'NONE'       && 'text-slate-500',
        !tier                 && 'text-slate-900 dark:text-white',
      )}>{value}</p>
    </button>
  )
}

// ── IntegradorCard ────────────────────────────────────────────────────────────
function IntegradorCard({ integ, isEditing, onEdit, onDrill, onChange }: {
  integ: WhitelabelStatus; isEditing: boolean
  onEdit: () => void; onDrill: () => void; onChange: () => void
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
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[9px] font-semibold border border-amber-500/30">
              override
            </span>
          )}
          {!integ.active && (
            <span className="px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 text-[9px] font-semibold border border-rose-500/30">
              suspenso
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-500">{integ.email}</p>
        {integ.cfSubdomain && (
          <p className="text-[10px] text-cyan-400 font-mono mt-0.5">
            <ExternalLink className="w-2.5 h-2.5 inline" /> {integ.cfSubdomain}.vsaas.com.br
          </p>
        )}
        {integ.clientesFinaisCount !== undefined && (
          <p className="text-[10px] text-slate-500 mt-0.5">
            <Users className="w-2.5 h-2.5 inline" /> {integ.clientesFinaisCount} cliente{integ.clientesFinaisCount === 1 ? '' : 's'}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button onClick={onDrill} title="Ver detalhes"
          className="p-1.5 rounded-lg border border-white/10 hover:bg-white/10">
          <Eye className="w-3.5 h-3.5" />
        </button>
        <button onClick={onEdit}
          className="px-3 py-1 rounded-lg text-[10px] font-semibold border border-white/10 hover:bg-white/10">
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
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'bg-white/5 text-slate-400 border border-white/10',
          )}>
            {resolved[k] ? '✓' : '✗'} {CAP_LABELS[k].title}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-slate-500">{activeCount}/5 capabilities ativas</p>
    </>
  )
}

// ── EditPanel ─────────────────────────────────────────────────────────────────
function EditPanel({ integ, onChange }: { integ: WhitelabelStatus; onChange: () => void }) {
  const [busy,  setBusy]  = useState(false)
  const [err,   setErr]   = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  async function saveTier(newTier: WhitelabelTier) {
    if (newTier === integ.whitelabelTier) return
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
    <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
      {okMsg && (
        <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
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
                    ? cn(TIER_STYLES[t].badge, 'ring-2 ring-offset-1 ring-offset-space-900', TIER_STYLES[t].ring)
                    : 'bg-white/5 text-slate-500 hover:text-white border border-white/10',
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
            className="text-[10px] text-slate-500 hover:text-white disabled:opacity-30"
          >
            <RefreshCw className="w-3 h-3 inline mr-1" />Reset (defaults do tier)
          </button>
        </div>
        <div className="space-y-1">
          {(Object.keys(CAP_LABELS) as (keyof WhitelabelCapabilities)[]).map(k => {
            const final = integ.capabilitiesResolved[k]
            const isOverridden = explicit[k] !== undefined
            return (
              <div key={k} className="flex items-center justify-between p-2 rounded border border-white/10">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white">
                    {CAP_LABELS[k].emoji} {CAP_LABELS[k].title}
                    {isOverridden && <span className="ml-1 text-[9px] text-amber-500">override</span>}
                  </p>
                  <p className="text-[10px] text-slate-500">{CAP_LABELS[k].hint}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button disabled={busy} onClick={() => patchCap(k, true)} className={cn(
                    'px-2 py-1 rounded text-[10px] font-mono transition',
                    final
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'border border-white/10 text-slate-500 hover:text-emerald-400',
                  )}><Check className="w-3 h-3 inline" /></button>
                  <button disabled={busy} onClick={() => patchCap(k, false)} className={cn(
                    'px-2 py-1 rounded text-[10px] font-mono transition',
                    !final
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                      : 'border border-white/10 text-slate-500 hover:text-rose-400',
                  )}><X className="w-3 h-3 inline" /></button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {err && <div className="p-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">{err}</div>}
    </div>
  )
}

// ── IntegradorRow (list view) ─────────────────────────────────────────────────
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
    <tr className="border-t border-white/5 hover:bg-white/[0.02]">
      <td className="p-3">
        <p className="text-xs font-semibold text-white truncate max-w-[200px]">{integ.tradeName ?? integ.name}</p>
        <p className="text-[10px] text-slate-500">{integ.email}</p>
        {!integ.active && <span className="text-[9px] text-rose-400">suspenso</span>}
      </td>
      <td className="p-2">
        <select
          disabled={busy}
          value={integ.whitelabelTier}
          onChange={e => saveTier(e.target.value as WhitelabelTier)}
          className={cn(
            'px-2 py-1 rounded font-mono text-[10px] font-semibold border focus:outline-none cursor-pointer disabled:opacity-50',
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
            <span key={k} title={`${CAP_LABELS[k].title}: ${resolved[k] ? 'ON' : 'OFF'}`}
              className={cn(
                'w-6 h-6 rounded text-xs flex items-center justify-center',
                resolved[k]
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-white/5 text-slate-400 border border-white/10',
              )}
            >{CAP_LABELS[k].emoji}</span>
          ))}
        </div>
        <p className="text-[9px] text-slate-500 text-center mt-1">{activeCount}/5</p>
      </td>
      <td className="p-3 text-center font-mono text-xs">{integ.clientesFinaisCount ?? '—'}</td>
      <td className="p-3 text-center text-[10px] text-cyan-400 font-mono">
        {integ.cfSubdomain ? `${integ.cfSubdomain}.vsaas.com.br` : '—'}
      </td>
      <td className="p-3 text-right">
        <button onClick={onDrill}
          className="px-2 py-1 rounded text-[10px] border border-white/10 hover:bg-white/10">
          <ChevronRight className="w-3 h-3 inline" /> Detalhes
        </button>
      </td>
    </tr>
  )
}

// ── DrillModal ────────────────────────────────────────────────────────────────
function DrillModal({ integ, onClose, onChange }: {
  integ: WhitelabelStatus; onClose: () => void; onChange: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl mt-8 bg-space-900 border border-white/10 rounded-2xl shadow-2xl"
      >
        <div className={cn('p-5 rounded-t-2xl flex items-start justify-between gap-3', TIER_STYLES[integ.whitelabelTier].gradient)}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-lg font-bold text-white">{integ.tradeName ?? integ.name}</h3>
              <span className={cn('px-2 py-0.5 rounded-full font-mono text-[10px]', TIER_STYLES[integ.whitelabelTier].badge)}>
                {integ.whitelabelTier}
              </span>
            </div>
            <p className="text-xs text-slate-500">{integ.email}</p>
            {integ.cfSubdomain && (
              <a href={`https://${integ.cfSubdomain}.vsaas.com.br/pricing`} target="_blank" rel="noreferrer"
                className="text-xs text-cyan-400 font-mono mt-1 inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> {integ.cfSubdomain}.vsaas.com.br/pricing
              </a>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Resumo</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <DrillStat label="Clientes finais" value={integ.clientesFinaisCount ?? 0} icon={Users} />
              <DrillStat label="Capabilities ativas" value={`${Object.values(integ.capabilitiesResolved).filter(Boolean).length}/5`} />
              <DrillStat label="Override?" value={Object.keys(integ.whitelabelCapabilities ?? {}).length > 0 ? 'sim' : 'não'} />
              <DrillStat label="Status" value={integ.active ? 'ativo' : 'suspenso'} tone={integ.active ? 'emerald' : 'rose'} />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Edição completa</p>
            <EditPanel integ={integ} onChange={onChange} />
          </div>

          <div className="flex gap-2 pt-3 border-t border-white/10">
            <Link to={`/admin/tenants/${integ.id}`}
              className="flex-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold text-center">
              Cockpit do Tenant
            </Link>
            <Link to={`/audit?integradorId=${integ.id}`}
              className="flex-1 px-3 py-2 rounded-lg border border-white/10 text-xs font-semibold text-center hover:bg-white/5">
              Audit log
            </Link>
            <Link to="/health-scores"
              className="flex-1 px-3 py-2 rounded-lg border border-white/10 text-xs font-semibold text-center hover:bg-white/5">
              Health Scores
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── DrillStat (usado dentro do DrillModal) ────────────────────────────────────
function DrillStat({ label, value, icon: Icon, tone }: {
  label: string; value: any; icon?: any; tone?: 'emerald' | 'rose'
}) {
  return (
    <div className="p-2 rounded-lg border border-white/10">
      <p className="text-[9px] uppercase font-semibold text-slate-500 mb-0.5">{label}</p>
      <p className={cn('text-base font-bold',
        tone === 'emerald' && 'text-emerald-400',
        tone === 'rose'    && 'text-rose-400',
        !tone              && 'text-white',
      )}>
        {Icon && <Icon className="w-3.5 h-3.5 inline mr-1" />}{value}
      </p>
    </div>
  )
}

// ── StatSimple (usado na aba Domínios) ────────────────────────────────────────
function StatSimple({ color, label, value }: { color: string; label: string; value: number }) {
  const cls: Record<string, string> = {
    cyan:    'border-cyan-500/30 bg-cyan-500/5 text-cyan-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
    slate:   'border-white/10 bg-white/5 text-slate-300',
  }
  return (
    <div className={cn('p-3 rounded-lg border text-center', cls[color])}>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}
