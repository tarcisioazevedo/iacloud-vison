/**
 * ConfigTab — configurações de cobrança, notificações e gerenciamento Asaas.
 * Padrão visual alinhado ao design system.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { CreditCard, Loader2, AlertTriangle, Bell, Mail, X, Settings, Calendar, RefreshCw } from 'lucide-react'
import { api } from '../../api/client'
import { GlassCard } from '../cards/GlassCard'
import { cn } from '../../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface AsaasStatus {
  billingEnabled: boolean
  customer: null | { id: string; syncedAt: string }
  subscription: null | { id: string; planSlug: string; value: number; cycle: string; status: string; nextDueDate: string; billingType: string | null }
}

function brl(n: number) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function ConfigTab() {
  const { data, isLoading, mutate } = useSWR<AsaasStatus>('/me/integrador/asaas/status', fetcher)
  const [cancelling, setCancelling] = useState(false)

  async function cancelSubscription() {
    if (!confirm('Cancelar sua assinatura no iaCloud Vision? Isso pode suspender o serviço dos seus clientes finais.')) return
    setCancelling(true)
    try {
      await api.delete('/me/integrador/asaas/subscription')
      mutate()
    } catch (e: any) {
      alert('Falha: ' + (e?.response?.data?.message ?? e?.message))
    } finally { setCancelling(false) }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-600 dark:text-cyan-400" />
        <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">Carregando configuração…</span>
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Cobrança / Asaas */}
      <GlassCard className={cn('p-5',
        !data.billingEnabled    ? 'border-amber-300 dark:border-amber-500/20' :
        !data.customer          ? 'border-slate-300 dark:border-slate-500/20' :
                                   'border-emerald-300 dark:border-emerald-500/20',
      )}>
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className={cn('w-4 h-4',
            !data.billingEnabled ? 'text-amber-600 dark:text-amber-400' :
            !data.customer       ? 'text-slate-500' :
                                    'text-emerald-600 dark:text-emerald-400',
          )} />
          <h3 className={cn('text-xs uppercase tracking-wider font-bold',
            !data.billingEnabled ? 'text-amber-700 dark:text-amber-300' :
            !data.customer       ? 'text-slate-700 dark:text-slate-300' :
                                    'text-emerald-700 dark:text-emerald-300',
          )}>Cobrança (Asaas)</h3>
        </div>

        {!data.billingEnabled ? (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Billing global desabilitado
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              O fabricante ainda não ativou cobranças. Aguarde para começar a faturar.
            </p>
          </div>
        ) : !data.customer ? (
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Cadastro Asaas pendente</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              A primeira fatura será gerada automaticamente no dia 1 do próximo mês. Seu cadastro no Asaas é criado nesse momento.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="ID Asaas" value={data.customer.id} mono />
            <Field label="Sincronizado em" value={new Date(data.customer.syncedAt).toLocaleDateString('pt-BR')} Icon={RefreshCw} />
          </div>
        )}
      </GlassCard>

      {/* Assinatura */}
      {data.subscription && (
        <GlassCard className="p-5 border-cyan-300 dark:border-cyan-500/20">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <h3 className="text-xs uppercase tracking-wider font-bold text-cyan-700 dark:text-cyan-300">Assinatura ativa</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Field label="Plano" value={data.subscription.planSlug} />
            <Field label="Valor" value={`R$ ${brl(data.subscription.value)}/${data.subscription.cycle === 'MONTHLY' ? 'mês' : 'ano'}`} highlight />
            <Field label="Próxima cobrança" value={new Date(data.subscription.nextDueDate).toLocaleDateString('pt-BR')} Icon={Calendar} />
            <Field label="Método" value={data.subscription.billingType ?? '—'} />
          </div>
          <button onClick={cancelSubscription} disabled={cancelling}
            className="text-xs px-3 py-1.5 rounded-md border border-rose-300 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 inline-flex items-center gap-2 disabled:opacity-50 font-medium transition">
            <X className="w-3 h-3" /> {cancelling ? 'Cancelando…' : 'Cancelar assinatura'}
          </button>
        </GlassCard>
      )}

      {/* Notificações */}
      <GlassCard className="p-5 border-violet-300 dark:border-violet-500/20">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          <h3 className="text-xs uppercase tracking-wider font-bold text-violet-700 dark:text-violet-300">Notificações</h3>
        </div>
        <ul className="space-y-2.5">
          <Notif Icon={Mail} title="Email" desc="Automático em T-3, T-1, T-0 e em caso de atraso" active />
          <Notif Icon={Bell} title="Push browser" desc="Quando você está logado no app" active />
          <Notif Icon={AlertTriangle} title="Banner global" desc="Visível em qualquer página se houver fatura atrasada" active />
        </ul>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-4 pt-3 border-t border-slate-200 dark:border-white/5">
          💡 WhatsApp (opt-in) virá em breve. Por enquanto, mantenha as notificações do browser ativadas.
        </p>
      </GlassCard>
    </div>
  )
}

function Field({ label, value, mono, highlight, Icon }: { label: string; value: string; mono?: boolean; highlight?: boolean; Icon?: any }) {
  return (
    <div className={cn('rounded-lg p-3 border',
      highlight
        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30'
        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-white/10',
    )}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </p>
      <p className={cn('text-sm font-bold mt-1',
        mono && 'font-mono',
        highlight ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-white',
      )}>{value}</p>
    </div>
  )
}

function Notif({ Icon, title, desc, active }: { Icon: any; title: string; desc: string; active?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
        active
          ? 'bg-gradient-to-br from-violet-500 to-cyan-500 text-white shadow-md shadow-violet-500/20'
          : 'bg-slate-100 dark:bg-slate-700/50 text-slate-500',
      )}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{desc}</p>
      </div>
      {active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold uppercase">Ativo</span>}
    </li>
  )
}
