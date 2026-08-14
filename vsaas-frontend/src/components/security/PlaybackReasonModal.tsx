/**
 * <PlaybackReasonModal> — modal de justificativa pra abrir gravação.
 *
 * Aparece quando o tenant tem TenantPolicy.requireReasonForPlayback=true e o
 * usuário tenta abrir uma gravação. Bloqueia o fluxo até informar motivo
 * (dropdown) + descrição (textarea). Audit log grava ambos pra cadeia de
 * custódia LGPD.
 *
 * Uso:
 *   const [showReason, setShowReason] = useState<{ camera, range } | null>(null)
 *   // No catch do issuePlaybackToken:
 *   if (err.response?.data?.error === 'REASON_REQUIRED') {
 *     setShowReason({ camera, range })
 *   }
 *   <PlaybackReasonModal
 *     open={!!showReason}
 *     onClose={() => setShowReason(null)}
 *     onConfirm={(reason, description) => { ... reissue token with reason }}
 *   />
 */
import { useState } from 'react'
import { Shield, AlertTriangle, X } from 'lucide-react'

const REASON_PRESETS = [
  { value: 'investigacao',  label: '🔍 Investigação de incidente' },
  { value: 'operacao',      label: '🛡️ Operação de segurança em andamento' },
  { value: 'auditoria',     label: '📋 Auditoria periódica' },
  { value: 'lgpd_request',  label: '⚖️ Solicitação LGPD (titular pediu acesso)' },
  { value: 'manutencao',    label: '🔧 Verificação técnica / manutenção' },
  { value: 'treinamento',   label: '🎓 Treinamento de operador' },
  { value: 'outro',         label: '✏️ Outro motivo (descreva)' },
]

interface Props {
  open:        boolean
  cameraName?: string
  rangeLabel?: string  // ex: "23/05 14:00 → 14:30"
  onClose:     () => void
  onConfirm:   (reason: string, description: string) => Promise<void> | void
}

export function PlaybackReasonModal({ open, cameraName, rangeLabel, onClose, onConfirm }: Props) {
  const [preset, setPreset]            = useState<string>('investigacao')
  const [description, setDescription]  = useState('')
  const [ackChecked, setAckChecked]    = useState(false)
  const [submitting, setSubmitting]    = useState(false)
  const [error, setError]              = useState<string | null>(null)

  if (!open) return null

  const isOther = preset === 'outro'
  const minDescLen = isOther ? 10 : 0
  const descLen = description.trim().length
  const valid = ackChecked && descLen >= minDescLen

  async function submit() {
    if (!valid) return
    setSubmitting(true); setError(null)
    try {
      const presetLabel = REASON_PRESETS.find(p => p.value === preset)?.label ?? preset
      await onConfirm(presetLabel.replace(/^[^\s]+ /, ''), description.trim())
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Falha ao registrar justificativa')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border-2 border-amber-500/30 rounded-2xl shadow-2xl max-w-lg w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
            <Shield className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Justifique o acesso à gravação</h2>
            <p className="text-xs text-slate-400">LGPD · cadeia de custódia exigida pelo tenant</p>
          </div>
        </div>

        {/* Contexto */}
        {(cameraName || rangeLabel) && (
          <div className="mb-4 p-3 rounded-lg bg-slate-800/50 border border-white/10 text-xs">
            {cameraName && <p className="text-slate-300"><strong>Câmera:</strong> {cameraName}</p>}
            {rangeLabel && <p className="text-slate-300 mt-0.5"><strong>Trecho:</strong> {rangeLabel}</p>}
          </div>
        )}

        {/* Aviso */}
        <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200 leading-relaxed">
            <strong>Este acesso fica registrado.</strong> Seu nome, IP, horário e a justificativa
            informada abaixo ficam disponíveis ao titular dos dados (LGPD Art. 9).
          </p>
        </div>

        {/* Form */}
        <div className="space-y-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-bold">
              Motivo
            </span>
            <select
              value={preset}
              onChange={e => setPreset(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-500"
            >
              {REASON_PRESETS.map(p => (
                <option key={p.value} value={p.value} className="bg-slate-900">{p.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-bold">
              Descrição {isOther ? '(obrigatória)' : '(opcional)'}
            </span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={isOther ? 'Descreva em detalhes o motivo do acesso…' : 'Adicione contexto se quiser (ex: número do BO, ticket interno…)'}
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
            />
            <p className="text-[10px] text-slate-500 mt-1 text-right">{descLen}/500</p>
          </label>

          <label className="flex items-start gap-2 p-3 rounded-lg bg-white/5 border border-white/10 cursor-pointer">
            <input
              type="checkbox"
              checked={ackChecked}
              onChange={e => setAckChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4"
            />
            <span className="text-xs text-slate-300">
              Confirmo que o acesso tem finalidade legítima declarada acima e que entendo que
              esta informação fica auditada e disponível ao titular dos dados.
            </span>
          </label>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-semibold disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={!valid || submitting}
              className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Registrando…' : 'Justificar e abrir gravação'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
