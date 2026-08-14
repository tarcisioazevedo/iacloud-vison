/**
 * plan-enforcement.service.ts — Sprint 0 · Variação B.
 *
 * Verifica limites de plano do integrador ao cadastrar cliente final ou câmera.
 * Soft cap (default): permite ultrapassar (invoice-generator cobra adicional).
 * Hard cap: bloqueia o cadastro com 409 e exige upgrade.
 *
 * Lock de concorrência (M9): usa SELECT FOR UPDATE em transaction pra contar
 * atomicamente. Sem isso, 2 users do mesmo integrador adicionariam clientes
 * simultaneamente e passariam do limite mesmo no hard cap.
 *
 * Uso:
 *   await assertCanAddClienteFinal(integradorId)  // throws PlanLimitExceededError se hard cap atingido
 *   await assertCanAddCamera(integradorId)
 */
import { prisma } from '../lib/prisma'
import { Prisma } from '@prisma/client'

export class PlanLimitExceededError extends Error {
  constructor(
    public resource: 'clientes' | 'cameras',
    public limit: number,
    public current: number,
    public planName: string,
  ) {
    super(`Limite do plano "${planName}" atingido: ${resource} ${current}/${limit}`)
    this.name = 'PlanLimitExceededError'
  }
}

interface EnforcementSnapshot {
  enforcementMode: 'soft' | 'hard' | string
  planName:       string
  limit:          number | null
  current:        number
}

/**
 * Snapshot do limite + uso atual SEM lock — pra dashboards/previews.
 * Para checagens durante criação real, use `assertCanAddX` (com lock).
 */
export async function getClienteFinalSnapshot(integradorId: string): Promise<EnforcementSnapshot> {
  const integ = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: {
      maxClientesFinaisOverride: true,
      plan: { select: { name: true, maxClientesFinais: true, enforcementMode: true } },
    },
  })
  if (!integ?.plan) {
    return { enforcementMode: 'soft', planName: 'sem plano', limit: null, current: 0 }
  }
  const limit = integ.maxClientesFinaisOverride ?? integ.plan.maxClientesFinais ?? null
  const current = await prisma.clienteFinal.count({ where: { integradorId, active: true } })
  return {
    enforcementMode: integ.plan.enforcementMode,
    planName:       integ.plan.name,
    limit,
    current,
  }
}

export async function getCameraSnapshot(integradorId: string): Promise<EnforcementSnapshot> {
  const integ = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: {
      maxCamerasOverride: true,
      plan: { select: { name: true, maxCameras: true, enforcementMode: true } },
    },
  })
  if (!integ?.plan) {
    return { enforcementMode: 'soft', planName: 'sem plano', limit: null, current: 0 }
  }
  const limit = integ.maxCamerasOverride ?? integ.plan.maxCameras ?? null
  const current = await prisma.camera.count({
    where: { active: true, site: { clienteFinal: { integradorId, active: true } } },
  })
  return {
    enforcementMode: integ.plan.enforcementMode,
    planName:       integ.plan.name,
    limit,
    current,
  }
}

/**
 * Verifica + lock concorrência. Chamar DENTRO de uma transaction ou criar uma.
 *
 * Usa SELECT ... FOR UPDATE na linha do Integrador pra serializar checagens
 * concorrentes do mesmo tenant. Custo: lock até o COMMIT da transaction.
 *
 * Soft cap: nunca lança — log e segue.
 * Hard cap: lança PlanLimitExceededError se ultrapassaria o limite.
 */
export async function assertCanAddClienteFinal(integradorId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    // Lock atomic na linha do Integrador
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "Integrador" WHERE id = ${integradorId} FOR UPDATE
    `)

    const integ = await tx.integrador.findUnique({
      where: { id: integradorId },
      select: {
        maxClientesFinaisOverride: true,
        plan: { select: { name: true, maxClientesFinais: true, enforcementMode: true } },
      },
    })
    if (!integ?.plan) return // sem plano = sem enforcement (legado)

    const limit = integ.maxClientesFinaisOverride ?? integ.plan.maxClientesFinais ?? null
    if (limit == null) return // ilimitado

    const current = await tx.clienteFinal.count({ where: { integradorId, active: true } })

    if (current >= limit) {
      if (integ.plan.enforcementMode === 'hard') {
        throw new PlanLimitExceededError('clientes', limit, current, integ.plan.name)
      }
      // soft cap: invoice-generator cobrará adicional no próximo ciclo
    }
  }, { isolationLevel: 'Serializable' })
}

export async function assertCanAddCamera(integradorId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "Integrador" WHERE id = ${integradorId} FOR UPDATE
    `)

    const integ = await tx.integrador.findUnique({
      where: { id: integradorId },
      select: {
        maxCamerasOverride: true,
        plan: { select: { name: true, maxCameras: true, enforcementMode: true } },
      },
    })
    if (!integ?.plan) return

    const limit = integ.maxCamerasOverride ?? integ.plan.maxCameras ?? null
    if (limit == null) return

    const current = await tx.camera.count({
      where: { active: true, site: { clienteFinal: { integradorId, active: true } } },
    })

    if (current >= limit) {
      if (integ.plan.enforcementMode === 'hard') {
        throw new PlanLimitExceededError('cameras', limit, current, integ.plan.name)
      }
    }
  }, { isolationLevel: 'Serializable' })
}
