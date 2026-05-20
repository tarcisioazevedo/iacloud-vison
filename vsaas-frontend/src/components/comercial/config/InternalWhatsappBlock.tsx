/**
 * InternalWhatsappBlock — Pareamento da instância Evolution dedicada à equipe
 * VSaaS (notificações comerciais internas).
 *
 * Estados:
 *   - "open"        → conectado: mostra perfil + número + botões logout/test
 *   - "connecting"  → instância criada, esperando scan: mostra QR + countdown
 *   - "close" / nil → não criado: botão "Criar instância"
 *
 * Auto-refresh do snapshot a cada 5s. Se conectar, esconde QR.
 */
import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, MessageCircle, LogOut, Trash2, Send, CheckCircle, AlertCircle, QrCode } from 'lucide-react'
import { GlassCard } from '../../cards/GlassCard'
import {
  useInternalWaState, provisionInternalWa, refreshInternalWaQr,
  logoutInternalWa, deleteInternalWa, sendTestInternalWa,
  formatApiError,
} from '../../../api/client'
import { cn } from '../../../lib/utils'

export function InternalWhatsappBlock() {
  const { data, mutate, isLoading } = useInternalWaState()
  const [qr, setQr] = useState<string | null>(null)
  const [pairing, setPairing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const [testPhone, setTestPhone] = useState('')
  const [testMsg, setTestMsg] = useState('')

  const state = data?.snapshot?.connectionState ?? 'unknown'
  const isOpen = state === 'open'

  // Quando conecta, esconde QR.
  useEffect(() => {
    if (isOpen && qr) setQr(null)
  }, [isOpen, qr])

  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(label); setErr(null); setInfo(null)
    try {
      const r = await fn()
      return r
    } catch (e: any) {
      setErr(formatApiError(e)); return null
    } finally {
      setBusy(null)
    }
  }

  async function provision() {
    const r = await withBusy('provision', provisionInternalWa)
    if (r) {
      setQr(r.qrCodePayload ?? null)
      setPairing(r.pairingCode ?? null)
      mutate()
    }
  }
  async function refreshQr() {
    const r = await withBusy('refresh', refreshInternalWaQr)
    if (r) {
      setQr(r.qrCodePayload ?? null)
      setPairing(r.pairingCode ?? null)
      mutate()
    }
  }
  async function logout() {
    if (!confirm('Desconectar a instância? Será preciso escanear de novo para reconectar.')) return
    if (await withBusy('logout', logoutInternalWa)) {
      setQr(null); setPairing(null); mutate()
      setInfo('Desconectado.')
    }
  }
  async function deleteInstance() {
    if (!confirm('REMOVER a instância? Tudo é apagado e precisará criar do zero.')) return
    if (await withBusy('delete', deleteInternalWa)) {
      setQr(null); setPairing(null); mutate()
      setInfo('Instância removida.')
    }
  }
  async function sendTest() {
    if (!testPhone.trim()) { setErr('Informe um número.'); return }
    const r = await withBusy('send-test', () => sendTestInternalWa(testPhone.trim(), testMsg.trim() || undefined))
    if (r?.ok) setInfo('✅ Mensagem de teste enviada com sucesso.')
    else if (r) setErr('Falha: ' + (r.error ?? 'erro desconhecido'))
  }

  if (isLoading) return <div className="h-32 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">WhatsApp interno (Evolution)</h3>
        <code className="text-[10px] text-slate-500 font-mono ml-1">{data?.instanceName ?? 'iacloud_internal'}</code>
        <StateBadge state={state} />
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Instância dedicada para notificações comerciais (HOT_LEAD, alertas críticos). Diferente das instâncias por cliente.
      </p>

      {/* Erros / infos */}
      {err && (
        <div className="mb-3 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {err}
        </div>
      )}
      {info && (
        <div className="mb-3 p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5" /> {info}
        </div>
      )}

      {/* CONECTADO */}
      {isOpen && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Número vinculado" value={data?.snapshot?.phoneNumber ?? '—'} mono />
            <Field label="Perfil" value={data?.snapshot?.profileName ?? '—'} />
          </div>
          <div className="border-t border-slate-200 dark:border-white/5 pt-3">
            <p className="text-[10px] uppercase text-slate-500 mb-2">Enviar mensagem de teste</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input value={testPhone} onChange={e => setTestPhone(e.target.value)}
                placeholder="11 99999-0000"
                className="px-2 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
              <input value={testMsg} onChange={e => setTestMsg(e.target.value)}
                placeholder="(opcional) mensagem custom"
                className="md:col-span-2 px-2 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
            </div>
            <div className="mt-2 flex gap-2">
              <button onClick={sendTest} disabled={busy === 'send-test' || !testPhone.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold disabled:opacity-50">
                {busy === 'send-test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Enviar teste
              </button>
            </div>
          </div>
          <div className="border-t border-slate-200 dark:border-white/5 pt-3 flex gap-2">
            <button onClick={logout} disabled={busy === 'logout'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-xs font-medium disabled:opacity-50">
              {busy === 'logout' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
              Desconectar
            </button>
            <button onClick={deleteInstance} disabled={busy === 'delete'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-xs font-medium disabled:opacity-50">
              {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Remover instância
            </button>
          </div>
        </div>
      )}

      {/* CONECTANDO ou QR já obtido */}
      {!isOpen && (data?.exists || qr) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div className="flex flex-col items-center gap-3 p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10">
            {qr ? (
              <img src={qr} alt="QR Code WhatsApp"
                className="w-48 h-48 bg-white rounded p-2"
                onError={() => setErr('Falha ao carregar QR')} />
            ) : (
              <div className="w-48 h-48 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-600">
                <QrCode className="w-16 h-16 opacity-30" />
              </div>
            )}
            {pairing && (
              <div className="text-center">
                <p className="text-[10px] uppercase text-slate-500">Ou digite o código de pareamento:</p>
                <p className="text-base font-mono font-bold text-slate-900 dark:text-white tracking-wider">{pairing}</p>
              </div>
            )}
            <button onClick={refreshQr} disabled={busy === 'refresh'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-violet-500 hover:bg-violet-400 text-white text-xs font-bold disabled:opacity-50">
              {busy === 'refresh' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {qr ? 'Renovar QR' : 'Gerar QR'}
            </button>
          </div>

          <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
            <h4 className="font-bold text-slate-900 dark:text-white text-sm">Como parear</h4>
            <ol className="space-y-1.5 list-decimal list-inside text-slate-400">
              <li>Abra o <strong className="text-slate-900 dark:text-white">WhatsApp Business</strong> no celular dedicado da equipe</li>
              <li>Toque em <strong className="text-slate-900 dark:text-white">Mais opções (⋮)</strong> → <strong className="text-slate-900 dark:text-white">Dispositivos conectados</strong> → <strong className="text-slate-900 dark:text-white">Conectar um dispositivo</strong></li>
              <li>Escaneie o QR Code ao lado <em>ou</em> digite o código de pareamento</li>
              <li>Aguarde — a página detecta a conexão automaticamente em até 5s</li>
            </ol>
            <p className="text-[10px] text-slate-500 mt-3">
              💡 Use um número exclusivo da empresa, não pessoal. WhatsApp Business preferível ao normal (suporta sessões mais estáveis).
            </p>
            <div className="pt-3 border-t border-slate-200 dark:border-white/5">
              <button onClick={deleteInstance} disabled={busy === 'delete'}
                className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Recomeçar do zero
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEM INSTÂNCIA */}
      {!data?.exists && !qr && (
        <div className="p-6 rounded-lg bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border border-emerald-500/30 text-center">
          <MessageCircle className="w-12 h-12 mx-auto text-emerald-400 mb-3" />
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Instância ainda não criada</h4>
          <p className="text-xs text-slate-400 mb-4">
            Crie a instância para receber QR Code de pareamento. O número usado será o canal oficial das notificações.
          </p>
          <button onClick={provision} disabled={busy === 'provision'}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-bold disabled:opacity-50">
            {busy === 'provision' ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
            Criar instância e gerar QR
          </button>
        </div>
      )}
    </GlassCard>
  )
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    open:        { label: '● Conectado',    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
    connecting:  { label: '◐ Conectando',   cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30 animate-pulse' },
    qr:          { label: '◑ Aguarda QR',   cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30 animate-pulse' },
    close:       { label: '○ Desconectado', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
    unknown:     { label: '— sem estado',   cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  }
  const s = map[state] ?? map.unknown
  return <span className={cn('ml-auto px-2 py-0.5 rounded text-[10px] font-bold border', s.cls)}>{s.label}</span>
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-2 rounded bg-white/[0.02] border border-slate-200 dark:border-white/10">
      <p className="text-[10px] uppercase text-slate-500 mb-0.5">{label}</p>
      <p className={cn('text-xs text-slate-900 dark:text-white', mono && 'font-mono')}>{value}</p>
    </div>
  )
}
