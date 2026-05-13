/**
 * ConfigDefaultsTab — SalesConfig singleton: SLA demo, round-robin, push, lost reasons.
 */
import { useEffect, useState } from 'react'
import { Save, Loader2, Plus, X } from 'lucide-react'
import { GlassCard } from '../../cards/GlassCard'
import { useSalesConfig, updateSalesConfig, formatApiError } from '../../../api/client'
import { cn } from '../../../lib/utils'

export function ConfigDefaultsTab() {
  const { data, mutate, isLoading } = useSalesConfig()
  const [sla, setSla] = useState(1)
  const [rr, setRr] = useState(true)
  const [push, setPush] = useState(true)
  const [reasons, setReasons] = useState<string[]>([])
  const [newReason, setNewReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) {
      setSla(data.slaDemoBusinessDays ?? 1)
      setRr(data.roundRobinEnabled ?? true)
      setPush(data.pushNotifications ?? true)
      setReasons(data.customLostReasons ?? [])
    }
  }, [data])

  async function save() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      await updateSalesConfig({
        slaDemoBusinessDays: sla,
        roundRobinEnabled: rr,
        pushNotifications: push,
        customLostReasons: reasons,
      })
      await mutate()
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  if (isLoading) return <div className="h-64 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />

  return (
    <div className="space-y-4">
      <GlassCard className="p-4 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Configurações gerais</h3>

        <Row label="SLA aprovação de demos (dias úteis)"
             help="Tempo máximo para aprovar/rejeitar uma demo enviada antes de soar alerta.">
          <input type="number" min={0} max={30} value={sla} onChange={e => setSla(parseInt(e.target.value || '0', 10))}
            className="px-2 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-white w-24" />
        </Row>

        <Row label="Round-robin automático" help="Distribui leads novos automaticamente entre SDR/HUNTER ativos.">
          <Toggle value={rr} onChange={setRr} />
        </Row>

        <Row label="Notificações push" help="Habilita push para alertas críticos de pipeline.">
          <Toggle value={push} onChange={setPush} />
        </Row>

        <div>
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">Motivos personalizados de perda</div>
          <p className="text-[10px] text-slate-500 mb-2">Adicione razões custom além das padrão (preço, prazo, sem fit, sem orçamento).</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {reasons.map((r, i) => (
              <span key={i} className="px-2 py-1 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[11px] flex items-center gap-1">
                {r}
                <button onClick={() => setReasons(rs => rs.filter((_, j) => j !== i))} className="hover:text-rose-200"><X className="w-3 h-3" /></button>
              </span>
            ))}
            {!reasons.length && <span className="text-[11px] text-slate-500">Nenhum motivo customizado.</span>}
          </div>
          <div className="flex gap-1.5">
            <input value={newReason} onChange={e => setNewReason(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newReason.trim()) { setReasons(rs => [...rs, newReason.trim()]); setNewReason('') } }}
              placeholder="Ex: Decisor mudou"
              className="flex-1 px-2 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-white" />
            <button onClick={() => { if (newReason.trim()) { setReasons(rs => [...rs, newReason.trim()]); setNewReason('') } }}
              className="px-3 py-1.5 rounded text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
        </div>

        {err && <div className="p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{err}</div>}

        <div className="flex justify-end">
          <button onClick={save} disabled={busy}
            className="px-3 py-2 rounded text-xs font-medium bg-violet-500 hover:bg-violet-400 text-white disabled:opacity-50 flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? 'Salvo!' : 'Salvar configurações'}
          </button>
        </div>
      </GlassCard>
    </div>
  )
}

function Row({ label, help, children }: { label: string; help?: string; children: any }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-white/5 pb-3 last:border-0">
      <div>
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</div>
        {help && <div className="text-[10px] text-slate-500">{help}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)}
      className={cn('relative inline-flex w-10 h-5 rounded-full transition border',
        value ? 'bg-violet-500/30 border-violet-500/60' : 'bg-slate-700/50 border-slate-600/40')}>
      <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition',
        value ? 'left-5' : 'left-0.5')} />
    </button>
  )
}
