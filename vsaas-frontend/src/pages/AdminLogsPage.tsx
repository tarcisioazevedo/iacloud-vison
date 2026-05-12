/**
 * AdminLogsPage — LogsCenter standalone para SUPER_ADMIN.
 *
 * Wrapper fino que usa o componente LogsCenter já criado.
 * Filtros do LogsCenter (categoria, severidade, ator, resource, etc) cobrem
 * todos os tenants — escopo via JWT do super_admin (sem filtro = vê tudo).
 */
import { ScrollText } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { LogsCenter } from '../components/logs/LogsCenter'

export function AdminLogsPage() {
  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-violet-500/5 to-transparent border-cyan-300 dark:border-cyan-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shadow-lg">
            <ScrollText className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Logs Globais
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-500/30 font-mono uppercase">
                cross-tenant
              </span>
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              5W1H de toda atividade na plataforma. Filtre por tenant, categoria, severidade, ator, recurso, IP ou texto.
            </p>
          </div>
        </div>
      </GlassCard>

      <LogsCenter mode="cockpit" />
    </div>
  )
}
