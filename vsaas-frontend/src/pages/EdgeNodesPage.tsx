/**
 * EdgeNodesPage — wrapper fino sobre EdgeBoxesPanel.
 *
 * Mental model (refactor):
 *   - SUPER_ADMIN não usa /edge: gerencia boxes dentro de cada tenant em
 *     /admin/tenants/:id?tab=boxes. Acesso a /edge mostra placeholder + redirect.
 *   - INTEGRADOR_ADMIN/INTEGRADOR_TECNICO: /edge é a "casa" deles, mostra só
 *     suas próprias boxes (escopo via JWT).
 */
import { useNavigate, Navigate } from 'react-router-dom'
import { Cpu } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { EdgeBoxesPanel } from '../components/edge/EdgeBoxesPanel'

const userRole = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
const isSuperAdmin = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN_GLOBAL'
const canProvision = ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'].includes(userRole)

export function EdgeNodesPage() {
  const navigate = useNavigate()

  // Onda 6.C: super-admin redireciona IMEDIATAMENTE (sem timeout 2.5s)
  if (isSuperAdmin) return <Navigate to="/admin/tenants" replace />

  return (
    <div className="space-y-4">
      {/* Hero premium — paridade com outros cockpits */}
      <GlassCard className="p-5 bg-gradient-to-br from-amber-500/10 via-cyan-500/5 to-transparent border-amber-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-amber-500/20 text-2xl">
              📦
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Minhas Edge Boxes</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Hardware ICV-BOX provisionado nos sites dos seus clientes. Cada box
                gerencia câmeras locais (RTSP/ONVIF), roda IA on-device, grava local
                e sincroniza com a cloud.
              </p>
              <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono uppercase">
                  Hardware
                </span>
                <span className="text-slate-500">deploy automatizado · OTA · telemetria 24/7</span>
              </div>
            </div>
          </div>
          {canProvision && (
            <button
              onClick={() => navigate('/edge?action=provision')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-cyan-500 hover:opacity-90 text-white text-sm font-bold shadow-lg shadow-amber-500/20 transition"
            >
              <Cpu className="w-4 h-4" />
              Provisionar nova box
            </button>
          )}
        </div>
      </GlassCard>

      <EdgeBoxesPanel mode="standalone" canProvision={canProvision} />
    </div>
  )
}
