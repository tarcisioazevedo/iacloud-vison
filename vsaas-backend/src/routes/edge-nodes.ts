/**
 * Edge Nodes Routes — escopo multi-tenant (JWT do usuário).
 *
 * GET    /edge-nodes                  → lista (tenant-scoped)
 * GET    /edge-nodes/:id              → detalhe
 * POST   /edge-nodes/provision        → cria EdgeNode + gera licenseKey + opcional e-mail
 * GET    /edge-nodes/:id/license-key  → recupera chave (INTEGRADOR_ADMIN ou SUPER_ADMIN)
 * POST   /edge-nodes/:id/rotate-token → regera chave (invalida anterior)
 * DELETE /edge-nodes/:id              → desativa (DECOMMISSIONED)
 *
 * Regras de negócio:
 *   - SUPER_ADMIN: acesso irrestrito, pode operar em qualquer tenant.
 *   - INTEGRADOR_ADMIN: opera somente nos EdgeNodes dos seus ClienteFinais.
 *     Quota definida por Integrador.maxEdgeNodes (null = ilimitado).
 *   - CLIENTE_* e outros: somente leitura do próprio ClienteFinal.
 */
import { Router } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { sendMail, loadTemplate, renderTemplate } from '../lib/smtp'
import { NotFoundError, UnauthorizedError, ValidationError, ForbiddenError } from '../lib/errors'
import { logger } from '../lib/logger'
import type { JwtPayload } from '../middleware/auth'

export const edgeNodesRouter = Router()
edgeNodesRouter.use(requireAuth)

// ─── helpers ──────────────────────────────────────────────────────────────────

function edgeTenantWhere(jwt: JwtPayload | undefined): Prisma.EdgeNodeWhereInput {
  if (!jwt) throw new UnauthorizedError()
  if (jwt.role === 'SUPER_ADMIN') return {}
  if (jwt.clienteFinalId) return { site: { clienteFinalId: jwt.clienteFinalId } }
  if (jwt.integradorId)   return { site: { clienteFinal: { integradorId: jwt.integradorId } } }
  throw new UnauthorizedError('JWT sem tenant')
}

function canManageEdge(jwt: JwtPayload): boolean {
  return jwt.role === 'SUPER_ADMIN' || jwt.role === 'INTEGRADOR_ADMIN'
}

/** Gera chave legível: IACV-XXXX-XXXX-XXXX-XXXX */
function generateLicenseKey(): string {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase()
  return `IACV-${seg()}${seg()}-${seg()}${seg()}-${seg()}${seg()}-${seg()}${seg()}`
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

/**
 * Verifica quota de EdgeNodes para INTEGRADOR_ADMIN.
 * Conta ONLINE + PROVISIONING + DEGRADED (não OFFLINE nem DECOMMISSIONED).
 * Lança ForbiddenError se limite atingido.
 */
async function assertEdgeQuota(integradorId: string): Promise<void> {
  const integrador = await prisma.integrador.findUnique({
    where:  { id: integradorId },
    select: { maxEdgeNodes: true, name: true },
  })
  if (!integrador) throw new NotFoundError('Integrador')
  if (integrador.maxEdgeNodes == null) return // ilimitado

  const used = await prisma.edgeNode.count({
    where: {
      status: { in: ['ONLINE', 'PROVISIONING', 'DEGRADED'] },
      site:   { clienteFinal: { integradorId } },
    },
  })
  if (used >= integrador.maxEdgeNodes) {
    throw new ForbiddenError(
      `Limite de ${integrador.maxEdgeNodes} Edge Node(s) atingido para este integrador. ` +
      `Contate o suporte para ampliar a quota.`
    )
  }
}

// ─── GET /edge-nodes ──────────────────────────────────────────────────────────

edgeNodesRouter.get('/', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const tenantWhere = edgeTenantWhere(jwt)

  const siteId       = typeof req.query.siteId       === 'string' ? req.query.siteId       : undefined
  const integradorId = typeof req.query.integradorId === 'string' ? req.query.integradorId : undefined
  const includeOffline = req.query.includeOffline === 'true'

  const where: Prisma.EdgeNodeWhereInput = {
    ...tenantWhere,
    ...(siteId       ? { siteId }                                               : {}),
    ...(integradorId ? { site: { clienteFinal: { integradorId } } }             : {}),
    ...(includeOffline ? {} : { status: { in: ['ONLINE', 'DEGRADED', 'PROVISIONING'] } }),
  }

  const nodes = await prisma.edgeNode.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: {
      id: true, name: true, serialNumber: true, status: true,
      model: true, accelerator: true, ipLocal: true,
      lastHeartbeat: true, firmwareVersion: true, yoloModelVersion: true,
      go2rtcEndpoint: true, cpuUsage: true, memUsage: true, tempCelsius: true,
      licenseExpiresAt: true, maxCameras: true,
      technicianEmail: true,
      // Não expõe licenseKeyEnc nem apiToken na listagem
      site: {
        select: {
          id: true, name: true,
          clienteFinal: { select: { id: true, name: true } },
        },
      },
      _count: { select: { cameras: { where: { active: true } } } },
    },
    take: 500,
  })

  res.json({ edgeNodes: nodes, total: nodes.length })
}))

// ─── GET /edge-nodes/:id ──────────────────────────────────────────────────────

edgeNodesRouter.get('/:id', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const tenantWhere = edgeTenantWhere(jwt)

  const node = await prisma.edgeNode.findFirst({
    where: { id: String(req.params.id), ...tenantWhere },
    include: {
      site: {
        select: {
          id: true, name: true,
          clienteFinal: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!node) throw new NotFoundError('Edge node')

  const cameraCount = await prisma.camera.count({
    where: { edgeNodeId: node.id, siteId: node.siteId, active: true },
  })

  // Sanitizar: nunca vaza apiToken, go2rtcAuth nem licenseKeyEnc no GET geral
  const { apiToken: _t, go2rtcAuth: _a, licenseKeyEnc: _k, ...safe } = node as any
  res.json({ ...safe, _count: { cameras: cameraCount } })
}))

// ─── POST /edge-nodes/provision ───────────────────────────────────────────────

const ProvisionSchema = z.object({
  siteId:           z.string().uuid(),
  name:             z.string().min(1).max(120),
  serialNumber:     z.string().min(1).max(64),
  description:      z.string().max(255).optional(),
  model:            z.string().max(100).optional(),
  accelerator:      z.string().max(60).optional(),
  macAddress:       z.string().max(32).optional(),
  maxCameras:       z.number().int().positive().optional(),
  licenseExpiresAt: z.string().datetime().optional(),
  technicianEmail:  z.string().email().optional(),
  sendEmail:        z.boolean().default(false),
})

edgeNodesRouter.post('/provision', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (!canManageEdge(jwt)) throw new ForbiddenError('Apenas SUPER_ADMIN ou INTEGRADOR_ADMIN podem provisionar Edge Nodes')

  const parse = ProvisionSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const b = parse.data

  // Verificar que o Site pertence ao tenant do JWT
  const site = await prisma.site.findFirst({
    where: {
      id: b.siteId,
      ...(jwt.role === 'INTEGRADOR_ADMIN'
        ? { clienteFinal: { integradorId: jwt.integradorId! } }
        : {}),
    },
    include: { clienteFinal: { select: { id: true, name: true, integradorId: true } } },
  })
  if (!site) throw new NotFoundError('Site')

  const integradorId = site.clienteFinal.integradorId

  // Verificar quota antes de criar
  if (jwt.role === 'INTEGRADOR_ADMIN') {
    await assertEdgeQuota(jwt.integradorId!)
  }

  // Gerar licenseKey + hash + enc
  const licenseKey    = generateLicenseKey()
  const apiToken      = hashKey(licenseKey)
  const licenseKeyEnc = encryptSecret(licenseKey)

  // Sprint R7: INTEGRADOR_ADMIN provisiona em PENDING_APPROVAL.
  // SUPER_ADMIN provisiona direto em PROVISIONING (auto-aprovado).
  const requiresApproval = jwt.role === 'INTEGRADOR_ADMIN'
  const initialStatus: any = requiresApproval ? 'PENDING_APPROVAL' : 'PROVISIONING'

  const node = await prisma.edgeNode.create({
    data: {
      siteId:           b.siteId,
      name:             b.name,
      serialNumber:     b.serialNumber,
      description:      b.description ?? null,
      model:            b.model ?? null,
      accelerator:      b.accelerator ?? null,
      macAddress:       b.macAddress ?? null,
      maxCameras:       b.maxCameras ?? null,
      licenseExpiresAt: b.licenseExpiresAt ? new Date(b.licenseExpiresAt) : null,
      apiToken,
      licenseKeyEnc,
      technicianEmail:  b.technicianEmail ?? null,
      integradorId:     integradorId ?? null,
      status:           initialStatus,
    },
    select: {
      id: true, name: true, serialNumber: true, status: true,
      model: true, siteId: true, technicianEmail: true,
    },
  })

  // Sprint R7: cria ApprovalRequest se INTEGRADOR_ADMIN
  let approvalRequestId: string | null = null
  if (requiresApproval) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const ar = await prisma.approvalRequest.create({
      data: {
        action: 'PROVISION_EDGE_NODE' as any,
        payloadJson: {
          edgeNodeId: node.id,
          name: node.name,
          serialNumber: node.serialNumber,
          siteId: site.id,
          siteName: site.name,
          clienteFinalName: site.clienteFinal.name,
          integradorId,
          requestedBy: jwt.sub,
        } as any,
        reason: `Solicitação de licença Edge Node "${node.name}" (S/N ${node.serialNumber}) para cliente ${site.clienteFinal.name}`,
        requestedByUserId: jwt.sub,
        expiresAt,
      },
    })
    approvalRequestId = ar.id
    logger.info({ edgeNodeId: node.id, approvalRequestId, integradorId }, 'edge_node_provision_pending_approval')
  } else {
    logger.info({ edgeNodeId: node.id, integradorId, keyPrefix: licenseKey.slice(0, 9) }, 'edge_node_provisioned')
  }

  // Enviar por e-mail ao técnico se solicitado E não estiver aguardando aprovação
  let emailSent = false
  let emailError: string | undefined
  if (b.sendEmail && b.technicianEmail && !requiresApproval) {
    const result = await sendLicenseKeyEmail({
      to:          b.technicianEmail,
      licenseKey,
      edgeNodeId:  node.id,
      edgeName:    node.name,
      siteName:    site.name,
      clienteName: site.clienteFinal.name,
    })
    emailSent  = result.sent
    emailError = result.reason
  }

  res.status(201).json({
    edgeNode: {
      ...node,
      site:         { id: site.id, name: site.name },
      clienteFinal: { id: site.clienteFinal.id, name: site.clienteFinal.name },
    },
    // Só expõe licenseKey se não precisa aprovação
    licenseKey: requiresApproval ? null : licenseKey,
    requiresApproval,
    approvalRequestId,
    message: requiresApproval
      ? 'Solicitação criada. Aguarde aprovação do super admin para receber a chave.'
      : 'Edge Node provisionado. COPIE A CHAVE — ela não será exibida novamente neste endpoint.',
    email: b.sendEmail && !requiresApproval
      ? { sent: emailSent, to: b.technicianEmail, error: emailError ?? null }
      : null,
    bootstrap: requiresApproval ? null : {
      edgeNodeId:    node.id,
      licenseKey,
      backendUrl:    process.env.PUBLIC_API_URL ?? 'https://api.iacvision.com.br',
      heartbeatSec:  60,
    },
  })
}))

// ─── POST /edge-nodes/:id/suspend ─────────────────────────────────────────────
// SUPER_ADMIN suspende remotamente uma licença.
// Box continua existindo mas o token é invalidado e status vira SUSPENDED.
edgeNodesRouter.post('/:id/suspend', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN') throw new ForbiddenError('Apenas SUPER_ADMIN pode suspender licenças')

  const reason = (req.body?.reason as string | undefined) ?? null
  const node = await prisma.edgeNode.findUnique({ where: { id: String(req.params.id) } })
  if (!node) throw new NotFoundError('Edge node')

  await prisma.edgeNode.update({
    where: { id: node.id },
    data: {
      status: 'SUSPENDED' as any,
      // Invalida o token atual — box deixa de autenticar
      apiToken: hashKey(crypto.randomUUID()),
    },
  })

  await prisma.auditLog.create({
    data: {
      action: 'EDGE_NODE_SUSPENDED',
      resource: 'EdgeNode',
      resourceId: node.id,
      integradorId: node.integradorId,
      metadataJson: { reason } as any,
      superAdminId: jwt.sub,
    },
  }).catch(err => logger.warn({ err: err.message }, 'edge_suspend_audit_failed'))

  logger.warn({ edgeNodeId: node.id, by: jwt.sub, reason }, 'edge_node_suspended')
  res.json({ ok: true, edgeNodeId: node.id, status: 'SUSPENDED', reason })
}))

// ─── POST /edge-nodes/:id/resume ──────────────────────────────────────────────
// SUPER_ADMIN reativa licença previamente suspensa.
// Gera nova chave (a antiga foi invalidada) e marca para re-provisionamento.
edgeNodesRouter.post('/:id/resume', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN') throw new ForbiddenError('Apenas SUPER_ADMIN pode reativar licenças')

  const node = await prisma.edgeNode.findUnique({ where: { id: String(req.params.id) } })
  if (!node) throw new NotFoundError('Edge node')
  if ((node.status as any) !== 'SUSPENDED') throw new ValidationError(`Edge node não está suspenso (status atual: ${node.status})`)

  // Gera nova chave (a antiga foi invalidada no suspend)
  const licenseKey    = generateLicenseKey()
  const apiToken      = hashKey(licenseKey)
  const licenseKeyEnc = encryptSecret(licenseKey)

  await prisma.edgeNode.update({
    where: { id: node.id },
    data: {
      status: 'PROVISIONING',
      apiToken,
      licenseKeyEnc,
    },
  })

  await prisma.auditLog.create({
    data: {
      action: 'EDGE_NODE_RESUMED',
      resource: 'EdgeNode',
      resourceId: node.id,
      integradorId: node.integradorId,
      superAdminId: jwt.sub,
    },
  }).catch(err => logger.warn({ err: err.message }, 'edge_resume_audit_failed'))

  logger.info({ edgeNodeId: node.id, by: jwt.sub }, 'edge_node_resumed')
  res.json({
    ok: true,
    edgeNodeId: node.id,
    status: 'PROVISIONING',
    licenseKey,
    warning: 'Box precisa reativar com a nova chave. A anterior está inválida.',
  })
}))

// ─── GET /edge-nodes/:id/license-key ─────────────────────────────────────────
// Recupera a chave cifrada. Restrito a SUPER_ADMIN e INTEGRADOR_ADMIN (tenant próprio).

edgeNodesRouter.get('/:id/license-key', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (!canManageEdge(jwt)) throw new ForbiddenError('Acesso negado')

  const node = await prisma.edgeNode.findFirst({
    where: {
      id: String(req.params.id),
      ...edgeTenantWhere(jwt),
    },
    select: {
      id: true, name: true, serialNumber: true,
      licenseKeyEnc: true, technicianEmail: true, status: true,
    },
  })
  if (!node) throw new NotFoundError('Edge node')

  const licenseKey = decryptSecret(node.licenseKeyEnc)
  if (!licenseKey) {
    // Pode ter sido provisionado antes desta feature ou enc corrompido
    return res.status(404).json({
      error:   'KEY_UNAVAILABLE',
      message: 'Chave não disponível. Use rotate-token para gerar uma nova.',
    })
  }

  res.json({
    edgeNodeId:     node.id,
    name:           node.name,
    serialNumber:   node.serialNumber,
    licenseKey,
    technicianEmail: node.technicianEmail,
    status:         node.status,
    warning: 'Trate esta chave com sigilo. Qualquer pessoa com ela pode ativar este Edge Node.',
  })
}))

// ─── POST /edge-nodes/:id/rotate-token ───────────────────────────────────────
// Invalida a chave atual e gera uma nova. Chave antiga deixa de funcionar.

const RotateSchema = z.object({
  technicianEmail: z.string().email().optional(),
  sendEmail:       z.boolean().default(false),
})

edgeNodesRouter.post('/:id/rotate-token', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (!canManageEdge(jwt)) throw new ForbiddenError('Acesso negado')

  const parse = RotateSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const node = await prisma.edgeNode.findFirst({
    where: { id: String(req.params.id), ...edgeTenantWhere(jwt) },
    include: {
      site: {
        select: {
          id: true, name: true,
          clienteFinal: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!node) throw new NotFoundError('Edge node')

  const licenseKey    = generateLicenseKey()
  const apiToken      = hashKey(licenseKey)
  const licenseKeyEnc = encryptSecret(licenseKey)
  const techEmail     = parse.data.technicianEmail ?? node.technicianEmail ?? undefined

  await prisma.edgeNode.update({
    where: { id: node.id },
    data: {
      apiToken,
      licenseKeyEnc,
      status: 'PROVISIONING', // força re-activate com nova chave
      ...(techEmail ? { technicianEmail: techEmail } : {}),
    },
  })

  logger.info({ edgeNodeId: node.id, keyPrefix: licenseKey.slice(0, 9) }, 'edge_node_token_rotated')

  let emailSent = false
  let emailError: string | undefined
  if (parse.data.sendEmail && techEmail) {
    const result = await sendLicenseKeyEmail({
      to:          techEmail,
      licenseKey,
      edgeNodeId:  node.id,
      edgeName:    node.name,
      siteName:    node.site.name,
      clienteName: node.site.clienteFinal.name,
    })
    emailSent  = result.sent
    emailError = result.reason
  }

  res.json({
    edgeNodeId: node.id,
    licenseKey,
    warning: 'Chave anterior invalidada. Box precisará fazer novo /activate com a nova chave.',
    email: parse.data.sendEmail
      ? { sent: emailSent, to: techEmail ?? null, error: emailError ?? null }
      : null,
  })
}))

// ─── DELETE /edge-nodes/:id ───────────────────────────────────────────────────
// Soft-delete: muda status para DECOMMISSIONED. Dados preservados para auditoria.

edgeNodesRouter.delete('/:id', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (!canManageEdge(jwt)) throw new ForbiddenError('Acesso negado')

  const node = await prisma.edgeNode.findFirst({
    where: { id: String(req.params.id), ...edgeTenantWhere(jwt) },
  })
  if (!node) throw new NotFoundError('Edge node')

  await prisma.edgeNode.update({
    where: { id: node.id },
    data: {
      status:       'OFFLINE',
      apiToken:     hashKey(crypto.randomUUID()), // invalida token atual
      licenseKeyEnc: null,                        // apaga chave cifrada
    },
  })

  logger.info({ edgeNodeId: node.id, by: jwt.sub }, 'edge_node_decommissioned')

  res.json({ ok: true, deletedId: node.id, message: 'Edge Node desativado. Câmeras vinculadas preservadas.' })
}))

// ─── helper: envio de e-mail de licença ───────────────────────────────────────

interface LicenseEmailOpts {
  to:          string
  licenseKey:  string
  edgeNodeId:  string
  edgeName:    string
  siteName:    string
  clienteName: string
}

async function sendLicenseKeyEmail(opts: LicenseEmailOpts) {
  const tpl = await loadTemplate('license_key')
  if (!tpl) return { sent: false, reason: 'Template license_key não encontrado' }

  const publicUrl = process.env.PUBLIC_APP_URL ?? 'https://app.iacvision.com.br'

  const subject = renderTemplate(tpl.subject, {
    edgeName:    opts.edgeName,
    siteName:    opts.siteName,
    clienteName: opts.clienteName,
  })
  const text = renderTemplate(tpl.body, {
    edgeName:    opts.edgeName,
    siteName:    opts.siteName,
    clienteName: opts.clienteName,
    licenseKey:  opts.licenseKey,
    edgeNodeId:  opts.edgeNodeId,
    dashboardUrl: `${publicUrl}/edge-nodes/${opts.edgeNodeId}`,
    docsUrl:     `${publicUrl}/docs/instalacao`,
  })

  return sendMail({ to: opts.to, subject, text })
}
