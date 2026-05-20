/**
 * CameraDetailPage — visão completa de uma câmera com tabs estilo Frigate.
 *
 * Tabs: Live · Config · Zones · Events · Logs · Faces · LPR · Stats
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Activity, Settings, Map, Bell, FileText,
  Smile, FileBadge, BarChart3, PlayCircle, Image as ImageIcon,
  CheckCircle2, XCircle, Loader2, AlertCircle, Copy, MapPin, Search,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { RecordingScheduleGrid } from '../components/cameras/RecordingScheduleGrid'
import { CameraRetentionPlanCard } from '../components/retention/CameraRetentionPlanCard'
import { PlanHistoryCard } from '../components/retention/PlanHistoryCard'
import { cn } from '../lib/utils'
import { LivePlayer } from '../components/player/LivePlayer'
import {
  useCamera, useCameraLogs, useCameraStreamTests,
  testCamera, snapshotCamera, updateCamera, formatApiError,
  clearCameraRecordings,
  useEdgeNodes, BASE_URL,
  useIngestConfig, revealRtmpIngestKey, regenerateRtmpIngestKey,
} from '../api/client'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { UptimeSparkline } from '../components/cameras/UptimeSparkline'
import { DiagnosticsCard } from '../components/cameras/DiagnosticsCard'

const TABS = [
  { id: 'live',    label: 'Live',    icon: Activity },
  { id: 'config',  label: 'Config',  icon: Settings },
  { id: 'zones',   label: 'Zonas',   icon: Map },
  { id: 'events',  label: 'Eventos', icon: Bell },
  { id: 'logs',    label: 'Logs',    icon: FileText },
  { id: 'faces',   label: 'Faces',   icon: Smile },
  { id: 'lpr',     label: 'LPR',     icon: FileBadge },
  { id: 'stats',   label: 'Stats',   icon: BarChart3 },
] as const

export function CameraDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<typeof TABS[number]['id']>('live')
  const { data: camera, mutate } = useCamera(id ?? null)
  const [testing, setTesting] = useState(false)
  const [snapping, setSnapping] = useState(false)
  const [snap, setSnap] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<any>(null)

  /**
   * Toast efêmero global do header — mostra resultado de Testar RTSP,
   * Snapshot ou outras ações que antes só apareciam dentro de uma tab
   * específica. Sem isso, clicar "Snapshot" ou "Testar" estando na tab
   * Config parecia silencioso (resultado ia pro state mas nenhum
   * componente da tab atual consumia).
   */
  const [headerToast, setHeaderToast] = useState<
    { type: 'success' | 'error' | 'info'; msg: string } | null
  >(null)

  // Auto-dismiss do toast após 5s.
  useEffect(() => {
    if (!headerToast) return
    const t = window.setTimeout(() => setHeaderToast(null), 5000)
    return () => window.clearTimeout(t)
  }, [headerToast])

  async function handleTest() {
    if (!id) return
    setTesting(true)
    setHeaderToast({ type: 'info', msg: 'Executando ffprobe no backend…' })
    try {
      const r = await testCamera(id)
      setTestResult(r)
      setHeaderToast(
        r?.success
          ? {
              type: 'success',
              msg: `Stream OK — ${r.resolution ?? '?'} @ ${r.fps ?? '?'}fps · ${r.codec ?? '?'} · ${r.latencyMs ?? '?'}ms`,
            }
          : { type: 'error', msg: `Falha no teste: ${r?.errorMessage ?? 'erro desconhecido'}` },
      )
    } catch (e) {
      const msg = formatApiError(e)
      setTestResult({ success: false, errorMessage: msg })
      setHeaderToast({ type: 'error', msg: `Falha no teste: ${msg}` })
    } finally {
      setTesting(false)
    }
  }

  async function handleSnap() {
    if (!id) return
    setSnapping(true)
    setHeaderToast({ type: 'info', msg: 'Capturando snapshot…' })
    try {
      // Backend devolve { snapshotUrl, snapshotAt } — antes o código fazia
      // `const { url } = ...` (campo errado), então `snap` ficava undefined
      // e o usuário pensava que o botão era silencioso.
      const result = await snapshotCamera(id)
      const url: string | null = result?.snapshotUrl ?? result?.url ?? null
      if (!url) {
        throw new Error('Backend não retornou URL do snapshot')
      }
      setSnap(url)
      setHeaderToast({
        type: 'success',
        msg: 'Snapshot capturado — visível na aba Live.',
      })
      // Recarrega câmera para atualizar lastSnapshotUrl/lastSnapshotAt
      mutate()
    } catch (e) {
      setHeaderToast({ type: 'error', msg: `Falha no snapshot: ${formatApiError(e)}` })
    } finally {
      setSnapping(false)
    }
  }

  if (!camera) return <div className="text-slate-500 text-sm">Carregando…</div>

  // ── Status visual (paridade com tree view) ─────────────────────────────────
  const statusColor: Record<string, string> = {
    ACTIVE:       'bg-emerald-500',
    PROVISIONING: 'bg-amber-500 animate-pulse',
    PAUSED:       'bg-slate-500',
    ERROR:        'bg-rose-500 animate-pulse',
    INACTIVE:     'bg-slate-600',
  }

  return (
    <div className="space-y-3">
      {/* Header compacto — paridade com CamerasPage (1 linha) */}
      <GlassCard className="p-3 bg-gradient-to-br from-rose-500/10 via-violet-500/5 to-transparent border-rose-500/20">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button onClick={() => navigate('/cameras')}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10 text-slate-500 hover:text-slate-900 dark:hover:text-slate-900 dark:text-white shrink-0"
              title="Voltar para lista">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center shadow shadow-rose-500/20 text-base shrink-0 relative">
              📹
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-slate-900 ${statusColor[camera.status] ?? 'bg-slate-500'}`}
                title={camera.status} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-slate-900 dark:text-white truncate">{camera.name}</h1>
                <code className="text-[10px] text-slate-500 font-mono">#{camera.id.slice(0, 8)}</code>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                  camera.status === 'ACTIVE'  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                  camera.status === 'ERROR'   ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' :
                  camera.status === 'PROVISIONING' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                  'bg-slate-500/15 text-slate-400 border-slate-500/30'
                }`}>{camera.status}</span>
                {camera.tier && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-violet-500/10 text-violet-400 border border-violet-500/20">
                    {camera.tier}
                  </span>
                )}
                {camera.pipeline && (
                  <span className="text-[10px] font-mono text-slate-500 uppercase">{camera.pipeline}</span>
                )}
                {camera.resolution && <span className="text-[10px] text-slate-500">· {camera.resolution}</span>}
                {camera.fps != null && <span className="text-[10px] text-slate-500">· {camera.fps} fps</span>}
                {camera.location && <span className="text-[10px] text-slate-500 truncate">· {camera.location}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap shrink-0">
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-2.5 py-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-500/20 border border-cyan-200 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300 text-xs flex items-center gap-1.5 hover:bg-cyan-200 dark:hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
              {testing ? 'Testando…' : 'Testar RTSP'}
            </button>
            <button
              onClick={handleSnap}
              disabled={snapping}
              className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10 disabled:opacity-50"
            >
              {snapping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              {snapping ? 'Capturando…' : 'Snapshot'}
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Toast efêmero — feedback de Testar RTSP / Snapshot / outras ações
          do header. Visível em qualquer tab. Auto-dismiss em 5s. */}
      {headerToast && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-2 ${
            headerToast.type === 'success'
              ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
              : headerToast.type === 'error'
                ? 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30'
                : 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30'
          }`}
        >
          {headerToast.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {headerToast.type === 'error'   && <XCircle className="w-4 h-4 shrink-0" />}
          {headerToast.type === 'info'    && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          <span className="flex-1 truncate">{headerToast.msg}</span>
          <button
            onClick={() => setHeaderToast(null)}
            className="opacity-60 hover:opacity-100"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-white/10 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon
          const active = t.id === tab
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 flex items-center gap-2 text-sm font-medium transition border-b-2 whitespace-nowrap ${
                active ? 'border-cyan-600 text-cyan-700 dark:border-cyan-400 dark:text-cyan-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-600 dark:text-slate-300'}`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Body */}
      <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        {tab === 'live'    && <LiveTab camera={camera} snap={snap} testResult={testResult} onGoConfig={() => setTab('config')} />}
        {tab === 'config'  && <ConfigTab camera={camera} onSave={() => mutate()} />}
        {tab === 'zones'   && <ZonesTab camera={camera} />}
        {tab === 'events'  && <EventsTab cameraId={camera.id} />}
        {tab === 'logs'    && <LogsTab cameraId={camera.id} />}
        {tab === 'faces'   && <FacesTab cameraId={camera.id} />}
        {tab === 'lpr'     && <LprTab cameraId={camera.id} />}
        {tab === 'stats'   && <StatsTab camera={camera} />}
      </motion.div>
    </div>
  )
}

// ── LIVE ──
function LiveTab({ camera, snap, testResult, onGoConfig: _onGoConfig }: any) {
  const { data: tests } = useCameraStreamTests(camera.id)
  const [liveStatus, setLiveStatus] = useState<string>('idle')
  // Modo de exibição:
  //   'live'         — LivePlayer (WHEP→MJPEG via backend; backend escolhe
  //                    entre go2rtc do edge ou go2rtc embarcado)
  //   'snapshot-loop' — fallback ffmpeg local (~7s/frame) — usuário escolhe
  //                    manualmente ou caímos automaticamente em erro
  //   'last-snap'    — apenas o último frame capturado pelo botão "Snapshot"
  //                    do header (estático, não loop)
  const [view, setView] = useState<'live' | 'snapshot-loop' | 'last-snap'>('live')

  const _hasEdge = !!camera.edgeNodeId

  // Quando o LivePlayer entra em 'error' (WHEP+MJPEG falharam) e o usuário
  // está no modo 'live', oferecemos snapshot-loop como fallback automático.
  // Não trocamos sozinho — usuário pode preferir reconectar. Mostramos um
  // banner com call-to-action.
  const liveFailed = liveStatus === 'error'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <GlassCard className="lg:col-span-2 overflow-hidden p-0">
        <div className="aspect-video relative bg-black">
          {view === 'last-snap' && snap ? (
            <>
              <img src={snap} className="w-full h-full object-contain" />
              <button
                onClick={() => setView('live')}
                className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-black/60 hover:bg-black/80 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-xs font-semibold"
              >
                Voltar ao live
              </button>
              <div className="absolute bottom-3 left-3 px-2 py-0.5 rounded-full bg-amber-500/90 text-white text-[10px] font-bold">
                ÚLTIMO SNAPSHOT
              </div>
            </>
          ) : view === 'snapshot-loop' ? (
            // Fallback explícito — útil se WebRTC não funcionar (firewall,
            // codec, etc). ~7s/frame via ffmpeg local do backend.
            <>
              <SnapshotLoopPlayer cameraId={camera.id} cameraName={camera.name} />
              <button
                onClick={() => setView('live')}
                className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-md bg-black/60 hover:bg-black/80 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-xs font-semibold"
              >
                ← Voltar ao live (WebRTC)
              </button>
            </>
          ) : (
            // Modo padrão: LivePlayer tenta WHEP→MJPEG via backend. O backend
            // resolve internamente entre go2rtc do edge (se houver) ou
            // embarcado (EMBEDDED_GO2RTC_URL). Quando ambos falham, o player
            // emite onStatus='error' e oferecemos snapshot-loop como fallback.
            <LivePlayer
              cameraId={camera.id}
              mode="whep"
              muted
              showOverlay
              cameraName={camera.name}
              onStatus={setLiveStatus}
              className="w-full h-full"
            />
          )}
          {view === 'live' && (
            <div className="absolute top-3 right-3 flex gap-2 pointer-events-none">
              <span className="px-2 py-0.5 rounded-full bg-black/60 text-slate-900 dark:text-white text-[10px] font-mono">
                {camera.resolution ?? '—'} @ {camera.fps ?? '—'}fps · {camera.codec ?? '—'}
              </span>
            </div>
          )}
          {snap && view === 'live' && (
            <button
              onClick={() => setView('last-snap')}
              className="absolute bottom-3 right-3 px-2.5 py-1 rounded-md bg-black/60 hover:bg-black/80 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-[11px] font-semibold flex items-center gap-1 pointer-events-auto"
            >
              <ImageIcon className="w-3 h-3" /> Ver último snapshot
            </button>
          )}
          {view === 'live' && liveFailed && (
            <button
              onClick={() => setView('snapshot-loop')}
              className="absolute bottom-3 left-3 px-2.5 py-1 rounded-md bg-amber-500/90 hover:bg-amber-500 text-white text-[11px] font-semibold flex items-center gap-1 pointer-events-auto"
            >
              <ImageIcon className="w-3 h-3" /> Tentar snapshot-loop (ffmpeg)
            </button>
          )}
        </div>
      </GlassCard>

      <div className="space-y-3">
        {/* Diagnóstico em tempo real — Onda 2 / P1 #6 */}
        <DiagnosticsCard cameraId={camera.id} />

        <GlassCard className="p-4">
          <h3 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase mb-2">Teste Mais Recente</h3>
          {testResult ? (
            <div className={`text-xs ${testResult.success ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4 inline mr-1" /> : <XCircle className="w-4 h-4 inline mr-1" />}
              {testResult.success ? `OK · ${testResult.latencyMs}ms` : testResult.errorMessage}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Nenhum teste executado</p>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <h3 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase mb-2">Histórico Stream Tests</h3>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {(tests?.items ?? []).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between text-[11px] font-mono">
                <span className={t.success ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}>
                  {t.success ? '✓' : '✗'} {new Date(t.createdAt).toLocaleTimeString()}
                </span>
                <span className="text-slate-500">{t.latencyMs ?? '—'}ms · {t.stage}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  )
}

// ── CONFIG ──
/**
 * Whitelist de campos editáveis pelo PATCH /cameras/:id.
 *
 * O backend usa Zod com .strict() — qualquer chave fora dessa lista
 * (id, createdAt, subscription, zones, _count, etc.) é REJEITADA com
 * 400 "Unrecognized key". Antes desta refatoração o componente mandava
 * o objeto camera inteiro e por isso o botão "Salvar" não fazia nada
 * (erro era engolido).
 *
 * Esta lista deve refletir o UpdateCameraSchema do backend.
 */
const EDITABLE_FIELDS = [
  // Identidade
  'name', 'description', 'location',
  // Geolocalização — override do site
  'zipCode', 'city', 'state', 'latitude', 'longitude',
  // Edge node — operador realoca câmera; backend valida ownership.
  'edgeNodeId',
  // Streams
  'rtspMainUrl', 'rtspSubUrl', 'rtspUsername', 'rtspPassword',
  // Identificação técnica
  'brand', 'model', 'firmwareVersion', 'resolution', 'fps', 'codec',
  // FFmpeg / HW
  'hwAccel', 'ffmpegInputArgs', 'ffmpegOutputArgs', 'ffmpegGlobalArgs',
  // Detector
  'detectorType', 'detectorWidth', 'detectorHeight', 'detectorFps',
  // Motion
  'motionEnabled', 'motionThreshold', 'motionContourArea', 'motionImproveContrast',
  // Snapshot / Record
  'snapshotsEnabled', 'snapshotBoundingBox', 'snapshotQuality', 'snapshotRetainDays',
  'recordEnabled', 'recordMode', 'recordRetainDays', 'recordAlertRetainDays',
  'recordDetectionRetainDays', 'recordPreCaptureSec', 'recordPostCaptureSec',
  // Audio
  'audioEnabled', 'audioMinVolume',
  // Cloud AI Worker (YOLO)
  'aiEnabled', 'aiConfidenceMin',
  // Semantic / Face / LPR / GenAI
  'semanticSearchEnabled', 'semanticModelSize',
  'faceRecognitionEnabled', 'faceMinScore',
  'lprEnabled', 'lprFormatRegex',
  'genaiEnabled', 'genaiProvider', 'genaiModel', 'genaiPromptGlobal',
  // ONVIF / PTZ
  'onvifHost', 'onvifPort', 'onvifUsername', 'onvifPassword',
  'ptzEnabled', 'ptzAutotrackEnabled',
  // Birdseye
  'birdseyeEnabled', 'birdseyeMode',
  // Sprint Q.3 (Clean snapshot copy) + Q.5 (Cooldown) + Q.6 (Stationary)
  'cleanSnapshotEnabled', 'notificationCooldownSec',
  'detectStationaryInterval', 'detectStationaryThreshold',
  // RTMP push out — broadcast pra YouTube/Twitch/Facebook (URL cifrada
  // no backend; frontend envia plain text e o backend cifra em rtmpPushUrlEnc).
  'rtmpPushUrl', 'rtmpPushEnabled',
  // RTMP push IN — modo de ingestão (RTSP_PULL vs RTMP_PUSH). Quando muda
  // pra RTMP_PUSH, o backend auto-gera a stream key se ainda não existe.
  'ingestMode',
] as const

function ConfigTab({ camera, onSave }: any) {
  const [draft, setDraft] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [cepLoading, setCepLoading] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  // Reset de gravações — confirma com nome da câmera digitado pelo usuário
  const [clearOpen, setClearOpen] = useState(false)
  const [clearConfirm, setClearConfirm] = useState('')
  const [clearing, setClearing] = useState(false)

  // Edge nodes do mesmo site da câmera — backend devolve já filtrado por
  // tenant. includeOffline pra UI mostrar edges em manutenção também
  // (operador pode querer atribuir uma câmera para edge offline planejado).
  // Tolerante a `camera` sem siteId (cobertura defensiva — em alguns
  // estados de loading/erro o camera pode chegar parcial).
  const cameraSiteId = camera?.siteId
  const { data: edgeNodesData } = useEdgeNodes(
    cameraSiteId ? { siteId: cameraSiteId, includeOffline: true } : undefined,
  )
  const edgeNodes = edgeNodesData?.edgeNodes ?? []
  const selectedEdge = edgeNodes.find(e => e.id === (draft.edgeNodeId ?? camera?.edgeNodeId)) ?? null

  // Campos atuais resolvem por draft || camera (fallback ao valor servidor).
  const get = (k: string) => (k in draft ? draft[k] : camera[k])
  const set = (k: string, v: any) => {
    setDraft((d: any) => ({ ...d, [k]: v }))
    setFeedback(null) // limpa toast antigo ao editar
  }

  // Conta campos modificados — UX do botão "Salvar (3 alterações)".
  const dirtyCount = Object.keys(draft).length

  async function save() {
    if (dirtyCount === 0) {
      setFeedback({ type: 'error', msg: 'Nenhuma alteração para salvar.' })
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      // Filtra somente os campos editáveis e que mudaram. Limpa strings
      // vazias para `null` quando o backend permite nullable (descrição,
      // location, ffmpeg args, etc).
      const payload: Record<string, unknown> = {}
      for (const k of EDITABLE_FIELDS) {
        if (k in draft) {
          const v = draft[k]
          payload[k] = typeof v === 'string' && v === '' ? null : v
        }
      }
      await updateCamera(camera.id, payload)
      setDraft({})
      setFeedback({ type: 'success', msg: `Salvo (${dirtyCount} ${dirtyCount === 1 ? 'campo' : 'campos'}).` })
      onSave()
    } catch (e) {
      setFeedback({ type: 'error', msg: formatApiError(e) })
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setDraft({})
    setFeedback(null)
  }

  async function handleCepBlur() {
    const raw = (get('zipCode') ?? '').replace(/\D/g, '')
    if (raw.length !== 8) return
    setCepLoading(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${raw}/json/`)
      const data = await res.json()
      if (data.erro) return
      setDraft((d: any) => ({
        ...d,
        zipCode: data.cep        ?? get('zipCode'),
        city:    data.localidade ?? get('city'),
        state:   data.uf         ?? get('state'),
      }))
      const parts = [data.logradouro, data.bairro, data.localidade, data.uf, 'Brasil'].filter(Boolean)
      setGeocoding(true)
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(parts.join(', '))}`,
          { headers: { 'Accept-Language': 'pt-BR' } }
        )
        const geoData = await geoRes.json()
        if (geoData[0]) {
          setDraft((d: any) => ({
            ...d,
            latitude:  parseFloat(geoData[0].lat),
            longitude: parseFloat(geoData[0].lon),
          }))
        }
      } finally {
        setGeocoding(false)
      }
    } catch {
      // silencia — localização é opcional
    } finally {
      setCepLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Modo de ingestão — RTSP_PULL (backend puxa) vs RTMP_PUSH (câmera
          empurra). Decisão chave: RTMP_PUSH atravessa NAT do cliente sem
          hardware extra; RTSP_PULL precisa rede local OU edge OU port-forward. */}
      <IngestModeCard
        camera={camera}
        draft={draft}
        get={get}
        set={set}
      />

      {/* Stream / RTSP — acrescentado por feedback do usuário: editor da URL
          ficou faltando aqui. Sem ele a única forma de mudar URL era recriar
          a câmera. Só relevante quando ingestMode=RTSP_PULL. */}
      <GlassCard className={cn(
        'p-4 space-y-3 md:col-span-2',
        ((draft.ingestMode ?? camera?.ingestMode) === 'RTMP_PUSH') && 'opacity-60',
      )}>
        <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
          Stream / RTSP
          {(draft.ingestMode ?? camera?.ingestMode) === 'RTMP_PUSH' && (
            <span className="ml-2 text-[10px] font-normal text-slate-500">
              (modo RTMP_PUSH — RTSP usado apenas pra fallback de snapshot)
            </span>
          )}
        </h3>
        <Input
          label="URL principal (rtsp://...)"
          value={get('rtspMainUrl') ?? ''}
          onChange={v => set('rtspMainUrl', v)}
        />
        <Input
          label="URL secundária (sub-stream)"
          value={get('rtspSubUrl') ?? ''}
          onChange={v => set('rtspSubUrl', v)}
        />
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="Usuário"
            value={get('rtspUsername') ?? ''}
            onChange={v => set('rtspUsername', v)}
          />
          <Input
            label="Senha (deixe em branco para não alterar)"
            value={get('rtspPassword') ?? ''}
            onChange={v => set('rtspPassword', v)}
            type="password"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Input label="Resolução" value={get('resolution') ?? ''} onChange={v => set('resolution', v)} />
          <Input label="FPS"        value={get('fps') ?? ''}        onChange={v => set('fps', v ? +v : null)} type="number" />
          <Input label="Codec"      value={get('codec') ?? ''}      onChange={v => set('codec', v)} />
        </div>
        <p className="text-[10px] text-slate-500 dark:text-slate-600">
          A senha é cifrada no servidor (AES-256-GCM) antes de persistir. Após salvar,
          o campo aparece vazio — preencha somente se quiser substituir.
        </p>
      </GlassCard>

      {/* Edge Node — controla onde o stream WHEP/MJPEG é servido (go2rtc).
          Câmera sem edge funciona apenas para snapshot (ffmpeg local), não
          para live. Backend filtra os edges pelo tenant + valida ownership
          no momento do PATCH (anti-IDOR). */}
      <GlassCard className="p-4 space-y-3 md:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">Edge Node</h3>
          {(draft.edgeNodeId ?? camera?.edgeNodeId) ? (
            <span className="text-[10px] px-2 py-0.5 rounded border bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30">
              live habilitado
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded border bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
              live indisponível — apenas snapshot
            </span>
          )}
        </div>
        <label className="block">
          <span className="text-[11px] uppercase text-slate-500 tracking-wider">Edge associado</span>
          <select
            value={get('edgeNodeId') ?? ''}
            onChange={e => set('edgeNodeId', e.target.value === '' ? null : e.target.value)}
            className="w-full mt-1 px-2 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500/50"
          >
            <option value="">— Sem edge (apenas snapshot via ffmpeg) —</option>
            {edgeNodes.map(en => {
              const hasGo2rtc = !!en.go2rtcEndpoint
              const offline   = en.status !== 'ONLINE'
              return (
                <option key={en.id} value={en.id}>
                  {en.name} · {en.serialNumber}
                  {en.model ? ` · ${en.model}` : ''}
                  {' · '}
                  {en.status}
                  {!hasGo2rtc ? ' · ⚠ go2rtc não configurado' : ''}
                  {offline ? ' (offline)' : ''}
                </option>
              )
            })}
          </select>
        </label>
        {edgeNodes.length === 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300/80 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            Nenhum edge node neste site — cadastre um para habilitar live.
          </p>
        )}
        {selectedEdge && (
          <div className="text-[11px] text-slate-500 space-y-0.5">
            <p>
              <span className="text-slate-500 dark:text-slate-600">Acelerador:</span>{' '}
              {selectedEdge.accelerator ?? '—'}
              {' · '}
              <span className="text-slate-500 dark:text-slate-600">Status:</span>{' '}
              <span className={
                selectedEdge.status === 'ONLINE'  ? 'text-emerald-700 dark:text-emerald-300' :
                selectedEdge.status === 'OFFLINE' ? 'text-rose-700 dark:text-rose-300'    :
                                                    'text-amber-600 dark:text-amber-300'
              }>{selectedEdge.status}</span>
            </p>
            <p>
              <span className="text-slate-500 dark:text-slate-600">go2rtc:</span>{' '}
              {selectedEdge.go2rtcEndpoint ? (
                <span className="text-emerald-700 dark:text-emerald-300 font-mono">{selectedEdge.go2rtcEndpoint}</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-300">não configurado (live falhará)</span>
              )}
            </p>
            {selectedEdge.lastHeartbeat && (
              <p>
                <span className="text-slate-500 dark:text-slate-600">Último heartbeat:</span>{' '}
                {new Date(selectedEdge.lastHeartbeat).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        )}
        <p className="text-[10px] text-slate-500 dark:text-slate-600">
          O edge node é o nó físico/virtual que roda go2rtc + agente de
          inferência. Sem edge, apenas o snapshot (ffmpeg do backend) funciona;
          live (WHEP/MJPEG) requer edge online com go2rtc configurado.
        </p>
      </GlassCard>

      {/* Transmitir para (RTMP push out) — espelha o feed da câmera para
          uma plataforma de streaming externa (YouTube Live / Twitch /
          Facebook Live / CDN customizada). go2rtc faz copy do H.264 sem
          transcode (CPU ~zero). URL é cifrada AES-256-GCM no backend antes
          de persistir — pode conter stream key sensível. */}
      <GlassCard className="p-4 space-y-3 md:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">Transmitir para (RTMP push)</h3>
          {get('rtmpPushEnabled') && (camera?.rtmpPushConfigured || draft.rtmpPushUrl) ? (
            <span className="text-[10px] px-2 py-0.5 rounded border bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 dark:bg-rose-400 animate-pulse" />
              transmitindo
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/30">
              desabilitado
            </span>
          )}
        </div>
        <Toggle
          label="Habilitar push RTMP"
          value={get('rtmpPushEnabled') ?? false}
          onChange={(v: boolean) => set('rtmpPushEnabled', v)}
        />
        <Input
          label={
            camera?.rtmpPushConfigured && !draft.rtmpPushUrl
              ? 'URL configurada (deixe em branco para manter; preencha para alterar)'
              : 'URL completa com stream key (rtmp://… ou rtmps://…)'
          }
          value={get('rtmpPushUrl') ?? ''}
          onChange={(v: string) => set('rtmpPushUrl', v)}
        />
        <div className="text-[10px] text-slate-500 space-y-0.5">
          <p className="text-slate-600 dark:text-slate-400 font-semibold mt-1">Exemplos:</p>
          <p><span className="font-mono text-slate-700 dark:text-slate-300">YouTube Live:</span> rtmp://a.rtmp.youtube.com/live2/<span className="text-amber-600 dark:text-amber-300">SUA_STREAM_KEY</span></p>
          <p><span className="font-mono text-slate-700 dark:text-slate-300">Twitch:</span>      rtmp://live.twitch.tv/app/<span className="text-amber-600 dark:text-amber-300">SUA_STREAM_KEY</span></p>
          <p><span className="font-mono text-slate-700 dark:text-slate-300">Facebook:</span>    rtmps://live-api-s.facebook.com:443/rtmp/<span className="text-amber-600 dark:text-amber-300">SUA_STREAM_KEY</span></p>
        </div>
        <p className="text-[10px] text-slate-500 dark:text-slate-600 leading-relaxed">
          A URL é cifrada (AES-256-GCM) antes de persistir e nunca volta nas respostas
          da API. Push só inicia quando alguém estiver consumindo a câmera (lazy producer
          do go2rtc). Latência típica: 2–5s. Apenas câmera com edge node ou go2rtc embarcado.
        </p>
      </GlassCard>

      {/* Localização — coordenada específica da câmera (override do site). */}
      <GlassCard className="p-4 space-y-3 md:col-span-2">
        <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400 flex items-center gap-2">
          <MapPin className="w-4 h-4" /> Localização (mapa)
        </h3>
        <div className="flex gap-3 items-end">
          <div className="w-44">
            <label className="block">
              <span className="text-[11px] uppercase text-slate-500 tracking-wider">CEP</span>
              <div className="relative mt-1">
                <input
                  value={get('zipCode') ?? ''}
                  onChange={e => set('zipCode', e.target.value)}
                  onBlur={handleCepBlur}
                  placeholder="00000-000"
                  maxLength={9}
                  className="w-full px-3 py-1.5 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500/50"
                />
                {(cepLoading || geocoding) && (
                  <Loader2 className="absolute right-2 top-2 w-3.5 h-3.5 animate-spin text-cyan-500" />
                )}
              </div>
            </label>
          </div>
          <div className="flex-1">
            <Input label="Cidade" value={get('city') ?? ''} onChange={v => set('city', v)} />
          </div>
          <div className="w-20">
            <Input label="Estado (UF)" value={get('state') ?? ''} onChange={v => set('state', v.toUpperCase())} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Latitude"
            value={get('latitude') != null ? String(get('latitude')) : ''}
            onChange={v => set('latitude', v === '' ? null : parseFloat(v))}
            type="number"
          />
          <Input
            label="Longitude"
            value={get('longitude') != null ? String(get('longitude')) : ''}
            onChange={v => set('longitude', v === '' ? null : parseFloat(v))}
            type="number"
          />
        </div>
        {get('latitude') != null && get('longitude') != null && (
          <p className="text-[11px] text-emerald-500 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Coordenada definida — câmera aparecerá no mapa na posição exata.
          </p>
        )}
        <p className="text-[10px] text-slate-500 dark:text-slate-600">
          Preencha o CEP para auto-detectar cidade/estado e geocodificar. Se o site já tem coordenada, esta câmera a sobrescreve no mapa.
        </p>
      </GlassCard>

      {/* Agendamento de Gravação — sobrescreve recordMode por faixa horária */}
      <GlassCard className="p-4 space-y-3 md:col-span-2">
        <RecordingScheduleGrid cameraId={camera.id} />
      </GlassCard>

      <GlassCard className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">Motion</h3>
        <Toggle label="Habilitado" value={get('motionEnabled')} onChange={v => set('motionEnabled', v)} />
        <Slider label="Threshold" value={get('motionThreshold') ?? 30} onChange={v => set('motionThreshold', v)} min={1} max={255} />
        <Slider label="Contour Area" value={get('motionContourArea') ?? 10} onChange={v => set('motionContourArea', v)} min={1} max={100} />
      </GlassCard>

      <GlassCard className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">Detector</h3>
        <Input label="Tipo" value={get('detectorType') ?? 'CPU'} onChange={v => set('detectorType', v.toUpperCase())} />
        <div className="grid grid-cols-3 gap-2">
          <Input label="W"   value={get('detectorWidth')  ?? 1280} onChange={v => set('detectorWidth',  +v)} type="number" />
          <Input label="H"   value={get('detectorHeight') ?? 720}  onChange={v => set('detectorHeight', +v)} type="number" />
          <Input label="FPS" value={get('detectorFps')    ?? 5}    onChange={v => set('detectorFps',    +v)} type="number" />
        </div>
        <Input label="HwAccel" value={get('hwAccel') ?? 'NONE'} onChange={v => set('hwAccel', v.toUpperCase())} />
      </GlassCard>

      <GlassCard className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">Recursos</h3>

        {/* Cloud AI Worker — YOLO inferência server-side */}
        <div className="pb-2 border-b border-slate-200 dark:border-white/10">
          <Toggle
            label="Cloud AI (YOLO)"
            value={get('aiEnabled')}
            onChange={v => set('aiEnabled', v)}
          />
          {get('aiEnabled') && (
            <div className="mt-2 ml-6 space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-slate-500 w-32">Confiança mín.</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="0.99"
                  value={get('aiConfidenceMin') ?? 0.50}
                  onChange={e => set('aiConfidenceMin', parseFloat(e.target.value))}
                  className="w-20 px-2 py-1 text-xs rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white"
                />
                <span className="text-[10px] text-slate-400">(padrão 0.50)</span>
              </div>
              <a
                href={`/recordings/motion-search?cameraId=${camera.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white transition"
              >
                <Search className="w-3.5 h-3.5" />
                Pesquisar Detecções IA
              </a>
            </div>
          )}
        </div>

        <Toggle label="Face Recognition" value={get('faceRecognitionEnabled')} onChange={v => set('faceRecognitionEnabled', v)} />
        <Toggle label="LPR"              value={get('lprEnabled')}             onChange={v => set('lprEnabled', v)} />
        <Toggle label="Audio"            value={get('audioEnabled')}           onChange={v => set('audioEnabled', v)} />
        <Toggle label="Semantic Search"  value={get('semanticSearchEnabled')}  onChange={v => set('semanticSearchEnabled', v)} />
        <Toggle label="GenAI"            value={get('genaiEnabled')}           onChange={v => set('genaiEnabled', v)} />
      </GlassCard>

      {/* A4 (2026-05-09): retenção legacy fica somente leitura quando plano
          comercial está em vigor — evita confusão "configurei 30 dias mas só
          guarda 7" porque o plano sobrescreve recordRetainDays. */}
      <GlassCard className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
          Retenção (técnica)
          {camera.retentionPlanId && (
            <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-400 uppercase font-mono">
              Plano comercial em vigor
            </span>
          )}
        </h3>
        <Input
          label="Modo gravação"
          value={get('recordMode') ?? 'MOTION'}
          onChange={v => set('recordMode', v.toUpperCase())}
        />
        <Input
          label={camera.retentionPlanId ? 'Retain dias (desabilitado — plano dita)' : 'Retain dias'}
          value={get('recordRetainDays') ?? 7}
          onChange={v => set('recordRetainDays', +v)}
          type="number"
          disabled={!!camera.retentionPlanId}
        />
        <Input
          label="Retain alert dias"
          value={get('recordAlertRetainDays') ?? 30}
          onChange={v => set('recordAlertRetainDays', +v)}
          type="number"
        />
        <p className="text-[10px] text-slate-500 italic">
          {camera.retentionPlanId
            ? 'O plano comercial atribuído (card ao lado) substitui "Retain dias". Remova o override no card para reativar este campo.'
            : 'Sem plano comercial atribuído — câmera usa esta retenção técnica. Atribua um plano no card ao lado para integrar com billing.'}
        </p>
      </GlassCard>

      {/* Zona de risco — reset de gravações por câmera */}
      <GlassCard className="p-4 space-y-3 border border-rose-500/30">
        <h3 className="text-sm font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Zona de risco
        </h3>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold">
              Limpar todas as gravações desta câmera
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Apaga permanentemente os segmentos de vídeo no R2, o índice no banco
              e os arquivos locais. A câmera continuará gravando novas mídias
              normalmente. Esta ação não pode ser desfeita.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setClearOpen(true); setClearConfirm('') }}
            className="px-3 py-1.5 rounded text-xs font-bold bg-rose-500/20 text-rose-700 dark:text-rose-300 hover:bg-rose-500/30 transition flex items-center gap-1.5 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpar gravações
          </button>
        </div>
      </GlassCard>

      {/* Modal de confirmação — exige digitar o nome exato da câmera */}
      {clearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md w-full mx-4 border border-rose-500/40 shadow-2xl">
            <div className="flex items-center gap-2 mb-3 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-base font-bold">Confirmar limpeza de gravações</h3>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
              Você está prestes a apagar <strong>todos os segmentos de vídeo</strong>,
              snapshots e índices da câmera <strong>{camera.name}</strong>. Esta ação
              é irreversível.
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
              Para confirmar, digite o nome exato da câmera: <code className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-rose-600">{camera.name}</code>
            </p>
            <input
              type="text"
              value={clearConfirm}
              onChange={e => setClearConfirm(e.target.value)}
              placeholder={camera.name}
              autoFocus
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white mb-4"
              disabled={clearing}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setClearOpen(false); setClearConfirm('') }}
                disabled={clearing}
                className="px-4 py-2 rounded text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={clearConfirm !== camera.name || clearing}
                onClick={async () => {
                  setClearing(true)
                  try {
                    const r = await clearCameraRecordings(camera.id)
                    setFeedback({
                      type: 'success',
                      msg: `Limpeza completa: ${r.deleted.recordingSegments} segmentos, ${r.deleted.spriteSheets} sprites, ${r.deleted.r2Objects} objetos R2 apagados.`,
                    })
                    setClearOpen(false)
                    setClearConfirm('')
                    onSave()
                  } catch (err) {
                    setFeedback({ type: 'error', msg: formatApiError(err) })
                  } finally {
                    setClearing(false)
                  }
                }}
                className="px-4 py-2 rounded text-sm font-bold bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {clearing ? 'Apagando...' : 'Apagar tudo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plano comercial de retenção (G22 — substitui retenção legacy quando configurado) */}
      <CameraRetentionPlanCard cameraId={camera.id} cameraName={camera.name} />

      {/* B4: histórico de mudanças de plano desta câmera */}
      <PlanHistoryCard cameraId={camera.id} limit={10} />

      {/* Sprint Q.3 + Q.5 + Q.6 — Snapshots, Cooldown e Detecção Estacionária */}
      <GlassCard className="p-4 space-y-3 md:col-span-2">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">Snapshots, Cooldown & Estacionária</h3>
          <span className="px-1.5 py-0.5 rounded text-[9px] bg-violet-100 text-violet-700 border border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30 font-mono uppercase">
            Frigate-style
          </span>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 space-y-2">
            <Toggle
              label="Salvar cópia limpa do snapshot (sem bbox/timestamp)"
              value={get('cleanSnapshotEnabled') ?? true}
              onChange={v => set('cleanSnapshotEnabled', v)}
            />
            <p className="text-[10px] text-slate-500">
              Quando ligado, cada evento gera <em>dois</em> snapshots no GCS: o anotado (com bounding boxes)
              e o limpo. Use <code className="text-cyan-700 dark:text-cyan-300">GET /cameras/&lt;id&gt;/snapshot?variant=clean</code>
              {' '}para servir a versão limpa em modais de evidência.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 space-y-2">
            <Input
              label="Cooldown de notificações (segundos)"
              value={get('notificationCooldownSec') ?? 60}
              onChange={v => set('notificationCooldownSec', v ? +v : null)}
              type="number"
            />
            <p className="text-[10px] text-slate-500">
              Tempo mínimo entre dois alertas <em>iguais</em> da mesma câmera (mesmo objeto+severidade).
              Evita spam de push/MQTT em cenas com loitering. <strong>0</strong> desativa, <strong>60</strong> é
              o padrão razoável.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 space-y-2">
            <Input
              label="Intervalo de detecção estacionária (frames)"
              value={get('detectStationaryInterval') ?? 50}
              onChange={v => set('detectStationaryInterval', v ? +v : null)}
              type="number"
            />
            <p className="text-[10px] text-slate-500">
              A cada N frames, re-roda o detector em objetos parados — pega quando uma pessoa para de
              "ser pessoa" (ex.: empilhador estacionado classificado como pessoa). Frigate usa 50.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 space-y-2">
            <Input
              label="Threshold estacionário (frames sem mover)"
              value={get('detectStationaryThreshold') ?? 10}
              onChange={v => set('detectStationaryThreshold', v ? +v : null)}
              type="number"
            />
            <p className="text-[10px] text-slate-500">
              Após N frames sem deslocamento &gt; threshold, o objeto vira <em>stationary</em> e
              economiza CPU do detector. Padrão Frigate: 10.
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="md:col-span-2 flex items-center justify-between gap-2 sticky bottom-0 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md py-3 border-t border-slate-200 dark:border-white/5 -mx-2 px-2 z-10">
        <div className="flex-1">
          {feedback && (
            <div className={`text-xs px-3 py-1.5 rounded-lg border inline-flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
                : 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30'
            }`}>
              {feedback.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {feedback.msg}
            </div>
          )}
          {!feedback && dirtyCount > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {dirtyCount} {dirtyCount === 1 ? 'alteração não salva' : 'alterações não salvas'}
            </span>
          )}
        </div>
        <button
          onClick={discard}
          disabled={saving || dirtyCount === 0}
          className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-sm disabled:opacity-30"
        >
          Descartar
        </button>
        <button
          onClick={save}
          disabled={saving || dirtyCount === 0}
          className={
            // Quando o último submit deu sucesso (dirty=0 e feedback ok),
            // o botão fica VERDE com label "Salvo" para deixar claro pro
            // usuário que o clique surtiu efeito (era confuso quando ele
            // só ficava cinza-disabled e parecia "esvanecido"/travado).
            feedback?.type === 'success' && dirtyCount === 0
              ? 'px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold flex items-center gap-2 ring-2 ring-emerald-400/40'
              : 'px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50'
          }
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          {saving
            ? 'Salvando…'
            : feedback?.type === 'success' && dirtyCount === 0
              ? 'Salvo!'
              : `Salvar${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
        </button>
      </div>
    </div>
  )
}

// ── ZONES ──
function ZonesTab({ camera }: any) {
  return (
    <GlassCard className="p-6">
      <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400 mb-2">Zonas Configuradas</h3>
      <p className="text-xs text-slate-500 mb-4">
        Zonas definem áreas onde aplicar regras (inertia, loitering_time, filters) — estilo Frigate.
      </p>
      {(camera.zones ?? []).length === 0 ? (
        <div className="text-center py-10 text-slate-500 text-sm">Nenhuma zona configurada</div>
      ) : (
        <div className="space-y-2">
          {camera.zones.map((z: any) => (
            <div key={z.id} className="p-3 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900 dark:text-white text-sm">{z.name}</p>
                <p className="text-[11px] text-slate-500">inertia={z.inertia} · loitering={z.loiteringTimeSec}s · objects={(z.objectsJson ?? []).join(',')}</p>
              </div>
              <span className="text-xs text-slate-600 dark:text-slate-400">{z.color}</span>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}

// ── EVENTS / LOGS / FACES / LPR / STATS ──
function EventsTab({ cameraId: _cameraId }: any) {
  return <GlassCard className="p-6"><p className="text-xs text-slate-500">Eventos da câmera — em breve (usa /bi/evidence e ReviewItems)</p></GlassCard>
}

function LogsTab({ cameraId }: any) {
  const { data } = useCameraLogs(cameraId, { pageSize: '100' })
  // Backend GET /cameras/:id/logs retorna array DIRETO (não envelope { items }).
  // Schema usa `recordedAt` (não `createdAt` — bug que dava 500 em outras telas).
  const items: any[] = Array.isArray(data) ? data : (data?.items ?? [])
  return (
    <GlassCard className="p-0 overflow-hidden">
      <div className="p-4 border-b border-slate-200 dark:border-white/5">
        <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">Logs Recentes · {items.length}</h3>
      </div>
      <div className="max-h-[600px] overflow-y-auto font-mono text-xs">
        {items.map((l: any) => (
          <div key={l.id} className="px-4 py-1.5 border-b border-slate-200 dark:border-white/5 flex gap-3 hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5">
            <span className="text-slate-500 dark:text-slate-600 w-20 shrink-0">{new Date(l.recordedAt ?? l.createdAt).toLocaleTimeString()}</span>
            <span className={`w-14 font-bold ${
              l.level === 'ERROR' || l.level === 'FATAL' ? 'text-rose-700 dark:text-rose-400' :
              l.level === 'WARN'                         ? 'text-amber-600 dark:text-amber-400' :
              l.level === 'INFO'                         ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}`}>{l.level}</span>
            <span className="w-20 text-violet-700 dark:text-violet-400">{l.source}</span>
            <span className="flex-1 text-slate-700 dark:text-slate-300">{l.message}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}

function FacesTab({ cameraId: _cameraId }: any) {
  return <GlassCard className="p-6"><p className="text-xs text-slate-500">Reconhecimentos faciais nesta câmera — use /faces para gerenciar biblioteca</p></GlassCard>
}

function LprTab({ cameraId: _cameraId }: any) {
  return <GlassCard className="p-6"><p className="text-xs text-slate-500">Leituras de placa — use /plates para gerenciar placas cadastradas</p></GlassCard>
}

function StatsTab({ camera }: any) {
  return (
    <div className="space-y-4">
      {/* Uptime sparkline 7d — mostra cobertura de gravação por hora */}
      <GlassCard className="p-4">
        <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400 mb-3">
          Cobertura de gravação — últimos 7 dias
        </h3>
        <UptimeSparkline cameraId={camera.id} days={7} height={48} />
        <p className="text-[10px] text-slate-500 italic mt-2">
          Cada barra = 1 hora. Verde &gt; 80%, amarelo 20-80%, vermelho &lt; 20%, cinza sem dados.
        </p>
      </GlassCard>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Zonas"        value={camera._count?.zones ?? 0} />
        <StatBox label="Eventos"      value={camera._count?.analyticsEvents ?? 0} />
        <StatBox label="Face events"  value={camera._count?.faceEvents ?? 0} />
        <StatBox label="LPR events"   value={camera._count?.plateEvents ?? 0} />
      </div>
    </div>
  )
}
function StatBox({ label, value }: any) {
  return (
    <GlassCard className="p-4 text-center">
      <p className="text-[11px] uppercase text-slate-500 tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-cyan-700 dark:text-cyan-400 mt-1">{value}</p>
    </GlassCard>
  )
}

// ── Form helpers ──
function Toggle({ label, value, onChange }: { label: string; value: boolean | null | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-700 dark:text-slate-300">{label}</span>
      <button onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition ${value ? 'bg-cyan-500' : 'bg-slate-200 dark:bg-white/10'}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
      </button>
    </div>
  )
}
function Slider({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-500">{label}: <b className="text-cyan-700 dark:text-cyan-400">{value}</b></span>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(+e.target.value)} className="w-full" />
    </label>
  )
}
function Input({ label, value, onChange, type = 'text', disabled = false }: { label: string; value: string | number | null | undefined; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase text-slate-500 tracking-wider">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full mt-1 px-2 py-1.5 rounded border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500/50 ${
          disabled
            ? 'bg-slate-100 dark:bg-white/[0.02] opacity-60 cursor-not-allowed'
            : 'bg-slate-50 dark:bg-white/5'
        }`}
      />
    </label>
  )
}

/**
 * SnapshotLoopPlayer — exibe um JPEG da câmera atualizando a cada ~7s.
 *
 * Usado quando a câmera não tem edge node (live WHEP/MJPEG indisponível).
 * Cada captura passa pelo ffmpeg do backend (`/live/:id/snapshot-jpeg`),
 * que demora ~3–9s dependendo do handshake RTSP. Para evitar empilhamento
 * de requests sobrepostas, agendamos o próximo tick **só depois** que o
 * <img> termina de carregar (onLoad/onError) + 2s de gap.
 *
 * Anti-leak:
 *   - flag `alive` controla cleanup quando o componente desmonta ou cameraId muda
 *   - timeouts são limpos no return do useEffect
 *   - <img key={tick}> força nova request HTTP a cada tick (sem cache)
 *
 * Por que não setInterval(5_000): se a captura demora 9s, em 30s teríamos
 * 6 requests pendentes acumuladas, derrubando o backend (cada uma spawna
 * um ffmpeg). O modelo "load → wait → next" é auto-throttling.
 */
function SnapshotLoopPlayer({ cameraId, cameraName }: { cameraId: string; cameraName: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)

  // Busca uma URL nova com ticket fresco a cada `tick`.
  useEffect(() => {
    let alive = true
    snapshotCamera(cameraId)
      .then(({ snapshotUrl }) => {
        if (!alive) return
        // Cache-buster `&_=${Date.now()}` previne navegador reusar imagem
        // antiga (Cache-Control: max-age=2 do backend pode ainda servir
        // resposta cached em alguns navegadores).
        setUrl(`${BASE_URL}${snapshotUrl}&_=${Date.now()}`)
        setError(null)
      })
      .catch(err => {
        if (!alive) return
        setError(formatApiError(err))
        setLoading(false)
      })
    return () => { alive = false }
  }, [cameraId, tick])

  // Quando o <img> termina (load ou erro), agenda próximo tick.
  // O gap de 2s evita martelar o backend mesmo em câmera lenta.
  function scheduleNext(success: boolean) {
    setLoading(false)
    if (success) {
      setLastUpdate(new Date())
      setError(null)
    }
    const t = setTimeout(() => setTick(n => n + 1), 2000)
    return () => clearTimeout(t)
  }

  return (
    <div className="relative w-full h-full bg-black">
      {url && (
        <img
          key={tick}
          src={url}
          alt={`Snapshot ${cameraName}`}
          className="w-full h-full object-contain"
          onLoad={() => scheduleNext(true)}
          onError={() => {
            setError('Falha ao carregar snapshot — RTSP inacessível?')
            scheduleNext(false)
          }}
        />
      )}
      {loading && !url && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          <p className="text-xs">Capturando primeiro frame via ffmpeg…</p>
          <p className="text-[10px] text-slate-500">~3–9s no primeiro carregamento</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rose-950/60 text-rose-200 px-6 text-center">
          <AlertCircle className="w-8 h-8" />
          <p className="text-xs font-semibold">{error}</p>
          <p className="text-[10px] text-rose-300/70">Tentando novamente em ~2s…</p>
        </div>
      )}
      {/* Badges */}
      <div className="absolute top-2 left-2 flex items-center gap-2 pointer-events-none">
        <div className="px-2 py-1 rounded-md bg-amber-500/90 text-white text-[10px] font-bold flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          SNAPSHOT LOOP
        </div>
        <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border border-slate-200 dark:border-white/10 text-[10px] font-medium text-slate-900 dark:text-white truncate max-w-[200px]">
          {cameraName}
        </div>
      </div>
      {lastUpdate && (
        <div className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm border border-slate-200 dark:border-white/10 text-[10px] text-slate-600 dark:text-slate-300 font-mono pointer-events-none">
          atualizado {lastUpdate.toLocaleTimeString('pt-BR')}
        </div>
      )}
    </div>
  )
}

/**
 * Card "Modo de ingestão" — primeira decisão do operador na configuração:
 *
 *   RTSP_PULL — backend puxa o RTSP da câmera. Requer alcance de rede:
 *               LAN do backend, edge node, ou port-forward. Sub-segundo.
 *   RTMP_PUSH — câmera empurra RTMP outbound pra nós, atravessa NAT do
 *               cliente automaticamente. Sem hardware extra. 2-5s latência.
 *               Compatível com Hikvision/Dahua/Axis/Intelbras (~2018+).
 *
 * Quando o operador troca pra RTMP_PUSH, o backend gera uma stream key
 * automaticamente (visível ao revelar). Operador cola URL+key na câmera.
 *
 * Stream key é credencial sensível — UI mostra mascarada por padrão,
 * com toggle "👁 mostrar" que dispara endpoint dedicado (com log de
 * auditoria em CameraLog).
 */
function IngestModeCard({ camera, draft, get: _get, set }: any) {
  const { data: ingestConfig } = useIngestConfig()
  const [revealedKey, setRevealedKey] = useState<{ key: string; url: string } | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [copied, setCopied] = useState<'url' | 'key' | null>(null)

  const currentMode: 'RTSP_PULL' | 'RTMP_PUSH' =
    draft.ingestMode ?? camera?.ingestMode ?? 'RTSP_PULL'
  const hasKey = !!camera?.rtmpIngestKeyConfigured

  // Snapshot do último frame recebido — backend atualiza a cada tick do
  // ingest-sync quando vê o stream da câmera no go2rtc.
  const lastFrame = camera?.rtmpIngestLastFrameAt ? new Date(camera.rtmpIngestLastFrameAt) : null
  const isReceiving = lastFrame && (Date.now() - lastFrame.getTime()) < 30_000

  async function handleReveal() {
    setRevealing(true)
    try {
      const r = await revealRtmpIngestKey(camera.id)
      if (r.key && r.url) setRevealedKey({ key: r.key, url: r.url })
    } catch (e: any) {
      alert(formatApiError(e))
    } finally {
      setRevealing(false)
    }
  }

  async function handleRegenerate() {
    if (!confirm('Gerar nova stream key vai INVALIDAR a key atual. A câmera vai parar de empurrar até você atualizar a configuração dela com a nova URL. Continuar?')) return
    setRegenerating(true)
    try {
      const r = await regenerateRtmpIngestKey(camera.id)
      if (r.key && r.url) setRevealedKey({ key: r.key, url: r.url })
    } catch (e: any) {
      alert(formatApiError(e))
    } finally {
      setRegenerating(false)
    }
  }

  async function copyToClipboard(text: string, what: 'url' | 'key') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* fallback: select-all não vale o esforço aqui */ }
  }

  return (
    <GlassCard className="p-4 space-y-3 md:col-span-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-cyan-700 dark:text-cyan-400">Modo de ingestão</h3>
        {currentMode === 'RTMP_PUSH' && (
          isReceiving ? (
            <span className="text-[10px] px-2 py-0.5 rounded border bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
              recebendo stream
            </span>
          ) : hasKey ? (
            <span className="text-[10px] px-2 py-0.5 rounded border bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
              aguardando câmera empurrar
            </span>
          ) : null
        )}
      </div>

      {/* Toggle de modo — radio cards estilo "card selector" */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => set('ingestMode', 'RTSP_PULL')}
          className={cn(
            'p-3 rounded-lg border text-left transition',
            currentMode === 'RTSP_PULL'
              ? 'border-cyan-400 bg-cyan-50 dark:border-cyan-500/60 dark:bg-cyan-500/10'
              : 'border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]',
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className={cn('w-3 h-3 rounded-full border-2', currentMode === 'RTSP_PULL' ? 'border-cyan-600 bg-cyan-600 dark:border-cyan-400 dark:bg-cyan-400' : 'border-slate-400 dark:border-slate-500')} />
            <span className="text-xs font-bold text-slate-900 dark:text-white">RTSP Pull</span>
          </div>
          <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-relaxed">
            Backend puxa RTSP da câmera. Requer rede local, edge node ou
            port-forward. <strong>Sub-segundo</strong> de latência.
          </p>
        </button>
        <button
          type="button"
          onClick={() => set('ingestMode', 'RTMP_PUSH')}
          className={cn(
            'p-3 rounded-lg border text-left transition',
            currentMode === 'RTMP_PUSH'
              ? 'border-cyan-400 bg-cyan-50 dark:border-cyan-500/60 dark:bg-cyan-500/10'
              : 'border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]',
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className={cn('w-3 h-3 rounded-full border-2', currentMode === 'RTMP_PUSH' ? 'border-cyan-600 bg-cyan-600 dark:border-cyan-400 dark:bg-cyan-400' : 'border-slate-400 dark:border-slate-500')} />
            <span className="text-xs font-bold text-slate-900 dark:text-white">RTMP Push ⭐</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 font-semibold">recomendado</span>
          </div>
          <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-relaxed">
            Câmera empurra RTMP pra nós. <strong>Atravessa NAT</strong> sem
            hardware extra. 2-5s latência. Hikvision/Dahua/Axis ~2018+.
          </p>
        </button>
      </div>

      {/* Painel de credenciais (visível só em RTMP_PUSH) */}
      {currentMode === 'RTMP_PUSH' && (
        <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 p-3 space-y-3">
          {!hasKey && draft.ingestMode !== 'RTMP_PUSH' ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Salve as alterações para gerar uma stream key.
            </p>
          ) : !hasKey ? (
            <p className="text-[11px] text-cyan-700 dark:text-cyan-300">
              Stream key será gerada automaticamente ao salvar.
            </p>
          ) : (
            <>
              <div>
                <p className="text-[10px] uppercase text-slate-500 tracking-wider mb-1">URL de ingestão</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-2 py-1.5 rounded bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] font-mono text-cyan-800 dark:text-cyan-200 truncate">
                    {revealedKey?.url ?? `${ingestConfig?.rtmpUrlBase ?? 'rtmp://…'}/${revealedKey?.key ?? '••••••••••••'}`}
                  </code>
                  <button
                    onClick={() => revealedKey && copyToClipboard(revealedKey.url, 'url')}
                    disabled={!revealedKey}
                    className="px-2 py-1.5 rounded bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-[11px] text-slate-700 dark:text-slate-300 disabled:opacity-30"
                    title="Copiar URL completa"
                  >
                    {copied === 'url' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase text-slate-500 tracking-wider mb-1">Stream key</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-2 py-1.5 rounded bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] font-mono text-amber-700 dark:text-amber-200 truncate">
                    {revealedKey?.key ?? '••••••••••••••••••••••••••••'}
                  </code>
                  {!revealedKey ? (
                    <button
                      onClick={handleReveal}
                      disabled={revealing}
                      className="px-2 py-1.5 rounded bg-amber-100 dark:bg-amber-500/20 hover:bg-amber-200 dark:hover:bg-amber-500/30 border border-amber-200 dark:border-amber-500/40 text-[11px] text-amber-800 dark:text-amber-200 font-semibold flex items-center gap-1 disabled:opacity-50"
                      title="Mostrar a stream key (logged em auditoria)"
                    >
                      {revealing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '👁'} mostrar
                    </button>
                  ) : (
                    <button
                      onClick={() => revealedKey && copyToClipboard(revealedKey.key, 'key')}
                      className="px-2 py-1.5 rounded bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-[11px] text-slate-700 dark:text-slate-300"
                      title="Copiar key"
                    >
                      {copied === 'key' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className="px-2 py-1.5 rounded bg-rose-100 dark:bg-rose-500/20 hover:bg-rose-200 dark:hover:bg-rose-500/30 border border-rose-200 dark:border-rose-500/40 text-[11px] text-rose-800 dark:text-rose-200 font-semibold flex items-center gap-1 disabled:opacity-50"
                    title="Gerar nova key (invalida a anterior)"
                  >
                    {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '🔄'} rotacionar
                  </button>
                </div>
              </div>

              {lastFrame && (
                <p className="text-[10px] text-slate-500">
                  Último frame:{' '}
                  <span className={isReceiving ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                    {isReceiving
                      ? `há ${Math.round((Date.now() - lastFrame.getTime()) / 1000)}s`
                      : lastFrame.toLocaleString('pt-BR')}
                  </span>
                </p>
              )}
            </>
          )}

          <details className="text-[10px] text-slate-500 leading-relaxed">
            <summary className="cursor-pointer hover:text-slate-700 dark:hover:text-slate-600 dark:text-slate-300 select-none">📖 Como configurar a câmera</summary>
            <div className="mt-2 space-y-2 pl-4 border-l border-slate-200 dark:border-white/10">
              <div>
                <p className="font-semibold text-slate-600 dark:text-slate-400">Hikvision (firmware simples — só "Server IP Address"):</p>
                <p>1. Configuration → Network → Network Service → RTMP</p>
                <p>2. Marcar <em>Enable</em></p>
                <p>3. Server IP Address: <code className="text-cyan-700 dark:text-cyan-300">{ingestConfig?.rtmpHost ?? '...'}</code></p>
                <p>4. Salvar. Path padrão será <code>live/&lt;serial&gt;</code> — ajuste a key da câmera no UI pra bater.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-600 dark:text-slate-400">Hikvision (firmware completo) / Dahua / Intelbras:</p>
                <p>Cole a <strong>URL completa</strong> (acima) no campo de RTMP push da câmera.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-600 dark:text-slate-400">Smartphone (POC rápido):</p>
                <p>App <em>Larix Broadcaster</em> (grátis Android/iOS) → Settings → Connections → "URL only" → cola URL completa.</p>
              </div>
            </div>
          </details>
        </div>
      )}
    </GlassCard>
  )
}
