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
  import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
  import { motion, AnimatePresence } from 'framer-motion'
  import { Link, useSearchParams } from 'react-router-dom'
  import { useIsMobile } from '../hooks/useIsMobile'
  import {
    Grid2x2, Grid3x3, LayoutGrid, LayoutPanelLeft, LayoutPanelTop, Maximize2, Minimize2,
    Plus, X, Camera as CameraIcon, Search, RefreshCw,
    Settings2, Save, Pencil, Trash2, Play, Pause, Sparkles,
    ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
    Check, Star, Clock, Map as MapIcon,
    History, SkipBack, SkipForward, Bell, Calendar,
    PanelRightOpen, PanelRightClose, Cloud, CloudOff,
    Building2, Shield, Volume2, VolumeX,
    Gamepad2, ZoomIn, ZoomOut, Square,
  } from 'lucide-react'
  import { LivePlayer } from '../components/player/LivePlayer'
  import { PlaybackPlayer, type PlaybackPlayerRef } from '../components/player/PlaybackPlayer'
  import { PlaybackTimelineZoom } from '../components/player/PlaybackTimelineZoom'
  import {
    useCameras, fetchMyMosaics, saveMyMosaics, useMe,
    usePlaybackTimeline, sendPtzCommand, useRecordingStats,
    useSpriteManifest,
    type PtzCommand,
  } from '../api/client'
  import { useMosaicStore } from '../stores/useMosaicStore'
  import { useAiOverlayStore, OBJECT_CATALOG, type ObjectCategory } from '../stores/useAiOverlayStore'
  import { cn } from '../lib/utils'
  import { todayLocalIso, localDayStartMs, shiftDay, localSecOfDay, isoDate } from '../lib/day-utils'

  type Layout =
    | '1x1' | '2x2' | '3x3' | '4x4' | '5x5' | '6x6'
    // Layouts assimétricos "spotlight" — 1 câmera focal + N periféricas.
    // Padrão clássico de CCTV walls (Defense IA, Digifort, Milestone XProtect).
    | 'spot1x5' | 'spot1x7' | 'spot1x9'

  interface LayoutDef {
    id: Layout
    label: string
    /** Número TOTAL de tiles (não cells do grid CSS). */
    cells: number
    /** Para layouts simétricos: classe tailwind `grid-cols-N`. */
    cols: string
    icon: any
    /** Quando presente, é um layout assimétrico com grid-template-areas.
     *  `slotAreas[i]` define qual área CSS o slot `i` ocupa. */
    template?: {
      columns: string     // ex: 'repeat(3, 1fr)'
      rows: string        // ex: 'repeat(3, 1fr)'
      areas: string       // ex: '"M M B" "M M C" "D E F"'
      slotAreas: string[] // ex: ['M', 'B', 'C', 'D', 'E', 'F']
    }
  }

  const LAYOUTS: LayoutDef[] = [
    { id: '1x1', label: '1×1', cells: 1,  cols: 'grid-cols-1', icon: LayoutGrid },
    { id: '2x2', label: '2×2', cells: 4,  cols: 'grid-cols-2', icon: Grid2x2    },
    { id: '3x3', label: '3×3', cells: 9,  cols: 'grid-cols-3', icon: Grid3x3    },
    { id: '4x4', label: '4×4', cells: 16, cols: 'grid-cols-4', icon: LayoutGrid },
    { id: '5x5', label: '5×5', cells: 25, cols: 'grid-cols-5', icon: LayoutGrid },
    { id: '6x6', label: '6×6', cells: 36, cols: 'grid-cols-6', icon: LayoutGrid },
    // ─── Spotlight (1+N) ─────────────────────────────────────────────────
    // Slot 0 = câmera focal (grande), slots 1..N = periféricas (pequenas).
    // Operadores arrastam a câmera de interesse pro slot 0 e mantêm o
    // contexto perimetral nas outras. Padrão #1 em centros de controle.
    {
      id: 'spot1x5', label: '1+5', cells: 6, cols: '', icon: LayoutPanelLeft,
      template: {
        // 3×3 grid → main 2×2 (canto sup-esq) + 2 à direita + 3 embaixo
        columns: 'repeat(3, 1fr)',
        rows:    'repeat(3, 1fr)',
        areas:   '"M M B" "M M C" "D E F"',
        slotAreas: ['M', 'B', 'C', 'D', 'E', 'F'],
      },
    },
    {
      id: 'spot1x7', label: '1+7', cells: 8, cols: '', icon: LayoutPanelLeft,
      template: {
        // 4×4 grid → main 3×3 + 3 à direita + 4 embaixo
        columns: 'repeat(4, 1fr)',
        rows:    'repeat(4, 1fr)',
        areas:   '"M M M B" "M M M C" "M M M D" "E F G H"',
        slotAreas: ['M', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      },
    },
    {
      id: 'spot1x9', label: '1+9', cells: 10, cols: '', icon: LayoutPanelTop,
      template: {
        // 5×5 grid → main 4×4 + 4 à direita + 5 embaixo
        // Main com aspecto 1:1; pequenas 1:1. Layout "cinema wall" clássico.
        columns: 'repeat(5, 1fr)',
        rows:    'repeat(5, 1fr)',
        areas:
          '"M M M M B" ' +
          '"M M M M C" ' +
          '"M M M M D" ' +
          '"M M M M E" ' +
          '"F G H I J"',
        slotAreas: ['M', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
      },
    },
  ]
  // Validação visual das áreas vs cells:
  //   spot1x5: 3×3=9 cells. M(4) + B+C(2) + D+E+F(3) = 9 ✓, 6 áreas = 6 slots ✓
  //   spot1x7: 4×4=16 cells. M(9) + B+C+D(3) + E+F+G+H(4) = 16 ✓, 8 áreas ✓
  //   spot1x9: 5×5=25 cells. M(16) + B+C+D+E(4) + F+G+H+I+J(5) = 25 ✓, 10 áreas ✓

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
    /** [LEGADO] Modo de ajuste de imagem antigo (global do mosaico).
     *  Removido do toolbar em 2026-05-12. Mantido na interface por compat de
     *  schema com perfis salvos antes da remoção — ignorado pelo render.
     *  O ajuste agora é Auto sempre, com override per-câmera em camera.fitOverride. */
    fitMode?: 'auto' | 'cover' | 'contain'
  }

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
          // Spread primeiro, defaults preenchem só o que estiver ausente.
          return {
            ...p,
            sidebarOpen:   p.sidebarOpen   ?? true,
            playbackAt:    p.playbackAt    ?? null,
            autoRotateSec: p.autoRotateSec ?? 0,
            // fitMode é legado (não tem mais UI). Preservamos o valor salvo
            // se existir, mas não criamos default novo.
          }
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
    // fitMode é legado — ignoramos o valor para não restaurar UI removida,
    // mas preservamos no perfil pra não disparar PUT desnecessário ao backend.
    const legacyFitMode = (p.fitMode === 'cover' || p.fitMode === 'contain' || p.fitMode === 'auto')
      ? p.fitMode : undefined
    return {
      presets,
      activeId,
      autoRotateSec: Number(p.autoRotateSec) || 0,
      sidebarOpen: p.sidebarOpen !== false,
      playbackAt: typeof p.playbackAt === 'string' ? p.playbackAt : null,
      fitMode: legacyFitMode,
    }
  }

  export function LivePage() {
    const isMobile = useIsMobile()
    const { data: camData } = useCameras()
    const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
    const [picker, setPicker] = useState<{ slot: number } | null>(null)
    const [isFs, setIsFs] = useState(false)
    const [showPresets, setShowPresets]           = useState(false)
    const [showLayoutPicker, setShowLayoutPicker] = useState(false)
    const [showAiPanel, setShowAiPanel] = useState(false)
    const [aiPanelTab, setAiPanelTab] = useState<ObjectCategory>('pessoas_veiculos')

    // IA overlay store
    const aiGlobalEnabled    = useAiOverlayStore(s => s.globalEnabled)
    const aiToggleGlobal     = useAiOverlayStore(s => s.toggleGlobalEnabled)
    const aiEnabledTypes     = useAiOverlayStore(s => s.enabledTypes)
    const aiToggleType       = useAiOverlayStore(s => s.toggleType)
    const aiShowBoxes        = useAiOverlayStore(s => s.showBoxes)
    const aiShowLabels       = useAiOverlayStore(s => s.showLabels)
    const aiMinConfidence    = useAiOverlayStore(s => s.minConfidence)
    const aiSetShowBoxes     = useAiOverlayStore(s => s.setShowBoxes)
    const aiSetShowLabels    = useAiOverlayStore(s => s.setShowLabels)
    const aiSetMinConfidence = useAiOverlayStore(s => s.setMinConfidence)
    const aiResetCameraOverrides = useCallback(() => {
      useAiOverlayStore.setState({ cameraOverrides: {} })
    }, [])
    const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')
    const [favs, setFavs] = useState<Set<string>>(loadFavs)
    // Modal de atalhos de teclado (cheatsheet). Aberto pela tecla `?` ou
    // pelo botão "?" na toolbar. Pesquisa em telas de ajuda da indústria
    // (Frigate, UniFi Protect): operadores novos descobrem os atalhos só
    // depois de meses; tornar isso óbvio é UX win imediato.
    const [showShortcuts, setShowShortcuts] = useState(false)

    const expandedSlot = useMosaicStore(state => state.expandedSlot)
    const setExpandedSlot = useMosaicStore(state => state.setExpandedSlot)
    const focusedSlot = useMosaicStore(state => state.focusedSlot)

    // Sync state com perfil do usuário no backend
    const [syncState, setSyncState] = useState<'idle' | 'saving' | 'synced' | 'error' | 'offline'>('idle')
    const [syncedFromBackend, setSyncedFromBackend] = useState(false)

    // Atualiza visibilidade da página na store
    useEffect(() => {
      const handleVisibility = () => {
        useMosaicStore.getState().setIsWindowVisible(!document.hidden)
      }
      handleVisibility()
      document.addEventListener('visibilitychange', handleVisibility)
      return () => document.removeEventListener('visibilitychange', handleVisibility)
    }, [])

    // Timeline interativa do mosaico (CF-feature, scroll-zoom).
    // Mostra heatmap de gravação do "pivô" — que é a câmera focada ou,
    // na ausência, o primeiro slot preenchido. Click → seta playbackAt no
    // mosaico inteiro (todas as câmeras vão pra esse instante).
    const [showMosaicTimeline, setShowMosaicTimeline] = useState(false)
    const [timelineDay, setTimelineDay] = useState<string>(() => todayLocalIso())

    useEffect(() => { saveFavs(favs) }, [favs])
    function toggleFav(id: string) {
      setFavs(s => {
        const next = new Set(s)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
    }

    const active = prefs.presets.find(p => p.id === prefs.activeId) ?? prefs.presets[0]
    const layoutMeta = LAYOUTS.find(l => l.id === active.layout)!
    // Em mobile, limita o grid a no máximo 2 colunas para não comprimir os tiles
    const mobileColsMap: Record<string, string> = {
      'grid-cols-1': 'grid-cols-1',
      'grid-cols-2': 'grid-cols-2',
      'grid-cols-3': 'grid-cols-2',
      'grid-cols-4': 'grid-cols-2',
      'grid-cols-5': 'grid-cols-2',
      'grid-cols-6': 'grid-cols-2',
    }
    // Layouts assimétricos não cabem em mobile (areas perdem proporção em telas
    // estreitas — main de 4×3 vira ilegível). Fallback: 1-coluna stack com o
    // main no topo. Em desktop, o template inline-style assume a renderização.
    const useAsymmetric = !isMobile && !!layoutMeta.template
    const gridCols = useAsymmetric
      ? '' // ignorado quando inline-style toma conta
      : isMobile
        ? (mobileColsMap[layoutMeta.cols] ?? 'grid-cols-2')
        : (layoutMeta.cols || 'grid-cols-2') // assimétrico em mobile → 2 colunas

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
    // Sprite manifest pra preview no hover da timeline global. Mesma câmera-pivô.
    // 2026-05-12 fix: LivePage não puxava sprites — usuário via timeline sem
    // miniaturas. Componente PlaybackTimelineZoom já tem código de hover, só
    // precisava receber o prop.
    const { data: mosaicSpriteManifest } = useSpriteManifest(
      showMosaicTimeline ? pivotCameraId : null,
      showMosaicTimeline ? timelineDay : null,
    )

    // Posição atual do playhead em segundos do dia — derivada do playbackAt
    // global. Quando AO VIVO (playbackAt=null), playhead vai pro fim do dia atual
    // (agora) só se o dia da timeline for hoje.
    const playheadSecOfDay = useMemo(() => {
      const isToday = timelineDay === todayLocalIso()
      if (prefs.playbackAt) {
        const d = new Date(prefs.playbackAt)
        const dayIso = isoDate(d)
        if (dayIso !== timelineDay) return undefined
        return localSecOfDay(d)
      }
      if (isToday) {
        return localSecOfDay(new Date())
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

    // ── Multi-monitor / Video Wall: aplica preset e fullscreen via URL ─────
    // Uso típico: o operador abre uma 2ª janela (Ctrl+N) com URL:
    //   /live?preset=PRESET_ID&fullscreen=1
    // que vai imediatamente pro preset alvo e entra em tela cheia. Permite
    // dispor presets diferentes em monitores diferentes sem precisar reabrir
    // o app e clicar a cada vez. URL params são aplicados UMA VEZ, depois
    // que os presets carregaram do backend.
    const [urlParams] = useSearchParams()
    useEffect(() => {
      if (!syncedFromBackend) return
      const wantPreset = urlParams.get('preset')
      const wantFs = urlParams.get('fullscreen') === '1'
      if (wantPreset) {
        // Busca por id exato OU nome (case-insensitive)
        const target = prefs.presets.find(p =>
          p.id === wantPreset || p.name.toLowerCase() === wantPreset.toLowerCase()
        )
        if (target && target.id !== prefs.activeId) {
          setPrefs(s => ({ ...s, activeId: target.id }))
        }
      }
      if (wantFs) {
        // Pequeno delay pra garantir que o DOM #live-mosaic-root existe
        setTimeout(() => {
          const el = document.getElementById('live-mosaic-root')
          if (el && !document.fullscreenElement) el.requestFullscreen().catch(() => {})
        }, 150)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [syncedFromBackend])

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

        // Esc fecha tile expandido OU o modal de atalhos — globais.
        if (e.key === 'Escape') {
          if (showShortcuts) { setShowShortcuts(false); return }
          if (expandedSlot != null) {
            e.preventDefault()
            setExpandedSlot(null)
            return
          }
        }

        // ? abre/fecha cheatsheet de atalhos (Shift+/ em teclado US-ANSI;
        // funciona em ABNT também porque o key é o caractere final, não o code).
        if (e.key === '?') {
          e.preventDefault()
          setShowShortcuts(v => !v)
          return
        }

        // b — toggla biblioteca de câmeras (painel direito)
        // Sem modifiers. Já passou o filtro INPUT/TEXTAREA/SELECT lá em cima.
        if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          e.preventDefault()
          setPrefs(s => ({ ...s, sidebarOpen: !s.sidebarOpen }))
          return
        }

        // 1-9 → focar slot N-1 (sem precisar mouse)
        if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const idx = Number(e.key) - 1
          if (idx < active.slots.length) {
            e.preventDefault()
            useMosaicStore.getState().setFocusedSlot(idx)
            return
          }
        }

        // ← / → navega entre presets (sem mouse no dropdown)
        if (e.key === 'ArrowLeft' && (e.shiftKey || e.ctrlKey)) {
          e.preventDefault()
          gotoRelativePreset(-1)
          return
        }
        if (e.key === 'ArrowRight' && (e.shiftKey || e.ctrlKey)) {
          e.preventDefault()
          gotoRelativePreset(1)
          return
        }

        // F sem slot focado → tela cheia do mosaico inteiro
        // (com slot focado, o handler abaixo expande só aquele tile)
        if ((e.key === 'f' || e.key === 'F') && focusedSlot == null) {
          e.preventDefault()
          toggleFs()
          return
        }

        // Demais atalhos exigem slot focado
        if (focusedSlot == null) return

        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          const cid = active.slots[focusedSlot]
          setSlot(focusedSlot, null)
          useMosaicStore.getState().setPaused(focusedSlot, false)
          if (cid) useMosaicStore.getState().clearPlaybackOffset(cid)
        } else if (e.key === ' ') {
          e.preventDefault()
          useMosaicStore.getState().togglePause(focusedSlot)
        } else if (e.key === 'f' || e.key === 'F') {
          // F = expandir/colapsar slot focado (paridade com fullscreen padrão)
          e.preventDefault()
          setExpandedSlot(expandedSlot === focusedSlot ? null : focusedSlot)
        }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [focusedSlot, expandedSlot, showShortcuts]) // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="flex flex-col h-full gap-3">
        <div className="flex items-center justify-end flex-wrap gap-2 bg-slate-900 rounded-xl border border-white/[0.08] px-3 py-1.5">
          <div className="hidden">{/* spacer */}</div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Preset switcher */}
            <div className="relative">
              <button
                onClick={() => setShowPresets(v => !v)}
                className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs font-semibold hover:bg-white/10 hover:text-white flex items-center gap-1.5"
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
                    className="absolute right-0 top-full mt-1 w-72 bg-slate-900 border border-white/10 rounded-lg shadow-xl z-40 overflow-hidden"
                  >
                    <div className="p-2 border-b border-white/10 flex items-center justify-between">
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
                                  className="flex-1 px-2 py-1 text-xs bg-slate-100 dark:bg-white/10 border border-cyan-300 dark:border-cyan-500/40 rounded text-white focus:outline-none"
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
                                  <span className={cn('text-xs truncate', isActive ? 'text-white font-semibold' : 'text-slate-200')}>
                                    {p.name}
                                  </span>
                                  <span className="text-[9px] font-mono text-slate-500 shrink-0">
                                    {p.layout} · {filled}/{p.slots.length}
                                  </span>
                                </button>
                                <button
                                  onClick={() => { setEditingPresetId(p.id); setEditName(p.name) }}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-slate-300 hover:text-white"
                                  title="Renomear"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => deletePreset(p.id)}
                                  disabled={prefs.presets.length <= 1}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-500/20 text-slate-300 hover:text-rose-700 dark:hover:text-rose-300 disabled:opacity-20 disabled:cursor-not-allowed"
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
                    <div className="p-2 border-t border-white/10 space-y-1">
                      <button
                        onClick={duplicateActive}
                        className="w-full text-[10px] px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-200 flex items-center justify-center gap-1.5"
                      >
                        <Plus className="w-3 h-3" /> Duplicar preset atual
                      </button>
                      {/* Multi-monitor: abre preset atual em nova janela já em
                          fullscreen. Útil pra distribuir presets entre 2+ displays. */}
                      <button
                        onClick={() => {
                          const url = `${window.location.pathname}?preset=${encodeURIComponent(active.id)}&fullscreen=1`
                          window.open(
                            url,
                            `vmsWindow_${active.id}`,
                            'noopener,noreferrer,popup=yes',
                          )
                          setShowPresets(false)
                        }}
                        className="w-full text-[10px] px-2 py-1.5 rounded bg-cyan-50 dark:bg-cyan-500/10 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-200/60 dark:border-cyan-500/30 flex items-center justify-center gap-1.5 font-semibold"
                        title="Abre o preset atual em uma nova janela já em tela cheia. Útil para múltiplos monitores."
                      >
                        <Maximize2 className="w-3 h-3" /> Abrir em nova janela (multi-monitor)
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* IA overlay toggle + config (Sprint 1 — Contador de Fluxo) */}
            <div className="relative">
              <div className={cn(
                'flex items-center gap-0.5 p-0.5 rounded-lg border',
                aiGlobalEnabled
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-white/5 border-white/10',
              )}>
                <button
                  onClick={aiToggleGlobal}
                  className={cn(
                    'px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 transition-colors',
                    aiGlobalEnabled
                      ? 'bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/35'
                      : 'text-slate-300 hover:bg-white/10',
                  )}
                  title={aiGlobalEnabled ? 'IA ativa — clique para desligar' : 'IA desligada — clique para ativar'}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>IA</span>
                  {aiGlobalEnabled && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                </button>
                <button
                  onClick={() => setShowAiPanel(v => !v)}
                  className={cn(
                    'p-1 rounded-md text-xs transition-colors',
                    aiGlobalEnabled ? 'text-emerald-200 hover:bg-emerald-500/20' : 'text-slate-400 hover:bg-white/10',
                  )}
                  title="Configurações de IA"
                >
                  <Settings2 className="w-3 h-3" />
                </button>
              </div>

              <AnimatePresence>
                {showAiPanel && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1 w-72 bg-slate-900 border border-white/10 rounded-xl shadow-xl z-40 overflow-hidden"
                  >
                    <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Inteligência Artificial</span>
                      <button onClick={() => setShowAiPanel(false)} className="text-slate-400 hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="p-3 space-y-3">
                      {/* Master toggle visual */}
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-white">Detecção em tempo real</div>
                          <div className="text-[10px] text-slate-400">Aplica a todas câmeras visíveis</div>
                        </div>
                        <button
                          onClick={aiToggleGlobal}
                          className={cn(
                            'relative w-9 h-5 rounded-full transition-colors',
                            aiGlobalEnabled ? 'bg-emerald-500' : 'bg-white/15',
                          )}
                          title={aiGlobalEnabled ? 'Desligar' : 'Ligar'}
                        >
                          <span className={cn(
                            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',
                            aiGlobalEnabled ? 'right-0.5' : 'left-0.5',
                          )} />
                        </button>
                      </div>

                      <div className="border-t border-white/5 pt-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Objetos a detectar</div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                const all = Object.values(OBJECT_CATALOG).flatMap(c => c.items.map(i => i.id))
                                useAiOverlayStore.setState({ enabledTypes: all })
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded text-emerald-300 hover:bg-emerald-500/10"
                              title="Selecionar todos"
                            >Todos</button>
                            <button
                              onClick={() => useAiOverlayStore.setState({ enabledTypes: [] })}
                              className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:bg-white/5"
                              title="Limpar seleção"
                            >Nenhum</button>
                          </div>
                        </div>

                        {/* Tabs de categoria */}
                        <div className="flex gap-1 mb-2 overflow-x-auto">
                          {(Object.keys(OBJECT_CATALOG) as ObjectCategory[]).map(cat => {
                            const isActive = aiPanelTab === cat
                            const items = OBJECT_CATALOG[cat].items
                            const enabledCount = items.filter(i => aiEnabledTypes.includes(i.id)).length
                            return (
                              <button
                                key={cat}
                                onClick={() => setAiPanelTab(cat)}
                                className={cn(
                                  'px-2 py-1 rounded text-[10px] font-semibold transition-colors flex items-center gap-1 whitespace-nowrap',
                                  isActive
                                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                                    : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10',
                                )}
                              >
                                <span>{OBJECT_CATALOG[cat].label}</span>
                                {enabledCount > 0 && (
                                  <span className={cn(
                                    'px-1 rounded text-[9px] font-bold',
                                    isActive ? 'bg-emerald-500/30 text-emerald-100' : 'bg-white/10 text-slate-300',
                                  )}>{enabledCount}</span>
                                )}
                              </button>
                            )
                          })}
                        </div>

                        <div className="grid grid-cols-2 gap-1 max-h-44 overflow-y-auto pr-1">
                          {OBJECT_CATALOG[aiPanelTab].items.map(o => {
                            const on = aiEnabledTypes.includes(o.id)
                            const disabled = !!o.disabled
                            return (
                              <button
                                key={o.id}
                                onClick={() => !disabled && aiToggleType(o.id)}
                                disabled={disabled}
                                title={o.hint ?? (disabled ? 'Requer modelo custom' : undefined)}
                                className={cn(
                                  'flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] transition-colors border',
                                  disabled
                                    ? 'bg-white/5 text-slate-500 border-white/5 cursor-not-allowed opacity-60'
                                    : on
                                      ? o.critical
                                        ? 'bg-rose-500/15 text-rose-200 border-rose-500/40'
                                        : 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
                                      : o.critical
                                        ? 'bg-rose-500/5 text-rose-300/70 border-rose-500/20 hover:bg-rose-500/10'
                                        : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
                                )}
                              >
                                <span>{o.emoji}</span>
                                <span className="font-semibold truncate">{o.label}</span>
                                {disabled
                                  ? <span className="ml-auto text-[8px] px-1 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold shrink-0">PRO</span>
                                  : on
                                    ? <Check className="w-3 h-3 ml-auto shrink-0" />
                                    : null}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div className="border-t border-white/5 pt-3 space-y-1.5">
                        <label className="flex items-center gap-2 cursor-pointer px-1">
                          <input
                            type="checkbox"
                            checked={aiShowBoxes}
                            onChange={(e) => aiSetShowBoxes(e.target.checked)}
                            className="accent-emerald-500 w-3.5 h-3.5"
                          />
                          <span className="text-xs text-slate-200">Mostrar bounding box</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer px-1">
                          <input
                            type="checkbox"
                            checked={aiShowLabels}
                            onChange={(e) => aiSetShowLabels(e.target.checked)}
                            className="accent-emerald-500 w-3.5 h-3.5"
                          />
                          <span className="text-xs text-slate-200">Labels com %</span>
                        </label>
                      </div>

                      <div className="border-t border-white/5 pt-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Confiança mín.</span>
                          <span className="text-sm font-bold text-emerald-300 font-mono">{Math.round(aiMinConfidence * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={Math.round(aiMinConfidence * 100)}
                          onChange={(e) => aiSetMinConfidence(Number(e.target.value) / 100)}
                          className="w-full accent-emerald-500"
                        />
                      </div>

                      <button
                        onClick={() => aiResetCameraOverrides()}
                        className="w-full px-2 py-1.5 rounded text-[11px] text-slate-400 hover:text-white hover:bg-white/5 border border-white/10"
                      >
                        Limpar overrides por câmera
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Layout switcher — dropdown flutuante */}
            <div className="relative">
              <button
                onClick={() => setShowLayoutPicker(v => !v)}
                className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs font-semibold hover:bg-white/10 hover:text-white flex items-center gap-1.5"
                title="Selecionar layout do mosaico"
              >
                {(() => {
                  const l = LAYOUTS.find(l => l.id === active.layout) ?? LAYOUTS[1]
                  const Icon = l.icon
                  return <><Icon className="w-3.5 h-3.5" />{l.label}</>
                })()}
                <ChevronDown className={cn('w-3 h-3 transition-transform', showLayoutPicker && 'rotate-180')} />
              </button>
              <AnimatePresence>
                {showLayoutPicker && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.12 }}
                    className="absolute left-0 top-full mt-1 w-48 bg-slate-900 border border-white/10 rounded-xl shadow-xl z-40 overflow-hidden py-1"
                  >
                    {/* Cabeçalho seção "Simétricos" */}
                    <div className="px-3 pt-1 pb-0.5 text-[9px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">
                      Simétricos
                    </div>
                    {LAYOUTS.filter(l => !l.template).map(l => {
                      const Icon = l.icon
                      const isActive = l.id === active.layout
                      return (
                        <button
                          key={l.id}
                          onClick={() => { setLayout(l.id); setShowLayoutPicker(false) }}
                          className={cn(
                            'w-full px-3 py-1.5 flex items-center gap-2.5 text-xs font-semibold transition',
                            isActive
                              ? 'bg-cyan-100 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                              : 'text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-white',
                          )}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="flex-1 text-left">{l.label}</span>
                          <span className="text-[9px] font-mono text-slate-400">{l.cells} tiles</span>
                          {isActive && <Check className="w-3 h-3 text-cyan-500 shrink-0" />}
                        </button>
                      )
                    })}
                    {/* Separador + seção "Spotlight" */}
                    <div className="my-1 border-t border-white/10" />
                    <div className="px-3 pt-1 pb-0.5 text-[9px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1">
                      <Star className="w-2.5 h-2.5 fill-current text-cyan-500" />
                      Spotlight (1 focal + N)
                    </div>
                    {LAYOUTS.filter(l => !!l.template).map(l => {
                      const Icon = l.icon
                      const isActive = l.id === active.layout
                      return (
                        <button
                          key={l.id}
                          onClick={() => { setLayout(l.id); setShowLayoutPicker(false) }}
                          className={cn(
                            'w-full px-3 py-1.5 flex items-center gap-2.5 text-xs font-semibold transition',
                            isActive
                              ? 'bg-cyan-100 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                              : 'text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-white',
                          )}
                          title="Layout assimétrico: slot 1 grande (câmera focal) + demais menores"
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="flex-1 text-left">{l.label}</span>
                          <span className="text-[9px] font-mono text-slate-400">{l.cells} tiles</span>
                          {isActive && <Check className="w-3 h-3 text-cyan-500 shrink-0" />}
                        </button>
                      )
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Auto-rotate — oculto em mobile */}
            <div className={cn('relative flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5 overflow-hidden', isMobile && 'hidden')}>
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
                className="relative px-1.5 py-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
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
                    : 'text-slate-300 hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent',
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
                className="relative px-1.5 py-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Próximo preset (manual)"
              >
                <SkipForward className="w-3 h-3" />
              </button>
              <select
                value={prefs.autoRotateSec}
                onChange={e => setPrefs(s => ({ ...s, autoRotateSec: +e.target.value }))}
                className="relative bg-transparent text-[11px] text-slate-200 focus:outline-none px-1"
                title="Intervalo de rotação (segundos)"
              >
                {ROTATE_INTERVALS.map(i => (
                  <option key={i} value={i} className="bg-slate-900">
                    {i === 0 ? 'off' : `${i}s`}
                  </option>
                ))}
              </select>
            </div>

            {/* Separador Grupo 1 → Grupo 2 */}
            <div className="w-px h-5 bg-white/[0.12] shrink-0" />

            {/* Date + Time pickers — playback histórico (oculto em mobile) */}
            {!isMobile && <PlaybackPicker
              value={prefs.playbackAt ?? null}
              onChange={iso => setPrefs(s => ({ ...s, playbackAt: iso }))}
            />}

            {/* Fit mode: REMOVIDO do toolbar (2026-05-12).
                Motivo: Auto resolve ~95% dos casos com a tolerância de 30% e
                o operador raramente quer reverter. Override por câmera (5%)
                deve ser configurado em CameraDetailPage, não aqui. A heurística
                Auto continua viva em LivePlayer.tsx (effectiveFit). */}

            <button
              onClick={clearAll}
              className="px-3 py-1.5 rounded-lg bg-white/8 border border-white/15 text-slate-300 text-xs font-semibold hover:bg-white/15 hover:text-white flex items-center gap-1.5"
              title="Limpar todos os slots do preset atual"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Limpar
            </button>

            {/* Mapa, Timeline e Biblioteca — ocultos em mobile */}
            {!isMobile && (
              <Link
                to="/live/map"
                className="px-3 py-1.5 rounded-lg bg-white/8 border border-white/15 text-slate-200 text-xs font-semibold hover:bg-white/15 hover:text-white flex items-center gap-1.5"
                title="Visualizar câmeras em mapa"
              >
                <MapIcon className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                Mapa
              </Link>
            )}
            {!isMobile && (
              <button
                onClick={() => setShowMosaicTimeline(v => !v)}
                className={cn(
                  'px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5',
                  showMosaicTimeline
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-200 hover:bg-amber-500/30'
                    : 'bg-white/8 border-white/15 text-slate-200 hover:bg-white/15 hover:text-white',
                )}
                title="Mostrar timeline interativa (heatmap de gravação) — scroll faz zoom"
              >
                <History className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300" />
                Timeline
              </button>
            )}
            {!isMobile && (
              <button
                onClick={() => setPrefs(s => ({ ...s, sidebarOpen: !s.sidebarOpen }))}
                className={cn(
                  'px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5',
                  prefs.sidebarOpen
                    ? 'bg-sky-500/20 border-sky-400/40 text-sky-200 hover:bg-sky-500/30'
                    : 'bg-white/8 border-white/15 text-slate-200 hover:bg-white/15 hover:text-white',
                )}
                title={prefs.sidebarOpen ? 'Ocultar biblioteca de câmeras' : 'Abrir biblioteca de câmeras'}
              >
                {prefs.sidebarOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
                Biblioteca
              </button>
            )}

            {/* Separador Grupo 2 → Grupo 3 */}
            <div className="w-px h-5 bg-white/[0.12] shrink-0" />

            {/* Sync indicator com perfil do usuário */}
            <SyncBadge state={syncState} />

            {/* Atalhos (?) — abre cheatsheet */}
            <button
              onClick={() => setShowShortcuts(true)}
              className="w-7 h-7 rounded-lg bg-white/8 border border-white/15 text-slate-300 text-xs font-bold hover:bg-white/15 hover:text-white flex items-center justify-center"
              title="Atalhos de teclado (?)"
            >
              ?
            </button>

            <button
              onClick={toggleFs}
              className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30 flex items-center gap-1.5"
            >
              {isFs ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              {isFs ? 'Sair' : 'Tela cheia'}
            </button>
          </div>
        </div>

        {/* Barra de saúde do mosaico — agregado de status das câmeras nos slots.
            Mostra contadores de ACTIVE / ERROR+OFFLINE+INACTIVE / PROVISIONING
            entre as câmeras do preset atual. Não conta slots vazios. */}
        {(() => {
          const filledIds = active.slots.filter((x): x is string => !!x)
          if (filledIds.length === 0) return null
          const cams = camData?.cameras ?? []
          const camsInMosaic = filledIds
            .map((id: string) => cams.find((c: any) => c.id === id))
            .filter(Boolean) as any[]
          const total = filledIds.length
          const active_ = camsInMosaic.filter((c: any) => c.status === 'ACTIVE').length
          const provisioning = camsInMosaic.filter((c: any) => c.status === 'PROVISIONING').length
          const degraded = camsInMosaic.filter((c: any) =>
            c.status === 'ERROR' || c.status === 'OFFLINE' || c.status === 'INACTIVE' || c.status === 'MAINTENANCE'
          ).length
          // Não mostra se total ≤ 1 (1×1) — barra ficaria redundante com badge da câmera única
          if (total <= 1) return null

          const allHealthy = active_ === total
          return (
            <div className={cn(
              'flex items-center gap-3 px-3 py-1.5 rounded-lg border text-[11px] font-semibold',
              allHealthy
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-200'
                : degraded > 0
                  ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-200'
                  : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-200',
            )}>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                allHealthy ? 'bg-emerald-500 animate-pulse' : degraded > 0 ? 'bg-rose-500' : 'bg-amber-500',
              )} />
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                Saúde do mosaico:
              </span>
              <span className="flex items-center gap-2 font-mono">
                <span className="text-emerald-700 dark:text-emerald-300" title="Câmeras ativas">
                  ✓ {active_}
                </span>
                {provisioning > 0 && (
                  <span className="text-amber-700 dark:text-amber-300" title="Em provisionamento">
                    ⋯ {provisioning}
                  </span>
                )}
                {degraded > 0 && (
                  <span className="text-rose-700 dark:text-rose-300" title="Em erro / offline / inativas">
                    ✗ {degraded}
                  </span>
                )}
                <span className="text-slate-500">/ {total}</span>
              </span>
              {!allHealthy && (
                <span className="text-[10px] italic opacity-80 ml-auto">
                  {degraded > 0 ? 'verifique câmeras destacadas' : 'aguardando ativação'}
                </span>
              )}
            </div>
          )
        })()}

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
          <div className="rounded-xl bg-slate-950 border border-white/10 p-3">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2 text-[11px]">
                <History className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300" />
                <span className="text-slate-200 font-semibold">Timeline interativa</span>
                {pivotCameraId ? (
                  <span className="text-slate-500">
                    · pivô: <span className="text-cyan-700 dark:text-cyan-300 font-mono">
                      {(() => {
                        const cam = (camData?.cameras ?? [])?.find?.((c: any) => c.id === pivotCameraId)
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
                    return shiftDay(d, -1)
                  })}
                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-slate-200"
                  title="Dia anterior"
                ><SkipBack className="w-3 h-3" /></button>
                <input
                  type="date"
                  value={timelineDay}
                  onChange={e => setTimelineDay(e.target.value)}
                  className="px-2 py-1 text-[11px] bg-white/5 border border-white/10 rounded-md text-white"
                />
                <button
                  onClick={() => setTimelineDay(d => {
                    return shiftDay(d, 1)
                  })}
                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-slate-200"
                  title="Próximo dia"
                ><SkipForward className="w-3 h-3" /></button>
                <button
                  onClick={() => setTimelineDay(todayLocalIso())}
                  className="px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-slate-200 font-semibold"
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
                motionBitmap={mosaicTimeline?.motionBitmap}
                intensity={mosaicTimeline?.intensity}
                events={mosaicTimeline?.events}
                bookmarks={mosaicTimeline?.bookmarks}
                gaps={mosaicTimeline?.gaps}
                spriteHours={mosaicSpriteManifest?.hours}
                currentSecOfDay={playheadSecOfDay}
                dayUtcDate={timelineDay}
                onSeekIso={iso => setPrefs(s => ({ ...s, playbackAt: iso }))}
                onDayChange={setTimelineDay}
                onJumpToLive={() => {
                  setTimelineDay(todayLocalIso())
                  setPrefs(s => ({ ...s, playbackAt: null }))
                }}
                trackHeight={30}
                compact
              />
            ) : (
              <div className="h-8 flex items-center justify-center text-[11px] text-slate-500 border border-dashed border-white/10 rounded-md">
                Adicione câmeras ao preset pra ver a timeline.
              </div>
            )}
          </div>
        )}

        {/* Mosaic + Library sidebar */}
        <div className="flex gap-3 flex-1 min-h-0">
          <div
            id="live-mosaic-root"
            className={cn(
              'relative rounded-xl bg-slate-950 border border-white/10 p-2 flex-1 min-w-0 min-h-0 flex flex-col',
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
                            const cam = (camData?.cameras ?? [])?.find?.((c: any) => c.id === pivotCameraId)
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
                      onClick={() => setTimelineDay(todayLocalIso())}
                      className="px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 font-semibold"
                    >Hoje</button>
                    {prefs.playbackAt && (
                      <button
                        onClick={() => setPrefs(s => ({ ...s, playbackAt: null }))}
                        className="ml-2 px-2 py-1 text-[10px] rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1"
                      ><Play className="w-2.5 h-2.5" /> AO VIVO</button>
                    )}
                    <button
                      onClick={() => setShowMosaicTimeline(false)}
                      className="ml-1 p-1 rounded bg-white/5 hover:bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300"
                      title="Fechar timeline"
                    ><X className="w-3 h-3" /></button>
                  </div>
                </div>
                {pivotCameraId ? (
                  <PlaybackTimelineZoom
                    bitmap={mosaicTimeline?.bitmap}
                    motionBitmap={mosaicTimeline?.motionBitmap}
                    intensity={mosaicTimeline?.intensity}
                    events={mosaicTimeline?.events}
                    bookmarks={mosaicTimeline?.bookmarks}
                    gaps={mosaicTimeline?.gaps}
                    spriteHours={mosaicSpriteManifest?.hours}
                    currentSecOfDay={playheadSecOfDay}
                    dayUtcDate={timelineDay}
                    onSeekIso={iso => setPrefs(s => ({ ...s, playbackAt: iso }))}
                    onDayChange={setTimelineDay}
                    onJumpToLive={() => {
                      setTimelineDay(todayLocalIso())
                      setPrefs(s => ({ ...s, playbackAt: null }))
                    }}
                    trackHeight={30}
                    compact
                  />
                ) : (
                  <div className="h-8 flex items-center justify-center text-[11px] text-slate-500 border border-dashed border-white/10 rounded-md">
                    Adicione câmeras ao preset pra ver a timeline.
                  </div>
                )}
              </div>
            )}
            <div
              className={cn(
                'grid gap-1.5 flex-1 min-h-0',
                !useAsymmetric && gridCols,
                !useAsymmetric && 'auto-rows-fr',
              )}
              style={useAsymmetric && layoutMeta.template ? {
                gridTemplateColumns: layoutMeta.template.columns,
                gridTemplateRows:    layoutMeta.template.rows,
                gridTemplateAreas:   layoutMeta.template.areas,
              } : undefined}
            >
              {active.slots.map((cameraId, idx) => {
                // Em layouts assimétricos, slot 0 é o "main" (M) e ganha
                // tratamento visual sutilmente diferente: dense=false (mostra
                // controles completos) e isMain=true (a célula pode opcionalmente
                // exibir badge "FOCAL"). As pequenas operam como o mosaico
                // tradicional. Em layouts simétricos, isMain é sempre false.
                const isMain = useAsymmetric && idx === 0
                // gridArea aplicado direto no MosaicCell (root é o grid item).
                // Wrapper extra quebraria propagação de altura (CSS Grid expande
                // o item direto; com wrapper sem h-full, o MosaicCell colapsava
                // pra altura natural do conteúdo → linhas desalinhadas no 2×2).
                const gridArea = useAsymmetric && layoutMeta.template
                  ? layoutMeta.template.slotAreas[idx]
                  : undefined
                return (
                  <MosaicCell
                    key={`${active.id}-${idx}`}
                    slotIndex={idx}
                    cameraId={cameraId}
                    gridArea={gridArea}
                    // Em layouts assimétricos, NÃO marca como dense o slot
                    // main (ele tem espaço sobrando); só os pequenos ficam
                    // densos. Em simétricos, mantém o critério antigo.
                    dense={useAsymmetric ? !isMain : layoutMeta.cells >= 16}
                    isMain={isMain}
                    isFavorite={!!cameraId && favs.has(cameraId)}
                    globalPlayback={prefs.playbackAt ?? null}
                    onToggleFav={() => cameraId && toggleFav(cameraId)}
                    onPick={() => setPicker({ slot: idx })}
                    onClear={() => {
                      setSlot(idx, null)
                      useMosaicStore.getState().setPaused(idx, false)
                      if (cameraId) useMosaicStore.getState().clearPlaybackOffset(cameraId)
                      // Se removeu enquanto expandido, sai do modo expandido também
                      if (useMosaicStore.getState().expandedSlot === idx) {
                        useMosaicStore.getState().setExpandedSlot(null)
                      }
                    }}
                    onDropSlot={(sourceIdx) => swapSlots(sourceIdx, idx)}
                    onDropLibrary={(sourceCameraId) => setSlot(idx, sourceCameraId)}
                  />
                )
              })}
            </div>
          </div>

          {/* Right-side library — paridade Monuv (oculta em mobile) */}
          {prefs.sidebarOpen && !isFs && !isMobile && (
            <CameraLibrarySidebar
              usedIds={active.slots.filter((x): x is string => !!x)}
              favs={favs}
              onToggleFav={toggleFav}
              onDragStart={(cameraId) => useMosaicStore.getState().setDragSource({ kind: 'library', cameraId })}
              onDragEnd={() => {
                useMosaicStore.getState().setDragSource(null);
                useMosaicStore.getState().setOverSlot(null);
              }}
              onQuickAdd={(cameraId) => {
                const empty = active.slots.findIndex(s => !s)
                if (empty >= 0) setSlot(empty, cameraId)
              }}
            />
          )}
        </div>

        {/* FAB mobile — abre picker para preencher próximo slot vazio */}
        {isMobile && !isFs && (
          <button
            onClick={() => {
              const empty = active.slots.findIndex(s => !s)
              if (empty >= 0) setPicker({ slot: empty })
            }}
            className="fixed bottom-6 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-full bg-cyan-600 text-white shadow-xl text-sm font-semibold active:scale-95 transition-transform"
          >
            <CameraIcon className="w-4 h-4" />
            <span>Câmera</span>
          </button>
        )}

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

        {/* Modal de atalhos de teclado (cheatsheet) */}
        <AnimatePresence>
          {showShortcuts && (
            <ShortcutsModal onClose={() => setShowShortcuts(false)} />
          )}
        </AnimatePresence>
      </div>
    )
  }

  // ── ShortcutsModal — cheatsheet de atalhos de teclado ───────────────────
  // Aberto pela tecla `?` ou pelo botão "?" na toolbar. Fechado por Esc,
  // click no backdrop, ou botão X. Lista organizada por categoria.
  function ShortcutsModal({ onClose }: { onClose: () => void }) {
    type Group = { title: string; items: { keys: string[]; desc: string }[] }
    const groups: Group[] = [
      {
        title: 'Navegação',
        items: [
          { keys: ['1'], desc: 'Focar slot 1 (idem 2..9)' },
          { keys: ['Shift', '←'], desc: 'Preset anterior' },
          { keys: ['Shift', '→'], desc: 'Próximo preset' },
          { keys: ['Esc'], desc: 'Sair de tela cheia / fechar modal' },
        ],
      },
      {
        title: 'Painéis',
        items: [
          { keys: ['S'], desc: 'Ocultar / mostrar menu lateral' },
          { keys: ['B'], desc: 'Ocultar / mostrar biblioteca de câmeras' },
          { keys: ['Ctrl', '\\'], desc: 'Ocultar / mostrar menu lateral' },
        ],
      },
      {
        title: 'Slot focado',
        items: [
          { keys: ['Espaço'], desc: 'Pausar / Continuar' },
          { keys: ['F'], desc: 'Expandir / colapsar tile (sem slot: tela cheia)' },
          { keys: ['Del'], desc: 'Remover câmera do slot' },
          { keys: ['Duplo-clique'], desc: 'Expandir / resetar zoom' },
        ],
      },
      {
        title: 'Mouse no vídeo',
        items: [
          { keys: ['Scroll'], desc: 'Zoom digital ancorado no cursor' },
          { keys: ['Drag'], desc: 'Mover tile (swap)' },
          { keys: ['Drag da Biblioteca'], desc: 'Preencher slot' },
        ],
      },
      {
        title: 'Ajuda',
        items: [
          { keys: ['?'], desc: 'Abrir/fechar este painel' },
        ],
      },
    ]
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.15 }}
          onClick={e => e.stopPropagation()}
          className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
            <div className="flex items-center gap-2 text-white font-bold">
              <Settings2 className="w-4 h-4 text-cyan-500" />
              Atalhos de teclado
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-white/10 text-slate-300"
              title="Fechar (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            {groups.map(g => (
              <div key={g.title}>
                <h4 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-2">
                  {g.title}
                </h4>
                <ul className="space-y-1.5">
                  {g.items.map((it, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 text-[12px]">
                      <div className="flex items-center gap-1 shrink-0">
                        {it.keys.map((k, j) => (
                          <span key={j}>
                            {j > 0 && <span className="text-slate-400 mx-0.5">+</span>}
                            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 border border-slate-300 dark:border-white/20 text-slate-700 dark:text-slate-200 font-mono text-[10px] font-bold shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                              {k}
                            </kbd>
                          </span>
                        ))}
                      </div>
                      <span className="text-slate-600 dark:text-slate-300 text-right">{it.desc}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="px-5 py-2 border-t border-white/10 text-[10px] text-slate-500 dark:text-slate-400">
            Dica: foque um tile clicando nele antes de usar Espaço, F ou Delete.
          </div>
        </motion.div>
      </motion.div>
    )
  }

  // ── Cell ────────────────────────────────────────────────────────────────

  interface CellProps {
    slotIndex: number
    cameraId: string | null
    dense: boolean
    isFavorite: boolean
    /** True quando este é o slot "focal" de um layout assimétrico (slot 0
     *  em spot1xN). Permite renderização especial (badge "FOCAL", controles
     *  full sem ficarem cramped). False em layouts simétricos. */
    isMain?: boolean
    /** gridArea CSS para layouts assimétricos (spot1xN). Quando setado,
     *  aplicado direto no root do MosaicCell — sem wrapper intermediário,
     *  pra não quebrar a propagação de altura do CSS Grid (rows=1fr). */
    gridArea?: string
    /** Quando setado, o mosaico inteiro está em playback histórico (override). */
    globalPlayback: string | null
    onToggleFav: () => void
    onPick: () => void
    onClear: () => void
    onDropSlot: (sourceIndex: number) => void
    onDropLibrary: (cameraId: string) => void
  }

  // ── PtzButton — botão direcional do D-Pad PTZ ─────────────────────────────
  // Componente puro pra reduzir ruído visual no JSX do MosaicCell. Lida com
  // mouse (press-and-hold) E touch (mobile/tablet), evita propagar eventos
  // pra evitar drag/select acidental no tile, e sinaliza ativação com cyan ring.
  interface PtzButtonProps {
    dir: 'up' | 'down' | 'left' | 'right'
    active: boolean
    dense: boolean
    onPress: () => void
    onRelease: () => void
  }
  function PtzButton({ dir, active, dense, onPress, onRelease }: PtzButtonProps) {
    const Icon = dir === 'up' ? ChevronUp
      : dir === 'down' ? ChevronDown
      : dir === 'left' ? ChevronLeft
      : ChevronRight
    const labels: Record<typeof dir, string> = {
      up: 'Inclinar para cima', down: 'Inclinar para baixo',
      left: 'Girar para esquerda', right: 'Girar para direita',
    }
    return (
      <button
        onMouseDown={(e) => { e.stopPropagation(); onPress() }}
        onMouseUp={(e) => { e.stopPropagation(); onRelease() }}
        onMouseLeave={onRelease}
        onTouchStart={(e) => { e.stopPropagation(); onPress() }}
        onTouchEnd={(e) => { e.stopPropagation(); onRelease() }}
        className={cn(
          'flex items-center justify-center rounded-md border transition',
          active
            ? 'bg-cyan-500/40 border-cyan-400/60 text-white shadow-lg shadow-cyan-500/30 scale-95'
            : 'bg-white/5 hover:bg-white/15 border-white/10 text-slate-200',
          dense ? 'w-6 h-6' : 'w-7 h-7',
        )}
        title={labels[dir]}
      >
        <Icon className={cn(dense ? 'w-3.5 h-3.5' : 'w-4 h-4', 'stroke-[2.5]')} />
      </button>
    )
  }

  const MosaicCell = React.memo(function MosaicCell({
    slotIndex, cameraId, dense,
    isFavorite, isMain = false, gridArea, globalPlayback,
    onToggleFav, onPick, onClear, onDropSlot, onDropLibrary,
  }: CellProps) {
    const { data } = useCameras()
    const camera = (data?.cameras ?? []).find((c: any) => c.id === cameraId)
    // Recording stats: só dispara quando faz sentido pro empty state inteligente.
    // - Status problemático: precisamos do lastSegmentAt pra dizer "há X tempo"
    // - Playback ativo: tile está revisando histórico, pode cair em SEM_GRAVACAO
    // Mosaico saudável em live não dispara — economiza 5s polling × N tiles.
    // 2026-05-12: CameraStatus enum = ACTIVE | INACTIVE | ERROR | MAINTENANCE | PENDING_CONFIG.
    const needsStats = !!cameraId && (
      camera?.status === 'ERROR' ||
      camera?.status === 'MAINTENANCE'
    )
    const [showPlaybackBar, setShowPlaybackBar] = useState(false)
    // Toggle do painel PTZ: quando true, o D-Pad aparece de forma persistente
    // (não depende de hover) e o usuário pode operar a câmera sem precisar
    // manter o mouse sobre o tile. Default off — só usuários com câmera PTZ
    // ativam, evita poluição visual em câmeras fixas.
    const [ptzPanelOpen, setPtzPanelOpen] = useState(false)
    const [ptzActive, setPtzActive] = useState<PtzCommand | null>(null)

    // Zustand State
    const isPaused = useMosaicStore(state => state.pausedSlots[slotIndex] ?? false)
    const isMuted = useMosaicStore(state => state.mutedSlots[slotIndex] ?? true)
    const playbackOffsetSec = useMosaicStore(state => cameraId ? (state.playbackOffsets[cameraId] ?? 0) : 0)

    // Fecha o painel PTZ automaticamente quando o slot entra em playback
    // (histórico) — PTZ exige stream ao vivo. Quando o usuário volta pra
    // live, o painel NÃO reabre sozinho (evita surpresa visual; ele pode
    // reabrir manualmente clicando no toggle).
    useEffect(() => {
      if (ptzPanelOpen && (showPlaybackBar || playbackOffsetSec < 0 || globalPlayback)) {
        setPtzPanelOpen(false)
      }
    }, [showPlaybackBar, playbackOffsetSec, globalPlayback, ptzPanelOpen])
    
    const isFocused = useMosaicStore(state => state.focusedSlot === slotIndex)
    const isExpanded = useMosaicStore(state => state.expandedSlot === slotIndex)
    const overSlot = useMosaicStore(state => state.overSlot)
    const dragSource = useMosaicStore(state => state.dragSource)
    const isWindowVisible = useMosaicStore(state => state.isWindowVisible)
    const isDragOver = overSlot === slotIndex && dragSource !== null && !(dragSource.kind === 'slot' && dragSource.slotIndex === slotIndex)

    const togglePause = useMosaicStore(state => state.togglePause)
    const toggleMute = useMosaicStore(state => state.toggleMute)
    const setPlaybackOffset = useMosaicStore(state => state.setPlaybackOffset)
    const setPaused = useMosaicStore(state => state.setPaused)
    const setFocusedSlot = useMosaicStore(state => state.setFocusedSlot)
    const setExpandedSlot = useMosaicStore(state => state.setExpandedSlot)
    const setDragSource = useMosaicStore(state => state.setDragSource)
    const setOverSlot = useMosaicStore(state => state.setOverSlot)

    function onTogglePause() { togglePause(slotIndex) }
    function onSetPlaybackOffset(sec: number) { if (cameraId) setPlaybackOffset(cameraId, sec) }
    function onRewind10() {
      if (!cameraId) return
      // Fix 2026-05-12: voltar 10s a partir do ponto VISUALIZADO (não da live).
      // Anchor reflete o ponto que o player está renderizando. Sem anchor
      // (live), volta 10s do "agora real". Recalcula o offset em segundos
      // relativos a now pra zustand entender uniformemente.
      const baselineMs = seekAnchor
        ? seekAnchor.at + seekAnchor.offsetSec * 1000
        : Date.now()
      const newTargetMs  = baselineMs - 10_000
      const newOffsetSec = Math.round((newTargetMs - Date.now()) / 1000)
      setPlaybackOffset(cameraId, newOffsetSec)
      // 2026-05-13: ao retornar 10s, abrir automaticamente a timeline pra
      // operador conseguir continuar navegando nas gravações sem precisar
      // achar o ícone de relógio. UX: rewind = "modo playback".
      setShowPlaybackBar(true)
    }
    function onGoLive() {
      if (cameraId) setPlaybackOffset(cameraId, 0)
      setPaused(slotIndex, false)
    }

    // Abre a timeline automaticamente ao pausar — o tile entra em modo scrubber
    // sem precisar clicar no ícone de relógio.
    useEffect(() => {
      if (isPaused) setShowPlaybackBar(true)
    }, [isPaused])

    // Per-tile timeline (CF — interativo dentro do tile, sem afetar outros).
    // Bitmap do dia ATUAL (UTC) — fetch só quando barra está aberta pra evitar
    // requests desnecessárias em mosaicos de 16+ tiles. SWR dedupe garante que
    // múltiplos tiles da mesma câmera (improvável) compartilham 1 request.
    const todayUtc = useMemo(() => todayLocalIso(), [])
    const { data: tileTimeline } = usePlaybackTimeline(
      showPlaybackBar && cameraId ? cameraId : null,
      showPlaybackBar && cameraId ? todayUtc : null,
    )
    // Sprite manifest pra preview no hover do scrubber per-tile.
    // 2026-05-12 fix: LivePage não passava spriteHours — UI mostrava só barrinhas
    // sem miniaturas. SWR dedupe entre tiles da mesma câmera evita reqs duplicadas.
    // Só busca quando a barra está visível pra não martelar /playback/:id/sprites
    // em mosaico 16+ tiles parado em live.
    const { data: tileSpriteManifest } = useSpriteManifest(
      showPlaybackBar && cameraId ? cameraId : null,
      showPlaybackBar && cameraId ? todayUtc : null,
    )

    // "Now" em segundos UTC do dia. Memoizamos por minuto pra evitar rerender
    // a cada segundo (timeline não precisa de precisão sub-minuto pra heatmap).
    const [nowTick, setNowTick] = useState(() => Date.now())
    // Fix 2026-05-12: nowTick deve atualizar SEMPRE que houver offset != 0 OU
    // a barra de playback estiver aberta. Antes só rodava com a barra aberta —
    // operador clicando "Rewind 10s" depois de ficar 30min na live pulava
    // para um ponto stale (10s antes do momento que abriu a página, não 10s
    // antes de AGORA).
    useEffect(() => {
      // Refresh imediato no efeito (no clique do botão, antes mesmo do tick).
      setNowTick(Date.now())
      const active = showPlaybackBar || playbackOffsetSec !== 0
      if (!active) return
      // Tick rápido (5s) quando offset ativo: precisão melhor pro seek inicial
      // e pro indicador de "−Xs atrás" no overlay refletir tempo real.
      const t = setInterval(() => setNowTick(Date.now()), 5_000)
      return () => clearInterval(t)
    }, [showPlaybackBar, playbackOffsetSec])
    const nowSec = useMemo(() => localSecOfDay(new Date(nowTick)), [nowTick])

    // Playhead local: âncora capturada no momento que offset mudou + offset.
    //
    // Bug fix 2026-05-12: antes era `nowSec + playbackOffsetSec` com nowSec
    // flutuante. A cada tick, tilePlayheadSec mudava e o useEffect abaixo
    // forçava seekTo, fazendo o vídeo NUNCA avançar — sempre re-seekando pra
    // "agora-10s". Agora: âncora estável capturada quando offset transiciona
    // 0→não-zero. tilePlayheadSec só muda quando o operador clica explicitamente
    // outro offset, ou via timeline. Entre cliques, o vídeo toca normalmente
    // (video.currentTime avança no HTMLVideoElement, sem re-seek).
    const [seekAnchor, setSeekAnchor] = useState<{ at: number; offsetSec: number } | null>(null)
    // 2026-05-12 fix: barra parada durante playback.
    // <PlaybackPlayer> dispara onTimeUpdate com secOfDay real do PDT a cada
    // `timeupdate` do <video>. Antes esse callback não estava ligado em LivePage —
    // a barra ficava parada no ponto do seek. Agora `livePlayheadSec` é
    // atualizado pelo player (HTMLVideoElement avança ~4Hz) e o tile usa esse
    // valor pra renderizar o cursor da timeline.
    const [livePlayheadSec, setLivePlayheadSec] = useState<number | null>(null)
    useEffect(() => {
      if (playbackOffsetSec === 0) {
        setSeekAnchor(null)
        setLivePlayheadSec(null)
        return
      }
      // Mudou offset → âncora nova + reseta livePlayheadSec até o player
      // re-publicar o PDT após o seek completar.
      setSeekAnchor(prev => {
        if (prev && prev.offsetSec === playbackOffsetSec) return prev
        setLivePlayheadSec(null)
        return { at: Date.now(), offsetSec: playbackOffsetSec }
      })
    }, [playbackOffsetSec])

    // 2026-05-12 — Throttle + arredonda secOfDay pra reduzir cascata de
    // re-renders. PlaybackPlayer dispara onTimeUpdate ~4Hz com float
    // (ex: 54123.456). Sem throttle, cada update propaga: tilePlayheadSec
    // muda → playbackTarget memo muda → playbackRange useEffect roda. Em
    // 30min vimos 52 tokens emitidos (vs ~2 esperados).
    // Estratégia: máximo 1 atualização/s, valor inteiro. Cursor da timeline
    // não precisa de precisão sub-segundo pra UX.
    const lastPlayheadUpdateRef = useRef(0)
    const onPlaybackTimeUpdate = useCallback((secOfDay: number) => {
      const now = Date.now()
      if (now - lastPlayheadUpdateRef.current < 1000) return
      lastPlayheadUpdateRef.current = now
      setLivePlayheadSec(Math.floor(secOfDay))
    }, [])

    // `emptyStateCtx` foi MOVIDO pra baixo (depois da declaração de `recStats`)
    // pra evitar TDZ em prod. Em dev o Vite tolerava, mas o tree-shake do
    // build minificado avalia `[recStats?.lastSegmentAt, ...]` antes da
    // declaração e crasha com `ReferenceError: Cannot access 'X' before initialization`.
    // Stack trace original: LivePage-CAboqSQJ.js:61:39970 → src 1696:25.

    const tilePlayheadSec = useMemo(() => {
      // Player publicou tempo real → barra acompanha vídeo
      if (livePlayheadSec != null) {
        return Math.max(0, Math.min(86399, livePlayheadSec))
      }
      if (!seekAnchor) {
        // Live: aproxima como now, mas é só usado pelo timeline overlay; live
        // não vai pro PlaybackPlayer.
        return Math.max(0, Math.min(86399, nowSec))
      }
      const targetMs = seekAnchor.at + seekAnchor.offsetSec * 1000
      return Math.max(0, Math.min(86399, localSecOfDay(new Date(targetMs))))
    }, [seekAnchor, livePlayheadSec, nowSec])

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
    // 2026-05-12 — playbackTarget DEVE ser estável durante reprodução.
    // Antes usava `tilePlayheadSec` (avança com o vídeo) → playbackTarget
    // mudava a cada timeupdate → useEffect de playbackRange rodava 4Hz →
    // ocasionalmente reanchora → novo manifest + novo ticket → 52 tokens em
    // 30min observados em produção.
    //
    // Agora: secOfDay vem do `seekAnchor` (fixo até o operador fazer novo
    // seek). Cursor da UI continua acompanhando vídeo via `tilePlayheadSec`
    // mas o RANGE DO MANIFEST não treme.
    const anchorSecOfDay = useMemo(() => {
      if (!seekAnchor) return null
      const targetMs = seekAnchor.at + seekAnchor.offsetSec * 1000
      return localSecOfDay(new Date(targetMs))
    }, [seekAnchor])

    const playbackTarget = useMemo(() => {
      if (globalPlayback) {
        const d = new Date(globalPlayback)
        const dayUtc = isoDate(d)
        const secOfDay = localSecOfDay(d)
        return { dayUtc, secOfDay, source: 'global' as const }
      }
      if (playbackOffsetSec < 0 && anchorSecOfDay != null) {
        return { dayUtc: todayUtc, secOfDay: anchorSecOfDay, source: 'tile' as const }
      }
      return null
    }, [globalPlayback, playbackOffsetSec, anchorSecOfDay, todayUtc])

    // Range do manifest HLS — janela estreita de ±90min em torno do alvo.
    // Por quê estreita: manifesto do dia inteiro = arquivo grande = lento pra
    // parsear. Janela de 2h cobre 99% dos casos de revisão no mosaico.
    // Por quê estável: só remonta (PlaybackPlayer) quando alvo sai ±60min da
    // âncora atual — scrub dentro da janela usa seekTo imperativo (sem flicker).
    const playbackAnchorMs = useRef<number | null>(null)
    const [playbackRange, setPlaybackRange] = useState<{ fromIso: string; toIso: string } | null>(null)

    useEffect(() => {
      if (!playbackTarget) {
        setPlaybackRange(null)
        playbackAnchorMs.current = null
        return
      }
      const dayStartMs = localDayStartMs(playbackTarget.dayUtc)
      const targetMs   = dayStartMs + playbackTarget.secOfDay * 1000
      const nowMs      = Date.now()

      // Reutiliza range se alvo ainda está dentro da janela atual (±60min)
      if (playbackAnchorMs.current !== null &&
          Math.abs(targetMs - playbackAnchorMs.current) < 60 * 60 * 1000) {
        return
      }
      // Nova âncora → janela ±90min (min: 00:00, max: agora)
      const fromMs = Math.max(dayStartMs, targetMs - 90 * 60 * 1000)
      const toMs   = Math.min(nowMs, targetMs + 30 * 60 * 1000)
      playbackAnchorMs.current = targetMs
      setPlaybackRange({
        fromIso: new Date(fromMs).toISOString(),
        toIso:   new Date(toMs).toISOString(),
      })
    }, [playbackTarget?.dayUtc, playbackTarget?.secOfDay])  // eslint-disable-line react-hooks/exhaustive-deps

    // Seek imperativo: só para mudanças SUBSEQUENTES dentro do mesmo manifest
    // (quando playbackRange não muda — alvo dentro da janela ±60min).
    // O seek INICIAL é feito pelo PlaybackPlayer via prop `initialSeekSec`
    // diretamente no MANIFEST_PARSED (antes era aqui e disparava antes do
    // manifest carregar, causando posição errada).
    const prevSeekKey = useRef<string | null>(null)
    useEffect(() => {
      if (!playbackTarget) {
        // Voltou ao vivo — reseta pra próxima entrada no playback
        prevSeekKey.current = null
        return
      }
      if (!playbackRef.current) return
      const key = `${playbackTarget.dayUtc}:${playbackTarget.secOfDay}`
      // Não seekar no primeiro render do target: PlaybackPlayer monta com
      // initialSeekSec e já aplica o seek dentro do MANIFEST_PARSED.
      if (prevSeekKey.current === null) { prevSeekKey.current = key; return }
      if (prevSeekKey.current === key) return
      prevSeekKey.current = key
      playbackRef.current.seekTo(playbackTarget.secOfDay)
    }, [playbackTarget?.secOfDay, playbackTarget?.dayUtc])

    // ── PTZ Handlers ─────────────────────────────────────────────────────────
    const isGlobalPlayback = !!globalPlayback
    const isPlayback = isGlobalPlayback || playbackOffsetSec < 0

    // Recording stats — usado pelo empty state inteligente do PlaybackPlayer.
    // Habilita quando: status problemático OU tile em playback (range pode estar vazio).
    // Refresh 30s pra não martelar /recordings/stats em mosaico denso.
    const wantsStats = needsStats || isPlayback
    const { data: recStats } = useRecordingStats(wantsStats ? cameraId : null, '24h')

    // Memoiza emptyStateContext (fix TDZ — declarado APÓS recStats).
    // Move-up de cima pra cá em 2026-05-12 pra resolver ReferenceError em prod.
    const emptyStateCtx = useMemo(() => ({
      cameraStatus:   camera?.status,
      lastSegmentAt:  recStats?.lastSegmentAt ?? null,
      recordingState: recStats?.recordingState,
    }), [camera?.status, recStats?.lastSegmentAt, recStats?.recordingState])

    const handlePtz = useCallback((cmd: PtzCommand) => {
      if (!cameraId || isPlayback) return
      setPtzActive(cmd)
      sendPtzCommand(cameraId, cmd).catch(err => console.error('[PTZ]', err))
    }, [cameraId, isPlayback])
    
    const handlePtzStop = useCallback(() => {
      if (!cameraId || isPlayback || !ptzActive) return
      setPtzActive(null)
      sendPtzCommand(cameraId, 'stop').catch(err => console.error('[PTZ]', err))
    }, [cameraId, isPlayback, ptzActive])

    // ── Zoom digital com scroll do mouse ─────────────────────────────────────
    // Scale 1x–8x ancorado na posição do cursor (transform-origin dinâmico).
    // Double-click no vídeo reseta o zoom. Não interfere com o wheel da
    // timeline (que tem e.stopPropagation() próprio).
    const [zoom, setZoom]       = useState(1)
    const [origin, setOrigin]   = useState({ x: 50, y: 50 }) // % relativo ao container
    const videoWrapRef = useRef<HTMLDivElement>(null)
    // Feedback visual ao capturar snapshot — flash branco efêmero no tile.
    const [snapFlash, setSnapFlash] = useState(false)

    // ── Captura snapshot do frame atual e dispara download ──────────────────
    // Funciona com WHEP (video element) E fallback snapshot (img element).
    // Usa canvas pra desenhar o frame e converter pra blob. Para video,
    // o crossOrigin precisa ser respeitado pelo backend (CORS allow-origin
    // do snapshot-jpeg já está ok). Para img, o crossOrigin do <img> deve
    // estar setado — vamos confiar que o backend serve com CORS adequado.
    //
    // O download usa o nome da câmera + timestamp ISO compacto:
    //   camera-portaria_2026-05-12T15-23-45.jpg
    const captureSnapshot = useCallback(() => {
      const wrap = videoWrapRef.current
      if (!wrap || !cameraId) return
      const videoEl = wrap.querySelector('video') as HTMLVideoElement | null
      const imgEl   = wrap.querySelector('img')   as HTMLImageElement | null

      let width = 0, height = 0
      const canvas = document.createElement('canvas')

      if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        width = videoEl.videoWidth
        height = videoEl.videoHeight
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        try { ctx.drawImage(videoEl, 0, 0, width, height) } catch { return }
      } else if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
        width = imgEl.naturalWidth
        height = imgEl.naturalHeight
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        try { ctx.drawImage(imgEl, 0, 0, width, height) } catch { return }
      } else {
        return // sem frame disponível
      }

      // Burn-in de marca d'água: timestamp + display code da câmera. Útil
      // pra evidência operacional (não substitui hash criptográfico do clip,
      // mas dá rastreabilidade humana imediata).
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
        const code  = `#${displayCodeFor({ id: cameraId })}`
        const text  = `${code} • ${stamp}`
        const pad   = Math.max(8, Math.round(width * 0.005))
        const fontSize = Math.max(12, Math.round(width * 0.014))
        ctx.font = `bold ${fontSize}px monospace`
        ctx.textBaseline = 'bottom'
        const metrics = ctx.measureText(text)
        const boxW = metrics.width + pad * 2
        const boxH = fontSize + pad
        // Fundo escuro com opacidade pra legibilidade em qualquer cena
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(pad, height - boxH - pad, boxW, boxH)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(text, pad * 2, height - pad - pad / 2)
      }

      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const camName = (cameraId || 'camera').replace(/[^a-z0-9-]/gi, '_')
        const tsCompact = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        a.href = url
        a.download = `snapshot_${camName.slice(0, 8)}_${tsCompact}.jpg`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, 'image/jpeg', 0.92)

      // Flash visual de 200ms
      setSnapFlash(true)
      setTimeout(() => setSnapFlash(false), 200)
    }, [cameraId])
    // Tap duplo em mobile para expandir/fechar tile
    const lastTapRef = useRef<number>(0)
    function handleTouchEnd() {
      const now = Date.now()
      if (now - lastTapRef.current < 300) {
        setExpandedSlot(isExpanded ? null : slotIndex)
        setFocusedSlot(slotIndex)
      }
      lastTapRef.current = now
    }

    function handleVideoWheel(e: React.WheelEvent) {
      // Só intercepta quando há zoom ativo OU quando o scroll é sobre o vídeo
      // e não há timeline aberta (timeline tem seu próprio onWheel com stopPropagation).
      e.preventDefault()
      e.stopPropagation()

      const rect = videoWrapRef.current?.getBoundingClientRect()
      if (rect) {
        setOrigin({
          x: ((e.clientX - rect.left) / rect.width)  * 100,
          y: ((e.clientY - rect.top)  / rect.height) * 100,
        })
      }

      setZoom(z => {
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15
        return Math.min(8, Math.max(1, z * delta))
      })
    }

    function resetZoom() { setZoom(1); setOrigin({ x: 50, y: 50 }) }

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setOverSlot(slotIndex) }
    const handleDrop     = (e: React.DragEvent) => { 
      e.preventDefault(); 
      if (dragSource?.kind === 'slot') onDropSlot(dragSource.slotIndex)
      else if (dragSource?.kind === 'library') onDropLibrary(dragSource.cameraId)
      setDragSource(null); setOverSlot(null)
    }

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

    const offsetLabel = isGlobalPlayback
      ? new Date(globalPlayback!).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
      : (PLAYBACK_OFFSETS.find(o => o.sec === playbackOffsetSec)?.label
          ?? (playbackOffsetSec < -60
              ? `−${Math.floor(-playbackOffsetSec / 60)}min`
              : `−${-playbackOffsetSec}s`))

    // Status do indicador (top-center): AO VIVO / PAUSADO / HISTÓRICO / OFFLINE.
    // 2026-05-12: badge "Ao Vivo" só pinta verde quando câmera está ACTIVE.
    // Em ERROR/MAINTENANCE/INACTIVE mostra badge vermelho — operador identifica
    // imediatamente que o tile não está em live mesmo que o último frame ainda
    // apareça no player (snapshot cache / mjpeg stale).
    // CameraStatus enum (Prisma) = ACTIVE | INACTIVE | ERROR | MAINTENANCE | PENDING_CONFIG.
    const camStatus: string | undefined = camera?.status
    const isCameraDown =
      camStatus && camStatus !== 'ACTIVE' && camStatus !== 'PENDING_CONFIG'
    const liveState: 'live' | 'paused' | 'history' | 'offline' =
      isPlayback ? 'history'
      : isPaused ? 'paused'
      : isCameraDown ? 'offline'
      : 'live'

    // Snapshot Throttling:
    // Força MJPEG (1 fps) se a janela estiver fora de foco OU a grade for >= 16 (dense) e a célula não estiver expandida.
    const idealMode = (!isWindowVisible || (dense && !isExpanded)) ? 'mjpeg' : 'auto'

    return (
      <div
        // draggable e arrastar não fazem sentido enquanto o tile está
        // expandido em tela cheia (overlay) — desabilita pra evitar UX
        // confusa de "estou arrastando um overlay".
        draggable={!isExpanded}
        tabIndex={0}
        onFocus={() => setFocusedSlot(slotIndex)}
        onBlur={() => setFocusedSlot(null)}
        onClick={() => setFocusedSlot(slotIndex)}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragSource({ kind: 'slot', slotIndex }) }}
        onDragEnd={() => { setDragSource(null); setOverSlot(null) }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={gridArea ? { gridArea } : undefined}
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
        {/* Wrapper de zoom — scroll amplia ancorado no cursor; duplo-clique reseta.
            overflow:hidden no tile pai já garante que a imagem não vaze pra fora. */}
        <div
          ref={videoWrapRef}
          onWheel={handleVideoWheel}
          onDoubleClick={(e) => {
            if (zoom > 1) { e.stopPropagation(); resetZoom(); return }
            setExpandedSlot(isExpanded ? null : slotIndex)
            setFocusedSlot(slotIndex)
          }}
          onTouchEnd={handleTouchEnd}
          className="w-full h-full"
          style={{
            overflow: 'hidden',
            cursor: zoom > 1 ? 'zoom-out' : undefined,
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: zoom > 1 ? `scale(${zoom})` : undefined,
              transformOrigin: zoom > 1 ? `${origin.x}% ${origin.y}%` : undefined,
              transition: 'transform 0.1s ease-out',
              willChange: zoom > 1 ? 'transform' : undefined,
            }}
          >
            {/* Player: live (WebRTC) ou playback HLS */}
            {playbackTarget && playbackRange ? (
              <PlaybackPlayer
                ref={playbackRef}
                cameraId={cameraId}
                fromIso={playbackRange.fromIso}
                toIso={playbackRange.toIso}
                dayUtcDate={playbackTarget.dayUtc}
                initialSeekSec={playbackTarget.secOfDay}
                minimal
                autoPlay
                paused={isPaused}
                className="w-full h-full"
                onTimeUpdate={onPlaybackTimeUpdate}
                emptyStateContext={emptyStateCtx}
              />
            ) : (
              <LivePlayer
                cameraId={cameraId}
                mode={idealMode}
                muted={isMuted}
                paused={isPaused}
                showOverlay={false}
                cameraName={camera?.name}
                // Override per-câmera (campo opcional `fitOverride` no schema):
                //   • Não existe ainda → fallback 'auto' (motor padrão; 95% dos casos).
                //   • Quando o backend adicionar (ex: PUT /cameras/:id { fitOverride: 'contain' })
                //     pra câmeras retrato/fisheye/4:3 críticas, basta esse fallback resolver
                //     sem mudança de código. Tipo cast pra suportar schema ainda não atualizado.
                fit={(camera as any)?.fitOverride ?? 'auto'}
                className="w-full h-full pointer-events-none"
              />
            )}
          </div>
        </div>

        {/* Badge de zoom ativo — canto inferior direito, some ao resetar */}
        {zoom > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); resetZoom() }}
            className="absolute bottom-8 right-1 z-20 px-1.5 py-0.5 rounded bg-black/70 border border-white/20 text-white text-[9px] font-mono hover:bg-black/90"
            title="Resetar zoom (duplo-clique)"
          >
            {zoom.toFixed(1)}×
          </button>
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

        {/* Badge "FOCAL" — só aparece no slot principal de layouts spotlight.
            Sinaliza ao operador que esta é a câmera em foco do preset assimétrico.
            Posiciona logo abaixo do nome pra não competir com o badge de status. */}
        {isMain && cameraId && (
          <div className="absolute top-1 right-1 z-10 pointer-events-none">
            <div className="px-1.5 py-0.5 rounded bg-cyan-500/90 text-white text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 shadow">
              <Star className="w-2.5 h-2.5 fill-current" />
              Focal
            </div>
          </div>
        )}

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
          {liveState === 'offline' && (
            <div
              className={cn(
                'px-1.5 py-0.5 rounded text-white text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 shadow',
                camStatus === 'ERROR' ? 'bg-rose-600/90' :
                camStatus === 'MAINTENANCE' ? 'bg-amber-600/90' :
                'bg-slate-600/90',
              )}
              title={camStatus === 'ERROR'
                ? 'Câmera em estado de erro — verifique conectividade'
                : camStatus === 'MAINTENANCE'
                  ? 'Câmera em manutenção'
                  : camStatus === 'INACTIVE'
                    ? 'Câmera desativada'
                    : 'Câmera fora do ar'}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
              {camStatus === 'ERROR' ? 'Erro'
                : camStatus === 'MAINTENANCE' ? 'Manut.'
                : camStatus === 'INACTIVE' ? 'Inativa'
                : 'Offline'}
            </div>
          )}
        </div>

        {/* Slot # badge (bottom-left, info técnica) */}
        <div className={cn(
          'absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/60 backdrop-blur font-mono text-slate-600 dark:text-slate-300 flex items-center gap-1 z-10',
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
          {/* Toggle Áudio */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleMute(slotIndex) }}
            className={cn(
              'p-1 rounded-md border',
              !isMuted
                ? 'bg-cyan-500/30 text-cyan-100 border-cyan-400/50 hover:bg-cyan-500/40'
                : 'bg-black/60 hover:bg-black/80 text-white border-white/10',
            )}
            title={isMuted ? 'Ativar som' : 'Desativar som'}
          >
            {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
          </button>
          {/* Snapshot — captura o frame atual e baixa como JPG com marca d'água
              (timestamp + display code da câmera). Funciona em live e playback. */}
          {cameraId && (
            <button
              onClick={(e) => { e.stopPropagation(); captureSnapshot() }}
              className="p-1 rounded-md bg-black/60 hover:bg-black/80 text-white border border-white/10"
              title="Capturar snapshot (baixa JPG com timestamp)"
            >
              <CameraIcon className="w-3 h-3" />
            </button>
          )}
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
              onClick={(e) => { e.stopPropagation(); onGoLive(); setShowPlaybackBar(false) }}
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
          {/* Toggle PTZ — quando ON, o painel D-Pad fica visível sem precisar
              de hover. Indicador cyan quando ativo. Não aparece em playback
              (PTZ requer stream ao vivo). */}
          {!isPlayback && (
            <button
              onClick={(e) => { e.stopPropagation(); setPtzPanelOpen(v => !v) }}
              className={cn(
                'p-1 rounded-md border transition',
                ptzPanelOpen
                  ? 'bg-cyan-500/30 text-cyan-100 border-cyan-400/50 hover:bg-cyan-500/40'
                  : 'bg-black/60 hover:bg-black/80 text-white border-white/10',
              )}
              title={ptzPanelOpen ? 'Fechar controle PTZ' : 'Abrir controle PTZ (pan/tilt/zoom)'}
            >
              <Gamepad2 className="w-3 h-3" />
            </button>
          )}
          <Link
            to={`/review?cameraId=${cameraId}`}
            onClick={(e) => e.stopPropagation()}
            className="p-1 rounded-md bg-black/60 hover:bg-black/80 text-white border border-white/10"
            title="Ver eventos da câmera"
          >
            <Bell className="w-3 h-3" />
          </Link>
          {/* Expandir / colapsar tile */}
          <button
            onClick={(e) => { 
              e.stopPropagation(); 
              setExpandedSlot(isExpanded ? null : slotIndex); 
              setFocusedSlot(slotIndex); 
            }}
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
          <div className="absolute bottom-3 right-3 z-20 px-2 py-1 rounded-md bg-black/70 backdrop-blur border border-white/15 text-[10px] text-slate-600 dark:text-slate-300 font-medium pointer-events-none animate-pulse">
            Esc · F · duplo-clique para sair
          </div>
        )}

        {/* Snapshot flash — overlay branco rápido (200ms) ao capturar.
            Feedback visual de "foto tirada" estilo câmera fotográfica.
            Transition de 200ms; setSnapFlash(false) dispara o fade-out. */}
        <div
          className={cn(
            'absolute inset-0 z-30 bg-white pointer-events-none transition-opacity duration-200',
            snapFlash ? 'opacity-70' : 'opacity-0',
          )}
        />

        {/* PTZ Panel — controle Pan/Tilt/Zoom da câmera.
            Visível quando ptzPanelOpen=true (toggle explícito pelo operador).
            Não aparece em playback (PTZ exige stream ao vivo).
            Posicionado bottom-right do tile, fora da área central da imagem.
            Touch targets ≥ 28×28px (acessibilidade) e organização em D-Pad
            cruciforme + STOP central + zoom inferior. */}
        <AnimatePresence>
          {ptzPanelOpen && !isPlayback && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'absolute z-20 select-none',
                // Em tile dense (≥16 cells), encolhe e fica menos intrusivo.
                // Em layouts spotlight (main), tem espaço de sobra.
                'bottom-3 right-3',
                'bg-space-900/90 backdrop-blur-md rounded-xl border border-cyan-500/30 shadow-2xl shadow-cyan-500/10',
                dense ? 'p-1.5' : 'p-2',
              )}
            >
              {/* Header — título + close. Marca o painel como "modal flutuante"
                  e dá ao usuário um caminho claro pra fechar (Esc não é óbvio). */}
              <div className="flex items-center justify-between mb-1.5 px-0.5">
                <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                  <Gamepad2 className="w-3 h-3" />
                  PTZ
                  {ptzActive && (
                    <span className="ml-1 px-1 py-px rounded bg-cyan-500/30 text-cyan-100 text-[8px]">
                      {ptzActive}
                    </span>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setPtzPanelOpen(false) }}
                  className="p-0.5 rounded hover:bg-slate-100 dark:bg-white/10 text-slate-400 hover:text-white transition"
                  title="Fechar PTZ"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              {/* D-Pad cruciforme — grid 3x3 com STOP no centro.
                  Layout:
                    .  ↑  .
                    ←  ⏹  →
                    .  ↓  .
                  Botões 28×28 (não-dense) ou 24×24 (dense). Cyan ring quando
                  pressionado. mouseDown/mouseUp para press-and-hold padrão PTZ. */}
              <div className={cn(
                'grid grid-cols-3 gap-0.5',
                dense ? 'w-[78px]' : 'w-[90px]',
              )}>
                <div />
                <PtzButton
                  dir="up"
                  active={ptzActive === 'up'}
                  dense={dense}
                  onPress={() => handlePtz('up')}
                  onRelease={handlePtzStop}
                />
                <div />
                <PtzButton
                  dir="left"
                  active={ptzActive === 'left'}
                  dense={dense}
                  onPress={() => handlePtz('left')}
                  onRelease={handlePtzStop}
                />
                {/* STOP central — para qualquer movimento em curso. Útil quando
                    o operador soltou o botão mas o ack do servidor demorou. */}
                <button
                  onClick={(e) => { e.stopPropagation(); handlePtzStop() }}
                  className={cn(
                    'flex items-center justify-center rounded-md border transition',
                    'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/25 hover:text-rose-100',
                    dense ? 'w-6 h-6' : 'w-7 h-7',
                  )}
                  title="Parar movimento (stop)"
                >
                  <Square className={cn('fill-current', dense ? 'w-2.5 h-2.5' : 'w-3 h-3')} />
                </button>
                <PtzButton
                  dir="right"
                  active={ptzActive === 'right'}
                  dense={dense}
                  onPress={() => handlePtz('right')}
                  onRelease={handlePtzStop}
                />
                <div />
                <PtzButton
                  dir="down"
                  active={ptzActive === 'down'}
                  dense={dense}
                  onPress={() => handlePtz('down')}
                  onRelease={handlePtzStop}
                />
                <div />
              </div>

              {/* Zoom controls — separados visualmente do pan/tilt por divisor. */}
              <div className="mt-1.5 pt-1.5 border-t border-white/10 flex gap-1">
                <button
                  onMouseDown={(e) => { e.stopPropagation(); handlePtz('zoomOut') }}
                  onMouseUp={handlePtzStop}
                  onMouseLeave={handlePtzStop}
                  onTouchStart={(e) => { e.stopPropagation(); handlePtz('zoomOut') }}
                  onTouchEnd={handlePtzStop}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 rounded-md border transition font-bold',
                    ptzActive === 'zoomOut'
                      ? 'bg-cyan-500/40 border-cyan-400/60 text-white'
                      : 'bg-white/5 hover:bg-white/15 border-white/10 text-slate-200',
                    dense ? 'h-6 text-[9px]' : 'h-7 text-[10px]',
                  )}
                  title="Afastar zoom (mantenha pressionado)"
                >
                  <ZoomOut className={dense ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                </button>
                <button
                  onMouseDown={(e) => { e.stopPropagation(); handlePtz('zoomIn') }}
                  onMouseUp={handlePtzStop}
                  onMouseLeave={handlePtzStop}
                  onTouchStart={(e) => { e.stopPropagation(); handlePtz('zoomIn') }}
                  onTouchEnd={handlePtzStop}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 rounded-md border transition font-bold',
                    ptzActive === 'zoomIn'
                      ? 'bg-cyan-500/40 border-cyan-400/60 text-white'
                      : 'bg-white/5 hover:bg-white/15 border-white/10 text-slate-200',
                    dense ? 'h-6 text-[9px]' : 'h-7 text-[10px]',
                  )}
                  title="Aproximar zoom (mantenha pressionado)"
                >
                  <ZoomIn className={dense ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
              {/* Timeline interativa per-tile com TODOS os layers de informação
                  (gaps, motion, events, bookmarks) — igual ao /recordings.
                  Menor que /recordings (compact 56px) mas com altura suficiente
                  pra label de data + heatmap legível. */}
              <div className="px-1.5 pt-1.5">
                <PlaybackTimelineZoom
                  bitmap={tileTimeline?.bitmap}
                  motionBitmap={tileTimeline?.motionBitmap}
                  intensity={tileTimeline?.intensity}
                  events={tileTimeline?.events}
                  bookmarks={tileTimeline?.bookmarks}
                  gaps={tileTimeline?.gaps}
                  spriteHours={tileSpriteManifest?.hours}
                  currentSecOfDay={tilePlayheadSec}
                  dayUtcDate={todayUtc}
                  onSeek={handleTileSeek}
                  trackHeight={dense ? 28 : 40}
                  compact
                />
              </div>

              {/* Controles — mesma ordem e estilo do /recordings */}
              <div className="px-2 py-1.5 flex items-center gap-1.5">
                {/* ⏮ Retroceder 30s */}
                <button
                  onClick={() => onSetPlaybackOffset(playbackOffsetSec - 30)}
                  className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white"
                  title="Retroceder 30s"
                >
                  <SkipBack className="w-3 h-3" />
                </button>

                {/* Presets de offset — dropdown compacto */}
                <select
                  value={PLAYBACK_OFFSETS.some(o => o.sec === playbackOffsetSec) ? playbackOffsetSec : ''}
                  onChange={(e) => onSetPlaybackOffset(Number(e.target.value))}
                  className="bg-white/10 text-[10px] font-semibold text-amber-200 px-1.5 py-1 rounded-md border border-amber-500/30 focus:outline-none"
                >
                  {!PLAYBACK_OFFSETS.some(o => o.sec === playbackOffsetSec) && (
                    <option value="" className="bg-slate-900 text-white">
                      {playbackOffsetSec === 0
                        ? 'AO VIVO'
                        : `−${Math.floor(-playbackOffsetSec / 60)}m ${(-playbackOffsetSec) % 60}s`}
                    </option>
                  )}
                  {PLAYBACK_OFFSETS.map(o => (
                    <option key={o.sec} value={o.sec} className="bg-slate-900 text-white">{o.label}</option>
                  ))}
                </select>

                {/* ⏭ Avançar 30s */}
                <button
                  onClick={() => onSetPlaybackOffset(Math.min(0, playbackOffsetSec + 30))}
                  className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white"
                  title="Avançar 30s"
                >
                  <SkipForward className="w-3 h-3" />
                </button>

                {/* Horário atual do playhead (BRT) */}
                {tilePlayheadSec != null && (
                  <span className="font-mono text-[10px] text-slate-300 tabular-nums ml-1">
                    {(() => {
                      let s = tilePlayheadSec - 3 * 3600
                      s = ((s % 86400) + 86400) % 86400
                      const pad = (n: number) => String(n).padStart(2, '0')
                      return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))}`
                    })()}
                  </span>
                )}

                <div className="flex-1" />

                {/* Snapshot */}
                {cameraId && (
                  <button
                    onClick={(e) => { e.stopPropagation(); captureSnapshot() }}
                    className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white"
                    title="Snapshot (baixa JPG)"
                  >
                    <CameraIcon className="w-3 h-3" />
                  </button>
                )}

                {/* AO VIVO */}
                {isPlayback && (
                  <button
                    onClick={() => { onGoLive(); setShowPlaybackBar(false) }}
                    className="px-2 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-1"
                    title="Voltar ao tempo real"
                  >
                    <Play className="w-2.5 h-2.5 fill-current" /> AO VIVO
                  </button>
                )}

                {/* Fechar */}
                <button
                  onClick={() => setShowPlaybackBar(false)}
                  className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white"
                  title="Fechar timeline"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  })

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
          className="w-full max-w-3xl max-h-[85vh] bg-slate-900 border border-white/10 rounded-xl overflow-hidden flex flex-col shadow-2xl shadow-cyan-500/10"
        >
          {/* Header */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <CameraIcon className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
                Selecionar câmera · Slot #{currentSlot + 1}
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {filtered.length} de {cameras.length} câmeras
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-white/10 text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Filters */}
          <div className="p-3 border-b border-white/10 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar por nome, site ou localização..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-md text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
              />
            </div>

            {sites.length > 0 && (
              <select
                value={siteFilter}
                onChange={e => setSiteFilter(e.target.value)}
                className="px-2 py-1.5 text-xs bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-cyan-500/50"
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
                className="px-2 py-1.5 text-xs bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-cyan-500/50"
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
                  : 'bg-white/5 text-slate-200 border-white/10 hover:text-white',
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
                            : 'bg-slate-50 dark:bg-white/[0.03] border-white/10 hover:bg-cyan-100 dark:hover:bg-cyan-500/10 hover:border-cyan-200 dark:hover:border-cyan-500/40',
                      )}
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-md flex items-center justify-center shrink-0',
                        c.status === 'ACTIVE' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' :
                        c.status === 'ERROR' ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400' :
                        'bg-slate-100 dark:bg-slate-500/20 text-slate-300',
                      )}>
                        <CameraIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-mono text-slate-500 shrink-0">#{displayCodeFor(c)}</span>
                          <p className="text-xs font-semibold text-white truncate">{c.name}</p>
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
          : { icon: Building2, label: 'Escopo',     cls: 'bg-slate-100 dark:bg-slate-500/15 text-slate-200 border-slate-200 dark:border-slate-500/30' }
    const ScopeIcon = scopeBadge.icon

    return (
      <aside className="w-72 shrink-0 rounded-xl bg-slate-900 border border-white/[0.14] flex flex-col max-h-[calc(100vh-180px)] overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <CameraIcon className="w-4 h-4 text-sky-700 dark:text-brand-skyLight" />
            <h3 className="text-xs font-bold text-white">Biblioteca de câmeras</h3>
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
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-md text-white placeholder-slate-500 focus:outline-none focus:border-sky-300 dark:focus:border-brand-sky/40"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="px-3 py-2 border-b border-white/10 flex flex-col gap-2">
          {/* Filtro de cliente (apenas para INTEGRADOR / SUPER_ADMIN) */}
          {isIntegrador && clientes.length > 1 && (
            <select
              value={clientFilter}
              onChange={e => setClient(e.target.value)}
              className="w-full px-2 py-1 text-[11px] bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-sky-300 dark:focus:border-brand-sky/40"
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
                className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-sky-300 dark:focus:border-brand-sky/40"
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
                  : 'bg-white/5 text-slate-200 border-white/10 hover:text-white',
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
                    ? 'bg-white/[0.02] border-white/[0.06] opacity-40 cursor-not-allowed'
                    : inUse
                      ? 'bg-violet-500/15 border-violet-400/40 cursor-grab active:cursor-grabbing hover:bg-violet-500/20'
                      : 'bg-white/[0.06] border-white/[0.12] cursor-grab active:cursor-grabbing hover:bg-sky-500/10 hover:border-sky-400/30',
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
                  c.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' :
                  c.status === 'ERROR'  ? 'bg-rose-500/20 text-rose-400' :
                                          'bg-slate-600/40 text-slate-400',
                )}>
                  <CameraIcon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-mono text-slate-500 shrink-0">#{code}</span>
                    <p className="text-xs font-semibold text-white truncate">{c.name}</p>
                    {fav && <Star className="w-2.5 h-2.5 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400 shrink-0" />}
                    {inUse && (
                      <span className="px-1.5 py-0.5 text-[8px] rounded-md bg-cyan-500/25 border border-cyan-400/40 text-cyan-200 font-bold tracking-wide">
                        EM USO
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">
                    {c.clienteFinal?.name ? `${c.clienteFinal.name} · ` : ''}
                    {c.site?.name ?? '—'}
                    {c.location ? ` · ${c.location}` : ''}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleFav(c.id) }}
                  className={cn(
                    'opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-white/10',
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
        <div className="px-3 py-2 border-t border-white/10 text-[9px] text-slate-500 dark:text-slate-600 leading-tight">
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
    const todayIso = todayLocalIso()
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
              : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10 hover:text-white',
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
              className="absolute right-0 top-full mt-1 w-64 bg-slate-900 border border-white/10 rounded-lg shadow-xl z-40 p-3 space-y-2.5"
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
                  className="w-full px-2 py-1.5 text-xs bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-amber-500/50"
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
                  className="w-full px-2 py-1.5 text-xs bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-amber-500/50"
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
                      setDraftDate(isoDate(dt))
                      setDraftTime(dt.toTimeString().slice(0, 5))
                    }}
                    className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-slate-200 border border-white/10"
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => { onChange(null); setOpen(false) }}
                  className="flex-1 px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 text-[11px] text-slate-200 border border-white/10 flex items-center justify-center gap-1"
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
      offline: { label: 'só local',  cls: 'bg-slate-700/60 border-slate-500/40 text-slate-300',  icon: CloudOff  },
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
