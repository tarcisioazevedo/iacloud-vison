/**
 * Trial Flow service.
 *
 * Conceito:
 *   - Integrador tem `trialEndsAt` quando é trial (null = pagante)
 *   - Trial padrão: 14 dias + 5 câmeras (limite técnico)
 *   - Cron diário (trial-expiration.service.ts) expira + envia lembretes
 *
 * Estágios de notificação:
 *   T-7  → 7 dias antes do fim
 *   T-3  → 3 dias antes
 *   T-1  → 1 dia antes
 *   T-0  → no dia da expiração
 *   T+1  → expirado, suspende serviço (active=false)
 *
 * Idempotência: trialNotificationsSent guarda timestamp do envio por estágio,
 * evita reenvio mesmo com cron rodando 2x/dia.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

export const TRIAL_DEFAULT_DAYS = 14
export const TRIAL_DEFAULT_MAX_CAMERAS = 5

export type TrialStage = 'T-7' | 'T-3' | 'T-1' | 'T-0' | 'EXPIRED'

export interface TrialStatus {
  isTrial: boolean
  isActive: boolean         // dentro do prazo
  daysRemaining: number     // < 0 quando expirado
  endsAt: Date | null
  activatedAt: Date | null
  maxCameras: number
  camerasUsed: number
  camerasOverLimit: boolean
}

/**
 * Calcula status detalhado do trial pra um integrador.
 * Usado no frontend (banner) e nos middlewares de limite.
 */
export async function getTrialStatus(integradorId: string): Promise<TrialStatus> {
  const i = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: { trialEndsAt: true, trialActivatedAt: true, trialMaxCameras: true },
  })
  if (!i || !i.trialEndsAt) {
    return {
      isTrial: false, isActive: true, daysRemaining: 999,
      endsAt: null, activatedAt: null,
      maxCameras: 0, camerasUsed: 0, camerasOverLimit: false,
    }
  }
  const now = Date.now()
  const endsMs = i.trialEndsAt.getTime()
  const daysRemaining = Math.ceil((endsMs - now) / (1000 * 60 * 60 * 24))
  const isActive = endsMs > now

  // Conta câmeras ativas do tenant
  const camerasUsed = await prisma.camera.count({
    where: {
      site: { clienteFinal: { integradorId } },
      status: { not: 'INACTIVE' as any },
    },
  })

  return {
    isTrial: true,
    isActive,
    daysRemaining,
    endsAt: i.trialEndsAt,
    activatedAt: i.trialActivatedAt,
    maxCameras: i.trialMaxCameras,
    camerasUsed,
    camerasOverLimit: camerasUsed > i.trialMaxCameras,
  }
}

/**
 * Cria trial num integrador existente (ou marca um recém-criado).
 * Default: 14 dias + 5 câmeras a partir de agora.
 */
export async function startTrial(
  integradorId: string,
  opts?: { days?: number; maxCameras?: number; activatedAt?: Date | null },
) {
  const days = opts?.days ?? TRIAL_DEFAULT_DAYS
  const maxCameras = opts?.maxCameras ?? TRIAL_DEFAULT_MAX_CAMERAS
  const trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

  return prisma.integrador.update({
    where: { id: integradorId },
    data: {
      trialEndsAt,
      trialActivatedAt: opts?.activatedAt ?? new Date(),
      trialMaxCameras: maxCameras,
      trialNotificationsSent: {},
      active: true,
    },
  })
}

/**
 * Estende o trial — reset notifications pra disparar lembretes novamente
 * em relação à nova data fim.
 */
export async function extendTrial(integradorId: string, addDays: number) {
  const i = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: { trialEndsAt: true },
  })
  if (!i || !i.trialEndsAt) throw new Error('integrador_not_in_trial')
  const newEnd = new Date(i.trialEndsAt.getTime() + addDays * 24 * 60 * 60 * 1000)
  return prisma.integrador.update({
    where: { id: integradorId },
    data: { trialEndsAt: newEnd, trialNotificationsSent: {}, active: true },
  })
}

/**
 * Converte trial em pagante: limpa campos de trial + marca conversion.
 * Audit log fica fora — o caller (rota) grava com contexto adequado.
 */
export async function convertTrialToPaid(integradorId: string) {
  return prisma.integrador.update({
    where: { id: integradorId },
    data: {
      trialEndsAt: null,
      trialActivatedAt: null,
      trialNotificationsSent: undefined,
      active: true,
    },
  })
}

/**
 * Cancela trial — suspende imediatamente (active=false) sem aguardar cron.
 */
export async function cancelTrial(integradorId: string) {
  return prisma.integrador.update({
    where: { id: integradorId },
    data: { active: false },
  })
}

/**
 * Calcula em qual estágio (T-7/T-3/T-1/T-0/EXPIRED) o trial está agora.
 * Retorna null se ainda não é hora de notificar nada.
 */
export function trialStageNow(endsAt: Date): TrialStage | null {
  const now = Date.now()
  const endsMs = endsAt.getTime()
  const daysRemaining = (endsMs - now) / (1000 * 60 * 60 * 24)
  if (daysRemaining <= 0) return 'EXPIRED'
  if (daysRemaining <= 1) return 'T-0'
  if (daysRemaining <= 1.5) return 'T-1'
  if (daysRemaining <= 3) return 'T-3'
  if (daysRemaining <= 7) return 'T-7'
  return null
}

/**
 * Marca um estágio de notificação como enviado.
 * Idempotente — se já estiver marcado, não duplica.
 */
export async function markNotificationSent(integradorId: string, stage: TrialStage) {
  const i = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: { trialNotificationsSent: true },
  })
  const current = (i?.trialNotificationsSent as Record<string, string> | null) ?? {}
  if (current[stage]) return  // já enviado
  current[stage] = new Date().toISOString()
  await prisma.integrador.update({
    where: { id: integradorId },
    data: { trialNotificationsSent: current },
  })
}

/**
 * Verifica se uma notificação já foi enviada — evita duplicação no cron.
 */
export function notificationAlreadySent(
  trialNotificationsSent: Record<string, string> | null | undefined,
  stage: TrialStage,
): boolean {
  return !!(trialNotificationsSent ?? {})[stage]
}

/**
 * Loop principal do cron — processa todos os trials.
 *
 * Para cada integrador com `trialEndsAt`:
 *   1. Calcula estágio atual (T-7/T-3/T-1/T-0/EXPIRED)
 *   2. Se já não enviou esse estágio → envia + marca
 *   3. Se EXPIRED → suspende active=false
 */
export async function processAllTrials(): Promise<{
  processed: number
  expired: number
  notified: { stage: TrialStage; count: number }[]
}> {
  const trials = await prisma.integrador.findMany({
    where: { trialEndsAt: { not: null } },
    select: {
      id: true, name: true, email: true,
      trialEndsAt: true, trialNotificationsSent: true, active: true,
    },
  })

  const notified: Record<TrialStage, number> = { 'T-7': 0, 'T-3': 0, 'T-1': 0, 'T-0': 0, 'EXPIRED': 0 }
  let expired = 0

  for (const t of trials) {
    if (!t.trialEndsAt) continue
    const stage = trialStageNow(t.trialEndsAt)
    if (!stage) continue

    const already = notificationAlreadySent(t.trialNotificationsSent as any, stage)
    if (already) continue

    if (stage === 'EXPIRED') {
      // Suspende
      if (t.active) {
        await prisma.integrador.update({
          where: { id: t.id },
          data: { active: false },
        })
        expired++
        logger.warn({ integradorId: t.id, name: t.name }, 'trial_expired_suspended')
      }
    } else {
      // Lembrete: por enquanto só log + audit. Email/WhatsApp vai por outro service
      // quando SMTP estiver configurado (capability email do WL).
      logger.info({ integradorId: t.id, name: t.name, stage }, 'trial_reminder_due')
    }

    await markNotificationSent(t.id, stage)
    notified[stage]++

    // Audit log
    try {
      await prisma.auditLog.create({
        data: {
          integradorId: t.id,
          action: stage === 'EXPIRED' ? 'TRIAL_EXPIRED' : `TRIAL_REMINDER_${stage}`,
          resource: 'Integrador',
          resourceId: t.id,
          metadataJson: { stage, daysRemaining: Math.ceil((t.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) },
        },
      })
    } catch (err) {
      logger.warn({ err }, 'trial_audit_failed')
    }
  }

  return {
    processed: trials.length,
    expired,
    notified: (Object.keys(notified) as TrialStage[]).map(stage => ({ stage, count: notified[stage] })),
  }
}
