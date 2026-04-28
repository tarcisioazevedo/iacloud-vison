/**
 * ApprovalRequest — Lote 6 (D14)
 *
 * Ações sensíveis do Admin global que requerem OK do Super Admin:
 *   CREATE_INTEGRADOR, DELETE_INTEGRADOR, DELETE_CLIENTE_FINAL,
 *   DELETE_USER, CHANGE_BILLING, RESET_USER_PASSWORD, CONVERT_LEAD
 *
 * Fluxo:
 *   1. ADMIN_GLOBAL → POST /approvals { action, payloadJson, reason }
 *      → cria ApprovalRequest PENDING, expira em 7 dias
 *
 *   2. SUPER_ADMIN → GET /approvals?status=PENDING
 *      → lista requests pendentes + detalhes do payload
 *
 *   3. SUPER_ADMIN → POST /approvals/:id/approve ou /reject
 *      approve: marca APPROVED + executa ação (EXECUTED) ou só aprova (APPROVED)
 *      reject:  marca REJECTED + salva rejectedReason
 *
 * Execução de ações (approve handler executa inline):
 *   DELETE_USER         → desativa User (active=false) — soft delete
 *   DELETE_INTEGRADOR   → desativa Integrador (active=false)
 *   DELETE_CLIENTE_FINAL → desativa ClienteFinal (active=false)
 *   RESET_USER_PASSWORD → gera senha aleatória, seta mustChangePassword=true
 *   CREATE_INTEGRADOR   → delegado ao payload (noop aqui, ação já executada antes da request)
 *   CONVERT_LEAD        → idem
 *   CHANGE_BILLING      → idem (apenas registro para auditoria)
 */
import { Router } from 'express'
import { z }      from 'zod'
import bcrypt     from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler }             from '../middleware/async-handler'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { logger } from '../lib/logger'

export const approvalsRouter = Router()

// ── Schemas ───────────────────────────────────────────────────────────────────

const ActionEnum = z.enum([
  'CREATE_INTEGRADOR',
  'DELETE_INTEGRADOR',
  'CONVERT_LEAD',
  'DELETE_CLIENTE_FINAL',
  'DELETE_USER',
  'CHANGE_BILLING',
  'RESET_USER_PASSWORD',
])

const CreateSchema = z.object({
  action:      ActionEnum,
  payloadJson: z.record(z.unknown()),
  reason:      z.string().min(10).max(1000).optional(),
})

const ListQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED']).optional(),
  action: ActionEnum.optional(),
  limit:  z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const RejectSchema = z.object({
  reason: z.string().min(5).max(500),
})

// ── POST /approvals ────────────────────────────────────────────────────────────

approvalsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const role = req.jwtPayload!.role
    if (role !== 'ADMIN_GLOBAL' && role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Apenas ADMIN_GLOBAL ou SUPER_ADMIN podem criar solicitações de aprovação')
    }

    const parse = CreateSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

    const { action, payloadJson, reason } = parse.data

    // Expira em 7 dias
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const request = await prisma.approvalRequest.create({
      data: {
        action:            action as any,
        payloadJson:       payloadJson as any,
        reason:            reason ?? null,
        requestedByUserId: req.jwtPayload!.sub,
        expiresAt,
      },
    })

    logger.info({ approvalId: request.id, action, requestedBy: req.jwtPayload!.sub }, 'approval_request_created')

    res.status(201).json(request)
  }),
)

// ── GET /approvals ─────────────────────────────────────────────────────────────

approvalsRouter.get(
  '/',
  requireAuth,
  requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'),
  asyncHandler(async (req, res) => {
    const parse = ListQuerySchema.safeParse(req.query)
    if (!parse.success) throw new ValidationError('Filtros inválidos')

    const { status, action, limit = 50, offset = 0 } = parse.data

    // Auto-expirar requests pendentes há mais de 7d (lazy expiration)
    await prisma.approvalRequest.updateMany({
      where: {
        status:    'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    })

    const where: any = {}
    if (status) where.status = status
    if (action) where.action = action

    // ADMIN_GLOBAL só vê suas próprias requests
    const role = req.jwtPayload!.role
    if (role === 'ADMIN_GLOBAL') {
      where.requestedByUserId = req.jwtPayload!.sub
    }

    const [items, total] = await Promise.all([
      prisma.approvalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.approvalRequest.count({ where }),
    ])

    // Count por status (para badges)
    const byStatusRaw = await prisma.approvalRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
    })
    const byStatus: Record<string, number> = {
      PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, EXPIRED: 0,
    }
    for (const r of byStatusRaw) byStatus[r.status] = r._count._all

    res.json({ items, total, limit, offset, byStatus })
  }),
)

// ── GET /approvals/:id ────────────────────────────────────────────────────────

approvalsRouter.get(
  '/:id',
  requireAuth,
  requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'),
  asyncHandler(async (req, res) => {
    const item = await prisma.approvalRequest.findUnique({ where: { id: String(req.params.id) } })
    if (!item) throw new NotFoundError('ApprovalRequest')

    // ADMIN_GLOBAL só vê as suas
    if (req.jwtPayload!.role === 'ADMIN_GLOBAL' && item.requestedByUserId !== req.jwtPayload!.sub) {
      throw new ForbiddenError('Acesso negado')
    }

    res.json(item)
  }),
)

// ── POST /approvals/:id/approve ───────────────────────────────────────────────

approvalsRouter.post(
  '/:id/approve',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const item = await prisma.approvalRequest.findUnique({ where: { id: String(req.params.id) } })
    if (!item) throw new NotFoundError('ApprovalRequest')
    if (item.status !== 'PENDING') {
      throw new ValidationError(`Request está com status ${item.status} — só PENDING pode ser aprovado`)
    }
    if (item.expiresAt < new Date()) {
      await prisma.approvalRequest.update({ where: { id: item.id }, data: { status: 'EXPIRED' } })
      throw new ValidationError('Request expirado')
    }

    const decidedBy = req.jwtPayload!.sub
    let resultJson: Record<string, unknown> = {}
    let newStatus: 'APPROVED' | 'EXECUTED' = 'APPROVED'

    // Executa a ação quando possível (soft-delete cases)
    const payload = item.payloadJson as Record<string, any>

    try {
      if (item.action === 'DELETE_USER' && payload.userId) {
        await prisma.user.update({
          where: { id: payload.userId },
          data:  { active: false },
        })
        resultJson = { deletedUserId: payload.userId }
        newStatus  = 'EXECUTED'
        logger.warn({ approvalId: item.id, userId: payload.userId }, 'approval_delete_user_executed')
      }

      else if (item.action === 'DELETE_INTEGRADOR' && payload.integradorId) {
        await prisma.integrador.update({
          where: { id: payload.integradorId },
          data:  { active: false },
        })
        resultJson = { deletedIntegradorId: payload.integradorId }
        newStatus  = 'EXECUTED'
        logger.warn({ approvalId: item.id, integradorId: payload.integradorId }, 'approval_delete_integrador_executed')
      }

      else if (item.action === 'DELETE_CLIENTE_FINAL' && payload.clienteFinalId) {
        await prisma.clienteFinal.update({
          where: { id: payload.clienteFinalId },
          data:  { active: false },
        })
        resultJson = { deletedClienteFinalId: payload.clienteFinalId }
        newStatus  = 'EXECUTED'
        logger.warn({ approvalId: item.id, clienteFinalId: payload.clienteFinalId }, 'approval_delete_clientefinal_executed')
      }

      else if (item.action === 'RESET_USER_PASSWORD' && payload.userId) {
        // Gera senha temporária aleatória de 12 chars
        const tempPw   = Array.from(crypto.getRandomValues(new Uint8Array(9)))
          .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
        const newHash  = await bcrypt.hash(tempPw, 12)
        await prisma.user.update({
          where: { id: payload.userId },
          data:  { passwordHash: newHash, mustChangePassword: true },
        })
        resultJson = { userId: payload.userId, tempPassword: tempPw }
        newStatus  = 'EXECUTED'
        logger.warn({ approvalId: item.id, userId: payload.userId }, 'approval_reset_password_executed')
      }

      else {
        // Para ações que são apenas audit (CREATE_INTEGRADOR, CONVERT_LEAD, CHANGE_BILLING)
        // só marcamos APPROVED — a ação foi (ou será) disparada pelo solicitante após aprovação
        resultJson = { note: 'Ação aprovada — solicitante notificado para executar' }
        newStatus  = 'APPROVED'
      }
    } catch (err: any) {
      logger.error({ approvalId: item.id, err: err?.message }, 'approval_execution_failed')
      throw err
    }

    const updated = await prisma.approvalRequest.update({
      where: { id: item.id },
      data: {
        status:          newStatus,
        decidedByUserId: decidedBy,
        decidedAt:       new Date(),
        executedAt:      newStatus === 'EXECUTED' ? new Date() : null,
        resultJson:      resultJson as any,
      },
    })

    logger.info({ approvalId: item.id, action: item.action, decidedBy, newStatus }, 'approval_approved')
    res.json(updated)
  }),
)

// ── POST /approvals/:id/reject ────────────────────────────────────────────────

approvalsRouter.post(
  '/:id/reject',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const item = await prisma.approvalRequest.findUnique({ where: { id: String(req.params.id) } })
    if (!item) throw new NotFoundError('ApprovalRequest')
    if (item.status !== 'PENDING') {
      throw new ValidationError(`Request está com status ${item.status} — só PENDING pode ser rejeitado`)
    }

    const parse = RejectSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError('Informe um motivo para a rejeição (mín. 5 caracteres)')

    const updated = await prisma.approvalRequest.update({
      where: { id: item.id },
      data: {
        status:          'REJECTED',
        rejectedReason:  parse.data.reason,
        decidedByUserId: req.jwtPayload!.sub,
        decidedAt:       new Date(),
      },
    })

    logger.info({ approvalId: item.id, action: item.action, decidedBy: req.jwtPayload!.sub }, 'approval_rejected')
    res.json(updated)
  }),
)
