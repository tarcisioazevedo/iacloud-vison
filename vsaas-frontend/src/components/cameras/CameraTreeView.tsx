/**
 * CameraTreeView — listagem em árvore (linha) das câmeras agrupadas por
 * Cliente Final → Site → Câmera, com miniatura ao vivo atualizada a cada 30s.
 *
 * Filosofia:
 *   - Densa: cada câmera ocupa 1 linha. Permite ver 30+ câmeras sem rolagem.
 *   - Hierárquica: agrupamento mostra estrutura física do cliente.
 *   - Live: thumbnail é regenerada via ffmpeg (GET /live/:id/snapshot-jpeg)
 *     a cada 30s quando a linha está visível (IntersectionObserver).
 *
 * Câmeras não-ACTIVE não buscam snapshot (evita 4xx no log).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronRight, ChevronDown, Camera as CameraIcon,
  Building2, MapPin, PlayCircle, Settings, Trash2, RefreshCw,
} from 'lucide-react'
import { getLiveToken, getCameraSnapshotUrl, BASE_URL } from '../../api/client'
import { cn } from '../../lib/utils'

const SNAPSHOT_REFRESH_MS = 30_000   // 30s — pedido explícito do usuário
const TICKET_TTL_MS       = 50_000

const STATUS_DOT: Record<string, string> = {
  ACTIVE:       'bg-emerald-500',
  PROVISIONING: 'bg-amber-500 animate-pulse',
  PAUSED:       'bg-slate-500',
  ERROR:        'bg-rose-500 animate-pulse',
  INACTIVE:     'bg-slate-600',
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'ATIVA', PROVISIONING: 'PROVISIONANDO', PAUSED: 'PAUSADA',
  ERROR: 'ERRO',  INACTIVE: 'INATIVA',
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:       'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  PROVISIONING: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  PAUSED:       'bg-slate-500/15 text-slate-400 border-slate-500/30',
  ERROR:        'bg-rose-500/15 text-rose-300 border-rose-500/30',
  INACTIVE:     'bg-slate-700/30 text-slate-500 border-slate-700/50',
}

interface Props {
  cameras: any[]
  onTest?: (id: string) => void
  onDelete?: (id: string, name: string) => void
  testingId?: string | null
}

interface Group {
  clienteId: string
  clienteName: string
  sites: Array<{
    siteId: string
    siteName: string
    siteAddress: string | null
    cameras: any[]
  }>
}

function buildTree(cameras: any[]): Group[] {
  const map = new Map<string, Group>()
  for (const cam of cameras) {
    const clienteId   = cam.site?.clienteFinal?.id   ?? '_orphan'
    const clienteName = cam.site?.clienteFinal?.name ?? '(sem cliente)'
    const siteId      = cam.site?.id   ?? '_orphan_site'
    const siteName    = cam.site?.name ?? '(sem site)'
    const siteAddress = [cam.site?.city, cam.site?.state].filter(Boolean).join('/') || null

    if (!map.has(clienteId)) {
      map.set(clienteId, { clienteId, clienteName, sites: [] })
    }
    const group = map.get(clienteId)!
    let site = group.sites.find(s => s.siteId === siteId)
    if (!site) {
      site = { siteId, siteName, siteAddress, cameras: [] }
      group.sites.push(site)
    }
    site.cameras.push(cam)
  }
  // Ordena: clientes alfabético, sites alfabético, câmeras por nome
  for (const g of map.values()) {
    g.sites.sort((a, b) => a.siteName.localeCompare(b.siteName))
    g.sites.forEach(s => s.cameras.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')))
  }
  return Array.from(map.values()).sort((a, b) => a.clienteName.localeCompare(b.clienteName))
}

export function CameraTreeView({ cameras, onTest, onDelete, testingId }: Props) {
  const groups = useMemo(() => buildTree(cameras), [cameras])
  // Por padrão tudo expandido — vista é densa por design.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  if (cameras.length === 0) return null

  return (
    <div className="space-y-3">
      {groups.map(g => {
        const totalCams = g.sites.reduce((s, x) => s + x.cameras.length, 0)
        const cliKey = `cli:${g.clienteId}`
        const cliCollapsed = collapsed.has(cliKey)
        return (
          <div key={g.clienteId} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-space-900 overflow-hidden">
            {/* Header Cliente */}
            <button onClick={() => toggle(cliKey)}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-violet-500/5 hover:bg-violet-500/10 border-b border-slate-200 dark:border-white/5 transition">
              {cliCollapsed
                ? <ChevronRight className="w-4 h-4 text-violet-400 shrink-0" />
                : <ChevronDown className="w-4 h-4 text-violet-400 shrink-0" />}
              <Building2 className="w-4 h-4 text-violet-400 shrink-0" />
              <span className="text-sm font-bold text-slate-900 dark:text-white">{g.clienteName}</span>
              <span className="text-[11px] text-slate-500">·</span>
              <span className="text-[11px] text-slate-500">{g.sites.length} site{g.sites.length > 1 ? 's' : ''}</span>
              <span className="text-[11px] text-slate-500">·</span>
              <span className="text-[11px] text-slate-500">{totalCams} câmera{totalCams > 1 ? 's' : ''}</span>
            </button>

            {!cliCollapsed && g.sites.map(site => {
              const siteKey = `site:${site.siteId}`
              const siteCollapsed = collapsed.has(siteKey)
              return (
                <div key={site.siteId}>
                  {/* Header Site */}
                  <button onClick={() => toggle(siteKey)}
                    className="w-full flex items-center gap-2 pl-7 pr-4 py-2 bg-cyan-500/[0.04] hover:bg-cyan-500/10 border-b border-slate-200 dark:border-white/5 transition text-left">
                    {siteCollapsed
                      ? <ChevronRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                    <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{site.siteName}</span>
                    {site.siteAddress && (
                      <span className="text-[10px] text-slate-500">· {site.siteAddress}</span>
                    )}
                    <span className="text-[10px] text-slate-500 ml-auto">{site.cameras.length} câmera{site.cameras.length > 1 ? 's' : ''}</span>
                  </button>

                  {!siteCollapsed && (
                    <div className="divide-y divide-slate-200/60 dark:divide-white/5">
                      {site.cameras.map(cam => (
                        <CameraTreeRow
                          key={cam.id}
                          cam={cam}
                          onTest={onTest}
                          onDelete={onDelete}
                          testing={testingId === cam.id}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────

function CameraTreeRow({ cam, onTest, onDelete, testing }: {
  cam: any
  onTest?: (id: string) => void
  onDelete?: (id: string, name: string) => void
  testing?: boolean
}) {
  const navigate = useNavigate()
  const rowRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [snapUrl, setSnapUrl] = useState<string | null>(null)
  const [snapErr, setSnapErr] = useState(false)
  const [snapLoading, setSnapLoading] = useState(false)
  const ticketRef = useRef<{ ticket: string; expiresAt: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Tenta snapshot persistido (Box → R2) primeiro — funciona mesmo com câmera ERROR.
  // Se Camera tiver lastSnapshotUrl, mostramos. Para câmeras puramente cloud-direct
  // ACTIVE, fallback para ffmpeg ticket.
  const hasPersistedSnap = !!cam.lastSnapshotUrl
  const canFfmpegSnap = cam.status === 'ACTIVE' && !hasPersistedSnap
  const canPreview = hasPersistedSnap || canFfmpegSnap

  // IntersectionObserver — só busca snapshot quando linha está visível
  useEffect(() => {
    if (!rowRef.current) return
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '100px' },
    )
    obs.observe(rowRef.current)
    return () => obs.disconnect()
  }, [])

  // Auto-refresh do snapshot a cada 30s.
  // Caminho A (preferido): GET /cameras/:id/snapshot/url → presigned R2 (10min)
  //   Funciona com camera EDGE_BOX em LAN remota (Box já fez upload ao R2).
  //   Funciona mesmo com status ERROR — usa último snapshot válido persistido.
  // Caminho B (fallback): /live/:id/snapshot-jpeg?ticket=... — exige rota
  //   de rede da Cloud ao RTSP da câmera (cloud-direct ACTIVE).
  useEffect(() => {
    if (!visible || !canPreview) return
    let cancelled = false

    async function ensureTicket(): Promise<string | null> {
      const cur = ticketRef.current
      if (cur && Date.now() < cur.expiresAt) return cur.ticket
      try {
        const t = await getLiveToken(cam.id, 'snapshot')
        ticketRef.current = { ticket: t.ticket, expiresAt: Date.now() + TICKET_TTL_MS }
        return t.ticket
      } catch { return null }
    }

    async function fetchSnap() {
      setSnapLoading(true)
      // Caminho A: snapshot persistido pela Box → R2
      if (hasPersistedSnap) {
        const r = await getCameraSnapshotUrl(cam.id)
        if (cancelled) return
        if (r?.url) {
          // cache-buster pra forçar re-load mesmo se a URL for igual (presigned
          // muda a cada chamada, mas garante).
          setSnapUrl(r.url + (r.url.includes('?') ? '&' : '?') + '_=' + Date.now())
          setSnapErr(false)
          return
        }
      }
      // Caminho B: ffmpeg via ticket
      if (canFfmpegSnap) {
        const ticket = await ensureTicket()
        if (cancelled) return
        if (!ticket) { setSnapLoading(false); setSnapErr(true); return }
        const url = `${BASE_URL}/live/${cam.id}/snapshot-jpeg?ticket=${encodeURIComponent(ticket)}&_=${Date.now()}`
        setSnapUrl(url)
        setSnapErr(false)
        return
      }
      setSnapLoading(false); setSnapErr(true)
    }

    fetchSnap()
    timerRef.current = setInterval(fetchSnap, SNAPSHOT_REFRESH_MS)
    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [visible, canPreview, hasPersistedSnap, canFfmpegSnap, cam.id])

  function open(e?: React.MouseEvent) {
    if (e) e.stopPropagation()
    navigate(`/cameras/${cam.id}`)
  }

  return (
    <div ref={rowRef}
      className="flex items-center gap-3 pl-12 pr-4 py-2 hover:bg-white/[0.03] dark:hover:bg-white/[0.04] cursor-pointer transition"
      onClick={() => open()}
    >
      {/* Miniatura ao vivo (96x60) */}
      <div className="relative w-24 h-16 rounded-md bg-slate-200 dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-300/40 dark:border-white/10">
        {snapUrl && !snapErr ? (
          <img
            src={snapUrl}
            alt={cam.name}
            onLoad={() => setSnapLoading(false)}
            onError={() => { setSnapErr(true); setSnapLoading(false) }}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 dark:text-slate-600">
            <CameraIcon className="w-5 h-5 opacity-40" />
          </div>
        )}
        {snapLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
          </div>
        )}
        {/* Status dot */}
        <span className={cn(
          'absolute top-1 left-1 w-2 h-2 rounded-full ring-2 ring-slate-900/60',
          STATUS_DOT[cam.status] ?? 'bg-slate-500',
        )} title={STATUS_LABEL[cam.status] ?? cam.status} />
        {/* Snapshot indicator */}
        {snapUrl && !snapErr && (
          <span className={cn(
            'absolute bottom-0.5 right-0.5 px-1 py-0.5 rounded text-[8px] font-bold text-white',
            hasPersistedSnap ? 'bg-cyan-500/80' : 'bg-rose-500/80',
          )}>
            {hasPersistedSnap ? '◉ R2' : '● LIVE'} 30s
          </span>
        )}
      </div>

      {/* Info principal */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">{cam.name}</span>
          <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold border', STATUS_BADGE[cam.status] ?? '')}>
            {STATUS_LABEL[cam.status] ?? cam.status}
          </span>
          {cam.tier && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-violet-500/10 text-violet-400 border border-violet-500/20">
              {cam.tier}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
          <span className="font-mono uppercase text-[10px]">{cam.pipeline ?? '—'}</span>
          {cam.resolution && (<><span>·</span><span>{cam.resolution}</span></>)}
          {cam.fps != null && (<><span>·</span><span>{cam.fps} fps</span></>)}
          {cam.location && (<><span>·</span><span className="truncate">{cam.location}</span></>)}
          {cam.id && (
            <>
              <span>·</span>
              <code className="font-mono text-[10px] text-slate-500/70 truncate">#{String(cam.id).slice(0, 8)}</code>
            </>
          )}
        </div>
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
        <ActionBtn icon={PlayCircle} title="Abrir live"
          onClick={() => navigate(`/cameras/${cam.id}?tab=live`)} color="emerald" />
        <ActionBtn icon={RefreshCw} title="Testar conexão"
          onClick={() => onTest?.(cam.id)} color="cyan" loading={testing} />
        <ActionBtn icon={Settings} title="Configurar"
          onClick={() => navigate(`/cameras/${cam.id}`)} color="slate" />
        <ActionBtn icon={Trash2} title="Remover"
          onClick={() => onDelete?.(cam.id, cam.name)} color="rose" />
      </div>
    </div>
  )
}

function ActionBtn({ icon: Icon, title, onClick, color, loading }: {
  icon: any; title: string; onClick: () => void;
  color: 'emerald'|'cyan'|'slate'|'rose'; loading?: boolean
}) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300',
    cyan:    'text-cyan-400 hover:bg-cyan-500/15 hover:text-cyan-300',
    slate:   'text-slate-500 hover:bg-white/10 hover:text-white',
    rose:    'text-rose-400 hover:bg-rose-500/15 hover:text-rose-300',
  }
  return (
    <button onClick={onClick} title={title}
      className={cn('p-1.5 rounded transition', colorMap[color])}>
      <Icon className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
    </button>
  )
}
