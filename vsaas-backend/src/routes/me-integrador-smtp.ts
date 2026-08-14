/**
 * me-integrador-smtp.ts — SMTP próprio por integrador (white-label capability: email).
 *
 * GET    /me/integrador/smtp          → lê config (senha mascarada)
 * PUT    /me/integrador/smtp          → salva/atualiza config
 * DELETE /me/integrador/smtp          → remove config (volta para SMTP global)
 * POST   /me/integrador/smtp/test     → envia email de teste e valida conexão
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { requireWhitelabelCapability } from '../middleware/whitelabel-capability'
import { ValidationError, ForbiddenError } from '../lib/errors'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { publicRoute } from '../middleware/require-capability'

export const meIntegradorSmtpRouter = Router()
meIntegradorSmtpRouter.use(requireAuth)
meIntegradorSmtpRouter.use(requireWhitelabelCapability('email'))

function assertIntegradorAdmin(role?: string, integradorId?: string) {
  if (!integradorId) throw new ForbiddenError('Apenas integradores podem configurar SMTP próprio')
  if (!['INTEGRADOR_ADMIN', 'SUPER_ADMIN', 'ADMIN_GLOBAL'].includes(role ?? '')) {
    throw new ForbiddenError('Apenas INTEGRADOR_ADMIN pode configurar SMTP')
  }
}

const SmtpSchema = z.object({
  host:        z.string().min(1, 'Host obrigatório'),
  port:        z.number().int().min(1).max(65535).default(587),
  secure:      z.boolean().default(false),
  user:        z.string().min(1, 'Usuário obrigatório'),
  pass:        z.string().optional(),   // vazio = não altera senha salva
  fromName:    z.string().min(1, 'Nome do remetente obrigatório'),
  fromAddress: z.string().email('Endereço de email inválido'),
})

// ── GET /me/integrador/smtp ──────────────────────────────────────────────────

meIntegradorSmtpRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload!
  assertIntegradorAdmin(role, integradorId)

  const cfg = await prisma.integradorSmtpConfig.findUnique({
    where: { integradorId: integradorId! },
  })

  if (!cfg) return res.json({ configured: false })

  res.json({
    configured:    true,
    host:          cfg.host,
    port:          cfg.port,
    secure:        cfg.secure,
    user:          cfg.user,
    pass:          '••••••',
    fromName:      cfg.fromName,
    fromAddress:   cfg.fromAddress,
    verified:      cfg.verified,
    lastTestedAt:  cfg.lastTestedAt,
    lastTestResult: cfg.lastTestResult,
  })
}))

// ── PUT /me/integrador/smtp ──────────────────────────────────────────────────

meIntegradorSmtpRouter.put('/',
  publicRoute(), // gated por requireWhitelabelCapability('email') no mount (app.ts)
  asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload!
  assertIntegradorAdmin(role, integradorId)

  const parse = SmtpSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const b = parse.data

  const existing = await prisma.integradorSmtpConfig.findUnique({
    where: { integradorId: integradorId! },
  })

  // Senha: se vier como '••••••' ou vazia, preserva a salva
  let passEnc: string
  if (!b.pass || b.pass === '••••••') {
    if (!existing) throw new ValidationError('Senha obrigatória na primeira configuração')
    passEnc = existing.passEnc
  } else {
    passEnc = encryptSecret(b.pass)
  }

  const data = {
    host:        b.host,
    port:        b.port,
    secure:      b.secure,
    user:        b.user,
    passEnc,
    fromName:    b.fromName,
    fromAddress: b.fromAddress,
    verified:    false,   // precisa testar novamente após salvar
  }

  await prisma.integradorSmtpConfig.upsert({
    where:  { integradorId: integradorId! },
    update: data,
    create: { integradorId: integradorId!, ...data },
  })

  logger.info({ integradorId, host: b.host }, 'integrador_smtp_saved')
  res.json({ ok: true })
}))

// ── DELETE /me/integrador/smtp ───────────────────────────────────────────────

meIntegradorSmtpRouter.delete('/',
  publicRoute(), // gated por requireWhitelabelCapability('email') no mount (app.ts)
  asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload!
  assertIntegradorAdmin(role, integradorId)

  await prisma.integradorSmtpConfig.deleteMany({ where: { integradorId: integradorId! } })
  logger.info({ integradorId }, 'integrador_smtp_removed')
  res.json({ ok: true })
}))

// ── POST /me/integrador/smtp/test ────────────────────────────────────────────

const TestSchema = z.object({
  to: z.string().email('Email de destino inválido'),
})

meIntegradorSmtpRouter.post('/test',
  publicRoute(), // gated por requireWhitelabelCapability('email') no mount (app.ts)
  asyncHandler(async (req, res) => {
  const { role, integradorId } = req.jwtPayload!
  assertIntegradorAdmin(role, integradorId)

  const parse = TestSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const cfg = await prisma.integradorSmtpConfig.findUnique({
    where: { integradorId: integradorId! },
  })
  if (!cfg) return res.json({ ok: false, error: 'SMTP não configurado' })

  const pass = decryptSecret(cfg.passEnc)
  if (!pass) return res.json({ ok: false, error: 'Falha ao decifrar senha SMTP' })

  let ok = false
  let error: string | undefined

  try {
    const nodemailer: any = await import('nodemailer').catch(() => null)
    if (!nodemailer) return res.json({ ok: false, error: 'nodemailer não instalado' })

    const transporter = nodemailer.createTransport({
      host:   cfg.host,
      port:   cfg.port,
      secure: cfg.secure,
      auth:   { user: cfg.user, pass },
      tls:    { rejectUnauthorized: false },
      connectionTimeout: 10_000,
    })

    await transporter.verify()
    await transporter.sendMail({
      from:    `"${cfg.fromName}" <${cfg.fromAddress}>`,
      to:      parse.data.to,
      subject: `✅ Teste SMTP — ${cfg.fromName}`,
      text:
        `Este é um email de teste do seu SMTP configurado.\n\n` +
        `Servidor: ${cfg.host}:${cfg.port}\n` +
        `Remetente: ${cfg.fromName} <${cfg.fromAddress}>\n\n` +
        `Se você recebeu este email, o SMTP está configurado corretamente.`,
    })

    ok = true
    logger.info({ integradorId, to: parse.data.to }, 'integrador_smtp_test_ok')
  } catch (err: any) {
    error = err.message ?? 'Falha SMTP'
    logger.warn({ integradorId, error }, 'integrador_smtp_test_failed')
  }

  // Persiste resultado do teste
  await prisma.integradorSmtpConfig.update({
    where: { integradorId: integradorId! },
    data: {
      verified:       ok,
      lastTestedAt:   new Date(),
      lastTestResult: ok ? null : error,
    },
  })

  res.json({ ok, ...(error ? { error } : {}) })
}))

// ── Utilitário exportado: carrega SMTP do integrador ou fallback global ──────

export async function loadSmtpForIntegrador(integradorId: string | undefined) {
  if (!integradorId) return null

  const cfg = await prisma.integradorSmtpConfig.findUnique({
    where: { integradorId },
  }).catch(() => null)
  if (!cfg) return null

  const pass = decryptSecret(cfg.passEnc)
  if (!pass) return null

  return {
    host:        cfg.host,
    port:        cfg.port,
    secure:      cfg.secure,
    user:        cfg.user,
    pass,
    fromName:    cfg.fromName,
    fromAddress: cfg.fromAddress,
  }
}
