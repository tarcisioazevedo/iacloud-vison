/**
 * PgVectorStore — implementação pgvector de IVectorStore.
 *
 * Storage: tabela `DetectionFrame` com colunas `captionEmbedding` e
 * `imageEmbedding` do tipo `vector(768)`. Index HNSW por modalidade.
 * Multi-tenancy via colunas denormalizadas (integradorId, clienteFinalId)
 * + WHERE em toda query.
 *
 * Performance esperada:
 *  - Insert: ~5ms (single) / ~50ms (batch de 50)
 *  - Search: <50ms p95 com filtros tenant + tempo, base de 100k vetores
 *  - Search global (cross-tenant): pode degradar; só permitido pra SUPER_ADMIN
 *
 * Ver docs/semantic-search/.
 */

import { prisma } from '../../lib/prisma'
import { logger } from '../../lib/logger'
import type {
  TenantScope,
  SearchModality,
  SearchHit,
  UpsertEmbeddingsInput,
  RawVecHit,
  ZScoreStats,
} from './types'
import type { IVectorStore } from './vector-store.interface'
import {
  toVectorLiteral,
  buildScopeWhere,
  mergeWithZScore,
  assertEmbeddingDim,
} from './pgvector-store-helpers'

const TOP_K_PER_MODALITY = 100 // espelha Frigate; ajustável depois
const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export class PgVectorStore implements IVectorStore {
  // ─── Upsert ────────────────────────────────────────────────────────────────

  async upsert(input: UpsertEmbeddingsInput): Promise<void> {
    if (input.captionEmbedding) assertEmbeddingDim(input.captionEmbedding, 'captionEmbedding')
    if (input.imageEmbedding) assertEmbeddingDim(input.imageEmbedding, 'imageEmbedding')

    const captionVec = input.captionEmbedding ? toVectorLiteral(input.captionEmbedding) : null
    const imageVec = input.imageEmbedding ? toVectorLiteral(input.imageEmbedding) : null
    const model = input.embeddingModel ?? 'gemini-embedding-001'
    const version = input.embeddingVersion ?? 1

    // Raw SQL porque Prisma não tem suporte nativo a Unsupported("vector") em update.
    // UPDATE simples: o DetectionFrame já foi criado pelo ai-worker via /detections/ingest.
    await prisma.$executeRaw`
      UPDATE "DetectionFrame"
      SET
        "captionText"      = COALESCE(${input.captionText ?? null}, "captionText"),
        "captionEmbedding" = COALESCE(${captionVec}::vector, "captionEmbedding"),
        "imageEmbedding"   = COALESCE(${imageVec}::vector, "imageEmbedding"),
        "embeddingModel"   = ${model},
        "embeddingVersion" = ${version},
        "captionedAt"      = NOW(),
        "captionError"     = NULL
      WHERE id = ${input.frameId}
    `
  }

  async upsertBatch(inputs: UpsertEmbeddingsInput[]): Promise<void> {
    // Em transação. Pra batch grande, considere CTE única no futuro.
    await prisma.$transaction(async (tx) => {
      for (const input of inputs) {
        // Reutiliza a mesma lógica mas dentro da transação.
        if (input.captionEmbedding) assertEmbeddingDim(input.captionEmbedding, 'captionEmbedding')
        if (input.imageEmbedding) assertEmbeddingDim(input.imageEmbedding, 'imageEmbedding')
        const captionVec = input.captionEmbedding ? toVectorLiteral(input.captionEmbedding) : null
        const imageVec = input.imageEmbedding ? toVectorLiteral(input.imageEmbedding) : null
        const model = input.embeddingModel ?? 'gemini-embedding-001'
        const version = input.embeddingVersion ?? 1
        await tx.$executeRaw`
          UPDATE "DetectionFrame"
          SET
            "captionText"      = COALESCE(${input.captionText ?? null}, "captionText"),
            "captionEmbedding" = COALESCE(${captionVec}::vector, "captionEmbedding"),
            "imageEmbedding"   = COALESCE(${imageVec}::vector, "imageEmbedding"),
            "embeddingModel"   = ${model},
            "embeddingVersion" = ${version},
            "captionedAt"      = NOW(),
            "captionError"     = NULL
          WHERE id = ${input.frameId}
        `
      }
    })
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  async search(
    queryEmbedding: Float32Array,
    opts: {
      modality: SearchModality
      tenantScope: TenantScope
      fromDate?: Date
      toDate?: Date
      limit?: number
    },
  ): Promise<SearchHit[]> {
    assertEmbeddingDim(queryEmbedding, 'queryEmbedding')
    const limit = clampLimit(opts.limit)
    const queryVec = toVectorLiteral(queryEmbedding)

    if (opts.modality === 'caption' || opts.modality === 'image') {
      return this.searchSingleModality(queryVec, opts.modality, opts, limit)
    }

    // merge — roda nas duas e faz z-score
    const [captionRaw, imageRaw] = await Promise.all([
      this.searchVecOnly(queryVec, 'caption', opts),
      this.searchVecOnly(queryVec, 'image', opts),
    ])
    if (captionRaw.length === 0 && imageRaw.length === 0) return []

    const integradorIdForStats =
      opts.tenantScope.integradorId ?? '__cross_tenant__' // stats globais separadas
    const [capStats, imgStats] = await Promise.all([
      this.getStats(integradorIdForStats, 'caption'),
      this.getStats(integradorIdForStats, 'image'),
    ])
    const merged = mergeWithZScore(captionRaw, imageRaw, capStats, imgStats).slice(0, limit)

    // Hidrata com metadados
    return this.hydrateHits(merged.map(m => ({ frameId: m.frameId, distance: m.zScore, source: m.source })))
  }

  /** Implementação interna — modalidade única + hidratação + scope. */
  private async searchSingleModality(
    queryVec: string,
    modality: 'caption' | 'image',
    opts: { tenantScope: TenantScope; fromDate?: Date; toDate?: Date },
    limit: number,
  ): Promise<SearchHit[]> {
    const column = modality === 'caption' ? 'captionEmbedding' : 'imageEmbedding'
    const where = buildScopeWhere(opts.tenantScope)
    const timeWhere = buildTimeWhere(opts.fromDate, opts.toDate, where.params.length)
    const sql = `
      SELECT
        df.id,
        df."cameraId",
        df."siteId",
        df."clienteFinalId",
        df."integradorId",
        df."timestamp",
        df."objectType",
        df."bboxX", df."bboxY", df."bboxW", df."bboxH",
        df."captionText",
        df."thumbnailKey",
        df."${column}" <=> $${where.params.length + timeWhere.extraParams.length + 1}::vector AS distance,
        c.name AS camera_name,
        s.name AS site_name,
        cf.name AS cliente_name
      FROM "DetectionFrame" df
      JOIN "Camera" c       ON c.id = df."cameraId"
      JOIN "Site" s         ON s.id = df."siteId"
      JOIN "ClienteFinal" cf ON cf.id = df."clienteFinalId"
      WHERE
        ${where.sql}
        ${timeWhere.sql}
        AND df."${column}" IS NOT NULL
      ORDER BY df."${column}" <=> $${where.params.length + timeWhere.extraParams.length + 1}::vector
      LIMIT $${where.params.length + timeWhere.extraParams.length + 2}
    `
    const params = [...where.params, ...timeWhere.extraParams, queryVec, limit]
    const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params)

    return rows.map(r => this.rowToHit(r, modality))
  }

  /** Versão "raw" — só pega ids + distance para depois mergear. */
  private async searchVecOnly(
    queryVec: string,
    modality: 'caption' | 'image',
    opts: { tenantScope: TenantScope; fromDate?: Date; toDate?: Date },
  ): Promise<RawVecHit[]> {
    const column = modality === 'caption' ? 'captionEmbedding' : 'imageEmbedding'
    const where = buildScopeWhere(opts.tenantScope)
    const timeWhere = buildTimeWhere(opts.fromDate, opts.toDate, where.params.length)
    const sql = `
      SELECT id, "${column}" <=> $${where.params.length + timeWhere.extraParams.length + 1}::vector AS distance
      FROM "DetectionFrame"
      WHERE ${where.sql} ${timeWhere.sql} AND "${column}" IS NOT NULL
      ORDER BY "${column}" <=> $${where.params.length + timeWhere.extraParams.length + 1}::vector
      LIMIT ${TOP_K_PER_MODALITY}
    `
    const params = [...where.params, ...timeWhere.extraParams, queryVec]
    const rows: Array<{ id: string; distance: number }> = await prisma.$queryRawUnsafe(sql, ...params)
    return rows.map(r => ({ frameId: r.id, distance: Number(r.distance), source: modality }))
  }

  async searchSimilar(
    frameId: string,
    opts: {
      tenantScope: TenantScope
      modality: 'caption' | 'image'
      limit?: number
    },
  ): Promise<SearchHit[]> {
    // 1) confirma acesso ao frame original
    const where = buildScopeWhere(opts.tenantScope)
    const checkRows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `SELECT id FROM "DetectionFrame" WHERE id = $${where.params.length + 1} AND ${where.sql}`,
      ...where.params,
      frameId,
    )
    if (checkRows.length === 0) {
      logger.warn({ frameId, tenantScope: opts.tenantScope }, 'searchSimilar: frame inacessível ou inexistente')
      return []
    }
    // 2) pega embedding do frame
    const column = opts.modality === 'caption' ? 'captionEmbedding' : 'imageEmbedding'
    const embRows: Array<{ emb: string | null }> = await prisma.$queryRawUnsafe(
      `SELECT "${column}"::text AS emb FROM "DetectionFrame" WHERE id = $1`,
      frameId,
    )
    if (!embRows[0]?.emb) return []
    // 3) reusa search single modality com aquele embedding (já é string vector)
    const limit = clampLimit(opts.limit)
    const queryVec = embRows[0].emb
    // Constrói SQL similar a searchSingleModality mas pulando o frame original
    const tw = buildTimeWhere(undefined, undefined, where.params.length)
    const sql = `
      SELECT
        df.id, df."cameraId", df."siteId", df."clienteFinalId", df."integradorId",
        df."timestamp", df."objectType",
        df."bboxX", df."bboxY", df."bboxW", df."bboxH",
        df."captionText", df."thumbnailKey",
        df."${column}" <=> $${where.params.length + 1}::vector AS distance,
        c.name AS camera_name,
        s.name AS site_name,
        cf.name AS cliente_name
      FROM "DetectionFrame" df
      JOIN "Camera" c        ON c.id = df."cameraId"
      JOIN "Site" s          ON s.id = df."siteId"
      JOIN "ClienteFinal" cf ON cf.id = df."clienteFinalId"
      WHERE
        ${where.sql}
        AND df.id <> $${where.params.length + 2}
        AND df."${column}" IS NOT NULL
      ORDER BY df."${column}" <=> $${where.params.length + 1}::vector
      LIMIT $${where.params.length + 3}
    `
    void tw // unused (no time filter on similar)
    const params = [...where.params, queryVec, frameId, limit]
    const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params)
    return rows.map(r => this.rowToHit(r, opts.modality))
  }

  // ─── Exclusão ──────────────────────────────────────────────────────────────

  async deleteByIntegrador(integradorId: string): Promise<number> {
    const result: Array<{ count: bigint }> = await prisma.$queryRaw`
      WITH updated AS (
        UPDATE "DetectionFrame"
        SET "captionEmbedding" = NULL,
            "imageEmbedding"   = NULL,
            "captionText"      = NULL,
            "captionedAt"      = NULL,
            "captionError"     = 'tenant_deleted'
        WHERE "integradorId" = ${integradorId}
          AND ("captionEmbedding" IS NOT NULL OR "imageEmbedding" IS NOT NULL)
        RETURNING id
      )
      SELECT COUNT(*)::bigint AS count FROM updated
    `
    const n = Number(result[0]?.count ?? 0)
    logger.info({ integradorId, deletedEmbeddings: n }, 'deleteByIntegrador completed')
    return n
  }

  async deleteByClienteFinal(clienteFinalId: string): Promise<number> {
    const result: Array<{ count: bigint }> = await prisma.$queryRaw`
      WITH updated AS (
        UPDATE "DetectionFrame"
        SET "captionEmbedding" = NULL,
            "imageEmbedding"   = NULL,
            "captionText"      = NULL,
            "captionedAt"      = NULL,
            "captionError"     = 'cliente_deleted'
        WHERE "clienteFinalId" = ${clienteFinalId}
          AND ("captionEmbedding" IS NOT NULL OR "imageEmbedding" IS NOT NULL)
        RETURNING id
      )
      SELECT COUNT(*)::bigint AS count FROM updated
    `
    return Number(result[0]?.count ?? 0)
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  async health() {
    try {
      const [ext]: Array<{ has_vector: boolean }> = await prisma.$queryRaw`
        SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector
      `
      const [idx]: Array<{ has_hnsw: boolean }> = await prisma.$queryRaw`
        SELECT EXISTS(
          SELECT 1 FROM pg_indexes
          WHERE indexname = 'DetectionFrame_captionEmbedding_hnsw_idx'
        ) AS has_hnsw
      `
      const [counts]: Array<{ total: bigint; pending: bigint }> = await prisma.$queryRaw`
        SELECT
          COUNT(*) FILTER (WHERE "captionEmbedding" IS NOT NULL OR "imageEmbedding" IS NOT NULL)::bigint AS total,
          COUNT(*) FILTER (WHERE "captionedAt" IS NULL AND "thumbnailKey" IS NOT NULL)::bigint AS pending
        FROM "DetectionFrame"
      `
      return {
        ok: ext.has_vector && idx.has_hnsw,
        backend: 'pgvector' as const,
        indexesReady: idx.has_hnsw,
        totalEmbeddings: Number(counts.total),
        pendingCaption: Number(counts.pending),
      }
    } catch (e) {
      return {
        ok: false,
        backend: 'pgvector' as const,
        indexesReady: false,
        totalEmbeddings: 0,
        pendingCaption: 0,
        error: String(e),
      }
    }
  }

  // ─── Stats (z-score por integrador) ────────────────────────────────────────

  private async getStats(integradorId: string, modality: 'caption' | 'image'): Promise<ZScoreStats> {
    const row = await prisma.searchStats.findUnique({
      where: { integradorId_modality: { integradorId, modality } },
    })
    if (!row) {
      return { integradorId, modality, mean: 0, variance: 1, n: 0 }
    }
    return {
      integradorId: row.integradorId,
      modality: row.modality as 'caption' | 'image',
      mean: row.mean,
      variance: row.variance,
      n: row.n,
    }
  }

  // ─── Helpers privados ──────────────────────────────────────────────────────

  private rowToHit(r: any, source: SearchModality): SearchHit {
    const distance = Number(r.distance)
    return {
      id: r.id,
      distance,
      // sigmoid invertida: 1/(1+e^z) — z<0 (mais relevante) gera confidence alta
      confidence: 1 / (1 + Math.exp(distance)),
      source,
      cameraId: r.cameraId,
      cameraName: r.camera_name ?? null,
      siteId: r.siteId,
      siteName: r.site_name ?? null,
      clienteFinalId: r.clienteFinalId,
      clienteFinalName: r.cliente_name ?? null,
      integradorId: r.integradorId,
      timestamp: new Date(r.timestamp),
      objectType: r.objectType,
      bboxX: Number(r.bboxX),
      bboxY: Number(r.bboxY),
      bboxW: Number(r.bboxW),
      bboxH: Number(r.bboxH),
      captionText: r.captionText ?? null,
      thumbnailKey: r.thumbnailKey ?? null,
    }
  }

  private async hydrateHits(rawHits: RawVecHit[]): Promise<SearchHit[]> {
    if (rawHits.length === 0) return []
    const ids = rawHits.map(h => h.frameId)
    const sourceById = new Map(rawHits.map(h => [h.frameId, h.source]))
    const distanceById = new Map(rawHits.map(h => [h.frameId, h.distance]))

    const rows: any[] = await prisma.$queryRaw`
      SELECT
        df.id, df."cameraId", df."siteId", df."clienteFinalId", df."integradorId",
        df."timestamp", df."objectType",
        df."bboxX", df."bboxY", df."bboxW", df."bboxH",
        df."captionText", df."thumbnailKey",
        c.name AS camera_name,
        s.name AS site_name,
        cf.name AS cliente_name
      FROM "DetectionFrame" df
      JOIN "Camera" c        ON c.id = df."cameraId"
      JOIN "Site" s          ON s.id = df."siteId"
      JOIN "ClienteFinal" cf ON cf.id = df."clienteFinalId"
      WHERE df.id = ANY(${ids})
    `
    return rows
      .map(r => ({ ...r, distance: distanceById.get(r.id) ?? 0 }))
      .map(r => this.rowToHit(r, sourceById.get(r.id) ?? 'caption'))
      // Preserva ordem dos rawHits (ranking)
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
  }
}

// =============================================================================
// Helpers privados
// =============================================================================

function clampLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)))
}

interface TimeWhereResult {
  sql: string
  extraParams: unknown[]
}

function buildTimeWhere(from: Date | undefined, to: Date | undefined, startIdx: number): TimeWhereResult {
  const parts: string[] = []
  const extra: unknown[] = []
  if (from) {
    extra.push(from)
    parts.push(`AND df."timestamp" >= $${startIdx + extra.length}`)
  }
  if (to) {
    extra.push(to)
    parts.push(`AND df."timestamp" <= $${startIdx + extra.length}`)
  }
  return { sql: parts.join(' '), extraParams: extra }
}
