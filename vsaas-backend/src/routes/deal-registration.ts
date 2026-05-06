/**
 * Deal Registration endpoints.
 *
 * INTEGRADOR:
 *   GET  /me/integrador/deal-registration              → meus deals
 *   GET  /me/integrador/deal-registration/check?cnpj=  → verifica se CNPJ está livre
 *   POST /me/integrador/deal-registration              → cria novo
 *   POST /me/integrador/deal-registration/:id/activity → registra atividade (+15d)
 *   POST /me/integrador/deal-registration/:id/lost     → marca como perdido
 *
 * SUPER_ADMIN:
 *   GET    /admin/deal-registration                    → todos (filtros)
 *   POST   /admin/deal-registration/:id/approve        → aprovar (ativa exclusividade 30d)
 *   POST   /admin/deal-registration/:id/reject         → rejeitar
 *   POST   /admin/deal-registration/:id/won            → marcar como contrato fechado
 *   POST   /admin/deal-registration/cron-run           → força expirar
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { resolveIntegradorId } from '../middleware/tenant-context'
import {
  createDealRegistration, approveDeal, rejectDeal, markWon, markLost,
  registerActivity, listMyDeals, listAllDeals, checkCnpjExclusivity,
  expireOldDeals,
} from '../services/deal-registration.service'

function uid(req: Request): string | undefined { return req.jwtPayload?.sub }
async function audit(req: Request, action: string, resourceId: string, metadata?: any, integradorId?: string) {
  try {
    await prisma.auditLog.create({
      data: {
        superAdminId: req.jwtPayload?.role === 'SUPER_ADMIN' ? uid(req) : undefined,
        integradorId: integradorId ?? (req.jwtPayload?.role !== 'SUPER_ADMIN' ? resolveIntegradorId(req) ?? undefined : undefined),
        action, resource: 'DealRegistration', resourceId,
        metadataJson: metadata ?? undefined,
      },
    })
  } catch (err) { /* best-effort */ }
}
function zodErr(res: Response, parsed: z.SafeParseError<any>) {
  return res.status(400).json({
    error: 'invalid_input',
    issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  })
}

// ── /me/integrador/deal-registration ────────────────────────────────────
export const meDealRegistrationRouter = Router()
meDealRegistrationRouter.use(requireAuth)
meDealRegistrationRouter.use(requireRole('INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'SUPER_ADMIN', 'ADMIN_GLOBAL'))

meDealRegistrationRouter.get('/', async (req, res) => {
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) return res.status(400).json({ error: 'no_tenant_context' })
  const status = typeof req.query.status === 'string' ? String(req.query.status) : undefined
  res.json(await listMyDeals(integradorId, { status }))
})

meDealRegistrationRouter.get('/check', async (req, res) => {
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) return res.status(400).json({ error: 'no_tenant_context' })
  const cnpj = typeof req.query.cnpj === 'string' ? String(req.query.cnpj) : ''
  if (!cnpj) return res.status(400).json({ error: 'cnpj_required' })
  const result = await checkCnpjExclusivity(cnpj, integradorId)
  res.json(result)
})

const CreateSchema = z.object({
  cnpj: z.string().min(11),
  companyName: z.string().min(1),
  companyTradeName: z.string().optional(),
  contactName: z.string().min(1),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  estimatedMrrBrl: z.number().nonnegative().optional(),
  notes: z.string().optional(),
})

meDealRegistrationRouter.post('/', async (req, res) => {
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) return res.status(400).json({ error: 'no_tenant_context' })
  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)

  try {
    const deal = await createDealRegistration({ ...parsed.data, integradorId })
    await audit(req, 'DEAL_REGISTRATION_CREATED', deal.id, { cnpj: deal.cnpj }, integradorId)
    res.status(201).json(deal)
  } catch (err: any) {
    if (err.code === 'invalid_cnpj') return res.status(400).json({ error: 'invalid_cnpj' })
    if (err.code === 'cnpj_already_locked') {
      return res.status(409).json({
        error: 'cnpj_already_locked',
        ownedBy: err.ownedBy,
        message: `CNPJ já em deal aprovado de outro integrador (${err.ownedBy?.integradorName}). Bloqueado até ${err.ownedBy?.expiresAt?.toISOString()?.slice(0, 10) ?? 'definir'}.`,
      })
    }
    if (err.code === 'own_deal_exists') {
      return res.status(409).json({ error: 'own_deal_exists', existing: err.existing })
    }
    throw err
  }
})

meDealRegistrationRouter.post('/:id/activity', async (req, res) => {
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) return res.status(400).json({ error: 'no_tenant_context' })
  const dealId = String(req.params.id)
  const deal = await prisma.dealRegistration.findUnique({ where: { id: dealId }, select: { integradorId: true } })
  if (!deal) return res.status(404).json({ error: 'deal_not_found' })
  if (deal.integradorId !== integradorId && req.jwtPayload?.role !== 'SUPER_ADMIN' && req.jwtPayload?.role !== 'ADMIN_GLOBAL') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const updated = await registerActivity(dealId)
  if (!updated) return res.status(400).json({ error: 'deal_not_active' })
  await audit(req, 'DEAL_REGISTRATION_ACTIVITY', dealId, undefined, integradorId)
  res.json(updated)
})

meDealRegistrationRouter.post('/:id/lost', async (req, res) => {
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) return res.status(400).json({ error: 'no_tenant_context' })
  const dealId = String(req.params.id)
  const deal = await prisma.dealRegistration.findUnique({ where: { id: dealId }, select: { integradorId: true } })
  if (!deal) return res.status(404).json({ error: 'deal_not_found' })
  if (deal.integradorId !== integradorId && req.jwtPayload?.role !== 'SUPER_ADMIN' && req.jwtPayload?.role !== 'ADMIN_GLOBAL') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const updated = await markLost(dealId)
  await audit(req, 'DEAL_REGISTRATION_LOST', dealId, undefined, integradorId)
  res.json(updated)
})

// ── /admin/deal-registration ────────────────────────────────────────────
export const adminDealRegistrationRouter = Router()
adminDealRegistrationRouter.use(requireAuth)
adminDealRegistrationRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

adminDealRegistrationRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? String(req.query.status) : undefined
  const integradorId = typeof req.query.integradorId === 'string' ? String(req.query.integradorId) : undefined
  const cnpj = typeof req.query.cnpj === 'string' ? String(req.query.cnpj) : undefined
  res.json(await listAllDeals({ status, integradorId, cnpj }))
})

adminDealRegistrationRouter.post('/:id/approve', async (req, res) => {
  try {
    const updated = await approveDeal(String(req.params.id), uid(req)!)
    await audit(req, 'DEAL_REGISTRATION_APPROVED', updated.id, { cnpj: updated.cnpj, expiresAt: updated.expiresAt })
    res.json(updated)
  } catch (err: any) {
    if (err.code === 'deal_not_found') return res.status(404).json({ error: 'deal_not_found' })
    if (err.code === 'not_pending') return res.status(409).json({ error: 'not_pending', current: err.current })
    if (err.code === 'cnpj_already_locked_at_approval') {
      return res.status(409).json({ error: 'cnpj_already_locked_at_approval', ownedBy: err.ownedBy })
    }
    throw err
  }
})

const RejectSchema = z.object({ reason: z.string().optional() })
adminDealRegistrationRouter.post('/:id/reject', async (req, res) => {
  const parsed = RejectSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  try {
    const updated = await rejectDeal(String(req.params.id), uid(req)!, parsed.data.reason)
    await audit(req, 'DEAL_REGISTRATION_REJECTED', updated.id, { reason: parsed.data.reason })
    res.json(updated)
  } catch (err: any) {
    if (err.code === 'deal_not_found') return res.status(404).json({ error: 'deal_not_found' })
    throw err
  }
})

const WonSchema = z.object({ convertedLeadId: z.string().optional() })
adminDealRegistrationRouter.post('/:id/won', async (req, res) => {
  const parsed = WonSchema.safeParse(req.body)
  if (!parsed.success) return zodErr(res, parsed)
  const updated = await markWon(String(req.params.id), parsed.data.convertedLeadId)
  await audit(req, 'DEAL_REGISTRATION_WON', updated.id, { leadId: parsed.data.convertedLeadId })
  res.json(updated)
})

adminDealRegistrationRouter.post('/cron-run', async (req, res) => {
  const r = await expireOldDeals()
  await audit(req, 'DEAL_REGISTRATION_CRON_FORCED', 'all', r)
  res.json(r)
})
