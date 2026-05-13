/**
 * IngestLogPage — auditoria do pipeline RTMP push (camera→cloud).
 *
 * Restrita a SUPER_ADMIN — o endpoint público de ingest
 * (`rtmp://ingest.iacloud.com.br/live/<key>`) recebe TCP de qualquer câmera
 * sem segregação por tenant (não dá pra filtrar por integrador no socket).
 * Por isso o log é visão de infra, e só admin global enxerga.
 *
 * Casos de uso:
 *   - Investigar "por que minha câmera não conecta" (procurar IP de origem
 *     em AUTH_FAIL/UNKNOWN_PATH)
 *   - Detectar tentativa de força bruta de stream key (top failers IP)
 *   - Auditar bytes recebidos por câmera ao longo do dia
 *   - Confirmar que câmera nova começou a empurrar (PUBLISH_START + AUTH_OK)
 */
import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, AlertCircle, AlertTriangle, CheckCircle2, Clock, RefreshCw,
  Search, ShieldAlert, Wifi, WifiOff, Filter, X,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useIngestLog, useIngestLogStats, type IngestEvent } from '../api/client'
import { cn } from '../lib/utils'

const EVENT_META: Record<IngestEvent, { label: string; color: string; icon: any }> = {
  PUBLISH_START: { label: 'Publish iniciado', color: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30', icon: Wifi },
  PUBLISH_END:   { label: 'Publish encerrado', color: 'text-slate-600 dark:text-slate-300 bg-slate-500/10 border-slate-500/30', icon: WifiOff },
  AUTH_OK:       { label: 'Auth OK',           color: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', icon: CheckCircle2 },
  AUTH_FAIL:     { label: 'Auth falhou',       color: 'text-rose-300 bg-rose-500/10 border-rose-500/30', icon: ShieldAlert },
  UNKNOWN_PATH:  { label: 'Path desconhecido', color: 'text-amber-300 bg-amber-500/10 border-amber-500/30', icon: AlertTriangle },
  ERROR:         { label: 'Erro',              color: 'text-rose-400 bg-rose-500/20 border-rose-500/40', icon: AlertCircle },
}

function formatBytes(s: string | null): string {
  if (s == null) return '—'
  const n = Number(s)
  if (n === 0 || isNaN(n)) return '0 B'
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
  if (n > 1_000) return `${(n / 1_000).toFixed(0)} kB`
  return `${n} B`
}

export function IngestLogPage() {
  const [filterEvent, setFilterEvent] = useState<IngestEvent | ''>('')
  const [filterIp, setFilterIp]       = useState('')
  const [filterCamera, setFilterCamera] = useState('')
  const [hours, setHours]             = useState(24)

  const since = useMemo(() => new Date(Date.now() - hours * 3600 * 1000).toISOString(), [hours])

  const { data, isLoading, mutate } = useIngestLog({
    event:       filterEvent || undefined,
    remoteAddr:  filterIp || undefined,
    cameraId:    filterCamera || undefined,
    since,
    limit:       200,
  })
  const { data: stats } = useIngestLogStats()

  const items = data?.items ?? []
  const hasFilter = !!(filterEvent || filterIp || filterCamera)

  function clearFilters() {
    setFilterEvent('')
    setFilterIp('')
    setFilterCamera('')
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            Ingest Log — RTMP Push
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Auditoria de tentativas de conexão no endpoint público
            <code className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-cyan-700 dark:text-cyan-300 text-[10px]">
              rtmp://ingest.iacloud.com.br/live/&lt;key&gt;
            </code>
            {' '}— restrito a SUPER_ADMIN.
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-700 dark:text-cyan-200 text-xs font-semibold flex items-center gap-1"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      {/* KPI cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {(Object.keys(EVENT_META) as IngestEvent[]).map(ev => {
            const m = EVENT_META[ev]
            const Icon = m.icon
            return (
              <GlassCard
                key={ev}
                className={cn(
                  'p-3 cursor-pointer hover:border-cyan-500/30 transition',
                  filterEvent === ev && 'border-cyan-500/60',
                )}
                onClick={() => setFilterEvent(filterEvent === ev ? '' : ev)}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={cn('w-3 h-3', m.color.split(' ')[0])} />
                  <p className="text-[9px] uppercase text-slate-500 truncate">{m.label}</p>
                </div>
                <p className={cn('text-lg font-bold', m.color.split(' ')[0])}>
                  {stats.stats[ev] ?? 0}
                </p>
              </GlassCard>
            )
          })}
        </div>
      )}

      {/* Top failers — alerta se há tentativas suspeitas */}
      {stats?.topFailers && stats.topFailers.length > 0 && (
        <GlassCard className="p-3 border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-bold text-rose-600 dark:text-rose-300">
                Tentativas com key inválida (24h) — possível scan / brute force
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {stats.topFailers.map(f => (
                  <button
                    key={f.remoteAddr}
                    onClick={() => setFilterIp(f.remoteAddr)}
                    className="px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-[10px] font-mono text-rose-700 dark:text-rose-200"
                    title={`Filtrar por ${f.remoteAddr}`}
                  >
                    {f.remoteAddr || '—'} <span className="text-rose-400 ml-1">×{f.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Filtros */}
      <GlassCard className="p-3">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span className="text-slate-500 dark:text-slate-400 font-semibold">Filtros:</span>

          <select
            value={filterEvent}
            onChange={e => setFilterEvent(e.target.value as IngestEvent | '')}
            className="px-2 py-1 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-[11px]"
          >
            <option value="">Todos eventos</option>
            {(Object.keys(EVENT_META) as IngestEvent[]).map(ev => (
              <option key={ev} value={ev}>{EVENT_META[ev].label}</option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <Search className="w-3 h-3 text-slate-500" />
            <input
              type="text"
              placeholder="IP origem (192.168...)"
              value={filterIp}
              onChange={e => setFilterIp(e.target.value)}
              className="px-2 py-1 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-[11px] w-44 font-mono"
            />
          </div>

          <div className="flex items-center gap-1">
            <Search className="w-3 h-3 text-slate-500" />
            <input
              type="text"
              placeholder="Camera ID (uuid)"
              value={filterCamera}
              onChange={e => setFilterCamera(e.target.value)}
              className="px-2 py-1 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-[11px] w-44 font-mono"
            />
          </div>

          <select
            value={hours}
            onChange={e => setHours(+e.target.value)}
            className="px-2 py-1 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-[11px]"
          >
            <option value={1}>Última hora</option>
            <option value={6}>Últimas 6h</option>
            <option value={24}>Últimas 24h</option>
            <option value={168}>Últimos 7d</option>
          </select>

          {hasFilter && (
            <button
              onClick={clearFilters}
              className="ml-auto px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-700 dark:text-rose-200 text-[10px] font-semibold flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Limpar
            </button>
          )}
        </div>
      </GlassCard>

      {/* Tabela de eventos */}
      <GlassCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-3 py-2 font-semibold w-[140px]"><Clock className="w-3 h-3 inline mr-1" />Quando</th>
                <th className="text-left px-3 py-2 font-semibold w-[150px]">Evento</th>
                <th className="text-left px-3 py-2 font-semibold">Stream Path</th>
                <th className="text-left px-3 py-2 font-semibold w-[140px]">Origem</th>
                <th className="text-left px-3 py-2 font-semibold w-[180px]">Câmera</th>
                <th className="text-right px-3 py-2 font-semibold w-[80px]">Bytes</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-500 text-xs">
                    Nenhum evento no período. Câmera ainda não tentou empurrar?
                  </td>
                </tr>
              )}
              {items.map(it => {
                const m = EVENT_META[it.event]
                const Icon = m.icon
                return (
                  <motion.tr
                    key={it.id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="border-b border-slate-100 dark:border-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                      {new Date(it.ts).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold', m.color)}>
                        <Icon className="w-2.5 h-2.5" />
                        {m.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-cyan-700 dark:text-cyan-200 font-mono text-[11px]">{it.streamPath}</code>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                      {it.remoteAddr ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      {it.camera ? (
                        <a
                          href={`/cameras/${it.camera.id}`}
                          className="text-cyan-600 dark:text-cyan-300 hover:text-cyan-700 dark:hover:text-cyan-200 hover:underline truncate"
                        >
                          {it.camera.name}
                        </a>
                      ) : (
                        <span className="text-slate-500 italic">desconhecida</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {formatBytes(it.bytesIn)}
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {data && (
        <p className="text-[10px] text-slate-500 text-center">
          Mostrando {items.length} de {data.total} eventos · desde{' '}
          {new Date(data.sinceUtc).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  )
}
