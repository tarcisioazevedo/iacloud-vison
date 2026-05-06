/**
 * Health Alerts endpoints.
 *
 * INTEGRADOR:
 *   GET  /me/integrador/health-alerts            → ativos (não resolvidos) do tenant
 *   POST /me/integrador/health-alerts/:id/ack    → marca como visto
 *
 * SUPER_ADMIN:
 *   GET  /admin/health-alerts                    → todos (com filtros)
 *   POST /admin/health-alerts/cron-run           → força cron
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { resolveIntegradorId } from '../middleware/tenant-context'
import {
  listActiveAlerts, listAllAlerts, acknowledgeAlert,
  processHealthAlerts,
} from '../services/health-alert.service'

// ── /me/integrador/health-alerts ───────────────────────────────────────
export const meHealthAlertsRouter = Router()
meHealthAlertsRouter.use(requireAuth)
meHealthAlertsRouter.use(requireRole('INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'SUPER_ADMIN', 'ADMIN_GLOBAL'))

meHealthAlertsRouter.get('/', async (req: Request, res: Response) => {
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) return res.status(400).json({ error: 'no_tenant_context' })
  const alerts = await listActiveAlerts(integradorId)
  res.json({ alerts, total: alerts.length })
})

meHealthAlertsRouter.post('/:id/ack', async (req: Request, res: Response) => {
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) return res.status(400).json({ error: 'no_tenant_context' })
  // Validar ownership
  const alertId = String(req.params.id)
  const alert = await prisma.healthAlert.findUnique({
    where: { id: alertId },
    select: { integradorId: true },
  })
  if (!alert) return res.status(404).json({ error: 'alert_not_found' })
  if (alert.integradorId !== integradorId && req.jwtPayload?.role !== 'SUPER_ADMIN' && req.jwtPayload?.role !== 'ADMIN_GLOBAL') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const updated = await acknowledgeAlert(alertId, String(req.jwtPayload!.sub))
  res.json(updated)
})

// ── /admin/health-alerts ───────────────────────────────────────────────
export const adminHealthAlertsRouter = Router()
adminHealthAlertsRouter.use(requireAuth)
adminHealthAlertsRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

adminHealthAlertsRouter.get('/', async (req, res) => {
  const integradorId = typeof req.query.integradorId === 'string' ? String(req.query.integradorId) : undefined
  const level = typeof req.query.level === 'string' ? String(req.query.level) : undefined
  const unresolved = req.query.unresolved === 'true'
  const limit = req.query.limit ? Number(req.query.limit) : undefined
  const alerts = await listAllAlerts({ integradorId, level, unresolved, limit })
  res.json({ alerts, total: alerts.length })
})

adminHealthAlertsRouter.post('/cron-run', async (req, res) => {
  const result = await processHealthAlerts()
  await prisma.auditLog.create({
    data: {
      superAdminId: req.jwtPayload!.sub,
      action: 'HEALTH_ALERT_CRON_FORCED',
      resource: 'HealthAlert',
      metadataJson: result as any,
    },
  }).catch(() => { /* ignore */ })
  res.json(result)
})
