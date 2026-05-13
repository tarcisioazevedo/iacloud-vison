/**
 * Sprint Gap 4 — UsersPage
 *
 * Página de usuários do tenant, escopada via JWT no backend.
 *
 * Funcionalidades:
 *  - Listar usuários (GET /users) com filtro por role
 *  - Convidar novo usuário (POST /users/invite) — modal apresenta a senha
 *    temporária UMA vez, com botão de copiar; se SMTP estiver configurado
 *    no backend o convidado recebe email automaticamente.
 *
 * Quem pode convidar (validado também no backend):
 *  - SUPER_ADMIN     → qualquer role
 *  - INTEGRADOR_ADMIN → INTEGRADOR_TECNICO (próprio integ) ou CLIENTE_*
 *  - CLIENTE_ADMIN   → CLIENTE_OPERADOR/VIEWER do próprio cliente final
 */
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSWRConfig } from 'swr'
import {
  Users, Plus, Search, X, Loader2, Copy, Check, Mail, AlertTriangle,
  ShieldCheck, Building2, UserPlus, Clock, Shield,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useUsers, useClientesModules, inviteUser, formatApiError,
  type UserRow, type AppRole, type InviteResponse, type InvitePayload,
} from '../api/client'
import { cn } from '../lib/utils'

const userRole = (typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : '') as AppRole | ''
const canInviteAny     = ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'CLIENTE_ADMIN'].includes(userRole)
const isSuperAdmin     = userRole === 'SUPER_ADMIN'
const isIntegradorAdmin= userRole === 'INTEGRADOR_ADMIN'

const ROLE_BADGES: Record<AppRole, string> = {
  SUPER_ADMIN:        'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
  INTEGRADOR_ADMIN:   'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30',
  INTEGRADOR_TECNICO: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-200 dark:border-cyan-500/20',
  CLIENTE_ADMIN:      'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  CLIENTE_OPERADOR:   'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/20',
  CLIENTE_VIEWER:     'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30',
}
const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN:        'Super Admin',
  INTEGRADOR_ADMIN:   'Integrador Admin',
  INTEGRADOR_TECNICO: 'Integrador Técnico',
  CLIENTE_ADMIN:      'Cliente Admin',
  CLIENTE_OPERADOR:   'Cliente Operador',
  CLIENTE_VIEWER:     'Cliente Visualizador',
}

export function UsersPage() {
  const { data, error, isLoading } = useUsers()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<AppRole | ''>('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteResult, setInviteResult] = useState<InviteResponse | null>(null)

  const users = data?.users ?? []

  const filtered = useMemo(() => {
    return users.filter(u => {
      if (roleFilter && u.role !== roleFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!u.email.toLowerCase().includes(q) && !u.name.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [users, search, roleFilter])

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-violet-500/5 to-transparent border-cyan-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Usuários</h1>
              <p className="text-sm text-slate-700 dark:text-slate-400 mt-1 max-w-2xl">
                Pessoas com acesso ao seu tenant. Convide novos com função
                específica — backend gera senha temporária e (se SMTP configurado)
                envia por email.
              </p>
            </div>
          </div>
          {canInviteAny && (
            <button
              onClick={() => setInviteOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-100 hover:bg-cyan-200 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:hover:bg-cyan-500/25 dark:border-cyan-500/30 dark:text-cyan-200 text-xs font-bold transition"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Convidar usuário
            </button>
          )}
        </div>
      </GlassCard>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou email..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-slate-600 text-sm focus:outline-none focus:border-cyan-500/50"
          />
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as AppRole | '')}
          className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 dark:bg-white/5 dark:border-white/10 dark:text-slate-300 text-xs"
        >
          <option value="" className="bg-white dark:bg-space-900">Todas as funções</option>
          {(Object.keys(ROLE_LABELS) as AppRole[]).map(r => (
            <option key={r} value={r} className="bg-white dark:bg-space-900">{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <span className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/5 dark:border-white/10 text-xs text-slate-700 dark:text-slate-400 font-mono">
          {filtered.length} / {users.length}
        </span>
      </div>

      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Falha ao listar usuários</p>
              <p className="text-xs text-slate-700 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {isLoading && !data && (
        <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs">Carregando usuários...</p>
        </GlassCard>
      )}

      {filtered.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[500px]">
            <thead className="bg-slate-100 dark:bg-white/5 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Usuário</th>
                <th className="text-left px-4 py-3">Função</th>
                <th className="text-left px-4 py-3">Tenant</th>
                <th className="text-left px-4 py-3">Último login</th>
                <th className="text-right px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => <UserRowItem key={u.id} user={u} />)}
            </tbody>
          </table></div>
        </GlassCard>
      )}

      {data && filtered.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Users className="w-12 h-12 mx-auto text-slate-400 dark:text-slate-700 mb-3" />
          <p className="text-sm text-slate-700 dark:text-slate-400">
            {search || roleFilter ? 'Nenhum usuário bate com o filtro.' : 'Nenhum usuário cadastrado.'}
          </p>
        </GlassCard>
      )}

      <AnimatePresence>
        {inviteOpen && (
          <InviteModal
            onClose={() => setInviteOpen(false)}
            onSuccess={result => {
              setInviteOpen(false)
              setInviteResult(result)
            }}
          />
        )}
        {inviteResult && (
          <InviteResultModal
            result={inviteResult}
            onClose={() => setInviteResult(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function UserRowItem({ user }: { user: UserRow }) {
  return (
    <tr className="border-t border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:bg-white/5">
      <td className="px-4 py-3">
        <p className="text-white font-medium">{user.name}</p>
        <p className="text-[11px] text-slate-500">{user.email}</p>
      </td>
      <td className="px-4 py-3">
        <span className={cn('px-2 py-0.5 rounded text-[10px] border font-mono uppercase', ROLE_BADGES[user.role])}>
          {ROLE_LABELS[user.role]}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-slate-400">
        {user.clienteFinal?.name ?? user.integrador?.name ?? <span className="text-slate-600">—</span>}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {user.lastLoginAt
          ? <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> {new Date(user.lastLoginAt).toLocaleDateString('pt-BR')}</span>
          : <span className="italic text-slate-600">nunca</span>}
      </td>
      <td className="px-4 py-3 text-right">
        {user.active
          ? <span className="text-[10px] uppercase font-mono text-emerald-300">ativo</span>
          : <span className="text-[10px] uppercase font-mono text-rose-300">inativo</span>}
      </td>
    </tr>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function InviteModal({ onClose, onSuccess }: {
  onClose: () => void
  onSuccess: (r: InviteResponse) => void
}) {
  const { mutate } = useSWRConfig()
  const { data: clientesData } = useClientesModules()
  const clientes = clientesData?.clientes ?? []

  // Roles que o convidador pode escolher.
  const availableRoles: InvitePayload['role'][] = useMemo(() => {
    if (isSuperAdmin) return ['INTEGRADOR_TECNICO', 'CLIENTE_ADMIN', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER']
    if (isIntegradorAdmin) return ['INTEGRADOR_TECNICO', 'CLIENTE_ADMIN', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER']
    // CLIENTE_ADMIN
    return ['CLIENTE_OPERADOR', 'CLIENTE_VIEWER']
  }, [])

  const [form, setForm] = useState<InvitePayload>({
    email: '', name: '', role: availableRoles[0],
    clienteFinalId: undefined,
    integradorId:   undefined,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const needsClienteFinal = form.role.startsWith('CLIENTE_') && !['CLIENTE_OPERADOR', 'CLIENTE_VIEWER'].some(r => userRole === 'CLIENTE_ADMIN' && r === form.role)
    || (form.role.startsWith('CLIENTE_') && userRole !== 'CLIENTE_ADMIN')

  const needsIntegrador = isSuperAdmin && form.role === 'INTEGRADOR_TECNICO'

  async function submit() {
    if (!form.email || !form.name) {
      setError('Email e nome são obrigatórios')
      return
    }
    if (needsClienteFinal && !form.clienteFinalId) {
      setError('Selecione o cliente final')
      return
    }
    if (needsIntegrador && !form.integradorId) {
      setError('Informe o integradorId')
      return
    }
    setSaving(true); setError(null)
    try {
      const result = await inviteUser({
        email: form.email.trim().toLowerCase(),
        name:  form.name.trim(),
        role:  form.role,
        clienteFinalId: form.clienteFinalId || undefined,
        integradorId:   form.integradorId   || undefined,
      })
      await mutate('/users')
      onSuccess(result)
    } catch (err: any) {
      setError(formatApiError(err))
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Convidar usuário" onClose={onClose} accent="cyan">
      <div className="space-y-3 text-sm">
        <Field label="Email *">
          <input
            type="email" value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="usuario@empresa.com.br"
            className={inputCls}
          />
        </Field>
        <Field label="Nome *">
          <input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Maria Silva"
            className={inputCls}
          />
        </Field>
        <Field label="Função *">
          <select
            value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value as InvitePayload['role'] })}
            className={inputCls}
          >
            {availableRoles.map(r => (
              <option key={r} value={r} className="bg-space-900">{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </Field>

        {needsClienteFinal && (
          <Field label="Cliente final *">
            <select
              value={form.clienteFinalId ?? ''}
              onChange={e => setForm({ ...form, clienteFinalId: e.target.value || undefined })}
              className={inputCls}
            >
              <option value="" className="bg-space-900">— selecionar —</option>
              {clientes.map(c => (
                <option key={c.id} value={c.id} className="bg-space-900">{c.name}</option>
              ))}
            </select>
          </Field>
        )}

        {needsIntegrador && (
          <Field label="Integrador (UUID) *">
            <input
              value={form.integradorId ?? ''}
              onChange={e => setForm({ ...form, integradorId: e.target.value || undefined })}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className={inputCls + ' font-mono'}
            />
          </Field>
        )}

        <div className="px-3 py-2 rounded-lg bg-slate-500/10 border border-slate-500/20 text-[11px] text-slate-400 flex items-start gap-2">
          <Mail className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Backend gera uma senha temporária e mostra UMA vez na próxima tela.
            Se SMTP estiver configurado (<code className="font-mono">SMTP_HOST</code>),
            o convidado recebe por email automaticamente.
          </span>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={saving} className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white">
            Cancelar
          </button>
          <button
            onClick={submit} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-bold disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
            Convidar
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function InviteResultModal({ result, onClose }: { result: InviteResponse; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)
  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <ModalShell title="Convite criado" onClose={onClose} accent="emerald">
      <div className="space-y-4 text-sm">
        <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong className="block mb-0.5">Senha temporária só aparece UMA vez</strong>
            Copie agora. Se o email automático não chegou, repasse manualmente
            via canal seguro (não use email pessoal/whatsapp).
          </div>
        </div>

        <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs">
          <p className="text-white"><strong>{result.user.name}</strong></p>
          <p className="text-slate-400 mt-0.5">{result.user.email} · {ROLE_LABELS[result.user.role]}</p>
          {result.user.clienteFinal && (
            <p className="text-slate-500 mt-0.5 flex items-center gap-1"><Building2 className="w-3 h-3" /> {result.user.clienteFinal.name}</p>
          )}
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Senha temporária</p>
          <div className="flex gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-slate-200 dark:border-white/10 text-sm font-mono text-emerald-300 truncate">
              {result.invitation.tempPassword}
            </code>
            <button
              onClick={() => copy('pwd', result.invitation.tempPassword)}
              className="px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-1.5"
            >
              {copied === 'pwd' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'pwd' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">URL de login</p>
          <div className="flex gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-slate-200 dark:border-white/10 text-xs font-mono text-cyan-300 truncate">
              {result.invitation.loginUrl}
            </code>
            <button
              onClick={() => copy('url', result.invitation.loginUrl)}
              className="px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 text-xs flex items-center gap-1.5"
            >
              {copied === 'url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'url' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>

        <div className={cn(
          'px-3 py-2 rounded-lg border text-xs flex items-center gap-2',
          result.invitation.emailSent
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            : 'bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-300',
        )}>
          {result.invitation.emailSent
            ? <><Check className="w-4 h-4" /> Email enviado para <strong>{result.user.email}</strong></>
            : <>
                <Mail className="w-4 h-4" />
                <span>
                  <strong>Email NÃO enviado</strong> — repasse manualmente.
                  {result.invitation.emailReason && (
                    <span className="block text-[10px] text-slate-500 mt-0.5">Motivo: {result.invitation.emailReason}</span>
                  )}
                </span>
              </>}
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-bold"
          >
            Concluído
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function ModalShell({ title, onClose, accent, children }: {
  title: string; onClose: () => void; accent: 'cyan' | 'emerald'
  children: React.ReactNode
}) {
  const ring = accent === 'cyan' ? 'border-cyan-500/30' : 'border-emerald-500/30'
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={cn('w-full max-w-lg max-h-[90vh] overflow-auto rounded-2xl bg-space-900 border p-5', ring)}
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-50 dark:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-cyan-500/50 dark:focus:ring-cyan-500/20'

// Sentinela para o linter — Plus pode parecer não-usado se renderizado
// condicional, mas a importação é mantida pra futura ação inline.
void Plus
