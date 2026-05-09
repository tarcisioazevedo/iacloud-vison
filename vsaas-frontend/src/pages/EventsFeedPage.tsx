import { useState, useEffect, useCallback } from 'react'
import { Activity, Camera, Users, Car, RefreshCw, Zap, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api } from '../api/client'
import { cn } from '../lib/utils'

interface FeedEvent {
  id:           string
  eventType:    string
  severity:     string
  model:        string
  capturedAt:   string
  personCount:  number | null
  vehicleCount: number | null
  labels:       string[]
  description:  string | null
  camera:       { id: string; name: string; site: string | null; cliente: string | null } | null
}

const EVENT_ICONS: Record<string, string> = {
  PERSON_DETECTED:  '🧑',
  VEHICLE_DETECTED: '🚗',
  SCENE_ANALYZED:   '🎥',
  TRIGGER_FIRE:     '🔔',
}

const SEVERITY_COLORS: Record<string, string> = {
  ALERT:     'border-l-rose-500 bg-rose-500/5',
  DETECTION: 'border-l-amber-500 bg-amber-500/5',
  INFO:      'border-l-sky-500  bg-sky-500/5',
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60)  return `${secs}s atrás`
  if (secs < 3600) return `${Math.floor(secs / 60)}min atrás`
  return `${Math.floor(secs / 3600)}h atrás`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function EventsFeedPage() {
  const [events, setEvents]       = useState<FeedEvent[]>([])
  const [loading, setLoading]     = useState(true)
  const [lastRefresh, setRefresh] = useState(new Date())
  const [autoRefresh, setAuto]    = useState(true)
  const [newCount, setNewCount]   = useState(0)
  const [lastSince, setLastSince] = useState<string | null>(null)

  const load = useCallback(async (since?: Date) => {
    try {
      const params: any = { limit: 100 }
      if (since) params.since = since.toISOString()
      const resp = await api.get('/events/feed', { params })
      const incoming: FeedEvent[] = resp.data.events ?? []
      if (since && incoming.length > 0) {
        setEvents(prev => {
          const existingIds = new Set(prev.map(e => e.id))
          const fresh = incoming.filter(e => !existingIds.has(e.id))
          setNewCount(n => n + fresh.length)
          return [...fresh, ...prev].slice(0, 200)
        })
      } else {
        setEvents(incoming)
        setNewCount(0)
      }
      setRefresh(new Date())
      if (incoming.length > 0) setLastSince(incoming[0].capturedAt)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  // Carga inicial
  useEffect(() => { load() }, [load])

  // Polling a cada 10s
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => {
      load(lastSince ? new Date(lastSince) : undefined)
    }, 10_000)
    return () => clearInterval(id)
  }, [autoRefresh, lastSince, load])

  const personTotal  = events.filter(e => e.eventType === 'PERSON_DETECTED').length
  const vehicleTotal = events.filter(e => e.eventType === 'VEHICLE_DETECTED').length
  const alertTotal   = events.filter(e => e.severity === 'ALERT').length

  return (
    <div className="space-y-4">
      {/* Header */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-indigo-500/5 to-transparent border-violet-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shadow-lg">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Feed de Eventos IA</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Detecções em tempo real — Cloud Vision + Gemini Flash
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {newCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-rose-500 text-white text-xs font-bold animate-pulse">
                +{newCount} novos
              </span>
            )}
            <button
              onClick={() => setAuto(v => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                autoRefresh
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-500/20 text-slate-600 dark:text-slate-400',
              )}
            >
              <Zap className="w-3.5 h-3.5" />
              {autoRefresh ? 'Ao vivo' : 'Pausado'}
            </button>
            <button
              onClick={() => load()}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </GlassCard>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <GlassCard className="p-4 text-center">
          <Users className="w-6 h-6 mx-auto mb-1 text-indigo-500" />
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{personTotal}</p>
          <p className="text-xs text-slate-500">Pessoas detectadas</p>
        </GlassCard>
        <GlassCard className="p-4 text-center">
          <Car className="w-6 h-6 mx-auto mb-1 text-amber-500" />
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{vehicleTotal}</p>
          <p className="text-xs text-slate-500">Veículos detectados</p>
        </GlassCard>
        <GlassCard className="p-4 text-center">
          <AlertTriangle className="w-6 h-6 mx-auto mb-1 text-rose-500" />
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{alertTotal}</p>
          <p className="text-xs text-slate-500">Alertas disparados</p>
        </GlassCard>
      </div>

      {/* Feed */}
      <GlassCard className="overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <Eye className="w-4 h-4" />
            {events.length} eventos nas últimas 24h
          </div>
          <span className="text-xs text-slate-400">
            Atualizado {lastRefresh.toLocaleTimeString('pt-BR')}
          </span>
        </div>

        {loading && (
          <div className="p-12 text-center">
            <RefreshCw className="w-8 h-8 mx-auto text-slate-300 animate-spin mb-3" />
            <p className="text-sm text-slate-400">Carregando eventos...</p>
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className="p-12 text-center">
            <Camera className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <p className="text-sm text-slate-500 font-medium">Nenhum evento ainda</p>
            <p className="text-xs text-slate-400 mt-1">
              Câmeras CLOUD_DIRECT são analisadas a cada 10 minutos pelo Gemini Flash
            </p>
          </div>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {events.map(event => (
            <div
              key={event.id}
              className={cn(
                'flex gap-3 p-4 border-l-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors',
                SEVERITY_COLORS[event.severity] ?? SEVERITY_COLORS.INFO,
              )}
            >
              {/* Icon */}
              <div className="text-2xl flex-shrink-0 leading-none pt-0.5">
                {EVENT_ICONS[event.eventType] ?? '🔍'}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {event.camera?.name ?? 'Câmera desconhecida'}
                      {event.camera?.site && (
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          · {event.camera.site}
                        </span>
                      )}
                    </p>
                    {event.description && (
                      <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                        {event.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-slate-400">{formatTime(event.capturedAt)}</p>
                    <p className="text-xs text-slate-300">{timeAgo(event.capturedAt)}</p>
                  </div>
                </div>

                {/* Labels */}
                {event.labels && event.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(event.labels as string[]).slice(0, 6).map((label: string) => (
                      <span
                        key={label}
                        className="px-1.5 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}

                {/* Counts */}
                <div className="flex gap-3 mt-1.5">
                  {(event.personCount ?? 0) > 0 && (
                    <span className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-0.5">
                      <Users className="w-3 h-3" /> {event.personCount} pessoa{(event.personCount ?? 0) > 1 ? 's' : ''}
                    </span>
                  )}
                  {(event.vehicleCount ?? 0) > 0 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                      <Car className="w-3 h-3" /> {event.vehicleCount} veículo{(event.vehicleCount ?? 0) > 1 ? 's' : ''}
                    </span>
                  )}
                  {event.severity === 'ALERT' && (
                    <span className="text-xs text-rose-500 flex items-center gap-0.5">
                      <AlertTriangle className="w-3 h-3" /> Alerta
                    </span>
                  )}
                  {event.severity === 'DETECTION' && (
                    <span className="text-xs text-emerald-500 flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> Detecção
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  )
}
