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
        className="w-full max-w-2xl"
        onClick={e => e.stopPropagation()}
      >
        <GlassCard className="p-6 border-rose-500/40 bg-gradient-to-br from-rose-500/5 to-violet-500/5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center text-2xl shrink-0 shadow-lg shadow-rose-500/30">
                🔐
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Acessar como…</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Você está prestes a impersonar <strong className="text-white">{targetName}</strong>. Esta ação é
                  registrada (motivo · duração · IP) e visível ao usuário-alvo.
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step 1: Nível de acesso */}
          <div className="mb-5">
            <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2 block">
              Nível de acesso
            </label>
            <div className="space-y-2">
              {validRoles.map(r => {
                const meta = ROLE_LABELS[r]
                const selected = role === r
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={cn(
                      'w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition',
                      selected
                        ? 'border-rose-500 bg-rose-500/10 text-white'
                        : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-rose-500/50',
                    )}
                  >
                    <span className="text-xl shrink-0">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold">{meta.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{meta.desc}</div>
                    </div>
                    <span className={cn(
                      'w-4 h-4 rounded-full border-2 shrink-0 mt-1',
                      selected ? 'bg-rose-500 border-rose-500' : 'border-slate-600',
                    )} />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Step 2: Motivo (obrigatório) */}
          <div className="mb-5">
            <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2 block">
              Motivo (obrigatório · mínimo 10 caracteres)
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Ex: Suporte técnico · ticket #1234 · investigar box offline desde 14:30"
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

          {/* Step 3: Duração */}
          <div className="mb-5">
            <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2 block flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> Duração máxima
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
                          : 'border-rose-500 bg-rose-500/10 text-white'
                        : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-rose-500/50',
                    )}
                  >
                    {d.label}
                    {d.warn && <span className="block text-[10px] text-amber-400 mt-0.5">justificar</span>}
                  </button>
                )
              })}
            </div>
            {durationLong && (
              <p className="text-[11px] text-amber-400 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Duração estendida — descreva o motivo com mais detalhe acima.
              </p>
            )}
          </div>

          {/* Step 4: LGPD checkbox */}
          <label className={cn(
            'flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition mb-5',
            acknowledged
              ? 'border-emerald-500/50 bg-emerald-500/5'
              : 'border-amber-500/50 bg-amber-500/5',
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
                LGPD — Concordo que minhas ações ficam visíveis ao cliente
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Tudo que eu fizer durante esta sessão (cliques, navegação, alterações)
                ficará registrado no audit log do cliente impersonado, com meu nome,
                IP, motivo e duração. Este registro é imutável.
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
              className="px-4 py-2 rounded-lg text-slate-400 hover:text-white text-sm transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'px-5 py-2 rounded-lg text-sm font-bold text-white transition flex items-center gap-2',
                canSubmit
                  ? 'bg-gradient-to-r from-rose-500 to-violet-500 hover:opacity-90 shadow-lg shadow-rose-500/30'
                  : 'bg-slate-700 cursor-not-allowed opacity-50',
              )}
            >
              {submitting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <UserIcon className="w-4 h-4" />}
              {submitting ? 'Iniciando...' : 'Iniciar impersonação →'}
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
