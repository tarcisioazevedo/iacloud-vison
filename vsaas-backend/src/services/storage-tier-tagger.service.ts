/**
 * Storage Tier Tagger (2026-05-12) — marca segments antigos como COLD.
 *
 * Não move objetos no R2 (lifecycle real fica pra Fase D quando R2 IA sair).
 * Hoje o serviço só atualiza a coluna `storageTier` por idade — útil pra:
 *   - Dashboards mostrarem distribuição HOT/COLD do storage de cada cliente
 *   - Billing futuro diferenciar preço por tier
 *   - Operador identificar candidatos a lifecycle quando R2 IA virar GA
 *
 * Regra (configurável via env):
 *   - hasEvent=true OR criticality=EVIDENCE/MISSION_CRITICAL → fica HOT pra sempre
 *   - Demais segments com `endedAt < now - HOT_DAYS` → vira COLD
 *
 * Cron diário 04h UTC. Atualiza em batch (5000/tick) com UPDATE em massa,
 * sem percorrer um a um.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const HOT_DAYS  = Number(process.env.STORAGE_TIER_HOT_DAYS ?? 7)
const BATCH     = Number(process.env.STORAGE_TIER_BATCH ?? 5000)
const TICK_MS   = Number(process.env.STORAGE_TIER_TICK_MS ?? 24 * 60 * 60 * 1000)
const ENABLED   = process.env.STORAGE_TIER_TAGGER_ENABLED !== 'false'

let timer: NodeJS.Timeout | null = null

async function tick(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - HOT_DAYS * 24 * 60 * 60 * 1000)

    // Atualiza em SQL raw pra evitar buscar→update em loop.
    // Critério: ainda HOT, mais velho que cutoff, sem evento/motion, câmera
    // não-evidência (legal hold se manifesta em criticality).
    const result = await prisma.$executeRaw`
      UPDATE "RecordingSegment" rs
      SET "storageTier" = 'COLD'
      FROM "Camera" c
      WHERE rs."cameraId" = c."id"
        AND rs."storageTier" = 'HOT'
        AND rs."endedAt" < ${cutoff}
        AND rs."hasEvent" = false
        AND c."criticality" NOT IN ('EVIDENCE', 'MISSION_CRITICAL')
        AND rs."id" IN (
          SELECT "id" FROM "RecordingSegment"
          WHERE "storageTier" = 'HOT'
            AND "endedAt" < ${cutoff}
            AND "hasEvent" = false
          ORDER BY "endedAt" ASC
          LIMIT ${BATCH}
        )
    `

    if (result > 0) {
      logger.info({ tagged: result, cutoff, hotDays: HOT_DAYS },
        'storage_tier_tagger_cold')
    }
  } catch (err) {
    logger.warn({ err }, 'storage_tier_tagger_failed')
  }
}

export const storageTierTagger = {
  start(): void {
    if (!ENABLED) {
      logger.info('storage_tier_tagger_disabled')
      return
    }
    if (timer) return
    logger.info({ tickMs: TICK_MS, hotDays: HOT_DAYS, batch: BATCH },
      'storage_tier_tagger_starting')
    // Tick imediato pra processar pendências do boot
    tick().catch(() => {})
    timer = setInterval(() => { tick().catch(() => {}) }, TICK_MS)
  },
  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },
  /** Pra debug — dispara tick sob demanda. */
  async tickNow(): Promise<void> { return tick() },
}
