/**
 * LeadsTab — wrapper que reusa LeadsPage existente (CRM completo).
 */
import { Link } from 'react-router-dom'
import { ExternalLink, Users } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { LeadsPage } from '../../pages/LeadsPage'

export function LeadsTab() {
  return (
    <div className="space-y-3">
      <GlassCard className="p-3 border-cyan-500/30 bg-cyan-500/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            <p className="text-xs text-slate-600 dark:text-slate-300">CRM completo de leads — filtros, follow-ups, conversão, demos.</p>
          </div>
          <Link to="/admin/leads" className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> Abrir página standalone
          </Link>
        </div>
      </GlassCard>
      <div className="-mx-6">
        <LeadsPage />
      </div>
    </div>
  )
}
