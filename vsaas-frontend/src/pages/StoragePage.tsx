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
import { useEffect, useState } from 'react'
import { StorageSection } from './SettingsPage'
import { IntegradorContractCard } from '../components/retention/IntegradorContractCard'
import { CamerasByPlanTable } from '../components/retention/CamerasByPlanTable'
import { getSystemHealth, type SystemHealth } from '../api/client'
import { CostEstimateCard } from '../components/storage/CostEstimateCard'
import { cn } from '../lib/utils'

const myIntegradorId = typeof window !== 'undefined' ? (localStorage.getItem('icv_integrador_id') ?? '') : ''

function R2HealthBadge() {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  useEffect(() => {
    let cancelled = false
    const fetch = () => getSystemHealth().then(h => { if (!cancelled) setHealth(h) }).catch(() => {})
    fetch()
    const id = setInterval(fetch, 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])
  if (!health?.r2) return null

  const { ok, latencyMs } = health.r2
  const state =
    !ok                       ? { label: 'R2 offline',     color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30' }
    : latencyMs === null       ? { label: 'R2 desconhecido',color: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30' }
    : (latencyMs ?? 0) > 5000   ? { label: `R2 lento (${latencyMs}ms)`, color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' }
    : (latencyMs ?? 0) > 1500   ? { label: `R2 OK (${latencyMs}ms)`,    color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' }
                                : { label: `R2 OK (${latencyMs}ms)`,    color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' }

  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-bold border', state.color)}>
      <span className={cn(
        'w-1.5 h-1.5 rounded-full',
        !ok                              ? 'bg-rose-500'
        : (latencyMs ?? 0) > 5000         ? 'bg-amber-500 animate-pulse'
                                          : 'bg-emerald-500',
      )} />
      {state.label}
    </span>
  )
}

const role = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
const isSuperAdmin  = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
const isIntegrador  = role === 'INTEGRADOR_ADMIN'

export function StoragePage() {
  if (!isSuperAdmin && !isIntegrador) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Badge de saúde R2 — único elemento mantido do antigo header */}
      <div className="flex justify-end">
        <R2HealthBadge />
      </div>

      {/* Custo estimado de storage (Onda 5 / P1 #7) */}
      {isIntegrador && myIntegradorId && <CostEstimateCard integradorId={myIntegradorId} />}

      {/* Integrador: contrato com VSaaS (plano default + markup) acima da config técnica. */}
      {isIntegrador && <IntegradorContractCard />}

      {/* Tabela câmeras × plano efetivo (super admin + integrador) */}
      {(isSuperAdmin || isIntegrador) && <CamerasByPlanTable />}

      <StorageSection />
    </div>
  )
}
