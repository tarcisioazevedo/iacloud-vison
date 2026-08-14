/**
 * ContratacoesTab — clientes finais agrupados com suas ClienteSubscriptions.
 * Padrão visual alinhado ao design system.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { Building2, ChevronDown, ChevronRight, Loader2, Plus, ArrowRight, Camera, DollarSign, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { GlassCard } from '../cards/GlassCard'
import { cn } from '../../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface ClienteRow {
  id: string; name: string; razaoSocial: string
  subscriptionsCount: number
  cameras: number
  totalMensalBrl: number
  subscriptions: Array<{
    id: string; status: string; startedAt: string
    productSlug: string; productName: string; category: string
    cameraCount: number; finalPriceBrl: number; subtotalBrl: number
    trialUntil: string | null
  }>
}

function brl(n: number) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function ContratacoesTab() {
  const { data, isLoading } = useSWR<ClienteRow[]>('/me/integrador/billing/clientes-contratacoes', fetcher)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-600 dark:text-cyan-400" />
        <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">Carregando contratações…</span>
      </div>
    )
  }

  if (!data?.length) {
    return (
      <GlassCard className="p-8">
        <div className="text-center max-w-md mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 mx-auto mb-4 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Nenhum cliente final ainda</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 mb-5">
            Quando você cadastrar clientes e eles contratarem produtos do marketplace, aparecem aqui agrupados.
          </p>
          <Link to="/clientes-finais" className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600 shadow-md shadow-cyan-500/20">
            <Plus className="w-4 h-4" /> Cadastrar primeiro cliente
          </Link>
        </div>
      </GlassCard>
    )
  }

  const totalGeral     = data.reduce((s, c) => s + c.totalMensalBrl, 0)
  const totalCameras   = data.reduce((s, c) => s + c.cameras, 0)
  const totalAssinaturas = data.reduce((s, c) => s + c.subscriptionsCount, 0)

  return (
    <div className="space-y-4">
      {/* KPIs do header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <GlassCard className="p-5 border-cyan-300 dark:border-cyan-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider font-bold flex items-center gap-1.5 text-cyan-700 dark:text-cyan-300">
              <Users className="w-3.5 h-3.5" /> Clientes
            </span>
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">{data.length}</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">com contratos ativos</div>
        </GlassCard>
        <GlassCard className="p-5 border-violet-300 dark:border-violet-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider font-bold flex items-center gap-1.5 text-violet-700 dark:text-violet-300">
              <Camera className="w-3.5 h-3.5" /> Câmeras / Assinaturas
            </span>
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">{totalCameras}<span className="text-base text-slate-500 font-normal"> / {totalAssinaturas}</span></div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">câmeras cobertas em {totalAssinaturas} contrato{totalAssinaturas !== 1 ? 's' : ''}</div>
        </GlassCard>
        <GlassCard className="p-5 border-emerald-300 dark:border-emerald-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider font-bold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
              <DollarSign className="w-3.5 h-3.5" /> Receita mensal
            </span>
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">R$ {brl(totalGeral)}</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">somatório de todos os contratos</div>
        </GlassCard>
      </div>

      <div className="flex items-center justify-end">
        <Link to="/marketplace" className="text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 font-medium">
          Ir ao marketplace <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Lista de clientes */}
      <GlassCard className="p-0 overflow-hidden">
        <div className="divide-y divide-slate-100 dark:divide-white/5">
          {data.map(c => {
            const isOpen = expanded.has(c.id)
            return (
              <div key={c.id}>
                <button onClick={() => toggle(c.id)}
                  className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left transition">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition',
                      isOpen
                        ? 'bg-gradient-to-br from-cyan-500 to-blue-500 text-white shadow-md shadow-cyan-500/20'
                        : 'bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400',
                    )}>
                      {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{c.name}</p>
                      <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {c.subscriptionsCount} contrato{c.subscriptionsCount !== 1 ? 's' : ''}</span>
                        <span className="flex items-center gap-1"><Camera className="w-3 h-3" /> {c.cameras} câmera{c.cameras !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold font-mono text-emerald-700 dark:text-emerald-400">R$ {brl(c.totalMensalBrl)}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">/mês</p>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-slate-800/40 px-5 py-4">
                    {c.subscriptions.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-2">Sem assinaturas ativas.</p>
                    ) : (
                      <div className="overflow-x-auto -mx-5 px-5">
                        <table className="w-full text-xs min-w-[640px]">
                          <thead className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                            <tr>
                              <th className="text-left py-2 px-2 font-semibold uppercase tracking-wider">Produto</th>
                              <th className="text-center py-2 px-2 font-semibold uppercase tracking-wider">Status</th>
                              <th className="text-left py-2 px-2 font-semibold uppercase tracking-wider">Desde</th>
                              <th className="text-right py-2 px-2 font-semibold uppercase tracking-wider">Câmeras</th>
                              <th className="text-right py-2 px-2 font-semibold uppercase tracking-wider">Preço unit.</th>
                              <th className="text-right py-2 px-2 font-semibold uppercase tracking-wider">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.subscriptions.map(s => (
                              <tr key={s.id} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                                <td className="py-2 px-2">
                                  <p className="font-semibold text-slate-700 dark:text-slate-200">{s.productName}</p>
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{s.productSlug}</p>
                                </td>
                                <td className="py-2 px-2 text-center"><StatusPill status={s.status} /></td>
                                <td className="py-2 px-2 text-[11px] text-slate-500 dark:text-slate-400">{new Date(s.startedAt).toLocaleDateString('pt-BR')}</td>
                                <td className="py-2 px-2 text-right font-semibold">{s.cameraCount}</td>
                                <td className="py-2 px-2 text-right font-mono">R$ {brl(s.finalPriceBrl)}</td>
                                <td className="py-2 px-2 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">R$ {brl(s.subtotalBrl)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </GlassCard>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:    'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30',
    TRIAL:     'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-500/30',
    GRACE:     'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30',
    SUSPENDED: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30',
  }
  return <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase', map[status] ?? 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-300')}>{status}</span>
}
