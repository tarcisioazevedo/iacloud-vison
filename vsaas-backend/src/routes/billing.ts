/**
 * Billing Routes — Sprint 4 do plano docs/STORAGE-ARCHITECTURE.md
 *
 * Endpoints para os 3 papéis verem o painel de margem com a lente correta:
 *
 *   GET /billing/platform              — visão global (SUPER_ADMIN)
 *   GET /billing/integrador/:id?       — visão integrador (INT_ADMIN ou SA com :id)
 *   GET /billing/me                     — versão "minhas métricas" — auto-resolve role
 *   GET /billing/snapshots/:id          — drill-down de um snapshot específico
 *   GET /billing/snapshots/:id/items    — lineItems (cliente/site/câmera)
 *   POST /billing/run-daily             — força tick (SUPER_ADMIN, debug)
 *   POST /billing/run-reconciliation    — força tick reconciliation (SUPER_ADMIN)
 */
import { Router, type Request, type Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { logger } from '../lib/logger'
import { storageBilling } from '../services/storage-billing.service'
import { storageBillingReconciliation } from '../services/storage-billing-reconciliation.service'

export const billingRouter = Router()

function isSuperAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
}
function isIntegradorAdmin(role: string): boolean {
  return role === 'INTEGRADOR_ADMIN' || isSuperAdmin(role)
}

// ── Helpers de formatação ────────────────────────────────────────────────────

function formatSnapshot(s: any, includeIacloudCost: boolean) {
  const base = {
    id:                  s.id,
    bucketId:            s.bucketId,
    integradorId:        s.integradorId,
    bucketName:          s.bucket?.name,
    integradorName:      s.integrador?.name,
    periodYearMonth:     s.periodYearMonth,
    periodStart:         s.periodStart,
    periodEnd:           s.periodEnd,
    avgStorageBytes:     s.avgStorageBytes.toString(),
    avgStorageGb:        Number((Number(s.avgStorageBytes) / (1024 ** 3)).toFixed(3)),
    classAOpsTotal:      s.classAOpsTotal.toString(),
    classBOpsTotal:      s.classBOpsTotal.toString(),
    usdBrlRate:          Number(s.usdBrlRate),
    priceToIntegradorBrl: Number(s.priceToIntegradorBrl),
    status:              s.status,
    generatedAt:         s.generatedAt,
    finalizedAt:         s.finalizedAt,
  }
  if (!includeIacloudCost) return base   // INT/CF não veem o custo R2 nem margem fabricante
  return {
    ...base,
    costStorageUsd:        Number(s.costStorageUsd),
    costClassAUsd:         Number(s.costClassAUsd),
    costClassBUsd:         Number(s.costClassBUsd),
    costTotalUsd:          Number(s.costTotalUsd),
    costTotalBrl:          Number(s.costTotalBrl),
    marginIACloudBrl:      Number(s.marginIACloudBrl),
    marginIACloudPct:      Number(s.marginIACloudPct),
    cloudflareInvoiceUsd:  s.cloudflareInvoiceUsd != null ? Number(s.cloudflareInvoiceUsd) : null,
    reconciliationDriftPct: s.reconciliationDriftPct != null ? Number(s.reconciliationDriftPct) : null,
    reconciledAt:          s.reconciledAt,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /billing/platform — Super Admin
// ═════════════════════════════════════════════════════════════════════════════
billingRouter.get('/platform', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!isSuperAdmin(req.jwtPayload.role)) throw new ForbiddenError('Apenas SUPER_ADMIN')

  const yearMonth = (req.query.period as string) ??
    `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`

  const snapshots = await prisma.storageBillingSnapshot.findMany({
    where: { periodYearMonth: yearMonth },
    include: {
      bucket:     { select: { name: true } },
      integrador: { select: { name: true, email: true } },
    },
    orderBy: { priceToIntegradorBrl: 'desc' },
  })

  // Totais consolidados
  const totals = snapshots.reduce((acc, s) => ({
    receitaBrl:        acc.receitaBrl + Number(s.priceToIntegradorBrl),
    custoR2Brl:        acc.custoR2Brl + Number(s.costTotalBrl),
    margemBrl:         acc.margemBrl  + Number(s.marginIACloudBrl),
    integradores:      acc.integradores.add(s.integradorId),
  }), { receitaBrl: 0, custoR2Brl: 0, margemBrl: 0, integradores: new Set<string>() })

  const margemPct = totals.receitaBrl > 0 ? (totals.margemBrl / totals.receitaBrl) * 100 : 0

  res.json({
    period: yearMonth,
    totals: {
      receitaBrl: Number(totals.receitaBrl.toFixed(2)),
      custoR2Brl: Number(totals.custoR2Brl.toFixed(2)),
      margemBrl:  Number(totals.margemBrl.toFixed(2)),
      margemPct:  Number(margemPct.toFixed(2)),
      integradoresAtivos: totals.integradores.size,
    },
    snapshots: snapshots.map(s => formatSnapshot(s, true)),
  })
}))

// ═════════════════════════════════════════════════════════════════════════════
// GET /billing/integrador/:id?  — Integrador OU SA com :id
// Vê snapshots do próprio tenant (sem custo R2 nem margem fabricante)
// ═════════════════════════════════════════════════════════════════════════════
billingRouter.get('/integrador/:id?', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const p = req.jwtPayload
  let integradorId: string | null = null

  if (isSuperAdmin(p.role)) {
    integradorId = (req.params.id as string) ?? (req.query.integradorId as string) ?? null
    if (!integradorId) throw new ValidationError('integradorId requerido')
  } else if (isIntegradorAdmin(p.role)) {
    integradorId = p.integradorId ?? null
    if (req.params.id && req.params.id !== integradorId) {
      throw new ForbiddenError('Você só pode ver o seu próprio tenant')
    }
  } else {
    throw new ForbiddenError('Apenas INTEGRADOR_ADMIN ou SUPER_ADMIN')
  }

  const yearMonth = (req.query.period as string) ??
    `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`

  const [snapshot, contract, lineItems] = await Promise.all([
    prisma.storageBillingSnapshot.findFirst({
      where:   { integradorId: integradorId!, periodYearMonth: yearMonth },
      include: { bucket: { select: { name: true } }, integrador: { select: { name: true } } },
    }),
    prisma.integradorRetentionContract.findUnique({
      where:   { integradorId: integradorId! },
      include: { defaultPlano: { select: { slug: true, name: true } } },
    }),
    // Itens agregados por cliente final (para lista do drill-down)
    integradorId ? (async () => {
      const snap = await prisma.storageBillingSnapshot.findFirst({
        where: { integradorId: integradorId!, periodYearMonth: yearMonth },
        select: { id: true },
      })
      if (!snap) return []
      return prisma.storageBillingLineItem.findMany({
        where: { snapshotId: snap.id, scope: 'CLIENTE_FINAL' },
        orderBy: { totalCostBrl: 'desc' },
      })
    })() : Promise.resolve([]),
  ])

  // Pedidos pendentes do tenant
  const pendingRequests = await prisma.retentionUpgradeRequest.count({
    where: {
      status: 'PENDING_INTEGRADOR',
      OR: [
        { camera: { site: { clienteFinal: { integradorId: integradorId! } } } },
        { clienteFinal: { integradorId: integradorId! } },
      ],
    },
  })

  // INT vê preço atacado (que ele paga IACloud) + preço CF (que ele cobra) + sua margem.
  // NÃO vê custo R2 nem margem IACloud (a sua margem como fabricante é segredo).
  const formattedSnap = snapshot ? formatSnapshot(snapshot, isSuperAdmin(p.role)) : null

  res.json({
    period: yearMonth,
    integradorId,
    snapshot: formattedSnap,
    contract: contract ? {
      id:                          contract.id,
      defaultPlano:                contract.defaultPlano,
      markupPct:                   Number(contract.markupPct),
      autoApproveUpgradeLimitBrl:  contract.autoApproveUpgradeLimitBrl ? Number(contract.autoApproveUpgradeLimitBrl) : null,
      autoApproveResolutionMax:    contract.autoApproveResolutionMax,
      autoApproveRetainDaysMax:    contract.autoApproveRetainDaysMax,
      notifyAllChanges:            contract.notifyAllChanges,
    } : null,
    pendingRequests,
    clientes: lineItems.map(li => ({
      clienteFinalId:         li.scopeId,
      avgStorageBytes:        li.avgStorageBytes.toString(),
      avgStorageGb:           Number((Number(li.avgStorageBytes) / (1024 ** 3)).toFixed(3)),
      priceToIntegradorBrl:   Number(li.priceToIntegradorBrl),
      priceToClienteFinalBrl: Number(li.priceToClienteFinalBrl),
      marginIntegradorBrl:    Number(li.marginIntegradorBrl),
    })),
  })
}))

// ═════════════════════════════════════════════════════════════════════════════
// GET /billing/me — auto-resolve por role
// ═════════════════════════════════════════════════════════════════════════════
billingRouter.get('/me', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const p = req.jwtPayload

  if (p.role.startsWith('CLIENTE_')) {
    // CF: já tem em /storage/me/usage no Sprint 1 — billing apenas confirma plano e custo estimado
    if (!p.clienteFinalId) throw new ForbiddenError('clienteFinalId ausente no token')
    const cf = await prisma.clienteFinal.findUnique({
      where:   { id: p.clienteFinalId },
      include: {
        retentionPlanDefault: { select: { slug: true, name: true, retainDays: true, resolution: true, pricePerCameraMonthUsd: true } },
        integrador: { select: { id: true, name: true, retentionContract: { select: { markupPct: true } } } },
      },
    })
    if (!cf) throw new NotFoundError('Cliente final não encontrado')

    return res.json({
      role: p.role,
      clienteFinalId: cf.id,
      retentionPlanDefault: cf.retentionPlanDefault,
      markupIntegrador: cf.integrador?.retentionContract?.markupPct
        ? Number(cf.integrador.retentionContract.markupPct) : 30,
      // outros campos consultar via /storage/me/usage do Sprint 1
    })
  }

  if (isIntegradorAdmin(p.role) && p.integradorId) {
    return res.redirect(307, `/billing/integrador/${p.integradorId}`)
  }

  if (isSuperAdmin(p.role)) {
    return res.redirect(307, '/billing/platform')
  }

  throw new ForbiddenError(`Role '${p.role}' sem acesso a billing`)
}))

// ═════════════════════════════════════════════════════════════════════════════
// GET /billing/snapshots/:id — drill-down de 1 snapshot
// ═════════════════════════════════════════════════════════════════════════════
billingRouter.get('/snapshots/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const p = req.jwtPayload
  const snap = await prisma.storageBillingSnapshot.findUnique({
    where: { id: String(req.params.id) },
    include: {
      bucket:     { select: { name: true, integradorId: true } },
      integrador: { select: { name: true } },
    },
  })
  if (!snap) throw new NotFoundError('Snapshot não encontrado')

  // RBAC
  if (!isSuperAdmin(p.role)
      && !(isIntegradorAdmin(p.role) && p.integradorId === snap.integradorId)) {
    throw new ForbiddenError('Sem acesso a este snapshot')
  }

  res.json({ snapshot: formatSnapshot(snap, isSuperAdmin(p.role)) })
}))

// ═════════════════════════════════════════════════════════════════════════════
// GET /billing/snapshots/:id/items — lineItems (com filtro por scope)
// ═════════════════════════════════════════════════════════════════════════════
billingRouter.get('/snapshots/:id/items', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const p = req.jwtPayload
  const snapshotId = String(req.params.id)
  const scope = req.query.scope as string | undefined  // CLIENTE_FINAL | SITE | CAMERA

  const snap = await prisma.storageBillingSnapshot.findUnique({
    where:  { id: snapshotId },
    select: { id: true, integradorId: true },
  })
  if (!snap) throw new NotFoundError('Snapshot não encontrado')

  if (!isSuperAdmin(p.role)
      && !(isIntegradorAdmin(p.role) && p.integradorId === snap.integradorId)) {
    throw new ForbiddenError('Sem acesso a este snapshot')
  }

  const where: Prisma.StorageBillingLineItemWhereInput = {
    snapshotId,
    ...(scope && ['CLIENTE_FINAL', 'SITE', 'CAMERA'].includes(scope)
      ? { scope: scope as 'CLIENTE_FINAL' | 'SITE' | 'CAMERA' }
      : {}),
  }
  const items = await prisma.storageBillingLineItem.findMany({
    where, orderBy: { totalCostBrl: 'desc' },
  })

  const includeIacloudCost = isSuperAdmin(p.role)
  res.json({
    snapshotId,
    items: items.map(i => ({
      id:           i.id,
      scope:        i.scope,
      scopeId:      i.scopeId,
      parentScopeId: i.parentScopeId,
      avgStorageGb: Number((Number(i.avgStorageBytes) / (1024 ** 3)).toFixed(3)),
      classAOps:    i.classAOps.toString(),
      classBOps:    i.classBOps.toString(),
      ...(includeIacloudCost ? {
        costR2Brl:        Number(i.costR2Brl),
        vpsCostBrl:       Number(i.vpsCostBrl),
        totalCostBrl:     Number(i.totalCostBrl),
        marginIACloudBrl: Number(i.marginIACloudBrl),
      } : {}),
      priceToIntegradorBrl:   Number(i.priceToIntegradorBrl),
      priceToClienteFinalBrl: Number(i.priceToClienteFinalBrl),
      marginIntegradorBrl:    Number(i.marginIntegradorBrl),
      captureMode:    i.captureMode,
      resolution:     i.resolution,
      retentionDays:  i.retentionDays,
      isOutlier:      i.isOutlier,
      outlierReason:  i.outlierReason,
    })),
  })
}))

// ═════════════════════════════════════════════════════════════════════════════
// POST /billing/run-daily   — força tick imediato (SUPER_ADMIN, debug)
// POST /billing/run-reconciliation — força reconciliação (SUPER_ADMIN, debug)
// ═════════════════════════════════════════════════════════════════════════════

billingRouter.post('/run-daily', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!isSuperAdmin(req.jwtPayload.role)) throw new ForbiddenError('Apenas SUPER_ADMIN')
  await storageBilling.runDailyOnce()
  logger.info({ by: req.jwtPayload.sub }, 'billing_run_daily_manual')
  res.json({ ok: true, status: storageBilling.status() })
}))

billingRouter.post('/run-reconciliation', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!isSuperAdmin(req.jwtPayload.role)) throw new ForbiddenError('Apenas SUPER_ADMIN')
  await storageBillingReconciliation.runOnce()
  logger.info({ by: req.jwtPayload.sub }, 'billing_run_reconciliation_manual')
  res.json({ ok: true, status: storageBillingReconciliation.status() })
}))
