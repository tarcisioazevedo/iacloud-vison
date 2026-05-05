import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, Search, RefreshCw, Download, User, Camera, X, Loader2 } from 'lucide-react'
import { NotificationsBell } from '../notifications/NotificationsBell'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useKpis, api, formatApiError } from '../../api/client'
import { ThemeToggle } from './ThemeToggle'

const VERTICAL_LABELS: Record<string, string> = {
  SHOPPING_MALL: '🏬 Shopping',
  RETAIL:        '🛍️ Varejo',
  INDUSTRIAL:    '🏭 Indústria',
  OFFICE:        '🏢 Escritório',
  SCHOOL:        '🏫 Escola',
  CONDOMINIUM:   '🏘️ Condomínio',
  HEALTHCARE:    '🏥 Saúde',
}

interface TopBarProps {
  title?: string
  vertical?: string
}

// ── Avatar upload mini-modal ─────────────────────────────────────────────────
function AvatarMenu() {
  const [open, setOpen]       = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const fileRef               = useRef<HTMLInputElement>(null)

  // Read avatar from localStorage cache (set on upload success)
  const cached = localStorage.getItem('icv_avatar') ?? ''
  const [avatarUrl, setAvatarUrl] = useState(cached)

  const role = localStorage.getItem('icv_role') ?? ''

  // Only User roles support avatarUrl (not SUPER_ADMIN / INTEGRADOR_ADMIN)
  const supportsAvatar = role !== 'SUPER_ADMIN' && role !== 'INTEGRADOR_ADMIN'

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Selecione uma imagem'); return }
    if (file.size > 2 * 1024 * 1024) { setError('Imagem deve ter no máximo 2MB'); return }

    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string
      setSaving(true)
      setError('')
      try {
        await api.patch('/auth/me/avatar', { avatarUrl: dataUrl })
        localStorage.setItem('icv_avatar', dataUrl)
        setAvatarUrl(dataUrl)
        setOpen(false)
      } catch (err: any) {
        setError(formatApiError(err))
      } finally {
        setSaving(false)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleRemove = async () => {
    setSaving(true)
    setError('')
    try {
      await api.patch('/auth/me/avatar', { avatarUrl: null })
      localStorage.removeItem('icv_avatar')
      setAvatarUrl('')
      setOpen(false)
    } catch (err: any) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={[
          'w-8 h-8 rounded-xl border overflow-hidden flex items-center justify-center transition-colors',
          'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200',
          'dark:bg-white/10 dark:border-white/8 dark:text-slate-300 dark:hover:bg-white/15',
        ].join(' ')}
        title="Meu perfil"
      >
        {avatarUrl
          ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
          : <User className="w-4 h-4" />
        }
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={[
              'absolute right-0 top-10 z-50 w-56 rounded-xl border shadow-xl p-3 text-sm',
              'bg-white border-slate-200',
              'dark:bg-space-900 dark:border-white/10',
            ].join(' ')}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-slate-800 dark:text-white text-xs">Foto de perfil</span>
              <button onClick={() => setOpen(false)}>
                <X className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
              </button>
            </div>

            {/* Preview */}
            <div className="flex justify-center mb-3">
              <div className="w-16 h-16 rounded-full border-2 border-slate-200 dark:border-white/10 overflow-hidden bg-slate-100 dark:bg-white/5 flex items-center justify-center">
                {avatarUrl
                  ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                  : <User className="w-7 h-7 text-slate-400" />
                }
              </div>
            </div>

            {error && <p className="text-rose-500 text-xs mb-2 text-center">{error}</p>}

            {supportsAvatar ? (
              <div className="flex flex-col gap-1.5">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={saving}
                  className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  Enviar foto
                </button>
                {avatarUrl && (
                  <button
                    onClick={handleRemove}
                    disabled={saving}
                    className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-400 text-xs font-medium hover:bg-rose-50 dark:hover:bg-rose-900/20 transition disabled:opacity-50"
                  >
                    Remover foto
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                Avatar não disponível para este perfil.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function TopBar({ title = 'Dashboard Analítico', vertical = 'SHOPPING_MALL' }: TopBarProps) {
  const { mutate } = useKpis()
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await mutate()
    setTimeout(() => setRefreshing(false), 600)
  }

  const now = new Date()

  function openCmdK() {
    // Dispara evento de teclado para abrir CommandPalette
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
  }

  return (
    <header className={[
      'sticky top-0 z-30 flex items-center justify-between gap-4 px-6 py-3 border-b backdrop-blur-xl',
      'bg-white/95 border-slate-200',
      // DARK premium: gradiente sutil violet→cyan + border violet/20
      'dark:border-violet-500/20',
      'dark:bg-gradient-to-r dark:from-slate-900/90 dark:via-slate-900/85 dark:to-slate-900/90',
    ].join(' ')}>
      {/* Left */}
      <div className="min-w-0">
        <h1 className="text-base font-bold text-slate-900 dark:text-white truncate">{title}</h1>
        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>{VERTICAL_LABELS[vertical] ?? vertical}</span>
          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-700 shrink-0" />
          <span className="truncate">{format(now, "EEEE, dd 'de' MMMM 'de' yyyy · HH:mm", { locale: ptBR })}</span>
        </p>
      </div>

      {/* Center: search button → abre Cmd+K */}
      <button
        type="button"
        onClick={openCmdK}
        className={[
          'hidden lg:flex items-center gap-2 rounded-xl px-3 py-2 max-w-md flex-1 border transition group',
          'bg-slate-50 border-slate-200 hover:bg-slate-100',
          'dark:bg-slate-900/60 dark:border-violet-500/20',
          'dark:hover:border-violet-500/40 dark:hover:bg-violet-500/5',
        ].join(' ')}
      >
        <Search className="w-3.5 h-3.5 text-slate-400 dark:text-violet-400 shrink-0 group-hover:text-violet-500 transition" />
        <span className="bg-transparent text-xs text-slate-500 dark:text-slate-500 outline-none flex-1 text-left">
          Buscar integrador, cliente, site, câmera ou ação...
        </span>
        <kbd className="hidden xl:inline-flex text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded px-1.5 py-0.5 border border-slate-300 dark:border-slate-700 font-mono shrink-0">
          ⌘K
        </kbd>
      </button>

      {/* Right: actions */}
      <div className="flex items-center gap-2 shrink-0">
        <motion.button
          onClick={handleRefresh}
          whileTap={{ scale: 0.95 }}
          className={[
            'p-2 rounded-xl border transition-all',
            'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            'dark:bg-slate-900/60 dark:border-violet-500/20 dark:text-slate-400 dark:hover:bg-violet-500/10 dark:hover:border-violet-500/40 dark:hover:text-white',
          ].join(' ')}
          title="Atualizar dados"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </motion.button>

        <button className={[
          'p-2 rounded-xl border transition-all',
          'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700',
          'dark:bg-slate-900/60 dark:border-violet-500/20 dark:text-slate-400 dark:hover:bg-violet-500/10 dark:hover:border-violet-500/40 dark:hover:text-white',
        ].join(' ')}>
          <Download className="w-3.5 h-3.5" />
        </button>

        <NotificationsBell />

        {/* Theme toggle (Sun/Moon) */}
        <ThemeToggle size={14} className="!rounded-xl !p-2" />

        {/* User avatar */}
        <AvatarMenu />

        {/* Live indicator com glow rose */}
        <div className={[
          'flex items-center gap-2 px-3 py-1.5 rounded-xl border',
          'bg-rose-500/10 border-rose-500/30',
          'shadow-[0_0_18px_-4px_rgba(244,63,94,0.4)]',
        ].join(' ')}>
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
          <span className="text-xs text-rose-500 dark:text-rose-300 font-bold tracking-wider">AO VIVO</span>
        </div>
      </div>
    </header>
  )
}
