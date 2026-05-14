/**
 * WhatsAppLogsPanel
 * Extrato sofisticado de mensagens enviadas via Evolution API.
 * Filtros: status, origem, destinatário, texto, período.
 * Usado tanto no SettingsPage (CLIENTE_ADMIN) quanto no WhatsAppModal.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Search, RefreshCw, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, Clock, MessageCircle,
  Filter, Calendar, Phone, Loader2, AlertTriangle,
  Inbox,
} from 'lucide-react'
import { api, formatApiError } from '../../api/client'
import { cn } from '../../lib/utils'

interface LogEntry {
  id:             string
  toPhone:        string
  message:        string
  status:         string  // sent | failed | delivered
  origin:         string  // manual | alert | bulk
  errorMessage:   string | null
  evolutionMsgId: string | null
  sentAt:         string
  instanceName:   string
}

interface Pagination {
  total: number
  page:  number
  limit: number
  pages: number
}

interface Filters {
  q:      string
  status: string
  origin: string
  phone:  string
  from:   string
  to:     string
}

interface Props {
  qs:        string   // '' ou '?clienteFinalId=...'
  /** Base URL do canal. Default '/notifications/whatsapp'; super-admin usa '/admin/notifications/whatsapp'. */
  basePath?: string
  autoLoad?: boolean
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  sent:      { label: 'Enviado',   color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20',     icon: <CheckCircle2 className="w-3 h-3" /> },
  delivered: { label: 'Entregue', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20', icon: <CheckCircle2 className="w-3 h-3" /> },
  failed:    { label: 'Falhou',   color: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20',       icon: <XCircle className="w-3 h-3" /> },
}

const ORIGIN_LABELS: Record<string, string> = {
  manual: 'Teste manual',
  alert:  'Alerta automático',
  bulk:   'Envio em massa',
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? STATUS_LABELS['sent']
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border', s.color)}>
      {s.icon} {s.label}
    </span>
  )
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55')) {
    return `+55 (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`
  }
  if (d.length === 12 && d.startsWith('55')) {
    return `+55 (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`
  }
  return `+${d}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export function WhatsAppLogsPanel({ qs, basePath = '/notifications/whatsapp', autoLoad = true }: Props) {
  const [logs,       setLogs]       = useState<LogEntry[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [filters, setFilters] = useState<Filters>({
    q: '', status: '', origin: '', phone: '', from: '', to: '',
  })
  const [page, setPage] = useState(1)

  function setF<K extends keyof Filters>(k: K, v: string) {
    setFilters(f => ({ ...f, [k]: v }))
    setPage(1)
  }

  const load = useCallback(async (pg = page) => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.q)      params.set('q',      filters.q)
      if (filters.status) params.set('status', filters.status)
      if (filters.origin) params.set('origin', filters.origin)
      if (filters.phone)  params.set('phone',  filters.phone)
      if (filters.from)   params.set('from',   new Date(filters.from).toISOString())
      if (filters.to)     params.set('to',     new Date(filters.to + 'T23:59:59').toISOString())
      params.set('page',  String(pg))
      params.set('limit', '20')

      // Mescla qs (que pode ser '' ou '?clienteFinalId=...')
      const sep = qs ? '&' : '?'
      const url = `${basePath}/logs${qs}${sep}${params.toString()}`

      const { data } = await api.get(url)
      setLogs(data.logs ?? [])
      setPagination(data.pagination ?? null)
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setLoading(false)
    }
  }, [filters, page, qs])

  useEffect(() => {
    if (autoLoad) load(page)
  }, [page])  // eslint-disable-line

  function applyFilters() {
    setPage(1)
    load(1)
  }

  function clearFilters() {
    setFilters({ q: '', status: '', origin: '', phone: '', from: '', to: '' })
    setPage(1)
    setTimeout(() => load(1), 0)
  }

  const hasActiveFilters = Object.values(filters).some(v => v !== '')

  const inputCls =
    'w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 ' +
    'dark:bg-space-800/40 dark:border-white/10 dark:text-white dark:placeholder:text-slate-600 rounded-lg text-xs ' +
    'focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition'

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1">
          <MessageCircle className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          <p className="text-[11px] font-semibold text-slate-900 dark:text-white">Extrato de mensagens</p>
          {pagination && (
            <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full">
              {pagination.total} {pagination.total === 1 ? 'registro' : 'registros'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setFiltersOpen(v => !v)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition',
              filtersOpen || hasActiveFilters
                ? 'bg-cyan-100 border-cyan-200 text-cyan-700 dark:bg-cyan-500/20 dark:border-cyan-500/40 dark:text-cyan-300'
                : 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-white/[0.03] dark:border-white/8 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5',
            )}
          >
            <Filter className="w-3 h-3" />
            Filtros
            {hasActiveFilters && (
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 ml-0.5" />
            )}
          </button>
          <button
            onClick={() => load(page)}
            disabled={loading}
            title="Atualizar"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-white/8 text-slate-500 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition disabled:opacity-40"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Filtros expansíveis */}
      {filtersOpen && (
        <div className="p-3 rounded-xl border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-white/[0.02] space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">

            {/* Busca no texto */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                value={filters.q}
                onChange={e => setF('q', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyFilters()}
                placeholder="Buscar no texto da mensagem…"
                className={inputCls + ' pl-7'}
              />
            </div>

            {/* Destinatário */}
            <div className="relative">
              <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                type="tel"
                value={filters.phone}
                onChange={e => setF('phone', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyFilters()}
                placeholder="Filtrar por número…"
                className={inputCls + ' pl-7'}
              />
            </div>

            {/* Status */}
            <select
              value={filters.status}
              onChange={e => setF('status', e.target.value)}
              className={inputCls}
            >
              <option value="">Todos os status</option>
              <option value="sent">Enviado</option>
              <option value="delivered">Entregue</option>
              <option value="failed">Falhou</option>
            </select>

            {/* Origem */}
            <select
              value={filters.origin}
              onChange={e => setF('origin', e.target.value)}
              className={inputCls}
            >
              <option value="">Todas as origens</option>
              <option value="manual">Teste manual</option>
              <option value="alert">Alerta automático</option>
              <option value="bulk">Envio em massa</option>
            </select>

            {/* Data de */}
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                type="date"
                value={filters.from}
                onChange={e => setF('from', e.target.value)}
                className={inputCls + ' pl-7'}
              />
            </div>

            {/* Data até */}
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                type="date"
                value={filters.to}
                onChange={e => setF('to', e.target.value)}
                className={inputCls + ' pl-7'}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={applyFilters}
              className="px-3 py-1.5 rounded-lg bg-cyan-100 hover:bg-cyan-200 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/20 dark:hover:bg-cyan-500/30 dark:border-cyan-500/40 dark:text-cyan-200 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Search className="w-3 h-3" /> Aplicar filtros
            </button>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 dark:bg-white/5 dark:hover:bg-white/8 dark:border-white/8 dark:text-slate-400 text-xs font-medium transition"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </div>
      )}

      {/* Conteúdo */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 text-[11px]">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {loading && logs.length === 0 && (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando extrato…
        </div>
      )}

      {!loading && !error && logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
          <Inbox className="w-8 h-8 opacity-50" />
          <p className="text-[11px]">
            {hasActiveFilters ? 'Nenhuma mensagem encontrada para este filtro' : 'Nenhuma mensagem enviada ainda'}
          </p>
        </div>
      )}

      {logs.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-white/8 overflow-hidden">
          {/* Cabeçalho da tabela */}
          <div className="hidden sm:grid grid-cols-[1.2fr_1fr_2.5fr_0.8fr_0.7fr] gap-2 px-3 py-2 bg-slate-50 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/5 text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
            <span>Data / Hora</span>
            <span>Destinatário</span>
            <span>Mensagem</span>
            <span>Origem</span>
            <span>Status</span>
          </div>

          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {logs.map(log => (
              <li key={log.id}>
                {/* Linha principal */}
                <button
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition"
                >
                  <div className="sm:grid sm:grid-cols-[1.2fr_1fr_2.5fr_0.8fr_0.7fr] sm:gap-2 sm:items-center space-y-1 sm:space-y-0">
                    {/* Timestamp */}
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                        {formatDate(log.sentAt)}
                      </span>
                    </div>

                    {/* Número */}
                    <div className="flex items-center gap-1.5">
                      <Phone className="w-3 h-3 text-slate-400 shrink-0 sm:hidden lg:block" />
                      <span className="text-[11px] font-mono text-slate-900 dark:text-white truncate">
                        {formatPhone(log.toPhone)}
                      </span>
                    </div>

                    {/* Mensagem preview */}
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate leading-snug">
                      {log.message.slice(0, 120)}{log.message.length > 120 ? '…' : ''}
                    </p>

                    {/* Origem */}
                    <span className="text-[10px] text-slate-500 truncate hidden sm:block">
                      {ORIGIN_LABELS[log.origin] ?? log.origin}
                    </span>

                    {/* Status */}
                    <StatusBadge status={log.status} />
                  </div>
                </button>

                {/* Detalhe expandido */}
                {expanded === log.id && (
                  <div className="px-3 pb-3 pt-0 space-y-2 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-100 dark:border-white/5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                      <div>
                        <p className="text-slate-400 uppercase tracking-wider mb-0.5">Instância</p>
                        <p className="font-mono text-slate-700 dark:text-slate-300">{log.instanceName}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 uppercase tracking-wider mb-0.5">ID Evolution</p>
                        <p className="font-mono text-slate-700 dark:text-slate-300 truncate">
                          {log.evolutionMsgId ?? '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400 uppercase tracking-wider mb-0.5">Origem</p>
                        <p className="text-slate-700 dark:text-slate-300">{ORIGIN_LABELS[log.origin] ?? log.origin}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 uppercase tracking-wider mb-0.5">Status</p>
                        <StatusBadge status={log.status} />
                      </div>
                    </div>

                    {/* Mensagem completa */}
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Mensagem completa</p>
                      <pre className="text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/8 rounded-lg p-2.5 font-sans leading-relaxed max-h-40 overflow-y-auto">
                        {log.message}
                      </pre>
                    </div>

                    {log.errorMessage && (
                      <div>
                        <p className="text-[10px] text-rose-500 uppercase tracking-wider mb-1">Erro</p>
                        <p className="text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg p-2">
                          {log.errorMessage}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Paginação */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>
            Página {pagination.page} de {pagination.pages} · {pagination.total} registro{pagination.total !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setPage(p => p - 1); load(page - 1) }}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-white/8 hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5 transition disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            {/* Botões de página */}
            {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
              const pg = Math.max(1, Math.min(pagination.pages - 4, page - 2)) + i
              return (
                <button
                  key={pg}
                  onClick={() => { setPage(pg); load(pg) }}
                  disabled={loading}
                  className={cn(
                    'w-7 h-7 rounded-lg border text-[11px] font-medium transition',
                    pg === page
                      ? 'bg-cyan-100 border-cyan-200 text-cyan-700 dark:bg-cyan-500/20 dark:border-cyan-500/40 dark:text-cyan-300'
                      : 'border-slate-200 dark:border-white/8 hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5',
                  )}
                >
                  {pg}
                </button>
              )
            })}
            <button
              onClick={() => { setPage(p => p + 1); load(page + 1) }}
              disabled={page >= pagination.pages || loading}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-white/8 hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5 transition disabled:opacity-40"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
