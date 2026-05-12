/**
 * PlanHistoryCard — timeline de mudanças de plano de retenção.
 *
 * Modos:
 *   - cameraId: histórico da câmera (próprio + herança do cliente)
 *   - clienteFinalId: histórico do cliente
 *
 * Consume GET /retention/upgrade-requests?cameraId=X (B4 fix, filtros novos).
 *
 * Mostra timeline reversa cronológica com:
 *   - Status badge (AUTO_APPROVED / PENDING_INTEGRADOR / APPROVED / DENIED)
 *   - From → To (planos com nome + slug)
 *   - Quem solicitou + quem decidiu + quando
 *   - Decision note
 */
import { useEffect, useState } from 'react'
import {
  Loader2, History, CheckCircle2, Clock, XCircle, Sparkles, ArrowRight,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { api } from '../../api/client'
import { cn } from '../../lib/utils'

interface UpgradeRequest {
  id:             string
  status:         'AUTO_APPROVED' | 'PENDING_INTEGRADOR' | 'APPROVED' | 'DENIED' | 'CANCELED'
  requestedAt:    string
  decidedAt?:     string | null
  decisionNote?:  string | null
  fromPlano?:     { slug: string; name: string }
  toPlano:        { slug: string; name: string }
  requestedBy?:   { id: string; name: string; email: string }
}

interface Props {
  cameraId?:        string
  clienteFinalId?:  string
  limit?:           number
}

export function PlanHistoryCard({ cameraId, clienteFinalId, limit = 20 }: Props) {
  const [items, setItems] = useState<UpgradeRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams()
    if (cameraId)       params.set('cameraId', cameraId)
    if (clienteFinalId) params.set('clienteFinalId', clienteFinalId)
    params.set('limit', String(limit))
    setLoading(true)
    api.get(`/retention/upgrade-requests?${params.toString()}`)
      .then(r => setItems(r.data.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [cameraId, clienteFinalId, limit])

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-slate-500 flex items-center justify-center shrink-0">
          <History className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
            Histórico de mudanças de plano
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Últimas {limit} solicitações de upgrade/downgrade
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-xs text-slate-500 italic py-6">
          Nenhuma mudança de plano registrada.
        </p>
      ) : (
        <ol className="relative border-l border-slate-200 dark:border-white/10 ml-3 space-y-3 pl-5">
          {items.map(item => (
            <TimelineEntry key={item.id} item={item} />
          ))}
        </ol>
      )}
    </GlassCard>
  )
}

function TimelineEntry({ item }: { item: UpgradeRequest }) {
  const { icon, color, label } = statusMeta(item.status)
  return (
    <li className="relative">
      {/* Bullet */}
      <span className={cn(
        'absolute -left-[27px] top-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center',
        color.bullet,
      )}>
        {icon}
      </span>

      <div className={cn(
        'p-3 rounded-lg border text-xs',
        color.bg,
      )}>
        <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
          <span className={cn('px-1.5 py-0.5 rounded text-[9px] uppercase font-bold', color.badge)}>
            {label}
          </span>
          <span className="text-[10px] text-slate-500">
            {formatDate(item.requestedAt)}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
          <span className="line-through opacity-60">
            {item.fromPlano?.name ?? 'sem plano'}
          </span>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <strong className="text-slate-900 dark:text-white">{item.toPlano.name}</strong>
        </div>

        {item.requestedBy && (
          <p className="text-[10px] text-slate-500 mt-1.5">
            Solicitado por <span className="font-medium">{item.requestedBy.name}</span>
            {item.decidedAt && (
              <> · decidido em {formatDate(item.decidedAt)}</>
            )}
          </p>
        )}

        {item.decisionNote && (
          <p className="text-[10px] text-slate-400 mt-1 italic">
            “{item.decisionNote}”
          </p>
        )}
      </div>
    </li>
  )
}

function statusMeta(status: UpgradeRequest['status']) {
  switch (status) {
    case 'AUTO_APPROVED':
      return {
        label: 'Auto-aprovado',
        icon: <Sparkles className="w-2.5 h-2.5 text-cyan-600" />,
        color: {
          bullet: 'bg-cyan-100 border-cyan-500 dark:bg-cyan-500/20 dark:border-cyan-400',
          bg: 'bg-cyan-50/50 dark:bg-cyan-500/5 border-cyan-200 dark:border-cyan-500/20',
          badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
        },
      }
    case 'APPROVED':
      return {
        label: 'Aprovado',
        icon: <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />,
        color: {
          bullet: 'bg-emerald-100 border-emerald-500 dark:bg-emerald-500/20 dark:border-emerald-400',
          bg: 'bg-emerald-50/50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20',
          badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
        },
      }
    case 'PENDING_INTEGRADOR':
      return {
        label: 'Aguardando integrador',
        icon: <Clock className="w-2.5 h-2.5 text-amber-600" />,
        color: {
          bullet: 'bg-amber-100 border-amber-500 dark:bg-amber-500/20 dark:border-amber-400',
          bg: 'bg-amber-50/50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20',
          badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
        },
      }
    case 'DENIED':
    case 'CANCELED':
      return {
        label: status === 'DENIED' ? 'Negado' : 'Cancelado',
        icon: <XCircle className="w-2.5 h-2.5 text-rose-600" />,
        color: {
          bullet: 'bg-rose-100 border-rose-500 dark:bg-rose-500/20 dark:border-rose-400',
          bg: 'bg-rose-50/50 dark:bg-rose-500/5 border-rose-200 dark:border-rose-500/20',
          badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
        },
      }
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
