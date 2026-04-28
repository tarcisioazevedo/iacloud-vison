/**
 * Job: limpar referências de evidências expiradas no DB.
 * O GCS apaga os arquivos automaticamente (lifecycle rule).
 * Este job apenas nulifica as referências no PostgreSQL.
 * Cron: "0 * * * *" (toda hora)
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

export async function runEvidenceCleanup(): Promise<void> {
  const { count } = await prisma.analyticsEvent.updateMany({
    where: {
      evidenceExpiry:   { lt: new Date() },
      evidenceGcsKey:   { not: null },
    },
    data: {
      evidenceGcsBucket: null,
      evidenceGcsKey:    null,
    },
  })

  if (count > 0) {
    logger.info({ cleared: count }, 'evidence_refs_cleared')
  }
}
