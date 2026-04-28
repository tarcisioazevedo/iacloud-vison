/**
 * Integradores Routes — gerenciado pelo SuperAdmin.
 * CRUD completo + quota status.
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { requireAuth, requireRole } from '../middleware/auth'
import { quotaService } from '../services/quota.service'
import { prisma } from '../lib/prisma'
import { ValidationError, NotFoundError } from '../lib/errors'

export const integradorRouter = Router()
integradorRouter.use(requireAuth)
integradorRouter.use(requireRole('SUPER_ADMIN'))

const CreateSchema = z.object({
  name:          z.string().min(1),
  tradeName:     z.string().optional(),
  cnpj:          z.string().optional(),
  email:         z.string().email(),
  password:      z.string().min(8),
  phone:         z.string().optional(),
  gcpProjectId:  z.string().optional(),
  staticVisionMonthlyLimit:  z.number().int().positive().default(50000),
  streamingMinutesLimit:     z.number().positive().default(6000),
})

integradorRouter.post('/', async (req: Request, res: Response) => {
  const parse = CreateSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const b = parse.data

  const integrador = await prisma.integrador.create({
    data: {
      name:         b.name,
      tradeName:    b.tradeName ?? null,
      cnpj:         b.cnpj ?? null,
      email:        b.email,
      passwordHash: await bcrypt.hash(b.password, 12),
      phone:        b.phone ?? null,
      gcpProjectId: b.gcpProjectId ?? null,
    },
  })

  // Criar quota para o mês atual
  const now        = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  await prisma.apiQuota.create({
    data: {
      integradorId:             integrador.id,
      staticVisionMonthlyLimit: b.staticVisionMonthlyLimit,
      streamingMinutesLimit:    b.streamingMinutesLimit,
      periodStart,
      periodEnd,
    },
  })

  await prisma.auditLog.create({
    data: {
      superAdminId: req.jwtPayload!.sub,
      action:       'INTEGRADOR_CREATED',
      resource:     'Integrador',
      resourceId:   integrador.id,
    },
  })

  res.status(201).json({ id: integrador.id, name: integrador.name, email: integrador.email })
})

integradorRouter.get('/', async (_req: Request, res: Response) => {
  const integradores = await prisma.integrador.findMany({
    select: {
      id: true, name: true, email: true, active: true, createdAt: true,
      _count: { select: { clienteFinais: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ integradores, total: integradores.length })
})

integradorRouter.get('/:id/quota', async (req: Request, res: Response) => {
  const integrador = await prisma.integrador.findUnique({ where: { id: req.params.id } })
  if (!integrador) throw new NotFoundError('Integrador')
  const status = await quotaService.getStatus(req.params.id)
  res.json({ integrador: { id: integrador.id, name: integrador.name }, quota: status })
})
