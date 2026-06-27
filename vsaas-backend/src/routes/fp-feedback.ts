/**
 * FP Feedback Routes — operador marca alertas como falso positivo / correto.
 *
 * Endereça P1 GAPs #7 (feedback UI) e #8 (auto-pause após N FP consecutivos).
 *
 * Endpoints:
 *   POST /fp-feedback                  — registra verdict
 *   GET  /fp-feedback?source=&sourceId — lista verdicts de uma origem
 *
 * Auto-pause logic (depois de salvar verdict):
 *   - source='semantic_rule': se últimos 3 são 'false_positive',
 *     marca SemanticRule.autoPaused=true.
 *   - source='lpr': informativo (não pausa por enquanto).
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError } from '../lib/errors'
import { logger } from '../lib/logger'
import { requires, publicRoute } from '../middleware/require-capability'
import { CAPABILITIES } from '../lib/capabilities'

export const fpFeedbackRouter = Router()
fpFeedbackRouter.use(requireAuth)

const FpSchema = z.object({
  source:   z.enum(['semantic_rule', 'lpr', 'specialist', 'detection']),
  sourceId: z.string().uuid(),
  cameraId: z.string().uuid(),
  verdict:  z.enum(['false_positive', 'correct', 'partial']),
  notes:    z.string().max(500).optional(),
})

const AUTO_PAUSE_FP_THRESHOLD = Number(process.env.AUTO_PAUSE_FP_THRESHOLD ?? 3)

fpFeedbackRouter.post('/',
  requires(CAPABILITIES.AI_SEMANTIC_FP_FEEDBACK),
  asyncHandler(async (req, res) => {
  const parsed = FpSchema.safeParse(req.body)
  if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)
  const p = req.jwtPayload!

  const fb = await prisma.fpFeedback.create({
    data: {
      source:   parsed.data.source,
      sourceId: parsed.data.sourceId,
      cameraId: parsed.data.cameraId,
      markedBy: p.sub,
      verdict:  parsed.data.verdict,
      notes:    parsed.data.notes ?? null,
    },
  })

  // ── Auto-pause logic para SemanticRule ──────────────────────────────────
  if (parsed.data.source === 'semantic_rule') {
    if (parsed.data.verdict === 'false_positive') {
      // Incrementa consecutiveFp + verifica threshold
      const rule = await prisma.semanticRule.update({
        where: { id: parsed.data.sourceId },
        data: { consecutiveFp: { increment: 1 } },
        select: { consecutiveFp: true },
      }).catch(() => null)
      if (rule && rule.consecutiveFp >= AUTO_PAUSE_FP_THRESHOLD) {
        await prisma.semanticRule.update({
          where: { id: parsed.data.sourceId },
          data: {
            autoPaused: true,
            autoPausedAt: new Date(),
            autoPausedReason: 'too_many_fp',
          },
        })
        logger.info({ ruleId: parsed.data.sourceId, consecutiveFp: rule.consecutiveFp }, 'semantic_rule_auto_paused')
      }
    } else if (parsed.data.verdict === 'correct') {
      // Zera contador
      await prisma.semanticRule.update({
        where: { id: parsed.data.sourceId },
        data: { consecutiveFp: 0 },
      }).catch(() => {})
    }
  }

  res.status(201).json(fb)
}))

fpFeedbackRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const source = req.query.source as string | undefined
  const sourceId = req.query.sourceId as string | undefined
  const items = await prisma.fpFeedback.findMany({
    where: {
      ...(source ? { source } : {}),
      ...(sourceId ? { sourceId } : {}),
    },
    orderBy: { ts: 'desc' },
    take: 100,
  })
  res.json({ items })
}))
