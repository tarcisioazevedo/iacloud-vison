/**
 * SettingsPage — configurações do usuário e do tenant.
 *
 * Seções (navegação lateral):
 *   • Perfil        — nome, email, telefone (dados do /auth/me + PATCH /auth/me)
 *   • Segurança     — trocar senha (POST /auth/change-password), sessões
 *   • Preferências  — UI/UX (tema, densidade, animações) — persist localStorage
 *   • Notificações  — stub com toggles locais
 *   • Billing       — usa /quota/status
 *   • Sobre         — versão, build, links
 */
import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  User, Shield, Sliders, Bell, Receipt, Info,
  Check, Loader2, Eye, EyeOff, Save, AlertTriangle,
  Building2, Mail, Phone, Calendar,
  Zap, Moon, Sun, MonitorSmartphone,
  LogOut, ExternalLink, MessageCircle, Send,
  Plus, Trash2, Webhook, CheckCircle2,
  Smartphone, Wifi, BookOpen, Radio,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useMe, updateMe, changePassword, useQuotaStatus,
  useMqttStatus, useMqttTopicsCatalog,
  usePushSubscriptions,
} from '../api/client'
import { usePushSubscription } from '../hooks/usePushSubscription'
import { cn } from '../lib/utils'

// ── Tipagem das preferências locais ──────────────────────────────────────
interface LocalPrefs {
  density: 'compact' | 'comfortable'
  animations: boolean
  autoRefresh: boolean
  notifyCritical: boolean
  notifyWarn: boolean
  notifyInfo: boolean
  sound: boolean
}
const DEFAULT_PREFS: LocalPrefs = {
  density: 'comfortable',
  animations: true,
  autoRefresh: true,
  notifyCritical: true,
  notifyWarn: true,
  notifyInfo: false,
  sound: false,
}
const PREFS_KEY = 'icv_prefs'
function loadPrefs(): LocalPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) }
  } catch { return DEFAULT_PREFS }
}

// ── Seções ────────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'profile',       label: 'Perfil',        icon: User,        desc: 'Dados pessoais e da organização' },
  { id: 'security',      label: 'Segurança',     icon: Shield,      desc: 'Senha e sessão ativa' },
  { id: 'preferences',   label: 'Preferências',  icon: Sliders,     desc: 'Aparência e comportamento da UI' },
  { id: 'notifications', label: 'Notificações',  icon: Bell,        desc: 'Eventos que disparam alertas' },
  { id: 'integrations',  label: 'Integrações',   icon: Radio,       desc: 'MQTT, WebPush e ecossistema' },
  { id: 'billing',       label: 'Uso & Quota',   icon: Receipt,     desc: 'Consumo de APIs e faturamento' },
  { id: 'about',         label: 'Sobre',         icon: Info,        desc: 'Versão, build e suporte' },
] as const
type SectionId = typeof SECTIONS[number]['id']

export function SettingsPage() {
  const [section, setSection] = useState<SectionId>('profile')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Sliders className="w-5 h-5 text-cyan-700 dark:text-cyan-400" />
          Configurações
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Perfil, segurança, preferências e faturamento
        </p>
      </div>

      {/* Grid com nav lateral + conteúdo */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Nav lateral */}
        <GlassCard className="p-2 lg:col-span-1 h-fit">
          <nav className="space-y-0.5">
            {SECTIONS.map(s => {
              const Icon = s.icon
              const active = s.id === section
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition',
                    active
                      ? 'bg-cyan-100 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:border-cyan-500/30 dark:text-cyan-300'
                      : 'hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
                  )}
                >
                  <Icon className={cn('w-4 h-4 shrink-0 mt-0.5', active ? 'text-cyan-700 dark:text-cyan-400' : 'text-slate-500')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">{s.label}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate">{s.desc}</p>
                  </div>
                </button>
              )
            })}
          </nav>
        </GlassCard>

        {/* Conteúdo */}
        <div className="lg:col-span-3">
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {section === 'profile'       && <ProfileSection />}
            {section === 'security'      && <SecuritySection />}
            {section === 'preferences'   && <PreferencesSection />}
            {section === 'notifications' && <NotificationsSection />}
            {section === 'integrations'  && <IntegrationsSection />}
            {section === 'billing'       && <BillingSection />}
            {section === 'about'         && <AboutSection />}
          </motion.div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════
function ProfileSection() {
  const { data: me, error, isLoading, mutate } = useMe()
  const [draft, setDraft] = useState<{ name: string; phone: string }>({ name: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (me) setDraft({ name: me.name ?? '', phone: me.phone ?? '' })
  }, [me])

  const dirty = useMemo(() => {
    if (!me) return false
    return (me.name ?? '') !== draft.name || (me.phone ?? '') !== (draft.phone ?? '')
  }, [me, draft])

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      await updateMe({ name: draft.name, phone: draft.phone || undefined })
      setSavedAt(new Date())
      mutate()
    } catch (err: any) {
      setSaveError(err?.response?.data?.message ?? err?.message ?? 'Erro ao salvar')
    }
    setSaving(false)
  }

  if (isLoading) return <LoadingCard text="Carregando perfil..." />
  if (error || !me) return <ErrorCard text={error?.message ?? 'Falha ao carregar perfil'} />

  const canEditPhone = me.kind === 'INTEGRADOR'

  return (
    <GlassCard className="p-5 space-y-5">
      <header>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Perfil</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {me.kind === 'SUPER_ADMIN' ? 'Conta de Super Admin' :
           me.kind === 'INTEGRADOR'  ? 'Conta de Integrador'  :
                                       `Usuário · ${me.role ?? ''}`}
        </p>
      </header>

      {/* Identidade resumida */}
      <div className="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-white/5">
        <div className="w-12 h-12 rounded-full bg-brand-gradient flex items-center justify-center text-white font-bold text-lg shadow-sky-glow">
          {me.name?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{me.name}</p>
          <p className="text-[11px] text-slate-500 truncate">{me.email}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-600 font-mono">{me.id.slice(0, 8)}…</p>
        </div>
      </div>

      {/* Formulário */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Nome completo" icon={<User className="w-3.5 h-3.5" />}>
          <input
            type="text"
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            className="input"
          />
        </Field>

        <Field label="E-mail" icon={<Mail className="w-3.5 h-3.5" />} hint="E-mail não pode ser alterado aqui">
          <input type="email" value={me.email} disabled className="input bg-slate-100 dark:bg-white/[0.02] text-slate-500 cursor-not-allowed" />
        </Field>

        <Field
          label="Telefone"
          icon={<Phone className="w-3.5 h-3.5" />}
          hint={!canEditPhone ? 'Edição disponível apenas para contas Integrador' : undefined}
        >
          <input
            type="tel"
            value={draft.phone}
            onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))}
            disabled={!canEditPhone}
            placeholder="+55 11 99999-9999"
            className={cn('input', !canEditPhone && 'bg-slate-100 dark:bg-white/[0.02] text-slate-500 cursor-not-allowed')}
          />
        </Field>

        <Field label="Criado em" icon={<Calendar className="w-3.5 h-3.5" />}>
          <input
            type="text"
            value={new Date(me.createdAt).toLocaleString('pt-BR')}
            disabled
            className="input bg-slate-100 dark:bg-white/[0.02] text-slate-500 cursor-not-allowed"
          />
        </Field>
      </div>

      {/* Organização vinculada */}
      {(me.integrador || me.clienteFinal) && (
        <section className="pt-4 border-t border-slate-200 dark:border-white/5">
          <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">Vínculo organizacional</h3>
          <div className="space-y-2">
            {me.integrador && (
              <OrgRow
                icon={<Building2 className="w-4 h-4 text-violet-700 dark:text-violet-400" />}
                label="Integrador"
                name={me.integrador.name}
                sub={me.integrador.tradeName ?? undefined}
              />
            )}
            {me.clienteFinal && (
              <OrgRow
                icon={<Building2 className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />}
                label="Cliente Final"
                name={me.clienteFinal.name}
                sub={me.clienteFinal.tradeName ?? undefined}
              />
            )}
          </div>
        </section>
      )}

      {/* Integrador: dados da empresa */}
      {me.kind === 'INTEGRADOR' && (
        <section className="pt-4 border-t border-slate-200 dark:border-white/5">
          <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">Dados da empresa</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InfoRow label="Nome fantasia" value={me.tradeName || '—'} />
            <InfoRow label="CNPJ"          value={me.cnpj ?? '—'} mono />
            <InfoRow label="Website"       value={me.website ?? '—'} />
          </div>
          <p className="text-[10px] text-slate-500 mt-2">
            Alteração de CNPJ/website requer contato com o Super Admin.
          </p>
        </section>
      )}

      {/* Save bar */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-white/5">
        <div className="text-[11px]">
          {savedAt && !saveError && <span className="text-emerald-700 dark:text-emerald-400">✓ Salvo em {savedAt.toLocaleTimeString()}</span>}
          {saveError && <span className="text-rose-700 dark:text-rose-400">{saveError}</span>}
          {!savedAt && !saveError && dirty && <span className="text-amber-500 dark:text-amber-400">Alterações não salvas</span>}
        </div>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className={cn(
            'px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition',
            dirty && !saving
              ? 'bg-cyan-500 hover:bg-cyan-400 text-white shadow-cyan-glow'
              : 'bg-slate-100 dark:bg-white/5 text-slate-500 cursor-not-allowed',
          )}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salvar alterações
        </button>
      </div>
    </GlassCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY
// ═══════════════════════════════════════════════════════════════════════════
function SecuritySection() {
  const [current, setCurrent] = useState('')
  const [nextPw, setNextPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const strength = useMemo(() => scorePassword(nextPw), [nextPw])
  const canSubmit = current.length >= 6 && nextPw.length >= 8 && nextPw === confirm && strength >= 2

  async function submit() {
    setLoading(true); setMsg(null)
    try {
      await changePassword(current, nextPw)
      setMsg({ ok: true, text: 'Senha alterada com sucesso. Use a nova senha no próximo login.' })
      setCurrent(''); setNextPw(''); setConfirm('')
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.message ?? err?.message ?? 'Falha ao alterar senha' })
    }
    setLoading(false)
  }

  function logoutAll() {
    if (!window.confirm('Deseja mesmo encerrar a sessão?')) return
    localStorage.removeItem('icv_token')
    localStorage.removeItem('icv_role')
    window.location.href = '/login'
  }

  return (
    <div className="space-y-4">
      {/* Trocar senha */}
      <GlassCard className="p-5 space-y-4">
        <header>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Alterar senha</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Mínimo 8 caracteres. Recomenda-se misturar letras, números e símbolos.</p>
        </header>

        <div className="space-y-3 max-w-md">
          <Field label="Senha atual">
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={current}
                onChange={e => setCurrent(e.target.value)}
                className="input pr-9"
                autoComplete="current-password"
              />
              <button type="button" onClick={() => setShow(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 dark:hover:text-white">
                {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </Field>

          <Field label="Nova senha">
            <input
              type={show ? 'text' : 'password'}
              value={nextPw}
              onChange={e => setNextPw(e.target.value)}
              className="input"
              autoComplete="new-password"
            />
            {nextPw.length > 0 && <PasswordStrength score={strength} />}
          </Field>

          <Field label="Confirmar nova senha">
            <input
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className={cn('input', confirm && nextPw !== confirm && 'border-rose-500/40')}
              autoComplete="new-password"
            />
            {confirm && nextPw !== confirm && (
              <p className="text-[10px] text-rose-700 dark:text-rose-400 mt-1">Senhas não coincidem</p>
            )}
          </Field>

          {msg && (
            <div className={cn(
              'flex items-start gap-2 p-3 rounded-lg border text-[11px]',
              msg.ok
                ? 'bg-emerald-100 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300'
                : 'bg-rose-100 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300',
            )}>
              {msg.ok ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              {msg.text}
            </div>
          )}

          <button
            onClick={submit}
            disabled={!canSubmit || loading}
            className={cn(
              'w-full px-4 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2',
              canSubmit && !loading
                ? 'bg-cyan-500 hover:bg-cyan-400 text-white'
                : 'bg-slate-100 dark:bg-white/5 text-slate-500 cursor-not-allowed',
            )}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
            Alterar senha
          </button>
        </div>
      </GlassCard>

      {/* Sessão */}
      <GlassCard className="p-5">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Sessão ativa</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Encerra sua sessão neste navegador. Você será redirecionado ao login.
            </p>
          </div>
          <button
            onClick={logoutAll}
            className="px-3 py-1.5 rounded-lg bg-rose-100 border border-rose-200 text-rose-700 hover:bg-rose-200 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/25 text-xs font-semibold flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" /> Encerrar sessão
          </button>
        </header>
      </GlassCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PREFERENCES (localStorage)
// ═══════════════════════════════════════════════════════════════════════════
function PreferencesSection() {
  const [prefs, setPrefs] = useState<LocalPrefs>(loadPrefs)

  useEffect(() => { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) }, [prefs])

  function set<K extends keyof LocalPrefs>(key: K, value: LocalPrefs[K]) {
    setPrefs(p => ({ ...p, [key]: value }))
  }

  return (
    <GlassCard className="p-5 space-y-5">
      <header>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Preferências da interface</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Salvas localmente neste navegador · não se aplicam em outros dispositivos
        </p>
      </header>

      {/* Tema (por enquanto só escuro) */}
      <section>
        <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">Tema</h3>
        <div className="grid grid-cols-3 gap-2 max-w-md">
          <ThemeOption icon={<Moon   className="w-4 h-4" />} label="Escuro"     active disabled />
          <ThemeOption icon={<Sun    className="w-4 h-4" />} label="Claro"      disabled />
          <ThemeOption icon={<MonitorSmartphone className="w-4 h-4" />} label="Sistema" disabled />
        </div>
        <p className="text-[10px] text-slate-500 mt-2">Modo claro em desenvolvimento.</p>
      </section>

      {/* Densidade */}
      <section className="pt-4 border-t border-slate-200 dark:border-white/5">
        <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">Densidade</h3>
        <div className="flex gap-2">
          {(['compact', 'comfortable'] as const).map(d => (
            <button
              key={d}
              onClick={() => set('density', d)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold border transition',
                prefs.density === d
                  ? 'bg-cyan-100 border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:border-cyan-500/40 dark:text-cyan-300'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:text-slate-900 dark:bg-white/5 dark:border-white/10 dark:text-slate-400 dark:hover:text-white',
              )}
            >
              {d === 'compact' ? 'Compacta' : 'Confortável'}
            </button>
          ))}
        </div>
      </section>

      {/* Comportamento */}
      <section className="pt-4 border-t border-slate-200 dark:border-white/5">
        <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-3">Comportamento</h3>
        <div className="space-y-3">
          <ToggleRow
            label="Animações de transição"
            desc="Desabilite se o dispositivo estiver com performance baixa"
            value={prefs.animations}
            onChange={v => set('animations', v)}
          />
          <ToggleRow
            label="Auto-refresh de dados"
            desc="Atualiza KPIs, câmeras e revisão automaticamente a cada 10–30s"
            value={prefs.autoRefresh}
            onChange={v => set('autoRefresh', v)}
          />
        </div>
      </section>
    </GlassCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS — canais (Email/WhatsApp/Telegram) + severidade
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Modelo de canais de notificação — scaffold persistido em localStorage.
 *
 * Este scaffold prepara a UI e a estrutura de dados para envio multi-canal
 * sem implementar as integrações de fato. Quando a lógica de envio for
 * ativada no backend (Sprint notificações), o contrato é:
 *
 *   POST /notifications/channels  body: NotificationChannelsConfig
 *   POST /notifications/test      body: { channel: 'email'|'whatsapp'|'telegram' }
 *
 * Enquanto isso, as credenciais ficam locais e nenhum envio acontece.
 */
interface EmailChannelConfig {
  enabled: boolean
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string                 // nunca enviar ao backend sem TLS
  fromAddress: string
  fromName: string
  recipients: string[]             // lista de destinatários por severidade
}
interface WhatsAppChannelConfig {
  enabled: boolean
  provider: 'twilio' | 'meta-cloud' | 'evolution-api'
  accountSid: string               // Twilio: Account SID / Meta: Business Account ID
  authToken: string                // Twilio: Auth Token / Meta: Access Token
  fromNumber: string               // E.164: +5511999999999
  recipients: string[]
}
interface TelegramChannelConfig {
  enabled: boolean
  botToken: string                 // token do @BotFather
  chatIds: string[]                // IDs de chats ou canais (@handle ou -100...)
}
interface NotificationChannelsConfig {
  severityRouting: {
    critical: { email: boolean; whatsapp: boolean; telegram: boolean }
    warn:     { email: boolean; whatsapp: boolean; telegram: boolean }
    info:     { email: boolean; whatsapp: boolean; telegram: boolean }
  }
  email: EmailChannelConfig
  whatsapp: WhatsAppChannelConfig
  telegram: TelegramChannelConfig
}
const DEFAULT_CHANNELS: NotificationChannelsConfig = {
  severityRouting: {
    critical: { email: true,  whatsapp: true,  telegram: true  },
    warn:     { email: true,  whatsapp: false, telegram: true  },
    info:     { email: false, whatsapp: false, telegram: false },
  },
  email: {
    enabled: false, smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '',
    fromAddress: '', fromName: 'IA Cloud Vision', recipients: [],
  },
  whatsapp: {
    enabled: false, provider: 'twilio',
    accountSid: '', authToken: '', fromNumber: '', recipients: [],
  },
  telegram: {
    enabled: false, botToken: '', chatIds: [],
  },
}
const CHANNELS_KEY = 'icv_notify_channels_v1'
function loadChannels(): NotificationChannelsConfig {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY)
    if (!raw) return DEFAULT_CHANNELS
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_CHANNELS,
      ...parsed,
      severityRouting: { ...DEFAULT_CHANNELS.severityRouting, ...(parsed.severityRouting ?? {}) },
      email:    { ...DEFAULT_CHANNELS.email,    ...(parsed.email    ?? {}) },
      whatsapp: { ...DEFAULT_CHANNELS.whatsapp, ...(parsed.whatsapp ?? {}) },
      telegram: { ...DEFAULT_CHANNELS.telegram, ...(parsed.telegram ?? {}) },
    }
  } catch { return DEFAULT_CHANNELS }
}

function NotificationsSection() {
  const [prefs, setPrefs] = useState<LocalPrefs>(loadPrefs)
  const [channels, setChannels] = useState<NotificationChannelsConfig>(loadChannels)
  const [tab, setTab] = useState<'severity' | 'email' | 'whatsapp' | 'telegram'>('severity')

  useEffect(() => { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) }, [prefs])
  useEffect(() => { localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels)) }, [channels])

  function setP<K extends keyof LocalPrefs>(k: K, v: LocalPrefs[K]) { setPrefs(p => ({ ...p, [k]: v })) }

  const TABS = [
    { id: 'severity' as const, label: 'Severidade & UI', icon: Bell,           count: null },
    { id: 'email'    as const, label: 'E-mail',          icon: Mail,           count: channels.email.recipients.length },
    { id: 'whatsapp' as const, label: 'WhatsApp',        icon: MessageCircle,  count: channels.whatsapp.recipients.length },
    { id: 'telegram' as const, label: 'Telegram',        icon: Send,           count: channels.telegram.chatIds.length },
  ]

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
              Notificações
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Provisione canais de envio (e-mail, WhatsApp, Telegram) e defina
              qual severidade dispara cada canal
            </p>
          </div>
          <StatusPill enabled={channels.email.enabled || channels.whatsapp.enabled || channels.telegram.enabled} />
        </header>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/5 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap transition',
                  active
                    ? 'bg-cyan-100 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:border-cyan-500/30 dark:text-cyan-300'
                    : 'text-slate-700 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white border border-transparent',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                {t.count !== null && t.count > 0 && (
                  <span className="ml-1 px-1.5 py-0 rounded-full bg-slate-200 dark:bg-white/10 text-[9px] font-mono">{t.count}</span>
                )}
              </button>
            )
          })}
        </div>

        {tab === 'severity' && (
          <SeverityTab
            prefs={prefs}
            setP={setP}
            routing={channels.severityRouting}
            onRouting={(sev, ch, v) => setChannels(c => ({
              ...c,
              severityRouting: { ...c.severityRouting, [sev]: { ...c.severityRouting[sev], [ch]: v } },
            }))}
            channelsEnabled={{
              email:    channels.email.enabled,
              whatsapp: channels.whatsapp.enabled,
              telegram: channels.telegram.enabled,
            }}
          />
        )}

        {tab === 'email' && (
          <EmailChannelTab
            config={channels.email}
            onChange={(patch) => setChannels(c => ({ ...c, email: { ...c.email, ...patch } }))}
          />
        )}

        {tab === 'whatsapp' && (
          <WhatsAppChannelTab
            config={channels.whatsapp}
            onChange={(patch) => setChannels(c => ({ ...c, whatsapp: { ...c.whatsapp, ...patch } }))}
          />
        )}

        {tab === 'telegram' && (
          <TelegramChannelTab
            config={channels.telegram}
            onChange={(patch) => setChannels(c => ({ ...c, telegram: { ...c.telegram, ...patch } }))}
          />
        )}

        <div className="p-3 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 dark:bg-violet-500/5 dark:border-violet-500/20 dark:text-violet-300 text-[11px] flex items-start gap-2">
          <Webhook className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong className="text-violet-800 dark:text-violet-200">Scaffold provisionado.</strong>{' '}
            As credenciais ficam salvas localmente neste navegador. O envio real
            será ativado quando o backend disponibilizar
            {' '}<code className="text-violet-800 dark:text-violet-200">POST /notifications/channels</code>
            {' '}e <code className="text-violet-800 dark:text-violet-200">POST /notifications/test</code>.
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

// ── Severidade & UI ──────────────────────────────────────────────────────
function SeverityTab({
  prefs, setP, routing, onRouting, channelsEnabled,
}: {
  prefs: LocalPrefs
  setP: <K extends keyof LocalPrefs>(k: K, v: LocalPrefs[K]) => void
  routing: NotificationChannelsConfig['severityRouting']
  onRouting: (sev: keyof NotificationChannelsConfig['severityRouting'], ch: 'email' | 'whatsapp' | 'telegram', v: boolean) => void
  channelsEnabled: { email: boolean; whatsapp: boolean; telegram: boolean }
}) {
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-3">Severidade no navegador</h3>
        <div className="space-y-2">
          <ToggleRow label="Críticas"     desc="Intrusão, EPI, blacklist"               value={prefs.notifyCritical} onChange={v => setP('notifyCritical', v)} color="rose" />
          <ToggleRow label="Avisos"        desc="Loitering, placa não autorizada"        value={prefs.notifyWarn}     onChange={v => setP('notifyWarn', v)}     color="amber" />
          <ToggleRow label="Informativas"  desc="Eventos gerais (chegadas, contagens)"   value={prefs.notifyInfo}     onChange={v => setP('notifyInfo', v)}     color="cyan" />
          <ToggleRow label="Som ao alertar" desc="Beep breve para eventos críticos"      value={prefs.sound}          onChange={v => setP('sound', v)} />
        </div>
      </section>

      <section className="pt-4 border-t border-slate-200 dark:border-white/5">
        <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-3">Roteamento por severidade → canal</h3>
        <p className="text-[10px] text-slate-500 mb-3">
          Marque quais canais recebem cada severidade. Canais desabilitados aparecem em cinza.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2 pr-3 font-semibold">Severidade</th>
                <th className="py-2 px-2 font-semibold text-center">E-mail</th>
                <th className="py-2 px-2 font-semibold text-center">WhatsApp</th>
                <th className="py-2 px-2 font-semibold text-center">Telegram</th>
              </tr>
            </thead>
            <tbody>
              {(['critical', 'warn', 'info'] as const).map(sev => (
                <tr key={sev} className="border-t border-slate-200 dark:border-white/5">
                  <td className="py-2 pr-3 text-slate-900 dark:text-white font-semibold">
                    {sev === 'critical' ? '🔴 Críticas' : sev === 'warn' ? '🟡 Avisos' : '🔵 Informativas'}
                  </td>
                  {(['email', 'whatsapp', 'telegram'] as const).map(ch => (
                    <td key={ch} className="py-2 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={routing[sev][ch]}
                        disabled={!channelsEnabled[ch]}
                        onChange={e => onRouting(sev, ch, e.target.checked)}
                        className="w-4 h-4 rounded accent-cyan-500 disabled:opacity-30"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ── E-mail (SMTP) ────────────────────────────────────────────────────────
function EmailChannelTab({
  config, onChange,
}: {
  config: EmailChannelConfig
  onChange: (patch: Partial<EmailChannelConfig>) => void
}) {
  return (
    <div className="space-y-4">
      <ChannelHeader
        enabled={config.enabled}
        onToggle={v => onChange({ enabled: v })}
        icon={<Mail className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />}
        label="SMTP (e-mail)"
        hint="Envie alertas por SMTP (Gmail, AWS SES, SendGrid, Mailgun, servidor próprio)"
      />

      <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-3', !config.enabled && 'opacity-50 pointer-events-none')}>
        <Field label="Host SMTP" icon={<Mail className="w-3.5 h-3.5" />}>
          <input type="text" value={config.smtpHost} onChange={e => onChange({ smtpHost: e.target.value })}
                 placeholder="smtp.gmail.com" className="input" />
        </Field>
        <Field label="Porta">
          <input type="number" value={config.smtpPort} onChange={e => onChange({ smtpPort: Number(e.target.value) || 587 })}
                 placeholder="587" className="input" />
        </Field>
        <Field label="Usuário">
          <input type="text" value={config.smtpUser} onChange={e => onChange({ smtpUser: e.target.value })}
                 placeholder="noreply@empresa.com.br" className="input" />
        </Field>
        <Field label="Senha / App Password" hint="Senha nunca é enviada sem TLS">
          <input type="password" value={config.smtpPass} onChange={e => onChange({ smtpPass: e.target.value })}
                 placeholder="••••••••" className="input" autoComplete="new-password" />
        </Field>
        <Field label="Remetente (endereço)">
          <input type="email" value={config.fromAddress} onChange={e => onChange({ fromAddress: e.target.value })}
                 placeholder="alertas@empresa.com.br" className="input" />
        </Field>
        <Field label="Remetente (nome exibido)">
          <input type="text" value={config.fromName} onChange={e => onChange({ fromName: e.target.value })}
                 placeholder="IA Cloud Vision" className="input" />
        </Field>
      </div>

      <RecipientsEditor
        disabled={!config.enabled}
        label="Destinatários"
        placeholder="time-seg@empresa.com.br"
        type="email"
        items={config.recipients}
        onChange={(recipients) => onChange({ recipients })}
        validate={(v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'E-mail inválido'}
      />

      <TestButton disabled={!config.enabled} channel="email" />
    </div>
  )
}

// ── WhatsApp ─────────────────────────────────────────────────────────────
function WhatsAppChannelTab({
  config, onChange,
}: {
  config: WhatsAppChannelConfig
  onChange: (patch: Partial<WhatsAppChannelConfig>) => void
}) {
  return (
    <div className="space-y-4">
      <ChannelHeader
        enabled={config.enabled}
        onToggle={v => onChange({ enabled: v })}
        icon={<MessageCircle className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />}
        label="WhatsApp Business"
        hint="Suporta Twilio, Meta Cloud API ou Evolution API (self-hosted)"
      />

      <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-3', !config.enabled && 'opacity-50 pointer-events-none')}>
        <Field label="Provedor" hint="Cada provedor exige credenciais específicas">
          <select value={config.provider} onChange={e => onChange({ provider: e.target.value as any })} className="input">
            <option value="twilio">Twilio</option>
            <option value="meta-cloud">Meta Cloud API</option>
            <option value="evolution-api">Evolution API (self-hosted)</option>
          </select>
        </Field>
        <Field label="Número remetente (E.164)" hint="+5511999999999">
          <input type="tel" value={config.fromNumber} onChange={e => onChange({ fromNumber: e.target.value })}
                 placeholder="+5511999999999" className="input" />
        </Field>
        <Field
          label={config.provider === 'twilio' ? 'Account SID' : config.provider === 'meta-cloud' ? 'Business Account ID' : 'Instance ID'}
        >
          <input type="text" value={config.accountSid} onChange={e => onChange({ accountSid: e.target.value })}
                 placeholder={config.provider === 'twilio' ? 'ACxxxxxxxxxx' : config.provider === 'meta-cloud' ? '1234567890' : 'instance-name'}
                 className="input font-mono" />
        </Field>
        <Field
          label={config.provider === 'twilio' ? 'Auth Token' : config.provider === 'meta-cloud' ? 'Access Token' : 'API Key'}
        >
          <input type="password" value={config.authToken} onChange={e => onChange({ authToken: e.target.value })}
                 placeholder="••••••••" className="input" autoComplete="new-password" />
        </Field>
      </div>

      <RecipientsEditor
        disabled={!config.enabled}
        label="Destinatários (E.164)"
        placeholder="+5511988887777"
        type="tel"
        items={config.recipients}
        onChange={(recipients) => onChange({ recipients })}
        validate={(v) => /^\+[1-9]\d{7,14}$/.test(v) || 'Use formato E.164: +5511999999999'}
      />

      <TestButton disabled={!config.enabled} channel="whatsapp" />
    </div>
  )
}

// ── Telegram ─────────────────────────────────────────────────────────────
function TelegramChannelTab({
  config, onChange,
}: {
  config: TelegramChannelConfig
  onChange: (patch: Partial<TelegramChannelConfig>) => void
}) {
  return (
    <div className="space-y-4">
      <ChannelHeader
        enabled={config.enabled}
        onToggle={v => onChange({ enabled: v })}
        icon={<Send className="w-4 h-4 text-sky-700 dark:text-sky-400" />}
        label="Telegram Bot"
        hint="Crie um bot em @BotFather e adicione-o ao grupo/canal de alertas"
      />

      <div className={cn('grid grid-cols-1 gap-3', !config.enabled && 'opacity-50 pointer-events-none')}>
        <Field label="Bot Token" hint="Obtido em @BotFather após /newbot">
          <input type="password" value={config.botToken} onChange={e => onChange({ botToken: e.target.value })}
                 placeholder="1234567890:ABCdefGhIjKlmNoPqRstUVwxYZ1234567"
                 className="input font-mono text-[11px]" autoComplete="new-password" />
        </Field>
      </div>

      <RecipientsEditor
        disabled={!config.enabled}
        label="Chat IDs / Canais"
        placeholder="-1001234567890 ou @canal-alertas"
        type="text"
        items={config.chatIds}
        onChange={(chatIds) => onChange({ chatIds })}
        validate={(v) => /^(-?\d+|@[a-zA-Z0-9_]{5,})$/.test(v) || 'Use -1001234567890 ou @handle'}
      />

      <div className="text-[10px] text-slate-500 leading-relaxed">
        <strong className="text-slate-700 dark:text-slate-400">Como obter o Chat ID:</strong> adicione o bot ao grupo/canal,
        envie qualquer mensagem e acesse{' '}
        <code className="text-cyan-700 dark:text-cyan-300">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>{' '}
        — o campo <code className="text-cyan-700 dark:text-cyan-300">chat.id</code> traz o valor.
      </div>

      <TestButton disabled={!config.enabled} channel="telegram" />
    </div>
  )
}

// ── Helpers dos canais ───────────────────────────────────────────────────
function ChannelHeader({
  enabled, onToggle, icon, label, hint,
}: {
  enabled: boolean; onToggle: (v: boolean) => void
  icon: React.ReactNode; label: string; hint: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/5">
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0 mt-0.5">{icon}</div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-900 dark:text-white">{label}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>
        </div>
      </div>
      <button
        onClick={() => onToggle(!enabled)}
        className={cn(
          'relative w-10 h-5 rounded-full transition shrink-0 mt-1',
          enabled ? 'bg-cyan-500' : 'bg-slate-300 dark:bg-white/10',
        )}
        aria-pressed={enabled}
      >
        <span className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
          enabled && 'translate-x-5',
        )} />
      </button>
    </div>
  )
}

function RecipientsEditor({
  disabled, label, placeholder, type, items, onChange, validate,
}: {
  disabled?: boolean
  label: string
  placeholder: string
  type: 'text' | 'email' | 'tel'
  items: string[]
  onChange: (items: string[]) => void
  validate: (value: string) => true | string
}) {
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function add() {
    const v = draft.trim()
    if (!v) return
    const r = validate(v)
    if (r !== true) { setErr(r); return }
    if (items.includes(v)) { setErr('Já adicionado'); return }
    onChange([...items, v])
    setDraft(''); setErr(null)
  }
  function remove(i: number) { onChange(items.filter((_, idx) => idx !== i)) }

  return (
    <section className={cn('space-y-2', disabled && 'opacity-50 pointer-events-none')}>
      <h3 className="text-[11px] uppercase text-slate-500 tracking-wider">{label}</h3>
      <div className="flex gap-2">
        <input
          type={type}
          value={draft}
          onChange={e => { setDraft(e.target.value); setErr(null) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder}
          className="input flex-1"
        />
        <button
          onClick={add}
          className="px-3 py-2 rounded-lg bg-cyan-100 border border-cyan-200 text-cyan-700 hover:bg-cyan-200 dark:bg-cyan-500/15 dark:border-cyan-500/30 dark:text-cyan-300 dark:hover:bg-cyan-500/25 text-xs font-semibold flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Adicionar
        </button>
      </div>
      {err && <p className="text-[10px] text-rose-700 dark:text-rose-400">{err}</p>}
      {items.length === 0 ? (
        <p className="text-[10px] text-slate-500 italic">Nenhum destinatário adicionado ainda.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/5">
              <span className="text-xs text-slate-800 dark:text-slate-200 font-mono truncate">{it}</span>
              <button
                onClick={() => remove(i)}
                className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-500/15 text-slate-500 hover:text-rose-700 dark:hover:text-rose-300"
                aria-label="Remover destinatário"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TestButton({ disabled, channel }: { disabled: boolean; channel: 'email' | 'whatsapp' | 'telegram' }) {
  const [state, setState] = useState<'idle' | 'sending' | 'scaffold'>('idle')

  function test() {
    if (disabled) return
    setState('sending')
    // Backend ainda não implementa POST /notifications/test — mostrar aviso scaffold.
    setTimeout(() => setState('scaffold'), 600)
  }

  const labelFor = {
    email:    'Enviar e-mail de teste',
    whatsapp: 'Enviar mensagem de teste',
    telegram: 'Enviar mensagem de teste',
  }[channel]

  return (
    <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-white/5">
      <div className="text-[10px] text-slate-500">
        {state === 'scaffold' ? (
          <span className="text-amber-600 dark:text-amber-300 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Endpoint <code>POST /notifications/test</code> ainda não implementado no backend — scaffold salvo localmente.
          </span>
        ) : (
          <span>Dispara um envio de teste para validar credenciais.</span>
        )}
      </div>
      <button
        onClick={test}
        disabled={disabled || state === 'sending'}
        className={cn(
          'px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shrink-0',
          !disabled
            ? 'bg-cyan-500 hover:bg-cyan-400 text-white'
            : 'bg-slate-100 dark:bg-white/5 text-slate-500 cursor-not-allowed',
        )}
      >
        {state === 'sending'
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Send className="w-3.5 h-3.5" />
        }
        {labelFor}
      </button>
    </div>
  )
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold border shrink-0',
      enabled
        ? 'bg-emerald-100 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300'
        : 'bg-slate-100 border-slate-200 text-slate-700 dark:bg-slate-500/10 dark:border-slate-500/30 dark:text-slate-400',
    )}>
      {enabled ? <CheckCircle2 className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
      {enabled ? 'Canais ativos' : 'Nenhum canal ativo'}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BILLING
// ═══════════════════════════════════════════════════════════════════════════
function BillingSection() {
  const { data, isLoading, error } = useQuotaStatus()

  if (isLoading) return <LoadingCard text="Carregando uso..." />
  if (error) return <ErrorCard text="Falha ao carregar status de quota (este endpoint pode não estar disponível para o seu papel)." />

  // Cast pra any pois esta seção é legacy — UI nova canônica é /quota.
  const d: any = data
  const usage: any[] = d?.items ?? d?.usage ?? []
  const summary: any = d?.summary ?? d

  return (
    <div className="space-y-4">
      <GlassCard className="p-5">
        <header className="mb-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Uso de APIs & Quota</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Consumo atual de Vertex AI, armazenamento e outros recursos contratados</p>
        </header>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <QuotaStat label="Ciclo"     value={summary.cycleLabel ?? summary.cycle ?? '—'} />
            <QuotaStat label="Vertex AI" value={summary.vertexCalls ?? 0} suffix="chamadas" />
            <QuotaStat label="Storage"   value={summary.storageGb ?? 0}   suffix="GB" />
            <QuotaStat label="Eventos"   value={summary.events ?? 0} />
          </div>
        )}

        {Array.isArray(usage) && usage.length > 0 ? (
          <div className="space-y-2">
            {usage.map((q: any, i: number) => {
              const pct = Math.min(100, Math.round(((q.used ?? 0) / Math.max(1, q.limit ?? 1)) * 100))
              return (
                <div key={i} className="p-3 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-800 dark:text-slate-300 font-semibold">{q.resource ?? q.name ?? `Recurso #${i + 1}`}</span>
                    <span className="font-mono text-slate-700 dark:text-slate-400">
                      {q.used ?? 0} / {q.limit ?? '∞'} {q.unit ?? ''}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
                    <div
                      className={cn(
                        'h-full transition-all',
                        pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-cyan-500',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500 text-center py-6">
            Nenhum dado de consumo disponível neste ciclo.
          </p>
        )}
      </GlassCard>

      <GlassCard className="p-5">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
          Faturamento
        </h3>
        <p className="text-xs text-slate-500">
          Faturas, meio de pagamento e ciclo de cobrança serão geridos pelo seu Integrador responsável.
          Em caso de dúvidas, entre em contato com o suporte.
        </p>
      </GlassCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ABOUT
// ═══════════════════════════════════════════════════════════════════════════
function AboutSection() {
  const buildTime = (import.meta as any).env?.VITE_BUILD_TIME ?? 'dev'
  const version   = (import.meta as any).env?.VITE_APP_VERSION ?? '1.0.0-dev'

  return (
    <GlassCard className="p-5 space-y-4">
      <header className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-brand-gradient flex items-center justify-center shadow-sky-glow overflow-hidden">
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-white" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7 15h10a4 4 0 0 0 0-8 5 5 0 0 0-9.7-1A3.5 3.5 0 0 0 7 15Z"
                  stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(255,255,255,0.14)" />
            <circle cx="12" cy="11" r="2.3" fill="currentColor" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">IA Cloud Vision</h2>
          <p className="text-[11px] text-slate-500">Analytics Platform · VSaaS multi-tenant</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <InfoRow label="Versão"      value={version}   mono />
        <InfoRow label="Build"       value={buildTime} mono />
        <InfoRow label="Ambiente"    value={(import.meta as any).env?.MODE ?? 'development'} mono />
        <InfoRow label="API URL"     value={(import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3000'} mono />
      </div>

      <div className="pt-3 border-t border-slate-200 dark:border-white/5 space-y-2">
        <a href={`${(import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3000'}/docs`}
           target="_blank" rel="noreferrer"
           className="flex items-center justify-between p-2.5 rounded-lg bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/5 dark:hover:bg-cyan-500/10 dark:border-cyan-500/20 dark:text-cyan-200 text-xs">
          <span className="flex items-center gap-2"><BookOpen className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400" /> API Reference (OpenAPI 3.1 / Swagger UI)</span>
          <ExternalLink className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400" />
        </a>
        <a href={`${(import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3000'}/openapi.json`}
           target="_blank" rel="noreferrer"
           className="flex items-center justify-between p-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-slate-300 text-xs">
          <span className="flex items-center gap-2"><Webhook className="w-3.5 h-3.5 text-violet-700 dark:text-violet-400" /> openapi.json (raw)</span>
          <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
        </a>
        <a href="https://cloud.google.com/vertex-ai" target="_blank" rel="noreferrer"
           className="flex items-center justify-between p-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-slate-300 text-xs">
          <span className="flex items-center gap-2"><Zap className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" /> Documentação Vertex AI</span>
          <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
        </a>
      </div>
    </GlassCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint Q.1 + Q.2 + E.2 — Integrations
// ═══════════════════════════════════════════════════════════════════════════
function IntegrationsSection() {
  return (
    <div className="space-y-4">
      <WebPushCard />
      <PwaInstallCard />
      <MqttCard />
    </div>
  )
}

function WebPushCard() {
  const push = usePushSubscription()
  const { data: subs } = usePushSubscriptions()
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)

  async function handleTest() {
    setTesting(true)
    setTestMsg(null)
    try {
      await push.test({ title: '✓ IA Cloud Vision', body: 'Notificação de teste recebida com sucesso.' })
      setTestMsg('Push de teste enviado.')
    } catch {
      setTestMsg('Falha ao enviar — veja erro acima.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <GlassCard className="p-5 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Bell className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
            Notificações Push (WebPush VAPID)
            {push.simulated && <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30 font-mono uppercase">simulado</span>}
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Recebe alertas críticos mesmo com a aba fechada — usa o Service Worker do navegador.
          </p>
        </div>
        <span className={cn(
          'px-2 py-1 rounded-md text-[10px] font-mono uppercase',
          push.subscribed
            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
            : 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/5 dark:text-slate-400 dark:border-white/10',
        )}>
          {push.subscribed ? 'ativo' : 'inativo'}
        </span>
      </header>

      {!push.supported && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-500/5 dark:border-amber-500/20 dark:text-amber-300 text-[11px] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Seu navegador não suporta WebPush. Use Chrome, Edge, Firefox ou Safari ≥ 16.</span>
        </div>
      )}

      {push.permission === 'denied' && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/5 dark:border-rose-500/20 dark:text-rose-300 text-[11px] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Permissão negada. Vá nas configurações do navegador (cadeado na barra de URL → Notificações → Permitir) e tente novamente.</span>
        </div>
      )}

      {push.error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/5 dark:border-rose-500/20 dark:text-rose-300 text-[11px]">
          {push.error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!push.subscribed ? (
          <button
            onClick={push.enable}
            disabled={!push.supported || push.loading || push.permission === 'denied'}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-100 hover:bg-cyan-200 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:hover:bg-cyan-500/25 dark:border-cyan-500/30 dark:text-cyan-200 text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {push.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
            Ativar notificações neste dispositivo
          </button>
        ) : (
          <>
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-100 hover:bg-emerald-200 border border-emerald-200 text-emerald-700 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 dark:border-emerald-500/30 dark:text-emerald-200 text-xs font-semibold transition disabled:opacity-40"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Enviar push de teste
            </button>
            <button
              onClick={push.disable}
              disabled={push.loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-slate-300 text-xs font-semibold transition disabled:opacity-40"
            >
              {push.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Desativar
            </button>
          </>
        )}
      </div>

      {testMsg && <p className="text-[11px] text-slate-700 dark:text-slate-400">{testMsg}</p>}

      {subs?.items && subs.items.length > 0 && (
        <div className="pt-3 border-t border-slate-200 dark:border-white/5">
          <h3 className="text-[10px] uppercase text-slate-500 tracking-wider mb-2">
            Dispositivos inscritos ({subs.items.length})
          </h3>
          <div className="space-y-1.5">
            {subs.items.map(s => (
              <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/5">
                <Smartphone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-slate-800 dark:text-slate-200 truncate">{shortUA(s.userAgent)}</p>
                  <p className="text-[9px] text-slate-500 font-mono truncate">{new URL(s.endpoint).host}</p>
                </div>
                {s.failureCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30 font-mono">
                    {s.failureCount} falhas
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  )
}

function shortUA(ua: string | null): string {
  if (!ua) return 'Navegador desconhecido'
  if (/Chrome\//.test(ua) && !/Edg/.test(ua)) return 'Chrome'
  if (/Edg\//.test(ua))     return 'Edge'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari'
  return ua.slice(0, 40) + (ua.length > 40 ? '…' : '')
}

function PwaInstallCard() {
  const [deferred, setDeferred] = useState<any>(null)
  const [installed, setInstalled] = useState<boolean>(
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,
  )

  useEffect(() => {
    const onPrompt = (e: any) => { e.preventDefault(); setDeferred(e) }
    const onInstalled = () => { setInstalled(true); setDeferred(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function handleInstall() {
    if (!deferred) return
    deferred.prompt()
    try { await deferred.userChoice } catch {/* ignore */}
    setDeferred(null)
  }

  return (
    <GlassCard className="p-5 space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <MonitorSmartphone className="w-4 h-4 text-violet-700 dark:text-violet-400" />
            Instalar como App (PWA)
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Acesso rápido em desktop ou mobile, abre em janela própria sem barra do navegador.
          </p>
        </div>
        <span className={cn(
          'px-2 py-1 rounded-md text-[10px] font-mono uppercase',
          installed
            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
            : 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/5 dark:text-slate-400 dark:border-white/10',
        )}>
          {installed ? 'instalado' : 'não instalado'}
        </span>
      </header>

      {!installed && (
        deferred ? (
          <button
            onClick={handleInstall}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-100 hover:bg-violet-200 border border-violet-200 text-violet-700 dark:bg-violet-500/15 dark:hover:bg-violet-500/25 dark:border-violet-500/30 dark:text-violet-200 text-xs font-semibold transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Instalar IA Cloud Vision
          </button>
        ) : (
          <p className="text-[11px] text-slate-500">
            No Chrome/Edge: clique no ícone de instalação na barra de URL. No Safari iOS: <em>Compartilhar → Adicionar à Tela de Início</em>.
          </p>
        )
      )}
    </GlassCard>
  )
}

function MqttCard() {
  // Card resumido — versão completa em /integrations/mqtt (MqttConsolePage).
  const { data: status } = useMqttStatus()
  const { data: catalog } = useMqttTopicsCatalog()

  const connected = !!status?.connected
  const brokerSet = !!status?.brokerUrl

  return (
    <GlassCard className="p-5 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Wifi className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            MQTT Broker
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Hierarquia <code className="text-cyan-700 dark:text-cyan-300">iacv/&lt;integradorId&gt;/...</code> — espelha tópicos Frigate para integração com NVRs e Home Assistant.
          </p>
        </div>
        <span className={cn(
          'px-2 py-1 rounded-md text-[10px] font-mono uppercase',
          connected
            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
            : 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/5 dark:text-slate-400 dark:border-white/10',
        )}>
          {connected ? 'conectado' : brokerSet ? 'desconectado' : 'noop'}
        </span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[10px]">
        <KvBadge label="Broker configurado" ok={brokerSet} />
        <KvBadge label="Conexão ativa" ok={connected} />
        <div className="p-2 rounded-md bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/5">
          <p className="text-slate-500 uppercase tracking-wider">Tópicos catálogo</p>
          <p className="text-slate-800 dark:text-slate-200 font-mono">{catalog?.topics?.length ?? '—'}</p>
        </div>
      </div>

      {!brokerSet && (
        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-500/5 dark:border-amber-500/20 dark:text-amber-300 text-[11px]">
          <code>IACV_MQTT_BROKER_URL</code> não configurado. Publisher em modo NOOP (apenas loga). Configure variável de ambiente para ativar.
        </div>
      )}

      <Link
        to="/integrations/mqtt"
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-100 hover:bg-cyan-200 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:hover:bg-cyan-500/25 dark:border-cyan-500/30 dark:text-cyan-200 text-xs font-semibold transition"
      >
        <Send className="w-3.5 h-3.5" />
        Abrir console MQTT
      </Link>
    </GlassCard>
  )
}

function KvBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={cn('p-2 rounded-md border', ok ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/5 dark:border-emerald-500/20' : 'bg-slate-50 border-slate-200 dark:bg-white/[0.03] dark:border-white/5')}>
      <p className="text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={cn('font-mono', ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-400')}>{ok ? 'sim' : 'não'}</p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers de UI
// ═══════════════════════════════════════════════════════════════════════════
function Field({ label, icon, hint, children }: { label: string; icon?: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1 mb-1">
        {icon} {label}
      </span>
      {children}
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </label>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn('text-xs text-slate-800 dark:text-slate-200 mt-0.5 truncate', mono && 'font-mono')}>{value}</p>
    </div>
  )
}

function OrgRow({ icon, label, name, sub }: { icon: React.ReactNode; label: string; name: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/5">
      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase text-slate-500 tracking-wider">{label}</p>
        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{name}</p>
        {sub && <p className="text-[10px] text-slate-500 truncate">{sub}</p>}
      </div>
    </div>
  )
}

function ToggleRow({
  label, desc, value, onChange, color = 'cyan',
}: {
  label: string; desc: string; value: boolean; onChange: (v: boolean) => void; color?: 'cyan' | 'rose' | 'amber'
}) {
  const colorMap = {
    cyan:  'bg-cyan-500',
    rose:  'bg-rose-500',
    amber: 'bg-amber-500',
  }
  return (
    <div className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 dark:bg-white/[0.02] dark:hover:bg-white/[0.04] dark:border-white/5 transition">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-900 dark:text-white">{label}</p>
        <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          'relative w-9 h-5 rounded-full transition shrink-0 mt-0.5',
          value ? colorMap[color] : 'bg-slate-300 dark:bg-white/10',
        )}
        aria-pressed={value}
      >
        <span className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
          value && 'translate-x-4',
        )} />
      </button>
    </div>
  )
}

function ThemeOption({ icon, label, active, disabled }: { icon: React.ReactNode; label: string; active?: boolean; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      className={cn(
        'p-3 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-semibold transition',
        active
          ? 'bg-cyan-100 border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:border-cyan-500/40 dark:text-cyan-300'
          : 'bg-slate-100 border-slate-200 text-slate-700 dark:bg-white/5 dark:border-white/10 dark:text-slate-400',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function QuotaStat({ label, value, suffix }: { label: string; value: any; suffix?: string }) {
  return (
    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/5">
      <p className="text-[9px] uppercase text-slate-500 tracking-wider">{label}</p>
      <p className="text-lg font-bold text-slate-900 dark:text-white mt-0.5 truncate">
        {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
        {suffix && <span className="text-[10px] text-slate-500 font-normal ml-1">{suffix}</span>}
      </p>
    </div>
  )
}

function PasswordStrength({ score }: { score: number }) {
  const labels = ['muito fraca', 'fraca', 'média', 'forte', 'muito forte']
  const colors = ['bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-cyan-500']
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className={cn('h-1 flex-1 rounded-full', i <= score ? colors[score] : 'bg-slate-200 dark:bg-white/5')} />
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-1">Força: <span className="text-slate-800 dark:text-slate-300">{labels[score]}</span></p>
    </div>
  )
}

function scorePassword(pw: string): number {
  if (pw.length < 8) return 0
  let s = 0
  if (pw.length >= 10) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^a-zA-Z0-9]/.test(pw)) s++
  return Math.min(4, s)
}

function LoadingCard({ text }: { text: string }) {
  return (
    <GlassCard className="p-8 flex flex-col items-center justify-center gap-2 text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      <p className="text-xs">{text}</p>
    </GlassCard>
  )
}

function ErrorCard({ text }: { text: string }) {
  return (
    <GlassCard className="p-6 flex items-start gap-3 border-rose-500/30">
      <AlertTriangle className="w-5 h-5 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">Erro ao carregar</p>
        <p className="text-[11px] text-slate-700 dark:text-slate-400 mt-1">{text}</p>
      </div>
    </GlassCard>
  )
}
