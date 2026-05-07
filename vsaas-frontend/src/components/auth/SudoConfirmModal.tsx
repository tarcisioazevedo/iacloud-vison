/**
 * SudoConfirmModal — Step-up auth pra integrador acessar dados sensíveis
 * do cliente (live, gravações, faces, placas).
 *
 * UX: igual ao ImpersonateModal — motivo obrigatório, duração, checkbox LGPD.
 * Diferença: aqui exige reautenticação por SENHA (não só motivo). Reason e
 * acesso ficam em audit log com `ELEVATED_ACCESS_GRANT`.
 */
import { useState } from 'react'
import { X, AlertTriangle, ShieldCheck, Loader2, KeyRound, Clock, Lock } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { requestSudo } from '../../lib/sudo'
import { formatApiError } from '../../api/client'
import { cn } from '../../lib/utils'

export interface SudoConfirmModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  /** Texto que descreve o que o usuário tá tentando acessar (ex: "Live · cam-porta-01"). */
  targetLabel?: string
}

const DURATIONS: { sec: number; label: string; warn?: boolean }[] = [
  { sec: 900,  label: '15 min' },
  { sec: 1800, label: '30 min' },
  { sec: 3600, label: '1 hora', warn: true },
]

export function SudoConfirmModal({ open, onClose, onSuccess, targetLabel }: SudoConfirmModalProps) {
  const [password, setPassword] = useState('')
  const [reason, setReason]     = useState('')
  const [duration, setDuration] = useState(900)
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reasonValid = reason.trim().length >= 10
  const passwordValid = password.length >= 1
  const canSubmit = passwordValid && reasonValid && acknowledged && !submitting

  if (!open) return null

  function reset() {
    setPassword('')
    setReason('')
    setDuration(900)
    setAcknowledged(false)
    setError(null)
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await requestSudo({
        password,
        reason:          reason.trim(),
        durationSeconds: duration,
        acknowledged:    true,
      })
      reset()
      onSuccess?.()
      onClose()
    } catch (e: unknown) {
      setError(formatApiError(e))
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => { if (!submitting) onClose() }}
    >
      <div className="w-full max-w-2xl" onClick={e => e.stopPropagation()}>
        <GlassCard className="p-6 border-amber-500/40 bg-gradient-to-br from-amber-500/5 to-rose-500/5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center text-2xl shrink-0 shadow-lg shadow-amber-500/30">
                <Lock className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Reautenticação para acesso sensível</h2>
                <p className="text-sm text-slate-400 mt-1">
                  {targetLabel ? <>Acesso a <strong className="text-white">{targetLabel}</strong>. </> : null}
                  Esta ação fica registrada (motivo · duração · IP) e é visível ao cliente final no painel LGPD dele.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={submitting}
              className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Senha */}
          <div className="mb-4">
            <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2 block flex items-center gap-1.5">
              <KeyRound className="w-3 h-3" /> Sua senha
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          {/* Motivo */}
          <div className="mb-4">
            <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2 block">
              Motivo (obrigatório · mínimo 10 caracteres)
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Ex: Atendimento ao cliente — ticket #1234 — investigar evento detectado às 14:30"
              rows={2}
              className={cn(
                'w-full px-3 py-2 rounded-lg bg-slate-800 border text-sm text-white placeholder:text-slate-500 focus:outline-none transition',
                reason.length === 0 ? 'border-slate-700' :
                  reasonValid ? 'border-emerald-500/50 focus:border-emerald-500' : 'border-rose-500/50 focus:border-rose-500',
              )}
            />
            <div className="flex justify-between mt-1 text-[10px]">
              <span className={reasonValid ? 'text-emerald-400' : 'text-slate-500'}>
                {reasonValid ? '✓ válido' : `${Math.max(0, 10 - reason.length)} caracteres restantes`}
              </span>
              <span className="text-slate-500">{reason.length}/500</span>
            </div>
          </div>

          {/* Duração */}
          <div className="mb-5">
            <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2 block flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> Duração da elevação
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map(d => {
                const selected = duration === d.sec
                return (
                  <button
                    key={d.sec}
                    type="button"
                    onClick={() => setDuration(d.sec)}
                    className={cn(
                      'py-2.5 rounded-lg border-2 text-sm font-bold transition',
                      selected
                        ? d.warn
                          ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                          : 'border-amber-500 bg-amber-500/10 text-white'
                        : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-amber-500/50',
                    )}
                  >
                    {d.label}
                    {d.warn && <span className="block text-[10px] text-amber-400 mt-0.5">cuidado</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* LGPD */}
          <label className={cn(
            'flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition mb-5',
            acknowledged ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-amber-500/50 bg-amber-500/5',
          )}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-emerald-500 shrink-0"
            />
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                LGPD — Acesso registrado e visível ao cliente
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Confirmo que estou acessando dados pessoais do cliente final (vídeo, biometria,
                placas) com finalidade legítima descrita acima. Cada request feito durante a
                elevação fica no audit log forense e aparece no painel LGPD do cliente.
              </div>
            </div>
          </label>

          {/* Erro */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-sm text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-slate-400 hover:text-white text-sm transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'px-5 py-2 rounded-lg text-sm font-bold text-white transition flex items-center gap-2',
                canSubmit
                  ? 'bg-gradient-to-r from-amber-500 to-rose-500 hover:opacity-90 shadow-lg shadow-amber-500/30'
                  : 'bg-slate-700 cursor-not-allowed opacity-50',
              )}
            >
              {submitting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <KeyRound className="w-4 h-4" />}
              {submitting ? 'Validando…' : 'Confirmar elevação'}
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
