import { Link } from 'react-router-dom'
import { TrendingUp, ExternalLink } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'

export function BITab() {
  return (
    <GlassCard className="p-12 text-center">
      <TrendingUp className="w-16 h-16 mx-auto text-cyan-400 mb-4" />
      <h3 className="text-base font-bold text-white mb-2">Contratado × Utilizado</h3>
      <p className="text-sm text-slate-400 mb-4 max-w-md mx-auto">
        Análise comercial: módulos contratados vs efetivamente usados por integrador.
        Identifica oportunidades de upsell e churn risk.
      </p>
      <Link to="/admin/modulos/utilization"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-bold">
        <ExternalLink className="w-4 h-4" /> Abrir BI completo
      </Link>
    </GlassCard>
  )
}
