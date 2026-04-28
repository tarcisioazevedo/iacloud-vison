/**
 * Sprint U.2.3 — ReviewRulesPage
 *
 * CRUD de regras de revisão automática (CameraAlertRule). Cada regra:
 *   - É ligada a uma câmera específica (tenant-isolada via JWT no backend).
 *   - Tem um trigger type (11 tipos: ZONE_OCCUPANCY, LOITERING, FACE_MATCH...).
 *   - Tem severidade (DETECTION/ALERT/CRITICAL) e canais de notificação
 *     opcionais (email, webhook, push, MQTT topic).
 *   - Tem `conditions` JSON livre — UI atual aceita JSON cru, sem editor visual
 *     por trigger type (escopo de Sprint futuro).
 *   - Tem `cooldownSec` para evitar spam.
 *
 * Decisão de UX: integrado no menu como página própria (`/review/rules`) ao
 * invés de aba dentro de ReviewPage (que já tem 9 tabs e 815 linhas — poluiria).
 * Botão "Regras" na ReviewPage leva para cá.
 *
 * Fora de escopo (próximas iterações):
 *   - Editor visual por trigger (selector de zonas no canvas, blacklist UI...).
 *   - Schedule visual (calendário semanal).
 *   - Teste em vivo de regra antes de salvar.
 */
import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Plus, Search, Loader2, AlertTriangle,
  X, Trash2, Bell, Camera as CameraIcon, ToggleLeft, ToggleRight,
  ArrowLeft, Mail, Globe, Radio, Zap,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useReviewRules, createReviewRule, updateReviewRule, deleteReviewRule,
  useCameras, formatApiError,
  type ReviewRule, type ReviewTriggerType, type ReviewSeverity,
  type CreateReviewRulePayload,
} from '../api/client'
import { cn } from '../lib/utils'

const TRIGGER_TYPES: { value: ReviewTriggerType; label: string; hint: string }[] = [
  { value: 'ZONE_OCCUPANCY', label: 'Ocupação de Zona',  hint: 'N pessoas em zona X por T segundos' },
  { value: 'LOITERING',      label: 'Permanência',       hint: 'Pessoa parada em área por > T segundos' },
  { value: 'TRIPWIRE',       label: 'Linha Virtual',     hint: 'Cruzamento de linha em direção específica' },
  { value: 'PPE_VIOLATION',  label: 'Falta de EPI',      hint: 'Pessoa sem capacete/colete/máscara' },
  { value: 'FACE_MATCH',     label: 'Face Reconhecida',  hint: 'Match com face cadastrada' },
  { value: 'FACE_UNKNOWN',   label: 'Face Desconhecida', hint: 'Face sem match no cadastro' },
  { value: 'LPR_BLACKLIST',  label: 'Placa Bloqueada',   hint: 'Placa em lista negra' },
  { value: 'AUDIO_DETECT',   label: 'Áudio',             hint: 'Som específico (tiro, grito, vidro)' },
  { value: 'MOTION_AREA',    label: 'Movimento em Área', hint: 'Movimento dentro de polígono' },
  { value: 'OBJECT_CLASS',   label: 'Classe de Objeto',  hint: 'Detecção de classe específica (faca, mochila)' },
  { value: 'QUEUE_OVERFLOW', label: 'Fila Excessiva',    hint: 'Fila > N pessoas por > T segundos' },
]

const SEVERITY_BADGES: Record<ReviewSeverity, string> = {
  DETECTION: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  ALERT:     'bg-amber-500/15 text-amber-300 border-amber-500/30',
  CRITICAL:  'bg-rose-500/15 text-rose-300 border-rose-500/30',
}

export function ReviewRulesPage() {
  const { data, error, isLoading, mutate } = useReviewRules()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<ReviewRule | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReviewRule | null>(null)

  const rules = data?.items ?? []

  const filtered = useMemo(() => {
    if (!search) return rules
    const q = search.toLowerCase()
    return rules.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.triggerType.toLowerCase().includes(q) ||
      (r.camera?.name ?? '').toLowerCase().includes(q),
    )
  }, [rules, search])

  async function handleToggle(rule: ReviewRule) {
    try {
      await updateReviewRule(rule.id, { enabled: !rule.enabled })
      mutate()
    } catch (err) {
      alert(formatApiError(err))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteReviewRule(deleteTarget.id)
      setDeleteTarget(null)
      mutate()
    } catch (err) {
      alert(formatApiError(err))
    }
  }

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-amber-500/10 via-rose-500/5 to-transparent border-amber-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Regras de Revisão
                <Link to="/review"
                  className="ml-2 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-cyan-300 font-mono">
                  <ArrowLeft className="w-3 h-3" />
                  voltar para Eventos
                </Link>
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Regras automáticas que disparam <strong className="text-slate-900 dark:text-white">alertas</strong> ou
                detecções quando câmeras detectam padrões pré-definidos. Use cooldown
                pra evitar spam e severidade pra priorizar a fila.
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-white text-sm font-bold shadow-lg shadow-amber-500/20 transition"
          >
            <Plus className="w-4 h-4" />
            Nova regra
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
            placeholder="Buscar por nome, câmera ou trigger..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
          />
        </div>
        <span className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400 font-mono">
          {filtered.length} {filtered.length === 1 ? 'regra' : 'regras'}
        </span>
      </div>

      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">Falha ao listar regras</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {isLoading && !data && (
        <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs">Carregando regras...</p>
        </GlassCard>
      )}

      {data && filtered.length === 0 && !search && (
        <GlassCard className="p-12 text-center">
          <ShieldCheck className="w-12 h-12 mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma regra criada ainda.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-bold transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Criar a primeira
          </button>
        </GlassCard>
      )}

      {filtered.length > 0 && (
        <div className="grid gap-2">
          {filtered.map(rule => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={() => handleToggle(rule)}
              onEdit={() => setEditing(rule)}
              onDelete={() => setDeleteTarget(rule)}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showCreate && (
          <RuleFormModal
            mode="create"
            onClose={() => setShowCreate(false)}
            onSuccess={() => { mutate(); setShowCreate(false) }}
          />
        )}
        {editing && (
          <RuleFormModal
            mode="edit"
            initial={editing}
            onClose={() => setEditing(null)}
            onSuccess={() => { mutate(); setEditing(null) }}
          />
        )}
        {deleteTarget && (
          <DeleteConfirmModal
            rule={deleteTarget}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={handleDelete}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function RuleCard({ rule, onToggle, onEdit, onDelete }: {
  rule: ReviewRule
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const triggerLabel = TRIGGER_TYPES.find(t => t.value === rule.triggerType)?.label ?? rule.triggerType
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <button onClick={onToggle} title={rule.enabled ? 'Desativar' : 'Ativar'} className="mt-0.5 shrink-0">
            {rule.enabled ? (
              <ToggleRight className="w-9 h-9 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-9 h-9 text-slate-600" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{rule.name}</h3>
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] border font-mono uppercase', SEVERITY_BADGES[rule.severity])}>
                {rule.severity}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/15 text-violet-300 border border-violet-500/30 font-mono">
                {triggerLabel}
              </span>
            </div>
            {rule.description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{rule.description}</p>
            )}
            <div className="mt-2 flex items-center gap-3 flex-wrap text-[10px] text-slate-500 font-mono">
              <span className="inline-flex items-center gap-1">
                <CameraIcon className="w-3 h-3" />
                {rule.camera?.name ?? rule.cameraId.slice(0, 8)}
              </span>
              {rule.cooldownSec != null && (
                <span className="inline-flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  cooldown {rule.cooldownSec}s
                </span>
              )}
              {rule.notifyEmail && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> email</span>}
              {rule.notifyWebhookUrl && <span className="inline-flex items-center gap-1"><Globe className="w-3 h-3" /> webhook</span>}
              {rule.notifyPushEnabled && <span className="inline-flex items-center gap-1"><Bell className="w-3 h-3" /> push</span>}
              {rule.notifyMqttTopic && <span className="inline-flex items-center gap-1"><Radio className="w-3 h-3" /> mqtt</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onEdit}
            className="px-3 py-1.5 rounded-lg text-[11px] text-cyan-300 hover:bg-cyan-500/10 border border-cyan-500/20 transition">
            Editar
          </button>
          <button onClick={onDelete} title="Remover"
            className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </GlassCard>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function RuleFormModal({ mode, initial, onClose, onSuccess }: {
  mode: 'create' | 'edit'
  initial?: ReviewRule
  onClose: () => void
  onSuccess: () => void
}) {
  const { data: camerasData, isLoading: camerasLoading } = useCameras()
  const cameras: { id: string; name: string }[] = camerasData?.cameras ?? []

  const [form, setForm] = useState<CreateReviewRulePayload>({
    cameraId:    initial?.cameraId ?? '',
    name:        initial?.name ?? '',
    description: initial?.description ?? '',
    enabled:     initial?.enabled ?? true,
    triggerType: initial?.triggerType ?? 'MOTION_AREA',
    conditions:  initial?.conditionsJson ?? {},
    cooldownSec: initial?.cooldownSec ?? 60,
    severity:    initial?.severity ?? 'ALERT',
    notifyEmail: initial?.notifyEmail ?? '',
    notifyWebhookUrl: initial?.notifyWebhookUrl ?? '',
    notifyPushEnabled: initial?.notifyPushEnabled ?? false,
    notifyMqttTopic: initial?.notifyMqttTopic ?? '',
  })
  const [conditionsJson, setConditionsJson] = useState(
    JSON.stringify(initial?.conditionsJson ?? {}, null, 2),
  )
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)

  // Pré-seleciona primeira câmera no create se nenhuma escolhida
  useEffect(() => {
    if (mode === 'create' && !form.cameraId && cameras.length > 0) {
      setForm(f => ({ ...f, cameraId: cameras[0].id }))
    }
  }, [cameras, mode, form.cameraId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitErr(null)

    let parsedConditions: Record<string, any>
    try {
      parsedConditions = conditionsJson.trim() ? JSON.parse(conditionsJson) : {}
    } catch {
      setSubmitErr('Condições devem ser JSON válido')
      return
    }
    if (form.name.trim().length < 1) { setSubmitErr('Nome obrigatório'); return }
    if (mode === 'create' && !form.cameraId) { setSubmitErr('Selecione uma câmera'); return }

    setSubmitting(true)
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        description: form.description?.toString().trim() || null,
        conditions: parsedConditions,
        notifyEmail: form.notifyEmail?.toString().trim() || null,
        notifyWebhookUrl: form.notifyWebhookUrl?.toString().trim() || null,
        notifyMqttTopic: form.notifyMqttTopic?.toString().trim() || null,
      }
      if (mode === 'create') {
        await createReviewRule(payload)
      } else if (initial) {
        const { cameraId: _drop, ...editable } = payload
        void _drop
        await updateReviewRule(initial.id, editable)
      }
      onSuccess()
    } catch (err) {
      setSubmitErr(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-2xl bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        <header className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {mode === 'create' ? 'Nova regra' : 'Editar regra'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Câmera (não editável em modo edit) */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Câmera *
            </label>
            {mode === 'edit' ? (
              <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-400 font-mono">
                {initial?.camera?.name ?? form.cameraId}
                <span className="ml-2 text-[10px] text-slate-600">(não editável)</span>
              </div>
            ) : camerasLoading ? (
              <div className="h-10 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
              </div>
            ) : cameras.length === 0 ? (
              <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
                Nenhuma câmera disponível. Cadastre uma câmera antes de criar regras.
              </div>
            ) : (
              <select
                value={form.cameraId}
                onChange={e => setForm(f => ({ ...f, cameraId: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-amber-500/50"
              >
                {cameras.map(c => (
                  <option key={c.id} value={c.id} className="bg-space-900">{c.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Nome *" value={form.name}
              onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Ex.: Loiter na entrada" />
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Trigger *</label>
              <select
                value={form.triggerType}
                onChange={e => setForm(f => ({ ...f, triggerType: e.target.value as ReviewTriggerType }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-amber-500/50"
              >
                {TRIGGER_TYPES.map(t => (
                  <option key={t.value} value={t.value} className="bg-space-900">{t.label}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-slate-500">
                {TRIGGER_TYPES.find(t => t.value === form.triggerType)?.hint}
              </p>
            </div>
          </div>

          <Input label="Descrição" value={form.description?.toString() ?? ''}
            onChange={v => setForm(f => ({ ...f, description: v }))}
            placeholder="O que esta regra faz?" />

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Condições (JSON)
            </label>
            <textarea
              value={conditionsJson}
              onChange={e => setConditionsJson(e.target.value)}
              rows={5}
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-amber-500/50"
              placeholder='{ "minPeople": 3, "durationSec": 30 }'
            />
            <p className="mt-1 text-[10px] text-slate-500">
              Ex.: ZONE_OCCUPANCY → {'{"zone":"entrada","min":3,"durationSec":30}'}.
              Editor visual por trigger será adicionado em sprint futuro.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Severidade</label>
              <select
                value={form.severity}
                onChange={e => setForm(f => ({ ...f, severity: e.target.value as ReviewSeverity }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-amber-500/50"
              >
                <option value="DETECTION" className="bg-space-900">Detection</option>
                <option value="ALERT" className="bg-space-900">Alert</option>
                <option value="CRITICAL" className="bg-space-900">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Cooldown (s)</label>
              <input
                type="number" min={0} max={3600}
                value={form.cooldownSec ?? 60}
                onChange={e => setForm(f => ({ ...f, cooldownSec: parseInt(e.target.value || '0', 10) }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white font-mono focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-300 cursor-pointer w-full">
                <input
                  type="checkbox"
                  checked={form.enabled ?? true}
                  onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                  className="accent-emerald-500"
                />
                Ativada
              </label>
            </div>
          </div>

          <div className="pt-3 border-t border-white/5">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
              Notificações
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label="Email" value={form.notifyEmail?.toString() ?? ''}
                onChange={v => setForm(f => ({ ...f, notifyEmail: v }))} placeholder="ops@empresa.com" />
              <Input label="Webhook URL" value={form.notifyWebhookUrl?.toString() ?? ''}
                onChange={v => setForm(f => ({ ...f, notifyWebhookUrl: v }))} placeholder="https://..." />
              <Input label="MQTT Topic" value={form.notifyMqttTopic?.toString() ?? ''}
                onChange={v => setForm(f => ({ ...f, notifyMqttTopic: v }))} placeholder="alerts/zone-occupancy" />
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-300 cursor-pointer mt-5">
                <input
                  type="checkbox"
                  checked={form.notifyPushEnabled ?? false}
                  onChange={e => setForm(f => ({ ...f, notifyPushEnabled: e.target.checked }))}
                  className="accent-cyan-500"
                />
                Push notification
              </label>
            </div>
          </div>

          {submitErr && (
            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{submitErr}</span>
            </div>
          )}
        </div>

        <footer className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 transition">
            Cancelar
          </button>
          <button type="submit" disabled={submitting}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2 transition">
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === 'create' ? 'Criar regra' : 'Salvar alterações'}
          </button>
        </footer>
      </motion.form>
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function DeleteConfirmModal({ rule, onCancel, onConfirm }: {
  rule: ReviewRule
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-space-900 border border-rose-500/30 rounded-2xl shadow-2xl overflow-hidden"
      >
        <header className="px-5 py-4 border-b border-white/10 flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-rose-400" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Remover regra</h3>
        </header>
        <div className="p-5 space-y-3 text-sm text-slate-300">
          <p>
            Apagar a regra <strong className="text-slate-900 dark:text-white">"{rule.name}"</strong>?
            Esta ação é <strong className="text-rose-300">irreversível</strong>.
          </p>
          <p className="text-xs text-slate-500 font-mono">id: {rule.id}</p>
        </div>
        <footer className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2">
          <button onClick={onCancel}
            className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 transition">
            Cancelar
          </button>
          <button onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold flex items-center gap-2 transition">
            <Trash2 className="w-3.5 h-3.5" />
            Remover
          </button>
        </footer>
      </motion.div>
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function Input({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
        {label}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
      />
    </div>
  )
}

