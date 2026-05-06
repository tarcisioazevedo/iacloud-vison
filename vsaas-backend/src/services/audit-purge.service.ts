/**
 * audit-purge.service.ts
 *
 * Cron diário (03:00 UTC) que apaga entradas do AuditLog mais velhas que
 * AUDIT_RETENTION_DAYS (default 180). 180 dias = mínimo razoável para
 * compliance LGPD ("direito ao acesso" do titular pode pedir histórico
 * recente; deletar antes pode comprometer a resposta).
 *
 * Implementação: setInterval-based (mesmo padrão de sales-cron.service.ts
 * e digest.service.ts). Sem dependência externa de cron lib.
 *
 * Configuração via env:
 *   AUDIT_RETENTION_DAYS=180   (default — 180 dias)
 *   AUDIT_PURGE_HOUR_UTC=3     (default — 03:00 UTC)
 *
 * Operação:
 *   - Roda 1x por dia (idempotente: state lastRunDate evita re-execução)
 *   - DELETE com WHERE createdAt < (now - retention) — usa index covering
 *   - Limita 50k registros por execução para não travar DB em DBs grandes
 *   - Loga total deletado + duração para observabilidade
 *
 * Para desabilitar (dev/test): AUDIT_RETENTION_DAYS=0 → service não inicia.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS ?? '180', 10)
const PURGE_HOUR_UTC = parseInt(process.env.AUDIT_PURGE_HOUR_UTC ?? '3', 10)
const CHECK_INTERVAL_MS = 60 * 60 * 1000  // checa de hora em hora se é hora de rodar
const MAX_DELETE_PER_RUN = 50_000          // safety cap

const STATE = { lastRunDate: '' }
let timer: NodeJS.Timeout | null = null

function todayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function shouldRun(): boolean {
  if (RETENTION_DAYS <= 0) return false
  const nowUtc = new Date()
  if (nowUtc.getUTCHours() < PURGE_HOUR_UTC) return false
  return STATE.lastRunDate !== todayKeyUtc()
}

async function runPurge(): Promise<void> {
  STATE.lastRunDate = todayKeyUtc()
  const startedAt = Date.now()
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  try {
    // Postgres deleteMany não suporta LIMIT — fazemos em loop até estourar
    // o cap ou não ter mais o que deletar.
    let totalDeleted = 0
    let batchCount = 0
    while (totalDeleted < MAX_DELETE_PER_RUN) {
      // findMany pega ids antigos em batches; deleteMany usa esses ids.
      // Isso garante deletar exatamente o que queremos sem race condition.
      const old = await prisma.auditLog.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: Math.min(5_000, MAX_DELETE_PER_RUN - totalDeleted),
      })
      if (old.length === 0) break
      const result = await prisma.auditLog.deleteMany({
        where: { id: { in: old.map(o => o.id) } },
      })
      totalDeleted += result.count
      batchCount++
      // Pequeno respiro pra não saturar I/O
      await new Promise(r => setTimeout(r, 100))
    }

    const durationMs = Date.now() - startedAt
    logger.info(
      { deleted: totalDeleted, batches: batchCount, retentionDays: RETENTION_DAYS, cutoff: cutoff.toISOString(), durationMs },
      'audit_purge.completed',
    )
  } catch (err) {
    logger.error({ err }, 'audit_purge.failed')
  }
}

export function startAuditPurgeService(): void {
  if (timer) return
  if (RETENTION_DAYS <= 0) {
    logger.info('audit_purge.disabled (AUDIT_RETENTION_DAYS=0)')
    return
  }
  logger.info({ retentionDays: RETENTION_DAYS, purgeHourUtc: PURGE_HOUR_UTC }, 'audit_purge.scheduled')
  timer = setInterval(() => {
    if (shouldRun()) runPurge().catch(err => logger.error({ err }, 'audit_purge.tick_failed'))
  }, CHECK_INTERVAL_MS)
  // Permite o processo encerrar sem aguardar o timer
  if (timer.unref) timer.unref()
}

export function stopAuditPurgeService(): void {
  if (timer) { clearInterval(timer); timer = null }
}
