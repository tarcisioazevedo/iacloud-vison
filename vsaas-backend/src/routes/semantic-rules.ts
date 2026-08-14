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
import { requires } from '../middleware/require-capability'
import { CAPABILITIES } from '../lib/capabilities'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'
import { cameraTenantWhere } from '../lib/tenant-scope'
import { captureSnapshot, FfmpegSnapshotError } from '../services/ffmpeg-snapshot.service'
import { evaluateSemanticRule } from '../services/genai.service'
import { ScheduleWindowSchema, serializeSchedule, parseSchedule } from '../lib/semantic-schedule'

export const semanticRulesRouter = Router()
semanticRulesRouter.use(requireAuth)

const CreateSchema = z.object({
  cameraId:       z.string().uuid(),
  prompt:         z.string().min(10).max(500),
  intervalSec:    z.number().int().min(5).max(3600).default(30),
  notifyChannels: z.array(z.enum(['push', 'whatsapp', 'email', 'telegram'])).default([]),
  severity:       z.enum(['info', 'warning', 'critical']).default('warning'),
  // Aceita JSON estruturado (preferido) OU cron raw (legacy)
  schedule:       ScheduleWindowSchema.nullable().optional(),
  scheduleCron:   z.string().optional().nullable(),
  enabled:        z.boolean().default(true),
})
const PatchSchema = CreateSchema.partial().omit({ cameraId: true })

/** Resolve scheduleCron persistido a partir dos campos do payload.
 *  Prioriza `schedule` (JSON estruturado) sobre `scheduleCron` (legacy).
 *  Aceita Create OU Patch — PatchSchema é Partial<CreateSchema> sem cameraId. */
function resolveSchedulePersistence(
  d: Partial<z.infer<typeof CreateSchema>>,
): string | null | undefined {
  if (d.schedule !== undefined) return serializeSchedule(d.schedule)
  if (d.scheduleCron !== undefined) return d.scheduleCron ?? null
  return undefined // não tocar no campo no PATCH
}

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
semanticRulesRouter.get('/', requires(CAPABILITIES.AI_SEMANTIC_LIST_ALERTS), asyncHandler(async (req, res) => {
  const cameraId = req.query.cameraId as string | undefined
  const ids = await allowedCameraIds(req.jwtPayload)
  const rules = await prisma.semanticRule.findMany({
    where: {
      cameraId: cameraId ? cameraId : { in: ids },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    // Exclui lastFireSnapshot (Bytes) — servido via /:id/snapshot.
    select: {
      id: true, cameraId: true, prompt: true, scheduleCron: true, intervalSec: true,
      enabled: true, notifyChannels: true, severity: true, triggerId: true,
      lastFiredAt: true, lastEvaluatedAt: true, fireCount: true,
      consecutiveFp: true, autoPaused: true, autoPausedAt: true, autoPausedReason: true,
      lastFireReason: true, createdAt: true, updatedAt: true,
    },
  })
  // Anexa `schedule` parseado (UI consome esse, scheduleCron continua para legacy)
  const items = rules.map(r => ({ ...r, schedule: parseSchedule(r.scheduleCron) }))
  res.json({ items })
}))

// ── CREATE ───────────────────────────────────────────────────────────────
semanticRulesRouter.post('/', requires(CAPABILITIES.AI_SEMANTIC_CREATE_RULE), asyncHandler(async (req, res) => {
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
        status: { in: ['ACTIVE', 'GRACE'] as any },
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

  const persistedSchedule = resolveSchedulePersistence(parsed.data)
  const created = await prisma.semanticRule.create({
    data: {
      cameraId:       parsed.data.cameraId,
      prompt:         parsed.data.prompt,
      intervalSec:    parsed.data.intervalSec,
      notifyChannels: parsed.data.notifyChannels,
      severity:       parsed.data.severity,
      scheduleCron:   persistedSchedule ?? null,
      enabled:        parsed.data.enabled,
      createdById:    req.jwtPayload?.sub ?? null,
    },
  })
  res.status(201).json({ ...created, schedule: parseSchedule(created.scheduleCron) })
}))

// ── GET ─────────────────────────────────────────────────────────────────
semanticRulesRouter.get('/:id', requires(CAPABILITIES.AI_SEMANTIC_LIST_ALERTS), asyncHandler(async (req, res) => {
  const ids = await allowedCameraIds(req.jwtPayload)
  const row = await prisma.semanticRule.findFirst({
    where: { id: req.params.id, cameraId: { in: ids } },
  })
  if (!row) throw new NotFoundError('semantic_rule_not_found')
  res.json(row)
}))

// ── PATCH ───────────────────────────────────────────────────────────────
semanticRulesRouter.patch('/:id', requires(CAPABILITIES.AI_SEMANTIC_CREATE_RULE), asyncHandler(async (req, res) => {
  const parsed = PatchSchema.safeParse(req.body)
  if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

  const ids = await allowedCameraIds(req.jwtPayload)
  const existing = await prisma.semanticRule.findFirst({
    where: { id: req.params.id, cameraId: { in: ids } },
  })
  if (!existing) throw new NotFoundError('semantic_rule_not_found')

  const persistedSchedule = resolveSchedulePersistence(parsed.data)

  // Reativar (enabled=true) uma regra auto-pausada (P1 #8) precisa também
  // limpar o auto-pause em si — senão ela continua invisível pro tick()
  // mesmo com enabled=true. Reseta consecutiveFp também, senão um único FP
  // novo já dispara o auto-pause de novo antes de dar chance ao prompt revisado.
  const reactivatingFromAutoPause = parsed.data.enabled === true && existing.autoPaused

  const updated = await prisma.semanticRule.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.prompt !== undefined ? { prompt: parsed.data.prompt } : {}),
      ...(parsed.data.intervalSec !== undefined ? { intervalSec: parsed.data.intervalSec } : {}),
      ...(parsed.data.notifyChannels !== undefined ? { notifyChannels: parsed.data.notifyChannels } : {}),
      ...(parsed.data.severity !== undefined ? { severity: parsed.data.severity } : {}),
      ...(persistedSchedule !== undefined ? { scheduleCron: persistedSchedule } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      ...(reactivatingFromAutoPause
        ? { autoPaused: false, autoPausedAt: null, autoPausedReason: null, consecutiveFp: 0 }
        : {}),
    },
  })
  res.json({ ...updated, schedule: parseSchedule(updated.scheduleCron) })
}))

// ── DELETE ──────────────────────────────────────────────────────────────
semanticRulesRouter.delete('/:id', requires(CAPABILITIES.AI_SEMANTIC_CREATE_RULE), asyncHandler(async (req, res) => {
  const ids = await allowedCameraIds(req.jwtPayload)
  const existing = await prisma.semanticRule.findFirst({
    where: { id: req.params.id, cameraId: { in: ids } },
  })
  if (!existing) throw new NotFoundError('semantic_rule_not_found')
  await prisma.semanticRule.delete({ where: { id: existing.id } })
  res.status(204).end()
}))

// ── TEST (manual eval agora) ────────────────────────────────────────────
// ⚠ Gate crítico: cada chamada dispara Gemini (custo direto). Bloqueia sem subscription.
semanticRulesRouter.post('/:id/test', requires(CAPABILITIES.AI_SEMANTIC_TEST_RULE), asyncHandler(async (req, res) => {
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
    res.json({
      ok: true,
      result,
      snapshotBase64: jpeg.toString('base64'),
      snapshotMime: 'image/jpeg',
    })
  } catch (err: any) {
    if (err instanceof FfmpegSnapshotError) {
      res.status(503).json({ error: 'snapshot_failed', code: err.code, message: err.message }); return
    }
    throw err
  }
}))

// ── Histórico de disparos (extrato auditável) ──────────────────────────
// GET /semantic-rules/:id/fires → paginado, sem snapshot bytes
semanticRulesRouter.get('/:id/fires', requires(CAPABILITIES.AI_SEMANTIC_LIST_ALERTS), asyncHandler(async (req, res) => {
  const ids = await allowedCameraIds(req.jwtPayload)
  const rule = await prisma.semanticRule.findFirst({
    where: { id: req.params.id, cameraId: { in: ids } },
    select: { id: true },
  })
  if (!rule) throw new NotFoundError('semantic_rule_not_found')

  const limit  = Math.min(Number(req.query.limit ?? 30), 200)
  const offset = Math.max(Number(req.query.offset ?? 0), 0)

  const [items, total] = await Promise.all([
    prisma.semanticRuleFire.findMany({
      where: { ruleId: rule.id },
      orderBy: { firedAt: 'desc' },
      skip: offset, take: limit,
      select: {
        id: true, firedAt: true, reason: true, confidence: true,
        severity: true, verdict: true, cameraId: true,
      },
    }),
    prisma.semanticRuleFire.count({ where: { ruleId: rule.id } }),
  ])
  res.json({ items, total, limit, offset })
}))

// Serve snapshot de um fire específico (download).
semanticRulesRouter.get('/:id/fires/:fireId/snapshot', requires(CAPABILITIES.AI_SEMANTIC_LIST_ALERTS), asyncHandler(async (req, res) => {
  const ids = await allowedCameraIds(req.jwtPayload)
  const fire = await prisma.semanticRuleFire.findFirst({
    where: { id: req.params.fireId, ruleId: req.params.id, cameraId: { in: ids } },
    select: { snapshot: true, firedAt: true },
  })
  if (!fire || !fire.snapshot) throw new NotFoundError('snapshot_not_found')

  const filename = `disparo-${req.params.fireId.slice(0, 8)}-${fire.firedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`
  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('Content-Disposition',
    req.query.download === '1'
      ? `attachment; filename="${filename}"`
      : `inline; filename="${filename}"`,
  )
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.send(Buffer.from(fire.snapshot))
}))

// FP feedback POR FIRE (não por regra) — atualiza verdict do disparo específico
// + agrega no consecutiveFp da regra como antes.
semanticRulesRouter.post('/:id/fires/:fireId/verdict', requires(CAPABILITIES.AI_SEMANTIC_LIST_ALERTS), asyncHandler(async (req, res) => {
  const verdict = req.body?.verdict as string
  if (!['correct', 'false_positive'].includes(verdict)) {
    throw new ValidationError('verdict deve ser correct ou false_positive')
  }
  const ids = await allowedCameraIds(req.jwtPayload)
  const fire = await prisma.semanticRuleFire.findFirst({
    where: { id: req.params.fireId, ruleId: req.params.id, cameraId: { in: ids } },
    select: { id: true, ruleId: true, cameraId: true, verdict: true },
  })
  if (!fire) throw new NotFoundError('fire_not_found')

  await prisma.semanticRuleFire.update({
    where: { id: fire.id },
    data: { verdict },
  })
  // Mesma lógica do /fp-feedback: incrementa consecutiveFp ou zera
  if (verdict === 'false_positive') {
    const updated = await prisma.semanticRule.update({
      where: { id: fire.ruleId },
      data: { consecutiveFp: { increment: 1 } },
      select: { consecutiveFp: true },
    })
    if (updated.consecutiveFp >= 3) {
      await prisma.semanticRule.update({
        where: { id: fire.ruleId },
        data: { autoPaused: true, autoPausedAt: new Date(), autoPausedReason: 'too_many_fp' },
      })
    }
  } else {
    await prisma.semanticRule.update({
      where: { id: fire.ruleId },
      data: { consecutiveFp: 0 },
    })
  }
  res.json({ ok: true, fireId: fire.id, verdict })
}))

// Serve o snapshot persistido do último disparo (crop da regra).
// Acesso: mesma regra de allowedCameraIds (cliente só vê suas câmeras).
semanticRulesRouter.get('/:id/snapshot', requires(CAPABILITIES.AI_SEMANTIC_LIST_ALERTS), asyncHandler(async (req, res) => {
  const ids = await allowedCameraIds(req.jwtPayload)
  const rule = await prisma.semanticRule.findFirst({
    where: { id: req.params.id, cameraId: { in: ids } },
    select: { lastFireSnapshot: true, lastFiredAt: true },
  })
  if (!rule) throw new NotFoundError('semantic_rule_not_found')
  if (!rule.lastFireSnapshot) {
    res.status(404).json({ error: 'no_snapshot' }); return
  }
  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('Cache-Control', 'private, max-age=30')
  if (rule.lastFiredAt) res.setHeader('X-Last-Fired-At', rule.lastFiredAt.toISOString())
  res.send(Buffer.from(rule.lastFireSnapshot))
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
