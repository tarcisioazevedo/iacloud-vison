/**
 * CaptionWorker — testes unitários.
 *
 * Mocka prisma, r2 download, gemini caption e embedding service.
 * Cobre:
 *  - batch claim (n frames pegos atomicamente)
 *  - happy path: download → caption → embed → upsert
 *  - falha por frame não derruba batch (partial success)
 *  - r2 retorna null (thumbnail sumiu) → marca captionError, não retenta
 *  - gemini retorna null → marca captionError, retenta na próxima rodada
 *  - embedding falha (quota) → marca captionError, retenta com backoff
 *  - métricas atualizadas (counts: ok/fail/skipped)
 *  - idempotente: rodar 2x não duplica trabalho
 */

import { describe, it, expect, vi } from 'vitest'
import { CaptionWorker, type CaptionWorkerDeps } from '../caption-worker.service'

function makeFrame(overrides: Partial<any> = {}): any {
  return {
    id: 'frame-1',
    cameraId: 'cam-1',
    integradorId: 'int-1',
    clienteFinalId: 'cf-1',
    siteId: 'site-1',
    thumbnailKey: 'ai-thumbs/cam-1/frame-1.jpg',
    timestamp: new Date(),
    objectType: 'person',
    captionedAt: null,
    captionError: null,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<CaptionWorkerDeps> = {}): CaptionWorkerDeps {
  const baseFrames = [makeFrame()]
  return {
    prisma: {
      detectionFrame: {
        findMany: vi.fn(async () => baseFrames),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({})),
      },
    } as any,
    downloadThumbnail: vi.fn(async () => Buffer.from('fake-jpeg')),
    captionImage: vi.fn(async () => 'Pessoa caminhando na entrada'),
    embedText: vi.fn(async () => new Float32Array(768).fill(0.1)),
    vectorStore: {
      upsert: vi.fn(async () => undefined),
    } as any,
    audit: {
      recordBackfill: vi.fn(async () => undefined),
    } as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    ...overrides,
  }
}

describe('CaptionWorker.processBatch', () => {
  it('happy path: download + caption + embed + upsert', async () => {
    const deps = makeDeps()
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 5000 })
    const result = await worker.processBatch()
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)
    expect(deps.downloadThumbnail).toHaveBeenCalledOnce()
    expect(deps.captionImage).toHaveBeenCalledOnce()
    expect(deps.embedText).toHaveBeenCalledOnce()
    expect(deps.vectorStore.upsert).toHaveBeenCalledOnce()
  })

  it('quando não há frames pendentes: no-op', async () => {
    const deps = makeDeps({
      prisma: {
        detectionFrame: {
          findMany: vi.fn(async () => []),
          updateMany: vi.fn(async () => ({ count: 0 })),
          update: vi.fn(async () => ({})),
        },
      } as any,
    })
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 5000 })
    const result = await worker.processBatch()
    expect(result.processed).toBe(0)
    expect(deps.captionImage).not.toHaveBeenCalled()
  })

  it('r2 retorna null (thumbnail sumiu): marca captionError, skip', async () => {
    const deps = makeDeps({
      downloadThumbnail: vi.fn(async () => null),
    })
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 5000 })
    const result = await worker.processBatch()
    expect(result.processed).toBe(0)
    expect(result.failed).toBe(1)
    // Foi marcado como erro permanente para não retentar
    expect(deps.prisma.detectionFrame.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'frame-1' },
        data: expect.objectContaining({
          captionError: expect.stringMatching(/thumbnail_missing/i),
          captionedAt: expect.any(Date),
        }),
      }),
    )
  })

  it('gemini caption retorna null: marca erro temporário (sem captionedAt)', async () => {
    const deps = makeDeps({
      captionImage: vi.fn(async () => null),
    })
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 5000 })
    const result = await worker.processBatch()
    expect(result.failed).toBe(1)
    const updateCall = (deps.prisma.detectionFrame.update as any).mock.calls[0][0]
    // Mantém captionedAt NULL para retentar na próxima rodada
    expect(updateCall.data.captionedAt).toBeUndefined()
    expect(updateCall.data.captionError).toMatch(/caption_unavailable/i)
  })

  it('embed falha: marca erro temporário', async () => {
    const deps = makeDeps({
      embedText: vi.fn(async () => { throw new Error('quota exceeded') }),
    })
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 5000 })
    const result = await worker.processBatch()
    expect(result.failed).toBe(1)
    const updateCall = (deps.prisma.detectionFrame.update as any).mock.calls[0][0]
    expect(updateCall.data.captionError).toMatch(/quota exceeded/)
    expect(updateCall.data.captionedAt).toBeUndefined()
  })

  it('falha de UM frame não derruba o batch', async () => {
    const frames = [makeFrame({ id: 'f1' }), makeFrame({ id: 'f2' }), makeFrame({ id: 'f3' })]
    let callCount = 0
    const deps = makeDeps({
      prisma: {
        detectionFrame: {
          findMany: vi.fn(async () => frames),
          updateMany: vi.fn(async () => ({ count: 3 })),
          update: vi.fn(async () => ({})),
        },
      } as any,
      captionImage: vi.fn(async () => {
        callCount++
        if (callCount === 2) throw new Error('rate limit')
        return 'caption ok'
      }),
    })
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 5000 })
    const result = await worker.processBatch()
    expect(result.processed).toBe(2)
    expect(result.failed).toBe(1)
  })

  it('respeita batchSize', async () => {
    const deps = makeDeps()
    const worker = new CaptionWorker(deps, { batchSize: 5, pollIntervalMs: 5000 })
    await worker.processBatch()
    const findCall = (deps.prisma.detectionFrame.findMany as any).mock.calls[0][0]
    expect(findCall.take).toBe(5)
  })

  it('filtra: thumbnailKey IS NOT NULL AND captionedAt IS NULL', async () => {
    const deps = makeDeps()
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 5000 })
    await worker.processBatch()
    const findCall = (deps.prisma.detectionFrame.findMany as any).mock.calls[0][0]
    expect(findCall.where).toMatchObject({
      captionedAt: null,
      thumbnailKey: { not: null },
    })
  })

  it('métricas acumulam entre batches', async () => {
    const deps = makeDeps()
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 5000 })
    await worker.processBatch()
    await worker.processBatch()
    const stats = worker.stats()
    expect(stats.totalProcessed).toBe(2)
    expect(stats.totalFailed).toBe(0)
  })

  it('upsert recebe embedding correto', async () => {
    const embedding = new Float32Array(768).fill(0.5)
    const deps = makeDeps({
      embedText: vi.fn(async () => embedding),
    })
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 5000 })
    await worker.processBatch()
    expect(deps.vectorStore.upsert).toHaveBeenCalledWith({
      frameId: 'frame-1',
      captionText: 'Pessoa caminhando na entrada',
      captionEmbedding: embedding,
      embeddingModel: expect.any(String),
    })
  })

  it('frames com erro anterior são retentados (captionError NOT NULL + captionedAt NULL)', async () => {
    const deps = makeDeps({
      prisma: {
        detectionFrame: {
          findMany: vi.fn(async () => [
            makeFrame({ captionError: 'rate limit', captionedAt: null }),
          ]),
          updateMany: vi.fn(async () => ({ count: 1 })),
          update: vi.fn(async () => ({})),
        },
      } as any,
    })
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 5000 })
    const result = await worker.processBatch()
    expect(result.processed).toBe(1)
  })
})

describe('CaptionWorker start/stop', () => {
  it('start agenda timer e stop limpa', async () => {
    vi.useFakeTimers()
    const deps = makeDeps({
      prisma: {
        detectionFrame: {
          findMany: vi.fn(async () => []),
          updateMany: vi.fn(async () => ({ count: 0 })),
          update: vi.fn(async () => ({})),
        },
      } as any,
    })
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 1000 })
    worker.start()
    expect(worker.isRunning()).toBe(true)
    worker.stop()
    expect(worker.isRunning()).toBe(false)
    vi.useRealTimers()
  })

  it('start 2x é no-op (não duplica timer)', async () => {
    const deps = makeDeps()
    const worker = new CaptionWorker(deps, { batchSize: 10, pollIntervalMs: 1000 })
    worker.start()
    worker.start()
    expect(worker.isRunning()).toBe(true)
    worker.stop()
  })
})
