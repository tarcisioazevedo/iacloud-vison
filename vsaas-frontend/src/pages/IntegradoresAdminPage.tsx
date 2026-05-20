/**
 * Sprint U.2.1 — IntegradoresAdminPage
 *
 * Gerenciamento de integradores (SUPER_ADMIN only).
 * Backend hoje expõe:
 *   - POST   /admin/integradores       → cria
 *   - GET    /admin/integradores       → lista com counts
 *   - GET    /admin/integradores/:id/quota → status detalhado
 *
 * Sem PATCH/DELETE no backend ainda — UI é create + read.
 * Edição de módulos vai pelo módulo "Módulos" existente (link "Gerenciar módulos"
 * em cada linha leva pra ModulosAdminPage filtrada).
 */
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Building2, Plus, Search, Eye, EyeOff, Loader2, AlertTriangle, CheckCircle2,
  X, Mail, Briefcase, Users, Activity, Puzzle, ExternalLink,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useIntegradores, useIntegradorQuota, createIntegrador,
  formatApiError, type CreateIntegradorPayload, type IntegradorRow,
} from '../api/client'
import { cn } from '../lib/utils'

export function IntegradoresAdminPage() {
  const { data, error, isLoading, mutate } = useIntegradores()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [drawerId, setDrawerId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const list = data?.integradores ?? []
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter(i => i.name.toLowerCase().includes(q) || i.email.toLowerCase().includes(q))
  }, [data, search])

  const drawerIntegrador = useMemo(
    () => (data?.integradores ?? []).find(i => i.id === drawerId) ?? null,
    [data, drawerId],
  )

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-vsaas-cyan/10 via-white to-vsaas-aqua/10 dark:from-vsaas-cyan/10 dark:via-vsaas-deepNavy/35 dark:to-vsaas-lens/10 border-vsaas-cyan/25 dark:border-vsaas-cyan/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-vsaas-tech to-vsaas-aqua flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Building2 className="w-6 h-6 text-slate-900 dark:text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Integradores
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-vsaas-lens/10 text-vsaas-lens dark:text-violet-300 border border-vsaas-lens/25 dark:border-violet-500/30 font-mono uppercase">
                  super-admin
                </span>
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Empresas-cliente que revendem o VSaaS para seus próprios
                clientes finais. Cada integrador tem <strong className="text-slate-900 dark:text-white">quota
                isolada</strong>, módulos próprios e tenant separado.
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-vsaas-tech via-vsaas-cyan to-vsaas-aqua hover:brightness-105 text-white text-sm font-bold shadow-lg shadow-cyan-500/20 transition"
          >
            <Plus className="w-4 h-4" />
            Novo integrador
          </button>
        </div>
      </GlassCard>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou email..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-vsaas-cyan/70 focus:ring-2 focus:ring-vsaas-cyan/15"
          />
        </div>
        <span className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400 font-mono">
          {filtered.length} {filtered.length === 1 ? 'integrador' : 'integradores'}
        </span>
      </div>

      {/* Errors */}
      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">Falha ao listar integradores</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{friendlyListError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Empty / loading */}
      {isLoading && !data && (
        <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs">Carregando integradores...</p>
        </GlassCard>
      )}

      {data && filtered.length === 0 && !search && (
        <GlassCard className="p-12 text-center">
          <Building2 className="w-12 h-12 mx-auto text-slate-400 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum integrador cadastrado ainda.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-vsaas-cyan/10 hover:bg-vsaas-cyan/15 border border-vsaas-cyan/30 text-vsaas-deepNavy dark:text-vsaas-cyan text-xs font-bold transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Cadastrar o primeiro
          </button>
        </GlassCard>
      )}

      {/* Tabela */}
      {filtered.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[600px]">
            <thead className="bg-white/[0.02] border-b border-slate-200 dark:border-white/5">
              <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5 text-left">Nome</th>
                <th className="px-4 py-2.5 text-left">Email</th>
                <th className="px-4 py-2.5 text-left w-24">Clientes</th>
                <th className="px-4 py-2.5 text-left w-24">Status</th>
                <th className="px-4 py-2.5 text-left w-32">Criado em</th>
                <th className="px-4 py-2.5 text-right w-32">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(i => (
                <IntegradorRowItem key={i.id} integrador={i} onSelect={() => setDrawerId(i.id)} />
              ))}
            </tbody>
          </table></div>
        </GlassCard>
      )}

      <AnimatePresence>
        {showCreate && (
          <CreateIntegradorModal
            onClose={() => setShowCreate(false)}
            onSuccess={() => { mutate(); setShowCreate(false) }}
          />
        )}
        {drawerIntegrador && (
          <IntegradorDrawer integrador={drawerIntegrador} onClose={() => setDrawerId(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function friendlyListError(error: unknown) {
  const message = formatApiError(error)
  if (/network|timeout|ECONN|503|502|504/i.test(message)) {
    return 'API temporariamente indispon?vel. A tela tenta se recuperar automaticamente; verifique o status do backend/banco se persistir.'
  }
  return message
}
function IntegradorRowItem({ integrador, onSelect }: { integrador: IntegradorRow; onSelect: () => void }) {
  return (
    <tr className="border-b border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition cursor-pointer" onClick={onSelect}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-vsaas-tech/25 to-vsaas-aqua/25 border border-vsaas-cyan/30 flex items-center justify-center text-[11px] font-bold text-vsaas-deepNavy dark:text-vsaas-cyan">
            {integrador.name[0]?.toUpperCase() ?? 'I'}
          </div>
          <span className="text-sm font-medium text-slate-900 dark:text-white">{integrador.name}</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{integrador.email}</td>
      <td className="px-4 py-2.5">
        <span className="px-2 py-0.5 rounded text-[10px] bg-vsaas-cyan/10 text-vsaas-deepNavy dark:text-vsaas-cyan border border-vsaas-cyan/30 font-mono">
          {integrador._count.clienteFinais}
        </span>
      </td>
      <td className="px-4 py-2.5">
        {integrador.active ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-300">
            <CheckCircle2 className="w-3 h-3" /> Ativo
          </span>
        ) : (
          <span className="text-[10px] text-slate-500">Inativo</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-[10px] text-slate-500 font-mono">
        {new Date(integrador.createdAt).toLocaleDateString('pt-BR')}
      </td>
      <td className="px-4 py-2.5 text-right">
        <Link
          to={`/admin/modulos`}
          onClick={e => e.stopPropagation()}
          title="Gerenciar módulos"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-slate-400 hover:text-violet-300 hover:bg-violet-500/10 transition"
        >
          <Puzzle className="w-3 h-3" />
          Módulos
        </Link>
      </td>
    </tr>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function IntegradorDrawer({ integrador, onClose }: { integrador: IntegradorRow; onClose: () => void }) {
  const { data: quotaData, error: quotaErr, isLoading } = useIntegradorQuota(integrador.id)

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }}
        transition={{ type: 'tween', duration: 0.2 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg h-full bg-white dark:bg-space-900 border-l border-slate-200 dark:border-white/10 overflow-y-auto shadow-2xl"
      >
        <header className="sticky top-0 bg-white/95 dark:bg-space-900/95 backdrop-blur border-b border-slate-200 dark:border-white/10 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{integrador.name}</h3>
            <p className="text-xs text-slate-500 font-mono">{integrador.email}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:text-white">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {/* Cards de status */}
          <div className="grid grid-cols-2 gap-2">
            <Tile icon={Users} label="Clientes finais" value={String(integrador._count.clienteFinais)} accent="cyan" />
            <Tile icon={Activity} label="Status" value={integrador.active ? 'Ativo' : 'Inativo'} accent={integrador.active ? 'emerald' : 'slate'} />
          </div>

          {/* Quota */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <Briefcase className="w-3 h-3" />
              Quota do mês corrente
            </h4>
            {isLoading ? (
              <div className="h-32 flex items-center justify-center text-slate-600">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : quotaErr ? (
              <p className="text-xs text-rose-600 dark:text-rose-300">{formatApiError(quotaErr)}</p>
            ) : quotaData?.quota ? (
              <div className="space-y-3">
                <QuotaBar
                  label="Static Vision (req/mês)"
                  used={quotaData.quota.staticVisionMonthlyUsed}
                  limit={quotaData.quota.staticVisionMonthlyLimit}
                />
                <QuotaBar
                  label="Streaming (min/mês)"
                  used={quotaData.quota.streamingMinutesUsed}
                  limit={quotaData.quota.streamingMinutesLimit}
                />
                <p className="text-[10px] text-slate-500 font-mono">
                  Período: {new Date(quotaData.quota.periodStart).toLocaleDateString('pt-BR')}
                  {' → '}
                  {new Date(quotaData.quota.periodEnd).toLocaleDateString('pt-BR')}
                </p>
              </div>
            ) : null}
          </div>

          {/* Ações */}
          <div className="pt-2 border-t border-slate-200 dark:border-white/5 space-y-2">
            <Link
              to="/admin/modulos"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-sm text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition"
            >
              <Puzzle className="w-4 h-4 text-vsaas-lens dark:text-violet-300" />
              Gerenciar módulos contratados
              <ExternalLink className="w-3 h-3 ml-auto text-slate-500" />
            </Link>
            <Link
              to="/admin/modulos/utilization"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-sm text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition"
            >
              <Activity className="w-4 h-4 text-vsaas-cyan" />
              Ver utilização (contratado vs uso)
              <ExternalLink className="w-3 h-3 ml-auto text-slate-500" />
            </Link>
          </div>

          {/* Aviso edição */}
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20">
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              <strong>Edição inline indisponível.</strong> O backend ainda não expõe
              <code className="px-1 mx-1 text-amber-700 dark:text-amber-200">PATCH /admin/integradores/:id</code>
              nem <code className="px-1 mx-1 text-amber-700 dark:text-amber-200">DELETE</code>. Para alterar
              dados, use o cliente Prisma ou aguarde Sprint U.2 backend.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function Tile({ icon: Icon, label, value, accent }: any) {
  const colors = {
    cyan:    'text-vsaas-deepNavy dark:text-vsaas-cyan border-vsaas-cyan/25 bg-vsaas-cyan/5 dark:bg-vsaas-cyan/10',
    emerald: 'text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10',
    slate:   'text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03]',
  }[accent as string]
  return (
    <div className={cn('p-3 rounded-lg border', colors)}>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-500">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <p className="text-base font-bold mt-1">{value}</p>
    </div>
  )
}

function QuotaBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const safeLimit = Math.max(1, limit)
  const pct = Math.min(100, (used / safeLimit) * 100)
  const color = pct > 90 ? 'rose' : pct > 70 ? 'amber' : 'emerald'
  const colorClass = {
    rose:    'bg-rose-500',
    amber:   'bg-amber-500',
    emerald: 'bg-emerald-500',
  }[color]
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-600 dark:text-slate-400">{label}</span>
        <span className="text-slate-600 dark:text-slate-300 font-mono">{used.toLocaleString('pt-BR')} / {limit.toLocaleString('pt-BR')}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
        <div className={cn('h-full transition-all', colorClass)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-slate-500 mt-0.5">{Math.round(pct)}% utilizado</p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function CreateIntegradorModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<CreateIntegradorPayload>({
    name: '',
    email: '',
    password: '',
    staticVisionMonthlyLimit: 50_000,
    streamingMinutesLimit: 6_000,
  })
  const [showPwd, setShowPwd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function update<K extends keyof CreateIntegradorPayload>(key: K, value: CreateIntegradorPayload[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await createIntegrador(form)
      onSuccess()
    } catch (e) {
      setErr(formatApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-2xl space-y-4"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Novo integrador</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Cria conta com role <code className="text-vsaas-lens dark:text-violet-300">INTEGRADOR_ADMIN</code> + quota inicial.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:text-white">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="space-y-3">
          <Input label="Nome da empresa *" value={form.name} onChange={v => update('name', v)} />
          <Input label="Razão social" value={form.tradeName ?? ''} onChange={v => update('tradeName', v)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="CNPJ" value={form.cnpj ?? ''} onChange={v => update('cnpj', v)} placeholder="00.000.000/0001-00" />
            <Input label="Telefone" value={form.phone ?? ''} onChange={v => update('phone', v)} />
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-white/5 space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-vsaas-deepNavy dark:text-vsaas-cyan flex items-center gap-1.5">
              <Mail className="w-3 h-3" />
              Credenciais do admin
            </p>
            <Input label="Email *" type="email" value={form.email} onChange={v => update('email', v)} />
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Senha * (mín. 8)</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => update('password', e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-3 py-2 pr-10 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-vsaas-cyan/70 focus:ring-2 focus:ring-vsaas-cyan/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 dark:text-white"
                >
                  {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-white/5 space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-vsaas-deepNavy dark:text-vsaas-cyan">Quota inicial mensal</p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Static Vision (req/mês)"
                type="number"
                value={String(form.staticVisionMonthlyLimit ?? 50_000)}
                onChange={v => update('staticVisionMonthlyLimit', Math.max(1, Number(v) || 0))}
              />
              <Input
                label="Streaming (min/mês)"
                type="number"
                value={String(form.streamingMinutesLimit ?? 6_000)}
                onChange={v => update('streamingMinutesLimit', Math.max(1, Number(v) || 0))}
              />
            </div>
            <Input
              label="GCP Project ID (opcional)"
              value={form.gcpProjectId ?? ''}
              onChange={v => update('gcpProjectId', v)}
              placeholder="meu-projeto-gcp"
            />
          </div>
        </div>

        {err && (
          <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-300">
            {err}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-900 dark:text-white text-xs"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || !form.name || !form.email || !form.password || form.password.length < 8}
            className="flex-1 px-3 py-2 rounded-lg bg-gradient-to-r from-vsaas-tech via-vsaas-cyan to-vsaas-aqua hover:brightness-105 text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Criar
          </button>
        </div>
      </motion.form>
    </motion.div>
  )
}

function Input({
  label, value, onChange, type = 'text', placeholder,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-vsaas-cyan/70 focus:ring-2 focus:ring-vsaas-cyan/15"
      />
    </div>
  )
}
