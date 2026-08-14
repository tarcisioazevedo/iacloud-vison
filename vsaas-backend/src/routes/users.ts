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
import { loadSmtp, loadTemplate, renderTemplate } from '../lib/smtp'
import { publicRoute } from '../middleware/require-capability'

export const usersRouter = Router()
usersRouter.use(requireAuth)

// =============================================================================
// GET /users  → lista escopada
// =============================================================================

usersRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
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

  // Filtros opcionais (escopados — só estreitam, nunca expandem)
  const qpClienteFinalId = typeof req.query.clienteFinalId === 'string' ? req.query.clienteFinalId : null
  const qpRole = typeof req.query.role === 'string' ? req.query.role : null
  const qpQ    = typeof req.query.q === 'string' ? req.query.q.trim() : null

  if (qpClienteFinalId) {
    // INTEGRADOR_ADMIN/TECNICO: precisa garantir que o ClienteFinal pertence ao tenant.
    if (jwt.role === 'INTEGRADOR_ADMIN' || jwt.role === 'INTEGRADOR_TECNICO') {
      const cf = await prisma.clienteFinal.findFirst({
        where: { id: qpClienteFinalId, integradorId: jwt.integradorId! },
        select: { id: true },
      })
      if (!cf) throw new ForbiddenError('ClienteFinal fora do seu tenant')
    } else if (jwt.role === 'CLIENTE_ADMIN' || jwt.role === 'CLIENTE_OPERADOR' || jwt.role === 'CLIENTE_VIEWER') {
      if (qpClienteFinalId !== jwt.clienteFinalId) throw new ForbiddenError('Fora do seu tenant')
    }
    where = { ...where, clienteFinalId: qpClienteFinalId }
  }
  if (qpRole) {
    where = { ...where, role: qpRole }
  }
  if (qpQ) {
    where = {
      ...where,
      OR: [
        { name:  { contains: qpQ, mode: 'insensitive' } },
        { email: { contains: qpQ, mode: 'insensitive' } },
      ],
    }
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, email: true, name: true, role: true, active: true,
      lastLoginAt: true, createdAt: true,
      // Sprint A — gestão granular
      allowedSiteIds: true, allowedCameraIds: true,
      accessSchedule: true, expiresAt: true, lockedUntil: true,
      lgpdAcceptedAt: true, lgpdPolicyVersion: true,
      totpEnabledAt: true, mustChangePassword: true,
      passwordChangedAt: true, passwordExpiresAt: true,
      tags: true, capabilityOverrides: true,
      mobileAppAllowed: true, vacationUntil: true, deniedActions: true,
      integrador:   { select: { id: true, name: true } },
      clienteFinal: { select: { id: true, name: true } },
      // Conta sessões ativas (não revogadas, não expiradas)
      _count: {
        select: {
          sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } },
        },
      },
    },
    orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  })
  res.json({ users, total: users.length })
}))

// =============================================================================
// GET /users/sessions/active  — sessões ativas do tenant em UMA query
// =============================================================================
// Substitui o N+1 do frontend (que fazia 1 request por user).
// Retorna sessões não-revogadas e não-expiradas, com info do user embutida,
// já no escopo do tenant do caller.
//
// Sprint A P1 fix
usersRouter.get('/sessions/active',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!

    // Tenant scope — VISIBILIDADE: mostra TODAS as sessões do tenant
    // (admin precisa saber quem está logado, incluindo peer-admins e si mesmo).
    // A capacidade de REVOGAR é separada (flag canRevoke por linha, calculada
    // depois) — segue a matriz do loadUserInScope().
    let userWhere: any = {}
    if (jwt.role === 'SUPER_ADMIN' || jwt.role === 'ADMIN_GLOBAL') {
      userWhere = {}
    } else if (jwt.role === 'INTEGRADOR_ADMIN' || jwt.role === 'INTEGRADOR_TECNICO') {
      if (!jwt.integradorId) throw new UnauthorizedError('JWT sem integradorId')
      userWhere = { integradorId: jwt.integradorId }
    } else if (jwt.role === 'CLIENTE_ADMIN') {
      if (!jwt.clienteFinalId) throw new UnauthorizedError('JWT sem clienteFinalId')
      // Vê TODAS as sessões do cliente final (inclusive outros ADMINs/SUPERVISORS).
      // canRevoke por linha controla quais ele pode efetivamente derrubar.
      userWhere = { clienteFinalId: jwt.clienteFinalId }
    } else {
      throw new ForbiddenError('Sem permissão')
    }

    const now = new Date()
    const sessions = await prisma.userSession.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: now },
        user: userWhere,
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 500,
      select: {
        id: true, device: true, ip: true,
        createdAt: true, expiresAt: true, lastSeenAt: true,
        user: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    })

    // canRevoke por linha — espelha matriz do loadUserInScope().
    // SUPER/ADMIN_GLOBAL: revoga qualquer um.
    // INTEGRADOR_ADMIN: revoga qualquer um do seu integrador.
    // CLIENTE_ADMIN: revoga SUPERVISOR/OPERADOR/VIEWER do seu cliente final.
    // Própria sessão SEMPRE revogável (= logout forçado, válido).
    function canRevoke(targetRole: string, targetUserId: string): boolean {
      if (targetUserId === jwt.sub) return true  // própria sessão = self-logout permitido
      if (jwt.role === 'SUPER_ADMIN' || jwt.role === 'ADMIN_GLOBAL') return true
      if (jwt.role === 'INTEGRADOR_ADMIN') return true
      if (jwt.role === 'CLIENTE_ADMIN') {
        return ['CLIENTE_SUPERVISOR', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER'].includes(targetRole)
      }
      return false
    }

    res.json({
      sessions: sessions.map(s => ({
        id: s.id,
        device: s.device,
        ip: s.ip,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastSeenAt: s.lastSeenAt,
        online: (now.getTime() - s.lastSeenAt.getTime()) < 5 * 60_000,
        isSelf: s.user.id === jwt.sub,
        canRevoke: canRevoke(s.user.role, s.user.id),
        user: s.user,
      })),
      total: sessions.length,
    })
  })
)

// =============================================================================
// POST /users/invite
// =============================================================================

const AccessScheduleSchema = z.object({
  weekdays:  z.array(z.number().int().min(0).max(6)).min(1).max(7),
  hourStart: z.number().int().min(0).max(23),
  hourEnd:   z.number().int().min(0).max(23),
  timezone:  z.string().optional(),
})

const CapabilityOverridesSchema = z.object({
  add:    z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
})

const InviteSchema = z.object({
  email:           z.string().email(),
  name:            z.string().min(2).max(120),
  role:            z.enum([
    'INTEGRADOR_ADMIN',     // Apenas SUPER_ADMIN pode convidar (admin do tenant)
    'INTEGRADOR_TECNICO',
    'CLIENTE_ADMIN',
    'CLIENTE_SUPERVISOR',
    'CLIENTE_OPERADOR',
    'CLIENTE_VIEWER',
  ]),
  // Para SUPER_ADMIN/INTEGRADOR_ADMIN convidando CLIENTE_*: precisa o destino.
  clienteFinalId:  z.string().uuid().optional(),
  // Para SUPER_ADMIN convidando alguém em outro integrador (raro).
  integradorId:    z.string().uuid().optional(),

  // ── Sprint A · Campos opcionais de gestão granular ───────────────────────
  allowedSiteIds:      z.array(z.string().uuid()).optional(),
  allowedCameraIds:    z.array(z.string().uuid()).optional(),
  accessSchedule:      AccessScheduleSchema.optional().nullable(),
  expiresAt:           z.string().datetime().optional().nullable(),
  tags:                z.array(z.string().max(40)).optional(),
  capabilityOverrides: CapabilityOverridesSchema.optional().nullable(),
  /// Se true, força usuário a configurar 2FA no 1º login (recomendado pra admins)
  requireMfaSetup:     z.boolean().optional(),
  /// Default true. Marque false pra bloquear acesso ao app mobile (só desktop).
  mobileAppAllowed:    z.boolean().optional(),
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
    inviterName: opts.inviterName ?? 'VSaaS',
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

usersRouter.post('/invite',
  publicRoute(),
  asyncHandler(async (req, res) => {
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
      mustChangePassword: true,
      // Sprint A — campos opcionais do convite
      allowedSiteIds:      b.allowedSiteIds ?? [],
      allowedCameraIds:    b.allowedCameraIds ?? [],
      accessSchedule:      (b.accessSchedule ?? undefined) as any,
      expiresAt:           b.expiresAt ? new Date(b.expiresAt) : null,
      tags:                b.tags ?? [],
      capabilityOverrides: (b.capabilityOverrides ?? undefined) as any,
      requireMfaSetup:     b.requireMfaSetup ?? false,
      mobileAppAllowed:    b.mobileAppAllowed ?? true,
    },
    select: {
      id: true, email: true, name: true, role: true,
      integradorId: true, clienteFinalId: true, createdAt: true,
      allowedSiteIds: true, allowedCameraIds: true,
      accessSchedule: true, expiresAt: true, tags: true,
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
    // P1 fix — alinhado com user-sessions.ts (que sempre permitiu SUPERVISOR)
    if (target.role !== 'CLIENTE_OPERADOR' && target.role !== 'CLIENTE_VIEWER' && target.role !== 'CLIENTE_SUPERVISOR') {
      throw new ForbiddenError('CLIENTE_ADMIN só gerencia SUPERVISOR/OPERADOR/VIEWER')
    }
    return target
  }
  throw new ForbiddenError('Sem permissão')
}

// Roles que cada papel pode atribuir em PATCH/INVITE. Defesa contra
// privilege escalation — CLIENTE_ADMIN promovendo OPERADOR pra CLIENTE_ADMIN.
const ROLE_ASSIGNMENT_MATRIX: Record<string, string[]> = {
  SUPER_ADMIN:      ['SUPER_ADMIN','ADMIN_GLOBAL','INTEGRADOR_ADMIN','INTEGRADOR_TECNICO','CLIENTE_ADMIN','CLIENTE_SUPERVISOR','CLIENTE_OPERADOR','CLIENTE_VIEWER'],
  ADMIN_GLOBAL:     ['ADMIN_GLOBAL','INTEGRADOR_ADMIN','INTEGRADOR_TECNICO','CLIENTE_ADMIN','CLIENTE_SUPERVISOR','CLIENTE_OPERADOR','CLIENTE_VIEWER'],
  INTEGRADOR_ADMIN: ['INTEGRADOR_TECNICO','CLIENTE_ADMIN','CLIENTE_SUPERVISOR','CLIENTE_OPERADOR','CLIENTE_VIEWER'],
  CLIENTE_ADMIN:    ['CLIENTE_SUPERVISOR','CLIENTE_OPERADOR','CLIENTE_VIEWER'],
}
function canAssignRole(callerRole: string, targetRole: string): boolean {
  const allowed = ROLE_ASSIGNMENT_MATRIX[callerRole] ?? []
  return allowed.includes(targetRole)
}

// =============================================================================
// PATCH /users/:id  → atualizar nome, email, role, active
// =============================================================================
const UpdateUserSchema = z.object({
  name:   z.string().min(2).max(120).optional(),
  email:  z.string().email().optional(),
  role:   z.enum([
    'SUPER_ADMIN','INTEGRADOR_ADMIN','INTEGRADOR_TECNICO',
    'CLIENTE_ADMIN','CLIENTE_SUPERVISOR','CLIENTE_OPERADOR','CLIENTE_VIEWER',
  ]).optional(),
  active: z.boolean().optional(),

  // ── Sprint A · Campos opcionais de gestão granular ───────────────────────
  allowedSiteIds:      z.array(z.string().uuid()).optional(),
  allowedCameraIds:    z.array(z.string().uuid()).optional(),
  accessSchedule:      AccessScheduleSchema.optional().nullable(),
  expiresAt:           z.string().datetime().optional().nullable(),
  tags:                z.array(z.string().max(40)).optional(),
  capabilityOverrides: CapabilityOverridesSchema.optional().nullable(),
  mobileAppAllowed:    z.boolean().optional(),
  vacationUntil:       z.string().datetime().optional().nullable(),
  deniedActions:       z.array(z.string().max(60)).optional(),
})

usersRouter.patch('/:id',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const target = await loadUserInScope(jwt, String(req.params.id))

  const parse = UpdateUserSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const b = parse.data

  // P0 fix — defesa contra privilege escalation. Antes só bloqueava promoção
  // pra SUPER_ADMIN; CLIENTE_ADMIN podia promover OPERADOR/VIEWER pra
  // CLIENTE_ADMIN livremente. Agora valida toda atribuição contra matriz.
  if (b.role && !canAssignRole(jwt.role, b.role)) {
    throw new ForbiddenError(`${jwt.role} não pode atribuir role ${b.role}`)
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
      // Sprint A — escopo e granularidade
      ...(b.allowedSiteIds      !== undefined ? { allowedSiteIds:      b.allowedSiteIds } : {}),
      ...(b.allowedCameraIds    !== undefined ? { allowedCameraIds:    b.allowedCameraIds } : {}),
      ...(b.accessSchedule      !== undefined ? { accessSchedule:      (b.accessSchedule ?? undefined) as any } : {}),
      ...(b.expiresAt           !== undefined ? { expiresAt:           b.expiresAt ? new Date(b.expiresAt) : null } : {}),
      ...(b.tags                !== undefined ? { tags:                b.tags } : {}),
      ...(b.capabilityOverrides !== undefined ? { capabilityOverrides: (b.capabilityOverrides ?? undefined) as any } : {}),
      ...(b.mobileAppAllowed    !== undefined ? { mobileAppAllowed:    b.mobileAppAllowed } : {}),
      ...(b.vacationUntil       !== undefined ? { vacationUntil:       b.vacationUntil ? new Date(b.vacationUntil) : null } : {}),
      ...(b.deniedActions       !== undefined ? { deniedActions:       b.deniedActions } : {}),
    },
    select: {
      id: true, email: true, name: true, role: true, active: true,
      allowedSiteIds: true, allowedCameraIds: true,
      accessSchedule: true, expiresAt: true, tags: true,
      mobileAppAllowed: true, vacationUntil: true, deniedActions: true,
    },
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
usersRouter.delete('/:id',
  publicRoute(),
  asyncHandler(async (req, res) => {
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
usersRouter.post('/:id/reset-password',
  publicRoute(),
  asyncHandler(async (req, res) => {
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
usersRouter.post('/:id/resend-invite',
  publicRoute(),
  asyncHandler(async (req, res) => {
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
