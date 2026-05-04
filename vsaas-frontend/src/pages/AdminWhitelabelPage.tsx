/**
 * AdminWhitelabelPage — White-label, Domínios e Templates (SUPER_ADMIN).
 *
 * Mental model: define defaults da plataforma + governança do que integradores
 * podem customizar. White-label = "como o cliente vê a plataforma quando o
 * integrador customiza".
 *
 * Tabs:
 *   1. Identidade — logo IACloud, paleta default
 *   2. Domínios — visão global de todos cfSubdomain provisionados
 *   3. Templates — defaults de email/push/whatsapp
 *   4. Governança — quais campos integrador pode customizar
 */
import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import {
  Palette, Globe, Mail, ShieldCheck, ChevronRight, ExternalLink,
  AlertTriangle, CheckCircle, Loader2, RefreshCw, Building2,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api } from '../api/client'
import { cn } from '../lib/utils'

const fetcher = (u: string) => api.get(u).then(r => r.data)

type TabId = 'identidade' | 'dominios' | 'templates' | 'governanca'

const TABS: { id: TabId; label: string; icon: any; color: string }[] = [
  { id: 'identidade', label: 'Identidade Visual', icon: Palette,     color: 'violet' },
  { id: 'dominios',   label: 'Domínios',          icon: Globe,       color: 'cyan' },
  { id: 'templates',  label: 'Templates',         icon: Mail,        color: 'amber' },
  { id: 'governanca', label: 'Governança',        icon: ShieldCheck, color: 'emerald' },
]

export function AdminWhitelabelPage() {
  const [params, setParams] = useSearchParams()
  const initialTab = (params.get('tab') as TabId) || 'dominios'
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)

  useEffect(() => { setActiveTab((params.get('tab') as TabId) || 'dominios') }, [params])

  function changeTab(t: TabId) {
    setActiveTab(t)
    setParams(p => { const np = new URLSearchParams(p); np.set('tab', t); return np }, { replace: true })
  }

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg">
            <Palette className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              White-label
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30 font-mono uppercase">
                marca · domínios · templates
              </span>
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              Configurações globais de marca da plataforma + governança do que cada integrador pode customizar.
              Cada integrador customiza a SUA marca em "Minha Empresa &gt; Branding".
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button key={tab.id} onClick={() => changeTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg whitespace-nowrap transition-all border',
                isActive
                  ? `bg-${tab.color}-500/20 text-${tab.color}-300 border-${tab.color}-500/30 shadow-lg`
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 border-transparent',
              )}>
              <Icon className="w-4 h-4" /><span className="text-sm font-medium">{tab.label}</span>
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={activeTab}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}>
          {activeTab === 'identidade' && <IdentidadeTab />}
          {activeTab === 'dominios'   && <DominiosTab />}
          {activeTab === 'templates'  && <TemplatesTab />}
          {activeTab === 'governanca' && <GovernancaTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
function IdentidadeTab() {
  return (
    <div className="space-y-4">
      <GlassCard className="p-12 text-center">
        <Palette className="w-16 h-16 mx-auto text-violet-400 mb-4" />
        <h3 className="text-base font-bold text-white mb-2">Identidade Visual da Plataforma</h3>
        <p className="text-sm text-slate-400 max-w-md mx-auto mb-4">
          Editor de logo, paleta de cores e tipografia padrão da IACloud Vision.
          Será sobrescrito pela identidade do integrador quando ele customizar.
        </p>
        <p className="text-xs text-amber-300">Em construção — slot reservado para Fase Branding</p>
      </GlassCard>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
function DominiosTab() {
  const { data, isLoading, mutate } = useSWR('/admin/integradores', fetcher)
  const integradores = data?.integradores ?? []
  const withDomain = integradores.filter((i: any) => i.cfSubdomain)
  const withoutDomain = integradores.filter((i: any) => !i.cfSubdomain)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat color="cyan"    label="Total integradores" value={integradores.length} />
        <Stat color="emerald" label="Com domínio"        value={withDomain.length} />
        <Stat color="slate"   label="Sem domínio"        value={withoutDomain.length} />
      </div>

      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" /> Domínios provisionados
          </h3>
          <button onClick={() => mutate()} className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/5">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-1">{[0,1,2].map(i => <div key={i} className="h-12 bg-white/5 rounded animate-pulse" />)}</div>
        ) : withDomain.length === 0 ? (
          <p className="text-xs text-slate-500 py-8 text-center">Nenhum domínio white-label provisionado ainda</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-500 border-b border-white/5">
                <tr>
                  <th className="px-3 py-2 text-left">Integrador</th>
                  <th className="px-3 py-2 text-left">Subdomain</th>
                  <th className="px-3 py-2 text-left">URL</th>
                  <th className="px-3 py-2 text-center">DNS</th>
                  <th className="px-3 py-2 text-center">SSL</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {withDomain.map((i: any) => (
                  <tr key={i.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-sm font-medium text-white">{i.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300 font-mono">{i.cfSubdomain}</td>
                    <td className="px-3 py-2 text-xs text-cyan-400">
                      <a href={`https://${i.cfSubdomain}.iacloud.com.br`} target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1">
                        {i.cfSubdomain}.iacloud.com.br <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                    <td className="px-3 py-2 text-center"><CheckCircle className="w-4 h-4 text-emerald-400 inline" /></td>
                    <td className="px-3 py-2 text-center"><CheckCircle className="w-4 h-4 text-emerald-400 inline" /></td>
                    <td className="px-3 py-2 text-right">
                      <Link to={`/admin/tenants/${i.id}?tab=config`} className="text-cyan-400 hover:text-cyan-300 text-xs">
                        Configurar →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {withoutDomain.length > 0 && (
        <GlassCard className="p-4 border-amber-500/30 bg-amber-500/5">
          <h4 className="text-sm font-bold text-amber-300 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {withoutDomain.length} integrador(es) sem domínio
          </h4>
          <p className="text-xs text-slate-400 mb-3">
            Estes tenants ainda não provisionaram domínio próprio — usam o padrão app.iacloud.com.br.
          </p>
          <div className="flex flex-wrap gap-2">
            {withoutDomain.slice(0, 10).map((i: any) => (
              <Link key={i.id} to={`/admin/tenants/${i.id}?tab=config`}
                className="px-2 py-1 rounded text-[10px] bg-white/5 hover:bg-amber-500/10 text-slate-300 hover:text-amber-300 border border-white/10">
                {i.name} →
              </Link>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
function TemplatesTab() {
  const TEMPLATES = [
    { name: 'lead_confirmation',    label: 'Confirmação de cadastro de demo',  status: 'ativo' },
    { name: 'lead_demo_approved',   label: 'Demo aprovada (com magic link)',   status: 'ativo' },
    { name: 'lead_demo_rejected',   label: 'Demo rejeitada (cordial)',          status: 'ativo' },
    { name: 'lead_notification',    label: 'Notificação de novo lead (admins)', status: 'ativo' },
    { name: 'invite',               label: 'Convite de usuário',                status: 'ativo' },
    { name: 'license_key',          label: 'Chave de licença Edge Box',         status: 'ativo' },
    { name: 'alert_digest',         label: 'Resumo diário de alertas',          status: 'ativo' },
  ]

  return (
    <div className="space-y-3">
      <GlassCard className="p-4 border-amber-500/20">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Mail className="w-4 h-4 text-amber-400" /> Templates de email padrão
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Defaults da plataforma (carregados de SystemConfig em runtime). Integradores podem sobrescrever no painel deles.
        </p>
      </GlassCard>

      <div className="grid gap-2">
        {TEMPLATES.map(t => (
          <GlassCard key={t.name} className="p-3 flex items-center justify-between hover:bg-white/[0.02] transition">
            <div>
              <p className="text-sm font-medium text-white">{t.label}</p>
              <p className="text-[10px] text-slate-500 font-mono">{t.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {t.status}
              </span>
              <button className="text-cyan-400 hover:text-cyan-300 text-xs">Editar →</button>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
function GovernancaTab() {
  return (
    <GlassCard className="p-12 text-center">
      <ShieldCheck className="w-16 h-16 mx-auto text-emerald-400 mb-4" />
      <h3 className="text-base font-bold text-white mb-2">Governança White-label</h3>
      <p className="text-sm text-slate-400 max-w-md mx-auto mb-4">
        Defina quais campos cada plano (Starter / Pro / Enterprise) permite customizar:
        logo, cores, domínio, templates de email, branding completo, etc.
      </p>
      <p className="text-xs text-amber-300">Em construção — slot reservado</p>
    </GlassCard>
  )
}

function Stat({ color, label, value }: { color: string; label: string; value: number }) {
  const cls: Record<string, string> = {
    cyan:    'border-cyan-500/30 bg-cyan-500/5 text-cyan-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
    slate:   'border-white/10 bg-white/5 text-slate-300',
  }
  return (
    <div className={cn('p-3 rounded-lg border text-center', cls[color])}>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}
