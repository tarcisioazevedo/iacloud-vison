/**
 * ApprovalsDemoTab — Aprovações de DEMO (lead aguardando liberação).
 * NÃO confundir com aprovações de Edge (no cockpit do tenant).
 */
import { useState } from 'react'
import useSWR from 'swr'
import {
  CheckCircle2, Loader2, Mail, Phone, BarChart3, Clock, CheckCircle,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { api, formatApiError } from '../../api/client'
import { cn } from '../../lib/utils'
import { useUiToast } from '../Toast'
import { confirm } from '../ConfirmDialog'

const fetcher = (u: string) => api.get(u).then(r => r.data)

export function ApprovalsDemoTab() {
  const toast = useUiToast()
  const { data, error, isLoading, mutate } = useSWR<any>('/leads?status=NEW', fetcher, { refreshInterval: 30_000 })
  const [busyId, setBusyId] = useState<string | null>(null)

  const leads = data?.items ?? data?.leads ?? []

  async function approve(lead: any) {
    const ok = await confirm({
      title: `Aprovar demo para ${lead.contactName}?`,
      description: 'Gera magic link, envia email rico ao lead com link e tutorial, e marca lead como DEMO_SENT.',
      confirmLabel: 'Aprovar',
    })
    if (!ok) return
    setBusyId(lead.id)
    try {
      const r = await api.post(`/leads/${lead.id}/invite`, { ttlDays: 14 })
      mutate()
      toast.success({
        title: 'Demo aprovada',
        description: `Enviada para ${lead.contactEmail}\nLink: ${r.data?.magicLink ?? '(gerado, ver email)'}`,
      })
    } catch (e) { toast.error(formatApiError(e)) }
    finally { setBusyId(null) }
  }

  async function reject(lead: any) {
    const reason = prompt(`Motivo para rejeitar a demo de ${lead.contactName}? (opcional, será enviado ao lead)`)
    if (reason === null) return
    setBusyId(lead.id)
    try {
      await api.patch(`/leads/${lead.id}`, { status: 'LOST', lostReason: reason || 'Demo rejeitada' })
      mutate()
    } catch (e) { toast.error(formatApiError(e)) }
    finally { setBusyId(null) }
  }

  if (isLoading) return <div className="h-64 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />
  if (error) return (
    <GlassCard className="p-6 border-rose-500/30">
      <p className="text-xs text-rose-300">{formatApiError(error)}</p>
    </GlassCard>
  )

  return (
    <div className="space-y-3">
      <GlassCard className="p-4 border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-white">Aprovações de Demo ({leads.length})</h3>
            <p className="text-xs text-slate-400 mt-1">
              Leads aguardando aprovação para acesso à demo. <strong>SLA: 1 dia útil</strong>.
              Ao aprovar, o sistema gera magic link e envia email automaticamente.
            </p>
          </div>
        </div>
      </GlassCard>

      {leads.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <CheckCircle className="w-12 h-12 mx-auto text-emerald-500/50 mb-3" />
          <p className="text-sm text-slate-400">Nenhuma aprovação pendente. ✨</p>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {leads.map((lead: any) => (
            <GlassCard key={lead.id} className="p-3 border-amber-500/20">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border',
                      lead.kind === 'INTEGRADOR'
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                        : 'bg-violet-500/20 text-violet-300 border-violet-500/30',
                    )}>
                      {lead.kind === 'INTEGRADOR' ? 'Integrador' : 'Cliente Final'}
                    </span>
                    <h4 className="text-sm font-bold text-white">{lead.contactName}</h4>
                    {lead.companyName && <span className="text-xs text-slate-500">· {lead.companyName}</span>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-400 mt-2">
                    <span className="flex items-center gap-1.5"><Mail className="w-3 h-3 text-slate-500" />{lead.contactEmail}</span>
                    {lead.contactPhone && <span className="flex items-center gap-1.5"><Phone className="w-3 h-3 text-slate-500" />{lead.contactPhone}</span>}
                    {lead.cnpj && <span className="font-mono">CNPJ: {lead.cnpj}</span>}
                    {lead.cameraVolume && <span className="flex items-center gap-1.5"><BarChart3 className="w-3 h-3 text-slate-500" />{lead.cameraVolume} câmeras</span>}
                    {lead.city && <span>{lead.city}/{lead.state}</span>}
                    <span className="flex items-center gap-1.5"><Clock className="w-3 h-3 text-slate-500" />{new Date(lead.createdAt).toLocaleString('pt-BR')}</span>
                  </div>
                  {lead.message && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 italic bg-slate-50 dark:bg-white/5 p-2 rounded border border-slate-200 dark:border-white/10">"{lead.message}"</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button onClick={() => approve(lead)} disabled={busyId === lead.id}
                    className="px-3 py-1.5 rounded text-xs bg-emerald-500 hover:bg-emerald-600 text-white font-bold disabled:opacity-50 flex items-center gap-1">
                    {busyId === lead.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                    Aprovar Demo
                  </button>
                  <button onClick={() => reject(lead)} disabled={busyId === lead.id}
                    className="px-3 py-1.5 rounded text-xs bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 font-bold">
                    Rejeitar
                  </button>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  )
}
