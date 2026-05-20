/**
 * ConfigPermissionsTab — Matriz role × screen × level (NONE/VIEW/EDIT/ADMIN).
 *
 * Permite editar defaults por role e gerenciar overrides individuais por SalesUser.
 */
import { useMemo, useState } from 'react'
import { Save, RefreshCw, Loader2, AlertCircle, ShieldCheck, UserCog } from 'lucide-react'
import { GlassCard } from '../../cards/GlassCard'
import {
  useSalesPermissionsMatrix, updateRolePermissions, useSalesTeam,
  setUserPermissionOverride, deletePermissionOverride,
  formatApiError, type PermLevel, SALES_SCREENS,
} from '../../../api/client'
import { cn } from '../../../lib/utils'

const ROLES = ['SDR','HUNTER','CLOSER','AE','CS','MANAGER','DIRECTOR'] as const
const LEVELS: PermLevel[] = ['NONE','VIEW','EDIT','ADMIN']
const LEVEL_COLOR: Record<PermLevel, string> = {
  NONE: 'bg-slate-700/30 text-slate-400 border-slate-600/30',
  VIEW: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  EDIT: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  ADMIN: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
}

const SCREEN_LABEL: Record<string, string> = {
  executive: 'Visão Executiva',
  pipeline: 'Pipeline',
  demos: 'Demos',
  opportunities: 'Oportunidades',
  activities: 'Atividades',
  team: 'Equipe & Metas',
  materials: 'Materiais',
  modules: 'Módulos IA',
  config: 'Configurações',
}

export function ConfigPermissionsTab() {
  const { data, mutate, isLoading } = useSalesPermissionsMatrix()
  const { data: teamData } = useSalesTeam()
  const [view, setView] = useState<'roles' | 'overrides'>('roles')

  if (isLoading) return <div className="h-64 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />

  return (
    <div className="space-y-4">
      <GlassCard className="p-2">
        <div className="flex gap-1">
          <button onClick={() => setView('roles')}
            className={cn('flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-medium border transition',
              view === 'roles' ? 'bg-violet-500/20 text-violet-300 border-violet-500/40' : 'text-slate-400 border-transparent hover:bg-slate-50 dark:bg-white/5')}>
            <ShieldCheck className="w-3.5 h-3.5" /> Defaults por Função
          </button>
          <button onClick={() => setView('overrides')}
            className={cn('flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-medium border transition',
              view === 'overrides' ? 'bg-violet-500/20 text-violet-300 border-violet-500/40' : 'text-slate-400 border-transparent hover:bg-slate-50 dark:bg-white/5')}>
            <UserCog className="w-3.5 h-3.5" /> Overrides Individuais
          </button>
        </div>
      </GlassCard>

      {view === 'roles' && <RoleMatrix data={data} mutate={mutate} />}
      {view === 'overrides' && <OverridesPanel data={data} team={teamData?.team ?? []} mutate={mutate} />}
    </div>
  )
}

function RoleMatrix({ data, mutate }: { data: any; mutate: () => void }) {
  // local edits: { role: { screen: level } }
  const [edits, setEdits] = useState<Record<string, Record<string, PermLevel>>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [savedFor, setSavedFor] = useState<string | null>(null)

  // Build base matrix from defaults
  const base = useMemo(() => {
    const m: Record<string, Record<string, PermLevel>> = {}
    for (const r of ROLES) m[r] = {}
    for (const p of (data?.defaults || [])) {
      if (p.role) m[p.role] = m[p.role] || {}
      if (p.role) m[p.role][p.screen] = p.level
    }
    for (const r of ROLES) {
      for (const s of SALES_SCREENS) {
        if (!m[r][s]) m[r][s] = 'NONE'
      }
    }
    return m
  }, [data])

  function getLevel(role: string, screen: string): PermLevel {
    return edits[role]?.[screen] ?? base[role]?.[screen] ?? 'NONE'
  }

  function setLevel(role: string, screen: string, level: PermLevel) {
    setEdits(prev => ({ ...prev, [role]: { ...(prev[role] || {}), [screen]: level } }))
  }

  async function saveRole(role: string) {
    setBusy(role); setErr(null)
    try {
      const all: { screen: string; level: PermLevel }[] = SALES_SCREENS.map(s => ({ screen: s, level: getLevel(role, s) }))
      await updateRolePermissions(role, all)
      await mutate()
      setEdits(prev => { const np = { ...prev }; delete np[role]; return np })
      setSavedFor(role); setTimeout(() => setSavedFor(null), 2000)
    } catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(null) }
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Matriz Função × Tela</h3>
          <p className="text-xs text-slate-500">Clique nas células para alterar; salve por linha (função).</p>
        </div>
      </div>

      {err && (
        <div className="mb-3 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {err}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2 pr-3 text-[10px] uppercase text-slate-500 sticky left-0 bg-white dark:bg-slate-900/80">Função</th>
              {SALES_SCREENS.map(s => (
                <th key={s} className="py-2 px-1 text-[10px] uppercase text-slate-500 text-center min-w-[80px]">{SCREEN_LABEL[s] || s}</th>
              ))}
              <th className="py-2 pl-2 text-[10px] uppercase text-slate-500 text-center">Salvar</th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map(role => {
              const dirty = !!edits[role]
              return (
                <tr key={role} className="border-t border-slate-200 dark:border-white/5">
                  <td className="py-2 pr-3 sticky left-0 bg-white dark:bg-slate-900/80">
                    <span className="text-xs font-semibold text-slate-200">{role}</span>
                  </td>
                  {SALES_SCREENS.map(s => {
                    const lvl = getLevel(role, s)
                    return (
                      <td key={s} className="py-1 px-1 text-center">
                        <select value={lvl} onChange={e => setLevel(role, s, e.target.value as PermLevel)}
                          className={cn('px-1.5 py-0.5 rounded text-[10px] border cursor-pointer outline-none focus:ring-2 focus:ring-violet-500/50',
                            LEVEL_COLOR[lvl], '[&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white')}>
                          {LEVELS.map(L => <option key={L} value={L}>{L}</option>)}
                        </select>
                      </td>
                    )
                  })}
                  <td className="py-2 pl-2 text-center">
                    <button onClick={() => saveRole(role)} disabled={!dirty || busy === role}
                      className={cn('px-2 py-1 rounded text-[10px] font-medium border flex items-center gap-1 mx-auto',
                        dirty
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                          : 'bg-slate-700/30 text-slate-500 border-slate-600/30 cursor-not-allowed',
                        busy === role && 'opacity-50')}>
                      {busy === role ? <Loader2 className="w-3 h-3 animate-spin" /> :
                        savedFor === role ? <RefreshCw className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                      {savedFor === role ? 'Salvo' : dirty ? 'Salvar' : 'Sem mudanças'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10px] text-slate-500 flex items-center gap-3 flex-wrap">
        <span>Níveis:</span>
        {LEVELS.map(L => <span key={L} className={cn('px-1.5 py-0.5 rounded border', LEVEL_COLOR[L])}>{L}</span>)}
      </div>
    </GlassCard>
  )
}

function OverridesPanel({ data, team, mutate }: { data: any; team: any[]; mutate: () => void }) {
  const [salesUserId, setSalesUserId] = useState<string>('')
  const [screen, setScreen] = useState<string>('pipeline')
  const [level, setLevel] = useState<PermLevel>('VIEW')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    if (!salesUserId) return
    setBusy(true); setErr(null)
    try {
      await setUserPermissionOverride(salesUserId, screen, level)
      await mutate()
    } catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  async function remove(id: string) {
    setBusy(true)
    try { await deletePermissionOverride(id); await mutate() }
    finally { setBusy(false) }
  }

  const overrides = data?.overrides || []
  const teamMap = new Map(team.map(t => [t.id, t]))

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Adicionar override individual</h3>
        <p className="text-xs text-slate-500 mb-3">Sobrescreve o default da função para um vendedor específico.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select value={salesUserId} onChange={e => setSalesUserId(e.target.value)}
            className="px-2 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
            <option value="">— vendedor —</option>
            {team.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
          </select>
          <select value={screen} onChange={e => setScreen(e.target.value)}
            className="px-2 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
            {SALES_SCREENS.map(s => <option key={s} value={s}>{SCREEN_LABEL[s] || s}</option>)}
          </select>
          <select value={level} onChange={e => setLevel(e.target.value as PermLevel)}
            className="px-2 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
            {LEVELS.map(L => <option key={L} value={L}>{L}</option>)}
          </select>
          <button onClick={add} disabled={busy || !salesUserId}
            className="px-3 py-1.5 rounded text-xs bg-violet-500 hover:bg-violet-400 text-white disabled:opacity-50">
            {busy ? 'Salvando…' : 'Aplicar override'}
          </button>
        </div>
        {err && <div className="mt-2 text-xs text-rose-400">{err}</div>}
      </GlassCard>

      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Overrides ativos ({overrides.length})</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th className="py-2 pr-3">Vendedor</th>
              <th className="py-2 pr-3">Tela</th>
              <th className="py-2 pr-3">Nível</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((o: any) => {
              const t = teamMap.get(o.salesUserId)
              return (
                <tr key={o.id} className="border-b border-slate-200 dark:border-white/5">
                  <td className="py-2 pr-3 text-slate-200">{t ? `${t.name} (${t.role})` : o.salesUserId}</td>
                  <td className="py-2 pr-3 text-slate-400">{SCREEN_LABEL[o.screen] || o.screen}</td>
                  <td className="py-2 pr-3">
                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] border', LEVEL_COLOR[o.level as PermLevel])}>{o.level}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <button onClick={() => remove(o.id)} className="text-xs text-rose-400 hover:text-rose-300">Remover</button>
                  </td>
                </tr>
              )
            })}
            {!overrides.length && <tr><td colSpan={4} className="py-6 text-center text-slate-500">Nenhum override individual.</td></tr>}
          </tbody>
        </table>
      </GlassCard>
    </div>
  )
}
