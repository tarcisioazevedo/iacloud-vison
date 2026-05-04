/**
 * EdgeNodesPage — wrapper fino sobre EdgeBoxesPanel.
 *
 * Mental model (refactor):
 *   - SUPER_ADMIN não usa /edge: gerencia boxes dentro de cada tenant em
 *     /admin/tenants/:id?tab=boxes. Acesso a /edge mostra placeholder + redirect.
 *   - INTEGRADOR_ADMIN/INTEGRADOR_TECNICO: /edge é a "casa" deles, mostra só
 *     suas próprias boxes (escopo via JWT).
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cpu, AlertTriangle } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { EdgeBoxesPanel } from '../components/edge/EdgeBoxesPanel'

const userRole = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
const isSuperAdmin = userRole === 'SUPER_ADMIN'
const canProvision = ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'].includes(userRole)

export function EdgeNodesPage() {
  const navigate = useNavigate()

  useEffect(() => {
    if (isSuperAdmin) {
      const t = setTimeout(() => navigate('/admin/tenants', { replace: true }), 2500)
      return () => clearTimeout(t)
    }
  }, [navigate])

  if (isSuperAdmin) {
    return (
      <GlassCard className="p-12 text-center max-w-2xl mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-violet-400" />
        </div>
        <h2 className="text-lg font-bold text-white mb-2">Edge Boxes ficam dentro de cada Tenant</h2>
        <p className="text-sm text-slate-400 max-w-md mx-auto">
          Como SUPER_ADMIN, gerencie as edge boxes selecionando um integrador em <code className="text-violet-300">/admin/tenants</code> e abrindo a aba <strong>Edge Boxes</strong>.
        </p>
        <p className="text-xs text-slate-500 mt-4">Redirecionando em alguns segundos...</p>
        <button onClick={() => navigate('/admin/tenants')}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-sm font-bold">
          <Cpu className="w-4 h-4" /> Ir para Tenants agora
        </button>
      </GlassCard>
    )
  }

  return <EdgeBoxesPanel mode="standalone" canProvision={canProvision} />
}
