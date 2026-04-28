/**
 * CameraMapPage — paridade Monuv /camera/map (versão real)
 *
 * Substitui o placeholder anterior por mapa Leaflet com:
 *   • Tiles CartoDB Dark Matter (alinhado ao tema do dashboard)
 *   • Marker clustering automático (até 36 tiles em SP sem virar mancha visual)
 *   • Pin colorido por status (verde/âmbar/vermelho/cinza)
 *   • Popup com nome + site + link "Abrir câmera"
 *   • Geocoder Nominatim (open-source, gratuito) pra buscar endereço
 *   • Sidebar: busca por nome + filtro por site + filtro por modo de ingestão
 *   • Click na sidebar → flyTo + abre popup
 *
 * Bug-fix vs versão anterior: coords vêm de `camera.site.latitude/longitude`
 * (Site é geolocalizado, não Camera). A versão antiga lia `camera.latitude`,
 * que não existe no schema — todas as câmeras apareciam "sem geoloc".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import {
  Map as MapIcon, ArrowLeft, Search, MapPin, Camera as CameraIcon,
  Filter, ExternalLink, Compass, X,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useCameras, snapshotCamera, BASE_URL } from '../api/client'
import { cn } from '../lib/utils'

// ── Snapshot cache + helper pra preview no popup ──────────────────────────
//
// Cada câmera carregada no mapa pode ter ~10-20 hovers durante a sessão.
// Sem cache, cada hover dispara um spawn ffmpeg no backend (~5s+CPU).
// Cacheamos URL com ticket por 50s (ticket dura 60s no backend) — re-hover
// dentro da janela reusa a mesma URL.
const snapshotUrlCache = new Map<string, { url: string; at: number }>()

async function getSnapshotUrl(cameraId: string): Promise<string | null> {
  const cached = snapshotUrlCache.get(cameraId)
  if (cached && Date.now() - cached.at < 50_000) return cached.url
  try {
    const r = await snapshotCamera(cameraId)
    const path = (r as { snapshotUrl?: string })?.snapshotUrl
    if (!path) return null
    const url = `${BASE_URL}${path}`
    snapshotUrlCache.set(cameraId, { url, at: Date.now() })
    return url
  } catch {
    return null
  }
}

// ── Tipos auxiliares ─────────────────────────────────────────────────────
type CameraStatus = 'ACTIVE' | 'INACTIVE' | 'ERROR' | 'MAINTENANCE' | 'PENDING_CONFIG'
type IngestMode = 'RTSP_PULL' | 'RTMP_PUSH'

interface CameraGeo {
  id: string
  name: string
  status: CameraStatus
  ingestMode?: IngestMode
  lat: number
  lng: number
  site?: { id: string; name: string }
  location?: string | null
  // Vindos do Site (paridade Monuv: popup mostra endereço completo)
  address?: string | null
  city?: string | null
  state?: string | null
}

// Centro default = Sudeste do Brasil. Mais útil que centro geográfico
// (Brasília) porque a maioria das câmeras de cliente é em SP/RJ/MG/ES e
// a perspectiva já mostra o cluster sem precisar dar zoom-out depois.
// FitBounds reposiciona se houver câmeras com geoloc.
const BRAZIL_CENTER: [number, number] = [-22.0, -47.0]
const DEFAULT_ZOOM = 5
const FOCUS_ZOOM   = 16

// CartoDB Dark Matter — gratuito, alinhado ao tema dark da aplicação.
// Atribuição obrigatória (CC-BY 3.0).
const DARK_TILES_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const DARK_TILES_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
  'contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

// Cor por status — bate com paleta do resto da app
function statusColor(status: CameraStatus): string {
  switch (status) {
    case 'ACTIVE':         return '#10B981'  // emerald
    case 'ERROR':          return '#F43F5E'  // rose
    case 'INACTIVE':
    case 'MAINTENANCE':    return '#F59E0B'  // amber
    case 'PENDING_CONFIG': return '#94A3B8'  // slate
    default:               return '#94A3B8'
  }
}

// Cria DivIcon HTML colorido por status. Mais leve que carregar um SVG/PNG
// por câmera e permite gradiente/pulse quando ativa.
function buildIcon(camera: CameraGeo): L.DivIcon {
  const color = statusColor(camera.status)
  const isActive = camera.status === 'ACTIVE'
  return L.divIcon({
    html: `
      <div style="position:relative;width:24px;height:24px;">
        ${isActive ? `<div style="position:absolute;inset:-4px;border-radius:50%;background:${color};opacity:0.25;animation:pulse-marker 2s ease-out infinite;"></div>` : ''}
        <div style="
          width:24px;height:24px;border-radius:50%;
          background:${color};
          border:3px solid #0F172A;
          box-shadow:0 2px 8px rgba(0,0,0,0.5);
          display:flex;align-items:center;justify-content:center;
        ">
          <div style="width:6px;height:6px;border-radius:50%;background:white;"></div>
        </div>
      </div>
    `,
    className: 'icv-camera-marker',  // contorna default leaflet shadow
    iconSize:   [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  })
}

// ── Componente: camada de marcadores com cluster ─────────────────────────
//
// react-leaflet v5 não tem componente oficial pra MarkerClusterGroup. A
// `leaflet.markercluster` é uma lib imperativa do Leaflet vanilla. Aqui
// montamos o cluster em useEffect e gerenciamos o ciclo de vida.
//
// Comparado com react-leaflet-markercluster (que não suporta v5), é até
// mais leve e nos dá controle fino sobre o iconCreateFunction.
function CameraClusterLayer({
  cameras,
  onMarkerClick,
  registerFlyTo,
}: {
  cameras: CameraGeo[]
  onMarkerClick: (c: CameraGeo) => void
  registerFlyTo: (fn: (c: CameraGeo) => void) => void
}) {
  const map = useMap()
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null)
  const markerByIdRef = useRef<Map<string, L.Marker>>(new Map())

  useEffect(() => {
    // Cria o cluster com estilo cyan (override do amarelo padrão).
    const cluster = (L as any).markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 60,
      iconCreateFunction: (cl: any) => {
        const count = cl.getChildCount()
        const size = count < 10 ? 36 : count < 100 ? 44 : 52
        return L.divIcon({
          html: `
            <div style="
              width:${size}px;height:${size}px;border-radius:50%;
              background:rgba(6,182,212,0.85);
              border:3px solid rgba(255,255,255,0.4);
              display:flex;align-items:center;justify-content:center;
              color:white;font-weight:bold;font-size:${count < 10 ? 13 : count < 100 ? 14 : 15}px;
              font-family:ui-sans-serif,system-ui,sans-serif;
              box-shadow:0 4px 12px rgba(6,182,212,0.4);
            ">${count}</div>
          `,
          className: 'icv-cluster-marker',
          iconSize: [size, size],
        })
      },
    }) as L.MarkerClusterGroup

    clusterRef.current = cluster
    map.addLayer(cluster)

    // Helper que monta o HTML do popup. Ganha placeholder pra imagem
    // do preview — substituído async quando o snapshot carrega.
    //
    // Layout (paridade Monuv + melhoria visual):
    //   ┌──────────────────────────────┐
    //   │ [preview snapshot 240×135]   │
    //   │ Nome da câmera               │
    //   │ Site Name · location hint    │
    //   │ [STATUS] [INGEST_MODE]       │
    //   │ 📍 Rua, Cidade - UF          │
    //   │ [ Abrir câmera → ]           │
    //   └──────────────────────────────┘
    const buildPopupHTML = (c: CameraGeo, snapshotUrl: string | null) => {
      const previewBlock = snapshotUrl
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
           ">
             <span>Capturando snapshot…</span>
           </div>`

      // Endereço completo só aparece se Site estiver geo-cadastrado.
      // Formato: "Rua X, 123 - Bairro, Cidade - UF"
      const addrParts: string[] = []
      if (c.address) addrParts.push(c.address)
      const cityState = [c.city, c.state].filter(Boolean).join(' - ')
      if (cityState) addrParts.push(cityState)
      const addrLine = addrParts.join(', ')

      return `
        <div style="min-width:240px;font-family:ui-sans-serif,system-ui,sans-serif;">
          ${previewBlock}
          <div style="font-weight:bold;font-size:13px;color:#0F172A;margin-bottom:4px;">
            ${escapeHtml(c.name)}
          </div>
          <div style="font-size:11px;color:#64748B;margin-bottom:6px;">
            ${escapeHtml(c.site?.name ?? 'Sem site')}
            ${c.location ? ` &middot; ${escapeHtml(c.location)}` : ''}
          </div>
          <div style="display:flex;gap:6px;align-items:center;font-size:10px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="
              padding:2px 8px;border-radius:9999px;
              background:${statusColor(c.status)}22;
              color:${statusColor(c.status)};
              border:1px solid ${statusColor(c.status)}55;
              font-weight:600;
            ">${c.status}</span>
            ${c.ingestMode ? `<span style="
              padding:2px 8px;border-radius:9999px;
              background:#06B6D422;color:#06B6D4;
              border:1px solid #06B6D455;font-weight:600;
            ">${c.ingestMode === 'RTMP_PUSH' ? 'RTMP push' : 'RTSP pull'}</span>` : ''}
          </div>
          ${addrLine ? `
            <div style="font-size:10px;color:#475569;margin-bottom:8px;display:flex;gap:4px;line-height:1.3;">
              <span style="flex-shrink:0;">📍</span>
              <span>${escapeHtml(addrLine)}</span>
            </div>
          ` : ''}
          <a href="/cameras/${c.id}" style="
            display:inline-block;padding:6px 12px;border-radius:6px;
            background:#06B6D4;color:white;text-decoration:none;
            font-size:11px;font-weight:600;
          ">Abrir câmera →</a>
        </div>
      `
    }

    // Auto-close UX (paridade Monuv estilo tooltip):
    //   mouseout marker → agenda fechamento em 400ms
    //   mouseover marker → cancela fechamento + re-abre se já fechou
    //   mouseenter popup → cancela fechamento (operador está lendo)
    //   mouseleave popup → agenda fechamento em 400ms
    //
    // Resultado: popup só fecha quando mouse sai DEFINITIVAMENTE da
    // dupla marker+popup. UX padrão de tooltip CSS pure.
    const closeTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const cancelClose = (id: string) => {
      const t = closeTimers.get(id)
      if (t) { clearTimeout(t); closeTimers.delete(id) }
    }
    const scheduleClose = (id: string, m: L.Marker, delay = 400) => {
      cancelClose(id)
      closeTimers.set(id, setTimeout(() => {
        if (m.isPopupOpen()) m.closePopup()
        closeTimers.delete(id)
      }, delay))
    }

    // Popula. Cada marker tem hover → abre popup + carrega snapshot.
    // Click do popup mantém comportamento normal (link <a>).
    const newMap = new Map<string, L.Marker>()
    for (const c of cameras) {
      const m = L.marker([c.lat, c.lng], { icon: buildIcon(c) })

      // Popup inicial sem imagem (placeholder skeleton-shimmer).
      m.bindPopup(buildPopupHTML(c, null), {
        // closeOnClick: false → click no mapa não fecha. Operador navega
        // mantendo popup aberto. Fecha pelo X, hover-out, ou outro hover.
        closeOnClick: false,
        autoClose: false,
        autoPan: true,
        keepInView: true,
      })

      // Hover marker: abre popup + faz fetch do snapshot (com cache).
      m.on('mouseover', async () => {
        cancelClose(c.id)
        const cached = snapshotUrlCache.get(c.id)
        if (cached && Date.now() - cached.at < 50_000) {
          m.setPopupContent(buildPopupHTML(c, cached.url))
        }
        m.openPopup()

        if (!cached || Date.now() - cached.at >= 50_000) {
          const url = await getSnapshotUrl(c.id)
          if (url && m.isPopupOpen()) {
            m.setPopupContent(buildPopupHTML(c, url))
          }
        }
      })

      // Mouseout marker: agenda fechamento (cancelado se mouse entrar no popup)
      m.on('mouseout', () => scheduleClose(c.id, m))

      // Quando popup é montado no DOM, hookamos enter/leave nele.
      // Nota: re-roda toda vez que o popup abre (DOM novo a cada open).
      m.on('popupopen', (ev: L.PopupEvent) => {
        const popupEl = ev.popup.getElement()
        if (!popupEl) return
        popupEl.addEventListener('mouseenter', () => cancelClose(c.id))
        popupEl.addEventListener('mouseleave', () => scheduleClose(c.id, m))
      })

      m.on('click', () => onMarkerClick(c))
      cluster.addLayer(m)
      newMap.set(c.id, m)
    }
    markerByIdRef.current = newMap

    // Expõe função de fly+open pro parent (lista lateral usa).
    registerFlyTo((cam: CameraGeo) => {
      const m = markerByIdRef.current.get(cam.id)
      if (!m) return
      // Se o marker está num cluster, zoom até ficar visível, depois open.
      cluster.zoomToShowLayer(m, () => m.openPopup())
      map.flyTo([cam.lat, cam.lng], FOCUS_ZOOM, { duration: 0.8 })
    })

    return () => {
      map.removeLayer(cluster)
      clusterRef.current = null
      markerByIdRef.current.clear()
    }
  }, [map, cameras, onMarkerClick, registerFlyTo])

  return null
}

// Util: escape HTML em strings que vão pro popup (sem React aqui).
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c])
}

// Detecta câmeras "coincidentes" (todas no mesmo ponto, ex: mesmo Site).
// Tolerância 0.01° ≈ 1km — útil pra evitar zoom-extremo quando o operador
// ainda não geo-localizou cada câmera individualmente.
function allCoincident(cs: CameraGeo[]): boolean {
  if (cs.length < 2) return true
  const [first, ...rest] = cs
  return rest.every(c =>
    Math.abs(c.lat - first.lat) < 0.01 &&
    Math.abs(c.lng - first.lng) < 0.01,
  )
}

// ── Componente: ajusta bounds pra englobar todos os pins no primeiro load ─
//
// Estratégia:
//   - 1 câmera OU todas coincidentes (mesmo Site): zoom 5 centrado.
//     Mostra Brasil/região com o cluster destacado — perspectiva pedida
//     pelo cliente. Evita aproximar demais quando ainda não há geoloc
//     fina por câmera.
//   - Várias câmeras espalhadas: fitBounds com maxZoom 10 (estado/região).
//     Padding inflado pra dar respiro visual nos pins de borda.
function FitToBounds({ cameras }: { cameras: CameraGeo[] }) {
  const map = useMap()
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current || cameras.length === 0) return
    if (cameras.length === 1 || allCoincident(cameras)) {
      map.setView([cameras[0].lat, cameras[0].lng], 5)
    } else {
      const bounds = L.latLngBounds(cameras.map(c => [c.lat, c.lng]))
      // .pad(0.3) cresce a bbox em 30% pra dar respiro visual nas bordas.
      map.fitBounds(bounds.pad(0.3), { padding: [30, 30], maxZoom: 10 })
    }
    fittedRef.current = true
  }, [map, cameras])
  return null
}

// ── Defensivo: força recálculo de tamanho em caso de container atrasado ──
//
// Quando o MapContainer monta dentro de um pai que ainda está calculando
// dimensões (flex/grid em hydration), o Leaflet pode capturar 0×0 e ficar
// preso. `invalidateSize()` força ele a olhar o tamanho atual. Rodamos
// 1× imediato e 1× após 200ms (cobre Browser repaint async).
function MapInvalidate() {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    const t = setTimeout(() => map.invalidateSize(), 200)
    return () => clearTimeout(t)
  }, [map])
  return null
}

// ── Geocoder Nominatim (OSM gratuito, sem chave) ─────────────────────────
//
// A busca de endereço usa Nominatim em vez do ESRI pago do Monuv. Política
// de uso aceita 1 req/s e atribuição visível. Coloco um delay de 400ms
// (debounce) entre digitação e fetch.
//
// Em produção com volume alto, vale subir um Nominatim self-hosted ou
// migrar pra Photon/Pelias.
async function geocodeAddress(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`
  const r = await fetch(url, {
    headers: {
      // Política Nominatim: identificar a aplicação
      'Accept': 'application/json',
    },
  })
  if (!r.ok) return null
  const data: any[] = await r.json()
  if (!data?.length) return null
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    label: data[0].display_name as string,
  }
}

function GeocoderControl({ flyToCoords }: { flyToCoords: (lat: number, lng: number, zoom?: number) => void }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await geocodeAddress(q)
      if (!r) { setErr('Endereço não encontrado'); return }
      flyToCoords(r.lat, r.lng, 14)
      setQ(r.label.split(',').slice(0, 3).join(', '))  // mostra resultado normalizado
    } catch {
      setErr('Falha na busca — verifique conexão')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <div className="relative flex-1">
        <Compass className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setErr(null) }}
          placeholder="Buscar endereço (ex: Av Paulista, SP)"
          className={cn(
            'w-full pl-8 pr-3 py-1.5 text-xs rounded-md border focus:outline-none',
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

// ── Página ───────────────────────────────────────────────────────────────
export function CameraMapPage() {
  const { data, isLoading } = useCameras()
  const cameras: any[] = data?.cameras ?? []
  const [q, setQ] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [ingestFilter, setIngestFilter] = useState<'' | IngestMode>('')

  // Lista geo-localizada — coords vêm do Site associado (não da Camera).
  // Schema atual só tem latitude/longitude em Site. Câmeras sem site ou com
  // site sem coords NÃO aparecem no mapa (mas continuam na sidebar como aviso).
  const geoCameras: CameraGeo[] = useMemo(() => {
    const list: CameraGeo[] = []
    for (const c of cameras) {
      const lat = c.site?.latitude
      const lng = c.site?.longitude
      if (typeof lat === 'number' && typeof lng === 'number') {
        list.push({
          id: c.id, name: c.name, status: c.status,
          ingestMode: c.ingestMode, lat, lng,
          site: c.site ? { id: c.site.id, name: c.site.name } : undefined,
          location: c.location ?? null,
          address: c.site?.address ?? null,
          city:    c.site?.city ?? null,
          state:   c.site?.state ?? null,
        })
      }
    }
    return list
  }, [cameras])

  const sites = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of cameras) if (c.site) seen.set(c.site.id, c.site.name)
    return [...seen.entries()]
  }, [cameras])

  const filteredGeo = useMemo(() => geoCameras.filter(c => {
    if (q) {
      const needle = q.toLowerCase()
      if (!(c.name?.toLowerCase().includes(needle) ||
            c.site?.name?.toLowerCase().includes(needle) ||
            c.location?.toLowerCase().includes(needle))) return false
    }
    if (siteFilter && c.site?.id !== siteFilter) return false
    if (ingestFilter && c.ingestMode !== ingestFilter) return false
    return true
  }), [geoCameras, q, siteFilter, ingestFilter])

  // Ref pra função de fly+open exposta pelo ClusterLayer
  const flyToRef = useRef<(c: CameraGeo) => void>(() => {})
  const mapRef = useRef<L.Map | null>(null)

  function handleSidebarClick(c: CameraGeo) {
    flyToRef.current?.(c)
  }

  function flyToCoords(lat: number, lng: number, zoom = 14) {
    mapRef.current?.flyTo([lat, lng], zoom, { duration: 0.8 })
  }

  const totalGeo = geoCameras.length
  const totalNoGeo = cameras.length - totalGeo

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
            <MapIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Mapa de Câmeras
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Visualização geográfica · {totalGeo}/{cameras.length} câmeras com coordenadas
            {totalNoGeo > 0 && (
              <span className="ml-1 text-amber-700 dark:text-amber-400/80">
                · {totalNoGeo} sem geoloc (configure no Site)
              </span>
            )}
          </p>
        </div>
        <Link
          to="/live"
          className={cn(
            'px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors',
            'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900',
            'dark:bg-white/5 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white',
          )}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar ao mosaico
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Sidebar com câmeras + filtros */}
        <GlassCard className="p-3 lg:col-span-1 space-y-2 max-h-[80vh] overflow-y-auto">
          <div className={cn(
            'sticky top-0 z-10 pb-2 border-b space-y-2',
            'bg-white border-slate-200',
            'dark:bg-space-900 dark:border-white/5',
          )}>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar câmera (nome / site)..."
                className={cn(
                  'w-full pl-8 pr-3 py-1.5 text-xs rounded-md border focus:outline-none',
                  'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-cyan-500',
                  'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500 dark:focus:border-cyan-500/50',
                )}
              />
            </div>
            {sites.length > 0 && (
              <select
                value={siteFilter}
                onChange={e => setSiteFilter(e.target.value)}
                className={cn(
                  'w-full px-2 py-1.5 text-xs rounded-md border',
                  'bg-slate-50 border-slate-200 text-slate-900',
                  'dark:bg-white/5 dark:border-white/10 dark:text-white',
                )}
              >
                <option value="">Todos os sites</option>
                {sites.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            <select
              value={ingestFilter}
              onChange={e => setIngestFilter(e.target.value as IngestMode | '')}
              className={cn(
                'w-full px-2 py-1.5 text-xs rounded-md border',
                'bg-slate-50 border-slate-200 text-slate-900',
                'dark:bg-white/5 dark:border-white/10 dark:text-white',
              )}
            >
              <option value="">Todos os modos</option>
              <option value="RTSP_PULL">RTSP Pull</option>
              <option value="RTMP_PUSH">RTMP Push</option>
            </select>
            <p className="text-[10px] text-slate-500 flex items-center gap-1">
              <Filter className="w-3 h-3" />
              {filteredGeo.length} {filteredGeo.length === 1 ? 'câmera' : 'câmeras'} no mapa
            </p>
          </div>

          {isLoading ? (
            <p className="text-xs text-slate-500 text-center py-8">Carregando…</p>
          ) : filteredGeo.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-8 px-2">
              <p>Nenhuma câmera com coordenadas para os filtros atuais.</p>
              {totalGeo === 0 && cameras.length > 0 && (
                <p className="mt-2 text-amber-700 dark:text-amber-400/80">
                  Nenhum site tem coordenadas configuradas. Vá em <em>Sites</em> e
                  preencha latitude/longitude pra aparecer no mapa.
                </p>
              )}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {filteredGeo.map(c => (
                <li
                  key={c.id}
                  className={cn(
                    'p-2 rounded-lg border transition cursor-pointer',
                    'bg-slate-50 border-slate-200 hover:border-cyan-300',
                    'dark:bg-white/[0.03] dark:border-white/5 dark:hover:border-cyan-500/30',
                  )}
                  onClick={() => handleSidebarClick(c)}
                  title="Clique pra centralizar no mapa"
                >
                  <div className="flex items-start gap-2">
                    <div className={cn(
                      'w-6 h-6 rounded flex items-center justify-center shrink-0',
                      c.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                        : c.status === 'ERROR'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400',
                    )}>
                      <CameraIcon className="w-3 h-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate text-slate-900 dark:text-white">{c.name}</p>
                      <p className="text-[10px] truncate text-slate-500 dark:text-slate-500">{c.site?.name ?? '—'}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <MapPin className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400/80" />
                        <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400/80">
                          {c.lat.toFixed(3)}, {c.lng.toFixed(3)}
                        </span>
                      </div>
                    </div>
                    <Link
                      to={`/cameras/${c.id}`}
                      onClick={e => e.stopPropagation()}
                      className={cn(
                        'p-1 rounded',
                        'text-slate-500 hover:text-cyan-700 hover:bg-cyan-100',
                        'dark:hover:text-cyan-300 dark:hover:bg-cyan-500/10',
                      )}
                      title="Abrir câmera"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {/* Map. NÃO usa <GlassCard> aqui porque ele envolve children num
            <div relative z-10> sem `h-full flex flex-col`, o que faz o
            flex-1 do mapa colapsar pra 0. Replicamos a aparência glass
            com div direto + flex-flow correto.

            ATENÇÃO: altura é EXPLÍCITA (h-[80vh]). O MapContainer Leaflet
            calcula seu tamanho sobre `height` do parent — se o parent for
            só `min-height`, o filho com `100%` colapsa. */}
        <div
          className={cn(
            'lg:col-span-3 h-[80vh] flex flex-col overflow-hidden',
            'relative rounded-2xl border',
            // LIGHT: card branco com sombra discreta (a área do mapa em si
            // continua dark — vide DARK_TILES_URL).
            'bg-white border-slate-200 shadow-sm',
            // DARK: glass histórico
            'dark:bg-glass dark:backdrop-blur-sm dark:border-white/8 dark:shadow-glass',
          )}
        >
          {/* Subtle inner highlight só no DARK */}
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.04] to-transparent pointer-events-none hidden dark:block" />

          <div className="relative z-10 p-3 flex items-center gap-3 shrink-0 border-b border-slate-200 dark:border-white/5">
            <div className="flex-1 min-w-[200px]">
              <GeocoderControl flyToCoords={flyToCoords} />
            </div>
            <div className="hidden md:flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400" /> ativa
              <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400 ml-2" /> manutenção
              <span className="w-2 h-2 rounded-full bg-rose-500 dark:bg-rose-400 ml-2" /> erro
              <span className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-400 ml-2" /> pendente
            </div>
          </div>

          {/* `style={{ height: '100%' }}` no MapContainer também é defensivo —
              alguns builds Leaflet+Tailwind ignoram a classe `h-full` se a
              altura do flex-item parent for calculada tarde demais.
              `minHeight: 0` evita que o flex-item seja "pushed" pela altura
              natural do conteúdo (default min-content faz overflow). */}
          <div className="relative z-10 flex-1" style={{ minHeight: 0 }}>
            <MapContainer
              center={BRAZIL_CENTER}
              zoom={DEFAULT_ZOOM}
              minZoom={3}
              maxZoom={19}
              style={{ height: '100%', width: '100%' }}
              ref={mapRef as any}
            >
              <TileLayer url={DARK_TILES_URL} attribution={DARK_TILES_ATTR} />
              <MapInvalidate />
              {filteredGeo.length > 0 && (
                <>
                  <CameraClusterLayer
                    cameras={filteredGeo}
                    onMarkerClick={() => {}}
                    registerFlyTo={(fn) => { flyToRef.current = fn }}
                  />
                  <FitToBounds cameras={filteredGeo} />
                </>
              )}
            </MapContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
