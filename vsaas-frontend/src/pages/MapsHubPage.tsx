/**
 * MapsHubPage — Hub unificado dos dois tipos de mapa.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  📍 Mapas                                       [🔒 Travado] │
 *   │  Visão geográfica e plantas internas                         │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  [🌍 Geográfico]  [📐 Sinótico]                             │
 *   │  ───────────────                                             │
 *   │                                                              │
 *   │   • Tab Geográfico: Leaflet + clusters + drag de sites       │
 *   │   • Tab Sinótico:  plantas indoor (reusa SynopticMapPage)    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Princípios de UX:
 *   1. Mapa default LOCKED — pin não move por engano. Toggle visível
 *      "Editar posições" desbloqueia. Cor de fundo muda pra cue visual.
 *   2. Mover pin não persiste sozinho — abre balão "Salvar?" sobre o pin.
 *      Cancelar volta pra posição original. Salvar faz PATCH.
 *   3. Click em mapa vazio (modo edit) abre modal "Criar site aqui" com
 *      reverse-geocoding pré-preenchido.
 *   4. Sites sem geoloc viram cards arrastáveis na sidebar — drag pro
 *      mapa cria coordenadas iniciais.
 *   5. CLIENTE_*: leitura apenas no mapa geográfico (backend impede
 *      criar/editar Site nessa role); permissão total no sinótico.
 */
import { lazy, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { MapContainer, TileLayer, useMap, useMapEvents, Marker, Tooltip, Polyline, CircleMarker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import {
  Map as MapIcon, Layout, Lock, Unlock, Plus, X, Search, MapPin,
  Camera as CameraIcon, ExternalLink, Compass, Save, Trash2, Move,
  Building2, AlertCircle, Loader2, Check, Sparkles, Eye, Filter,
  ChevronRight, Layers, Maximize2, Globe, Wand2, Satellite,
  Ruler, Flame, MousePointer2, RotateCcw, History, ArrowRight,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useSites, useCameras, useClientesFinais, useSitesGeo, snapshotCamera,
  createSite, updateSite, updateCamera, useReviewItems, useSiteHistory,
  BASE_URL, formatApiError,
  type SiteRow, type ClienteFinalRow, type SiteHistoryEntry,
} from '../api/client'
import { cn } from '../lib/utils'

// Carregamento sob demanda do mapa sinótico (preserva bundle inicial leve).
const SynopticMapPage = lazy(() =>
  import('./SynopticMapPage').then(m => ({ default: m.SynopticMapPage })),
)

// ── Constantes visuais ─────────────────────────────────────────────────────

const TAB_ITEMS = [
  { id: 'geo'      as const, label: 'Geográfico', icon: Globe,  emoji: '🌍', sublabel: 'Mapa do mundo · clusters · sites' },
  { id: 'synoptic' as const, label: 'Sinótico',   icon: Layout, emoji: '📐', sublabel: 'Plantas indoor · drag-and-drop'   },
]

// ── Tile providers ────────────────────────────────────────────────────────
// Cada modo é um conjunto de camadas overlaid. CartoDB Dark é o "estilizado"
// alinhado ao tema; Esri World Imagery dá foto-aérea de alta resolução
// (gratuito, atribuição obrigatória); o "híbrido" combina foto + labels CARTO.

const TILE_LAYERS = {
  dark: {
    label: 'Mapa',
    icon:  MapIcon,
    layers: [{
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }],
  },
  satellite: {
    label: 'Satélite',
    icon:  Satellite,
    layers: [{
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, GIS Community',
      maxZoom: 19,
    }],
  },
  hybrid: {
    label: 'Híbrido',
    icon:  Layers,
    layers: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
      },
      {
        url: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
        attribution: '',
        maxZoom: 19,
      },
    ],
  },
} as const

type TileMode = keyof typeof TILE_LAYERS

const BRAZIL_CENTER: [number, number] = [-22.0, -47.0]
const DEFAULT_ZOOM = 5

// Cor de status — alinhada com paleta global do app.
function statusColor(status?: string): string {
  switch (status) {
    case 'ACTIVE':
    case 'ONLINE':         return '#10B981'  // emerald
    case 'ERROR':          return '#F43F5E'  // rose
    case 'INACTIVE':
    case 'MAINTENANCE':    return '#F59E0B'  // amber
    case 'PENDING_CONFIG':
    default:               return '#94A3B8'  // slate
  }
}

// ── Tipos compostos pro state local ───────────────────────────────────────

interface SiteWithGeo extends SiteRow {
  latitude:  number | null
  longitude: number | null
}

interface PendingMove {
  siteId:   string
  origLat:  number | null
  origLng:  number | null
  newLat:   number
  newLng:   number
}

interface PendingBatchMove {
  // offsets em graus (lat/lng) aplicados ao site origem do drag
  deltaLat: number
  deltaLng: number
  // mapa de siteId → posição original e nova
  affected: Map<string, { origLat: number; origLng: number; newLat: number; newLng: number }>
}

interface PendingCameraAssignment {
  cameraId:   string
  cameraName: string
  siteId:     string
  siteName:   string
}

interface MeasurePoint { lat: number; lng: number }

type Role =
  | 'SUPER_ADMIN' | 'ADMIN_GLOBAL'
  | 'INTEGRADOR_ADMIN' | 'INTEGRADOR_TECNICO'
  | 'CLIENTE_ADMIN' | 'CLIENTE_SUPERVISOR' | 'CLIENTE_OPERADOR' | 'CLIENTE_VIEWER'
  | string

// ═════════════════════════════════════════════════════════════════════════════
// PAGE ROOT
// ═════════════════════════════════════════════════════════════════════════════

export function MapsHubPage() {
  const [tab, setTab] = useState<'geo' | 'synoptic'>('geo')
  const role: Role = (typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : '')

  // Quem pode editar sites no mapa geográfico:
  // backend permite SUPER_ADMIN ou INTEGRADOR_ADMIN. CLIENTE_* fica read-only.
  // Backend libera PATCH /sites/:id pra: SUPER_ADMIN, INTEGRADOR_ADMIN e
  // CLIENTE_ADMIN (whitelist de campos no servidor garante que cliente final
  // só altera latitude/longitude/address/city/state). Demais CLIENTE_*
  // (SUPERVISOR/OPERADOR/VIEWER) ficam read-only.
  const canEditGeo =
    role === 'SUPER_ADMIN' ||
    role === 'ADMIN_GLOBAL' ||
    role === 'INTEGRADOR_ADMIN' ||
    role === 'CLIENTE_ADMIN'

  return (
    <div className="space-y-5">
      {/* Header com gradiente premium e tabs grandes */}
      <Header tab={tab} onTabChange={setTab} canEditGeo={canEditGeo} />

      <AnimatePresence mode="wait">
        {tab === 'geo' && (
          <motion.div
            key="geo"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            <GeoMapView canEdit={canEditGeo} />
          </motion.div>
        )}

        {tab === 'synoptic' && (
          <motion.div
            key="synoptic"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            <Suspense fallback={<SynopticSkeleton />}>
              <SynopticMapPage />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────

function Header({
  tab, onTabChange, canEditGeo,
}: {
  tab: 'geo' | 'synoptic'
  onTabChange: (t: 'geo' | 'synoptic') => void
  canEditGeo: boolean
}) {
  return (
    <div className="space-y-4">
      {/* Title bar */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500/15 to-violet-500/15 border border-cyan-500/30 dark:border-cyan-500/40 flex items-center justify-center shrink-0">
            <MapIcon className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Mapas
              <span className="px-2 py-0.5 rounded-md bg-gradient-to-r from-fuchsia-500/20 to-cyan-500/20 border border-fuchsia-500/30 text-[10px] font-bold text-fuchsia-700 dark:text-fuchsia-300 tracking-wide">
                NOVO
              </span>
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Visão geográfica dos sites e plantas internas com câmeras posicionadas
            </p>
          </div>
        </div>
      </div>

      {/* Tab segmented control — premium */}
      <div className="relative inline-flex p-1 rounded-2xl bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/8 shadow-sm">
        {TAB_ITEMS.map(item => {
          const Icon   = item.icon
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={cn(
                'relative z-10 px-4 md:px-5 py-2.5 rounded-xl flex items-center gap-2.5 transition-colors duration-200',
                'min-w-[180px]',
                active
                  ? 'text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
              )}
            >
              {active && (
                <motion.div
                  layoutId="maps-tab-pill"
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 shadow-lg shadow-cyan-500/30"
                  transition={{ type: 'spring', bounce: 0.18, duration: 0.5 }}
                />
              )}
              <span className="relative flex items-center gap-2.5">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex flex-col items-start text-left">
                  <span className="text-sm font-semibold leading-tight">{item.label}</span>
                  <span className={cn(
                    'text-[10px] leading-tight',
                    active ? 'text-cyan-50/90' : 'text-slate-500 dark:text-slate-500',
                  )}>{item.sublabel}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Sub-info por tab */}
      {tab === 'geo' && (
        <div className={cn(
          'flex items-center gap-2 text-xs px-3 py-2 rounded-lg border',
          'bg-cyan-50 border-cyan-200 text-cyan-800',
          'dark:bg-cyan-500/5 dark:border-cyan-500/20 dark:text-cyan-300/90',
        )}>
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          {canEditGeo ? (
            <span>
              <strong>Modo edição</strong>: por padrão o mapa fica <strong>travado 🔒</strong> pra evitar movimentos
              acidentais. Clique em <strong>Editar</strong> pra destravar, arraste pins ou clique em ponto livre pra
              criar site. Mudanças só persistem ao clicar em <strong>Salvar</strong>. Cada alteração fica no histórico
              do site (ícone 🕒 no painel lateral).
            </span>
          ) : (
            <span>
              <strong>Visão somente leitura</strong>: seu perfil não tem permissão pra mover sites. Solicite ao
              CLIENTE_ADMIN ou ao integrador. No mapa sinótico você pode posicionar câmeras nas plantas.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB · GEOGRÁFICO
// ═════════════════════════════════════════════════════════════════════════════

function GeoMapView({ canEdit }: { canEdit: boolean }) {
  const { data: sitesData, mutate: mutateSites }       = useSites()
  const { data: geoData,   mutate: mutateGeo }         = useSitesGeo()
  const { data: camsData }                             = useCameras()
  const { data: clientesData }                         = useClientesFinais()

  const sites    = sitesData?.sites    ?? []
  const cameras: any[]  = camsData?.cameras   ?? []
  const clientes = clientesData?.clientes ?? []
  const geoMap   = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number }>()
    geoData?.points?.forEach(p => m.set(p.id, { lat: p.lat, lng: p.lng }))
    return m
  }, [geoData])

  // Combina sites com coords. Site não-geolocalizado vira candidato a drag.
  const sitesEnriched: SiteWithGeo[] = useMemo(() => {
    return sites.map(s => {
      const geo = geoMap.get(s.id)
      return {
        ...s,
        latitude:  geo?.lat ?? null,
        longitude: geo?.lng ?? null,
      }
    })
  }, [sites, geoMap])

  const sitesWithGeo    = sitesEnriched.filter(s => s.latitude != null && s.longitude != null)
  const sitesWithoutGeo = sitesEnriched.filter(s => s.latitude == null || s.longitude == null)

  // ── State da edição ──────────────────────────────────────────────────────
  const [editMode,        setEditMode]        = useState(false)
  const [pendingMove,     setPendingMove]     = useState<PendingMove | null>(null)
  const [pendingBatch,    setPendingBatch]    = useState<PendingBatchMove | null>(null)
  const [creatingSite,    setCreatingSite]    = useState<{ lat: number; lng: number } | null>(null)
  const [draggedDraftSite,setDraggedDraftSite]= useState<{ siteId: string; lat: number; lng: number } | null>(null)
  const [pendingCamAssign,setPendingCamAssign]= useState<PendingCameraAssignment | null>(null)
  const [selectedSiteId,  setSelectedSiteId]  = useState<string | null>(null)
  const [multiSelectIds,  setMultiSelectIds]  = useState<Set<string>>(() => new Set())
  const [savingPos,       setSavingPos]       = useState(false)
  const [search,          setSearch]          = useState('')
  const [clienteFilter,   setClienteFilter]   = useState<string>('')
  // Layers / tools
  const [tileMode,        setTileMode]        = useState<TileMode>('dark')
  const [heatmapOn,       setHeatmapOn]       = useState(false)
  const [measureOn,       setMeasureOn]       = useState(false)
  const [measurePoints,   setMeasurePoints]   = useState<MeasurePoint[]>([])

  // Câmeras "soltas" — sem site OU com site mas que o usuário quer reatribuir.
  // Critério "sem site": camera.site é null/undefined.
  const orphanCameras = useMemo<any[]>(() => cameras.filter(c => !c.site?.id), [cameras])

  // Quando sai do modo edit com mudança pendente, descarta tudo.
  function exitEditMode() {
    setEditMode(false)
    setPendingMove(null)
    setPendingBatch(null)
    setDraggedDraftSite(null)
    setPendingCamAssign(null)
    setMultiSelectIds(new Set())
  }

  // Filtered list pra sidebar
  const filteredWithGeo = useMemo(() => sitesWithGeo.filter(s => {
    if (clienteFilter && s.clienteFinal?.id !== clienteFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        s.name?.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q) ||
        s.city?.toLowerCase().includes(q) ||
        s.clienteFinal?.name?.toLowerCase().includes(q)
      )
    }
    return true
  }), [sitesWithGeo, search, clienteFilter])

  // Persiste move
  async function handleConfirmMove() {
    if (!pendingMove) return
    setSavingPos(true)
    try {
      await updateSite(pendingMove.siteId, {
        latitude:  pendingMove.newLat,
        longitude: pendingMove.newLng,
      })
      mutateGeo()
      mutateSites()
      setPendingMove(null)
    } catch (err: any) {
      alert(formatApiError(err))
    } finally {
      setSavingPos(false)
    }
  }

  function handleCancelMove() {
    setPendingMove(null)
  }

  // Persiste drop de site sem geo
  async function handleConfirmDraft() {
    if (!draggedDraftSite) return
    setSavingPos(true)
    try {
      await updateSite(draggedDraftSite.siteId, {
        latitude:  draggedDraftSite.lat,
        longitude: draggedDraftSite.lng,
      })
      mutateGeo()
      mutateSites()
      setDraggedDraftSite(null)
    } catch (err: any) {
      alert(formatApiError(err))
    } finally {
      setSavingPos(false)
    }
  }

  function handleCancelDraft() {
    setDraggedDraftSite(null)
  }

  // ── Batch move (multi-select) ────────────────────────────────────────────
  async function handleConfirmBatch() {
    if (!pendingBatch) return
    setSavingPos(true)
    try {
      // PATCH em paralelo. Falha parcial vai parar no Promise.all e o backend
      // mantém quem já passou (não há transação distribuída — UX assume best-
      // effort. Se ficar inconsistente, próximo Salvar resolve).
      await Promise.all(
        Array.from(pendingBatch.affected.entries()).map(([id, pos]) =>
          updateSite(id, { latitude: pos.newLat, longitude: pos.newLng }),
        ),
      )
      mutateGeo()
      mutateSites()
      setPendingBatch(null)
      setMultiSelectIds(new Set())
    } catch (err: any) {
      alert(formatApiError(err))
    } finally {
      setSavingPos(false)
    }
  }

  function handleCancelBatch() {
    setPendingBatch(null)
  }

  function clearMultiSelect() {
    setMultiSelectIds(new Set())
    setPendingBatch(null)
  }

  function toggleMultiSelect(siteId: string) {
    setMultiSelectIds(prev => {
      const next = new Set(prev)
      if (next.has(siteId)) next.delete(siteId)
      else next.add(siteId)
      return next
    })
  }

  // ── Drag câmera → site ───────────────────────────────────────────────────
  async function handleConfirmCamAssign() {
    if (!pendingCamAssign) return
    setSavingPos(true)
    try {
      // siteId aceito pelo PATCH /cameras/:id (UpdateCameraSchema atualizado).
      // Backend reseta edgeNodeId pra null — operador escolhe edge depois.
      await updateCamera(pendingCamAssign.cameraId, { siteId: pendingCamAssign.siteId })
      setPendingCamAssign(null)
    } catch (err: any) {
      alert(formatApiError(err))
    } finally {
      setSavingPos(false)
    }
  }

  function handleCancelCamAssign() {
    setPendingCamAssign(null)
  }

  // ESC fecha measure / multi-select
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (measureOn)            { setMeasureOn(false); setMeasurePoints([]) }
        if (multiSelectIds.size)   clearMultiSelect()
        if (pendingMove)           setPendingMove(null)
        if (pendingBatch)          setPendingBatch(null)
        if (pendingCamAssign)      setPendingCamAssign(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureOn, multiSelectIds, pendingMove, pendingBatch, pendingCamAssign])

  const mapRef   = useRef<L.Map | null>(null)
  function flyTo(lat: number, lng: number, zoom = 14) {
    mapRef.current?.flyTo([lat, lng], zoom, { duration: 0.8 })
  }

  // Geocoder pelo header do mapa (busca de endereço)
  async function flyToAddress(query: string) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } })
    if (!r.ok) return null
    const data: any[] = await r.json()
    if (!data?.length) return null
    flyTo(parseFloat(data[0].lat), parseFloat(data[0].lon), 14)
    return data[0].display_name as string
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      {/* SIDEBAR ─────────────────────────────────────────────────────────── */}
      <GlassCard className="p-3 lg:col-span-1 space-y-3 max-h-[78vh] overflow-y-auto">
        <SidebarHeader
          editMode={editMode}
          canEdit={canEdit}
          onToggleEdit={() => editMode ? exitEditMode() : setEditMode(true)}
        />

        <div className="space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar site / endereço / cliente"
              className={cn(
                'w-full pl-8 pr-3 py-1.5 text-xs rounded-md border focus:outline-none transition',
                'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-cyan-500',
                'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500 dark:focus:border-cyan-500/50',
              )}
            />
          </div>
          {clientes.length > 1 && (
            <select
              value={clienteFilter}
              onChange={e => setClienteFilter(e.target.value)}
              className={cn(
                'w-full px-2 py-1.5 text-xs rounded-md border',
                'bg-slate-50 border-slate-200 text-slate-900',
                'dark:bg-white/5 dark:border-white/10 dark:text-white',
              )}
            >
              <option value="">Todos os clientes</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="text-[10px] text-slate-500 dark:text-slate-500 flex items-center gap-1">
            <Filter className="w-3 h-3" />
            {filteredWithGeo.length} site(s) no mapa · {sitesWithoutGeo.length} sem geoloc
          </div>
        </div>

        {/* Sites geolocalizados */}
        {filteredWithGeo.length > 0 && (
          <div className="space-y-1.5">
            <SidebarSection title="Sites no mapa" count={filteredWithGeo.length} icon={MapPin} />
            <ul className="space-y-1.5">
              {filteredWithGeo.map(s => (
                <SiteListItem
                  key={s.id}
                  site={s}
                  cameras={cameras.filter(c => c.site?.id === s.id)}
                  isSelected={selectedSiteId === s.id}
                  onClick={() => {
                    setSelectedSiteId(s.id)
                    if (s.latitude != null && s.longitude != null) flyTo(s.latitude, s.longitude, 14)
                  }}
                />
              ))}
            </ul>
          </div>
        )}

        {/* Sites sem geo — drag-source só em modo edit */}
        {sitesWithoutGeo.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <SidebarSection
              title="Sem geolocalização"
              count={sitesWithoutGeo.length}
              icon={AlertCircle}
              tone="warning"
            />
            {editMode && canEdit && (
              <p className="text-[10px] text-amber-700 dark:text-amber-400/90 flex items-start gap-1 leading-tight">
                <Wand2 className="w-3 h-3 shrink-0 mt-0.5" />
                Arraste um card pro mapa pra geolocalizar.
              </p>
            )}
            <ul className="space-y-1.5">
              {sitesWithoutGeo.map(s => (
                <DraggableNoGeoItem
                  key={s.id}
                  site={s}
                  draggable={editMode && canEdit}
                />
              ))}
            </ul>
          </div>
        )}

        {/* Câmeras órfãs — drag pra atribuir a um site (drop em pin) */}
        {orphanCameras.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <SidebarSection
              title="Câmeras sem site"
              count={orphanCameras.length}
              icon={CameraIcon}
              tone="warning"
            />
            {editMode && canEdit && (
              <p className="text-[10px] text-cyan-700 dark:text-cyan-400/90 flex items-start gap-1 leading-tight">
                <Wand2 className="w-3 h-3 shrink-0 mt-0.5" />
                Arraste a câmera para o pin do site no mapa.
              </p>
            )}
            <ul className="space-y-1.5">
              {orphanCameras.map(cam => (
                <DraggableOrphanCamera
                  key={cam.id}
                  camera={cam}
                  draggable={editMode && canEdit}
                />
              ))}
            </ul>
          </div>
        )}

        {sitesEnriched.length === 0 && (
          <p className="text-[11px] text-slate-500 dark:text-slate-500 text-center py-6 px-2">
            Nenhum site cadastrado.
            {canEdit && (
              <>
                <br />
                {editMode
                  ? <span className="text-cyan-600 dark:text-cyan-400 font-medium">Clique em qualquer ponto do mapa pra criar.</span>
                  : <Link to="/sites" className="text-cyan-600 dark:text-cyan-400 font-medium hover:underline">Criar em /sites →</Link>
                }
              </>
            )}
          </p>
        )}
      </GlassCard>

      {/* MAPA ───────────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'lg:col-span-3 h-[78vh] flex flex-col overflow-hidden relative rounded-2xl border transition-colors',
          editMode
            ? 'bg-white border-amber-300 dark:bg-transparent dark:border-amber-500/40 shadow-amber-500/10 shadow-lg dark:bg-gradient-to-br dark:from-amber-500/[0.04] dark:to-rose-500/[0.02] dark:backdrop-blur-sm'
            : 'bg-white border-slate-200 shadow-sm dark:bg-transparent dark:bg-gradient-to-br dark:from-white/[0.06] dark:to-white/[0.02] dark:backdrop-blur-sm dark:border-white/8 dark:shadow-glass',
        )}
      >
        {/* Edit ribbon */}
        {editMode && (
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-rose-500 text-white text-[10px] font-bold tracking-wide flex items-center gap-1.5 shadow-lg pointer-events-none"
          >
            <Unlock className="w-3 h-3" />
            EDITANDO POSIÇÕES
          </motion.div>
        )}

        {/* Inner highlight no DARK */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.04] to-transparent pointer-events-none hidden dark:block" />

        {/* Header do mapa: geocoder + legenda */}
        <div className="relative z-10 p-3 flex items-center gap-3 shrink-0 border-b border-slate-200 dark:border-white/5">
          <GeocoderForm onSubmit={flyToAddress} />
          <div className="hidden md:flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-500">
            <Legend dot="#10B981" label="Online" />
            <Legend dot="#F59E0B" label="Atenção" />
            <Legend dot="#F43F5E" label="Erro" />
            <Legend dot="#94A3B8" label="Inativa" />
          </div>
        </div>

        {/* Map */}
        <div className="relative z-10 flex-1" style={{ minHeight: 0 }}>
          <MapContainer
            center={BRAZIL_CENTER}
            zoom={DEFAULT_ZOOM}
            minZoom={3}
            maxZoom={19}
            // Zoom fluido (P0): passos fracionais de 0.25 evitam saltos abruptos
            // típicos do Leaflet (defaults zoomSnap=1, zoomDelta=1). Combinado
            // com wheelPxPerZoomLevel=100 dá a sensação de "Mapbox-like":
            //   • zoomSnap=0.25      — granularidade final do snap
            //   • zoomDelta=0.5      — botões + e − e teclas avançam 0.5
            //   • wheelPxPerZoomLevel=100 — px de scroll por nível de zoom
            //   • wheelDebounceTime=20  — responsividade do trackpad
            zoomSnap={0.25}
            zoomDelta={0.5}
            wheelPxPerZoomLevel={100}
            wheelDebounceTime={20}
            zoomAnimation={true}
            fadeAnimation={true}
            markerZoomAnimation={true}
            style={{ height: '100%', width: '100%' }}
            ref={mapRef as any}
          >
            {/* Tile layers — observa tileMode (Mapa | Satélite | Híbrido) */}
            {TILE_LAYERS[tileMode].layers.map((l, i) => (
              <TileLayer
                key={`${tileMode}-${i}`}
                url={l.url}
                attribution={l.attribution}
                maxZoom={l.maxZoom}
              />
            ))}
            <MapInvalidate />
            <FitToSites sites={sitesWithGeo} />

            {/* Click-to-create-site (só em modo edit, fora de measure) */}
            {editMode && canEdit && !measureOn && (
              <ClickToCreate
                onClick={(lat, lng) => setCreatingSite({ lat, lng })}
                hasPendingMove={!!pendingMove || !!pendingBatch}
              />
            )}

            {/* Drop receiver pro draggable da sidebar (sites sem geo + câmeras sem site) */}
            {editMode && canEdit && (
              <MapDropReceiver
                onDropSite={(siteId, lat, lng) => setDraggedDraftSite({ siteId, lat, lng })}
              />
            )}

            {/* Heatmap de eventos (camada CircleMarker com gradiente intensidade) */}
            {heatmapOn && <HeatmapBlobs sites={sitesWithGeo} cameras={cameras} />}

            {/* Régua de distância */}
            {measureOn && (
              <MeasureLayer
                points={measurePoints}
                onAddPoint={p => setMeasurePoints(prev => [...prev, p])}
              />
            )}

            {/* Sites com geo */}
            {sitesWithGeo.map(s => {
              const camsOfSite     = cameras.filter(c => c.site?.id === s.id)
              const isMulti        = multiSelectIds.has(s.id)
              // Se há batch e este site faz parte → exibe na posição "trasladada"
              const batchPos       = pendingBatch?.affected.get(s.id)
              const overrideLat    = batchPos ? batchPos.newLat : null
              const overrideLng    = batchPos ? batchPos.newLng : null
              return (
                <SiteMarker
                  key={s.id}
                  site={s}
                  cameras={camsOfSite}
                  cameraCount={camsOfSite.length}
                  editable={editMode && canEdit && !measureOn}
                  isMoving={pendingMove?.siteId === s.id}
                  isSelected={selectedSiteId === s.id}
                  isMulti={isMulti}
                  isBatchAffected={!!batchPos}
                  pendingMove={pendingMove?.siteId === s.id ? pendingMove : null}
                  overrideLat={overrideLat}
                  overrideLng={overrideLng}
                  onClick={(shiftKey) => {
                    if (editMode && canEdit && shiftKey) {
                      toggleMultiSelect(s.id)
                    } else {
                      setSelectedSiteId(s.id)
                    }
                  }}
                  onDragStart={() => {
                    setPendingMove(null)
                    setPendingBatch(null)
                  }}
                  onDragEnd={(lat, lng) => {
                    // Se o site faz parte do multi-select, é um drag de GRUPO:
                    // calcula offset e move todos os outros junto.
                    if (multiSelectIds.has(s.id) && multiSelectIds.size > 1) {
                      const deltaLat = lat - s.latitude!
                      const deltaLng = lng - s.longitude!
                      const affected = new Map<string, { origLat: number; origLng: number; newLat: number; newLng: number }>()
                      for (const id of multiSelectIds) {
                        const target = sitesEnriched.find(x => x.id === id)
                        if (!target?.latitude || !target?.longitude) continue
                        affected.set(id, {
                          origLat: target.latitude,
                          origLng: target.longitude,
                          newLat:  target.latitude  + deltaLat,
                          newLng:  target.longitude + deltaLng,
                        })
                      }
                      setPendingBatch({ deltaLat, deltaLng, affected })
                    } else {
                      setPendingMove({
                        siteId:  s.id,
                        origLat: s.latitude,
                        origLng: s.longitude,
                        newLat:  lat,
                        newLng:  lng,
                      })
                    }
                  }}
                  onDropCamera={(cameraId) => {
                    const cam = cameras.find(c => c.id === cameraId)
                    if (!cam) return
                    setPendingCamAssign({
                      cameraId,
                      cameraName: cam.name,
                      siteId:     s.id,
                      siteName:   s.name,
                    })
                  }}
                />
              )
            })}

            {/* Drag-and-drop: sites sem geo (cards) → mapa */}
            {draggedDraftSite && (
              <DraftDropMarker draft={draggedDraftSite} />
            )}
          </MapContainer>

          {/* Floating panel: tile switcher + heatmap + measure (top-right) */}
          <FloatingTools
            tileMode={tileMode}
            onTileChange={setTileMode}
            heatmapOn={heatmapOn}
            onToggleHeatmap={() => setHeatmapOn(v => !v)}
            measureOn={measureOn}
            onToggleMeasure={() => {
              setMeasureOn(v => !v)
              if (measureOn) setMeasurePoints([])
            }}
          />

          {/* Floating measure badge (bottom-left) */}
          <AnimatePresence>
            {measureOn && (
              <MeasureBadge
                points={measurePoints}
                onClear={() => setMeasurePoints([])}
                onClose={() => { setMeasureOn(false); setMeasurePoints([]) }}
              />
            )}
          </AnimatePresence>

          {/* Multi-select toolbar (bottom-center, acima das pills de salvar) */}
          <AnimatePresence>
            {multiSelectIds.size > 0 && !pendingBatch && (
              <MultiSelectToolbar
                count={multiSelectIds.size}
                onClear={clearMultiSelect}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Confirmar mover (overlay flutuante) */}
        <AnimatePresence>
          {pendingMove && (
            <motion.div
              key="move-bubble"
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000]"
            >
              <ConfirmActionPill
                title="Salvar nova posição?"
                subtitle={`${pendingMove.newLat.toFixed(5)}, ${pendingMove.newLng.toFixed(5)}`}
                onConfirm={handleConfirmMove}
                onCancel={handleCancelMove}
                busy={savingPos}
                accent="amber"
              />
            </motion.div>
          )}
          {draggedDraftSite && (
            <motion.div
              key="draft-bubble"
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000]"
            >
              <ConfirmActionPill
                title="Geolocalizar este site aqui?"
                subtitle={`${draggedDraftSite.lat.toFixed(5)}, ${draggedDraftSite.lng.toFixed(5)}`}
                onConfirm={handleConfirmDraft}
                onCancel={handleCancelDraft}
                busy={savingPos}
                accent="violet"
              />
            </motion.div>
          )}
          {pendingBatch && (
            <motion.div
              key="batch-bubble"
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000]"
            >
              <ConfirmActionPill
                title={`Salvar ${pendingBatch.affected.size} novas posições?`}
                subtitle={`Δ ${pendingBatch.deltaLat.toFixed(4)}, ${pendingBatch.deltaLng.toFixed(4)}`}
                onConfirm={handleConfirmBatch}
                onCancel={handleCancelBatch}
                busy={savingPos}
                accent="amber"
              />
            </motion.div>
          )}
          {pendingCamAssign && (
            <motion.div
              key="cam-assign-bubble"
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000]"
            >
              <ConfirmActionPill
                title={`Atribuir ${pendingCamAssign.cameraName}?`}
                subtitle={`→ ${pendingCamAssign.siteName}`}
                onConfirm={handleConfirmCamAssign}
                onCancel={handleCancelCamAssign}
                busy={savingPos}
                accent="violet"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Drawer de detalhes do site */}
        <AnimatePresence>
          {selectedSiteId && (
            <SiteDrawer
              key={selectedSiteId}
              site={sitesEnriched.find(s => s.id === selectedSiteId)!}
              cameras={cameras.filter(c => c.site?.id === selectedSiteId)}
              onClose={() => setSelectedSiteId(null)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Modal criar site */}
      <AnimatePresence>
        {creatingSite && (
          <CreateSiteModal
            lat={creatingSite.lat}
            lng={creatingSite.lng}
            clientes={clientes}
            onClose={() => setCreatingSite(null)}
            onCreated={() => {
              mutateSites()
              mutateGeo()
              setCreatingSite(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Sidebar atomics ───────────────────────────────────────────────────────

function SidebarHeader({
  editMode, canEdit, onToggleEdit,
}: {
  editMode: boolean
  canEdit:  boolean
  onToggleEdit: () => void
}) {
  return (
    <div className="space-y-2 pb-2 border-b border-slate-200 dark:border-white/5">
      <div className="flex items-center justify-between gap-2">
        <span className={cn(
          'flex items-center gap-1.5 text-[11px] font-semibold tracking-wide',
          editMode
            ? 'text-amber-700 dark:text-amber-400'
            : 'text-slate-700 dark:text-slate-300',
        )}>
          {editMode
            ? <><Unlock className="w-3 h-3" /> Editando</>
            : <><Lock   className="w-3 h-3" /> Travado</>}
        </span>

        <button
          type="button"
          onClick={onToggleEdit}
          disabled={!canEdit}
          title={!canEdit ? 'Permissão de integrador necessária' : undefined}
          className={cn(
            'px-2.5 py-1 rounded-md text-[11px] font-semibold transition flex items-center gap-1',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            editMode
              ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm shadow-amber-500/30'
              : 'bg-slate-200 hover:bg-cyan-100 hover:text-cyan-700 text-slate-700 dark:bg-white/5 dark:hover:bg-cyan-500/15 dark:hover:text-cyan-300 dark:text-slate-300 dark:border dark:border-white/10',
          )}
        >
          {editMode ? <><Lock className="w-3 h-3" /> Travar</> : <><Unlock className="w-3 h-3" /> Editar</>}
        </button>
      </div>

      <p className="text-[10px] text-slate-500 dark:text-slate-500 leading-tight">
        {editMode
          ? 'Mudanças só persistem ao salvar. Click no mapa cria site.'
          : 'Pins fixos. Click leva ao site. Toggle para editar.'}
      </p>
    </div>
  )
}

function SidebarSection({
  title, count, icon: Icon, tone = 'normal',
}: {
  title: string
  count: number
  icon:  any
  tone?: 'normal' | 'warning'
}) {
  return (
    <div className={cn(
      'flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider',
      tone === 'warning'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-slate-500 dark:text-slate-500',
    )}>
      <Icon className="w-3 h-3" />
      {title}
      <span className={cn(
        'ml-auto px-1.5 py-0.5 rounded text-[9px]',
        tone === 'warning'
          ? 'bg-amber-100 dark:bg-amber-500/15'
          : 'bg-slate-100 dark:bg-white/[0.06]',
      )}>{count}</span>
    </div>
  )
}

function SiteListItem({
  site, cameras, isSelected, onClick,
}: {
  site:       SiteWithGeo
  cameras:    any[]
  isSelected: boolean
  onClick:    () => void
}) {
  const onlineCount = cameras.filter(c => c.status === 'ACTIVE' || c.status === 'ONLINE').length
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          'w-full p-2 rounded-lg border text-left transition',
          isSelected
            ? 'bg-cyan-50 border-cyan-300 ring-2 ring-cyan-500/30 dark:bg-cyan-500/10 dark:border-cyan-500/40'
            : 'bg-slate-50 border-slate-200 hover:border-cyan-300 dark:bg-white/[0.03] dark:border-white/5 dark:hover:border-cyan-500/30',
        )}
      >
        <div className="flex items-start gap-2">
          <div className={cn(
            'w-7 h-7 rounded-md flex items-center justify-center shrink-0',
            'bg-gradient-to-br from-cyan-500/15 to-violet-500/15 border border-cyan-500/25',
          )}>
            <Building2 className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold truncate text-slate-900 dark:text-white">{site.name}</p>
            <p className="text-[10px] truncate text-slate-500 dark:text-slate-500">
              {site.clienteFinal?.name ?? '—'}
              {site.city && ` · ${site.city}${site.state ? `/${site.state}` : ''}`}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] flex items-center gap-1 text-slate-500 dark:text-slate-400">
                <CameraIcon className="w-2.5 h-2.5" />
                {cameras.length}
                {onlineCount > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">· {onlineCount} on</span>
                )}
              </span>
              <span className="ml-auto text-[9px] font-mono text-cyan-700 dark:text-cyan-400/80">
                {site.latitude!.toFixed(2)}, {site.longitude!.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </button>
    </li>
  )
}

function DraggableNoGeoItem({ site, draggable }: { site: SiteWithGeo; draggable: boolean }) {
  return (
    <li
      draggable={draggable}
      onDragStart={e => {
        // dataTransfer keys são case-insensitive em alguns browsers (Chrome/Firefox
        // armazenam lowercase). Usamos lowercase consistente em todos os
        // handlers — o key formal MIME-like com hífen seria mais correto, mas
        // strings simples já funcionam.
        e.dataTransfer.setData('siteid', site.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={cn(
        'p-2 rounded-lg border-2 border-dashed transition group',
        draggable
          ? 'bg-amber-50 border-amber-300 hover:border-amber-500 cursor-move dark:bg-amber-500/5 dark:border-amber-500/40 dark:hover:border-amber-500/70'
          : 'bg-slate-50 border-slate-200 dark:bg-white/[0.03] dark:border-white/10',
      )}
    >
      <div className="flex items-start gap-2">
        <div className={cn(
          'w-7 h-7 rounded-md flex items-center justify-center shrink-0',
          draggable
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
            : 'bg-slate-200 text-slate-500 dark:bg-white/[0.06] dark:text-slate-500',
        )}>
          {draggable ? <Move className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate text-slate-900 dark:text-white">{site.name}</p>
          <p className="text-[10px] truncate text-slate-500 dark:text-slate-500">
            {site.clienteFinal?.name ?? '—'}
          </p>
          <p className="text-[9px] text-amber-700 dark:text-amber-400/90 italic">
            {draggable ? 'Arraste pra geolocalizar' : 'Sem coordenadas'}
          </p>
        </div>
      </div>
    </li>
  )
}

function DraggableOrphanCamera({ camera, draggable }: { camera: any; draggable: boolean }) {
  const dot = statusColor(camera.status)
  return (
    <li
      draggable={draggable}
      onDragStart={e => {
        e.dataTransfer.setData('cameraid', camera.id)
        e.dataTransfer.effectAllowed = 'link'
      }}
      className={cn(
        'p-2 rounded-lg border-2 border-dashed transition group',
        draggable
          ? 'bg-cyan-50 border-cyan-300 hover:border-cyan-500 cursor-move dark:bg-cyan-500/5 dark:border-cyan-500/40 dark:hover:border-cyan-500/70'
          : 'bg-slate-50 border-slate-200 dark:bg-white/[0.03] dark:border-white/10',
      )}
    >
      <div className="flex items-start gap-2">
        <div className={cn(
          'w-7 h-7 rounded-md flex items-center justify-center shrink-0 relative',
          draggable
            ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400'
            : 'bg-slate-200 text-slate-500 dark:bg-white/[0.06] dark:text-slate-500',
        )}>
          <CameraIcon className="w-3.5 h-3.5" />
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-white dark:ring-space-900"
            style={{ background: dot }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate text-slate-900 dark:text-white">{camera.name}</p>
          <p className="text-[10px] truncate text-slate-500 dark:text-slate-500">
            {camera.status} {camera.ingestMode && `· ${camera.ingestMode}`}
          </p>
          <p className="text-[9px] text-cyan-700 dark:text-cyan-400/90 italic">
            {draggable ? 'Arraste pro pin de um site' : 'Sem site'}
          </p>
        </div>
      </div>
    </li>
  )
}

// ── Mapa: pieces ───────────────────────────────────────────────────────────

function MapInvalidate() {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    const t = setTimeout(() => map.invalidateSize(), 200)
    return () => clearTimeout(t)
  }, [map])
  return null
}

function FitToSites({ sites }: { sites: SiteWithGeo[] }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || sites.length === 0) return
    const valid = sites.filter(s => s.latitude != null && s.longitude != null)
    if (valid.length === 0) return
    if (valid.length === 1) {
      map.setView([valid[0].latitude!, valid[0].longitude!], 13)
    } else {
      const bounds = L.latLngBounds(valid.map(s => [s.latitude!, s.longitude!] as [number, number]))
      map.fitBounds(bounds.pad(0.2), { padding: [40, 40], maxZoom: 11 })
    }
    fitted.current = true
  }, [map, sites])
  return null
}

function ClickToCreate({
  onClick, hasPendingMove,
}: {
  onClick: (lat: number, lng: number) => void
  hasPendingMove: boolean
}) {
  useMapEvents({
    click(e) {
      // Não cria site se há mudança pendente — usuário precisa decidir 1ª.
      if (hasPendingMove) return
      // Ignora clicks que vêm de dentro de um marker (Leaflet propaga).
      const target = e.originalEvent.target as HTMLElement
      if (target?.closest('.leaflet-marker-icon')) return
      onClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

/**
 * MapDropReceiver — captura drops no canvas do mapa.
 *
 * Aceita 2 tipos de payload no DataTransfer:
 *   • `siteId`   — site sem geo arrastado pra ser geolocalizado (drop livre no canvas)
 *   • `cameraid` — câmera órfã. NÃO trata aqui: cada SiteMarker tem listener próprio
 *     (stopPropagation no marker impede que esse handler dispare).
 *
 * Camera dropada FORA de um pin é silenciosamente ignorada (UX: só atribui
 * quando o usuário deixa em cima de um pin de site).
 */
function MapDropReceiver({
  onDropSite,
}: {
  onDropSite: (siteId: string, lat: number, lng: number) => void
}) {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    function handleDragOver(e: DragEvent) {
      const types = e.dataTransfer?.types
      if (!types) return
      const arr = Array.from(types)
      // Aceita drop tanto de siteId quanto cameraid (este último vai pro pin).
      if (arr.includes('siteid') || arr.includes('cameraid')) {
        e.preventDefault()
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = arr.includes('cameraid') ? 'link' : 'move'
        }
      }
    }
    function handleDrop(e: DragEvent) {
      const siteId = e.dataTransfer?.getData('siteid')
      if (!siteId) return  // cameraid é tratado pelo SiteMarker
      e.preventDefault()
      const rect    = container.getBoundingClientRect()
      const point   = L.point(e.clientX - rect.left, e.clientY - rect.top)
      const latlng  = map.containerPointToLatLng(point)
      onDropSite(siteId, latlng.lat, latlng.lng)
    }
    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('drop', handleDrop)
    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('drop', handleDrop)
    }
  }, [map, onDropSite])
  return null
}

function DraftDropMarker({ draft }: { draft: { lat: number; lng: number } }) {
  const icon = L.divIcon({
    html: `
      <div style="position:relative;width:36px;height:36px;">
        <div style="position:absolute;inset:-8px;border-radius:50%;border:2px dashed #8B5CF6;animation:pulse-marker 1.4s ease-out infinite;"></div>
        <div style="
          width:36px;height:36px;border-radius:50%;
          background:linear-gradient(135deg,#8B5CF6,#06B6D4);
          border:3px solid white;
          box-shadow:0 4px 14px rgba(139,92,246,0.45);
          display:flex;align-items:center;justify-content:center;
        ">
          <span style="color:white;font-size:18px;line-height:1;">📍</span>
        </div>
      </div>
    `,
    className: 'icv-camera-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
  return <Marker position={[draft.lat, draft.lng]} icon={icon} />
}

// Cache global (módulo) de URLs de snapshot autenticado. TTL 50s alinha
// com TTL do ticket de snapshot do backend (60s) e dá margem pra hover
// repetido sem re-spawn de ffmpeg.
const SITE_SNAPSHOT_CACHE = new Map<string, { url: string; at: number }>()
async function fetchSiteSnapshotUrl(cameraId: string): Promise<string | null> {
  const c = SITE_SNAPSHOT_CACHE.get(cameraId)
  if (c && Date.now() - c.at < 50_000) return c.url
  try {
    const r = await snapshotCamera(cameraId)
    const path = (r as { snapshotUrl?: string })?.snapshotUrl
    if (!path) return null
    const url = `${BASE_URL}${path}`
    SITE_SNAPSHOT_CACHE.set(cameraId, { url, at: Date.now() })
    return url
  } catch {
    return null
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c])
}

function SiteMarker({
  site, cameras, cameraCount, editable, isMoving, isSelected, isMulti, isBatchAffected,
  pendingMove, overrideLat, overrideLng,
  onClick, onDragStart, onDragEnd, onDropCamera,
}: {
  site:        SiteWithGeo
  cameras:     any[]
  cameraCount: number
  editable:    boolean
  isMoving:    boolean
  isSelected:  boolean
  isMulti:     boolean
  isBatchAffected: boolean
  pendingMove: PendingMove | null
  overrideLat: number | null
  overrideLng: number | null
  onClick:     (shiftKey: boolean) => void
  onDragStart: () => void
  onDragEnd:   (lat: number, lng: number) => void
  onDropCamera: (cameraId: string) => void
}) {
  const lat = overrideLat != null
    ? overrideLat
    : isMoving && pendingMove ? pendingMove.newLat : site.latitude!
  const lng = overrideLng != null
    ? overrideLng
    : isMoving && pendingMove ? pendingMove.newLng : site.longitude!

  // Cor de cada estado:
  //  • multi-select  → violet com badge ✓
  //  • moving / batch → amber pulse
  //  • normal hovered/selected → cyan com halo violet (selected)
  const isAlt   = isMulti || isMoving || isBatchAffected
  const tone    = isAlt ? '#F59E0B' : '#06B6D4'
  const border  = isMulti ? '#8B5CF6' : isSelected ? '#A78BFA' : '#0F172A'
  const haloOp  = isSelected || isMulti ? 0.55 : 0.3

  const icon = L.divIcon({
    html: `
      <div class="icv-site-pin" style="position:relative;width:34px;height:34px;">
        <div style="position:absolute;inset:-6px;border-radius:50%;background:${tone};opacity:${haloOp};animation:pulse-marker 2s ease-out infinite;"></div>
        <div style="
          width:34px;height:34px;border-radius:50%;
          background:linear-gradient(135deg, ${tone}EE, ${tone}AA);
          border:3px solid ${border};
          box-shadow:0 3px 10px rgba(0,0,0,0.35);
          display:flex;align-items:center;justify-content:center;
          color:white;font-weight:bold;font-size:11px;
        ">
          ${cameraCount}
        </div>
        ${isMoving || isBatchAffected ? `
          <div style="
            position:absolute;top:-4px;right:-4px;width:14px;height:14px;
            border-radius:50%;background:#F59E0B;border:2px solid white;
            box-shadow:0 1px 4px rgba(0,0,0,0.3);
            animation:pulse-marker 1s ease-out infinite;
          "></div>` : ''}
        ${isMulti ? `
          <div style="
            position:absolute;top:-5px;left:-5px;width:16px;height:16px;
            border-radius:50%;background:#8B5CF6;border:2px solid white;
            box-shadow:0 1px 4px rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;
            color:white;font-size:10px;font-weight:bold;
          ">✓</div>` : ''}
      </div>
    `,
    className: 'icv-camera-marker',
    iconSize:   [34, 34],
    iconAnchor: [17, 17],
  })

  // Hookar drop-target HTML5 nativo no DOM do marker (camera→site).
  // O Leaflet renderiza markers com classe `.leaflet-marker-icon` e o nosso
  // wrapper é `.icv-site-pin`. Adicionamos listeners assim que o marker é
  // adicionado ao mapa.
  const markerRef = useRef<L.Marker | null>(null)
  useEffect(() => {
    const m = markerRef.current
    if (!m) return
    const el = m.getElement() as HTMLElement | null
    if (!el) return
    let isOver = false
    function onDragEnter(e: DragEvent) {
      const types = e.dataTransfer?.types
      if (!types || !Array.from(types).includes('cameraid')) return
      e.preventDefault()
      if (!isOver) {
        isOver = true
        el!.style.transform = (el!.style.transform || '') + ' scale(1.25)'
        el!.style.transition = 'transform 120ms ease-out'
        el!.style.filter = 'drop-shadow(0 0 12px rgba(16,185,129,0.7))'
      }
    }
    function onDragOver(e: DragEvent) {
      const types = e.dataTransfer?.types
      if (!types || !Array.from(types).includes('cameraid')) return
      e.preventDefault()
      e.stopPropagation()  // impede o map drop receiver
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'link'
    }
    function onDragLeave() {
      if (isOver) {
        isOver = false
        el!.style.transform = (el!.style.transform || '').replace(' scale(1.25)', '')
        el!.style.filter = ''
      }
    }
    function onDrop(e: DragEvent) {
      const cameraId = e.dataTransfer?.getData('cameraid')
      if (!cameraId) return
      e.preventDefault()
      e.stopPropagation()
      onDragLeave()
      onDropCamera(cameraId)
    }
    el.addEventListener('dragenter', onDragEnter)
    el.addEventListener('dragover',  onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop',      onDrop)
    return () => {
      el.removeEventListener('dragenter', onDragEnter)
      el.removeEventListener('dragover',  onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop',      onDrop)
    }
  }, [onDropCamera])

  // ── Hover popup com snapshot ao vivo da primeira câmera ─────────────────
  // Estratégia copiada do CameraMapPage original (paridade que faltava):
  //   • bindPopup com placeholder skeleton
  //   • mouseover: openPopup + fetchSnapshot async + atualiza HTML
  //   • mouseout / popup mouseleave: scheduleClose 400ms (UX tooltip)
  //   • cache de URLs evita spawn ffmpeg em loop
  // O click do marker continua sendo o gesto principal (abre drawer).
  const firstCam = cameras[0]
  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    const m: L.Marker = marker  // narrow pra closures internas

    function buildPopupHtml(snapshotUrl: string | null): string {
      const previewBlock = firstCam
        ? snapshotUrl
          ? `<img src="${escapeHtml(snapshotUrl)}" alt="snapshot" style="
               width:240px;height:135px;object-fit:cover;
               background:#0F172A;border-radius:6px;display:block;margin-bottom:8px;
             " onerror="this.style.display='none'"/>`
          : `<div style="
               width:240px;height:135px;
               background:linear-gradient(110deg, #0F172A 30%, #1E293B 50%, #0F172A 70%);
               background-size:200% 100%;
               animation:icv-skeleton 1.4s ease-in-out infinite;
               border-radius:6px;display:flex;align-items:center;justify-content:center;
               color:#94A3B8;font-size:10px;margin-bottom:8px;
             "><span>capturando snapshot…</span></div>`
        : `<div style="
             width:240px;height:135px;background:#1E293B;border-radius:6px;
             display:flex;align-items:center;justify-content:center;
             color:#64748B;font-size:11px;margin-bottom:8px;
           "><span>📍 site sem câmeras</span></div>`

      const onlineN = cameras.filter(c => c.status === 'ACTIVE' || c.status === 'ONLINE').length
      const offN    = cameras.length - onlineN

      const camMini = cameras.slice(0, 4).map(c => {
        const dot = statusColor(c.status)
        return `<span style="
          display:inline-flex;align-items:center;gap:4px;padding:2px 6px;
          border-radius:9999px;background:#F8FAFC;border:1px solid #E2E8F0;
          font-size:10px;color:#475569;margin-right:4px;margin-top:4px;
        ">
          <span style="width:6px;height:6px;border-radius:50%;background:${dot};"></span>
          ${escapeHtml(c.name)}
        </span>`
      }).join('')
      const moreN = cameras.length > 4 ? cameras.length - 4 : 0

      return `
        <div style="min-width:240px;font-family:ui-sans-serif,system-ui,sans-serif;">
          ${previewBlock}
          <div style="font-weight:bold;font-size:13px;color:#0F172A;margin-bottom:2px;">
            ${escapeHtml(site.name)}
          </div>
          <div style="font-size:11px;color:#64748B;margin-bottom:6px;">
            ${escapeHtml(site.clienteFinal?.name ?? '—')}
            ${site.city ? ` · ${escapeHtml(site.city)}${site.state ? '/' + escapeHtml(site.state) : ''}` : ''}
          </div>
          <div style="display:flex;gap:6px;align-items:center;font-size:10px;margin-bottom:6px;">
            <span style="
              padding:2px 8px;border-radius:9999px;
              background:#06B6D422;color:#06B6D4;
              border:1px solid #06B6D455;font-weight:600;
            ">${cameraCount} câmera${cameraCount === 1 ? '' : 's'}</span>
            ${onlineN ? `<span style="
              padding:2px 8px;border-radius:9999px;
              background:#10B98122;color:#059669;
              border:1px solid #10B98155;font-weight:600;
            ">${onlineN} online</span>` : ''}
            ${offN ? `<span style="
              padding:2px 8px;border-radius:9999px;
              background:#F59E0B22;color:#D97706;
              border:1px solid #F59E0B55;font-weight:600;
            ">${offN} offline</span>` : ''}
          </div>
          ${camMini ? `<div style="margin-bottom:8px;">${camMini}${moreN ? `<span style="font-size:10px;color:#94A3B8;">+ ${moreN}</span>` : ''}</div>` : ''}
          ${firstCam ? `<a href="/cameras/${firstCam.id}" style="
            display:inline-block;padding:6px 12px;border-radius:6px;
            background:#06B6D4;color:white;text-decoration:none;
            font-size:11px;font-weight:600;margin-right:6px;
          ">Abrir 1ª câmera →</a>` : ''}
          ${editable ? `<div style="font-size:9px;color:#7C3AED;margin-top:6px;font-style:italic;">
            ${isMulti ? '✓ selecionado · arraste para mover juntos' : 'Arraste · Shift+click multi-select'}
          </div>` : ''}
        </div>
      `
    }

    m.bindPopup(buildPopupHtml(null), {
      closeButton: false,
      closeOnClick: false,
      autoClose: false,
      autoPan: false,
      offset: L.point(0, -8),
    })

    // Auto-close em hover (paridade Monuv): mouseover abre, mouseout fecha
    // após 400ms (cancelado se mouse entrar no popup).
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    const cancelClose = () => { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null } }
    const scheduleClose = (delay = 400) => {
      cancelClose()
      closeTimer = setTimeout(() => {
        if (m.isPopupOpen()) m.closePopup()
      }, delay)
    }

    function onMouseOver() {
      cancelClose()
      // se já tem cache → renderiza com snapshot direto. Senão placeholder
      // skeleton + fetch async que troca o conteúdo.
      const cached = firstCam ? SITE_SNAPSHOT_CACHE.get(firstCam.id) : null
      if (cached && Date.now() - cached.at < 50_000) {
        m.setPopupContent(buildPopupHtml(cached.url))
      }
      m.openPopup()
      if (firstCam && (!cached || Date.now() - cached.at >= 50_000)) {
        fetchSiteSnapshotUrl(firstCam.id).then(url => {
          if (url && m.isPopupOpen()) {
            m.setPopupContent(buildPopupHtml(url))
          }
        })
      }
    }
    function onMouseOut() {
      scheduleClose()
    }
    function onPopupOpen(ev: L.PopupEvent) {
      const popupEl = ev.popup.getElement()
      if (!popupEl) return
      popupEl.addEventListener('mouseenter', cancelClose)
      popupEl.addEventListener('mouseleave', () => scheduleClose())
    }

    m.on('mouseover', onMouseOver)
    m.on('mouseout',  onMouseOut)
    m.on('popupopen', onPopupOpen)
    return () => {
      cancelClose()
      m.off('mouseover', onMouseOver)
      m.off('mouseout',  onMouseOut)
      m.off('popupopen', onPopupOpen)
      m.unbindPopup()
    }
    // Quando cameras (lista) muda, rebinda pra refletir status atualizado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, site.name, site.clienteFinal?.name, site.city, site.state,
      cameraCount, isMulti, editable, firstCam?.id, cameras.length])

  return (
    <Marker
      ref={markerRef as any}
      position={[lat, lng]}
      icon={icon}
      draggable={editable}
      eventHandlers={{
        click: (e) => {
          const orig = e.originalEvent as MouseEvent
          onClick(!!orig?.shiftKey)
        },
        dragstart: () => onDragStart(),
        dragend: (e) => {
          const m = e.target as L.Marker
          const latlng = m.getLatLng()
          onDragEnd(latlng.lat, latlng.lng)
        },
      }}
    />
  )
}

// ── Floating Tools (top-right): tile switcher + heatmap + measure ────────

function FloatingTools({
  tileMode, onTileChange, heatmapOn, onToggleHeatmap, measureOn, onToggleMeasure,
}: {
  tileMode: TileMode
  onTileChange: (m: TileMode) => void
  heatmapOn: boolean
  onToggleHeatmap: () => void
  measureOn: boolean
  onToggleMeasure: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="absolute top-3 right-3 z-[1000] flex items-start gap-2">
      {/* Painel principal */}
      <div className={cn(
        'rounded-xl border shadow-2xl backdrop-blur-md overflow-hidden transition-all',
        'bg-white/95 border-slate-200',
        'dark:bg-space-900/90 dark:border-white/10',
      )}>
        {/* Tile chips */}
        {!collapsed && (
          <div className="p-2 border-b border-slate-200/70 dark:border-white/5">
            <div className="text-[9px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-500 mb-1.5 px-1">
              Camada
            </div>
            <div className="flex gap-1">
              {(Object.keys(TILE_LAYERS) as TileMode[]).map(mode => {
                const Icon   = TILE_LAYERS[mode].icon
                const active = tileMode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onTileChange(mode)}
                    title={TILE_LAYERS[mode].label}
                    className={cn(
                      'flex-1 flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition border',
                      active
                        ? 'bg-gradient-to-br from-cyan-500 to-violet-500 text-white border-transparent shadow-md'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/5 dark:hover:bg-white/10 dark:text-slate-400 dark:border-white/10',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="leading-tight">{TILE_LAYERS[mode].label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Tools */}
        {!collapsed && (
          <div className="p-2 space-y-1">
            <ToolToggle
              icon={Flame}
              label="Heatmap"
              sublabel="Eventos 24h"
              active={heatmapOn}
              activeColor="rose"
              onClick={onToggleHeatmap}
            />
            <ToolToggle
              icon={Ruler}
              label="Medir"
              sublabel="Régua de distância"
              active={measureOn}
              activeColor="cyan"
              onClick={onToggleMeasure}
            />
          </div>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        title={collapsed ? 'Expandir' : 'Recolher'}
        className={cn(
          'rounded-xl border shadow-lg backdrop-blur-md p-2 transition',
          'bg-white/95 border-slate-200 hover:bg-slate-100',
          'dark:bg-space-900/90 dark:border-white/10 dark:hover:bg-white/5',
        )}
      >
        <Layers className={cn('w-4 h-4 transition', collapsed ? 'text-cyan-500' : 'text-slate-500 dark:text-slate-400')} />
      </button>
    </div>
  )
}

function ToolToggle({
  icon: Icon, label, sublabel, active, activeColor, onClick,
}: {
  icon:        any
  label:       string
  sublabel:    string
  active:      boolean
  activeColor: 'rose' | 'cyan'
  onClick:     () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition border',
        active
          ? activeColor === 'rose'
            ? 'bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-500/15 dark:border-rose-500/40 dark:text-rose-300'
            : 'bg-cyan-100 border-cyan-300 text-cyan-800 dark:bg-cyan-500/15 dark:border-cyan-500/40 dark:text-cyan-300'
          : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-slate-400',
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="flex flex-col leading-tight">
        <span className="text-[11px] font-semibold">{label}</span>
        <span className="text-[9px] opacity-70">{sublabel}</span>
      </span>
      <span className={cn(
        'ml-auto w-7 h-3.5 rounded-full transition relative',
        active
          ? activeColor === 'rose' ? 'bg-rose-500' : 'bg-cyan-500'
          : 'bg-slate-300 dark:bg-white/15',
      )}>
        <span className={cn(
          'absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-all',
          active ? 'left-3.5' : 'left-0.5',
        )} />
      </span>
    </button>
  )
}

// ── Régua de distância ────────────────────────────────────────────────────

/** Calcula distância em metros usando Haversine (Leaflet provê via LatLng.distanceTo). */
function totalDistance(points: MeasurePoint[]): number {
  if (points.length < 2) return 0
  let dist = 0
  for (let i = 1; i < points.length; i++) {
    const a = L.latLng(points[i - 1].lat, points[i - 1].lng)
    const b = L.latLng(points[i].lat, points[i].lng)
    dist += a.distanceTo(b)
  }
  return dist
}

function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`
}

function MeasureLayer({
  points, onAddPoint,
}: {
  points: MeasurePoint[]
  onAddPoint: (p: MeasurePoint) => void
}) {
  useMapEvents({
    click(e) {
      // ignora clicks em pins de site (handler próprio do Marker dispara antes)
      const target = e.originalEvent.target as HTMLElement
      if (target?.closest('.leaflet-marker-icon')) return
      onAddPoint({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })

  if (points.length === 0) return null

  const positions = points.map(p => [p.lat, p.lng] as [number, number])

  return (
    <>
      <Polyline
        positions={positions}
        pathOptions={{
          color: '#06B6D4',
          weight: 3,
          opacity: 0.9,
          dashArray: '6 6',
        }}
      />
      {points.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat, p.lng]}
          radius={6}
          pathOptions={{
            color: '#0891B2',
            fillColor: '#06B6D4',
            fillOpacity: 1,
            weight: 2,
          }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]} className="icv-measure-tooltip">
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, fontWeight: 600 }}>
              {i === 0 ? 'A' : i === points.length - 1 ? `B · ${fmtDistance(totalDistance(points))}` : `${i + 1}`}
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  )
}

function MeasureBadge({
  points, onClear, onClose,
}: {
  points: MeasurePoint[]
  onClear: () => void
  onClose: () => void
}) {
  const dist = totalDistance(points)
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="absolute bottom-4 left-4 z-[1000]"
    >
      <div className={cn(
        'flex items-center gap-3 px-4 py-2.5 rounded-full backdrop-blur-md shadow-2xl border-2',
        'bg-cyan-50/95 border-cyan-300 dark:bg-cyan-950/90 dark:border-cyan-500/50',
      )}>
        <Ruler className="w-4 h-4 text-cyan-700 dark:text-cyan-300" />
        <div className="flex flex-col">
          <span className="text-xs font-bold text-cyan-900 dark:text-cyan-200 font-mono">
            {points.length < 2 ? 'Clique no mapa para medir' : fmtDistance(dist)}
          </span>
          <span className="text-[10px] text-cyan-700 dark:text-cyan-400/80">
            {points.length === 0
              ? 'A → B'
              : points.length === 1
                ? '1 ponto · click pra próximo'
                : `${points.length} pontos · ESC encerra`}
          </span>
        </div>
        {points.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="px-2 py-0.5 rounded-full bg-cyan-200 hover:bg-cyan-300 dark:bg-white/10 dark:hover:bg-white/20 text-[10px] font-semibold text-cyan-900 dark:text-cyan-200 flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Limpar
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-full hover:bg-cyan-200 dark:hover:bg-white/10 text-cyan-700 dark:text-cyan-300"
          aria-label="Fechar régua"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  )
}

// ── Heatmap de eventos ────────────────────────────────────────────────────

/**
 * Renderiza "blobs" de calor sobre os sites baseado em # de eventos das
 * últimas 24h. Em vez de leaflet.heat (dep nova), usamos CircleMarker com
 * radius proporcional à intensidade — visualmente equivalente, zero deps.
 *
 * Intensidade:
 *   • 0 eventos       → não desenha
 *   • 1-3 eventos     → cyan (calmo)
 *   • 4-15            → amber
 *   • 16+             → rose (alerta)
 *
 * Raio escala em pixels (independent de zoom — Leaflet CircleMarker), 24-72px.
 */
function HeatmapBlobs({ sites, cameras }: { sites: SiteWithGeo[]; cameras: any[] }) {
  // Eventos das últimas 24h. SWR cacheia entre toggles do heatmap.
  const since = useMemo(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), [])
  const { data: events } = useReviewItems({ since, pageSize: '500' })

  // Agrega: count por siteId via cameraId → site lookup.
  const siteCount = useMemo(() => {
    const camToSite = new Map<string, string>()
    cameras.forEach(c => { if (c.site?.id) camToSite.set(c.id, c.site.id) })
    const counts = new Map<string, number>()
    const items: any[] = (events as any)?.items ?? []
    for (const ev of items) {
      const sid = camToSite.get(ev.cameraId)
      if (!sid) continue
      counts.set(sid, (counts.get(sid) ?? 0) + 1)
    }
    return counts
  }, [events, cameras])

  return (
    <>
      {sites.map(s => {
        const count = siteCount.get(s.id) ?? 0
        if (count === 0) return null
        const tier =
          count >= 16 ? { color: '#F43F5E', radius: 56 + Math.min(20, count - 16) }
        : count >= 4  ? { color: '#F59E0B', radius: 36 + (count - 4) * 1.5 }
        :               { color: '#06B6D4', radius: 24 + count * 2 }

        return (
          <CircleMarker
            key={s.id}
            center={[s.latitude!, s.longitude!]}
            radius={tier.radius}
            pathOptions={{
              color: tier.color,
              fillColor: tier.color,
              fillOpacity: 0.22,
              weight: 1,
              opacity: 0.5,
            }}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
              <div style={{ fontFamily: 'ui-sans-serif,system-ui,sans-serif', fontSize: 11, lineHeight: 1.3 }}>
                <div style={{ fontWeight: 700, color: '#0F172A' }}>{s.name}</div>
                <div style={{ color: '#64748B', fontSize: 10 }}>
                  {count} evento{count === 1 ? '' : 's'} nas últimas 24h
                </div>
              </div>
            </Tooltip>
          </CircleMarker>
        )
      })}
    </>
  )
}

// ── Multi-select toolbar ──────────────────────────────────────────────────

function MultiSelectToolbar({ count, onClear }: { count: number; onClear: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[999]"
    >
      <div className={cn(
        'flex items-center gap-3 px-4 py-2.5 rounded-full backdrop-blur-md shadow-2xl border-2',
        'bg-violet-50/95 border-violet-300 dark:bg-violet-950/90 dark:border-violet-500/50',
      )}>
        <MousePointer2 className="w-4 h-4 text-violet-700 dark:text-violet-300" />
        <div className="flex flex-col">
          <span className="text-xs font-bold text-violet-900 dark:text-violet-200">
            {count} site{count === 1 ? '' : 's'} selecionado{count === 1 ? '' : 's'}
          </span>
          <span className="text-[10px] text-violet-700 dark:text-violet-400/80">
            Arraste qualquer pin pra mover juntos · Shift+click adiciona/remove
          </span>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="px-2.5 py-1 rounded-full bg-violet-200 hover:bg-violet-300 dark:bg-white/10 dark:hover:bg-white/20 text-[11px] font-semibold text-violet-900 dark:text-violet-200 flex items-center gap-1"
        >
          <X className="w-3 h-3" /> Limpar
        </button>
      </div>
    </motion.div>
  )
}

// ── Geocoder ───────────────────────────────────────────────────────────────

function GeocoderForm({ onSubmit }: { onSubmit: (q: string) => Promise<string | null> }) {
  const [q, setQ]     = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true); setErr(null)
    try {
      const label = await onSubmit(q)
      if (!label) setErr('Endereço não encontrado')
      else setQ(label.split(',').slice(0, 3).join(', '))
    } catch {
      setErr('Falha — verifique conexão')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-1 flex-1 max-w-md">
      <div className="relative flex-1">
        <Compass className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setErr(null) }}
          placeholder="Buscar endereço (ex: Av Paulista, SP)"
          className={cn(
            'w-full pl-8 pr-3 py-1.5 text-xs rounded-md border focus:outline-none transition',
            'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-cyan-500',
            'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500 dark:focus:border-cyan-500/50',
          )}
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(''); setErr(null) }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300"
            aria-label="Limpar"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <button
        type="submit"
        disabled={busy || !q.trim()}
        className={cn(
          'px-3 py-1.5 rounded-md border text-xs font-semibold disabled:opacity-40',
          'bg-cyan-100 hover:bg-cyan-200 border-cyan-300 text-cyan-700',
          'dark:bg-cyan-500/20 dark:hover:bg-cyan-500/30 dark:border-cyan-500/40 dark:text-cyan-200',
        )}
      >
        {busy ? '…' : 'Ir'}
      </button>
      {err && <p className="absolute mt-12 text-[10px] text-rose-700 dark:text-rose-400">{err}</p>}
    </form>
  )
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ background: dot }} />
      {label}
    </span>
  )
}

// ── ConfirmActionPill (genérico) ───────────────────────────────────────────

function ConfirmActionPill({
  title, subtitle, onConfirm, onCancel, busy, accent,
}: {
  title:    string
  subtitle: string
  onConfirm: () => void
  onCancel:  () => void
  busy:      boolean
  accent:    'amber' | 'violet'
}) {
  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2.5 rounded-full backdrop-blur-md shadow-2xl border-2',
      accent === 'amber'
        ? 'bg-amber-50/95 border-amber-300 dark:bg-amber-950/90 dark:border-amber-500/50'
        : 'bg-violet-50/95 border-violet-300 dark:bg-violet-950/90 dark:border-violet-500/50',
    )}>
      <div className="flex flex-col">
        <span className={cn(
          'text-xs font-bold',
          accent === 'amber' ? 'text-amber-900 dark:text-amber-200' : 'text-violet-900 dark:text-violet-200',
        )}>
          {title}
        </span>
        <span className={cn(
          'text-[10px] font-mono',
          accent === 'amber' ? 'text-amber-700 dark:text-amber-400/80' : 'text-violet-700 dark:text-violet-400/80',
        )}>
          {subtitle}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-2.5 py-1 rounded-full bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/20 text-[11px] font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={cn(
            'px-3 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 disabled:opacity-50',
            accent === 'amber'
              ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-500/30'
              : 'bg-violet-500 hover:bg-violet-600 text-white shadow-md shadow-violet-500/30',
          )}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Salvar
        </button>
      </div>
    </div>
  )
}

// ── Modal: Criar site clicando no mapa ────────────────────────────────────

function CreateSiteModal({
  lat, lng, clientes, onClose, onCreated,
}: {
  lat:        number
  lng:        number
  clientes:   ClienteFinalRow[]
  onClose:    () => void
  onCreated:  () => void
}) {
  const [name,           setName]           = useState('')
  const [clienteFinalId, setClienteFinalId] = useState(clientes[0]?.id ?? '')
  const [address,        setAddress]        = useState('')
  const [city,           setCity]           = useState('')
  const [state,          setState]          = useState('')
  const [busy,           setBusy]           = useState(false)
  const [err,            setErr]            = useState<string | null>(null)
  const [reverseBusy,    setReverseBusy]    = useState(true)

  // Reverse-geocoding para sugerir endereço
  useEffect(() => {
    const ctrl = new AbortController()
    async function run() {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
        const r = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
        if (!r.ok) return
        const d = await r.json()
        const a = d.address ?? {}
        const road     = a.road ?? a.pedestrian ?? a.footway ?? ''
        const houseNum = a.house_number ?? ''
        const suburb   = a.suburb ?? a.neighbourhood ?? a.city_district ?? ''
        const cityName = a.city ?? a.town ?? a.village ?? a.municipality ?? ''
        const stateAcr = a['ISO3166-2-lvl4']?.split('-')[1] ?? a.state ?? ''
        setAddress([road, houseNum, suburb].filter(Boolean).join(', '))
        setCity(cityName)
        setState(stateAcr)
      } catch { /* offline / abort — silencia */ }
      finally  { setReverseBusy(false) }
    }
    run()
    return () => ctrl.abort()
  }, [lat, lng])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !clienteFinalId) return
    setBusy(true); setErr(null)
    try {
      await createSite({
        name:           name.trim(),
        clienteFinalId,
        address:        address || undefined,
        city:           city    || undefined,
        state:          state   || undefined,
        latitude:       lat,
        longitude:      lng,
      })
      onCreated()
    } catch (e: any) {
      setErr(formatApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[2000] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 16 }}
        transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
        onClick={e => e.stopPropagation()}
        className={cn(
          'w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden',
          'bg-white border-slate-200',
          'dark:bg-space-900 dark:border-white/10',
        )}
      >
        {/* Header gradient */}
        <div className="relative px-5 py-4 bg-gradient-to-br from-cyan-500/10 via-violet-500/10 to-fuchsia-500/10 border-b border-slate-200 dark:border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 p-1 rounded-md hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Plus className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            Criar site aqui
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
            📍 {lat.toFixed(6)}, {lng.toFixed(6)}
          </p>
          {reverseBusy && (
            <p className="text-[10px] text-cyan-600 dark:text-cyan-400 mt-1 flex items-center gap-1">
              <Loader2 className="w-2.5 h-2.5 animate-spin" /> Buscando endereço…
            </p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <Field label="Nome do site" required>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Loja Centro / Galpão A / Bloco 1"
              className={cn(
                'w-full px-3 py-2 text-sm rounded-md border focus:outline-none',
                'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-cyan-500',
                'dark:bg-white/5 dark:border-white/10 dark:text-white dark:focus:border-cyan-500/50',
              )}
            />
          </Field>

          <Field label="Cliente final" required>
            <select
              value={clienteFinalId}
              onChange={e => setClienteFinalId(e.target.value)}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-md border focus:outline-none',
                'bg-slate-50 border-slate-200 text-slate-900 focus:border-cyan-500',
                'dark:bg-white/5 dark:border-white/10 dark:text-white dark:focus:border-cyan-500/50',
              )}
            >
              {clientes.length === 0 && <option value="">— sem clientes —</option>}
              {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>

          <Field label="Endereço">
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Rua, número, bairro"
              className={cn(
                'w-full px-3 py-2 text-sm rounded-md border focus:outline-none',
                'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-cyan-500',
                'dark:bg-white/5 dark:border-white/10 dark:text-white dark:focus:border-cyan-500/50',
              )}
            />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Field label="Cidade">
                <input
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  className={cn(
                    'w-full px-3 py-2 text-sm rounded-md border focus:outline-none',
                    'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-cyan-500',
                    'dark:bg-white/5 dark:border-white/10 dark:text-white dark:focus:border-cyan-500/50',
                  )}
                />
              </Field>
            </div>
            <Field label="UF">
              <input
                value={state}
                onChange={e => setState(e.target.value.toUpperCase().slice(0, 2))}
                maxLength={2}
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-md border focus:outline-none uppercase',
                  'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-cyan-500',
                  'dark:bg-white/5 dark:border-white/10 dark:text-white dark:focus:border-cyan-500/50',
                )}
              />
            </Field>
          </div>

          {err && (
            <div className="p-2 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-1.5 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {err}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim() || !clienteFinalId}
              className="ml-auto px-4 py-2 rounded-md bg-gradient-to-r from-cyan-500 to-violet-500 text-white text-sm font-semibold flex items-center gap-1.5 shadow-lg shadow-cyan-500/30 hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Criar site
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1 inline-block">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
    </label>
  )
}

// ── Drawer: detalhes do site selecionado ──────────────────────────────────

function SiteDrawer({
  site, cameras, onClose,
}: {
  site:    SiteWithGeo
  cameras: any[]
  onClose: () => void
}) {
  const onlineCount = cameras.filter(c => c.status === 'ACTIVE' || c.status === 'ONLINE').length
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <motion.div
      initial={{ x: 360, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 360, opacity: 0 }}
      transition={{ type: 'spring', bounce: 0.18, duration: 0.4 }}
      className={cn(
        'absolute top-0 right-0 bottom-0 w-[340px] z-[900] overflow-y-auto',
        'border-l shadow-2xl',
        'bg-white border-slate-200',
        'dark:bg-space-900/95 dark:border-white/10 dark:backdrop-blur',
      )}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-3 border-b bg-gradient-to-r from-cyan-500/10 to-violet-500/10 border-slate-200 dark:border-white/5">
        <div className="flex items-start gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{site.name}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {site.clienteFinal?.name ?? '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Câmeras"   value={cameras.length} accent="cyan" />
          <Stat label="Online"    value={onlineCount}    accent="emerald" />
          <Stat label="Offline"   value={cameras.length - onlineCount} accent="slate" />
        </div>
      </div>

      {/* Endereço + coords */}
      <div className="p-4 space-y-3 border-b border-slate-200 dark:border-white/5">
        {(site.address || site.city) && (
          <div className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
            <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
            <span>
              {site.address}
              {site.city && (site.address ? ' · ' : '') + `${site.city}${site.state ? `/${site.state}` : ''}`}
            </span>
          </div>
        )}
        {site.latitude != null && site.longitude != null && (
          <div className="text-[10px] font-mono text-cyan-700 dark:text-cyan-400/90">
            {site.latitude.toFixed(6)}, {site.longitude.toFixed(6)}
          </div>
        )}
      </div>

      {/* Lista de câmeras */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-500">
            Câmeras deste site
          </h4>
          <Link
            to={`/cameras?site=${site.id}`}
            className="text-[10px] text-cyan-700 dark:text-cyan-400 hover:underline flex items-center gap-0.5"
          >
            Adicionar <Plus className="w-3 h-3" />
          </Link>
        </div>

        {cameras.length === 0 ? (
          <div className="text-[11px] text-slate-500 text-center py-4 bg-slate-50 dark:bg-white/[0.03] rounded-md">
            Nenhuma câmera neste site.<br />
            <Link to={`/cameras?site=${site.id}`} className="text-cyan-700 dark:text-cyan-400 hover:underline">
              Adicionar câmera →
            </Link>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {cameras.map(cam => (
              <li key={cam.id}>
                <Link
                  to={`/cameras/${cam.id}`}
                  className="flex items-center gap-2 p-2 rounded-md bg-slate-50 hover:bg-slate-100 border border-slate-200 dark:bg-white/[0.03] dark:hover:bg-white/[0.06] dark:border-white/5 transition group"
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: statusColor(cam.status) }}
                  />
                  <CameraIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate text-slate-900 dark:text-white">{cam.name}</p>
                    <p className="text-[10px] truncate text-slate-500 dark:text-slate-500">
                      {cam.status} {cam.ingestMode && `· ${cam.ingestMode}`}
                    </p>
                  </div>
                  <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-4 border-t border-slate-200 dark:border-white/5 space-y-2">
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="w-full px-3 py-2 rounded-md bg-violet-50 hover:bg-violet-100 border border-violet-300 text-violet-700 dark:bg-violet-500/10 dark:hover:bg-violet-500/20 dark:border-violet-500/30 dark:text-violet-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
        >
          <History className="w-3.5 h-3.5" /> Histórico de mudanças
        </button>
        <Link
          to={`/cameras?site=${site.id}`}
          className="w-full px-3 py-2 rounded-md bg-cyan-50 hover:bg-cyan-100 border border-cyan-300 text-cyan-700 dark:bg-cyan-500/10 dark:hover:bg-cyan-500/20 dark:border-cyan-500/30 dark:text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
        >
          <CameraIcon className="w-3.5 h-3.5" /> Gerenciar câmeras
        </Link>
        <Link
          to="/sites"
          className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 text-xs font-medium flex items-center justify-center gap-1.5 transition"
        >
          <Eye className="w-3.5 h-3.5" /> Detalhes do site
        </Link>
      </div>

      <AnimatePresence>
        {historyOpen && (
          <SiteHistorySheet
            siteId={site.id}
            siteName={site.name}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Histórico de mudanças do site ─────────────────────────────────────────

function SiteHistorySheet({
  siteId, siteName, onClose,
}: {
  siteId:   string
  siteName: string
  onClose:  () => void
}) {
  const { data, isLoading, error } = useSiteHistory(siteId)
  const items = data?.items ?? []

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[2000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 16 }}
        transition={{ type: 'spring', bounce: 0.18, duration: 0.4 }}
        onClick={e => e.stopPropagation()}
        className={cn(
          'w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden',
          'bg-white border-slate-200',
          'dark:bg-space-900 dark:border-white/10',
        )}
      >
        {/* Header */}
        <div className="relative px-5 py-4 bg-gradient-to-br from-violet-500/10 via-cyan-500/10 to-fuchsia-500/10 border-b border-slate-200 dark:border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 p-1 rounded-md hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <History className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            Histórico de mudanças
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            <strong>{siteName}</strong> · últimas {data?.total ?? 0} alterações
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="text-center py-12 text-slate-500 text-sm flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Carregando histórico…
            </div>
          )}
          {error && (
            <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-1.5 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Falha ao carregar histórico — verifique conexão
            </div>
          )}
          {!isLoading && !error && items.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">
              <History className="w-8 h-8 mx-auto mb-2 text-slate-400 dark:text-slate-600" />
              Sem alterações registradas ainda.
            </div>
          )}
          <ol className="relative space-y-3">
            {items.map((entry, idx) => (
              <HistoryEntry key={entry.id} entry={entry} isLatest={idx === 0} />
            ))}
          </ol>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-white/5 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-500">
          <span>Auditoria · LGPD compliance</span>
          <span className="font-mono">{items.length} de {data?.total ?? 0}</span>
        </div>
      </motion.div>
    </motion.div>
  )
}

function HistoryEntry({ entry, isLatest }: { entry: SiteHistoryEntry; isLatest: boolean }) {
  const diff = entry.metadataJson?.diff ?? {}
  const changedKeys = Object.keys(diff)
  const actorName =
    entry.user?.name        ??
    entry.user?.email       ??
    entry.superAdmin?.email ??
    entry.integrador?.name  ??
    entry.clienteFinal?.name ??
    'sistema'
  const actorRole =
    entry.user?.role
      || (entry.superAdmin   ? 'SUPER_ADMIN' : '')
      || (entry.integrador   ? 'INTEGRADOR'  : '')
      || (entry.clienteFinal ? 'CLIENTE'     : '')
  const dt = new Date(entry.createdAt)
  const dateStr = dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })

  // Detecta tipo de alteração pra colorir o card.
  const isMove =
    'latitude' in diff || 'longitude' in diff
  const isAddress =
    'address' in diff || 'city' in diff || 'state' in diff
  const accentClass =
    isMove
      ? 'border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/5'
      : isAddress
        ? 'border-cyan-300 bg-cyan-50 dark:border-cyan-500/30 dark:bg-cyan-500/5'
        : 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03]'

  return (
    <li className={cn('relative pl-6')}>
      {/* Linha do tempo */}
      <span className={cn(
        'absolute left-2 top-1.5 w-2.5 h-2.5 rounded-full ring-4',
        isLatest
          ? 'bg-violet-500 ring-violet-500/20 animate-pulse'
          : 'bg-slate-300 ring-slate-300/30 dark:bg-slate-500 dark:ring-slate-500/30',
      )} />
      <span className="absolute left-3 top-5 bottom-0 w-px bg-slate-200 dark:bg-white/10" />

      <div className={cn('rounded-lg border p-3 transition', accentClass)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-slate-900 dark:text-white">{actorName}</span>
              {actorRole && (
                <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-[9px] font-mono text-slate-600 dark:text-slate-400">
                  {actorRole}
                </span>
              )}
              {isLatest && (
                <span className="px-1.5 py-0.5 rounded bg-violet-200 dark:bg-violet-500/20 text-[9px] font-bold text-violet-700 dark:text-violet-300">
                  MAIS RECENTE
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5 font-mono">
              {dateStr} {entry.ipAddress && `· ${entry.ipAddress}`}
            </p>
          </div>
        </div>

        {changedKeys.length > 0 && (
          <ul className="mt-2 space-y-1">
            {changedKeys.slice(0, 6).map(k => {
              const change = diff[k]
              return (
                <li key={k} className="text-[11px] text-slate-700 dark:text-slate-300 leading-tight flex items-start gap-1">
                  <span className="font-mono font-semibold text-violet-700 dark:text-violet-400 shrink-0">{k}:</span>
                  <span className="font-mono text-slate-500 dark:text-slate-500 line-through">
                    {fmtChange(change.from)}
                  </span>
                  <ArrowRight className="w-2.5 h-2.5 text-slate-400 shrink-0 mt-0.5" />
                  <span className="font-mono text-emerald-700 dark:text-emerald-400">
                    {fmtChange(change.to)}
                  </span>
                </li>
              )
            })}
            {changedKeys.length > 6 && (
              <li className="text-[10px] text-slate-500 italic">
                + {changedKeys.length - 6} outras alterações
              </li>
            )}
          </ul>
        )}
        {changedKeys.length === 0 && (
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500 italic">
            {entry.action}
          </p>
        )}
      </div>
    </li>
  )
}

function fmtChange(v: any): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'number') return v.toFixed(v % 1 === 0 ? 0 : 5)
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  return String(v).slice(0, 32)
}

function Stat({ label, value, accent }: { label: string; value: number; accent: 'cyan' | 'emerald' | 'slate' }) {
  const cls = {
    cyan:    'text-cyan-700    dark:text-cyan-400',
    emerald: 'text-emerald-700 dark:text-emerald-400',
    slate:   'text-slate-700   dark:text-slate-400',
  }[accent]
  return (
    <div className="rounded-md bg-white/60 dark:bg-white/[0.04] py-2 border border-slate-200 dark:border-white/5">
      <div className={cn('text-lg font-bold', cls)}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-500">{label}</div>
    </div>
  )
}

// ── Synoptic skeleton (suspense fallback) ─────────────────────────────────

function SynopticSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden"
        >
          <div className="h-40 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-white/5 dark:to-white/10 animate-pulse" />
          <div className="p-4 space-y-2">
            <div className="h-3 w-2/3 bg-slate-200 dark:bg-white/10 animate-pulse rounded" />
            <div className="h-2 w-1/3 bg-slate-200 dark:bg-white/10 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
