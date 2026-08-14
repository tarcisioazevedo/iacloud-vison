/**
 * me-integrador-plan.ts — integrador consulta seu plano + solicita upgrade.
 *
 *   GET    /me/integrador/plan                    plano atual + uso + trial
 *   GET    /me/integrador/plan/available          planos públicos pra comparar
 *   POST   /me/integrador/plan/upgrade-request    cria solicitação de upgrade
 *   GET    /me/integrador/plan/upgrade-requests   lista das minhas solicitações
 */
import { Router } from 'express'
import { publicRoute } from '../middleware/require-capability'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'

export const meIntegradorPlanRouter = Router()
meIntegradorPlanRouter.use(requireAuth)

function assertIntegradorScope(role?: string, integradorId?: string): string {
  if (!integradorId) throw new ForbiddenError('Sem escopo de integrador')
  if (role !== 'INTEGRADOR_ADMIN' && role !== 'INTEGRADOR_TECNICO') {
    throw new ForbiddenError('Apenas INTEGRADOR_ADMIN ou INTEGRADOR_TECNICO')
  }
  return integradorId
}

const UpgradeRequestSchema = z.object({
  toPlanId: z.string().uuid(),
  reason:   z.string().max(1000).optional(),
})

// ── GET /me/integrador/plan ────────────────────────────────────────────────

meIntegradorPlanRouter.get('/plan',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integId = assertIntegradorScope(req.jwtPayload?.role, req.jwtPayload?.integradorId)

    const integ = await prisma.integrador.findUnique({
      where: { id: integId },
      select: {
        id: true, name: true, tradeName: true,
        planId: true, planActivatedAt: true, pricingVersion: true,
        trialEndsAt: true, trialActivatedAt: true,
        maxClientesFinaisOverride: true, maxCamerasOverride: true,
        plan: {
          select: {
            id: true, slug: true, name: true, tagline: true,
            priceMonthly: true, priceMonuv: true,
            maxClientesFinais: true, maxCameras: true,
            extraClientePriceBrl: true, extraCameraPriceBrl: true,
            isTrial: true, trialDays: true, enforcementMode: true,
            pricingVersion: true, accent: true, highlights: true, recommended: true,
          },
        },
      },
    })
    if (!integ) throw new NotFoundError('Integrador não encontrado')

    // Uso atual: clientes ativos + câmeras ativas
    const [clientesAtivos, camerasAtivas] = await Promise.all([
      prisma.clienteFinal.count({ where: { integradorId: integId, active: true } }),
      prisma.camera.count({
        where: {
          active: true,
          site: { clienteFinal: { integradorId: integId, active: true } },
        },
      }),
    ])

    // Limites efetivos (override comercial sobrescreve plano)
    const limitClientes = integ.maxClientesFinaisOverride ?? integ.plan?.maxClientesFinais ?? null
    const limitCameras  = integ.maxCamerasOverride        ?? integ.plan?.maxCameras        ?? null

    // Trial countdown
    const now = Date.now()
    const trialDaysLeft = integ.trialEndsAt
      ? Math.max(0, Math.ceil((integ.trialEndsAt.getTime() - now) / (24 * 3600 * 1000)))
      : null
    const trialActive = !!(integ.plan?.isTrial && integ.trialEndsAt && integ.trialEndsAt.getTime() > now)

    // Estimativa de adicionais (soft cap)
    const clientesExcedidos = limitClientes != null && clientesAtivos > limitClientes
      ? clientesAtivos - limitClientes : 0
    const camerasExcedidas  = limitCameras  != null && camerasAtivas  > limitCameras
      ? camerasAtivas  - limitCameras  : 0
    const extraClienteBrl = Number(integ.plan?.extraClientePriceBrl ?? 0) * clientesExcedidos
    const extraCameraBrl  = Number(integ.plan?.extraCameraPriceBrl  ?? 0) * camerasExcedidas
    const totalMensalidadeBrl = Number(integ.plan?.priceMonthly ?? 0) + extraClienteBrl + extraCameraBrl

    res.json({
      integrador: {
        id: integ.id,
        name: integ.tradeName ?? integ.name,
        pricingVersion: integ.pricingVersion,
      },
      plan: integ.plan,
      planActivatedAt: integ.planActivatedAt,
      trial: trialActive ? {
        endsAt:       integ.trialEndsAt,
        daysLeft:     trialDaysLeft,
        activatedAt:  integ.trialActivatedAt,
      } : null,
      usage: {
        clientesAtivos,
        clientesLimit: limitClientes,
        clientesPct:   limitClientes ? Math.min(100, Math.round(clientesAtivos / limitClientes * 100)) : null,
        camerasAtivas,
        camerasLimit:  limitCameras,
        camerasPct:    limitCameras  ? Math.min(100, Math.round(camerasAtivas  / limitCameras  * 100)) : null,
      },
      adicionais: {
        clientesExcedidos,
        camerasExcedidas,
        extraClienteBrl: Number(extraClienteBrl.toFixed(2)),
        extraCameraBrl:  Number(extraCameraBrl.toFixed(2)),
      },
      cobrancaPrevistaMensalBrl: Number(totalMensalidadeBrl.toFixed(2)),
    })
  }),
)

// ── GET /me/integrador/plan/available ──────────────────────────────────────

meIntegradorPlanRouter.get('/plan/available',
  publicRoute(),
  asyncHandler(async (req, res) => {
    assertIntegradorScope(req.jwtPayload?.role, req.jwtPayload?.integradorId)

    const plans = await prisma.platformPlan.findMany({
      where: {
        tenantId: null,
        archived: false,
        publicVisible: true,
      },
      orderBy: { displayOrder: 'asc' },
      select: {
        id: true, slug: true, name: true, tagline: true,
        priceMonthly: true, priceMonuv: true,
        maxClientesFinais: true, maxCameras: true,
        extraClientePriceBrl: true, extraCameraPriceBrl: true,
        isTrial: true, trialDays: true,
        accent: true, highlights: true, recommended: true,
        connections: true, retention: true, totalAIs: true,
      },
    })

    res.json(plans)
  }),
)

// ── POST /me/integrador/plan/upgrade-request ───────────────────────────────

meIntegradorPlanRouter.post('/plan/upgrade-request',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integId = assertIntegradorScope(req.jwtPayload?.role, req.jwtPayload?.integradorId)
    if (req.jwtPayload?.role !== 'INTEGRADOR_ADMIN') {
      throw new ForbiddenError('Apenas INTEGRADOR_ADMIN pode solicitar upgrade')
    }

    const parsed = UpgradeRequestSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Payload inválido', { details: parsed.error.flatten() })
    const { toPlanId, reason } = parsed.data

    const integ = await prisma.integrador.findUnique({
      where: { id: integId },
      select: { id: true, planId: true },
    })
    if (!integ) throw new NotFoundError('Integrador não encontrado')

    const toPlan = await prisma.platformPlan.findUnique({
      where: { id: toPlanId },
      select: { id: true, archived: true, publicVisible: true, name: true },
    })
    if (!toPlan || toPlan.archived || !toPlan.publicVisible) {
      throw new ValidationError('Plano destino indisponível')
    }
    if (toPlan.id === integ.planId) {
      throw new ValidationError('Já é o plano atual')
    }

    // Evita múltiplas solicitações PENDING simultâneas
    const existing = await prisma.planUpgradeRequest.findFirst({
      where: { integradorId: integ.id, status: 'PENDING' },
    })
    if (existing) {
      throw new ValidationError('Você já tem uma solicitação pendente de upgrade — aguarde a decisão')
    }

    const upgrade = await prisma.planUpgradeRequest.create({
      data: {
        integradorId: integ.id,
        fromPlanId:   integ.planId,
        toPlanId:     toPlan.id,
        reason:       reason ?? null,
        status:       'PENDING',
      },
    })

    res.status(201).json({ ok: true, request: upgrade, toPlanName: toPlan.name })
  }),
)

// ── GET /me/integrador/plan/upgrade-requests ───────────────────────────────

meIntegradorPlanRouter.get('/plan/upgrade-requests',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integId = assertIntegradorScope(req.jwtPayload?.role, req.jwtPayload?.integradorId)

    const list = await prisma.planUpgradeRequest.findMany({
      where:   { integradorId: integId },
      orderBy: { createdAt: 'desc' },
      take:    20,
    })

    const planIds = Array.from(new Set([
      ...list.map(r => r.fromPlanId).filter(Boolean) as string[],
      ...list.map(r => r.toPlanId),
    ]))
    const plans = await prisma.platformPlan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, slug: true, name: true },
    })
    const planMap = new Map(plans.map(p => [p.id, p]))

    res.json(list.map(r => ({
      ...r,
      fromPlan: r.fromPlanId ? planMap.get(r.fromPlanId) ?? null : null,
      toPlan:   planMap.get(r.toPlanId) ?? null,
    })))
  }),
)
