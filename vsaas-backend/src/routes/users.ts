/**
 * Users Routes — Sprint Gap 4 (convite de usuário).
 *
 * Endpoints:
 *   - GET  /users           lista usuários do tenant (escopo via JWT)
 *   - POST /users/invite    cria User + senha temporária (exibida na resposta)
 *
 * Convite "stateless": como o schema do User não tem `invitedAt`/`acceptedAt`,
 * geramos uma senha temporária randômica e mostramos UMA vez na resposta. O
 * convidado loga com ela, e a UI orienta a trocar via /auth/change-password.
 *
 * SMTP é opcional: se SMTP_HOST estiver definido + nodemailer instalado, o
 * sistema envia email; caso contrário responde com `emailSent=false` e o
 * admin precisa repassar manualmente. Nada bloqueia.
 *
 * Regras de quem-convida-quem:
 *   - SUPER_ADMIN     → qualquer role/tenant.
 *   - INTEGRADOR_ADMIN → INTEGRADOR_TECNICO (próprio integ) ou
 *                        CLIENTE_* (em qualquer cliente do próprio integrador).
 *   - INTEGRADOR_TECNICO → ❌ não convida.
 *   - CLIENTE_ADMIN   → CLIENTE_OPERADOR/VIEWER no próprio clienteFinalId.
 *   - CLIENTE_*       → ❌ não convidam abaixo de operador.
 */
import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { ValidationError, UnauthorizedError, NotFoundError, ForbiddenError } from '../lib/errors'
import { tenantIdOptional } from '../lib/zod-helpers'
import { loadSmtp, loadTemplate, renderTemplate } from '../lib/smtp'

export const usersRouter = Router()
usersRouter.use(requireAuth)

// =============================================================================
// GET /users  → lista escopada
// =============================================================================

usersRouter.get('/', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!

  let where: any = {}
  if (jwt.role === 'SUPER_ADMIN') {
    where = {}
  } else if (jwt.clienteFinalId) {
    where = { clienteFinalId: jwt.clienteFinalId }
  } else if (jwt.integradorId) {
    where = { integradorId: jwt.integradorId }
  } else {
    throw new UnauthorizedError('JWT sem tenant')
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, email: true, name: true, role: true, active: true,
      lastLoginAt: true, createdAt: true,
      integrador:   { select: { id: true, name: true } },
      clienteFinal: { select: { id: true, name: true } },
    },
    orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  })
  res.json({ users, total: users.length })
}))

// =============================================================================
// POST /users/invite
// =============================================================================

const InviteSchema = z.object({
  email:           z.string().email(),
  name:            z.string().min(2).max(120),
  role:            z.enum([
    'INTEGRADOR_ADMIN',     // Apenas SUPER_ADMIN pode convidar (admin do tenant)
    'INTEGRADOR_TECNICO',
    'CLIENTE_ADMIN',
    'CLIENTE_OPERADOR',
    'CLIENTE_VIEWER',
  ]),
  // Para SUPER_ADMIN/INTEGRADOR_ADMIN convidando CLIENTE_*: precisa o destino.
  // Aceita UUID ou slug legacy (ex.: `cf-acme-shopping`) — tenants seedados
  // antes da migração para UUIDs estritos ainda usam slugs.
  clienteFinalId:  tenantIdOptional,
  // Para SUPER_ADMIN convidando alguém em outro integrador (raro).
  integradorId:    tenantIdOptional,
})

/**
 * Gera senha temporária legível (12 chars base64url).
 * Não vai pro banco em texto puro — é hashada antes do create.
 */
function generateTempPassword(): string {
  return randomBytes(9).toString('base64url')
}

/**
 * Envia email de convite de usuário.
 * Usa SMTP e template "invite" do SystemConfig (DB). Fallback para .env e
 * template padrão hardcoded. Falha silenciosa — devolve reason se não enviou.
 */
async function trySendInviteEmail(opts: {
  to: string
  name: string
  loginUrl: string
  tempPassword: string
  inviterName?: string
}): Promise<{ sent: boolean; reason?: string }> {
  // Verifica se SMTP está configurado (DB ou .env)
  const smtp = await loadSmtp()
  if (!smtp.host || !smtp.user) {
    return { sent: false, reason: 'SMTP não configurado' }
  }

  // Carrega template "invite" do DB (ou usa o padrão)
  const tpl = await loadTemplate('invite')
  if (!tpl) return { sent: false, reason: 'Template de convite não encontrado' }

  const vars: Record<string, string> = {
    name:        opts.name,
    email:       opts.to,
    password:    opts.tempPassword,
    loginUrl:    opts.loginUrl,
    inviterName: opts.inviterName ?? 'IA Cloud Vision',
  }

  const subject = renderTemplate(tpl.subject, vars)
  const text    = renderTemplate(tpl.body,    vars)

  try {
    const nodemailer: any = await import('nodemailer').catch(() => null)
    if (!nodemailer) return { sent: false, reason: 'nodemailer não instalado' }

    const transporter = nodemailer.createTransport({
      host:   smtp.host,
      port:   smtp.port,
      secure: smtp.secure,
      auth:   { user: smtp.user, pass: smtp.pass },
      tls:    { rejectUnauthorized: false },
      connectionTimeout: 10_000,
    })

    await transporter.sendMail({
      from:    `"${smtp.fromName}" <${smtp.fromAddress}>`,
      to:      opts.to,
      subject,
      text,
    })

    logger.info({ to: opts.to, subject }, 'invite_email_sent')
    return { sent: true }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'invite_email_send_failed')
    return { sent: false, reason: err.message ?? 'Falha SMTP' }
  }
}

usersRouter.post('/invite', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const parse = InviteSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const b = parse.data

  // ── Resolver tenant scope do convidado conforme convidador ─────────────
  let targetIntegradorId: string | null = null
  let targetClienteFinalId: string | null = null

  if (jwt.role === 'SUPER_ADMIN') {
    // SA pode convidar pra qualquer tenant — mas precisa ser explícito.
    if (b.role === 'INTEGRADOR_ADMIN' || b.role === 'INTEGRADOR_TECNICO') {
      if (!b.integradorId) throw new ValidationError(`integradorId obrigatório para ${b.role}`)
      targetIntegradorId = b.integradorId
    } else {
      // CLIENTE_*
      if (!b.clienteFinalId) throw new ValidationError('clienteFinalId obrigatório para roles CLIENTE_*')
      const cf = await prisma.clienteFinal.findUnique({
        where: { id: b.clienteFinalId },
        select: { id: true, integradorId: true },
      })
      if (!cf) throw new NotFoundError('ClienteFinal')
      targetClienteFinalId = cf.id
      targetIntegradorId   = cf.integradorId
    }
  } else if (jwt.role === 'INTEGRADOR_ADMIN') {
    if (!jwt.integradorId) throw new UnauthorizedError('JWT sem integradorId')
    // INTEGRADOR_ADMIN não pode convidar outro INTEGRADOR_ADMIN
    if (b.role === 'INTEGRADOR_ADMIN') throw new ForbiddenError('Apenas SUPER_ADMIN pode convidar outro INTEGRADOR_ADMIN')

    if (b.role === 'INTEGRADOR_TECNICO') {
      // Técnico do próprio integrador.
      targetIntegradorId = jwt.integradorId
    } else {
      // CLIENTE_* — precisa do clienteFinalId, e ele precisa pertencer
      // ao integrador do convidador.
      if (!b.clienteFinalId) throw new ValidationError('clienteFinalId obrigatório para roles CLIENTE_*')
      const cf = await prisma.clienteFinal.findFirst({
        where: { id: b.clienteFinalId, integradorId: jwt.integradorId },
        select: { id: true, integradorId: true },
      })
      if (!cf) throw new NotFoundError('ClienteFinal (ou fora do seu tenant)')
      targetClienteFinalId = cf.id
      targetIntegradorId   = cf.integradorId
    }
  } else if (jwt.role === 'CLIENTE_ADMIN') {
    if (!jwt.clienteFinalId) throw new UnauthorizedError('JWT sem clienteFinalId')
    if (b.role !== 'CLIENTE_OPERADOR' && b.role !== 'CLIENTE_VIEWER') {
      throw new ValidationError('CLIENTE_ADMIN só pode convidar CLIENTE_OPERADOR/VIEWER')
    }
    targetClienteFinalId = jwt.clienteFinalId
    targetIntegradorId   = jwt.integradorId ?? null
  } else {
    throw new UnauthorizedError('Role sem permissão de convite')
  }

  // ── Conflito de email (User.email é unique) ─────────────────────────────
  const exists = await prisma.user.findUnique({ where: { email: b.email }, select: { id: true } })
  if (exists) throw new ValidationError(`Email já cadastrado: ${b.email}`)

  // ── Criar usuário com senha temporária ─────────────────────────────────
  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  const user = await prisma.user.create({
    data: {
      email:          b.email,
      name:           b.name,
      role:           b.role as any,
      passwordHash,
      integradorId:   targetIntegradorId,
      clienteFinalId: targetClienteFinalId,
      active:         true,
    },
    select: {
      id: true, email: true, name: true, role: true,
      integradorId: true, clienteFinalId: true, createdAt: true,
    },
  })

  // ── Tentar email ────────────────────────────────────────────────────────
  const loginUrl = process.env.PUBLIC_FRONTEND_URL ?? 'http://localhost:5173/login'
  const emailResult = await trySendInviteEmail({
    to:           b.email,
    name:         b.name,
    loginUrl,
    tempPassword,
    inviterName:  jwt.role,
  })

  // ── Auditoria ──────────────────────────────────────────────────────────
  try {
    await prisma.auditLog.create({
      data: {
        action:        'USER_INVITED',
        resource:      'User',
        resourceId:    user.id,
        integradorId:  targetIntegradorId,
        clienteFinalId:targetClienteFinalId,
        // superAdminId/userId conforme quem convidou:
        ...(jwt.role === 'SUPER_ADMIN' ? { superAdminId: jwt.sub } : { userId: jwt.sub }),
      },
    })
  } catch (err: any) {
    // AuditLog opcional — não bloqueia convite.
    logger.warn({ err: err.message }, 'invite_audit_log_failed')
  }

  logger.info({
    userId: user.id, email: user.email, role: user.role,
    inviterRole: jwt.role, emailSent: emailResult.sent,
  }, 'user_invited')

  // ⚠️ tempPassword é exposto UMA vez aqui. Se email falhou, admin precisa
  // repassar manualmente.
  res.status(201).json({
    user,
    invitation: {
      tempPassword,
      loginUrl,
      emailSent:   emailResult.sent,
      emailReason: emailResult.reason ?? null,
    },
  })
}))

// =============================================================================
// Helpers de escopo: garante que quem chama tem permissão sobre o usuário alvo.
// =============================================================================

async function loadUserInScope(jwt: any, userId: string) {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, role: true, active: true,
      integradorId: true, clienteFinalId: true, mustChangePassword: true,
    },
  })
  if (!target) throw new NotFoundError('User')

  if (jwt.role === 'SUPER_ADMIN') return target
  if (jwt.role === 'INTEGRADOR_ADMIN') {
    if (target.integradorId !== jwt.integradorId) throw new ForbiddenError('Usuário fora do seu tenant')
    return target
  }
  if (jwt.role === 'CLIENTE_ADMIN') {
    if (target.clienteFinalId !== jwt.clienteFinalId) throw new ForbiddenError('Usuário fora do seu tenant')
    if (target.role !== 'CLIENTE_OPERADOR' && target.role !== 'CLIENTE_VIEWER') {
      throw new ForbiddenError('CLIENTE_ADMIN só gerencia OPERADOR/VIEWER')
    }
    return target
  }
  throw new ForbiddenError('Sem permissão')
}

// =============================================================================
// PATCH /users/:id  → atualizar nome, email, role, active
// =============================================================================
const UpdateUserSchema = z.object({
  name:   z.string().min(2).max(120).optional(),
  email:  z.string().email().optional(),
  role:   z.enum([
    'SUPER_ADMIN','INTEGRADOR_ADMIN','INTEGRADOR_TECNICO',
    'CLIENTE_ADMIN','CLIENTE_OPERADOR','CLIENTE_VIEWER',
  ]).optional(),
  active: z.boolean().optional(),
})

usersRouter.patch('/:id', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const target = await loadUserInScope(jwt, String(req.params.id))

  const parse = UpdateUserSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const b = parse.data

  // Não-SUPER_ADMIN não pode promover para SUPER_ADMIN
  if (b.role === 'SUPER_ADMIN' && jwt.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Apenas SUPER_ADMIN pode atribuir role SUPER_ADMIN')
  }
  // Não pode auto-rebaixar
  if (target.id === jwt.sub && (b.active === false || (b.role && b.role !== target.role))) {
    throw new ForbiddenError('Não é possível alterar role/status do próprio usuário')
  }

  // Email único
  if (b.email && b.email !== target.email) {
    const conflict = await prisma.user.findUnique({ where: { email: b.email }, select: { id: true } })
    if (conflict) throw new ValidationError('Email já cadastrado')
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(b.name   !== undefined ? { name: b.name } : {}),
      ...(b.email  !== undefined ? { email: b.email } : {}),
      ...(b.role   !== undefined ? { role: b.role as any } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    },
    select: { id: true, email: true, name: true, role: true, active: true },
  })

  await prisma.auditLog.create({
    data: {
      action: 'USER_UPDATED',
      resource: 'User',
      resourceId: target.id,
      integradorId: target.integradorId,
      clienteFinalId: target.clienteFinalId,
      metadataJson: { changes: b } as any,
      ...(jwt.role === 'SUPER_ADMIN' ? { superAdminId: jwt.sub } : { userId: jwt.sub }),
    },
  }).catch(err => logger.warn({ err: err.message }, 'user_update_audit_failed'))

  logger.info({ userId: target.id, by: jwt.sub, changes: b }, 'user_updated')
  res.json({ user: updated })
}))

// =============================================================================
// DELETE /users/:id  → soft-delete (active=false)
// =============================================================================
usersRouter.delete('/:id', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const target = await loadUserInScope(jwt, String(req.params.id))

  if (target.id === jwt.sub) throw new ForbiddenError('Não é possível desativar o próprio usuário')

  await prisma.user.update({
    where: { id: target.id },
    data:  { active: false },
  })

  await prisma.auditLog.create({
    data: {
      action: 'USER_DEACTIVATED',
      resource: 'User',
      resourceId: target.id,
      integradorId: target.integradorId,
      clienteFinalId: target.clienteFinalId,
      ...(jwt.role === 'SUPER_ADMIN' ? { superAdminId: jwt.sub } : { userId: jwt.sub }),
    },
  }).catch(err => logger.warn({ err: err.message }, 'user_delete_audit_failed'))

  logger.info({ userId: target.id, by: jwt.sub }, 'user_deactivated')
  res.json({ ok: true, deactivatedId: target.id })
}))

// =============================================================================
// POST /users/:id/reset-password  → admin força nova senha temporária
// =============================================================================
usersRouter.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const target = await loadUserInScope(jwt, String(req.params.id))

  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash, mustChangePassword: true },
  })

  // Tenta reenviar email com nova senha
  const loginUrl = process.env.PUBLIC_FRONTEND_URL ?? 'http://localhost:5173/login'
  const emailResult = await trySendInviteEmail({
    to: target.email,
    name: target.name ?? target.email,
    loginUrl,
    tempPassword,
    inviterName: jwt.role,
  })

  await prisma.auditLog.create({
    data: {
      action: 'USER_PASSWORD_RESET',
      resource: 'User',
      resourceId: target.id,
      integradorId: target.integradorId,
      clienteFinalId: target.clienteFinalId,
      metadataJson: { emailSent: emailResult.sent } as any,
      ...(jwt.role === 'SUPER_ADMIN' ? { superAdminId: jwt.sub } : { userId: jwt.sub }),
    },
  }).catch(err => logger.warn({ err: err.message }, 'user_reset_audit_failed'))

  logger.info({ userId: target.id, by: jwt.sub, emailSent: emailResult.sent }, 'user_password_reset')
  res.json({
    ok: true,
    tempPassword,
    emailSent: emailResult.sent,
    emailReason: emailResult.reason ?? null,
  })
}))

// =============================================================================
// POST /users/:id/resend-invite  → reenvia email com nova senha temporária
// =============================================================================
usersRouter.post('/:id/resend-invite', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const target = await loadUserInScope(jwt, String(req.params.id))

  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash, mustChangePassword: true },
  })

  const loginUrl = process.env.PUBLIC_FRONTEND_URL ?? 'http://localhost:5173/login'
  const emailResult = await trySendInviteEmail({
    to: target.email,
    name: target.name ?? target.email,
    loginUrl,
    tempPassword,
    inviterName: jwt.role,
  })

  res.json({
    ok: true,
    tempPassword,
    emailSent: emailResult.sent,
    emailReason: emailResult.reason ?? null,
  })
}))
