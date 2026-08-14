/**
 * LGPD Consent Routes — opt-in/opt-out de uso IA externo (Gemini, Roboflow).
 *
 * Sem consent ativo, ai-gating.service bloqueia chamadas (P0 #5).
 *
 * Endpoints:
 *   GET    /lgpd-consents                 — lista consents do cliente atual
 *   POST   /lgpd-consents                 — aceita um scope
 *   DELETE /lgpd-consents/:scope          — revoga
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, ForbiddenError } from '../lib/errors'
import { publicRoute } from '../middleware/require-capability'

export const lgpdConsentsRouter = Router()
lgpdConsentsRouter.use(requireAuth)

const SCOPE = z.enum(['ai_gemini', 'ai_roboflow', 'ai_facial'])

function getClienteFinalId(req: any): string | null {
  const p = req.jwtPayload
  if (p.clienteFinalId) return p.clienteFinalId
  return null  // SUPER_ADMIN / INTEGRADOR não tem consent próprio
}

// ── LIST ─────────────────────────────────────────────────────────────────
lgpdConsentsRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const p = req.jwtPayload!
  let cfId = getClienteFinalId(req)

  // Integrador/admin pode consultar de um cliente específico
  if (!cfId && req.query.clienteFinalId) {
    const cf = await prisma.clienteFinal.findUnique({
      where: { id: req.query.clienteFinalId as string },
      select: { integradorId: true },
    })
    if (!cf) throw new ForbiddenError('Cliente não encontrado')
    if (p.role !== 'SUPER_ADMIN' && cf.integradorId !== p.integradorId) {
      throw new ForbiddenError('Cliente fora do escopo')
    }
    cfId = req.query.clienteFinalId as string
  }

  if (!cfId) { res.json({ items: [] }); return }
  const items = await prisma.lgpdConsent.findMany({
    where: { clienteFinalId: cfId },
    orderBy: { updatedAt: 'desc' },
  })
  res.json({ items })
}))

// ── ACCEPT ──────────────────────────────────────────────────────────────
lgpdConsentsRouter.post('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const schema = z.object({
    scope: SCOPE,
    clienteFinalId: z.string().uuid().optional(),
    policyVersion: z.string().default('v1'),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

  const p = req.jwtPayload!
  let cfId = parsed.data.clienteFinalId ?? getClienteFinalId(req)
  if (!cfId) throw new ValidationError('clienteFinalId obrigatório')

  // Escopo: cliente aceita o próprio · integrador/super pode aceitar em nome dele
  if (p.clienteFinalId && p.clienteFinalId !== cfId) {
    throw new ForbiddenError('Sem escopo')
  }
  if (p.integradorId && !p.clienteFinalId) {
    const cf = await prisma.clienteFinal.findUnique({ where: { id: cfId }, select: { integradorId: true } })
    if (cf?.integradorId !== p.integradorId) throw new ForbiddenError('Sem escopo')
  }

  const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null
  const userAgent = req.headers['user-agent'] ?? null

  const consent = await prisma.lgpdConsent.upsert({
    where: { clienteFinalId_scope: { clienteFinalId: cfId, scope: parsed.data.scope } },
    create: {
      clienteFinalId:  cfId,
      scope:           parsed.data.scope,
      accepted:        true,
      acceptedAt:      new Date(),
      acceptedByUserId: p.sub,
      policyVersion:   parsed.data.policyVersion,
      ipAddress,
      userAgent,
    },
    update: {
      accepted:        true,
      acceptedAt:      new Date(),
      acceptedByUserId: p.sub,
      revokedAt:       null,
      policyVersion:   parsed.data.policyVersion,
      ipAddress,
      userAgent,
    },
  })
  res.status(201).json(consent)
}))

// ── REVOKE ──────────────────────────────────────────────────────────────
lgpdConsentsRouter.delete('/:scope',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const scope = SCOPE.parse(req.params.scope)
  const cfId = getClienteFinalId(req)
  if (!cfId) throw new ForbiddenError('Apenas cliente final pode revogar')
  await prisma.lgpdConsent.update({
    where: { clienteFinalId_scope: { clienteFinalId: cfId, scope } },
    data: { accepted: false, revokedAt: new Date() },
  })
  res.status(204).end()
}))
