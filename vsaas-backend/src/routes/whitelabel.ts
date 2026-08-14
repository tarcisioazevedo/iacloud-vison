/**
 * Whitelabel Routes — Sprint 5 do plano docs/STORAGE-ARCHITECTURE.md.
 *
 * Permite ao integrador configurar seu próprio domínio (ex:
 * cdn.acmevigilancia.com.br) que aponta para o bucket R2 do tenant. Isso
 * habilita cache CDN no playback HLS (reduz Class B ops) e branding real
 * (cliente final do integrador não vê app.iacloud.com.br).
 *
 * Endpoints:
 *   GET  /me/whitelabel          — vê domínio atual + status DNS/SSL
 *   PUT  /me/whitelabel          — define/altera customDomain (INT_ADMIN)
 *   POST /me/whitelabel/verify   — força revalidação DNS (caso CNAME demorou pra propagar)
 *   DELETE /me/whitelabel        — remove customDomain (volta a usar managed r2.dev)
 *
 * Integração CF Custom Hostnames:
 *   - Quando o integrador define o custom domain, criamos um Custom Hostname
 *     no bucket R2 via API CF: POST /accounts/{id}/r2/buckets/{bucket}/domains/custom
 *   - Cloudflare valida automaticamente DNS + SSL
 *   - Status do hostname (active|pending|error) fica visível na UI
 *
 * Pré-requisito DNS:
 *   O integrador precisa criar CNAME no provedor DNS dele:
 *     cdn.acmevigilancia.com.br  CNAME  pub-{bucketId}.r2.dev
 *   (instruções aparecem na resposta do PUT)
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { logger } from '../lib/logger'
import { requires } from '../middleware/require-capability'
import { CAPABILITIES } from '../lib/capabilities'

export const whitelabelRouter = Router()

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? ''
const API_TOKEN  = process.env.R2_API_TOKEN  ?? ''
const API_BASE   = 'https://api.cloudflare.com/client/v4'

function isIntegradorAdmin(role: string): boolean {
  return role === 'INTEGRADOR_ADMIN' || role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
}

// Sanitiza domain — só lowercase, letras/números/hífen/ponto, sem trailing slash
function sanitizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
}

const domainSchema = z.string().regex(/^([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/, 'Domínio inválido (ex: cdn.acme.com.br)')

// ── GET /me/whitelabel ───────────────────────────────────────────────────────
whitelabelRouter.get('/',
  requires(CAPABILITIES.WHITELABEL_CUSTOM_DOMAIN),
  requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const p = req.jwtPayload
  if (!isIntegradorAdmin(p.role)) throw new ForbiddenError('Apenas INTEGRADOR_ADMIN ou SUPER_ADMIN')

  let integradorId = p.integradorId
  if (p.role === 'SUPER_ADMIN' || p.role === 'ADMIN_GLOBAL') {
    integradorId = (req.query.integradorId as string) ?? p.integradorId
  }
  if (!integradorId) throw new ValidationError('integradorId requerido')

  const integ = await prisma.integrador.findUnique({
    where:  { id: integradorId },
    select: { id: true, name: true, customDomain: true, storageBuckets: { select: { name: true } } },
  })
  if (!integ) throw new NotFoundError('Integrador não encontrado')

  const bucket = integ.storageBuckets[0]?.name
  // Se não há custom domain definido, retorna estado padrão (managed)
  if (!integ.customDomain) {
    return res.json({
      integradorId,
      customDomain: null,
      bucket,
      managed: bucket ? `pub-${bucket.replace(/^icv-/, '')}.r2.dev` : null,
      status: 'not_configured',
      instructions: bucket
        ? `Defina o domínio via PUT, depois aponte CNAME ${'<seu-domínio>'} → pub-{bucketId}.r2.dev`
        : 'Bucket do integrador ainda não criado',
    })
  }

  // Tem customDomain — consulta status no Cloudflare
  let cfStatus: { status: string; errors?: any } = { status: 'unknown' }
  if (ACCOUNT_ID && API_TOKEN && bucket) {
    try {
      const r = await fetch(
        `${API_BASE}/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/domains/custom`,
        { headers: { Authorization: `Bearer ${API_TOKEN}` } },
      )
      const json = await r.json() as any
      const matched = json?.result?.domains?.find((d: any) => d.domain === integ.customDomain)
      if (matched) {
        cfStatus = { status: matched.status?.ownership ?? matched.status?.ssl ?? 'pending' }
      }
    } catch (err) {
      logger.warn({ err, bucket }, 'whitelabel_cf_status_failed')
    }
  }

  res.json({
    integradorId,
    customDomain: integ.customDomain,
    bucket,
    cfStatus,
    instructions: `CNAME ${integ.customDomain} → pub-{bucketId}.r2.dev (consulte /me/whitelabel/verify para revalidação)`,
  })
}))

// ── PUT /me/whitelabel ───────────────────────────────────────────────────────
const putSchema = z.object({
  customDomain: domainSchema,
})

whitelabelRouter.put('/',
  requires(CAPABILITIES.WHITELABEL_CUSTOM_DOMAIN),
  requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const p = req.jwtPayload
  if (!isIntegradorAdmin(p.role)) throw new ForbiddenError('Apenas INTEGRADOR_ADMIN ou SUPER_ADMIN')

  let integradorId = p.integradorId
  if (p.role === 'SUPER_ADMIN' || p.role === 'ADMIN_GLOBAL') {
    integradorId = (req.query.integradorId as string) ?? p.integradorId
  }
  if (!integradorId) throw new ValidationError('integradorId requerido')

  const data = putSchema.parse(req.body)
  const domain = sanitizeDomain(data.customDomain)

  // Valida que domínio não está em uso por outro integrador
  const conflict = await prisma.integrador.findFirst({
    where: { customDomain: domain, NOT: { id: integradorId } },
    select: { id: true },
  })
  if (conflict) throw new ValidationError('Este domínio já está em uso por outro integrador')

  // Atualiza o registro do integrador
  const integ = await prisma.integrador.update({
    where: { id: integradorId },
    data:  { customDomain: domain },
    select: { id: true, customDomain: true, storageBuckets: { select: { name: true } } },
  })

  const bucket = integ.storageBuckets[0]?.name

  // Tenta registrar Custom Hostname no Cloudflare (best-effort)
  let cfRegistration: any = { ok: false, message: 'CF API not configured' }
  if (ACCOUNT_ID && API_TOKEN && bucket) {
    try {
      const r = await fetch(
        `${API_BASE}/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/domains/custom`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ domain, enabled: true, minTLS: '1.2' }),
        },
      )
      const json = await r.json() as any
      cfRegistration = json?.success
        ? { ok: true, status: json.result?.status }
        : { ok: false, errors: json?.errors }
    } catch (err) {
      cfRegistration = { ok: false, message: String(err) }
    }
  }

  logger.info({ integradorId, domain, cfRegistration }, 'whitelabel_custom_domain_set')

  res.json({
    integradorId: integ.id,
    customDomain: integ.customDomain,
    bucket,
    cfRegistration,
    nextSteps: [
      `Aponte CNAME no provedor DNS do seu domínio: ${domain} → pub-{bucketId}.r2.dev`,
      'Aguarde Cloudflare validar SSL (5-30 minutos após CNAME estar correto)',
      'Use GET /me/whitelabel para acompanhar status',
    ],
  })
}))

// ── POST /me/whitelabel/verify — força revalidação ───────────────────────────
whitelabelRouter.post('/verify',
  requires(CAPABILITIES.WHITELABEL_CUSTOM_DOMAIN),
  requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const p = req.jwtPayload
  if (!isIntegradorAdmin(p.role)) throw new ForbiddenError('Apenas INTEGRADOR_ADMIN ou SUPER_ADMIN')

  let integradorId = p.integradorId
  if (p.role === 'SUPER_ADMIN' || p.role === 'ADMIN_GLOBAL') {
    integradorId = (req.query.integradorId as string) ?? p.integradorId
  }
  if (!integradorId) throw new ValidationError('integradorId requerido')

  const integ = await prisma.integrador.findUnique({
    where:  { id: integradorId },
    select: { customDomain: true, storageBuckets: { select: { name: true } } },
  })
  if (!integ?.customDomain) throw new ValidationError('Sem customDomain configurado')
  const bucket = integ.storageBuckets[0]?.name
  if (!bucket) throw new ValidationError('Bucket não encontrado')

  if (!ACCOUNT_ID || !API_TOKEN) {
    return res.status(503).json({ error: 'CF API não configurada' })
  }

  // Cloudflare R2 não tem endpoint explícito de "force revalidate"; o status
  // é atualizado automaticamente conforme DNS propaga e SSL é emitido.
  // Reusamos GET /domains/custom pra obter status atual.
  try {
    const r = await fetch(
      `${API_BASE}/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/domains/custom`,
      { headers: { Authorization: `Bearer ${API_TOKEN}` } },
    )
    const json = await r.json() as any
    const matched = json?.result?.domains?.find((d: any) => d.domain === integ.customDomain)
    res.json({ status: matched ?? null })
  } catch (err) {
    logger.warn({ err }, 'whitelabel_verify_failed')
    res.status(502).json({ error: 'Falha ao consultar Cloudflare', details: String(err) })
  }
}))

// ── DELETE /me/whitelabel ────────────────────────────────────────────────────
whitelabelRouter.delete('/',
  requires(CAPABILITIES.WHITELABEL_CUSTOM_DOMAIN),
  requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const p = req.jwtPayload
  if (!isIntegradorAdmin(p.role)) throw new ForbiddenError('Apenas INTEGRADOR_ADMIN ou SUPER_ADMIN')

  let integradorId = p.integradorId
  if (p.role === 'SUPER_ADMIN' || p.role === 'ADMIN_GLOBAL') {
    integradorId = (req.query.integradorId as string) ?? p.integradorId
  }
  if (!integradorId) throw new ValidationError('integradorId requerido')

  const integ = await prisma.integrador.findUnique({
    where:  { id: integradorId },
    select: { customDomain: true, storageBuckets: { select: { name: true } } },
  })
  if (!integ?.customDomain) {
    return res.json({ ok: true, message: 'Sem customDomain configurado' })
  }
  const bucket = integ.storageBuckets[0]?.name
  const oldDomain = integ.customDomain

  // Best-effort: remove Custom Hostname no Cloudflare
  if (ACCOUNT_ID && API_TOKEN && bucket) {
    try {
      await fetch(
        `${API_BASE}/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/domains/custom/${encodeURIComponent(oldDomain)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${API_TOKEN}` } },
      )
    } catch (err) {
      logger.warn({ err, bucket, domain: oldDomain }, 'whitelabel_cf_delete_failed')
    }
  }

  await prisma.integrador.update({
    where: { id: integradorId },
    data:  { customDomain: null },
  })

  logger.info({ integradorId, oldDomain }, 'whitelabel_custom_domain_removed')
  res.json({ ok: true, removedDomain: oldDomain })
}))
