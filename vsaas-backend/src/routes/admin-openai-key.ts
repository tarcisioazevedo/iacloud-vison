/**
 * admin-openai-key.ts — gerencia a OpenAI API key do POOL (fabricante).
 *
 * Espelha admin-gemini-key.ts — segundo provedor de IA disponível pro
 * SUPER_ADMIN configurar, independente do Gemini (útil como alternativa
 * quando a key do Gemini está inválida/indisponível).
 *
 * 3 endpoints (SUPER_ADMIN only):
 *   GET    /admin/openai-key         → status atual (source + masked)
 *   PUT    /admin/openai-key         → grava nova key (criptografada AES-256-GCM)
 *   DELETE /admin/openai-key         → remove do SystemConfig (volta pro env/docker)
 *   POST   /admin/openai-key/test    → valida key contra OpenAI API
 *
 * Resolução de chave:
 *   1. SystemConfig.key='ai.openai_api_key_enc' (criptografada)
 *   2. process.env.OPENAI_API_KEY (vem de /run/secrets/openai_api_key no Docker)
 *
 * Nota: isto só disponibiliza/gerencia a key. Nenhuma função do genai.service
 * (describe/chat/compare/text) foi religada pra usar OpenAI — hoje só o
 * Gemini é consumido nos fluxos de IA existentes.
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

export const adminOpenaiKeyRouter = Router()
adminOpenaiKeyRouter.use(requireAuth)
adminOpenaiKeyRouter.use(requireSudo)

const SYSTEM_KEY = 'ai.openai_api_key_enc'

function maskKey(key: string | null | undefined): string | null {
  if (!key) return null
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 6) + '••••' + key.slice(-4)
}

// ── GET /admin/openai-key ───────────────────────────────────────────────
adminOpenaiKeyRouter.get('/',
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

  const envKey = process.env.OPENAI_API_KEY ?? null
  res.json({
    source: envKey ? 'env-docker-secret' : 'none',
    masked: maskKey(envKey),
    hasKey: !!envKey,
    updatedAt: null,
  })
}))

// ── PUT /admin/openai-key — salva nova ──────────────────────────────────
adminOpenaiKeyRouter.put('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const parsed = z.object({ apiKey: z.string().min(20).max(200) }).safeParse(req.body)
  if (!parsed.success) throw new ValidationError('apiKey inválida')
  if (!parsed.data.apiKey.startsWith('sk-')) {
    throw new ValidationError('apiKey não parece ser uma OpenAI API key (esperado prefixo sk-...)')
  }

  const sealed = encryptSecret(parsed.data.apiKey)
  const row = await prisma.systemConfig.upsert({
    where:  { key: SYSTEM_KEY },
    create: { key: SYSTEM_KEY, value: sealed },
    update: { value: sealed, updatedAt: new Date() },
  })

  logger.info({ keyPreview: maskKey(parsed.data.apiKey), userId: req.jwtPayload?.sub }, 'admin_openai_key_updated')
  res.json({ ok: true, source: 'systemconfig', masked: maskKey(parsed.data.apiKey), updatedAt: row.updatedAt })
}))

// ── DELETE /admin/openai-key — volta pro env/docker secret ──────────────
adminOpenaiKeyRouter.delete('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  await prisma.systemConfig.delete({ where: { key: SYSTEM_KEY } }).catch(() => {})
  logger.info({ userId: req.jwtPayload?.sub }, 'admin_openai_key_removed')
  res.json({ ok: true, source: process.env.OPENAI_API_KEY ? 'env-docker-secret' : 'none' })
}))

// ── POST /admin/openai-key/test — valida key ────────────────────────────
adminOpenaiKeyRouter.post('/test',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const candidate = (req.body?.apiKey as string | undefined)?.trim()
  let apiKey: string | null = candidate ?? null

  if (!apiKey) {
    // Sem candidate: testa a key atual
    const row = await prisma.systemConfig.findUnique({ where: { key: SYSTEM_KEY } })
    apiKey = row?.value ? decryptSecret(row.value) : (process.env.OPENAI_API_KEY ?? null)
  }
  if (!apiKey) {
    res.status(400).json({ ok: false, error: 'Nenhuma key configurada para testar' })
    return
  }

  const t0 = Date.now()
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Responda apenas: OK' }],
        max_tokens: 10,
      }),
    })
    const elapsed = Date.now() - t0
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      res.json({ ok: false, latencyMs: elapsed, error: `HTTP ${r.status}`, detail: text.slice(0, 300) })
      return
    }
    const data = await r.json().catch(() => null) as any
    const reply = data?.choices?.[0]?.message?.content?.trim() ?? ''
    res.json({ ok: true, latencyMs: elapsed, reply, model: 'gpt-4o-mini' })
  } catch (err: any) {
    res.json({ ok: false, latencyMs: Date.now() - t0, error: err.message ?? 'network_error' })
  }
}))
