/**
 * EvidenceVault Routes — gestão de janelas de gravação salvaguardadas.
 *
 * GET    /evidence-vault?cameraId=X         → lista entradas da câmera (tenant-scoped)
 * POST   /evidence-vault                    → cria salvaguarda { cameraId, startAt, endAt, reason, expiresAt? }
 * DELETE /evidence-vault/:id                → remove salvaguarda (libera segments pra retention)
 *
 * Semântica:
 *   - Salvaguarda em vigor: `expiresAt IS NULL OR expiresAt > now()`
 *   - tickRetention (recording.service.ts) filtra segments que intersectam
 *     QUALQUER salvaguarda em vigor — esses NUNCA são apagados.
 *   - Remover salvaguarda NÃO apaga segments — apenas libera o gate de retention.
 *
 * Auditoria: cada criação/remoção entra no AuditLog (action=EVIDENCE_VAULT_*).
 * LGPD: reason é obrigatório (mínimo 10 chars) pra rastreabilidade.
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, type JwtPayload } from '../middleware/auth'
import { blockReadOnly } from '../middleware/block-read-only'
import { asyncHandler } from '../middleware/async-handler'
import {
  cameraTenantWhere,
  requireCameraForUser,
} from '../lib/tenant-scope'
import { ValidationError, NotFoundError } from '../lib/errors'
import { publicRoute } from '../middleware/require-capability'
import { auditAction } from '../lib/audit-helpers'
import { logger } from '../lib/logger'

export const evidenceVaultRouter = Router()
evidenceVaultRouter.use(requireAuth)
evidenceVaultRouter.use(blockReadOnly)

function resolveTenantId(jwt: JwtPayload): string {
  return jwt.clienteFinalId ?? jwt.integradorId ?? jwt.sub ?? 'SUPER_ADMIN'
}

// =============================================================================
// GET /evidence-vault?cameraId=...
// =============================================================================

const ListSchema = z.object({
  cameraId: z.string().uuid().optional(),
  /** Inclui também as expiradas (default false — só ativas) */
  includeExpired: z.coerce.boolean().optional().default(false),
})

evidenceVaultRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const parse = ListSchema.safeParse(req.query)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'Query inválida')
  const { cameraId, includeExpired } = parse.data

  const tenantWhere = cameraTenantWhere(req.jwtPayload!)

  const where: any = {
    camera: tenantWhere,
    ...(cameraId ? { cameraId } : {}),
    ...(includeExpired
      ? {}
      : { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }),
  }

  const items = await prisma.evidenceVault.findMany({
    where,
    orderBy: { startAt: 'desc' },
    include: {
      camera:    { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
    take: 500,
  })

  res.json({ items })
}))

// =============================================================================
// POST /evidence-vault
// =============================================================================

const CreateSchema = z.object({
  cameraId:  z.string().uuid(),
  startAt:   z.string().datetime(),
  endAt:     z.string().datetime(),
  /** Obrigatório — 10 chars mín pra forçar contexto LGPD-compatível. */
  reason:    z.string().min(10).max(2000),
  /** ISO datetime opcional. Null/undefined = permanente. */
  expiresAt: z.string().datetime().nullish(),
})

evidenceVaultRouter.post('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const parse = CreateSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'Dados inválidos')
  const d = parse.data

  const startAt = new Date(d.startAt)
  const endAt   = new Date(d.endAt)
  if (endAt <= startAt) throw new ValidationError('endAt deve ser maior que startAt')

  // Isolation: câmera precisa pertencer ao tenant
  const cam = await requireCameraForUser(d.cameraId, req.jwtPayload, {
    select: { id: true, name: true },
  })

  const tenantId = resolveTenantId(req.jwtPayload!)

  const created = await prisma.evidenceVault.create({
    data: {
      cameraId:    cam.id,
      tenantId,
      startAt,
      endAt,
      reason:      d.reason,
      expiresAt:   d.expiresAt ? new Date(d.expiresAt) : null,
      createdById: req.jwtPayload?.sub ?? null,
    },
    include: {
      camera:    { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  })

  auditAction(prisma, {
    req,
    action: 'EVIDENCE_VAULT_CREATE',
    resource: 'EvidenceVault',
    resourceId: created.id,
    metadata: {
      cameraId: cam.id,
      cameraName: cam.name,
      startAt: startAt.toISOString(),
      endAt:   endAt.toISOString(),
      reason: d.reason,
      expiresAt: d.expiresAt ?? null,
    },
  }).catch(err => logger.warn({ err }, 'evidence_vault_audit_create_failed'))

  res.status(201).json(created)
}))

// =============================================================================
// DELETE /evidence-vault/:id
// =============================================================================

evidenceVaultRouter.delete('/:id',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const tenantWhere = cameraTenantWhere(req.jwtPayload!)
  const existing = await prisma.evidenceVault.findFirst({
    where: { id: req.params.id, camera: tenantWhere as any },
    include: { camera: { select: { id: true, name: true } } },
  })
  if (!existing) throw new NotFoundError('Salvaguarda não encontrada')

  await prisma.evidenceVault.delete({ where: { id: existing.id } })

  auditAction(prisma, {
    req,
    action: 'EVIDENCE_VAULT_DELETE',
    resource: 'EvidenceVault',
    resourceId: existing.id,
    metadata: {
      cameraId: existing.cameraId,
      cameraName: existing.camera.name,
      startAt: existing.startAt.toISOString(),
      endAt: existing.endAt.toISOString(),
      reason: existing.reason,
    },
  }).catch(err => logger.warn({ err }, 'evidence_vault_audit_delete_failed'))

  res.json({ ok: true })
}))
