/**
 * GuestPlayerPage — Sprint F · Magic Link.
 *
 * Rota: /guest/:token (PÚBLICA — sem layout/sidebar do sistema)
 *
 * Fluxo:
 *  1. Carrega `/guest/:token/info` → mostra cabeçalho + form de PIN se exigido
 *  2. POST `/guest/:token/access` com PIN → recebe JWT efêmero (10min)
 *  3. Baseado no escopo (camera/site/clip) renderiza player apropriado
 *  4. Watermark CSS absoluto sobre o vídeo (nome + timestamp + IP)
 *  5. Heartbeat a cada 30s pra log de auditoria
 *  6. Footer com aviso LGPD
 */
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import Hls from 'hls.js'
import {
  Lock, Shield, Clock, AlertTriangle, Loader2, LogOut, Eye, KeyRound,
} from 'lucide-react'
import {
  fetchGuestInfo, exchangeGuestAccess, fetchGuestLive, fetchGuestRecordingTimeline,
  postGuestLog, formatApiError,
  type GuestInfo, type GuestAccessResponse,
} from '../api/client'
import { BRAND } from '../lib/brand'

type Phase = 'loading' | 'unavailable' | 'pin' | 'ready'

export function GuestPlayerPage() {
  const { token } = useParams<{ token: string }>()
  const [phase, setPhase] = useState<Phase>('loading')
  const [info, setInfo]   = useState<GuestInfo | null>(null)
  const [session, setSession] = useState<GuestAccessResponse | null>(null)
  const [pin, setPin]     = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // ───── Carrega info inicial ─────
  useEffect(() => {
    if (!token) { setPhase('unavailable'); setError('Token não informado'); return }
    fetchGuestInfo(token)
      .then(i => {
        setInfo(i)
        if (i.revoked) { setPhase('unavailable'); setError('Link revogado pelo administrador.') }
        else if (i.expired) { setPhase('unavailable'); setError('Link expirado.') }
        else if (i.requiresPin) setPhase('pin')
        else {
          // Sem PIN → exchange direto
          handleAccess(undefined)
        }
      })
      .catch(err => {
        setPhase('unavailable')
        setError(formatApiError(err))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handleAccess(pinValue?: string) {
    if (!token) return
    setSubmitting(true)
    setError(null)
    try {
      const s = await exchangeGuestAccess(token, pinValue)
      setSession(s)
      setPhase('ready')
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  // ───── Heartbeat a cada 30s ─────
  const startedAtRef = useRef<number>(Date.now())
  useEffect(() => {
    if (phase !== 'ready' || !token || !session) return
    startedAtRef.current = Date.now()
    const iv = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000)
      postGuestLog(token, session.guestToken, { action: 'heartbeat', durationSeconds: elapsed }).catch(() => { /* silent */ })
    }, 30_000)
    const onUnload = () => {
      const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000)
      // Best-effort: usa sendBeacon (síncrono) pra session_end na saída
      try {
        const url = `${(import.meta as ImportMeta).env?.VITE_API_URL ?? '/api'}/guest/${encodeURIComponent(token)}/log`
        const blob = new Blob([JSON.stringify({ action: 'session_end', durationSeconds: elapsed })], { type: 'application/json' })
        navigator.sendBeacon(url, blob)
      } catch { /* ignore */ }
    }
    window.addEventListener('beforeunload', onUnload)
    return () => { clearInterval(iv); window.removeEventListener('beforeunload', onUnload) }
  }, [phase, token, session])

  // ──────────────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return <FullScreen><Loader2 className="w-8 h-8 animate-spin text-cyan-400" /></FullScreen>
  }

  if (phase === 'unavailable') {
    return (
      <FullScreen>
        <div className="text-center max-w-md space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-rose-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Acesso indisponível</h1>
          <p className="text-sm text-slate-400">{error ?? 'O link de acesso não pode ser usado.'}</p>
          {info && (
            <p className="text-xs text-slate-500 mt-2">Convidado por <strong>{info.createdBy}</strong></p>
          )}
        </div>
      </FullScreen>
    )
  }

  if (phase === 'pin' && info) {
    return (
      <FullScreen>
        <div className="w-full max-w-md mx-auto space-y-5">
          <HeaderMini info={info} />
          <div className="bg-slate-900 border border-cyan-500/30 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center mx-auto mb-3">
                <KeyRound className="w-7 h-7 text-cyan-400" />
              </div>
              <h2 className="text-lg font-bold text-white">Digite o PIN</h2>
              <p className="text-xs text-slate-400 mt-1">O PIN foi enviado por canal separado (SMS, ligação).</p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              maxLength={8}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={e => e.key === 'Enter' && pin.length >= 4 && handleAccess(pin)}
              placeholder="••••"
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-white/10 text-3xl text-white text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            />
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5 text-xs text-rose-300 flex gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}
            <button onClick={() => handleAccess(pin)} disabled={submitting || pin.length < 4}
              className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Continuar
            </button>
          </div>
          <LgpdFooter />
        </div>
      </FullScreen>
    )
  }

  if (phase === 'ready' && session && info) {
    return <GuestSession token={token!} session={session} info={info} />
  }

  return null
}

// ──────────────────────────────────────────────────────────────────────────────
// GuestSession — wrapper com header + player + watermark + footer
// ──────────────────────────────────────────────────────────────────────────────
function GuestSession({ token, session, info }: { token: string; session: GuestAccessResponse; info: GuestInfo }) {
  const expiresAt = new Date(session.link.validUntil)

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-white">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-slate-900/80 backdrop-blur">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center flex-shrink-0">
            <Shield className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{info.guestName}</div>
            <div className="text-[11px] text-slate-400 truncate">
              {info.scope.label} · {info.purpose} · convidado por {info.createdBy}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right hidden md:block">
            <div className="text-[10px] text-slate-500 uppercase">Expira</div>
            <div className="text-xs text-slate-300 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {expiresAt.toLocaleString('pt-BR')}
            </div>
          </div>
          <button onClick={() => { window.close(); window.location.href = '/' }}
            className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1.5">
            <LogOut className="w-3.5 h-3.5" /> Encerrar
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-auto">
        {session.link.scope.kind === 'camera' && (
          <CameraPlayer token={token} session={session} mode="live" />
        )}
        {session.link.scope.kind === 'clip' && (
          <CameraPlayer token={token} session={session} mode="clip" />
        )}
        {session.link.scope.kind === 'site' && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 text-center text-amber-200 text-sm">
            <Eye className="w-6 h-6 inline mr-2" />
            Mosaico de site ainda não implementado nesta versão. Use links por câmera específica.
          </div>
        )}
      </main>

      <footer className="px-4 py-3 border-t border-white/10 text-center text-[11px] text-slate-500 bg-slate-900/80">
        <Shield className="w-3 h-3 inline mr-1" />
        Acesso auditado por <strong className="text-slate-400">{BRAND.name}</strong>.
        Todas as ações são registradas para fins de compliance LGPD.
      </footer>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// CameraPlayer — abre HLS via /guest/:token/stream/live OU /recording/timeline
// ──────────────────────────────────────────────────────────────────────────────
function CameraPlayer({ token, session, mode }: {
  token: string
  session: GuestAccessResponse
  mode: 'live' | 'clip'
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef   = useRef<Hls | null>(null)
  const [manifestUrl, setManifest] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'live' | 'recording'>(
    mode === 'live' && session.link.capabilities.live ? 'live' : 'recording',
  )

  useEffect(() => {
    let cancelled = false
    setError(null)
    setManifest(null)

    const load = async () => {
      try {
        if (activeTab === 'live' && session.link.capabilities.live) {
          const r = await fetchGuestLive(token, session.guestToken)
          if (!cancelled) setManifest(absoluteUrl(r.manifestUrl))
          postGuestLog(token, session.guestToken, { action: 'viewed_live' }).catch(() => {})
        } else if (session.link.capabilities.recording) {
          const r = await fetchGuestRecordingTimeline(token, session.guestToken)
          if (!cancelled) setManifest(absoluteUrl(r.manifestUrl))
          postGuestLog(token, session.guestToken, { action: 'viewed_recording' }).catch(() => {})
        } else {
          setError('Nenhuma permissão de visualização configurada neste link.')
        }
      } catch (err) {
        setError(formatApiError(err))
      }
    }
    void load()
    return () => { cancelled = true }
  }, [token, session, activeTab])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !manifestUrl) return
    if (hlsRef.current) { try { hlsRef.current.destroy() } catch { /* noop */ } hlsRef.current = null }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true })
      hlsRef.current = hls
      hls.loadSource(manifestUrl)
      hls.attachMedia(v)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        v.play().catch(() => { /* user gesture required */ })
      })
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError(data.details ?? 'Falha no player')
      })
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = manifestUrl
      v.play().catch(() => { /* gesture */ })
    }

    return () => {
      if (hlsRef.current) { try { hlsRef.current.destroy() } catch { /* noop */ } hlsRef.current = null }
    }
  }, [manifestUrl])

  return (
    <div className="max-w-5xl mx-auto space-y-3">
      {/* Tabs Live/Recording (se ambos disponíveis) */}
      {session.link.capabilities.live && session.link.capabilities.recording && (
        <div className="flex gap-2">
          {(['live', 'recording'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                activeTab === t ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
              }`}>
              {t === 'live' ? 'Ao vivo' : 'Gravação'}
            </button>
          ))}
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden bg-black border border-white/10 aspect-video">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-amber-300 text-sm p-6 text-center">
            <div>
              <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
              {error}
            </div>
          </div>
        ) : (
          <>
            <video ref={videoRef} controls playsInline className="w-full h-full bg-black" />
            <Watermark text={session.link.watermarkText} />
          </>
        )}
      </div>

      <div className="text-xs text-slate-500 px-1 flex flex-wrap justify-between gap-2">
        <span>Convidado: {session.link.guestName}</span>
        <span>Sessão expira em {Math.round(((session.link.validUntil ? new Date(session.link.validUntil).getTime() : Date.now()) - Date.now()) / 60_000)} min</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Watermark — sobreposto via CSS (text com opacidade 0.3)
// V1: overlay only. Burn-in via FFmpeg fica para versão futura.
// ──────────────────────────────────────────────────────────────────────────────
function Watermark({ text }: { text: string }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 5_000)
    return () => clearInterval(iv)
  }, [])

  const stamp = now.toLocaleString('pt-BR')
  return (
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none select-none">
      <div className="absolute top-3 right-3 text-white/40 text-xs font-mono drop-shadow-lg">
        {text} · {stamp}
      </div>
      <div className="absolute bottom-3 left-3 text-white/30 text-[10px] font-mono">
        {text}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-componentes auxiliares
// ──────────────────────────────────────────────────────────────────────────────
function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 py-10 text-white">
      {children}
    </div>
  )
}

function HeaderMini({ info }: { info: GuestInfo }) {
  return (
    <div className="text-center space-y-1">
      <div className="text-xs text-slate-500 uppercase font-semibold">{info.tenant.name}</div>
      <h1 className="text-lg font-bold">Acesso Convidado</h1>
      <p className="text-xs text-slate-400">
        Você foi convidado por <strong className="text-cyan-300">{info.createdBy}</strong> para visualizar:
      </p>
      <p className="text-sm text-white">{info.scope.label}</p>
      <p className="text-xs text-slate-500 mt-1">
        Validade: até {new Date(info.validUntil).toLocaleString('pt-BR')}
      </p>
      <p className="text-xs text-amber-300/80 mt-1">Motivo: {info.purpose}</p>
    </div>
  )
}

function LgpdFooter() {
  return (
    <div className="text-center text-[11px] text-slate-500 px-3">
      <AlertTriangle className="w-3 h-3 inline mr-1" />
      Este acesso é monitorado. Todas as suas ações ficam registradas para fins de compliance LGPD. Powered by {BRAND.name}.
    </div>
  )
}

function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  const base = (import.meta as ImportMeta).env?.VITE_API_URL ?? '/api'
  return `${String(base).replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}`
}
