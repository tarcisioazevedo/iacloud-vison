import { Router } from 'express'
import { createHash, randomUUID } from 'crypto'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { UnauthorizedError, ValidationError, NotFoundError, ForbiddenError } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { auditAction } from '../lib/audit-helpers'
import { publicRoute } from '../middleware/require-capability'
import {
  validatePasswordAgainstPolicy,
  applyPasswordChange,
  resolvePolicy,
} from '../lib/password-policy'
import { verifyTotpCode } from '../lib/totp'
import { decryptSecret } from '../lib/crypto'
import { logger } from '../lib/logger'

export const authRouter = Router()

// Dummy hash usado quando o email não corresponde a nenhum actor. Mantemos
// o tempo de `bcrypt.compare` constante para não vazar enumeração de usuário
// (login responde com a mesma latência para "user não existe" vs "senha
// errada"). Computado uma vez em startup; o resultado é descartado.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password', 10)

// Brute-force guard em /login: 5 falhas por janela (default 5min) por
// IP+email. Sucesso (2xx) não conta — só penaliza tentativa inválida.
const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 5 * 60_000),
  max:      Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 5),
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const rawIp = req.ip ?? 'unknown'
    // Para IPv6, agrupa em /64 (4 primeiros hextets) para não escapar do
    // limit via prefixo rotativo do mesmo cliente.
    const ip = rawIp.includes(':')
      ? rawIp.split(':').slice(0, 4).join(':')
      : rawIp
    const email = typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : 'no-email'
    return `login:${ip}:${email}`
  },
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
})

// Brute-force guard em /login-mfa-verify: 10 falhas por janela (5min) por
// IP+challengeToken. TOTP é só 6 dígitos (1M combinações) — sem isto o
// desafio (válido por 5min) seria forçável. Sucesso não conta.
// Hash do challengeToken vira a chave para não estourar a memória do store.
const mfaVerifyLimiter = rateLimit({
  windowMs: Number(process.env.MFA_RATE_LIMIT_WINDOW_MS ?? 5 * 60_000),
  max:      Number(process.env.MFA_RATE_LIMIT_MAX ?? 10),
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const rawIp = req.ip ?? 'unknown'
    const ip = rawIp.includes(':')
      ? rawIp.split(':').slice(0, 4).join(':')
      : rawIp
    const ch = typeof req.body?.challengeToken === 'string'
      ? createHash('sha256').update(req.body.challengeToken).digest('hex').slice(0, 16)
      : 'no-challenge'
    return `mfa-verify:${ip}:${ch}`
  },
  message: { error: 'Muitas tentativas. Refaça o login.' },
})

// ───────────────── helpers ──────────────────────────────────────────────

async function resolveActor(payload: { sub: string; role: string }) {
  if (payload.role === 'SUPER_ADMIN') {
    const sa = await prisma.superAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, createdAt: true },
    })
    if (!sa) return null
    return { kind: 'SUPER_ADMIN' as const, ...sa, integrador: null, clienteFinal: null }
  }

  if (payload.role === 'INTEGRADOR_ADMIN') {
    const integ = await prisma.integrador.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, name: true, email: true, createdAt: true,
        tradeName: true, cnpj: true, phone: true, website: true,
      },
    })
    if (!integ) return null
    return { kind: 'INTEGRADOR' as const, ...integ, integrador: integ, clienteFinal: null }
  }

  // User (pode ter role de Integrador Técnico ou qualquer papel de ClienteFinal)
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: {
      integrador:   { select: { id: true, name: true, tradeName: true } },
      clienteFinal: { select: { id: true, name: true, tradeName: true } },
    },
  })
  if (!user) return null
  return {
    kind: 'USER' as const,
    id:   user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    role: user.role,
    integrador:   user.integrador,
    clienteFinal: user.clienteFinal,
    // Flags de UX/enforcement consumidas pelo frontend:
    mobileAppAllowed: user.mobileAppAllowed,
    requireMfaSetup:  user.requireMfaSetup,
    totpEnabledAt:    user.totpEnabledAt,
  }
}

async function updatePassword(payload: { sub: string; role: string }, newHash: string) {
  if (payload.role === 'SUPER_ADMIN') {
    await prisma.superAdmin.update({ where: { id: payload.sub }, data: { passwordHash: newHash } })
    return
  }
  if (payload.role === 'INTEGRADOR_ADMIN') {
    await prisma.integrador.update({ where: { id: payload.sub }, data: { passwordHash: newHash } })
    return
  }
  // Reset mustChangePassword on successful password change (Lote 2 / Lote 5)
  await prisma.user.update({
    where: { id: payload.sub },
    data: { passwordHash: newHash, mustChangePassword: false },
  })
}

async function getCurrentHash(payload: { sub: string; role: string }): Promise<string | null> {
  if (payload.role === 'SUPER_ADMIN') {
    const r = await prisma.superAdmin.findUnique({ where: { id: payload.sub }, select: { passwordHash: true } })
    return r?.passwordHash ?? null
  }
  if (payload.role === 'INTEGRADOR_ADMIN') {
    const r = await prisma.integrador.findUnique({ where: { id: payload.sub }, select: { passwordHash: true } })
    return r?.passwordHash ?? null
  }
  const r = await prisma.user.findUnique({ where: { id: payload.sub }, select: { passwordHash: true } })
  return r?.passwordHash ?? null
}

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
})

authRouter.post('/login',
  publicRoute(),
  loginLimiter, asyncHandler(async (req, res) => {
  const parse = LoginSchema.safeParse(req.body)
  // Mesma mensagem para email/senha inválidos — evita user enumeration.
  if (!parse.success) throw new UnauthorizedError('Email ou senha inválidos')

  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET not configured')

  const { email, password } = parse.data

  type Actor = {
    id: string
    passwordHash: string
    role: string
    integradorId?: string
    clienteFinalId?: string
    mustChangePassword?: boolean
    /** Só populado pra User (User-table); SuperAdmin/Integrador ignoram lockout/policy */
    isUser?: boolean
    failedLoginAttempts?: number
    lockedUntil?: Date | null
    passwordExpiresAt?: Date | null
    totpEnabledAt?: Date | null
    totpSecret?: string | null
    requireMfaSetup?: boolean
  }

  let actor: Actor | null = null

  const superAdmin = await prisma.superAdmin.findUnique({ where: { email } })
  if (superAdmin) {
    actor = { id: superAdmin.id, passwordHash: superAdmin.passwordHash, role: 'SUPER_ADMIN' }
  }

  if (!actor) {
    const integrador = await prisma.integrador.findUnique({ where: { email } })
    if (integrador) {
      actor = {
        id: integrador.id,
        passwordHash: integrador.passwordHash,
        role: 'INTEGRADOR_ADMIN',
        integradorId: integrador.id,
      }
    }
  }

  if (!actor) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (user) {
      actor = {
        id:                  user.id,
        passwordHash:        user.passwordHash,
        role:                user.role,
        integradorId:        user.integradorId ?? undefined,
        clienteFinalId:      user.clienteFinalId ?? undefined,
        mustChangePassword:  user.mustChangePassword,
        isUser:              true,
        failedLoginAttempts: user.failedLoginAttempts,
        lockedUntil:         user.lockedUntil,
        passwordExpiresAt:   user.passwordExpiresAt,
        totpEnabledAt:       user.totpEnabledAt,
        totpSecret:          user.totpSecret,
        requireMfaSetup:     user.requireMfaSetup,
      }
    }
  }

  // ── Sprint B · Lockout check ANTES da senha ─────────────────────────────────
  // Antes de validar a senha, checa se a conta está bloqueada por excesso de
  // tentativas falhadas. Retorna 423 Locked com unlockAt — frontend traduz.
  // Aplica só pra User (SuperAdmin/Integrador não têm lockout — usam loginLimiter).
  if (actor?.isUser && actor.lockedUntil && actor.lockedUntil > new Date()) {
    const unlockAt = actor.lockedUntil
    await auditAction(prisma, {
      action:     'LOGIN_FAILED',
      resource:   'User',
      resourceId: actor.id,
      result:     'BLOCKED',
      metadata:   { attemptedEmail: email, reason: 'account_locked', unlockAt: unlockAt.toISOString() },
      req,
    })
    res.status(423).json({
      error:    'ACCOUNT_LOCKED',
      message:  `Conta bloqueada por excesso de tentativas. Tente novamente após ${unlockAt.toISOString()}`,
      unlockAt: unlockAt.toISOString(),
    })
    return
  }

  // ── Validação de senha ──────────────────────────────────────────────────────
  // Sempre roda bcrypt.compare (mesmo se actor=null) contra dummy hash para
  // manter latência constante (proteção contra user-enumeration por timing).
  const passwordOk = actor
    ? await bcrypt.compare(password, actor.passwordHash)
    : (await bcrypt.compare(password, DUMMY_PASSWORD_HASH), false)
  if (!actor || !passwordOk) {
    // Sprint B · incrementa contador e lock-out se for User
    let lockedNow = false
    let unlockAt: Date | null = null
    if (actor?.isUser) {
      try {
        const policy = await resolvePolicy(actor.clienteFinalId ?? null)
        const newAttempts = (actor.failedLoginAttempts ?? 0) + 1
        if (newAttempts >= policy.loginMaxAttempts) {
          unlockAt = new Date(Date.now() + policy.loginLockoutMinutes * 60_000)
          await prisma.user.update({
            where: { id: actor.id },
            data:  {
              failedLoginAttempts: 0,   // reset depois de bloquear (próxima janela)
              lockedUntil:         unlockAt,
            },
          })
          lockedNow = true

          // Revoga sessões ativas — defesa em profundidade (sessões antigas
          // podem ter sido obtidas por força bruta antes do lock).
          await prisma.userSession.updateMany({
            where: { userId: actor.id, revokedAt: null },
            data:  { revokedAt: new Date(), revokedReason: 'login_lockout' },
          }).catch(() => { /* best-effort */ })

          await auditAction(prisma, {
            action:     'LOGIN_FAILED_LOCKOUT',
            resource:   'User',
            resourceId: actor.id,
            result:     'BLOCKED',
            metadata:   {
              attemptedEmail: email,
              attempts:       newAttempts,
              maxAttempts:    policy.loginMaxAttempts,
              lockoutMinutes: policy.loginLockoutMinutes,
              unlockAt:       unlockAt.toISOString(),
            },
            req,
          })
        } else {
          await prisma.user.update({
            where: { id: actor.id },
            data:  { failedLoginAttempts: newAttempts },
          })
        }
      } catch (err) {
        logger.warn({ err, userId: actor.id }, 'login_failed_counter_update_failed')
      }
    }

    // Audit padrão (Onda 12.1). reason inclui lockedNow=true se virou lock.
    await auditAction(prisma, {
      action:     'LOGIN_FAILED',
      resource:   'User',
      resourceId: actor?.id ?? null,
      result:     'BLOCKED',
      metadata:   {
        attemptedEmail: email,
        reason: !actor ? 'unknown_email' : 'invalid_password',
        lockedNow,
        unlockAt: unlockAt?.toISOString() ?? null,
      },
      req,
    })

    if (lockedNow && unlockAt) {
      res.status(423).json({
        error:    'ACCOUNT_LOCKED',
        message:  `Conta bloqueada por excesso de tentativas. Tente novamente após ${unlockAt.toISOString()}`,
        unlockAt: unlockAt.toISOString(),
      })
      return
    }

    throw new UnauthorizedError('Email ou senha inválidos')
  }

  // ── Senha correta — reset contador, atualiza lastLoginAt ──────────────────
  const passwordExpired = !!(actor.isUser && actor.passwordExpiresAt && actor.passwordExpiresAt < new Date())
  const mustChange = !!(actor.mustChangePassword) || passwordExpired

  // ── Sprint C · MFA Gate ────────────────────────────────────────────────────
  // Se o user tem 2FA habilitado, NÃO emite JWT cheio agora. Emite um
  // "mfa_challenge" token de curta duração (5min) com mfaPending=true.
  // Frontend chama POST /auth/login-mfa-verify com challenge + código.
  // Se o tenant exige MFA (TenantPolicy.mfaRequiredForRoles), e o user ainda
  // não habilitou, retornamos mustEnableMfa=true junto com JWT cheio — frontend
  // força o setup logo após o login.
  if (actor.isUser && actor.totpEnabledAt && actor.totpSecret) {
    const challengeToken = jwt.sign(
      {
        sub:            actor.id,
        role:           actor.role,
        integradorId:   actor.integradorId,
        clienteFinalId: actor.clienteFinalId,
        mfaPending:     true,
      },
      secret,
      { expiresIn: '5m' } as jwt.SignOptions,
    )

    await auditAction(prisma, {
      action:     'LOGIN_MFA_CHALLENGED',
      resource:   'User',
      resourceId: actor.id,
      result:     'SUCCESS',
      metadata:   { email, role: actor.role },
      req,
    })

    res.json({
      mfaRequired:     true,
      challengeToken,
      role:            actor.role,
      mustChangePassword: mustChange,
      passwordExpired,
    })
    return
  }

  if (actor.isUser) {
    await prisma.user.update({
      where: { id: actor.id },
      data:  {
        failedLoginAttempts: 0,
        lockedUntil:         null,
        lastLoginAt:         new Date(),
        // Se a senha expirou pelo cron mas ainda não foi forçado, marca aqui.
        ...(passwordExpired ? { mustChangePassword: true } : {}),
      },
    }).catch(err => logger.warn({ err, userId: actor!.id }, 'login_success_user_update_failed'))
  }

  const jti = randomUUID()
  const token = jwt.sign(
    {
      sub:            actor.id,
      role:           actor.role,
      integradorId:   actor.integradorId,
      clienteFinalId: actor.clienteFinalId,
      jti,
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? '8h' } as jwt.SignOptions,
  )

  // Sprint A/B — cria UserSession só pra User (não SuperAdmin/Integrador).
  // tokenHash = SHA256(jti) — permite revogar sem manter JWT em si.
  if (actor.isUser) {
    try {
      const tokenHash = createHash('sha256').update(jti).digest('hex')
      // Limite de validade alinhado com JWT_EXPIRES_IN (8h padrão).
      // Quando o token expira no JWT, a session "morre" naturalmente; cron limpa depois.
      const sessionTtlMs = 8 * 60 * 60_000
      await prisma.userSession.create({
        data: {
          userId:    actor.id,
          tokenHash,
          device:    String(req.headers['user-agent'] ?? '').slice(0, 250) || null,
          ip:        req.ip ?? null,
          expiresAt: new Date(Date.now() + sessionTtlMs),
        },
      })
    } catch (err) {
      // Não bloqueia o login — auditoria de sessão é best-effort.
      logger.warn({ err, userId: actor.id }, 'user_session_create_failed')
    }
  }

  // Onda 12.1 — LOGIN_SUCCESS para LGPD/forense (quem acessou, quando, IP)
  await auditAction(prisma, {
    action:     'LOGIN_SUCCESS',
    resource:   'User',
    resourceId: actor.id,
    result:     'SUCCESS',
    metadata: {
      email,
      role:               actor.role,
      integradorId:       actor.integradorId,
      clienteFinalId:     actor.clienteFinalId,
      mustChangePassword: mustChange,
      passwordExpired,
    },
    req,
  })

  // P0 fix · convite tinha "Exigir 2FA no 1º login" — bloqueia uso até
  // configurar TOTP. Frontend deve direcionar pro /settings → 2FA.
  // (Só usuários — SuperAdmin/Integrador não têm essa flag.)
  const mustEnableMfa = !!(actor.isUser && actor.requireMfaSetup && !actor.totpEnabledAt)

  res.json({
    token,
    role:               actor.role,
    mustChangePassword: mustChange,
    passwordExpired,
    mustEnableMfa,
  })
}))

// ════════════════════════════════════════════════════════════════════════════
// POST /auth/logout — logout explícito (revoga UserSession + audit LOGOUT)
// ════════════════════════════════════════════════════════════════════════════
// Cliente chama no botão "Sair". Best-effort: se o JWT já expirou ou não
// houver UserSession, ainda retorna 200 (frontend limpa estado independente).
authRouter.post('/logout',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice(7)
      try {
        const secret = process.env.JWT_SECRET!
        const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as { sub: string; jti?: string; role: string; integradorId?: string; clienteFinalId?: string }

        // Revoga UserSession (só pra User; SuperAdmin/Integrador não têm)
        if (payload.jti) {
          const tokenHash = createHash('sha256').update(payload.jti).digest('hex')
          await prisma.userSession.updateMany({
            where: { tokenHash, revokedAt: null },
            data:  { revokedAt: new Date(), revokedReason: 'user_logout' },
          }).catch(() => { /* best-effort */ })
        }

        await auditAction(prisma, {
          action:     'LOGOUT',
          resource:   'User',
          resourceId: payload.sub,
          result:     'SUCCESS',
          metadata:   { jti: payload.jti, role: payload.role },
          req,
        })
      } catch { /* JWT inválido/expirado — ignora, frontend limpa local mesmo assim */ }
    }
    res.json({ ok: true })
  })
)

// ════════════════════════════════════════════════════════════════════════════
// POST /auth/login-mfa-verify — 2º passo do login quando user tem TOTP ativo
// ════════════════════════════════════════════════════════════════════════════
// Recebe challengeToken (emitido pelo /login) + código TOTP (6 dígitos) ou
// código de backup. Se válido, emite JWT cheio e cria UserSession.
//
// Aceita também BACKUP CODE (10 chars). Backup é single-use → remove do array.
//
// Sprint C · docs/40-PLAN-GESTAO-USUARIOS.md
const MfaVerifySchema = z.object({
  challengeToken: z.string().min(20),
  code:           z.string().min(6).max(20),  // 6 dígitos TOTP ou backup code
})

authRouter.post('/login-mfa-verify',
  publicRoute(),
  mfaVerifyLimiter,
  asyncHandler(async (req, res) => {
    const parse = MfaVerifySchema.safeParse(req.body)
    if (!parse.success) throw new UnauthorizedError('Dados inválidos')
    const { challengeToken, code } = parse.data

    const secret = process.env.JWT_SECRET
    if (!secret) throw new Error('JWT_SECRET not configured')

    // Valida o challenge token
    let payload: { sub: string; role: string; integradorId?: string; clienteFinalId?: string; mfaPending?: boolean }
    try {
      payload = jwt.verify(challengeToken, secret, { algorithms: ['HS256'] }) as any
    } catch {
      throw new UnauthorizedError('Desafio expirado. Faça login novamente.')
    }
    if (!payload.mfaPending) throw new UnauthorizedError('Token inválido')

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, role: true, integradorId: true, clienteFinalId: true,
        totpSecret: true, totpEnabledAt: true, totpBackupCodesHash: true,
        mustChangePassword: true, passwordExpiresAt: true,
      },
    })
    if (!user || !user.totpEnabledAt || !user.totpSecret) {
      throw new UnauthorizedError('2FA não está habilitado nesta conta')
    }

    const isNumeric = /^\d{6}$/.test(code)
    let verified = false
    let usedBackup = false

    if (isNumeric) {
      const totpSecret = decryptSecret(user.totpSecret)
      if (totpSecret) verified = verifyTotpCode(totpSecret, code)
    }

    // Tenta backup code se não bateu como TOTP
    if (!verified) {
      const codeHash = createHash('sha256').update(code.toUpperCase().trim()).digest('hex')
      const idx = user.totpBackupCodesHash.indexOf(codeHash)
      if (idx >= 0) {
        verified = true
        usedBackup = true
        const newHashes = [...user.totpBackupCodesHash.slice(0, idx), ...user.totpBackupCodesHash.slice(idx + 1)]
        await prisma.user.update({
          where: { id: user.id },
          data:  { totpBackupCodesHash: newHashes },
        })
      }
    }

    if (!verified) {
      await auditAction(prisma, {
        action:     'LOGIN_MFA_FAILED',
        resource:   'User',
        resourceId: user.id,
        result:     'BLOCKED',
        metadata:   { triedBackup: !isNumeric },
        req,
      })
      throw new UnauthorizedError('Código inválido')
    }

    // Sucesso → emite JWT cheio + sessão
    const passwordExpired = !!(user.passwordExpiresAt && user.passwordExpiresAt < new Date())
    const mustChange = !!user.mustChangePassword || passwordExpired

    await prisma.user.update({
      where: { id: user.id },
      data:  {
        failedLoginAttempts: 0,
        lockedUntil:         null,
        lastLoginAt:         new Date(),
        ...(passwordExpired ? { mustChangePassword: true } : {}),
      },
    }).catch(err => logger.warn({ err, userId: user.id }, 'mfa_verify_user_update_failed'))

    const jti = randomUUID()
    const token = jwt.sign(
      {
        sub:            user.id,
        role:           user.role,
        integradorId:   user.integradorId ?? undefined,
        clienteFinalId: user.clienteFinalId ?? undefined,
        jti,
      },
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '8h' } as jwt.SignOptions,
    )

    try {
      const tokenHash = createHash('sha256').update(jti).digest('hex')
      await prisma.userSession.create({
        data: {
          userId:    user.id,
          tokenHash,
          device:    String(req.headers['user-agent'] ?? '').slice(0, 250) || null,
          ip:        req.ip ?? null,
          expiresAt: new Date(Date.now() + 8 * 60 * 60_000),
        },
      })
    } catch (err) {
      logger.warn({ err, userId: user.id }, 'mfa_user_session_create_failed')
    }

    await auditAction(prisma, {
      action:     usedBackup ? 'LOGIN_MFA_BACKUP_USED' : 'LOGIN_MFA_SUCCESS',
      resource:   'User',
      resourceId: user.id,
      result:     'SUCCESS',
      metadata:   {
        usedBackup,
        backupCodesRemaining: usedBackup ? user.totpBackupCodesHash.length - 1 : user.totpBackupCodesHash.length,
      },
      req,
    })

    res.json({
      token,
      role:               user.role,
      mustChangePassword: mustChange,
      passwordExpired,
      usedBackup,
      backupCodesRemaining: usedBackup ? user.totpBackupCodesHash.length - 1 : user.totpBackupCodesHash.length,
    })
  })
)

// ════════════════════════════════════════════════════════════════════════════
// POST /auth/sudo — step-up auth pra integrador acessar dados sensíveis
// ════════════════════════════════════════════════════════════════════════════
// Razão: live/recordings/faces/plates contêm dados pessoais do cliente final.
// Integrador tem permissão técnica mas LGPD exige finalidade declarada. Exigir
// senha + motivo a cada janela de 15min trata como "sudo": o ato de digitar
// senha pra desbloquear força conscientização e gera audit log forte.
//
// Não aplica a SUPER_ADMIN (fabricante) nem CLIENTE_* (donos). Aplica só a
// INTEGRADOR_ADMIN — INTEGRADOR_TECNICO sequer vê os itens na sidebar.
const SudoSchema = z.object({
  password:        z.string().min(1),
  reason:          z.string().min(10).max(500),
  durationSeconds: z.number().int().min(300).max(3600).optional(), // 5min–1h
  acknowledged:    z.boolean().refine(v => v === true, {
    message: 'É necessário concordar que o acesso fica registrado e visível ao cliente (LGPD)',
  }),
})

authRouter.post('/sudo',
  publicRoute(),
  requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload!

  // Apenas INTEGRADOR_ADMIN pode elevar. TECNICO nem deveria estar pedindo —
  // se chegou aqui é tentativa indevida.
  if (p.role !== 'INTEGRADOR_ADMIN') {
    throw new ForbiddenError('Apenas INTEGRADOR_ADMIN pode solicitar elevação')
  }
  if (p.impersonatedBy) {
    throw new ForbiddenError('Não é permitido elevar dentro de uma sessão impersonada')
  }

  const parse = SudoSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')
  const { password, reason, durationSeconds } = parse.data
  const expiresInSec = durationSeconds ?? 900 // 15min default

  // Valida a senha do Integrador (ator é o owner do tenant).
  const integrador = await prisma.integrador.findUnique({
    where:  { id: p.sub },
    select: { id: true, passwordHash: true, active: true },
  })
  if (!integrador || !integrador.active) {
    throw new ForbiddenError('Conta inativa')
  }
  const ok = await bcrypt.compare(password, integrador.passwordHash)
  if (!ok) {
    // Audit failure pra detectar brute-force de elevação
    await auditAction(prisma, {
      action:     'ELEVATED_ACCESS_DENIED',
      resource:   'Integrador',
      resourceId: p.sub,
      result:     'BLOCKED',
      metadata:   { reason: 'invalid_password' },
      req,
    })
    throw new UnauthorizedError('Senha inválida')
  }

  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET not configured')

  const sudoToken = jwt.sign(
    {
      sub:       p.sub,
      parentSub: p.sub,
      scope:     'sudo' as const,
      reason,
    },
    secret,
    { expiresIn: expiresInSec } as jwt.SignOptions,
  )

  // Audit forte — mesma scope que ImpersonateSession
  await prisma.auditLog.create({
    data: {
      integradorId: p.sub,
      userId:       null,
      action:       'ELEVATED_ACCESS_GRANT',
      resource:     'Integrador',
      resourceId:   p.sub,
      metadataJson: {
        reason,
        durationSeconds: expiresInSec,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
    },
  })

  res.json({
    sudoToken,
    expiresInSeconds: expiresInSec,
    expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
  })
}))

// ── POST /auth/sudo/revoke ────────────────────────────────────────────────
authRouter.post('/sudo/revoke',
  publicRoute(),
  requireAuth, asyncHandler(async (req, res) => {
  const p = req.jwtPayload!
  // Só audita; o JWT sudo é stateless e expira sozinho. Frontend limpa storage.
  if (p.role === 'INTEGRADOR_ADMIN') {
    await prisma.auditLog.create({
      data: {
        integradorId: p.sub,
        action:       'ELEVATED_ACCESS_REVOKED',
        resource:     'Integrador',
        resourceId:   p.sub,
        metadataJson: { manual: true },
      },
    })
  }
  res.json({ ok: true })
}))

// ───────────────── GET /auth/me ────────────────────────────────────────
authRouter.get('/me',
  publicRoute(),
  requireAuth, asyncHandler(async (req, res) => {
  const actor = await resolveActor(req.jwtPayload!)
  if (!actor) throw new NotFoundError('Usuário')
  res.json(actor)
}))

// ───────────────── PATCH /auth/me  (editar nome/telefone) ──────────────
const UpdateProfileSchema = z.object({
  name:  z.string().min(1).max(120).optional(),
  phone: z.string().max(32).optional(),
})
authRouter.patch('/me',
  publicRoute(),
  requireAuth, asyncHandler(async (req, res) => {
  const parse = UpdateProfileSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError('Dados inválidos')
  const patch = parse.data
  const payload = req.jwtPayload!

  if (payload.role === 'SUPER_ADMIN') {
    if (patch.name) {
      await prisma.superAdmin.update({ where: { id: payload.sub }, data: { name: patch.name } })
    }
  } else if (payload.role === 'INTEGRADOR_ADMIN') {
    await prisma.integrador.update({
      where: { id: payload.sub },
      data: {
        ...(patch.name  !== undefined ? { name: patch.name  } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      },
    })
  } else {
    await prisma.user.update({
      where: { id: payload.sub },
      data: { ...(patch.name !== undefined ? { name: patch.name } : {}) },
    })
  }

  const fresh = await resolveActor(payload)
  res.json(fresh)
}))

// ───────────────── PATCH /auth/me/avatar (Lote 6) ─────────────────────
const AvatarSchema = z.object({
  // Aceita URL externa ou data URL (base64). Máx 2MB em data URL (~2.7MB base64).
  avatarUrl: z.string().max(2_200_000).refine(
    v => v.startsWith('data:image/') || v.startsWith('https://') || v.startsWith('http://'),
    'avatarUrl deve ser data URL de imagem ou URL https',
  ).nullable(),
})
authRouter.patch('/me/avatar',
  publicRoute(),
  requireAuth, asyncHandler(async (req, res) => {
  const parse = AvatarSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'Avatar inválido')

  const payload = req.jwtPayload!

  // Apenas User (não SuperAdmin nem IntegradorAdmin — não têm avatarUrl no schema)
  if (payload.role === 'SUPER_ADMIN' || payload.role === 'INTEGRADOR_ADMIN') {
    throw new ValidationError('Avatar não suportado para este perfil')
  }

  const updated = await prisma.user.update({
    where: { id: payload.sub },
    data:  { avatarUrl: parse.data.avatarUrl },
    select: { id: true, name: true, email: true, avatarUrl: true, role: true },
  })

  res.json(updated)
}))

// ───────────────── POST /auth/box-token ────────────────────────────────
//
// SSO Box: técnico do integrador usa o mesmo login da Cloud para acessar
// o portal local de uma Box específica, sem senha separada.
//
// Fluxo:
//   1. Técnico faz login na Cloud → JWT normal (8h)
//   2. Técnico (ou a Box) chama POST /auth/box-token { edgeNodeId }
//   3. Cloud valida que o usuário tem acesso àquela Box (mesmo integrador)
//   4. Cloud retorna box_token JWT curto (1h), assinado com BOX_JWT_SECRET
//   5. Box valida o box_token com o mesmo secret → abre sessão local
//
// A Box sabe qual integradorId aceitar via EdgeNode.integradorId (populado no activate).
// Se integradorId bater com o do token → login autorizado, sem criar senha local.
//
const BoxTokenSchema = z.object({
  edgeNodeId: z.string().uuid(),
})

authRouter.post('/box-token',
  publicRoute(),
  requireAuth, asyncHandler(async (req, res) => {
  const jwt_payload = req.jwtPayload!

  // Apenas INTEGRADOR_ADMIN e INTEGRADOR_TECNICO podem solicitar acesso à Box
  if (!['INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'SUPER_ADMIN'].includes(jwt_payload.role)) {
    throw new UnauthorizedError('Apenas técnicos do integrador podem acessar o portal da Box')
  }

  const parse = BoxTokenSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const { edgeNodeId } = parse.data

  // Verificar que o EdgeNode existe e pertence ao integrador do usuário
  const node = await prisma.edgeNode.findUnique({
    where: { id: edgeNodeId },
    include: {
      site: { include: { clienteFinal: { select: { integradorId: true } } } },
    },
  })
  if (!node) throw new NotFoundError('Edge Node')

  const nodeIntegradorId = node.integradorId ?? node.site.clienteFinal.integradorId

  // SUPER_ADMIN tem acesso irrestrito; para os demais, verificar tenant
  if (jwt_payload.role !== 'SUPER_ADMIN' && nodeIntegradorId !== jwt_payload.integradorId) {
    throw new UnauthorizedError('Box não pertence ao seu integrador')
  }

  // Verificar ACL de técnico (IntegradorTechnicianAccess), se existir
  if (jwt_payload.role === 'INTEGRADOR_TECNICO') {
    const acl = await prisma.integradorTechnicianAccess.findFirst({
      where: {
        technicianUserId: jwt_payload.sub,
        integradorId:     nodeIntegradorId ?? undefined,
        revokedAt:        null,
      },
    })
    // Se tem registros de ACL e o clienteFinal da box não está na lista → negar
    const hasAnyAcl = await prisma.integradorTechnicianAccess.count({
      where: { technicianUserId: jwt_payload.sub, revokedAt: null },
    })
    if (hasAnyAcl > 0 && !acl) {
      throw new UnauthorizedError('Técnico não tem acesso a este cliente')
    }
  }

  const boxSecret = process.env.BOX_JWT_SECRET ?? process.env.JWT_SECRET
  if (!boxSecret) throw new Error('BOX_JWT_SECRET não configurado')

  // Buscar dados do usuário para incluir no token
  const user = await prisma.user.findUnique({
    where: { id: jwt_payload.sub },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!user) throw new NotFoundError('Usuário')

  // Emitir box_token com TTL 1h, escopo restrito a este EdgeNode
  const boxToken = jwt.sign(
    {
      sub:          user.id,
      name:         user.name,
      email:        user.email,
      role:         jwt_payload.role,
      integradorId: nodeIntegradorId,
      edgeNodeId,
      aud:          `box:${edgeNodeId}`,
    },
    boxSecret,
    { expiresIn: '1h' } as jwt.SignOptions,
  )

  // Atualizar integradorId no EdgeNode se ainda não estava preenchido
  if (!node.integradorId && nodeIntegradorId) {
    await prisma.edgeNode.update({
      where: { id: edgeNodeId },
      data: { integradorId: nodeIntegradorId },
    }).catch(() => { /* não crítico */ })
  }

  res.json({
    boxToken,
    expiresIn: 3600,
    edgeNodeId,
    integradorId: nodeIntegradorId,
    user: { id: user.id, name: user.name, email: user.email, role: jwt_payload.role },
    instructions: {
      use: 'Envie este token no header: Authorization: Bearer <boxToken>',
      validate: `Box valida usando BOX_JWT_SECRET e verifica aud === "box:${edgeNodeId}"`,
    },
  })
}))

// ───────────────── GET /auth/me/password-policy ─────────────────────────
// Sprint B — retorna a política aplicável ao user logado pra UI mostrar
// requisitos em tempo real (Min N caracteres, 1 maiúscula, 1 número, 1 especial,
// diferente das últimas N). Não expõe loginMaxAttempts/lockoutMinutes pra
// não dar pista pra atacante; só as regras visíveis durante mudança de senha.
authRouter.get('/me/password-policy',
  publicRoute(),
  requireAuth, asyncHandler(async (req, res) => {
  const payload = req.jwtPayload!
  const policy = await resolvePolicy(payload.clienteFinalId ?? null)
  res.json({
    policy: {
      passwordMinLength:      policy.passwordMinLength,
      passwordRequireSpecial: policy.passwordRequireSpecial,
      passwordRequireNumber:  policy.passwordRequireNumber,
      passwordRequireUpper:   policy.passwordRequireUpper,
      passwordHistoryCount:   policy.passwordHistoryCount,
      passwordRotateDays:     policy.passwordRotateDays,
    },
  })
}))

// ───────────────── POST /auth/change-password ──────────────────────────
const ChangePwSchema = z.object({
  current: z.string().min(6, 'Senha atual deve ter ao menos 6 caracteres'),
  next:    z.string().min(8, 'Nova senha deve ter ao menos 8 caracteres'),
})
authRouter.post('/change-password',
  publicRoute(),
  requireAuth, asyncHandler(async (req, res) => {
  const parse = ChangePwSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'Senha inválida')
  const payload = req.jwtPayload!

  const currentHash = await getCurrentHash(payload)
  if (!currentHash) throw new NotFoundError('Usuário')

  const ok = await bcrypt.compare(parse.data.current, currentHash)
  if (!ok) {
    // Onda 12.2 — tentativa de troca de senha com senha atual errada
    // (suspeita de comprometimento de sessão)
    await auditAction(prisma, {
      action:     'PASSWORD_CHANGE_FAILED',
      resource:   'User',
      resourceId: payload.sub,
      result:     'BLOCKED',
      metadata:   { reason: 'invalid_current_password' },
      req,
    })
    throw new UnauthorizedError('Senha atual incorreta')
  }

  // ── Sprint B · valida nova senha contra TenantPolicy + histórico ─────────
  // Aplica só pra User (SuperAdmin/Integrador não têm tenant nem history).
  const isUserActor = payload.role !== 'SUPER_ADMIN' && payload.role !== 'INTEGRADOR_ADMIN'
  if (isUserActor) {
    const validation = await validatePasswordAgainstPolicy(
      parse.data.next,
      payload.clienteFinalId ?? null,
      { userId: payload.sub },
    )
    if (!validation.valid) {
      await auditAction(prisma, {
        action:     'PASSWORD_CHANGE_FAILED',
        resource:   'User',
        resourceId: payload.sub,
        result:     'BLOCKED',
        metadata:   { reason: 'policy_violation', errors: validation.errors },
        req,
      })
      res.status(400).json({
        error:   'PASSWORD_POLICY_VIOLATION',
        message: validation.errors[0] ?? 'Senha não atende à política',
        errors:  validation.errors,
        policy:  validation.policy,
      })
      return
    }
  }

  const newHash = await bcrypt.hash(parse.data.next, 12)

  if (isUserActor) {
    // Aplica via helper que cuida do history + reset de expiresAt + sessões.
    const policy = await resolvePolicy(payload.clienteFinalId ?? null)
    await applyPasswordChange({
      userId:  payload.sub,
      newHash,
      oldHash: currentHash,
      policy,
    })

    // Invalida todas as sessions EXCETO a atual.
    // Identifica a sessão atual via jti (se o JWT tem) → tokenHash.
    try {
      const currentJti = (payload as any).jti as string | undefined
      const currentTokenHash = currentJti
        ? createHash('sha256').update(currentJti).digest('hex')
        : null

      await prisma.userSession.updateMany({
        where: {
          userId:    payload.sub,
          revokedAt: null,
          ...(currentTokenHash ? { tokenHash: { not: currentTokenHash } } : {}),
        },
        data: {
          revokedAt:     new Date(),
          revokedReason: 'password_changed',
        },
      })
    } catch (err) {
      logger.warn({ err, userId: payload.sub }, 'password_change_session_invalidate_failed')
    }
  } else {
    // SuperAdmin/Integrador: caminho legado (sem policy/history).
    await updatePassword(payload, newHash)
  }

  // Onda 12.2 — PASSWORD_CHANGED é evento crítico LGPD (titular pode pedir
  // "quem trocou minha senha em X data?"). Não loga a senha (helper redact).
  await auditAction(prisma, {
    action:     'PASSWORD_CHANGED',
    resource:   'User',
    resourceId: payload.sub,
    result:     'SUCCESS',
    metadata:   { role: payload.role },
    req,
  })

  res.json({ ok: true })
}))
