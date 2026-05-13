/**
 * PresenceMap — Mapa interativo Leaflet de sites/integradores no Brasil.
 *
 * Onda 7 do docs/13-PLAN-COCKPIT-PREMIUM.md.
 * Substitui o placeholder GeographicPresence em /admin/tenants e cockpits.
 *
 * Uso:
 *   <PresenceMap
 *     points={[
 *       { id: 'site-1', lat: -23.55, lng: -46.63, name: 'Site Centro',
 *         clienteName: 'Cliente A', integradorName: 'IACloud T.', healthScore: 98 }
 *     ]}
 *     persona="super"
 *   />
 *
 * Cada nível (super-admin / integrador / cliente) recebe os pontos que pode
 * ver — RBAC já aplicado server-side.
 */
import { useEffect, useRef } from 'react'
import L, { Map as LeafletMap, Marker as LeafletMarker, LayerGroup } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { GlassCard } from '../cards/GlassCard'
import { cn } from '../../lib/utils'

// Workaround: ícones default do Leaflet não carregam via Vite sem path absoluto
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export interface PresenceMapPoint {
  id: string
  lat: number
  lng: number
  /** Nome do site (sempre) */
  name: string
  /** Nome do cliente final (super-admin e integrador) */
  clienteName?: string
  /** Nome do integrador (apenas super-admin) */
  integradorName?: string
  /** Health score 0-100 (afeta cor do pin) */
  healthScore?: number | null
  /** Contadores agregados */
  counts?: { boxes?: number; cameras?: number; boxesOnline?: number }
}

export interface PresenceMapProps {
  points: PresenceMapPoint[]
  /** Altura do mapa (default: 320px = 20rem) */
  height?: string
  className?: string
  /** Mostrar empty state se não houver pontos */
  showEmpty?: boolean
  /** Título customizado */
  title?: string
}

function pinColorFor(score: number | null | undefined): string {
  if (score == null) return '#64748b'    // slate-500
  if (score >= 95) return '#10b981'      // emerald-500
  if (score >= 80) return '#34d399'      // emerald-400
  if (score >= 60) return '#f59e0b'      // amber-500
  if (score >= 40) return '#fb923c'      // orange-400
  return '#f43f5e'                       // rose-500
}

function makeColoredPin(color: string, pulse = false): L.DivIcon {
  return L.divIcon({
    html: `
      <div style="position:relative;width:24px;height:24px">
        <div style="
          position:absolute; inset:6px;
          width:12px; height:12px;
          background:${color};
          border:2px solid white;
          border-radius:50%;
          box-shadow:0 0 12px ${color}, 0 1px 4px rgba(0,0,0,0.4);
          ${pulse ? 'animation:icv-pulse 2s infinite' : ''}
        "></div>
      </div>
      <style>
        @keyframes icv-pulse {
          0%, 100% { transform:scale(1); opacity:1 }
          50% { transform:scale(1.3); opacity:0.7 }
        }
      </style>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    className: 'icv-presence-pin',
  })
}

export function PresenceMap({
  points,
  height = '320px',
  className,
  showEmpty = true,
  title = '🗺 Presença Geográfica',
}: PresenceMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)

  // Mount map (1x)
  useEffect(() => {
    if (!containerRef.current) return
    if (mapRef.current) return

    // Brasil center default
    const map = L.map(containerRef.current, {
      center: [-15.5, -47.5],
      zoom: 4,
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: false,
    })

    // CartoDB dark mode tiles (free, sem token)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map)

    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    // Cleanup
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // Update markers when points change
  useEffect(() => {
    if (!mapRef.current || !layerRef.current) return
    layerRef.current.clearLayers()

    if (points.length === 0) return

    const markers: LeafletMarker[] = []
    for (const p of points) {
      if (!isFinite(p.lat) || !isFinite(p.lng)) continue
      const color = pinColorFor(p.healthScore)
      const isHealthy = (p.healthScore ?? 100) >= 80
      const pin = makeColoredPin(color, !isHealthy)

      const m = L.marker([p.lat, p.lng], { icon: pin })
      m.bindPopup(`
        <div style="font-family: system-ui, sans-serif; min-width: 180px">
          <div style="font-weight:bold; color:#fff; margin-bottom:4px">📍 ${escapeHtml(p.name)}</div>
          ${p.clienteName ? `<div style="font-size:11px; color:#94a3b8">${escapeHtml(p.clienteName)}</div>` : ''}
          ${p.integradorName ? `<div style="font-size:10px; color:#64748b; margin-top:2px">via ${escapeHtml(p.integradorName)}</div>` : ''}
          <div style="margin-top:6px; padding-top:6px; border-top:1px solid #1e293b; font-size:11px; color:#cbd5e1">
            ${p.healthScore != null ? `<span style="color:${color}; font-weight:bold">●${p.healthScore}</span> saúde<br/>` : ''}
            ${p.counts?.boxes != null ? `📦 ${p.counts.boxesOnline ?? 0}/${p.counts.boxes} boxes online<br/>` : ''}
            ${p.counts?.cameras != null ? `📹 ${p.counts.cameras} câmeras` : ''}
          </div>
        </div>
      `, { maxWidth: 250 })

      m.addTo(layerRef.current)
      markers.push(m)
    }

    // Auto-fit bounds se houver pontos
    if (markers.length > 0) {
      const group = L.featureGroup(markers)
      mapRef.current.fitBounds(group.getBounds().pad(0.3), {
        maxZoom: 12,
        animate: false,
      })
    }
  }, [points])

  const validPoints = points.filter(p => isFinite(p.lat) && isFinite(p.lng))
  const totalSites = points.length
  const onlineBoxes = points.reduce((acc, p) => acc + (p.counts?.boxesOnline ?? 0), 0)
  const totalBoxes = points.reduce((acc, p) => acc + (p.counts?.boxes ?? 0), 0)

  return (
    <GlassCard className={cn('p-5 border-slate-300 dark:border-slate-700/50', className)}>
      <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2 flex-wrap">
        <span>{title}</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
          {totalSites} site{totalSites !== 1 ? 's' : ''}
          {totalBoxes > 0 && ` · ${onlineBoxes}/${totalBoxes} boxes online`}
        </span>
      </h2>

      {validPoints.length === 0 && showEmpty ? (
        <div
          className="bg-slate-100 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-500 relative overflow-hidden"
          style={{ height }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-cyan-500/5 pointer-events-none" />
          <div className="text-center relative z-10">
            <div className="text-4xl mb-2">📍</div>
            <div className="text-sm">Nenhum site geo-localizado ainda</div>
            <div className="text-xs text-slate-600 mt-1">
              Cadastre lat/lng nos sites para vê-los no mapa
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{ height }}
          className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800"
        />
      )}
    </GlassCard>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
