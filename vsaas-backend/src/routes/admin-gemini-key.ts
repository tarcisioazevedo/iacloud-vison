/**
 * admin-gemini-key.ts — gerencia a Gemini API key do POOL (fabricante).
 *
 * 3 endpoints (SUPER_ADMIN only):
 *   GET    /admin/gemini-key         → status atual (source + masked)
 *   PUT    /admin/gemini-key         → grava nova key (criptografada AES-256-GCM)
 *   DELETE /admin/gemini-key         → remove do SystemConfig (volta pro env/docker)
 *   POST   /admin/gemini-key/test    → valida key contra Gemini API
 *
 * Resolução de chave (ordem usada pelo aiGatingService.loadFabricanteKey):
 *   1. SystemConfig.key='ai.gemini_api_key_enc' (criptografada)
 *   2. process.env.GEMINI_API_KEY (vem de /run/secrets/gemini_api_key no Docker)
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth, requireSudo } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError } from '../lib/errors'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { publicRoute } from '../middleware/require-capability'

export const adminGeminiKeyRouter = Router()
adminGeminiKeyRouter.use(requireAuth)
adminGeminiKeyRouter.use(requireSudo)

const SYSTEM_KEY = 'ai.gemini_api_key_enc'

function maskKey(key: string | null | undefined): string | null {
  if (!key) return null
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 6) + '••••' + key.slice(-4)
}

// ── GET /admin/gemini-key ───────────────────────────────────────────────
adminGeminiKeyRouter.get('/',
  publicRoute(),
  asyncHandler(async (_req, res) => {
  const row = await prisma.systemConfig.findUnique({ where: { key: SYSTEM_KEY } })

  if (row?.value) {
    const plain = decryptSecret(row.value)
    res.json({
      source: 'systemconfig',
      masked: maskKey(plain),
      hasKey: !!plain,
      updatedAt: row.updatedAt,
    })
    return
  }

  const envKey = process.env.GEMINI_API_KEY ?? null
  res.json({
    source: envKey ? 'env-docker-secret' : 'none',
    masked: maskKey(envKey),
    hasKey: !!envKey,
    updatedAt: null,
  })
}))

// ── PUT /admin/gemini-key — salva nova ──────────────────────────────────
adminGeminiKeyRouter.put('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const parsed = z.object({ apiKey: z.string().min(20).max(200) }).safeParse(req.body)
  if (!parsed.success) throw new ValidationError('apiKey inválida')
  if (!parsed.data.apiKey.startsWith('AIza')) {
    throw new ValidationError('apiKey não parece ser uma Gemini API key (esperado prefixo AIza...)')
  }

  const sealed = encryptSecret(parsed.data.apiKey)
  const row = await prisma.systemConfig.upsert({
    where:  { key: SYSTEM_KEY },
    create: { key: SYSTEM_KEY, value: sealed },
    update: { value: sealed, updatedAt: new Date() },
  })

  logger.info({ keyPreview: maskKey(parsed.data.apiKey), userId: req.jwtPayload?.sub }, 'admin_gemini_key_updated')
  res.json({ ok: true, source: 'systemconfig', masked: maskKey(parsed.data.apiKey), updatedAt: row.updatedAt })
}))

// ── DELETE /admin/gemini-key — volta pro env/docker secret ──────────────
adminGeminiKeyRouter.delete('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  await prisma.systemConfig.delete({ where: { key: SYSTEM_KEY } }).catch(() => {})
  logger.info({ userId: req.jwtPayload?.sub }, 'admin_gemini_key_removed')
  res.json({ ok: true, source: process.env.GEMINI_API_KEY ? 'env-docker-secret' : 'none' })
}))

// ── POST /admin/gemini-key/test — valida key ────────────────────────────
adminGeminiKeyRouter.post('/test',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const candidate = (req.body?.apiKey as string | undefined)?.trim()
  let apiKey: string | null = candidate ?? null

  if (!apiKey) {
    // Sem candidate: testa a key atual
    const row = await prisma.systemConfig.findUnique({ where: { key: SYSTEM_KEY } })
    apiKey = row?.value ? decryptSecret(row.value) : (process.env.GEMINI_API_KEY ?? null)
  }
  if (!apiKey) {
    res.status(400).json({ ok: false, error: 'Nenhuma key configurada para testar' })
    return
  }

  const t0 = Date.now()
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Responda apenas: OK' }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    })
    const elapsed = Date.now() - t0
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      res.json({ ok: false, latencyMs: elapsed, error: `HTTP ${r.status}`, detail: text.slice(0, 300) })
      return
    }
    const data = await r.json().catch(() => null) as any
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    res.json({ ok: true, latencyMs: elapsed, reply, model: 'gemini-2.5-flash' })
  } catch (err: any) {
    res.json({ ok: false, latencyMs: Date.now() - t0, error: err.message ?? 'network_error' })
  }
}))
