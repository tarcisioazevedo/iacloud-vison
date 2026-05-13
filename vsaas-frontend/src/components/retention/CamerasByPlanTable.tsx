/**
 * CamerasByPlanTable — tabela compacta de câmeras × plano efetivo × R$/mês.
 *
 * Consume GET /retention/cameras (A5).
 *
 * Modos:
 *   - integrador: lista todas câmeras do tenant
 *   - super admin: pode passar ?integradorId pra filtrar
 *
 * Mostra stats no topo + tabela com filtros (com plano / sem plano).
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Loader2, Filter, AlertTriangle, CheckCircle2, Settings2,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { api } from '../../api/client'
import { cn } from '../../lib/utils'

interface Row {
  cameraId:    string
  cameraName:  string
  siteName:    string
  clienteName: string
  hasOverride: boolean
  legacyRetainDays: number
  plan: {
    id:         string
    name:       string
    slug:       string
    retainDays: number
    resolution: string
    source:     'CAMERA' | 'CLIENTE_FINAL' | 'INTEGRADOR'
  } | null
  finalPriceBrl: number
  markupPct:     number
}

interface ApiResponse {
  items: Row[]
  total: number
  stats: {
    withPlan:        number
    withoutPlan:     number
    totalMonthlyBrl: number
  }
}

export function CamerasByPlanTable({ integradorId, clienteFinalId }: {
  integradorId?:   string
  clienteFinalId?: string
}) {
  const [data, setData]       = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<'ALL' | 'WITH_PLAN' | 'WITHOUT_PLAN'>('ALL')
  const [search, setSearch]   = useState('')

  useEffect(() => {
    const params = new URLSearchParams()
    if (integradorId)   params.set('integradorId', integradorId)
    if (clienteFinalId) params.set('clienteFinalId', clienteFinalId)
    setLoading(true)
    api.get(`/retention/cameras?${params.toString()}`)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [integradorId, clienteFinalId])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.items.filter(r => {
      if (filter === 'WITH_PLAN'    && !r.plan) return false
      if (filter === 'WITHOUT_PLAN' && r.plan)  return false
      if (search) {
        const s = search.toLowerCase()
        return r.cameraName.toLowerCase().includes(s) ||
               r.siteName.toLowerCase().includes(s) ||
               r.clienteName.toLowerCase().includes(s)
      }
      return true
    })
  }, [data, filter, search])

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shrink-0">
          <Settings2 className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Câmeras × Plano de retenção
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Plano efetivo de cada câmera (override / cliente / integrador default)
          </p>
        </div>
        {data?.stats && (
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 font-bold">
              {data.stats.withPlan} com plano
            </span>
            {data.stats.withoutPlan > 0 && (
              <span className="px-2 py-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 font-bold">
                {data.stats.withoutPlan} sem plano
              </span>
            )}
            <span className="px-2 py-1 rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300 font-bold">
              R$ {data.stats.totalMonthlyBrl.toFixed(2)}/mês
            </span>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-slate-400" />
        {(['ALL', 'WITH_PLAN', 'WITHOUT_PLAN'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2.5 py-1 text-xs rounded-md font-medium transition',
              filter === f
                ? 'bg-cyan-500 text-white'
                : 'bg-slate-100 dark:bg-white/5 text-slate-600 hover:bg-slate-200',
            )}
          >
            {f === 'ALL' ? 'Todas' : f === 'WITH_PLAN' ? 'Com plano' : 'Sem plano'}
          </button>
        ))}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar câmera/site/cliente…"
          className="ml-auto px-2 py-1 text-xs rounded-md border bg-white dark:bg-white/5 dark:border-white/10 dark:text-white w-48"
        />
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-xs text-slate-500 italic py-6">
          Nenhuma câmera nesta visão.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500 text-[10px] uppercase bg-slate-50 dark:bg-white/5">
              <tr>
                <th className="text-left p-2">Câmera</th>
                <th className="text-left p-2">Site / Cliente</th>
                <th className="text-left p-2">Plano</th>
                <th className="text-center p-2">Resolução</th>
                <th className="text-center p-2">Dias</th>
                <th className="text-center p-2">Origem</th>
                <th className="text-right p-2">R$/mês</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.cameraId} className="border-t border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5">
                  <td className="p-2">
                    <Link to={`/cameras/${r.cameraId}`} className="font-medium text-cyan-600 hover:underline">
                      {r.cameraName}
                    </Link>
                    {r.hasOverride && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 font-bold uppercase">
                        Override
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-slate-500">
                    {r.siteName} · {r.clienteName}
                  </td>
                  <td className="p-2">
                    {r.plan ? (
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                        {r.plan.name}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-amber-600">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        Sem plano · legacy {r.legacyRetainDays}d
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {r.plan ? (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 font-mono text-[10px]">
                        {r.plan.resolution === 'UHD_4K' ? '4K' : r.plan.resolution}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="p-2 text-center font-mono">
                    {r.plan ? `${r.plan.retainDays}d` : '—'}
                  </td>
                  <td className="p-2 text-center text-[10px]">
                    {r.plan ? sourceLabel(r.plan.source) : '—'}
                  </td>
                  <td className="p-2 text-right font-bold text-emerald-600">
                    R$ {r.finalPriceBrl.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  )
}

function sourceLabel(s: string): string {
  if (s === 'CAMERA')        return 'câmera'
  if (s === 'CLIENTE_FINAL') return 'cliente'
  if (s === 'INTEGRADOR')    return 'integrador'
  return s
}
