import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { UnauthorizedError, ValidationError, NotFoundError } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'

export const authRouter = Router()

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

authRouter.post('/login', asyncHandler(async (req, res) => {
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

  res.json({
    token,
    role:               actor.role,
    mustChangePassword: actor.mustChangePassword ?? false,
  })
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
  if (!ok) throw new UnauthorizedError('Senha atual incorreta')

  const newHash = await bcrypt.hash(parse.data.next, 12)
  await updatePassword(payload, newHash)

  res.json({ ok: true })
}))
