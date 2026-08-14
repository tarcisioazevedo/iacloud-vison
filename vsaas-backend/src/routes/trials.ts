/**
 * Trial endpoints.
 *
 * SUPER_ADMIN:
 *   GET    /admin/trials                  → lista todos os trials (active/expired)
 *   POST   /admin/trials                  → cria trial num integrador existente
 *   POST   /admin/trials/:id/extend       → estende +N dias
 *   POST   /admin/trials/:id/convert      → converte em pagante (limpa flags trial)
 *   POST   /admin/trials/:id/cancel       → suspende
 *   POST   /admin/trials/cron-run         → força execução do cron (debug)
 *
 * INTEGRADOR:
 *   GET    /me/integrador/trial-status    → status detalhado pro banner
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { resolveIntegradorId } from '../middleware/tenant-context'
import { publicRoute } from '../middleware/require-capability'
import {
  startTrial, extendTrial, convertTrialToPaid, cancelTrial, getTrialStatus,
  processAllTrials,
} from '../services/trial.service'

// ── /admin/trials ───────────────────────────────────────────────────────
export const adminTrialsRouter = Router()
adminTrialsRouter.use(requireAuth)
adminTrialsRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

function uid(req: Request): string | undefined { return req.jwtPayload?.sub }
async function audit(req: Request, action: string, resourceId: string, metadata?: any) {
  try {
    await prisma.auditLog.create({
      data: {
        superAdminId: uid(req),
        action, resource: 'Integrador', resourceId,
        metadataJson: metadata ?? undefined,
      },
    })
  } catch { /* best-effort */ }
}

adminTrialsRouter.get('/',
  publicRoute(),
  async (_req, res) => {
  const trials = await prisma.integrador.findMany({
    where: { trialEndsAt: { not: null } },
    select: {
      id: true, name: true, tradeName: true, email: true,
      trialEndsAt: true, trialActivatedAt: true, trialMaxCameras: true,
      trialNotificationsSent: true, active: true,
      whitelabelTier: true, createdAt: true,
    },
    orderBy: { trialEndsAt: 'asc' },
  })

  const enriched = await Promise.all(trials.map(async t => {
    const status = await getTrialStatus(t.id)
    return {
      ...t,
      status: {
        isActive: status.isActive,
        daysRemaining: status.daysRemaining,
        camerasUsed: status.camerasUsed,
        camerasOverLimit: status.camerasOverLimit,
      },
    }
  }))
  res.json(enriched)
})

const StartSchema = z.object({
  integradorId: z.string().uuid(),
  days: z.number().int().min(1).max(365).optional(),
  maxCameras: z.number().int().min(1).max(100).optional(),
  activate: z.boolean().optional().default(true),
})
adminTrialsRouter.post('/',
  publicRoute(),
  async (req, res) => {
  const parse = StartSchema.safeParse(req.body)
  if (!parse.success) return res.status(400).json({ error: 'invalid_input', issues: parse.error.issues })
  const { integradorId, days, maxCameras, activate } = parse.data

  const exists = await prisma.integrador.findUnique({ where: { id: integradorId }, select: { id: true } })
  if (!exists) return res.status(404).json({ error: 'integrador_not_found' })

  const updated = await startTrial(integradorId, {
    days, maxCameras,
    activatedAt: activate ? new Date() : null,
  })
  await audit(req, 'TRIAL_STARTED', integradorId, { days, maxCameras })
  res.status(201).json({
    id: updated.id,
    trialEndsAt: updated.trialEndsAt,
    trialMaxCameras: updated.trialMaxCameras,
  })
})

const ExtendSchema = z.object({ addDays: z.number().int().min(1).max(180) })
adminTrialsRouter.post('/:id/extend',
  publicRoute(),
  async (req, res) => {
  const parse = ExtendSchema.safeParse(req.body)
  if (!parse.success) return res.status(400).json({ error: 'invalid_input' })
  try {
    const updated = await extendTrial(req.params.id, parse.data.addDays)
    await audit(req, 'TRIAL_EXTENDED', req.params.id, { addDays: parse.data.addDays })
    res.json({ trialEndsAt: updated.trialEndsAt })
  } catch (err: any) {
    if (err.message === 'integrador_not_in_trial') return res.status(400).json({ error: 'integrador_not_in_trial' })
    throw err
  }
})

adminTrialsRouter.post('/:id/convert',
  publicRoute(),
  async (req, res) => {
  const updated = await convertTrialToPaid(req.params.id)
  await audit(req, 'TRIAL_CONVERTED_TO_PAID', req.params.id)
  res.json({ id: updated.id, active: updated.active, trialEndsAt: updated.trialEndsAt })
})

adminTrialsRouter.post('/:id/cancel',
  publicRoute(),
  async (req, res) => {
  const updated = await cancelTrial(req.params.id)
  await audit(req, 'TRIAL_CANCELLED', req.params.id)
  res.json({ id: updated.id, active: updated.active })
})

adminTrialsRouter.post('/cron-run',
  publicRoute(),
  async (req, res) => {
  const result = await processAllTrials()
  await audit(req, 'TRIAL_CRON_FORCED', 'all', result)
  res.json(result)
})

// ── /me/integrador/trial-status ─────────────────────────────────────────
export const meTrialStatusRouter = Router()
meTrialStatusRouter.use(requireAuth)
meTrialStatusRouter.use(requireRole('INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'SUPER_ADMIN', 'ADMIN_GLOBAL'))

meTrialStatusRouter.get('/',
  publicRoute(),
  async (req: Request, res: Response) => {
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) {
    return res.status(400).json({ error: 'no_tenant_context' })
  }
  const status = await getTrialStatus(integradorId)
  res.json(status)
})
