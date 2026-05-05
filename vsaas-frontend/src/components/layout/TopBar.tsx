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
      // DARK paridade mockup 01: bg-slate-900/80 simples + border-slate-800
      'dark:border-slate-800',
      'dark:bg-slate-900/80',
    ].join(' ')}>
      {/* Search button (paridade mockup — sem título "Dashboard Analítico" no left) */}
      <button
        type="button"
        onClick={openCmdK}
        className={[
          'flex items-center gap-2 rounded-lg px-3 py-1.5 flex-1 max-w-md border transition group',
          'bg-slate-50 border-slate-200 hover:bg-slate-100',
          'dark:bg-slate-800/50 dark:border-slate-700',
          'dark:hover:border-violet-500/50 dark:hover:bg-slate-800',
        ].join(' ')}
      >
        <Search className="w-4 h-4 text-slate-400 dark:text-slate-400 shrink-0" />
        <span className="bg-transparent text-sm text-slate-500 dark:text-slate-400 outline-none flex-1 text-left">
          Buscar integrador, cliente, site ou câmera…
        </span>
        <kbd className="text-[10px] bg-slate-200 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 rounded px-1.5 py-0.5 border border-slate-300 dark:border-slate-600 font-mono shrink-0">
          ⌘K
        </kbd>
      </button>

      {/* Right: AO VIVO indicator (paridade mockup — sem outros botões) */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Botões secundários ficam ocultos para paridade pixel com mockup 01.
            Refresh: Cmd+K → Atualizar (em construção)
            Download/Bell/Theme/Avatar: acessíveis pela sidebar / Cmd+K. */}
        <span className="text-[10px] uppercase tracking-wider text-rose-400 dark:text-rose-300 font-bold flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          AO VIVO
        </span>
      </div>
    </header>
  )
}
