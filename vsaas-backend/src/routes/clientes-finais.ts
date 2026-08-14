/**
 * Clientes Finais Routes — Sprint Gap 5.
 *
 * Cadastro de clientes finais (B2B2B) por integradores. Inclui campo textual
 * `commercialPlan` para o integrador descrever o plano comercial acordado
 * (texto livre, sem amarração com pricing técnico).
 *
 * Escopo:
 *   - SUPER_ADMIN     → vê todos / cria em qualquer integrador (precisa integradorId).
 *   - INTEGRADOR_ADMIN → vê e cria apenas no próprio integrador.
 *   - INTEGRADOR_TECNICO → vê os do próprio integrador (sem criar/editar).
 *   - CLIENTE_*       → vê apenas o próprio (somente leitura).
 *
 * Endpoints:
 *   GET    /clientes-finais          → lista escopada
 *   POST   /clientes-finais          → cria (SUPER_ADMIN | INTEGRADOR_ADMIN)
 *   GET    /clientes-finais/:id      → detalhe escopado
 *   PATCH  /clientes-finais/:id      → atualiza (inclui commercialPlan)
 *   DELETE /clientes-finais/:id      → soft delete (active=false)
 */
import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { r2Service } from '../services/r2.service'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { ValidationError, UnauthorizedError, NotFoundError, ForbiddenError } from '../lib/errors'

// Upload de logo white-label do cliente final — mesmo padrão de integradores.
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(svg\+xml|png|jpeg|webp)$/i.test(file.mimetype)
    cb(ok ? null : new Error('Formato não aceito (use SVG, PNG, JPEG ou WebP)') as any, ok)
  },
})
import { publicRoute } from '../middleware/require-capability'
import {
  generatePortalTokenPlaintext,
  hashPortalToken,
  computeExpiresAt,
  buildPortalMagicLink,
  PORTAL_TOKEN_DEFAULT_TTL_HOURS,
  PORTAL_TOKEN_MAX_TTL_HOURS,
} from '../lib/portal-token'

export const clientesFinaisRouter = Router()
clientesFinaisRouter.use(requireAuth)

const VERTICALS = [
  'RETAIL', 'SHOPPING', 'EDUCATION', 'INDUSTRY', 'LOGISTICS',
  'PARKING', 'CONDOMINIUM', 'PUBLIC_SAFETY', 'OTHER',
] as const

// Slug do portal: somente lowercase, dígitos e hífen; 3–40 chars; sem hífens
// nas pontas. Subdomain-safe e fácil de digitar.
const PORTAL_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/
const HEX_COLOR_REGEX   = /^#[0-9a-fA-F]{6}$/

const CreateSchema = z.object({
  name:           z.string().min(2).max(160),
  tradeName:      z.string().max(160).optional(),
  cnpj:           z.string().max(20).optional(),
  email:          z.string().email(),
  phone:          z.string().max(40).optional(),
  address:        z.string().max(240).optional(),
  city:           z.string().max(120).optional(),
  state:          z.string().max(40).optional(),
  country:        z.string().max(4).default('BR'),
  vertical:       z.enum(VERTICALS),
  logoUrl:        z.string().url().max(500).optional(),
  notifyEmail:    z.string().email().optional(),
  commercialPlan: z.string().max(4000).optional(),
  // Cota de storage em bytes (null/omit = sem cota explícita). Aceita string
  // pra evitar overflow JS num (BigInt) — Zod converte e Prisma persiste.
  // Ex.: 100 GiB = 107374182400. Mínimo 1 GB pra evitar inputs nonsense.
  storageQuotaBytes: z.union([
    z.coerce.bigint().min(1_000_000_000n).nullable(),
    z.null(),
  ]).optional(),
  // Portal white-label (CF.4)
  portalSlug:     z.string().regex(PORTAL_SLUG_REGEX, 'slug deve ser lowercase, dígitos e hífen (3–40)').optional(),
  primaryColor:   z.string().regex(HEX_COLOR_REGEX, 'cor deve ser hex #RRGGBB').optional(),
  secondaryColor: z.string().regex(HEX_COLOR_REGEX, 'cor deve ser hex #RRGGBB').optional(),
  // SUPER_ADMIN exige; INTEGRADOR_ADMIN ignora (vem do JWT).
  integradorId:   z.string().uuid().optional(),
})

const UpdateSchema = CreateSchema.partial().omit({ integradorId: true })

// =============================================================================
// GET /clientes-finais
// =============================================================================
clientesFinaisRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!

  let where: any = {}
  if (jwt.role === 'SUPER_ADMIN') {
    where = {}
  } else if (jwt.clienteFinalId) {
    where = { id: jwt.clienteFinalId }
  } else if (jwt.integradorId) {
    where = { integradorId: jwt.integradorId }
  } else {
    throw new UnauthorizedError('JWT sem tenant')
  }

  const clientes = await prisma.clienteFinal.findMany({
    where,
    select: {
      id: true, name: true, tradeName: true, cnpj: true, email: true,
      phone: true, city: true, state: true, vertical: true, active: true,
      commercialPlan: true, createdAt: true, updatedAt: true,
      integrador: { select: { id: true, name: true } },
      _count: { select: { sites: true, users: true } },
    },
    orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  })
  res.json({ clientes, total: clientes.length })
}))

// =============================================================================
// POST /clientes-finais
// =============================================================================
clientesFinaisRouter.post('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    throw new ForbiddenError('Apenas SUPER_ADMIN ou INTEGRADOR_ADMIN podem criar clientes finais')
  }

  const parse = CreateSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const b = parse.data

  // Decide integradorId conforme role
  let integradorId: string
  if (jwt.role === 'SUPER_ADMIN') {
    if (!b.integradorId) throw new ValidationError('integradorId obrigatório para SUPER_ADMIN')
    const integ = await prisma.integrador.findUnique({ where: { id: b.integradorId }, select: { id: true } })
    if (!integ) throw new NotFoundError('Integrador')
    integradorId = integ.id
  } else {
    if (!jwt.integradorId) throw new UnauthorizedError('JWT sem integradorId')
    integradorId = jwt.integradorId
  }

  const cliente = await prisma.clienteFinal.create({
    data: {
      integradorId,
      name:           b.name,
      tradeName:      b.tradeName ?? null,
      cnpj:           b.cnpj ?? null,
      email:          b.email,
      phone:          b.phone ?? null,
      address:        b.address ?? null,
      city:           b.city ?? null,
      state:          b.state ?? null,
      country:        b.country ?? 'BR',
      vertical:       b.vertical as any,
      logoUrl:        b.logoUrl ?? null,
      notifyEmail:    b.notifyEmail ?? null,
      commercialPlan: b.commercialPlan ?? null,
      portalSlug:     b.portalSlug ?? null,
      primaryColor:   b.primaryColor ?? null,
      secondaryColor: b.secondaryColor ?? null,
      active:         true,
    },
  })

  // Auditoria (não bloqueia se falhar)
  try {
    await prisma.auditLog.create({
      data: {
        action:       'CLIENTE_FINAL_CREATED',
        resource:     'ClienteFinal',
        resourceId:   cliente.id,
        integradorId,
        ...(jwt.role === 'SUPER_ADMIN' ? { superAdminId: jwt.sub } : { userId: jwt.sub }),
      },
    })
  } catch (err: any) {
    logger.warn({ err: err.message }, 'cliente_final_audit_log_failed')
  }

  logger.info({ clienteFinalId: cliente.id, integradorId, by: jwt.sub }, 'cliente_final_created')
  res.status(201).json({ cliente })
}))

// =============================================================================
// GET /clientes-finais/:id
// =============================================================================
clientesFinaisRouter.get('/:id',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const where: any = { id: req.params.id }
  if (jwt.role !== 'SUPER_ADMIN') {
    if (jwt.clienteFinalId) where.id = jwt.clienteFinalId  // CLIENTE_* só vê o próprio
    else if (jwt.integradorId) where.integradorId = jwt.integradorId
    else throw new UnauthorizedError('JWT sem tenant')
  }

  const cliente = await prisma.clienteFinal.findFirst({
    where,
    include: {
      integrador: { select: { id: true, name: true } },
      _count: { select: { sites: true, users: true } },
    },
  })
  if (!cliente) throw new NotFoundError('ClienteFinal')
  res.json({ cliente })
}))

// =============================================================================
// PATCH /clientes-finais/:id
// =============================================================================
clientesFinaisRouter.patch('/:id',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    throw new ForbiddenError('Apenas admins podem editar clientes finais')
  }

  const parse = UpdateSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const b = parse.data

  // Confirma escopo antes de atualizar
  const existing = await prisma.clienteFinal.findFirst({
    where: jwt.role === 'SUPER_ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, integradorId: jwt.integradorId! },
    select: { id: true, integradorId: true },
  })
  if (!existing) throw new NotFoundError('ClienteFinal')

  const cliente = await prisma.clienteFinal.update({
    where: { id: existing.id },
    data: {
      ...(b.name           !== undefined && { name: b.name }),
      ...(b.tradeName      !== undefined && { tradeName: b.tradeName }),
      ...(b.cnpj           !== undefined && { cnpj: b.cnpj }),
      ...(b.email          !== undefined && { email: b.email }),
      ...(b.phone          !== undefined && { phone: b.phone }),
      ...(b.address        !== undefined && { address: b.address }),
      ...(b.city           !== undefined && { city: b.city }),
      ...(b.state          !== undefined && { state: b.state }),
      ...(b.country        !== undefined && { country: b.country }),
      ...(b.vertical       !== undefined && { vertical: b.vertical as any }),
      ...(b.logoUrl        !== undefined && { logoUrl: b.logoUrl }),
      ...(b.notifyEmail    !== undefined && { notifyEmail: b.notifyEmail }),
      ...(b.commercialPlan !== undefined && { commercialPlan: b.commercialPlan }),
      ...(b.storageQuotaBytes !== undefined && { storageQuotaBytes: b.storageQuotaBytes }),
      ...(b.portalSlug     !== undefined && { portalSlug:     b.portalSlug }),
      ...(b.primaryColor   !== undefined && { primaryColor:   b.primaryColor }),
      ...(b.secondaryColor !== undefined && { secondaryColor: b.secondaryColor }),
    },
  })

  try {
    await prisma.auditLog.create({
      data: {
        action:       'CLIENTE_FINAL_UPDATED',
        resource:     'ClienteFinal',
        resourceId:   cliente.id,
        integradorId: existing.integradorId,
        ...(jwt.role === 'SUPER_ADMIN' ? { superAdminId: jwt.sub } : { userId: jwt.sub }),
      },
    })
  } catch (err: any) {
    logger.warn({ err: err.message }, 'cliente_final_audit_log_failed')
  }

  res.json({ cliente })
}))

// =============================================================================
// =============================================================================
// POST /clientes-finais/:id/logo  (multipart, campo "file") — white-label
// SUPER_ADMIN ou INTEGRADOR_ADMIN do integrador-pai. Persiste em R2 e
// grava ClienteFinal.logoUrl.
// =============================================================================
clientesFinaisRouter.post('/:id/logo',
  publicRoute(),
  logoUpload.single('file'), asyncHandler(async (req, res) => {
  const id = String(req.params.id)
  const jwt = req.jwtPayload!

  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    throw new ForbiddenError('Apenas SUPER_ADMIN ou INTEGRADOR_ADMIN podem trocar logo')
  }
  if (!req.file) throw new ValidationError('Arquivo "file" obrigatório (multipart)')

  const cliente = await prisma.clienteFinal.findUnique({
    where:  { id },
    select: { id: true, integradorId: true, logoUrl: true },
  })
  if (!cliente) throw new NotFoundError('Cliente final')

  // INTEGRADOR_ADMIN só pode mexer em CFs do próprio integrador
  if (jwt.role === 'INTEGRADOR_ADMIN' && cliente.integradorId !== jwt.integradorId) {
    throw new ForbiddenError('Cliente final pertence a outro integrador')
  }

  const result = await r2Service.uploadLogoBuffer(
    req.file.buffer,
    req.file.mimetype,
    cliente.integradorId,
    'cliente',
    id,
  )
  if (!result) {
    res.status(503).json({ error: 'STORAGE_UNAVAILABLE', message: 'R2 não configurado' })
    return
  }

  await prisma.clienteFinal.update({
    where: { id },
    data:  { logoUrl: result.url },
  })

  res.json({ ok: true, logoUrl: result.url, bucket: result.bucket, key: result.key })
}))

// DELETE /clientes-finais/:id/logo
clientesFinaisRouter.delete('/:id/logo',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const id = String(req.params.id)
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    throw new ForbiddenError('Apenas admins podem remover logo')
  }
  await prisma.clienteFinal.update({ where: { id }, data: { logoUrl: null } })
  res.json({ ok: true })
}))

// =============================================================================
// DELETE /clientes-finais/:id  (soft delete)
// =============================================================================
clientesFinaisRouter.delete('/:id',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    throw new ForbiddenError('Apenas admins podem inativar clientes finais')
  }

  const existing = await prisma.clienteFinal.findFirst({
    where: jwt.role === 'SUPER_ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, integradorId: jwt.integradorId! },
    select: { id: true, integradorId: true },
  })
  if (!existing) throw new NotFoundError('ClienteFinal')

  await prisma.clienteFinal.update({
    where: { id: existing.id },
    data: { active: false },
  })

  try {
    await prisma.auditLog.create({
      data: {
        action:       'CLIENTE_FINAL_DEACTIVATED',
        resource:     'ClienteFinal',
        resourceId:   existing.id,
        integradorId: existing.integradorId,
        ...(jwt.role === 'SUPER_ADMIN' ? { superAdminId: jwt.sub } : { userId: jwt.sub }),
      },
    })
  } catch (err: any) {
    logger.warn({ err: err.message }, 'cliente_final_audit_log_failed')
  }

  res.status(204).end()
}))

// =============================================================================
// PORTAL TOKENS (Sprint CF.4) — Magic-link de acesso B2B2B
// =============================================================================

const TokenMintSchema = z.object({
  ttlHours:  z.number().int().min(1).max(PORTAL_TOKEN_MAX_TTL_HOURS).optional(),
  singleUse: z.boolean().optional(),
  label:     z.string().max(120).optional(),
})

/**
 * Reusa a regra de escopo: SUPER_ADMIN livre, INTEGRADOR_ADMIN no próprio
 * integrador. Outros papéis não podem mintar tokens para clientes (CLIENTE_*
 * já É o cliente — não faz sentido o cliente emitir token pra si mesmo).
 */
async function loadClienteForAdmin(req: any, id: string) {
  const jwt = req.jwtPayload
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    throw new ForbiddenError('Apenas SUPER_ADMIN ou INTEGRADOR_ADMIN podem gerenciar tokens de portal')
  }
  const where = jwt.role === 'SUPER_ADMIN'
    ? { id }
    : { id, integradorId: jwt.integradorId! }

  const cliente = await prisma.clienteFinal.findFirst({
    where,
    select: { id: true, integradorId: true, name: true, active: true },
  })
  if (!cliente) throw new NotFoundError('ClienteFinal')
  if (!cliente.active) throw new ForbiddenError('ClienteFinal está inativo — não é possível emitir token')
  return cliente
}

// ── POST /clientes-finais/:id/portal-token ──────────────────────────────────
// Mint um magic-link. Plaintext aparece UMA VEZ no response.
clientesFinaisRouter.post('/:id/portal-token',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const cliente = await loadClienteForAdmin(req, req.params.id)
  const jwt     = req.jwtPayload!

  const parse = TokenMintSchema.safeParse(req.body ?? {})
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const { ttlHours, singleUse, label } = parse.data

  const plaintext = generatePortalTokenPlaintext()
  const tokenHash = hashPortalToken(plaintext)
  const expiresAt = computeExpiresAt(ttlHours ?? PORTAL_TOKEN_DEFAULT_TTL_HOURS)

  const token = await prisma.portalAccessToken.create({
    data: {
      clienteFinalId: cliente.id,
      tokenHash,
      expiresAt,
      singleUse: singleUse ?? false,
      createdBy: jwt.sub,
      label:     label ?? null,
    },
    select: { id: true, expiresAt: true, singleUse: true, label: true, createdAt: true },
  })

  // Auditoria — SEM o plaintext nem o hash (defesa em profundidade).
  try {
    await prisma.auditLog.create({
      data: {
        action:       'PORTAL_TOKEN_MINTED',
        resource:     'PortalAccessToken',
        resourceId:   token.id,
        integradorId: cliente.integradorId,
        ...(jwt.role === 'SUPER_ADMIN' ? { superAdminId: jwt.sub } : { userId: jwt.sub }),
      },
    })
  } catch (err: any) {
    logger.warn({ err: err.message }, 'portal_token_audit_log_failed')
  }

  logger.info({
    clienteFinalId: cliente.id,
    tokenId:        token.id,
    by:             jwt.sub,
    ttlHours:       ttlHours ?? PORTAL_TOKEN_DEFAULT_TTL_HOURS,
  }, 'portal_token_minted')

  res.status(201).json({
    token: {
      id:        token.id,
      // ⚠️ plaintext só aparece aqui, no response do mint. Nunca recuperável.
      plaintext,
      magicLink: buildPortalMagicLink(plaintext),
      expiresAt: token.expiresAt,
      singleUse: token.singleUse,
      label:     token.label,
      createdAt: token.createdAt,
    },
  })
}))

// ── GET /clientes-finais/:id/portal-tokens ──────────────────────────────────
// Lista tokens emitidos (sem plaintext). Útil pra integrador auditar.
clientesFinaisRouter.get('/:id/portal-tokens',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const cliente = await loadClienteForAdmin(req, req.params.id)

  const tokens = await prisma.portalAccessToken.findMany({
    where: { clienteFinalId: cliente.id },
    select: {
      id: true, expiresAt: true, lastUsedAt: true, singleUse: true,
      revoked: true, label: true, createdBy: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  // Anota status calculado pra UI consumir direto.
  const now = Date.now()
  const enriched = tokens.map(t => ({
    ...t,
    status:
      t.revoked              ? 'revoked' :
      t.expiresAt.getTime() < now ? 'expired' :
      t.singleUse && t.lastUsedAt ? 'consumed' :
      t.lastUsedAt           ? 'active' :
                               'pending',
  }))

  res.json({ tokens: enriched, total: enriched.length })
}))

// ── DELETE /clientes-finais/:id/portal-tokens/:tokenId ──────────────────────
// Revoga (soft) — não deleta pra preservar audit trail.
clientesFinaisRouter.delete('/:id/portal-tokens/:tokenId',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const cliente = await loadClienteForAdmin(req, req.params.id)
  const jwt     = req.jwtPayload!

  // Confirma que o token pertence a este cliente final.
  const existing = await prisma.portalAccessToken.findFirst({
    where: { id: req.params.tokenId, clienteFinalId: cliente.id },
    select: { id: true, revoked: true },
  })
  if (!existing) throw new NotFoundError('PortalAccessToken')
  if (existing.revoked) {
    res.status(204).end()
    return
  }

  await prisma.portalAccessToken.update({
    where: { id: existing.id },
    data:  { revoked: true },
  })

  try {
    await prisma.auditLog.create({
      data: {
        action:       'PORTAL_TOKEN_REVOKED',
        resource:     'PortalAccessToken',
        resourceId:   existing.id,
        integradorId: cliente.integradorId,
        ...(jwt.role === 'SUPER_ADMIN' ? { superAdminId: jwt.sub } : { userId: jwt.sub }),
      },
    })
  } catch (err: any) {
    logger.warn({ err: err.message }, 'portal_token_audit_log_failed')
  }

  logger.info({ tokenId: existing.id, by: jwt.sub }, 'portal_token_revoked')
  res.status(204).end()
}))
