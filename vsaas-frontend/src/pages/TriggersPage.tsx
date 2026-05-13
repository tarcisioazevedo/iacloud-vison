/**
 * Sprint S — Semantic Triggers UI
 *
 * Página principal:
 *   - Lista de gatilhos do tenant com toggle, score histórico e ação rápida
 *   - "Novo gatilho" abre TriggerWizardModal (3 passos: tipo → fonte → ações)
 *   - Card de detalhe inline (último hit, threshold, cooldown)
 *
 * Estratégia UX: gatilhos são produtos de venda — visual hero, copy aspiracional.
 *   Texto: "🚨 quando alguém entrar com capacete amarelo após 22h, me notifica"
 *   Imagem: arrasta um print de uma cena que importa, sistema vetoriza.
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, Plus, Search, Trash2, Loader2, AlertTriangle,
  Bell, Webhook, Video, Volume2, Flag, Image as ImageIcon, Type,
  Clock, Activity, CheckCircle2, X, Settings as SettingsIcon, Camera,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useTriggers, createTrigger, deleteTrigger, patchTrigger, testTrigger,
  formatApiError,
  type TriggerListItem, type CreateTriggerPayload, type TriggerAction,
  type TriggerSourceType,
} from '../api/client'
import { cn } from '../lib/utils'

const ACTION_META: Record<TriggerAction['type'], { icon: any; label: string; color: string }> = {
  WEBHOOK:     { icon: Webhook, label: 'Webhook',  color: 'violet' },
  NOTIFY:      { icon: Bell,    label: 'Push',     color: 'cyan' },
  RECORD:      { icon: Video,   label: 'Gravar',   color: 'emerald' },
  SIREN:       { icon: Volume2, label: 'Sirene',   color: 'amber' },
  REVIEW_FLAG: { icon: Flag,    label: 'Revisão',  color: 'rose' },
}

export function TriggersPage() {
  const { data, error, mutate, isLoading } = useTriggers()
  const [search, setSearch] = useState('')
  const [showWizard, setShowWizard] = useState(false)

  const items = (data?.items ?? []).filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-fuchsia-500/10 via-cyan-500/5 to-transparent border-fuchsia-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-fuchsia-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/20">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Gatilhos IA
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-500/30 font-mono uppercase">novo</span>
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Descreva uma cena em <strong className="text-slate-900 dark:text-white">linguagem natural</strong> ou
                envie uma <strong className="text-slate-900 dark:text-white">imagem de referência</strong>. A IA monitora
                todas as suas câmeras e dispara <strong className="text-slate-900 dark:text-white">webhooks, notificações
                e gravações</strong> quando o cenário for detectado.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-fuchsia-500 to-cyan-500 hover:from-fuchsia-600 hover:to-cyan-600 text-white text-sm font-bold shadow-lg shadow-fuchsia-500/20 transition"
          >
            <Plus className="w-4 h-4" />
            Novo gatilho
          </button>
        </div>
      </GlassCard>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar gatilhos por nome ou descrição..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
        <span className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-500 dark:text-slate-400 font-mono">
          {items.length} {items.length === 1 ? 'gatilho' : 'gatilhos'}
        </span>
      </div>

      {/* Lista */}
      {error && (
        <GlassCard className="p-6 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">Falha ao carregar gatilhos</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {isLoading && !data && (
        <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs">Carregando gatilhos...</p>
        </GlassCard>
      )}

      {data && items.length === 0 && !search && (
        <EmptyState onCreate={() => setShowWizard(true)} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map(t => (
          <TriggerCard key={t.id} trigger={t} onChange={() => mutate()} />
        ))}
      </div>

      {/* Wizard */}
      <AnimatePresence>
        {showWizard && (
          <TriggerWizardModal
            onClose={() => setShowWizard(false)}
            onCreated={() => { setShowWizard(false); mutate() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function EmptyState({ onCreate }: { onCreate: () => void }) {
  const examples = [
    { icon: '🚨', text: '"Pessoa parada na recepção depois das 22h"' },
    { icon: '🦺', text: '"Operário sem capacete na área de carga"' },
    { icon: '🚗', text: '"Veículo branco estacionando em vaga reservada"' },
    { icon: '📦', text: '"Caixa abandonada no corredor por mais de 5min"' },
  ]
  return (
    <GlassCard className="p-10 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-fuchsia-500/20 to-cyan-500/20 border border-fuchsia-500/30 flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-8 h-8 text-fuchsia-400" />
      </div>
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">Nenhum gatilho configurado</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
        Gatilhos são <strong className="text-slate-900 dark:text-white">cenários que a IA vigia 24/7</strong>. Em vez de
        criar regras técnicas, você descreve o que importa.
      </p>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-2 max-w-xl mx-auto text-left">
        {examples.map((e, i) => (
          <div key={i} className="p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-[11px] text-slate-700 dark:text-slate-300">
            <span className="text-base mr-1.5">{e.icon}</span>{e.text}
          </div>
        ))}
      </div>

      <button
        onClick={onCreate}
        className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white text-sm font-bold shadow-lg shadow-fuchsia-500/20"
      >
        <Plus className="w-4 h-4" />
        Criar primeiro gatilho
      </button>
    </GlassCard>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function TriggerCard({ trigger, onChange }: { trigger: TriggerListItem; onChange: () => void }) {
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    try { await patchTrigger(trigger.id, { enabled: !trigger.enabled }); onChange() }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!confirm(`Excluir gatilho "${trigger.name}"?`)) return
    setBusy(true)
    try { await deleteTrigger(trigger.id); onChange() }
    finally { setBusy(false) }
  }

  return (
    <GlassCard className={cn(
      'p-4 space-y-3 transition',
      trigger.enabled ? 'border-emerald-500/15' : 'opacity-70',
    )}>
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-fuchsia-500/15 border border-fuchsia-500/30 flex items-center justify-center shrink-0">
            {trigger.sourceType === 'TEXT' ? <Type className="w-3.5 h-3.5 text-fuchsia-300" /> : <ImageIcon className="w-3.5 h-3.5 text-fuchsia-300" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{trigger.name}</h3>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">{trigger.description ?? '—'}</p>
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={busy}
          className={cn(
            'relative w-9 h-5 rounded-full transition shrink-0 mt-0.5',
            trigger.enabled ? 'bg-emerald-500' : 'bg-slate-100 dark:bg-white/10',
          )}
        >
          <span className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            trigger.enabled && 'translate-x-4',
          )} />
        </button>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat icon={Activity}    label="Threshold"   value={(trigger.threshold * 100).toFixed(0) + '%'} />
        <Stat icon={Clock}       label="Cooldown"    value={trigger.cooldownSec + 's'} />
        <Stat icon={CheckCircle2} label="Hits"       value={String(trigger.hitsCount)} />
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-200 dark:border-white/5">
        <span>último hit: {trigger.lastHitAt ? new Date(trigger.lastHitAt).toLocaleString('pt-BR') : 'nunca'}</span>
        <button
          onClick={remove}
          disabled={busy}
          className="p-1 rounded hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition"
          title="Excluir gatilho"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </GlassCard>
  )
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="p-2 rounded-md bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
      <Icon className="w-3 h-3 text-slate-500 mx-auto mb-0.5" />
      <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-xs font-bold text-slate-900 dark:text-white font-mono">{value}</p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// WIZARD — 3 passos: fonte → ações → revisão
// ════════════════════════════════════════════════════════════════════════════
type Step = 1 | 2 | 3

function TriggerWizardModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<Step>(1)
  const [draft, setDraft] = useState<{
    clienteFinalId: string
    name: string
    description: string
    sourceType: TriggerSourceType
    sourceText: string
    sourceImageBase64: string
    threshold: number
    cooldownSec: number
    actions: TriggerAction[]
  }>({
    clienteFinalId: '',
    name: '',
    description: '',
    sourceType: 'TEXT',
    sourceText: '',
    sourceImageBase64: '',
    threshold: 0.78,
    cooldownSec: 120,
    actions: [{ type: 'NOTIFY' }],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const canNext = (() => {
    if (step === 1) return draft.name.length >= 2 && draft.clienteFinalId.length > 0
      && (draft.sourceType !== 'TEXT' || draft.sourceText.length >= 3)
      && (draft.sourceType !== 'IMAGE' || draft.sourceImageBase64.length > 100)
    if (step === 2) return draft.actions.length > 0
    return true
  })()

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const payload: CreateTriggerPayload = {
        clienteFinalId: draft.clienteFinalId,
        name:           draft.name,
        description:    draft.description || undefined,
        sourceType:     draft.sourceType,
        sourceText:     draft.sourceType === 'TEXT'  ? draft.sourceText : undefined,
        sourceImageBase64: draft.sourceType === 'IMAGE' ? draft.sourceImageBase64 : undefined,
        threshold:      draft.threshold,
        cooldownSec:    draft.cooldownSec,
        actions:        draft.actions,
      }
      await createTrigger(payload)
      onCreated()
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-space-900/95 backdrop-blur-md border-b border-slate-200 dark:border-white/10 p-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-fuchsia-600 dark:text-fuchsia-400" />
              Novo gatilho IA
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Passo {step} de 3</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-5 pt-4">
          <div className="flex gap-2">
            {[1, 2, 3].map(n => (
              <div key={n} className={cn(
                'flex-1 h-1 rounded-full transition',
                n <= step ? 'bg-gradient-to-r from-fuchsia-500 to-cyan-500' : 'bg-slate-200 dark:bg-white/10',
              )} />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {step === 1 && (
            <Step1
              draft={draft}
              onChange={(patch) => setDraft(d => ({ ...d, ...patch }))}
            />
          )}
          {step === 2 && (
            <Step2
              actions={draft.actions}
              onChange={(actions) => setDraft(d => ({ ...d, actions }))}
            />
          )}
          {step === 3 && (
            <Step3
              draft={draft}
              onChange={(patch) => setDraft(d => ({ ...d, ...patch }))}
            />
          )}

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white/95 dark:bg-space-900/95 backdrop-blur-md border-t border-slate-200 dark:border-white/10 p-4 flex items-center justify-between">
          <button
            onClick={() => step > 1 ? setStep((step - 1) as Step) : onClose()}
            className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-semibold"
          >
            {step === 1 ? 'Cancelar' : 'Voltar'}
          </button>

          {step < 3 ? (
            <button
              onClick={() => canNext && setStep((step + 1) as Step)}
              disabled={!canNext}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Próximo
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white text-xs font-bold disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Criar gatilho
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function Step1({ draft, onChange }: { draft: any; onChange: (patch: any) => void }) {
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5_000_000) { alert('Imagem deve ter no máximo 5MB'); return }
    const reader = new FileReader()
    reader.onload = () => onChange({ sourceImageBase64: String(reader.result) })
    reader.readAsDataURL(f)
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">1. Defina o gatilho</h3>

      <Field label="Nome">
        <input
          value={draft.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="Ex.: Intrusão noturna na recepção"
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500/50"
        />
      </Field>

      <Field label="Cliente Final (UUID)" hint="Gatilhos pertencem ao cliente final. Cole o ID do cliente onde este gatilho deve operar.">
        <input
          value={draft.clienteFinalId}
          onChange={e => onChange({ clienteFinalId: e.target.value })}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white font-mono focus:outline-none focus:border-cyan-500/50"
        />
      </Field>

      <Field label="Descrição (opcional)">
        <input
          value={draft.description}
          onChange={e => onChange({ description: e.target.value })}
          placeholder="Para que serve este gatilho?"
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500/50"
        />
      </Field>

      <Field label="Tipo de fonte">
        <div className="grid grid-cols-2 gap-2">
          <SourceTypeBtn
            active={draft.sourceType === 'TEXT'}
            icon={Type}
            label="Texto"
            desc="Descreva a cena em linguagem natural"
            onClick={() => onChange({ sourceType: 'TEXT' })}
          />
          <SourceTypeBtn
            active={draft.sourceType === 'IMAGE'}
            icon={ImageIcon}
            label="Imagem"
            desc="Upload de uma cena de referência"
            onClick={() => onChange({ sourceType: 'IMAGE' })}
          />
        </div>
      </Field>

      {draft.sourceType === 'TEXT' && (
        <Field label="Descreva o que detectar">
          <textarea
            value={draft.sourceText}
            onChange={e => onChange({ sourceText: e.target.value })}
            rows={3}
            placeholder='Ex.: "pessoa com mochila preta entrando pela porta dos fundos depois das 22h"'
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500/50 resize-none"
          />
        </Field>
      )}

      {draft.sourceType === 'IMAGE' && (
        <Field label="Imagem de referência">
          <label className="block w-full p-6 rounded-lg bg-slate-50 dark:bg-white/5 border-2 border-dashed border-slate-300 dark:border-white/10 hover:border-cyan-500/50 cursor-pointer text-center transition">
            <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
            {draft.sourceImageBase64 ? (
              <>
                <img src={draft.sourceImageBase64} alt="ref" className="mx-auto max-h-40 rounded mb-2" />
                <p className="text-[11px] text-slate-400">Clique para trocar</p>
              </>
            ) : (
              <>
                <ImageIcon className="w-8 h-8 mx-auto mb-2 text-slate-500" />
                <p className="text-xs text-slate-700 dark:text-slate-300">Clique ou arraste uma imagem</p>
                <p className="text-[10px] text-slate-500 mt-1">PNG/JPG até 5MB</p>
              </>
            )}
          </label>
        </Field>
      )}
    </div>
  )
}

function SourceTypeBtn({ active, icon: Icon, label, desc, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-3 rounded-lg border text-left transition',
        active
          ? 'bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-800 dark:text-fuchsia-100'
          : 'bg-slate-50 dark:bg-white/[0.03] border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20',
      )}
    >
      <Icon className="w-4 h-4 mb-1" />
      <p className="text-xs font-bold">{label}</p>
      <p className="text-[10px] opacity-70 mt-0.5">{desc}</p>
    </button>
  )
}

function Step2({ actions, onChange }: { actions: TriggerAction[]; onChange: (a: TriggerAction[]) => void }) {
  function toggleAction(type: TriggerAction['type']) {
    const exists = actions.some(a => a.type === type)
    if (exists) onChange(actions.filter(a => a.type !== type))
    else {
      const newAction: TriggerAction = type === 'WEBHOOK'
        ? { type: 'WEBHOOK', url: '' }
        : type === 'SIREN'
          ? { type: 'SIREN' }
          : { type } as TriggerAction
      onChange([...actions, newAction])
    }
  }
  function updateAction(idx: number, patch: any) {
    onChange(actions.map((a, i) => i === idx ? { ...a, ...patch } : a))
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">2. O que fazer quando for detectado?</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">Escolha uma ou mais ações. Você pode mudar depois.</p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {(Object.keys(ACTION_META) as Array<keyof typeof ACTION_META>).map(t => {
          const meta = ACTION_META[t]
          const Icon = meta.icon
          const enabled = actions.some(a => a.type === t)
          return (
            <button
              key={t}
              onClick={() => toggleAction(t)}
              className={cn(
                'p-3 rounded-lg border text-left transition',
                enabled
                  ? `bg-${meta.color}-500/15 border-${meta.color}-500/40 text-${meta.color}-100`
                  : 'bg-white/[0.03] border-slate-200 dark:border-white/10 text-slate-400 hover:border-white/20',
              )}
            >
              <Icon className="w-4 h-4 mb-1" />
              <p className="text-xs font-bold">{meta.label}</p>
            </button>
          )
        })}
      </div>

      {actions.map((a, i) => a.type === 'WEBHOOK' && (
        <div key={i} className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/20 space-y-2">
          <p className="text-[10px] uppercase text-violet-700 dark:text-violet-300 tracking-wider font-bold">Webhook</p>
          <input
            value={(a as any).url ?? ''}
            onChange={e => updateAction(i, { url: e.target.value })}
            placeholder="https://exemplo.com/webhook"
            className="w-full px-3 py-2 rounded-md bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-violet-500/50"
          />
          <input
            value={(a as any).secret ?? ''}
            onChange={e => updateAction(i, { secret: e.target.value })}
            placeholder="Segredo HMAC (opcional, gera assinatura X-ICV-Signature)"
            className="w-full px-3 py-2 rounded-md bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-violet-500/50"
          />
        </div>
      ))}
    </div>
  )
}

function Step3({ draft, onChange }: { draft: any; onChange: (patch: any) => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">3. Sensibilidade e revisão</h3>

      <Field label={`Threshold de match — ${(draft.threshold * 100).toFixed(0)}%`} hint="Menor = mais sensível (mais hits, mais falsos positivos). Padrão 78%.">
        <input
          type="range" min={0.5} max={0.95} step={0.01}
          value={draft.threshold}
          onChange={e => onChange({ threshold: +e.target.value })}
          className="w-full accent-fuchsia-500"
        />
      </Field>

      <Field label={`Cooldown — ${draft.cooldownSec}s`} hint="Tempo mínimo entre dois disparos consecutivos (anti-spam).">
        <input
          type="range" min={0} max={600} step={10}
          value={draft.cooldownSec}
          onChange={e => onChange({ cooldownSec: +e.target.value })}
          className="w-full accent-cyan-500"
        />
      </Field>

      <div className="p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
        <h4 className="text-[10px] uppercase text-cyan-700 dark:text-cyan-300 tracking-wider font-bold mb-2">Revisão</h4>
        <dl className="space-y-1 text-xs">
          <Row k="Nome"     v={draft.name} />
          <Row k="Cliente"  v={draft.clienteFinalId.slice(0, 8) + '…'} mono />
          <Row k="Fonte"    v={draft.sourceType} />
          {draft.sourceType === 'TEXT' && <Row k="Texto" v={draft.sourceText.slice(0, 60) + (draft.sourceText.length > 60 ? '…' : '')} />}
          <Row k="Threshold" v={(draft.threshold * 100).toFixed(0) + '%'} />
          <Row k="Cooldown"  v={draft.cooldownSec + 's'} />
          <Row k="Ações"     v={draft.actions.map((a: TriggerAction) => ACTION_META[a.type].label).join(', ')} />
        </dl>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">{label}</span>
      {children}
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </label>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className={cn('text-slate-700 dark:text-slate-200 truncate', mono && 'font-mono text-[11px]')}>{v}</dd>
    </div>
  )
}
