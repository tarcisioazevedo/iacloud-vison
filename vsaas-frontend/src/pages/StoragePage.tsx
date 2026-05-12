/**
 * StoragePage — gestão de armazenamento dedicada (Super Admin + Integrador).
 *
 * Wrapper sobre `StorageSection` (definida em SettingsPage) elevando-a para
 * uma rota de sidebar ao invés de aba secundária dentro de /settings.
 *
 * Por que existe: gestão de storage é função de uso recorrente (revisão de
 * margem, órfãos, retenção, lifecycle). Esconder dentro de /settings
 * dificulta acesso. Sidebar → 1 click.
 *
 * Roles:
 *   - SUPER_ADMIN/ADMIN_GLOBAL → StorageGlobalDashboard (todos os tenants,
 *     buckets, órfãos, logs)
 *   - INTEGRADOR_ADMIN          → StorageIntegradorView (config próprio
 *     bucket, retenção, custom S3)
 *   - INTEGRADOR_TECNICO        → bloqueado (Settings antigos)
 *   - CLIENTE_*                 → bloqueado (vê via Cockpit cards)
 */
import { Navigate } from 'react-router-dom'
import { HardDrive } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { StorageSection } from './SettingsPage'
import { IntegradorContractCard } from '../components/retention/IntegradorContractCard'
import { CamerasByPlanTable } from '../components/retention/CamerasByPlanTable'

const role = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
const isSuperAdmin  = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
const isIntegrador  = role === 'INTEGRADOR_ADMIN'

export function StoragePage() {
  if (!isSuperAdmin && !isIntegrador) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent border-cyan-300 dark:border-cyan-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shrink-0">
            <HardDrive className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {isSuperAdmin ? 'Storage — Visão Global' : 'Storage — Meu Bucket'}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
              {isSuperAdmin
                ? 'Gestão multi-tenant: buckets por integrador, gravações órfãs, lifecycle, auditoria de acesso.'
                : 'Configuração do seu bucket (R2 padrão VSaaS ou S3 custom), retenção, conexão e diagnóstico.'}
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Integrador: contrato com VSaaS (plano default + markup) acima da config técnica. */}
      {isIntegrador && <IntegradorContractCard />}

      {/* Tabela câmeras × plano efetivo (super admin + integrador) */}
      {(isSuperAdmin || isIntegrador) && <CamerasByPlanTable />}

      <StorageSection />
    </div>
  )
}
