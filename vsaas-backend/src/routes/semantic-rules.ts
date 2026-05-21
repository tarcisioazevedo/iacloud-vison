/**
 * SemanticRule Routes — CRUD de regras de alerta em linguagem natural.
 *
 * Endpoints:
 *   GET    /semantic-rules           — lista (filtro cameraId)
 *   POST   /semantic-rules           — cria
 *   GET    /semantic-rules/:id       — detalhe
 *   PATCH  /semantic-rules/:id       — edita
 *   DELETE /semantic-rules/:id       — remove
 *   POST   /semantic-rules/:id/test  — avalia agora (manual) e retorna resultado
 *
 * Tenant scope: regras pertencem a Camera → Site → ClienteFinal → Integrador.
 * Reusa `cameraTenantWhere` igual outras rotas.
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'
import { cameraTenantWhere } from '../lib/tenant-scope'
import { captureSnapshot, FfmpegSnapshotError } from '../services/ffmpeg-snapshot.service'
import { evaluateSemanticRule } from '../services/genai.service'

export const semanticRulesRouter = Router()
semanticRulesRouter.use(requireAuth)

const CreateSchema = z.object({
  cameraId:       z.string().uuid(),
  prompt:         z.string().min(10).max(500),
  intervalSec:    z.number().int().min(15).max(3600).default(30),
  notifyChannels: z.array(z.enum(['push', 'whatsapp', 'email', 'telegram'])).default([]),
  severity:       z.enum(['info', 'warning', 'critical']).default('warning'),
  scheduleCron:   z.string().optional().nullable(),
  enabled:        z.boolean().default(true),
})
const PatchSchema = CreateSchema.partial().omit({ cameraId: true })

async function assertCameraAccess(req: any, cameraId: string): Promise<void> {
  const cam = await prisma.camera.findFirst({
    where: { id: cameraId, ...cameraTenantWhere(req.jwtPayload) },
    select: { id: true },
  })
  if (!cam) throw new ForbiddenError('Camera fora do escopo')
}

async function allowedCameraIds(jwtPayload: any): Promise<string[]> {
  const cams = await prisma.camera.findMany({
    where: cameraTenantWhere(jwtPayload),
    select: { id: true },
  })
  return cams.map(c => c.id)
}

// ── LIST ─────────────────────────────────────────────────────────────────
semanticRulesRouter.get('/', asyncHandler(async (req, res) => {
  const cameraId = req.query.cameraId as string | undefined
  const ids = await allowedCameraIds(req.jwtPayload)
  const rules = await prisma.semanticRule.findMany({
    where: {
      cameraId: cameraId ? cameraId : { in: ids },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  res.json({ items: rules })
}))

// ── CREATE ───────────────────────────────────────────────────────────────
semanticRulesRouter.post('/', asyncHandler(async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors[0].message)
  }
  await assertCameraAccess(req, parsed.data.cameraId)

  // ── Quota enforce (P0 #3) ──────────────────────────────────────────────
  // Busca cliente da câmera, conta regras existentes vs limite do plano.
  const camera = await prisma.camera.findUnique({
    where: { id: parsed.data.cameraId },
    select: { site: { select: { clienteFinalId: true } } },
  })
  const clienteFinalId = camera?.site?.clienteFinalId
  if (clienteFinalId) {
    const subs = await prisma.clienteSubscription.findMany({
      where: {
        clienteFinalId,
        status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] as any },
      },
      select: { product: { select: { slug: true, metadata: true } } },
    })
    const limit = inferSemanticRuleQuota(subs)
    // Conta regras existentes deste cliente (via cameras do cliente)
    const myCameras = await prisma.camera.findMany({
      where: { site: { clienteFinalId } },
      select: { id: true },
    })
    const cameraIds = myCameras.map(c => c.id)
    const currentCount = await prisma.semanticRule.count({
      where: { cameraId: { in: cameraIds } },
    })
    if (currentCount >= limit) {
      res.status(403).json({
        error: 'quota_exceeded',
        message: `Limite de regras semanticas atingido (${currentCount}/${limit}). Adquira o add-on 'ai-semantic-alert' para regras extras.`,
        quota: { used: currentCount, limit },
      })
      return
    }
  }

  const created = await prisma.semanticRule.create({
    data: {
      cameraId:       parsed.data.cameraId,
      prompt:         parsed.data.prompt,
      intervalSec:    parsed.data.intervalSec,
      notifyChannels: parsed.data.notifyChannels,
      severity:       parsed.data.severity,
      scheduleCron:   parsed.data.scheduleCron ?? null,
      enabled:        parsed.data.enabled,
      createdById:    req.jwtPayload?.sub ?? null,
    },
  })
  res.status(201).json(created)
}))

// ── GET ─────────────────────────────────────────────────────────────────
semanticRulesRouter.get('/:id', asyncHandler(async (req, res) => {
  const ids = await allowedCameraIds(req.jwtPayload)
  const row = await prisma.semanticRule.findFirst({
    where: { id: req.params.id, cameraId: { in: ids } },
  })
  if (!row) throw new NotFoundError('semantic_rule_not_found')
  res.json(row)
}))

// ── PATCH ───────────────────────────────────────────────────────────────
semanticRulesRouter.patch('/:id', asyncHandler(async (req, res) => {
  const parsed = PatchSchema.safeParse(req.body)
  if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

  const ids = await allowedCameraIds(req.jwtPayload)
  const existing = await prisma.semanticRule.findFirst({
    where: { id: req.params.id, cameraId: { in: ids } },
  })
  if (!existing) throw new NotFoundError('semantic_rule_not_found')

  const updated = await prisma.semanticRule.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.prompt !== undefined ? { prompt: parsed.data.prompt } : {}),
      ...(parsed.data.intervalSec !== undefined ? { intervalSec: parsed.data.intervalSec } : {}),
      ...(parsed.data.notifyChannels !== undefined ? { notifyChannels: parsed.data.notifyChannels } : {}),
      ...(parsed.data.severity !== undefined ? { severity: parsed.data.severity } : {}),
      ...(parsed.data.scheduleCron !== undefined ? { scheduleCron: parsed.data.scheduleCron ?? null } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    },
  })
  res.json(updated)
}))

// ── DELETE ──────────────────────────────────────────────────────────────
semanticRulesRouter.delete('/:id', asyncHandler(async (req, res) => {
  const ids = await allowedCameraIds(req.jwtPayload)
  const existing = await prisma.semanticRule.findFirst({
    where: { id: req.params.id, cameraId: { in: ids } },
  })
  if (!existing) throw new NotFoundError('semantic_rule_not_found')
  await prisma.semanticRule.delete({ where: { id: existing.id } })
  res.status(204).end()
}))

// ── TEST (manual eval agora) ────────────────────────────────────────────
semanticRulesRouter.post('/:id/test', asyncHandler(async (req, res) => {
  const ids = await allowedCameraIds(req.jwtPayload)
  const rule = await prisma.semanticRule.findFirst({
    where: { id: req.params.id, cameraId: { in: ids } },
  })
  if (!rule) throw new NotFoundError('semantic_rule_not_found')
  const camera = await prisma.camera.findUnique({
    where: { id: rule.cameraId },
    select: { rtspMainUrl: true, active: true },
  })
  if (!camera?.active || !camera.rtspMainUrl) {
    res.status(409).json({ error: 'camera_offline_or_no_rtsp' }); return
  }
  try {
    const jpeg = await captureSnapshot(camera.rtspMainUrl)
    const result = await evaluateSemanticRule(jpeg, rule.prompt)
    res.json({ ok: true, result })
  } catch (err: any) {
    if (err instanceof FfmpegSnapshotError) {
      res.status(503).json({ error: 'snapshot_failed', code: err.code, message: err.message }); return
    }
    throw err
  }
}))

/**
 * Quota de regras semânticas por cliente. Lógica:
 *  - Cliente sem subscription ativa de ai-semantic-alert -> 0 (não pode criar)
 *  - Subscription PER_RULE com quantity -> quantity
 *  - Plano base (smart-plus / enterprise) -> número incluído + add-ons
 *
 * Defaults conservadores; refinar com base nos planos reais que o fabricante
 * configurar no marketplace.
 */
function inferSemanticRuleQuota(subscriptions: Array<{ product: { slug: string; metadata: any } }>): number {
  let total = 0
  let hasBase = false
  for (const s of subscriptions) {
    const slug = s.product?.slug ?? ''
    const meta = s.product?.metadata as any
    if (slug.includes('ai-semantic-alert') || slug.includes('alertas-semanticos')) {
      total += Number(meta?.quotaRules ?? 1)
    }
    if (slug.includes('smart-plus') || slug.includes('enterprise')) {
      hasBase = true
      total += Number(meta?.includedRules ?? 5)
    }
  }
  // Fallback: cliente sem nada paga só pela primeira regra (entry-level)
  return hasBase || total > 0 ? total : 1
}
