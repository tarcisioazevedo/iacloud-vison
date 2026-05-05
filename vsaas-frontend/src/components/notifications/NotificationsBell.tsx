/**
 * NotificationsBell — sino do TopBar com dropdown de histórico de alertas.
 * Consome useAlertHistory do AlertToastProvider (notificações persistidas em localStorage).
 */
import { useState, useRef, useEffect } from 'react'
import { Bell, X, Trash2, CheckCheck, AlertOctagon, AlertTriangle, Info, Camera } from 'lucide-react'
import { useAlertHistory } from './AlertToastProvider'
import { cn } from '../../lib/utils'

const SEVERITY_CONFIG = {
  CRITICAL: { color: 'rose',   icon: AlertOctagon,  label: 'Crítico' },
  WARNING:  { color: 'amber',  icon: AlertTriangle, label: 'Atenção' },
  INFO:     { color: 'cyan',   icon: Info,          label: 'Info' },
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return `${diff}s atrás`
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`
  return `${Math.floor(diff / 86400)}d atrás`
}

export function NotificationsBell() {
  const { history, unreadCount, markAllRead, markRead, clearHistory } = useAlertHistory()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Click fora fecha
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  function handleOpen() {
    setOpen(o => !o)
    // Marca como lidas após 1s (deixa usuário ver os bullets vermelhos antes)
    if (!open && unreadCount > 0) setTimeout(() => markAllRead(), 1500)
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={handleOpen}
        className={cn(
          'relative p-2 rounded-xl border transition-colors',
          'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700',
          'dark:bg-white/5 dark:border-white/8 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white',
        )}
        title={unreadCount > 0 ? `${unreadCount} alertas não lidos` : 'Histórico de alertas'}>
        <Bell className="w-3.5 h-3.5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-[9px] text-white font-bold flex items-center justify-center animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-xl border bg-white dark:bg-space-900 border-slate-200 dark:border-white/10 shadow-2xl z-[100] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-white/10 bg-gradient-to-r from-violet-500/5 to-cyan-500/5">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-violet-500 dark:text-violet-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Notificações</h3>
              <span className="text-[10px] text-slate-500">{history.length}/100</span>
            </div>
            <div className="flex items-center gap-1">
              {history.length > 0 && (
                <>
                  <button onClick={markAllRead} title="Marcar todas como lidas"
                    className="p-1.5 rounded text-slate-500 hover:text-emerald-500 hover:bg-emerald-500/10">
                    <CheckCheck className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { if (confirm('Limpar histórico?')) clearHistory() }}
                    title="Limpar histórico"
                    className="p-1.5 rounded text-slate-500 hover:text-rose-500 hover:bg-rose-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button onClick={() => setOpen(false)} className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Lista */}
          <div className="max-h-[480px] overflow-y-auto">
            {history.length === 0 ? (
              <div className="py-12 text-center">
                <Bell className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-700 mb-2" />
                <p className="text-sm text-slate-500">Nenhuma notificação</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1">
                  Alertas em tempo real aparecem aqui
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {history.map(h => {
                  const cfg = SEVERITY_CONFIG[h.severity] ?? SEVERITY_CONFIG.INFO
                  const Icon = cfg.icon
                  const colorMap: Record<string, string> = {
                    rose:  'text-rose-500 bg-rose-500/10',
                    amber: 'text-amber-500 bg-amber-500/10',
                    cyan:  'text-cyan-500 bg-cyan-500/10',
                  }
                  return (
                    <div key={h.id}
                      onClick={() => markRead(h.id)}
                      className={cn(
                        'p-3 hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer',
                        !h.read && 'bg-violet-500/5',
                      )}>
                      <div className="flex items-start gap-2">
                        <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', colorMap[cfg.color])}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className={cn('text-[9px] uppercase font-bold', `text-${cfg.color}-500 dark:text-${cfg.color}-400`)}>
                              {cfg.label}
                            </span>
                            {!h.read && <span className="w-1.5 h-1.5 rounded-full bg-violet-500 ml-auto" />}
                          </div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white leading-tight">{h.title}</p>
                          <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">{h.body}</p>
                          {h.cameraName && (
                            <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                              <Camera className="w-2.5 h-2.5" /> {h.cameraName}
                            </p>
                          )}
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-[9px] text-slate-500 font-mono">{timeAgo(h.ts)}</span>
                            {h.cameraId && (
                              <button onClick={(e) => {
                                e.stopPropagation()
                                const params = new URLSearchParams({
                                  cameraId: h.cameraId!,
                                  at: new Date(h.ts).toISOString(),
                                })
                                window.open(`/recordings?${params.toString()}`, '_blank')
                                markRead(h.id)
                              }}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 hover:bg-violet-500/25 text-violet-500 dark:text-violet-300 font-bold">
                                ▶ Reproduzir
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {history.length > 0 && (
            <div className="p-2 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]">
              <p className="text-[10px] text-slate-500 text-center">
                Histórico local · até 100 alertas · persiste entre sessões
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
