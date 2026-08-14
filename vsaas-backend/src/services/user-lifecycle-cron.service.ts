/**
 * user-lifecycle-cron.service — Sprint B
 *
 * Cron horário que processa o ciclo de vida de usuários do cliente final:
 *   1. Senhas vencidas → seta mustChangePassword=true
 *   2. Contas com expiresAt < now → desativa (active=false) + revoga sessões
 *   3. Avisa contas que expiram em 7 dias (WhatsApp/email best-effort)
 *   4. Limpa sessões expiradas (UserSession.expiresAt < now - 30d)
 *   5. Auto-unlock contas onde lockedUntil < now
 *
 * Idempotente: rodar 2x seguido não duplica nada.
 *
 * Ativação: import + startUserLifecycleCron() em src/app.ts.
 * Desabilitar via env USER_LIFECYCLE_CRON_DISABLED=true.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { sendMail } from '../lib/smtp'

const INTERVAL_MS = 60 * 60 * 1000 // 1h
const WARNING_DAYS_AHEAD = 7
const SESSION_GC_AFTER_DAYS = 30

let timer: NodeJS.Timeout | null = null

export interface LifecycleStats {
  passwordsExpired:           number
  accountsExpired:            number
  expirationWarningsSent:     number
  expirationWarningsFailed:   number
  sessionsPurged:             number
  accountsUnlocked:           number
  errors:                     string[]
}

/**
 * Processa todas as etapas. Cada etapa é independente (try/catch local).
 * Retorna stats agregadas para inspeção via log e healthcheck.
 */
export async function processUserLifecycle(): Promise<LifecycleStats> {
  const stats: LifecycleStats = {
    passwordsExpired:         0,
    accountsExpired:          0,
    expirationWarningsSent:   0,
    expirationWarningsFailed: 0,
    sessionsPurged:           0,
    accountsUnlocked:         0,
    errors:                   [],
  }

  const now = new Date()

  // ── 1. Senhas vencidas ────────────────────────────────────────────────────
  try {
    const expired = await prisma.user.findMany({
      where: {
        passwordExpiresAt:  { lt: now, not: null },
        mustChangePassword: false,
        active:             true,
      },
      select: { id: true, email: true, clienteFinalId: true, integradorId: true },
      take:   500,
    })

    for (const u of expired) {
      await prisma.user.update({
        where: { id: u.id },
        data:  { mustChangePassword: true },
      })

      await prisma.auditLog.create({
        data: {
          action:         'PASSWORD_EXPIRED_AUTO_LOCK',
          resource:       'User',
          resourceId:     u.id,
          clienteFinalId: u.clienteFinalId ?? null,
          integradorId:   u.integradorId ?? null,
          metadataJson:   { email: u.email, reason: 'password_rotate_policy' },
        },
      }).catch(() => { /* best-effort */ })

      stats.passwordsExpired++
    }
  } catch (err: any) {
    logger.error({ err }, 'user_lifecycle_passwords_expired_failed')
    stats.errors.push(`passwords_expired: ${err?.message ?? 'unknown'}`)
  }

  // ── 2. Contas expiradas (expiresAt < now) → desativar ─────────────────────
  try {
    const expired = await prisma.user.findMany({
      where: {
        expiresAt: { lt: now, not: null },
        active:    true,
      },
      select: { id: true, email: true, clienteFinalId: true, integradorId: true },
      take:   500,
    })

    for (const u of expired) {
      await prisma.user.update({
        where: { id: u.id },
        data:  { active: false },
      })

      // Revoga todas as sessões ativas — usuário não consegue mais entrar
      const revoked = await prisma.userSession.updateMany({
        where: { userId: u.id, revokedAt: null },
        data:  { revokedAt: now, revokedReason: 'account_expired' },
      }).catch(() => ({ count: 0 }))

      await prisma.auditLog.create({
        data: {
          action:         'ACCOUNT_EXPIRED_AUTO_DISABLE',
          resource:       'User',
          resourceId:     u.id,
          clienteFinalId: u.clienteFinalId ?? null,
          integradorId:   u.integradorId ?? null,
          metadataJson:   {
            email:           u.email,
            sessionsRevoked: revoked.count,
            reason:          'expiresAt_passed',
          },
        },
      }).catch(() => { /* best-effort */ })

      stats.accountsExpired++
    }
  } catch (err: any) {
    logger.error({ err }, 'user_lifecycle_accounts_expired_failed')
    stats.errors.push(`accounts_expired: ${err?.message ?? 'unknown'}`)
  }

  // ── 3. Aviso de expiração próxima (T-7d) ──────────────────────────────────
  try {
    const windowStart = new Date(now.getTime() + (WARNING_DAYS_AHEAD - 1) * 24 * 60 * 60_000)
    const windowEnd   = new Date(now.getTime() + WARNING_DAYS_AHEAD       * 24 * 60 * 60_000)

    const expiring = await prisma.user.findMany({
      where: {
        active:    true,
        expiresAt: { gte: windowStart, lt: windowEnd },
      },
      select: {
        id: true, email: true, name: true,
        clienteFinalId: true, integradorId: true, expiresAt: true,
      },
      take: 200,
    })

    for (const u of expiring) {
      try {
        const daysLeft = Math.max(1, Math.ceil(
          ((u.expiresAt?.getTime() ?? now.getTime()) - now.getTime()) / (24 * 60 * 60_000),
        ))

        const mail = await sendMail({
          to:      u.email,
          subject: `[VSaaS] Sua conta expira em ${daysLeft} dia(s)`,
          text:
            `Olá, ${u.name ?? 'usuário'}!\n\n` +
            `Sua conta no VSaaS expira em ${daysLeft} dia(s).\n` +
            `Após a data de expiração, o acesso será automaticamente bloqueado.\n\n` +
            `Se precisar prorrogar, entre em contato com o administrador da sua organização.\n\n` +
            `Equipe VSaaS`,
          integradorId: u.integradorId ?? undefined,
        })

        if (mail.sent) {
          stats.expirationWarningsSent++
        } else {
          stats.expirationWarningsFailed++
        }

        // Log informativo — sem audit pra não inflar tabela (notificação banal).
        logger.info({
          userId:   u.id,
          email:    u.email,
          daysLeft,
          sent:     mail.sent,
          reason:   mail.reason,
        }, 'account_expiration_warning_sent')
      } catch (err) {
        stats.expirationWarningsFailed++
        logger.warn({ err, userId: u.id }, 'account_expiration_warning_failed')
      }
    }
  } catch (err: any) {
    logger.error({ err }, 'user_lifecycle_warnings_failed')
    stats.errors.push(`warnings: ${err?.message ?? 'unknown'}`)
  }

  // ── 4. Limpeza de sessões vencidas (TTL + 30d) ────────────────────────────
  try {
    const cutoff = new Date(now.getTime() - SESSION_GC_AFTER_DAYS * 24 * 60 * 60_000)
    const result = await prisma.userSession.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    })
    stats.sessionsPurged = result.count
  } catch (err: any) {
    logger.error({ err }, 'user_lifecycle_session_gc_failed')
    stats.errors.push(`session_gc: ${err?.message ?? 'unknown'}`)
  }

  // ── 5. Auto-unlock (lockedUntil < now) ────────────────────────────────────
  try {
    const result = await prisma.user.updateMany({
      where: {
        lockedUntil: { lt: now, not: null },
      },
      data: {
        lockedUntil:         null,
        failedLoginAttempts: 0,
      },
    })
    stats.accountsUnlocked = result.count
  } catch (err: any) {
    logger.error({ err }, 'user_lifecycle_auto_unlock_failed')
    stats.errors.push(`auto_unlock: ${err?.message ?? 'unknown'}`)
  }

  // ── 6. Auto-end férias (vacationUntil < now) ──────────────────────────────
  // User volta automaticamente. Audit log pra trilha.
  try {
    const returning = await prisma.user.findMany({
      where: { vacationUntil: { lt: now, not: null } },
      select: { id: true },
    })
    if (returning.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: returning.map(u => u.id) } },
        data:  { vacationUntil: null },
      })
      for (const u of returning) {
        await prisma.auditLog.create({
          data: {
            action: 'USER_VACATION_ENDED',
            resource: 'User',
            resourceId: u.id,
            userId: u.id,
            metadataJson: { auto: true } as any,
          },
        }).catch(() => {})
      }
      ;(stats as any).vacationsEnded = returning.length
    }
  } catch (err: any) {
    logger.error({ err }, 'user_lifecycle_vacation_end_failed')
    stats.errors.push(`vacation_end: ${err?.message ?? 'unknown'}`)
  }

  return stats
}

async function tick() {
  try {
    const stats = await processUserLifecycle()
    logger.info(stats, 'user_lifecycle_cron_tick')
  } catch (err) {
    logger.error({ err }, 'user_lifecycle_cron_failed')
  }
}

export function startUserLifecycleCron() {
  if (process.env.USER_LIFECYCLE_CRON_DISABLED === 'true') {
    logger.info('user_lifecycle_cron_disabled_via_env')
    return
  }
  if (timer) return

  // Primeira execução em 45s — escalonado pra não competir com outros crons no boot.
  setTimeout(() => {
    tick().catch(err => logger.error({ err }, 'user_lifecycle_cron_initial_failed'))
    timer = setInterval(tick, INTERVAL_MS)
  }, 45_000)

  logger.info({ intervalMin: INTERVAL_MS / 60_000 }, 'user_lifecycle_cron_started')
}

export function stopUserLifecycleCron() {
  if (timer) clearInterval(timer)
  timer = null
}
