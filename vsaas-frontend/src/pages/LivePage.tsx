/**
 * LivePage — mosaico multi-câmera ao vivo (estilo Frigate / CCTV wall).
 *
 * Recursos:
 *   • Layouts 1×1 / 2×2 / 3×3 / 4×4 / 5×5 / 6×6 (36 tiles)
 *   • Presets nomeados: criar, renomear, deletar, trocar rápido
 *   • Drag-and-drop entre tiles (swap) E da sidebar direita (drop = preencher)
 *   • Auto-rotate ciclando entre presets com intervalo configurável
 *   • Sidebar persistente à direita c/ biblioteca de câmeras (paridade Monuv)
 *   • Calendário + relógio para playback histórico global do mosaico
 *   • Cada célula usa <LivePlayer> (WHEP + MJPEG fallback)
 *   • Modo tela cheia global
 *   • Persistência de presets no perfil do usuário (backend) + fallback localStorage
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Grid2x2, Grid3x3, LayoutGrid, Maximize2, Minimize2,
  Plus, X, Camera as CameraIcon, Search, RefreshCw,
  Eye, Settings2, Save, Pencil, Trash2, Play, Pause,
  ChevronDown, Check, Star, Clock, Map as MapIcon,
  History, SkipBack, SkipForward, Bell, Calendar,
  PanelRightOpen, PanelRightClose, Cloud, CloudOff,
  Building2, Shield,
} from 'lucide-react'
import { LivePlayer } from '../components/player/LivePlayer'
import { PlaybackPlayer, type PlaybackPlayerRef } from '../components/player/PlaybackPlayer'
import { PlaybackTimelineZoom } from '../components/player/PlaybackTimelineZoom'
import {
  useCameras, fetchMyMosaics, saveMyMosaics, useMe,
  usePlaybackTimeline,
} from '../api/client'
import { cn } from '../lib/utils'

type Layout = '1x1' | '2x2' | '3x3' | '4x4' | '5x5' | '6x6'

const LAYOUTS: { id: Layout; label: string; cells: number; cols: string; icon: any }[] = [
  { id: '1x1', label: '1×1', cells: 1,  cols: 'grid-cols-1', icon: LayoutGrid },
  { id: '2x2', label: '2×2', cells: 4,  cols: 'grid-cols-2', icon: Grid2x2    },
  { id: '3x3', label: '3×3', cells: 9,  cols: 'grid-cols-3', icon: Grid3x3    },
  { id: '4x4', label: '4×4', cells: 16, cols: 'grid-cols-4', icon: LayoutGrid },
  { id: '5x5', label: '5×5', cells: 25, cols: 'grid-cols-5', icon: LayoutGrid },
  { id: '6x6', label: '6×6', cells: 36, cols: 'grid-cols-6', icon: LayoutGrid },
]

const ROTATE_INTERVALS = [0, 5, 10, 15, 30, 60] // segundos; 0 = desligado
const STORAGE_KEY = 'icv_live_prefs_v2'
const LEGACY_KEY  = 'icv_live_layout'

interface Preset {
  id: string
  name: string
  layout: Layout
  slots: (string | null)[]
}
interface Prefs {
  presets: Preset[]
  activeId: string
  autoRotateSec: number
  /** Sidebar direita (biblioteca) aberta */
  sidebarOpen?: boolean
  /** Playback histórico global do mosaico (paridade Monuv) — ISO */
  playbackAt?: string | null
}

/** Tipo de drag em curso. `slot` = troca entre tiles, `library` = da sidebar */
type DragSource =
  | { kind: 'slot'; slotIndex: number }
  | { kind: 'library'; cameraId: string }
  | null

function uid() { return Math.random().toString(36).slice(2, 10) }

// ── Display code (paridade Monuv `#139761`) ──────────────────────────────
// Determinístico a partir do UUID enquanto o backend não publica `displayCode`.
// Quando `cam.displayCode` existir, é usado preferencialmente.
function hash32(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (((h << 5) - h) + s.charCodeAt(i)) | 0
  return h >>> 0
}
export function displayCodeFor(cam: { id?: string; displayCode?: number | string } | null | undefined): string {
  if (!cam) return '000000'
  if (cam.displayCode != null) return String(cam.displayCode).padStart(6, '0')
  if (!cam.id) return '000000'
  return String(hash32(String(cam.id)) % 1_000_000).padStart(6, '0')
}

/** Formata identificação Monuv-style: `(#139761) Nome da câmera`. */
function formatCameraIdentity(cam: any): string {
  if (!cam) return ''
  const name = cam.name ?? 'Câmera sem nome'
  return `(#${displayCodeFor(cam)}) ${name}`
}

function defaultPreset(layout: Layout = '2x2'): Preset {
  const cells = LAYOUTS.find(l => l.id === layout)!.cells
  return { id: uid(), name: 'Padrão', layout, slots: Array(cells).fill(null) }
}

// ── Favoritas (paridade Monuv) ───────────────────────────────────────────
// Conjunto de cameraIds marcadas como favoritas. Monuv oferece filtro
// "Favoritas" na lista de câmeras; replicamos com persistência local.
const FAV_KEY = 'icv_live_favs_v1'
function loadFavs(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')) }
  catch { return new Set() }
}
function saveFavs(s: Set<string>) {
  localStorage.setItem(FAV_KEY, JSON.stringify([...s]))
}

// ── Playback histórico no grid (paridade Monuv) ──────────────────────────
// Monuv permite rebobinar cada célula do mosaico para ver histórico (até
// 6 meses, limitado pela retenção). Scaffold do seeker: offsetSec negativo
// deslocará o timestamp-alvo no player quando o endpoint de playback
// (`GET /playback/{cameraId}?at=<iso>`) estiver disponível.
const PLAYBACK_OFFSETS = [
  { sec: 0,      label: 'Ao vivo' },
  { sec: -30,    label: '−30s'   },
  { sec: -120,   label: '−2min'  },
  { sec: -600,   label: '−10min' },
  { sec: -3600,  label: '−1h'    },
  { sec: -21600, label: '−6h'    },
  { sec: -86400, label: '−1d'    },
]

function loadPrefs(): Prefs {
  // Tenta V2
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Prefs
      if (p?.presets?.length && p.activeId && p.presets.find(x => x.id === p.activeId)) {
        return { autoRotateSec: 0, sidebarOpen: true, playbackAt: null, ...p }
      }
    }
  } catch {/* fallthrough */}

  // Migra V1
  try {
    const old = localStorage.getItem(LEGACY_KEY)
    if (old) {
      const parsed = JSON.parse(old) as { layout: Layout; slots: (string | null)[] }
      if (LAYOUTS.find(l => l.id === parsed.layout)) {
        const preset: Preset = { id: uid(), name: 'Migrado', layout: parsed.layout, slots: parsed.slots }
        return { presets: [preset], activeId: preset.id, autoRotateSec: 0, sidebarOpen: true, playbackAt: null }
      }
    }
  } catch {/* fallthrough */}

  const p = defaultPreset('2x2')
  return { presets: [p], activeId: p.id, autoRotateSec: 0, sidebarOpen: true, playbackAt: null }
}

/** Sanitiza prefs vindos do backend (defesa contra schema parcial). */
function sanitizePrefs(p: any): Prefs | null {
  if (!p || !Array.isArray(p.presets) || !p.presets.length) return null
  const presets: Preset[] = p.presets
    .filter((x: any) => x?.id && x?.layout && Array.isArray(x?.slots))
    .map((x: any) => ({
      id: String(x.id),
      name: String(x.name ?? 'Sem nome'),
      layout: (LAYOUTS.find(l => l.id === x.layout)?.id ?? '2x2') as Layout,
      slots: x.slots.map((s: any) => (typeof s === 'string' ? s : null)),
    }))
  if (!presets.length) return null
  const activeId = presets.find(x => x.id === p.activeId)?.id ?? presets[0].id
  return {
    presets,
    activeId,
    autoRotateSec: Number(p.autoRotateSec) || 0,
    sidebarOpen: p.sidebarOpen !== false,
    playbackAt: typeof p.playbackAt === 'string' ? p.playbackAt : null,
  }
}

export function LivePage() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [picker, setPicker] = useState<{ slot: number } | null>(null)
  const [isFs, setIsFs] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [drag, setDrag]         = useState<DragSource>(null)
  const [overSlot, setOverSlot] = useState<number | null>(null)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [favs, setFavs] = useState<Set<string>>(loadFavs)
  // playbackOffsets: por cameraId → segundos de defasagem (negativo = passado)
  // Ao trocar a câmera do slot, o offset é descartado por segurança.
  const [playbackOffsets, setPlaybackOffsets] = useState<Record<string, number>>({})
  // Pausa ao vivo por slot (paridade Monuv) — apenas índices pausados
  const [pausedSlots, setPausedSlots] = useState<Set<number>>(new Set())
  // Slot focado por interação (para atalhos de teclado: Delete = remover do grid)
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null)
  // Slot expandido em tela cheia (overlay z-50). Setado por duplo-clique
  // ou tecla F com tile focado. Apenas um slot pode estar expandido por vez.
  // ESC sai. Mantemos como estado top-level para que ESC funcione mesmo sem
  // foco no tile (mais robusto pra UX de tela cheia).
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null)
  // Sync state com perfil do usuário no backend
  const [syncState, setSyncState] = useState<'idle' | 'saving' | 'synced' | 'error' | 'offline'>('idle')
  const [syncedFromBackend, setSyncedFromBackend] = useState(false)

  // Timeline interativa do mosaico (CF-feature, scroll-zoom).
  // Mostra heatmap de gravação do "pivô" — que é a câmera focada ou,
  // na ausência, o primeiro slot preenchido. Click → seta playbackAt no
  // mosaico inteiro (todas as câmeras vão pra esse instante).
  const [showMosaicTimeline, setShowMosaicTimeline] = useState(false)
  const [timelineDay, setTimelineDay] = useState<string>(() => new Date().toISOString().slice(0, 10))

  useEffect(() => { saveFavs(favs) }, [favs])
  function toggleFav(id: string) {
    setFavs(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function setPlaybackOffset(cameraId: string, sec: number) {
    setPlaybackOffsets(p => ({ ...p, [cameraId]: sec }))
  }

  const active = prefs.presets.find(p => p.id === prefs.activeId) ?? prefs.presets[0]
  const layoutMeta = LAYOUTS.find(l => l.id === active.layout)!

  // Câmera "pivô" pra timeline do mosaico — focada > primeira do preset.
  // Sem pivô (mosaico vazio), o componente mostra empty-state.
  const pivotCameraId = useMemo(() => {
    if (focusedSlot != null && active.slots[focusedSlot]) return active.slots[focusedSlot]
    return active.slots.find(Boolean) ?? null
  }, [focusedSlot, active.slots])
  const { data: mosaicTimeline } = usePlaybackTimeline(
    showMosaicTimeline ? pivotCameraId : null,
    showMosaicTimeline ? timelineDay : null,
  )

  // Posição atual do playhead em segundos do dia — derivada do playbackAt
  // global. Quando AO VIVO (playbackAt=null), playhead vai pro fim do dia atual
  // (agora) só se o dia da timeline for hoje.
  const playheadSecOfDay = useMemo(() => {
    const isToday = timelineDay === new Date().toISOString().slice(0, 10)
    if (prefs.playbackAt) {
      const d = new Date(prefs.playbackAt)
      const dayIso = d.toISOString().slice(0, 10)
      if (dayIso !== timelineDay) return undefined
      return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()
    }
    if (isToday) {
      const now = new Date()
      return now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()
    }
    return undefined
  }, [prefs.playbackAt, timelineDay])

  // ─ Sincronização com perfil no backend ─────────────────────────────────
  // Carrega 1× ao montar; qualquer mudança subsequente é debounced p/ servidor.
  useEffect(() => {
    let cancelled = false
    fetchMyMosaics<any>().then(data => {
      if (cancelled) return
      const sanitized = sanitizePrefs(data)
      if (sanitized) {
        setPrefs(sanitized)
        setSyncState('synced')
      } else {
        // Endpoint indisponível ou sem dados — segue com localStorage
        setSyncState('offline')
      }
      setSyncedFromBackend(true)
    })
    return () => { cancelled = true }
  }, [])

  // Persistência local + envio debounced para backend (perfil do usuário)
  const saveTimer = useRef<number | null>(null)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    if (!syncedFromBackend) return // evita PUT antes do GET inicial
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    setSyncState('saving')
    saveTimer.current = window.setTimeout(async () => {
      const ok = await saveMyMosaics(prefs)
      setSyncState(ok ? 'synced' : 'offline')
    }, 800)
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current) }
  }, [prefs, syncedFromBackend])

  // Helpers de update do preset ativo
  function patchActive(patch: Partial<Preset>) {
    setPrefs(s => ({
      ...s,
      presets: s.presets.map(p => p.id === s.activeId ? { ...p, ...patch } : p),
    }))
  }
  function setLayout(l: Layout) {
    const target = LAYOUTS.find(x => x.id === l)!.cells
    const next = [...active.slots]
    if (next.length < target) while (next.length < target) next.push(null)
    else next.length = target
    patchActive({ layout: l, slots: next })
  }
  function setSlot(slotIdx: number, cameraId: string | null) {
    const next = [...active.slots]
    next[slotIdx] = cameraId
    patchActive({ slots: next })
    setPicker(null)
  }
  function swapSlots(a: number, b: number) {
    if (a === b) return
    const next = [...active.slots]
    ;[next[a], next[b]] = [next[b], next[a]]
    patchActive({ slots: next })
  }
  function clearAll() {
    patchActive({ slots: active.slots.map(() => null) })
  }

  // Presets: CRUD
  function addPreset() {
    const p = defaultPreset(active.layout)
    p.name = `Preset ${prefs.presets.length + 1}`
    setPrefs(s => ({ ...s, presets: [...s.presets, p], activeId: p.id }))
    setEditingPresetId(p.id)
    setEditName(p.name)
  }
  function switchPreset(id: string) {
    setPrefs(s => ({ ...s, activeId: id }))
  }
  function deletePreset(id: string) {
    setPrefs(s => {
      if (s.presets.length <= 1) return s // não apaga o último
      const remaining = s.presets.filter(p => p.id !== id)
      const activeId = s.activeId === id ? remaining[0].id : s.activeId
      return { ...s, presets: remaining, activeId }
    })
  }
  function renamePreset(id: string, name: string) {
    setPrefs(s => ({ ...s, presets: s.presets.map(p => p.id === id ? { ...p, name } : p) }))
  }
  function duplicateActive() {
    const copy: Preset = { ...active, id: uid(), name: `${active.name} (cópia)`, slots: [...active.slots] }
    setPrefs(s => ({ ...s, presets: [...s.presets, copy], activeId: copy.id }))
  }

  // Auto-rotate — intervalo principal + tick de 250ms para o progress bar.
  // Manter dois timers é mais simples que um requestAnimationFrame partial:
  // o rotate em si dispara `setPrefs(activeId=next)` que re-renderiza o
  // mosaico inteiro; o tick só atualiza um número (progresso 0..1).
  const rotateTimer = useRef<number | null>(null)
  const rotateStartedAt = useRef<number>(Date.now())
  const [rotateProgress, setRotateProgress] = useState(0) // 0..1

  function gotoRelativePreset(delta: number) {
    setPrefs(s => {
      if (s.presets.length < 2) return s
      const idx = s.presets.findIndex(p => p.id === s.activeId)
      const nextIdx = ((idx + delta) % s.presets.length + s.presets.length) % s.presets.length
      return { ...s, activeId: s.presets[nextIdx].id }
    })
    rotateStartedAt.current = Date.now()
    setRotateProgress(0)
  }

  useEffect(() => {
    if (rotateTimer.current) window.clearInterval(rotateTimer.current)
    setRotateProgress(0)
    rotateStartedAt.current = Date.now()
    if (prefs.autoRotateSec > 0 && prefs.presets.length > 1) {
      const rotateMs = prefs.autoRotateSec * 1000
      rotateTimer.current = window.setInterval(() => {
        const elapsed = Date.now() - rotateStartedAt.current
        if (elapsed >= rotateMs) {
          setPrefs(s => {
            const idx = s.presets.findIndex(p => p.id === s.activeId)
            const next = s.presets[(idx + 1) % s.presets.length]
            return { ...s, activeId: next.id }
          })
          rotateStartedAt.current = Date.now()
          setRotateProgress(0)
        } else {
          setRotateProgress(elapsed / rotateMs)
        }
      }, 250)
    }
    return () => { if (rotateTimer.current) window.clearInterval(rotateTimer.current) }
  }, [prefs.autoRotateSec, prefs.presets.length, prefs.activeId])

  // Atalhos de teclado por slot focado (Delete = remover; Espaço = pause/play;
  // F = expandir; Esc = sair de expandido). Esc é capturado mesmo sem
  // foco no tile — UX padrão de "tela cheia".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Esc fecha tile expandido — funciona globalmente (sem precisar focus)
      if (e.key === 'Escape' && expandedSlot != null) {
        e.preventDefault()
        setExpandedSlot(null)
        return
      }

      // Demais atalhos exigem slot focado
      if (focusedSlot == null) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        setSlot(focusedSlot, null)
        setPausedSlots(s => { const n = new Set(s); n.delete(focusedSlot); return n })
      } else if (e.key === ' ') {
        e.preventDefault()
        setPausedSlots(s => {
          const n = new Set(s)
          if (n.has(focusedSlot)) n.delete(focusedSlot); else n.add(focusedSlot)
          return n
        })
      } else if (e.key === 'f' || e.key === 'F') {
        // F = expandir/colapsar slot focado (paridade com fullscreen padrão)
        e.preventDefault()
        setExpandedSlot(prev => (prev === focusedSlot ? null : focusedSlot))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedSlot, expandedSlot]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fullscreen
  function toggleFs() {
    const el = document.getElementById('live-mosaic-root')
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen()
  }
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Eye className="w-5 h-5 text-cyan-700 dark:text-cyan-400" />
            Visualização ao Vivo
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Mosaico multi-câmera · WebRTC (WHEP) com fallback MJPEG · até 36 tiles
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Preset switcher */}
          <div className="relative">
            <button
              onClick={() => setShowPresets(v => !v)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400" />
              <span className="max-w-[160px] truncate">{active.name}</span>
              <span className="text-[9px] text-slate-500">({prefs.presets.length})</span>
              <ChevronDown className={cn('w-3 h-3 transition', showPresets && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {showPresets && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-lg shadow-xl z-40 overflow-hidden"
                >
                  <div className="p-2 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Presets salvos</span>
                    <button
                      onClick={addPreset}
                      className="text-[10px] px-2 py-1 rounded bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-200 dark:hover:bg-cyan-500/30 border border-cyan-200 dark:border-cyan-500/30 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Novo
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {prefs.presets.map(p => {
                      const isActive = p.id === prefs.activeId
                      const isEditing = editingPresetId === p.id
                      const filled = p.slots.filter(Boolean).length
                      return (
                        <div
                          key={p.id}
                          className={cn(
                            'flex items-center gap-2 px-2 py-1.5 group',
                            isActive ? 'bg-cyan-100 dark:bg-cyan-500/10' : 'hover:bg-slate-100 dark:hover:bg-white/5',
                          )}
                        >
                          {isEditing ? (
                            <>
                              <input
                                autoFocus
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { renamePreset(p.id, editName.trim() || p.name); setEditingPresetId(null) }
                                  if (e.key === 'Escape') setEditingPresetId(null)
                                }}
                                className="flex-1 px-2 py-1 text-xs bg-slate-100 dark:bg-white/10 border border-cyan-300 dark:border-cyan-500/40 rounded text-slate-900 dark:text-white focus:outline-none"
                              />
                              <button onClick={() => { renamePreset(p.id, editName.trim() || p.name); setEditingPresetId(null) }}
                                className="p-1 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-500/30">
                                <Check className="w-3 h-3" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => { switchPreset(p.id); setShowPresets(false) }}
                                className="flex-1 text-left flex items-center gap-2 min-w-0"
                              >
                                <span className={cn(
                                  'w-1.5 h-1.5 rounded-full shrink-0',
                                  isActive ? 'bg-cyan-600 dark:bg-cyan-400' : 'bg-slate-400 dark:bg-slate-600',
                                )} />
                                <span className={cn('text-xs truncate', isActive ? 'text-slate-900 dark:text-white font-semibold' : 'text-slate-700 dark:text-slate-300')}>
                                  {p.name}
                                </span>
                                <span className="text-[9px] font-mono text-slate-500 shrink-0">
                                  {p.layout} · {filled}/{p.slots.length}
                                </span>
                              </button>
                              <button
                                onClick={() => { setEditingPresetId(p.id); setEditName(p.name) }}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                title="Renomear"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => deletePreset(p.id)}
                                disabled={prefs.presets.length <= 1}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-500/20 text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-300 disabled:opacity-20 disabled:cursor-not-allowed"
                                title={prefs.presets.length <= 1 ? 'Mantenha ao menos 1 preset' : 'Deletar preset'}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div className="p-2 border-t border-slate-200 dark:border-white/10">
                    <button
                      onClick={duplicateActive}
                      className="w-full text-[10px] px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3 h-3" /> Duplicar preset atual
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Layout switcher */}
          <div className="flex items-center bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg p-0.5">
            {LAYOUTS.map(l => {
              const Icon = l.icon
              const activeLayout = l.id === active.layout
              return (
                <button
                  key={l.id}
                  onClick={() => setLayout(l.id)}
                  className={cn(
                    'px-2 py-1.5 rounded-md text-[11px] font-semibold flex items-center gap-1 transition',
                    activeLayout
                      ? 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/40'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent',
                  )}
                  title={`Layout ${l.label} (${l.cells} tiles)`}
                >
                  <Icon className="w-3 h-3" />
                  {l.label}
                </button>
              )
            })}
          </div>

          {/* Auto-rotate — controles manuais + progress quando ligado */}
          <div className="relative flex items-center bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg p-0.5 overflow-hidden">
            {/* Progress bar de fundo, full width quando rotacionando */}
            {prefs.autoRotateSec > 0 && prefs.presets.length > 1 && (
              <div
                className="absolute left-0 top-0 bottom-0 bg-violet-200 dark:bg-violet-500/15 transition-[width] duration-200 ease-linear pointer-events-none"
                style={{ width: `${rotateProgress * 100}%` }}
              />
            )}
            <button
              onClick={() => gotoRelativePreset(-1)}
              disabled={prefs.presets.length < 2}
              className="relative px-1.5 py-1.5 rounded text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Preset anterior (manual)"
            >
              <SkipBack className="w-3 h-3" />
            </button>
            <button
              onClick={() => setPrefs(s => ({ ...s, autoRotateSec: s.autoRotateSec > 0 ? 0 : 10 }))}
              className={cn(
                'relative px-2 py-1.5 rounded-md text-[11px] font-semibold flex items-center gap-1',
                prefs.autoRotateSec > 0
                  ? 'bg-violet-100 dark:bg-violet-500/30 text-violet-700 dark:text-violet-200 border border-violet-200 dark:border-violet-500/40'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent',
              )}
              title={prefs.presets.length < 2 ? 'Crie ao menos 2 presets para usar auto-rotate' : 'Ligar/desligar rotação automática'}
              disabled={prefs.presets.length < 2 && prefs.autoRotateSec === 0}
            >
              {prefs.autoRotateSec > 0 ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              Auto
            </button>
            <button
              onClick={() => gotoRelativePreset(1)}
              disabled={prefs.presets.length < 2}
              className="relative px-1.5 py-1.5 rounded text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Próximo preset (manual)"
            >
              <SkipForward className="w-3 h-3" />
            </button>
            <select
              value={prefs.autoRotateSec}
              onChange={e => setPrefs(s => ({ ...s, autoRotateSec: +e.target.value }))}
              className="relative bg-transparent text-[11px] text-slate-700 dark:text-slate-300 focus:outline-none px-1"
              title="Intervalo de rotação (segundos)"
            >
              {ROTATE_INTERVALS.map(i => (
                <option key={i} value={i} className="bg-white dark:bg-space-900">
                  {i === 0 ? 'off' : `${i}s`}
                </option>
              ))}
            </select>
          </div>

          {/* Date + Time pickers — playback histórico do mosaico (paridade Monuv) */}
          <PlaybackPicker
            value={prefs.playbackAt ?? null}
            onChange={iso => setPrefs(s => ({ ...s, playbackAt: iso }))}
          />

          <button
            onClick={clearAll}
            className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5"
            title="Limpar todos os slots do preset atual"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Limpar
          </button>

          {/* Mapa (paridade Monuv /camera/map) */}
          <Link
            to="/live/map"
            className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5"
            title="Visualizar câmeras em mapa"
          >
            <MapIcon className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
            Mapa
          </Link>

          {/* Toggle Timeline interativa do mosaico (CF: scroll-zoom) */}
          <button
            onClick={() => setShowMosaicTimeline(v => !v)}
            className={cn(
              'px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5',
              showMosaicTimeline
                ? 'bg-amber-100 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/25'
                : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white',
            )}
            title="Mostrar timeline interativa (heatmap de gravação) — scroll faz zoom"
          >
            <History className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300" />
            Timeline
          </button>

          {/* Toggle sidebar direita */}
          <button
            onClick={() => setPrefs(s => ({ ...s, sidebarOpen: !s.sidebarOpen }))}
            className={cn(
              'px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5',
              prefs.sidebarOpen
                ? 'bg-sky-100 dark:bg-brand-sky/15 border-sky-200 dark:border-brand-sky/30 text-sky-700 dark:text-brand-skyLight hover:bg-sky-200 dark:hover:bg-brand-sky/25'
                : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white',
            )}
            title={prefs.sidebarOpen ? 'Ocultar biblioteca de câmeras' : 'Abrir biblioteca de câmeras'}
          >
            {prefs.sidebarOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
            Biblioteca
          </button>

          {/* Sync indicator com perfil do usuário */}
          <SyncBadge state={syncState} />

          <button
            onClick={toggleFs}
            className="px-3 py-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-500/20 border border-cyan-200 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300 text-xs font-semibold hover:bg-cyan-200 dark:hover:bg-cyan-500/30 flex items-center gap-1.5"
          >
            {isFs ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {isFs ? 'Sair' : 'Tela cheia'}
          </button>
        </div>
      </div>

      {/* Auto-rotate indicator */}
      {prefs.autoRotateSec > 0 && prefs.presets.length > 1 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-100 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/30 text-[11px] text-violet-700 dark:text-violet-200">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-violet-400 animate-pulse" />
          Rotação automática ativa · trocando a cada {prefs.autoRotateSec}s ·
          próximo: <span className="font-semibold">
            {prefs.presets[(prefs.presets.findIndex(p => p.id === prefs.activeId) + 1) % prefs.presets.length].name}
          </span>
        </div>
      )}

      {/* Playback histórico global indicator (paridade Monuv) */}
      {prefs.playbackAt && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-200">
          <History className="w-3.5 h-3.5 shrink-0" />
          <span>
            Mostrando gravações de{' '}
            <span className="font-semibold text-amber-800 dark:text-amber-100">
              {new Date(prefs.playbackAt).toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
            {' '}— todas as câmeras do mosaico estão posicionadas nesse instante.
          </span>
          <button
            onClick={() => setPrefs(s => ({ ...s, playbackAt: null }))}
            className="ml-auto px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 font-bold text-[10px] hover:bg-emerald-200 dark:hover:bg-emerald-500/30 flex items-center gap-1"
          >
            <Play className="w-2.5 h-2.5" /> AO VIVO
          </button>
        </div>
      )}

      {/* Timeline interativa do mosaico — collapsible, com scroll-zoom.
          Pivô = câmera focada (ou primeira do preset). Click navega o
          mosaico inteiro pra esse instante (seta playbackAt global).
          NOTA: este painel é o "global", afetando todas as câmeras. Cada
          tile também tem seu PRÓPRIO timeline (clique no ícone de relógio
          em cada câmera). O global fica fora do `live-mosaic-root` por
          design — mas no modo fullscreen é replicado lá dentro pra
          permanecer visível (ver bloco abaixo do mosaic root). */}
      {showMosaicTimeline && !isFs && (
        <div className="rounded-xl bg-white dark:bg-space-900/60 border border-slate-200 dark:border-white/10 p-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-[11px]">
              <History className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300" />
              <span className="text-slate-700 dark:text-slate-300 font-semibold">Timeline interativa</span>
              {pivotCameraId ? (
                <span className="text-slate-500">
                  · pivô: <span className="text-cyan-700 dark:text-cyan-300 font-mono">
                    {(() => {
                      const cam = (cameras as any[])?.find?.((c: any) => c.id === pivotCameraId)
                      return cam ? formatCameraIdentity(cam) : pivotCameraId.slice(0, 8)
                    })()}
                  </span>
                  {focusedSlot == null && (
                    <span className="text-slate-500 dark:text-slate-600 italic ml-1">(clique numa câmera pra trocar pivô)</span>
                  )}
                </span>
              ) : (
                <span className="text-slate-500 italic">· nenhum slot preenchido</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setTimelineDay(d => {
                  const dt = new Date(d + 'T00:00:00.000Z')
                  dt.setUTCDate(dt.getUTCDate() - 1)
                  return dt.toISOString().slice(0, 10)
                })}
                className="p-1 rounded bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
                title="Dia anterior"
              ><SkipBack className="w-3 h-3" /></button>
              <input
                type="date"
                value={timelineDay}
                onChange={e => setTimelineDay(e.target.value)}
                className="px-2 py-1 text-[11px] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white"
              />
              <button
                onClick={() => setTimelineDay(d => {
                  const dt = new Date(d + 'T00:00:00.000Z')
                  dt.setUTCDate(dt.getUTCDate() + 1)
                  return dt.toISOString().slice(0, 10)
                })}
                className="p-1 rounded bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
                title="Próximo dia"
              ><SkipForward className="w-3 h-3" /></button>
              <button
                onClick={() => setTimelineDay(new Date().toISOString().slice(0, 10))}
                className="px-2 py-1 text-[10px] rounded bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-semibold"
              >Hoje</button>
              {prefs.playbackAt && (
                <button
                  onClick={() => setPrefs(s => ({ ...s, playbackAt: null }))}
                  className="ml-2 px-2 py-1 text-[10px] rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 font-bold flex items-center gap-1"
                  title="Voltar ao live em todas as câmeras"
                ><Play className="w-2.5 h-2.5" /> AO VIVO</button>
              )}
            </div>
          </div>
          {pivotCameraId ? (
            <PlaybackTimelineZoom
              bitmap={mosaicTimeline?.bitmap}
              currentSecOfDay={playheadSecOfDay}
              dayUtcDate={timelineDay}
              onSeekIso={iso => setPrefs(s => ({ ...s, playbackAt: iso }))}
              trackHeight={48}
            />
          ) : (
            <div className="h-12 flex items-center justify-center text-[11px] text-slate-500 border border-dashed border-slate-200 dark:border-white/10 rounded-md">
              Adicione câmeras ao preset pra ver a timeline.
            </div>
          )}
        </div>
      )}

      {/* Mosaic + Library sidebar */}
      <div className="flex gap-3">
        <div
          id="live-mosaic-root"
          className={cn(
            'relative rounded-xl bg-white dark:bg-space-900/60 border border-slate-200 dark:border-white/10 p-2 flex-1 min-w-0',
            isFs && 'w-screen h-screen p-0 rounded-none border-0 bg-black',
          )}
        >
          {/* Timeline global — variante fullscreen.
              Float sobre o mosaico (z-30) pra ficar visível dentro do
              requestFullscreen() do `live-mosaic-root`. Sem ela, o usuário
              clicaria em Timeline em fullscreen e nada apareceria — strip
              externo está fora do elemento fullscreened. */}
          {showMosaicTimeline && isFs && (
            <div className="absolute left-3 right-3 bottom-3 z-30 rounded-xl bg-black/85 backdrop-blur border border-amber-500/30 p-3 shadow-2xl">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <History className="w-3.5 h-3.5 text-amber-300" />
                  <span className="text-slate-200 font-semibold">Timeline interativa (fullscreen)</span>
                  {pivotCameraId ? (
                    <span className="text-slate-400">
                      · pivô: <span className="text-cyan-300 font-mono">
                        {(() => {
                          const cam = (cameras as any[])?.find?.((c: any) => c.id === pivotCameraId)
                          return cam ? formatCameraIdentity(cam) : pivotCameraId.slice(0, 8)
                        })()}
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">· nenhum slot preenchido</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={timelineDay}
                    onChange={e => setTimelineDay(e.target.value)}
                    className="px-2 py-1 text-[11px] bg-white/5 border border-white/10 rounded-md text-white"
                  />
                  <button
                    onClick={() => setTimelineDay(new Date().toISOString().slice(0, 10))}
                    className="px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-slate-300 font-semibold"
                  >Hoje</button>
                  {prefs.playbackAt && (
                    <button
                      onClick={() => setPrefs(s => ({ ...s, playbackAt: null }))}
                      className="ml-2 px-2 py-1 text-[10px] rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1"
                    ><Play className="w-2.5 h-2.5" /> AO VIVO</button>
                  )}
                  <button
                    onClick={() => setShowMosaicTimeline(false)}
                    className="ml-1 p-1 rounded bg-white/5 hover:bg-white/10 text-slate-300"
                    title="Fechar timeline"
                  ><X className="w-3 h-3" /></button>
                </div>
              </div>
              {pivotCameraId ? (
                <PlaybackTimelineZoom
                  bitmap={mosaicTimeline?.bitmap}
                  currentSecOfDay={playheadSecOfDay}
                  dayUtcDate={timelineDay}
                  onSeekIso={iso => setPrefs(s => ({ ...s, playbackAt: iso }))}
                  trackHeight={48}
                />
              ) : (
                <div className="h-12 flex items-center justify-center text-[11px] text-slate-500 border border-dashed border-white/10 rounded-md">
                  Adicione câmeras ao preset pra ver a timeline.
                </div>
              )}
            </div>
          )}
          <div
            className={cn(
              'grid gap-1.5',
              layoutMeta.cols,
              isFs ? 'h-full' : 'auto-rows-fr',
            )}
            style={!isFs ? { aspectRatio: '16 / 9' } : undefined}
          >
            {active.slots.map((cameraId, idx) => (
              <MosaicCell
                key={`${active.id}-${idx}`}
                slotIndex={idx}
                cameraId={cameraId}
                dense={layoutMeta.cells >= 16}
                isDragOver={overSlot === idx && drag !== null && !(drag.kind === 'slot' && drag.slotIndex === idx)}
                isFavorite={!!cameraId && favs.has(cameraId)}
                isPaused={pausedSlots.has(idx)}
                isFocused={focusedSlot === idx}
                isExpanded={expandedSlot === idx}
                playbackOffsetSec={cameraId ? (playbackOffsets[cameraId] ?? 0) : 0}
                globalPlayback={prefs.playbackAt ?? null}
                onToggleFav={() => cameraId && toggleFav(cameraId)}
                onSetPlaybackOffset={(sec) => cameraId && setPlaybackOffset(cameraId, sec)}
                onTogglePause={() => setPausedSlots(s => {
                  const n = new Set(s)
                  if (n.has(idx)) n.delete(idx); else n.add(idx)
                  return n
                })}
                onRewind10={() => cameraId && setPlaybackOffset(cameraId, (playbackOffsets[cameraId] ?? 0) - 10)}
                onGoLive={() => {
                  if (cameraId) setPlaybackOffset(cameraId, 0)
                  setPausedSlots(s => { const n = new Set(s); n.delete(idx); return n })
                }}
                onFocus={() => setFocusedSlot(idx)}
                onBlur={() => setFocusedSlot(s => s === idx ? null : s)}
                onPick={() => setPicker({ slot: idx })}
                onClear={() => {
                  setSlot(idx, null)
                  setPausedSlots(s => { const n = new Set(s); n.delete(idx); return n })
                  // Se removeu enquanto expandido, sai do modo expandido também
                  setExpandedSlot(prev => (prev === idx ? null : prev))
                }}
                onToggleExpand={() => {
                  setExpandedSlot(prev => (prev === idx ? null : idx))
                  // Foca o tile ao expandir — habilita atalhos imediatos
                  setFocusedSlot(idx)
                }}
                onDragStart={() => setDrag({ kind: 'slot', slotIndex: idx })}
                onDragEnd={() => { setDrag(null); setOverSlot(null) }}
                onDragOver={() => setOverSlot(idx)}
                onDrop={() => {
                  if (drag?.kind === 'slot') swapSlots(drag.slotIndex, idx)
                  else if (drag?.kind === 'library') setSlot(idx, drag.cameraId)
                  setDrag(null); setOverSlot(null)
                }}
              />
            ))}
          </div>
        </div>

        {/* Right-side library — paridade Monuv */}
        {prefs.sidebarOpen && !isFs && (
          <CameraLibrarySidebar
            usedIds={active.slots.filter((x): x is string => !!x)}
            favs={favs}
            onToggleFav={toggleFav}
            onDragStart={(cameraId) => setDrag({ kind: 'library', cameraId })}
            onDragEnd={() => { setDrag(null); setOverSlot(null) }}
            onQuickAdd={(cameraId) => {
              // Click rápido = preencher primeiro slot vazio
              const empty = active.slots.findIndex(s => !s)
              if (empty >= 0) setSlot(empty, cameraId)
            }}
          />
        )}
      </div>

      {/* Footer hint */}
      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-600">
        <span>
          {active.slots.filter(Boolean).length}/{active.slots.length} tiles ocupados ·
          arraste da biblioteca → tile, ou troque tiles entre si
        </span>
        <span className="font-mono">preset: {active.id.slice(0, 6)}</span>
      </div>

      {/* Picker modal */}
      <AnimatePresence>
        {picker && (
          <CameraPickerModal
            currentSlot={picker.slot}
            usedIds={active.slots.filter((x): x is string => !!x)}
            onPick={cid => setSlot(picker.slot, cid)}
            onClose={() => setPicker(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Cell ────────────────────────────────────────────────────────────────

interface CellProps {
  slotIndex: number
  cameraId: string | null
  dense: boolean
  isDragOver: boolean
  isFavorite: boolean
  isPaused: boolean
  isFocused: boolean
  /** True quando este tile está expandido em tela cheia (overlay z-50). */
  isExpanded: boolean
  playbackOffsetSec: number
  /** Quando setado, o mosaico inteiro está em playback histórico (override). */
  globalPlayback: string | null
  onToggleFav: () => void
  onSetPlaybackOffset: (sec: number) => void
  onTogglePause: () => void
  onRewind10: () => void
  onGoLive: () => void
  onFocus: () => void
  onBlur: () => void
  onPick: () => void
  /** Toggle expandir/colapsar — duplo-clique no tile dispara isto. */
  onToggleExpand: () => void
  onClear: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: () => void
  onDrop: () => void
}

function MosaicCell({
  slotIndex, cameraId, dense, isDragOver,
  isFavorite, isPaused, isFocused, isExpanded, playbackOffsetSec, globalPlayback,
  onToggleFav, onSetPlaybackOffset, onTogglePause, onRewind10, onGoLive,
  onFocus, onBlur, onPick, onClear, onToggleExpand,
  onDragStart, onDragEnd, onDragOver, onDrop,
}: CellProps) {
  const { data } = useCameras()
  const camera = (data?.cameras ?? []).find((c: any) => c.id === cameraId)
  const [showPlaybackBar, setShowPlaybackBar] = useState(false)

  // Per-tile timeline (CF — interativo dentro do tile, sem afetar outros).
  // Bitmap do dia ATUAL (UTC) — fetch só quando barra está aberta pra evitar
  // requests desnecessárias em mosaicos de 16+ tiles. SWR dedupe garante que
  // múltiplos tiles da mesma câmera (improvável) compartilham 1 request.
  const todayUtc = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const { data: tileTimeline } = usePlaybackTimeline(
    showPlaybackBar && cameraId ? cameraId : null,
    showPlaybackBar && cameraId ? todayUtc : null,
  )

  // "Now" em segundos UTC do dia. Memoizamos por minuto pra evitar rerender
  // a cada segundo (timeline não precisa de precisão sub-minuto pra heatmap).
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!showPlaybackBar) return
    const t = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [showPlaybackBar])
  const nowSec = useMemo(() => {
    const n = new Date(nowTick)
    return n.getUTCHours() * 3600 + n.getUTCMinutes() * 60 + n.getUTCSeconds()
  }, [nowTick])

  // Playhead local: now + offset (offset é negativo no passado).
  // Se o offset levar pra antes de 00:00 do dia (ex: -10h às 5h da manhã),
  // simplesmente clampamos em 0 — UI ainda navega o dia atual.
  const tilePlayheadSec = Math.max(0, Math.min(86399, nowSec + playbackOffsetSec))

  // Click no timeline → converte secOfDay em offset relativo a "agora".
  // Não permite seek pro futuro: clamp em 0 (live).
  function handleTileSeek(secOfDay: number) {
    const offset = secOfDay - nowSec
    onSetPlaybackOffset(Math.min(0, offset))
  }

  // ── Recuperação de gravação dentro do tile (HLS) ──────────────────────
  // Quando offset < 0 OU global playback ativo, troca <LivePlayer> por
  // <PlaybackPlayer> com manifest do dia. Seek imperativo via ref evita
  // remount a cada arrasto na timeline.
  const playbackRef = useRef<PlaybackPlayerRef>(null)
  // Alvo do playback: dia + segundo dentro do dia.
  // - Global playback: usa o ISO global (qualquer dia).
  // - Per-tile: usa o dia atual (offset relativo a now).
  const playbackTarget = useMemo(() => {
    if (globalPlayback) {
      const d = new Date(globalPlayback)
      const dayUtc = d.toISOString().slice(0, 10)
      const secOfDay = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()
      return { dayUtc, secOfDay, source: 'global' as const }
    }
    if (playbackOffsetSec < 0) {
      return { dayUtc: todayUtc, secOfDay: tilePlayheadSec, source: 'tile' as const }
    }
    return null
  }, [globalPlayback, playbackOffsetSec, tilePlayheadSec, todayUtc])

  // Range do manifest HLS: dia inteiro. Memoizamos por dia pra que troca
  // de offset DENTRO do mesmo dia NÃO recrie o manifest (que dispararia
  // remount do <video> e flicker). Só muda quando o dia muda.
  const playbackRange = useMemo(() => {
    if (!playbackTarget) return null
    return {
      fromIso: `${playbackTarget.dayUtc}T00:00:00.000Z`,
      // toIso = "agora" se o dia for hoje; senão fim do dia. Limita o
      // manifest pra não trazer segmentos do futuro.
      toIso: playbackTarget.dayUtc === todayUtc
        ? new Date().toISOString()
        : `${playbackTarget.dayUtc}T23:59:59.999Z`,
    }
  }, [playbackTarget?.dayUtc, todayUtc])  // eslint-disable-line react-hooks/exhaustive-deps

  // Seek imperativo quando o alvo dentro do mesmo manifest muda
  useEffect(() => {
    if (!playbackTarget || !playbackRef.current) return
    // currentTime do <video> é segundos desde o início do manifest (=fromIso=00:00 UTC).
    // Então secOfDay já é o tempo correto.
    playbackRef.current.seekTo(playbackTarget.secOfDay)
  }, [playbackTarget?.secOfDay, playbackTarget?.dayUtc])

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); onDragOver() }
  const handleDrop     = (e: React.DragEvent) => { e.preventDefault(); onDrop() }

  if (!cameraId) {
    return (
      <button
        onClick={onPick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          'relative group rounded-lg border border-dashed transition flex flex-col items-center justify-center text-slate-600 hover:text-cyan-300',
          isDragOver
            ? 'border-cyan-400 bg-cyan-500/10'
            : 'border-white/15 bg-white/[0.02] hover:bg-white/[0.04] hover:border-cyan-500/40',
        )}
      >
        <div className={cn('absolute top-1 left-1 px-1 py-0.5 rounded bg-black/40 font-mono text-slate-500', dense ? 'text-[8px]' : 'text-[9px]')}>
          #{slotIndex + 1}
        </div>
        <Plus className={cn('mb-1 opacity-50 group-hover:opacity-100 transition', dense ? 'w-4 h-4' : 'w-8 h-8')} />
        {!dense && <span className="text-[10px] font-medium uppercase tracking-wider">Adicionar</span>}
      </button>
    )
  }

  const isGlobalPlayback = !!globalPlayback
  const isPlayback = isGlobalPlayback || playbackOffsetSec < 0
  const offsetLabel = isGlobalPlayback
    ? new Date(globalPlayback!).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
    : (PLAYBACK_OFFSETS.find(o => o.sec === playbackOffsetSec)?.label
        ?? (playbackOffsetSec < -60
            ? `−${Math.floor(-playbackOffsetSec / 60)}min`
            : `−${-playbackOffsetSec}s`))

  // Status do indicador (top-right): AO VIVO / PAUSADO / HISTÓRICO
  const liveState: 'live' | 'paused' | 'history' =
    isPlayback ? 'history' : isPaused ? 'paused' : 'live'

  return (
    <div
      // draggable e arrastar não fazem sentido enquanto o tile está
      // expandido em tela cheia (overlay) — desabilita pra evitar UX
      // confusa de "estou arrastando um overlay".
      draggable={!isExpanded}
      tabIndex={0}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onFocus}
      onDoubleClick={onToggleExpand}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'relative group rounded-lg overflow-hidden transition outline-none',
        // Quando expandido (overlay), o cursor não é mais "grab" e o tile
        // ocupa o viewport inteiro com z-index alto. Mantém o ring de
        // foco mas remove o de drag (não dá pra dropar em si mesmo).
        isExpanded
          ? 'fixed inset-0 z-50 rounded-none bg-black cursor-default'
          : 'cursor-grab active:cursor-grabbing',
        !isExpanded && isDragOver && 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-space-900',
        isPlayback && 'ring-1 ring-amber-500/50',
        isPaused && !isPlayback && 'ring-1 ring-amber-300/60',
        !isExpanded && isFocused && 'ring-2 ring-brand-sky/60 ring-offset-2 ring-offset-space-900',
      )}
    >
      {/* Player: live (WebRTC) ou playback HLS — swap baseado no estado.
          Quando entra/sai de playback há um remount (HLS init custa
          ~500ms-2s); esse é o trade-off pra ter recuperação real dentro
          do tile sem exigir LivePlayer com codec dual. */}
      {playbackTarget && playbackRange ? (
        <PlaybackPlayer
          ref={playbackRef}
          cameraId={cameraId}
          fromIso={playbackRange.fromIso}
          toIso={playbackRange.toIso}
          minimal
          autoPlay
          className="w-full h-full"
        />
      ) : (
        <LivePlayer
          cameraId={cameraId}
          mode="auto"
          muted
          showOverlay={false}
          cameraName={camera?.name}
          className="w-full h-full pointer-events-none"
        />
      )}

      {/* Overlay de PAUSA (congela visual o último frame) */}
      {isPaused && !isPlayback && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="px-3 py-1.5 rounded-full bg-black/70 border border-amber-400/40 text-amber-200 text-[11px] font-bold uppercase tracking-widest flex items-center gap-1.5 shadow-xl">
            <Pause className="w-3 h-3 fill-current" />
            Pausado
          </div>
        </div>
      )}

      {/* spanNomeCamera (paridade Monuv) — top-left identification */}
      <div className={cn(
        'absolute top-1 left-1 z-10 max-w-[calc(100%-90px)] flex items-center gap-1.5',
        'pointer-events-none',
      )}>
        <span
          className={cn(
            'spanNomeCamera inline-block px-2 py-1 rounded-md',
            'bg-black/65 backdrop-blur-sm text-white font-semibold truncate',
            'shadow-[0_1px_3px_rgba(0,0,0,0.55)]',
            dense ? 'text-[10px]' : 'text-[11px]',
          )}
          title={formatCameraIdentity(camera ?? { id: cameraId })}
        >
          (#{displayCodeFor(camera ?? { id: cameraId })}){' '}
          {camera?.name ?? 'Câmera'}
        </span>
      </div>

      {/* Live state badge (top-center) */}
      <div className="absolute top-1 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        {liveState === 'live' && (
          <div className="px-1.5 py-0.5 rounded bg-emerald-500/90 text-white text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 shadow">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            Ao Vivo
          </div>
        )}
        {liveState === 'history' && (
          <div className="px-1.5 py-0.5 rounded bg-amber-500/90 text-white text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 shadow">
            <History className="w-2.5 h-2.5" />
            {offsetLabel}
          </div>
        )}
        {liveState === 'paused' && (
          <div className="px-1.5 py-0.5 rounded bg-amber-300/90 text-amber-950 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 shadow">
            <Pause className="w-2.5 h-2.5 fill-current" />
            Pausado
          </div>
        )}
      </div>

      {/* Slot # badge (bottom-left, info técnica) */}
      <div className={cn(
        'absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/60 backdrop-blur font-mono text-slate-300 flex items-center gap-1 z-10',
        dense ? 'text-[8px]' : 'text-[9px]',
      )}>
        <span>#{slotIndex + 1}</span>
        {camera?.resolution && !dense && <span className="opacity-70">· {camera.resolution}</span>}
        {isFavorite && <Star className={cn('fill-amber-400 text-amber-400', dense ? 'w-2 h-2' : 'w-2.5 h-2.5')} />}
      </div>

      {/* Slot action bar — controles per-cell paridade Monuv */}
      <div className={cn(
        'absolute top-1 right-1 flex items-center gap-1 transition z-10',
        isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
      )}>
        {/* Pausar / Continuar */}
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePause() }}
          className={cn(
            'p-1 rounded-md border',
            isPaused
              ? 'bg-amber-500/30 text-amber-100 border-amber-400/50 hover:bg-amber-500/40'
              : 'bg-black/60 hover:bg-black/80 text-white border-white/10',
          )}
          title={isPaused ? 'Continuar (espaço)' : 'Pausar (espaço)'}
        >
          {isPaused ? <Play className="w-3 h-3 fill-current" /> : <Pause className="w-3 h-3 fill-current" />}
        </button>
        {/* Retornar 10 segundos */}
        <button
          onClick={(e) => { e.stopPropagation(); onRewind10() }}
          className="p-1 rounded-md bg-black/60 hover:bg-black/80 text-white border border-white/10"
          title="Retornar 10 segundos"
        >
          <SkipBack className="w-3 h-3" />
        </button>
        {/* AO VIVO (volta ao tempo real) */}
        {(isPaused || isPlayback || playbackOffsetSec < 0) && (
          <button
            onClick={(e) => { e.stopPropagation(); onGoLive() }}
            className="px-1.5 py-1 rounded-md bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 border border-emerald-400/40 text-[9px] font-bold uppercase tracking-wider"
            title="Voltar ao tempo real"
          >
            Ao Vivo
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFav() }}
          className={cn(
            'p-1 rounded-md border',
            isFavorite
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
              : 'bg-black/60 hover:bg-black/80 text-white border-white/10',
          )}
          title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          <Star className={cn('w-3 h-3', isFavorite && 'fill-current')} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setShowPlaybackBar(v => !v) }}
          className={cn(
            'p-1 rounded-md border',
            showPlaybackBar || isPlayback
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-black/60 hover:bg-black/80 text-white border-white/10',
          )}
          title="Playback histórico"
        >
          <Clock className="w-3 h-3" />
        </button>
        <Link
          to={`/review?cameraId=${cameraId}`}
          onClick={(e) => e.stopPropagation()}
          className="p-1 rounded-md bg-black/60 hover:bg-black/80 text-white border border-white/10"
          title="Ver eventos da câmera"
        >
          <Bell className="w-3 h-3" />
        </Link>
        <button
          onClick={(e) => { e.stopPropagation(); onPick() }}
          className="p-1 rounded-md bg-black/60 hover:bg-black/80 text-white border border-white/10"
          title="Trocar câmera"
        >
          <Settings2 className="w-3 h-3" />
        </button>
        {/* Expandir / colapsar tile (também acionável por duplo-clique no
            tile e por tecla F com o tile focado). */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
          className={cn(
            'p-1 rounded-md border',
            isExpanded
              ? 'bg-cyan-500/30 hover:bg-cyan-500/40 text-cyan-100 border-cyan-400/50'
              : 'bg-black/60 hover:bg-black/80 text-white border-white/10',
          )}
          title={isExpanded ? 'Sair da tela cheia (Esc / F / duplo-clique)' : 'Expandir em tela cheia (F / duplo-clique)'}
        >
          {isExpanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        </button>
        {/* Remover câmera do grid (paridade Monuv). Em modo expandido,
            esconde — não faz sentido remover sem ver o mosaico. */}
        {!isExpanded && (
          <button
            onClick={(e) => { e.stopPropagation(); onClear() }}
            className="p-1 rounded-md bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 border border-rose-500/30"
            title="Remover câmera do grid (Delete)"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Hint sutil no canto inferior-direito quando expandido — dica de
          como sair, vira invisível depois de 3s de hover. */}
      {isExpanded && (
        <div className="absolute bottom-3 right-3 z-20 px-2 py-1 rounded-md bg-black/70 backdrop-blur border border-white/15 text-[10px] text-slate-300 font-medium pointer-events-none animate-pulse">
          Esc · F · duplo-clique para sair
        </div>
      )}

      {/* Playback scrubber — aparece sob demanda.
          Estrutura: [timeline interativa zoom/pan/click] + [scrubber c/ presets].
          Interativo com o "ao vivo": clicar no timeline define offset relativo
          a agora; clicar em LIVE volta pro tempo real. Zoom/pan no scroll do
          mouse — útil pra localizar evento de poucos segundos. */}
      <AnimatePresence>
        {showPlaybackBar && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-0 left-0 right-0 bg-black/85 backdrop-blur border-t border-amber-500/30 z-20"
            onClick={(e) => e.stopPropagation()}
            // Wheel não deve propagar pro mosaic root (evita scroll da página
            // enquanto user dá zoom no timeline do tile).
            onWheel={(e) => e.stopPropagation()}
          >
            {/* Timeline interativa per-tile. Em modo dense (16+ tiles) usa
                track=18px; senão 24px. Compact=true esconde header/minimapa. */}
            <div className="px-1.5 pt-1.5">
              <PlaybackTimelineZoom
                bitmap={tileTimeline?.bitmap}
                currentSecOfDay={tilePlayheadSec}
                dayUtcDate={todayUtc}
                onSeek={handleTileSeek}
                trackHeight={dense ? 18 : 24}
                compact
              />
            </div>

            {/* Controles compactos */}
            <div className="px-1.5 py-1.5 flex items-center gap-1">
              <button
                onClick={() => onSetPlaybackOffset(Math.min(0, playbackOffsetSec + 30))}
                className="p-0.5 rounded bg-white/10 hover:bg-white/20 text-white"
                title="Avançar 30s"
              >
                <SkipForward className="w-2.5 h-2.5" />
              </button>
              <select
                value={PLAYBACK_OFFSETS.some(o => o.sec === playbackOffsetSec) ? playbackOffsetSec : ''}
                onChange={(e) => onSetPlaybackOffset(Number(e.target.value))}
                className="flex-1 bg-white/10 text-[9px] font-semibold text-amber-200 px-1 py-0.5 rounded border border-amber-500/30 focus:outline-none"
              >
                {!PLAYBACK_OFFSETS.some(o => o.sec === playbackOffsetSec) && (
                  <option value="" className="bg-space-900 text-white">
                    {playbackOffsetSec === 0
                      ? 'AO VIVO'
                      : `−${Math.floor(-playbackOffsetSec / 60)}min ${(-playbackOffsetSec) % 60}s`}
                  </option>
                )}
                {PLAYBACK_OFFSETS.map(o => (
                  <option key={o.sec} value={o.sec} className="bg-space-900 text-white">{o.label}</option>
                ))}
              </select>
              <button
                onClick={() => onSetPlaybackOffset(playbackOffsetSec - 30)}
                className="p-0.5 rounded bg-white/10 hover:bg-white/20 text-white"
                title="Retroceder 30s"
              >
                <SkipBack className="w-2.5 h-2.5" />
              </button>
              {isPlayback && (
                <button
                  onClick={() => onSetPlaybackOffset(0)}
                  className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-bold hover:bg-emerald-500/30 flex items-center gap-1"
                  title="Voltar ao ao vivo"
                >
                  <Play className="w-2 h-2 fill-current" /> AO VIVO
                </button>
              )}
              {/* Botão fechar — útil em mosaico denso onde ícone Clock no
                  toolbar pode ficar coberto pelo scrubber */}
              <button
                onClick={() => setShowPlaybackBar(false)}
                className="p-0.5 rounded bg-white/10 hover:bg-white/20 text-white"
                title="Fechar timeline"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Camera picker modal ─────────────────────────────────────────────────

interface PickerProps {
  currentSlot: number
  usedIds: string[]
  onPick: (id: string) => void
  onClose: () => void
}

function CameraPickerModal({ currentSlot, usedIds, onPick, onClose }: PickerProps) {
  const [q, setQ] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [pipelineFilter, setPipelineFilter] = useState('')
  const [favsOnly, setFavsOnly] = useState(false)
  const [favs] = useState<Set<string>>(loadFavs)
  const { data, isLoading } = useCameras()
  const cameras: any[] = data?.cameras ?? []

  const sites = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of cameras) if (c.site) seen.set(c.site.id, c.site.name)
    return [...seen.entries()]
  }, [cameras])

  const pipelines = useMemo(() => {
    return [...new Set(cameras.map(c => c.pipeline).filter(Boolean))] as string[]
  }, [cameras])

  const filtered = cameras.filter(c => {
    if (q && !(
      c.name?.toLowerCase().includes(q.toLowerCase()) ||
      c.location?.toLowerCase().includes(q.toLowerCase()) ||
      c.site?.name?.toLowerCase().includes(q.toLowerCase())
    )) return false
    if (siteFilter && c.site?.id !== siteFilter) return false
    if (pipelineFilter && c.pipeline !== pipelineFilter) return false
    if (favsOnly && !favs.has(c.id)) return false
    return true
  })

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[85vh] bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden flex flex-col shadow-2xl shadow-cyan-500/10"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CameraIcon className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
              Selecionar câmera · Slot #{currentSlot + 1}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {filtered.length} de {cameras.length} câmeras
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="p-3 border-b border-slate-200 dark:border-white/10 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar por nome, site ou localização..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          {sites.length > 0 && (
            <select
              value={siteFilter}
              onChange={e => setSiteFilter(e.target.value)}
              className="px-2 py-1.5 text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500/50"
            >
              <option value="">Todos os sites</option>
              {sites.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}

          {pipelines.length > 0 && (
            <select
              value={pipelineFilter}
              onChange={e => setPipelineFilter(e.target.value)}
              className="px-2 py-1.5 text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500/50"
            >
              <option value="">Todos pipelines</option>
              {pipelines.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}

          <button
            onClick={() => setFavsOnly(v => !v)}
            className={cn(
              'px-2 py-1.5 text-xs rounded-md border flex items-center gap-1 font-semibold',
              favsOnly
                ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/40'
                : 'bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:text-slate-900 dark:hover:text-white',
            )}
            title={favsOnly ? 'Mostrando apenas favoritas' : 'Mostrar apenas favoritas'}
          >
            <Star className={cn('w-3 h-3', favsOnly && 'fill-current')} />
            Favoritas{favs.size > 0 && ` (${favs.size})`}
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-500 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              Carregando câmeras...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              Nenhuma câmera encontrada
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map(c => {
                const inUse = usedIds.includes(c.id)
                const canLive = c.liveMode !== 'DISABLED' && c.edgeNodeId
                return (
                  <button
                    key={c.id}
                    disabled={!canLive}
                    onClick={() => onPick(c.id)}
                    className={cn(
                      'text-left p-3 rounded-lg border transition flex items-start gap-2.5',
                      !canLive
                        ? 'bg-slate-50 dark:bg-white/[0.02] border-slate-100 dark:border-white/5 opacity-40 cursor-not-allowed'
                        : inUse
                          ? 'bg-violet-100 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/40 hover:bg-violet-200 dark:hover:bg-violet-500/20'
                          : 'bg-slate-50 dark:bg-white/[0.03] border-slate-200 dark:border-white/10 hover:bg-cyan-100 dark:hover:bg-cyan-500/10 hover:border-cyan-200 dark:hover:border-cyan-500/40',
                    )}
                  >
                    <div className={cn(
                      'w-8 h-8 rounded-md flex items-center justify-center shrink-0',
                      c.status === 'ACTIVE' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' :
                      c.status === 'ERROR' ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400' :
                      'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400',
                    )}>
                      <CameraIcon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-slate-500 shrink-0">#{displayCodeFor(c)}</span>
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{c.name}</p>
                        {favs.has(c.id) && (
                          <Star className="w-3 h-3 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400 shrink-0" />
                        )}
                        {inUse && (
                          <span className="px-1 py-0.5 text-[8px] rounded bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 font-bold">
                            EM USO
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500 truncate">
                        {c.clienteFinal?.name ? `${c.clienteFinal.name} · ` : ''}{c.site?.name ?? '—'} · {c.location ?? 'sem loc.'}
                      </p>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <span className="text-[9px] font-mono text-slate-500">{c.resolution ?? '—'}</span>
                        {c.pipeline && (
                          <span className="text-[9px] font-mono text-cyan-700 dark:text-cyan-400">{c.pipeline}</span>
                        )}
                        {!canLive && (
                          <span className="text-[9px] font-mono text-rose-700 dark:text-rose-400">offline/disabled</span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar direita — biblioteca de câmeras (paridade Monuv)
// ─────────────────────────────────────────────────────────────────────────────

interface LibraryProps {
  usedIds:     string[]
  favs:        Set<string>
  onToggleFav: (cameraId: string) => void
  onDragStart: (cameraId: string) => void
  onDragEnd:   () => void
  onQuickAdd:  (cameraId: string) => void
}

function CameraLibrarySidebar({
  usedIds, favs, onToggleFav, onDragStart, onDragEnd, onQuickAdd,
}: LibraryProps) {
  const [q, setQ]                 = useState('')
  const [siteFilter, setSite]     = useState('')
  const [clientFilter, setClient] = useState('')
  const [favsOnly, setFavsOnly]   = useState(false)
  const { data, isLoading } = useCameras()
  const { data: me }        = useMe()
  const cameras: any[]      = data?.cameras ?? []

  // ── Tenant scope (regras de negócio) ─────────────────────────────────────
  // INTEGRADOR  → vê todas câmeras de seus clientes finais (filtro opcional).
  // USER (cliente final) → vê apenas as próprias câmeras (filtro fixo).
  // USER c/ role=GUARITA → vê apenas os sites atribuídos ao usuário.
  const isIntegrador  = me?.kind === 'INTEGRADOR' || me?.kind === 'SUPER_ADMIN'
  const isClienteFin  = me?.kind === 'USER' && !!me?.clienteFinal
  const isGuarita     = (me?.role ?? '').toUpperCase() === 'GUARITA'
  const myClienteId   = me?.clienteFinal?.id ?? null
  // Sites atribuídos à guarita — backend pode publicar em `me.assignedSiteIds`
  const guaritaSites: string[] = Array.isArray((me as any)?.assignedSiteIds)
    ? (me as any).assignedSiteIds
    : []

  // Pool após aplicar regras de negócio do tenant (defesa client-side)
  const tenantPool = useMemo(() => {
    return cameras.filter(c => {
      if (isClienteFin && myClienteId) {
        const cid = c.clienteFinal?.id ?? c.clienteFinalId ?? null
        if (cid && cid !== myClienteId) return false
      }
      if (isGuarita && guaritaSites.length > 0) {
        const sid = c.site?.id ?? null
        if (!sid || !guaritaSites.includes(sid)) return false
      }
      return true
    })
  }, [cameras, isClienteFin, myClienteId, isGuarita, guaritaSites])

  // Lista de clientes finais distintos (apenas integrador filtra)
  const clientes = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of tenantPool) {
      const cf = c.clienteFinal
      if (cf?.id) m.set(cf.id, cf.name ?? cf.tradeName ?? cf.id)
    }
    return [...m.entries()]
  }, [tenantPool])

  const sites = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of tenantPool) if (c.site) m.set(c.site.id, c.site.name)
    return [...m.entries()]
  }, [tenantPool])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tenantPool.filter(c => {
      if (clientFilter && (c.clienteFinal?.id ?? c.clienteFinalId) !== clientFilter) return false
      if (siteFilter && c.site?.id !== siteFilter) return false
      if (favsOnly && !favs.has(c.id)) return false
      if (needle) {
        const code = displayCodeFor(c)
        if (!(
          c.name?.toLowerCase().includes(needle) ||
          c.location?.toLowerCase().includes(needle) ||
          c.site?.name?.toLowerCase().includes(needle) ||
          c.clienteFinal?.name?.toLowerCase().includes(needle) ||
          code.includes(needle) ||
          String(c.id).toLowerCase().includes(needle)
        )) return false
      }
      return true
    })
  }, [tenantPool, q, clientFilter, siteFilter, favsOnly, favs])

  // Badge de escopo para o usuário entender o que ele está vendo
  const scopeBadge = isIntegrador
    ? { icon: Building2, label: 'Integrador', cls: 'bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-200 border-violet-200 dark:border-violet-500/30' }
    : isGuarita
      ? { icon: Shield,    label: 'Guarita',    cls: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-200 border-amber-200 dark:border-amber-500/30' }
      : isClienteFin
        ? { icon: Building2, label: 'Meu cliente', cls: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border-emerald-200 dark:border-emerald-500/30' }
        : { icon: Building2, label: 'Escopo',     cls: 'bg-slate-100 dark:bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30' }
  const ScopeIcon = scopeBadge.icon

  return (
    <aside className="w-72 shrink-0 rounded-xl bg-white dark:bg-space-900/60 border border-slate-200 dark:border-white/10 flex flex-col max-h-[calc(100vh-180px)] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-200 dark:border-white/10">
        <div className="flex items-center gap-2 mb-2">
          <CameraIcon className="w-4 h-4 text-sky-700 dark:text-brand-skyLight" />
          <h3 className="text-xs font-bold text-slate-900 dark:text-white">Biblioteca de câmeras</h3>
          <span className="ml-auto text-[10px] text-slate-500 font-mono">{filtered.length}/{tenantPool.length}</span>
        </div>
        {/* Scope chip */}
        <div className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-semibold mb-2', scopeBadge.cls)}>
          <ScopeIcon className="w-2.5 h-2.5" />
          {scopeBadge.label}
          {isClienteFin && me?.clienteFinal?.name && (
            <span className="opacity-80 truncate max-w-[120px]">· {me.clienteFinal.name}</span>
          )}
          {isGuarita && guaritaSites.length > 0 && (
            <span className="opacity-80">· {guaritaSites.length} site(s)</span>
          )}
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar (nome, #código, site)…"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:border-sky-300 dark:focus:border-brand-sky/40"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-white/10 flex flex-col gap-2">
        {/* Filtro de cliente (apenas para INTEGRADOR / SUPER_ADMIN) */}
        {isIntegrador && clientes.length > 1 && (
          <select
            value={clientFilter}
            onChange={e => setClient(e.target.value)}
            className="w-full px-2 py-1 text-[11px] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded text-slate-900 dark:text-white focus:outline-none focus:border-sky-300 dark:focus:border-brand-sky/40"
            title="Filtrar por cliente final"
          >
            <option value="">Todos os clientes ({clientes.length})</option>
            {clientes.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {sites.length > 1 && (
            <select
              value={siteFilter}
              onChange={e => setSite(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded text-slate-900 dark:text-white focus:outline-none focus:border-sky-300 dark:focus:border-brand-sky/40"
              title={isGuarita ? 'Sites atribuídos a você' : 'Filtrar por site'}
            >
              <option value="">{isGuarita ? 'Meus sites' : 'Todos os sites'}</option>
              {sites.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setFavsOnly(v => !v)}
            className={cn(
              'px-2 py-1 text-[11px] rounded border flex items-center gap-1 font-semibold',
              favsOnly
                ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/40'
                : 'bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:text-slate-900 dark:hover:text-white',
            )}
            title={favsOnly ? 'Mostrando apenas favoritas' : 'Filtrar favoritas'}
          >
            <Star className={cn('w-3 h-3', favsOnly && 'fill-current')} />
            {favs.size}
          </button>
        </div>
      </div>

      {/* List — itens dragáveis */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-slate-500 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            Carregando…
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-10 text-slate-500 text-xs">
            Nenhuma câmera encontrada.
          </div>
        )}
        {filtered.map(c => {
          const inUse  = usedIds.includes(c.id)
          // Critério para ser arrastável: live não está explicitamente
          // desligado E temos pelo menos uma rota de stream disponível
          // (edge node go2rtc OU URL RTSP direta — backend tenta WHEP via
          // edge primeiro, cai pra MJPEG se houver, senão mostra erro).
          const hasStreamSource = !!(c.edgeNodeId || c.rtspMainUrl)
          const canLive = c.liveMode !== 'DISABLED' && hasStreamSource
          const fav    = favs.has(c.id)
          const code   = displayCodeFor(c)
          // Detecta câmera sem edge → tooltip explica que stream pode falhar
          // mesmo arrastando (depende do backend resolver alternativa).
          const noEdgeWarn = canLive && !c.edgeNodeId
          return (
            <div
              key={c.id}
              draggable={canLive}
              onDragStart={(e) => {
                if (!canLive) { e.preventDefault(); return }
                e.dataTransfer.effectAllowed = 'copy'
                e.dataTransfer.setData('text/plain', c.id)
                onDragStart(c.id)
              }}
              onDragEnd={onDragEnd}
              onDoubleClick={() => canLive && onQuickAdd(c.id)}
              className={cn(
                'group relative px-2 py-1.5 rounded-lg border transition flex items-center gap-2',
                !canLive
                  ? 'bg-slate-50 dark:bg-white/[0.02] border-slate-100 dark:border-white/5 opacity-40 cursor-not-allowed'
                  : inUse
                    ? 'bg-violet-100 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/30 cursor-grab active:cursor-grabbing hover:bg-violet-200 dark:hover:bg-violet-500/15'
                    : 'bg-slate-50 dark:bg-white/[0.03] border-slate-200 dark:border-white/10 cursor-grab active:cursor-grabbing hover:bg-sky-100 dark:hover:bg-brand-sky/10 hover:border-sky-200 dark:hover:border-brand-sky/30',
              )}
              title={
                !canLive
                  ? 'Câmera sem fonte de stream (sem edge node nem RTSP)'
                  : noEdgeWarn
                    ? `(#${code}) ${c.name}\nArraste para um tile do mosaico\n⚠ Sem edge node — stream pode não funcionar até provisionar um Frigate/go2rtc associado.`
                    : `(#${code}) ${c.name}\nArraste para um tile do mosaico (duplo-clique = preencher slot livre)`
              }
            >
              <div className={cn(
                'w-7 h-7 rounded-md flex items-center justify-center shrink-0',
                c.status === 'ACTIVE' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' :
                c.status === 'ERROR'  ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400' :
                                        'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400',
              )}>
                <CameraIcon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-mono text-slate-500 shrink-0">#{code}</span>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{c.name}</p>
                  {fav && <Star className="w-2.5 h-2.5 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400 shrink-0" />}
                  {inUse && (
                    <span className="px-1 py-0.5 text-[8px] rounded bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 font-bold">
                      EM USO
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 truncate">
                  {c.clienteFinal?.name ? `${c.clienteFinal.name} · ` : ''}
                  {c.site?.name ?? '—'}
                  {c.location ? ` · ${c.location}` : ''}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFav(c.id) }}
                className={cn(
                  'opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10',
                  fav ? 'text-amber-500 dark:text-amber-400 opacity-100' : 'text-slate-500',
                )}
                title={fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              >
                <Star className={cn('w-3 h-3', fav && 'fill-current')} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Hint */}
      <div className="px-3 py-2 border-t border-slate-200 dark:border-white/10 text-[9px] text-slate-500 dark:text-slate-600 leading-tight">
        💡 <b>Arraste</b> uma câmera para um tile vazio ou ocupado, ou <b>duplo-clique</b> para preencher o próximo slot livre.
      </div>
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Date + Time picker — playback histórico do mosaico
// ─────────────────────────────────────────────────────────────────────────────

function PlaybackPicker({
  value, onChange,
}: { value: string | null; onChange: (iso: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Estados separados para date e time, derivados do value
  const todayIso = new Date().toISOString().slice(0, 10)
  const date = value ? value.slice(0, 10) : todayIso
  const time = value
    ? value.slice(11, 16)
    : new Date().toTimeString().slice(0, 5)
  const [draftDate, setDraftDate] = useState(date)
  const [draftTime, setDraftTime] = useState(time)

  useEffect(() => {
    if (open) {
      setDraftDate(date)
      setDraftTime(time)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function apply() {
    if (!draftDate || !draftTime) return
    // Combina como local-time → ISO
    const [y, m, d]   = draftDate.split('-').map(Number)
    const [hh, mm]    = draftTime.split(':').map(Number)
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0)
    onChange(dt.toISOString())
    setOpen(false)
  }

  const active = !!value

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5',
          active
            ? 'bg-amber-100 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/40 text-amber-700 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/25'
            : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white',
        )}
        title="Selecionar data e hora para reproduzir gravações no mosaico"
      >
        <Calendar className="w-3.5 h-3.5" />
        {active
          ? new Date(value!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          : 'Data/Hora'}
        {active && (
          <X
            className="w-3 h-3 ml-1 opacity-60 hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); onChange(null) }}
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-lg shadow-xl z-40 p-3 space-y-2.5"
          >
            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Data
              </label>
              <input
                type="date"
                value={draftDate}
                max={todayIso}
                onChange={e => setDraftDate(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded text-slate-900 dark:text-white focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Horário
              </label>
              <input
                type="time"
                step={60}
                value={draftTime}
                onChange={e => setDraftTime(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded text-slate-900 dark:text-white focus:outline-none focus:border-amber-500/50"
              />
            </div>

            {/* Atalhos rápidos */}
            <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-200 dark:border-white/5">
              {[
                { label: '−5min',  ms: 5  * 60_000 },
                { label: '−30min', ms: 30 * 60_000 },
                { label: '−1h',    ms: 60 * 60_000 },
                { label: '−6h',    ms: 6  * 3600_000 },
                { label: '−1d',    ms: 24 * 3600_000 },
              ].map(s => (
                <button
                  key={s.label}
                  onClick={() => {
                    const dt = new Date(Date.now() - s.ms)
                    setDraftDate(dt.toISOString().slice(0, 10))
                    setDraftTime(dt.toTimeString().slice(0, 5))
                  }}
                  className="px-2 py-0.5 rounded bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-[10px] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10"
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => { onChange(null); setOpen(false) }}
                className="flex-1 px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-[11px] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 flex items-center justify-center gap-1"
              >
                <Play className="w-3 h-3" /> Ao vivo
              </button>
              <button
                onClick={apply}
                className="flex-1 px-2 py-1.5 rounded bg-amber-100 dark:bg-amber-500/20 hover:bg-amber-200 dark:hover:bg-amber-500/30 text-[11px] text-amber-700 dark:text-amber-200 border border-amber-200 dark:border-amber-500/40 font-semibold flex items-center justify-center gap-1"
              >
                <History className="w-3 h-3" /> Reproduzir
              </button>
            </div>

            <p className="text-[9px] text-slate-500 dark:text-slate-600 leading-tight">
              Aplica a todos os tiles. O endpoint{' '}
              <code className="font-mono text-[8px] bg-slate-100 dark:bg-white/5 px-1 rounded">/playback/&lt;id&gt;?at=ISO</code>{' '}
              será conectado ao LivePlayer em seguida — UX já habilitada.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync badge — perfil do usuário
// ─────────────────────────────────────────────────────────────────────────────

type SyncState = 'idle' | 'saving' | 'synced' | 'error' | 'offline'

function SyncBadge({ state }: { state: SyncState }) {
  if (state === 'idle') return null
  const variants: Record<SyncState, { label: string; cls: string; icon: any }> = {
    idle:    { label: '',         cls: '',                                                                        icon: Cloud     },
    saving:  { label: 'salvando…', cls: 'bg-cyan-100 dark:bg-cyan-500/10 border-cyan-200 dark:border-cyan-500/30 text-cyan-700 dark:text-cyan-300',                          icon: RefreshCw },
    synced:  { label: 'no perfil', cls: 'bg-emerald-100 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300',                 icon: Cloud     },
    error:   { label: 'erro',      cls: 'bg-rose-100 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300',                          icon: CloudOff  },
    offline: { label: 'só local',  cls: 'bg-slate-100 dark:bg-slate-500/10 border-slate-200 dark:border-slate-500/20 text-slate-600 dark:text-slate-400',                       icon: CloudOff  },
  }
  const v = variants[state]
  const Icon = v.icon
  return (
    <span
      className={cn(
        'px-2 py-1.5 rounded-lg border text-[10px] font-semibold flex items-center gap-1',
        v.cls,
      )}
      title={
        state === 'synced'  ? 'Mosaicos sincronizados com seu perfil — disponível em outros dispositivos.' :
        state === 'saving'  ? 'Enviando ao backend…' :
        state === 'offline' ? 'Backend de perfil indisponível — salvo apenas neste dispositivo.' :
        state === 'error'   ? 'Falha ao salvar — usando cópia local.' : ''
      }
    >
      <Icon className={cn('w-3 h-3', state === 'saving' && 'animate-spin')} />
      {v.label}
    </span>
  )
}
