/**
 * SemanticRuleTemplate Routes — biblioteca de regras pre-prontas testadas.
 *
 * Endereça P2 GAP #16: integrador vende com "templates comprovados, 4% FP histórico".
 *
 * Visão por role:
 *   SUPER_ADMIN  — vê todos (globais + de integradores)
 *   INTEGRADOR   — vê globais + os seus (CRUD nos seus)
 *   CLIENTE      — vê globais + os do seu integrador (read-only)
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'

export const semanticTemplatesRouter = Router()
semanticTemplatesRouter.use(requireAuth)

// ── LIST: globais + escopo do user ────────────────────────────────────────
semanticTemplatesRouter.get('/', asyncHandler(async (req, res) => {
  const p = req.jwtPayload!
  const vertical = req.query.vertical as string | undefined
  const where: any = { enabled: true }
  if (vertical) where.vertical = vertical

  if (p.role === 'SUPER_ADMIN') {
    // Vê todos
  } else if (p.clienteFinalId) {
    // Cliente: pega o integradorId via clienteFinal
    const cf = await prisma.clienteFinal.findUnique({
      where: { id: p.clienteFinalId },
      select: { integradorId: true },
    })
    where.OR = [
      { integradorId: null },                  // globais
      { integradorId: cf?.integradorId ?? '' }, // do meu integrador
    ]
  } else if (p.integradorId) {
    where.OR = [
      { integradorId: null },
      { integradorId: p.integradorId },
    ]
  } else {
    where.integradorId = null
  }

  const items = await prisma.semanticRuleTemplate.findMany({
    where,
    orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  })
  res.json({ items })
}))

// ── CREATE (integrador or super admin) ────────────────────────────────────
semanticTemplatesRouter.post('/', asyncHandler(async (req, res) => {
  const schema = z.object({
    emoji: z.string().max(8).default('🎯'),
    title: z.string().min(3).max(120),
    prompt: z.string().min(10).max(500),
    defaultIntervalSec: z.number().int().min(15).max(3600).default(30),
    defaultSeverity: z.enum(['info', 'warning', 'critical']).default('warning'),
    defaultChannels: z.array(z.string()).default([]),
    vertical: z.string().max(50).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)
  const p = req.jwtPayload!

  // Globais só super_admin
  const integradorId = p.role === 'SUPER_ADMIN' ? null : p.integradorId
  if (!integradorId && p.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Sem escopo para criar template')
  }

  const created = await prisma.semanticRuleTemplate.create({
    data: {
      integradorId,
      emoji:               parsed.data.emoji,
      title:               parsed.data.title,
      prompt:              parsed.data.prompt,
      defaultIntervalSec:  parsed.data.defaultIntervalSec,
      defaultSeverity:     parsed.data.defaultSeverity,
      defaultChannels:     parsed.data.defaultChannels,
      vertical:            parsed.data.vertical ?? null,
    },
  })
  res.status(201).json(created)
}))

// ── DELETE (próprio integrador ou super) ──────────────────────────────────
semanticTemplatesRouter.delete('/:id', asyncHandler(async (req, res) => {
  const p = req.jwtPayload!
  const tpl = await prisma.semanticRuleTemplate.findUnique({ where: { id: req.params.id } })
  if (!tpl) throw new NotFoundError('template_not_found')
  if (p.role !== 'SUPER_ADMIN' && tpl.integradorId !== p.integradorId) {
    throw new ForbiddenError('Sem escopo')
  }
  await prisma.semanticRuleTemplate.delete({ where: { id: req.params.id } })
  res.status(204).end()
}))

// ── USE TEMPLATE — incrementa contador (chamado pelo frontend ao criar regra) ──
semanticTemplatesRouter.post('/:id/use', asyncHandler(async (req, res) => {
  const tpl = await prisma.semanticRuleTemplate.update({
    where: { id: req.params.id },
    data: { usageCount: { increment: 1 } },
  }).catch(() => null)
  if (!tpl) throw new NotFoundError('template_not_found')
  res.json(tpl)
}))
