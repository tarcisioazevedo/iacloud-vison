/**
 * /smart-city — Vertical Cidades Inteligentes (Sprint 2.4)
 *
 * Diferencial competitivo vs Monuv "Cidades inteligentes":
 *   • Heatmap de incidentes por bairro/zona (não só por câmera).
 *   • Rastreamento cross-camera de placas (timeline + rota reconstruída).
 *   • Hot list com origem rastreada (manual / API SSP / Detran / CSV).
 *   • Dashboard executivo público para gestor de cidade (federação).
 *
 * Backend planejado:
 *   GET /bi/smart-city/overview?days=N
 *   GET /bi/smart-city/hotspots?days=N
 *   GET /bi/smart-city/hotlist
 *   GET /bi/smart-city/traffic?days=N
 *   POST /bi/smart-city/track-plate { plate, days, fuzzy }
 *
 * Enquanto não publica, roda em SYNTHETIC_MODE (mesmo padrão de
 * UtilizationPage e UptimePage). Flag abaixo controla.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Building2, Siren, Activity, Map as MapIcon, TrendingUp, TrendingDown,
  Search, Car, Eye, AlertTriangle, ShieldAlert, ShieldCheck, Database,
  Upload, RefreshCw, FileText, Route, Clock, Camera as CameraIcon,
  ChevronRight, Info, Filter, Hash, MapPin, Share2, Download,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useCameras, usePlateEvents, usePlates } from '../api/client'
import { cn } from '../lib/utils'
import { ExportCsvButton } from '../components/ExportCsvButton'
import type { CsvColumn } from '../lib/csv'

const SYNTHETIC_MODE = true

// ─────────────────────────────────────────────────────────────────────────────
// Síntese determinística
// ─────────────────────────────────────────────────────────────────────────────

function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const SAMPLE_BAIRROS = [
  'Centro', 'Vila Industrial', 'Jardim das Palmeiras', 'Cidade Alta',
  'Parque Industrial', 'Zona Sul', 'Boa Vista', 'Santo Antônio',
  'Vila Nova', 'Bela Vista', 'Jardim América', 'Vila Real',
]
const SAMPLE_VIAS = [
  'Av. Brasil', 'Av. Paulista', 'R. XV de Novembro', 'Av. Marechal Rondon',
  'R. Tiradentes', 'Av. Anhanguera', 'Rod. SP-310', 'Av. Beira-Rio',
  'R. das Flores', 'Av. Independência', 'R. dos Andradas', 'Av. Castelo Branco',
]
const HOTLIST_SOURCES = [
  { id: 'manual',  label: 'Cadastro manual', icon: FileText },
  { id: 'ssp_api', label: 'SSP (API)',       icon: Database },
  { id: 'detran',  label: 'Detran',          icon: Database },
  { id: 'csv',     label: 'CSV importado',   icon: Upload   },
]

interface CityKpis {
  eventsToday: number
  events7d: number
  hotlistAlerts24h: number
  hotspotsActive: number
  camerasInMesh: number
  vehiclesCounted24h: number
  uniquePlatesSeen24h: number
  alertsResolutionTimeMin: number
}

interface HotspotRow {
  zone: string
  events: number
  delta: number          // % vs período anterior
  topCategory: string
  cameras: number
}

interface HotlistEntry {
  plate: string
  category: 'STOLEN' | 'WANTED' | 'BLACKLIST' | 'WATCHLIST'
  source: typeof HOTLIST_SOURCES[number]['id']
  active: boolean
  registeredAt: string   // ISO
  lastSeenAt: string | null
  detectionsLast30d: number
  vehicleDescription: string | null
}

interface TrafficRow {
  via: string
  cameraCount: number
  vehiclesPerHour: number
  peakHour: number       // 0..23
  delta: number          // % vs semana anterior
  anomaly: boolean       // 3-sigma flag
}

interface TrackingHit {
  ts: string             // ISO
  cameraId: string
  cameraName: string
  bairro: string
  via: string
  confidence: number     // 0..1
  imageUrl: string | null
}

function synthHotspots(seed: string, days: number): HotspotRow[] {
  return SAMPLE_BAIRROS.map(b => {
    const h = hash32(`${seed}::${b}::${days}`)
    const events = 30 + (h % 850) * (days / 7)
    return {
      zone: b,
      events: Math.round(events),
      delta: ((h >> 8) % 200 - 80) / 10,                // -8% .. +12%
      topCategory: ['Movimento', 'LPR', 'Suspeito', 'Anomalia', 'Presença'][(h >> 4) % 5],
      cameras: 2 + (h >> 16) % 18,
    }
  }).sort((a, b) => b.events - a.events)
}

function synthHotlist(seed: string): HotlistEntry[] {
  const out: HotlistEntry[] = []
  const samples = 24
  const cats: HotlistEntry['category'][] = ['STOLEN', 'WANTED', 'BLACKLIST', 'WATCHLIST']
  const srcs: HotlistEntry['source'][] = ['manual', 'ssp_api', 'detran', 'csv']
  for (let i = 0; i < samples; i++) {
    const h = hash32(`${seed}::plate::${i}`)
    const letters = String.fromCharCode(65 + (h % 26)) +
                    String.fromCharCode(65 + ((h >> 5) % 26)) +
                    String.fromCharCode(65 + ((h >> 10) % 26))
    const middle = (h >> 15) % 10
    const isMercosul = (h % 4) === 0
    const tail = isMercosul
      ? `${middle}${String.fromCharCode(65 + ((h >> 17) % 26))}${(h >> 21) % 100}`.padStart(4, '0')
      : `${middle}${(h >> 17) % 1000}`.padStart(4, '0')
    const plate = `${letters}${tail.slice(0, 4)}`
    const detections = (h % 100) < 60 ? 0 : 1 + ((h >> 7) % 28)
    out.push({
      plate,
      category: cats[(h >> 11) % 4],
      source: srcs[(h >> 13) % 4],
      active: (h % 100) < 88,
      registeredAt: new Date(Date.now() - ((h % 90) + 1) * 86400_000).toISOString(),
      lastSeenAt: detections === 0
        ? null
        : new Date(Date.now() - ((h % 144) + 1) * 3600_000).toISOString(),
      detectionsLast30d: detections,
      vehicleDescription: ['Honda Civic preto', 'Fiat Uno branco', 'VW Gol prata',
                            'Toyota Corolla cinza', 'Hyundai HB20 vermelho', null][i % 6],
    })
  }
  return out
}

function synthTraffic(seed: string, days: number): TrafficRow[] {
  return SAMPLE_VIAS.map(v => {
    const h = hash32(`${seed}::via::${v}::${days}`)
    const vph = 80 + (h % 1500)
    const peak = (h >> 10) % 24
    const delta = ((h >> 14) % 240 - 100) / 10
    const anomaly = Math.abs(delta) > 18  // ~3-sigma flag
    return {
      via: v,
      cameraCount: 1 + (h >> 4) % 6,
      vehiclesPerHour: vph,
      peakHour: peak,
      delta,
      anomaly,
    }
  }).sort((a, b) => b.vehiclesPerHour - a.vehiclesPerHour)
}

function synthTracking(plate: string, cameras: any[]): TrackingHit[] {
  const h0 = hash32(plate.toUpperCase())
  const count = 3 + (h0 % 6) // 3..8 hits
  const pool = cameras.slice(0, Math.max(1, cameras.length))
  const hits: TrackingHit[] = []
  let lastTs = Date.now() - (h0 % 24) * 3600_000
  for (let i = 0; i < count; i++) {
    const h = hash32(`${plate}::${i}`)
    const cam = pool[h % Math.max(1, pool.length)] ?? { id: `cam-${i}`, name: `Câmera ${i + 1}` }
    const stride = (h % 12) + 2 // 2..13 minutos entre detecções
    lastTs += stride * 60_000
    hits.push({
      ts: new Date(lastTs).toISOString(),
      cameraId: cam.id,
      cameraName: cam.name ?? `Câmera ${i + 1}`,
      bairro: SAMPLE_BAIRROS[(h >> 8) % SAMPLE_BAIRROS.length],
      via: SAMPLE_VIAS[(h >> 12) % SAMPLE_VIAS.length],
      confidence: 0.78 + ((h >> 6) % 22) / 100, // 0.78 .. 0.99
      imageUrl: null,
    })
  }
  return hits.sort((a, b) => +new Date(a.ts) - +new Date(b.ts))
}

function synthKpis(days: number, camCount: number): CityKpis {
  const h = hash32(`kpi::${days}::${camCount}`)
  const eventsBase = 1500 + (h % 4500)
  return {
    eventsToday:        Math.round(eventsBase / 7),
    events7d:           eventsBase,
    hotlistAlerts24h:   3 + (h % 18),
    hotspotsActive:     1 + ((h >> 8) % 5),
    camerasInMesh:      camCount,
    vehiclesCounted24h: 8000 + (h % 22000),
    uniquePlatesSeen24h: 1200 + ((h >> 12) % 4500),
    alertsResolutionTimeMin: 8 + ((h >> 16) % 22),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de UI
// ─────────────────────────────────────────────────────────────────────────────

const PERIODS = [
  { label: 'Hoje',    days: 1 },
  { label: '7 dias',  days: 7 },
  { label: '30 dias', days: 30 },
]

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('pt-BR')
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60_000) return 'agora'
  if (d < 3_600_000) return `há ${Math.floor(d / 60_000)}min`
  if (d < 86_400_000) return `há ${Math.floor(d / 3_600_000)}h`
  return `há ${Math.floor(d / 86_400_000)}d`
}

function fmtPlate(p: string): string {
  const c = p.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (c.length === 7) return c.slice(0, 3) + '-' + c.slice(3)
  return c
}

const CATEGORY_STYLES: Record<HotlistEntry['category'], { label: string; cls: string; icon: any }> = {
  STOLEN:    { label: 'Roubado',    cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40',     icon: ShieldAlert },
  WANTED:    { label: 'Procurado',  cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40',     icon: Siren        },
  BLACKLIST: { label: 'Bloqueado',  cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40',  icon: ShieldAlert },
  WATCHLIST: { label: 'Monitorado', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',     icon: Eye          },
}

type Tab = 'overview' | 'hotlist' | 'traffic' | 'tracking'

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export function SmartCityHubPage() {
  const [tab, setTab]   = useState<Tab>('overview')
  const [days, setDays] = useState(7)
  const { data: camerasData } = useCameras()
  const cameras: any[] = camerasData?.items ?? []

  const seed = `city::${cameras.length || 'demo'}`
  const kpis      = useMemo(() => synthKpis(days, cameras.length || 24),         [days, cameras.length])
  const hotspots  = useMemo(() => synthHotspots(seed, days),                      [seed, days])
  const hotlist   = useMemo(() => synthHotlist(seed),                             [seed])
  const traffic   = useMemo(() => synthTraffic(seed, days),                       [seed, days])

  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-amber-400" />
            Cidades Inteligentes
            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[9px] font-bold text-amber-300 tracking-wider uppercase">
              Vertical
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Visão executiva para gestores municipais · LPR, fluxo veicular, hotspots e rastreamento cross-camera.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg p-0.5">
            {PERIODS.map(p => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={cn(
                  'px-2.5 py-1 rounded text-[11px] font-semibold',
                  days === p.days
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-400 hover:text-slate-900 dark:text-white hover:bg-slate-50 dark:bg-white/5 border border-transparent',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Compartilhar via federação (paridade /federation, exclusividade nossa) */}
          <Link
            to="/federation"
            className="px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs font-semibold hover:bg-violet-500/20 flex items-center gap-1.5"
            title="Compartilhar dashboards com órgãos públicos via Segurança Colaborativa"
          >
            <Share2 className="w-3.5 h-3.5" />
            Federação
          </Link>
        </div>
      </div>

      {SYNTHETIC_MODE && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            <b>Modo aproximação</b> — números derivados de síntese determinística. Endpoints
            <code className="font-mono text-[10px] bg-slate-100 dark:bg-white/10 px-1 rounded mx-1">/bi/smart-city/*</code>
            serão conectados em seguida (UI pronta).
          </span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile icon={<Activity />}     accent="amber"   label={`Eventos (${days}d)`} value={fmtInt(kpis.events7d)}        subtitle={`${fmtInt(kpis.eventsToday)} hoje`} />
        <KpiTile icon={<Siren />}        accent="rose"    label="Alertas hot list 24h"  value={fmtInt(kpis.hotlistAlerts24h)} subtitle={`${kpis.alertsResolutionTimeMin}min MTTR`} />
        <KpiTile icon={<MapPin />}       accent="violet"  label="Hotspots ativos"       value={fmtInt(kpis.hotspotsActive)}   subtitle="anomalia 3σ" />
        <KpiTile icon={<Car />}          accent="cyan"    label="Veículos 24h"          value={fmtInt(kpis.vehiclesCounted24h)} subtitle={`${fmtInt(kpis.uniquePlatesSeen24h)} placas únicas`} />
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-white/10 flex items-center gap-1">
        {([
          { id: 'overview', label: 'Visão Geral',   icon: Activity },
          { id: 'hotlist',  label: 'Hot List',      icon: Siren    },
          { id: 'traffic',  label: 'Fluxo Veicular', icon: Route   },
          { id: 'tracking', label: 'Rastreamento',  icon: MapIcon  },
        ] as const).map(t => {
          const Icon = t.icon
          const active = t.id === tab
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-3 py-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 -mb-px transition',
                active
                  ? 'text-amber-300 border-amber-400'
                  : 'text-slate-400 border-transparent hover:text-slate-900 dark:text-white',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'overview' && <OverviewTab hotspots={hotspots} kpis={kpis} days={days} />}
          {tab === 'hotlist'  && <HotlistTab  entries={hotlist} />}
          {tab === 'traffic'  && <TrafficTab  rows={traffic} days={days} />}
          {tab === 'tracking' && <TrackingTab cameras={cameras} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab — Overview
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({ hotspots, kpis, days }: { hotspots: HotspotRow[]; kpis: CityKpis; days: number }) {
  // Top 8 zonas + barra proporcional
  const top = hotspots.slice(0, 8)
  const max = Math.max(...top.map(h => h.events), 1)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <GlassCard className="p-4 lg:col-span-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-violet-400" />
            Hotspots por bairro
          </h3>
          <span className="text-[10px] text-slate-500">Top 8 · janela {days}d</span>
        </div>
        <div className="space-y-1.5">
          {top.map((h, i) => (
            <div key={h.zone} className="flex items-center gap-3">
              <div className="text-[10px] font-mono text-slate-500 w-5 shrink-0">#{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">{h.zone}</span>
                  <span className="text-[10px] text-slate-500 ml-2 shrink-0">
                    {h.cameras} câm · top: <span className="text-violet-300">{h.topCategory}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
                    <div
                      className={cn(
                        'h-full transition-all',
                        i === 0 ? 'bg-rose-400' :
                        i === 1 ? 'bg-amber-400' :
                        i === 2 ? 'bg-violet-400' :
                                  'bg-cyan-400',
                      )}
                      style={{ width: `${(h.events / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-slate-900 dark:text-white w-16 text-right">{fmtInt(h.events)}</span>
                  <span className={cn(
                    'text-[10px] font-semibold w-12 text-right flex items-center justify-end gap-0.5',
                    h.delta > 5  ? 'text-rose-300'    :
                    h.delta < -5 ? 'text-emerald-300' :
                                   'text-slate-500',
                  )}>
                    {h.delta > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : h.delta < 0 ? <TrendingDown className="w-2.5 h-2.5" /> : null}
                    {h.delta > 0 ? '+' : ''}{h.delta.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
          <Siren className="w-4 h-4 text-rose-400" />
          Sinais de alerta
        </h3>
        <div className="space-y-2">
          <AlertSummary
            label="Hotlist disparada (24h)"
            value={kpis.hotlistAlerts24h}
            tone="rose"
            sub={`MTTR ${kpis.alertsResolutionTimeMin}min`}
          />
          <AlertSummary
            label="Bairros em anomalia 3σ"
            value={kpis.hotspotsActive}
            tone="violet"
            sub="acima do desvio padrão histórico"
          />
          <AlertSummary
            label="Câmeras na malha cidade"
            value={kpis.camerasInMesh}
            tone="cyan"
            sub="contribuindo para o pool"
          />
          <Link
            to="/review?severity=CRITICAL"
            className="mt-2 w-full px-3 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-rose-500/25"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Ver eventos críticos
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </GlassCard>
    </div>
  )
}

function AlertSummary({ label, value, tone, sub }:
  { label: string; value: number; tone: 'rose' | 'violet' | 'cyan'; sub: string }) {
  const cls = {
    rose:   'bg-rose-500/10 border-rose-500/30 text-rose-300',
    violet: 'bg-violet-500/10 border-violet-500/30 text-violet-300',
    cyan:   'bg-cyan-500/10 border-cyan-500/30 text-cyan-300',
  }[tone]
  return (
    <div className={cn('px-3 py-2 rounded-lg border flex items-center justify-between', cls)}>
      <div className="min-w-0">
        <p className="text-xs font-semibold truncate">{label}</p>
        <p className="text-[10px] opacity-70">{sub}</p>
      </div>
      <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab — Hot List
// ─────────────────────────────────────────────────────────────────────────────

function HotlistTab({ entries }: { entries: HotlistEntry[] }) {
  const [q, setQ]               = useState('')
  const [catFilter, setCat]     = useState<HotlistEntry['category'] | ''>('')
  const [srcFilter, setSrc]     = useState('')
  const [activeOnly, setActive] = useState(true)

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase()
    return entries.filter(e => {
      if (catFilter && e.category !== catFilter) return false
      if (srcFilter && e.source !== srcFilter) return false
      if (activeOnly && !e.active) return false
      if (needle && !(
        e.plate.toUpperCase().includes(needle) ||
        (e.vehicleDescription ?? '').toUpperCase().includes(needle)
      )) return false
      return true
    })
  }, [entries, q, catFilter, srcFilter, activeOnly])

  const csvCols: CsvColumn<HotlistEntry>[] = [
    { header: 'Placa',        accessor: r => fmtPlate(r.plate) },
    { header: 'Categoria',    accessor: r => CATEGORY_STYLES[r.category].label },
    { header: 'Origem',       accessor: r => HOTLIST_SOURCES.find(s => s.id === r.source)?.label ?? r.source },
    { header: 'Ativo',        accessor: r => r.active ? 'Sim' : 'Não' },
    { header: 'Cadastrada',   accessor: r => r.registeredAt },
    { header: 'Última visão', accessor: r => r.lastSeenAt ?? '' },
    { header: 'Detecções 30d', accessor: r => r.detectionsLast30d },
    { header: 'Veículo',      accessor: r => r.vehicleDescription ?? '' },
  ]

  return (
    <div className="space-y-3">
      <GlassCard className="p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar placa ou descrição..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40 font-mono uppercase"
          />
        </div>
        <select
          value={catFilter}
          onChange={e => setCat(e.target.value as any)}
          className="px-2 py-1.5 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-amber-500/40"
        >
          <option value="">Todas categorias</option>
          {Object.entries(CATEGORY_STYLES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={srcFilter}
          onChange={e => setSrc(e.target.value)}
          className="px-2 py-1.5 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-amber-500/40"
        >
          <option value="">Todas origens</option>
          {HOTLIST_SOURCES.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <button
          onClick={() => setActive(v => !v)}
          className={cn(
            'px-2 py-1.5 text-xs rounded-md border flex items-center gap-1 font-semibold',
            activeOnly
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
              : 'bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10',
          )}
          title={activeOnly ? 'Mostrando apenas ativos' : 'Incluir inativos'}
        >
          <Filter className="w-3 h-3" />
          {activeOnly ? 'Apenas ativos' : 'Todos'}
        </button>
        <ExportCsvButton basename="hotlist" rows={filtered} columns={csvCols} label="CSV" />
      </GlassCard>

      <GlassCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2.5">Placa</th>
                <th className="px-3 py-2.5">Categoria</th>
                <th className="px-3 py-2.5">Origem</th>
                <th className="px-3 py-2.5">Cadastro</th>
                <th className="px-3 py-2.5">Última visão</th>
                <th className="px-3 py-2.5 text-right">Detecções 30d</th>
                <th className="px-3 py-2.5">Veículo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">Nenhuma placa na hot list com esses filtros.</td></tr>
              )}
              {filtered.map(e => {
                const cat = CATEGORY_STYLES[e.category]
                const CatIcon = cat.icon
                const src = HOTLIST_SOURCES.find(s => s.id === e.source)!
                const SrcIcon = src.icon
                return (
                  <tr key={e.plate + e.registeredAt} className="border-b border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-mono font-bold text-amber-200">{fmtPlate(e.plate)}</td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold', cat.cls)}>
                        <CatIcon className="w-2.5 h-2.5" />
                        {cat.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      <span className="inline-flex items-center gap-1 text-[10px]">
                        <SrcIcon className="w-3 h-3 text-slate-500" />
                        {src.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-[10px]">{fmtRelative(e.registeredAt)}</td>
                    <td className="px-3 py-2 text-[10px]">
                      {e.lastSeenAt
                        ? <span className="text-amber-300">{fmtRelative(e.lastSeenAt)}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-cyan-300">{e.detectionsLast30d}</td>
                    <td className="px-3 py-2 text-slate-400 text-[11px] truncate max-w-[160px]">
                      {e.vehicleDescription ?? <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <GlassCard className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            Origens da hot list
          </h3>
          <button className="px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] font-semibold hover:bg-cyan-500/20 flex items-center gap-1">
            <RefreshCw className="w-2.5 h-2.5" />
            Sincronizar fontes
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {HOTLIST_SOURCES.map(s => {
            const Icon = s.icon
            const count = entries.filter(e => e.source === s.id).length
            return (
              <div key={s.id} className="px-3 py-2 rounded-lg bg-white/[0.02] border border-slate-200 dark:border-white/5 flex items-center gap-2">
                <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{s.label}</p>
                  <p className="text-[10px] text-slate-500">{count} placa(s)</p>
                </div>
              </div>
            )
          })}
        </div>
      </GlassCard>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab — Fluxo Veicular
// ─────────────────────────────────────────────────────────────────────────────

function TrafficTab({ rows, days }: { rows: TrafficRow[]; days: number }) {
  const [onlyAnom, setOnlyAnom] = useState(false)
  const filtered = onlyAnom ? rows.filter(r => r.anomaly) : rows
  const max = Math.max(...rows.map(r => r.vehiclesPerHour), 1)
  const csvCols: CsvColumn<TrafficRow>[] = [
    { header: 'Via',                accessor: r => r.via },
    { header: 'Câmeras',            accessor: r => r.cameraCount },
    { header: 'Veículos/hora (média)', accessor: r => r.vehiclesPerHour },
    { header: 'Pico (hora)',        accessor: r => `${r.peakHour}:00` },
    { header: 'Δ vs semana ant. (%)', accessor: r => r.delta.toFixed(1) },
    { header: 'Anomalia 3σ',        accessor: r => r.anomaly ? 'Sim' : 'Não' },
  ]

  return (
    <div className="space-y-3">
      <GlassCard className="p-3 flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
          <Route className="w-4 h-4 text-cyan-400" />
          Fluxo veicular por via
        </h3>
        <span className="text-[10px] text-slate-500">·  janela {days}d</span>
        <div className="flex-1" />
        <button
          onClick={() => setOnlyAnom(v => !v)}
          className={cn(
            'px-2 py-1.5 text-xs rounded-md border flex items-center gap-1 font-semibold',
            onlyAnom
              ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
              : 'bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10',
          )}
        >
          <AlertTriangle className="w-3 h-3" />
          {onlyAnom ? 'Apenas anomalias' : 'Filtrar anomalias'}
        </button>
        <ExportCsvButton basename={`traffic_${days}d`} rows={filtered} columns={csvCols} label="CSV" />
      </GlassCard>

      <GlassCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2.5">Via</th>
                <th className="px-3 py-2.5">Câmeras</th>
                <th className="px-3 py-2.5">Vol. médio</th>
                <th className="px-3 py-2.5">Pico</th>
                <th className="px-3 py-2.5 text-right">Δ semana</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">Nenhuma via.</td></tr>
              )}
              {filtered.map(r => (
                <tr key={r.via} className={cn(
                  'border-b border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02]',
                  r.anomaly && 'bg-rose-500/[0.04]',
                )}>
                  <td className="px-3 py-2 text-slate-900 dark:text-white font-medium">{r.via}</td>
                  <td className="px-3 py-2 text-slate-400 font-mono">{r.cameraCount}</td>
                  <td className="px-3 py-2 w-1/3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
                        <div
                          className={cn('h-full', r.anomaly ? 'bg-rose-400' : 'bg-cyan-400')}
                          style={{ width: `${(r.vehiclesPerHour / max) * 100}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono text-slate-900 dark:text-white w-16 text-right">{fmtInt(r.vehiclesPerHour)}/h</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                    <Clock className="w-3 h-3 inline mr-1 text-slate-500" />
                    {String(r.peakHour).padStart(2, '0')}:00
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn(
                      'inline-flex items-center gap-0.5 text-[11px] font-semibold',
                      r.delta > 5  ? 'text-rose-300' :
                      r.delta < -5 ? 'text-emerald-300' :
                                     'text-slate-400',
                    )}>
                      {r.delta > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : r.delta < 0 ? <TrendingDown className="w-2.5 h-2.5" /> : null}
                      {r.delta > 0 ? '+' : ''}{r.delta.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.anomaly && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-rose-500/15 border-rose-500/40 text-rose-300 text-[9px] font-bold uppercase">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        3σ
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab — Rastreamento Cross-camera
// ─────────────────────────────────────────────────────────────────────────────

function TrackingTab({ cameras }: { cameras: any[] }) {
  const [plate, setPlate] = useState('')
  const [hits, setHits] = useState<TrackingHit[] | null>(null)
  const [searched, setSearched] = useState<string>('')

  function search() {
    const clean = plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (clean.length < 5) return
    setSearched(clean)
    setHits(synthTracking(clean, cameras))
  }

  const totalDistance = useMemo(() => {
    if (!hits || hits.length < 2) return null
    // Aproximação muito grosseira: 0.8 km entre câmeras consecutivas (mock)
    return ((hits.length - 1) * 0.8).toFixed(1)
  }, [hits])

  const totalTime = useMemo(() => {
    if (!hits || hits.length < 2) return null
    const min = (+new Date(hits[hits.length - 1].ts) - +new Date(hits[0].ts)) / 60_000
    return Math.round(min)
  }, [hits])

  return (
    <div className="space-y-3">
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <MapIcon className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Rastreamento cross-camera</h3>
          <span className="px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-[9px] font-bold text-violet-300 tracking-wider uppercase">
            Exclusivo
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Reconstrói a rota de uma placa correlacionando detecções LPR em múltiplas câmeras
          dentro de uma janela de tempo. Útil para investigação de furto, fuga e
          rastreio de veículos suspeitos.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Hash className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={plate}
              onChange={e => setPlate(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="ABC-1234 ou ABC1D23"
              className="w-full pl-8 pr-3 py-2 text-sm bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/40 font-mono uppercase"
              maxLength={8}
            />
          </div>
          <button
            onClick={search}
            disabled={plate.replace(/[^A-Z0-9]/gi, '').length < 5}
            className="px-3 py-2 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-200 text-xs font-semibold hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Search className="w-3.5 h-3.5" />
            Rastrear
          </button>
        </div>
      </GlassCard>

      {hits && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <KpiTile icon={<CameraIcon />} accent="violet"  label="Câmeras"        value={fmtInt(hits.length)} subtitle="detecções correlatas" />
            <KpiTile icon={<Clock />}      accent="cyan"    label="Janela"         value={totalTime != null ? `${totalTime}min` : '—'} subtitle="entre 1ª e última visão" />
            <KpiTile icon={<Route />}      accent="amber"   label="Rota aprox."    value={totalDistance ? `${totalDistance} km` : '—'} subtitle="estimativa" />
            <KpiTile icon={<Eye />}        accent="emerald" label="Confiança média" value={`${Math.round(hits.reduce((a, h) => a + h.confidence, 0) / hits.length * 100)}%`} subtitle="ML score" />
          </div>

          <GlassCard className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Timeline de detecções para <span className="font-mono text-amber-300">{fmtPlate(searched)}</span>
              </h3>
              <span className="text-[10px] text-slate-500">{hits.length} hits</span>
            </div>
            <ol className="relative border-l border-slate-200 dark:border-white/10 ml-2 space-y-3">
              {hits.map((h, i) => (
                <li key={i} className="ml-4">
                  <div className="absolute -left-[7px] mt-1 w-3.5 h-3.5 rounded-full bg-violet-500 border-2 border-space-900 shadow-[0_0_0_3px_rgba(139,92,246,0.18)]" />
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-mono text-amber-300">
                      {new Date(h.ts).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' })}
                    </span>
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">{h.cameraName}</span>
                    <span className="text-[10px] text-slate-500">·</span>
                    <span className="text-[10px] text-slate-400">{h.via}, {h.bairro}</span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded font-mono',
                      h.confidence >= 0.9 ? 'bg-emerald-500/15 text-emerald-300' :
                      h.confidence >= 0.8 ? 'bg-cyan-500/15 text-cyan-300'       :
                                            'bg-amber-500/15 text-amber-300',
                    )}>
                      {Math.round(h.confidence * 100)}%
                    </span>
                    <Link
                      to={`/cameras/${h.cameraId}`}
                      className="ml-auto text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5"
                    >
                      ver câmera <ChevronRight className="w-2.5 h-2.5" />
                    </Link>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-white/5 flex items-center justify-between">
              <Link
                to="/live/map"
                className="text-[11px] text-violet-300 hover:text-violet-200 flex items-center gap-1"
              >
                <MapIcon className="w-3 h-3" />
                Visualizar rota no mapa
              </Link>
              <ExportCsvButton
                basename={`tracking_${searched}`}
                rows={hits}
                columns={[
                  { header: 'Timestamp',  accessor: r => r.ts },
                  { header: 'Câmera',     accessor: r => r.cameraName },
                  { header: 'Bairro',     accessor: r => r.bairro },
                  { header: 'Via',        accessor: r => r.via },
                  { header: 'Confiança',  accessor: r => Math.round(r.confidence * 100) + '%' },
                ]}
                label="CSV"
              />
            </div>
          </GlassCard>
        </>
      )}
      {!hits && (
        <GlassCard className="p-8 text-center text-slate-500 text-sm">
          <MapIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
          Digite uma placa acima para reconstruir a rota cross-camera.
        </GlassCard>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI tile (compatível com UtilizationPage)
// ─────────────────────────────────────────────────────────────────────────────

function KpiTile({
  icon, accent, label, value, subtitle,
}: { icon: React.ReactNode; accent: 'cyan' | 'violet' | 'emerald' | 'rose' | 'amber'; label: string; value: string; subtitle?: string }) {
  const styles = {
    cyan:    { text: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    icon: 'text-cyan-400'    },
    violet:  { text: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  icon: 'text-violet-400'  },
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: 'text-emerald-400' },
    rose:    { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    icon: 'text-rose-400'    },
    amber:   { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   icon: 'text-amber-400'   },
  }[accent]
  return (
    <GlassCard glow={accent} className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div className={cn('p-2 rounded-lg border', styles.bg, styles.border)}>
          <div className={cn('w-4 h-4', styles.icon)}>{icon}</div>
        </div>
      </div>
      <div className={cn('text-2xl font-bold tracking-tight', styles.text)}>{value}</div>
      <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 font-medium">{label}</p>
      {subtitle && <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>}
    </GlassCard>
  )
}
