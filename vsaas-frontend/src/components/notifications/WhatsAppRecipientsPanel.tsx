/**
 * WhatsAppRecipientsPanel
 * Gerencia a lista de destinatários de alertas automáticos do canal WhatsApp.
 * Usado tanto no SettingsPage (CLIENTE_ADMIN) quanto no WhatsAppModal
 * do ClientesFinaisPage (INTEGRADOR_ADMIN via ?clienteFinalId=).
 *
 * Funcionalidades:
 *  - Adicionar / remover destinatários
 *  - Broadcast avulso: envia uma mensagem para todos os destinatários de uma vez
 */

import { useState } from 'react'
import {
  Plus, X, Loader2, AlertTriangle, Users, Phone,
  Send, ChevronDown, ChevronUp,
} from 'lucide-react'
import { api, formatApiError } from '../../api/client'
import { cn } from '../../lib/utils'

interface Props {
  recipients:   string[]
  qs:           string   // '' para CLIENTE_ADMIN, '?clienteFinalId=...' para INTEGRADOR_ADMIN
  /** Path base do recurso (default '/notifications/whatsapp').
   *  Para super-admin (canal singleton do fabricante) passe '/admin/notifications/whatsapp'. */
  basePath?:    string
  onUpdate:     (recipients: string[]) => void
  /** Bloqueia TODAS as ações (CRUD + broadcast). Use para falta de instância. */
  disabled?:    boolean
  /** Bloqueia apenas o broadcast (cadastro segue habilitado).
   *  Default: alinha com `disabled` para preservar comportamento legado. */
  broadcastDisabled?: boolean
  onLogRefresh?: () => void  // chamado após broadcast para atualizar o extrato
}

function formatPhone(phone: string): string {
  // 5511999999999 → +55 (11) 99999-9999
  const d = phone.replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55')) {
    const ddd = d.slice(2, 4)
    const part1 = d.slice(4, 9)
    const part2 = d.slice(9)
    return `+55 (${ddd}) ${part1}-${part2}`
  }
  if (d.length === 12 && d.startsWith('55')) {
    const ddd = d.slice(2, 4)
    const part1 = d.slice(4, 8)
    const part2 = d.slice(8)
    return `+55 (${ddd}) ${part1}-${part2}`
  }
  return `+${d}`
}

export function WhatsAppRecipientsPanel({
  recipients, qs, basePath = '/notifications/whatsapp',
  onUpdate, disabled, broadcastDisabled, onLogRefresh,
}: Props) {
  const [input,         setInput]         = useState('')
  const [adding,        setAdding]        = useState(false)
  const [removing,      setRemoving]      = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const [broadcastMsg,  setBroadcastMsg]  = useState('')
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [broadcasting,  setBroadcasting]  = useState(false)
  const [broadcastRes,  setBroadcastRes]  = useState<string | null>(null)

  // Se broadcastDisabled não for explicitamente passado, herda do disabled
  // (compatibilidade com calls anteriores).
  const broadcastBlocked = broadcastDisabled ?? disabled

  async function add() {
    const phone = input.replace(/\D/g, '')
    if (phone.length < 10) { setError('Mínimo 10 dígitos (código do país + DDD + número)'); return }
    setAdding(true); setError(null)
    try {
      const { data } = await api.post(`${basePath}/recipients${qs}`, { phone })
      onUpdate(data.channel.recipients ?? [])
      setInput('')
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setAdding(false)
    }
  }

  async function remove(phone: string) {
    setRemoving(phone); setError(null)
    try {
      const { data } = await api.delete(`${basePath}/recipients${qs}`, { data: { phone } })
      onUpdate(data.channel.recipients ?? [])
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setRemoving(null)
    }
  }

  async function broadcast() {
    if (!broadcastMsg.trim()) return
    setBroadcasting(true); setBroadcastRes(null)
    try {
      const { data } = await api.post(`${basePath}/broadcast${qs}`, { message: broadcastMsg })
      setBroadcastRes(`✅ Enviado para ${data.sent} número(s)${data.failed ? ` · ${data.failed} falha(s)` : ''}`)
      setBroadcastMsg('')
      onLogRefresh?.()
    } catch (e) {
      setBroadcastRes('❌ ' + formatApiError(e))
    } finally {
      setBroadcasting(false)
    }
  }

  const inputCls =
    'w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 ' +
    'dark:bg-space-800/40 dark:border-white/10 dark:text-white dark:placeholder:text-slate-600 rounded-lg text-sm ' +
    'focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div className={cn('space-y-3', disabled && 'opacity-60 pointer-events-none')}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
        <p className="text-[11px] font-semibold text-slate-900 dark:text-white">Destinatários de alertas</p>
        <span className="ml-auto text-[10px] text-slate-500 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full">
          {recipients.length} {recipients.length === 1 ? 'número' : 'números'}
        </span>
      </div>

      <p className="text-[10px] text-slate-500 leading-relaxed">
        Números que receberão alertas automáticos do sistema. Adicione no formato internacional
        (ex.: <code className="font-mono text-cyan-600 dark:text-cyan-400">5511999999999</code>).
      </p>

      {/* Input de adição */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="tel"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="5511999999999"
            disabled={disabled || adding}
            className={inputCls + ' pl-9'}
          />
        </div>
        <button
          onClick={add}
          disabled={disabled || adding || !input.trim()}
          className="px-3 py-2 rounded-lg bg-cyan-100 hover:bg-cyan-200 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/20 dark:hover:bg-cyan-500/30 dark:border-cyan-500/40 dark:text-cyan-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Adicionar
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-[11px] text-rose-600 dark:text-rose-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* Lista de destinatários */}
      {recipients.length === 0 ? (
        <div className="py-4 text-center text-[11px] text-slate-400 italic">
          Nenhum destinatário cadastrado ainda
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5 rounded-lg border border-slate-200 dark:border-white/8 overflow-hidden">
          {recipients.map(phone => (
            <li key={phone} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.04] transition">
              <div className="flex items-center gap-2.5">
                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white font-mono">{formatPhone(phone)}</p>
                  <p className="text-[10px] text-slate-400">{phone}</p>
                </div>
              </div>
              <button
                onClick={() => remove(phone)}
                disabled={removing === phone}
                title="Remover destinatário"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition disabled:opacity-40"
              >
                {removing === phone
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <X className="w-3.5 h-3.5" />
                }
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Broadcast avulso — exige WhatsApp conectado, mesmo com destinatários cadastrados */}
      {recipients.length > 0 && (
        <div className={cn('rounded-lg border border-emerald-200 dark:border-emerald-500/20 overflow-hidden', broadcastBlocked && 'opacity-60')}>
          <button
            onClick={() => { setBroadcastOpen(o => !o); setBroadcastRes(null) }}
            disabled={broadcastBlocked}
            title={broadcastBlocked ? 'Conecte o WhatsApp na aba Conexão para enviar mensagens' : undefined}
            className="w-full flex items-center gap-2 px-3 py-2.5 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold transition disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5 shrink-0" />
            Enviar mensagem para todos os destinatários
            {broadcastBlocked && <span className="ml-1 text-[9px] uppercase tracking-wider opacity-70">(WhatsApp desconectado)</span>}
            <span className="ml-auto">
              {broadcastOpen
                ? <ChevronUp className="w-3.5 h-3.5" />
                : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>

          {broadcastOpen && !broadcastBlocked && (
            <div className="p-3 space-y-2 bg-white dark:bg-white/[0.02]">
              <textarea
                rows={3}
                value={broadcastMsg}
                onChange={e => setBroadcastMsg(e.target.value)}
                placeholder="Digite a mensagem que será enviada para todos os números da lista…"
                disabled={broadcasting}
                className={inputCls + ' resize-none text-xs leading-relaxed'}
              />
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={broadcast}
                  disabled={broadcasting || !broadcastMsg.trim()}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {broadcasting
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Send className="w-3.5 h-3.5" />}
                  Enviar para {recipients.length} número{recipients.length !== 1 ? 's' : ''}
                </button>
                {broadcastRes && (
                  <span className={cn(
                    'text-[11px] font-medium px-2.5 py-1 rounded-lg border',
                    broadcastRes.startsWith('✅')
                      ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                      : 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20',
                  )}>
                    {broadcastRes}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
