/**
 * /admin/modulos/utilization — Contratado × Utilizado (Sprint 2.3)
 *
 * Paridade Monuv `/product/report`:
 *   • Cruza módulos contratados (catalog × enabledModules) com uso efetivo
 *     (#eventos no período, câmeras com uso, custo GCP estimado).
 *   • Sinaliza subutilização → oportunidade de churn ou upsell.
 *   • Exporta CSV.
 *
 * Backend planejado: GET `/bi/utilization?days=N`. Enquanto não publica,
 * usa síntese determinística (hash do par integradorId+moduleId) — mesma
 * estratégia da UptimePage. Flag SYNTHETIC_MODE controla.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Puzzle, ArrowLeft, AlertTriangle, TrendingDown, TrendingUp,
  Search, Building2, Activity, DollarSign, CheckCircle2, XCircle,
  Info, Filter, ChevronDown, ChevronRight,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useModuleCatalog, useAdminIntegradoresModules } from '../api/client'
import { cn } from '../lib/utils'
import { ExportCsvButton } from '../components/ExportCsvButton'
import type { CsvColumn } from '../lib/csv'

const SYNTHETIC_MODE = true

// ─────────────────────────────────────────────────────────────────────────────
// Síntese determinística (espelho da estratégia em UptimePage)
// ─────────────────────────────────────────────────────────────────────────────

function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface UsageCell {
  /** Está contratado pelo integrador */
  contracted: boolean
  /** #eventos gerados pelo módulo no período */
  events: number
  /** câmeras únicas que dispararam esse módulo */
  cameras: number
  /** custo estimado em BRL (período) */
  costBrl: number
  /** flag “utilizado” = contracted && events > 0 */
  used: boolean
}

interface UtilRow {
  integradorId: string
  integradorName: string
  integradorEmail: string
  clientesCount: number
  /** total contratados */
  contracted: number
  /** total contratados E utilizados */
  used: number
  /** % aderência = used / contracted */
  adherence: number
  /** custo total estimado no período (BRL) */
  costBrl: number
  /** total eventos no período */
  events: number
  /** total câmeras únicas (deduzido) */
  cameras: number
  /** mapa moduleId → célula */
  cells: Record<string, UsageCell>
}

/**
 * Custo médio por evento por categoria (R$/evento).
 * Aproximação realista para ordem de grandeza:
 *   • vision_api  → ~R$ 0.012/imagem (LABEL/FACE/OBJECT)
 *   • vertex      → ~R$ 0.018/operação (multimodal)
 *   • edge        → ~R$ 0.0008/evento (depreciação rateada de hardware)
 */
const COST_PER_EVENT: Record<string, number> = {
  vision_api: 0.012,
  vertex:     0.018,
  edge:       0.0008,
}

function synthCell(integradorId: string, moduleId: string, contracted: boolean, days: number, category: string): UsageCell {
  if (!contracted) {
    return { contracted: false, events: 0, cameras: 0, costBrl: 0, used: false }
  }
  const h = hash32(`${integradorId}::${moduleId}::${days}`)
  // 25% das contratações ficam zeradas (subutilização)
  const isZero = (h % 100) < 25
  if (isZero) {
    return { contracted: true, events: 0, cameras: 0, costBrl: 0, used: false }
  }
  // Eventos: dispersão larga — 50..50.000 por período
  const eventsBase = 50 + (h % 1500) * (1 + ((h >> 8) % 30))
  const events = Math.round(eventsBase * (days / 30))
  const cameras = 1 + (h % 14) // 1..14 câmeras
  const cost = events * (COST_PER_EVENT[category] ?? 0.005)
  return {
    contracted: true,
    events,
    cameras,
    costBrl: Math.round(cost * 100) / 100,
    used: events > 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de UI
// ─────────────────────────────────────────────────────────────────────────────

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}
function fmtInt(n: number): string {
  return n.toLocaleString('pt-BR')
}
function pct(v: number): string {
  if (!isFinite(v)) return '—'
  return `${(v * 100).toFixed(0)}%`
}

function adherenceBadge(adherence: number, contracted: number) {
  if (contracted === 0) {
    return { label: 'Sem contrato', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30', icon: Info }
  }
  if (adherence >= 0.85) return { label: 'Saudável',     cls: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30', icon: CheckCircle2 }
  if (adherence >= 0.5)  return { label: 'Atenção',      cls: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',     icon: AlertTriangle }
  return                       { label: 'Subutilizado',  cls: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',         icon: TrendingDown }
}

const PERIODS: { label: string; days: number }[] = [
  { label: '7 dias',   days: 7 },
  { label: '30 dias',  days: 30 },
  { label: '90 dias',  days: 90 },
]

type SortKey = 'name' | 'contracted' | 'used' | 'adherence' | 'cost'

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export function UtilizationPage() {
  const { data: catalog = [] }                         = useModuleCatalog()
  const { data: integradores = [], isLoading }         = useAdminIntegradoresModules()
  const [days, setDays]                                = useState<number>(30)
  const [q, setQ]                                      = useState('')
  const [onlyUnderused, setOnlyUnderused]              = useState(false)
  const [sortKey, setSortKey]                          = useState<SortKey>('adherence')
  const [sortDir, setSortDir]                          = useState<'asc' | 'desc'>('asc')
  const [expanded, setExpanded]                        = useState<Set<string>>(new Set())

  // ── Cruza catalog × integradores → linhas ──────────────────────────────
  const rows: UtilRow[] = useMemo(() => {
    return (integradores as any[]).map((integ: any) => {
      const enabled: string[] = integ.enabledModules ?? []
      const cells: Record<string, UsageCell> = {}
      let contracted = 0, used = 0, costBrl = 0, events = 0
      const cameraIds = new Set<string>()
      for (const m of catalog as any[]) {
        const isContracted = enabled.includes(m.id)
        const cell = synthCell(integ.id, m.id, isContracted, days, m.category)
        cells[m.id] = cell
        if (cell.contracted) contracted++
        if (cell.used) used++
        events  += cell.events
        costBrl += cell.costBrl
        // câmeras ficcionais — somatório (sem dedup real)
        for (let i = 0; i < cell.cameras; i++) cameraIds.add(`${m.id}-${i}`)
      }
      return {
        integradorId:  integ.id,
        integradorName: integ.name,
        integradorEmail: integ.email,
        clientesCount: integ._count?.clienteFinais ?? 0,
        contracted,
        used,
        adherence: contracted === 0 ? 0 : used / contracted,
        costBrl: Math.round(costBrl * 100) / 100,
        events,
        cameras: cameraIds.size,
        cells,
      }
    })
  }, [integradores, catalog, days])

  // ── Filtros + sort ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (needle && !(
        r.integradorName.toLowerCase().includes(needle) ||
        r.integradorEmail.toLowerCase().includes(needle)
      )) return false
      if (onlyUnderused && !(r.contracted > 0 && r.adherence < 0.5)) return false
      return true
    })
  }, [rows, q, onlyUnderused])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'name':       return dir * a.integradorName.localeCompare(b.integradorName, 'pt-BR')
        case 'contracted': return dir * (a.contracted - b.contracted)
        case 'used':       return dir * (a.used - b.used)
        case 'adherence':  return dir * (a.adherence - b.adherence)
        case 'cost':       return dir * (a.costBrl - b.costBrl)
      }
    })
    return arr
  }, [filtered, sortKey, sortDir])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc') }
  }

  function toggleExpanded(id: string) {
    setExpanded(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  // ── KPIs agregados ─────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalContracted = rows.reduce((a, r) => a + r.contracted, 0)
    const totalUsed       = rows.reduce((a, r) => a + r.used, 0)
    const totalCost       = rows.reduce((a, r) => a + r.costBrl, 0)
    const totalEvents     = rows.reduce((a, r) => a + r.events, 0)
    const adherence       = totalContracted === 0 ? 0 : totalUsed / totalContracted
    const underused       = rows.filter(r => r.contracted > 0 && r.adherence < 0.5).length
    return { totalContracted, totalUsed, totalCost, totalEvents, adherence, underused }
  }, [rows])

  // ── CSV export (linha por integrador) ──────────────────────────────────
  const csvCols: CsvColumn<UtilRow>[] = [
    { header: 'Integrador',           accessor: r => r.integradorName },
    { header: 'Email',                accessor: r => r.integradorEmail },
    { header: 'Clientes',             accessor: r => r.clientesCount },
    { header: 'Módulos contratados',  accessor: r => r.contracted },
    { header: 'Módulos utilizados',   accessor: r => r.used },
    { header: 'Aderência (%)',        accessor: r => Math.round(r.adherence * 100) },
    { header: `Eventos (${days}d)`,   accessor: r => r.events },
    { header: 'Câmeras únicas',       accessor: r => r.cameras },
    { header: 'Custo estimado (BRL)', accessor: r => r.costBrl.toFixed(2) },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/admin/modulos"
            className="p-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-100 dark:bg-white/10"
            title="Voltar para gestão de módulos"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Puzzle className="w-5 h-5 text-cyan-700 dark:text-cyan-400" />
              Contratado × Utilizado
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
              Cruzamento de módulos contratados por integrador com a adoção real
              (eventos no período, câmeras únicas, custo estimado).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg p-0.5">
            {PERIODS.map(p => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={cn(
                  'px-2.5 py-1 rounded text-[11px] font-semibold',
                  days === p.days
                    ? 'bg-cyan-100 text-cyan-700 border border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/40'
                    : 'text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-50 dark:bg-white/5 border border-transparent',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <ExportCsvButton
            basename={`utilization_${days}d`}
            rows={sorted}
            columns={csvCols}
            label="Exportar CSV"
          />
        </div>
      </div>

      {/* Synthetic mode banner */}
      {SYNTHETIC_MODE && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-[11px] text-amber-800 dark:text-amber-200">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            <b>Modo aproximação</b> — os números de uso e custo são derivados
            de uma síntese determinística (hash do par integrador+módulo).
            O endpoint{' '}
            <code className="font-mono text-[10px] bg-slate-100 dark:bg-white/10 px-1 rounded">
              GET /bi/utilization?days={days}
            </code>{' '}
            será conectado em seguida e a UI permanece a mesma.
          </span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          icon={<Puzzle />}
          accent="cyan"
          label="Contratos ativos"
          value={fmtInt(kpis.totalContracted)}
          subtitle={`${(integradores as any[]).length} integradores`}
        />
        <KpiTile
          icon={<Activity />}
          accent="emerald"
          label="Utilização efetiva"
          value={fmtInt(kpis.totalUsed)}
          subtitle={pct(kpis.adherence) + ' de aderência'}
        />
        <KpiTile
          icon={<TrendingDown />}
          accent={kpis.underused > 0 ? 'rose' : 'emerald'}
          label="Subutilizados"
          value={fmtInt(kpis.underused)}
          subtitle={kpis.underused > 0 ? 'oportunidade churn/upsell' : 'tudo saudável'}
        />
        <KpiTile
          icon={<DollarSign />}
          accent="violet"
          label={`Custo (${days}d)`}
          value={fmtBRL(kpis.totalCost)}
          subtitle={`${fmtInt(kpis.totalEvents)} eventos`}
        />
      </div>

      {/* Filtros */}
      <GlassCard className="p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar integrador (nome ou email)..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-cyan-500/40"
          />
        </div>
        <button
          onClick={() => setOnlyUnderused(v => !v)}
          className={cn(
            'px-3 py-1.5 rounded-md border text-xs font-semibold flex items-center gap-1.5',
            onlyUnderused
              ? 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40'
              : 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-white/5 dark:text-slate-300 dark:border-white/10 hover:text-slate-900 dark:hover:text-white',
          )}
          title={onlyUnderused ? 'Mostrando apenas subutilizados (<50%)' : 'Filtrar apenas subutilizados (<50%)'}
        >
          <Filter className="w-3 h-3" />
          {onlyUnderused ? 'Apenas subutilizados' : 'Filtrar subutilizados'}
        </button>
        <span className="text-[10px] text-slate-500 dark:text-slate-500 font-mono">
          {sorted.length}/{rows.length} integradores
        </span>
      </GlassCard>

      {/* Tabela */}
      <GlassCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-400">
                <th className="px-3 py-2.5 w-6"></th>
                <SortHeader label="Integrador"  k="name"       current={sortKey} dir={sortDir} onClick={toggleSort} />
                <th className="px-3 py-2.5">Clientes</th>
                <SortHeader label="Contratados" k="contracted" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortHeader label="Utilizados"  k="used"       current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortHeader label="Aderência"   k="adherence"  current={sortKey} dir={sortDir} onClick={toggleSort} />
                <th className="px-3 py-2.5 text-right">Eventos</th>
                <SortHeader label="Custo"       k="cost"       current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500 dark:text-slate-500">Carregando…</td></tr>
              )}
              {!isLoading && sorted.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500 dark:text-slate-500">Nenhum integrador encontrado</td></tr>
              )}
              {sorted.map(r => {
                const isExp = expanded.has(r.integradorId)
                const badge = adherenceBadge(r.adherence, r.contracted)
                const BadgeIcon = badge.icon
                return (
                  <>
                    <tr
                      key={r.integradorId}
                      className={cn(
                        'border-b border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] cursor-pointer transition',
                        isExp && 'bg-slate-50 dark:bg-white/[0.03]',
                      )}
                      onClick={() => toggleExpanded(r.integradorId)}
                    >
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-500">
                        {isExp
                          ? <ChevronDown className="w-3.5 h-3.5" />
                          : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-slate-200 dark:border-white/10 flex items-center justify-center text-[10px] font-bold text-slate-900 dark:text-white">
                            {r.integradorName[0]}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{r.integradorName}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-500 truncate">{r.integradorEmail}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-400">
                        <div className="flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-slate-500 dark:text-slate-500" />
                          {r.clientesCount}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-mono">{r.contracted}</td>
                      <td className="px-3 py-2 font-mono">
                        <span className={cn(
                          r.used > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-500',
                        )}>{r.used}</span>
                        <span className="text-slate-500 dark:text-slate-600"> / {r.contracted}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 max-w-[100px] h-1.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                            <div
                              className={cn(
                                'h-full transition-all',
                                r.adherence >= 0.85 ? 'bg-emerald-400' :
                                r.adherence >= 0.5  ? 'bg-amber-400' :
                                                      'bg-rose-400',
                              )}
                              style={{ width: `${Math.min(100, r.adherence * 100)}%` }}
                            />
                          </div>
                          <span className={cn(
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-semibold',
                            badge.cls,
                          )}>
                            <BadgeIcon className="w-2.5 h-2.5" />
                            {pct(r.adherence)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300 font-mono">{fmtInt(r.events)}</td>
                      <td className="px-3 py-2 text-right text-violet-700 dark:text-violet-300 font-mono font-semibold">{fmtBRL(r.costBrl)}</td>
                    </tr>
                    {isExp && (
                      <tr key={`${r.integradorId}-detail`} className="border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/30">
                        <td colSpan={8} className="px-4 py-3">
                          <ModuleBreakdown row={r} catalog={catalog as any[]} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────────────

function KpiTile({
  icon, accent, label, value, subtitle,
}: { icon: React.ReactNode; accent: 'cyan' | 'violet' | 'emerald' | 'rose' | 'amber'; label: string; value: string; subtitle?: string }) {
  const styles = {
    cyan:    { text: 'text-cyan-700 dark:text-cyan-400',    bg: 'bg-cyan-50 dark:bg-cyan-500/10',    border: 'border-cyan-200 dark:border-cyan-500/20',    icon: 'text-cyan-700 dark:text-cyan-400'    },
    violet:  { text: 'text-violet-700 dark:text-violet-400',  bg: 'bg-violet-50 dark:bg-violet-500/10',  border: 'border-violet-200 dark:border-violet-500/20',  icon: 'text-violet-700 dark:text-violet-400'  },
    emerald: { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20', icon: 'text-emerald-700 dark:text-emerald-400' },
    rose:    { text: 'text-rose-700 dark:text-rose-400',    bg: 'bg-rose-50 dark:bg-rose-500/10',    border: 'border-rose-200 dark:border-rose-500/20',    icon: 'text-rose-700 dark:text-rose-400'    },
    amber:   { text: 'text-amber-700 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-500/10',   border: 'border-amber-200 dark:border-amber-500/20',   icon: 'text-amber-700 dark:text-amber-400'   },
  }[accent]
  return (
    <GlassCard glow={accent} className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div className={cn('p-2 rounded-lg border', styles.bg, styles.border)}>
          <div className={cn('w-4 h-4', styles.icon)}>{icon}</div>
        </div>
      </div>
      <div className={cn('text-2xl font-bold tracking-tight', styles.text)}>{value}</div>
      <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5 font-medium">{label}</p>
      {subtitle && <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5">{subtitle}</p>}
    </GlassCard>
  )
}

interface SortHeaderProps {
  label: string
  k: SortKey
  current: SortKey
  dir: 'asc' | 'desc'
  onClick: (k: SortKey) => void
  align?: 'left' | 'right'
}
function SortHeader({ label, k, current, dir, onClick, align = 'left' }: SortHeaderProps) {
  const active = current === k
  return (
    <th
      className={cn('px-3 py-2.5 cursor-pointer select-none hover:text-slate-900 dark:hover:text-white', align === 'right' && 'text-right')}
      onClick={() => onClick(k)}
    >
      <span className={cn('inline-flex items-center gap-1', active && 'text-cyan-700 dark:text-cyan-300')}>
        {label}
        {active && (dir === 'asc' ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />)}
      </span>
    </th>
  )
}

function ModuleBreakdown({ row, catalog }: { row: UtilRow; catalog: any[] }) {
  const groups: Record<string, any[]> = {}
  for (const m of catalog) {
    if (!groups[m.category]) groups[m.category] = []
    groups[m.category].push(m)
  }
  const CATEGORY_LABEL: Record<string, string> = {
    vision_api: 'Cloud Vision API',
    vertex:     'Vertex AI Vision',
    edge:       'Edge (YOLOv8)',
  }
  const CATEGORY_COLOR: Record<string, string> = {
    vision_api: 'text-violet-700 dark:text-violet-300',
    vertex:     'text-cyan-700 dark:text-cyan-300',
    edge:       'text-emerald-700 dark:text-emerald-300',
  }

  return (
    <div className="space-y-3">
      {Object.entries(groups).map(([cat, mods]) => (
        <div key={cat}>
          <div className={cn('text-[10px] font-bold uppercase tracking-widest mb-1.5', CATEGORY_COLOR[cat] ?? 'text-slate-700 dark:text-slate-400')}>
            {CATEGORY_LABEL[cat] ?? cat}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {mods.map(m => {
              const cell = row.cells[m.id] ?? { contracted: false, events: 0, cameras: 0, costBrl: 0, used: false }
              const status =
                !cell.contracted ? 'off' :
                cell.used ? 'on' : 'idle'
              return (
                <div
                  key={m.id}
                  className={cn(
                    'px-2.5 py-2 rounded-lg border text-[11px]',
                    status === 'on'   && 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30',
                    status === 'idle' && 'bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30',
                    status === 'off'  && 'bg-slate-50 border-slate-200 dark:bg-white/[0.02] dark:border-white/5 opacity-60',
                  )}
                  title={
                    status === 'on'   ? `${fmtInt(cell.events)} eventos · ${fmtInt(cell.cameras)} câmeras`  :
                    status === 'idle' ? 'Contratado, mas sem uso no período (subutilizado)'                  :
                                        'Não contratado por este integrador'
                  }
                >
                  <div className="flex items-center justify-between gap-1">
                    <p className={cn(
                      'text-[11px] font-semibold truncate',
                      status === 'on'   && 'text-emerald-800 dark:text-emerald-200',
                      status === 'idle' && 'text-rose-800 dark:text-rose-200',
                      status === 'off'  && 'text-slate-500 dark:text-slate-500',
                    )}>
                      {m.name}
                    </p>
                    {status === 'on'   && <CheckCircle2  className="w-3 h-3 text-emerald-700 dark:text-emerald-300 shrink-0" />}
                    {status === 'idle' && <AlertTriangle className="w-3 h-3 text-rose-700 dark:text-rose-300 shrink-0" />}
                    {status === 'off'  && <XCircle       className="w-3 h-3 text-slate-500 dark:text-slate-600 shrink-0" />}
                  </div>
                  {status !== 'off' && (
                    <div className="flex items-center justify-between mt-1 text-[9px] font-mono">
                      <span className="text-slate-700 dark:text-slate-400">{fmtInt(cell.events)} ev.</span>
                      <span className={cn('font-semibold', status === 'on' ? 'text-violet-700 dark:text-violet-300' : 'text-slate-500 dark:text-slate-600')}>
                        {fmtBRL(cell.costBrl)}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
