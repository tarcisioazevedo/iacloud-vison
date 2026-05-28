/**
 * EvidenceVaultCard — gerencia salvaguardas de gravação por câmera.
 *
 * Cliente final / integrador marca um intervalo (start..end) como "evidência".
 * Backend (tickRetention + motion-gate-cleaner) NUNCA apaga segments cuja janela
 * intersecte uma salvaguarda em vigor. Usado para:
 *   - Incidente importante (guardar além da retenção normal)
 *   - Pedido policial/judicial (cadeia de custódia)
 *   - Bloqueio LGPD art. 16
 *
 * UX:
 *   - Lista as ativas (expandable)
 *   - Botão "Salvaguardar agora" abre modal com 3 campos:
 *     · Intervalo (start/end, default últimos 60min)
 *     · Motivo (obrigatório, min 10 chars — força contexto LGPD)
 *     · Expiração (opcional: 30d / 90d / 1 ano / 5 anos / permanente)
 */
import { useState } from 'react'
import { Shield, ShieldOff, Plus, Loader2, Clock, User as UserIcon, Trash2 } from 'lucide-react'
import {
  useEvidenceVault, createEvidenceVault, deleteEvidenceVault, formatApiError,
  type EvidenceVaultEntry,
} from '../../api/client'
import { useUiToast } from '../Toast'
import { confirm } from '../ConfirmDialog'

interface Props {
  cameraId: string
}

const EXPIRATION_PRESETS = [
  { key: '30d',  label: '30 dias',  days: 30 },
  { key: '90d',  label: '90 dias',  days: 90 },
  { key: '1y',   label: '1 ano',    days: 365 },
  { key: '5y',   label: '5 anos',   days: 365 * 5 },
  { key: 'inf',  label: 'Permanente', days: null },
] as const

export function EvidenceVaultCard({ cameraId }: Props) {
  const toast = useUiToast()
  const { data, mutate, isLoading } = useEvidenceVault(cameraId)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Form state
  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().slice(0, 16)  // "YYYY-MM-DDTHH:MM"
  const [startAt, setStartAt] = useState(fmt(oneHourAgo))
  const [endAt, setEndAt]     = useState(fmt(now))
  const [reason, setReason]   = useState('')
  const [expirationKey, setExpirationKey] = useState<typeof EXPIRATION_PRESETS[number]['key']>('90d')

  const items = data?.items ?? []

  async function handleCreate() {
    if (reason.trim().length < 10) {
      toast.error('Motivo precisa ter ao menos 10 caracteres (auditoria LGPD).')
      return
    }
    const expDays = EXPIRATION_PRESETS.find(p => p.key === expirationKey)?.days ?? null
    const expiresAt = expDays
      ? new Date(Date.now() + expDays * 24 * 3600 * 1000).toISOString()
      : null
    setSubmitting(true)
    try {
      await createEvidenceVault({
        cameraId,
        startAt: new Date(startAt).toISOString(),
        endAt:   new Date(endAt).toISOString(),
        reason:  reason.trim(),
        expiresAt,
      })
      await mutate()
      setModalOpen(false)
      setReason('')
      toast.success('Salvaguarda criada — gravação protegida do auto-cleanup.')
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(item: EvidenceVaultEntry) {
    const ok = await confirm({
      title:        'Remover esta salvaguarda?',
      description:
        'A gravação volta a ser sujeita à política de retenção normal. ' +
        `Trechos já armazenados continuam disponíveis até o prazo natural ` +
        `expirar.\n\nMotivo registrado: "${item.reason}"`,
      confirmLabel: 'Sim, remover proteção',
      destructive:  true,
    })
    if (!ok) return
    setDeleting(item.id)
    try {
      await deleteEvidenceVault(item.id)
      await mutate()
      toast.success('Salvaguarda removida.')
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="p-4 space-y-3 border border-purple-500/30 rounded-2xl bg-white/50 dark:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-purple-700 dark:text-purple-400 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Cofre de Evidências
          {items.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-700 dark:text-purple-300 font-mono">
              {items.length} ativa{items.length === 1 ? '' : 's'}
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-purple-500 hover:bg-purple-600 text-white transition"
        >
          <Plus className="w-3 h-3" />
          Salvaguardar
        </button>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        Marque trechos importantes como evidência. Eles ficam imunes à política
        de retenção até a data de expiração ou até você remover manualmente.
        Útil para incidentes, pedidos policiais ou bloqueio LGPD.
      </p>

      {isLoading ? (
        <div className="text-[11px] text-slate-500 italic">Carregando…</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-slate-500 italic flex items-center gap-1.5 py-2">
          <ShieldOff className="w-3.5 h-3.5" />
          Nenhuma gravação está salvaguardada nesta câmera.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {items.map(it => {
            const start = new Date(it.startAt)
            const end   = new Date(it.endAt)
            const durMin = Math.round((end.getTime() - start.getTime()) / 60_000)
            const expires = it.expiresAt ? new Date(it.expiresAt) : null
            return (
              <div key={it.id} className="flex items-start gap-2 p-2 rounded-lg border border-slate-200 dark:border-white/10 text-[11px]">
                <Shield className="w-3.5 h-3.5 text-purple-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {it.reason}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500 dark:text-slate-400 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {start.toLocaleString('pt-BR')} → {end.toLocaleString('pt-BR')} ({durMin} min)
                    </span>
                    {expires ? (
                      <span className="flex items-center gap-1">
                        Expira em {expires.toLocaleDateString('pt-BR')}
                      </span>
                    ) : (
                      <span className="px-1 rounded bg-purple-500/10 text-purple-700 dark:text-purple-300 font-mono">
                        permanente
                      </span>
                    )}
                    {it.createdBy && (
                      <span className="flex items-center gap-1">
                        <UserIcon className="w-2.5 h-2.5" />
                        {it.createdBy.name}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(it)}
                  disabled={deleting === it.id}
                  className="p-1.5 rounded hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 transition disabled:opacity-40"
                  title="Remover salvaguarda"
                >
                  {deleting === it.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modal de criação ─────────────────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false) }}
        >
          <div className="w-full max-w-md p-5 rounded-2xl bg-white dark:bg-slate-900 border border-purple-500/30 space-y-3 shadow-xl">
            <h3 className="text-sm font-bold text-purple-700 dark:text-purple-400 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Nova salvaguarda
            </h3>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="space-y-1">
                <span className="block text-slate-600 dark:text-slate-400 font-semibold">Início</span>
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={e => setStartAt(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-slate-600 dark:text-slate-400 font-semibold">Fim</span>
                <input
                  type="datetime-local"
                  value={endAt}
                  onChange={e => setEndAt(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white"
                />
              </label>
            </div>
            <label className="block text-[11px] space-y-1">
              <span className="text-slate-600 dark:text-slate-400 font-semibold">
                Motivo <span className="text-rose-500">*</span>
                <span className="text-slate-400 font-normal ml-1">(mín 10 chars, registrado em auditoria)</span>
              </span>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder="Ex: incidente furto em 24/05 às 14:30, pedido de polícia BO 12345"
                className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white"
              />
              <span className="text-[9px] text-slate-400">{reason.length}/10 mín</span>
            </label>
            <div className="space-y-1">
              <span className="block text-[11px] text-slate-600 dark:text-slate-400 font-semibold">Expira em</span>
              <div className="flex flex-wrap gap-1">
                {EXPIRATION_PRESETS.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setExpirationKey(p.key)}
                    className={
                      'px-2 py-1 rounded text-[10px] font-semibold transition ' +
                      (expirationKey === p.key
                        ? 'bg-purple-500 text-white'
                        : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10')
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={submitting}
                className="px-3 py-1.5 rounded text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={submitting || reason.trim().length < 10}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-purple-500 hover:bg-purple-600 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                Salvaguardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
