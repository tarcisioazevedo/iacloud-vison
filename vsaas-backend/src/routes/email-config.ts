/**
 * email-config.ts — Configuração de e-mail transacional (SMTP + templates).
 *
 * Armazena no SystemConfig (DB key/value).
 * Chaves usadas:
 *   - "smtp_config"         → JSON com host, port, secure, user, pass, fromName, fromAddress
 *   - "email_tpl_<name>"    → JSON com subject e body do template
 */
import { Router } from 'express'
import { z }      from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, UnauthorizedError } from '../lib/errors'
import { auditUpdate } from '../lib/audit-helpers'
import {
  SmtpConfig,
  EmailTemplate,
  DEFAULT_TEMPLATES,
  loadSmtp,
} from '../lib/smtp'

export const emailConfigRouter = Router()

// Aplica auth em todas as rotas deste router
emailConfigRouter.use(requireAuth)

// Helper: garante que só SUPER_ADMIN acessa
function assertSuperAdmin(role?: string) {
  if (role !== 'SUPER_ADMIN') throw new UnauthorizedError('Apenas SUPER_ADMIN pode gerenciar configurações de e-mail')
}

// ── GET /config/email/smtp ────────────────────────────────────────────────────

emailConfigRouter.get('/smtp', asyncHandler(async (req, res) => {
  assertSuperAdmin(req.jwtPayload?.role)
  const cfg = await loadSmtp()
  res.json({
    host:        cfg.host,
    port:        cfg.port,
    secure:      cfg.secure,
    user:        cfg.user,
    pass:        cfg.pass ? '••••••' : '',
    fromName:    cfg.fromName,
    fromAddress: cfg.fromAddress,
    configured:  !!(cfg.host && cfg.user),
  })
}))

// ── PUT /config/email/smtp ────────────────────────────────────────────────────

const SmtpSchema = z.object({
  host:        z.string().min(1),
  port:        z.number().int().min(1).max(65535),
  secure:      z.boolean(),
  user:        z.string().min(1),
  pass:        z.string().optional(),   // vazio = não altera senha salva
  fromName:    z.string().min(1),
  fromAddress: z.string().email(),
})

emailConfigRouter.put('/smtp', asyncHandler(async (req, res) => {
  assertSuperAdmin(req.jwtPayload?.role)
  const parse = SmtpSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const b = parse.data

  // Onda 12.4 — captura ANTES para diff (vetor de phishing crítico)
  const before = await loadSmtp()

  // Se pass vier como '••••••' ou vazio, preserva a senha atual
  let passToSave = b.pass ?? ''
  if (!passToSave || passToSave === '••••••') {
    passToSave = before.pass
  }

  const cfg: SmtpConfig = { ...b, pass: passToSave }
  await prisma.systemConfig.upsert({
    where:  { key: 'smtp_config' },
    update: { value: JSON.stringify(cfg) },
    create: { key: 'smtp_config', value: JSON.stringify(cfg) },
  })

  // Onda 12.4 — SMTP_CONFIG_CHANGED com diff before/after.
  // Helper redacta automaticamente `pass` no metadata.
  await auditUpdate(prisma, {
    action:     'SMTP_CONFIG_CHANGED',
    resource:   'SmtpConfig',
    resourceId: 'smtp_config',
    before, after: cfg,
    metadata:   { passwordRotated: !!b.pass && b.pass !== '••••••' },
    req,
  })

  res.json({ ok: true })
}))

// ── POST /config/email/smtp/test ──────────────────────────────────────────────

const TestSchema = z.object({
  to: z.string().email(),
})

emailConfigRouter.post('/smtp/test', asyncHandler(async (req, res) => {
  assertSuperAdmin(req.jwtPayload?.role)
  const parse = TestSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const cfg = await loadSmtp()
  if (!cfg.host || !cfg.user) {
    return res.json({ ok: false, error: 'SMTP não configurado' })
  }

  try {
    const nodemailer: any = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host:   cfg.host,
      port:   cfg.port,
      secure: cfg.secure,
      auth:   { user: cfg.user, pass: cfg.pass },
      tls:    { rejectUnauthorized: false },
      connectionTimeout: 10_000,
    })

    // Verifica conexão
    await transporter.verify()

    // Envia e-mail de teste
    await transporter.sendMail({
      from:    `"${cfg.fromName}" <${cfg.fromAddress}>`,
      to:      parse.data.to,
      subject: '✅ Teste de SMTP — VSaaS',
      text:
        'Este é um e-mail de teste do VSaaS.\n\n' +
        `Servidor: ${cfg.host}:${cfg.port}\n` +
        `Remetente: ${cfg.fromName} <${cfg.fromAddress}>\n\n` +
        'Se você recebeu este e-mail, o SMTP está configurado corretamente.',
    })

    logger.info({ to: parse.data.to, host: cfg.host }, 'smtp_test_ok')
    res.json({ ok: true })
  } catch (err: any) {
    logger.warn({ err: err.message }, 'smtp_test_failed')
    res.json({ ok: false, error: err.message ?? 'Falha SMTP' })
  }
}))

// ── GET /config/email/templates ───────────────────────────────────────────────

emailConfigRouter.get('/templates', asyncHandler(async (req, res) => {
  assertSuperAdmin(req.jwtPayload?.role)
  const rows = await prisma.systemConfig.findMany({
    where: { key: { startsWith: 'email_tpl_' } },
  })
  const overrides: Record<string, Partial<EmailTemplate>> = {}
  for (const row of rows) {
    try { overrides[row.key.replace('email_tpl_', '')] = JSON.parse(row.value) } catch { /* skip */ }
  }

  const templates = DEFAULT_TEMPLATES.map(t => ({
    ...t,
    ...(overrides[t.name] ?? {}),
  }))

  res.json({ templates })
}))

// ── PUT /config/email/templates/:name ────────────────────────────────────────

const TemplateSchema = z.object({
  subject: z.string().min(1).max(200),
  body:    z.string().min(1).max(10_000),
})

emailConfigRouter.put('/templates/:name', asyncHandler(async (req, res) => {
  assertSuperAdmin(req.jwtPayload?.role)
  const { name } = req.params
  const validNames = DEFAULT_TEMPLATES.map(t => t.name)
  if (!validNames.includes(name)) throw new ValidationError(`Template desconhecido: ${name}`)

  const parse = TemplateSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  await prisma.systemConfig.upsert({
    where:  { key: `email_tpl_${name}` },
    update: { value: JSON.stringify(parse.data) },
    create: { key: `email_tpl_${name}`, value: JSON.stringify(parse.data) },
  })

  res.json({ ok: true })
}))

// ── DELETE /config/email/templates/:name (reset to default) ──────────────────

emailConfigRouter.delete('/templates/:name', asyncHandler(async (req, res) => {
  assertSuperAdmin(req.jwtPayload?.role)
  const { name } = req.params
  await prisma.systemConfig.deleteMany({ where: { key: `email_tpl_${name}` } })
  res.json({ ok: true })
}))
