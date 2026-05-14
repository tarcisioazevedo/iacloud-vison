/**
 * CaptionWorker — preenche captionText + captionEmbedding em DetectionFrames
 * recém-criadas pelo vsaas-ai-worker (ou backfill).
 *
 * Pipeline por frame:
 *   1. Download da thumbnail JPEG do R2 (via integradorId já denormalizado)
 *   2. Gemini Flash gera caption (~25 palavras PT-BR)
 *   3. Gemini Embedding 001 gera vetor 768d L2-normalizado
 *   4. PgVectorStore.upsert persiste tudo
 *
 * Resiliência:
 *  - Falha de UM frame não derruba o batch
 *  - Erros permanentes (thumbnail sumiu) → marca captionedAt + captionError,
 *    nunca mais é tentado
 *  - Erros transientes (rate limit, timeout) → mantém captionedAt NULL,
 *    captionError pra debug, será retentado na próxima rodada
 *  - Backoff implícito: workers parados por X minutos (config) entre tentativas
 *
 * Multi-tenant:
 *  - R2 bucket isolado por integradorId (já implementado em r2Storage)
 *  - Não precisa scoping aqui — frames já têm integradorId denormalizado
 *
 * Custo aproximado (Gemini 2.5 Flash + embedding 001, mai/2026):
 *  - Caption: ~$0.0005/frame
 *  - Embedding: ~$0.000001/frame
 *  - 10k frames/dia ≈ $150/mês
 *
 * Ver docs/semantic-search/caption-worker.md.
 */

import type { PrismaClient } from '@prisma/client'
import type { Logger } from 'pino'
import { DEFAULT_EMBEDDING_MODEL } from './types'
import type { IVectorStore } from './vector-store.interface'
import type { SearchAuditService } from './search-audit.service'

// =============================================================================
// Interfaces de DI — facilitam mock
// =============================================================================

export interface CaptionWorkerDeps {
  prisma: PrismaClient
  /** R2 download: integradorId + key → Buffer ou null se 404. */
  downloadThumbnail: (integradorId: string, key: string) => Promise<Buffer | null>
  /** Gemini Flash caption: JPEG → string ou null se vazio. */
  captionImage: (jpeg: Buffer) => Promise<string | null>
  /** Gemini embedding text: string → Float32Array(768). */
  embedText: (text: string) => Promise<Float32Array>
  /** Vector store para persistir o embedding. */
  vectorStore: IVectorStore
  /** Audit service (opcional — só usado em backfill explícito). */
  audit?: SearchAuditService
  /** Pino logger. */
  logger: Logger
}

export interface CaptionWorkerConfig {
  /** Quantos frames buscar por rodada. Default 10. */
  batchSize: number
  /** Intervalo entre rodadas em ms. Default 30000 (30s). */
  pollIntervalMs: number
  /** Concorrência interna por batch. Default 3 (Gemini quota-aware). */
  concurrency?: number
  /** Modelo de embedding registrado em DetectionFrame.embeddingModel. */
  embeddingModel?: string
}

export interface BatchResult {
  processed: number
  failed: number
  skipped: number
  durationMs: number
}

// =============================================================================
// Worker
// =============================================================================

export class CaptionWorker {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private busy = false
  private _totalProcessed = 0
  private _totalFailed = 0
  private _totalSkipped = 0
  private _lastRunAt: Date | null = null
  private _lastError: string | null = null

  constructor(
    private deps: CaptionWorkerDeps,
    private config: CaptionWorkerConfig,
  ) {}

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) {
      this.deps.logger.debug('caption_worker_already_running')
      return
    }
    this.running = true
    this.deps.logger.info(
      { batchSize: this.config.batchSize, pollMs: this.config.pollIntervalMs },
      'caption_worker_started',
    )
    // Primeira rodada imediata, depois agendada
    this.tick()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.deps.logger.info('caption_worker_stopped')
  }

  isRunning(): boolean {
    return this.running
  }

  stats() {
    return {
      running: this.running,
      busy: this.busy,
      totalProcessed: this._totalProcessed,
      totalFailed: this._totalFailed,
      totalSkipped: this._totalSkipped,
      lastRunAt: this._lastRunAt,
      lastError: this._lastError,
    }
  }

  // ─── Tick ──────────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (!this.running) return
    if (this.busy) {
      // tick anterior ainda rodando — pula este ciclo
      this.schedule()
      return
    }
    this.busy = true
    try {
      await this.processBatch()
      this._lastError = null
    } catch (e) {
      this._lastError = String(e)
      this.deps.logger.error({ err: this._lastError }, 'caption_worker_tick_failed')
    } finally {
      this.busy = false
      this.schedule()
    }
  }

  private schedule(): void {
    if (!this.running) return
    this.timer = setTimeout(() => void this.tick(), this.config.pollIntervalMs)
  }

  // ─── Core: processar 1 batch ───────────────────────────────────────────────

  async processBatch(): Promise<BatchResult> {
    const t0 = Date.now()
    this._lastRunAt = new Date()

    const frames = await this.deps.prisma.detectionFrame.findMany({
      where: {
        captionedAt: null,
        thumbnailKey: { not: null },
      },
      take: this.config.batchSize,
      orderBy: { createdAt: 'desc' }, // novos primeiro — mais relevantes
      select: {
        id: true,
        integradorId: true,
        thumbnailKey: true,
      },
    })

    if (frames.length === 0) {
      return { processed: 0, failed: 0, skipped: 0, durationMs: Date.now() - t0 }
    }

    const concurrency = Math.max(1, this.config.concurrency ?? 3)
    let processed = 0
    let failed = 0

    // Pool simples de workers
    let idx = 0
    const workItem = async () => {
      while (idx < frames.length) {
        const myIdx = idx++
        const frame = frames[myIdx]
        try {
          const ok = await this.processFrame(frame)
          if (ok) processed++
          else failed++
        } catch (e) {
          failed++
          this.deps.logger.warn(
            { err: String(e), frameId: frame.id },
            'caption_worker_frame_failed',
          )
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, workItem))

    this._totalProcessed += processed
    this._totalFailed += failed

    const durationMs = Date.now() - t0
    this.deps.logger.info(
      { processed, failed, totalProcessed: this._totalProcessed, durationMs },
      'caption_worker_batch_done',
    )
    return { processed, failed, skipped: 0, durationMs }
  }

  // ─── Processa 1 frame ──────────────────────────────────────────────────────

  /**
   * Retorna true se processou com sucesso, false se houve erro (logado +
   * persistido em DetectionFrame.captionError).
   */
  private async processFrame(frame: {
    id: string
    integradorId: string
    thumbnailKey: string | null
  }): Promise<boolean> {
    if (!frame.thumbnailKey) {
      await this.markPermanentError(frame.id, 'thumbnail_key_missing')
      return false
    }

    // 1) Download
    const jpeg = await this.deps.downloadThumbnail(frame.integradorId, frame.thumbnailKey)
    if (!jpeg) {
      // Thumbnail sumiu do R2 — erro permanente, não retenta
      await this.markPermanentError(frame.id, 'thumbnail_missing_in_r2')
      return false
    }

    // 2) Caption
    let caption: string | null
    try {
      caption = await this.deps.captionImage(jpeg)
    } catch (e) {
      // erro do Gemini (rate limit, timeout) — transient, retenta
      await this.markTransientError(frame.id, `caption_error: ${truncErr(e)}`)
      return false
    }
    if (!caption) {
      // Gemini retornou vazio (filtro de segurança, etc) — transient
      await this.markTransientError(frame.id, 'caption_unavailable')
      return false
    }

    // 3) Embedding
    let embedding: Float32Array
    try {
      embedding = await this.deps.embedText(caption)
    } catch (e) {
      await this.markTransientError(frame.id, `embed_error: ${truncErr(e)}`)
      return false
    }

    // 4) Persist
    try {
      await this.deps.vectorStore.upsert({
        frameId: frame.id,
        captionText: caption,
        captionEmbedding: embedding,
        embeddingModel: this.config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
      })
      return true
    } catch (e) {
      await this.markTransientError(frame.id, `persist_error: ${truncErr(e)}`)
      return false
    }
  }

  // ─── Estado de erro ────────────────────────────────────────────────────────

  /** Erro permanente: marca captionedAt = NOW para não retentar. */
  private async markPermanentError(frameId: string, reason: string): Promise<void> {
    try {
      await this.deps.prisma.detectionFrame.update({
        where: { id: frameId },
        data: { captionError: reason, captionedAt: new Date() },
      })
    } catch (e) {
      this.deps.logger.warn({ err: String(e), frameId }, 'mark_permanent_error_failed')
    }
  }

  /** Erro transiente: salva mensagem mas mantém captionedAt NULL para retentar. */
  private async markTransientError(frameId: string, reason: string): Promise<void> {
    try {
      await this.deps.prisma.detectionFrame.update({
        where: { id: frameId },
        data: { captionError: reason },
      })
    } catch (e) {
      this.deps.logger.warn({ err: String(e), frameId }, 'mark_transient_error_failed')
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Trunca mensagem de erro para caber em DetectionFrame.captionError. */
function truncErr(e: unknown, max = 200): string {
  const s = e instanceof Error ? e.message : String(e)
  return s.length > max ? s.slice(0, max) + '...' : s
}
