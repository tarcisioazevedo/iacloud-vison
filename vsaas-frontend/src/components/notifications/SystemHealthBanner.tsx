/**
 * SystemHealthBanner — banner global no topo da app que aparece quando
 * algo está degradado na infra:
 *   - tmpfs ≥85% → gravação PAUSADA (banner vermelho)
 *   - tmpfs ≥70% → gravação em risco (banner amarelo)
 *   - R2 inacessível ou latência >5s → playback degradado (banner amarelo)
 *
 * Onda 1 / P0 #3 + P2 #20.
 *
 * Estratégia:
 *   - Polling /health a cada 30s (cache 5s no backend, custo desprezível)
 *   - Escuta SSE 'tmpfs_state' para reação imediata (sem aguardar polling)
 *   - Banner com dismiss manual (sessionStorage — volta no próximo refresh)
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, X, HardDrive, Cloud } from 'lucide-react'
import { getSystemHealth, type SystemHealth } from '../../api/client'
import { useAlertHistory } from './AlertToastProvider'
import { cn } from '../../lib/utils'

const POLL_MS = 30_000

export function SystemHealthBanner() {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem('icv_health_dismissed')
      return new Set(raw ? JSON.parse(raw) : [])
    } catch { return new Set() }
  })
  const { history: alerts } = useAlertHistory()

  // Polling do /health
  useEffect(() => {
    let cancelled = false
    async function fetch() {
      try {
        const h = await getSystemHealth()
        if (!cancelled) setHealth(h)
      } catch { /* ignore */ }
    }
    fetch()
    const id = setInterval(fetch, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Recebe SSE 'tmpfs_state' via alert history e força refresh do /health
  // pra capturar mudança imediata (sem aguardar polling de 30s).
  useEffect(() => {
    const latest = alerts[0]
    if (latest && (latest as any).meta?.tmpfsState) {
      // Refresh imediato — não confia só no SSE pra evitar drift de cache
      getSystemHealth().then(setHealth).catch(() => {})
    }
  }, [alerts])

  function dismiss(key: string) {
    const next = new Set(dismissed)
    next.add(key)
    setDismissed(next)
    sessionStorage.setItem('icv_health_dismissed', JSON.stringify(Array.from(next)))
  }

  if (!health) return null

  const banners: Array<{ key: string; severity: 'critical' | 'warning'; icon: any; title: string; body: string }> = []

  // Tmpfs PAUSED (crítico)
  if (health.tmpfs?.paused) {
    banners.push({
      key: 'tmpfs-paused',
      severity: 'critical',
      icon: HardDrive,
      title: 'Gravação pausada — disco temporário cheio',
      body: `Tmpfs em ${health.tmpfs.pct?.toFixed(1) ?? '—'}%. Novos segmentos não estão sendo gerados até o disco descer abaixo de 60%. Verifique se o R2 está online (uploads em fila ocupam o disco) ou aguarde retentativas.`,
    })
  } else if (health.tmpfs?.pct && health.tmpfs.pct >= 70) {
    // Tmpfs WARN (amarelo)
    banners.push({
      key: 'tmpfs-warn',
      severity: 'warning',
      icon: HardDrive,
      title: 'Disco de gravação quase cheio',
      body: `Tmpfs em ${health.tmpfs.pct.toFixed(1)}%. Se atingir 85% a gravação será pausada automaticamente.`,
    })
  }

  // R2 offline ou lento
  if (health.r2 && !health.r2.ok) {
    banners.push({
      key: 'r2-offline',
      severity: 'warning',
      icon: Cloud,
      title: 'Storage R2 inacessível',
      body: 'Gravações em andamento estão sendo salvas localmente. Playback de gravações antigas pode falhar até a conexão ser restaurada.',
    })
  } else if (health.r2?.latencyMs && health.r2.latencyMs > 5000) {
    banners.push({
      key: 'r2-slow',
      severity: 'warning',
      icon: Cloud,
      title: 'Storage R2 com alta latência',
      body: `Latência atual: ${health.r2.latencyMs}ms. Playback e upload podem estar lentos.`,
    })
  }

  const visible = banners.filter(b => !dismissed.has(b.key))
  if (visible.length === 0) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] pointer-events-none">
      <div className="flex flex-col gap-1 p-2 pointer-events-auto">
        {visible.map(b => {
          const Icon = b.icon
          return (
            <div
              key={b.key}
              className={cn(
                'flex items-start gap-3 px-4 py-2.5 rounded-md shadow-lg backdrop-blur-md',
                b.severity === 'critical'
                  ? 'bg-rose-500/95 text-white border border-rose-700/40'
                  : 'bg-amber-500/95 text-white border border-amber-700/40',
              )}
            >
              <Icon className="w-5 h-5 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">
                  {b.severity === 'critical' && <AlertTriangle className="w-4 h-4 inline mr-1" />}
                  {b.title}
                </p>
                <p className="text-xs opacity-95 mt-0.5">{b.body}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(b.key)}
                className="p-1 rounded hover:bg-white/20 transition shrink-0"
                title="Dispensar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
