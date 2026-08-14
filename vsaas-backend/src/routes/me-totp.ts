/**
 * Me TOTP Routes — 2FA self-service do user logado.
 *
 * Fluxo:
 *   1. POST /me/totp/setup   → gera secret + otpauthUrl (NÃO persiste ainda)
 *      Frontend renderiza QR com qrcode.react
 *   2. POST /me/totp/verify  → user digita 6 dígitos pra confirmar
 *      Persiste secret cifrado + totpEnabledAt + 10 backup codes
 *      Retorna backup codes APENAS desta vez (single-disclosure)
 *   3. POST /me/totp/disable → desabilita 2FA (precisa código atual ou senha)
 *
 * Secret é cifrado com ICV_ENCRYPTION_KEY antes de salvar.
 * Backup codes são hashed (SHA256) — single-use.
 *
 * Sprint C · docs/40-PLAN-GESTAO-USUARIOS.md
 */
import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { publicRoute } from '../middleware/require-capability'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'
import { generateTotpSecret, verifyTotpCode, generateBackupCodes } from '../lib/totp'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { logger } from '../lib/logger'

export const meTotpRouter = Router()
meTotpRouter.use(requireAuth)

// Cache em memória dos secrets pendentes (não persiste até verify).
// Key: userId, value: { secret, expiresAt }. Expira em 10min.
// Em produção multi-instance, mover pra Redis. Por enquanto Map é OK.
const pendingSecrets = new Map<string, { secret: string; otpauthUrl: string; expiresAt: number }>()
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of pendingSecrets.entries()) {
    if (v.expiresAt < now) pendingSecrets.delete(k)
  }
}, 60_000)

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

// ── POST /me/totp/setup ────────────────────────────────────────────────────
meTotpRouter.post('/setup',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const user = await prisma.user.findUnique({
      where: { id: jwt.sub },
      select: { id: true, email: true, totpEnabledAt: true },
    })
    if (!user) throw new NotFoundError('User')

    if (user.totpEnabledAt) {
      throw new ValidationError('2FA já está ativo. Desabilite antes de reconfigurar.')
    }

    const { secret, otpauthUrl } = generateTotpSecret(user.email, 'VSaaS')
    pendingSecrets.set(user.id, {
      secret,
      otpauthUrl,
      expiresAt: Date.now() + 10 * 60_000,  // 10min pra completar
    })

    // ⚠ Retorna secret raw APENAS aqui (não persistido).
    // Frontend mostra QR. Cliente verifica → persiste cifrado.
    res.json({ secret, otpauthUrl, expiresInMinutes: 10 })
  })
)

// ── POST /me/totp/verify ───────────────────────────────────────────────────
const VerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Código deve ter 6 dígitos'),
})

meTotpRouter.post('/verify',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const parse = VerifySchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
    const { code } = parse.data

    const pending = pendingSecrets.get(jwt.sub)
    if (!pending) throw new ValidationError('Setup expirou ou não iniciado. Comece novamente.')
    if (pending.expiresAt < Date.now()) {
      pendingSecrets.delete(jwt.sub)
      throw new ValidationError('Setup expirou. Comece novamente.')
    }

    if (!verifyTotpCode(pending.secret, code)) {
      throw new ValidationError('Código inválido. Verifique se o relógio do dispositivo está correto.')
    }

    // Gera backup codes (single-disclosure) + hash pra DB
    const backupCodes = generateBackupCodes(10)
    const backupHashes = backupCodes.map(sha256hex)

    // Cifra o secret antes de persistir
    const encryptedSecret = encryptSecret(pending.secret)

    await prisma.user.update({
      where: { id: jwt.sub },
      data: {
        totpSecret: encryptedSecret,
        totpEnabledAt: new Date(),
        totpBackupCodesHash: backupHashes,
        // P0 fix · user cumpriu o requisito de 2FA do convite, libera o resto.
        requireMfaSetup: false,
      },
    })

    pendingSecrets.delete(jwt.sub)

    await prisma.auditLog.create({
      data: {
        action: 'USER_TOTP_ENABLED',
        resource: 'User',
        resourceId: jwt.sub,
        userId: jwt.sub,
        clienteFinalId: jwt.clienteFinalId ?? null,
        integradorId: jwt.integradorId ?? null,
      },
    }).catch(err => logger.warn({ err, userId: jwt.sub }, 'totp_enable_audit_failed'))

    logger.info({ userId: jwt.sub }, 'totp_enabled')

    // ⚠ Backup codes mostrados UMA vez. Cliente deve salvar agora.
    res.json({
      success: true,
      backupCodes,
      warning: 'Salve estes códigos em local seguro. Eles serão mostrados apenas agora. Cada um pode ser usado uma única vez para recuperar acesso.',
    })
  })
)

// ── POST /me/totp/disable ──────────────────────────────────────────────────
const DisableSchema = z.object({
  code:     z.string().regex(/^\d{6}$/).optional(),
  password: z.string().min(1).optional(),
}).refine(d => !!d.code || !!d.password, {
  message: 'Informe código TOTP atual OU senha do user',
})

meTotpRouter.post('/disable',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const parse = DisableSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
    const { code, password } = parse.data

    const user = await prisma.user.findUnique({
      where: { id: jwt.sub },
      select: { id: true, passwordHash: true, totpSecret: true, totpEnabledAt: true },
    })
    if (!user) throw new NotFoundError('User')
    if (!user.totpEnabledAt) throw new ValidationError('2FA não está ativo')

    // Valida: TOTP atual OU senha
    let authorized = false
    if (code && user.totpSecret) {
      const secret = decryptSecret(user.totpSecret)
      if (secret) authorized = verifyTotpCode(secret, code)
    }
    if (!authorized && password) {
      authorized = await bcrypt.compare(password, user.passwordHash)
    }
    if (!authorized) throw new ForbiddenError('Código TOTP ou senha incorretos')

    await prisma.user.update({
      where: { id: jwt.sub },
      data: {
        totpSecret: null,
        totpEnabledAt: null,
        totpBackupCodesHash: [],
      },
    })

    await prisma.auditLog.create({
      data: {
        action: 'USER_TOTP_DISABLED',
        resource: 'User',
        resourceId: jwt.sub,
        userId: jwt.sub,
        clienteFinalId: jwt.clienteFinalId ?? null,
        integradorId: jwt.integradorId ?? null,
      },
    }).catch(err => logger.warn({ err, userId: jwt.sub }, 'totp_disable_audit_failed'))

    logger.info({ userId: jwt.sub }, 'totp_disabled')
    res.json({ success: true })
  })
)

// ── POST /me/totp/regenerate-backup-codes ─────────────────────────────────
// User pode gerar novos backup codes (invalida os antigos).
meTotpRouter.post('/regenerate-backup-codes',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const parse = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(req.body)
    if (!parse.success) throw new ValidationError('Informe código TOTP atual pra gerar novos backup codes')

    const user = await prisma.user.findUnique({
      where: { id: jwt.sub },
      select: { totpSecret: true, totpEnabledAt: true },
    })
    if (!user?.totpEnabledAt || !user.totpSecret) throw new ValidationError('2FA não está ativo')

    const secret = decryptSecret(user.totpSecret)
    if (!secret || !verifyTotpCode(secret, parse.data.code)) throw new ForbiddenError('Código TOTP incorreto')

    const newCodes = generateBackupCodes(10)
    const hashes = newCodes.map(sha256hex)
    await prisma.user.update({
      where: { id: jwt.sub },
      data: { totpBackupCodesHash: hashes },
    })

    res.json({ backupCodes: newCodes, warning: 'Códigos anteriores foram invalidados.' })
  })
)

// ── GET /me/totp/status ────────────────────────────────────────────────────
meTotpRouter.get('/status',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const user = await prisma.user.findUnique({
      where: { id: jwt.sub },
      select: { totpEnabledAt: true, totpBackupCodesHash: true },
    })
    res.json({
      enabled: !!user?.totpEnabledAt,
      enabledAt: user?.totpEnabledAt ?? null,
      backupCodesRemaining: user?.totpBackupCodesHash.length ?? 0,
    })
  })
)
