import { Receipt } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'

export function BillingTab() {
  return (
    <GlassCard className="p-12 text-center bg-gradient-to-br from-rose-500/10 to-violet-500/5 border-rose-500/30">
      <Receipt className="w-16 h-16 mx-auto text-rose-400 mb-4" />
      <h3 className="text-lg font-bold text-white mb-2">Faturamento — Em construção</h3>
      <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
        Módulo de billing recorrente. Integração com Stripe / Pagar.me / Iugu, geração de boletos NF-e,
        cobrança por consumo (Vertex AI) e por câmera ativa.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto">
        {[
          'Cobrança recorrente', 'NF-e automática', 'Inadimplência',
          'Cobrança por consumo', 'Webhook de pagamento', 'Dashboard receita',
        ].map(label => (
          <div key={label} className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-xs font-bold text-slate-300">{label}</p>
            <p className="text-[10px] text-slate-500 mt-1 uppercase">planejado</p>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
