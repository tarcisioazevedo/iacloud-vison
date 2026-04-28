/**
 * Technician Access — Lote 3
 *
 * ACL granular: quais clientes finais um INTEGRADOR_TECNICO pode acessar.
 *
 * Default (sem registros) = acesso a TODOS os clientes do integrador.
 * Com ao menos uma linha ativa para o técnico → allowlist (deny-by-default).
 *
 * Endpoints:
 *   GET  /technician-access              (INTEGRADOR_ADMIN) → lista todos do seu integrador
 *   GET  /technician-access/my           (INTEGRADOR_TECNICO) → lista do próprio técnico
 *   POST /technician-access              (INTEGRADOR_ADMIN) → concede acesso
 *   DELETE /technician-access/:id        (INTEGRADOR_ADMIN) → revoga
 *
 * O escopo efetivo é aplicado via `resolveTechnicianClienteIds` chamado nos
 * handlers de câmeras/sites quando role=INTEGRADOR_TECNICO.
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../lib/errors'
import { logger } from '../lib/logger'

export const technicianAccessRouter = Router()
technicianAccessRouter.use(requireAuth)

// ── helpers ─────────────────────────────────────────────────────────────────

function requireIntegradorAdmin(req: any) {
  const { role, integradorId } = req.jwtPayload ?? {}
  if (role !== 'INTEGRADOR_ADMIN' && role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Apenas INTEGRADOR_ADMIN pode gerenciar acessos de técnicos')
  }
  return integradorId as string | undefined
}

/**
 * Retorna os clienteFinalIds que um técnico pode acessar.
 * Vazio → nenhuma restrição (acesso a todos do integrador).
 * Com entradas → allowlist estrita.
 *
 * Chamado externamente pelos routers de cameras/sites (via export).
 */
export async function resolveTechnicianClienteIds(technicianUserId: string): Promise<string[] | null> {
  const rows = await prisma.integradorTechnicianAccess.findMany({
    where: {
      technicianUserId,
      revokedAt: null,
    },
    select: { clienteFinalId: true },
  })
  if (rows.length === 0) return null  // sem restrição
  return rows.map((r) => r.clienteFinalId)
}

// ── GET /technician-access — admin: lista acessos do integrador ──────────────

technicianAccessRouter.get('/', asyncHandler(async (req, res) => {
  const { role, integradorId, sub } = req.jwtPayload!

  let integrId = integradorId

  if (role === 'INTEGRADOR_TECNICO') {
    // Técnico vê os próprios acessos
    const accesses = await prisma.integradorTechnicianAccess.findMany({
      where: { technicianUserId: sub, revokedAt: null },
      include: {
        clienteFinal: { select: { id: true, name: true, tradeName: true } },
      },
      orderBy: { grantedAt: 'asc' },
    })
    return res.json({ accesses, total: accesses.length })
  }

  if (role !== 'INTEGRADOR_ADMIN' && role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Acesso negado')
  }

  const where: any = { revokedAt: null }
  if (role === 'INTEGRADOR_ADMIN' && integrId) {
    where.integradorId = integrId
  }

  const technicianId = req.query.technicianId as string | undefined
  if (technicianId) where.technicianUserId = technicianId

  const accesses = await prisma.integradorTechnicianAccess.findMany({
    where,
    include: {
      technician: { select: { id: true, name: true, email: true, role: true } },
      clienteFinal: { select: { id: true, name: true, tradeName: true } },
    },
    orderBy: { grantedAt: 'desc' },
    take: 200,
  })
  res.json({ accesses, total: accesses.length })
}))

// ── POST /technician-access — concede acesso ─────────────────────────────────

const GrantSchema = z.object({
  technicianUserId: z.string().uuid(),
  clienteFinalId:   z.string().uuid(),
  scope:            z.enum(['VIEWER', 'OPERATOR', 'FULL']).default('FULL'),
})

technicianAccessRouter.post('/', asyncHandler(async (req, res) => {
  const integrId = requireIntegradorAdmin(req)

  const parse = GrantSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

  const { technicianUserId, clienteFinalId, scope } = parse.data

  // Verifica que o técnico pertence ao integrador
  const tech = await prisma.user.findUnique({
    where: { id: technicianUserId },
    select: { id: true, role: true, integradorId: true },
  })
  if (!tech) throw new NotFoundError('Técnico')
  if (tech.role !== 'INTEGRADOR_TECNICO') {
    throw new ValidationError('Usuário não é um técnico integrador')
  }
  if (req.jwtPayload!.role !== 'SUPER_ADMIN' && tech.integradorId !== integrId) {
    throw new ForbiddenError('Técnico não pertence a este integrador')
  }

  // Verifica que o cliente pertence ao integrador
  const cf = await prisma.clienteFinal.findUnique({
    where: { id: clienteFinalId },
    select: { id: true, integradorId: true },
  })
  if (!cf) throw new NotFoundError('ClienteFinal')
  if (req.jwtPayload!.role !== 'SUPER_ADMIN' && cf.integradorId !== integrId) {
    throw new ForbiddenError('ClienteFinal não pertence a este integrador')
  }

  // Upsert — se já existia (revokedAt != null) reativa
  const access = await prisma.integradorTechnicianAccess.upsert({
    where:  { technicianUserId_clienteFinalId: { technicianUserId, clienteFinalId } },
    update: { revokedAt: null, scope, grantedByUserId: req.jwtPayload!.sub, grantedAt: new Date() },
    create: {
      technicianUserId,
      clienteFinalId,
      integradorId:    tech.integradorId!,
      scope,
      grantedByUserId: req.jwtPayload!.sub,
    },
  })

  logger.info({
    technicianUserId,
    clienteFinalId,
    scope,
    actorId: req.jwtPayload!.sub,
  }, 'technician_access_granted')

  res.status(201).json({ access })
}))

// ── DELETE /technician-access/:id — revoga ───────────────────────────────────

technicianAccessRouter.delete('/:id', asyncHandler(async (req, res) => {
  requireIntegradorAdmin(req)

  const entry = await prisma.integradorTechnicianAccess.findUnique({
    where: { id: req.params.id },
  })
  if (!entry) throw new NotFoundError('TechnicianAccess')

  const { role, integradorId } = req.jwtPayload!
  if (role !== 'SUPER_ADMIN' && entry.integradorId !== integradorId) {
    throw new ForbiddenError('Entrada não pertence a este integrador')
  }

  await prisma.integradorTechnicianAccess.update({
    where: { id: entry.id },
    data:  { revokedAt: new Date() },
  })

  logger.info({ accessId: entry.id, actorId: req.jwtPayload!.sub }, 'technician_access_revoked')
  res.json({ ok: true, id: entry.id })
}))
