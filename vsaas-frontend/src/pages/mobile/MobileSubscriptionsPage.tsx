import { useNavigate } from 'react-router-dom'
import { HardDrive, ShoppingBag, ChevronRight, Check, RefreshCw } from 'lucide-react'
import { api } from '../../api/client'
import useSWR from 'swr'
import { cn } from '../../lib/utils'

interface Subscription {
  id: string
  productName: string
  productCategory: string
  status: string
  cameraCount: number
  monthlyPrice: number
  startedAt: string
}

function useSubscriptions() {
  return useSWR<{ subscriptions: Subscription[] }>('/marketplace/subscriptions', (url: string) =>
    api.get(url).then(r => r.data)
  )
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativo', GRACE: 'Período de graça', CANCELED: 'Cancelado', SUSPENDED: 'Suspenso',
}
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  GRACE: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  CANCELED: 'text-slate-400 bg-slate-800 border-slate-700',
  SUSPENDED: 'text-red-400 bg-red-500/10 border-red-500/20',
}

export function MobileSubscriptionsPage() {
  const { data, isLoading, mutate } = useSubscriptions()
  const navigate = useNavigate()

  const subs = data?.subscriptions ?? []
  const active = subs.filter(s => s.status === 'ACTIVE' || s.status === 'GRACE')
  const totalMonthly = active.reduce((acc, s) => acc + s.monthlyPrice, 0)

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white">Assinaturas</h1>
          {totalMonthly > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">
              Total: <span className="text-cyan-400 font-semibold">R$ {totalMonthly.toFixed(2).replace('.', ',')}/mês</span>
            </p>
          )}
        </div>
        <button onClick={() => mutate()} className="p-2 rounded-xl bg-slate-800 text-slate-400 active:bg-slate-700">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-32 rounded-2xl bg-slate-900 animate-pulse" />
          ))
        ) : subs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <HardDrive className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">Nenhuma assinatura ativa</p>
            <p className="text-xs text-slate-600 mt-1">Contrate um plano de armazenamento</p>
          </div>
        ) : subs.map(sub => (
          <div key={sub.id} className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
            {/* Top accent */}
            <div className="h-1 bg-gradient-to-r from-cyan-500 to-cyan-600" />

            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                    <HardDrive className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white leading-tight">{sub.productName}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {sub.cameraCount} câmera{sub.cameraCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full border', STATUS_COLOR[sub.status] ?? STATUS_COLOR.CANCELED)}>
                  {STATUS_LABEL[sub.status] ?? sub.status}
                </span>
              </div>

              <div className="space-y-2">
                {[
                  ['Mensal', `R$ ${sub.monthlyPrice.toFixed(2).replace('.', ',')}`],
                  ['Desde',  new Date(sub.startedAt).toLocaleDateString('pt-BR')],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{k}</span>
                    <span className="text-xs font-semibold text-slate-200">{v}</span>
                  </div>
                ))}
              </div>

              {sub.status === 'ACTIVE' && (
                <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-800">
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-xs text-emerald-400">Gravação ativa</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Marketplace CTA */}
        <button
          onClick={() => navigate('/marketplace/storage')}
          className="w-full flex items-center gap-3 p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 active:bg-cyan-500/20"
        >
          <div className="w-9 h-9 rounded-xl bg-cyan-500/20 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-cyan-300">Ver Marketplace</p>
            <p className="text-xs text-cyan-500/70">Contratar ou alterar planos de storage</p>
          </div>
          <ChevronRight className="w-4 h-4 text-cyan-500 shrink-0" />
        </button>
      </div>
    </div>
  )
}
