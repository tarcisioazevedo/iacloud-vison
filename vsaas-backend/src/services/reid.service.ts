/**
 * Reid Service — Re-identificação cross-câmera por similaridade de embedding.
 *
 * Pipeline:
 *   1. Worker envia reidEmbedding (768-dim MobileNetV3-Small L2-norm) no event_end.
 *   2. storeAndSearch() salva o embedding + busca eventos similares no pgvector.
 *   3. Se similarity >= REID_THRESHOLD, correlaciona ambos via correlatedEventId.
 *
 * Sem Gemini: puramente vetorial. Rápido, gratuito, sem latência de API.
 * Limitação: MobileNetV3-Small treinado em ImageNet (não Re-ID específico).
 *   Falsos positivos possíveis com roupas similares. Gemini como fallback futuro.
 *
 * Threshold 0.82 calibrado empiricamente (ImageNet backbone):
 *   > 0.82 = alta confiança (mesma roupa, mesma postura)
 *   0.70-0.82 = possível — registra correlatedReason mas não correlaciona
 *   < 0.70 = pessoas diferentes
 */

import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

// Cosine similarity mínima para correlacionar (1 - cosine_distance)
const REID_THRESHOLD = Number(process.env.REID_THRESHOLD ?? '0.82')

// Janela temporal de busca: só compara events nas últimas N horas
const REID_WINDOW_HOURS = Number(process.env.REID_WINDOW_HOURS ?? '2')

// Máximo de candidatos a comparar por event (limita escrita em DB)
const REID_MAX_CANDIDATES = Number(process.env.REID_MAX_CANDIDATES ?? '5')

export interface ReidCandidate {
  id: string
  cameraId: string
  cameraName: string
  startTime: Date
  endTime: Date | null
  topScore: number
  thumbnailKey: string | null
  similarity: number
}

/**
 * Salva reidEmbedding no DetectionEvent e busca eventos similares
 * em outras câmeras do mesmo integrador.
 *
 * Retorna os candidatos encontrados (para logging/debug).
 */
export async function storeAndSearch(
  eventId: string,
  cameraId: string,
  embedding: number[],
): Promise<void> {
  // 1. Persiste embedding (raw SQL pois Prisma não suporta vector nativo)
  const vectorLiteral = `[${embedding.join(',')}]`
  await prisma.$executeRaw`
    UPDATE "DetectionEvent"
    SET "reidEmbedding" = ${vectorLiteral}::vector
    WHERE id = ${eventId}
  `

  // 2. Busca integrador desta câmera (para tenant isolation)
  const cam = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: {
      site: {
        select: {
          clienteFinal: { select: { integradorId: true } },
        },
      },
    },
  })
  const integradorId = cam?.site?.clienteFinal?.integradorId
  if (!integradorId) {
    // Camera CLOUD_DIRECT sem site (dev/demo) — não busca cross-cam
    logger.debug({ eventId, cameraId }, 'reid_skip_no_integrador')
    return
  }

  // 3. Busca eventos similares em outras câmeras via pgvector (HNSW)
  type RawRow = {
    id: string
    cameraId: string
    cameraName: string
    startTime: Date
    endTime: Date | null
    topScore: number
    thumbnailKey: string | null
    similarity: number
  }

  const windowFrom = new Date(Date.now() - REID_WINDOW_HOURS * 60 * 60 * 1000)

  const candidates: RawRow[] = await prisma.$queryRaw`
    SELECT
      de.id,
      de."cameraId",
      c.name AS "cameraName",
      de."startTime",
      de."endTime",
      de."topScore",
      de."thumbnailKey",
      (1 - (de."reidEmbedding" <=> ${vectorLiteral}::vector)) AS similarity
    FROM "DetectionEvent" de
    JOIN "Camera" c ON c.id = de."cameraId"
    JOIN "Site" s ON s.id = c."siteId"
    JOIN "ClienteFinal" cf ON cf.id = s."clienteFinalId"
    WHERE cf."integradorId" = ${integradorId}
      AND de."cameraId" != ${cameraId}
      AND de."reidEmbedding" IS NOT NULL
      AND de."objectType" = 'person'
      AND de."startTime" >= ${windowFrom}
      AND de."correlatedEventId" IS NULL
      AND de.id != ${eventId}
    ORDER BY de."reidEmbedding" <=> ${vectorLiteral}::vector
    LIMIT ${REID_MAX_CANDIDATES}
  `

  if (candidates.length === 0) {
    logger.debug({ eventId }, 'reid_no_candidates')
    return
  }

  // 4. Correlaciona se similarity >= threshold
  const bestMatch = candidates[0]
  const sim = Number(bestMatch.similarity)

  logger.info({
    eventId,
    cameraId,
    bestMatchId: bestMatch.id,
    bestMatchCamera: bestMatch.cameraName,
    similarity: sim.toFixed(4),
    threshold: REID_THRESHOLD,
  }, 'reid_search_result')

  if (sim >= REID_THRESHOLD) {
    const reason = `vector_reid sim=${sim.toFixed(3)} model=mobilenet_v3_small`
    try {
      await prisma.$transaction([
        prisma.detectionEvent.update({
          where: { id: eventId },
          data: {
            correlatedEventId:    bestMatch.id,
            correlatedConfidence: sim,
            correlatedReason:     reason,
          },
        }),
        prisma.detectionEvent.update({
          where: { id: bestMatch.id },
          data: {
            correlatedEventId:    eventId,
            correlatedConfidence: sim,
            correlatedReason:     reason,
          },
        }),
      ])
      logger.info({
        eventA: eventId, eventB: bestMatch.id,
        cameraA: cameraId, cameraB: bestMatch.cameraId,
        similarity: sim.toFixed(4),
      }, 'reid_correlated')
    } catch (err: any) {
      logger.warn({ eventId, err: err.message }, 'reid_correlate_failed')
    }
  }
}

/**
 * Retorna eventos similares para um eventId dado — usado pela API frontend.
 * Busca pelo reidEmbedding do event e retorna candidatos ranqueados.
 */
export async function searchSimilarForEvent(
  eventId: string,
  limit = 10,
): Promise<ReidCandidate[]> {
  // Pega o embedding do event de referência
  const rows: Array<{ reidEmbedding: string | null }> = await prisma.$queryRaw`
    SELECT "reidEmbedding"::text AS "reidEmbedding"
    FROM "DetectionEvent"
    WHERE id = ${eventId}
  `
  const emb = rows[0]?.reidEmbedding
  if (!emb) return []

  // Mesma câmera e integrador pra contexto
  const evt = await prisma.detectionEvent.findUnique({
    where: { id: eventId },
    select: {
      cameraId: true,
      camera: {
        select: {
          site: { select: { clienteFinal: { select: { integradorId: true } } } },
        },
      },
    },
  })
  const integradorId = evt?.camera?.site?.clienteFinal?.integradorId
  if (!integradorId) return []

  const windowFrom = new Date(Date.now() - REID_WINDOW_HOURS * 60 * 60 * 1000)

  const candidates: ReidCandidate[] = await prisma.$queryRaw`
    SELECT
      de.id,
      de."cameraId",
      c.name AS "cameraName",
      de."startTime",
      de."endTime",
      de."topScore",
      de."thumbnailKey",
      (1 - (de."reidEmbedding" <=> ${emb}::vector)) AS similarity
    FROM "DetectionEvent" de
    JOIN "Camera" c ON c.id = de."cameraId"
    JOIN "Site" s ON s.id = c."siteId"
    JOIN "ClienteFinal" cf ON cf.id = s."clienteFinalId"
    WHERE cf."integradorId" = ${integradorId}
      AND de."cameraId" != ${evt!.cameraId}
      AND de."reidEmbedding" IS NOT NULL
      AND de."objectType" = 'person'
      AND de."startTime" >= ${windowFrom}
      AND de.id != ${eventId}
    ORDER BY de."reidEmbedding" <=> ${emb}::vector
    LIMIT ${limit}
  `

  return candidates.map(c => ({ ...c, similarity: Number(c.similarity) }))
}
