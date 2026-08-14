/**
 * GuestLinksPage — Sprint F · Magic Link auditável (lista + ações).
 *
 * Rota: /users/guest-links
 * Acesso: CLIENTE_ADMIN (também aberto pra SUPER_ADMIN/INTEGRADOR_ADMIN).
 *
 * Layout:
 *  - Header com botão "+ Gerar novo link"
 *  - Tabs: Ativos / Em uso / Usados / Expirados / Revogados
 *  - Filtros: período e busca
 *  - Cards (não tabela), 1 por link
 */
import { useMemo, useState } from 'react'
import {
  Link2, Plus, Search, Shield, Clock, Eye, Download, Trash2, Activity, Calendar, RefreshCw, AlertTriangle,
} from 'lucide-react'
import {
  useGuestLinks, type GuestLinkRow, type GuestLinkStatus, formatApiError, revokeGuestLink,
} from '../api/client'
import { CreateGuestLinkModal } from '../components/guest/CreateGuestLinkModal'
import { GuestLinkDetailDrawer } from '../components/guest/GuestLinkDetailDrawer'
import { useUiToast } from '../components/Toast'
import { confirm } from '../components/ConfirmDialog'
import { GlassCard } from '../components/cards/GlassCard'

const TABS: { id: GuestLinkStatus | 'all'; label: string; color: string }[] = [
  { id: 'all',     label: 'Todos',     color: 'text-slate-300' },
  { id: 'active',  label: 'Ativos',    color: 'text-emerald-300' },
  { id: 'used',    label: 'Em uso',    color: 'text-amber-300' },
  { id: 'used_up', label: 'Usados',    color: 'text-slate-400' },
  { id: 'expired', label: 'Expirados', color: 'text-slate-500' },
  { id: 'revoked', label: 'Revogados', color: 'text-rose-300' },
]

interface GuestLinksPageProps {
  /** Se true, omite o hero interno (usado quando renderizado dentro de outra
   *  página como aba — ex.: /users?tab=guests). O botão "+ Gerar" é mostrado
   *  via prop externa pelo pai. */
  headless?: boolean
}

export function GuestLinksPage({ headless = false }: GuestLinksPageProps = {}) {
  const toast = useUiToast()
  const [tab, setTab]           = useState<GuestLinkStatus | 'all'>('active')
  const [search, setSearch]     = useState('')
  const [periodDays, setPeriod] = useState<number>(30)
  const [createOpen, setCreate] = useState(false)
  const [drawer, setDrawer]     = useState<string | null>(null)
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  const canCreate = role === 'CLIENTE_ADMIN' || role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL' || role === 'INTEGRADOR_ADMIN'

  const { data, mutate, isLoading } = useGuestLinks({ status: tab, search, periodDays })

  async function handleRevoke(link: GuestLinkRow) {
    const ok = await confirm({
      title: `Revogar link de ${link.guestName}?`,
      description: 'O convidado perderá acesso imediatamente.',
      destructive: true,
      confirmLabel: 'Revogar',
    })
    if (!ok) return
    try {
      await revokeGuestLink(link.id)
      toast.success('Link revogado')
      void mutate()
    } catch (err) {
      toast.error({ title: 'Falha ao revogar', description: formatApiError(err) })
    }
  }

  const counts = (data?.links ?? []).reduce((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  // KPIs derivados pra mostrar quando em modo headless (aba dentro de /users)
  const kpis = useMemo(() => {
    const links = data?.links ?? []
    const now = Date.now()
    return {
      total:    links.length,
      active:   links.filter(l => l.status === 'active').length,
      inUse:    links.filter(l => l.status === 'used').length,
      expiringSoon: links.filter(l => {
        if (l.status !== 'active') return false
        const ms = new Date(l.validUntil).getTime() - now
        return ms > 0 && ms < 24 * 60 * 60_000
      }).length,
      withPin:    links.filter(l => l.hasPin).length,
    }
  }, [data?.links])

  return (
    <div className={headless ? 'space-y-5' : 'p-6 space-y-5 max-w-7xl mx-auto'}>
      {!headless && (
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-violet-500/5 to-transparent border-cyan-500/20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
              <Link2 className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Acessos Convidado</h1>
              <p className="text-xs text-slate-400">Magic Links auditáveis · LGPD compliant · revogação instantânea</p>
            </div>
          </div>
          {canCreate && (
            <button onClick={() => setCreate(true)}
              className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white font-bold text-sm flex items-center gap-2 shadow-cyan-glow">
              <Plus className="w-4 h-4" /> Gerar novo link
            </button>
          )}
        </div>
      </GlassCard>
      )}
      {headless && (
        <>
          {/* KPIs Magic Links */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <GuestKpi label="Ativos"          value={kpis.active}       color="emerald" />
            <GuestKpi label="Em uso agora"    value={kpis.inUse}        color="amber"   />
            <GuestKpi label="Expira em 24h"   value={kpis.expiringSoon} color="rose"    />
            <GuestKpi label="Com PIN"         value={kpis.withPin}      color="violet"  />
            <GuestKpi label="Total no período" value={kpis.total}       color="cyan"    />
          </div>
          {canCreate && (
            <div className="flex justify-end">
              <button onClick={() => setCreate(true)}
                className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-cyan-500/30">
                <Plus className="w-4 h-4" /> Gerar novo link
              </button>
            </div>
          )}
        </>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10">
        {TABS.map(t => {
          const n = t.id === 'all' ? (data?.total ?? 0) : (counts[t.id] ?? 0)
          const active = t.id === tab
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
                active ? 'border-cyan-500 text-cyan-300' : 'border-transparent text-slate-400 hover:text-white'
              }`}>
              {t.label}
              <span className={`px-1.5 rounded-full text-[10px] bg-white/10 ${t.color}`}>{n}</span>
            </button>
          )
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, e-mail ou motivo…"
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50" />
        </div>
        <select value={periodDays} onChange={e => setPeriod(parseInt(e.target.value, 10))}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300">
          <option value={7}>Últimos 7d</option>
          <option value={30}>Últimos 30d</option>
          <option value={90}>Últimos 90d</option>
          <option value={365}>Último ano</option>
        </select>
        <button onClick={() => void mutate()} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-300 flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {isLoading && (
          <div className="text-center text-slate-500 py-10 text-sm">Carregando…</div>
        )}
        {!isLoading && (data?.links?.length ?? 0) === 0 && (
          <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
            <Link2 className="w-10 h-10 opacity-50" />
            <p className="text-sm">Nenhum link encontrado pra esses filtros.</p>
          </GlassCard>
        )}
        {data?.links?.map(link => (
          <GuestLinkCard key={link.id} link={link} onOpen={() => setDrawer(link.id)} onRevoke={() => handleRevoke(link)} />
        ))}
      </div>

      {createOpen && (
        <CreateGuestLinkModal onClose={() => setCreate(false)} onCreated={() => { void mutate() }} />
      )}
      {drawer && (
        <GuestLinkDetailDrawer linkId={drawer} onClose={() => setDrawer(null)} onRevoked={() => void mutate()} />
      )}
    </div>
  )
}

function GuestLinkCard({ link, onOpen, onRevoke }: {
  link: GuestLinkRow
  onOpen: () => void
  onRevoke: () => void
}) {
  const expiresAt = new Date(link.validUntil)
  const expired = expiresAt.getTime() < Date.now()
  const msToExpiry = expiresAt.getTime() - Date.now()
  const expiryLabel = link.revokedAt ? 'Revogado'
    : expired ? `Expirou ${formatHuman(-msToExpiry)} atrás`
    : `Expira em ${formatHuman(msToExpiry)}`

  const statusStyle = {
    active:   'border-emerald-500/30 bg-emerald-500/5',
    used:     'border-amber-500/30 bg-amber-500/5',
    used_up:  'border-slate-500/30 bg-white/5',
    expired:  'border-slate-700 bg-white/5',
    revoked:  'border-rose-500/30 bg-rose-500/5',
  }[link.status] ?? 'border-white/10 bg-white/5'

  const statusBadge = {
    active:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    used:     'bg-amber-500/20 text-amber-300 border-amber-500/40',
    used_up:  'bg-slate-500/20 text-slate-300 border-slate-500/40',
    expired:  'bg-slate-600/30 text-slate-400 border-slate-600/40',
    revoked:  'bg-rose-500/20 text-rose-300 border-rose-500/40',
  }[link.status] ?? 'bg-white/10 text-slate-300 border-white/20'

  const statusLabel = {
    active:   'Ativo',
    used:     'Em uso',
    used_up:  'Usado',
    expired:  'Expirado',
    revoked:  'Revogado',
  }[link.status] ?? link.status

  return (
    <div className={`border rounded-xl p-4 transition hover:bg-white/10 ${statusStyle}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-white truncate">{link.guestName}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border ${statusBadge}`}>{statusLabel}</span>
            {link.hasPin && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 flex items-center gap-1"><Shield className="w-2.5 h-2.5" />PIN</span>}
            {link.allowedIpCidr && <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">IP restrito</span>}
            {link.canDownload && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1"><Download className="w-2.5 h-2.5" />Download</span>}
          </div>
          <p className="text-xs text-slate-400 mt-1 truncate">{link.purpose}</p>
          <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500 mt-2">
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" />
              {link.cameraId ? 'Câmera' : link.siteId ? 'Site' : 'Clipe'}
            </span>
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />
              {expiresAt.toLocaleString('pt-BR')}
            </span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />
              {expiryLabel}
            </span>
            <span className="flex items-center gap-1"><Activity className="w-3 h-3" />
              {link.usesCount}/{link.maxUses} usos
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onOpen} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-300 border border-white/10">Detalhes</button>
          {!link.revokedAt && (
            <button onClick={onRevoke} className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-xs text-rose-300 border border-rose-500/30 flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Revogar
            </button>
          )}
        </div>
      </div>
      {link.revokedReason && (
        <div className="mt-2 text-[11px] text-rose-300/80 flex gap-1.5 items-center">
          <AlertTriangle className="w-3 h-3" /> {link.revokedReason}
        </div>
      )}
    </div>
  )
}

function formatHuman(ms: number): string {
  const m = Math.abs(ms) / 60_000
  if (m < 1) return '<1min'
  if (m < 60) return `${Math.round(m)}min`
  const h = m / 60
  if (h < 24) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

// ── KPI pill compacto (consistente com UsersPage) ─────────────────────────
const KPI_COLOR_GUEST: Record<string, { bg: string; text: string; ring: string }> = {
  cyan:    { bg: 'bg-cyan-500/15',    text: 'text-cyan-700 dark:text-cyan-300',       ring: 'ring-cyan-500/20'    },
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-500/20' },
  violet:  { bg: 'bg-violet-500/15',  text: 'text-violet-700 dark:text-violet-300',   ring: 'ring-violet-500/20'  },
  amber:   { bg: 'bg-amber-500/15',   text: 'text-amber-700 dark:text-amber-300',     ring: 'ring-amber-500/20'   },
  rose:    { bg: 'bg-rose-500/15',    text: 'text-rose-700 dark:text-rose-300',       ring: 'ring-rose-500/20'    },
}

function GuestKpi({ label, value, color }: {
  label: string; value: number; color: keyof typeof KPI_COLOR_GUEST
}) {
  const c = KPI_COLOR_GUEST[color]
  return (
    <div className={`px-3 py-2.5 rounded-lg bg-white/40 dark:bg-white/5 ring-1 backdrop-blur ${c.ring}`}>
      <p className={`text-2xl font-bold leading-none ${c.text}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mt-1.5">{label}</p>
    </div>
  )
}
