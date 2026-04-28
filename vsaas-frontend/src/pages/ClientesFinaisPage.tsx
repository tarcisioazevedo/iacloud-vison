/**
 * Sprint Gap 5 — ClientesFinaisPage
 *
 * Cadastro/listagem de clientes finais B2B2B do integrador.
 * Inclui campo `commercialPlan` (textarea livre) onde o integrador descreve
 * o pacote contratado — o sistema NÃO interpreta o conteúdo, apenas guarda.
 *
 * Escopo:
 *   - SUPER_ADMIN     vê todos / cria em qualquer integrador
 *   - INTEGRADOR_ADMIN vê os próprios / cria no próprio integ
 *   - INTEGRADOR_TECNICO vê os próprios (somente leitura)
 *   - CLIENTE_*       vê apenas o próprio (read-only)
 */
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSWRConfig } from 'swr'
import {
  Building2, Plus, Search, X, Loader2, Mail, MapPin, FileText,
  Edit3, AlertTriangle, CheckCircle2, Briefcase, Link as LinkIcon,
  UserCog, Trash2,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PortalTokenModal } from '../components/portal/PortalTokenModal'
import {
  useClientesFinais, createClienteFinal, updateClienteFinal,
  formatApiError, api,
  type ClienteFinalRow, type ClienteFinalPayload, type Vertical,
} from '../api/client'
import { cn } from '../lib/utils'

const userRole = (typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : '')
const canManage = ['SUPER_ADMIN', 'INTEGRADOR_ADMIN'].includes(userRole)
const isSuperAdmin = userRole === 'SUPER_ADMIN'

const VERTICALS: { value: Vertical; label: string }[] = [
  { value: 'RETAIL',        label: 'Varejo' },
  { value: 'SHOPPING',      label: 'Shopping' },
  { value: 'EDUCATION',     label: 'Educação' },
  { value: 'INDUSTRY',      label: 'Indústria' },
  { value: 'LOGISTICS',     label: 'Logística' },
  { value: 'PARKING',       label: 'Estacionamento' },
  { value: 'CONDOMINIUM',   label: 'Condomínio' },
  { value: 'PUBLIC_SAFETY', label: 'Segurança Pública' },
  { value: 'OTHER',         label: 'Outro' },
]
const VERTICAL_COLORS: Record<Vertical, string> = {
  RETAIL:        'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  SHOPPING:      'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-500/15 dark:text-pink-300 dark:border-pink-500/30',
  EDUCATION:     'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  INDUSTRY:      'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
  LOGISTICS:     'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
  PARKING:       'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30',
  CONDOMINIUM:   'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  PUBLIC_SAFETY: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  OTHER:         'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30',
}

export function ClientesFinaisPage() {
  const { data, error, isLoading } = useClientesFinais()
  const [search, setSearch] = useState('')
  const [verticalFilter, setVerticalFilter] = useState<Vertical | ''>('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ClienteFinalRow | null>(null)
  const [portalFor, setPortalFor]   = useState<ClienteFinalRow | null>(null)
  const [techFor,   setTechFor]     = useState<ClienteFinalRow | null>(null)

  const clientes = data?.clientes ?? []
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return clientes.filter(c => {
      if (verticalFilter && c.vertical !== verticalFilter) return false
      if (!s) return true
      return (
        c.name.toLowerCase().includes(s) ||
        (c.tradeName ?? '').toLowerCase().includes(s) ||
        c.email.toLowerCase().includes(s) ||
        (c.cnpj ?? '').toLowerCase().includes(s) ||
        (c.commercialPlan ?? '').toLowerCase().includes(s)
      )
    })
  }, [clientes, search, verticalFilter])

  return (
    <div className="space-y-6">
      {/* Hero */}
      <GlassCard className="p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-cyan-100 border border-cyan-200 dark:bg-cyan-500/20 dark:border-cyan-500/40 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-cyan-700 dark:text-cyan-300" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Clientes Finais</h1>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-400 max-w-2xl">
              Empresas atendidas por este integrador. Cada cliente final tem seus
              próprios sites, câmeras e usuários — totalmente isolados no
              modelo B2B2B. O <strong className="text-slate-900 dark:text-white">plano comercial</strong> é
              um campo de texto livre onde você registra o que foi acordado.
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-cyan-100 hover:bg-cyan-200 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/20 dark:hover:bg-cyan-500/30 dark:border-cyan-500/40 dark:text-cyan-200 rounded-xl text-sm font-medium transition shrink-0"
            >
              <Plus className="w-4 h-4" />
              Novo Cliente Final
            </button>
          )}
        </div>
      </GlassCard>

      {/* Filtros */}
      <GlassCard className="p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por nome, CNPJ, email ou plano…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select
            value={verticalFilter}
            onChange={e => setVerticalFilter(e.target.value as Vertical | '')}
            className={inputCls + ' md:w-56'}
          >
            <option value="">Todas as verticais</option>
            {VERTICALS.map(v => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
      </GlassCard>

      {/* Lista */}
      {isLoading && (
        <GlassCard className="p-12 text-center">
          <Loader2 className="w-6 h-6 text-cyan-700 dark:text-cyan-400 mx-auto animate-spin" />
          <p className="text-slate-700 dark:text-slate-400 text-sm mt-3">Carregando clientes…</p>
        </GlassCard>
      )}
      {error && (
        <GlassCard className="p-6 border-rose-500/30 bg-rose-50 dark:bg-rose-500/5">
          <div className="flex items-center gap-3 text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-5 h-5" />
            <p className="text-sm">{formatApiError(error)}</p>
          </div>
        </GlassCard>
      )}
      {!isLoading && !error && filtered.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Building2 className="w-10 h-10 text-slate-400 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-700 dark:text-slate-400 text-sm">
            {clientes.length === 0
              ? 'Nenhum cliente final cadastrado ainda.'
              : 'Nenhum cliente corresponde ao filtro.'}
          </p>
        </GlassCard>
      )}
      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(c => (
            <ClienteCard
              key={c.id}
              cliente={c}
              canEdit={canManage}
              onEdit={() => setEditing(c)}
              onOpenPortal={canManage ? () => setPortalFor(c) : undefined}
              onOpenTech={canManage ? () => setTechFor(c) : undefined}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {createOpen && (
          <UpsertModal
            mode="create"
            onClose={() => setCreateOpen(false)}
          />
        )}
        {editing && (
          <UpsertModal
            mode="edit"
            cliente={editing}
            onClose={() => setEditing(null)}
          />
        )}
        {portalFor && (
          <PortalTokenModal
            cliente={portalFor}
            onClose={() => setPortalFor(null)}
          />
        )}
        {techFor && (
          <TechAccessModal
            cliente={techFor}
            onClose={() => setTechFor(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────
function ClienteCard({
  cliente, canEdit, onEdit, onOpenPortal, onOpenTech,
}: { cliente: ClienteFinalRow; canEdit: boolean; onEdit: () => void; onOpenPortal?: () => void; onOpenTech?: () => void }) {
  const verticalLbl = VERTICALS.find(v => v.value === cliente.vertical)?.label ?? cliente.vertical
  return (
    <GlassCard className={cn('p-5', !cliente.active && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-slate-900 dark:text-white truncate">{cliente.name}</h3>
            {!cliente.active && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30 border">
                INATIVO
              </span>
            )}
          </div>
          {cliente.tradeName && (
            <p className="text-xs text-slate-500 truncate">{cliente.tradeName}</p>
          )}
        </div>
        <span className={cn('text-[10px] px-2 py-1 rounded-full border whitespace-nowrap', VERTICAL_COLORS[cliente.vertical])}>
          {verticalLbl}
        </span>
      </div>

      <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-400 mb-3">
        <div className="flex items-center gap-2">
          <Mail className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{cliente.email}</span>
        </div>
        {(cliente.city || cliente.state) && (
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>{[cliente.city, cliente.state].filter(Boolean).join(' / ')}</span>
          </div>
        )}
        {cliente.cnpj && (
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono">{cliente.cnpj}</span>
          </div>
        )}
      </div>

      {/* Plano comercial — destaque */}
      {cliente.commercialPlan ? (
        <div className="mb-3 p-3 rounded-lg bg-cyan-50 border border-cyan-200 dark:bg-cyan-500/5 dark:border-cyan-500/20">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300 font-semibold mb-1">
            <Briefcase className="w-3 h-3" />
            Plano comercial
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap line-clamp-3">
            {cliente.commercialPlan}
          </p>
        </div>
      ) : canEdit ? (
        <div className="mb-3 p-2 rounded-lg bg-slate-100 border border-dashed border-slate-300 dark:bg-slate-800/40 dark:border-slate-700">
          <p className="text-[11px] text-slate-500 italic">Plano comercial não preenchido</p>
        </div>
      ) : null}

      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-3 border-t border-slate-200 dark:border-white/5">
        <div className="flex items-center gap-3">
          <span>{cliente._count?.sites ?? 0} sites</span>
          <span>·</span>
          <span>{cliente._count?.users ?? 0} usuários</span>
          {isSuperAdmin && cliente.integrador && (
            <>
              <span>·</span>
              <span className="text-cyan-700 dark:text-cyan-300">{cliente.integrador.name}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onOpenTech && (
            <button
              onClick={onOpenTech}
              className="flex items-center gap-1 px-2 py-1 rounded text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/10 transition"
              title="Acessos de técnicos"
            >
              <UserCog className="w-3 h-3" />
              Técnicos
            </button>
          )}
          {onOpenPortal && (
            <button
              onClick={onOpenPortal}
              className="flex items-center gap-1 px-2 py-1 rounded text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/10 transition"
              title="Magic-links do portal cliente-final"
            >
              <LinkIcon className="w-3 h-3" />
              Portal
            </button>
          )}
          {canEdit && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1 px-2 py-1 rounded text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-500/10 transition"
              title="Editar"
            >
              <Edit3 className="w-3 h-3" />
              Editar
            </button>
          )}
        </div>
      </div>
    </GlassCard>
  )
}

// ─── Modal Create/Edit ───────────────────────────────────────────────────────
function UpsertModal({
  mode, cliente, onClose,
}: { mode: 'create' | 'edit'; cliente?: ClienteFinalRow; onClose: () => void }) {
  const { mutate } = useSWRConfig()
  const [form, setForm] = useState<ClienteFinalPayload>({
    name:           cliente?.name ?? '',
    tradeName:      cliente?.tradeName ?? '',
    cnpj:           cliente?.cnpj ?? '',
    email:          cliente?.email ?? '',
    phone:          cliente?.phone ?? '',
    city:           cliente?.city ?? '',
    state:          cliente?.state ?? '',
    country:        'BR',
    vertical:       cliente?.vertical ?? 'RETAIL',
    commercialPlan: cliente?.commercialPlan ?? '',
    portalSlug:     cliente?.portalSlug ?? '',
    primaryColor:   cliente?.primaryColor ?? '',
    secondaryColor: cliente?.secondaryColor ?? '',
    logoUrl:        cliente?.logoUrl ?? '',
    integradorId:   undefined,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof ClienteFinalPayload>(k: K, v: ClienteFinalPayload[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function submit() {
    setBusy(true); setErr(null)
    try {
      // Limpa campos vazios para o zod aceitar
      const payload: any = { ...form }
      Object.keys(payload).forEach(k => {
        if (payload[k] === '' || payload[k] === undefined) delete payload[k]
      })
      if (mode === 'create') {
        await createClienteFinal(payload)
      } else {
        await updateClienteFinal(cliente!.id, payload)
      }
      await mutate('/clientes-finais')
      onClose()
    } catch (e) {
      setErr(formatApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={mode === 'create' ? 'Novo Cliente Final' : `Editar: ${cliente?.name}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Razão social *">
            <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <Field label="Nome fantasia">
            <input className={inputCls} value={form.tradeName ?? ''} onChange={e => set('tradeName', e.target.value)} />
          </Field>
          <Field label="CNPJ">
            <input className={inputCls + ' font-mono'} value={form.cnpj ?? ''} onChange={e => set('cnpj', e.target.value)} placeholder="00.000.000/0000-00" />
          </Field>
          <Field label="Email *">
            <input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} />
          </Field>
          <Field label="Telefone">
            <input className={inputCls} value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} />
          </Field>
          <Field label="Vertical *">
            <select className={inputCls} value={form.vertical} onChange={e => set('vertical', e.target.value as Vertical)}>
              {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Cidade">
            <input className={inputCls} value={form.city ?? ''} onChange={e => set('city', e.target.value)} />
          </Field>
          <Field label="UF">
            <input className={inputCls} maxLength={2} value={form.state ?? ''} onChange={e => set('state', e.target.value.toUpperCase())} />
          </Field>
        </div>

        {/* commercialPlan — campo central do Gap 5 */}
        <Field label="Plano comercial (texto livre)" hint="Descreva o pacote acordado: nº de câmeras, módulos contratados, SLA, condições de suporte etc.">
          <textarea
            rows={5}
            className={inputCls + ' resize-y leading-relaxed'}
            value={form.commercialPlan ?? ''}
            onChange={e => set('commercialPlan', e.target.value)}
            placeholder={'Ex.:\n- Pacote 50 câmeras + 2 módulos (Faces + LPR)\n- SLA 99,5% • Suporte 8x5\n- Vigência 12 meses, reajuste IPCA'}
          />
        </Field>

        {/* Branding do portal cliente-final (CF.4) ──────────────────── */}
        <div className="pt-4 mt-4 border-t border-slate-200 dark:border-white/5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-semibold">
              Portal white-label
            </span>
            <span className="text-[10px] text-slate-500">
              Aparência do portal entregue ao cliente final
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Slug do portal" hint="Aparece na URL: /portal/{slug}. Lowercase, números, hífen. 2–40 chars.">
              <input
                className={inputCls + ' font-mono text-xs lowercase'}
                value={form.portalSlug ?? ''}
                onChange={e => set('portalSlug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="acme-corp"
                maxLength={40}
              />
            </Field>
            <Field label="Logo URL" hint="URL pública pra logo do cliente. Use HTTPS.">
              <input
                className={inputCls + ' text-xs'}
                value={form.logoUrl ?? ''}
                onChange={e => set('logoUrl', e.target.value)}
                placeholder="https://cdn.cliente.com/logo.png"
              />
            </Field>
            <Field label="Cor primária" hint="Hex #RRGGBB. Usada no header e botões.">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="w-10 h-10 rounded border border-slate-200 dark:border-white/10 bg-transparent cursor-pointer"
                  value={form.primaryColor || '#06b6d4'}
                  onChange={e => set('primaryColor', e.target.value)}
                />
                <input
                  className={inputCls + ' font-mono text-xs flex-1'}
                  value={form.primaryColor ?? ''}
                  onChange={e => set('primaryColor', e.target.value)}
                  placeholder="#06b6d4"
                  maxLength={7}
                />
              </div>
            </Field>
            <Field label="Cor secundária" hint="Hex #RRGGBB. Acentos e destaques.">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="w-10 h-10 rounded border border-slate-200 dark:border-white/10 bg-transparent cursor-pointer"
                  value={form.secondaryColor || '#8b5cf6'}
                  onChange={e => set('secondaryColor', e.target.value)}
                />
                <input
                  className={inputCls + ' font-mono text-xs flex-1'}
                  value={form.secondaryColor ?? ''}
                  onChange={e => set('secondaryColor', e.target.value)}
                  placeholder="#8b5cf6"
                  maxLength={7}
                />
              </div>
            </Field>
          </div>
        </div>

        {isSuperAdmin && mode === 'create' && (
          <Field label="ID do Integrador (somente SUPER_ADMIN)" hint="UUID do integrador que vai ser dono deste cliente final.">
            <input className={inputCls + ' font-mono text-xs'} value={form.integradorId ?? ''} onChange={e => set('integradorId', e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          </Field>
        )}
      </div>

      {err && (
        <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition">
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={busy || !form.name || !form.email}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-100 hover:bg-cyan-200 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/20 dark:hover:bg-cyan-500/30 dark:border-cyan-500/40 dark:text-cyan-200 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {mode === 'create' ? 'Cadastrar' : 'Salvar'}
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const inputCls =
  'w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 ' +
  'dark:bg-space-800/40 dark:border-white/10 dark:text-white dark:placeholder:text-slate-600 rounded-lg text-sm ' +
  'focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-slate-700 dark:text-slate-400 font-medium mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-slate-500 dark:text-slate-600 mt-1">{hint}</span>}
    </label>
  )
}

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white border border-slate-200 dark:bg-space-900 dark:border-white/10 rounded-2xl p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-200 dark:border-white/5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="p-1 rounded text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}

// ─── TechAccessModal — Lote 3 ────────────────────────────────────────────────

interface TechAccessEntry {
  id:               string
  technicianUserId: string
  scope:            string
  grantedAt:        string
  technician: { id: string; name: string; email: string; role: string }
}

function TechAccessModal({ cliente, onClose }: { cliente: ClienteFinalRow; onClose: () => void }) {
  const [accesses, setAccesses]     = useState<TechAccessEntry[]>([])
  const [loading,  setLoading]      = useState(true)
  const [fetchErr, setFetchErr]     = useState('')
  const [grantEmail, setGrantEmail] = useState('')
  const [grantScope, setGrantScope] = useState<'FULL' | 'OPERATOR' | 'VIEWER'>('FULL')
  const [granting,   setGranting]   = useState(false)
  const [grantErr,   setGrantErr]   = useState('')
  const [revoking,   setRevoking]   = useState<string | null>(null)

  const loadAccesses = async () => {
    try {
      const r = await api.get(`/technician-access?clienteFinalId=${cliente.id}`)
      setAccesses(r.data.accesses ?? [])
    } catch (e) {
      setFetchErr(formatApiError(e))
    } finally {
      setLoading(false)
    }
  }

  useState(() => { loadAccesses() })

  async function grant() {
    if (!grantEmail.trim()) return
    setGranting(true)
    setGrantErr('')
    try {
      // Look up user by email first
      const usersResp = await api.get(`/users?role=INTEGRADOR_TECNICO&q=${encodeURIComponent(grantEmail.trim())}`)
      const users = usersResp.data.users ?? []
      const tech = users.find((u: any) => u.email.toLowerCase() === grantEmail.trim().toLowerCase())
      if (!tech) { setGrantErr('Técnico não encontrado — verifique o e-mail'); return }
      await api.post('/technician-access', {
        technicianUserId: tech.id,
        clienteFinalId:   cliente.id,
        scope:            grantScope,
      })
      setGrantEmail('')
      await loadAccesses()
    } catch (e) {
      setGrantErr(formatApiError(e))
    } finally {
      setGranting(false)
    }
  }

  async function revoke(id: string) {
    setRevoking(id)
    try {
      await api.delete(`/technician-access/${id}`)
      setAccesses((prev) => prev.filter((a) => a.id !== id))
    } finally {
      setRevoking(null)
    }
  }

  return (
    <ModalShell title={`Acessos de Técnicos — ${cliente.name}`} onClose={onClose}>
      {/* Conceder acesso */}
      <div className="mb-5 p-4 rounded-xl bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20">
        <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-3">Conceder acesso a técnico</p>
        <div className="flex gap-2 flex-wrap">
          <input
            value={grantEmail}
            onChange={(e) => setGrantEmail(e.target.value)}
            placeholder="E-mail do técnico"
            className={inputCls + ' flex-1 min-w-[180px]'}
          />
          <select
            value={grantScope}
            onChange={(e) => setGrantScope(e.target.value as any)}
            className={inputCls + ' w-32'}
          >
            <option value="FULL">FULL</option>
            <option value="OPERATOR">OPERATOR</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <button
            onClick={grant}
            disabled={granting || !grantEmail.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-40 flex items-center gap-1.5 transition"
          >
            {granting ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <UserCog className="w-3.5 h-3.5"/>}
            Conceder
          </button>
        </div>
        {grantErr && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0"/> {grantErr}
          </p>
        )}
      </div>

      {/* Lista de acessos */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2"/> Carregando…
        </div>
      ) : fetchErr ? (
        <p className="text-xs text-rose-500 text-center py-4">{fetchErr}</p>
      ) : accesses.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-6 italic">
          Sem restrições de acesso — todos os técnicos do integrador podem acessar este cliente.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {accesses.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">{a.technician.name}</p>
                <p className="text-xs text-slate-500">{a.technician.email}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Escopo: <strong>{a.scope}</strong> · Concedido {new Date(a.grantedAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <button
                onClick={() => revoke(a.id)}
                disabled={revoking === a.id}
                className="ml-3 px-2 py-1.5 rounded-lg text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition disabled:opacity-40"
              >
                {revoking === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Trash2 className="w-3.5 h-3.5"/>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  )
}
