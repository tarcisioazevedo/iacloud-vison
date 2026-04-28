/**
 * Demo Invites — Lote 1 do onboarding revisado.
 *
 * Endpoints:
 *   POST   /leads/:id/invite       (admin) → emite DemoInvite + retorna magic link
 *   POST   /leads/:id/convert      (admin) → cria tenant (Integrador OU ClienteFinal)
 *                                            e marca lead CONVERTED.
 *   GET    /demo-invites           (admin) → lista
 *   POST   /demo-invites/:id/revoke(admin) → revoga
 *
 *   GET    /demo/:token            (público) → carrega convite (sem expor email)
 *   POST   /demo/:token/accept     (público) → aceita: usuário define senha,
 *                                              backend cria User admin do tenant
 *
 * D11 (token reusável): token plaintext nunca expira por uso parcial. Só
 * `accept` move status pra ACCEPTED. Acessar GET /demo/:token N vezes
 * dentro da janela retorna o mesmo payload — operador pode fechar a aba
 * sem perder o convite.
 */
import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../lib/errors'
import { logger } from '../lib/logger'

export const demoInvitesRouter   = Router()
export const demoPublicRouter    = Router()
export const leadActionsRouter   = Router()  // mountado em /leads (sub-actions)

// ── helpers ──────────────────────────────────────────────────────────────────

const INVITE_TTL_DAYS = 14

function hashToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex')
}

function generateToken(): { plaintext: string; hash: string } {
  // 32 bytes URL-safe → ~43 chars base64url. Suficiente pra inviabilizar
  // brute-force (não há rate limit por token, só por IP).
  const buf = crypto.randomBytes(32)
  const plaintext = buf.toString('base64url')
  return { plaintext, hash: hashToken(plaintext) }
}

function isFabricanteRole(role?: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
}

function requireFabricante(req: any) {
  if (!isFabricanteRole(req.jwtPayload?.role)) {
    throw new ForbiddenError('Apenas Fabricante (Super Admin / Admin global) pode emitir convites')
  }
}

// ── POST /leads/:id/invite — emite convite ──────────────────────────────────

const InviteSchema = z.object({
  targetKind:        z.enum(['INTEGRADOR', 'CLIENTE_FINAL']).optional(),
  suggestedPlan:     z.string().max(2000).optional().nullable(),
  hostIntegradorId:  z.string().uuid().optional().nullable(),
  ttlDays:           z.number().int().min(1).max(60).optional(),
  notes:             z.string().max(2000).optional().nullable(),
})

leadActionsRouter.post('/:id/invite', requireAuth, asyncHandler(async (req, res) => {
  requireFabricante(req)

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
  if (!lead) throw new NotFoundError('Lead')
  if (lead.status === 'CONVERTED') throw new ConflictError('Lead já convertido')

  const parse = InviteSchema.safeParse(req.body ?? {})
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

  const targetKind = parse.data.targetKind ?? lead.kind
  if (targetKind === 'CLIENTE_FINAL' && !parse.data.hostIntegradorId) {
    // Vamos hospedar no integrador "IACV Direct" (criado se não existir).
    // Em prod isso é um seed; aqui criamos no fly se ainda faltar.
  }

  const ttlDays = parse.data.ttlDays ?? INVITE_TTL_DAYS
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
  const { plaintext, hash } = generateToken()

  const invite = await prisma.demoInvite.create({
    data: {
      leadId:           lead.id,
      tokenHash:        hash,
      status:           'PENDING',
      expiresAt,
      suggestedPlan:    parse.data.suggestedPlan ?? null,
      targetKind,
      hostIntegradorId: parse.data.hostIntegradorId ?? null,
      createdByUserId:  req.jwtPayload!.sub,
      notes:            parse.data.notes ?? null,
    },
  })

  // Mark lead status DEMO_SENT (idempotente — já pode estar DEMO_SENT).
  if (lead.status === 'NEW' || lead.status === 'CONTACTED') {
    await prisma.lead.update({
      where: { id: lead.id },
      data:  { status: 'DEMO_SENT', demoSentAt: lead.demoSentAt ?? new Date() },
    })
  }

  const baseUrl = process.env.PUBLIC_APP_URL ?? 'http://localhost:5173'
  const magicLink = `${baseUrl}/demo/${plaintext}`

  logger.info({
    leadId:   lead.id,
    inviteId: invite.id,
    targetKind,
    actorId:  req.jwtPayload!.sub,
  }, 'demo_invite_created')

  // TODO: enviar email/WhatsApp aqui. Por ora retornamos o link no payload
  // pra o operador copiar/enviar manualmente.

  res.status(201).json({
    invite: {
      id:            invite.id,
      magicLink,                 // ⚠️ aparece UMA vez — frontend mostra modal copiar
      token:         plaintext,  // mesmo motivo
      expiresAt:     invite.expiresAt,
      targetKind:    invite.targetKind,
      suggestedPlan: invite.suggestedPlan,
    },
  })
}))

// ── POST /leads/:id/convert — converte direto, sem aceite do lead ────────────
//
// Caminho "alto-toque": o operador comercial já fechou via WhatsApp/call e
// quer criar o tenant agora, sem esperar lead clicar em invite. A senha vai
// vir por email pra primeira pessoa (mustChangePassword=true).

const ConvertSchema = z.object({
  targetKind:    z.enum(['INTEGRADOR', 'CLIENTE_FINAL']),
  // Para INTEGRADOR
  cnpj:          z.string().optional().nullable(),
  vertical:      z.string().optional(),  // só CLIENTE_FINAL
  hostIntegradorId: z.string().uuid().optional().nullable(),
  commercialPlan:   z.string().max(2000).optional().nullable(),
  // Senha temporária — opcional; se omitida, geramos.
  tempPassword:  z.string().min(8).optional(),
})

leadActionsRouter.post('/:id/convert', requireAuth, asyncHandler(async (req, res) => {
  requireFabricante(req)

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
  if (!lead) throw new NotFoundError('Lead')
  if (lead.status === 'CONVERTED') throw new ConflictError('Lead já convertido')

  const parse = ConvertSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

  const tempPassword = parse.data.tempPassword ?? generateRandomPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  let createdIntegradorId:    string | null = null
  let createdClienteFinalId:  string | null = null
  let createdUserId:          string | null = null

  if (parse.data.targetKind === 'INTEGRADOR') {
    if (!lead.companyName) throw new ValidationError('Lead não tem razão social — preencha antes de converter')

    const integ = await prisma.integrador.create({
      data: {
        name:         lead.companyName,
        tradeName:    lead.companyTradeName ?? null,
        cnpj:         (parse.data.cnpj ?? lead.cnpj) ?? null,
        email:        lead.contactEmail,
        passwordHash,                       // legacy field; user real abaixo
        phone:        lead.contactPhone ?? null,
      },
    })
    // Quota do mês atual (segue padrão de integradores.ts)
    const now = new Date()
    await prisma.apiQuota.create({
      data: {
        integradorId: integ.id,
        staticVisionMonthlyLimit: 50000,
        streamingMinutesLimit:    6000,
        periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
        periodEnd:   new Date(now.getFullYear(), now.getMonth() + 1, 0),
      },
    })
    // User admin
    const user = await prisma.user.create({
      data: {
        email:        lead.contactEmail,
        passwordHash,
        name:         lead.contactName,
        role:         'INTEGRADOR_ADMIN',
        integradorId: integ.id,
        mustChangePassword: true,
      },
    })
    createdIntegradorId = integ.id
    createdUserId       = user.id

  } else {
    // CLIENTE_FINAL — precisa de integrador host. Auto-resolve "IACV Direct".
    let hostIntegradorId = parse.data.hostIntegradorId
    if (!hostIntegradorId) {
      const direct = await prisma.integrador.findFirst({ where: { email: 'direct@iacloud.com.br' } })
      if (direct) {
        hostIntegradorId = direct.id
      } else {
        const direct2 = await prisma.integrador.create({
          data: {
            name:         'IACV Direct',
            tradeName:    'IA Cloud Vision Direct',
            email:        'direct@iacloud.com.br',
            passwordHash: await bcrypt.hash(generateRandomPassword(), 12),
          },
        })
        hostIntegradorId = direct2.id
        const now = new Date()
        await prisma.apiQuota.create({
          data: {
            integradorId: hostIntegradorId,
            staticVisionMonthlyLimit: 100000,
            streamingMinutesLimit:    12000,
            periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
            periodEnd:   new Date(now.getFullYear(), now.getMonth() + 1, 0),
          },
        })
      }
    }

    const cf = await prisma.clienteFinal.create({
      data: {
        integradorId:   hostIntegradorId,
        name:           lead.companyName ?? lead.contactName,
        tradeName:      lead.companyTradeName ?? null,
        cnpj:           lead.cnpj ?? null,
        email:          lead.contactEmail,
        phone:          lead.contactPhone ?? null,
        city:           lead.city ?? null,
        state:          lead.state ?? null,
        vertical:       (parse.data.vertical as any) ?? 'OTHER',
        commercialPlan: parse.data.commercialPlan ?? null,
      },
    })
    const user = await prisma.user.create({
      data: {
        email:          lead.contactEmail,
        passwordHash,
        name:           lead.contactName,
        role:           'CLIENTE_ADMIN',
        clienteFinalId: cf.id,
        mustChangePassword: true,
      },
    })
    createdClienteFinalId = cf.id
    createdUserId         = user.id
  }

  // Marca lead convertido
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status:                  'CONVERTED',
      convertedAt:             new Date(),
      convertedIntegradorId:   createdIntegradorId,
      convertedClienteFinalId: createdClienteFinalId,
    },
  })

  // Audit
  await prisma.auditLog.create({
    data: {
      superAdminId: req.jwtPayload!.sub,
      action:       'LEAD_CONVERTED',
      resource:     parse.data.targetKind === 'INTEGRADOR' ? 'Integrador' : 'ClienteFinal',
      resourceId:   createdIntegradorId ?? createdClienteFinalId ?? lead.id,
      metadataJson: {
        leadId:     lead.id,
        targetKind: parse.data.targetKind,
        userId:     createdUserId,
      },
    },
  })

  logger.info({
    leadId:    lead.id,
    targetKind: parse.data.targetKind,
    integradorId:   createdIntegradorId,
    clienteFinalId: createdClienteFinalId,
    userId:         createdUserId,
    actorId:        req.jwtPayload!.sub,
  }, 'lead_converted')

  res.status(201).json({
    leadId:                  lead.id,
    integradorId:            createdIntegradorId,
    clienteFinalId:          createdClienteFinalId,
    user: {
      id:            createdUserId,
      email:         lead.contactEmail,
      tempPassword,                  // ⚠️ aparece UMA vez
      mustChangePassword: true,
    },
  })
}))

// ── GET /demo-invites — lista para Fabricante ────────────────────────────────

demoInvitesRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  requireFabricante(req)

  const items = await prisma.demoInvite.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      lead: {
        select: { id: true, contactName: true, contactEmail: true, companyName: true, kind: true, status: true },
      },
    },
  })
  res.json({ items, total: items.length })
}))

demoInvitesRouter.post('/:id/revoke', requireAuth, asyncHandler(async (req, res) => {
  requireFabricante(req)
  const inv = await prisma.demoInvite.findUnique({ where: { id: req.params.id } })
  if (!inv) throw new NotFoundError('DemoInvite')
  if (inv.status === 'ACCEPTED') throw new ConflictError('Convite já foi aceito')

  const updated = await prisma.demoInvite.update({
    where: { id: inv.id },
    data:  { status: 'REVOKED' },
  })
  logger.info({ inviteId: inv.id, actorId: req.jwtPayload!.sub }, 'demo_invite_revoked')
  res.json({ id: updated.id, status: updated.status })
}))

// ── GET /demo/:token — público (consultar convite) ──────────────────────────

demoPublicRouter.get('/:token', asyncHandler(async (req, res) => {
  const tokenHash = hashToken(req.params.token)
  const invite = await prisma.demoInvite.findUnique({
    where: { tokenHash },
    include: {
      lead: {
        select: { contactName: true, contactEmail: true, companyName: true, kind: true },
      },
    },
  })
  if (!invite) throw new NotFoundError('Convite')
  if (invite.status === 'REVOKED')           throw new ForbiddenError('Convite revogado')
  if (invite.status === 'ACCEPTED')          throw new ConflictError('Convite já foi aceito — faça login')
  if (invite.expiresAt.getTime() < Date.now()) {
    // Marca expirado de forma idempotente
    if (invite.status !== 'EXPIRED') {
      await prisma.demoInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } })
    }
    throw new ForbiddenError('Convite expirado')
  }

  res.json({
    invite: {
      id:            invite.id,
      targetKind:    invite.targetKind,
      suggestedPlan: invite.suggestedPlan,
      expiresAt:     invite.expiresAt,
    },
    lead: invite.lead,
  })
}))

// ── POST /demo/:token/accept — aceita + cria tenant + user ──────────────────

const AcceptSchema = z.object({
  password: z.string().min(8).max(120),
  name:     z.string().min(2).max(120).optional(),  // override se quiser
})

demoPublicRouter.post('/:token/accept', asyncHandler(async (req, res) => {
  const tokenHash = hashToken(req.params.token)
  const invite = await prisma.demoInvite.findUnique({
    where: { tokenHash },
    include: { lead: true },
  })
  if (!invite) throw new NotFoundError('Convite')
  if (invite.status === 'REVOKED')   throw new ForbiddenError('Convite revogado')
  if (invite.status === 'ACCEPTED')  throw new ConflictError('Convite já foi aceito')
  if (invite.expiresAt.getTime() < Date.now()) {
    await prisma.demoInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } })
    throw new ForbiddenError('Convite expirado')
  }

  const parse = AcceptSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

  const passwordHash = await bcrypt.hash(parse.data.password, 12)
  const lead = invite.lead
  const finalName = parse.data.name ?? lead.contactName

  // Idempotência: se já existe user com esse email, retornamos erro claro
  const existingUser = await prisma.user.findUnique({ where: { email: lead.contactEmail } })
  if (existingUser) throw new ConflictError('Já existe usuário com este e-mail — faça login')

  // Cria tenant + user (mesma lógica de /leads/:id/convert mas com a senha
  // que o usuário escolheu — sem mustChangePassword).
  let createdIntegradorId:   string | null = null
  let createdClienteFinalId: string | null = null
  let userId: string

  if (invite.targetKind === 'INTEGRADOR') {
    if (!lead.companyName) throw new ValidationError('Lead sem razão social — contacte o administrador')
    const integ = await prisma.integrador.create({
      data: {
        name:         lead.companyName,
        tradeName:    lead.companyTradeName ?? null,
        cnpj:         lead.cnpj ?? null,
        email:        lead.contactEmail,
        passwordHash,
        phone:        lead.contactPhone ?? null,
      },
    })
    const now = new Date()
    await prisma.apiQuota.create({
      data: {
        integradorId: integ.id,
        staticVisionMonthlyLimit: 50000,
        streamingMinutesLimit:    6000,
        periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
        periodEnd:   new Date(now.getFullYear(), now.getMonth() + 1, 0),
      },
    })
    const user = await prisma.user.create({
      data: {
        email:        lead.contactEmail,
        passwordHash,
        name:         finalName,
        role:         'INTEGRADOR_ADMIN',
        integradorId: integ.id,
        mustChangePassword: false,
      },
    })
    createdIntegradorId = integ.id
    userId = user.id
  } else {
    // CLIENTE_FINAL no integrador host (default IACV Direct)
    let hostIntegradorId = invite.hostIntegradorId
    if (!hostIntegradorId) {
      const direct = await prisma.integrador.upsert({
        where:  { email: 'direct@iacloud.com.br' },
        update: {},
        create: {
          name:         'IACV Direct',
          tradeName:    'IA Cloud Vision Direct',
          email:        'direct@iacloud.com.br',
          passwordHash: await bcrypt.hash(generateRandomPassword(), 12),
        },
      })
      hostIntegradorId = direct.id
    }
    const cf = await prisma.clienteFinal.create({
      data: {
        integradorId:   hostIntegradorId,
        name:           lead.companyName ?? lead.contactName,
        tradeName:      lead.companyTradeName ?? null,
        cnpj:           lead.cnpj ?? null,
        email:          lead.contactEmail,
        phone:          lead.contactPhone ?? null,
        city:           lead.city ?? null,
        state:          lead.state ?? null,
        vertical:       'OTHER' as any,
        commercialPlan: invite.suggestedPlan ?? null,
      },
    })
    const user = await prisma.user.create({
      data: {
        email:          lead.contactEmail,
        passwordHash,
        name:           finalName,
        role:           'CLIENTE_ADMIN',
        clienteFinalId: cf.id,
        mustChangePassword: false,
      },
    })
    createdClienteFinalId = cf.id
    userId = user.id
  }

  // Atualiza invite + lead em paralelo
  await Promise.all([
    prisma.demoInvite.update({
      where: { id: invite.id },
      data:  { status: 'ACCEPTED', consumedAt: new Date() },
    }),
    prisma.lead.update({
      where: { id: lead.id },
      data: {
        status:                  'CONVERTED',
        convertedAt:             new Date(),
        convertedIntegradorId:   createdIntegradorId,
        convertedClienteFinalId: createdClienteFinalId,
      },
    }),
  ])

  logger.info({
    inviteId: invite.id,
    leadId:   lead.id,
    userId,
    targetKind: invite.targetKind,
  }, 'demo_invite_accepted')

  res.json({
    ok:    true,
    redirectTo: '/login',
    email: lead.contactEmail,
  })
}))

// ── helper: senha temp legível ───────────────────────────────────────────────
function generateRandomPassword(length = 14): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz'
  let out = ''
  const bytes = crypto.randomBytes(length)
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}
