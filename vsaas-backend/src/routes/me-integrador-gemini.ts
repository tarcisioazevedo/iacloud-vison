/**
 * me-integrador-gemini.ts — config Gemini BYOK por integrador.
 *
 * Modelo 3-tier de pagamento Gemini (audit P0 #12):
 *   - pool     : usa chave do Fabricante (default) — fabricante paga
 *   - self     : integrador usa chave própria — paga direto Google
 *   - off      : recusa qualquer chamada Gemini (não recomendado)
 *
 * GET    /me/integrador/gemini          → lê config (key mascarada)
 * PUT    /me/integrador/gemini          → atualiza modo + key (encrypta)
 * DELETE /me/integrador/gemini          → volta para 'pool'
 * POST   /me/integrador/gemini/test     → faz 1 call de teste e mede latência
 * GET    /me/integrador/gemini/usage    → tokens + chamadas + custo no mês
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, ForbiddenError } from '../lib/errors'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { resetByokFailures } from '../services/ai-gating.service'

export const meIntegradorGeminiRouter = Router()
meIntegradorGeminiRouter.use(requireAuth)

function assertIntegradorAdmin(role?: string, integradorId?: string) {
  if (!integradorId) throw new ForbiddenError('Apenas integradores podem configurar Gemini BYOK')
  if (!['INTEGRADOR_ADMIN', 'SUPER_ADMIN', 'ADMIN_GLOBAL'].includes(role ?? '')) {
    throw new ForbiddenError('Apenas INTEGRADOR_ADMIN pode configurar Gemini BYOK')
  }
}

function maskKey(key: string | null): string | null {
  if (!key) return null
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••' + key.slice(-4)
}

// ── GET ──────────────────────────────────────────────────────────────────────
meIntegradorGeminiRouter.get('/', asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload!
  assertIntegradorAdmin(role, integradorId)

  const integ = await prisma.integrador.findUnique({
    where: { id: integradorId! },
    select: {
      geminiByokMode: true,
      geminiApiKeyEnc: true,
      geminiCallCapDaily: true,
    },
  })

  const plainKey = decryptSecret(integ?.geminiApiKeyEnc ?? null)
  res.json({
    mode: integ?.geminiByokMode ?? 'pool',
    hasKey: !!plainKey,
    keyMasked: maskKey(plainKey),
    callCapDaily: integ?.geminiCallCapDaily ?? 15000,
  })
}))

// ── PUT (set mode + key) ─────────────────────────────────────────────────────
const PutSchema = z.object({
  mode:   z.enum(['pool', 'self', 'off']),
  apiKey: z.string().optional(),  // vazio = não altera key salva
})

meIntegradorGeminiRouter.put('/', asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload!
  assertIntegradorAdmin(role, integradorId)

  const parsed = PutSchema.safeParse(req.body)
  if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message)

  const { mode, apiKey } = parsed.data

  if (mode === 'self' && !apiKey) {
    // Se está mudando pra 'self', exige key (a menos que já tenha uma salva)
    const existing = await prisma.integrador.findUnique({
      where: { id: integradorId! },
      select: { geminiApiKeyEnc: true },
    })
    if (!existing?.geminiApiKeyEnc) {
      throw new ValidationError('apiKey obrigatório ao escolher modo self')
    }
  }

  const data: any = { geminiByokMode: mode }
  if (apiKey && apiKey.length > 0) {
    if (!apiKey.startsWith('AIza')) {
      throw new ValidationError('apiKey não parece ser uma Gemini API key (esperado prefixo AIza...)')
    }
    data.geminiApiKeyEnc = encryptSecret(apiKey)
    // Reset contador de falhas BYOK ao atualizar key
    resetByokFailures(integradorId!)
  }

  await prisma.integrador.update({
    where: { id: integradorId! },
    data,
  })

  logger.info({ integradorId, mode }, 'integrador_gemini_config_updated')
  res.json({ ok: true, mode })
}))

// ── DELETE (volta pra pool) ──────────────────────────────────────────────────
meIntegradorGeminiRouter.delete('/', asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload!
  assertIntegradorAdmin(role, integradorId)

  await prisma.integrador.update({
    where: { id: integradorId! },
    data: { geminiByokMode: 'pool', geminiApiKeyEnc: null },
  })
  resetByokFailures(integradorId!)
  res.status(204).end()
}))

// ── POST /test (valida key fazendo 1 call leve) ──────────────────────────────
meIntegradorGeminiRouter.post('/test', asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload!
  assertIntegradorAdmin(role, integradorId)

  const candidate = (req.body?.apiKey as string | undefined)?.trim()
  let apiKey: string | null = candidate ?? null

  if (!apiKey) {
    const integ = await prisma.integrador.findUnique({
      where: { id: integradorId! },
      select: { geminiApiKeyEnc: true },
    })
    apiKey = decryptSecret(integ?.geminiApiKeyEnc ?? null)
  }

  if (!apiKey) {
    throw new ValidationError('Nenhuma chave configurada para testar')
  }

  const t0 = Date.now()
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Responda apenas: OK' }] }],
        generationConfig: { maxOutputTokens: 5 },
      }),
    })
    const elapsed = Date.now() - t0
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return res.status(200).json({
        ok: false,
        latencyMs: elapsed,
        error: `HTTP ${resp.status}`,
        detail: text.slice(0, 300),
      })
    }
    const data = await resp.json().catch(() => null) as any
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    res.json({
      ok: true,
      latencyMs: elapsed,
      reply,
      model: 'gemini-1.5-flash',
    })
  } catch (err: any) {
    const elapsed = Date.now() - t0
    res.json({ ok: false, latencyMs: elapsed, error: err.message ?? 'network_error' })
  }
}))

// ── GET /usage (resumo mensal — agrega de GeminiCallLog) ─────────────────────
meIntegradorGeminiRouter.get('/usage', asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload!
  assertIntegradorAdmin(role, integradorId)

  const from = new Date()
  from.setDate(1)
  from.setHours(0, 0, 0, 0)

  // Agrega chamadas onde o pagador é este integrador
  const rows = await prisma.geminiCallLog.groupBy({
    by: ['paidBy', 'outcome', 'feature'],
    where: {
      payerId: integradorId!,
      ts: { gte: from },
    },
    _count: { _all: true },
    _sum: { tokensIn: true, tokensOut: true },
  })

  let totalCalls = 0
  let totalTokensIn = 0
  let totalTokensOut = 0
  let successCalls = 0
  const perFeature: Record<string, { calls: number; tokensIn: number; tokensOut: number }> = {}

  for (const r of rows) {
    totalCalls += r._count._all
    totalTokensIn += r._sum.tokensIn ?? 0
    totalTokensOut += r._sum.tokensOut ?? 0
    if (r.outcome === 'success') successCalls += r._count._all
    const k = r.feature
    if (!perFeature[k]) perFeature[k] = { calls: 0, tokensIn: 0, tokensOut: 0 }
    perFeature[k].calls += r._count._all
    perFeature[k].tokensIn += r._sum.tokensIn ?? 0
    perFeature[k].tokensOut += r._sum.tokensOut ?? 0
  }

  // Custo estimado Gemini Flash 1.5: $0.075/1M in, $0.30/1M out (USD)
  const costInUsd  = (totalTokensIn  / 1_000_000) * 0.075
  const costOutUsd = (totalTokensOut / 1_000_000) * 0.30
  const totalCostUsd = costInUsd + costOutUsd
  const totalCostBrl = totalCostUsd * 5.0  // approx FX

  res.json({
    periodFrom: from.toISOString(),
    totalCalls,
    successCalls,
    totalTokensIn,
    totalTokensOut,
    estCostUsd: Number(totalCostUsd.toFixed(4)),
    estCostBrl: Number(totalCostBrl.toFixed(2)),
    perFeature,
  })
}))
