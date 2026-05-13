/**
 * ComercialConfigPage — Configurações administrativas do Hub Comercial.
 *
 * 5 sub-tabs:
 *   1. 👥 Usuários       — gerenciar SalesUsers (add/suspender/vincular User)
 *   2. 🔐 Permissões     — matriz role × screen × level + overrides individuais
 *   3. ⚙️ Defaults       — singleton SalesConfig (SLA demo, round-robin, push, lost reasons)
 *   4. 📋 Templates      — placeholder (kits de mensagens / playbooks)
 *   5. 🧾 Audit          — placeholder (log de mudanças sensíveis)
 */
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Users, ShieldCheck, Settings as SettingsIcon, FileText, History, Bell } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'
import { ConfigUsersTab } from '../components/comercial/config/ConfigUsersTab'
import { ConfigPermissionsTab } from '../components/comercial/config/ConfigPermissionsTab'
import { ConfigDefaultsTab } from '../components/comercial/config/ConfigDefaultsTab'
import { ConfigNotificationsTab } from '../components/comercial/config/ConfigNotificationsTab'

type SubTab = 'users' | 'permissions' | 'defaults' | 'notifications' | 'templates' | 'audit'

const SUBTABS: { id: SubTab; label: string; icon: any }[] = [
  { id: 'users',         label: 'Usuários',     icon: Users },
  { id: 'permissions',   label: 'Permissões',   icon: ShieldCheck },
  { id: 'defaults',      label: 'Defaults',     icon: SettingsIcon },
  { id: 'notifications', label: 'Notificações', icon: Bell },
  { id: 'templates',     label: 'Templates',    icon: FileText },
  { id: 'audit',         label: 'Audit',        icon: History },
]

export function ComercialConfigPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const initial = (params.get('sub') as SubTab) || 'users'
  const [active, setActive] = useState<SubTab>(initial)

  function change(t: SubTab) {
    setActive(t)
    setParams(p => { const np = new URLSearchParams(p); np.set('sub', t); return np }, { replace: true })
  }

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-slate-500/10 via-violet-500/5 to-cyan-500/5 border-slate-500/30">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/admin/comercial')} className="p-2 rounded-lg bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:bg-white/10 transition" title="Voltar ao Hub">
            <ArrowLeft className="w-4 h-4 text-slate-400" />
          </button>
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-500 to-violet-500 flex items-center justify-center shadow-lg">
            <SettingsIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Configurações do Hub Comercial</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Gestão de usuários, permissões granulares por tela e defaults do funil.
            </p>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {SUBTABS.map(t => {
            const Icon = t.icon
            const isActive = active === t.id
            return (
              <button key={t.id} onClick={() => change(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg whitespace-nowrap transition-all border text-xs font-medium',
                  isActive
                    ? 'bg-violet-500/20 text-violet-300 border-violet-500/40 shadow-lg'
                    : 'text-slate-500 hover:text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:bg-white/5 border-transparent',
                )}>
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>
      </GlassCard>

      <div className="min-h-[400px]">
        {active === 'users'       && <ConfigUsersTab />}
        {active === 'permissions' && <ConfigPermissionsTab />}
        {active === 'defaults'      && <ConfigDefaultsTab />}
        {active === 'notifications' && <ConfigNotificationsTab />}
        {active === 'templates'   && (
          <GlassCard className="p-12 text-center text-slate-500 text-sm">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            Templates de mensagens e playbooks — em breve.
          </GlassCard>
        )}
        {active === 'audit'       && (
          <GlassCard className="p-12 text-center text-slate-500 text-sm">
            <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
            Histórico de mudanças sensíveis — em breve.
          </GlassCard>
        )}
      </div>
    </div>
  )
}
