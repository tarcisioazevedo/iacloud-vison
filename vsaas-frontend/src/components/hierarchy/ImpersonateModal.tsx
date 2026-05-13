/**
 * ImpersonateModal — Modal de "Acessar como…" auditado 3-níveis.
 *
 * Onda 9 do docs/13-PLAN-COCKPIT-PREMIUM.md.
 *
 * Recursos:
 * - 3 níveis: INTEGRADOR_ADMIN / CLIENTE_ADMIN / CLIENTE_OPERADOR
 * - Motivo OBRIGATÓRIO (mínimo 10 caracteres)
 * - Duração: 15min (default) · 1h · 4h (justificar >1h)
 * - Checkbox de ciência LGPD obrigatório
 * - Audit log completo no backend (motivo, duração, IP, user-agent)
 * - Aut-logout no fim da duração via JWT exp
 * - Banner vermelho persistente (componente <ImpersonateBanner/>)
 */
import { useState } from 'react'
import { X, AlertTriangle, ShieldCheck, Loader2, User as UserIcon, Clock } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { impersonateStart, formatApiError, type ImpersonateTargetRole } from '../../api/client'
import { cn } from '../../lib/utils'

export interface ImpersonateModalProps {
  open: boolean
  onClose: () => void
  /** Integrador a ser impersonado (super-admin → integrador) */
  integradorId?: string
  integradorName?: string
  /** Cliente final a ser impersonado (super-admin/integrador → cliente) */
  clienteFinalId?: string
  clienteName?: string
  /** Quais roles oferecer no modal (default: todos os 3 níveis) */
  availableRoles?: ImpersonateTargetRole[]
}

const ROLE_LABELS: Record<ImpersonateTargetRole, { label: string; desc: string; icon: string }> = {
  INTEGRADOR_ADMIN:   { label: 'Integrador (admin)',     desc: 'Acesso total ao tenant do integrador', icon: '🤝' },
  INTEGRADOR_TECNICO: { label: 'Integrador (técnico)',   desc: 'Operação e suporte sem billing',       icon: '🔧' },
  CLIENTE_ADMIN:      { label: 'Cliente Final (admin)',  desc: 'Admin do cliente final · gerencia usuários do próprio cliente', icon: '👤' },
  CLIENTE_OPERADOR:   { label: 'Cliente Final (operador)', desc: 'Pode operar (live, eventos) mas não gerencia',                icon: '👁️' },
  CLIENTE_VIEWER:     { label: 'Cliente Final (viewer)', desc: 'Somente leitura — apenas visualização',                       icon: '👀' },
}

const DURATIONS: { sec: number; label: string; warn?: boolean }[] = [
  { sec: 900,   label: '15 min' },
  { sec: 3600,  label: '1 hora' },
  { sec: 14400, label: '4 horas', warn: true },
]

export function ImpersonateModal({
  open, onClose, integradorId, integradorName, clienteFinalId, clienteName, availableRoles,
}: ImpersonateModalProps) {
  const [role, setRole] = useState<ImpersonateTargetRole>(
    integradorId ? 'INTEGRADOR_ADMIN' : 'CLIENTE_ADMIN',
  )
  const [duration, setDuration] = useState<number>(900)
  const [reason, setReason] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetName = integradorName ?? clienteName ?? 'usuário'
  const reasonValid = reason.trim().length >= 10
  const durationLong = duration > 3600
  const canSubmit = acknowledged && reasonValid && !submitting

  // Filtra roles válidas para o contexto
  const validRoles: ImpersonateTargetRole[] = availableRoles ?? (
    integradorId
      ? ['INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO']
      : ['CLIENTE_ADMIN', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER']
  )

  if (!open) return null

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      // Salva sessão ORIGINAL antes de impersonar — ImpersonateBanner.handleEnd
      // restaura esse token quando o admin clica em "Sair".
      const originalToken = localStorage.getItem('icv_token')
      const originalRole  = localStorage.getItem('icv_role')
      const originalEmail = localStorage.getItem('icv_email')
      if (originalToken && !localStorage.getItem('icv_token_original')) {
        localStorage.setItem('icv_token_original', originalToken)
        localStorage.setItem('icv_role_original',  originalRole  ?? '')
        localStorage.setItem('icv_email_original', originalEmail ?? '')
      }

      const res = await impersonateStart({
        integradorId,
        clienteFinalId,
        targetRole: role,
        durationSeconds: duration,
        reason: reason.trim(),
        acknowledged: true,
      })
      // Salva token novo + dados de countdown no localStorage
      localStorage.setItem('icv_token', res.token)
      localStorage.setItem('icv_role', res.target.role)
      localStorage.setItem('icv_email', res.target.email)
      localStorage.setItem('icv_impersonate_expires_at', res.expiresAt)
      localStorage.setItem('icv_impersonate_target', JSON.stringify({
        id: res.target.id, email: res.target.email, role: res.target.role,
        targetName, reason: reason.trim(),
      }))
      // Reload completo para SWR re-fetch tudo com novo JWT
      window.location.href = '/'
    } catch (e: unknown) {
      setError(formatApiError(e))
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <GlassCard className="p-5 border-rose-500/40 bg-white dark:bg-slate-900 shadow-2xl">
          {/* Header compacto — uma linha */}
          <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center text-lg shrink-0">
                🔐
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">Acessar como {targetName}</h2>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 shrink-0">
                    LGPD
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Ação registrada (motivo · IP · duração) e visível ao usuário-alvo
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step 1: Nível de acesso — cards horizontais compactos */}
          <div className="mb-3">
            <label className="text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 font-bold mb-1.5 block">
              Nível de acesso
            </label>
            <div className="space-y-1.5">
              {validRoles.map(r => {
                const meta = ROLE_LABELS[r]
                const selected = role === r
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border-2 text-left transition',
                      selected
                        ? 'border-rose-500 bg-rose-500/15 text-slate-900 dark:text-white'
                        : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 hover:border-rose-400 dark:hover:border-rose-500/60',
                    )}
                  >
                    <span className="text-base shrink-0">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold leading-tight">{meta.label}</div>
                      <div className="text-[10px] text-slate-600 dark:text-slate-400 leading-tight truncate">{meta.desc}</div>
                    </div>
                    <span className={cn(
                      'w-3.5 h-3.5 rounded-full border-2 shrink-0',
                      selected ? 'bg-rose-500 border-rose-500' : 'border-slate-400 dark:border-slate-500',
                    )} />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Step 2: Motivo */}
          <div className="mb-3">
            <label className="text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-400 font-bold mb-1.5 block">
              Motivo · mínimo 10 caracteres
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Ex: Suporte técnico · ticket #1234 · box offline desde 14:30"
              rows={2}
              className={cn(
                'w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none transition resize-none',
                reason.length === 0 ? 'border-slate-300 dark:border-slate-700' :
                  reasonValid ? 'border-emerald-500/70 focus:border-emerald-500' : 'border-rose-500/70 focus:border-rose-500',
              )}
            />
            <div className="flex justify-between mt-0.5 text-[10px]">
              <span className={reasonValid ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}>
                {reasonValid ? '✓ válido' : `${Math.max(0, 10 - reason.length)} caracteres restantes`}
              </span>
              <span className="text-slate-500">{reason.length}/500</span>
            </div>
          </div>

          {/* Step 3: Duração */}
          <div className="mb-3">
            <label className="text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-400 font-bold mb-1.5 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Duração máxima
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {DURATIONS.map(d => {
                const selected = duration === d.sec
                return (
                  <button
                    key={d.sec}
                    type="button"
                    onClick={() => setDuration(d.sec)}
                    className={cn(
                      'py-1.5 rounded-lg border-2 text-xs font-bold transition',
                      selected
                        ? d.warn
                          ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'border-rose-500 bg-rose-500/10 text-slate-900 dark:text-white'
                        : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 hover:border-rose-400',
                    )}
                  >
                    {d.label}
                    {d.warn && <span className="block text-[9px] text-amber-700 dark:text-amber-400">justificar</span>}
                  </button>
                )
              })}
            </div>
            {durationLong && (
              <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Duração estendida — descreva motivo com mais detalhe.
              </p>
            )}
          </div>

          {/* Step 4: LGPD checkbox compacto */}
          <label className={cn(
            'flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition mb-3',
            acknowledged
              ? 'border-emerald-500/60 bg-emerald-500/10'
              : 'border-amber-500/60 bg-amber-500/10',
          )}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
              className="w-4 h-4 accent-emerald-500 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Ciente · LGPD Art. 7º IX + Art. 37º
              </div>
              <div className="text-[10px] text-slate-600 dark:text-slate-300 leading-tight">
                Cliques e alterações ficam no audit log imutável (nome, IP, motivo).
              </div>
            </div>
          </label>

          {/* Erro */}
          {error && (
            <div className="mb-3 p-2 rounded-lg bg-rose-500/10 border border-rose-500/40 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs transition border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'px-4 py-1.5 rounded-lg text-xs font-bold text-white transition flex items-center gap-1.5',
                canSubmit
                  ? 'bg-gradient-to-r from-rose-500 to-violet-500 hover:opacity-90 shadow-lg shadow-rose-500/30'
                  : 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-60',
              )}
            >
              {submitting
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <UserIcon className="w-3.5 h-3.5" />}
              {submitting ? 'Iniciando...' : 'Iniciar impersonação →'}
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
