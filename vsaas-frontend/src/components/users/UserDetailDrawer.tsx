/**
 * UserDetailDrawer — gestão completa de um usuário do tenant.
 *
 * Drawer lateral (slide-in da direita, ~480px) com header (avatar/nome/role +
 * ações destrutivas) e 6 abas internas:
 *
 *   1. Perfil       — nome, role, status, tags, expiresAt
 *   2. Permissões   — escopo de sites/câmeras, agenda, capabilityOverrides
 *   3. Sessões      — lista de UserSession + revogação por linha / em massa
 *   4. 2FA          — status TOTP (read-only — disable só pelo próprio user)
 *   5. Acessos Convidado — Magic Links que o user criou (filtra client-side)
 *   6. Atividade    — audit log filtrado por userId
 *
 * Padrão visual baseado em GuestLinkDetailDrawer.tsx.
 *
 * Backend usado:
 *   - GET    /users                                  (já carregado pela página pai)
 *   - PATCH  /users/:id
 *   - DELETE /users/:id
 *   - POST   /users/:id/reset-password
 *   - GET    /users/:id/sessions
 *   - POST   /users/:id/sessions/:sessionId/revoke
 *   - POST   /users/:id/sessions/revoke-all
 *   - GET    /audit/explorer?actorId=<id>            (timeline filtrada)
 *   - useGuestLinks() filtrado client-side por createdById
 */
import { useMemo, useState } from 'react'
import {
  X, User as UserIcon, Shield, Clock, Loader2, KeyRound, Trash2, Save,
  AlertTriangle, ShieldCheck, Link2, Activity, Calendar, CheckCircle2,
  Monitor, Lock, MapPin, Camera, Tags, FileJson,
} from 'lucide-react'
import useSWR from 'swr'
import {
  patchUser, deleteUser, resetUserPassword,
  useUserSessions, revokeUserSession, revokeAllUserSessions,
  useSites, useCameras, useGuestLinks,
  formatApiError,
  api,
  type UserRow, type AppRole, type UpdateUserPayload, type AccessSchedule,
  type AuditEntry,
} from '../../api/client'
import { useUiToast } from '../Toast'
import { confirm } from '../ConfirmDialog'
import { cn } from '../../lib/utils'

// ────────────────────────────────────────────────────────────────────────────
// Types & constants
// ────────────────────────────────────────────────────────────────────────────
type Tab = 'profile' | 'permissions' | 'sessions' | 'mfa' | 'guests' | 'activity'

const SCOPED_ROLES: AppRole[] = [
  'CLIENTE_OPERADOR', 'CLIENTE_VIEWER', 'CLIENTE_SUPERVISOR',
  'INTEGRADOR_TECNICO',
]

const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN:        'Super Admin',
  ADMIN_GLOBAL:       'Admin Global',
  INTEGRADOR_ADMIN:   'Integrador Admin',
  INTEGRADOR_TECNICO: 'Integrador Técnico',
  CLIENTE_ADMIN:      'Cliente Admin',
  CLIENTE_SUPERVISOR: 'Cliente Supervisor',
  CLIENTE_OPERADOR:   'Cliente Operador',
  CLIENTE_VIEWER:     'Cliente Visualizador',
}

const ROLE_BADGES: Record<AppRole, string> = {
  SUPER_ADMIN:        'bg-violet-500/15 text-violet-300 border-violet-500/30',
  ADMIN_GLOBAL:       'bg-violet-500/15 text-violet-300 border-violet-500/30',
  INTEGRADOR_ADMIN:   'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  INTEGRADOR_TECNICO: 'bg-cyan-500/10 text-cyan-200 border-cyan-500/20',
  CLIENTE_ADMIN:      'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  CLIENTE_SUPERVISOR: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  CLIENTE_OPERADOR:   'bg-emerald-500/10 text-emerald-200 border-emerald-500/20',
  CLIENTE_VIEWER:     'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const myRole = (typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : '') as AppRole | ''

function isInScopedRole(role: AppRole): boolean {
  return SCOPED_ROLES.includes(role)
}

interface Props {
  user: UserRow
  onClose: () => void
  /** Disparado depois de qualquer mutação que muda o usuário ou a lista. */
  onChanged: () => void
  /** Disparado quando o user clica "Ver na aba Convidados". */
  onSwitchTab?: (tab: 'users' | 'guests' | 'sessions' | 'activity') => void
}

// ────────────────────────────────────────────────────────────────────────────
// Drawer raiz
// ────────────────────────────────────────────────────────────────────────────
export function UserDetailDrawer({ user, onClose, onChanged, onSwitchTab }: Props) {
  const toast = useUiToast()
  const [tab, setTab]       = useState<Tab>('profile')
  const [working, setWorking] = useState(false)

  // Inicial do nome pro avatar
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase()

  async function handleResetPassword() {
    const ok = await confirm({
      title: 'Resetar senha?',
      description: `Uma nova senha temporária será gerada para ${user.email}. Se SMTP estiver configurado, o usuário recebe por email.`,
      confirmLabel: 'Resetar',
    })
    if (!ok) return
    setWorking(true)
    try {
      const result = await resetUserPassword(user.id)
      if (result.emailSent) {
        toast.success({
          title: 'Senha resetada',
          description: `Email enviado para ${user.email}. Senha temporária: ${result.tempPassword}`,
          duration: 12_000,
        })
      } else {
        toast.warning({
          title: 'Senha resetada (email não enviado)',
          description: `Repasse manualmente: ${result.tempPassword} — motivo: ${result.emailReason ?? 'desconhecido'}`,
          duration: 20_000,
        })
      }
      onChanged()
    } catch (err) {
      toast.error({ title: 'Falha ao resetar', description: formatApiError(err) })
    } finally {
      setWorking(false)
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Desativar ${user.name}?`,
      description: 'O usuário não conseguirá mais entrar. Para reativar, edite o cadastro e marque "ativo" novamente.',
      destructive: true,
      confirmLabel: 'Desativar',
      typeToConfirm: user.email,
    })
    if (!ok) return
    setWorking(true)
    try {
      await deleteUser(user.id)
      toast.success(`Usuário ${user.name} desativado`)
      onChanged()
      onClose()
    } catch (err) {
      toast.error({ title: 'Falha ao desativar', description: formatApiError(err) })
    } finally {
      setWorking(false)
    }
  }

  const showPermissions = isInScopedRole(user.role)

  // Lista de abas filtrada — Permissões só pra roles escopáveis.
  const TABS: { id: Tab; label: string; icon: typeof UserIcon }[] = useMemo(() => {
    const base: { id: Tab; label: string; icon: typeof UserIcon }[] = [
      { id: 'profile',     label: 'Perfil',      icon: UserIcon },
    ]
    if (showPermissions) base.push({ id: 'permissions', label: 'Permissões', icon: Lock })
    base.push(
      { id: 'sessions',   label: 'Sessões',    icon: Monitor },
      { id: 'mfa',        label: '2FA',         icon: ShieldCheck },
      { id: 'guests',     label: 'Convidados', icon: Link2 },
      { id: 'activity',   label: 'Atividade',  icon: Activity },
    )
    return base
  }, [showPermissions])

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="w-full max-w-[520px] h-full bg-slate-900 border-l border-white/10 shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">{user.name}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={cn('px-2 py-0.5 rounded text-[10px] border font-mono uppercase', ROLE_BADGES[user.role])}>
                {ROLE_LABELS[user.role]}
              </span>
              {user.active
                ? <span className="text-[10px] uppercase font-mono text-emerald-300">ativo</span>
                : <span className="text-[10px] uppercase font-mono text-rose-300">inativo</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Ações destrutivas (sempre visíveis) */}
        <div className="px-5 py-2 border-b border-white/5 flex items-center gap-2 flex-wrap">
          <button
            onClick={handleResetPassword}
            disabled={working}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-200 text-xs font-semibold disabled:opacity-50"
          >
            <KeyRound className="w-3 h-3" /> Resetar senha
          </button>
          <button
            onClick={handleDelete}
            disabled={working}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-200 text-xs font-semibold disabled:opacity-50"
          >
            <Trash2 className="w-3 h-3" /> Desativar
          </button>
        </div>

        {/* Tabs */}
        <nav className="flex border-b border-white/10 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition shrink-0',
                  tab === t.id
                    ? 'border-cyan-500 text-cyan-300 bg-cyan-500/5'
                    : 'border-transparent text-slate-400 hover:text-white',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            )
          })}
        </nav>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'profile'     && <ProfileTab user={user} onChanged={onChanged} />}
          {tab === 'permissions' && <PermissionsTab user={user} onChanged={onChanged} />}
          {tab === 'sessions'    && <SessionsTab userId={user.id} />}
          {tab === 'mfa'         && <MfaTab user={user} />}
          {tab === 'guests'      && <GuestsTab userId={user.id} onSwitchTab={onSwitchTab} />}
          {tab === 'activity'    && <ActivityTab userId={user.id} />}
        </div>
      </aside>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Aba 1 — Perfil
// ────────────────────────────────────────────────────────────────────────────
function ProfileTab({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const toast = useUiToast()
  const [name, setName]   = useState(user.name)
  const [role, setRole]   = useState<AppRole>(user.role)
  const [active, setActive] = useState(user.active)
  const [tags, setTags]   = useState<string[]>(user.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [expiresAt, setExpiresAt] = useState<string>(
    user.expiresAt ? user.expiresAt.slice(0, 10) : '',
  )
  const [mobileAppAllowed, setMobileAppAllowed] = useState<boolean>(
    user.mobileAppAllowed !== false,  // default true (campo opcional na resposta)
  )
  const [vacationUntil, setVacationUntil] = useState<string>(
    user.vacationUntil ? user.vacationUntil.slice(0, 10) : '',
  )
  // Mapa de ações bloqueadas pra UX de checkbox. Default = vazio (tudo permitido).
  const initialDenied = new Set(user.deniedActions ?? [])
  const [denyExport,   setDenyExport]   = useState<boolean>(initialDenied.has('recordings.export'))
  const [denySnapshot, setDenySnapshot] = useState<boolean>(initialDenied.has('snapshot.take'))
  const [denyBookmark, setDenyBookmark] = useState<boolean>(initialDenied.has('bookmark.create'))
  const [denyDelete,   setDenyDelete]   = useState<boolean>(initialDenied.has('bookmark.delete'))
  const [saving, setSaving] = useState(false)

  // Roles que quem está editando pode atribuir.
  const allowedRoles: AppRole[] = useMemo(() => {
    if (myRole === 'SUPER_ADMIN' || myRole === 'ADMIN_GLOBAL') {
      return ['INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'CLIENTE_ADMIN', 'CLIENTE_SUPERVISOR', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER']
    }
    if (myRole === 'INTEGRADOR_ADMIN') {
      return ['INTEGRADOR_TECNICO', 'CLIENTE_ADMIN', 'CLIENTE_SUPERVISOR', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER']
    }
    if (myRole === 'CLIENTE_ADMIN') {
      return ['CLIENTE_OPERADOR', 'CLIENTE_VIEWER']
    }
    return [user.role]
  }, [user.role])

  function addTag() {
    const v = tagInput.trim()
    if (!v || tags.includes(v)) return
    setTags([...tags, v])
    setTagInput('')
  }
  function removeTag(t: string) {
    setTags(tags.filter(x => x !== t))
  }

  async function save() {
    setSaving(true)
    try {
      const deniedActions: string[] = []
      if (denyExport)   deniedActions.push('recordings.export')
      if (denySnapshot) deniedActions.push('snapshot.take')
      if (denyBookmark) deniedActions.push('bookmark.create')
      if (denyDelete)   deniedActions.push('bookmark.delete')

      // Date inputs (yyyy-mm-dd) sem hora viram 00:00 UTC, que em BRT (UTC-3)
      // é 21:00 do dia ANTERIOR. Pra "expira/volta no dia X" significar fim
      // do dia X em horário local, montamos T23:59:59 local antes de toISOString.
      const toEndOfDayIso = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-').map(Number)
        return new Date(y, m - 1, d, 23, 59, 59).toISOString()
      }
      const body: UpdateUserPayload = {
        name,
        active,
        role,
        expiresAt:     expiresAt     ? toEndOfDayIso(expiresAt)     : null,
        tags,
        mobileAppAllowed,
        vacationUntil: vacationUntil ? toEndOfDayIso(vacationUntil) : null,
        deniedActions,
      }
      await patchUser(user.id, body)
      toast.success('Perfil salvo')
      onChanged()
    } catch (err) {
      toast.error({ title: 'Falha ao salvar', description: formatApiError(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Section title="Identidade" icon={UserIcon}>
        <Field label="Nome">
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Email">
          <input value={user.email} readOnly className={cn(inputCls, 'opacity-60 cursor-not-allowed')} />
        </Field>
        <Field label="Função">
          <select
            value={role}
            onChange={e => setRole(e.target.value as AppRole)}
            disabled={allowedRoles.length === 1}
            className={inputCls}
          >
            {(allowedRoles.includes(role) ? allowedRoles : [role, ...allowedRoles]).map(r => (
              <option key={r} value={r} className="bg-slate-900">{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Usuário ativo (consegue fazer login)
          </label>
        </Field>
      </Section>

      <Section title="Acesso por plataforma" icon={Monitor}>
        <label className="flex items-start gap-2 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20 cursor-pointer">
          <input
            type="checkbox"
            checked={mobileAppAllowed}
            onChange={e => setMobileAppAllowed(e.target.checked)}
            className="mt-0.5 w-4 h-4"
          />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-200">Pode usar o app mobile</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Desmarque pra restringir esse usuário ao desktop (ex: operador de central que
              precisa estar fixo na estação).
            </p>
          </div>
        </label>
      </Section>

      <Section title="Modo Férias" icon={Calendar}>
        <Field label="Volta automática em">
          <input
            type="date"
            value={vacationUntil}
            onChange={e => setVacationUntil(e.target.value)}
            className={inputCls}
          />
        </Field>
        <p className="text-[11px] text-slate-500 mt-1">
          Bloqueia login + ações até a data marcada. Reativa sozinho às 00:00 do dia seguinte.
          Em branco = sem férias agendada.
        </p>
        {vacationUntil && new Date(vacationUntil) > new Date() && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
            🏖️ Em férias até {new Date(vacationUntil).toLocaleDateString('pt-BR')}
          </div>
        )}
      </Section>

      <Section title="Ações bloqueadas" icon={Lock}>
        <p className="text-[11px] text-slate-500 mb-3">
          Marque pra impedir esse usuário de executar a ação. Tudo desmarcado = pode fazer tudo
          (sujeito ao plano e demais permissões).
        </p>
        <div className="space-y-2">
          <DenyToggle label="Baixar/exportar gravações"        checked={denyExport}   onChange={setDenyExport}   />
          <DenyToggle label="Tirar snapshot"                    checked={denySnapshot} onChange={setDenySnapshot} />
          <DenyToggle label="Criar bookmarks/marcadores"        checked={denyBookmark} onChange={setDenyBookmark} />
          <DenyToggle label="Deletar bookmarks (irreversível)" checked={denyDelete}   onChange={setDenyDelete}   />
        </div>
      </Section>

      <Section title="Tenant" icon={Shield}>
        <KV label="Integrador" value={user.integrador?.name ?? '—'} />
        <KV label="Cliente final" value={user.clienteFinal?.name ?? '—'} />
        <KV label="Criado em" value={new Date(user.createdAt).toLocaleString('pt-BR')} />
        {user.lastLoginAt && (
          <KV label="Último login" value={new Date(user.lastLoginAt).toLocaleString('pt-BR')} />
        )}
      </Section>

      <Section title="Tags" icon={Tags}>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.length === 0 && <span className="text-xs text-slate-500">nenhuma tag</span>}
          {tags.map(t => (
            <span key={t} className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[11px] flex items-center gap-1">
              {t}
              <button onClick={() => removeTag(t)} className="hover:text-rose-300"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
            placeholder="ex: plantão_noturno"
            className={inputCls + ' flex-1'}
          />
          <button onClick={addTag} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-200">Adicionar</button>
        </div>
      </Section>

      <Section title="Validade do acesso" icon={Calendar}>
        <Field label="Expira em (deixe em branco para nunca expirar)">
          <input
            type="date"
            value={expiresAt}
            onChange={e => setExpiresAt(e.target.value)}
            className={inputCls}
          />
        </Field>
      </Section>

      <div className="pt-2 sticky bottom-0 bg-slate-900 pb-1">
        <button
          onClick={save}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-sm font-bold disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar perfil
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Aba 2 — Permissões (escopo + agenda + overrides)
// ────────────────────────────────────────────────────────────────────────────
function PermissionsTab({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const toast = useUiToast()
  const { data: sitesData }   = useSites()
  const { data: camerasData } = useCameras() as { data?: { cameras: { id: string; name: string }[] } }

  const sites: { id: string; name: string }[]   = sitesData?.sites ?? []
  const cameras: { id: string; name: string }[] = camerasData?.cameras ?? []

  const [allowedSiteIds, setAllowedSiteIds]     = useState<string[]>(user.allowedSiteIds ?? [])
  const [allowedCameraIds, setAllowedCameraIds] = useState<string[]>(user.allowedCameraIds ?? [])

  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(Boolean(user.accessSchedule))
  const [weekdays, setWeekdays] = useState<number[]>(
    user.accessSchedule?.weekdays ?? [0, 1, 2, 3, 4, 5, 6],
  )
  const [hourStart, setHourStart] = useState<number>(user.accessSchedule?.hourStart ?? 0)
  const [hourEnd, setHourEnd]     = useState<number>(user.accessSchedule?.hourEnd ?? 23)

  const [overridesText, setOverridesText] = useState<string>(
    user.capabilityOverrides ? JSON.stringify(user.capabilityOverrides, null, 2) : '',
  )
  const [overridesError, setOverridesError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function toggleSite(id: string) {
    setAllowedSiteIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function toggleCamera(id: string) {
    setAllowedCameraIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function toggleDay(d: number) {
    setWeekdays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  async function save() {
    let overrides: { add?: string[]; remove?: string[] } | null = null
    if (overridesText.trim()) {
      try {
        const parsed = JSON.parse(overridesText)
        if (typeof parsed !== 'object' || parsed === null) throw new Error('JSON deve ser um objeto')
        overrides = parsed as { add?: string[]; remove?: string[] }
        setOverridesError(null)
      } catch (err: any) {
        setOverridesError(`JSON inválido: ${err.message}`)
        return
      }
    }

    let schedule: AccessSchedule | null = null
    if (scheduleEnabled) {
      if (weekdays.length === 0) {
        toast.error('Selecione ao menos 1 dia da semana')
        return
      }
      schedule = { weekdays, hourStart, hourEnd }
    }

    setSaving(true)
    try {
      await patchUser(user.id, {
        allowedSiteIds,
        allowedCameraIds,
        accessSchedule:      schedule,
        capabilityOverrides: overrides,
      })
      toast.success('Permissões salvas')
      onChanged()
    } catch (err) {
      toast.error({ title: 'Falha ao salvar', description: formatApiError(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Section title="Sites permitidos" icon={MapPin}>
        <p className="text-[11px] text-slate-500 mb-2">
          Vazio = acesso a TODOS os sites do tenant. Selecione para restringir.
        </p>
        <MultiSelect
          options={sites}
          selected={allowedSiteIds}
          onToggle={toggleSite}
          emptyLabel="nenhum site cadastrado"
        />
      </Section>

      <Section title="Câmeras permitidas" icon={Camera}>
        <p className="text-[11px] text-slate-500 mb-2">
          Vazio = acesso a TODAS as câmeras dos sites permitidos.
        </p>
        <MultiSelect
          options={cameras}
          selected={allowedCameraIds}
          onToggle={toggleCamera}
          emptyLabel="nenhuma câmera cadastrada"
        />
      </Section>

      <Section title="Agenda de acesso" icon={Clock}>
        <label className="flex items-center gap-2 text-sm text-slate-300 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={e => setScheduleEnabled(e.target.checked)}
          />
          Restringir por dia/horário
        </label>
        {scheduleEnabled && (
          <>
            <div className="flex gap-1 flex-wrap mb-3">
              {WEEKDAY_LABELS.map((label, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] font-semibold border transition',
                    weekdays.includes(idx)
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:text-white',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Hora início (0-23)">
                <input
                  type="number" min={0} max={23}
                  value={hourStart}
                  onChange={e => setHourStart(Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)))}
                  className={inputCls}
                />
              </Field>
              <Field label="Hora fim (0-23)">
                <input
                  type="number" min={0} max={23}
                  value={hourEnd}
                  onChange={e => setHourEnd(Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)))}
                  className={inputCls}
                />
              </Field>
            </div>
          </>
        )}
      </Section>

      <Section title="Capability overrides (avançado)" icon={FileJson}>
        <p className="text-[11px] text-slate-500 mb-2">
          JSON com <code className="text-cyan-300">{`{ add: ["cap.x"], remove: ["cap.y"] }`}</code>.
          Deixe vazio se não houver overrides.
        </p>
        <textarea
          value={overridesText}
          onChange={e => setOverridesText(e.target.value)}
          placeholder={'{\n  "add": [],\n  "remove": []\n}'}
          rows={6}
          className={cn(inputCls, 'font-mono text-xs')}
        />
        {overridesError && (
          <p className="text-[11px] text-rose-300 mt-1">{overridesError}</p>
        )}
      </Section>

      <div className="pt-2 sticky bottom-0 bg-slate-900 pb-1">
        <button
          onClick={save}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-sm font-bold disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar permissões
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Aba 3 — Sessões
// ────────────────────────────────────────────────────────────────────────────
function SessionsTab({ userId }: { userId: string }) {
  const toast = useUiToast()
  const { data, isLoading, mutate } = useUserSessions(userId)
  const sessions = data?.sessions ?? []

  async function revoke(sessionId: string) {
    const ok = await confirm({
      title: 'Revogar essa sessão?',
      description: 'O dispositivo será deslogado no próximo request.',
      destructive: true,
      confirmLabel: 'Revogar',
    })
    if (!ok) return
    try {
      await revokeUserSession(userId, sessionId)
      toast.success('Sessão revogada')
      void mutate()
    } catch (err) {
      toast.error({ title: 'Falha', description: formatApiError(err) })
    }
  }

  async function revokeAll() {
    const ok = await confirm({
      title: 'Revogar TODAS as sessões?',
      description: 'O usuário precisará fazer login novamente em todos os dispositivos.',
      destructive: true,
      confirmLabel: 'Revogar tudo',
    })
    if (!ok) return
    try {
      const result = await revokeAllUserSessions(userId)
      toast.success(`${result.revoked} sessão(ões) revogada(s)`)
      void mutate()
    } catch (err) {
      toast.error({ title: 'Falha', description: formatApiError(err) })
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-8 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }

  const active = sessions.filter(s => s.active)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          {sessions.length} sessão(ões) — {active.length} ativa(s)
        </p>
        {active.length > 0 && (
          <button
            onClick={revokeAll}
            className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Revogar todas
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="text-center text-sm text-slate-500 py-8">Sem sessões registradas.</div>
      ) : (
        sessions.map(s => (
          <div key={s.id} className={cn(
            'border rounded-lg p-3 text-xs',
            s.active
              ? (s.online ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-white/5')
              : 'border-white/5 bg-white/[0.02] opacity-60',
          )}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Monitor className="w-3 h-3 text-slate-400" />
                  <span className="text-slate-200 font-mono truncate">{s.device ?? 'dispositivo desconhecido'}</span>
                  {s.online && (
                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-bold uppercase">online</span>
                  )}
                  {!s.active && (
                    <span className="px-1.5 py-0.5 rounded-full bg-slate-500/20 text-slate-400 border border-slate-500/30 text-[9px] font-bold uppercase">
                      {s.revokedAt ? 'revogada' : 'expirada'}
                    </span>
                  )}
                </div>
                <div className="text-slate-500 space-x-3">
                  <span>IP: {s.ip ?? '—'}</span>
                  <span>Último: {new Date(s.lastSeenAt).toLocaleString('pt-BR')}</span>
                </div>
                <div className="text-slate-600 mt-0.5">
                  Criada em {new Date(s.createdAt).toLocaleString('pt-BR')}
                </div>
              </div>
              {s.active && (
                <button
                  onClick={() => revoke(s.id)}
                  className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[11px] shrink-0"
                >
                  Revogar
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Aba 4 — 2FA (read-only / admin info)
// ────────────────────────────────────────────────────────────────────────────
function MfaTab({ user }: { user: UserRow }) {
  const enabled = Boolean(user.totpEnabledAt)
  return (
    <div className="space-y-4">
      <div className={cn(
        'rounded-xl p-4 border flex items-start gap-3',
        enabled
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : 'bg-amber-500/10 border-amber-500/30',
      )}>
        {enabled
          ? <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
          : <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />}
        <div className="flex-1">
          <p className={cn('text-sm font-bold', enabled ? 'text-emerald-200' : 'text-amber-200')}>
            {enabled ? '2FA (TOTP) habilitado' : '2FA (TOTP) NÃO habilitado'}
          </p>
          {enabled && user.totpEnabledAt && (
            <p className="text-xs text-slate-400 mt-1">
              Habilitado em {new Date(user.totpEnabledAt).toLocaleString('pt-BR')}
            </p>
          )}
          {!enabled && (
            <p className="text-xs text-slate-400 mt-1">
              O usuário pode ativar via Configurações → Segurança.
            </p>
          )}
        </div>
      </div>

      {enabled && (
        <div className="rounded-xl p-4 border border-white/10 bg-white/[0.03] text-xs text-slate-400 space-y-2">
          <p className="text-slate-300 font-semibold">Por que não desativo o 2FA por aqui?</p>
          <p>
            Por segurança, apenas o próprio usuário pode remover o segundo fator
            (rota <code className="text-cyan-300 font-mono">/me/totp/disable</code> via Configurações).
            Se ele perdeu o dispositivo, use <strong>Resetar senha</strong> no topo do drawer
            — ao fazer login novamente o admin pode forçar nova configuração de 2FA via política.
          </p>
        </div>
      )}

      {user.lockedUntil && new Date(user.lockedUntil) > new Date() && (
        <div className="rounded-xl p-3 border border-rose-500/30 bg-rose-500/10 text-xs text-rose-200 flex items-start gap-2">
          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Conta <strong>bloqueada</strong> até {new Date(user.lockedUntil).toLocaleString('pt-BR')} —
            excesso de tentativas de login. Use "Resetar senha" pra destravar.
          </span>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Aba 5 — Acessos Convidado (filtrado client-side por createdById)
// ────────────────────────────────────────────────────────────────────────────
function GuestsTab({ userId, onSwitchTab }: {
  userId: string
  onSwitchTab?: (tab: 'users' | 'guests' | 'sessions' | 'activity') => void
}) {
  const { data, isLoading } = useGuestLinks({ search: '', periodDays: 365 })
  const links = (data?.links ?? []).filter(l => l.createdById === userId)

  if (isLoading) {
    return <div className="flex justify-center py-8 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }

  if (links.length === 0) {
    return (
      <div className="text-center text-sm text-slate-500 py-8">
        <Link2 className="w-8 h-8 mx-auto opacity-50 mb-2" />
        <p>Esse usuário não criou nenhum Magic Link nos últimos 365 dias.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {links.map(l => (
        <div key={l.id} className="border border-white/10 rounded-lg p-3 text-xs bg-white/[0.03]">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-slate-200 font-semibold truncate">{l.guestName}</p>
              <p className="text-slate-500 truncate">{l.purpose}</p>
              <p className="text-slate-600 mt-1">
                Criado em {new Date(l.createdAt).toLocaleString('pt-BR')} ·
                expira {new Date(l.validUntil).toLocaleString('pt-BR')}
              </p>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold border bg-white/5 text-slate-300 border-white/10 shrink-0">
              {l.status}
            </span>
          </div>
        </div>
      ))}

      {onSwitchTab && (
        <button
          onClick={() => onSwitchTab('guests')}
          className="w-full mt-2 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-semibold"
        >
          Ver na aba "Convidados"
        </button>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Aba 6 — Atividade (audit timeline filtrada por actorId)
// ────────────────────────────────────────────────────────────────────────────
function ActivityTab({ userId }: { userId: string }) {
  const fetcher = (url: string) => api.get(url).then(r => r.data)
  const { data, isLoading } = useSWR<{ logs: AuditEntry[]; total: number }>(
    `/audit/explorer?actorId=${encodeURIComponent(userId)}&limit=50&days=90`,
    fetcher,
    { revalidateOnFocus: false },
  )
  const logs = data?.logs ?? []

  if (isLoading) {
    return <div className="flex justify-center py-8 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }

  if (logs.length === 0) {
    return (
      <div className="text-center text-sm text-slate-500 py-8">
        <Activity className="w-8 h-8 mx-auto opacity-50 mb-2" />
        <p>Sem atividade registrada nos últimos 90 dias.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {logs.map(l => (
        <div key={l.id} className="border border-white/10 rounded-lg p-2.5 text-xs bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2">
            <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border', actionPill(l.action))}>
              {l.action}
            </span>
            <span className="text-slate-500 text-[10px]">
              {new Date(l.createdAt).toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="text-slate-400 mt-1 truncate">
            {l.resource}{l.resourceId ? ` · ${l.resourceId.slice(0, 8)}…` : ''}
            {l.ipAddress ? ` · ${l.ipAddress}` : ''}
          </div>
        </div>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers compartilhados
// ────────────────────────────────────────────────────────────────────────────
function actionPill(a: string): string {
  if (a.includes('FAILED') || a.includes('DENIED') || a.includes('REVOKED') || a.includes('DELETED') || a.includes('DEACTIVATED'))
    return 'bg-rose-500/20 text-rose-300 border-rose-500/30'
  if (a.includes('SUCCESS') || a.includes('ENABLED') || a.includes('CREATED'))
    return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
  if (a.includes('UPDATED') || a.includes('CHANGED'))
    return 'bg-amber-500/20 text-amber-300 border-amber-500/30'
  return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
}

function Section({ title, icon: Icon, children }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5 mb-2.5">
        <Icon className="w-3.5 h-3.5 text-cyan-400" /> {title}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  )
}

function MultiSelect({ options, selected, onToggle, emptyLabel }: {
  options:    { id: string; name: string }[]
  selected:   string[]
  onToggle:   (id: string) => void
  emptyLabel: string
}) {
  const [search, setSearch] = useState('')
  const filtered = options.filter(o => o.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar…"
        className={cn(inputCls, 'mb-2 text-xs')}
      />
      <div className="max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/20 divide-y divide-white/5">
        {options.length === 0 && (
          <p className="px-3 py-2 text-xs text-slate-500">{emptyLabel}</p>
        )}
        {filtered.map(o => {
          const checked = selected.includes(o.id)
          return (
            <label key={o.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 cursor-pointer">
              <input type="checkbox" checked={checked} onChange={() => onToggle(o.id)} />
              <span className="truncate flex-1">{o.name}</span>
            </label>
          )
        })}
      </div>
      <p className="text-[10px] text-slate-500 mt-1">{selected.length} selecionado(s)</p>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20'

// Toggle "negação" — vermelho quando ativo (visual = ação bloqueada).
function DenyToggle({ label, checked, onChange }: {
  label:    string
  checked:  boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className={cn(
      'flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition',
      checked
        ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        : 'bg-white/5 border-white/10 text-slate-300 hover:border-white/20',
    )}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4"
      />
      <span className="text-xs flex-1">{label}</span>
      {checked && <span className="text-[9px] uppercase font-bold">bloqueado</span>}
    </label>
  )
}
