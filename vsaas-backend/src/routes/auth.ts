import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { UnauthorizedError, ValidationError, NotFoundError, ForbiddenError } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { auditAction } from '../lib/audit-helpers'

export const authRouter = Router()

// Brute-force guard em /login: 5 falhas por janela (default 5min) por
// IP+email. Sucesso (2xx) não conta — só penaliza tentativa inválida.
const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 5 * 60_000),
  max:      Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 5),
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const rawIp = req.ip ?? 'unknown'
    // Para IPv6, agrupa em /64 (4 primeiros hextets) para não escapar do
    // limit via prefixo rotativo do mesmo cliente.
    const ip = rawIp.includes(':')
      ? rawIp.split(':').slice(0, 4).join(':')
      : rawIp
    const email = typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : 'no-email'
    return `login:${ip}:${email}`
  },
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
})

// ───────────────── helpers ──────────────────────────────────────────────

async function resolveActor(payload: { sub: string; role: string }) {
  if (payload.role === 'SUPER_ADMIN') {
    const sa = await prisma.superAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, createdAt: true },
    })
    if (!sa) return null
    return { kind: 'SUPER_ADMIN' as const, ...sa, integrador: null, clienteFinal: null }
  }

  if (payload.role === 'INTEGRADOR_ADMIN') {
    const integ = await prisma.integrador.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, name: true, email: true, createdAt: true,
        tradeName: true, cnpj: true, phone: true, website: true,
      },
    })
    if (!integ) return null
    return { kind: 'INTEGRADOR' as const, ...integ, integrador: integ, clienteFinal: null }
  }

  // User (pode ter role de Integrador Técnico ou qualquer papel de ClienteFinal)
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: {
      integrador:   { select: { id: true, name: true, tradeName: true } },
      clienteFinal: { select: { id: true, name: true, tradeName: true } },
    },
  })
  if (!user) return null
  return {
    kind: 'USER' as const,
    id:   user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    role: user.role,
    integrador:   user.integrador,
    clienteFinal: user.clienteFinal,
  }
}

async function updatePassword(payload: { sub: string; role: string }, newHash: string) {
  if (payload.role === 'SUPER_ADMIN') {
    await prisma.superAdmin.update({ where: { id: payload.sub }, data: { passwordHash: newHash } })
    return
  }
  if (payload.role === 'INTEGRADOR_ADMIN') {
    await prisma.integrador.update({ where: { id: payload.sub }, data: { passwordHash: newHash } })
    return
  }
  // Reset mustChangePassword on successful password change (Lote 2 / Lote 5)
  await prisma.user.update({
    where: { id: payload.sub },
    data: { passwordHash: newHash, mustChangePassword: false },
  })
}

async function getCurrentHash(payload: { sub: string; role: string }): Promise<string | null> {
  if (payload.role === 'SUPER_ADMIN') {
    const r = await prisma.superAdmin.findUnique({ where: { id: payload.sub }, select: { passwordHash: true } })
    return r?.passwordHash ?? null
  }
  if (payload.role === 'INTEGRADOR_ADMIN') {
    const r = await prisma.integrador.findUnique({ where: { id: payload.sub }, select: { passwordHash: true } })
    return r?.passwordHash ?? null
  }
  const r = await prisma.user.findUnique({ where: { id: payload.sub }, select: { passwordHash: true } })
  return r?.passwordHash ?? null
}

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
})

authRouter.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const parse = LoginSchema.safeParse(req.body)
  // Mesma mensagem para email/senha inválidos — evita user enumeration.
  if (!parse.success) throw new UnauthorizedError('Email ou senha inválidos')

  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET not configured')

  const { email, password } = parse.data

  type Actor = {
    id: string
    passwordHash: string
    role: string
    integradorId?: string
    clienteFinalId?: string
    mustChangePassword?: boolean
  }

  let actor: Actor | null = null

  const superAdmin = await prisma.superAdmin.findUnique({ where: { email } })
  if (superAdmin) {
    actor = { id: superAdmin.id, passwordHash: superAdmin.passwordHash, role: 'SUPER_ADMIN' }
  }

  if (!actor) {
    const integrador = await prisma.integrador.findUnique({ where: { email } })
    if (integrador) {
      actor = {
        id: integrador.id,
        passwordHash: integrador.passwordHash,
        role: 'INTEGRADOR_ADMIN',
        integradorId: integrador.id,
      }
    }
  }

  if (!actor) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (user) {
      actor = {
        id:                 user.id,
        passwordHash:       user.passwordHash,
        role:               user.role,
        integradorId:       user.integradorId ?? undefined,
        clienteFinalId:     user.clienteFinalId ?? undefined,
        mustChangePassword: user.mustChangePassword,
      }
    }
  }

  if (!actor || !(await bcrypt.compare(password, actor.passwordHash))) {
    // Onda 12.1 — LOGIN_FAILED com email tentado (sem senha) + IP/UA
    // Útil para brute-force detection (filtrar por IP + actorEmail).
    await auditAction(prisma, {
      action:     'LOGIN_FAILED',
      resource:   'User',
      resourceId: null,
      result:     'BLOCKED',
      metadata:   {
        attemptedEmail: email,
        reason: !actor ? 'unknown_email' : 'invalid_password',
      },
      req,
    })
    throw new UnauthorizedError('Email ou senha inválidos')
  }

  const token = jwt.sign(
    {
      sub:            actor.id,
      role:           actor.role,
      integradorId:   actor.integradorId,
      clienteFinalId: actor.clienteFinalId,
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? '8h' } as jwt.SignOptions,
  )

  // Onda 12.1 — LOGIN_SUCCESS para LGPD/forense (quem acessou, quando, IP)
  // Importante: req.jwtPayload ainda está vazio (login é o que cria o JWT),
  // então passamos o ator manualmente via campos diretos no metadata e o
  // auditAction usa softAuth (que não populou nada). Reforçamos no insert
  // direto se necessário.
  await auditAction(prisma, {
    action:     'LOGIN_SUCCESS',
    resource:   'User',
    resourceId: actor.id,
    result:     'SUCCESS',
    metadata: {
      email,
      role:               actor.role,
      integradorId:       actor.integradorId,
      clienteFinalId:     actor.clienteFinalId,
      mustChangePassword: actor.mustChangePassword ?? false,
    },
    req,
  })

  res.json({
    token,
    role:               actor.role,
    mustChangePassword: actor.mustChangePassword ?? false,
  })
}))

// ════════════════════════════════════════════════════════════════════════════
// POST /auth/sudo — step-up auth pra integrador acessar dados sensíveis
// ════════════════════════════════════════════════════════════════════════════
// Razão: live/recordings/faces/plates contêm dados pessoais do cliente final.
// Integrador tem permissão técnica mas LGPD exige finalidade declarada. Exigir
// senha + motivo a cada janela de 15min trata como "sudo": o ato de digitar
// senha pra desbloquear força conscientização e gera audit log forte.
//
// Não aplica a SUPER_ADMIN (fabricante) nem CLIENTE_* (donos). Aplica só a
// INTEGRADOR_ADMIN — INTEGRADOR_TECNICO sequer vê os itens na sidebar.
const SudoSchema = z.object({
  password:        z.string().min(1),
  reason:          z.string().min(10).max(500),
  durationSeconds: z.number().int().min(300).max(3600).optional(), // 5min–1h
  acknowledged:    z.boolean().refine(v => v === true, {
    message: 'É necessário concordar que o acesso fica registrado e visível ao cliente (LGPD)',
  }),
})

authRouter.post('/sudo', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload!

  // Apenas INTEGRADOR_ADMIN pode elevar. TECNICO nem deveria estar pedindo —
  // se chegou aqui é tentativa indevida.
  if (p.role !== 'INTEGRADOR_ADMIN') {
    throw new ForbiddenError('Apenas INTEGRADOR_ADMIN pode solicitar elevação')
  }
  if (p.impersonatedBy) {
    throw new ForbiddenError('Não é permitido elevar dentro de uma sessão impersonada')
  }

  const parse = SudoSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')
  const { password, reason, durationSeconds } = parse.data
  const expiresInSec = durationSeconds ?? 900 // 15min default

  // Valida a senha do Integrador (ator é o owner do tenant).
  const integrador = await prisma.integrador.findUnique({
    where:  { id: p.sub },
    select: { id: true, passwordHash: true, active: true },
  })
  if (!integrador || !integrador.active) {
    throw new ForbiddenError('Conta inativa')
  }
  const ok = await bcrypt.compare(password, integrador.passwordHash)
  if (!ok) {
    // Audit failure pra detectar brute-force de elevação
    await auditAction(prisma, {
      action:     'ELEVATED_ACCESS_DENIED',
      resource:   'Integrador',
      resourceId: p.sub,
      result:     'BLOCKED',
      metadata:   { reason: 'invalid_password' },
      req,
    })
    throw new UnauthorizedError('Senha inválida')
  }

  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET not configured')

  const sudoToken = jwt.sign(
    {
      sub:       p.sub,
      parentSub: p.sub,
      scope:     'sudo' as const,
      reason,
    },
    secret,
    { expiresIn: expiresInSec } as jwt.SignOptions,
  )

  // Audit forte — mesma scope que ImpersonateSession
  await prisma.auditLog.create({
    data: {
      integradorId: p.sub,
      userId:       null,
      action:       'ELEVATED_ACCESS_GRANT',
      resource:     'Integrador',
      resourceId:   p.sub,
      metadataJson: {
        reason,
        durationSeconds: expiresInSec,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
    },
  })

  res.json({
    sudoToken,
    expiresInSeconds: expiresInSec,
    expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
  })
}))

// ── POST /auth/sudo/revoke ────────────────────────────────────────────────
authRouter.post('/sudo/revoke', requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload!
  // Só audita; o JWT sudo é stateless e expira sozinho. Frontend limpa storage.
  if (p.role === 'INTEGRADOR_ADMIN') {
    await prisma.auditLog.create({
      data: {
        integradorId: p.sub,
        action:       'ELEVATED_ACCESS_REVOKED',
        resource:     'Integrador',
        resourceId:   p.sub,
        metadataJson: { manual: true },
      },
    })
  }
  res.json({ ok: true })
}))

// ───────────────── GET /auth/me ────────────────────────────────────────
authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const actor = await resolveActor(req.jwtPayload!)
  if (!actor) throw new NotFoundError('Usuário')
  res.json(actor)
}))

// ───────────────── PATCH /auth/me  (editar nome/telefone) ──────────────
const UpdateProfileSchema = z.object({
  name:  z.string().min(1).max(120).optional(),
  phone: z.string().max(32).optional(),
})
authRouter.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const parse = UpdateProfileSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError('Dados inválidos')
  const patch = parse.data
  const payload = req.jwtPayload!

  if (payload.role === 'SUPER_ADMIN') {
    if (patch.name) {
      await prisma.superAdmin.update({ where: { id: payload.sub }, data: { name: patch.name } })
    }
  } else if (payload.role === 'INTEGRADOR_ADMIN') {
    await prisma.integrador.update({
      where: { id: payload.sub },
      data: {
        ...(patch.name  !== undefined ? { name: patch.name  } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      },
    })
  } else {
    await prisma.user.update({
      where: { id: payload.sub },
      data: { ...(patch.name !== undefined ? { name: patch.name } : {}) },
    })
  }

  const fresh = await resolveActor(payload)
  res.json(fresh)
}))

// ───────────────── PATCH /auth/me/avatar (Lote 6) ─────────────────────
const AvatarSchema = z.object({
  // Aceita URL externa ou data URL (base64). Máx 2MB em data URL (~2.7MB base64).
  avatarUrl: z.string().max(2_200_000).refine(
    v => v.startsWith('data:image/') || v.startsWith('https://') || v.startsWith('http://'),
    'avatarUrl deve ser data URL de imagem ou URL https',
  ).nullable(),
})
authRouter.patch('/me/avatar', requireAuth, asyncHandler(async (req, res) => {
  const parse = AvatarSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'Avatar inválido')

  const payload = req.jwtPayload!

  // Apenas User (não SuperAdmin nem IntegradorAdmin — não têm avatarUrl no schema)
  if (payload.role === 'SUPER_ADMIN' || payload.role === 'INTEGRADOR_ADMIN') {
    throw new ValidationError('Avatar não suportado para este perfil')
  }

  const updated = await prisma.user.update({
    where: { id: payload.sub },
    data:  { avatarUrl: parse.data.avatarUrl },
    select: { id: true, name: true, email: true, avatarUrl: true, role: true },
  })

  res.json(updated)
}))

// ───────────────── POST /auth/box-token ────────────────────────────────
//
// SSO Box: técnico do integrador usa o mesmo login da Cloud para acessar
// o portal local de uma Box específica, sem senha separada.
//
// Fluxo:
//   1. Técnico faz login na Cloud → JWT normal (8h)
//   2. Técnico (ou a Box) chama POST /auth/box-token { edgeNodeId }
//   3. Cloud valida que o usuário tem acesso àquela Box (mesmo integrador)
//   4. Cloud retorna box_token JWT curto (1h), assinado com BOX_JWT_SECRET
//   5. Box valida o box_token com o mesmo secret → abre sessão local
//
// A Box sabe qual integradorId aceitar via EdgeNode.integradorId (populado no activate).
// Se integradorId bater com o do token → login autorizado, sem criar senha local.
//
const BoxTokenSchema = z.object({
  edgeNodeId: z.string().uuid(),
})

authRouter.post('/box-token', requireAuth, asyncHandler(async (req, res) => {
  const jwt_payload = req.jwtPayload!

  // Apenas INTEGRADOR_ADMIN e INTEGRADOR_TECNICO podem solicitar acesso à Box
  if (!['INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'SUPER_ADMIN'].includes(jwt_payload.role)) {
    throw new UnauthorizedError('Apenas técnicos do integrador podem acessar o portal da Box')
  }

  const parse = BoxTokenSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const { edgeNodeId } = parse.data

  // Verificar que o EdgeNode existe e pertence ao integrador do usuário
  const node = await prisma.edgeNode.findUnique({
    where: { id: edgeNodeId },
    include: {
      site: { include: { clienteFinal: { select: { integradorId: true } } } },
    },
  })
  if (!node) throw new NotFoundError('Edge Node')

  const nodeIntegradorId = node.integradorId ?? node.site.clienteFinal.integradorId

  // SUPER_ADMIN tem acesso irrestrito; para os demais, verificar tenant
  if (jwt_payload.role !== 'SUPER_ADMIN' && nodeIntegradorId !== jwt_payload.integradorId) {
    throw new UnauthorizedError('Box não pertence ao seu integrador')
  }

  // Verificar ACL de técnico (IntegradorTechnicianAccess), se existir
  if (jwt_payload.role === 'INTEGRADOR_TECNICO') {
    const acl = await prisma.integradorTechnicianAccess.findFirst({
      where: {
        technicianUserId: jwt_payload.sub,
        integradorId:     nodeIntegradorId ?? undefined,
        revokedAt:        null,
      },
    })
    // Se tem registros de ACL e o clienteFinal da box não está na lista → negar
    const hasAnyAcl = await prisma.integradorTechnicianAccess.count({
      where: { technicianUserId: jwt_payload.sub, revokedAt: null },
    })
    if (hasAnyAcl > 0 && !acl) {
      throw new UnauthorizedError('Técnico não tem acesso a este cliente')
    }
  }

  const boxSecret = process.env.BOX_JWT_SECRET ?? process.env.JWT_SECRET
  if (!boxSecret) throw new Error('BOX_JWT_SECRET não configurado')

  // Buscar dados do usuário para incluir no token
  const user = await prisma.user.findUnique({
    where: { id: jwt_payload.sub },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!user) throw new NotFoundError('Usuário')

  // Emitir box_token com TTL 1h, escopo restrito a este EdgeNode
  const boxToken = jwt.sign(
    {
      sub:          user.id,
      name:         user.name,
      email:        user.email,
      role:         jwt_payload.role,
      integradorId: nodeIntegradorId,
      edgeNodeId,
      aud:          `box:${edgeNodeId}`,
    },
    boxSecret,
    { expiresIn: '1h' } as jwt.SignOptions,
  )

  // Atualizar integradorId no EdgeNode se ainda não estava preenchido
  if (!node.integradorId && nodeIntegradorId) {
    await prisma.edgeNode.update({
      where: { id: edgeNodeId },
      data: { integradorId: nodeIntegradorId },
    }).catch(() => { /* não crítico */ })
  }

  res.json({
    boxToken,
    expiresIn: 3600,
    edgeNodeId,
    integradorId: nodeIntegradorId,
    user: { id: user.id, name: user.name, email: user.email, role: jwt_payload.role },
    instructions: {
      use: 'Envie este token no header: Authorization: Bearer <boxToken>',
      validate: `Box valida usando BOX_JWT_SECRET e verifica aud === "box:${edgeNodeId}"`,
    },
  })
}))

// ───────────────── POST /auth/change-password ──────────────────────────
const ChangePwSchema = z.object({
  current: z.string().min(6, 'Senha atual deve ter ao menos 6 caracteres'),
  next:    z.string().min(8, 'Nova senha deve ter ao menos 8 caracteres'),
})
authRouter.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const parse = ChangePwSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'Senha inválida')
  const payload = req.jwtPayload!

  const currentHash = await getCurrentHash(payload)
  if (!currentHash) throw new NotFoundError('Usuário')

  const ok = await bcrypt.compare(parse.data.current, currentHash)
  if (!ok) {
    // Onda 12.2 — tentativa de troca de senha com senha atual errada
    // (suspeita de comprometimento de sessão)
    await auditAction(prisma, {
      action:     'PASSWORD_CHANGE_FAILED',
      resource:   'User',
      resourceId: payload.sub,
      result:     'BLOCKED',
      metadata:   { reason: 'invalid_current_password' },
      req,
    })
    throw new UnauthorizedError('Senha atual incorreta')
  }

  const newHash = await bcrypt.hash(parse.data.next, 12)
  await updatePassword(payload, newHash)

  // Onda 12.2 — PASSWORD_CHANGED é evento crítico LGPD (titular pode pedir
  // "quem trocou minha senha em X data?"). Não loga a senha (helper redact).
  await auditAction(prisma, {
    action:     'PASSWORD_CHANGED',
    resource:   'User',
    resourceId: payload.sub,
    result:     'SUCCESS',
    metadata:   { role: payload.role },
    req,
  })

  res.json({ ok: true })
}))
