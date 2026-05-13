import { Link } from 'react-router-dom'
import { DollarSign, ExternalLink, CheckCircle } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { cn } from '../../lib/utils'

export function PricingTab() {
  return (
    <div className="space-y-4">
      <GlassCard className="p-4 border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <DollarSign className="w-5 h-5 text-amber-400 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-white">Tabela de Preços</h3>
            <p className="text-xs text-slate-400 mt-1">Vitrine para apresentações comerciais. Edição de preços por módulo em <Link to="/admin/catalog" className="text-amber-300 hover:underline">Catálogo</Link>.</p>
          </div>
        </div>
      </GlassCard>

      <div className="grid gap-4 md:grid-cols-3">
        <PricingCard tier="STARTER" price="R$ 99" perMonth perCamera color="violet"
          features={['Gravação 7 dias', 'Live multi-câmera', '1 site', 'Email support']} />
        <PricingCard tier="PROFESSIONAL" price="R$ 199" perMonth perCamera color="cyan" highlighted
          features={['Tudo do Starter', 'Faces + Placas', 'Heatmap', 'Smart City', 'WhatsApp alerts', '5 sites']} />
        <PricingCard tier="ENTERPRISE" price="Sob consulta" color="emerald"
          features={['Tudo do PRO', 'White-label completo', 'Edge boxes ilimitadas', 'SLA dedicado', 'Federation']} />
      </div>

      <Link to="/pricing" target="_blank"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-sm font-bold">
        <ExternalLink className="w-4 h-4" /> Ver página pública /pricing
      </Link>
    </div>
  )
}

function PricingCard({ tier, price, perMonth, perCamera, color, features, highlighted }: {
  tier: string; price: string; perMonth?: boolean; perCamera?: boolean; color: string
  features: string[]; highlighted?: boolean
}) {
  return (
    <GlassCard className={cn('p-5', highlighted && `border-${color}-500/50 shadow-lg`)}>
      <p className={`text-[10px] uppercase tracking-wider font-bold text-${color}-300`}>{tier}</p>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-white">{price}</span>
        {perMonth && <span className="text-xs text-slate-500">/mês</span>}
        {perCamera && <span className="text-xs text-slate-500">por câmera</span>}
      </div>
      <ul className="mt-4 space-y-1.5">
        {features.map(f => (
          <li key={f} className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2">
            <CheckCircle className={`w-3.5 h-3.5 text-${color}-400 shrink-0 mt-0.5`} />
            {f}
          </li>
        ))}
      </ul>
    </GlassCard>
  )
}
