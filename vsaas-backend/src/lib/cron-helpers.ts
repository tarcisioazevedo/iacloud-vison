/**
 * Helpers para crons/workers que precisam respeitar capability gating.
 *
 * Padrão: em vez de `for (const cliente of allClientes)`, use
 *         `await forEachClienteWithCapability(cap, fn)`.
 *
 * Por câmera, use `forEachCameraWithCapability`. Por câmera escopada por
 * subscription específica, use `getCamerasWithCapability`.
 *
 * Fonte: docs/32-IMPLEMENTACAO-CAPABILITY-GATING.md (peça 4.C)
 */
import { prisma } from './prisma'
import { canUse } from './capability-check'
import { logger } from './logger'

/**
 * Itera todos os clientes ativos, executando fn() APENAS para os que têm a capability.
 *
 * @returns contadores { processed, skipped }
 */
export async function forEachClienteWithCapability(
  capability: string,
  fn: (clienteFinalId: string) => Promise<void>,
  opts: { logScope?: string } = {},
): Promise<{ processed: number, skipped: number, errors: number }> {
  const clientes = await prisma.clienteFinal.findMany({
    where: { active: true },
    select: { id: true },
  })

  let processed = 0
  let skipped = 0
  let errors = 0

  for (const c of clientes) {
    const allowed = await canUse(c.id, capability)
    if (!allowed) {
      skipped++
      continue
    }

    try {
      await fn(c.id)
      processed++
    } catch (err) {
      errors++
      logger.error({ err, clienteFinalId: c.id, capability, scope: opts.logScope },
        'cron_per_cliente_failed')
    }
  }

  logger.info({ capability, processed, skipped, errors, scope: opts.logScope },
    'cron_per_cliente_done')
  return { processed, skipped, errors }
}

/**
 * Itera todas as câmeras ativas, executando fn() APENAS para câmeras cujo
 * cliente final dono tem a capability.
 *
 * Usado por: recording.service, ai-worker dispatcher, timelapse generator.
 */
export async function forEachCameraWithCapability(
  capability: string,
  fn: (cameraId: string, clienteFinalId: string) => Promise<void>,
  opts: { logScope?: string } = {},
): Promise<{ processed: number, skipped: number, errors: number }> {
  const cameras = await prisma.camera.findMany({
    where: { active: true },
    select: {
      id: true,
      site: { select: { clienteFinalId: true } },
    },
  })

  let processed = 0
  let skipped = 0
  let errors = 0

  for (const cam of cameras) {
    const clienteFinalId = cam.site?.clienteFinalId
    if (!clienteFinalId) { skipped++; continue }
    const allowed = await canUse(clienteFinalId, capability)
    if (!allowed) { skipped++; continue }

    try {
      await fn(cam.id, clienteFinalId)
      processed++
    } catch (err) {
      errors++
      logger.error({ err, cameraId: cam.id, capability, scope: opts.logScope },
        'cron_per_camera_failed')
    }
  }

  logger.info({ capability, processed, skipped, errors, scope: opts.logScope },
    'cron_per_camera_done')
  return { processed, skipped, errors }
}

/**
 * Versão que pre-filtra e retorna a lista (útil quando você quer fazer batch).
 */
export async function getClientesWithCapability(capability: string): Promise<string[]> {
  const clientes = await prisma.clienteFinal.findMany({
    where: { active: true },
    select: { id: true },
  })
  const allowed: string[] = []
  for (const c of clientes) {
    if (await canUse(c.id, capability)) allowed.push(c.id)
  }
  return allowed
}

export async function getCamerasWithCapability(capability: string): Promise<
  Array<{ cameraId: string, clienteFinalId: string }>
> {
  const cameras = await prisma.camera.findMany({
    where: { active: true },
    select: { id: true, site: { select: { clienteFinalId: true } } },
  })
  const result: Array<{ cameraId: string, clienteFinalId: string }> = []
  for (const cam of cameras) {
    const cid = cam.site?.clienteFinalId
    if (!cid) continue
    if (await canUse(cid, capability)) {
      result.push({ cameraId: cam.id, clienteFinalId: cid })
    }
  }
  return result
}
