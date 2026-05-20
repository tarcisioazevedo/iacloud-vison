import { useState, useEffect } from 'react'
import { UserPlus, LogOut, ChevronRight, X, Check, Loader2, Eye, EyeOff, Bell, BellOff, Fingerprint, Lock } from 'lucide-react'
import { useMe, api, getVapidPublicKey, subscribePush, unsubscribePush, changePassword } from '../../api/client'
import { cn } from '../../lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { haptic } from '../../lib/haptic'

// ── Push Notifications hook ────────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

function usePushToggle() {
  const [status, setStatus] = useState<'loading' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'>('loading')
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported'); return
    }
    if (Notification.permission === 'denied') {
      setStatus('denied'); return
    }
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setStatus(sub ? 'subscribed' : 'unsubscribed')
      })
    })
  }, [])

  async function toggle() {
    if (toggling) return
    setToggling(true)
    try {
      const reg = await navigator.serviceWorker.ready
      if (status === 'subscribed') {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          const keys = sub.toJSON().keys
          await sub.unsubscribe()
          if (keys?.p256dh) await unsubscribePush(keys.p256dh).catch(() => {})
        }
        setStatus('unsubscribed')
      } else {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') { setStatus('denied'); return }
        const { publicKey } = await getVapidPublicKey()
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        })
        const j = sub.toJSON()
        await subscribePush({
          endpoint: sub.endpoint,
          keys: { p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' },
          userAgent: navigator.userAgent,
        })
        setStatus('subscribed')
      }
    } catch (e) {
      console.error('push toggle error', e)
    } finally {
      setToggling(false)
    }
  }

  return { status, toggling, toggle }
}

// ── Biometric Auth ─────────────────────────────────────────────────────────────
function useBiometric() {
  const [available, setAvailable] = useState(false)
  const [enrolled, setEnrolled]   = useState(false)
  const [working, setWorking]     = useState(false)

  useEffect(() => {
    const ok = typeof window !== 'undefined'
      && 'PublicKeyCredential' in window
      && typeof (window as any).PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    if (!ok) return
    ;(window as any).PublicKeyCredential
      .isUserVerifyingPlatformAuthenticatorAvailable()
      .then((v: boolean) => {
        setAvailable(v)
        setEnrolled(localStorage.getItem('icv_biometric_enrolled') === '1')
      })
  }, [])

  async function enroll() {
    if (working) return
    setWorking(true)
    try {
      const userId = localStorage.getItem('icv_user_id') ?? 'user'
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'IA Cloud Vision' }, // Deixa o navegador inferir o RP ID correto automaticamente
          user: {
            id: new TextEncoder().encode(userId),
            name: localStorage.getItem('icv_email') ?? 'user',
            displayName: localStorage.getItem('icv_name') ?? 'Usuário',
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'preferred', // Se o celular não tiver biometria ativa, não quebra
            residentKey: 'required',
            requireResidentKey: true,
          },
          timeout: 60000,
        },
      }) as PublicKeyCredential | null

      if (cred) {
        // Salvar a credencial gerada para chamar na hora do login!
        const rawId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)))
        localStorage.setItem('icv_biometric_id', rawId)
        localStorage.setItem('icv_biometric_enrolled', '1')
        setEnrolled(true)
      }
    } catch (e: any) {
      alert("Erro na Biometria: " + (e.message || e.name || String(e)))
      if (e.name !== 'NotAllowedError') console.error('biometric enroll', e)
    } finally {
      setWorking(false)
    }
  }

  async function unenroll() {
    localStorage.removeItem('icv_biometric_enrolled')
    localStorage.removeItem('icv_biometric_id')
    setEnrolled(false)
  }

  return { available, enrolled, working, enroll, unenroll }
}

// ── Create User Sheet ──────────────────────────────────────────────────────────
function CreateUserSheet({ onClose }: { onClose: () => void }) {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [role, setRole]         = useState('CLIENTE_OPERADOR')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState<{ tempPassword: string } | null>(null)
  const [showPw, setShowPw]     = useState(false)

  async function handleSubmit() {
    if (!name.trim() || !email.trim()) { setError('Nome e e-mail são obrigatórios.'); return }
    setLoading(true); setError(null)
    try {
      const r = await api.post('/users/invite', { name: name.trim(), email: email.trim(), role })
      setSuccess({ tempPassword: r.data?.tempPassword ?? r.data?.password ?? '(enviado por e-mail)' })
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Erro ao criar usuário.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="fixed bottom-0 inset-x-0 z-50 rounded-t-3xl bg-slate-950 border-t border-slate-800 px-4 pb-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-2.5 pb-4">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {success ? (
          /* Tela de sucesso */
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
              <Check className="w-7 h-7 text-emerald-400" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Usuário criado!</h3>
            <p className="text-sm text-slate-400 mb-4">Senha temporária gerada abaixo.</p>
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 mb-4">
              <p className="text-xs text-slate-500 mb-1">E-mail</p>
              <p className="text-sm font-mono text-white mb-3">{email}</p>
              <p className="text-xs text-slate-500 mb-1">Senha temporária</p>
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono text-cyan-400 flex-1">
                  {showPw ? success.tempPassword : '••••••••••••'}
                </p>
                <button onClick={() => setShowPw(v => !v)} className="text-slate-500">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-6">O usuário deve trocar a senha no primeiro acesso.</p>
            <button
              onClick={onClose}
              className="w-full py-3.5 rounded-2xl bg-cyan-500 text-slate-950 text-sm font-bold active:bg-cyan-400"
            >
              Concluído
            </button>
          </div>
        ) : (
          /* Formulário */
          <>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white">Novo usuário</h3>
              <button onClick={onClose} className="p-2 rounded-xl bg-slate-800 text-slate-400 active:bg-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              {/* Nome */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Nome completo</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ex: João Silva"
                  className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500"
                />
              </div>

              {/* Email */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="joao@empresa.com.br"
                  className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500"
                />
              </div>

              {/* Role */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Perfil de acesso</label>
                <div className="space-y-2">
                  {[
                    { value: 'CLIENTE_OPERADOR',   label: 'Operador',   desc: 'Visualiza câmeras e recebe alertas' },
                    { value: 'CLIENTE_SUPERVISOR',  label: 'Supervisor', desc: 'Acesso somente leitura ao dashboard' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setRole(opt.value)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left transition',
                        role === opt.value
                          ? 'border-cyan-500/50 bg-cyan-500/10'
                          : 'border-slate-800 bg-slate-900 active:bg-slate-800',
                      )}
                    >
                      <div className={cn(
                        'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
                        role === opt.value ? 'border-cyan-500 bg-cyan-500' : 'border-slate-600',
                      )}>
                        {role === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{opt.label}</p>
                        <p className="text-xs text-slate-400">{opt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-3">
                <X className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full py-3.5 rounded-2xl bg-cyan-500 text-slate-950 text-sm font-bold disabled:opacity-50 active:bg-cyan-400 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Criar usuário
            </button>
          </>
        )}
      </motion.div>
    </>
  )
}

// ── Change Password Sheet ──────────────────────────────────────────────────────
function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [showCur, setShowCur] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState(false)

  async function handleSubmit() {
    if (!current || !next) { setError('Preencha todos os campos.'); return }
    if (next !== confirm)  { setError('As senhas não coincidem.'); return }
    if (next.length < 8)   { setError('Mínimo 8 caracteres.'); return }
    setLoading(true); setError(null)
    try {
      await changePassword(current, next)
      haptic([50, 30, 80])
      setDone(true)
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Senha atual incorreta ou erro no servidor.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="fixed bottom-0 inset-x-0 z-50 rounded-t-3xl bg-slate-950 border-t border-slate-800 px-4 pb-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2.5 pb-4">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {done ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
              <Check className="w-7 h-7 text-emerald-400" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Senha alterada!</h3>
            <p className="text-sm text-slate-400 mb-6">Use a nova senha no próximo login.</p>
            <button onClick={onClose}
              className="w-full py-3.5 rounded-2xl bg-cyan-500 text-slate-950 text-sm font-bold active:bg-cyan-400">
              Concluído
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white">Alterar senha</h3>
              <button onClick={onClose} className="p-2 rounded-xl bg-slate-800 text-slate-400 active:bg-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              {/* Senha atual */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Senha atual</label>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-2xl px-4 py-3 focus-within:border-cyan-500">
                  <input
                    type={showCur ? 'text' : 'password'}
                    value={current}
                    onChange={e => setCurrent(e.target.value)}
                    placeholder="••••••••"
                    className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
                  />
                  <button onClick={() => setShowCur(v => !v)} className="text-slate-500 pl-2">
                    {showCur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Nova senha */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Nova senha</label>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-2xl px-4 py-3 focus-within:border-cyan-500">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={next}
                    onChange={e => setNext(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
                  />
                  <button onClick={() => setShowNew(v => !v)} className="text-slate-500 pl-2">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {/* Strength bar */}
                {next.length > 0 && (
                  <div className="mt-1.5 flex gap-1">
                    {[8, 12, 16].map((len, i) => (
                      <div key={i} className={cn(
                        'h-1 flex-1 rounded-full transition-colors',
                        next.length >= len
                          ? i === 0 ? 'bg-red-500' : i === 1 ? 'bg-amber-500' : 'bg-emerald-500'
                          : 'bg-slate-700',
                      )} />
                    ))}
                  </div>
                )}
              </div>

              {/* Confirmar */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Confirmar nova senha</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repita a nova senha"
                  className={cn(
                    'w-full bg-slate-900 border rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none',
                    confirm && next !== confirm ? 'border-red-500' : 'border-slate-700 focus:border-cyan-500',
                  )}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-3">
                <X className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full py-3.5 rounded-2xl bg-cyan-500 text-slate-950 text-sm font-bold disabled:opacity-50 active:bg-cyan-400 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Alterar senha
            </button>
          </>
        )}
      </motion.div>
    </>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export function MobileProfilePage() {
  const { data: me } = useMe()
  const [showCreateUser, setShowCreateUser]   = useState(false)
  const [showChangePass, setShowChangePass]   = useState(false)
  const push      = usePushToggle()
  const biometric = useBiometric()

  const role    = localStorage.getItem('icv_role') ?? ''
  const isAdmin = role === 'CLIENTE_ADMIN'

  function handleLogout() {
    localStorage.removeItem('icv_token')
    localStorage.removeItem('icv_role')
    window.location.href = '/login'
  }

  const ROLE_LABELS: Record<string, string> = {
    CLIENTE_ADMIN:      'Administrador',
    CLIENTE_OPERADOR:   'Operador',
    CLIENTE_SUPERVISOR: 'Supervisor',
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="px-4 pt-4 pb-3 shrink-0">
        <h1 className="text-lg font-bold text-white">Perfil</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        {/* Avatar card */}
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-cyan-700 flex items-center justify-center shrink-0">
            <span className="text-xl font-bold text-white">
              {(me?.name ?? 'U').charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{me?.name ?? '—'}</p>
            <p className="text-xs text-slate-400 truncate">{me?.email ?? '—'}</p>
            <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              {ROLE_LABELS[role] ?? role}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          {/* Criar usuário — só CLIENTE_ADMIN */}
          {isAdmin && (
            <button
              onClick={() => setShowCreateUser(true)}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-slate-900 border border-slate-800 active:bg-slate-800"
            >
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                <UserPlus className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-white">Criar usuário</p>
                <p className="text-xs text-slate-400">Adicionar operador ou supervisor</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
            </button>
          )}

          {/* Informações da conta */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 divide-y divide-slate-800">
            {[
              ['Cliente', me?.clienteFinal?.name ?? '—'],
              ['Conta criada', me?.createdAt ? new Date(me.createdAt).toLocaleDateString('pt-BR') : '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-4 py-3.5">
                <span className="text-xs text-slate-500">{label}</span>
                <span className="text-xs font-medium text-slate-200">{value}</span>
              </div>
            ))}
          </div>

          {/* ── Alterar senha ────────────────────────────────────── */}
          <button
            onClick={() => setShowChangePass(true)}
            className="w-full flex items-center gap-3 p-4 rounded-2xl bg-slate-900 border border-slate-800 active:bg-slate-800"
          >
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-white">Alterar senha</p>
              <p className="text-xs text-slate-400">Trocar a senha da sua conta</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
          </button>

          {/* ── Notificações push ────────────────────────────────── */}
          {push.status !== 'unsupported' && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800">
              <div className="flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                    {push.status === 'subscribed'
                      ? <Bell className="w-4 h-4 text-violet-400" />
                      : <BellOff className="w-4 h-4 text-slate-500" />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Notificações push</p>
                    <p className="text-xs text-slate-400">
                      {push.status === 'subscribed'  ? 'Ativadas neste dispositivo'  :
                       push.status === 'denied'       ? 'Bloqueadas pelo navegador'   :
                       push.status === 'loading'      ? 'Verificando…'               :
                       'Desativadas'}
                    </p>
                  </div>
                </div>
                {push.status !== 'denied' && push.status !== 'loading' && (
                  <button
                    onClick={push.toggle}
                    disabled={push.toggling}
                    className={cn(
                      'relative w-12 h-6 rounded-full transition-colors',
                      push.status === 'subscribed' ? 'bg-violet-500' : 'bg-slate-700',
                    )}
                  >
                    {push.toggling
                      ? <Loader2 className="w-3 h-3 animate-spin text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                      : <span className={cn(
                          'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                          push.status === 'subscribed' ? 'left-6' : 'left-0.5',
                        )} />
                    }
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Biometria (Removido Temporariamente) ── */}
          {/*
          {biometric.available && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800">
              <div className="flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                    <Fingerprint className={cn('w-4 h-4', biometric.enrolled ? 'text-emerald-400' : 'text-slate-500')} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Login biométrico</p>
                    <p className="text-xs text-slate-400">
                      {biometric.enrolled ? 'Digital/Face ID cadastrado' : 'Usar digital ou Face ID para entrar'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={biometric.enrolled ? biometric.unenroll : biometric.enroll}
                  disabled={biometric.working}
                  className={cn(
                    'relative w-12 h-6 rounded-full transition-colors',
                    biometric.enrolled ? 'bg-emerald-500' : 'bg-slate-700',
                  )}
                >
                  {biometric.working
                    ? <Loader2 className="w-3 h-3 animate-spin text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    : <span className={cn(
                        'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                        biometric.enrolled ? 'left-6' : 'left-0.5',
                      )} />
                  }
                </button>
              </div>
            </div>
          )}
          */}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 active:bg-red-500/20"
          >
            <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
              <LogOut className="w-4 h-4 text-red-400" />
            </div>
            <span className="text-sm font-semibold text-red-400">Sair da conta</span>
          </button>
        </div>

        <p className="text-center text-xs text-slate-600 pb-2">VSaaS v1.0 · app.vsaas.com.br</p>
      </div>

      <AnimatePresence>
        {showCreateUser && (
          <CreateUserSheet onClose={() => setShowCreateUser(false)} />
        )}
        {showChangePass && (
          <ChangePasswordSheet onClose={() => setShowChangePass(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
