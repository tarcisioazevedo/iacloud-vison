/**
 * Deal Registration service.
 *
 * Lock model: apenas 1 deal APPROVED por CNPJ ao mesmo tempo.
 * Outros integradores que tentarem cadastrar Lead/Deal com mesmo CNPJ
 * recebem 409 com indicação de quem detém a exclusividade.
 *
 * Auto-extension (+15d) quando há atividade comercial registrada.
 * Auto-EXPIRED via cron diário quando passa do prazo.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

export const DEFAULT_EXCLUSIVITY_DAYS = 30
export const ACTIVITY_EXTENSION_DAYS = 15

/**
 * Normaliza CNPJ — remove formatação, deixa só dígitos.
 */
export function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}

/**
 * Validação simples de CNPJ — 14 dígitos. Não valida dígito verificador
 * pra não bloquear no MVP (podemos endurecer depois).
 */
export function isValidCnpj(cnpj: string): boolean {
  const clean = normalizeCnpj(cnpj)
  return clean.length === 14
}

/**
 * Verifica se um CNPJ está com exclusividade ativa de outro integrador.
 * Retorna o registration owner (se houver) ou null se livre.
 */
export async function checkCnpjExclusivity(
  cnpj: string,
  excludingIntegradorId?: string,
): Promise<{
  locked: boolean
  ownedBy?: { integradorId: string; integradorName: string; expiresAt: Date | null; dealId: string }
}> {
  const clean = normalizeCnpj(cnpj)
  if (!clean) return { locked: false }

  const active = await prisma.dealRegistration.findFirst({
    where: {
      cnpj: clean,
      status: 'APPROVED',
      ...(excludingIntegradorId && { integradorId: { not: excludingIntegradorId } }),
    },
    include: {
      integrador: { select: { id: true, name: true, tradeName: true } },
    },
  })

  if (!active) return { locked: false }

  return {
    locked: true,
    ownedBy: {
      integradorId: active.integradorId,
      integradorName: active.integrador.tradeName ?? active.integrador.name,
      expiresAt: active.expiresAt,
      dealId: active.id,
    },
  }
}

/**
 * Cria deal registration. Bloqueia se CNPJ já está em deal APPROVED de outro.
 */
export async function createDealRegistration(input: {
  integradorId: string
  cnpj: string
  companyName: string
  companyTradeName?: string
  contactName: string
  contactEmail?: string
  contactPhone?: string
  estimatedMrrBrl?: number
  notes?: string
}) {
  const clean = normalizeCnpj(input.cnpj)
  if (!isValidCnpj(clean)) {
    throw Object.assign(new Error('invalid_cnpj'), { code: 'invalid_cnpj' })
  }

  const exclusivity = await checkCnpjExclusivity(clean, input.integradorId)
  if (exclusivity.locked) {
    throw Object.assign(new Error('cnpj_already_locked'), {
      code: 'cnpj_already_locked',
      ownedBy: exclusivity.ownedBy,
    })
  }

  // Se o próprio integrador já tem deal pendente/aprovado pra esse CNPJ, retorna o existente
  const own = await prisma.dealRegistration.findFirst({
    where: {
      integradorId: input.integradorId,
      cnpj: clean,
      status: { in: ['PENDING', 'APPROVED'] },
    },
  })
  if (own) {
    throw Object.assign(new Error('own_deal_exists'), { code: 'own_deal_exists', existing: own })
  }

  return prisma.dealRegistration.create({
    data: {
      integradorId: input.integradorId,
      cnpj: clean,
      companyName: input.companyName,
      companyTradeName: input.companyTradeName,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      estimatedMrrBrl: input.estimatedMrrBrl,
      notes: input.notes,
      status: 'PENDING',
    },
  })
}

/**
 * SUPER_ADMIN aprova → ativa exclusividade por 30 dias.
 */
export async function approveDeal(dealId: string, approvedBy: string) {
  const deal = await prisma.dealRegistration.findUnique({ where: { id: dealId } })
  if (!deal) throw Object.assign(new Error('deal_not_found'), { code: 'deal_not_found' })
  if (deal.status !== 'PENDING') {
    throw Object.assign(new Error('not_pending'), { code: 'not_pending', current: deal.status })
  }

  // Re-checa exclusividade na hora da aprovação (race condition)
  const exclusivity = await checkCnpjExclusivity(deal.cnpj, deal.integradorId)
  if (exclusivity.locked) {
    throw Object.assign(new Error('cnpj_already_locked_at_approval'), {
      code: 'cnpj_already_locked_at_approval',
      ownedBy: exclusivity.ownedBy,
    })
  }

  const expiresAt = new Date(Date.now() + DEFAULT_EXCLUSIVITY_DAYS * 24 * 60 * 60 * 1000)
  return prisma.dealRegistration.update({
    where: { id: dealId },
    data: {
      status: 'APPROVED',
      approvedBy,
      approvedAt: new Date(),
      expiresAt,
    },
  })
}

export async function rejectDeal(dealId: string, rejectedBy: string, reason?: string) {
  const deal = await prisma.dealRegistration.findUnique({ where: { id: dealId } })
  if (!deal) throw Object.assign(new Error('deal_not_found'), { code: 'deal_not_found' })
  return prisma.dealRegistration.update({
    where: { id: dealId },
    data: {
      status: 'REJECTED',
      rejectedBy,
      rejectedAt: new Date(),
      rejectionReason: reason,
    },
  })
}

/**
 * Marca como WON quando vira contrato. Linka ao Lead/Integrador convertido.
 */
export async function markWon(dealId: string, convertedLeadId?: string) {
  return prisma.dealRegistration.update({
    where: { id: dealId },
    data: { status: 'WON', wonAt: new Date(), convertedLeadId },
  })
}

export async function markLost(dealId: string) {
  return prisma.dealRegistration.update({
    where: { id: dealId },
    data: { status: 'LOST', lostAt: new Date() },
  })
}

/**
 * Registra atividade comercial. Auto-estende +15d se houver atividade.
 */
export async function registerActivity(dealId: string) {
  const deal = await prisma.dealRegistration.findUnique({ where: { id: dealId } })
  if (!deal || deal.status !== 'APPROVED') return null

  const newExpiresAt = deal.expiresAt
    ? new Date(Math.max(deal.expiresAt.getTime(), Date.now() + ACTIVITY_EXTENSION_DAYS * 24 * 60 * 60 * 1000))
    : new Date(Date.now() + ACTIVITY_EXTENSION_DAYS * 24 * 60 * 60 * 1000)

  return prisma.dealRegistration.update({
    where: { id: dealId },
    data: { lastActivityAt: new Date(), expiresAt: newExpiresAt },
  })
}

/**
 * Cron — expira deals APPROVED com expiresAt < agora.
 */
export async function expireOldDeals(): Promise<{ expired: number }> {
  const now = new Date()
  const toExpire = await prisma.dealRegistration.findMany({
    where: {
      status: 'APPROVED',
      expiresAt: { lt: now },
    },
    select: { id: true, cnpj: true, integradorId: true },
  })
  if (toExpire.length === 0) return { expired: 0 }

  await prisma.dealRegistration.updateMany({
    where: { id: { in: toExpire.map(d => d.id) } },
    data: { status: 'EXPIRED' },
  })

  for (const d of toExpire) {
    try {
      await prisma.auditLog.create({
        data: {
          integradorId: d.integradorId,
          action: 'DEAL_REGISTRATION_EXPIRED',
          resource: 'DealRegistration',
          resourceId: d.id,
          metadataJson: { cnpj: d.cnpj },
        },
      })
    } catch { /* ignore */ }
  }

  logger.info({ count: toExpire.length }, 'deal_registrations_expired')
  return { expired: toExpire.length }
}

/**
 * Lista deals do integrador.
 */
export async function listMyDeals(integradorId: string, opts?: { status?: string }) {
  return prisma.dealRegistration.findMany({
    where: {
      integradorId,
      ...(opts?.status && { status: opts.status as any }),
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Lista todos os deals (admin) com filtros.
 */
export async function listAllDeals(opts?: { status?: string; integradorId?: string; cnpj?: string }) {
  const cleanCnpj = opts?.cnpj ? normalizeCnpj(opts.cnpj) : undefined
  return prisma.dealRegistration.findMany({
    where: {
      ...(opts?.status && { status: opts.status as any }),
      ...(opts?.integradorId && { integradorId: opts.integradorId }),
      ...(cleanCnpj && { cnpj: cleanCnpj }),
    },
    include: {
      integrador: { select: { id: true, name: true, tradeName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}
