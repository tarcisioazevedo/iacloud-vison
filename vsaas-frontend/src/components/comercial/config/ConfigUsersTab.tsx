/**
 * ConfigUsersTab — Gestão de SalesUsers (vendedores).
 * Permite: adicionar (vincular User existente), suspender/reativar, ver permissões efetivas.
 */
import { useState } from 'react'
import { Plus, UserCheck, UserX, ShieldCheck, Loader2, Mail } from 'lucide-react'
import { GlassCard } from '../../cards/GlassCard'
import {
  useSalesTeam, useEligibleUsers, createSalesUser, formatApiError,
  api, useUserEffectivePermissions, type PermLevel,
} from '../../../api/client'
import { cn } from '../../../lib/utils'

const ROLES = ['SDR','HUNTER','CLOSER','AE','CS','MANAGER','DIRECTOR'] as const
const ROLE_COLOR: Record<string, string> = {
  SDR: 'cyan', HUNTER: 'amber', CLOSER: 'emerald', AE: 'violet', CS: 'emerald', MANAGER: 'amber', DIRECTOR: 'rose',
}
const LEVEL_COLOR: Record<PermLevel, string> = {
  NONE: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
  VIEW: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  EDIT: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
  ADMIN: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
}

export function ConfigUsersTab() {
  const { data: teamData, mutate: mutateTeam, isLoading } = useSalesTeam()
  const { data: eligible } = useEligibleUsers()
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [permFor, setPermFor] = useState<string | null>(null)

  // Form state
  const [userId, setUserId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<typeof ROLES[number]>('SDR')

  function pickEligible(uid: string) {
    setUserId(uid)
    const u = eligible?.users.find(x => x.id === uid)
    if (u) { setName(u.name); setEmail(u.email) }
  }

  async function handleCreate() {
    setBusy(true); setErr(null)
    try {
      await createSalesUser({ userId, name, email, role })
      await mutateTeam()
      setShowAdd(false); setUserId(''); setName(''); setEmail(''); setRole('SDR')
    } catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  async function toggleActive(id: string, active: boolean) {
    await api.patch(`/sales/team/${id}`, { active: !active })
    await mutateTeam()
  }

  if (isLoading) return <div className="h-64 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />

  const team = teamData?.team ?? []

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Vendedores ({team.length})</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Vincule um usuário existente do sistema a um perfil comercial.
            </p>
          </div>
          <button onClick={() => setShowAdd(s => !s)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 border border-violet-500/40 text-xs font-medium">
            <Plus className="w-3.5 h-3.5" /> Adicionar vendedor
          </button>
        </div>

        {showAdd && (
          <div className="mb-4 p-3 rounded-lg bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase text-slate-500">Usuário do sistema</label>
                <select value={userId} onChange={e => pickEligible(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-white">
                  <option value="">— escolher —</option>
                  {eligible?.users.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email}) · {u.role}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">Função comercial</label>
                <select value={role} onChange={e => setRole(e.target.value as any)}
                  className="w-full px-2 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-white">
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">Nome</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-white" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-white" />
              </div>
            </div>
            {err && <div className="text-xs text-rose-400">{err}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-md text-xs text-slate-400 hover:bg-slate-50 dark:bg-white/5">Cancelar</button>
              <button onClick={handleCreate} disabled={busy || !userId || !role}
                className="px-3 py-1.5 rounded-md text-xs bg-violet-500 hover:bg-violet-400 text-white disabled:opacity-50 flex items-center gap-1.5">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Criar
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200 dark:border-white/10">
                <th className="py-2 pr-3">Nome</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Função</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {team.map(m => (
                <tr key={m.id} className="border-b border-slate-200 dark:border-white/5">
                  <td className="py-2 pr-3 text-slate-200">{m.name}</td>
                  <td className="py-2 pr-3 text-slate-400 flex items-center gap-1"><Mail className="w-3 h-3" /> {m.email}</td>
                  <td className="py-2 pr-3">
                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] border',
                      `bg-${ROLE_COLOR[m.role] || 'slate'}-500/15 text-${ROLE_COLOR[m.role] || 'slate'}-300 border-${ROLE_COLOR[m.role] || 'slate'}-500/30`)}>
                      {m.role}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {m.active
                      ? <span className="text-emerald-400">● Ativo</span>
                      : <span className="text-slate-500">○ Suspenso</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggleActive(m.id, m.active)}
                        className="p-1.5 rounded hover:bg-slate-50 dark:bg-white/5" title={m.active ? 'Suspender' : 'Reativar'}>
                        {m.active ? <UserX className="w-3.5 h-3.5 text-rose-400" /> : <UserCheck className="w-3.5 h-3.5 text-emerald-400" />}
                      </button>
                      <button onClick={() => setPermFor(permFor === m.id ? null : m.id)}
                        className="p-1.5 rounded hover:bg-slate-50 dark:bg-white/5" title="Ver permissões efetivas">
                        <ShieldCheck className="w-3.5 h-3.5 text-violet-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!team.length && (
                <tr><td colSpan={5} className="py-8 text-center text-slate-500">Nenhum vendedor cadastrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {permFor && <UserPermsCard salesUserId={permFor} levelColor={LEVEL_COLOR} onClose={() => setPermFor(null)} />}
    </div>
  )
}

function UserPermsCard({ salesUserId, levelColor, onClose }: { salesUserId: string; levelColor: Record<PermLevel,string>; onClose: () => void }) {
  const { data, isLoading } = useUserEffectivePermissions(salesUserId)
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Permissões efetivas</h4>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-600 dark:text-slate-300">fechar</button>
      </div>
      {isLoading && <div className="h-20 bg-slate-50 dark:bg-white/5 rounded animate-pulse" />}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {data.screens.map(s => {
            const e = data.effective[s]
            return (
              <div key={s} className="p-2 rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/30">
                <div className="text-[10px] uppercase text-slate-500">{s}</div>
                <div className={cn('mt-1 px-1.5 py-0.5 rounded text-[10px] border inline-block', levelColor[e?.level as PermLevel || 'NONE'])}>
                  {e?.level || 'NONE'}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{e?.source || 'none'}</div>
              </div>
            )
          })}
        </div>
      )}
    </GlassCard>
  )
}
