/**
 * RecordingsPage — central de gravações com tabs integradas.
 *
 * Tabs:
 *   - Playback: revisão HLS por câmera + dia (atual)
 *   - Storage: browser S3 + estatísticas
 *   - Configuração: retenção por câmera (multi-tenant)
 *
 * Multi-tenant:
 *   - Integrador define storageRetainDays padrão
 *   - Câmera pode override com recordRetainDays
 *   - UI mostra origem do valor (herdado vs custom)
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { AnimatePresence } from 'framer-motion'
import { useMyCapabilities } from '../hooks/useMyCapabilities'
import { QuickPurchaseModal, type MarketplaceCatalogProduct } from '../components/marketplace/QuickPurchaseModal'
import {
  Film, Search, Calendar, ChevronLeft, ChevronRight,
  Camera as CameraIcon, ArrowLeft, Filter, Clock, Play,
  HardDrive, Settings2, Folder, FileVideo, Loader2,
  Save, ChevronDown, RefreshCw, Info, Activity,
  Mail, Phone, AlertTriangle, DollarSign, ArrowUpCircle, X, Check,
  Star, MonitorPlay, Keyboard, Download,
} from 'lucide-react'
import { todayLocalIso, localDayStartMs, shiftDay, localSecOfDay } from '../lib/day-utils'
import { brtTime, brtDate, brtDateTime, brtIsoDate, brtDayStartMs } from '../lib/brt'
import { GlassCard } from '../components/cards/GlassCard'
import { useUiToast } from '../components/Toast'
import { PlaybackPlayer, type PlaybackPlayerRef } from '../components/player/PlaybackPlayer'
import { PlaybackTimelineZoom } from '../components/player/PlaybackTimelineZoom'
import { ExportRangeModal } from '../components/player/ExportRangeModal'
import { ExportProgressModal } from '../components/player/ExportProgressModal'
import { StatusTab } from '../components/recordings/StatusTab'
import { useCameras, usePlaybackTimeline, usePlaybackIndex, useSpriteManifest, usePlaybackCoverage, api, formatApiError, createBookmark } from '../api/client'
import { cn } from '../lib/utils'

type Tab = 'playback' | 'status' | 'storage' | 'config'

// todayLocalIso, shiftDay, localDayStartMs, localSecOfDay importados de day-utils.

function dayShift(day: string, deltaDays: number): string {
  return shiftDay(day, deltaDays)
}

/**
 * Range ISO local para playback. Aceita filtro opcional de hora ("HH:MM")
 * pra delimitar a janela dentro do dia. Default: dia inteiro 00:00–23:59.
 * Sem 'Z' no ISO → interpreta como horário local do browser (BRT).
 */
// dayRangeIso removida — não utilizada no JSX atual

/**
 * Monta range ISO local a partir de dia + horas (HH:MM). Se startHour/endHour
 * forem nulos, usa 00:00→23:59 (dia inteiro). Retorna toIso > fromIso.
 */
function hourRangeIso(day: string, startHour: string | null, endHour: string | null): { fromIso: string; toIso: string } {
  const startH = startHour ?? '00:00'
  const endH   = endHour ?? '23:59'
  // BRT fixo (UTC-3): meia-noite BRT do `day` = 03:00 UTC. HH:MM BRT = HH+3:MM UTC.
  const dayMs = brtDayStartMs(day)
  const [sH, sM] = startH.split(':').map(Number)
  const [eH, eM] = endH.split(':').map(Number)
  return {
    fromIso: new Date(dayMs + sH * 3600_000 + sM * 60_000).toISOString(),
    toIso:   new Date(dayMs + eH * 3600_000 + eM * 60_000 + 59_999).toISOString(),
  }
}

/** Converte segundos do dia (0..86400) → "HH:MM" UTC. */
function secOfDayToHHMM(sec: number): string {
  const h = Math.max(0, Math.min(23, Math.floor(sec / 3600)))
  const m = Math.max(0, Math.min(59, Math.floor((sec % 3600) / 60)))
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function RecordingsPage() {
  const [tab, setTab] = useState<Tab>('playback')
  const { data, isLoading: camsLoading, mutate: refetchCameras } = useCameras()
  const cameras: any[] = data?.cameras ?? []
  const [q, setQ] = useState('')
  const [siteFilter, setSiteFilter] = useState('')

  // Deep-link: vindo de /recordings/motion-search (botão "Ver"), recebemos
  // cameraId + at na URL. Inicializamos selectedCameraId/day a partir disso
  // e guardamos o `at` para fazer seekTo() depois que o player carregar.
  const [urlParams] = useSearchParams()
  const initialCameraId = urlParams.get('cameraId')
  const initialAt       = urlParams.get('at')
  // initialDay calculado em BRT (não fuso do browser) — alinha com localDayStartMs/localSecOfDay.
  const initialDay      = initialAt
    ? brtIsoDate(initialAt)
    : todayLocalIso()

  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(initialCameraId)
  const [day, setDay] = useState<string>(initialDay)
  // secOfDay relativo à meia-noite local. Reseta após o primeiro seek.
  const [pendingSeek, setPendingSeek] = useState<number | null>(() => {
    if (!initialAt) return null
    const d = new Date(initialAt)
    const dayMs = localDayStartMs(initialDay)
    return Math.max(0, Math.round((d.getTime() - dayMs) / 1000))
  })
  // null = posição desconhecida (player ainda não emitiu timeupdate). Evita
  // desenhar cursor erradamente em 00:00 UTC quando o vídeo nem começou.
  // Vira número assim que o player carrega o primeiro fragment via PDT.
  const [currentSecOfDay, setCurrentSecOfDay] = useState<number | null>(null)
  // Filtro de hora (HH:MM, UTC). null = dia inteiro (00:00→23:59).
  const [startHour, setStartHour] = useState<string | null>(null)
  const [endHour, setEndHour]     = useState<string | null>(null)

  // Sidebar retrátil — colapsada vira coluna fina de ~52px com só ícones.
  // Persistida em localStorage, atalho `[` toggla.
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('icv:rec:sidebar') !== '0' } catch { return true }
  })
  function toggleSidebar() {
    setSidebarOpen(v => {
      const next = !v
      try { localStorage.setItem('icv:rec:sidebar', next ? '1' : '0') } catch {}
      return next
    })
  }

  const playerRef = useRef<PlaybackPlayerRef>(null)

  // Atalho `[` pra toggle sidebar (global no escopo da página).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '[') { e.preventDefault(); toggleSidebar() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sites = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of cameras) if (c.site) seen.set(c.site.id, c.site.name)
    return [...seen.entries()]
  }, [cameras])

  // Mostra TODAS as câmeras (não filtra recordEnabled=false). Câmeras sem
  // gravação aparecem com badge + abrem upsell em vez de player. Antes elas
  // sumiam da lista, confundindo o cliente que achava ter perdido a câmera.
  const filtered = useMemo(() => cameras.filter(c => {
    if (q && !c.name?.toLowerCase().includes(q.toLowerCase())) return false
    if (siteFilter && c.site?.id !== siteFilter) return false
    return true
  }), [cameras, q, siteFilter])

  const recordingCount = useMemo(() => filtered.filter(c => c.recordEnabled !== false).length, [filtered])

  useEffect(() => {
    if (!selectedCameraId && filtered.length > 0) {
      setSelectedCameraId(filtered[0].id)
    }
  }, [filtered, selectedCameraId])

  const selectedCamera = cameras.find(c => c.id === selectedCameraId)

  const { data: timeline, mutate: mutateTimeline } = usePlaybackTimeline(selectedCameraId, day)
  const { data: index } = usePlaybackIndex(selectedCameraId)
  const { data: spriteManifest } = useSpriteManifest(selectedCameraId, day)
  // Detecta se o `at` do deep-link cai dentro de um gap de gravação.
  // Mostra banner amarelo explicando + sugere segmento mais próximo.
  const { data: coverage } = usePlaybackCoverage(selectedCameraId, initialAt)

  const daysWithRecording = useMemo(() => {
    return new Set(index?.days?.map((d: any) => d.day) ?? [])
  }, [index])

  const range = useMemo(() => hourRangeIso(day, startHour, endHour),
    [day, startHour, endHour])

  // Deep-link seek: aguarda timeline carregar pra garantir que o segmento
  // existe, depois pula no player. Reseta pendingSeek pra rodar uma vez só.
  useEffect(() => {
    if (pendingSeek == null) return
    if (!timeline || !playerRef.current) return
    // Pequeno delay pra o PlaybackPlayer terminar de montar/anexar HLS
    const t = setTimeout(() => {
      playerRef.current?.seekTo(pendingSeek)
      setPendingSeek(null)
    }, 600)
    return () => clearTimeout(t)
  }, [pendingSeek, timeline])

  function handleSeek(secOfDay: number) {
    playerRef.current?.seekTo(secOfDay)
  }

  function changeDay(delta: number) {
    setDay(d => dayShift(d, delta))
    setCurrentSecOfDay(null)
  }

  /**
   * Jump pro "AO VIVO" — disparado por double-click na bolinha do playhead.
   * Comportamento:
   *   1. Se já está em outro dia, troca pra hoje (re-fetch automático
   *      via React Query).
   *   2. Calcula segundos do dia ATUAL em UTC (timeline usa UTC internamente,
   *      o conversor BRT só roda no display).
   *   3. Chama handleSeek pro player buscar nesse instante.
   *
   * Se a câmera tem gravação contínua, o vídeo vai pular pro frame mais
   * recente. Se há gap (camera offline), HLS retorna 404 e o player exibe
   * "sem gravação" — comportamento idêntico ao seek manual nessa posição.
   */
  function handleJumpToLive() {
    const today = todayLocalIso()
    if (day !== today) setDay(today)
    handleSeek(localSecOfDay(new Date()))
  }

  const TABS = [
    { id: 'playback' as const, icon: Play, label: 'Playback' },
    { id: 'status' as const, icon: Activity, label: 'Status' },
    { id: 'storage' as const, icon: HardDrive, label: 'Storage' },
    { id: 'config' as const, icon: Settings2, label: 'Configuração' },
  ]

  return (
    <div className="space-y-2">
      {/* ── Barra compacta unificada (substitui Hero gigante + Tabs row).
          ~40px de altura, mostra: título · tabs inline · ações.
          Libera ~120px verticais que antes eram do hero+tabs separados. ── */}
      <div className={cn(
        'flex items-center justify-between gap-3 flex-wrap px-3 py-1.5 rounded-lg border',
        'bg-slate-100 border-slate-200',
        'dark:bg-white/[0.04] dark:border-white/10',
      )}>
        <div className="flex items-center gap-2 min-w-0">
          <Film className="w-4 h-4 text-vsaas-cyan" />
          <h1 className="text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">Gravações</h1>
          <span className="hidden md:inline-flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-600 border border-amber-400/30 dark:text-amber-300">HLS</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-600 border border-emerald-400/30 dark:text-emerald-300">S3/R2</span>
          </span>
          <Link
            to="/recordings/motion-search"
            className="hidden sm:inline-flex items-center gap-1 ml-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-300 border border-violet-400/30 hover:bg-violet-500/20 transition"
            title="Buscar movimento desenhando uma zona na cena"
          >
            🔎 Busca por Zona
          </Link>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tabs inline compactos */}
          <div className={cn(
            'flex rounded-md border p-0.5',
            'bg-white border-slate-200',
            'dark:bg-white/[0.03] dark:border-white/10',
          )}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'px-2 py-1 text-[11px] font-medium rounded flex items-center gap-1 transition-all',
                  tab === t.id
                    ? 'bg-vsaas-cyan/10 text-vsaas-deepNavy ring-1 ring-vsaas-cyan/20 dark:text-vsaas-cyan dark:ring-vsaas-cyan/30'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/[0.06]',
                )}
                title={t.label}
              >
                <t.icon className="w-3 h-3" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
          <Link
            to="/live"
            className={cn(
              'px-2 py-1 rounded-md border text-[11px] font-semibold flex items-center gap-1 transition-colors',
              'bg-white border-slate-200 text-slate-700 hover:bg-slate-100',
              'dark:bg-white/5 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white',
            )}
          >
            <ArrowLeft className="w-3 h-3" />
            Ao Vivo
          </Link>
        </div>
      </div>

      <div
        className={cn(
          'grid gap-3',
          // Layout responsivo: aberta = 280px + resto / colapsada = 52px + resto
          // Em mobile (lg-) sempre stacked (sidebar acima)
          sidebarOpen
            ? 'grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]'
            : 'grid-cols-1 lg:grid-cols-[52px_minmax(0,1fr)]',
        )}
      >
        {/* Sidebar — câmeras (retrátil) */}
        {sidebarOpen ? (
          <GlassCard className="p-3 max-h-[78vh] overflow-y-auto">
          <div className={cn(
            'space-y-2 sticky top-0 z-10 pb-2 border-b flex flex-col',
            'bg-white border-slate-200',
            'dark:bg-space-900 dark:border-white/5',
          )}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Câmeras</span>
              <button
                type="button"
                onClick={toggleSidebar}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white"
                title="Colapsar sidebar ([)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar câmera..."
                className={cn(
                  'w-full pl-8 pr-3 py-1.5 text-xs rounded-md focus:outline-none border',
                  'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-vsaas-cyan',
                  'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500 dark:focus:border-vsaas-cyan/60',
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
                {sites.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            )}
            <p className="text-[10px] text-slate-500 flex items-center gap-1">
              <Filter className="w-3 h-3" />
              {recordingCount}/{filtered.length} com gravação ativa
            </p>
          </div>

          {camsLoading ? (
            <p className="text-xs text-slate-500 text-center py-8">Carregando…</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8 px-2">
              Nenhuma câmera neste tenant.
            </p>
          ) : (
            <ul className="space-y-1 mt-2">
              {filtered.map(c => {
                const noRec = c.recordEnabled === false
                return (
                <li
                  key={c.id}
                  onClick={() => { setSelectedCameraId(c.id); setCurrentSecOfDay(null) }}
                  className={cn(
                    'p-2 rounded-lg border cursor-pointer transition',
                    c.id === selectedCameraId
                      ? 'border-amber-400 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-500/10'
                      : noRec
                        ? cn(
                            'border-slate-200 bg-slate-50/50 opacity-70 hover:opacity-100 hover:border-cyan-300',
                            'dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-cyan-500/30',
                          )
                        : cn(
                            'border-slate-200 bg-slate-50 hover:border-amber-300',
                            'dark:border-white/5 dark:bg-white/[0.03] dark:hover:border-amber-500/30',
                          ),
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className={cn(
                      'w-6 h-6 rounded flex items-center justify-center shrink-0',
                      noRec
                        ? 'bg-slate-200 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'
                        : c.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400',
                    )}>
                      <CameraIcon className="w-3 h-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate text-slate-900 dark:text-white">{c.name}</p>
                      <p className="text-[10px] truncate text-slate-500">{c.site?.name ?? '—'}</p>
                      {noRec ? (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                          🔇 sem gravação
                        </p>
                      ) : (
                        <p className="text-[10px] text-slate-500">
                          <span className="text-vsaas-cyan dark:text-vsaas-cyan">{c.recordRetainDays ?? 7}d</span>
                          {' · '}{c.recordMode || 'ALL'}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              )})}
            </ul>
          )}
        </GlassCard>
        ) : (
          // Sidebar colapsada — coluna fina 52px só com ícones.
          // Click no toggle expande, click em câmera seleciona + abre.
          <div className={cn(
            'rounded-lg border p-1.5 flex flex-col items-center gap-1.5 max-h-[78vh] overflow-y-auto',
            'bg-white border-slate-200',
            'dark:bg-white/[0.03] dark:border-white/10',
          )}>
            <button
              type="button"
              onClick={toggleSidebar}
              className="w-9 h-9 rounded-md flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white"
              title="Expandir sidebar ([)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="w-8 h-px bg-slate-100 dark:bg-white/10" />
            {filtered.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => { setSelectedCameraId(c.id); setCurrentSecOfDay(null) }}
                className={cn(
                  'w-9 h-9 rounded-md flex items-center justify-center transition relative',
                  c.id === selectedCameraId
                    ? 'bg-vsaas-cyan/15 text-vsaas-cyan ring-1 ring-vsaas-cyan/40'
                    : 'hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 dark:text-slate-500 dark:hover:text-white',
                )}
                title={`${c.name} · ${c.site?.name ?? '—'} · ${c.recordRetainDays ?? 7}d`}
              >
                <CameraIcon className="w-4 h-4" />
                {c.status === 'ACTIVE' && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Main content */}
        <div className="flex flex-col gap-2 min-w-0">
          {tab === 'playback' && (
            selectedCamera && selectedCamera.recordEnabled === false ? (
              <NoRecordingUpsell
                cameraId={selectedCamera.id}
                cameraName={selectedCamera.name}
                onActivated={() => refetchCameras()}
              />
            ) : (
              <PlaybackTab
                selectedCamera={selectedCamera}
                day={day}
                setDay={setDay}
                changeDay={changeDay}
                timeline={timeline}
                mutateTimeline={mutateTimeline}
                spriteManifest={spriteManifest}
                daysWithRecording={daysWithRecording}
                range={range}
                startHour={startHour}
                setStartHour={setStartHour}
                endHour={endHour}
                setEndHour={setEndHour}
                currentSecOfDay={currentSecOfDay}
                setCurrentSecOfDay={setCurrentSecOfDay}
                handleSeek={handleSeek}
                handleJumpToLive={handleJumpToLive}
                playerRef={playerRef}
                initialAt={initialAt}
                coverage={coverage}
              />
            )
          )}
          {tab === 'status' && <StatusTab cameras={filtered} />}
          {tab === 'storage' && <StorageTab selectedCamera={selectedCamera} />}
          {tab === 'config' && (
            <ConfigTab
              selectedCamera={selectedCamera}
              cameras={filtered}
              refetchCameras={refetchCameras}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// EMPTY STATE: câmera com recordEnabled=false
//
// Não confundir com câmera SEM subscription STORAGE — esse é tratado pelo
// PlaybackPlayer + CapabilityBlockedView. Aqui o cliente tem a subscription
// mas desativou gravação nesta câmera específica (LGPD, custo, etc).
// ═══════════════════════════════════════════════════════════════════════════
function NoRecordingUpsell({
  cameraId, cameraName, onActivated,
}: { cameraId: string; cameraName: string; onActivated: () => void }) {
  const toast = useUiToast()
  const { has } = useMyCapabilities()
  const hasStorageCap = has('storage.playback.timeline')
  const [activating, setActivating] = useState(false)
  const [showPurchase, setShowPurchase] = useState<MarketplaceCatalogProduct | null>(null)

  async function activateRecording() {
    setActivating(true)
    try {
      await api.patch(`/cameras/${cameraId}`, { recordEnabled: true })
      toast.success(`Gravação ativada para ${cameraName}`)
      onActivated()
    } catch (e) {
      toast.error('Falha ao ativar gravação: ' + formatApiError(e))
    } finally {
      setActivating(false)
    }
  }

  // Busca o produto STORAGE recomendado pra essa capability
  const { data: productData } = useSWR<{
    product: MarketplaceCatalogProduct | null
  }>(
    !hasStorageCap ? `/me/capabilities/product-for/storage.playback.timeline` : null,
    (url: string) => api.get(url).then(r => r.data),
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  )

  return (
    <>
      <div className="flex items-center justify-center min-h-[55vh] p-6">
        <div className="max-w-xl w-full rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-transparent p-8 shadow-xl">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/40 flex items-center justify-center mb-4 text-3xl">
              🔇
            </div>
            <h2 className="text-xl font-bold text-slate-100 mb-1">
              Esta câmera não está gravando
            </h2>
            <p className="text-xs text-slate-500 mb-2">{cameraName}</p>
            <p className="text-sm text-slate-400 leading-relaxed">
              {hasStorageCap
                ? 'A gravação foi desativada nesta câmera. As demais continuam gravando normalmente.'
                : 'Você ainda não tem plano de gravação contratado para este cliente. Os streams ao vivo continuam funcionando — só as gravações em nuvem precisam de assinatura.'}
            </p>
          </div>

          {hasStorageCap ? (
            // Tem plano — só falta o toggle desta câmera
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-center">
              <div className="flex items-center justify-center gap-2 mb-3">
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-300">Plano de gravação ativo</span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Clique abaixo pra ativar gravação contínua desta câmera no plano que você já tem.
              </p>
              <button
                onClick={activateRecording}
                disabled={activating}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 transition inline-flex items-center gap-2"
              >
                {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                Ativar gravação nesta câmera
              </button>
            </div>
          ) : productData?.product ? (
            // Sem plano — upsell com QuickPurchaseModal inline
            <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-xl shrink-0">
                  📦
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold">
                    {productData.product.category}
                  </div>
                  <div className="text-base font-bold text-white">{productData.product.name}</div>
                  {productData.product.tagline && (
                    <div className="text-xs text-slate-400">{productData.product.tagline}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-slate-500">a partir de</div>
                  <div className="text-lg font-bold text-cyan-400">
                    R$ {Number(productData.product.finalPriceBrl ?? productData.product.fromPriceBrl ?? 0).toFixed(0)}
                    <span className="text-xs text-slate-500 font-normal">
                      {productData.product.pricingModel === 'FLAT_MONTH' ? '/mês' : '/câm/mês'}
                    </span>
                  </div>
                </div>
              </div>
              <ul className="space-y-1 mb-4 text-xs text-slate-300">
                <li className="flex items-center gap-2"><Check className="w-3 h-3 text-cyan-400" /> Gravação contínua 24/7</li>
                <li className="flex items-center gap-2"><Check className="w-3 h-3 text-cyan-400" /> Busca por timeline e exportação</li>
                <li className="flex items-center gap-2"><Check className="w-3 h-3 text-cyan-400" /> Conformidade LGPD com retenção configurável</li>
              </ul>
              <button
                onClick={() => setShowPurchase(productData.product)}
                className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-bold hover:opacity-90 transition inline-flex items-center justify-center gap-2"
              >
                Contratar {productData.product.name}
                <ChevronRight className="w-4 h-4" />
              </button>
              <p className="text-[10px] text-slate-500 text-center mt-2">
                Compra direto aqui, sem sair da página.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-500/30 bg-slate-800/50 p-4 text-center text-xs text-slate-400">
              Entre em contato com seu integrador para ativar gravação em nuvem.
            </div>
          )}
        </div>
      </div>

      {/* QuickPurchaseModal renderizado em overlay — não navega pra fora */}
      <AnimatePresence>
        {showPurchase && (
          <QuickPurchaseModal
            product={showPurchase}
            onClose={() => setShowPurchase(null)}
            onContracted={() => {
              setShowPurchase(null)
              onActivated() // refresh cameras pra refletir nova capability
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBACK TAB
// ═══════════════════════════════════════════════════════════════════════════
function PlaybackTab({
  selectedCamera, day, setDay, changeDay, timeline, mutateTimeline, spriteManifest, daysWithRecording,
  range, startHour, setStartHour, endHour, setEndHour,
  currentSecOfDay, setCurrentSecOfDay, handleSeek, handleJumpToLive, playerRef,
  initialAt, coverage,
}: any) {
  const toast = useUiToast()
  // ── Modo Cinema (Modelo C) ─────────────────────────────────────────────
  // Toggle via atalho `C` ou botão na toolbar do player. Quando ativo:
  // sidebar/header da página recolhem, player ocupa ~88vh, timeline + ações
  // viram overlay flutuante. Persistido em sessionStorage (some ao recarregar).
  const [cinemaMode, setCinemaMode] = useState<boolean>(() => {
    try { return sessionStorage.getItem('icv:cinema') === '1' } catch { return false }
  })
  function toggleCinema() {
    setCinemaMode(v => {
      const next = !v
      try { sessionStorage.setItem('icv:cinema', next ? '1' : '0') } catch {}
      return next
    })
  }

  // ── Bookmark draft (right-click na timeline) ──────────────────────────
  // Quando usuário clica com botão direito, abrimos modal pra título + cor.
  // secOfDay é convertido pra ISO ao salvar (dayUtc + sec * 1000).
  const [bookmarkDraft, setBookmarkDraft] = useState<{
    sec: number; title: string; color: string; saving: boolean; error: string | null
  } | null>(null)

  // B1 (2026-05-09): export de trecho. Modal pega range, dispara POST
  // /exports/recording → recebe jobId → abre ExportProgressModal pra
  // pollear status até "done" (com link de download).
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportJobId, setExportJobId] = useState<string | null>(null)

  function openBookmarkModal(sec: number) {
    if (!selectedCamera) return
    setBookmarkDraft({
      sec,
      title: '',
      color: '#F59E0B',
      saving: false,
      error: null,
    })
  }

  // ── Snapshot do frame atual ─────────────────────────────────────────────
  //
  // 2026-05-12 — P0-2 fix LGPD bypass.
  // Antes: canvas.toBlob client-side gerava o JPG localmente e baixava.
  // Não gravava ExportAudit, não emitia MediaCertificate, não passava por
  // requireCameraForUser. Operador podia exfiltrar snapshot sem rastro.
  //
  // Agora: dispara o pipeline oficial /exports/snapshot:
  //   1. Backend faz requireAuth + requireCameraForUser
  //   2. Renderiza frame via ffmpeg+manifest (mais fiel ao bitstream que canvas)
  //   3. Emite MediaCertificate com assinatura HMAC
  //   4. Persiste ExportAudit row (LGPD compliance)
  //   5. Retorna jobId; modal de progresso resolve URL+download
  async function snapshotCurrentFrame() {
    if (!selectedCamera || currentSecOfDay == null) return
    try {
      // Converte secOfDay (relativo à meia-noite local) → epoch UTC.
      const dayMs    = localDayStartMs(day)
      const targetMs = dayMs + currentSecOfDay * 1000
      const r = await api.post('/exports/snapshot', {
        cameraId:           selectedCamera.id,
        at:                 new Date(targetMs).toISOString(),
        format:             'jpg',
        includeCertificate: true,
      })
      const jobId = r.data?.jobId
      if (!jobId) throw new Error('jobId ausente')
      // Reaproveita o modal de progresso já existente — polleia status e
      // entrega o download quando concluído (já com assinatura digital).
      setExportJobId(jobId)
    } catch (err: any) {
      const msg = formatApiError(err)
      toast.error(`Falha ao gerar snapshot: ${msg}`)
    }
  }

  // ── Atalhos de teclado globais ──────────────────────────────────────────
  // Funcionam sem precisar focar nenhum elemento específico — operador
  // não precisa clicar na timeline pra usar setas.
  // Cuidado: só dispara se foco NÃO estiver em input/textarea (digitando).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // ── Navegação no tempo (setas + espaço) ─────────────────────────
      // Usa playerRef.seekTo (absoluto via PDT) em vez de mexer direto no
      // <video> — assim respeita gaps e segments cruzando o range.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (currentSecOfDay == null) return
        e.preventDefault()
        const big   = e.shiftKey ? 30 : 5
        const delta = e.key === 'ArrowLeft' ? -big : big
        const next  = Math.max(0, Math.min(86399, currentSecOfDay + delta))
        playerRef.current?.seekTo(next)
        return
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        playerRef.current?.togglePlay()
        return
      }
      if (e.key === 'Home' && currentSecOfDay != null) {
        e.preventDefault(); playerRef.current?.seekTo(0); return
      }
      if (e.key === 'End' && currentSecOfDay != null) {
        e.preventDefault(); playerRef.current?.seekTo(86399); return
      }
      // Pula 0..9 → 0%..90% do dia (atalho rápido pra explorar)
      if (e.key >= '0' && e.key <= '9') {
        const pct = parseInt(e.key, 10) / 10
        playerRef.current?.seekTo(Math.floor(pct * 86400))
        e.preventDefault()
        return
      }

      // ── Ações contextuais ───────────────────────────────────────────
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault(); toggleCinema()
      } else if (e.key === 'Escape' && cinemaMode) {
        e.preventDefault(); setCinemaMode(false)
        try { sessionStorage.setItem('icv:cinema', '0') } catch {}
      } else if ((e.key === 'b' || e.key === 'B') && currentSecOfDay != null && !bookmarkDraft) {
        e.preventDefault(); openBookmarkModal(Math.floor(currentSecOfDay))
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault(); snapshotCurrentFrame()
      } else if ((e.key === 'e' || e.key === 'E') && selectedCamera && !exportModalOpen && !exportJobId) {
        // B1: atalho "E" abre modal de export pro trecho atual.
        e.preventDefault(); setExportModalOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cinemaMode, currentSecOfDay, bookmarkDraft, selectedCamera, day, exportModalOpen, exportJobId])

  // Filtros chip — drawer expansível. Default fechado pra liberar espaço.
  const [filtersOpen, setFiltersOpen] = useState(false)

  async function submitBookmark() {
    if (!bookmarkDraft || !selectedCamera) return
    if (bookmarkDraft.title.trim().length < 2) {
      setBookmarkDraft({ ...bookmarkDraft, error: 'Título precisa de ao menos 2 letras' })
      return
    }
    setBookmarkDraft({ ...bookmarkDraft, saving: true, error: null })
    try {
      const startAt = localDayStartMs(day) + bookmarkDraft.sec * 1000
      await createBookmark({
        cameraId: selectedCamera.id,
        title:    bookmarkDraft.title.trim(),
        color:    bookmarkDraft.color,
        startAt:  new Date(startAt).toISOString(),
      })
      setBookmarkDraft(null)
      // Refrescar timeline pra novo bookmark aparecer na faixa de bookmarks.
      mutateTimeline?.()
    } catch (err: any) {
      setBookmarkDraft({
        ...bookmarkDraft,
        saving: false,
        error: formatApiError(err) || 'Falha ao salvar',
      })
    }
  }

  if (!selectedCamera) {
    return (
      <GlassCard className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-slate-500">
        <Film className="w-12 h-12 mb-2 opacity-40" />
        <p className="text-sm">Selecione uma câmera na lista lateral.</p>
      </GlassCard>
    )
  }

  // Resumo de filtros pro chip header (1 linha de ~32px) — substitui
  // GlassCard de ~110px com day picker + hour filter expandidos.
  const filterSummary = (() => {
    const dt = new Date(`${day}T12:00:00`)  // meio-dia local evita drift DST
    const dStr = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    const hourLabel =
      startHour === null && endHour === null ? 'Dia inteiro'
      : `${startHour ?? '00:00'} → ${endHour ?? '23:59'}`
    return { dStr, hourLabel }
  })()

  return (
    <>
      {/* Banner: evento durante gap de gravação ───────────────────────────── */}
      {initialAt && coverage && !coverage.coversExactly && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 mb-2 text-[12px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <span className="text-amber-500 shrink-0">⚠️</span>
          <div className="flex-1">
            <strong>Evento durante gap de gravação.</strong>{' '}
            O alerta foi capturado em <span className="font-mono">{brtTime(initialAt)} BRT</span>, mas não há vídeo gravado neste instante exato (recorder estava reiniciando ou câmera offline brevemente).
            {coverage.nearestBefore && (
              <span className="block mt-0.5">
                ⬅️ Último segmento antes: <span className="font-mono">{brtTime(coverage.nearestBefore.segmentEnd)} BRT</span> (gap de {coverage.nearestBefore.gapSec}s)
              </span>
            )}
            {coverage.nearestAfter && (
              <span className="block">
                ➡️ Próximo segmento depois: <span className="font-mono">{brtTime(coverage.nearestAfter.segmentStart)} BRT</span> (gap de {coverage.nearestAfter.gapSec}s)
              </span>
            )}
            <span className="block mt-0.5 text-[11px] opacity-80">A imagem analisada pela IA está disponível no alerta enviado (WhatsApp/push). A gravação retoma após o gap.</span>
          </div>
        </div>
      )}

      {/* ── Chip de filtros (substitui GlassCard expandido de filtros).
          1 linha compacta com data, range, stats. Click expande drawer
          inline. Total ~32px no estado fechado. ── */}
      <div className={cn(
        'rounded-md border',
        'bg-slate-50 border-slate-200',
        'dark:bg-white/[0.03] dark:border-white/10',
      )}>
        {/* Linha resumo — sempre visível, totalmente clicável */}
        <button
          type="button"
          onClick={() => setFiltersOpen(o => !o)}
          className="w-full px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[11px] hover:bg-white/[0.02] rounded-md"
        >
          <Calendar className="w-3.5 h-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
          <span className="font-semibold text-slate-900 dark:text-white">{filterSummary.dStr}</span>
          <span className="text-slate-400">·</span>
          <Clock className="w-3 h-3 text-cyan-500 dark:text-cyan-400" />
          <span className="text-slate-700 dark:text-slate-300">{filterSummary.hourLabel}</span>

          {/* Stats inline */}
          {timeline && (() => {
            const realSec  = timeline.realCoverageSec ?? timeline.coverageMin * 60
            const realMin  = Math.round(realSec / 60)
            const apparMin = timeline.coverageMin
            const fragmented = apparMin > 0 && (apparMin - realMin) / apparMin > 0.1
            return (
              <>
                <span className="text-slate-400">·</span>
                <span className="font-semibold text-cyan-700 dark:text-cyan-300">{realMin}min</span>
                <span className="text-slate-500">recuperável</span>
                {fragmented && (
                  <span title={`Apar. ${apparMin}min, real ${realMin}min`}
                        className="px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    ⚠ frag.
                  </span>
                )}
                {(timeline.gaps?.length ?? 0) > 0 && (
                  <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400">
                    ⚠ {timeline.gaps!.length} gap{timeline.gaps!.length > 1 ? 's' : ''}
                  </span>
                )}
              </>
            )
          })()}

          {daysWithRecording.size > 0 && !daysWithRecording.has(day) && (
            <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
              sem gravação
            </span>
          )}

          <span className="flex-1" />
          <ChevronDown className={cn(
            'w-3.5 h-3.5 text-slate-400 transition-transform',
            filtersOpen && 'rotate-180',
          )} />
        </button>

        {/* Drawer — só renderiza quando aberto */}
        {filtersOpen && (
          <div className="px-2.5 py-2 border-t border-slate-200 dark:border-white/10 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => changeDay(-1)} className={cn(
                'p-1 rounded', 'bg-slate-100 hover:bg-slate-200 text-slate-700',
                'dark:bg-white/5 dark:hover:bg-slate-100 dark:bg-white/10 dark:text-white',
              )} title="Dia anterior">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <input
                type="date"
                value={day}
                onChange={e => { setDay(e.target.value); setCurrentSecOfDay(null) }}
                className={cn(
                  'px-2 py-1 text-xs rounded-md border',
                  'bg-slate-50 border-slate-200 text-slate-900',
                  'dark:bg-white/5 dark:border-white/10 dark:text-white',
                )}
              />
              <button onClick={() => changeDay(1)} className={cn(
                'p-1 rounded', 'bg-slate-100 hover:bg-slate-200 text-slate-700',
                'dark:bg-white/5 dark:hover:bg-slate-100 dark:bg-white/10 dark:text-white',
              )} title="Próximo dia">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setDay(new Date().toISOString().split('T')[0]); setCurrentSecOfDay(null) }} className={cn(
                'px-2 py-1 text-[11px] rounded font-semibold',
                'bg-slate-100 hover:bg-slate-200 text-slate-700',
                'dark:bg-white/5 dark:hover:bg-slate-100 dark:bg-white/10 dark:text-slate-300',
              )}>
                Hoje
              </button>

              <span className="mx-2 h-5 w-px bg-slate-300 dark:bg-white/10" />

              <span className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Hora UTC</span>
              <input
                type="time"
                value={startHour ?? '00:00'}
                onChange={e => { setStartHour(e.target.value); setCurrentSecOfDay(null) }}
                className={cn(
                  'px-2 py-1 text-xs rounded-md border w-[88px]',
                  'bg-slate-50 border-slate-200 text-slate-900',
                  'dark:bg-white/5 dark:border-white/10 dark:text-white',
                )}
              />
              <span className="text-[10px] text-slate-500">→</span>
              <input
                type="time"
                value={endHour ?? '23:59'}
                onChange={e => { setEndHour(e.target.value); setCurrentSecOfDay(null) }}
                className={cn(
                  'px-2 py-1 text-xs rounded-md border w-[88px]',
                  'bg-slate-50 border-slate-200 text-slate-900',
                  'dark:bg-white/5 dark:border-white/10 dark:text-white',
                )}
              />
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {[
                { label: 'Dia inteiro', s: null,    e: null    },
                { label: 'Manhã',       s: '06:00', e: '12:00' },
                { label: 'Tarde',       s: '12:00', e: '18:00' },
                { label: 'Noite',       s: '18:00', e: '23:59' },
                { label: 'Última hora', s: secOfDayToHHMM(Math.max(0, currentSecOfDay - 3600)),
                  e: secOfDayToHHMM(Math.min(86399, currentSecOfDay)) },
              ].map(p => (
                <button
                  key={p.label}
                  onClick={() => { setStartHour(p.s); setEndHour(p.e); setCurrentSecOfDay(null) }}
                  className={cn(
                    'px-2 py-1 text-[10px] rounded-md border font-medium transition',
                    ((p.s === startHour && p.e === endHour) ||
                     (p.s === null && startHour === null && endHour === null))
                      ? 'bg-cyan-100 border-cyan-300 text-cyan-700 dark:bg-cyan-500/20 dark:border-cyan-500/40 dark:text-cyan-300'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-white/5 dark:border-white/10 dark:text-slate-400 dark:hover:bg-slate-100 dark:bg-white/10',
                  )}
                >
                  {p.label}
                </button>
              ))}
              {(startHour !== null || endHour !== null) && (
                <button
                  onClick={() => { setStartHour(null); setEndHour(null) }}
                  className="text-[10px] text-rose-500 hover:underline ml-2"
                  title="Limpar filtro de hora"
                >
                  limpar
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Player com timeline overlay (Modelo A) — vídeo cresce até ocupar
          todo o espaço disponível. Timeline + controles ficam num único bloco
          flutuante no rodapé do vídeo, com auto-hide elegante.
          Cinema mode (Modelo C) cresce o player pra ~88vh e oculta sidebar. */}
      <div
        className={cn(
          cinemaMode
            ? 'fixed inset-0 z-50 bg-black/95 backdrop-blur p-4 flex items-center justify-center'
            : 'w-full',
        )}
      >
        <PlaybackPlayer
          ref={playerRef}
          cameraId={selectedCamera.id}
          fromIso={range.fromIso}
          toIso={range.toIso}
          dayUtcDate={day}
          onTimeUpdate={(secOfDay: number) => setCurrentSecOfDay(secOfDay)}
          // Cinema: ocupa quase a viewport inteira respeitando 16:9.
          // Padrão: aspect-video + altura mínima generosa pra cresce até ~65vh.
          className={cn(
            cinemaMode
              ? 'w-full max-w-[1800px] aspect-video max-h-[92vh]'
              : 'w-full aspect-video max-h-[70vh]',
          )}
          isCinemaActive={cinemaMode}
          onFullscreenToggle={toggleCinema}
          // Timeline como overlay no rodapé do vídeo (Modelo A).
          // compact=true esconde o header de toggles e o mini-mapa — fica só
          // a track. Mais minimalista, não compete com o vídeo.
          overlayBottom={
            <PlaybackTimelineZoom
              bitmap={timeline?.bitmap}
              motionBitmap={timeline?.motionBitmap}
              intensity={timeline?.intensity}
              events={timeline?.events}
              bookmarks={timeline?.bookmarks}
              gaps={timeline?.gaps}
              spriteHours={spriteManifest?.hours}
              currentSecOfDay={currentSecOfDay}
              dayUtcDate={day}
              onSeek={handleSeek}
              onCreateBookmark={openBookmarkModal}
              // Pan da timeline atravessa fronteira do dia (mãozinha rola
              // pra ontem/amanhã). Reseta currentSecOfDay pra evitar pulo
              // visual do playhead enquanto novos dados carregam.
              onDayChange={(newDay) => { setDay(newDay); setCurrentSecOfDay(null) }}
              // Double-click na bolinha amarela = volta pro AO VIVO
              // (troca pra hoje + seek pro instante atual UTC).
              onJumpToLive={handleJumpToLive}
              compact
            />
          }
          // Ações contextuais (Bookmark · Snapshot · Cinema) entre o time
          // atual e o speed selector. Fullscreen reusa botão existente
          // (toggleCinema via onFullscreenToggle).
          toolbarActions={
            <>
              <button
                type="button"
                onClick={() => currentSecOfDay != null && openBookmarkModal(Math.floor(currentSecOfDay))}
                disabled={currentSecOfDay == null}
                className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                title="Bookmark agora (B)"
              >
                <Star className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={snapshotCurrentFrame}
                className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
                title="Snapshot (S)"
              >
                <CameraIcon className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setExportModalOpen(true)}
                className="p-1.5 rounded-md bg-cyan-500/30 hover:bg-cyan-500/50 text-white"
                title="Exportar trecho como MP4 (E)"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={toggleCinema}
                className={cn(
                  'p-1.5 rounded-md text-slate-900 dark:text-white',
                  cinemaMode ? 'bg-amber-500/40 hover:bg-amber-500/60' : 'bg-slate-100 dark:bg-white/10 hover:bg-white/20',
                )}
                title={cinemaMode ? 'Sair do cinema (C/Esc)' : 'Modo cinema (C)'}
              >
                <MonitorPlay className="w-3.5 h-3.5" />
              </button>
            </>
          }
        />
      </div>

      {/* Hint discreto de atalhos — substitui legenda detalhada da timeline */}
      {!cinemaMode && (
        <p className="text-[10px] text-slate-500 flex items-center gap-2 px-1">
          <Keyboard className="w-3 h-3" />
          <span>
            <kbd className="px-1 py-0.5 bg-slate-50 dark:bg-white/5 rounded">Espaço</kbd> tocar ·{' '}
            <kbd className="px-1 py-0.5 bg-slate-50 dark:bg-white/5 rounded">←</kbd>/<kbd className="px-1 py-0.5 bg-slate-50 dark:bg-white/5 rounded">→</kbd> ±5s ·{' '}
            <kbd className="px-1 py-0.5 bg-slate-50 dark:bg-white/5 rounded">B</kbd> bookmark ·{' '}
            <kbd className="px-1 py-0.5 bg-slate-50 dark:bg-white/5 rounded">S</kbd> snapshot ·{' '}
            <kbd className="px-1 py-0.5 bg-slate-50 dark:bg-white/5 rounded">E</kbd> exportar ·{' '}
            <kbd className="px-1 py-0.5 bg-slate-50 dark:bg-white/5 rounded">C</kbd> cinema ·{' '}
            <kbd className="px-1 py-0.5 bg-slate-50 dark:bg-white/5 rounded">btn-direito</kbd> bookmark no instante
          </span>
        </p>
      )}

      {/* Modal: novo bookmark (right-click na timeline) */}
      {bookmarkDraft && (
        <BookmarkCreateModal
          draft={bookmarkDraft}
          dayUtc={day}
          onChange={(d: any) => setBookmarkDraft({ ...bookmarkDraft, ...d })}
          onCancel={() => setBookmarkDraft(null)}
          onSubmit={submitBookmark}
        />
      )}

      {/* B1: modal de configuração do export */}
      {exportModalOpen && selectedCamera && (
        <ExportRangeModal
          cameraId={selectedCamera.id}
          cameraName={selectedCamera.name}
          dayUtc={day}
          defaultStartSec={currentSecOfDay ?? 0}
          defaultEndSec={Math.min(86399, (currentSecOfDay ?? 0) + 600)}
          onJobCreated={(jobId) => { setExportJobId(jobId); setExportModalOpen(false) }}
          onClose={() => setExportModalOpen(false)}
        />
      )}

      {/* B1: progresso do export (mostra polling + link download) */}
      {exportJobId && (
        <ExportProgressModal
          jobId={exportJobId}
          onClose={() => setExportJobId(null)}
        />
      )}

      {/* Fallback de clips do vault — quando HLS não tem cobertura no dia */}
      {(!timeline || (timeline.coverageMin ?? 0) === 0) && (
        <VaultClipsFallback cameraId={selectedCamera.id} day={day} />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// VAULT CLIPS FALLBACK — exibe clips do edge box (Frigate) quando não há HLS
// ═══════════════════════════════════════════════════════════════════════════
function VaultClipsFallback({ cameraId, day }: { cameraId: string; day: string }) {
  const [clips, setClips] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<any>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // ?at= no querystring (vindo de link externo)
  const atParam = useMemo(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('at')
  }, [])

  useEffect(() => {
    setLoading(true)
    setSelectedKey(null)
    // BRT: meia-noite BRT = 03:00 UTC; 23:59:59.999 BRT = 02:59:59.999 UTC do dia seguinte
    const from = new Date(brtDayStartMs(day)).toISOString()
    const to   = new Date(brtDayStartMs(day) + 24 * 60 * 60 * 1000 - 1).toISOString()
    api.get(`/vault/cameras/${cameraId}/clips`, { params: { from, to } })
      .then(r => {
        setClips(r.data?.clips ?? [])
        setMeta({
          truncated:      r.data?.truncated,
          totalAvailable: r.data?.totalAvailable,
          edgeNode:       r.data?.edgeNode,
          reason:         r.data?.reason,
        })
        // Auto-seleciona o clip mais próximo do `at` se vier no querystring
        if (atParam && r.data?.clips?.length) {
          const target = new Date(atParam).getTime()
          const closest = r.data.clips
            .filter((c: any) => c.type === 'clip')
            .reduce((best: any, c: any) => {
              const dist = Math.abs(new Date(c.timestamp).getTime() - target)
              return !best || dist < best.dist ? { c, dist } : best
            }, null)
          if (closest) setSelectedKey(closest.c.key)
        }
      })
      .catch(() => setClips([]))
      .finally(() => setLoading(false))
  }, [cameraId, day, atParam])

  const onlyClips = clips.filter(c => c.type === 'clip')
  const onlySnaps = clips.filter(c => c.type === 'snap' || c.type === 'thumb')
  const selectedClip = onlyClips.find(c => c.key === selectedKey)

  if (loading) {
    return (
      <GlassCard className="p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </GlassCard>
    )
  }

  if (clips.length === 0) {
    return (
      <GlassCard className="p-6 text-center text-sm text-slate-500">
        <Info className="w-5 h-5 mx-auto mb-2 opacity-50" />
        <p>Sem gravação contínua nem clips de evento neste dia.</p>
        {meta?.reason === 'no_edge_node_or_vault_configured' && (
          <p className="text-xs mt-2 text-amber-600">
            Esta câmera não tem edge box vinculado — gravação só seria possível
            via fluxo cloud-direct (não configurado).
          </p>
        )}
      </GlassCard>
    )
  }

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs">
          <p className="font-semibold text-slate-900 dark:text-white">
            Sem gravação HLS contínua — exibindo clips de detecção do edge box
          </p>
          <p className="text-slate-500 mt-0.5">
            {onlyClips.length} clip{onlyClips.length !== 1 ? 's' : ''} ·
            {' '}{onlySnaps.length} snapshot{onlySnaps.length !== 1 ? 's' : ''}
            {meta?.truncated && ` (mostrando primeiros ${clips.length} de ${meta.totalAvailable})`}
          </p>
        </div>
      </div>

      {/* Player do clip selecionado */}
      {selectedClip?.presignedUrl && (
        <div className="rounded-lg overflow-hidden bg-black aspect-video">
          <video
            src={selectedClip.presignedUrl}
            controls
            autoPlay
            className="w-full h-full"
            key={selectedClip.key}
          />
        </div>
      )}

      {/* Timeline simples de clips — botões clicáveis em ordem cronológica */}
      <div className="space-y-1 max-h-[40vh] overflow-y-auto">
        {onlyClips.map(c => {
          const isSelected = c.key === selectedKey
          const isAtMatch  = atParam && Math.abs(new Date(c.timestamp).getTime() - new Date(atParam).getTime()) < 30_000
          return (
            <button
              key={c.key}
              onClick={() => setSelectedKey(c.key)}
              className={cn(
                'w-full p-2 rounded-lg text-left flex items-center gap-2 text-xs transition border',
                isSelected
                  ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10'
                  : isAtMatch
                    ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/10'
                    : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5',
              )}
            >
              <Play className={cn(
                'w-3 h-3 shrink-0',
                isSelected ? 'text-cyan-600' : 'text-slate-400',
              )} />
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {brtTime(c.timestamp)}
              </span>
              <span className="flex-1 truncate text-slate-400 text-[10px]">{c.key.split('/').pop()}</span>
              <span className="text-[10px] text-slate-500">{c.sizeMB.toFixed(2)} MB</span>
              {isAtMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-800">match</span>}
            </button>
          )
        })}
      </div>
    </GlassCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE TAB
// ═══════════════════════════════════════════════════════════════════════════
function StorageTab({ selectedCamera }: { selectedCamera: any }) {
  // Role do usuário define UI: CLIENTE_* vê dashboard simplificado (consumo +
  // R$ + contato do integrador); INTEGRADOR_* / SUPER_ADMIN vê browser de S3.
  const userRole = typeof window !== 'undefined' ? (localStorage.getItem('icv_role') ?? '') : ''
  const isClienteFinal = userRole.startsWith('CLIENTE_')

  if (isClienteFinal) {
    return <ClienteFinalStorageDashboard />
  }
  return <IntegradorStorageBrowser selectedCamera={selectedCamera} />
}

// ─── Dashboard limpo para CLIENTE_FINAL ──────────────────────────────────────
// Consume /storage/me/usage (Sprint 1 enriquecido com R$ estimado, contato do
// integrador, freshness e info de cancelamento). Sem browse cru.
function ClienteFinalStorageDashboard() {
  const [usage, setUsage] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [planModalOpen, setPlanModalOpen] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get('/storage/me/usage')
      .then(r => setUsage(r.data))
      .catch(() => setUsage(null))
      .finally(() => setLoading(false))
  }, [reloadKey])

  if (loading) {
    return (
      <GlassCard className="p-8 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </GlassCard>
    )
  }
  if (!usage) {
    return (
      <GlassCard className="p-8 flex flex-col items-center justify-center min-h-[40vh] text-slate-500">
        <HardDrive className="w-12 h-12 mb-3 opacity-40" />
        <p className="text-sm font-medium">Não foi possível carregar dados de storage</p>
        <button onClick={() => setReloadKey(k => k + 1)} className="mt-3 text-xs text-cyan-600 hover:underline">
          Tentar novamente
        </button>
      </GlassCard>
    )
  }

  const usedGB           = usage.usedGB ?? 0
  const quotaGB          = usage.quotaGB
  const pct              = usage.usagePct
  const status           = usage.status as 'ok' | 'warning' | 'critical' | 'unmetered'
  const estimatedBrl     = usage.estimatedMonthlyBrl ?? 0
  const lastUpdated      = usage.lastUpdatedAt
  const integradorContact = usage.integradorContact as { name: string; email: string | null; phone: string | null } | null
  const cancellation     = usage.cancellation as { canceledAt: string; cancelGraceUntil: string } | null

  const statusColor = {
    ok:        'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/20',
    warning:   'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/20',
    critical:  'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-500/20',
    unmetered: 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-500/20',
  }[status]

  return (
    <div className="space-y-3">
      {/* Banner de cancelamento (LGPD graça) */}
      {cancellation && (
        <GlassCard className="p-4 border-amber-300 dark:border-amber-500/40">
          <div className="flex gap-3 items-start">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-semibold text-amber-700 dark:text-amber-400">
                Cancelamento em andamento — período de graça LGPD
              </p>
              <p className="text-slate-600 dark:text-slate-400 mt-1">
                Suas gravações ficarão acessíveis até{' '}
                <strong>{brtDate(cancellation.cancelGraceUntil)}</strong>.
                Após essa data, o conteúdo será permanentemente removido. Para reativar a conta,
                entre em contato com seu integrador.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Cards de consumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
            <HardDrive className="w-4 h-4" />
            Armazenamento usado
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {usedGB.toFixed(2)} <span className="text-sm font-normal text-slate-500">GB</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {usage.objectCount?.toLocaleString('pt-BR') ?? 0} arquivos · janela de {usage.retainDays}d
          </p>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
            <Activity className="w-4 h-4" />
            Cota acordada
          </div>
          {quotaGB != null ? (
            <>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                {quotaGB.toFixed(0)} <span className="text-sm font-normal text-slate-500">GB</span>
              </p>
              <div className="mt-2 space-y-1">
                <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                  <div
                    className={cn('h-full transition-all', {
                      'bg-emerald-500': status === 'ok',
                      'bg-amber-500':   status === 'warning',
                      'bg-rose-500':    status === 'critical',
                    })}
                    style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold', statusColor)}>
                    {pct?.toFixed(1)}%
                  </span>
                  <span className="text-slate-500">{(quotaGB - usedGB).toFixed(2)} GB livres</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-slate-400">sem cota</p>
              <p className="text-xs text-slate-500 mt-1">uso conforme contrato com integrador</p>
            </>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
            <DollarSign className="w-4 h-4" />
            Custo estimado/mês
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            R$ {estimatedBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            base R2 · valor final pode variar conforme plano
          </p>
        </GlassCard>
      </div>

      {/* CTA: solicitar mudança de plano */}
      <button
        onClick={() => setPlanModalOpen(true)}
        className={cn(
          'w-full flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-medium transition',
          'bg-cyan-500 hover:bg-cyan-600 text-white shadow-sm',
          'dark:bg-cyan-600 dark:hover:bg-cyan-500'
        )}
      >
        <ArrowUpCircle className="w-4 h-4" />
        Mudar plano de retenção
      </button>
      {planModalOpen && (
        <RetentionPlanModal
          onClose={() => setPlanModalOpen(false)}
          onChanged={() => { setPlanModalOpen(false); setReloadKey(k => k + 1) }}
        />
      )}

      {/* Contato do integrador */}
      {integradorContact && (
        <GlassCard className="p-4">
          <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
            Suporte do seu integrador
          </p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-cyan-100 dark:bg-cyan-500/20 flex items-center justify-center text-sm font-semibold text-cyan-600 dark:text-cyan-400">
              {integradorContact.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-white">{integradorContact.name}</p>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
                {integradorContact.email && (
                  <a href={`mailto:${integradorContact.email}`} className="flex items-center gap-1 hover:text-cyan-600">
                    <Mail className="w-3 h-3" /> {integradorContact.email}
                  </a>
                )}
                {integradorContact.phone && (
                  <a href={`tel:${integradorContact.phone}`} className="flex items-center gap-1 hover:text-cyan-600">
                    <Phone className="w-3 h-3" /> {integradorContact.phone}
                  </a>
                )}
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Footer — freshness + reload */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span className="flex items-center gap-1">
          <Info className="w-3 h-3" />
          {lastUpdated
            ? <>atualizado em {brtDateTime(lastUpdated)} BRT</>
            : 'sem dados de atualização'}
        </span>
        <button
          onClick={() => setReloadKey(k => k + 1)}
          className="flex items-center gap-1 hover:text-cyan-600 transition"
        >
          <RefreshCw className="w-3 h-3" /> recarregar
        </button>
      </div>
    </div>
  )
}

// ─── Modal de mudança de plano (CLIENTE_ADMIN) ───────────────────────────────
// Lista planos disponíveis do catálogo + chama POST /retention/clientes/:id/plan.
// Sprint 2: workflow é AUTO_APPROVED — efeito imediato. Hook para approval futura.
function RetentionPlanModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useUiToast()
  const [plans, setPlans] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [me, setMe] = useState<any>(null)
  const [currentPlan, setCurrentPlan] = useState<any>(null)
  const [resolutionFilter, setResolutionFilter] = useState<string>('HD')
  // Sprint 4 — Opção 3: cliente escolhe comportamento no downgrade
  const [downgradeBehavior, setDowngradeBehavior] = useState<'soft' | 'immediate'>('soft')
  const [showDowngradeChoice, setShowDowngradeChoice] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/retention/plans').then(r => r.data),
      api.get('/auth/me').then(r => r.data).catch(() => null),
      api.get('/billing/me').then(r => r.data).catch(() => null),
    ]).then(([p, u, b]) => {
      setPlans(p.plans ?? [])
      setMe(u)
      setCurrentPlan(b?.retentionPlanDefault ?? null)
    }).finally(() => setLoading(false))
  }, [])

  const cfId = me?.user?.clienteFinalId ?? me?.clienteFinalId
  const filtered = plans.filter(p => p.resolution === resolutionFilter || p.resolution === 'ANY')
  const selectedPlan = plans.find(p => p.id === selectedId)

  // Detecta se é downgrade (nova retenção menor que atual)
  const isDowngrade = currentPlan && selectedPlan && selectedPlan.retainDays < currentPlan.retainDays

  async function submit() {
    if (!selectedId || !cfId) return
    // Se é downgrade, mostra primeiro a tela de escolha (Opção 3)
    if (isDowngrade && !showDowngradeChoice) {
      setShowDowngradeChoice(true)
      return
    }
    setSubmitting(true)
    try {
      const r = await api.post(`/retention/clientes/${cfId}/plan`, {
        retentionPlanId: selectedId,
        downgradeBehavior,
      })
      // Se o backend retornou 202 (PENDING_INTEGRADOR), avisa o usuário
      if (r.data?.decision?.status === 'PENDING_INTEGRADOR') {
        toast.info({
          title: 'Pedido enviado',
          description: 'Aguardando aprovação do seu integrador. Você receberá email quando ele decidir.',
        })
      }
      onChanged()
    } catch (err) {
      toast.error('Não foi possível mudar o plano. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  // Tela secundária de downgrade Opção 3
  if (showDowngradeChoice && selectedPlan && currentPlan) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/10">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Reduzindo retenção
            </h2>
            <button onClick={() => setShowDowngradeChoice(false)} className="p-1 rounded-lg hover:bg-slate-100">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Você está reduzindo de <strong>{currentPlan.retainDays} dias</strong> para <strong>{selectedPlan.retainDays} dias</strong>.
              O que fazer com gravações entre {selectedPlan.retainDays} e {currentPlan.retainDays} dias atrás?
            </p>

            <label className={cn(
              'block p-3 rounded-xl border-2 cursor-pointer transition',
              downgradeBehavior === 'soft' ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10' : 'border-slate-200 dark:border-white/10',
            )}>
              <input
                type="radio" value="soft" checked={downgradeBehavior === 'soft'}
                onChange={() => setDowngradeBehavior('soft')}
                className="sr-only"
              />
              <div className="flex items-start gap-2">
                <Check className={cn('w-4 h-4 flex-shrink-0 mt-0.5', downgradeBehavior === 'soft' ? 'text-cyan-500' : 'text-transparent')} />
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Manter até expirar (recomendado)</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Gravações antigas continuam até completarem o tempo original.
                    A partir de hoje, novos segmentos respeitam {selectedPlan.retainDays} dias.
                  </p>
                </div>
              </div>
            </label>

            <label className={cn(
              'block p-3 rounded-xl border-2 cursor-pointer transition',
              downgradeBehavior === 'immediate' ? 'border-rose-500 bg-rose-50 dark:bg-rose-500/10' : 'border-slate-200 dark:border-white/10',
            )}>
              <input
                type="radio" value="immediate" checked={downgradeBehavior === 'immediate'}
                onChange={() => setDowngradeBehavior('immediate')}
                className="sr-only"
              />
              <div className="flex items-start gap-2">
                <Check className={cn('w-4 h-4 flex-shrink-0 mt-0.5', downgradeBehavior === 'immediate' ? 'text-rose-500' : 'text-transparent')} />
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Apagar agora gravações antigas</p>
                  <p className="text-xs text-slate-500 mt-1">
                    ⚠️ Gravações com mais de {selectedPlan.retainDays} dias são deletadas em até 1h.
                    Esta ação não pode ser desfeita.
                  </p>
                </div>
              </div>
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 dark:border-white/10">
            <button onClick={() => setShowDowngradeChoice(false)} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
              Voltar
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 text-sm rounded-lg bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Confirmar mudança'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Escolher plano de retenção</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-200 dark:border-white/10">
          <div className="flex gap-2 flex-wrap">
            {['ANY', 'VGA', 'HD', 'FHD', 'UHD_4K'].map(r => (
              <button
                key={r}
                onClick={() => setResolutionFilter(r)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-lg font-medium transition',
                  resolutionFilter === r
                    ? 'bg-cyan-500 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                )}
              >
                {r === 'UHD_4K' ? '4K' : r === 'ANY' ? 'Live Only' : r}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map(p => {
                const isSelected = selectedId === p.id
                const usdBrl     = 5.30
                const markupInt  = 1.30      // estimativa (real vem do contract no backend)
                const finalBrl   = (Number(p.pricePerCameraMonthUsd) * markupInt * usdBrl).toFixed(2)
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={cn(
                      'p-3 rounded-xl text-left transition border-2',
                      isSelected
                        ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10'
                        : 'border-slate-200 dark:border-white/10 hover:border-cyan-300 bg-white dark:bg-white/5'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{p.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {p.retainDays === 0 ? 'sem gravação' : `gravação ${p.retainDays} dia${p.retainDays > 1 ? 's' : ''}`}
                        </p>
                      </div>
                      {isSelected && <Check className="w-5 h-5 text-cyan-500 flex-shrink-0" />}
                    </div>
                    <p className="text-base font-bold text-slate-900 dark:text-white mt-2">
                      ~ R$ {finalBrl}<span className="text-xs font-normal text-slate-500">/cam/mês</span>
                    </p>
                  </button>
                )
              })}
              {filtered.length === 0 && (
                <p className="col-span-2 text-center text-sm text-slate-500 py-8">
                  Nenhum plano disponível para esta resolução.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 dark:border-white/10">
          <p className="flex-1 text-xs text-slate-500">
            <Info className="w-3 h-3 inline mr-1" />
            O plano é aplicado a todas as câmeras sem plano específico.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-100 dark:bg-white/10"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!selectedId || submitting || !cfId}
            className={cn(
              'px-4 py-2 text-sm rounded-lg font-medium transition',
              !selectedId || submitting || !cfId
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-white/5'
                : 'bg-cyan-500 text-white hover:bg-cyan-600'
            )}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Confirmar mudança'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Browser de S3 para INTEGRADOR_ADMIN / SUPER_ADMIN ───────────────────────
// Mantém o comportamento original (browse de objetos) que o role superior usa
// pra investigar gravações de qualquer cliente.
function IntegradorStorageBrowser({ selectedCamera }: { selectedCamera: any }) {
  const [stats, setStats] = useState<any>(null)
  const [browse, setBrowse] = useState<any>(null)
  const [prefix, setPrefix] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/storage/stats').then(r => r.data).catch(() => null),
      api.get('/storage/browse', { params: { prefix: selectedCamera?.id || '' } }).then(r => r.data).catch(() => null),
    ]).then(([s, b]) => {
      setStats(s)
      setBrowse(b)
      if (selectedCamera?.id) setPrefix(selectedCamera.id + '/')
    }).finally(() => setLoading(false))
  }, [selectedCamera?.id])

  async function navigateTo(newPrefix: string) {
    setLoading(true)
    try {
      const res = await api.get('/storage/browse', { params: { prefix: newPrefix } })
      setBrowse(res.data)
      setPrefix(newPrefix)
    } finally {
      setLoading(false)
    }
  }

  function goUp() {
    const parts = prefix.split('/').filter(Boolean)
    parts.pop()
    navigateTo(parts.length ? parts.join('/') + '/' : '')
  }

  if (loading) {
    return (
      <GlassCard className="p-8 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </GlassCard>
    )
  }

  if (!stats?.configured && !browse?.bucket) {
    return (
      <GlassCard className="p-8 flex flex-col items-center justify-center min-h-[40vh] text-slate-500">
        <HardDrive className="w-12 h-12 mb-3 opacity-40" />
        <p className="text-sm font-medium">Storage S3 não configurado</p>
        <p className="text-xs mt-1">Configure em Configurações → Storage</p>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-500/20 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {stats?.bucket || browse?.bucket || 'Storage S3'}
              </p>
              <p className="text-xs text-slate-500">
                {stats?.totalObjects?.toLocaleString() || '—'} objetos · {stats?.totalSizeMB?.toLocaleString() || '—'} MB
              </p>
            </div>
          </div>
          <button onClick={() => navigateTo(prefix)} className={cn(
            'p-2 rounded-lg transition',
            'hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10',
          )}>
            <RefreshCw className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </GlassCard>

      {/* Browser */}
      <GlassCard className="p-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs mb-3 flex-wrap">
          <button onClick={() => navigateTo('')} className="text-cyan-600 dark:text-cyan-400 hover:underline">
            /
          </button>
          {prefix.split('/').filter(Boolean).map((part, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <button
                onClick={() => navigateTo(arr.slice(0, i + 1).join('/') + '/')}
                className={cn(
                  i === arr.length - 1 ? 'text-slate-700 dark:text-white font-medium' : 'text-cyan-600 dark:text-cyan-400 hover:underline'
                )}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        {/* Items */}
        <div className="space-y-1 max-h-[50vh] overflow-y-auto">
          {prefix && (
            <button onClick={goUp} className={cn(
              'w-full p-2 rounded-lg text-left flex items-center gap-2 text-xs transition',
              'hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5',
            )}>
              <Folder className="w-4 h-4 text-amber-500" />
              <span className="text-slate-600 dark:text-slate-400">..</span>
            </button>
          )}
          {browse?.items?.map((item: any) => (
            <div key={item.key} className={cn(
              'p-2 rounded-lg flex items-center gap-2 text-xs transition',
              item.type === 'folder' ? 'hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5 cursor-pointer' : '',
            )} onClick={() => item.type === 'folder' && navigateTo(item.key)}>
              {item.type === 'folder' ? (
                <Folder className="w-4 h-4 text-amber-500" />
              ) : (
                <FileVideo className="w-4 h-4 text-cyan-500" />
              )}
              <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{item.name}</span>
              {item.size && (
                <span className="text-slate-500 text-[10px]">{formatBytes(item.size)}</span>
              )}
            </div>
          ))}
          {browse?.items?.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-4">Pasta vazia</p>
          )}
        </div>
      </GlassCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG TAB
// ═══════════════════════════════════════════════════════════════════════════
function ConfigTab({ selectedCamera, cameras, refetchCameras }: any) {
  const toast = useUiToast()
  const [saving, setSaving] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, any>>({})
  // Sprint 2 — catálogo de planos disponível para atribuição por câmera
  const [plans, setPlans] = useState<any[]>([])
  const [savingPlan, setSavingPlan] = useState<string | null>(null)

  useEffect(() => {
    api.get('/retention/plans')
      .then(r => setPlans(r.data?.plans ?? []))
      .catch(() => setPlans([]))
  }, [])

  function getEdit(camId: string, field: string, defaultVal: any) {
    return edits[camId]?.[field] ?? defaultVal
  }

  function setEdit(camId: string, field: string, value: any) {
    setEdits(e => ({
      ...e,
      [camId]: { ...e[camId], [field]: value },
    }))
  }

  async function saveCamera(cam: any) {
    setSaving(cam.id)
    try {
      await api.patch(`/cameras/${cam.id}`, {
        recordEnabled: getEdit(cam.id, 'recordEnabled', cam.recordEnabled),
        recordMode: getEdit(cam.id, 'recordMode', cam.recordMode),
        recordRetainDays: getEdit(cam.id, 'recordRetainDays', cam.recordRetainDays),
      })
      refetchCameras()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setSaving(null)
    }
  }

  // Sprint 2 — atribui plano à câmera (ou remove override se planoId='')
  async function changeCameraPlan(cam: any, planId: string) {
    setSavingPlan(cam.id)
    try {
      await api.post(`/retention/cameras/${cam.id}/plan`, {
        retentionPlanId: planId || null,
      })
      refetchCameras()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setSavingPlan(null)
    }
  }

  return (
    <div className="space-y-3">
      {/* Info */}
      <GlassCard className="p-3 border-cyan-500/20">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-600 dark:text-slate-400">
            <p><strong>Hierarquia de retenção:</strong> Integrador define padrão → Câmera pode override.</p>
            <p className="mt-1">Segmentos mais antigos são deletados automaticamente pelo sistema.</p>
          </div>
        </div>
      </GlassCard>

      {/* Camera list */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          Configuração por Câmera
        </h3>

        <div className="space-y-2">
          {cameras.map((cam: any) => (
            <div key={cam.id} className={cn(
              'p-3 rounded-lg border transition',
              cam.id === selectedCamera?.id
                ? 'border-amber-400 bg-amber-50/50 dark:border-amber-500/50 dark:bg-amber-500/5'
                : 'border-slate-200 dark:border-white/10',
            )}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <CameraIcon className="w-4 h-4 text-slate-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate text-slate-900 dark:text-white">{cam.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{cam.site?.name || '—'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Record enabled */}
                  <label className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={getEdit(cam.id, 'recordEnabled', cam.recordEnabled ?? true)}
                      onChange={e => setEdit(cam.id, 'recordEnabled', e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                    Gravar
                  </label>

                  {/* Mode */}
                  <select
                    value={getEdit(cam.id, 'recordMode', cam.recordMode || 'ALL')}
                    onChange={e => setEdit(cam.id, 'recordMode', e.target.value)}
                    className={cn(
                      'px-2 py-1 text-[10px] rounded border',
                      'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-white',
                    )}
                  >
                    <option value="ALL">Contínuo</option>
                    <option value="MOTION">Movimento</option>
                    <option value="DISABLED">Desabilitado</option>
                  </select>

                  {/* Retain days */}
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={getEdit(cam.id, 'recordRetainDays', cam.recordRetainDays ?? 7)}
                      onChange={e => setEdit(cam.id, 'recordRetainDays', Number(e.target.value))}
                      className={cn(
                        'w-14 px-2 py-1 text-[10px] rounded border text-center',
                        'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-white',
                      )}
                    />
                    <span className="text-[10px] text-slate-500">dias</span>
                  </div>

                  {/* Sprint 2 — Plano de retenção (catálogo) */}
                  {plans.length > 0 && (
                    <select
                      value={cam.retentionPlanId ?? ''}
                      onChange={e => changeCameraPlan(cam, e.target.value)}
                      disabled={savingPlan === cam.id}
                      className={cn(
                        'px-2 py-1 text-[10px] rounded border max-w-[140px]',
                        'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-white',
                        savingPlan === cam.id && 'opacity-50',
                      )}
                      title="Plano comercial (cascata: câmera → cliente → integrador)"
                    >
                      <option value="">— herdado —</option>
                      {plans.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Save */}
                  <button
                    onClick={() => saveCamera(cam)}
                    disabled={saving === cam.id}
                    className={cn(
                      'p-1.5 rounded transition',
                      'bg-cyan-600 text-white hover:bg-cyan-700',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                    )}
                  >
                    {saving === cam.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Save className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BOOKMARK CREATE MODAL — invocado por right-click na timeline
// ═══════════════════════════════════════════════════════════════════════════
function BookmarkCreateModal({
  draft, dayUtc, onChange, onCancel, onSubmit,
}: {
  draft: { sec: number; title: string; color: string; saving: boolean; error: string | null }
  dayUtc: string
  onChange: (patch: Partial<typeof draft>) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  // Preview do horário em BRT (UTC-3) — mesma convenção do PlaybackTimelineZoom.
  const brt = (() => {
    let s = draft.sec - 3 * 3600
    s = ((s % 86400) + 86400) % 86400
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = Math.floor(s % 60)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(h)}:${pad(m)}:${pad(ss)}`
  })()

  // Cores predefinidas — paleta consistente com o resto do app.
  const COLORS = [
    { hex: '#F59E0B', label: 'Âmbar' },
    { hex: '#EF4444', label: 'Vermelho' },
    { hex: '#10B981', label: 'Verde' },
    { hex: '#06B6D4', label: 'Cyan' },
    { hex: '#8B5CF6', label: 'Roxo' },
    { hex: '#EC4899', label: 'Rosa' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className={cn(
          'w-full max-w-sm rounded-xl border shadow-2xl p-4 space-y-3',
          'bg-white border-slate-200 text-slate-900',
          'dark:bg-slate-900 dark:border-white/10 dark:text-white',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <span style={{ color: draft.color }}>★</span>
            Novo bookmark
          </h3>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-600 dark:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="text-[11px] text-slate-500 font-mono">
          {dayUtc} · <span className="text-amber-500 dark:text-amber-300 font-bold">{brt} BRT</span>
        </div>

        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1 font-semibold">Título</label>
          <input
            type="text"
            autoFocus
            value={draft.title}
            onChange={(e) => onChange({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onSubmit() }
              else if (e.key === 'Escape') onCancel()
            }}
            placeholder="Ex: cliente saindo · alarme falso"
            disabled={draft.saving}
            className={cn(
              'w-full px-3 py-2 text-sm rounded-md border',
              'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400',
              'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500',
              'focus:outline-none focus:ring-2 focus:ring-amber-500/40',
            )}
          />
        </div>

        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1 font-semibold">Cor</label>
          <div className="flex items-center gap-1.5 flex-wrap">
            {COLORS.map(c => (
              <button
                key={c.hex}
                type="button"
                onClick={() => onChange({ color: c.hex })}
                className={cn(
                  'w-8 h-8 rounded-md border-2 transition-transform hover:scale-110',
                  draft.color === c.hex
                    ? 'border-white ring-2 ring-amber-400'
                    : 'border-white/20',
                )}
                style={{ background: c.hex }}
                title={c.label}
              />
            ))}
          </div>
        </div>

        {draft.error && (
          <p className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
            {draft.error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={draft.saving}
            className={cn(
              'px-3 py-1.5 text-xs font-semibold rounded-md',
              'bg-slate-100 hover:bg-slate-200 text-slate-700',
              'dark:bg-white/5 dark:hover:bg-slate-100 dark:bg-white/10 dark:text-white',
            )}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={draft.saving || draft.title.trim().length < 2}
            className={cn(
              'px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5',
              'bg-amber-500 hover:bg-amber-600 text-white',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {draft.saving && <Loader2 className="w-3 h-3 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
