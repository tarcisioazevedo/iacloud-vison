/**
 * SearchAuditService — auditoria de TODA operação de semantic search.
 *
 * Persiste em `StorageAccessLog` (model que já existe + enum extendido neste PR).
 * Best-effort: falhas de log NÃO propagam. Auditoria nunca pode quebrar uma
 * query funcional — só sinaliza no logger.
 *
 * Privacidade (LGPD):
 *  - Texto da query NÃO é persistido (pode conter dados pessoais)
 *  - Persistimos hash SHA-256 truncado (16 hex chars) — permite agregar/contar
 *    sem expor conteúdo
 *  - Para investigação forense de cross-tenant, hash + timestamp + actorId
 *    permitem cruzar com logs do app
 *
 * Ver docs/semantic-search/audit-strategy.md.
 */

import crypto from 'node:crypto'
import { prisma as defaultPrisma } from '../../lib/prisma'
import { logger } from '../../lib/logger'
import type { TenantScope, SearchModality } from './types'

// =============================================================================
// Public helpers
// =============================================================================

/**
 * Hash determinístico de query para audit log. Permite:
 *  - Agregação ("queries mais comuns") sem expor texto
 *  - Detecção de padrão (mesmo hash 100x/min = abuso)
 *  - Cruzamento forense via logger.info se necessário
 *
 * 16 hex chars (64 bits) — 1 colisão a cada ~2^32 queries únicas, suficiente
 * para análise de uso. Não use para crypto (não é segredo).
 */
export function hashQuery(query: string): string {
  return crypto.createHash('sha256').update(query, 'utf8').digest('hex').slice(0, 16)
}

// =============================================================================
// Types
// =============================================================================

type ActorType = 'SUPER_ADMIN' | 'INTEGRADOR' | 'USER'

interface Actor {
  type: ActorType
  id: string
  email?: string
}

interface QueryAudit {
  actor: Actor
  tenantScope: TenantScope
  query: string
  modality: SearchModality
  cameraIds?: string[]
  fromDate?: Date
  toDate?: Date
  resultsCount: number
  latencyMs: number
  success: boolean
  errorMessage?: string
  ipAddress?: string
  userAgent?: string
}

interface ReindexAudit {
  actor: Actor
  integradorId: string
  framesProcessed: number
  latencyMs: number
  success: boolean
  errorMessage?: string
}

interface DeleteAudit {
  actor: Actor
  integradorId?: string
  clienteFinalId?: string
  deletedCount: number
  reason: string
}

interface BackfillAudit {
  actor: Actor
  integradorId: string
  cameraId?: string
  fromDate?: Date
  toDate?: Date
  framesQueued: number
  estimatedCostUsd: number
}

// =============================================================================
// Service
// =============================================================================

/**
 * Subset mínimo de prisma usado — facilita mock em testes.
 */
interface PrismaSubset {
  storageAccessLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>
  }
}

export class SearchAuditService {
  private prisma: PrismaSubset

  constructor(opts: { _injectedPrisma?: PrismaSubset } = {}) {
    this.prisma = opts._injectedPrisma ?? (defaultPrisma as unknown as PrismaSubset)
  }

  /** Registra uma busca semântica (sucesso ou falha). */
  async recordQuery(a: QueryAudit): Promise<void> {
    await this.safeCreate({
      actorType: a.actor.type,
      actorId: a.actor.id,
      actorEmail: a.actor.email ?? null,
      integradorId: a.tenantScope.integradorId,
      clienteFinalId: a.tenantScope.clienteFinalId,
      action: 'SEMANTIC_SEARCH',
      success: a.success,
      errorMessage: a.errorMessage ?? null,
      ipAddress: a.ipAddress ?? null,
      userAgent: a.userAgent ?? null,
      metadataJson: {
        queryHash: hashQuery(a.query),
        queryLength: a.query.length,
        modality: a.modality,
        cameraIds: a.cameraIds ?? null,
        fromDate: a.fromDate?.toISOString() ?? null,
        toDate: a.toDate?.toISOString() ?? null,
        resultsCount: a.resultsCount,
        latencyMs: a.latencyMs,
        crossTenant: a.tenantScope.isCrossTenant,
      },
    })
  }

  /** "Find similar" — variante do query (não precisa hash de texto). */
  async recordSimilar(a: Omit<QueryAudit, 'query' | 'modality'> & {
    sourceFrameId: string
    modality: 'caption' | 'image'
  }): Promise<void> {
    await this.safeCreate({
      actorType: a.actor.type,
      actorId: a.actor.id,
      actorEmail: a.actor.email ?? null,
      integradorId: a.tenantScope.integradorId,
      clienteFinalId: a.tenantScope.clienteFinalId,
      action: 'SEMANTIC_SIMILAR',
      success: a.success,
      errorMessage: a.errorMessage ?? null,
      ipAddress: a.ipAddress ?? null,
      userAgent: a.userAgent ?? null,
      metadataJson: {
        sourceFrameId: a.sourceFrameId,
        modality: a.modality,
        resultsCount: a.resultsCount,
        latencyMs: a.latencyMs,
        crossTenant: a.tenantScope.isCrossTenant,
      },
    })
  }

  /** Reindex (admin). */
  async recordReindex(a: ReindexAudit): Promise<void> {
    await this.safeCreate({
      actorType: a.actor.type,
      actorId: a.actor.id,
      actorEmail: a.actor.email ?? null,
      integradorId: a.integradorId,
      action: 'SEMANTIC_REINDEX',
      success: a.success,
      errorMessage: a.errorMessage ?? null,
      metadataJson: {
        framesProcessed: a.framesProcessed,
        latencyMs: a.latencyMs,
      },
    })
  }

  /** Exclusão (LGPD). Trail forense crítico. */
  async recordDelete(a: DeleteAudit): Promise<void> {
    await this.safeCreate({
      actorType: a.actor.type,
      actorId: a.actor.id,
      actorEmail: a.actor.email ?? null,
      integradorId: a.integradorId ?? null,
      clienteFinalId: a.clienteFinalId ?? null,
      action: 'SEMANTIC_DELETE',
      success: true,
      metadataJson: {
        deletedCount: a.deletedCount,
        reason: a.reason,
      },
    })
  }

  /** Backfill / reprocess de histórico. */
  async recordBackfill(a: BackfillAudit): Promise<void> {
    await this.safeCreate({
      actorType: a.actor.type,
      actorId: a.actor.id,
      actorEmail: a.actor.email ?? null,
      integradorId: a.integradorId,
      action: 'SEMANTIC_BACKFILL',
      success: true,
      metadataJson: {
        cameraId: a.cameraId ?? null,
        fromDate: a.fromDate?.toISOString() ?? null,
        toDate: a.toDate?.toISOString() ?? null,
        framesQueued: a.framesQueued,
        estimatedCostUsd: a.estimatedCostUsd,
      },
    })
  }

  // ─── Helper privado ────────────────────────────────────────────────────────

  private async safeCreate(data: Record<string, unknown>): Promise<void> {
    try {
      await this.prisma.storageAccessLog.create({ data })
    } catch (e) {
      // Best-effort: nunca quebra o caller por causa de audit.
      // Loga em stderr (Loki/Promtail capturam) pra não perder o evento.
      logger.warn({ err: String(e), data }, 'search_audit_log_failed')
    }
  }
}

// =============================================================================
// Singleton (lazy)
// =============================================================================

let _singleton: SearchAuditService | null = null
export function getSearchAuditService(): SearchAuditService {
  if (!_singleton) _singleton = new SearchAuditService()
  return _singleton
}
