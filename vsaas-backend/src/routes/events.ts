/**
 * events.ts — Feed de eventos IA em tempo real.
 * GET /events/feed?since=ISO&limit=50&cameraId=X
 */
import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { ForbiddenError } from '../lib/errors'

export const eventsRouter = Router()

eventsRouter.get('/feed', requireAuth, async (req, res) => {
  const p           = (req as any).auth
  const limit       = Math.min(Number(req.query.limit ?? 50), 200)
  const since       = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 24 * 60 * 60_000)
  const cameraIdQ   = req.query.cameraId as string | undefined

  // Restrição por role
  const where: any = { capturedAt: { gte: since } }

  if (p.role.startsWith('CLIENTE_')) {
    if (!p.clienteFinalId) throw new ForbiddenError('clienteFinalId ausente')
    const sites = await prisma.site.findMany({
      where: { clienteFinalId: p.clienteFinalId },
      select: { id: true },
    })
    const camIds = await prisma.camera.findMany({
      where: { siteId: { in: sites.map(s => s.id) } },
      select: { id: true },
    })
    where.cameraId = { in: camIds.map(c => c.id) }
  } else if (p.role.startsWith('INTEGRADOR_')) {
    const clients = await prisma.clienteFinal.findMany({
      where: { integradorId: p.integradorId },
      select: { id: true },
    })
    const sites = await prisma.site.findMany({
      where: { clienteFinalId: { in: clients.map(c => c.id) } },
      select: { id: true },
    })
    const camIds = await prisma.camera.findMany({
      where: { siteId: { in: sites.map(s => s.id) } },
      select: { id: true },
    })
    where.cameraId = { in: camIds.map(c => c.id) }
  }
  // SUPER_ADMIN/ADMIN_GLOBAL: sem filtro adicional

  if (cameraIdQ) where.cameraId = cameraIdQ

  const events = await prisma.analyticsEvent.findMany({
    where,
    orderBy: { capturedAt: 'desc' },
    take:    limit,
    select: {
      id: true, eventType: true, severity: true, model: true,
      capturedAt: true, processedAt: true,
      personCount: true, vehicleCount: true,
      labelsJson: true,
      rawAnnotationsJson: true,
      camera: {
        select: {
          id: true, name: true,
          site: { select: { name: true, clienteFinal: { select: { name: true } } } },
        },
      },
    },
  })

  const formatted = events.map(e => ({
    id:           e.id,
    eventType:    e.eventType,
    severity:     e.severity,
    model:        e.model,
    capturedAt:   e.capturedAt,
    personCount:  e.personCount,
    vehicleCount: e.vehicleCount,
    labels:       e.labelsJson ?? [],
    description:  (e.rawAnnotationsJson as any)?.geminiDescription ?? null,
    camera: e.camera ? {
      id:      e.camera.id,
      name:    e.camera.name,
      site:    e.camera.site?.name ?? null,
      cliente: e.camera.site?.clienteFinal?.name ?? null,
    } : null,
  }))

  res.json({ events: formatted, count: formatted.length, since })
})
