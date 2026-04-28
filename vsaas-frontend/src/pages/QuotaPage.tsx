/**
 * Sprint U.3.1 — QuotaPage (Gap 1 fechado)
 *
 * Página dedicada de consumo. Usa `GET /quota/me` — endpoint tenant-scoped
 * implementado no backend que filtra cameras/events e expõe hardLimits do
 * ApiQuota conforme o JWT do usuário:
 *   - SUPER_ADMIN     → agregado da plataforma (cameras + events + S3 reais)
 *   - INTEGRADOR_*    → consumo do próprio integrador + hard-limits Vision/Streaming
 *   - CLIENT_*        → consumo do próprio cliente final (sem hard-limits)
 *
 * S3 só aparece para SUPER_ADMIN (compartilhado entre tenants — vazaria info).
 *
 * Para SUPER_ADMIN: botão "ver por integrador" → /admin/integradores.
 */
import { Link } from 'react-router-dom'
import {
  Gauge, Loader2, AlertTriangle, ExternalLink, Cpu, HardDrive,
  Calendar, Camera, BarChart3, Cloud, Building2, Info, ShieldCheck,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useQuotaMe, formatApiError, type QuotaItem } from '../api/client'
import { cn } from '../lib/utils'

const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
const isSuperAdmin = role === 'SUPER_ADMIN'

const SCOPE_LABELS: Record<string, { title: string; hint: string; tone: string }> = {
  PLATFORM: {
    title: 'Visão da plataforma',
    hint:   'Você está vendo o consumo agregado de TODOS os integradores e clientes finais.',
    tone:   'violet',
  },
  INTEGRADOR: {
    title: 'Consumo do seu integrador',
    hint:   'Inclui todas as suas câmeras, eventos e chamadas Vertex deste ciclo. Os hard-limits abaixo controlam bloqueio efetivo.',
    tone:   'cyan',
  },
  CLIENTE_FINAL: {
    title: 'Consumo do seu cliente',
    hint:   'Apenas as câmeras e eventos do seu ClienteFinal. Limites comerciais (Vertex, Streaming) ficam com o seu integrador.',
    tone:   'emerald',
  },
}

export function QuotaPage() {
  const { data, error, isLoading } = useQuotaMe()

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-emerald-500/5 to-transparent border-cyan-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Gauge className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Consumo & Cotas</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Quanto da sua plataforma está sendo usado neste ciclo de
                faturamento — câmeras, chamadas de IA, storage e eventos.
                Cotas servem como aviso e podem aplicar bloqueio rígido conforme
                a política configurada (HARD_BLOCK / SOFT_WARN).
              </p>
            </div>
          </div>

          {isSuperAdmin && (
            <Link
              to="/admin/integradores"
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-700 dark:text-violet-200 text-xs font-bold transition"
            >
              <Building2 className="w-3.5 h-3.5" />
              Ver por integrador
              <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </div>
      </GlassCard>

      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">Falha ao carregar consumo</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {isLoading && !data && (
        <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs">Carregando métricas de consumo...</p>
        </GlassCard>
      )}

      {data && (
        <>
          {/* Scope banner — deixa claro qual visão está sendo exibida */}
          <ScopeBanner scope={data.scope} />

          {/* Período */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-500 dark:text-slate-400 w-fit">
            <Calendar className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
            <span>Ciclo atual:</span>
            <strong className="text-slate-900 dark:text-white">{data.summary.cycleLabel}</strong>
            <span className="text-slate-600 font-mono">({data.summary.cycle})</span>
          </div>

          {/* KPIs sumário */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi
              icon={Camera}
              label="Câmeras ativas"
              value={data.summary.cameras.toLocaleString('pt-BR')}
              accent="cyan"
            />
            <Kpi
              icon={Cpu}
              label="Vertex AI"
              value={data.summary.vertexCalls.toLocaleString('pt-BR')}
              suffix="chamadas"
              accent="violet"
            />
            <Kpi
              icon={HardDrive}
              label="Storage S3"
              value={data.summary.storageGb.toFixed(1)}
              suffix="GB"
              accent="emerald"
            />
            <Kpi
              icon={BarChart3}
              label="Eventos"
              value={data.summary.events.toLocaleString('pt-BR')}
              suffix="no ciclo"
              accent="amber"
            />
          </div>

          {/* Items detalhados como barras */}
          <GlassCard className="p-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              Recursos com cota
            </h2>
            <div className="space-y-4">
              {data.items.map(item => (
                <QuotaBar key={item.resource} item={item} />
              ))}
            </div>
          </GlassCard>

          {/* Hard-limits do integrador (Vision/Streaming bloqueio rígido) */}
          {data.hardLimits && (
            <GlassCard className="p-5 border-amber-500/20">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                Limites rígidos (HARD_BLOCK)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Quando o consumo atinge 100%, novas chamadas Vision/Streaming são
                bloqueadas pelo backend (<code className="text-amber-600 dark:text-amber-200 font-mono px-1 bg-black/10 dark:bg-black/30 rounded">QuotaExceededError</code>) até a próxima virada de ciclo.
              </p>
              <div className="grid md:grid-cols-2 gap-3 text-xs">
                <HardLimitTile
                  label="Vertex Vision (chamadas)"
                  used={data.hardLimits.vision.used}
                  limit={data.hardLimits.vision.limit}
                  pct={data.hardLimits.vision.pct}
                  blocked={data.hardLimits.vision.blocked}
                />
                <HardLimitTile
                  label="Vertex Streaming (minutos)"
                  used={data.hardLimits.streaming.usedMinutes}
                  limit={data.hardLimits.streaming.limitMinutes}
                  pct={data.hardLimits.streaming.pct}
                  blocked={data.hardLimits.streaming.blocked}
                />
              </div>
              <p className="mt-3 text-[10px] text-slate-600">
                Renovação do ciclo: <strong className="text-slate-400 font-mono">{new Date(data.hardLimits.periodEnd).toLocaleDateString('pt-BR')}</strong>
              </p>
            </GlassCard>
          )}

          {/* S3 detalhe — só PLATFORM (compartilhado entre tenants) */}
          {data.scope === 'PLATFORM' && data.s3 && (
            <GlassCard className="p-5">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <Cloud className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                Cloud Storage
              </h2>
              {data.s3.enabled ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <Detail label="Bucket" value={data.s3.bucket ?? '—'} />
                  <Detail label="Região" value={data.s3.region ?? '—'} />
                  <Detail label="Objetos" value={data.s3.objectsCount.toLocaleString('pt-BR')} />
                  <Detail label="Endpoint" value={data.s3.endpoint ?? '—'} mono />
                </div>
              ) : (
                <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    S3 não configurado nesta instância. Defina <code className="px-1 mx-1 text-amber-100 bg-black/30 rounded font-mono">S3_ACCESS_KEY</code>,
                    <code className="px-1 mx-1 text-amber-100 bg-black/30 rounded font-mono">S3_SECRET_KEY</code> e
                    <code className="px-1 ml-1 text-amber-100 bg-black/30 rounded font-mono">S3_BUCKET</code>.
                  </span>
                </div>
              )}
            </GlassCard>
          )}

          {data.scope === 'CLIENTE_FINAL' && (
            <GlassCard className="p-4 border-emerald-500/20">
              <div className="flex items-start gap-3">
                <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  Limites comerciais (Vertex AI, storage) ficam com o seu integrador.
                  Para entender seu plano e tetos contratuais, fale com o suporte
                  do integrador que provisionou suas câmeras.
                </p>
              </div>
            </GlassCard>
          )}
        </>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function ScopeBanner({ scope }: { scope: 'PLATFORM' | 'INTEGRADOR' | 'CLIENTE_FINAL' }) {
  const meta = SCOPE_LABELS[scope] ?? SCOPE_LABELS.PLATFORM
  const tones: Record<string, string> = {
    violet:  'border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-200',
    cyan:    'border-cyan-500/30 bg-cyan-500/5 text-cyan-700 dark:text-cyan-200',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-200',
  }
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-xs flex items-start gap-2', tones[meta.tone])}>
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <div>
        <strong className="block">{meta.title}</strong>
        <span className="text-slate-400">{meta.hint}</span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function HardLimitTile({ label, used, limit, pct, blocked }: {
  label: string; used: number; limit: number; pct: number; blocked: boolean
}) {
  const tone = blocked
    ? 'border-rose-500/40 bg-rose-500/10'
    : pct >= 90
    ? 'border-rose-500/30 bg-rose-500/5'
    : pct >= 70
    ? 'border-amber-500/30 bg-amber-500/5'
    : 'border-emerald-500/30 bg-emerald-500/5'
  const barTone = blocked || pct >= 90
    ? 'from-rose-500 to-rose-400'
    : pct >= 70
    ? 'from-amber-500 to-amber-400'
    : 'from-emerald-500 to-cyan-500'
  return (
    <div className={cn('rounded-lg border p-3', tone)}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium text-slate-800 dark:text-slate-100">{label}</span>
        <span className={cn('text-xs font-mono', blocked && 'text-rose-600 dark:text-rose-300 font-bold')}>
          {pct}%{blocked && ' · BLOQUEADO'}
        </span>
      </div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mb-1.5">
        {formatNumber(used)} / {formatNumber(limit)}
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
        <div
          className={cn('h-full bg-gradient-to-r transition-all', barTone)}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function Kpi({ icon: Icon, label, value, suffix, accent }: {
  icon: any; label: string; value: string; suffix?: string
  accent: 'cyan' | 'violet' | 'emerald' | 'amber'
}) {
  const colors = {
    cyan:    { txt: 'text-cyan-600 dark:text-cyan-300',    border: 'border-cyan-500/20',    bg: 'bg-cyan-500/5'   },
    violet:  { txt: 'text-violet-600 dark:text-violet-300',  border: 'border-violet-500/20',  bg: 'bg-violet-500/5' },
    emerald: { txt: 'text-emerald-600 dark:text-emerald-300', border: 'border-emerald-500/20', bg: 'bg-emerald-500/5'},
    amber:   { txt: 'text-amber-600 dark:text-amber-300',   border: 'border-amber-500/20',   bg: 'bg-amber-500/5'  },
  }[accent]
  return (
    <div className={cn('rounded-xl border p-4', colors.border, colors.bg)}>
      <div className={cn('flex items-center gap-1.5 text-[10px] uppercase tracking-wider', colors.txt)}>
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-xl font-bold text-slate-900 dark:text-white">
        {value}
        {suffix && <span className="ml-1 text-[10px] font-normal text-slate-500">{suffix}</span>}
      </p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function QuotaBar({ item }: { item: QuotaItem }) {
  const hasLimit = item.limit != null && item.limit > 0
  const pct = hasLimit ? Math.min(100, (item.used / (item.limit as number)) * 100) : 0

  let barColor = 'from-emerald-500 to-cyan-500'
  let textColor = 'text-emerald-300'
  if (hasLimit) {
    if (pct >= 90)      { barColor = 'from-rose-500 to-rose-400';    textColor = 'text-rose-300'   }
    else if (pct >= 70) { barColor = 'from-amber-500 to-amber-400';  textColor = 'text-amber-300'  }
  } else {
    barColor = 'from-slate-600 to-slate-500'
    textColor = 'text-slate-400'
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{item.resource}</span>
        <span className={cn('text-xs font-mono', textColor)}>
          {formatNumber(item.used)} {hasLimit ? `/ ${formatNumber(item.limit as number)}` : ''}
          <span className="ml-1 text-slate-500">{item.unit}</span>
          {hasLimit && <span className="ml-2 text-slate-500">({pct.toFixed(0)}%)</span>}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
        <div
          className={cn('h-full bg-gradient-to-r transition-all', barColor)}
          style={{ width: hasLimit ? `${pct}%` : '100%' }}
        />
      </div>
      {!hasLimit && (
        <p className="mt-1 text-[10px] text-slate-600 italic">Sem limite definido</p>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn('mt-0.5 text-slate-700 dark:text-slate-200 truncate', mono && 'font-mono text-[11px]')}>{value}</p>
    </div>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 10_000)    return (n / 1_000).toFixed(1) + 'k'
  return n.toLocaleString('pt-BR')
}
