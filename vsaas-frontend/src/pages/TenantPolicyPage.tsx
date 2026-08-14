/**
 * TenantPolicyPage — configurações de segurança e compliance do tenant.
 *
 * Acesso: CLIENTE_ADMIN (também ADMIN_GLOBAL/SUPER_ADMIN/INTEGRADOR_ADMIN
 * com tenant scope resolvido no backend).
 *
 * Rota: /settings/tenant-policy
 *
 * Seções:
 *   1. Senha — min length, classes obrigatórias, rotação, history
 *   2. Autenticação 2FA — exigir pra quais roles
 *   3. Sessão — timeout, max concorrentes
 *   4. Lockout — tentativas, minutos bloqueado
 *   5. LGPD — consent obrigatório, versão da política, texto
 *   6. Compliance avançado — justificativa pra playback, watermark export
 */
import { useEffect, useState } from 'react'
import {
  Shield, Lock, KeyRound, Clock, Users, FileText, AlertTriangle,
  ShieldCheck, Save, Loader2, Check, Smartphone, Monitor, Eye, Download,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useTenantPolicy, updateTenantPolicy, type TenantPolicy } from '../api/client'
import { useUiToast } from '../components/Toast'
import { cn } from '../lib/utils'

const ALL_ROLES = ['CLIENTE_ADMIN', 'CLIENTE_SUPERVISOR', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER'] as const

export function TenantPolicyPage() {
  const toast = useUiToast()
  const { data, isLoading, mutate } = useTenantPolicy()
  const [draft, setDraft] = useState<Partial<TenantPolicy> | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (data) setDraft(data) }, [data])

  function set<K extends keyof TenantPolicy>(key: K, value: TenantPolicy[K]) {
    setDraft(prev => prev ? { ...prev, [key]: value } : prev)
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      await updateTenantPolicy(draft)
      toast.success('Política do tenant atualizada')
      void mutate()
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !draft) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Política de Segurança do Tenant</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-3xl">
              Define como senhas, sessões, 2FA, LGPD e compliance funcionam pra todos os usuários do seu tenant.
              Mudanças aqui são auditadas e aplicadas no próximo login.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Grid responsivo de seções */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── 1. Senha ────────────────────────────────────────────────────── */}
        <Section title="Política de senha" icon={KeyRound} color="cyan">
          <NumField label="Tamanho mínimo" min={6} max={64} value={draft.passwordMinLength!} onChange={v => set('passwordMinLength', v)} hint="entre 6 e 64 caracteres" />
          <ToggleField label="Exigir caractere especial" checked={!!draft.passwordRequireSpecial} onChange={v => set('passwordRequireSpecial', v)} />
          <ToggleField label="Exigir número" checked={!!draft.passwordRequireNumber} onChange={v => set('passwordRequireNumber', v)} />
          <ToggleField label="Exigir letra maiúscula" checked={!!draft.passwordRequireUpper} onChange={v => set('passwordRequireUpper', v)} />
          <NumField label="Forçar troca a cada (dias)" min={0} max={365} value={draft.passwordRotateDays ?? 0} onChange={v => set('passwordRotateDays', v === 0 ? null : v)} hint="0 = nunca expira" />
          <NumField label="Histórico de senhas bloqueadas" min={0} max={20} value={draft.passwordHistoryCount!} onChange={v => set('passwordHistoryCount', v)} hint="quantas senhas anteriores não podem ser reusadas" />
        </Section>

        {/* ── 2. 2FA ───────────────────────────────────────────────────────── */}
        <Section title="Autenticação em duas etapas" icon={ShieldCheck} color="emerald">
          <ToggleField label="Exigir 2FA para todos os usuários" checked={!!draft.mfaRequired} onChange={v => set('mfaRequired', v)} hint="quando ativo, qualquer usuário precisa configurar TOTP no 1º login" />
          {!draft.mfaRequired && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2 font-bold">
                Ou exija apenas para perfis específicos
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_ROLES.map(r => {
                  const checked = (draft.mfaRequiredForRoles ?? []).includes(r)
                  return (
                    <label key={r} className={cn(
                      'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer border',
                      checked
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                        : 'bg-white/5 border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-300',
                    )}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          const cur = draft.mfaRequiredForRoles ?? []
                          set('mfaRequiredForRoles', e.target.checked ? [...cur, r] : cur.filter(x => x !== r))
                        }}
                      />
                      {r.replace('CLIENTE_', '').replace('_', ' ').toLowerCase()}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </Section>

        {/* ── 3. Sessão ───────────────────────────────────────────────────── */}
        <Section title="Sessão" icon={Clock} color="amber">
          <NumField label="Tempo máximo de sessão (minutos)" min={15} max={43200} value={draft.sessionTimeoutMinutes!} onChange={v => set('sessionTimeoutMinutes', v)} hint="usuário desloga automático após esse tempo" />
          <NumField label="Sessões simultâneas por usuário" min={1} max={50} value={draft.sessionMaxConcurrent ?? 5} onChange={v => set('sessionMaxConcurrent', v)} hint="quantos dispositivos podem estar logados ao mesmo tempo" />
        </Section>

        {/* ── 4. Lockout ──────────────────────────────────────────────────── */}
        <Section title="Bloqueio por tentativas" icon={Lock} color="rose">
          <NumField label="Tentativas antes de bloquear" min={1} max={20} value={draft.loginMaxAttempts!} onChange={v => set('loginMaxAttempts', v)} />
          <NumField label="Minutos bloqueado" min={1} max={1440} value={draft.loginLockoutMinutes!} onChange={v => set('loginLockoutMinutes', v)} hint="quanto tempo a conta fica suspensa após estourar o limite" />
        </Section>

        {/* ── 5. LGPD ─────────────────────────────────────────────────────── */}
        <Section title="LGPD — Consentimento" icon={FileText} color="violet">
          <ToggleField label="Exigir aceite da política antes do primeiro acesso" checked={!!draft.lgpdRequireConsent} onChange={v => set('lgpdRequireConsent', v)} />
          <TextField label="Versão atual da política" value={draft.lgpdPolicyVersion!} onChange={v => set('lgpdPolicyVersion', v)} hint="incremente (ex: v2, v3) quando o texto mudar — força usuários a reaceitarem" placeholder="v1" />
          <TextAreaField label="Texto da política (markdown)" value={draft.lgpdPolicyText ?? ''} onChange={v => set('lgpdPolicyText', v || null)} hint="se vazio, usa texto default genérico do sistema" placeholder="Deixe em branco pra usar o texto padrão…" rows={6} />
        </Section>

        {/* ── 6. Compliance avançado ──────────────────────────────────────── */}
        <Section title="Compliance avançado" icon={AlertTriangle} color="amber">
          <ToggleField
            label="Exigir justificativa para abrir gravação"
            checked={!!draft.requireReasonForPlayback}
            onChange={v => set('requireReasonForPlayback', v)}
            hint="modal de motivo + descrição antes de cada playback. Audit log grava ambos pra cadeia de custódia."
            icon={Eye}
          />
          <ToggleField
            label="Watermark em exports MP4"
            checked={!!draft.exportWatermarkEnabled}
            onChange={v => set('exportWatermarkEnabled', v)}
            hint="burn-in via FFmpeg com info do usuário que baixou. Rastreia vazamento de gravação."
            icon={Download}
          />
          <ToggleField
            label="Watermark em snapshots JPEG"
            checked={!!draft.snapshotWatermarkEnabled}
            onChange={v => set('snapshotWatermarkEnabled', v)}
            hint="aplica a mesma marca d'água em snapshots — não só em exports de vídeo."
            icon={Eye}
          />

          {(draft.exportWatermarkEnabled || draft.snapshotWatermarkEnabled) && (
            <div className="space-y-3 border-l-2 border-amber-500/30 pl-3 ml-2 mt-3">
              <TextField
                label="Template do watermark"
                value={draft.exportWatermarkTemplate ?? ''}
                onChange={v => set('exportWatermarkTemplate', v)}
                placeholder="{name} · {timestamp}"
                hint="placeholders: {name}, {email}, {timestamp}, {cameraId}, {frametime} (só em vídeo — timestamp REAL do frame, anti-edição)"
              />

              <div>
                <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-bold">Posição</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['top-left','top-right','center','bottom-left','bottom-right','tile'] as const).map(p => {
                    const labels: Record<string,string> = {
                      'top-left':'↖ Sup. Esq.', 'top-right':'↗ Sup. Dir.',
                      'center':'⊙ Centro',
                      'bottom-left':'↙ Inf. Esq.', 'bottom-right':'↘ Inf. Dir.',
                      'tile':'⊞ Mosaico (anti-recrop)',
                    }
                    const active = draft.exportWatermarkPosition === p
                    return (
                      <button key={p} type="button" onClick={() => set('exportWatermarkPosition', p)}
                        className={cn(
                          'px-2 py-1.5 rounded-md text-[11px] font-semibold border',
                          active
                            ? 'bg-amber-500 text-white border-amber-400'
                            : 'bg-white/5 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-white/10 hover:border-amber-400',
                        )}>
                        {labels[p]}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-bold">
                    Opacidade · {((draft.exportWatermarkOpacity ?? 0.85) * 100).toFixed(0)}%
                  </span>
                  <input
                    type="range" min={0.1} max={1} step={0.05}
                    value={draft.exportWatermarkOpacity ?? 0.85}
                    onChange={e => set('exportWatermarkOpacity', parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <NumField
                  label="Tamanho fonte (px)"
                  min={10} max={72}
                  value={draft.exportWatermarkFontSize ?? 20}
                  onChange={v => set('exportWatermarkFontSize', v)}
                />
              </div>

              <TextField
                label="URL do logo (PNG/JPG, opcional)"
                value={draft.exportWatermarkLogoUrl ?? ''}
                onChange={v => set('exportWatermarkLogoUrl', v || null)}
                placeholder="https://cdn.exemplo.com/logo.png"
                hint="aparece no canto superior direito. URL precisa ser pública e acessível. Cacheada 1h. Vazio = só texto."
              />
            </div>
          )}
        </Section>
      </div>

      {/* Footer fixo de salvar */}
      <div className="sticky bottom-4 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 text-white font-bold shadow-lg shadow-cyan-500/30 hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Salvando…' : 'Salvar política'}
        </button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers visuais
// ════════════════════════════════════════════════════════════════════════════

const COLOR_MAP: Record<string, { ring: string; bg: string; text: string }> = {
  cyan:    { ring: 'border-cyan-500/30',    bg: 'bg-cyan-500/15',    text: 'text-cyan-700 dark:text-cyan-300'    },
  emerald: { ring: 'border-emerald-500/30', bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300' },
  amber:   { ring: 'border-amber-500/30',   bg: 'bg-amber-500/15',   text: 'text-amber-700 dark:text-amber-300'   },
  rose:    { ring: 'border-rose-500/30',    bg: 'bg-rose-500/15',    text: 'text-rose-700 dark:text-rose-300'     },
  violet:  { ring: 'border-violet-500/30',  bg: 'bg-violet-500/15',  text: 'text-violet-700 dark:text-violet-300' },
}

function Section({ title, icon: Icon, color, children }: {
  title:    string
  icon:     typeof Shield
  color:    keyof typeof COLOR_MAP
  children: React.ReactNode
}) {
  const c = COLOR_MAP[color]
  return (
    <GlassCard className={cn('p-5 space-y-3', c.ring)}>
      <div className="flex items-center gap-2.5 mb-1">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', c.bg)}>
          <Icon className={cn('w-4 h-4', c.text)} />
        </div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </GlassCard>
  )
}

function NumField({ label, value, onChange, min, max, hint }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; hint?: string
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-bold">{label}</span>
      <input
        type="number"
        min={min} max={max} value={value}
        onChange={e => onChange(parseInt(e.target.value, 10) || 0)}
        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
      />
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </label>
  )
}

function TextField({ label, value, onChange, hint, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-bold">{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-500"
      />
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </label>
  )
}

function TextAreaField({ label, value, onChange, hint, placeholder, rows = 4 }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string; rows?: number
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-bold">{label}</span>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 font-mono resize-y"
      />
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </label>
  )
}

function ToggleField({ label, checked, onChange, hint, icon: Icon }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; icon?: typeof Shield
}) {
  return (
    <label className={cn(
      'flex items-start gap-3 p-3 rounded-lg cursor-pointer border transition',
      checked
        ? 'bg-cyan-500/5 border-cyan-500/30'
        : 'bg-white/5 border-slate-200 dark:border-white/10 hover:border-cyan-500/30',
    )}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
          {Icon && <Icon className="w-3.5 h-3.5 text-cyan-500" />}
          {label}
        </p>
        {hint && <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{hint}</p>}
      </div>
      {checked && <Check className="w-4 h-4 text-cyan-500 shrink-0 mt-0.5" />}
    </label>
  )
}

// Sentinelas
void Users; void Smartphone; void Monitor
