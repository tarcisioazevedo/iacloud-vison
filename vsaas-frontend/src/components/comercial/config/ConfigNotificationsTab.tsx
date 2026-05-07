/**
 * ConfigNotificationsTab — Preferências de notificação por canal e por evento.
 *
 * Estrutura:
 *   1. Canais globais on/off (Push / Email / WhatsApp)
 *   2. Telefone WhatsApp (E.164)
 *   3. Quiet hours (start/end)
 *   4. Daily digest 07:00 toggle
 *   5. Matriz event × canal (override do default)
 *   6. Botões de teste por canal
 *   7. Histórico das últimas 50 notificações
 */
import { useEffect, useState } from 'react'
import { Save, Loader2, Bell, MessageCircle, Mail, Smartphone, Send, History as HistoryIcon, AlertCircle, CheckCircle, X } from 'lucide-react'
import { GlassCard } from '../../cards/GlassCard'
import {
  useNotifyPrefs, updateNotifyPrefs, sendTestNotify, useNotifyHistory,
  formatApiError, type NotifyChannel, type NotifyPrefs,
} from '../../../api/client'
import { cn } from '../../../lib/utils'
import { InternalWhatsappBlock } from './InternalWhatsappBlock'

// Eventos exibidos na matriz, com label friendly e default canais.
const EVENTS: { id: string; label: string; hint: string; defaultChannels: NotifyChannel[] }[] = [
  { id: 'NEW_LEAD',                label: '✨ Novo lead',              hint: 'Lead atribuído via round-robin',         defaultChannels: ['push', 'email', 'sse'] },
  { id: 'HOT_LEAD',                label: '🔥 Lead HOT',               hint: 'Score ≥ 75 sem contato em 1h',           defaultChannels: ['push', 'whatsapp', 'sse'] },
  { id: 'DEMO_APPROVED',           label: '🎬 Demo aprovada',          hint: 'Magic-link enviado ao lead',             defaultChannels: ['push', 'sse'] },
  { id: 'DEMO_PENDING_OVERDUE',    label: '⏱ Demo fora do SLA',        hint: 'Demo enviada > SLA dias sem ação',       defaultChannels: ['push', 'email'] },
  { id: 'LEAD_STALLED',            label: '⏱ Lead estagnado',          hint: '> 14d na mesma etapa',                   defaultChannels: ['push', 'email'] },
  { id: 'LEAD_CONVERTED',          label: '🏆 Lead convertido',        hint: 'Virou Integrador',                       defaultChannels: ['push', 'email', 'sse'] },
  { id: 'LEAD_LOST_TO_COMPETITOR', label: '⚔ Perdido p/ concorrente', hint: 'lostCategory=COMPETITOR',                defaultChannels: ['push', 'email'] },
  { id: 'LEAD_REASSIGNED',         label: '🔄 Lead reatribuído',       hint: 'Owner mudou',                            defaultChannels: ['push', 'sse'] },
  { id: 'GOAL_50_PCT',             label: '🎯 50% da meta',            hint: 'Cruzou metade da meta mensal',           defaultChannels: ['push'] },
  { id: 'GOAL_100_PCT',            label: '🏆 Meta atingida',          hint: 'Bateu meta mensal',                      defaultChannels: ['push', 'email'] },
  { id: 'DAILY_DIGEST',            label: '📅 Resumo diário',          hint: '07:00 — pendências e prioridades',       defaultChannels: ['email'] },
]

const CHANNELS: { id: NotifyChannel; label: string; icon: any; color: string }[] = [
  { id: 'push',     label: 'Push',     icon: Smartphone,     color: 'violet' },
  { id: 'email',    label: 'Email',    icon: Mail,           color: 'cyan' },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle,  color: 'emerald' },
  { id: 'sse',      label: 'Popup',    icon: Bell,           color: 'amber' },
]

export function ConfigNotificationsTab() {
  const { data: prefs, mutate, isLoading } = useNotifyPrefs()

  const [pushEnabled, setPushEnabled] = useState(true)
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [whatsappEnabled, setWhatsappEnabled] = useState(false)
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [quietHoursStart, setQuietHoursStart] = useState(22)
  const [quietHoursEnd, setQuietHoursEnd] = useState(7)
  const [dailyDigest, setDailyDigest] = useState(true)
  const [eventChannels, setEventChannels] = useState<Record<string, NotifyChannel[]>>({})

  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [testing, setTesting] = useState<NotifyChannel | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    if (!prefs) return
    setPushEnabled(prefs.pushEnabled)
    setEmailEnabled(prefs.emailEnabled)
    setWhatsappEnabled(prefs.whatsappEnabled)
    setWhatsappPhone(prefs.whatsappPhone ?? '')
    setQuietHoursStart(prefs.quietHoursStart ?? 22)
    setQuietHoursEnd(prefs.quietHoursEnd ?? 7)
    setDailyDigest(prefs.dailyDigest ?? true)
    setEventChannels((prefs.eventChannels as any) ?? {})
  }, [prefs])

  function toggleEventChannel(eventId: string, channel: NotifyChannel) {
    setEventChannels(prev => {
      const current = prev[eventId] ?? EVENTS.find(e => e.id === eventId)?.defaultChannels ?? []
      const next = current.includes(channel) ? current.filter(c => c !== channel) : [...current, channel]
      return { ...prev, [eventId]: next }
    })
  }

  function getEventChannels(eventId: string): NotifyChannel[] {
    return eventChannels[eventId] ?? EVENTS.find(e => e.id === eventId)?.defaultChannels ?? []
  }

  async function save() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      await updateNotifyPrefs({
        pushEnabled, emailEnabled, whatsappEnabled,
        whatsappPhone: whatsappPhone.trim() || null,
        quietHoursStart, quietHoursEnd, dailyDigest,
        eventChannels,
      })
      await mutate()
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  async function testChannel(channel: NotifyChannel) {
    setTesting(channel); setTestResult(null)
    try {
      const r = await sendTestNotify([channel])
      const sent = r?.sentByChannel?.[channel] ?? 0
      setTestResult(sent > 0
        ? `✅ ${channel.toUpperCase()}: enviado com sucesso`
        : `⚠ ${channel.toUpperCase()}: não enviado (${r?.failed ?? 0} falhas, ${r?.skipped ?? 0} skipped). Veja o histórico.`)
    } catch (e: any) {
      setTestResult(`❌ ${channel.toUpperCase()}: ${formatApiError(e)}`)
    } finally {
      setTesting(null)
      setTimeout(() => setTestResult(null), 6000)
    }
  }

  if (isLoading) return <div className="h-64 rounded-lg bg-white/5 animate-pulse" />

  return (
    <div className="space-y-4">
      {/* Provisionamento da instância WhatsApp interna (Evolution) */}
      <InternalWhatsappBlock />

      {/* Canais globais */}
      <GlassCard className="p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Canais habilitados</h3>
          <p className="text-xs text-slate-500">Liga/desliga global de cada canal. Tudo desligado = você não recebe nada.</p>
        </div>

        <ChannelToggle icon={Smartphone} color="violet" label="Push (browser)"
          desc="Notificações no navegador, mesmo com a aba fechada"
          value={pushEnabled} onChange={setPushEnabled} />

        <ChannelToggle icon={Mail} color="cyan" label="Email"
          desc="Resumo + alertas críticos via SMTP"
          value={emailEnabled} onChange={setEmailEnabled} />

        <ChannelToggle icon={MessageCircle} color="emerald" label="WhatsApp"
          desc="Eventos críticos via Evolution. Opt-in obrigatório (LGPD)."
          value={whatsappEnabled} onChange={setWhatsappEnabled}>
          {whatsappEnabled && (
            <div className="mt-2">
              <label className="text-[10px] uppercase text-slate-500 mb-1 block tracking-wider">Telefone WhatsApp (com DDD)</label>
              <input value={whatsappPhone} onChange={e => setWhatsappPhone(e.target.value)}
                placeholder="11 99999-0000"
                className="w-full px-3 py-1.5 rounded bg-slate-900 border border-white/10 text-xs text-white" />
              <p className="text-[10px] text-slate-500 mt-1">
                Será normalizado automaticamente para E.164. Apenas eventos com canal WhatsApp configurado serão enviados.
              </p>
            </div>
          )}
        </ChannelToggle>
      </GlassCard>

      {/* Quiet hours + Digest */}
      <GlassCard className="p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Não me incomode</h3>
          <p className="text-xs text-slate-500">Janela em que apenas eventos CRITICAL passam. SSE (popup) ignora — só popups quando a aba está aberta.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase text-slate-500 mb-1 block">Início (h)</label>
            <input type="number" min={0} max={23} value={quietHoursStart}
              onChange={e => setQuietHoursStart(parseInt(e.target.value || '0'))}
              className="w-full px-3 py-1.5 rounded bg-slate-900 border border-white/10 text-xs text-white" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 mb-1 block">Fim (h)</label>
            <input type="number" min={0} max={23} value={quietHoursEnd}
              onChange={e => setQuietHoursEnd(parseInt(e.target.value || '0'))}
              className="w-full px-3 py-1.5 rounded bg-slate-900 border border-white/10 text-xs text-white" />
          </div>
        </div>
        <div className="border-t border-white/5 pt-3">
          <ChannelToggle icon={Bell} color="amber" label="Resumo diário 07:00"
            desc="Email com pendências do dia (leads sem contato, demos em aberto, metas)"
            value={dailyDigest} onChange={setDailyDigest} />
        </div>
      </GlassCard>

      {/* Matriz event × canal */}
      <GlassCard className="p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Personalizar por evento</h3>
          <p className="text-xs text-slate-500">Override do default por evento. Canal só dispara se também estiver habilitado globalmente acima.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-white/10">
                <th className="py-2 pr-3 sticky left-0 bg-slate-900/80">Evento</th>
                {CHANNELS.map(c => (
                  <th key={c.id} className="py-2 px-2 text-center min-w-[70px]">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENTS.map(ev => {
                const active = getEventChannels(ev.id)
                return (
                  <tr key={ev.id} className="border-b border-white/5">
                    <td className="py-2 pr-3 sticky left-0 bg-slate-900/80">
                      <div className="text-xs text-slate-200 font-medium">{ev.label}</div>
                      <div className="text-[10px] text-slate-500">{ev.hint}</div>
                    </td>
                    {CHANNELS.map(c => {
                      const isOn = active.includes(c.id)
                      return (
                        <td key={c.id} className="py-2 px-2 text-center">
                          <button onClick={() => toggleEventChannel(ev.id, c.id)}
                            className={cn('w-7 h-7 rounded border-2 transition flex items-center justify-center mx-auto',
                              isOn
                                ? `bg-${c.color}-500/30 border-${c.color}-500/60 text-${c.color}-200`
                                : 'border-white/10 text-slate-600 hover:border-white/20')}>
                            {isOn ? '✓' : ''}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Test buttons */}
      <GlassCard className="p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Testar canais</h3>
          <p className="text-xs text-slate-500">Dispara uma notificação de teste só pra você. Útil para verificar push permission, SMTP, número WhatsApp.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map(c => {
            const Icon = c.icon
            const enabled = c.id === 'push' ? pushEnabled
              : c.id === 'email' ? emailEnabled
              : c.id === 'whatsapp' ? whatsappEnabled
              : true
            return (
              <button key={c.id} onClick={() => testChannel(c.id)}
                disabled={!enabled || testing === c.id}
                className={cn('flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition',
                  enabled
                    ? `bg-${c.color}-500/10 hover:bg-${c.color}-500/20 text-${c.color}-300 border-${c.color}-500/30`
                    : 'bg-white/5 text-slate-600 border-white/10 cursor-not-allowed')}>
                {testing === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <Icon className="w-3.5 h-3.5" />
                Testar {c.label}
              </button>
            )
          })}
        </div>
        {testResult && (
          <div className={cn('mt-3 p-2 rounded text-xs',
            testResult.startsWith('✅') ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
            : testResult.startsWith('⚠') ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
            : 'bg-rose-500/10 border border-rose-500/30 text-rose-300')}>
            {testResult}
          </div>
        )}
      </GlassCard>

      {err && (
        <GlassCard className="p-3 bg-rose-500/10 border-rose-500/30">
          <p className="text-xs text-rose-300 flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" />{err}</p>
        </GlassCard>
      )}

      <div className="flex justify-end">
        <button onClick={save} disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-xs font-bold disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saved ? 'Salvo!' : 'Salvar preferências'}
        </button>
      </div>

      {/* Histórico */}
      <NotifyHistoryBlock />
    </div>
  )
}

function ChannelToggle({ icon: Icon, color, label, desc, value, onChange, children }: {
  icon: any; color: string; label: string; desc?: string;
  value: boolean; onChange: (v: boolean) => void; children?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 pb-3 last:border-0 last:pb-0">
      <div className="flex items-start gap-3 flex-1">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
          `bg-${color}-500/15 border border-${color}-500/30 text-${color}-300`)}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-medium text-slate-200">{label}</p>
          {desc && <p className="text-[10px] text-slate-500">{desc}</p>}
          {children}
        </div>
      </div>
      <button onClick={() => onChange(!value)}
        className={cn('relative inline-flex w-10 h-5 rounded-full transition border shrink-0',
          value ? `bg-${color}-500/40 border-${color}-500/70` : 'bg-slate-700/50 border-slate-600/40')}>
        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition',
          value ? 'left-5' : 'left-0.5')} />
      </button>
    </div>
  )
}

function NotifyHistoryBlock() {
  const { data, isLoading } = useNotifyHistory(50)
  if (isLoading) return <div className="h-32 rounded-lg bg-white/5 animate-pulse" />
  const items = data?.items ?? []

  const STATUS_COLOR: Record<string, string> = {
    sent:           'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    failed:         'bg-rose-500/15 text-rose-300 border-rose-500/30',
    skipped_pref:   'bg-slate-500/15 text-slate-400 border-slate-500/30',
    skipped_quiet:  'bg-amber-500/15 text-amber-300 border-amber-500/30',
    deduped:        'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  }
  const STATUS_LABEL: Record<string, string> = {
    sent: 'enviado', failed: 'falha', skipped_pref: 'pref off', skipped_quiet: 'quiet hours', deduped: 'dedupe',
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <HistoryIcon className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Últimas notificações enviadas</h3>
        <span className="text-[10px] text-slate-500">({items.length})</span>
      </div>
      {!items.length ? (
        <p className="text-xs text-slate-500 italic text-center py-6">
          Sem notificações ainda. Configure preferências e dispare um teste acima.
        </p>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {items.map(it => (
            <div key={it.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02] border border-white/5 text-xs">
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold border', STATUS_COLOR[it.status] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/30')}>
                {STATUS_LABEL[it.status] ?? it.status}
              </span>
              <span className="text-[10px] uppercase text-slate-500 font-mono w-20 shrink-0">{it.channel}</span>
              <span className="text-xs text-slate-300 flex-1 truncate">{it.event}</span>
              <span className="text-[10px] text-slate-500 tabular-nums shrink-0" title={new Date(it.createdAt).toISOString()}>
                {new Date(it.createdAt).toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
                  timeZone: 'America/Sao_Paulo',
                })}
              </span>
              {it.errorMsg && (
                <span className="text-[10px] text-rose-400 truncate max-w-[200px]" title={it.errorMsg}>
                  <X className="w-3 h-3 inline" /> {it.errorMsg}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}
