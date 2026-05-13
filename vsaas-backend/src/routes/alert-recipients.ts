/**
 * alert-recipients.ts — CRUD de destinatários de alertas por e-mail.
 *
 *   GET    /alert-recipients          → lista do tenant
 *   POST   /alert-recipients          → cria destinatário
 *   PUT    /alert-recipients/:id      → atualiza
 *   DELETE /alert-recipients/:id      → remove
 *   POST   /alert-recipients/:id/test → envia e-mail de teste
 *
 * Controle de acesso:
 *   SUPER_ADMIN          → qualquer tenant (query param clienteFinalId / integradorId)
 *   INTEGRADOR_ADMIN     → próprio integrador + qualquer CF do seu tenant
 *   INTEGRADOR_TECNICO   → somente leitura
 *   CLIENTE_ADMIN        → próprio CF
 *   CLIENTE_OPERADOR     → leitura + gerencia apenas o próprio email
 *   CLIENTE_SUPERVISOR   → leitura + gerencia apenas o próprio email
 *   CLIENTE_VIEWER       → sem acesso
 */

import { Router } from 'express'
import { z }      from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth }  from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, UnauthorizedError, NotFoundError, ForbiddenError } from '../lib/errors'
import { sendMail, loadTemplate, renderTemplate } from '../lib/smtp'

export const alertRecipientsRouter = Router()
alertRecipientsRouter.use(requireAuth)

// ── Schema de validação ───────────────────────────────────────────────────────

const RecipientSchema = z.object({
  email:               z.string().email(),
  name:                z.string().max(120).optional().nullable(),
  active:              z.boolean().optional(),
  rcvCritical:         z.boolean().optional(),
  rcvWarning:          z.boolean().optional(),
  rcvInfo:             z.boolean().optional(),
  rcvCameraDown:       z.boolean().optional(),
  rcvCameraUp:         z.boolean().optional(),
  rcvTriggerFire:      z.boolean().optional(),
  rcvDigest:           z.boolean().optional(),
  escalateToIntegrador: z.boolean().optional(),
  quietStart:          z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  quietEnd:            z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  // Scope (obrigatório na criação pelo SUPER_ADMIN; ignorado pelos demais)
  clienteFinalId:      z.string().uuid().optional(),
  integradorId:        z.string().uuid().optional(),
})

// ── Helper: resolve scope do tenant a partir do JWT ───────────────────────────

async function resolveScope(
  jwt: { sub: string; role: string; integradorId?: string; clienteFinalId?: string },
  query: { clienteFinalId?: string; integradorId?: string },
): Promise<{ clienteFinalId?: string; integradorId?: string }> {

  if (jwt.role === 'SUPER_ADMIN') {
    // SA pode ler/editar qualquer tenant — exige query param
    if (query.clienteFinalId) return { clienteFinalId: query.clienteFinalId }
    if (query.integradorId)   return { integradorId:   query.integradorId }
    return {}  // sem filtro → retorna todos (listagem global)
  }

  if (jwt.role === 'INTEGRADOR_ADMIN' || jwt.role === 'INTEGRADOR_TECNICO') {
    if (query.clienteFinalId) {
      // Valida que o CF pertence ao integrador
      const cf = await prisma.clienteFinal.findFirst({
        where: { id: query.clienteFinalId, integradorId: jwt.integradorId! },
        select: { id: true },
      })
      if (!cf) throw new ForbiddenError('ClienteFinal não pertence ao seu integrador')
      return { clienteFinalId: query.clienteFinalId }
    }
    return { integradorId: jwt.integradorId }
  }

  // CLIENTE_*: sempre seu próprio CF
  const user = await prisma.user.findUnique({
    where: { id: jwt.sub },
    select: { clienteFinalId: true },
  })
  if (!user?.clienteFinalId) throw new UnauthorizedError('Usuário sem cliente final vinculado')
  return { clienteFinalId: user.clienteFinalId }
}

// ── GET /alert-recipients ─────────────────────────────────────────────────────

alertRecipientsRouter.get('/', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (jwt.role === 'CLIENTE_VIEWER') throw new ForbiddenError('Sem permissão')

  const scope = await resolveScope(jwt, req.query as any)

  const recipients = await prisma.alertRecipient.findMany({
    where: {
      ...(scope.clienteFinalId ? { clienteFinalId: scope.clienteFinalId } :
          scope.integradorId   ? { integradorId:   scope.integradorId   } : {}),
    },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
  })

  res.json({ recipients, total: recipients.length })
}))

// ── POST /alert-recipients ────────────────────────────────────────────────────

alertRecipientsRouter.post('/', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (['CLIENTE_VIEWER', 'INTEGRADOR_TECNICO'].includes(jwt.role)) {
    throw new ForbiddenError('Sem permissão para criar destinatários')
  }

  const parse = RecipientSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const data = parse.data

  // Determina scope do novo destinatário
  let clienteFinalId: string | undefined
  let integradorId:   string | undefined

  if (jwt.role === 'SUPER_ADMIN') {
    clienteFinalId = data.clienteFinalId
    integradorId   = data.integradorId
    if (!clienteFinalId && !integradorId) {
      throw new ValidationError('Informe clienteFinalId ou integradorId para SUPER_ADMIN')
    }
  } else if (['INTEGRADOR_ADMIN'].includes(jwt.role)) {
    if (data.clienteFinalId) {
      // Valida pertencimento
      const cf = await prisma.clienteFinal.findFirst({
        where: { id: data.clienteFinalId, integradorId: jwt.integradorId! },
        select: { id: true },
      })
      if (!cf) throw new ForbiddenError('ClienteFinal não pertence ao seu integrador')
      clienteFinalId = data.clienteFinalId
    } else {
      integradorId = jwt.integradorId
    }
  } else {
    // CLIENTE_ADMIN / CLIENTE_OPERADOR
    const user = await prisma.user.findUnique({ where: { id: jwt.sub }, select: { clienteFinalId: true } })
    clienteFinalId = user?.clienteFinalId ?? undefined
    if (!clienteFinalId) throw new UnauthorizedError('Sem cliente final vinculado')

    // CLIENTE_OPERADOR só pode adicionar o próprio email
    if (jwt.role === 'CLIENTE_OPERADOR' || jwt.role === 'CLIENTE_SUPERVISOR') {
      const self = await prisma.user.findUnique({ where: { id: jwt.sub }, select: { email: true } })
      if (self?.email !== data.email) throw new ForbiddenError('Operadores só podem adicionar o próprio e-mail')
    }
  }

  const created = await prisma.alertRecipient.create({
    data: {
      email:               data.email,
      name:                data.name ?? null,
      active:              data.active ?? true,
      rcvCritical:         data.rcvCritical ?? true,
      rcvWarning:          data.rcvWarning  ?? true,
      rcvInfo:             data.rcvInfo     ?? false,
      rcvCameraDown:       data.rcvCameraDown   ?? true,
      rcvCameraUp:         data.rcvCameraUp     ?? false,
      rcvTriggerFire:      data.rcvTriggerFire  ?? true,
      rcvDigest:           data.rcvDigest       ?? false,
      escalateToIntegrador: data.escalateToIntegrador ?? false,
      quietStart:          data.quietStart ?? null,
      quietEnd:            data.quietEnd   ?? null,
      clienteFinalId:      clienteFinalId ?? null,
      integradorId:        integradorId   ?? null,
    },
  })

  logger.info({ id: created.id, email: created.email, clienteFinalId, integradorId }, 'alert_recipient_created')
  res.status(201).json(created)
}))

// ── PUT /alert-recipients/:id ─────────────────────────────────────────────────

alertRecipientsRouter.put('/:id', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (['CLIENTE_VIEWER', 'INTEGRADOR_TECNICO'].includes(jwt.role)) {
    throw new ForbiddenError('Sem permissão para editar destinatários')
  }

  const parse = RecipientSchema.partial().safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const existing = await findAndAuthorize(req.params.id, jwt)

  // CLIENTE_OPERADOR só edita o próprio email
  if ((jwt.role === 'CLIENTE_OPERADOR' || jwt.role === 'CLIENTE_SUPERVISOR') && existing.email !== req.body.email) {
    const self = await prisma.user.findUnique({ where: { id: jwt.sub }, select: { email: true } })
    if (self?.email !== existing.email) throw new ForbiddenError('Sem permissão para editar este destinatário')
  }

  const { clienteFinalId: _cf, integradorId: _in, email: _em, ...updateData } = parse.data
  const updated = await prisma.alertRecipient.update({
    where: { id: existing.id },
    data:  updateData,
  })

  logger.info({ id: updated.id }, 'alert_recipient_updated')
  res.json(updated)
}))

// ── DELETE /alert-recipients/:id ──────────────────────────────────────────────

alertRecipientsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (['CLIENTE_VIEWER', 'INTEGRADOR_TECNICO'].includes(jwt.role)) {
    throw new ForbiddenError('Sem permissão')
  }

  const existing = await findAndAuthorize(req.params.id, jwt)
  await prisma.alertRecipient.delete({ where: { id: existing.id } })
  logger.info({ id: existing.id }, 'alert_recipient_deleted')
  res.json({ ok: true })
}))

// ── POST /alert-recipients/:id/test ──────────────────────────────────────────

alertRecipientsRouter.post('/:id/test', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const existing = await findAndAuthorize(req.params.id, jwt)

  const tpl = await loadTemplate('camera_down')
  if (!tpl) return res.json({ ok: false, error: 'Template não encontrado' })

  const baseUrl = process.env.PUBLIC_FRONTEND_URL?.replace('/login', '') ?? 'http://localhost:5173'
  const vars = {
    cameraName:     'Câmera Teste',
    location:       'Sala de Testes',
    siteName:       'Site de Demonstração',
    clienteName:    'Teste',
    offlineSince:   new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    offlineDuration:'2 min',
    severity:       'TESTE',
    description:    '🧪 Este é um e-mail de teste do sistema de alertas VSaaS.',
    dashboardUrl:   `${baseUrl}/cameras`,
    settingsUrl:    `${baseUrl}/settings`,
    escaladeNote:   '',
  }

  const subject = `🧪 [TESTE] ${renderTemplate(tpl.subject, vars)}`
  const text    = renderTemplate(tpl.body, vars)

  const result = await sendMail({ to: existing.email, subject, text })
  logger.info({ to: existing.email, ok: result.sent }, 'alert_recipient_test_sent')
  res.json(result.sent ? { ok: true } : { ok: false, error: result.reason })
}))

// ── Helper: encontra e autoriza acesso ao destinatário ────────────────────────

async function findAndAuthorize(id: string, jwt: { sub: string; role: string; integradorId?: string }) {
  const rec = await prisma.alertRecipient.findUnique({ where: { id } })
  if (!rec) throw new NotFoundError('AlertRecipient')

  if (jwt.role === 'SUPER_ADMIN') return rec

  if (jwt.role === 'INTEGRADOR_ADMIN' || jwt.role === 'INTEGRADOR_TECNICO') {
    if (rec.integradorId === jwt.integradorId) return rec
    // Ou é de um CF do integrador
    if (rec.clienteFinalId) {
      const cf = await prisma.clienteFinal.findFirst({
        where: { id: rec.clienteFinalId, integradorId: jwt.integradorId! },
        select: { id: true },
      })
      if (cf) return rec
    }
    throw new ForbiddenError('Acesso negado')
  }

  // CLIENTE_*
  const user = await prisma.user.findUnique({ where: { id: jwt.sub }, select: { clienteFinalId: true } })
  if (rec.clienteFinalId !== user?.clienteFinalId) throw new ForbiddenError('Acesso negado')
  return rec
}
