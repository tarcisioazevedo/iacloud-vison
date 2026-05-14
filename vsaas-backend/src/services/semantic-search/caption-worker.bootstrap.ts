/**
 * caption-worker.bootstrap — fábrica + singleton para iniciar o worker
 * no app.ts. Mantém deps reais (prisma, r2Storage, genai) longe da
 * implementação testável.
 *
 * Env vars:
 *   SEMANTIC_CAPTION_ENABLED       (default false — opt-in)
 *   SEMANTIC_CAPTION_BATCH_SIZE    (default 10)
 *   SEMANTIC_CAPTION_POLL_MS       (default 30000)
 *   SEMANTIC_CAPTION_CONCURRENCY   (default 3)
 *   SEMANTIC_CAPTION_MODEL         (default 'gemini-embedding-001')
 */

import { prisma } from '../../lib/prisma'
import { logger } from '../../lib/logger'
import { r2Storage } from '../r2-storage.service'
import { captionFrame } from '../genai.service'
import { CaptionWorker } from './caption-worker.service'
import { PgVectorStore } from './pgvector-store'
import { getGeminiEmbeddingService } from './gemini-embedding.service'
import { getSearchAuditService } from './search-audit.service'

let _instance: CaptionWorker | null = null

function readBoolEnv(name: string, defaultValue = false): boolean {
  const v = process.env[name]?.toLowerCase().trim()
  if (v == null || v === '') return defaultValue
  return v === '1' || v === 'true' || v === 'yes'
}

function readIntEnv(name: string, defaultValue: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : defaultValue
}

/**
 * Cria a instância singleton se ainda não existe. Idempotente.
 */
export function getCaptionWorker(): CaptionWorker {
  if (_instance) return _instance

  const embedSvc = getGeminiEmbeddingService()
  const store = new PgVectorStore()

  _instance = new CaptionWorker(
    {
      prisma,
      downloadThumbnail: (integradorId, key) => r2Storage.getBuffer(integradorId, key),
      captionImage: (jpeg) => captionFrame(jpeg),
      embedText: (text) => embedSvc.embed(text),
      vectorStore: store,
      audit: getSearchAuditService(),
      logger: logger.child({ component: 'caption-worker' }),
    },
    {
      batchSize: readIntEnv('SEMANTIC_CAPTION_BATCH_SIZE', 10),
      pollIntervalMs: readIntEnv('SEMANTIC_CAPTION_POLL_MS', 30_000),
      concurrency: readIntEnv('SEMANTIC_CAPTION_CONCURRENCY', 3),
      embeddingModel: process.env.SEMANTIC_CAPTION_MODEL ?? 'gemini-embedding-001',
    },
  )

  return _instance
}

/**
 * Inicia o worker se `SEMANTIC_CAPTION_ENABLED=true`.
 * Loga decisão pro operador.
 * Idempotente — chamar várias vezes não duplica timers.
 */
export function startCaptionWorkerIfEnabled(): void {
  const enabled = readBoolEnv('SEMANTIC_CAPTION_ENABLED', false)
  if (!enabled) {
    logger.info(
      { feature: 'semantic-search.caption-worker', enabled: false },
      'caption_worker_disabled (set SEMANTIC_CAPTION_ENABLED=true to activate)',
    )
    return
  }

  const embedSvc = getGeminiEmbeddingService()
  if (!embedSvc.isAvailable()) {
    logger.warn(
      'caption_worker_enabled_but_gemini_key_missing — set GEMINI_API_KEY or /run/secrets/gemini_api_key',
    )
    return
  }

  const worker = getCaptionWorker()
  worker.start()
}

/** Para o worker (uso em shutdown / testes). */
export function stopCaptionWorker(): void {
  if (_instance) _instance.stop()
}
