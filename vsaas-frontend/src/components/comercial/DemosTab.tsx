/**
 * DemosTab — Hub "Demos & Trials": jornada completa de avaliação em 5 sub-abas:
 *   1. ⏳ Pendentes (aguardando aprovação) — aprovar/rejeitar com SLA 1d útil
 *   2. ✨ Demos ativas (em uso) — DemoInvites válidos com tracking
 *   3. 🎁 Trial integrador — conta inteira em avaliação (14d)  [absorvido de /admin/trials]
 *   4. 📦 Trial produto — cliente final testa item do marketplace  [absorvido de /admin/trials]
 *   5. 📜 Histórico — convertidas + expiradas + perdidas
 *
 * Funil unificado: Lead → Demo → Trial → Conversão num só lugar.
 * Trials antes vivia em /admin/trials (item solto no sidebar) — fundido aqui
 * em 2026-06-25 reaproveitando IntegradorTrialsSection/SubscriptionTrialsSection.
 * Deep-link via ?sub=pendentes|ativas|trial-integrador|trial-produto|historico.
 */
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import {
  Sparkles, Clock, Mail, Phone, BarChart3, CheckCircle2, CheckCircle,
  Eye, Award, Loader2, History, XCircle, Gift, Package,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { api, formatApiError } from '../../api/client'
import { cn } from '../../lib/utils'
import { useUiToast } from '../Toast'
import { bg500_30, text200 } from '../../lib/colorClasses'
import { confirm } from '../ConfirmDialog'
import { IntegradorTrialsSection, SubscriptionTrialsSection } from '../../pages/AdminTrialsPage'

const fetcher = (u: string) => api.get(u).then(r => r.data)

type SubTab = 'pendentes' | 'ativas' | 'trial-integrador' | 'trial-produto' | 'historico'

const SUB_TABS: { id: SubTab; label: string; icon: any; color: string; description: string }[] = [
  { id: 'pendentes',        label: 'Pendentes',       icon: CheckCircle2, color: 'amber',   description: 'aguardando aprovação' },
  { id: 'ativas',           label: 'Demos ativas',    icon: Sparkles,     color: 'emerald', description: 'demos em uso' },
  { id: 'trial-integrador', label: 'Trial integrador', icon: Gift,        color: 'violet',  description: 'conta em avaliação' },
  { id: 'trial-produto',    label: 'Trial produto',   icon: Package,      color: 'cyan',    description: 'teste de marketplace' },
  { id: 'historico',        label: 'Histórico',       icon: History,      color: 'slate',   description: 'convertidas + perdidas' },
]

const VALID_SUBS = new Set<SubTab>(SUB_TABS.map(t => t.id))

export function DemosTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  // Deep-link: ?sub=trial-integrador (vindo do redirect /admin/trials). Default pendentes.
  const subParam = searchParams.get('sub') as SubTab | null
  const [sub, setSub] = useState<SubTab>(
    subParam && VALID_SUBS.has(subParam) ? subParam : 'pendentes',
  )

  // Sincroniza ?sub= na URL quando o operador troca de sub-aba (sem empilhar histórico).
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (sub === 'pendentes') next.delete('sub')
    else next.set('sub', sub)
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub])

  // Carrega counts dos estados de demo para badges nas sub-tabs
  const { data: pending }   = useSWR<any>('/leads?status=NEW', fetcher, { refreshInterval: 30_000 })
  const { data: active }    = useSWR<any>('/leads?status=DEMO_SENT', fetcher, { refreshInterval: 30_000 })
  const { data: converted } = useSWR<any>('/leads?status=CONVERTED', fetcher, { refreshInterval: 60_000 })
  const { data: lost }      = useSWR<any>('/leads?status=LOST', fetcher, { refreshInterval: 60_000 })

  const counts: Partial<Record<SubTab, number>> = {
    pendentes:  (pending?.items ?? pending?.leads ?? []).length,
    ativas:     (active?.items ?? active?.leads ?? []).length,
    historico:  (converted?.items ?? converted?.leads ?? []).length + (lost?.items ?? lost?.leads ?? []).length,
    // trial-integrador / trial-produto: as seções carregam seus próprios dados;
    // não duplicamos a query aqui (evita N+1). Badge fica sem número.
  }

  return (
    <div className="space-y-3">
      {/* Header com contexto */}
      <GlassCard className="p-4 border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-emerald-500/5 to-transparent">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-amber-400 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-white">Demos &amp; Trials</h3>
            <p className="text-xs text-slate-400 mt-1">
              Funil de avaliação completo: <strong>Pendente</strong> (aprovar) → <strong>Demo ativa</strong> (em uso)
              → <strong>Trial</strong> (conta/produto em avaliação) → <strong>Histórico</strong> (convertida ou perdida).
              <span className="ml-2 text-amber-300">SLA de aprovação: 1 dia útil.</span>
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="text-amber-300 font-bold">{counts.pendentes}</span>
            <span className="text-slate-500">·</span>
            <span className="text-emerald-300 font-bold">{counts.ativas}</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-600 dark:text-slate-300 font-bold">{counts.historico}</span>
          </div>
        </div>
      </GlassCard>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-white/10 overflow-x-auto">
        {SUB_TABS.map(t => {
          const Icon = t.icon
          const isActive = sub === t.id
          const colorMap: Record<string, string> = {
            amber:   'border-amber-500 text-amber-300',
            emerald: 'border-emerald-500 text-emerald-300',
            violet:  'border-violet-500 text-violet-300',
            cyan:    'border-cyan-500 text-cyan-300',
            slate:   'border-slate-500 text-slate-600 dark:text-slate-300',
          }
          const c = counts[t.id]
          return (
            <button key={t.id} onClick={() => setSub(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 -mb-px border-b-2 transition text-sm whitespace-nowrap',
                isActive
                  ? colorMap[t.color]
                  : 'border-transparent text-slate-500 hover:text-slate-600 dark:text-slate-300',
              )}>
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {c !== undefined && c > 0 && (
                <span className={cn(
                  'px-1.5 py-0.5 rounded-full text-[9px] font-bold',
                  isActive ? cn(bg500_30(t.color), text200(t.color)) : 'bg-slate-50 dark:bg-white/5 text-slate-500',
                )}>
                  {c}
                </span>
              )}
              <span className="text-[10px] text-slate-600 hidden lg:inline">· {t.description}</span>
            </button>
          )
        })}
      </div>

      {/* Conteúdo */}
      <div>
        {sub === 'pendentes'        && <PendentesSection />}
        {sub === 'ativas'           && <AtivasSection />}
        {sub === 'trial-integrador' && <IntegradorTrialsSection />}
        {sub === 'trial-produto'    && <SubscriptionTrialsSection />}
        {sub === 'historico'        && <HistoricoSection />}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Pendentes (aprovar / rejeitar)
// ════════════════════════════════════════════════════════════════════════════
function PendentesSection() {
  const toast = useUiToast()
  const { data, error, isLoading, mutate } = useSWR<any>('/leads?status=NEW', fetcher, { refreshInterval: 30_000 })
  const [busyId, setBusyId] = useState<string | null>(null)

  const leads = data?.items ?? data?.leads ?? []

  async function approve(lead: any) {
    const ok = await confirm({
      title: `Aprovar demo para ${lead.contactName}?`,
      description: 'Gera magic link, envia email rico ao lead com link e tutorial, e marca lead como DEMO_SENT.',
      confirmLabel: 'Aprovar',
    })
    if (!ok) return
    setBusyId(lead.id)
    try {
      const r = await api.post(`/leads/${lead.id}/invite`, { ttlDays: 14 })
      mutate()
      toast.success({
        title: 'Demo aprovada',
        description: `Enviada para ${lead.contactEmail}\nLink: ${r.data?.magicLink ?? '(gerado, ver email)'}`,
      })
    } catch (e) { toast.error(formatApiError(e)) }
    finally { setBusyId(null) }
  }

  async function reject(lead: any) {
    const reason = prompt(`Motivo para rejeitar a demo de ${lead.contactName}? (opcional, será enviado ao lead)`)
    if (reason === null) return
    setBusyId(lead.id)
    try {
      await api.patch(`/leads/${lead.id}`, { status: 'LOST', lostReason: reason || 'Demo rejeitada' })
      mutate()
    } catch (e) { toast.error(formatApiError(e)) }
    finally { setBusyId(null) }
  }

  if (isLoading) return <div className="h-64 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />
  if (error) return (
    <GlassCard className="p-6 border-rose-500/30">
      <p className="text-xs text-rose-300">{formatApiError(error)}</p>
    </GlassCard>
  )

  return leads.length === 0 ? (
    <GlassCard className="p-12 text-center">
      <CheckCircle className="w-12 h-12 mx-auto text-emerald-500/50 mb-3" />
      <p className="text-sm text-slate-400">Nenhuma demo aguardando aprovação. ✨</p>
      <p className="text-xs text-slate-500 mt-1">Quando um lead se cadastrar via /register-lead, aparecerá aqui.</p>
    </GlassCard>
  ) : (
    <div className="space-y-2">
      {leads.map((lead: any) => (
        <GlassCard key={lead.id} className="p-3 border-amber-500/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={cn(
                  'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border',
                  lead.kind === 'INTEGRADOR'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                    : 'bg-violet-500/20 text-violet-300 border-violet-500/30',
                )}>
                  {lead.kind === 'INTEGRADOR' ? 'Integrador' : 'Cliente Final'}
                </span>
                <h4 className="text-sm font-bold text-white">{lead.contactName}</h4>
                {lead.companyName && <span className="text-xs text-slate-500">· {lead.companyName}</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-400 mt-2">
                <span className="flex items-center gap-1.5"><Mail className="w-3 h-3 text-slate-500" />{lead.contactEmail}</span>
                {lead.contactPhone && <span className="flex items-center gap-1.5"><Phone className="w-3 h-3 text-slate-500" />{lead.contactPhone}</span>}
                {lead.cnpj && <span className="font-mono">CNPJ: {lead.cnpj}</span>}
                {lead.cameraVolume && <span className="flex items-center gap-1.5"><BarChart3 className="w-3 h-3 text-slate-500" />{lead.cameraVolume} câmeras</span>}
                {lead.city && <span>{lead.city}/{lead.state}</span>}
                <span className="flex items-center gap-1.5"><Clock className="w-3 h-3 text-slate-500" />{new Date(lead.createdAt).toLocaleString('pt-BR')}</span>
              </div>
              {lead.message && (
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 italic bg-slate-50 dark:bg-white/5 p-2 rounded border border-slate-200 dark:border-white/10">"{lead.message}"</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button onClick={() => approve(lead)} disabled={busyId === lead.id}
                className="px-3 py-1.5 rounded text-xs bg-emerald-500 hover:bg-emerald-600 text-white font-bold disabled:opacity-50 flex items-center gap-1">
                {busyId === lead.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                Aprovar Demo
              </button>
              <button onClick={() => reject(lead)} disabled={busyId === lead.id}
                className="px-3 py-1.5 rounded text-xs bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 font-bold">
                Rejeitar
              </button>
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Ativas (DEMO_SENT)
// ════════════════════════════════════════════════════════════════════════════
function AtivasSection() {
  const { data, isLoading } = useSWR<any>('/leads?status=DEMO_SENT', fetcher, { refreshInterval: 30_000 })
  const demos = data?.items ?? data?.leads ?? []

  if (isLoading) return <div className="h-64 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />

  return demos.length === 0 ? (
    <GlassCard className="p-12 text-center">
      <Sparkles className="w-12 h-12 mx-auto text-slate-700 mb-3" />
      <p className="text-sm text-slate-400">Nenhuma demo ativa no momento.</p>
      <p className="text-xs text-slate-500 mt-1">Aprovações em "Pendentes" geram demos ativas aqui.</p>
    </GlassCard>
  ) : (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {demos.map((d: any) => (
        <GlassCard key={d.id} className="p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white truncate">{d.contactName}</p>
              <p className="text-xs text-slate-500 truncate">{d.companyName ?? d.contactEmail}</p>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
              ATIVA
            </span>
          </div>
          <div className="space-y-1 text-[10px] text-slate-500">
            <p><Clock className="w-3 h-3 inline mr-1" /> Enviada {new Date(d.demoSentAt ?? d.updatedAt).toLocaleDateString('pt-BR')}</p>
            <p><Mail className="w-3 h-3 inline mr-1" /> {d.contactEmail}</p>
            {d.cameraVolume && <p><BarChart3 className="w-3 h-3 inline mr-1" /> {d.cameraVolume} câmeras</p>}
          </div>
          <div className="mt-2 flex gap-1">
            <button className="flex-1 px-2 py-1 rounded text-[10px] bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30">
              <Eye className="w-3 h-3 inline mr-1" /> Tracking
            </button>
            <button className="flex-1 px-2 py-1 rounded text-[10px] bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30">
              <Award className="w-3 h-3 inline mr-1" /> Converter
            </button>
          </div>
        </GlassCard>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Histórico (convertidos + perdidos)
// ════════════════════════════════════════════════════════════════════════════
function HistoricoSection() {
  const { data: converted } = useSWR<any>('/leads?status=CONVERTED', fetcher)
  const { data: lost }      = useSWR<any>('/leads?status=LOST', fetcher)

  const won  = converted?.items ?? converted?.leads ?? []
  const dead = lost?.items ?? lost?.leads ?? []

  return (
    <div className="space-y-4">
      {/* Convertidos */}
      <div>
        <h4 className="text-xs uppercase tracking-wider font-bold text-emerald-300 mb-2 flex items-center gap-2">
          <Award className="w-3.5 h-3.5" /> Convertidos ({won.length})
        </h4>
        {won.length === 0 ? (
          <GlassCard className="p-6 text-center">
            <p className="text-xs text-slate-500">Nenhuma demo convertida em cliente ainda.</p>
          </GlassCard>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {won.slice(0, 12).map((d: any) => (
              <GlassCard key={d.id} className="p-3 border-emerald-500/20">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{d.contactName}</p>
                    <p className="text-[10px] text-slate-500 truncate">{d.companyName ?? d.contactEmail}</p>
                  </div>
                  <span className="text-[10px] text-emerald-300">
                    {d.convertedAt ? new Date(d.convertedAt).toLocaleDateString('pt-BR') : '—'}
                  </span>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      {/* Perdidos */}
      <div>
        <h4 className="text-xs uppercase tracking-wider font-bold text-rose-300 mb-2 flex items-center gap-2">
          <XCircle className="w-3.5 h-3.5" /> Perdidos ({dead.length})
        </h4>
        {dead.length === 0 ? (
          <GlassCard className="p-6 text-center">
            <p className="text-xs text-slate-500">Nenhuma demo perdida.</p>
          </GlassCard>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {dead.slice(0, 12).map((d: any) => (
              <GlassCard key={d.id} className="p-3 border-rose-500/20 opacity-75">
                <div className="flex items-start gap-2">
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{d.contactName}</p>
                    <p className="text-[10px] text-slate-500 truncate">{d.companyName ?? d.contactEmail}</p>
                    {d.lostReason && (
                      <p className="text-[10px] text-rose-300 mt-1 italic line-clamp-2">"{d.lostReason}"</p>
                    )}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
