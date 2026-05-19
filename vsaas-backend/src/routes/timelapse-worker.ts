/**
 * Timelapse Worker API — endpoints para o vsaas-ai-worker processar TimelapseJobs.
 *
 * Auth: Bearer AI_WORKER_SECRET (mesmo token do detection ingest).
 *
 * Fluxo por job:
 *   1. Worker faz GET /timelapse/worker/jobs → lista PENDING
 *   2. Worker faz POST /timelapse/worker/jobs/:id/claim → PENDING → PROCESSING
 *   3. Worker faz GET /timelapse/worker/jobs/:id/segments → presigned GET URLs + PUT URL output
 *   4. Worker processa (ffmpeg)
 *   5. Worker faz POST /timelapse/worker/jobs/:id/complete ou /fail
 *
 * Retry: após 3 tentativas o job fica FAILED permanentemente.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAiWorkerAuth } from '../middleware/ai-worker-auth'
import { r2Storage } from '../services/r2-storage.service'

const router = Router()
router.use(requireAiWorkerAuth)

const MAX_ATTEMPTS = 3
const SEGMENT_URL_TTL_SEC = 7200   // 2h pra baixar tudo
const OUTPUT_URL_TTL_SEC  = 3600   // 1h pra fazer upload

// ─── GET /timelapse/worker/jobs ───────────────────────────────────────────────

router.get('/jobs', async (_req: Request, res: Response) => {
  try {
    const jobs = await prisma.timelapseJob.findMany({
      where: {
        status:   'PENDING',
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: {
        id: true, cameraId: true, clienteFinalId: true, integradorId: true,
        type: true, speedFactor: true, outputDurationSec: true, resolution: true,
        periodStart: true, periodEnd: true,
        camera: { select: { name: true } },
      },
    })
    res.json({ jobs })
  } catch (err) {
    logger.error({ err }, 'timelapse_worker_jobs_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ─── POST /timelapse/worker/jobs/:id/claim ────────────────────────────────────

router.post('/jobs/:id/claim', async (req: Request, res: Response) => {
  try {
    const job = await prisma.timelapseJob.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, attempts: true },
    })
    if (!job) return res.status(404).json({ error: 'not_found' })
    if (job.status !== 'PENDING') return res.json({ ok: false, reason: 'not_pending', status: job.status })
    if (job.attempts >= MAX_ATTEMPTS) return res.json({ ok: false, reason: 'max_attempts' })

    await prisma.timelapseJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, updatedAt: new Date() },
    })
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, 'timelapse_worker_claim_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ─── GET /timelapse/worker/jobs/:id/segments ──────────────────────────────────

router.get('/jobs/:id/segments', async (req: Request, res: Response) => {
  try {
    const job = await prisma.timelapseJob.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, cameraId: true, integradorId: true, clienteFinalId: true,
        periodStart: true, periodEnd: true, type: true,
        resolution: true, speedFactor: true,
      },
    })
    if (!job) return res.status(404).json({ error: 'not_found' })

    // Resolve integradorId se nulo (via câmera → site → CF → integrador)
    let integradorId = job.integradorId
    if (!integradorId) {
      const cam = await prisma.camera.findUnique({
        where:  { id: job.cameraId },
        select: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
      })
      integradorId = cam?.site?.clienteFinal?.integradorId ?? null
    }

    // Busca segmentos no período
    const segments = await prisma.recordingSegment.findMany({
      where: {
        cameraId:   job.cameraId,
        startedAt: { gte: job.periodStart },
        endedAt:   { lte: job.periodEnd },


      },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        storagePath: true,
        uploadBucket: true,
        startedAt: true,
        endedAt: true,
        sizeBytes: true,
      },
    })

    // Gera presigned GET URLs para cada segmento
    const segmentsWithUrls = await Promise.all(
      segments.map(async seg => {
        let url: string | null = null
        if (seg.storagePath && integradorId) {
          url = await r2Storage.getPresignedUrl(integradorId, seg.storagePath, SEGMENT_URL_TTL_SEC)
        }
        return {
          id:         seg.id,
          startedAt:  seg.startedAt.toISOString(),
          endedAt:    seg.endedAt?.toISOString() ?? null,
          sizeBytes:  seg.sizeBytes?.toString() ?? null,
          url,
        }
      }),
    )

    // Gera presigned PUT URL para o output
    const dt = job.periodStart.toISOString().slice(0, 10)
    const outputKey = `timelapse/${integradorId ?? 'unknown'}/${job.clienteFinalId}/${job.cameraId}/${job.type.toLowerCase()}-${dt}.mp4`
    const thumbKey  = `timelapse/${integradorId ?? 'unknown'}/${job.clienteFinalId}/${job.cameraId}/${job.type.toLowerCase()}-${dt}-thumb.jpg`

    let outputUploadUrl: string | null = null
    let thumbUploadUrl:  string | null = null
    if (integradorId) {
      outputUploadUrl = await r2Storage.getPresignedUploadUrl(integradorId, outputKey, 'video/mp4', OUTPUT_URL_TTL_SEC)
      thumbUploadUrl  = await r2Storage.getPresignedUploadUrl(integradorId, thumbKey, 'image/jpeg', OUTPUT_URL_TTL_SEC)
    }

    res.json({
      segments: segmentsWithUrls,
      outputKey,
      thumbKey,
      outputUploadUrl,
      thumbUploadUrl,
      integradorId,
    })
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, 'timelapse_worker_segments_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ─── POST /timelapse/worker/jobs/:id/complete ─────────────────────────────────

const CompleteSchema = z.object({
  outputPath:    z.string(),
  thumbnailPath: z.string().optional(),
  durationSec:   z.number().positive(),
  fileSizeBytes: z.number().int().positive(),
})

router.post('/jobs/:id/complete', async (req: Request, res: Response) => {
  const body = CompleteSchema.safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: 'validation_error', issues: body.error.issues })

  try {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)

    await prisma.timelapseJob.update({
      where: { id: req.params.id },
      data: {
        status:        'DONE',
        outputPath:    body.data.outputPath,
        thumbnailPath: body.data.thumbnailPath ?? null,
        durationSec:   body.data.durationSec,
        fileSizeBytes: BigInt(body.data.fileSizeBytes),
        generatedAt:   new Date(),
        expiresAt,
        errorMessage:  null,
        updatedAt:     new Date(),
      },
    })

    logger.info(
      { jobId: req.params.id, durationSec: body.data.durationSec, fileSizeBytes: body.data.fileSizeBytes },
      'timelapse_job_done',
    )
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, 'timelapse_worker_complete_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ─── POST /timelapse/worker/jobs/:id/fail ────────────────────────────────────

const FailSchema = z.object({
  errorMessage: z.string(),
  retryable:    z.boolean().optional().default(true),
})

router.post('/jobs/:id/fail', async (req: Request, res: Response) => {
  const body = FailSchema.safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: 'validation_error' })

  try {
    const job = await prisma.timelapseJob.findUnique({
      where: { id: req.params.id },
      select: { attempts: true },
    })
    if (!job) return res.status(404).json({ error: 'not_found' })

    const finalFail = !body.data.retryable || job.attempts >= MAX_ATTEMPTS
    await prisma.timelapseJob.update({
      where: { id: req.params.id },
      data: {
        status:       finalFail ? 'FAILED' : 'PENDING',
        errorMessage: body.data.errorMessage,
        updatedAt:    new Date(),
      },
    })

    logger.warn(
      { jobId: req.params.id, attempts: job.attempts, finalFail, err: body.data.errorMessage },
      'timelapse_job_failed',
    )
    res.json({ ok: true, finalFail })
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, 'timelapse_worker_fail_update_failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

export default router
