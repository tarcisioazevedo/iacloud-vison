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
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
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
  RefreshCw, Unlink, Link2, PhoneCall, ScanLine, WifiOff, CircleCheck, Users,
  Server, FileText, FlaskConical, RotateCcw, Lock,
  AlertCircle, BellOff, MailCheck, History, Settings2, X, ChevronDown, ChevronUp,
  Camera, Folder, File, Image, Video, ArrowLeft, Download, Play,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PremiumHero } from '../components/hierarchy'
import { WhatsAppRecipientsPanel } from '../components/notifications/WhatsAppRecipientsPanel'
import { WhatsAppLogsPanel } from '../components/notifications/WhatsAppLogsPanel'
import {
  useMe, updateMe, changePassword, useQuotaStatus,
  useMqttStatus, useMqttTopicsCatalog,
  usePushSubscriptions,
  useEmailSmtpConfig, saveEmailSmtpConfig, testEmailSmtp,
  useEmailTemplates, saveEmailTemplate, resetEmailTemplate,
  useAlertRecipients, saveAlertRecipient, deleteAlertRecipient, testAlertRecipient,
  useAlertConfig, saveAlertConfig,
  useAlertDeliveries, retryAlertDelivery,
  type AlertRecipient, type AlertConfig, type AlertDelivery,
  api, formatApiError, BASE_URL,
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
  { id: 'email',         label: 'E-mail',        icon: Mail,        desc: 'SMTP e templates de e-mail' },
  { id: 'alerts',        label: 'Alertas',       icon: AlertCircle, desc: 'Destinatários e histórico de alertas' },
  { id: 'storage',       label: 'Storage',       icon: Server,      desc: 'Armazenamento S3 para gravações' },
  { id: 'billing',       label: 'Uso & Quota',   icon: Receipt,     desc: 'Consumo de APIs e faturamento' },
  { id: 'sentry',        label: 'Sentry',        icon: AlertTriangle, desc: 'Monitoramento de erros (Super Admin)' },
  { id: 'about',         label: 'Sobre',         icon: Info,        desc: 'Versão, build e suporte' },
] as const
type SectionId = typeof SECTIONS[number]['id']

export function SettingsPage() {
  const [section, setSection] = useState<SectionId>('profile')
  const { data: me } = useMe()

  // Seções restritas por kind (mostra todas enquanto carrega)
  const isAdminOrIntegrador = !me || me.kind === 'SUPER_ADMIN' || me.kind === 'INTEGRADOR'
  const isSuperAdmin = me?.kind === 'SUPER_ADMIN'
  const visibleSections = SECTIONS.filter(s => {
    if (s.id === 'storage') return isAdminOrIntegrador
    if (s.id === 'email') return isAdminOrIntegrador
    if (s.id === 'sentry') return isSuperAdmin
    return true
  })

  return (
    <div className="space-y-4">
      {/* Hero premium (Onda 6.G) */}
      <PremiumHero
        emoji="⚙️"
        title="Configurações"
        subtitle="Perfil, segurança, preferências, notificações e faturamento"
        accent="cyan"
        tags={[
          { label: '2FA disponível', color: 'emerald' },
          { label: visibleSections.length + ' seções', color: 'cyan' },
        ]}
      />

      {/* Grid com nav lateral + conteúdo */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Nav lateral */}
        <GlassCard className="p-2 lg:col-span-1 h-fit">
          <nav className="space-y-0.5">
            {visibleSections.map(s => {
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
            {section === 'email'         && <EmailSection />}
            {section === 'alerts'        && <AlertsSection />}
            {section === 'storage'       && <StorageSection />}
            {section === 'billing'       && <BillingSection />}
            {section === 'sentry'        && <SentrySection />}
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

// Roles que usam a instância Evolution gerenciada pelo sistema (não trazem próprios Twilio/Meta)
const CLIENTE_ROLES = ['CLIENTE_ADMIN', 'CLIENTE_SUPERVISOR', 'CLIENTE_OPERADOR']
const _role = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
const isClienteRole = CLIENTE_ROLES.includes(_role)

function loadChannels(): NotificationChannelsConfig {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    const base = {
      ...DEFAULT_CHANNELS,
      ...parsed,
      severityRouting: { ...DEFAULT_CHANNELS.severityRouting, ...(parsed.severityRouting ?? {}) },
      email:    { ...DEFAULT_CHANNELS.email,    ...(parsed.email    ?? {}) },
      whatsapp: { ...DEFAULT_CHANNELS.whatsapp, ...(parsed.whatsapp ?? {}) },
      telegram: { ...DEFAULT_CHANNELS.telegram, ...(parsed.telegram ?? {}) },
    }
    // CLIENTE roles usam sempre Evolution API gerenciada
    if (isClienteRole) {
      base.whatsapp.provider = 'evolution-api'
      base.whatsapp.enabled  = true
    }
    return base
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

        {channels.whatsapp.provider !== 'evolution-api' && (
          <div className="p-3 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 dark:bg-violet-500/5 dark:border-violet-500/20 dark:text-violet-300 text-[11px] flex items-start gap-2">
            <Webhook className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong className="text-violet-800 dark:text-violet-200">Credenciais Twilio/Meta Cloud</strong>{' '}
              ficam salvas localmente neste navegador. O envio real via esses provedores
              será ativado em sprint futura. Para envio imediato, use{' '}
              <strong>Evolution API (self-hosted)</strong>.
            </div>
          </div>
        )}
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

interface EvolutionChannel {
  id: string
  instanceName: string
  instanceId: string | null
  connectionState: string
  phoneNumber: string | null
  profileName: string | null
  pairingCode: string | null
  qrCodePayload: string | null
  lastQrAt: string | null
  lastConnectedAt: string | null
  isActive: boolean
  recipients: string[]
}

const QR_POLL_INTERVAL = 5_000   // 5s
const QR_EXPIRY_SECS   = 60      // QR expira em 60s

// Resolve a URL base do painel WhatsApp por persona.
// - SUPER_ADMIN/ADMIN_GLOBAL: usa instância "do sistema" (singleton) em /admin/notifications/whatsapp
//   → para alertas comerciais (leads, demos) e notificações de plataforma do fabricante
// - CLIENTE_*: usa /notifications/whatsapp (backend resolve via JWT.clienteFinalId)
// - INTEGRADOR_*: hoje recebe a instância via gestão dos clientes finais
//   (painel /clientes-finais já tem WhatsAppModal para cada cliente). Aqui exibe aviso.
const SUPER_ROLES = ['SUPER_ADMIN', 'ADMIN_GLOBAL']
const _isSuperRole = SUPER_ROLES.includes(_role)
const _isIntegradorRole = ['INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'].includes(_role)
const WHATSAPP_BASE = _isSuperRole
  ? '/admin/notifications/whatsapp'  // instância singleton do fabricante
  : '/notifications/whatsapp'        // CLIENTE_* (escopo via JWT)

function EvolutionPairingPanel({
  config, onChange,
}: {
  config: WhatsAppChannelConfig
  onChange: (patch: Partial<WhatsAppChannelConfig>) => void
}) {
  const [channel, setChannel]         = useState<EvolutionChannel | null>(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [testPhone, setTestPhone]     = useState('')
  const [testMsg, setTestMsg]         = useState('')
  const [testResult, setTestResult]   = useState<string | null>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [qrExpiry, setQrExpiry]       = useState<number>(QR_EXPIRY_SECS)
  const [logsKey, setLogsKey]         = useState(0)
  const [subTab, setSubTab]           = useState<'conexao' | 'destinatarios' | 'extrato'>('conexao')
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isConnected  = channel?.connectionState === 'open'
  const isConnecting = channel?.connectionState === 'connecting' || (channel?.connectionState === 'close' && !!channel?.qrCodePayload)
  const shouldPoll   = isConnecting && !isConnected

  // Carrega estado inicial
  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const { data } = await api.get(WHATSAPP_BASE)
      setChannel(data.channel ?? null)
      if (data.channel?.connectionState === 'open') stopPolling()
    } catch (e) {
      if (!silent) setError(formatApiError(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // Polling automático quando aguardando scan
  function stopPolling() {
    if (pollRef.current)  { clearInterval(pollRef.current);  pollRef.current  = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  useEffect(() => {
    if (shouldPoll && !pollRef.current) {
      setQrExpiry(QR_EXPIRY_SECS)
      pollRef.current  = setInterval(() => fetchStatus(true), QR_POLL_INTERVAL)
      timerRef.current = setInterval(() => setQrExpiry(s => Math.max(0, s - 1)), 1_000)
    }
    if (!shouldPoll) stopPolling()
    return stopPolling
  }, [shouldPoll, fetchStatus])

  // Provisiona / reconecta instância
  async function handleProvision() {
    setLoading(true); setError(null)
    try {
      const { data } = await api.post(`${WHATSAPP_BASE}/instance`)
      setChannel(data.channel)
      setQrExpiry(QR_EXPIRY_SECS)
    } catch (e) { setError(formatApiError(e)) }
    finally { setLoading(false) }
  }

  // Renova QR
  async function handleRefresh() {
    setLoading(true); setError(null)
    try {
      const { data } = await api.post(`${WHATSAPP_BASE}/refresh`)
      setChannel(data.channel)
      setQrExpiry(QR_EXPIRY_SECS)
    } catch (e) { setError(formatApiError(e)) }
    finally { setLoading(false) }
  }

  // Logout (desconecta WhatsApp)
  async function handleLogout() {
    if (!confirm('Desconectar WhatsApp? O número precisará escanear o QR novamente.')) return
    setLoading(true); setError(null)
    try {
      const { data } = await api.post(`${WHATSAPP_BASE}/logout`)
      setChannel(data.channel)
      onChange({ enabled: false })
    } catch (e) { setError(formatApiError(e)) }
    finally { setLoading(false) }
  }

  // Excluir instância
  async function handleDelete() {
    if (!confirm('Excluir instância? Todo histórico será removido.')) return
    setLoading(true); setError(null)
    try {
      await api.post(`${WHATSAPP_BASE}/delete`)
      setChannel(null)
      onChange({ enabled: false })
    } catch (e) { setError(formatApiError(e)) }
    finally { setLoading(false) }
  }

  // Enviar mensagem de teste
  async function handleTest() {
    if (!testPhone) return
    setTestLoading(true); setTestResult(null)
    try {
      await api.post(`${WHATSAPP_BASE}/test`, {
        phoneNumber: testPhone,
        message: testMsg || undefined,
      })
      setTestResult('✅ Mensagem enviada com sucesso!')
      setLogsKey(k => k + 1)  // força reload do extrato
    } catch (e) {
      setTestResult('❌ ' + formatApiError(e))
      setLogsKey(k => k + 1)  // também registra falhas
    } finally { setTestLoading(false) }
  }

  // Renderiza QR Code (base64 image ou placeholder)
  const qrEl = channel?.qrCodePayload
    ? channel.qrCodePayload.startsWith('data:image/')
      ? <img src={channel.qrCodePayload} alt="QR Code WhatsApp" className="w-52 h-52 rounded-xl object-contain" />
      : <div className="w-52 h-52 flex items-center justify-center bg-white rounded-xl border-2 border-emerald-400 p-3">
          <ScanLine className="w-16 h-16 text-emerald-500" />
        </div>
    : null

  // Quando conecta, muda sub-aba para conexão para mostrar status
  useEffect(() => {
    if (isConnected && subTab === 'conexao') return
    // não faz nada — usuário controla a aba
  }, [isConnected]) // eslint-disable-line

  // Sub-abas do painel WhatsApp
  const WA_SUBTABS = [
    { id: 'conexao'      as const, label: 'Conexão',       icon: Wifi,          badge: isConnected ? '●' : undefined, badgeColor: 'text-emerald-500' },
    { id: 'destinatarios' as const, label: 'Destinatários', icon: Users,         badge: channel ? String(channel.recipients.length) : undefined },
    { id: 'extrato'      as const, label: 'Extrato',        icon: MessageCircle, badge: undefined },
  ] as const

  return (
    <div className="space-y-3">
      {/* Sub-nav interna */}
      <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/8">
        {WA_SUBTABS.map(t => {
          const Icon = t.icon
          const active = subTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap flex-1 justify-center transition',
                active
                  ? 'bg-white dark:bg-white/10 shadow-sm text-slate-900 dark:text-white border border-slate-200 dark:border-white/10'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {t.badge !== undefined && (
                <span className={cn(
                  'text-[9px] px-1.5 py-0 rounded-full font-mono',
                  active ? 'bg-slate-100 dark:bg-white/10' : 'bg-slate-200 dark:bg-white/10',
                  t.badgeColor,
                )}>
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Sub-aba: Conexão ── */}
      {subTab === 'conexao' && (
      <div className="space-y-4">
      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: 'Instância', value: channel?.instanceName ?? '—', mono: true },
          {
            label: 'Conexão',
            value: isConnected ? 'Conectado' : isConnecting ? 'Aguardando scan' : '—',
            color: isConnected ? 'text-emerald-600 dark:text-emerald-400' : isConnecting ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500',
          },
          { label: 'Número vinculado', value: channel?.phoneNumber ? `+${channel.phoneNumber}` : 'Não conectado' },
          { label: 'Perfil', value: channel?.profileName ?? 'Não identificado' },
        ].map(c => (
          <div key={c.label} className="p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
            <p className="text-[9px] uppercase text-slate-500 tracking-wider mb-1">{c.label}</p>
            <p className={cn('text-[11px] font-semibold truncate', c.mono && 'font-mono', c.color ?? 'text-slate-900 dark:text-white')}>{c.value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-[11px] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* QR Code panel */}
      {!isConnected && (
        <div className="flex flex-col md:flex-row gap-4 items-center p-4 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
          {/* QR */}
          <div className="flex flex-col items-center gap-3 shrink-0">
            {channel?.pairingCode && (
              <div className="text-center">
                <p className="text-[10px] uppercase text-slate-500 mb-1">Código de pareamento (digite no celular)</p>
                <p className="text-2xl font-mono font-bold tracking-[0.4em] text-emerald-700 dark:text-emerald-400 select-all">
                  {channel.pairingCode}
                </p>
              </div>
            )}
            {qrEl ? (
              <div className={cn(
                'relative rounded-2xl overflow-hidden',
                'ring-4',
                isConnecting ? 'ring-emerald-400/80 animate-pulse' : 'ring-slate-200 dark:ring-white/10',
              )}>
                {qrEl}
                {/* Countdown bar */}
                {isConnecting && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-200 dark:bg-white/10">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-1000"
                      style={{ width: `${(qrExpiry / QR_EXPIRY_SECS) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="w-52 h-52 flex items-center justify-center rounded-2xl bg-slate-100 dark:bg-white/5 border-2 border-dashed border-slate-300 dark:border-white/10">
                <div className="text-center">
                  <ScanLine className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                  <p className="text-[10px] text-slate-500">QR não disponível</p>
                </div>
              </div>
            )}
            {isConnecting && (
              <p className="text-[10px] text-slate-500 text-center">
                Expira em <strong>{qrExpiry}s</strong> · auto-refresh ativo
              </p>
            )}
          </div>

          {/* Instructions */}
          <div className="flex-1 space-y-3 text-[11px] text-slate-600 dark:text-slate-300">
            <p className="font-semibold text-slate-900 dark:text-white text-sm">Pareamento da instância</p>
            <ol className="space-y-2 list-decimal list-inside">
              <li>Abra o <strong>WhatsApp Business</strong> no celular</li>
              <li>Toque em <strong>Mais opções → Dispositivos conectados → Conectar</strong></li>
              <li>Escaneie o QR Code ao lado <em>ou</em> digite o código de pareamento</li>
              <li>Aguarde a confirmação — a página atualiza automaticamente</li>
            </ol>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={handleProvision}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                {channel ? 'Reconectar / Preparar' : 'Criar instância'}
              </button>
              {channel && (
                <button
                  onClick={handleRefresh}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 dark:bg-white/5 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-60"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Atualizar código
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Connected state — status + ações */}
      {isConnected && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
          <CircleCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">WhatsApp conectado!</p>
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate">
              Número: <strong>{channel?.phoneNumber ? `+${channel.phoneNumber}` : '—'}</strong>
              {channel?.profileName && <> · Perfil: <strong>{channel.profileName}</strong></>}
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={handleLogout}
              disabled={loading}
              title="Desconectar WhatsApp"
              className="px-2.5 py-1.5 rounded-lg bg-amber-100 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px] font-semibold flex items-center gap-1 transition disabled:opacity-60"
            >
              <WifiOff className="w-3.5 h-3.5" /> Logout
            </button>
            <button
              onClick={handleDelete}
              disabled={loading}
              title="Remover instância permanentemente"
              className="px-2.5 py-1.5 rounded-lg bg-rose-100 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-[11px] font-semibold flex items-center gap-1 transition disabled:opacity-60"
            >
              <Trash2 className="w-3.5 h-3.5" /> Excluir
            </button>
          </div>
        </div>
      )}

      {/* ── Envio de mensagem de teste (sempre visível) ── */}
      <div className={cn(
        'rounded-xl border space-y-3 p-4',
        isConnected
          ? 'bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/8'
          : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/5 opacity-60',
      )}>
        <div className="flex items-center gap-2">
          <PhoneCall className={cn('w-4 h-4', isConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')} />
          <p className="text-[11px] font-semibold text-slate-900 dark:text-white">Enviar mensagem de teste</p>
          {!isConnected && (
            <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-2 py-0.5 rounded-full">
              Conecte o WhatsApp para habilitar
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Número de destino" hint="Código do país + DDD + número, sem espaços">
            <input
              type="tel"
              value={testPhone}
              onChange={e => setTestPhone(e.target.value)}
              placeholder="5511999999999"
              disabled={!isConnected}
              className="input disabled:cursor-not-allowed"
            />
          </Field>
          <Field label="Mensagem" hint="Deixe vazio para usar a mensagem padrão de homologação">
            <textarea
              rows={3}
              value={testMsg}
              onChange={e => setTestMsg(e.target.value)}
              placeholder={"Se vazio, envia:\n✅ IA Cloud Vision — Teste de notificação\nCanal WhatsApp conectado com sucesso!"}
              disabled={!isConnected}
              className="input resize-none text-xs leading-relaxed disabled:cursor-not-allowed"
            />
          </Field>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleTest}
            disabled={testLoading || !testPhone || !isConnected}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
            Enviar mensagem de teste
          </button>
          {testResult && (
            <span className={cn(
              'text-[11px] font-medium px-2.5 py-1 rounded-lg border',
              testResult.startsWith('✅')
                ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                : 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20',
            )}>
              {testResult}
            </span>
          )}
        </div>

        {channel?.instanceName && (
          <p className="text-[10px] text-slate-400 dark:text-slate-600">
            Instância: <code className="font-mono">{channel.instanceName}</code> · Engine: Evolution/WHATSAPP-BAILEYS
          </p>
        )}
      </div>

      {/* Excluir instância (só quando desconectado e instância existe) */}
      {channel && !isConnected && (
        <div className="flex justify-end">
          <button
            onClick={handleDelete}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-rose-100 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-[11px] font-semibold flex items-center gap-1.5 transition disabled:opacity-60"
          >
            <Trash2 className="w-3.5 h-3.5" /> Excluir instância
          </button>
        </div>
      )}
      </div>
      )}

      {/* ── Sub-aba: Destinatários ── */}
      {subTab === 'destinatarios' && (
        <div className="rounded-xl border border-slate-200 dark:border-white/8 p-4 min-h-[200px]">
          {channel ? (
            // Permite cadastrar mesmo desconectado (cadastro é metadata).
            // Broadcast continua exigindo conexão.
            <WhatsAppRecipientsPanel
              recipients={channel.recipients ?? []}
              qs=""
              basePath={WHATSAPP_BASE}
              onUpdate={recipients => setChannel(ch => ch ? { ...ch, recipients } : ch)}
              disabled={false}
              broadcastDisabled={!isConnected}
              onLogRefresh={() => setLogsKey(k => k + 1)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Users className="w-10 h-10 text-slate-300 dark:text-slate-600" />
              <div className="text-center max-w-sm">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Cadastre destinatários do WhatsApp
                </p>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Crie a instância para começar a adicionar números que receberão alertas.
                  Você pode cadastrar destinatários antes mesmo de parear o número.
                </p>
              </div>
              <button
                onClick={handleProvision}
                disabled={loading}
                className="mt-2 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 hover:opacity-90 text-white text-xs font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 transition"
              >
                {loading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Plus className="w-3.5 h-3.5" />}
                Criar instância e cadastrar destinatários
              </button>
              <p className="text-[10px] text-slate-400 dark:text-slate-600">
                Você poderá parear o WhatsApp depois, na aba <span className="font-semibold">Conexão</span>.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Sub-aba: Extrato ── */}
      {subTab === 'extrato' && (
        <div className="rounded-xl border border-slate-200 dark:border-white/8 p-4 min-h-[200px]">
          {channel ? (
            <WhatsAppLogsPanel key={logsKey} qs="" autoLoad={true} />
          ) : (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
              <MessageCircle className="w-8 h-8 opacity-40" />
              <p className="text-[11px]">Nenhuma mensagem enviada ainda</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WhatsAppChannelTab({
  config, onChange,
}: {
  config: WhatsAppChannelConfig
  onChange: (patch: Partial<WhatsAppChannelConfig>) => void
}) {
  const isEvolution = config.provider === 'evolution-api'

  return (
    <div className="space-y-4">
      <ChannelHeader
        enabled={config.enabled}
        onToggle={v => onChange({ enabled: v })}
        icon={<MessageCircle className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />}
        label="WhatsApp Business"
        hint={isClienteRole ? 'Instância Evolution API gerenciada pelo integrador' : 'Suporta Twilio, Meta Cloud API ou Evolution API (self-hosted)'}
      />

      {/* Seletor de provedor — somente para roles que podem escolher */}
      {!isClienteRole && (
        <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-3', !config.enabled && 'opacity-50 pointer-events-none')}>
          <Field label="Provedor" hint="Cada provedor exige credenciais específicas">
            <select value={config.provider} onChange={e => onChange({ provider: e.target.value as WhatsAppChannelConfig['provider'] })} className="input">
              <option value="twilio">Twilio</option>
              <option value="meta-cloud">Meta Cloud API</option>
              <option value="evolution-api">Evolution API (self-hosted)</option>
            </select>
          </Field>
          {!isEvolution && (
            <Field label="Número remetente (E.164)" hint="+5511999999999">
              <input type="tel" value={config.fromNumber} onChange={e => onChange({ fromNumber: e.target.value })}
                     placeholder="+5511999999999" className="input" />
            </Field>
          )}
        </div>
      )}

      {/* ── Twilio / Meta Cloud: formulário de credenciais ── */}
      {!isEvolution && (
        <>
          <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-3', !config.enabled && 'opacity-50 pointer-events-none')}>
            <Field label={config.provider === 'twilio' ? 'Account SID' : 'Business Account ID'}>
              <input type="text" value={config.accountSid} onChange={e => onChange({ accountSid: e.target.value })}
                     placeholder={config.provider === 'twilio' ? 'ACxxxxxxxxxx' : '1234567890'}
                     className="input font-mono" />
            </Field>
            <Field label={config.provider === 'twilio' ? 'Auth Token' : 'Access Token'}>
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
        </>
      )}

      {/* ── Evolution API: painel de QR Code / pareamento ── */}
      {isEvolution && config.enabled && _isIntegradorRole && (
        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 text-[12px] flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold mb-1">Cada cliente final tem sua própria instância</p>
            <p className="text-[11px] leading-relaxed">
              Como integrador, você gerencia uma instância <span className="font-mono">WhatsApp</span> por cliente final.
              Acesse <a href="/clientes-finais" className="underline font-semibold">Meus Clientes</a> e clique no botão <span className="font-mono">WhatsApp</span> de cada cliente para provisionar/conectar.
            </p>
          </div>
        </div>
      )}

      {isEvolution && config.enabled && !_isIntegradorRole && (
        <EvolutionPairingPanel config={config} onChange={onChange} />
      )}

      {isEvolution && !config.enabled && (
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-[11px] text-slate-500 text-center">
          Ative o canal acima para configurar a instância Evolution API
        </div>
      )}
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
    if (!v) { setErr('Digite um valor antes de adicionar'); return }
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
          className={cn('input flex-1', err && !draft.trim() && 'ring-2 ring-rose-400 border-rose-400')}
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-2 rounded-lg bg-cyan-100 border border-cyan-200 text-cyan-700 hover:bg-cyan-200 dark:bg-cyan-500/15 dark:border-cyan-500/30 dark:text-cyan-300 dark:hover:bg-cyan-500/25 text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Adicionar
        </button>
      </div>
      {err && <p className="text-[10px] text-rose-700 dark:text-rose-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{err}</p>}
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
        <InfoRow label="API URL"     value={BASE_URL} mono />
      </div>

      <div className="pt-3 border-t border-slate-200 dark:border-white/5 space-y-2">
        <a href={`${BASE_URL}/docs`}
           target="_blank" rel="noreferrer"
           className="flex items-center justify-between p-2.5 rounded-lg bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/5 dark:hover:bg-cyan-500/10 dark:border-cyan-500/20 dark:text-cyan-200 text-xs">
          <span className="flex items-center gap-2"><BookOpen className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400" /> API Reference (OpenAPI 3.1 / Swagger UI)</span>
          <ExternalLink className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400" />
        </a>
        <a href={`${BASE_URL}/openapi.json`}
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

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL SECTION — SMTP + Templates
// ═══════════════════════════════════════════════════════════════════════════
function EmailSection() {
  const [tab, setTab] = useState<'smtp' | 'templates'>('smtp')

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 space-y-4">
        <header>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Mail className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
            E-mail Transacional
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Configure o servidor SMTP para envio de convites, alertas e notificações do sistema
          </p>
        </header>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/5">
          {([
            { id: 'smtp',      label: 'Servidor SMTP', icon: Server   },
            { id: 'templates', label: 'Templates',      icon: FileText },
          ] as const).map(t => {
            const Icon  = t.icon
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
              </button>
            )
          })}
        </div>

        {tab === 'smtp'      && <SmtpConfigTab />}
        {tab === 'templates' && <EmailTemplatesTab />}
      </GlassCard>
    </div>
  )
}

// ── SMTP Config Tab ───────────────────────────────────────────────────────────
function SmtpConfigTab() {
  const { data, isLoading, error, mutate } = useEmailSmtpConfig()

  const [form, setForm] = useState({
    host:        '',
    port:        587,
    secure:      false,
    user:        '',
    pass:        '',
    fromName:    'IA Cloud Vision',
    fromAddress: '',
  })
  const [saving,      setSaving]      = useState(false)
  const [testing,     setTesting]     = useState(false)
  const [testTo,      setTestTo]      = useState('')
  const [saveMsg,     setSaveMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [testMsg,     setTestMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [showPass,    setShowPass]    = useState(false)

  useEffect(() => {
    if (data) {
      setForm({
        host:        data.host,
        port:        data.port,
        secure:      data.secure,
        user:        data.user,
        pass:        data.pass,   // '••••••' se já salvo
        fromName:    data.fromName,
        fromAddress: data.fromAddress,
      })
    }
  }, [data])

  async function handleSave() {
    setSaving(true); setSaveMsg(null)
    try {
      await saveEmailSmtpConfig(form)
      await mutate()
      setSaveMsg({ ok: true, text: 'Configuração salva com sucesso!' })
    } catch (e) {
      setSaveMsg({ ok: false, text: formatApiError(e) })
    } finally { setSaving(false) }
  }

  async function handleTest() {
    if (!testTo) return
    setTesting(true); setTestMsg(null)
    try {
      const res = await testEmailSmtp(testTo)
      setTestMsg(res.ok
        ? { ok: true,  text: `E-mail enviado para ${testTo}` }
        : { ok: false, text: res.error ?? 'Falha SMTP' }
      )
    } catch (e) {
      setTestMsg({ ok: false, text: formatApiError(e) })
    } finally { setTesting(false) }
  }

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  if (isLoading) return (
    <div className="flex items-center gap-2 text-slate-500 text-xs py-4">
      <Loader2 className="w-4 h-4 animate-spin" /> Carregando configuração…
    </div>
  )
  if (error) return (
    <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-300 text-xs flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0" /> {formatApiError(error)}
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Status badge */}
      {data && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold border',
          data.configured
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300'
            : 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-300',
        )}>
          {data.configured
            ? <><CheckCircle2 className="w-3.5 h-3.5" /> SMTP configurado — {data.user}</>
            : <><AlertTriangle className="w-3.5 h-3.5" /> SMTP não configurado — preencha os campos abaixo</>
          }
        </div>
      )}

      {/* Campos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Host SMTP" icon={<Server className="w-3.5 h-3.5" />} hint="Ex: smtp.gmail.com, www701.your-server.de">
          <input
            type="text" value={form.host}
            onChange={e => set('host', e.target.value)}
            placeholder="smtp.seuprovedor.com"
            className="input w-full"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Porta">
            <input
              type="number" value={form.port}
              onChange={e => set('port', Number(e.target.value) || 587)}
              placeholder="587"
              className="input w-full"
            />
          </Field>
          <Field label="SSL/TLS">
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => set('secure', !form.secure)}
                className={cn(
                  'relative w-9 h-5 rounded-full transition',
                  form.secure ? 'bg-cyan-500' : 'bg-slate-300 dark:bg-white/10',
                )}
              >
                <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform', form.secure && 'translate-x-4')} />
              </button>
              <span className="text-[11px] text-slate-600 dark:text-slate-400">{form.secure ? 'SSL (465)' : 'STARTTLS (587)'}</span>
            </div>
          </Field>
        </div>

        <Field label="Usuário SMTP">
          <input
            type="text" value={form.user}
            onChange={e => set('user', e.target.value)}
            placeholder="email@seudominio.com.br"
            className="input w-full"
            autoComplete="username"
          />
        </Field>

        <Field label="Senha" hint="Deixe vazio para manter a senha atual">
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={form.pass}
              onChange={e => set('pass', e.target.value)}
              placeholder="••••••••"
              className="input w-full pr-8"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPass(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </Field>

        <Field label="Nome do remetente">
          <input
            type="text" value={form.fromName}
            onChange={e => set('fromName', e.target.value)}
            placeholder="IA Cloud Vision"
            className="input w-full"
          />
        </Field>

        <Field label="E-mail do remetente">
          <input
            type="email" value={form.fromAddress}
            onChange={e => set('fromAddress', e.target.value)}
            placeholder="no-reply@seudominio.com.br"
            className="input w-full"
          />
        </Field>
      </div>

      {/* Feedback salvar */}
      {saveMsg && (
        <div className={cn(
          'p-3 rounded-lg text-[11px] border flex items-center gap-2',
          saveMsg.ok
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300'
            : 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-300',
        )}>
          {saveMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
          {saveMsg.text}
        </div>
      )}

      {/* Botão salvar */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        Salvar configuração
      </button>

      {/* Teste de envio */}
      <div className="pt-4 border-t border-slate-200 dark:border-white/5 space-y-3">
        <h3 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <FlaskConical className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
          Testar conexão e envio
        </h3>
        <p className="text-[10px] text-slate-500">
          Clique em "Enviar teste" para verificar a conexão SMTP e receber um e-mail de confirmação.
        </p>
        <div className="flex gap-2">
          <input
            type="email" value={testTo}
            onChange={e => setTestTo(e.target.value)}
            placeholder="destinatario@email.com"
            className="input flex-1 text-xs"
          />
          <button
            onClick={handleTest}
            disabled={testing || !testTo || !form.host}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold transition disabled:opacity-60 whitespace-nowrap"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Enviar teste
          </button>
        </div>

        {testMsg && (
          <div className={cn(
            'p-3 rounded-lg text-[11px] border flex items-center gap-2',
            testMsg.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300'
              : 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-300',
          )}>
            {testMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
            {testMsg.text}
          </div>
        )}
      </div>

      {/* Dica de provedores */}
      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/[0.02] dark:border-white/5 text-[10px] text-slate-500 space-y-1">
        <p className="font-semibold text-slate-700 dark:text-slate-300">Configurações comuns:</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
          <span>Gmail: smtp.gmail.com : 587</span>
          <span>Outlook: smtp.office365.com : 587</span>
          <span>Brevo/Sendinblue: smtp-relay.brevo.com : 587</span>
          <span>AWS SES: email-smtp.us-east-1.amazonaws.com : 587</span>
          <span>iacloud.com.br: mail.iacloud.com.br : 587</span>
        </div>
      </div>
    </div>
  )
}

// ── Email Templates Tab ───────────────────────────────────────────────────────
function EmailTemplatesTab() {
  const { data, isLoading, error, mutate } = useEmailTemplates()
  const [selected, setSelected] = useState<string | null>(null)
  const [draft,    setDraft]    = useState<{ subject: string; body: string } | null>(null)
  const [saving,   setSaving]   = useState(false)
  const [resetting, setResetting] = useState(false)
  const [msg,      setMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  const templates = data?.templates ?? []
  const current   = templates.find(t => t.name === selected)

  useEffect(() => {
    if (current) setDraft({ subject: current.subject, body: current.body })
  }, [selected, current?.subject, current?.body])

  async function handleSave() {
    if (!selected || !draft) return
    setSaving(true); setMsg(null)
    try {
      await saveEmailTemplate(selected, draft)
      await mutate()
      setMsg({ ok: true, text: 'Template salvo!' })
    } catch (e) {
      setMsg({ ok: false, text: formatApiError(e) })
    } finally { setSaving(false) }
  }

  async function handleReset() {
    if (!selected) return
    if (!confirm('Restaurar o template para o padrão do sistema?')) return
    setResetting(true); setMsg(null)
    try {
      await resetEmailTemplate(selected)
      await mutate()
      setMsg({ ok: true, text: 'Template restaurado para o padrão.' })
      setDraft(null)
    } catch (e) {
      setMsg({ ok: false, text: formatApiError(e) })
    } finally { setResetting(false) }
  }

  if (isLoading) return (
    <div className="flex items-center gap-2 text-slate-500 text-xs py-4">
      <Loader2 className="w-4 h-4 animate-spin" /> Carregando templates…
    </div>
  )
  if (error) return (
    <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0" /> {formatApiError(error)}
    </div>
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Lista de templates */}
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Templates disponíveis</p>
        {templates.map(t => (
          <button
            key={t.name}
            onClick={() => { setSelected(t.name); setMsg(null) }}
            className={cn(
              'w-full text-left px-3 py-2.5 rounded-lg border text-xs transition',
              selected === t.name
                ? 'bg-cyan-100 border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:border-cyan-500/30 dark:text-cyan-300'
                : 'bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/[0.02] dark:border-white/5 dark:text-slate-400 hover:border-slate-300',
            )}
          >
            <p className="font-semibold text-[11px]">{t.label}</p>
            <p className="text-[10px] text-slate-500 truncate mt-0.5">{t.subject}</p>
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="md:col-span-2">
        {!selected ? (
          <div className="h-full flex items-center justify-center p-8 text-slate-500 text-xs text-center">
            <div>
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
              Selecione um template à esquerda para editar
            </div>
          </div>
        ) : draft ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-900 dark:text-white">{current?.label}</p>
              <button
                onClick={handleReset}
                disabled={resetting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-[11px] transition disabled:opacity-50"
              >
                {resetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Restaurar padrão
              </button>
            </div>

            <Field label="Assunto (Subject)">
              <input
                type="text"
                value={draft.subject}
                onChange={e => setDraft(d => d ? { ...d, subject: e.target.value } : d)}
                className="input w-full text-xs"
                placeholder="Assunto do e-mail"
              />
            </Field>

            <Field label="Corpo do e-mail">
              <textarea
                value={draft.body}
                onChange={e => setDraft(d => d ? { ...d, body: e.target.value } : d)}
                rows={12}
                className="input w-full text-xs font-mono resize-y"
                placeholder="Corpo do e-mail..."
              />
            </Field>

            {/* Variáveis disponíveis */}
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 text-[10px] text-slate-500">
              <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <Lock className="w-3 h-3 inline mr-1" />Variáveis disponíveis:
              </p>
              <div className="flex flex-wrap gap-1">
                {(selected === 'invite'
                  ? ['{{name}}', '{{email}}', '{{password}}', '{{loginUrl}}', '{{inviterName}}']
                  : selected === 'demo_invite'
                  ? ['{{name}}', '{{demoUrl}}', '{{expiryDays}}']
                  : ['{{cameraName}}', '{{location}}', '{{eventType}}', '{{timestamp}}', '{{severity}}', '{{description}}', '{{dashboardUrl}}']
                ).map(v => (
                  <code key={v} className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 font-mono">{v}</code>
                ))}
              </div>
            </div>

            {msg && (
              <div className={cn(
                'p-3 rounded-lg text-[11px] border flex items-center gap-2',
                msg.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300'
                  : 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-300',
              )}>
                {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                {msg.text}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Salvar template
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ALERTAS DE E-MAIL
// ═══════════════════════════════════════════════════════════════════════════

type AlertTab = 'recipients' | 'config' | 'history'

const STATUS_LABEL: Record<string, string> = {
  SENT:               'Enviado',
  FAILED:             'Falhou',
  SUPPRESSED_COOLDOWN:'Cooldown',
  SUPPRESSED_QUIET:   'Silencioso',
  SUPPRESSED_LIMIT:   'Limite',
}
const STATUS_COLOR: Record<string, string> = {
  SENT:               'text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/15',
  FAILED:             'text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-500/15',
  SUPPRESSED_COOLDOWN:'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/15',
  SUPPRESSED_QUIET:   'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-500/20',
  SUPPRESSED_LIMIT:   'text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-500/15',
}

const TIMEZONES = [
  'America/Sao_Paulo','America/Fortaleza','America/Manaus','America/Belem',
  'America/Cuiaba','America/Porto_Velho','America/Boa_Vista',
  'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'Europe/London','Europe/Paris','Europe/Lisbon',
  'UTC',
]

function AlertsSection() {
  const [tab, setTab] = useState<AlertTab>('recipients')
  const inCls = 'input text-xs'

  const tabs: { id: AlertTab; label: string; icon: React.ReactNode }[] = [
    { id: 'recipients', label: 'Destinatários', icon: <Mail className="w-3.5 h-3.5" /> },
    { id: 'config',     label: 'Configurações', icon: <Settings2 className="w-3.5 h-3.5" /> },
    { id: 'history',    label: 'Histórico',     icon: <History className="w-3.5 h-3.5" /> },
  ]

  return (
    <GlassCard className="p-5 space-y-4">
      <header>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
          Alertas de E-mail
        </h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Gerencie destinatários, cooldowns e histórico de envios de alertas por e-mail.
        </p>
      </header>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-lg w-fit">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition',
              tab === t.id
                ? 'bg-white dark:bg-white/10 text-cyan-700 dark:text-cyan-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'recipients' && <AlertRecipientsTab inCls={inCls} />}
      {tab === 'config'     && <AlertConfigTab inCls={inCls} />}
      {tab === 'history'    && <AlertHistoryTab />}
    </GlassCard>
  )
}

// ── Aba Destinatários ─────────────────────────────────────────────────────────

function AlertRecipientsTab({ inCls }: { inCls: string }) {
  const { data, mutate } = useAlertRecipients()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing]     = useState<AlertRecipient | null>(null)
  const [testing, setTesting]     = useState<string | null>(null)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [testMsg, setTestMsg]     = useState<{ id: string; ok: boolean; msg: string } | null>(null)

  const recipients = data?.recipients ?? []

  async function handleTest(r: AlertRecipient) {
    setTesting(r.id)
    setTestMsg(null)
    try {
      const res = await testAlertRecipient(r.id)
      setTestMsg({ id: r.id, ok: res.ok, msg: res.ok ? 'E-mail de teste enviado!' : (res.error ?? 'Falha ao enviar') })
    } catch (e: any) {
      setTestMsg({ id: r.id, ok: false, msg: e?.response?.data?.message ?? 'Erro ao enviar' })
    }
    setTesting(null)
    setTimeout(() => setTestMsg(null), 5000)
  }

  async function handleDelete(r: AlertRecipient) {
    if (!confirm(`Remover ${r.email}?`)) return
    setDeleting(r.id)
    try {
      await deleteAlertRecipient(r.id)
      mutate()
    } catch {}
    setDeleting(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-slate-500">{recipients.length} destinatário(s) cadastrado(s)</p>
        <button
          onClick={() => { setEditing(null); setShowModal(true) }}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-700 text-white text-[11px] font-medium transition"
        >
          <Plus className="w-3.5 h-3.5" />
          Adicionar
        </button>
      </div>

      {recipients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-slate-400 gap-2">
          <BellOff className="w-7 h-7" />
          <p className="text-xs">Nenhum destinatário cadastrado.</p>
          <p className="text-[10px]">Adicione e-mails para receber alertas de câmeras e eventos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recipients.map(r => (
            <div
              key={r.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border transition',
                r.active
                  ? 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10'
                  : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/5 opacity-60',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-900 dark:text-white truncate">{r.email}</span>
                  {r.name && <span className="text-[10px] text-slate-500 truncate">({r.name})</span>}
                  {!r.active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500">Inativo</span>
                  )}
                </div>
                {/* Badges de tipos */}
                <div className="flex flex-wrap gap-1 mt-1">
                  {r.rcvCameraDown  && <Badge color="rose">📷 Câmera Offline</Badge>}
                  {r.rcvCameraUp    && <Badge color="emerald">📷 Câmera Online</Badge>}
                  {r.rcvTriggerFire && <Badge color="amber">⚡ Trigger</Badge>}
                  {r.rcvDigest      && <Badge color="sky">📋 Digest</Badge>}
                  {r.escalateToIntegrador && <Badge color="purple">🔼 Escala Integrador</Badge>}
                  {r.quietStart && r.quietEnd && (
                    <Badge color="slate">🔕 {r.quietStart}–{r.quietEnd}</Badge>
                  )}
                </div>
              </div>

              {/* Test feedback */}
              {testMsg?.id === r.id && (
                <span className={cn('text-[10px]', testMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                  {testMsg.msg}
                </span>
              )}

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleTest(r)}
                  disabled={testing === r.id}
                  title="Enviar e-mail de teste"
                  className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition disabled:opacity-40"
                >
                  {testing === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => { setEditing(r); setShowModal(true) }}
                  title="Editar"
                  className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(r)}
                  disabled={deleting === r.id}
                  title="Remover"
                  className="p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition disabled:opacity-40"
                >
                  {deleting === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AlertRecipientModal
          initial={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); mutate() }}
          inCls={inCls}
        />
      )}
    </div>
  )
}

// ── Modal Adicionar/Editar Destinatário ────────────────────────────────────────

function AlertRecipientModal({
  initial, onClose, onSaved, inCls,
}: {
  initial:  AlertRecipient | null
  onClose:  () => void
  onSaved:  () => void
  inCls:    string
}) {
  const [form, setForm] = useState({
    email:                initial?.email                ?? '',
    name:                 initial?.name                ?? '',
    active:               initial?.active              ?? true,
    rcvCritical:          initial?.rcvCritical         ?? true,
    rcvWarning:           initial?.rcvWarning           ?? true,
    rcvInfo:              initial?.rcvInfo              ?? false,
    rcvCameraDown:        initial?.rcvCameraDown        ?? true,
    rcvCameraUp:          initial?.rcvCameraUp          ?? false,
    rcvTriggerFire:       initial?.rcvTriggerFire       ?? true,
    rcvDigest:            initial?.rcvDigest            ?? false,
    escalateToIntegrador: initial?.escalateToIntegrador ?? false,
    quietStart:           initial?.quietStart ?? '',
    quietEnd:             initial?.quietEnd   ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  function toggle(key: keyof typeof form) {
    setForm(f => ({ ...f, [key]: !f[key as keyof typeof f] }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await saveAlertRecipient(
        {
          email:                form.email,
          name:                 form.name || null,
          active:               form.active,
          rcvCritical:          form.rcvCritical,
          rcvWarning:           form.rcvWarning,
          rcvInfo:              form.rcvInfo,
          rcvCameraDown:        form.rcvCameraDown,
          rcvCameraUp:          form.rcvCameraUp,
          rcvTriggerFire:       form.rcvTriggerFire,
          rcvDigest:            form.rcvDigest,
          escalateToIntegrador: form.escalateToIntegrador,
          quietStart:           form.quietStart || null,
          quietEnd:             form.quietEnd   || null,
        } as any,
        initial?.id,
      )
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erro ao salvar')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-white/10 w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            {initial ? 'Editar Destinatário' : 'Adicionar Destinatário'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10 transition">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Email + Nome */}
          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">E-mail *</label>
              <input
                className={inCls}
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="destinatario@empresa.com"
                disabled={!!initial}
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Nome (opcional)</label>
              <input
                className={inCls}
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="João da Silva"
              />
            </div>
          </div>

          {/* Ativo */}
          <ToggleRow
            label="Ativo"
            desc="Desative para pausar alertas sem remover o destinatário"
            value={form.active}
            onChange={() => toggle('active')}
          />

          {/* Severity */}
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Severidade</p>
            <div className="space-y-1.5">
              <ToggleRow label="Crítico" desc="Câmera offline, falhas graves" value={form.rcvCritical} onChange={() => toggle('rcvCritical')} />
              <ToggleRow label="Aviso"   desc="Eventos de atenção"           value={form.rcvWarning}  onChange={() => toggle('rcvWarning')} />
              <ToggleRow label="Info"    desc="Eventos informativos"          value={form.rcvInfo}     onChange={() => toggle('rcvInfo')} />
            </div>
          </div>

          {/* Tipo de evento */}
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Tipo de Evento</p>
            <div className="space-y-1.5">
              <ToggleRow label="📷 Câmera Offline"    desc="Quando câmera perde heartbeat"   value={form.rcvCameraDown}  onChange={() => toggle('rcvCameraDown')} />
              <ToggleRow label="📷 Câmera Online"     desc="Quando câmera se reconecta"      value={form.rcvCameraUp}    onChange={() => toggle('rcvCameraUp')} />
              <ToggleRow label="⚡ Trigger Semântico"  desc="Correspondência de gatilho IA"   value={form.rcvTriggerFire} onChange={() => toggle('rcvTriggerFire')} />
              <ToggleRow label="📋 Digest Diário"     desc="Resumo diário de alertas"        value={form.rcvDigest}      onChange={() => toggle('rcvDigest')} />
            </div>
          </div>

          {/* Escalada para Integrador */}
          <ToggleRow
            label="🔼 Escalar para Integrador"
            desc="Em alertas CRÍTICOS, copia o Integrador responsável"
            value={form.escalateToIntegrador}
            onChange={() => toggle('escalateToIntegrador')}
          />

          {/* Janela silenciosa */}
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Janela Silenciosa</p>
            <p className="text-[10px] text-slate-400 mb-2">Alertas não enviados durante este horário</p>
            <div className="flex items-center gap-2">
              <input
                className={`${inCls} w-28`}
                type="time"
                value={form.quietStart}
                onChange={e => setForm(f => ({ ...f, quietStart: e.target.value }))}
                placeholder="22:00"
              />
              <span className="text-slate-400 text-xs">até</span>
              <input
                className={`${inCls} w-28`}
                type="time"
                value={form.quietEnd}
                onChange={e => setForm(f => ({ ...f, quietEnd: e.target.value }))}
                placeholder="07:00"
              />
              {(form.quietStart || form.quietEnd) && (
                <button
                  onClick={() => setForm(f => ({ ...f, quietStart: '', quietEnd: '' }))}
                  className="text-slate-400 hover:text-rose-500 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200 dark:border-white/10">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 transition">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.email}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-medium transition disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {initial ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Aba Configurações ─────────────────────────────────────────────────────────

function AlertConfigTab({ inCls }: { inCls: string }) {
  const { data, mutate } = useAlertConfig()
  const [form, setForm] = useState<Partial<AlertConfig>>({})
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  function setNum(key: keyof AlertConfig, val: string) {
    const n = parseInt(val, 10)
    if (!isNaN(n)) setForm(f => ({ ...f, [key]: n }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const { clienteFinalId: _cf, ...rest } = form as AlertConfig
      await saveAlertConfig(rest)
      setSavedOk(true)
      mutate()
      setTimeout(() => setSavedOk(false), 3000)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erro ao salvar')
    }
    setSaving(false)
  }

  if (!data) return <LoadingCard text="Carregando configurações..." />

  return (
    <div className="space-y-5">
      {/* Cooldowns */}
      <div>
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Cooldown (segundos)</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'cooldownCameraDown' as const, label: 'Câmera Offline', hint: 'padrão: 3600' },
            { key: 'cooldownCameraUp'   as const, label: 'Câmera Online',  hint: 'padrão: 600' },
            { key: 'cooldownTrigger'    as const, label: 'Trigger IA',     hint: 'padrão: 300' },
          ].map(({ key, label, hint }) => (
            <div key={key}>
              <label className="text-[10px] text-slate-500 mb-1 block">{label}</label>
              <input
                className={inCls}
                type="number"
                min={0}
                max={86400}
                value={form[key] ?? ''}
                onChange={e => setNum(key, e.target.value)}
              />
              <p className="text-[9px] text-slate-400 mt-0.5">{hint}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Grace period */}
      <div>
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block">
          Grace Period Offline (segundos)
        </label>
        <p className="text-[10px] text-slate-400 mb-2">Tempo sem heartbeat antes de declarar câmera offline</p>
        <input
          className={`${inCls} w-32`}
          type="number"
          min={0}
          max={3600}
          value={form.offlineGraceSec ?? ''}
          onChange={e => setNum('offlineGraceSec', e.target.value)}
        />
      </div>

      {/* Limites anti-spam */}
      <div>
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Limites Anti-Spam</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">Máx. e-mails / hora</label>
            <input
              className={inCls}
              type="number"
              min={1}
              max={500}
              value={form.maxEmailsPerHour ?? ''}
              onChange={e => setNum('maxEmailsPerHour', e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">Máx. e-mails / dia</label>
            <input
              className={inCls}
              type="number"
              min={1}
              max={5000}
              value={form.maxEmailsPerDay ?? ''}
              onChange={e => setNum('maxEmailsPerDay', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Digest */}
      <div className="p-3 rounded-lg border border-slate-200 dark:border-white/10 space-y-3">
        <ToggleRow
          label="📋 Digest Diário"
          desc="Envia um resumo diário com todos os alertas do dia"
          value={form.digestEnabled ?? false}
          onChange={() => setForm(f => ({ ...f, digestEnabled: !f.digestEnabled }))}
        />
        {form.digestEnabled && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">Horário do digest</label>
              <input
                className={inCls}
                type="time"
                value={form.digestTime ?? '08:00'}
                onChange={e => setForm(f => ({ ...f, digestTime: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">Fuso horário</label>
              <select
                className={inCls}
                value={form.digestTimezone ?? 'America/Sao_Paulo'}
                onChange={e => setForm(f => ({ ...f, digestTimezone: e.target.value }))}
              >
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Integrador forçar receber crítico */}
      <ToggleRow
        label="🔼 Integrador sempre recebe alertas CRÍTICOS"
        desc="O Integrador é copiado em todos alertas críticos, independente do destinatário configurar escalada"
        value={form.integradorForceReceiveCritical ?? false}
        onChange={() => setForm(f => ({ ...f, integradorForceReceiveCritical: !f.integradorForceReceiveCritical }))}
      />

      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-medium transition disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salvar configurações
        </button>
        {savedOk && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> Salvo!
          </span>
        )}
      </div>
    </div>
  )
}

// ── Aba Histórico ─────────────────────────────────────────────────────────────

function AlertHistoryTab() {
  const [statusFilter, setStatusFilter] = useState('')
  const [eventFilter,  setEventFilter]  = useState('')
  const [offset, setOffset]             = useState(0)
  const LIMIT = 20

  const { data, mutate, isLoading } = useAlertDeliveries({
    status:    statusFilter || undefined,
    eventType: eventFilter  || undefined,
    limit:     LIMIT,
    offset,
  })

  const [retrying, setRetrying] = useState<string | null>(null)

  async function handleRetry(id: string) {
    setRetrying(id)
    try {
      await retryAlertDelivery(id)
      mutate()
    } catch {}
    setRetrying(null)
  }

  const items    = data?.items    ?? []
  const total    = data?.total    ?? 0
  const byStatus = data?.byStatus ?? {}

  return (
    <div className="space-y-3">
      {/* Resumo por status */}
      {Object.keys(byStatus).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(byStatus).map(([status, count]) => (
            <button
              key={status}
              onClick={() => { setStatusFilter(statusFilter === status ? '' : status); setOffset(0) }}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium transition border',
                statusFilter === status
                  ? (STATUS_COLOR[status] ?? 'text-slate-600 bg-slate-100') + ' border-current'
                  : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20',
              )}
            >
              {STATUS_LABEL[status] ?? status}
              <span className="opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-2">
        <select
          className="input text-xs w-40"
          value={eventFilter}
          onChange={e => { setEventFilter(e.target.value); setOffset(0) }}
        >
          <option value="">Todos os tipos</option>
          <option value="CAMERA_DOWN">Câmera Offline</option>
          <option value="CAMERA_UP">Câmera Online</option>
          <option value="TRIGGER_FIRE">Trigger IA</option>
          <option value="DIGEST">Digest</option>
        </select>
        {(statusFilter || eventFilter) && (
          <button
            onClick={() => { setStatusFilter(''); setEventFilter(''); setOffset(0) }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition"
          >
            <X className="w-3 h-3" /> Limpar filtros
          </button>
        )}
        <button onClick={() => mutate()} className="ml-auto p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-slate-700 dark:hover:text-white transition">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <LoadingCard text="Carregando histórico..." />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-slate-400 gap-2">
          <MailCheck className="w-7 h-7" />
          <p className="text-xs">Nenhum registro encontrado.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map(d => (
            <div
              key={d.id}
              className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs"
            >
              {/* Status badge */}
              <span className={cn('shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium', STATUS_COLOR[d.status] ?? 'text-slate-500 bg-slate-100 dark:bg-slate-700')}>
                {STATUS_LABEL[d.status] ?? d.status}
              </span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="truncate text-slate-800 dark:text-slate-200 text-[11px]">{d.recipientEmail}</p>
                <p className="text-[10px] text-slate-500 truncate">
                  {d.eventType} · {new Date(d.sentAt).toLocaleString('pt-BR')}
                  {d.errorMsg && <span className="text-rose-500 ml-1">· {d.errorMsg}</span>}
                </p>
              </div>

              {/* Retry */}
              {d.status === 'FAILED' && (
                <button
                  onClick={() => handleRetry(d.id)}
                  disabled={retrying === d.id}
                  title="Reenviar"
                  className="shrink-0 p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition disabled:opacity-40"
                >
                  {retrying === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Paginação */}
      {total > LIMIT && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-[10px] text-slate-500">{offset + 1}–{Math.min(offset + LIMIT, total)} de {total}</p>
          <div className="flex gap-1">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 disabled:opacity-30 transition"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              disabled={offset + LIMIT >= total}
              onClick={() => setOffset(o => o + LIMIT)}
              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 disabled:opacity-30 transition"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE S3/R2
// ═══════════════════════════════════════════════════════════════════════════
// STORAGE SECTION — Super Admin vê dashboard global, Integrador vê seu bucket
// ═══════════════════════════════════════════════════════════════════════════
function StorageSection() {
  const { data: me } = useMe()

  // Super Admin: mostra dashboard global
  if (me?.kind === 'SUPER_ADMIN') {
    return <StorageGlobalDashboard />
  }

  // Integrador: mostra config do seu bucket
  if (me?.kind === 'INTEGRADOR') {
    return <StorageIntegradorView />
  }

  return (
    <GlassCard className="p-6">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Configuração de storage disponível apenas para Integradores.
      </p>
    </GlassCard>
  )
}

// ─── Dashboard Global (Super Admin) ──────────────────────────────────────────
function StorageGlobalDashboard() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [drawerClienteId, setDrawerClienteId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'buckets' | 'orphans' | 'logs'>('buckets')
  const [orphansData, setOrphansData] = useState<Record<string, any>>({})
  const [orphansLoading, setOrphansLoading] = useState<Record<string, boolean>>({})
  const [logsData, setLogsData] = useState<any>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsPage, setLogsPage] = useState(1)
  const [logsFilters, setLogsFilters] = useState({ integradorId: '', action: '', startDate: '', endDate: '' })
  const [deletingOrphans, setDeletingOrphans] = useState<string | null>(null)

  useEffect(() => {
    api.get('/storage/global')
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [])

  // Carregar órfãos por integrador
  const loadOrphans = async (integradorId: string) => {
    if (orphansData[integradorId] || orphansLoading[integradorId]) return
    setOrphansLoading(prev => ({ ...prev, [integradorId]: true }))
    try {
      const res = await api.get(`/storage/orphans?integradorId=${integradorId}`)
      setOrphansData(prev => ({ ...prev, [integradorId]: res.data }))
    } finally {
      setOrphansLoading(prev => ({ ...prev, [integradorId]: false }))
    }
  }

  // Carregar logs
  const loadLogs = async (page = 1) => {
    setLogsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (logsFilters.integradorId) params.set('integradorId', logsFilters.integradorId)
      if (logsFilters.action) params.set('action', logsFilters.action)
      if (logsFilters.startDate) params.set('startDate', logsFilters.startDate)
      if (logsFilters.endDate) params.set('endDate', logsFilters.endDate)
      const res = await api.get(`/storage/logs?${params.toString()}`)
      setLogsData(res.data)
      setLogsPage(page)
    } finally {
      setLogsLoading(false)
    }
  }

  // Excluir órfãos
  const deleteOrphans = async (integradorId: string, cameraIds: string[]) => {
    if (!confirm(`Tem certeza que deseja excluir ${cameraIds.length} gravação(ões) órfã(s)? Esta ação não pode ser desfeita.`)) return
    setDeletingOrphans(integradorId)
    try {
      await api.delete('/storage/orphans', { data: { integradorId, cameraIds, confirmDelete: true } })
      // Recarregar órfãos
      setOrphansData(prev => ({ ...prev, [integradorId]: undefined }))
      loadOrphans(integradorId)
      // Recarregar dados globais
      const res = await api.get('/storage/global')
      setData(res.data)
    } finally {
      setDeletingOrphans(null)
    }
  }

  useEffect(() => {
    if (activeTab === 'logs' && !logsData) loadLogs()
  }, [activeTab])

  if (loading) return <LoadingCard text="Carregando buckets..." />

  if (!data) {
    return (
      <GlassCard className="p-6">
        <p className="text-sm text-slate-600 dark:text-slate-400">Erro ao carregar dados de storage.</p>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-4">
      {/* Totais */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <GlassCard className="p-3 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Integradores</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{data.totals.totalIntegradores}</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Buckets Ativos</p>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{data.totals.totalBuckets}</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Storage Total</p>
          <p className="text-xl font-bold text-cyan-600 dark:text-cyan-400">{data.totals.totalGB} GB</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Clientes</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{data.totals.totalClientes}</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Câmeras</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{data.totals.totalCameras}</p>
        </GlassCard>
      </div>

      {/* R2 Status */}
      <GlassCard className={cn('p-3', data.r2Enabled ? 'border-emerald-500/30' : 'border-amber-500/30')}>
        <div className="flex items-center gap-2">
          <Server className={cn('w-4 h-4', data.r2Enabled ? 'text-emerald-500' : 'text-amber-500')} />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Cloudflare R2: {data.r2Enabled ? 'Habilitado' : 'Desabilitado'}
          </span>
          {data.r2Endpoint && (
            <span className="text-[10px] text-slate-500 font-mono">{data.r2Endpoint}</span>
          )}
        </div>
      </GlassCard>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-white/10">
        {[
          { id: 'buckets', label: 'Buckets', icon: Server },
          { id: 'orphans', label: 'Gravações Órfãs', icon: AlertTriangle },
          { id: 'logs', label: 'Logs de Acesso', icon: History },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Buckets */}
      {activeTab === 'buckets' && (
        <>
      {/* Lista de Buckets por Integrador */}
      <GlassCard className="divide-y divide-slate-200 dark:divide-white/10">
        <div className="p-3 bg-slate-50 dark:bg-white/5">
          <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            <div className="col-span-3">Integrador</div>
            <div className="col-span-2">Bucket</div>
            <div className="col-span-1 text-center">Tipo</div>
            <div className="col-span-1 text-right">GB</div>
            <div className="col-span-1 text-right">Objetos</div>
            <div className="col-span-1 text-center">Retenção</div>
            <div className="col-span-1 text-center">Clientes</div>
            <div className="col-span-1 text-center">Câmeras</div>
            <div className="col-span-1"></div>
          </div>
        </div>

        {data.buckets.map((b: any) => (
          <div key={b.integradorId}>
            <div
              className="p-3 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition"
              onClick={() => setExpandedId(expandedId === b.integradorId ? null : b.integradorId)}
            >
              <div className="grid grid-cols-12 gap-2 items-center text-xs">
                <div className="col-span-3">
                  <p className="font-semibold text-slate-900 dark:text-white truncate">{b.integrador.name}</p>
                  <p className="text-[10px] text-slate-500 truncate">{b.integrador.email}</p>
                </div>
                <div className="col-span-2">
                  <p className="font-mono text-[10px] text-slate-600 dark:text-slate-400 truncate">{b.bucket || '—'}</p>
                </div>
                <div className="col-span-1 text-center">
                  <span className={cn(
                    'px-1.5 py-0.5 text-[9px] rounded font-medium',
                    b.type === 'r2' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' :
                    b.type === 'custom' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' :
                    'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                  )}>
                    {b.type.toUpperCase()}
                  </span>
                </div>
                <div className="col-span-1 text-right font-semibold text-slate-900 dark:text-white">
                  {b.totalGB}
                </div>
                <div className="col-span-1 text-right text-slate-600 dark:text-slate-400">
                  {b.objectCount.toLocaleString()}
                </div>
                <div className="col-span-1 text-center text-slate-600 dark:text-slate-400">
                  {b.retainDays}d
                </div>
                <div className="col-span-1 text-center text-slate-600 dark:text-slate-400">
                  {b.clientesFinaisCount}
                </div>
                <div className="col-span-1 text-center text-slate-600 dark:text-slate-400">
                  {b.totalCameras}
                </div>
                <div className="col-span-1 text-right">
                  {expandedId === b.integradorId ? (
                    <ChevronUp className="w-4 h-4 text-slate-400 inline" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400 inline" />
                  )}
                </div>
              </div>
            </div>

            {/* Expanded: Clientes Finais */}
            {expandedId === b.integradorId && b.clientesFinais.length > 0 && (
              <div className="bg-slate-50 dark:bg-white/5 px-6 py-3 border-t border-slate-100 dark:border-white/5">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Clientes Finais — clique para ver detalhes
                </p>
                <div className="space-y-1">
                  {b.clientesFinais.map((cf: any) => (
                    <div
                      key={cf.id}
                      onClick={(e) => { e.stopPropagation(); setDrawerClienteId(cf.id) }}
                      className="flex items-center justify-between text-xs p-2 -mx-2 rounded-lg hover:bg-white dark:hover:bg-white/10 cursor-pointer transition"
                    >
                      <span className="text-slate-700 dark:text-slate-300 font-medium">{cf.name}</span>
                      <div className="flex items-center gap-4 text-slate-500">
                        <span>{cf.cameras} câmeras</span>
                        <span className="font-mono">{cf.usedGB} GB</span>
                        <ChevronDown className="w-3 h-3 -rotate-90" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {expandedId === b.integradorId && b.clientesFinais.length === 0 && (
              <div className="bg-slate-50 dark:bg-white/5 px-6 py-3 border-t border-slate-100 dark:border-white/5">
                <p className="text-xs text-slate-500 italic">Nenhum cliente final cadastrado</p>
              </div>
            )}
          </div>
        ))}

        {data.buckets.length === 0 && (
          <div className="p-6 text-center text-slate-500 text-sm">
            Nenhum integrador cadastrado
          </div>
        )}
      </GlassCard>
        </>
      )}

      {/* Tab: Gravações Órfãs */}
      {activeTab === 'orphans' && (
        <GlassCard className="divide-y divide-slate-200 dark:divide-white/10">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h3 className="font-semibold text-slate-900 dark:text-white">Gravações Órfãs</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Gravações de câmeras que foram excluídas ou desativadas. Esses arquivos ocupam espaço mas não são mais acessíveis pelo sistema.
            </p>
          </div>

          {data.buckets.map((b: any) => (
            <div key={b.integradorId} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-sm text-slate-900 dark:text-white">{b.integrador.name}</p>
                  <p className="text-[10px] text-slate-500">{b.bucket}</p>
                </div>
                <button
                  onClick={() => loadOrphans(b.integradorId)}
                  disabled={orphansLoading[b.integradorId]}
                  className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-white/10 rounded-lg hover:bg-slate-200 dark:hover:bg-white/20 transition"
                >
                  {orphansLoading[b.integradorId] ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : orphansData[b.integradorId] ? (
                    <RefreshCw className="w-3 h-3" />
                  ) : (
                    'Verificar'
                  )}
                </button>
              </div>

              {orphansData[b.integradorId] && (
                <div className="space-y-2">
                  {orphansData[b.integradorId].orphans.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      Nenhuma gravação órfã encontrada
                    </div>
                  ) : (
                    <>
                      <div className="bg-amber-50 dark:bg-amber-500/10 rounded-lg p-3 mb-3">
                        <div className="grid grid-cols-4 gap-2 text-center text-xs">
                          <div>
                            <p className="text-amber-600 dark:text-amber-400 font-bold text-lg">
                              {orphansData[b.integradorId].summary.totalOrphans}
                            </p>
                            <p className="text-amber-700 dark:text-amber-300 text-[10px]">Órfãos</p>
                          </div>
                          <div>
                            <p className="text-amber-600 dark:text-amber-400 font-bold text-lg">
                              {orphansData[b.integradorId].summary.deletedCameras}
                            </p>
                            <p className="text-amber-700 dark:text-amber-300 text-[10px]">Deletadas</p>
                          </div>
                          <div>
                            <p className="text-amber-600 dark:text-amber-400 font-bold text-lg">
                              {orphansData[b.integradorId].summary.totalGB} GB
                            </p>
                            <p className="text-amber-700 dark:text-amber-300 text-[10px]">Espaço</p>
                          </div>
                          <div>
                            <p className="text-amber-600 dark:text-amber-400 font-bold text-lg">
                              {orphansData[b.integradorId].summary.totalObjects.toLocaleString()}
                            </p>
                            <p className="text-amber-700 dark:text-amber-300 text-[10px]">Arquivos</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1">
                        {orphansData[b.integradorId].orphans.map((o: any) => (
                          <div key={o.cameraId} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-white/5 rounded-lg text-xs">
                            <div className="flex items-center gap-2">
                              <Camera className={cn(
                                'w-4 h-4',
                                o.status === 'deleted' ? 'text-red-500' : 'text-amber-500'
                              )} />
                              <div>
                                <p className="font-medium text-slate-900 dark:text-white">
                                  {o.cameraName || 'Câmera excluída'}
                                </p>
                                <p className="text-[10px] text-slate-500 font-mono">{o.cameraId}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={cn(
                                'px-1.5 py-0.5 rounded text-[9px] font-medium',
                                o.status === 'deleted'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                              )}>
                                {o.status === 'deleted' ? 'EXCLUÍDA' : 'INATIVA'}
                              </span>
                              <span className="text-slate-500">{o.objectCount} arquivos</span>
                              <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{o.totalGB} GB</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={() => deleteOrphans(
                          b.integradorId,
                          orphansData[b.integradorId].orphans.map((o: any) => o.cameraId)
                        )}
                        disabled={deletingOrphans === b.integradorId}
                        className="w-full mt-3 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {deletingOrphans === b.integradorId ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Excluindo...
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-3 h-3" />
                            Excluir todas ({orphansData[b.integradorId].summary.totalGB} GB)
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </GlassCard>
      )}

      {/* Tab: Logs de Acesso */}
      {activeTab === 'logs' && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <History className="w-5 h-5 text-slate-500" />
            <h3 className="font-semibold text-slate-900 dark:text-white">Logs de Acesso ao Storage</h3>
          </div>

          {/* Filtros */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <select
              value={logsFilters.integradorId}
              onChange={e => setLogsFilters(f => ({ ...f, integradorId: e.target.value }))}
              className="px-3 py-1.5 text-xs border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5"
            >
              <option value="">Todos integradores</option>
              {data.buckets.map((b: any) => (
                <option key={b.integradorId} value={b.integradorId}>{b.integrador.name}</option>
              ))}
            </select>
            <select
              value={logsFilters.action}
              onChange={e => setLogsFilters(f => ({ ...f, action: e.target.value }))}
              className="px-3 py-1.5 text-xs border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5"
            >
              <option value="">Todas ações</option>
              <option value="VIEW_DASHBOARD">Dashboard</option>
              <option value="VIEW_BUCKET">Bucket</option>
              <option value="VIEW_CLIENTE">Cliente</option>
              <option value="BROWSE_OBJECTS">Navegação</option>
              <option value="PREVIEW_OBJECT">Preview</option>
              <option value="DOWNLOAD_OBJECT">Download</option>
              <option value="DELETE_OBJECT">Exclusão</option>
              <option value="DELETE_ORPHANS">Excluir Órfãos</option>
            </select>
            <input
              type="date"
              value={logsFilters.startDate}
              onChange={e => setLogsFilters(f => ({ ...f, startDate: e.target.value }))}
              className="px-3 py-1.5 text-xs border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5"
              placeholder="Data início"
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={logsFilters.endDate}
                onChange={e => setLogsFilters(f => ({ ...f, endDate: e.target.value }))}
                className="flex-1 px-3 py-1.5 text-xs border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5"
                placeholder="Data fim"
              />
              <button
                onClick={() => loadLogs(1)}
                disabled={logsLoading}
                className="px-3 py-1.5 bg-cyan-500 text-white rounded-lg text-xs hover:bg-cyan-600 transition"
              >
                {logsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Filtrar'}
              </button>
            </div>
          </div>

          {/* Tabela de Logs */}
          {logsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : logsData?.logs?.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10">
                      <th className="text-left py-2 px-2 font-medium text-slate-500">Data</th>
                      <th className="text-left py-2 px-2 font-medium text-slate-500">Usuário</th>
                      <th className="text-left py-2 px-2 font-medium text-slate-500">Ação</th>
                      <th className="text-left py-2 px-2 font-medium text-slate-500">Integrador</th>
                      <th className="text-left py-2 px-2 font-medium text-slate-500">Detalhes</th>
                      <th className="text-right py-2 px-2 font-medium text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {logsData.logs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                        <td className="py-2 px-2 whitespace-nowrap text-slate-600 dark:text-slate-400">
                          {new Date(log.createdAt).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-2 px-2">
                          <p className="text-slate-900 dark:text-white">{log.actorEmail || log.actorId}</p>
                          <p className="text-[10px] text-slate-500">{log.actorType}</p>
                        </td>
                        <td className="py-2 px-2">
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[9px] font-medium',
                            log.action.includes('DELETE') ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400' :
                            log.action.includes('VIEW') ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' :
                            'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                          )}>
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-slate-600 dark:text-slate-400">
                          {log.integradorName || '—'}
                        </td>
                        <td className="py-2 px-2 text-slate-500">
                          {log.objectKey ? (
                            <span className="font-mono text-[10px]">{log.objectKey.slice(0, 30)}...</span>
                          ) : log.cameraId ? (
                            <span className="font-mono text-[10px]">cam: {log.cameraId.slice(0, 8)}...</span>
                          ) : log.bytesAffected ? (
                            <span>{(log.bytesAffected / 1024 / 1024 / 1024).toFixed(2)} GB</span>
                          ) : '—'}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {log.success ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 inline" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-red-500 inline" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              {logsData.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200 dark:border-white/10">
                  <p className="text-xs text-slate-500">
                    Página {logsData.pagination.page} de {logsData.pagination.totalPages} ({logsData.pagination.total} registros)
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => loadLogs(logsPage - 1)}
                      disabled={logsPage <= 1 || logsLoading}
                      className="px-3 py-1 text-xs bg-slate-100 dark:bg-white/10 rounded disabled:opacity-50"
                    >
                      Anterior
                    </button>
                    <button
                      onClick={() => loadLogs(logsPage + 1)}
                      disabled={logsPage >= logsData.pagination.totalPages || logsLoading}
                      className="px-3 py-1 text-xs bg-slate-100 dark:bg-white/10 rounded disabled:opacity-50"
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-slate-500 text-sm">
              Nenhum log encontrado
            </div>
          )}
        </GlassCard>
      )}

      {/* Drawer Cliente Final */}
      {drawerClienteId && (
        <StorageClienteDrawer
          clienteFinalId={drawerClienteId}
          onClose={() => setDrawerClienteId(null)}
        />
      )}
    </div>
  )
}

// ─── Drawer de Detalhes do Cliente Final ─────────────────────────────────────
function StorageClienteDrawer({ clienteFinalId, onClose }: { clienteFinalId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'cameras' | 'browser'>('cameras')
  const [browserPath, setBrowserPath] = useState('')
  const [browserData, setBrowserData] = useState<any>(null)
  const [browserLoading, setBrowserLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewType, setPreviewType] = useState<'image' | 'video' | null>(null)

  useEffect(() => {
    api.get(`/storage/cliente/${clienteFinalId}`)
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [clienteFinalId])

  useEffect(() => {
    if (tab === 'browser') {
      loadBrowser(browserPath)
    }
  }, [tab, browserPath, clienteFinalId])

  async function loadBrowser(path: string) {
    setBrowserLoading(true)
    try {
      const res = await api.get(`/storage/cliente/${clienteFinalId}/browse`, { params: { path } })
      setBrowserData(res.data)
    } finally {
      setBrowserLoading(false)
    }
  }

  async function handlePreview(item: any) {
    if (item.mediaType === 'other') return
    try {
      const res = await api.get('/storage/preview', {
        params: { key: item.key, clienteFinalId }
      })
      setPreviewUrl(res.data.url)
      setPreviewType(item.mediaType)
    } catch (err) {
      console.error('Preview error:', err)
    }
  }

  function navigateTo(path: string) {
    setBrowserPath(path)
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center gap-3">
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-white/10 rounded">
            <X className="w-5 h-5 text-slate-500" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {data?.clienteFinal?.name || 'Carregando...'}
            </h2>
            <p className="text-[10px] text-slate-500">{data?.integrador?.name}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="p-4 border-b border-slate-200 dark:border-white/10">
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-cyan-600 dark:text-cyan-400">{data.storage.totalGB}</p>
                  <p className="text-[10px] text-slate-500">GB Usado</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-900 dark:text-white">{data.summary.totalCameras}</p>
                  <p className="text-[10px] text-slate-500">Câmeras</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{data.summary.activeCameras}</p>
                  <p className="text-[10px] text-slate-500">Online</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-900 dark:text-white">{data.storage.retainDays}d</p>
                  <p className="text-[10px] text-slate-500">Retenção</p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200 dark:border-white/10">
              <button
                onClick={() => setTab('cameras')}
                className={cn(
                  'flex-1 py-2 text-xs font-semibold transition',
                  tab === 'cameras'
                    ? 'text-cyan-600 border-b-2 border-cyan-500'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                )}
              >
                <Camera className="w-4 h-4 inline mr-1" /> Câmeras
              </button>
              <button
                onClick={() => setTab('browser')}
                className={cn(
                  'flex-1 py-2 text-xs font-semibold transition',
                  tab === 'browser'
                    ? 'text-cyan-600 border-b-2 border-cyan-500'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                )}
              >
                <Folder className="w-4 h-4 inline mr-1" /> Object Browser
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4">
              {tab === 'cameras' && (
                <div className="grid grid-cols-2 gap-3">
                  {data.cameras.map((cam: any) => (
                    <div key={cam.id} className="border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
                      {/* Snapshot */}
                      <div className="aspect-video bg-slate-100 dark:bg-slate-800 relative">
                        {cam.lastSnapshotUrl ? (
                          <img
                            src={cam.lastSnapshotUrl}
                            alt={cam.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Camera className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                          </div>
                        )}
                        {/* Status badge */}
                        <div className={cn(
                          'absolute top-2 right-2 px-1.5 py-0.5 text-[9px] rounded font-medium',
                          cam.status === 'ONLINE'
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-500 text-white'
                        )}>
                          {cam.status}
                        </div>
                      </div>
                      {/* Info */}
                      <div className="p-2">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{cam.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{cam.siteName}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[10px] text-slate-400">{cam.retainDays}d retenção</span>
                          {cam.recordEnabled && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400">
                              REC
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.cameras.length === 0 && (
                    <div className="col-span-2 text-center py-8 text-slate-500 text-sm">
                      Nenhuma câmera cadastrada
                    </div>
                  )}
                </div>
              )}

              {tab === 'browser' && (
                <div className="space-y-3">
                  {/* Breadcrumbs */}
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      onClick={() => navigateTo('')}
                      className="text-cyan-600 hover:underline"
                    >
                      /
                    </button>
                    {browserData?.breadcrumbs?.map((crumb: any, i: number) => (
                      <span key={crumb.path} className="flex items-center gap-1">
                        <span className="text-slate-400">/</span>
                        <button
                          onClick={() => navigateTo(crumb.path)}
                          className={cn(
                            i === browserData.breadcrumbs.length - 1
                              ? 'text-slate-700 dark:text-slate-300'
                              : 'text-cyan-600 hover:underline'
                          )}
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </div>

                  {/* Items */}
                  {browserLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-white/10 rounded-lg divide-y divide-slate-100 dark:divide-white/5">
                      {/* Back button */}
                      {browserPath && (
                        <div
                          onClick={() => {
                            const parts = browserPath.split('/').filter(Boolean)
                            parts.pop()
                            navigateTo(parts.length ? parts.join('/') + '/' : '')
                          }}
                          className="p-2 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer"
                        >
                          <ArrowLeft className="w-4 h-4 text-slate-400" />
                          <span className="text-xs text-slate-500">..</span>
                        </div>
                      )}

                      {browserData?.items?.map((item: any) => (
                        <div
                          key={item.key}
                          onClick={() => {
                            if (item.type === 'folder') {
                              navigateTo(item.path)
                            } else if (item.mediaType !== 'other') {
                              handlePreview(item)
                            }
                          }}
                          className={cn(
                            'p-2 flex items-center gap-2 transition',
                            (item.type === 'folder' || item.mediaType !== 'other')
                              ? 'hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer'
                              : ''
                          )}
                        >
                          {item.type === 'folder' ? (
                            <Folder className="w-4 h-4 text-amber-500" />
                          ) : item.mediaType === 'image' ? (
                            <Image className="w-4 h-4 text-cyan-500" />
                          ) : item.mediaType === 'video' ? (
                            <Video className="w-4 h-4 text-purple-500" />
                          ) : (
                            <File className="w-4 h-4 text-slate-400" />
                          )}
                          <span className="flex-1 text-xs text-slate-700 dark:text-slate-300 truncate">
                            {item.name}
                          </span>
                          {item.type === 'file' && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              {item.sizeFormatted}
                            </span>
                          )}
                        </div>
                      ))}

                      {browserData?.items?.length === 0 && (
                        <div className="p-8 text-center text-slate-500 text-sm">
                          Pasta vazia
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </motion.div>

      {/* Preview Modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => { setPreviewUrl(null); setPreviewType(null) }}
        >
          <button className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20">
            <X className="w-6 h-6 text-white" />
          </button>
          {previewType === 'image' && (
            <img src={previewUrl} alt="Preview" className="max-w-full max-h-full object-contain" />
          )}
          {previewType === 'video' && (
            <video src={previewUrl} controls autoPlay className="max-w-full max-h-full" />
          )}
        </div>
      )}
    </div>
  )
}

// ─── View do Integrador (config do próprio bucket) ───────────────────────────
function StorageIntegradorView() {
  const [config, setConfig] = useState<any>(null)
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [retainDays, setRetainDays] = useState(30)
  const [form, setForm] = useState({
    endpoint: '',
    region: 'auto',
    bucket: '',
    accessKey: '',
    secretKey: '',
    createBucket: true,
  })

  useEffect(() => {
    Promise.all([
      api.get('/storage/config').then(r => r.data),
      api.get('/storage/stats').then(r => r.data),
    ]).then(([cfg, st]) => {
      setConfig(cfg)
      setStats(st)
      setRetainDays(cfg.retainDays || 30)
      setShowCustom(cfg.customStorage || false)
      if (cfg.customEndpoint) {
        setForm(f => ({
          ...f,
          endpoint: cfg.customEndpoint || '',
          region: cfg.customRegion || 'auto',
          bucket: cfg.customBucket || '',
        }))
      }
    }).finally(() => setLoading(false))
  }, [])

  async function handleTestR2() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.post('/storage/test', { type: 'r2' })
      setTestResult({ success: true, message: res.data.message })
    } catch (err: any) {
      setTestResult({ success: false, message: formatApiError(err) })
    } finally {
      setTesting(false)
    }
  }

  async function handleTestCustom() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.post('/storage/test', {
        type: 'custom',
        endpoint: form.endpoint,
        region: form.region,
        bucket: form.bucket,
        accessKey: form.accessKey,
        secretKey: form.secretKey,
        createBucket: form.createBucket,
      })
      setTestResult({ success: true, message: res.data.message })
    } catch (err: any) {
      setTestResult({ success: false, message: formatApiError(err) })
    } finally {
      setTesting(false)
    }
  }

  async function handleSaveRetention() {
    setSaving(true)
    try {
      await api.post('/storage/lifecycle', { retainDays })
      setTestResult({ success: true, message: `Retenção atualizada para ${retainDays} dias` })
      const cfg = await api.get('/storage/config').then(r => r.data)
      setConfig(cfg)
    } catch (err: any) {
      setTestResult({ success: false, message: formatApiError(err) })
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveCustom() {
    setSaving(true)
    try {
      await api.put('/storage/config', {
        customEndpoint: form.endpoint || null,
        customRegion: form.region || null,
        customBucket: form.bucket || null,
        customAccessKey: form.accessKey || undefined,
        customSecretKey: form.secretKey || undefined,
        retainDays,
      })
      setTestResult({ success: true, message: 'Configuração salva!' })
      const cfg = await api.get('/storage/config').then(r => r.data)
      setConfig(cfg)
    } catch (err: any) {
      setTestResult({ success: false, message: formatApiError(err) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingCard text="Carregando configuração..." />

  const isR2Active = config?.r2Enabled && config?.activeStorage === 'r2'
  const isCustomActive = config?.activeStorage === 'custom'

  return (
    <div className="space-y-4">
      {/* R2 Status (Primary) */}
      {config?.r2Enabled && (
        <GlassCard className="p-4 border-emerald-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center">
                <Server className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  Cloudflare R2
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                    {isR2Active ? 'ATIVO' : 'DISPONÍVEL'}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  {config.r2Bucket} · Egress grátis · Lifecycle automático
                </p>
              </div>
            </div>
            <button onClick={handleTestR2} disabled={testing} className={cn(
              'px-3 py-1.5 text-xs rounded-lg border transition flex items-center gap-1.5',
              'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100',
              'dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400',
              'disabled:opacity-50',
            )}>
              {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Testar
            </button>
          </div>

          {/* R2 Stats */}
          {stats?.type === 'r2' && !stats.error && (
            <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-500/20 grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Bucket</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{stats.bucket}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Objetos</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{stats.totalObjects?.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Tamanho</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{stats.totalSizeMB?.toLocaleString()} MB</p>
              </div>
            </div>
          )}
        </GlassCard>
      )}

      {/* Retention Config */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          Política de Retenção
        </h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Dias de retenção (lifecycle automático)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={retainDays}
              onChange={e => setRetainDays(Number(e.target.value))}
              className={cn(
                'w-full px-3 py-2 text-xs rounded-lg border focus:outline-none transition',
                'bg-white border-slate-200 text-slate-900',
                'dark:bg-white/5 dark:border-white/10 dark:text-white',
              )}
            />
          </div>
          <button
            onClick={handleSaveRetention}
            disabled={saving || retainDays === config?.retainDays}
            className={cn(
              'px-4 py-2 text-xs font-semibold rounded-lg transition flex items-center gap-2',
              'bg-cyan-600 text-white hover:bg-cyan-700',
              'dark:bg-cyan-500 dark:hover:bg-cyan-600',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mt-2">
          Segmentos mais antigos são deletados automaticamente pelo R2 lifecycle rules.
        </p>
      </GlassCard>

      {/* Custom S3 Toggle */}
      <GlassCard className="p-4">
        <button
          onClick={() => setShowCustom(!showCustom)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Storage Customizado (S3/Hetzner/MinIO)
            </span>
            {isCustomActive && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                ATIVO
              </span>
            )}
          </div>
          {showCustom ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {showCustom && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/10 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Endpoint</label>
                <input
                  type="url"
                  value={form.endpoint}
                  onChange={e => setForm(f => ({ ...f, endpoint: e.target.value }))}
                  placeholder="https://fsn1.your-objectstorage.com"
                  className={cn(
                    'w-full px-3 py-2 text-xs rounded-lg border focus:outline-none transition',
                    'bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-cyan-500',
                    'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500',
                  )}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Região</label>
                <select
                  value={form.region}
                  onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
                  className={cn(
                    'w-full px-3 py-2 text-xs rounded-lg border focus:outline-none transition',
                    'bg-white border-slate-200 text-slate-900',
                    'dark:bg-white/5 dark:border-white/10 dark:text-white',
                  )}
                >
                  <option value="auto">auto (R2)</option>
                  <option value="fsn1">fsn1 (Hetzner)</option>
                  <option value="nbg1">nbg1 (Hetzner)</option>
                  <option value="us-east-1">us-east-1 (AWS)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Bucket</label>
                <input
                  type="text"
                  value={form.bucket}
                  onChange={e => setForm(f => ({ ...f, bucket: e.target.value }))}
                  placeholder="meu-bucket"
                  className={cn(
                    'w-full px-3 py-2 text-xs rounded-lg border focus:outline-none transition',
                    'bg-white border-slate-200 text-slate-900 placeholder-slate-400',
                    'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500',
                  )}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Access Key</label>
                <input
                  type="text"
                  value={form.accessKey}
                  onChange={e => setForm(f => ({ ...f, accessKey: e.target.value }))}
                  placeholder={config?.hasCustomCredentials ? '••••••••' : 'Access Key'}
                  className={cn(
                    'w-full px-3 py-2 text-xs rounded-lg border focus:outline-none transition font-mono',
                    'bg-white border-slate-200 text-slate-900 placeholder-slate-400',
                    'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500',
                  )}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Secret Key</label>
                <input
                  type="password"
                  value={form.secretKey}
                  onChange={e => setForm(f => ({ ...f, secretKey: e.target.value }))}
                  placeholder={config?.hasCustomCredentials ? '••••••••' : 'Secret Key'}
                  className={cn(
                    'w-full px-3 py-2 text-xs rounded-lg border focus:outline-none transition font-mono',
                    'bg-white border-slate-200 text-slate-900 placeholder-slate-400',
                    'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500',
                  )}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={form.createBucket}
                onChange={e => setForm(f => ({ ...f, createBucket: e.target.checked }))}
                className="rounded border-slate-300 dark:border-slate-600"
              />
              Criar bucket automaticamente se não existir
            </label>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleTestCustom}
                disabled={testing || !form.endpoint || !form.accessKey || !form.secretKey}
                className={cn(
                  'px-4 py-2 text-xs font-semibold rounded-lg border transition flex items-center gap-2',
                  'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100',
                  'dark:bg-white/5 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                Testar
              </button>
              <button
                onClick={handleSaveCustom}
                disabled={saving || !form.endpoint}
                className={cn(
                  'px-4 py-2 text-xs font-semibold rounded-lg transition flex items-center gap-2',
                  'bg-cyan-600 text-white hover:bg-cyan-700',
                  'dark:bg-cyan-500 dark:hover:bg-cyan-600',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Salvar
              </button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Test Result */}
      {testResult && (
        <GlassCard className={cn(
          'p-3 flex items-center gap-2',
          testResult.success
            ? 'border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5'
            : 'border-rose-500/30 bg-rose-50/50 dark:bg-rose-500/5'
        )}>
          {testResult.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          )}
          <p className={cn(
            'text-xs',
            testResult.success ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
          )}>
            {testResult.message}
          </p>
        </GlassCard>
      )}

      {/* Info */}
      <GlassCard className="p-4 border-cyan-500/20">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
            <p><strong>Cloudflare R2:</strong> Storage principal com egress grátis e lifecycle automático.</p>
            <p><strong>Retenção:</strong> Configure os dias de retenção — R2 deleta automaticamente via lifecycle rules.</p>
            <p><strong>Custom S3:</strong> Use seu próprio storage (Hetzner, AWS, MinIO) se preferir.</p>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  const COLOR: Record<string, string> = {
    rose:    'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
    amber:   'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
    sky:     'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
    purple:  'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400',
    slate:   'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  }
  return (
    <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', COLOR[color] ?? COLOR.slate)}>
      {children}
    </span>
  )
}

function LoadingCard({ text }: { text: string }) {
  return (
    <GlassCard className="p-8 flex flex-col items-center justify-center gap-2 text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      <p className="text-xs">{text}</p>
    </GlassCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SENTRY — visível apenas para SUPER_ADMIN
// ═══════════════════════════════════════════════════════════════════════════
const SENTRY_ORG_SLUG = (import.meta as any).env?.VITE_SENTRY_ORG_SLUG ?? 'iacloud-vision'
const SENTRY_BASE     = `https://${SENTRY_ORG_SLUG}.sentry.io`
const SENTRY_PROJECTS = [
  { slug: 'vsaas-backend',  label: 'Backend (Node.js)' },
  { slug: 'vsaas-frontend', label: 'Frontend (React)' },
]

function SentrySection() {
  const integrationStatus = (import.meta as any).env?.VITE_SENTRY_DSN ? 'configured' : 'pending'

  const quickLinks = [
    { label: 'Issues — todos os erros',         path: '/issues/?statsPeriod=24h&query=is%3Aunresolved',                   icon: AlertCircle },
    { label: 'Issues novos hoje',               path: '/issues/?statsPeriod=24h&query=is%3Aunresolved+age%3A-24h',        icon: AlertTriangle },
    { label: 'Performance — rotas lentas',      path: '/performance/',                                                     icon: Zap },
    { label: 'Releases — saúde por deploy',     path: '/releases/',                                                        icon: History },
    { label: 'Alerts — regras ativas',          path: '/alerts/rules/',                                                    icon: Bell },
    { label: 'Dashboards customizados',         path: '/dashboards/',                                                      icon: Sliders },
    { label: 'Source Maps — uploads',           path: '/settings/projects/vsaas-frontend/source-maps/',                    icon: FileText },
    { label: 'Members & Teams',                 path: '/settings/members/',                                                icon: Users },
    { label: 'Quota & Billing',                 path: '/settings/billing/overview/',                                       icon: Receipt },
    { label: 'Audit Log',                       path: '/settings/audit-log/',                                              icon: History },
  ]

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              Sentry — Monitoramento de Erros
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Painel externo para investigar erros, performance e releases. Acesso apenas a Super Admin.
            </p>
          </div>
          <Badge color={integrationStatus === 'configured' ? 'emerald' : 'amber'}>
            {integrationStatus === 'configured' ? 'Integrado' : 'Aguardando DSN'}
          </Badge>
        </header>

        {integrationStatus === 'pending' && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
              <p className="font-semibold">Integração pendente</p>
              <p className="mt-1">
                O SDK do Sentry ainda não está conectado a este frontend. Defina <code className="font-mono bg-amber-500/20 px-1 rounded">VITE_SENTRY_DSN</code> no
                build e <code className="font-mono bg-amber-500/20 px-1 rounded">SENTRY_DSN_BACKEND</code> no Docker secret do backend
                para começar a receber eventos. Detalhes: <code className="font-mono">docs/runbook-sentry.md</code>.
              </p>
            </div>
          </div>
        )}

        {/* Botão grande — abrir painel principal */}
        <a
          href={SENTRY_BASE}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 p-3 rounded-lg bg-cyan-50 hover:bg-cyan-100 dark:bg-cyan-500/10 dark:hover:bg-cyan-500/20 border border-cyan-200 dark:border-cyan-500/30 transition group"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-cyan-100 dark:bg-cyan-500/20 flex items-center justify-center shrink-0">
              <ExternalLink className="w-4 h-4 text-cyan-700 dark:text-cyan-300" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-cyan-900 dark:text-cyan-100">Abrir painel Sentry</p>
              <p className="text-[10px] text-cyan-700 dark:text-cyan-400 font-mono truncate">{SENTRY_BASE}</p>
            </div>
          </div>
          <ExternalLink className="w-4 h-4 text-cyan-700 dark:text-cyan-300 shrink-0 group-hover:translate-x-0.5 transition" />
        </a>
      </GlassCard>

      {/* Projetos */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-xs font-bold text-slate-900 dark:text-white">Projetos</h3>
        <p className="text-[11px] text-slate-500">Atalhos diretos para os projetos do workspace.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SENTRY_PROJECTS.map(p => (
            <a
              key={p.slug}
              href={`${SENTRY_BASE}/projects/${p.slug}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 transition group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Server className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-slate-900 dark:text-white truncate">{p.label}</p>
                  <p className="text-[10px] text-slate-500 font-mono truncate">{p.slug}</p>
                </div>
              </div>
              <ExternalLink className="w-3 h-3 text-slate-400 shrink-0 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition" />
            </a>
          ))}
        </div>
      </GlassCard>

      {/* Atalhos rápidos */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-xs font-bold text-slate-900 dark:text-white">Atalhos rápidos</h3>
        <p className="text-[11px] text-slate-500">Os links mais usados no dia-a-dia de operação.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {quickLinks.map(link => {
            const Icon = link.icon
            return (
              <a
                key={link.path}
                href={`${SENTRY_BASE}${link.path}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 transition group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">{link.label}</span>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-400 shrink-0 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition" />
              </a>
            )
          })}
        </div>
      </GlassCard>

      {/* Informações úteis */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-slate-500" />
          O que está nos planos
        </h3>
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <div className="space-y-1">
            <p className="text-slate-500 uppercase tracking-wide text-[9px]">Quota mensal (free)</p>
            <ul className="space-y-0.5 text-slate-700 dark:text-slate-300">
              <li>5.000 errors</li>
              <li>10.000 performance units</li>
              <li>50 session replays</li>
              <li>30 dias retenção issues</li>
            </ul>
          </div>
          <div className="space-y-1">
            <p className="text-slate-500 uppercase tracking-wide text-[9px]">Quando upgrade</p>
            <ul className="space-y-0.5 text-slate-700 dark:text-slate-300">
              <li>Team: ~$26/mês — 50k errors</li>
              <li>Business: ~$80/mês + SAML/audit</li>
              <li>Recomendado: ao chegar 5+ pilotos pagos</li>
            </ul>
          </div>
        </div>
        <div className="pt-3 mt-3 border-t border-slate-200 dark:border-white/5">
          <a
            href={`${SENTRY_BASE}/settings/billing/overview/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-cyan-700 dark:text-cyan-400 hover:underline inline-flex items-center gap-1"
          >
            Ver consumo atual no painel <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </GlassCard>
    </div>
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
