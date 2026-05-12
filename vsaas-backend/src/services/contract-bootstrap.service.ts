/**
 * Contract Bootstrap — garante que TODO integrador tem um
 * IntegradorRetentionContract default ativo.
 *
 * Por que existe:
 *   ClienteRetentionCard mostra markup do contrato no preview de upgrade.
 *   Sem contrato, fallback era 30% hardcoded — cliente via preço estimado
 *   que não correspondia à realidade. Pior: rota POST /retention/cameras/:id/plan
 *   chamava decideUpgradeStatus que lê contract → resolveu undefined → tudo
 *   caía em PENDING.
 *
 * O que faz no boot:
 *   1. Lista todos integradores ativos
 *   2. Pra cada um sem contrato, cria um default:
 *      - defaultPlanoId: hd-7d (mais conservador, qualquer câmera nova herda)
 *      - markupPct: 30 (default histórico)
 *      - active: true
 *      - autoApprove limits: defaults do schema
 *
 *   Idempotente: roda em todo boot, só insere pra quem não tem.
 *
 * Não atualiza contratos existentes — operador edita manualmente quando
 * negocia novo % com a IA Cloud.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const DEFAULT_PLAN_SLUG = process.env.DEFAULT_RETENTION_PLAN_SLUG ?? 'hd-7d'
const DEFAULT_MARKUP_PCT = Number(process.env.DEFAULT_INTEGRADOR_MARKUP_PCT ?? 30)

export async function bootstrapIntegradorContracts(): Promise<void> {
  try {
    const defaultPlan = await prisma.retentionPlan.findUnique({
      where: { slug: DEFAULT_PLAN_SLUG },
      select: { id: true, slug: true },
    })
    if (!defaultPlan) {
      logger.warn({ slug: DEFAULT_PLAN_SLUG },
        'contract_bootstrap_default_plan_missing — pulando')
      return
    }

    const integradores = await prisma.integrador.findMany({
      where: { active: true },
      select: { id: true, name: true },
    })

    let created = 0
    for (const integ of integradores) {
      const existing = await prisma.integradorRetentionContract.findUnique({
        where: { integradorId: integ.id },
        select: { id: true },
      })
      if (existing) continue

      await prisma.integradorRetentionContract.create({
        data: {
          integradorId:   integ.id,
          defaultPlanoId: defaultPlan.id,
          markupPct:      DEFAULT_MARKUP_PCT,
          active:         true,
          notes:          'Auto-criado no boot — operador deve revisar markup',
        },
      })
      created++
      logger.info({ integradorId: integ.id, name: integ.name },
        'contract_bootstrap_created')
    }

    if (created > 0) {
      logger.info({ created, total: integradores.length },
        'contract_bootstrap_done')
    }
  } catch (err) {
    logger.warn({ err }, 'contract_bootstrap_failed')
  }
}
