/**
 * Box Suspend Cron — auto-suspende boxes sem heartbeat há > 7 dias.
 *
 * Por que existe:
 *   Box que ficou abandonada (cliente foi embora, equipamento queimou,
 *   foi roubado) continua "tecnicamente válida" no DB e suas câmeras
 *   continuam em `recordingConfig` esperando upload. Suspender automaticamente
 *   após 7d:
 *     1. Bloqueia uploads acidentais (todas rotas /iacv-box/* rejeitam
 *        com 403 UNLICENSED quando status = SUSPENDED — middleware
 *        `assert-box-ownership` linha 81: licensed = status !== SUSPENDED)
 *     2. Sinaliza ao operador que precisa investigar
 *     3. Libera quota/billing
 *
 * Estratégia:
 *   - Tick a cada 6h (não precisa precisão ao minuto)
 *   - Busca EdgeNode com lastHeartbeat < NOW - 7d AND status NOT IN (SUSPENDED, DECOMMISSIONED)
 *   - Marca status = SUSPENDED
 *   - Dispatch BOX_SUSPENDED por integrador (escala pra integrador, não cliente,
 *     porque integrador é quem cuida da box fisicamente)
 *
 * Reativação:
 *   Manual via UI admin (PATCH /admin/edge-nodes/:id { status: 'ONLINE' }).
 *   Não há auto-reativação — operador precisa investigar antes.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { alertService } from './alert.service'

const TICK_MS                  = 6 * 60 * 60 * 1000  // 6h
const SUSPEND_AFTER_DAYS       = Number(process.env.BOX_SUSPEND_DAYS ?? 7)
const ENABLED                  = process.env.BOX_SUSPEND_ENABLED !== 'false'

let timer: NodeJS.Timeout | null = null

async function tick(): Promise<void> {
  const cutoff = new Date(Date.now() - SUSPEND_AFTER_DAYS * 24 * 60 * 60 * 1000)

  // Boxes inativas há > N dias
  const stale = await prisma.edgeNode.findMany({
    where: {
      lastHeartbeat: { lt: cutoff },
      status: { not: 'SUSPENDED' as any },
    },
    select: {
      id: true, serialNumber: true, lastHeartbeat: true, status: true,
      site: {
        select: {
          name: true,
          clienteFinal: {
            select: {
              id: true, name: true, integradorId: true,
              integrador: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  if (stale.length === 0) return
  logger.info({ count: stale.length, cutoff }, 'box_suspend_candidates')

  const dashboardUrl = (process.env.PUBLIC_FRONTEND_URL?.replace(/\/login$/, '') ?? 'http://localhost:5173') + '/fleet'

  for (const node of stale) {
    const cf = node.site?.clienteFinal
    if (!cf) {
      logger.warn({ nodeId: node.id }, 'box_suspend_skipped_no_cliente')
      continue
    }

    // Suspende
    try {
      await prisma.edgeNode.update({
        where: { id: node.id },
        data: { status: 'SUSPENDED' as any },
      })
    } catch (err: any) {
      logger.warn({ err: err?.message, nodeId: node.id }, 'box_suspend_update_failed')
      continue
    }

    const daysWithout = Math.floor(
      (Date.now() - (node.lastHeartbeat?.getTime() ?? 0)) / 86_400_000,
    )

    // Dispatch alerta — usa clienteFinalId pra audit/cooldown,
    // mas o template menciona integrador como dono da box.
    await alertService.dispatch({
      type:           'BOX_SUSPENDED',
      severity:       'CRITICAL',
      clienteFinalId: cf.id,
      alertKey:       `box_suspended:${node.id}`,
      payload: {
        severity:             'CRITICAL',
        edgeNodeSerial:       node.serialNumber ?? '—',
        siteName:             node.site?.name ?? '—',
        clienteName:          cf.name ?? '—',
        integradorName:       cf.integrador?.name ?? '—',
        lastHeartbeatAt:      node.lastHeartbeat?.toLocaleString('pt-BR') ?? 'nunca',
        daysWithoutHeartbeat: String(daysWithout),
        dashboardUrl,
      },
    }).catch(err => logger.warn({ err, nodeId: node.id }, 'box_suspend_dispatch_failed'))

    logger.warn({
      nodeId: node.id, serial: node.serialNumber, daysWithout,
      cliente: cf.name, integrador: cf.integrador?.name,
    }, 'box_suspended')
  }
}

export const boxSuspendCron = {
  start(): void {
    if (!ENABLED) {
      logger.info('box_suspend_cron_disabled')
      return
    }
    if (timer) return
    logger.info({
      tickMs: TICK_MS, suspendAfterDays: SUSPEND_AFTER_DAYS,
    }, 'box_suspend_cron_starting')
    // Primeiro tick depois de 1min (pra não rodar exatamente no boot)
    setTimeout(() => tick().catch(err => logger.error({ err }, 'box_suspend_initial_failed')), 60_000)
    timer = setInterval(() => {
      tick().catch(err => logger.error({ err }, 'box_suspend_tick_failed'))
    }, TICK_MS)
  },

  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },

  /** Pra debug/admin — força um tick manual. */
  async tickNow(): Promise<{ suspended: number }> {
    const before = await prisma.edgeNode.count({ where: { status: 'SUSPENDED' as any } })
    await tick()
    const after = await prisma.edgeNode.count({ where: { status: 'SUSPENDED' as any } })
    return { suspended: after - before }
  },
}
