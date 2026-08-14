/**
 * AdminAlerts — Centro de comando de incidentes do SUPER_ADMIN.
 *
 * Filosofia: agregar SINAIS de problemas espalhados pelo sistema em uma única
 * fila de "trabalho a fazer", priorizada por severidade. Não substitui logs
 * (post-mortem) — complementa com visão proativa.
 *
 * Categorias MVP:
 *   - quota: integrador com Vertex/Streaming > 90% (warning) ou bloqueado (critical)
 *   - infra: edge box offline > 10min, suspended, status crítico
 *   - approvals: ApprovalRequest pendente > 48h + demos SLA (lead NEW) aguardando aprovação
 *   - commercial: lead novo > 24h sem contato
 *
 * Ações podem ser inline (`method`+`url`+`intent`): o frontend chama o endpoint
 * (ex: /approvals/:id/approve|reject, /leads/:id/invite, PATCH /leads/:id) e remove
 * o card otimisticamente. Os alertas seguem derivados em runtime (sem tabela nova) —
 * após a mutação o estado de origem muda e o alerta some no próximo refresh (30s).
 */
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { publicRoute } from '../middleware/require-capability'
import { prisma } from '../lib/prisma'

export const adminAlertsRouter = Router()
adminAlertsRouter.use(requireAuth)
adminAlertsRouter.use(requireRole('SUPER_ADMIN'))

type Severity = 'critical' | 'high' | 'warning' | 'info'
type Category = 'quota' | 'infra' | 'approvals' | 'commercial' | 'compliance'

interface Alert {
  id: string
  severity: Severity
  category: Category
  title: string
  description: string
  tenant: { id: string; name: string } | null
  resource: { type: string; id: string; name: string } | null
  createdAt: string
  ageMinutes: number
  actions: {
    label: string
    href?: string
    /** Ação inline: o frontend chama `method url` (com `body`) e remove/move o card ao concluir. */
    method?: 'POST' | 'PATCH'
    url?: string
    intent?: 'approve' | 'cancel'
    requiresReason?: boolean
    body?: Record<string, unknown>
  }[]
}

adminAlertsRouter.get('/active', publicRoute(), asyncHandler(async (_req: Request, res: Response) => {
  const alerts: Alert[] = []
  const now = Date.now()

  // ─── 1. Quota crítica/warning ─────────────────────────────────────────────
  const quotas = await prisma.apiQuota.findMany({
    where: { periodEnd: { gte: new Date() } },
    include: { integrador: { select: { id: true, name: true } } },
  })
  for (const q of quotas) {
    const visionPct  = q.staticVisionMonthlyLimit > 0 ? (q.staticVisionUsedThisMonth / q.staticVisionMonthlyLimit) * 100 : 0
    const streamPct  = q.streamingMinutesLimit > 0 ? (q.streamingMinutesUsed / q.streamingMinutesLimit) * 100 : 0
    if (visionPct >= 100) {
      alerts.push({
        id: `quota-vision-blocked-${q.integradorId}`,
        severity: 'critical',
        category: 'quota',
        title: `${q.integrador?.name ?? '—'} — Quota Vertex Vision em ${visionPct.toFixed(0)}%`,
        description: `BLOQUEADO. ${q.staticVisionUsedThisMonth.toLocaleString('pt-BR')} de ${q.staticVisionMonthlyLimit.toLocaleString('pt-BR')} requests usados.`,
        tenant: q.integrador,
        resource: { type: 'ApiQuota', id: q.id, name: 'Static Vision' },
        createdAt: new Date().toISOString(),
        ageMinutes: 0,
        actions: [
          { label: 'Ampliar quota', href: `/admin/tenants/${q.integradorId}?tab=config` },
          { label: 'Ver tenant',    href: `/admin/tenants/${q.integradorId}` },
        ],
      })
    } else if (visionPct >= 90) {
      alerts.push({
        id: `quota-vision-warning-${q.integradorId}`,
        severity: 'warning',
        category: 'quota',
        title: `${q.integrador?.name ?? '—'} — Quota Vertex em ${visionPct.toFixed(0)}%`,
        description: `Cuidado: aproximando do limite. Reset em ${q.periodEnd.toLocaleDateString('pt-BR')}.`,
        tenant: q.integrador,
        resource: { type: 'ApiQuota', id: q.id, name: 'Static Vision' },
        createdAt: new Date().toISOString(),
        ageMinutes: 0,
        actions: [
          { label: 'Ampliar agora', href: `/admin/tenants/${q.integradorId}?tab=config` },
        ],
      })
    }
    if (streamPct >= 100) {
      alerts.push({
        id: `quota-stream-blocked-${q.integradorId}`,
        severity: 'critical',
        category: 'quota',
        title: `${q.integrador?.name ?? '—'} — Streaming bloqueado (${streamPct.toFixed(0)}%)`,
        description: `Minutos de streaming esgotados.`,
        tenant: q.integrador,
        resource: { type: 'ApiQuota', id: q.id, name: 'Streaming' },
        createdAt: new Date().toISOString(),
        ageMinutes: 0,
        actions: [{ label: 'Ampliar', href: `/admin/tenants/${q.integradorId}?tab=config` }],
      })
    }
  }

  // ─── 2. Infra: Edge boxes offline > 10min ─────────────────────────────────
  const tenMinAgo = new Date(now - 10 * 60 * 1000)
  const staleEdges = await prisma.edgeNode.findMany({
    where: {
      status: { in: ['ONLINE', 'DEGRADED'] },
      lastHeartbeat: { lt: tenMinAgo },
    },
    select: {
      id: true, name: true, serialNumber: true, lastHeartbeat: true, status: true,
      site: { select: { name: true, clienteFinal: { select: { name: true, integradorId: true, integrador: { select: { id: true, name: true } } } } } },
    },
    take: 20,
  })
  for (const e of staleEdges) {
    const ageMin = e.lastHeartbeat ? Math.floor((now - new Date(e.lastHeartbeat).getTime()) / 60_000) : 999
    alerts.push({
      id: `edge-offline-${e.id}`,
      severity: ageMin > 60 ? 'high' : 'warning',
      category: 'infra',
      title: `Edge box "${e.name}" offline há ${ageMin}min`,
      description: `Site: ${e.site?.name ?? '—'} · Cliente: ${e.site?.clienteFinal?.name ?? '—'} · S/N ${e.serialNumber}`,
      tenant: e.site?.clienteFinal?.integrador ?? null,
      resource: { type: 'EdgeNode', id: e.id, name: e.name },
      createdAt: e.lastHeartbeat?.toISOString() ?? new Date().toISOString(),
      ageMinutes: ageMin,
      actions: [
        { label: 'Ver telemetria', href: `/admin/tenants/${e.site?.clienteFinal?.integradorId}?tab=boxes` },
      ],
    })
  }

  // Edges suspensas (ação manual recente, info)
  const suspended = await prisma.edgeNode.findMany({
    where: { status: 'SUSPENDED' as any },
    select: {
      id: true, name: true, updatedAt: true,
      site: { select: { clienteFinal: { select: { name: true, integradorId: true, integrador: { select: { id: true, name: true } } } } } },
    },
  }).catch(() => [])
  for (const e of suspended) {
    const ageMin = Math.floor((now - new Date(e.updatedAt).getTime()) / 60_000)
    alerts.push({
      id: `edge-suspended-${e.id}`,
      severity: 'info',
      category: 'infra',
      title: `Edge "${e.name}" suspensa`,
      description: `Cliente: ${e.site?.clienteFinal?.name ?? '—'} · suspensa há ${ageMin > 60 ? Math.floor(ageMin/60) + 'h' : ageMin + 'min'}`,
      tenant: e.site?.clienteFinal?.integrador ?? null,
      resource: { type: 'EdgeNode', id: e.id, name: e.name },
      createdAt: e.updatedAt.toISOString(),
      ageMinutes: ageMin,
      actions: [{ label: 'Reativar', href: `/admin/tenants/${e.site?.clienteFinal?.integradorId}?tab=boxes` }],
    })
  }

  // ─── 3. Aprovações pendentes > 48h ────────────────────────────────────────
  const fortyEightHoursAgo = new Date(now - 48 * 60 * 60 * 1000)
  const oldApprovals = await prisma.approvalRequest.findMany({
    where: { status: 'PENDING', createdAt: { lt: fortyEightHoursAgo } },
    take: 10,
  }).catch(() => [])
  for (const a of oldApprovals) {
    const ageMin = Math.floor((now - new Date(a.createdAt).getTime()) / 60_000)
    const days = Math.floor(ageMin / (60 * 24))
    const payload = a.payloadJson as any
    alerts.push({
      id: `approval-old-${a.id}`,
      severity: days > 5 ? 'high' : 'warning',
      category: 'approvals',
      title: `Aprovação pendente há ${days}d (${a.action})`,
      description: payload?.name ? `Recurso: ${payload.name}` : 'Aprovação aguardando decisão',
      tenant: payload?.integradorId ? { id: payload.integradorId, name: payload.clienteFinalName ?? '—' } : null,
      resource: { type: 'ApprovalRequest', id: a.id, name: a.action },
      createdAt: a.createdAt.toISOString(),
      ageMinutes: ageMin,
      actions: [
        { label: 'Aprovar', intent: 'approve', method: 'POST', url: `/approvals/${a.id}/approve` },
        { label: 'Cancelar aprovação', intent: 'cancel', method: 'POST', url: `/approvals/${a.id}/reject`, requiresReason: true },
        payload?.integradorId
          ? { label: 'Ver fila', href: `/admin/tenants/${payload.integradorId}?tab=approvals` }
          : { label: 'Ver fila', href: `/admin/comercial?tab=approvals` },
      ],
    })
  }

  // ─── SLA: Demos pendentes (lead NEW) > 1 dia útil aguardando aprovação ────
  // SLA de 1 dia útil = 24h em dias normais, ignora fim de semana grosseiramente
  const oneDayAgoSla = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const slaPending = await prisma.lead.findMany({
    where: { status: 'NEW', createdAt: { lt: oneDayAgoSla } },
    select: { id: true, contactName: true, companyName: true, createdAt: true },
    take: 5,
    orderBy: { createdAt: 'asc' },
  })
  for (const l of slaPending) {
    const ageMin = Math.floor((now - new Date(l.createdAt).getTime()) / 60_000)
    const days = Math.floor(ageMin / (60 * 24))
    alerts.push({
      id: `sla-demo-${l.id}`,
      severity: days > 2 ? 'critical' : 'high',
      category: 'approvals',
      title: `⚠ SLA estourado: demo de ${l.contactName} sem aprovação há ${days}d`,
      description: `Cliente espera resposta em 1 dia útil. ${l.companyName ?? 'sem empresa'}`,
      tenant: null,
      resource: { type: 'Lead', id: l.id, name: l.contactName },
      createdAt: l.createdAt.toISOString(),
      ageMinutes: ageMin,
      actions: [
        { label: 'Aprovar demo', intent: 'approve', method: 'POST', url: `/leads/${l.id}/invite` },
        { label: 'Cancelar aprovação', intent: 'cancel', method: 'PATCH', url: `/leads/${l.id}`, requiresReason: true, body: { status: 'LOST' } },
        { label: 'Ver demos', href: `/admin/comercial?tab=demos` },
      ],
    })
  }

  // ─── 4. Commercial: Leads novos > 24h sem contato ─────────────────────────
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000)
  const oldLeads = await prisma.lead.findMany({
    where: { status: 'NEW', createdAt: { lt: oneDayAgo } },
    take: 10,
  })
  for (const l of oldLeads) {
    const ageMin = Math.floor((now - new Date(l.createdAt).getTime()) / 60_000)
    const days = Math.floor(ageMin / (60 * 24))
    alerts.push({
      id: `lead-stale-${l.id}`,
      severity: days > 3 ? 'high' : 'warning',
      category: 'commercial',
      title: `Lead "${l.contactName}" sem contato há ${days}d`,
      description: `${l.companyName ?? l.contactEmail} · ${l.kind}`,
      tenant: null,
      resource: { type: 'Lead', id: l.id, name: l.contactName },
      createdAt: l.createdAt.toISOString(),
      ageMinutes: ageMin,
      actions: [
        { label: 'Aprovar demo', intent: 'approve', method: 'POST', url: `/leads/${l.id}/invite` },
        { label: 'Cancelar', intent: 'cancel', method: 'PATCH', url: `/leads/${l.id}`, requiresReason: true, body: { status: 'LOST' } },
        { label: 'Ver fila', href: `/admin/comercial?tab=approvals` },
      ],
    })
  }

  // ─── Sort: critical > high > warning > info; dentro do mesmo, mais antigo primeiro
  const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, warning: 2, info: 3 }
  alerts.sort((a, b) => {
    if (SEV_ORDER[a.severity] !== SEV_ORDER[b.severity]) return SEV_ORDER[a.severity] - SEV_ORDER[b.severity]
    return b.ageMinutes - a.ageMinutes
  })

  // ─── Counts por severidade ────────────────────────────────────────────────
  const counts: Record<Severity, number> = { critical: 0, high: 0, warning: 0, info: 0 }
  const byCategory: Record<Category, number> = { quota: 0, infra: 0, approvals: 0, commercial: 0, compliance: 0 }
  for (const a of alerts) {
    counts[a.severity]++
    byCategory[a.category]++
  }

  res.json({ alerts, total: alerts.length, counts, byCategory })
}))
