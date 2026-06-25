/**
 * Custom Domains — Lote 4
 *
 * White-label: Integradores e ClientesFinais podem apontar domínios próprios
 * (ex.: "monitor.acmecorp.com.br") via CNAME para `app.vsaas.com.br`.
 *
 * Fluxo de verificação:
 *   1. POST /custom-domains       → cria registro, gera verifyToken
 *   2. Cliente cria TXT record:   _icv-verify.<hostname>  TXT  <verifyToken>
 *   3. POST /custom-domains/:id/verify → backend dns.resolveTxt() valida
 *   4. Status ACTIVE              → Worker passa a resolver o host
 *
 * Endpoints:
 *   GET    /custom-domains              (admin)   → lista do tenant
 *   POST   /custom-domains              (admin)   → criar
 *   DELETE /custom-domains/:id          (admin)   → remover
 *   POST   /custom-domains/:id/verify   (admin)   → disparar verificação DNS
 */
import { Router } from 'express'
import { z } from 'zod'
import { promises as dns } from 'dns'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../lib/errors'
import { logger } from '../lib/logger'
import { kvProvisionTenant, kvDeprovisionTenant } from '../services/cloudflare.service'
import { requires } from '../middleware/require-capability'
import { CAPABILITIES } from '../lib/capabilities'

export const customDomainsRouter = Router()
customDomainsRouter.use(requireAuth)

// ── helpers ─────────────────────────────────────────────────────────────────

function assertCanManage(req: any) {
  const { role } = req.jwtPayload ?? {}
  if (!['SUPER_ADMIN', 'ADMIN_GLOBAL', 'INTEGRADOR_ADMIN', 'CLIENTE_ADMIN'].includes(role)) {
    throw new ForbiddenError('Sem permissão para gerenciar domínios')
  }
}

function ownerWhere(jwt: any) {
  if (jwt.role === 'SUPER_ADMIN' || jwt.role === 'ADMIN_GLOBAL') return {}
  if (jwt.integradorId && !jwt.clienteFinalId) return { integradorId: jwt.integradorId }
  if (jwt.clienteFinalId) return { clienteFinalId: jwt.clienteFinalId }
  return { id: '__no_access__' }
}

// ── GET /custom-domains ───────────────────────────────────────────────────────

customDomainsRouter.get('/',
  requires(CAPABILITIES.WHITELABEL_CUSTOM_DOMAIN),
  asyncHandler(async (req, res) => {
  assertCanManage(req)
  const where = ownerWhere(req.jwtPayload!)
  const domains = await prisma.customDomain.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json({ domains, total: domains.length })
}))

// ── POST /custom-domains ──────────────────────────────────────────────────────

const CreateSchema = z.object({
  hostname: z.string().min(3).max(253).regex(
    /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/,
    'Hostname inválido',
  ),
  // Opcionais — override de owner (só SUPER_ADMIN)
  integradorId:   z.string().uuid().optional().nullable(),
  clienteFinalId: z.string().uuid().optional().nullable(),
})

customDomainsRouter.post('/',
  requires(CAPABILITIES.WHITELABEL_CUSTOM_DOMAIN),
  asyncHandler(async (req, res) => {
  assertCanManage(req)

  const parse = CreateSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

  const { hostname } = parse.data

  // Resolve o owner
  let integradorId:   string | null = null
  let clienteFinalId: string | null = null

  const { role, integradorId: jwtInteg, clienteFinalId: jwtCf } = req.jwtPayload!

  if (role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL') {
    integradorId   = parse.data.integradorId   ?? null
    clienteFinalId = parse.data.clienteFinalId ?? null
    if (!integradorId && !clienteFinalId) {
      throw new ValidationError('Informe integradorId ou clienteFinalId')
    }
  } else if (jwtCf) {
    clienteFinalId = jwtCf
  } else if (jwtInteg) {
    integradorId = jwtInteg
  }

  // Unicidade
  const existing = await prisma.customDomain.findUnique({ where: { hostname } })
  if (existing) throw new ConflictError(`Hostname '${hostname}' já cadastrado`)

  const verifyToken = crypto.randomBytes(24).toString('base64url')

  const domain = await prisma.customDomain.create({
    data: {
      hostname,
      integradorId,
      clienteFinalId,
      verifyToken,
      status: 'PENDING_DNS',
    },
  })

  logger.info({ hostname, integradorId, clienteFinalId, actorId: req.jwtPayload!.sub }, 'custom_domain_created')

  res.status(201).json({
    domain,
    instructions: {
      cname: { name: hostname,                         value: 'app.vsaas.com.br' },
      txt:   { name: `_icv-verify.${hostname}`,        value: verifyToken },
    },
  })
}))

// ── POST /custom-domains/:id/verify ──────────────────────────────────────────

customDomainsRouter.post('/:id/verify',
  requires(CAPABILITIES.WHITELABEL_CUSTOM_DOMAIN),
  asyncHandler(async (req, res) => {
  assertCanManage(req)

  // B-4 (2026-06-15): tenant scope no WHERE, não em check posterior.
  // Antes: findUnique + check `!==` vazava existência via timing (404 vs 403).
  const { role, integradorId, clienteFinalId } = req.jwtPayload!
  const tenantWhere: any = (role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL')
    ? {}
    : clienteFinalId ? { clienteFinalId }
    : integradorId   ? { integradorId }
    : { id: '__no_tenant__' }   // bloqueia se JWT sem tenant
  const domain = await prisma.customDomain.findFirst({
    where: { id: req.params.id, ...tenantWhere },
  })
  if (!domain) throw new NotFoundError('CustomDomain')

  if (domain.status === 'ACTIVE') {
    return res.json({ domain, already: true })
  }

  // Check TXT record
  let verified = false
  let errMsg: string | null = null
  const txtName = `_icv-verify.${domain.hostname}`

  try {
    const records = await dns.resolveTxt(txtName)
    verified = records.flat().some((r) => r === domain.verifyToken)
    if (!verified) errMsg = `TXT não encontrado em ${txtName}. Aguarde propagação DNS (pode levar até 24h).`
  } catch (e: any) {
    errMsg = `Falha ao resolver ${txtName}: ${e.code ?? e.message}`
  }

  const updated = await prisma.customDomain.update({
    where: { id: domain.id },
    data: {
      status:        verified ? 'ACTIVE' : 'PENDING_VERIFICATION',
      verifiedAt:    verified ? new Date() : null,
      lastCheckedAt: new Date(),
      lastError:     verified ? null : errMsg,
    },
  })

  // Provisiona no KV do Worker quando verificado com sucesso
  if (verified && domain.integradorId) {
    kvProvisionTenant(domain.hostname, domain.integradorId).catch(err =>
      logger.warn({ err, hostname: domain.hostname }, 'cf_kv_provision_failed'),
    )
  }

  logger.info({ domainId: domain.id, hostname: domain.hostname, verified }, 'custom_domain_verify')

  res.json({
    domain: updated,
    verified,
    message: verified
      ? 'Domínio verificado e ativo! Roteamento ativado em até 30s.'
      : errMsg,
  })
}))

// ── DELETE /custom-domains/:id ────────────────────────────────────────────────

customDomainsRouter.delete('/:id',
  requires(CAPABILITIES.WHITELABEL_CUSTOM_DOMAIN),
  asyncHandler(async (req, res) => {
  assertCanManage(req)

  // B-4 (2026-06-15): tenant scope no WHERE
  const { role, integradorId, clienteFinalId } = req.jwtPayload!
  const tenantWhere: any = (role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL')
    ? {}
    : clienteFinalId ? { clienteFinalId }
    : integradorId   ? { integradorId }
    : { id: '__no_tenant__' }
  const domain = await prisma.customDomain.findFirst({
    where: { id: req.params.id, ...tenantWhere },
  })
  if (!domain) throw new NotFoundError('CustomDomain')

  // Remove do KV do Worker antes de deletar do DB
  if (domain.status === 'ACTIVE') {
    kvDeprovisionTenant(domain.hostname).catch(err =>
      logger.warn({ err, hostname: domain.hostname }, 'cf_kv_deprovision_failed'),
    )
  }

  await prisma.customDomain.delete({ where: { id: domain.id } })
  logger.info({ domainId: domain.id, actorId: req.jwtPayload!.sub }, 'custom_domain_deleted')
  res.json({ ok: true, id: domain.id })
}))
