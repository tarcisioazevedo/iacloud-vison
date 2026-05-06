/**
 * AdminWhitelabelTiersPage — SUPER_ADMIN gerencia tier + capabilities por integrador.
 *
 * Cockpit comercial do canal: lista todos os integradores, mostra tier atual,
 * capabilities resolvidas (defaults do tier + overrides) e permite edição inline.
 *
 * Matriz Tier × Capability:
 *   NONE       → tudo off (sem white-label)
 *   BASIC      → branding only
 *   PRO        → +domain +pricing +email
 *   ENTERPRISE → PRO + clientCustomization (cascade Modelo D)
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Palette, AlertCircle, Check, X, Crown, ExternalLink, DollarSign, RefreshCw } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'
import {
  api, useWhitelabelList,
  type WhitelabelTier, type WhitelabelCapabilities, type WhitelabelStatus,
} from '../api/client'

const TIERS: WhitelabelTier[] = ['NONE', 'BASIC', 'PRO', 'ENTERPRISE']

const TIER_COLORS: Record<WhitelabelTier, string> = {
  NONE: 'bg-slate-200 dark:bg-space-800 text-slate-500',
  BASIC: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30',
  PRO: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30',
  ENTERPRISE: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
}

const CAP_LABELS: Record<keyof WhitelabelCapabilities, { title: string; hint: string }> = {
  branding: { title: 'Branding', hint: 'Logo + cores próprias' },
  domain: { title: 'Domínio', hint: 'Subdomínio ou domínio próprio' },
  pricing: { title: 'Pricing', hint: 'Planos próprios (override do master)' },
  email: { title: 'E-mail', hint: 'SMTP / sender próprio (Fase 2)' },
  clientCustomization: { title: 'Cascade Cliente', hint: 'Cliente final customiza (Modelo D)' },
}

export function AdminWhitelabelTiersPage() {
  const { data: integradores, mutate, isLoading, error } = useWhitelabelList()
  const [editing, setEditing] = useState<string | null>(null)

  const summary = {
    total: integradores?.length ?? 0,
    byTier: TIERS.reduce((acc, t) => ({ ...acc, [t]: integradores?.filter(i => i.whitelabelTier === t).length ?? 0 }), {} as Record<WhitelabelTier, number>),
    revenuePotential: integradores?.filter(i => ['PRO', 'ENTERPRISE'].includes(i.whitelabelTier)).length ?? 0,
  }

  return (
    <div className="space-y-4">
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
                Capabilities granulares (branding, domínio, pricing, e-mail, cascade cliente)
                são derivadas do tier mas podem ser sobrescritas individualmente.
              </p>
            </div>
          </div>
          <Link to="/admin/pricing" className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold whitespace-nowrap">
            <DollarSign className="w-3.5 h-3.5" /> Pricing CMS
          </Link>
        </div>
      </GlassCard>

      {/* KPIs do canal */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <GlassCard className="p-3">
          <p className="text-[10px] uppercase font-semibold text-slate-500">Total integradores</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{summary.total}</p>
        </GlassCard>
        {TIERS.map(t => (
          <GlassCard key={t} className="p-3">
            <p className="text-[10px] uppercase font-semibold text-slate-500">{t}</p>
            <p className={cn('text-2xl font-bold mt-1',
              t === 'NONE' && 'text-slate-500',
              t === 'BASIC' && 'text-cyan-600 dark:text-cyan-400',
              t === 'PRO' && 'text-violet-600 dark:text-violet-400',
              t === 'ENTERPRISE' && 'text-amber-600 dark:text-amber-400',
            )}>{summary.byTier[t]}</p>
          </GlassCard>
        ))}
      </div>

      {/* Legenda tiers */}
      <GlassCard className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Defaults de capability por tier
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {TIERS.map(t => (
            <div key={t} className="p-3 rounded-lg border border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <span className={cn('px-2 py-0.5 rounded-full font-mono text-[10px]', TIER_COLORS[t])}>{t}</span>
                {t === 'PRO' && <Crown className="w-3.5 h-3.5 text-violet-500" />}
                {t === 'ENTERPRISE' && <Crown className="w-3.5 h-3.5 text-amber-500" />}
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                {t === 'NONE' && 'Sem white-label. Marca IACV.'}
                {t === 'BASIC' && 'Branding (logo+cores).'}
                {t === 'PRO' && 'Branding + Domínio + Pricing + Email.'}
                {t === 'ENTERPRISE' && 'PRO + Cliente final customiza.'}
              </p>
            </div>
          ))}
        </div>
      </GlassCard>

      {isLoading && <GlassCard className="p-6 text-center text-sm text-slate-500">Carregando…</GlassCard>}
      {error && (
        <GlassCard className="p-6 text-center">
          <AlertCircle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
          <p className="text-sm text-rose-600 dark:text-rose-400">Falha ao carregar integradores.</p>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {integradores?.map(i => (
          <IntegradorCard
            key={i.id}
            integ={i}
            isEditing={editing === i.id}
            onEdit={() => setEditing(editing === i.id ? null : i.id)}
            onChange={() => mutate()}
          />
        ))}
      </div>
    </div>
  )
}

function IntegradorCard({ integ, isEditing, onEdit, onChange }: {
  integ: WhitelabelStatus
  isEditing: boolean
  onEdit: () => void
  onChange: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function saveTier(newTier: WhitelabelTier) {
    setSaving(true); setErr(null)
    try {
      await api.put(`/admin/whitelabel/${integ.id}/tier`, { tier: newTier })
      onChange()
    } catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setSaving(false) }
  }
  async function patchCap(cap: keyof WhitelabelCapabilities, value: boolean) {
    setSaving(true); setErr(null)
    try {
      await api.patch(`/admin/whitelabel/${integ.id}/capabilities`, { [cap]: value })
      onChange()
    } catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setSaving(false) }
  }
  async function resetCaps() {
    if (!confirm('Resetar capabilities para defaults do tier?')) return
    setSaving(true); setErr(null)
    try {
      await api.delete(`/admin/whitelabel/${integ.id}/capabilities`)
      onChange()
    } catch (e: any) { setErr(e?.response?.data?.error ?? e.message) }
    finally { setSaving(false) }
  }

  const resolved = integ.capabilitiesResolved
  const activeCount = Object.values(resolved).filter(Boolean).length
  const explicit = (integ.whitelabelCapabilities ?? {}) as Partial<WhitelabelCapabilities>
  const hasOverrides = Object.keys(explicit).length > 0

  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{integ.tradeName ?? integ.name}</p>
            <span className={cn('px-2 py-0.5 rounded-full font-mono text-[10px]', TIER_COLORS[integ.whitelabelTier])}>
              {integ.whitelabelTier}
            </span>
            {hasOverrides && <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[9px] font-semibold border border-amber-500/30">override</span>}
          </div>
          <p className="text-[10px] text-slate-500">{integ.email}</p>
          {integ.cfSubdomain && (
            <p className="text-[10px] text-cyan-600 dark:text-brand-sky font-mono mt-0.5">
              <ExternalLink className="w-2.5 h-2.5 inline" /> {integ.cfSubdomain}.iacloud.com.br
            </p>
          )}
          {integ.clientesFinaisCount !== undefined && (
            <p className="text-[10px] text-slate-500 mt-0.5">
              {integ.clientesFinaisCount} cliente{integ.clientesFinaisCount === 1 ? '' : 's'} final{integ.clientesFinaisCount === 1 ? '' : 'is'}
            </p>
          )}
        </div>
        <button onClick={onEdit} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5">
          {isEditing ? 'Fechar' : 'Editar'}
        </button>
      </div>

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

      {isEditing && (
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/10 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Tier comercial</p>
            <div className="flex gap-1">
              {TIERS.map(t => (
                <button
                  key={t}
                  disabled={saving}
                  onClick={() => saveTier(t)}
                  className={cn(
                    'flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition disabled:opacity-50',
                    integ.whitelabelTier === t
                      ? TIER_COLORS[t]
                      : 'bg-slate-100 dark:bg-space-800 text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10',
                  )}
                >{t}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Override granular</p>
              <button
                onClick={resetCaps}
                disabled={saving || !hasOverrides}
                className="text-[10px] text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
              >
                <RefreshCw className="w-3 h-3 inline mr-1" />Reset (defaults do tier)
              </button>
            </div>
            <div className="space-y-1">
              {(Object.keys(CAP_LABELS) as (keyof WhitelabelCapabilities)[]).map(k => {
                const final = resolved[k]
                const isOverridden = explicit[k] !== undefined
                return (
                  <div key={k} className="flex items-center justify-between p-2 rounded border border-slate-200 dark:border-white/10">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                        {CAP_LABELS[k].title}
                        {isOverridden && <span className="ml-1 text-[9px] text-amber-500">override</span>}
                      </p>
                      <p className="text-[10px] text-slate-500">{CAP_LABELS[k].hint}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button disabled={saving} onClick={() => patchCap(k, true)} className={cn(
                        'px-2 py-1 rounded text-[10px] font-mono transition',
                        final ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40'
                              : 'border border-slate-200 dark:border-white/10 text-slate-500 hover:text-emerald-700',
                      )}><Check className="w-3 h-3 inline" /></button>
                      <button disabled={saving} onClick={() => patchCap(k, false)} className={cn(
                        'px-2 py-1 rounded text-[10px] font-mono transition',
                        !final ? 'bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-500/40'
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
      )}
    </GlassCard>
  )
}
