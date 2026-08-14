/**
 * AdminBillingExplorerPage — drill-down 3 níveis (SUPER_ADMIN).
 * Integradores → Clientes finais → Contratações.
 *
 * URL state:
 *   ?view=integradores                              → lista geral
 *   ?view=clientes&integradorId=xxx                 → drill nível 2
 *   ?view=contratacoes&clienteFinalId=yyy           → drill nível 3
 */
import { useState, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import useSWR from 'swr'
import {
  Building2, Building, Search, ChevronRight, Download, Loader2,
  ArrowLeft, AlertTriangle, Users, Camera, DollarSign, Package, Filter,
} from 'lucide-react'
import { api } from '../api/client'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'

const fetcher = (url: string) => api.get(url).then(r => r.data)

function brl(n: number) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type View = 'integradores' | 'clientes' | 'contratacoes'

export function AdminBillingExplorerPage() {
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) ?? 'integradores'
  const integradorId   = params.get('integradorId')   ?? undefined
  const clienteFinalId = params.get('clienteFinalId') ?? undefined

  function goTo(next: View, opts: { integradorId?: string; clienteFinalId?: string } = {}) {
    const p = new URLSearchParams()
    p.set('view', next)
    if (opts.integradorId)   p.set('integradorId',   opts.integradorId)
    if (opts.clienteFinalId) p.set('clienteFinalId', opts.clienteFinalId)
    setParams(p)
  }

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <GlassCard className="p-5 bg-gradient-to-br from-violet-500/10 via-cyan-500/5 to-transparent border-violet-300 dark:border-violet-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20 text-2xl">
              🔍
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Explorador de billing</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
                Drill-down individualizado: integradores → clientes finais → contratações. Investigue casos específicos sem perder o contexto.
              </p>
            </div>
          </div>
          <Link to="/admin/billing"
            className="text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 font-medium">
            <ArrowLeft className="w-3 h-3" /> Voltar ao resumo
          </Link>
        </div>

        {/* Breadcrumb */}
        <div className="mt-4 flex items-center gap-1.5 text-xs flex-wrap">
          <button onClick={() => goTo('integradores')}
            className={cn('px-2 py-1 rounded transition',
              view === 'integradores'
                ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400',
            )}>
            <Building className="w-3 h-3 inline mr-1" /> Integradores
          </button>
          {(view === 'clientes' || view === 'contratacoes') && integradorId && (
            <>
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <button onClick={() => goTo('clientes', { integradorId })}
                className={cn('px-2 py-1 rounded transition',
                  view === 'clientes'
                    ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400',
                )}>
                <Building2 className="w-3 h-3 inline mr-1" /> Clientes do integrador
              </button>
            </>
          )}
          {view === 'contratacoes' && clienteFinalId && (
            <>
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <span className="px-2 py-1 rounded bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 font-semibold">
                <Package className="w-3 h-3 inline mr-1" /> Contratações
              </span>
            </>
          )}
        </div>
      </GlassCard>

      {view === 'integradores' && <IntegradoresView onSelect={id => goTo('clientes', { integradorId: id })} />}
      {view === 'clientes' && integradorId && (
        <ClientesView integradorId={integradorId}
          onSelect={(cfId) => goTo('contratacoes', { integradorId, clienteFinalId: cfId })} />
      )}
      {view === 'contratacoes' && clienteFinalId && (
        <ContratacoesView clienteFinalId={clienteFinalId} />
      )}
    </div>
  )
}

// ═══════════════ NÍVEL 1: INTEGRADORES ════════════════════════════════════
interface IntegradorRow {
  id: string; name: string; tradeName: string | null; cnpj: string | null; email: string
  status: 'EM_DIA' | 'EM_ATRASO' | 'VENCE_BREVE' | 'PENDENTE_CADASTRO'
  clientesCount: number; camerasCount: number; mrrBrl: number
  lastInvoice: null | { status: string; totalAmountBrl: number; dueDate: string | null; paidAt: string | null }
}

function IntegradoresView({ onSelect }: { onSelect: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [orderBy, setOrderBy] = useState('mrr_desc')

  const url = useMemo(() => {
    const p = new URLSearchParams()
    if (q)        p.set('q', q)
    if (status)   p.set('status', status)
    if (orderBy)  p.set('orderBy', orderBy)
    return `/admin/billing/explorer/integradores?${p}`
  }, [q, status, orderBy])

  const { data, isLoading, error } = useSWR<{ totalCount: number; rows: IntegradorRow[] }>(url, fetcher,
    { keepPreviousData: true, refreshInterval: 60_000 },
  )

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-500" />
          <h3 className="text-xs uppercase tracking-wider font-bold text-slate-700 dark:text-slate-300">Filtros</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Nome, CNPJ ou email…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 focus:outline-none focus:ring-1 focus:ring-violet-500" />
          </div>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50">
            <option value="">Todos os status</option>
            <option value="EM_DIA">Em dia</option>
            <option value="VENCE_BREVE">Vence em breve</option>
            <option value="EM_ATRASO">Em atraso</option>
            <option value="PENDENTE_CADASTRO">Cadastro pendente</option>
          </select>
          <select value={orderBy} onChange={e => setOrderBy(e.target.value)}
            className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50">
            <option value="mrr_desc">Ordenar: MRR ↓</option>
            <option value="name_asc">Nome A-Z</option>
            <option value="clientes_desc">Mais clientes</option>
            <option value="cameras_desc">Mais câmeras</option>
          </select>
        </div>
      </GlassCard>

      {isLoading && !data && <Loading label="Carregando integradores…" />}
      {error && <ErrorBox message={error?.response?.data?.message ?? 'Falha ao carregar.'} />}

      {data && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="px-5 py-3 flex items-center justify-between border-b border-slate-200 dark:border-white/5">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <strong className="text-slate-900 dark:text-white">{data.totalCount}</strong> integrador{data.totalCount !== 1 ? 'es' : ''}{q || status ? ' (filtrado)' : ''}
            </p>
          </div>
          {data.rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">Nenhum integrador corresponde aos filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="text-left py-2.5 px-4 font-semibold uppercase tracking-wider">Integrador</th>
                    <th className="text-center py-2.5 px-4 font-semibold uppercase tracking-wider">Status</th>
                    <th className="text-right py-2.5 px-4 font-semibold uppercase tracking-wider">Clientes</th>
                    <th className="text-right py-2.5 px-4 font-semibold uppercase tracking-wider">Câmeras</th>
                    <th className="text-right py-2.5 px-4 font-semibold uppercase tracking-wider">MRR</th>
                    <th className="py-2.5 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => (
                    <tr key={r.id} onClick={() => onSelect(r.id)}
                      className="border-b border-slate-100 dark:border-white/5 hover:bg-violet-50 dark:hover:bg-violet-500/5 cursor-pointer transition">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-900 dark:text-white">{r.tradeName ?? r.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{r.email}{r.cnpj && ` · ${r.cnpj}`}</p>
                      </td>
                      <td className="py-3 px-4 text-center"><IntegradorStatusPill status={r.status} /></td>
                      <td className="py-3 px-4 text-right font-mono font-semibold">{r.clientesCount}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold">{r.camerasCount}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">R$ {brl(r.mrrBrl)}</td>
                      <td className="py-3 px-4 text-right"><ChevronRight className="w-4 h-4 text-slate-400 inline" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}
    </div>
  )
}

// ═══════════════ NÍVEL 2: CLIENTES DO INTEGRADOR ══════════════════════════
interface ClienteRow {
  id: string; name: string; razaoSocial: string
  status: 'ATIVO' | 'SUSPENSO' | 'CANCELADO' | 'SEM_CONTRATO'
  camerasCount: number; subscriptionsCount: number; mrrBrl: number; since: string
}
interface ClientesPayload {
  integrador: { id: string; name: string; tradeName: string | null; cnpj: string | null; email: string }
  totals: { clientesCount: number; camerasCount: number; subscriptionsCount: number; mrrBrl: number }
  rows: ClienteRow[]
}

function ClientesView({ integradorId, onSelect }: { integradorId: string; onSelect: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')

  const url = useMemo(() => {
    const p = new URLSearchParams()
    if (q)      p.set('q', q)
    if (status) p.set('status', status)
    return `/admin/billing/explorer/integradores/${integradorId}/clientes?${p}`
  }, [integradorId, q, status])

  const { data, isLoading, error } = useSWR<ClientesPayload>(url, fetcher, { keepPreviousData: true })

  async function downloadCsv() {
    const res = await api.get(`/admin/billing/explorer/integradores/${integradorId}/clientes.csv`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `clientes-${integradorId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading && !data) return <Loading label="Carregando clientes…" />
  if (error) return <ErrorBox message={error?.response?.data?.message ?? 'Falha ao carregar.'} />
  if (!data) return null

  return (
    <div className="space-y-4">
      {/* Card do integrador selecionado */}
      <GlassCard className="p-4 border-cyan-300 dark:border-cyan-500/20">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-cyan-700 dark:text-cyan-300 mb-1">Integrador selecionado</p>
        <p className="text-lg font-bold text-slate-900 dark:text-white">{data.integrador.tradeName ?? data.integrador.name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{data.integrador.email}{data.integrador.cnpj && ` · ${data.integrador.cnpj}`}</p>
      </GlassCard>

      {/* KPIs totais */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiMini label="Clientes" value={String(data.totals.clientesCount)} Icon={Users} color="cyan" />
        <KpiMini label="Câmeras" value={String(data.totals.camerasCount)} Icon={Camera} color="violet" />
        <KpiMini label="Contratos" value={String(data.totals.subscriptionsCount)} Icon={Package} color="amber" />
        <KpiMini label="MRR" value={`R$ ${brl(data.totals.mrrBrl)}`} Icon={DollarSign} color="emerald" />
      </div>

      {/* Filtros + CSV */}
      <GlassCard className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente final…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 focus:outline-none focus:ring-1 focus:ring-violet-500" />
          </div>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50">
            <option value="">Todos os status</option>
            <option value="ATIVO">Ativo</option>
            <option value="SUSPENSO">Suspenso</option>
            <option value="CANCELADO">Cancelado</option>
            <option value="SEM_CONTRATO">Sem contrato</option>
          </select>
          <button onClick={downloadCsv}
            className="px-3 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </GlassCard>

      <GlassCard className="p-0 overflow-hidden">
        {data.rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">Nenhum cliente corresponde aos filtros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="text-left py-2.5 px-4 font-semibold uppercase tracking-wider">Cliente</th>
                  <th className="text-center py-2.5 px-4 font-semibold uppercase tracking-wider">Status</th>
                  <th className="text-right py-2.5 px-4 font-semibold uppercase tracking-wider">Câmeras</th>
                  <th className="text-right py-2.5 px-4 font-semibold uppercase tracking-wider">Contratos</th>
                  <th className="text-right py-2.5 px-4 font-semibold uppercase tracking-wider">Receita/mês</th>
                  <th className="py-2.5 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id} onClick={() => onSelect(r.id)}
                    className="border-b border-slate-100 dark:border-white/5 hover:bg-violet-50 dark:hover:bg-violet-500/5 cursor-pointer transition">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900 dark:text-white">{r.name}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">desde {new Date(r.since).toLocaleDateString('pt-BR')}</p>
                    </td>
                    <td className="py-3 px-4 text-center"><ClienteStatusPill status={r.status} /></td>
                    <td className="py-3 px-4 text-right font-mono font-semibold">{r.camerasCount}</td>
                    <td className="py-3 px-4 text-right font-mono font-semibold">{r.subscriptionsCount}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">R$ {brl(r.mrrBrl)}</td>
                    <td className="py-3 px-4 text-right"><ChevronRight className="w-4 h-4 text-slate-400 inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  )
}

// ═══════════════ NÍVEL 3: CONTRATAÇÕES DO CLIENTE ═════════════════════════
interface Contratacao {
  id: string; productSlug: string; productName: string; category: string
  status: string; cameraCount: number; basePriceUsd: number
  finalPriceBrl: number; subtotalBrl: number
  startedAt: string; trialUntil: string | null
}
interface ContratacoesPayload {
  cliente:    { id: string; name: string; tradeName: string | null }
  integrador: { id: string; name: string; tradeName: string | null }
  totalMensalBrl: number
  contratacoes: Contratacao[]
}

function ContratacoesView({ clienteFinalId }: { clienteFinalId: string }) {
  const { data, isLoading, error } = useSWR<ContratacoesPayload>(
    `/admin/billing/explorer/clientes/${clienteFinalId}/contratacoes`, fetcher,
  )

  async function downloadCsv() {
    const res = await api.get(`/admin/billing/explorer/clientes/${clienteFinalId}/contratacoes.csv`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `contratacoes-${clienteFinalId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading && !data) return <Loading label="Carregando contratações…" />
  if (error) return <ErrorBox message={error?.response?.data?.message ?? 'Falha ao carregar.'} />
  if (!data) return null

  const activeCount = data.contratacoes.filter(c => ['ACTIVE', 'TRIAL', 'GRACE'].includes(c.status)).length

  return (
    <div className="space-y-4">
      {/* Card do cliente */}
      <GlassCard className="p-4 border-cyan-300 dark:border-cyan-500/20">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-cyan-700 dark:text-cyan-300 mb-1">Cliente final</p>
        <p className="text-lg font-bold text-slate-900 dark:text-white">{data.cliente.tradeName ?? data.cliente.name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Integrador: {data.integrador.tradeName ?? data.integrador.name}
        </p>
      </GlassCard>

      {/* KPIs + CSV */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-stretch">
        <KpiMini label="Contratos ativos" value={String(activeCount)} Icon={Package} color="emerald" />
        <KpiMini label="Total contratos" value={String(data.contratacoes.length)} Icon={Package} color="cyan" />
        <KpiMini label="Receita ativa /mês" value={`R$ ${brl(data.totalMensalBrl)}`} Icon={DollarSign} color="emerald" />
        <button onClick={downloadCsv}
          className="px-4 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 self-stretch justify-center">
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
      </div>

      <GlassCard className="p-0 overflow-hidden">
        {data.contratacoes.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">Nenhuma contratação encontrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="text-left py-2.5 px-4 font-semibold uppercase tracking-wider">Produto</th>
                  <th className="text-center py-2.5 px-4 font-semibold uppercase tracking-wider">Status</th>
                  <th className="text-right py-2.5 px-4 font-semibold uppercase tracking-wider">Câmeras</th>
                  <th className="text-right py-2.5 px-4 font-semibold uppercase tracking-wider">Atacado USD</th>
                  <th className="text-right py-2.5 px-4 font-semibold uppercase tracking-wider">Venda BRL</th>
                  <th className="text-right py-2.5 px-4 font-semibold uppercase tracking-wider">Subtotal</th>
                  <th className="text-left py-2.5 px-4 font-semibold uppercase tracking-wider">Desde</th>
                </tr>
              </thead>
              <tbody>
                {data.contratacoes.map(c => (
                  <tr key={c.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900 dark:text-white">{c.productName}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{c.productSlug} · {c.category}</p>
                    </td>
                    <td className="py-3 px-4 text-center"><SubStatusPill status={c.status} /></td>
                    <td className="py-3 px-4 text-right font-mono font-semibold">{c.cameraCount}</td>
                    <td className="py-3 px-4 text-right font-mono text-[11px] text-slate-600 dark:text-slate-400">${c.basePriceUsd.toFixed(4)}</td>
                    <td className="py-3 px-4 text-right font-mono">R$ {brl(c.finalPriceBrl)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">R$ {brl(c.subtotalBrl)}</td>
                    <td className="py-3 px-4 text-[11px] text-slate-500 dark:text-slate-400">{new Date(c.startedAt).toLocaleDateString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-t-2 border-slate-200 dark:border-slate-700">
                  <td colSpan={5} className="py-3 px-4 text-right font-semibold uppercase tracking-wider text-xs">Total mensal ativo</td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-base text-emerald-700 dark:text-emerald-400">R$ {brl(data.totalMensalBrl)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  )
}

// ═══════════════ HELPERS ══════════════════════════════════════════════════
function KpiMini({ label, value, Icon, color }: { label: string; value: string; Icon: any; color: 'cyan' | 'emerald' | 'amber' | 'violet' }) {
  const map = {
    cyan:    'border-cyan-300 dark:border-cyan-500/20 text-cyan-700 dark:text-cyan-300',
    emerald: 'border-emerald-300 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    amber:   'border-amber-300 dark:border-amber-500/20 text-amber-700 dark:text-amber-300',
    violet:  'border-violet-300 dark:border-violet-500/20 text-violet-700 dark:text-violet-300',
  }[color]
  return (
    <GlassCard className={cn('p-4', map.split(' ').filter(c => c.includes('border')).join(' '))}>
      <div className={cn('text-[10px] uppercase tracking-wider font-bold flex items-center gap-1', map.split(' ').filter(c => c.includes('text')).join(' '))}>
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">{value}</div>
    </GlassCard>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-violet-600 dark:text-violet-400" />
      <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">{label}</span>
    </div>
  )
}
function ErrorBox({ message }: { message: string }) {
  return (
    <GlassCard className="p-5 border-rose-300 dark:border-rose-500/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-rose-700 dark:text-rose-300">Erro ao carregar</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{message}</p>
        </div>
      </div>
    </GlassCard>
  )
}

function IntegradorStatusPill({ status }: { status: IntegradorRow['status'] }) {
  const map = {
    EM_DIA:            { label: 'EM DIA',        cls: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30' },
    VENCE_BREVE:       { label: 'VENCE BREVE',   cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30' },
    EM_ATRASO:         { label: 'EM ATRASO',     cls: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/30' },
    PENDENTE_CADASTRO: { label: 'PENDENTE',      cls: 'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-500/30' },
  }[status]
  return <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase border', map.cls)}>{map.label}</span>
}

function ClienteStatusPill({ status }: { status: ClienteRow['status'] }) {
  const map = {
    ATIVO:        { label: 'ATIVO',        cls: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30' },
    SUSPENSO:     { label: 'SUSPENSO',     cls: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/30' },
    CANCELADO:    { label: 'CANCELADO',    cls: 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-500/30' },
    SEM_CONTRATO: { label: 'SEM CONTRATO', cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30' },
  }[status]
  return <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase border', map.cls)}>{map.label}</span>
}

function SubStatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:    'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30',
    TRIAL:     'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/30',
    GRACE:     'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30',
    SUSPENDED: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/30',
  }
  return <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase border', map[status] ?? 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-500/30')}>{status}</span>
}
