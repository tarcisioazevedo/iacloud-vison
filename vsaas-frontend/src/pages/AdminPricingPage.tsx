/**
 * AdminPricingPage — CMS de pricing (master).
 * SUPER_ADMIN edita planos públicos + IAs + matriz VMS + hero + settings + competitors.
 * Cada plano tem campo wholesalePriceMonthly (piso para overrides de integradores).
 */
import { useEffect, useState } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import {
  DollarSign, Sparkles, HardDrive, Star, Settings, BarChart3,
  ExternalLink, Save, Plus, AlertCircle, EyeOff, Archive, Check, RefreshCw,
} from 'lucide-react'
import { api } from '../api/client'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'
import { confirm } from '../components/ConfirmDialog'

type SubTab = 'plans' | 'ais' | 'vms' | 'hero' | 'competitors' | 'settings'

interface AdminPlan {
  id: string; slug: string; name: string; tagline: string
  priceMonthly: string | null; priceMonuv: string | null
  wholesalePriceMonthly: string | null
  connections: string; retention: string; totalAIs: string
  ctaLabel: string; ctaKind: string; ctaUrl: string | null
  highlights: string[]; recommended: boolean; accent: string
  maxCameras: number | null; retentionDays: number | null
  modulesIncluded: string[]; edgeBoxScenario: string | null
  displayOrder: number; publicVisible: boolean; archived: boolean
}
interface AdminAI {
  id: string; slug: string; name: string; iconKey: string
  priceIACV: string | null; priceMonuv: string | null
  exclusive: boolean; color: string; description: string | null
  analyticsModel: string | null; displayOrder: number
  publicVisible: boolean; archived: boolean
}
interface AdminVMS { id: string; resolution: string; days: number; priceIACV: string; priceMonuv: string | null; active: boolean }
interface AdminHero {
  id: string; tagline: string; headline: string; headlineHighlights: any
  subtitle: string; ctaLoginText: string; ctaLoginUrl: string
  ctaConsultantText: string; ctaConsultantUrl: string | null; active: boolean
}
interface AdminCompetitor {
  id: string; iconKey: string; label: string; ourValue: string
  ourValueColor: string; theirValue: string | null; description: string | null
  displayOrder: number; active: boolean
}
interface AdminSettings {
  id: string; showAnnualToggle: boolean; annualDiscountPct: number
  showTabPlans: boolean; showTabAIs: boolean; showTabVMS: boolean
  showCompetitorSection: boolean; defaultCurrency: string
}
interface FullSnapshot {
  hero: AdminHero | null; settings: AdminSettings | null
  plans: AdminPlan[]; ais: AdminAI[]; vms: AdminVMS[]; competitors: AdminCompetitor[]
}

const fetcher = (url: string) => api.get(url).then(r => r.data)
const KEY = '/admin/pricing/full'

function fmtPrice(v: string | null) {
  if (v === null) return '—'
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'
}

export function AdminPricingPage() {
  const [tab, setTab] = useState<SubTab>('plans')
  const { data, error, isLoading, mutate } = useSWR<FullSnapshot>(KEY, fetcher)

  const refresh = () => { mutate(); globalMutate('/pricing') }

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-violet-500/5 to-transparent border-cyan-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shadow-lg">
              <DollarSign className="w-6 h-6 text-slate-900 dark:text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Pricing CMS · Master</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Edite planos master + campo wholesale (piso pra overrides). Integradores
                com tier ≥ PRO podem criar overrides destes planos no painel deles.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={refresh} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5">
              <RefreshCw className="w-3.5 h-3.5" /> Recarregar
            </button>
            <a href="/pricing" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold">
              <ExternalLink className="w-3.5 h-3.5" /> Ver pública
            </a>
          </div>
        </div>
      </GlassCard>

      <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 w-fit">
        {([
          { id: 'plans', label: 'Planos', icon: Star },
          { id: 'ais', label: 'IAs avulsas', icon: Sparkles },
          { id: 'vms', label: 'VMS', icon: HardDrive },
          { id: 'hero', label: 'Hero', icon: BarChart3 },
          { id: 'competitors', label: 'Comparativo', icon: BarChart3 },
          { id: 'settings', label: 'Settings', icon: Settings },
        ] as { id: SubTab; label: string; icon: any }[]).map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn(
              'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition',
              active
                ? 'bg-cyan-500/20 text-cyan-700 dark:text-brand-sky border border-cyan-500/30'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:text-white',
            )}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          )
        })}
      </div>

      {isLoading && <GlassCard className="p-6 text-center text-sm text-slate-500">Carregando…</GlassCard>}
      {error && (
        <GlassCard className="p-6 text-center">
          <AlertCircle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
          <p className="text-sm text-rose-600 dark:text-rose-400">Falha ao carregar pricing.</p>
        </GlassCard>
      )}

      {data && (
        <>
          {tab === 'plans' && <PlansEditor plans={data.plans} onChange={refresh} />}
          {tab === 'ais' && <AIsEditor ais={data.ais} onChange={refresh} />}
          {tab === 'vms' && <VMSEditor cells={data.vms} onChange={refresh} />}
          {tab === 'hero' && <HeroEditor hero={data.hero} onChange={refresh} />}
          {tab === 'competitors' && <CompetitorsEditor items={data.competitors} onChange={refresh} />}
          {tab === 'settings' && <SettingsEditor settings={data.settings} onChange={refresh} />}
        </>
      )}
    </div>
  )
}

// ─── Plans Editor ──────────────────────────────────────────────────────
function PlansEditor({ plans, onChange }: { plans: AdminPlan[]; onChange: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{plans.length} plano{plans.length === 1 ? '' : 's'}</h2>
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold">
          <Plus className="w-3.5 h-3.5" /> Novo plano
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {plans.map(p => (
          <GlassCard key={p.id} className={cn('p-4', p.archived && 'opacity-50')}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{p.name}</p>
                <p className="text-[10px] text-slate-500 font-mono">{p.slug}</p>
              </div>
              <div className="flex items-center gap-1">
                {p.recommended && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />}
                {!p.publicVisible && <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                {p.archived && <Archive className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2 line-clamp-2">{p.tagline}</p>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-[10px] text-slate-500">R$</span>
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                {p.priceMonthly === null ? 'Sob consulta' : fmtPrice(p.priceMonthly)}
              </span>
              {p.priceMonthly !== null && <span className="text-[10px] text-slate-500">/mês</span>}
            </div>
            {p.wholesalePriceMonthly && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-2 font-mono">
                wholesale (floor): R$ {fmtPrice(p.wholesalePriceMonthly)}
              </p>
            )}
            <button onClick={() => setEditing(p.slug)} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5">
              Editar
            </button>
          </GlassCard>
        ))}
      </div>
      {editing && <PlanModal plan={plans.find(p => p.slug === editing)!} onClose={() => setEditing(null)} onSave={onChange} />}
      {creating && <PlanModal plan={null} onClose={() => setCreating(false)} onSave={() => { setCreating(false); onChange() }} />}
    </div>
  )
}

type PlanTab = 'identity' | 'pricing' | 'limits' | 'content' | 'visibility'

function PlanModal({ plan, onClose, onSave }: { plan: AdminPlan | null; onClose: () => void; onSave: () => void }) {
  const isNew = plan === null
  const [tab, setTab] = useState<PlanTab>('identity')
  const [form, setForm] = useState<any>(plan ?? {
    slug: '', name: '', tagline: '', priceMonthly: null, priceMonuv: null,
    wholesalePriceMonthly: null, connections: '', retention: '', totalAIs: '',
    ctaLabel: 'Contratar agora', ctaKind: 'self-service', highlights: [],
    recommended: false, accent: 'cyan', publicVisible: true, displayOrder: 99,
    // Sprint 0 — Variação B
    maxClientesFinais: null, maxCameras: null,
    extraClientePriceBrl: null, extraCameraPriceBrl: null,
    isTrial: false, trialDays: 0, enforcementMode: 'soft', pricingVersion: 1,
  })
  const [highlightsText, setHighlightsText] = useState((plan?.highlights ?? []).join('\n'))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true); setErr(null)
    try {
      const num = (v: any) => v === null || v === '' || v === undefined ? null : Number(v)
      const intOrNull = (v: any) => v === null || v === '' || v === undefined ? null : Math.trunc(Number(v))
      const payload = {
        ...form,
        highlights: highlightsText.split('\n').map((s: string) => s.trim()).filter(Boolean),
        priceMonthly:         num(form.priceMonthly),
        priceMonuv:           num(form.priceMonuv),
        wholesalePriceMonthly:num(form.wholesalePriceMonthly),
        maxClientesFinais:    intOrNull(form.maxClientesFinais),
        maxCameras:           intOrNull(form.maxCameras),
        extraClientePriceBrl: num(form.extraClientePriceBrl),
        extraCameraPriceBrl:  num(form.extraCameraPriceBrl),
        trialDays:            Number(form.trialDays || 0),
        pricingVersion:       Number(form.pricingVersion || 1),
      }
      delete payload.id; delete payload.modulesIncluded; delete payload.createdAt; delete payload.updatedAt
      if (isNew) await api.post('/admin/pricing/plans', payload)
      else await api.patch(`/admin/pricing/plans/${plan!.slug}`, payload)
      onSave(); onClose()
    } catch (e: any) {
      const data = e?.response?.data
      if (data?.error === 'plan_in_use') setErr(data.message ?? `${data.integradoresCount} integrador(es) ativos usam este plano.`)
      else setErr(data?.error ?? e.message)
    }
    finally { setSaving(false) }
  }
  async function archive() {
    if (!plan) return
    const ok = await confirm({
      title: `Arquivar "${plan.name}"?`,
      destructive: true,
      confirmLabel: 'Arquivar',
    })
    if (!ok) return
    setSaving(true)
    try { await api.delete(`/admin/pricing/plans/${plan.slug}`); onSave(); onClose() }
    catch (e: any) {
      const data = e?.response?.data
      if (data?.error === 'plan_in_use') setErr(data.message ?? `${data.integradoresCount} integrador(es) ativos usam este plano. Mude-os antes de arquivar.`)
      else setErr(data?.error ?? e.message)
    }
    finally { setSaving(false) }
  }

  const tabs: { id: PlanTab; label: string; icon?: string }[] = [
    { id: 'identity',   label: 'Identificação' },
    { id: 'pricing',    label: 'Cobrança' },
    { id: 'limits',     label: 'Limites e adicionais' },
    { id: 'content',    label: 'Conteúdo' },
    { id: 'visibility', label: 'Visibilidade' },
  ]

  return (
    <Modal title={isNew ? 'Novo plano de revenda' : `Editar: ${plan!.name}`} onClose={onClose} size="xl">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        {/* COLUNA ESQUERDA — abas + form */}
        <div>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800 mb-4 -mt-1 overflow-x-auto">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn('px-3 py-2 text-xs font-medium border-b-2 -mb-px transition whitespace-nowrap',
                  tab === t.id
                    ? 'border-cyan-500 text-cyan-700 dark:text-cyan-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
                )}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'identity' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Slug" hint="kebab-case · não editável depois">
                <input disabled={!isNew} value={form.slug ?? ''} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} className="w-full input-base" />
              </Field>
              <Field label="Nome"><input value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full input-base" /></Field>
              <Field label="Tagline (subtítulo)" full><input value={form.tagline ?? ''} onChange={e => setForm({ ...form, tagline: e.target.value })} className="w-full input-base" /></Field>
              <Field label="Cor de destaque">
                <select value={form.accent ?? 'cyan'} onChange={e => setForm({ ...form, accent: e.target.value })} className="w-full input-base">
                  <option value="cyan">Cyan</option>
                  <option value="emerald">Emerald</option>
                  <option value="violet">Violet</option>
                  <option value="amber">Amber</option>
                  <option value="rose">Rose</option>
                </select>
              </Field>
              <Field label="Recomendado">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={!!form.recommended} onChange={e => setForm({ ...form, recommended: e.target.checked })} />
                  Badge "Mais popular"
                </label>
              </Field>
              <Field label="Plano de Trial" full>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={!!form.isTrial} onChange={e => setForm({ ...form, isTrial: e.target.checked })} />
                  Trial Free (não cobra mensalidade, expira)
                </label>
              </Field>
              {form.isTrial && (
                <Field label="Duração do trial (dias)" full>
                  <input type="number" min={1} max={365} value={form.trialDays ?? 0}
                    onChange={e => setForm({ ...form, trialDays: Number(e.target.value) })}
                    className="w-full input-base" />
                </Field>
              )}
            </div>
          )}

          {tab === 'pricing' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mensalidade BRL" hint="Vazio = Sob consulta (Enterprise)" full>
                <input type="number" step="0.01" min={0}
                  value={form.priceMonthly ?? ''}
                  disabled={!!form.isTrial}
                  onChange={e => setForm({ ...form, priceMonthly: e.target.value === '' ? null : e.target.value })}
                  className="w-full input-base" />
                {form.isTrial && <p className="text-[10px] text-amber-600 mt-1">Trial não cobra mensalidade.</p>}
              </Field>
              <Field label="Preço de comparação Monuv R$" hint="Mostra economia na vitrine">
                <input type="number" step="0.01" value={form.priceMonuv ?? ''} onChange={e => setForm({ ...form, priceMonuv: e.target.value === '' ? null : e.target.value })} className="w-full input-base" />
              </Field>
              <Field label="Wholesale BRL (piso pra overrides)">
                <input type="number" step="0.01" value={form.wholesalePriceMonthly ?? ''} onChange={e => setForm({ ...form, wholesalePriceMonthly: e.target.value === '' ? null : e.target.value })} className="w-full input-base" />
              </Field>
              <Field label="CTA" full>
                <div className="flex gap-2">
                  <select value={form.ctaKind ?? 'self-service'} onChange={e => setForm({ ...form, ctaKind: e.target.value })} className="input-base">
                    <option value="self-service">self-service</option>
                    <option value="consultant">consultant</option>
                  </select>
                  <input value={form.ctaLabel ?? ''} onChange={e => setForm({ ...form, ctaLabel: e.target.value })} className="flex-1 input-base" placeholder="Contratar agora" />
                </div>
              </Field>
              <Field label="Versão de pricing" hint="Incrementar quando mudar valores" full>
                <input type="number" min={1} value={form.pricingVersion ?? 1} onChange={e => setForm({ ...form, pricingVersion: Number(e.target.value) })} className="w-full input-base" />
                <p className="text-[10px] text-slate-500 mt-1">Integradores existentes ficam no preço antigo até trocar manualmente.</p>
              </Field>
            </div>
          )}

          {tab === 'limits' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Máx clientes finais" hint="Vazio = ilimitado (Enterprise)">
                <input type="number" min={0} value={form.maxClientesFinais ?? ''} onChange={e => setForm({ ...form, maxClientesFinais: e.target.value === '' ? null : Number(e.target.value) })} className="w-full input-base" />
              </Field>
              <Field label="Máx câmeras totais" hint="Vazio = ilimitado">
                <input type="number" min={0} value={form.maxCameras ?? ''} onChange={e => setForm({ ...form, maxCameras: e.target.value === '' ? null : Number(e.target.value) })} className="w-full input-base" />
              </Field>
              <Field label="Cliente adicional /mês R$" hint="Cobrança automática se soft cap">
                <input type="number" step="0.01" min={0} value={form.extraClientePriceBrl ?? ''} onChange={e => setForm({ ...form, extraClientePriceBrl: e.target.value === '' ? null : e.target.value })} className="w-full input-base" />
              </Field>
              <Field label="Câmera adicional /mês R$">
                <input type="number" step="0.01" min={0} value={form.extraCameraPriceBrl ?? ''} onChange={e => setForm({ ...form, extraCameraPriceBrl: e.target.value === '' ? null : e.target.value })} className="w-full input-base" />
              </Field>
              <Field label="Enforcement" full>
                <div className="flex gap-2 text-xs">
                  <label className="flex-1 flex items-center gap-2 p-2 rounded border border-slate-300 dark:border-white/10 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5">
                    <input type="radio" name="enforcement" value="soft" checked={form.enforcementMode === 'soft'} onChange={() => setForm({ ...form, enforcementMode: 'soft' })} />
                    <span><strong>Soft cap</strong> — cobra adicional automaticamente</span>
                  </label>
                  <label className="flex-1 flex items-center gap-2 p-2 rounded border border-slate-300 dark:border-white/10 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5">
                    <input type="radio" name="enforcement" value="hard" checked={form.enforcementMode === 'hard'} onChange={() => setForm({ ...form, enforcementMode: 'hard' })} />
                    <span><strong>Hard cap</strong> — bloqueia cadastro até upgrade</span>
                  </label>
                </div>
              </Field>
            </div>
          )}

          {tab === 'content' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Conexões (texto)" hint="Ex: '3 clientes / 36 câmeras'" full>
                <input value={form.connections ?? ''} onChange={e => setForm({ ...form, connections: e.target.value })} className="w-full input-base" />
              </Field>
              <Field label="Retenção (texto)" full>
                <input value={form.retention ?? ''} onChange={e => setForm({ ...form, retention: e.target.value })} className="w-full input-base" />
              </Field>
              <Field label="Total IAs (texto)" full>
                <input value={form.totalAIs ?? ''} onChange={e => setForm({ ...form, totalAIs: e.target.value })} className="w-full input-base" />
              </Field>
              <Field label="Highlights (1 por linha)" full>
                <textarea rows={7} value={highlightsText} onChange={e => setHighlightsText(e.target.value)} className="w-full input-base font-mono text-xs" placeholder="3 clientes finais&#10;36 câmeras totais&#10;Marketplace completo&#10;Suporte por email" />
                <p className="text-[10px] text-slate-500 mt-1">{highlightsText.split('\n').filter(s => s.trim()).length} bullets</p>
              </Field>
            </div>
          )}

          {tab === 'visibility' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Público (vitrine /pricing)" full>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={!!form.publicVisible} onChange={e => setForm({ ...form, publicVisible: e.target.checked })} />
                  Mostrar em /pricing (vitrine pública)
                </label>
                <p className="text-[10px] text-slate-500 mt-1">Desmarque pra planos Enterprise (sob consulta).</p>
              </Field>
              <Field label="Ordem de exibição" full>
                <input type="number" value={form.displayOrder ?? 0} onChange={e => setForm({ ...form, displayOrder: Number(e.target.value) })} className="w-full input-base" />
                <p className="text-[10px] text-slate-500 mt-1">Menor = primeiro na grid.</p>
              </Field>
            </div>
          )}

          {err && <div className="mt-3 p-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}

          <div className="mt-4 flex justify-between border-t border-slate-200 dark:border-white/10 pt-3">
            <div>{!isNew && <button onClick={archive} disabled={saving} className="px-3 py-2 rounded-lg border border-rose-500/40 text-rose-600 dark:text-rose-400 text-xs"><Archive className="w-3.5 h-3.5 inline mr-1" />Arquivar</button>}</div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs">Cancelar</button>
              <button onClick={save} disabled={saving} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold inline-flex items-center gap-1">
                {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Salvar
              </button>
            </div>
          </div>
        </div>

        {/* COLUNA DIREITA — pré-visualização (M2) */}
        <div className="lg:sticky lg:top-0 self-start">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Pré-visualização (como integrador vê)</p>
          <PlanCardPreview form={form} highlightsText={highlightsText} />
        </div>
      </div>
    </Modal>
  )
}

function PlanCardPreview({ form, highlightsText }: { form: any; highlightsText: string }) {
  const accent = form.accent ?? 'cyan'
  const borderMap: Record<string, string> = {
    cyan:    'border-cyan-300 dark:border-cyan-500/40',
    emerald: 'border-emerald-300 dark:border-emerald-500/40',
    violet:  'border-violet-300 dark:border-violet-500/40',
    amber:   'border-amber-300 dark:border-amber-500/40',
    rose:    'border-rose-300 dark:border-rose-500/40',
  }
  const borderCls = borderMap[accent] ?? 'border-cyan-300'
  const priceFmt = form.priceMonthly == null || form.priceMonthly === ''
    ? (form.isTrial ? 'R$ 0,00' : 'Sob consulta')
    : `R$ ${Number(form.priceMonthly).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  const monuvFmt = form.priceMonuv && Number(form.priceMonuv) > 0 && form.priceMonthly && Number(form.priceMonthly) < Number(form.priceMonuv)
    ? Math.round((1 - Number(form.priceMonthly) / Number(form.priceMonuv)) * 100)
    : null
  const highlights = highlightsText.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 6)

  return (
    <div className={cn('rounded-lg border-2 p-4 bg-white dark:bg-slate-800/30', borderCls, form.recommended && 'ring-2 ring-offset-2 ring-cyan-500/30')}>
      {form.recommended && (
        <span className="inline-block mb-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-700 dark:text-cyan-300">
          Mais popular
        </span>
      )}
      <h4 className="text-base font-bold text-slate-900 dark:text-white">{form.name || '(sem nome)'}</h4>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{form.tagline || '(sem tagline)'}</p>
      <div className="mt-3">
        <div className="text-2xl font-bold text-slate-900 dark:text-white">{priceFmt}{form.priceMonthly && <span className="text-xs font-normal text-slate-500">/mês</span>}</div>
        {monuvFmt && <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">{monuvFmt}% mais barato que Monuv</p>}
      </div>
      {form.isTrial && form.trialDays > 0 && (
        <p className="mt-2 text-xs bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded px-2 py-1 inline-block">
          🎁 Trial de {form.trialDays} dias grátis
        </p>
      )}
      <div className="mt-3 space-y-1 text-xs">
        {form.maxClientesFinais != null && (
          <div className="flex justify-between text-slate-700 dark:text-slate-300">
            <span>Clientes finais</span>
            <strong>{form.maxClientesFinais === 0 ? '∞' : `até ${form.maxClientesFinais}`}</strong>
          </div>
        )}
        {form.maxCameras != null && (
          <div className="flex justify-between text-slate-700 dark:text-slate-300">
            <span>Câmeras</span>
            <strong>{form.maxCameras === 0 ? '∞' : `até ${form.maxCameras}`}</strong>
          </div>
        )}
        {form.extraClientePriceBrl != null && (
          <div className="flex justify-between text-slate-500 dark:text-slate-400">
            <span>Cliente adicional</span>
            <span>+R$ {Number(form.extraClientePriceBrl).toFixed(2)}/mês</span>
          </div>
        )}
        {form.extraCameraPriceBrl != null && (
          <div className="flex justify-between text-slate-500 dark:text-slate-400">
            <span>Câmera adicional</span>
            <span>+R$ {Number(form.extraCameraPriceBrl).toFixed(2)}/mês</span>
          </div>
        )}
      </div>
      {highlights.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {highlights.map((h, i) => (
            <li key={i} className="flex items-start gap-1.5 text-slate-700 dark:text-slate-300">
              <span className="text-emerald-600 dark:text-emerald-400 mt-0.5">✓</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}
      <button className={cn('mt-3 w-full px-3 py-2 rounded text-xs font-semibold text-white',
        accent === 'cyan'    && 'bg-cyan-600',
        accent === 'emerald' && 'bg-emerald-600',
        accent === 'violet'  && 'bg-violet-600',
        accent === 'amber'   && 'bg-amber-600',
        accent === 'rose'    && 'bg-rose-600',
      )}>
        {form.ctaLabel || 'Contratar'}
      </button>
      {form.enforcementMode === 'hard' && (
        <p className="mt-2 text-[10px] text-rose-600 dark:text-rose-400">⚠ Hard cap: bloqueia ao atingir limite</p>
      )}
    </div>
  )
}

// ─── AIs / VMS / Hero / Competitors / Settings — versões enxutas ───────
function AIsEditor({ ais, onChange: _onChange }: { ais: AdminAI[]; onChange: () => void }) {
  return (
    <GlassCard className="p-0 overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-xs min-w-[420px]">
        <thead className="bg-slate-50 dark:bg-space-800/60 text-slate-500">
          <tr><th className="text-left p-2">Slug</th><th className="text-left p-2">Nome</th><th className="text-right p-2">IACV</th><th className="text-right p-2">Monuv</th><th className="text-center p-2">Excl.</th></tr>
        </thead>
        <tbody>
          {ais.map(a => (
            <tr key={a.id} className={cn('border-t border-slate-200 dark:border-white/5', a.archived && 'opacity-50')}>
              <td className="p-2 font-mono text-[10px]">{a.slug}</td>
              <td className="p-2 text-slate-900 dark:text-white">{a.name}</td>
              <td className="p-2 text-right font-mono">{fmtPrice(a.priceIACV)}</td>
              <td className="p-2 text-right font-mono text-slate-500">{a.priceMonuv ? fmtPrice(a.priceMonuv) : '—'}</td>
              <td className="p-2 text-center">{a.exclusive && <Check className="w-3.5 h-3.5 inline text-violet-500" />}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="p-3 text-center text-xs text-slate-500">Edição inline detalhada em sprint futuro — backend completo via PATCH /admin/pricing/ais/:slug.</div>
    </GlassCard>
  )
}

function VMSEditor({ cells, onChange: _onChange }: { cells: AdminVMS[]; onChange: () => void }) {
  const resolutions = Array.from(new Set(cells.map(c => c.resolution)))
  const days = Array.from(new Set(cells.map(c => c.days))).sort((a, b) => a - b)
  const getCell = (r: string, d: number) => cells.find(c => c.resolution === r && c.days === d)
  return (
    <GlassCard className="p-3 overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs">
        <thead><tr className="text-slate-500"><th className="text-left p-2">Resolução / Dias →</th>{days.map(d => <th key={d} className="text-right p-2 font-mono">{d === 0 ? 'live' : `${d}d`}</th>)}</tr></thead>
        <tbody>
          {resolutions.map(r => (
            <tr key={r} className="border-t border-slate-200 dark:border-white/5">
              <td className="p-2 font-semibold text-slate-900 dark:text-white">{r}</td>
              {days.map(d => {
                const c = getCell(r, d)
                return <td key={d} className="p-2 text-right font-mono">{c ? fmtPrice(c.priceIACV) : '—'}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-500 mt-2">Edição via PUT /admin/pricing/vms (bulk).</p>
    </GlassCard>
  )
}

function HeroEditor({ hero, onChange }: { hero: AdminHero | null; onChange: () => void }) {
  const [form, setForm] = useState<Partial<AdminHero>>(hero ?? { tagline: '', headline: '', subtitle: '', ctaLoginText: 'Entrar', ctaLoginUrl: '/login', ctaConsultantText: 'Falar com consultor', ctaConsultantUrl: null })
  useEffect(() => { if (hero) setForm(hero) }, [hero])
  const [saving, setSaving] = useState(false); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false)
  async function save() {
    setSaving(true); setErr(null); setOk(false)
    try { const p = { ...form }; delete (p as any).id; await api.put('/admin/pricing/hero', p); setOk(true); onChange() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) } finally { setSaving(false) }
  }
  return (
    <GlassCard className="p-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tagline" full><input value={form.tagline ?? ''} onChange={e => setForm({ ...form, tagline: e.target.value })} className="w-full input-base" /></Field>
        <Field label="Headline" full><input value={form.headline ?? ''} onChange={e => setForm({ ...form, headline: e.target.value })} className="w-full input-base" /></Field>
        <Field label="Subtitle" full><textarea rows={3} value={form.subtitle ?? ''} onChange={e => setForm({ ...form, subtitle: e.target.value })} className="w-full input-base" /></Field>
        <Field label="CTA Login text"><input value={form.ctaLoginText ?? ''} onChange={e => setForm({ ...form, ctaLoginText: e.target.value })} className="w-full input-base" /></Field>
        <Field label="CTA Login URL"><input value={form.ctaLoginUrl ?? ''} onChange={e => setForm({ ...form, ctaLoginUrl: e.target.value })} className="w-full input-base" /></Field>
      </div>
      {err && <div className="mt-3 p-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}
      {ok && <div className="mt-3 p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs">Hero atualizado.</div>}
      <div className="mt-4 flex justify-end">
        <button onClick={save} disabled={saving} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold inline-flex items-center gap-1">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Salvar
        </button>
      </div>
    </GlassCard>
  )
}

function CompetitorsEditor({ items }: { items: AdminCompetitor[]; onChange: () => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map(c => (
        <GlassCard key={c.id} className="p-4">
          <p className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">{c.label}</p>
          <p className={cn('text-lg font-bold mt-1', c.ourValueColor)}>{c.ourValue}</p>
          {c.theirValue && <p className="text-xs text-slate-500 line-through mt-1">{c.theirValue}</p>}
          {c.description && <p className="text-[11px] text-slate-500 mt-2">{c.description}</p>}
        </GlassCard>
      ))}
    </div>
  )
}

function SettingsEditor({ settings, onChange }: { settings: AdminSettings | null; onChange: () => void }) {
  const [form, setForm] = useState<Partial<AdminSettings>>(settings ?? { showAnnualToggle: true, annualDiscountPct: 20, showTabPlans: true, showTabAIs: true, showTabVMS: true, showCompetitorSection: true, defaultCurrency: 'BRL' })
  useEffect(() => { if (settings) setForm(settings) }, [settings])
  const [saving, setSaving] = useState(false); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false)
  async function save() {
    setSaving(true); setErr(null); setOk(false)
    try { const p = { ...form }; delete (p as any).id; await api.put('/admin/pricing/settings', p); setOk(true); onChange() }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message) } finally { setSaving(false) }
  }
  const Toggle = ({ k, label }: { k: keyof AdminSettings; label: string }) => (
    <label className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-white/10 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5">
      <input type="checkbox" checked={!!(form as any)[k]} onChange={e => setForm({ ...form, [k]: e.target.checked })} />
      <span className="text-xs font-semibold text-slate-900 dark:text-white">{label}</span>
    </label>
  )
  return (
    <GlassCard className="p-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Toggle k="showAnnualToggle" label="Toggle Mensal/Anual" />
        <Toggle k="showTabPlans" label="Tab Planos" />
        <Toggle k="showTabAIs" label="Tab IAs" />
        <Toggle k="showTabVMS" label="Tab VMS" />
        <Toggle k="showCompetitorSection" label="Comparativo" />
        <Field label="% desconto anual"><input type="number" min={0} max={100} value={form.annualDiscountPct ?? 20} onChange={e => setForm({ ...form, annualDiscountPct: Number(e.target.value) })} className="w-full input-base" /></Field>
      </div>
      {err && <div className="mt-3 p-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}
      {ok && <div className="mt-3 p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs">Settings atualizados.</div>}
      <div className="mt-4 flex justify-end">
        <button onClick={save} disabled={saving} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold inline-flex items-center gap-1">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Salvar
        </button>
      </div>
    </GlassCard>
  )
}

function Field({ label, hint, full, children }: { label: string; hint?: string; full?: boolean; children: any }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
        {label}{hint && <span className="ml-1 text-slate-400 font-normal normal-case">— {hint}</span>}
      </label>
      {children}
    </div>
  )
}

function Modal({ title, children, onClose, size = 'md' }: { title: string; children: any; onClose: () => void; size?: 'md' | 'xl' }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const maxW = size === 'xl' ? 'max-w-5xl' : 'max-w-2xl'
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className={cn('w-full mt-12 bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-5', maxW)}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-900 dark:text-white text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
