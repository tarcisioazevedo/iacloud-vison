/**
 * CameraGridCard — card individual do grid de configuração de câmeras.
 *
 * Cada card gerencia o próprio preview com 3 níveis de progressão:
 *   1. Lazy: nada acontece até o card entrar no viewport (IntersectionObserver
 *      com rootMargin 200px → começa a buscar um pouco antes).
 *   2. Snapshot auto-refresh: a cada 45s quando visível
 *      (POST /cameras/:id/snapshot — endpoint que já existe).
 *   3. Live opcional: usuário clica 👁 → ativa LivePlayer (WHEP+fallback)
 *      por 2 min, depois volta automaticamente pra snapshot.
 *
 * Por que esse padrão (espelha Frigate / UniFi Protect / Synology Surveillance):
 *   - Tela é de CONFIG, não monitoramento — live contínuo é desperdício.
 *   - Snapshot prova "câmera funciona, está apontando pra X" sem custo de stream.
 *   - Live sob demanda destrava ajuste fino (PTZ, zonas) sem que 8+ peers
 *     WebRTC simultâneos travem o browser ou bloqueiem em rede corporativa.
 *
 * Auto-expire de 2 min: usuário esquece a aba aberta, recursos liberam sozinhos.
 *
 * Câmeras não-ACTIVE: NÃO buscamos snapshot (evita ruído no log do backend
 * com 4xx esperados) e desabilitamos os botões de preview/live.
 */
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Camera, PlayCircle, Settings, Trash2, Eye, EyeOff, Image as ImageIcon,
  Video, Server, Cpu, Cloud, RefreshCw,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { getLiveToken, getCameraSnapshotUrl, BASE_URL } from '../../api/client'
import { LivePlayer } from '../player/LivePlayer'

// ─── Constantes visuais (espelham CamerasPage para consistência) ───────────
// NOTA: STATUS_STYLES aqui é renderizado SOBRE o thumbnail de vídeo, sempre
// escuro mesmo no tema light — então mantemos só a versão "translúcida-glass"
// (legível sobre qualquer frame). PIPELINE_COLORS idem.
const STATUS_STYLES: Record<string, string> = {
  ACTIVE:       'bg-emerald-500/30 text-emerald-200 border-emerald-400/40',
  PROVISIONING: 'bg-amber-500/30 text-amber-200 border-amber-400/40',
  PAUSED:       'bg-slate-500/30 text-slate-200 border-slate-400/40',
  ERROR:        'bg-rose-500/30 text-rose-200 border-rose-400/40',
  INACTIVE:     'bg-slate-700/40 text-slate-600 dark:text-slate-300 border-slate-600/50',
}
const PIPELINE_ICON: Record<string, any> = {
  EDGE_YOLO:        Cpu,
  VERTEX_STREAMING: Cloud,
  VISION_API_BATCH: Server,
}
const PIPELINE_COLORS: Record<string, string> = {
  EDGE_YOLO:        'text-emerald-200 bg-emerald-500/30 border-emerald-400/40',
  VERTEX_STREAMING: 'text-cyan-200 bg-cyan-500/30 border-cyan-400/40',
  VISION_API_BATCH: 'text-violet-200 bg-violet-500/30 border-violet-400/40',
}

const SNAP_REFRESH_MS     = 45_000   // 45s entre snapshots automáticos
const TICKET_TTL_MS       = 50_000   // ticket dura 60s no backend; renovamos com folga
const LIVE_AUTO_EXPIRE_MS = 120_000  // 2 min em live → volta pra snapshot

interface Props {
  cam: any
  onNavigate: (path: string) => void
  onTest:     (id: string) => void
  onDelete:   (id: string, name: string) => void
  testing:    boolean
  testResult?: any
  /** Componentes auxiliares passados para evitar duplicação de helpers visuais. */
  IdChip:  React.ComponentType<{ id: string }>
  Chip:    React.ComponentType<{ children: React.ReactNode; color: string }>
  IconBtn: React.ComponentType<any>
}

export function CameraGridCard({
  cam, onNavigate, onTest, onDelete, testing, testResult,
  IdChip, Chip, IconBtn,
}: Props) {
  const cardRef         = useRef<HTMLDivElement>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveExpireRef   = useRef<ReturnType<typeof setTimeout>  | null>(null)
  // Ticket JWT-curto (60s) emitido pelo backend para autorizar GET do snapshot
  // sem precisar de cookie/Authorization no `<img>`. Renovamos antes de expirar.
  const ticketRef       = useRef<{ ticket: string; expiresAt: number } | null>(null)

  const [isVisible,   setIsVisible]   = useState(false)
  const [snap,        setSnap]        = useState<{ url: string; ts: number } | null>(null)
  const [snapLoading, setSnapLoading] = useState(false)
  const [snapErr,     setSnapErr]     = useState(false)
  const [liveMode,    setLiveMode]    = useState(false)
  // Tick que força recálculo do "atualizado há Xs" sem refazer a request.
  const [, forceTick] = useState(0)

  const PipeIcon   = PIPELINE_ICON[cam.pipeline] ?? Video
  const pipeColor  = PIPELINE_COLORS[cam.pipeline] ?? ''
  // Box snapshots-live persiste em Camera.lastSnapshotUrl. Funciona mesmo
  // com câmera ERROR (último frame válido). Se ausente, fallback ffmpeg quando ACTIVE.
  const hasPersistedSnap = !!cam.lastSnapshotUrl
  const canFfmpegSnap = cam.status === 'ACTIVE' && !hasPersistedSnap
  const canPreview = hasPersistedSnap || canFfmpegSnap

  // ── IntersectionObserver: só ativa snapshots quando o card aparece ──────
  // rootMargin 200px = pré-busca antes de entrar 100% no viewport, dando UX
  // de "imagem já estava pronta" no scroll lento.
  useEffect(() => {
    if (!cardRef.current) return
    const obs = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: '200px' },
    )
    obs.observe(cardRef.current)
    return () => obs.disconnect()
  }, [])

  // ── Snapshot auto-refresh quando visível e não em live mode ────────────
  // Usa GET /live/:id/snapshot-jpeg?ticket=... (gera frame fresco via ffmpeg)
  // em vez do POST /cameras/:id/snapshot — esse último retorna URL pra
  // evidência salva em disco, que pode 404 se o arquivo foi rotacionado.
  //
  // Câmera não-ACTIVE não tem stream → pulamos a chamada (evita 4xx no log).
  useEffect(() => {
    if (!isVisible || liveMode || !canPreview) return
    let cancelled = false

    const ensureTicket = async (): Promise<string | null> => {
      const cur = ticketRef.current
      if (cur && Date.now() < cur.expiresAt) return cur.ticket
      try {
        const t = await getLiveToken(cam.id, 'snapshot')
        ticketRef.current = { ticket: t.ticket, expiresAt: Date.now() + TICKET_TTL_MS }
        return t.ticket
      } catch {
        return null
      }
    }

    const fetchSnap = async () => {
      setSnapLoading(true)
      // Caminho A: snapshot persistido pela Box → R2 (presigned)
      if (hasPersistedSnap) {
        const r = await getCameraSnapshotUrl(cam.id)
        if (cancelled) return
        if (r?.url) {
          const url = r.url + (r.url.includes('?') ? '&' : '?') + '_=' + Date.now()
          setSnap({ url, ts: Date.now() })
          setSnapErr(false)
          return
        }
      }
      // Caminho B: ffmpeg via ticket (cloud-direct ACTIVE)
      if (canFfmpegSnap) {
        const ticket = await ensureTicket()
        if (cancelled) return
        if (!ticket) { setSnapLoading(false); setSnapErr(true); return }
        const url = `${BASE_URL}/live/${cam.id}/snapshot-jpeg?ticket=${encodeURIComponent(ticket)}&_=${Date.now()}`
        setSnap({ url, ts: Date.now() })
        setSnapErr(false)
        return
      }
      setSnapLoading(false); setSnapErr(true)
    }

    fetchSnap()
    refreshTimerRef.current = setInterval(fetchSnap, SNAP_REFRESH_MS)

    return () => {
      cancelled = true
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [isVisible, liveMode, canPreview, cam.id])

  // ── Re-render do label "atualizado há Xs" a cada 10s ───────────────────
  useEffect(() => {
    if (!snap) return
    const t = setInterval(() => forceTick(n => n + 1), 10_000)
    return () => clearInterval(t)
  }, [snap])

  // ── Auto-expire do live mode após 2 min ────────────────────────────────
  // Evita que o usuário deixe a aba aberta e drene banda/CPU sem perceber.
  useEffect(() => {
    if (!liveMode) return
    liveExpireRef.current = setTimeout(() => setLiveMode(false), LIVE_AUTO_EXPIRE_MS)
    return () => {
      if (liveExpireRef.current) clearTimeout(liveExpireRef.current)
      liveExpireRef.current = null
    }
  }, [liveMode])

  async function manualRefresh(e?: React.MouseEvent) {
    e?.stopPropagation()
    if (!canPreview || snapLoading) return
    setSnapLoading(true)
    try {
      const cur = ticketRef.current
      let ticket = cur && Date.now() < cur.expiresAt ? cur.ticket : null
      if (!ticket) {
        const t = await getLiveToken(cam.id, 'snapshot')
        ticketRef.current = { ticket: t.ticket, expiresAt: Date.now() + TICKET_TTL_MS }
        ticket = t.ticket
      }
      const url = `${BASE_URL}/live/${cam.id}/snapshot-jpeg?ticket=${encodeURIComponent(ticket)}&_=${Date.now()}`
      setSnap({ url, ts: Date.now() })
      setSnapErr(false)
      // snapLoading limpa no onLoad/onError
    } catch {
      setSnapLoading(false)
      setSnapErr(true)
    }
  }

  function toggleLive(e: React.MouseEvent) {
    e.stopPropagation()
    if (!canPreview) return
    setLiveMode(m => !m)
  }

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      className="group relative"
    >
      <GlassCard className="overflow-hidden p-0">
        {/* Thumbnail / Live */}
        <div
          className="aspect-video relative bg-gradient-to-br from-slate-800 to-slate-900 cursor-pointer overflow-hidden"
          onClick={() => onNavigate(`/cameras/${cam.id}`)}
        >
          {liveMode ? (
            // LivePlayer ocupa o thumbnail. Click no card abre detalhe — então
            // contemos o propagate aqui pra que clique no player não navegue.
            <div onClick={e => e.stopPropagation()} className="w-full h-full">
              <LivePlayer
                cameraId={cam.id}
                mode="auto"
                showOverlay={false}
                fit="auto"
                className="w-full h-full"
              />
            </div>
          ) : snap && !snapErr ? (
            <>
              <img
                src={snap.url}
                alt=""
                className="w-full h-full object-cover"
                onLoad={() => { setSnapLoading(false); setSnapErr(false) }}
                onError={() => { setSnapLoading(false); setSnapErr(true) }}
              />
              {snapLoading && (
                <div className="absolute top-2 right-12 p-1 rounded bg-black/60 backdrop-blur-sm">
                  <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" />
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 gap-1">
              <Camera className="w-16 h-16 opacity-30" />
              {snapErr && (
                <span className="text-[10px] text-rose-400/70 font-medium">Sem sinal</span>
              )}
              {snapLoading && (
                <RefreshCw className="absolute top-3 right-3 w-5 h-5 text-cyan-400 animate-spin" />
              )}
            </div>
          )}

          {/* Status / pipeline overlays — sempre visíveis */}
          <div className="absolute top-2 left-2 flex gap-1.5 pointer-events-none">
            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[cam.status] ?? STATUS_STYLES.INACTIVE}`}>
              {cam.status}
            </span>
            {liveMode && (
              <span className="px-2 py-0.5 rounded-full bg-rose-500/90 text-white text-[10px] font-bold animate-pulse">LIVE</span>
            )}
          </div>
          <div className="absolute top-2 right-2 flex gap-1 pointer-events-none">
            <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono ${pipeColor}`}>
              <PipeIcon className="w-3 h-3 inline -mt-0.5" /> {cam.pipeline.split('_')[0]}
            </span>
          </div>

          {/* Bottom-left: resolução / fps / codec */}
          <div className="absolute bottom-2 left-2 flex gap-1.5 text-[10px] text-white/80 font-mono pointer-events-none">
            {cam.resolution && <span className="px-1.5 bg-black/50 rounded">{cam.resolution}</span>}
            {cam.fps        && <span className="px-1.5 bg-black/50 rounded">{cam.fps}fps</span>}
            {cam.codec      && <span className="px-1.5 bg-black/50 rounded">{cam.codec}</span>}
          </div>

          {/* Bottom-right: timestamp + controles (refresh / live toggle) */}
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            {snap && !liveMode && (
              <span className="px-1.5 py-0.5 bg-black/60 rounded text-[9px] font-mono text-slate-600 dark:text-slate-300">
                {formatRelative(snap.ts)}
              </span>
            )}
            {canPreview && (
              <>
                <button
                  onClick={manualRefresh}
                  disabled={snapLoading || liveMode}
                  title="Atualizar snapshot agora"
                  className="p-1 rounded bg-black/60 hover:bg-black/80 text-white/80 hover:text-white disabled:opacity-40 transition"
                >
                  <RefreshCw className={`w-3 h-3 ${snapLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={toggleLive}
                  title={liveMode ? 'Parar live (auto-fecha em 2min)' : 'Ativar live (2 min)'}
                  className={`p-1 rounded text-white hover:text-white transition ${
                    liveMode
                      ? 'bg-rose-500/80 hover:bg-rose-500'
                      : 'bg-black/60 hover:bg-cyan-500/80'
                  }`}
                >
                  {liveMode ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="p-4 space-y-2">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-sm truncate flex-1 text-slate-900 dark:text-white">{cam.name}</h3>
              <IdChip id={cam.id} />
            </div>
            <p className="text-[11px] text-slate-500 truncate">
              {cam.site?.name ?? 'Sem site'} · {cam.location ?? '—'}
            </p>
          </div>

          {/* Features chips */}
          <div className="flex flex-wrap gap-1">
            {cam.motionEnabled         && <Chip color="amber">motion</Chip>}
            {cam.faceRecognitionEnabled && <Chip color="cyan">face</Chip>}
            {cam.lprEnabled            && <Chip color="violet">LPR</Chip>}
            {cam.audioEnabled          && <Chip color="rose">audio</Chip>}
            {cam.semanticSearchEnabled && <Chip color="emerald">semantic</Chip>}
            {cam.recordMode && cam.recordMode !== 'DISABLED' && <Chip color="slate">{cam.recordMode}</Chip>}
          </div>

          {/* Tier + test result */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-500">
              Tier {cam.tier ?? '—'}
            </span>
            {testResult && (
              <span className={`text-[10px] font-mono ${testResult.success
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-700 dark:text-rose-400'}`}>
                {testResult.success ? `✓ ${testResult.latencyMs}ms` : '✗ Falha'}
              </span>
            )}
          </div>

          {/* Actions row */}
          <div className="flex gap-1 pt-2 border-t border-slate-200 dark:border-white/5">
            <IconBtn icon={PlayCircle}  onClick={() => onTest(cam.id)} loading={testing} tooltip="Testar RTSP" />
            <IconBtn icon={ImageIcon}   onClick={() => manualRefresh()} tooltip="Snapshot agora" />
            <IconBtn icon={Eye}         onClick={() => onNavigate(`/cameras/${cam.id}`)} tooltip="Detalhes" />
            <IconBtn icon={Settings}    onClick={() => onNavigate(`/cameras/${cam.id}?tab=config`)} tooltip="Config" />
            <IconBtn icon={Trash2}      onClick={() => onDelete(cam.id, cam.name)} tooltip="Remover" danger />
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

/** "agora" / "há 12s" / "há 3m" / "há 2h" — formato compacto para badge. */
function formatRelative(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 5)    return 'agora'
  if (sec < 60)   return `há ${sec}s`
  if (sec < 3600) return `há ${Math.floor(sec / 60)}m`
  return `há ${Math.floor(sec / 3600)}h`
}
