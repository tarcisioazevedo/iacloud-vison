/**
 * Export Service — fila in-memory de jobs ffmpeg para exportações de mídia.
 *
 * Tipos suportados:
 *   - SNAPSHOT: extrai 1 frame de uma gravação em timestamp específico (jpg/png)
 *   - RECORDING: corta range de uma câmera (mp4)
 *   - MOSAIC: empilha múltiplas câmeras em layout 2x2/1x4/4x1 (mp4)
 *
 * Concorrência:
 *   - Limite configurável (EXPORT_MAX_CONCURRENT, default 2)
 *   - Pending jobs aguardam em fila FIFO
 *   - VPS de 4 CPU não aguenta mais que 2-3 ffmpeg simultâneos sem afetar
 *     gravação contínua (que já consome 1 core por câmera ativa).
 *
 * Storage:
 *   - Output: ${process.cwd()}/exports/<jobId>.<ext>
 *   - Servido via /exports/:filename como static
 *   - sha256 do arquivo final é computado e materializado em MediaCertificate
 *
 * Limitações conhecidas (MVP):
 *   - Estado em memória — restart do backend perde fila + jobs em execução
 *   - Sem persistência de jobs (P1: tabela ExportJob)
 *   - Mosaic limitado a 4 câmeras (layouts 2x2/1x4/4x1)
 */
import { spawn, type ChildProcess } from 'child_process'
import { randomUUID, createHash } from 'crypto'
import { promises as fs, createReadStream } from 'fs'
import { join } from 'path'
import os from 'os'
import jwt from 'jsonwebtoken'
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { recordingStorage } from './recording-storage.service'
import { signMediaInternal } from '../routes/certificates'
import { recordExport } from '../routes/export-audit'

const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg'
const MAX_CONCURRENT = Number(process.env.EXPORT_MAX_CONCURRENT ?? 2)

const EXPORTS_DIR = join(process.cwd(), 'exports')

// Garante diretório no boot do módulo (idempotente).
fs.mkdir(EXPORTS_DIR, { recursive: true }).catch(err =>
  logger.warn({ err }, 'export_service_mkdir_failed'),
)

export type JobId = string
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface JobResult {
  url:       string
  sha256:    string
  certId?:   string | null
  sizeBytes: number
}

export interface JobState {
  id:          JobId
  type:        'SNAPSHOT' | 'RECORDING' | 'MOSAIC'
  tenantId:    string
  userId:      string | null
  cameraIds:   string[]
  status:      JobStatus
  progress:    number  // 0-1
  etaMs:       number | null
  error?:      string
  result?:     JobResult
  createdAt:   number
  startedAt?:  number
  finishedAt?: number
  // Internal
  _proc?:      ChildProcess
  _runner?:    () => Promise<void>
  _cleanup?:   Array<() => Promise<void>>
}

const jobs = new Map<JobId, JobState>()
const queue: JobId[] = []
let running = 0

interface SnapshotOpts {
  tenantId:           string
  userId:             string | null
  cameraId:           string
  at:                 Date
  format:             'jpg' | 'png'
  includeCertificate: boolean
}

interface RecordingOpts {
  tenantId:           string
  userId:             string | null
  cameraId:           string
  from:               Date
  to:                 Date
  includeCertificate: boolean
}

interface MosaicOpts {
  tenantId:           string
  userId:             string | null
  cameraIds:          string[]
  from:               Date
  to:                 Date
  layout:             '2x2' | '1x4' | '4x1'
  includeCertificate: boolean
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const exportService = {
  enqueueSnapshot(opts: SnapshotOpts): JobId {
    const id = randomUUID()
    const job: JobState = {
      id, type: 'SNAPSHOT',
      tenantId: opts.tenantId, userId: opts.userId,
      cameraIds: [opts.cameraId],
      status: 'queued', progress: 0, etaMs: null, createdAt: Date.now(),
    }
    job._runner = () => runSnapshot(job, opts)
    jobs.set(id, job)
    queue.push(id)
    pump()
    return id
  },

  enqueueRecording(opts: RecordingOpts): JobId {
    const id = randomUUID()
    const job: JobState = {
      id, type: 'RECORDING',
      tenantId: opts.tenantId, userId: opts.userId,
      cameraIds: [opts.cameraId],
      status: 'queued', progress: 0, etaMs: null, createdAt: Date.now(),
    }
    job._runner = () => runRecording(job, opts)
    jobs.set(id, job)
    queue.push(id)
    pump()
    return id
  },

  enqueueMosaic(opts: MosaicOpts): JobId {
    const id = randomUUID()
    const job: JobState = {
      id, type: 'MOSAIC',
      tenantId: opts.tenantId, userId: opts.userId,
      cameraIds: opts.cameraIds.slice(),
      status: 'queued', progress: 0, etaMs: null, createdAt: Date.now(),
    }
    job._runner = () => runMosaic(job, opts)
    jobs.set(id, job)
    queue.push(id)
    pump()
    return id
  },

  getStatus(jobId: JobId): JobState | null {
    const j = jobs.get(jobId)
    if (!j) return null
    return publicView(j)
  },

  cancel(jobId: JobId): boolean {
    const j = jobs.get(jobId)
    if (!j) return false
    if (j.status === 'queued') {
      const i = queue.indexOf(jobId)
      if (i >= 0) queue.splice(i, 1)
      j.status = 'cancelled'
      j.finishedAt = Date.now()
      return true
    }
    if (j.status === 'running' && j._proc) {
      try { j._proc.kill('SIGTERM') } catch { /* ignore */ }
      j.status = 'cancelled'
      j.finishedAt = Date.now()
      return true
    }
    return false
  },

  list(tenantId: string): JobState[] {
    return [...jobs.values()]
      .filter(j => j.tenantId === tenantId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(publicView)
  },

  /**
   * Emite ticket JWT pra autorizar download direto de um arquivo exportado.
   *
   * 2026-05-12 fix: antes `/exports/*` era servido por express.static sem
   * auth — qualquer um com o UUID baixava. UUIDs não enumeráveis "protegem"
   * mas vazamento em log/email/screenshot tornava arquivos públicos pra sempre.
   *
   * Agora: result.url já vem assinada com ticket TTL=1h. Frontend não muda —
   * só consome a URL como antes. Middleware estática verifica ticket antes
   * de servir.
   */
  issueDownloadTicket(jobId: JobId, tenantId: string, ttlSec = 3600): string {
    const now = Math.floor(Date.now() / 1000)
    return jwt.sign(
      { kind: 'export', jobId, tenantId, iat: now, exp: now + ttlSec },
      process.env.JWT_SECRET!,
      { algorithm: 'HS256' },
    )
  },

  /**
   * Verifica ticket de download. Retorna { jobId, tenantId } se válido.
   * Não checa expiração (jwt.verify já faz).
   */
  verifyDownloadTicket(token: string): { jobId: JobId; tenantId: string } {
    const decoded = jwt.verify(
      token, process.env.JWT_SECRET!, { algorithms: ['HS256'] },
    ) as { kind?: string; jobId?: string; tenantId?: string }
    if (decoded.kind !== 'export' || !decoded.jobId || !decoded.tenantId) {
      throw new Error('Ticket inválido pra download de export')
    }
    return { jobId: decoded.jobId, tenantId: decoded.tenantId }
  },

  /** Lookup interno pro middleware de auth. */
  getJob(jobId: JobId): JobState | undefined {
    return jobs.get(jobId)
  },
}

function publicView(j: JobState): JobState {
  // Strip internals (_proc, _runner, _cleanup) — não devem vazar em JSON.
  const { _proc, _runner, _cleanup, ...rest } = j
  return rest as JobState
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const id = queue.shift()!
    const j = jobs.get(id)
    if (!j || j.status !== 'queued') continue
    running++
    j.status = 'running'
    j.startedAt = Date.now()
    Promise.resolve()
      .then(() => j._runner!())
      .catch(err => {
        logger.error({ err, jobId: j.id }, 'export_job_runner_unhandled')
        j.status = 'error'
        j.error = err?.message ?? String(err)
      })
      .finally(() => {
        if (j.status === 'running') {
          // runner deveria ter setado done/error — defensive default.
          j.status = 'done'
        }
        j.finishedAt = Date.now()
        running--
        // GC: remove jobs concluídos > 1h pra não vazar memória.
        gcOldJobs()
        pump()
      })
  }
}

function gcOldJobs(): void {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [id, j] of jobs.entries()) {
    if (j.finishedAt && j.finishedAt < cutoff) {
      jobs.delete(id)
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', d => hash.update(d))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const s = await fs.stat(filePath)
    return s.size
  } catch { return 0 }
}

async function getCameraIntegradorId(cameraId: string): Promise<string> {
  const cam = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
  })
  return cam?.site?.clienteFinal?.integradorId ?? 'default'
}

interface SegmentRef {
  id:          string
  cameraId:    string
  startedAt:   Date
  endedAt:     Date
  durationSec: number
  storagePath: string
}

/**
 * Busca segmentos da câmera que sobrepõem [from, to], ordenados.
 * Garante que o arquivo local existe (baixa de R2/S3 se necessário) e
 * retorna lista de absolute paths em sequência cronológica.
 */
async function fetchAndStageSegments(
  cameraId: string,
  from: Date,
  to: Date,
): Promise<{ segments: SegmentRef[]; localPaths: string[]; cleanup: () => Promise<void> }> {
  const segments = await prisma.recordingSegment.findMany({
    where: {
      cameraId,
      startedAt: { lt: to },
      endedAt:   { gt: from },
    },
    orderBy: { startedAt: 'asc' },
    select: {
      id: true, cameraId: true, startedAt: true, endedAt: true,
      durationSec: true, storagePath: true,
    },
  })

  if (segments.length === 0) {
    return { segments: [], localPaths: [], cleanup: async () => {} }
  }

  const integradorId = await getCameraIntegradorId(cameraId)
  const localPaths: string[] = []
  const tempFiles: string[] = []

  for (const seg of segments) {
    const localAbs = recordingStorage.absolutePath(seg.storagePath)
    let exists = true
    try { await fs.access(localAbs) } catch { exists = false }

    if (exists) {
      localPaths.push(localAbs)
    } else {
      // Stream do cloud → arquivo temporário
      const stream = await recordingStorage.getReadStream(integradorId, seg.storagePath)
      if (!stream) {
        logger.warn({ cameraId, segmentId: seg.id, storagePath: seg.storagePath },
          'export_segment_unavailable')
        continue
      }
      const tmpPath = join(os.tmpdir(), `icv-export-${randomUUID()}.ts`)
      await new Promise<void>((resolve, reject) => {
        const ws = require('fs').createWriteStream(tmpPath)
        stream.pipe(ws)
        ws.on('finish', () => resolve())
        ws.on('error', reject)
        stream.on('error', reject)
      })
      tempFiles.push(tmpPath)
      localPaths.push(tmpPath)
    }
  }

  return {
    segments,
    localPaths,
    cleanup: async () => {
      for (const f of tempFiles) {
        await fs.unlink(f).catch(() => { /* ignore */ })
      }
    },
  }
}

/**
 * Concatena múltiplos .ts em 1 arquivo intermediário .mp4 usando ffmpeg
 * concat demuxer. Retorna path absoluto.
 */
async function concatSegments(localPaths: string[], outPath: string): Promise<void> {
  if (localPaths.length === 0) throw new Error('no_segments_to_concat')
  if (localPaths.length === 1) {
    // Single segment — só remux .ts → .mp4 (mais barato que concat).
    await runFfmpegOnce(['-i', localPaths[0], '-c', 'copy', '-y', outPath])
    return
  }

  const listFile = join(os.tmpdir(), `icv-concat-${randomUUID()}.txt`)
  const lines = localPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
  await fs.writeFile(listFile, lines, 'utf8')
  try {
    // Onda 3 / P0 #4: robustez a gaps/discontinuities.
    //
    // `-fflags +genpts`: regenera timestamps (corrige DTS reverso comum em
    //     segments produzidos com `-reset_timestamps 1` no recorder).
    // `-avoid_negative_ts make_zero`: normaliza timestamps negativos pós-concat.
    // `-c copy`: preserva codec original (sem re-encode = rápido + sem perda).
    //
    // Se isso falhar (codec mismatch entre segments), tenta fallback com
    // re-encode H.264/AAC — mais lento mas garante output válido.
    try {
      await runFfmpegOnce([
        '-fflags', '+genpts',
        '-f', 'concat', '-safe', '0',
        '-i', listFile,
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        '-y', outPath,
      ])
    } catch (concatErr) {
      logger.warn({ err: String(concatErr) }, 'export_concat_copy_failed_fallback_reencode')
      // Fallback: re-encode (mais robusto a codec mismatch, mas ~10x mais lento)
      await runFfmpegOnce([
        '-fflags', '+genpts',
        '-f', 'concat', '-safe', '0',
        '-i', listFile,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-avoid_negative_ts', 'make_zero',
        '-y', outPath,
      ])
    }
  } finally {
    await fs.unlink(listFile).catch(() => {})
  }
}

/**
 * Executa ffmpeg uma vez (sem progress tracking).
 * Lança Error se exit code != 0.
 */
function runFfmpegOnce(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, ['-hide_banner', '-loglevel', 'error', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    proc.stderr?.on('data', c => { stderr += c.toString('utf8') })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`))
    })
  })
}

/**
 * Executa ffmpeg com tracking de progresso. Atualiza job.progress e job.etaMs
 * com base nas linhas `out_time=` e/ou `frame=` que ffmpeg emite no stderr.
 */
function runFfmpegWithProgress(
  job: JobState,
  args: string[],
  totalDurationMs: number | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, ['-hide_banner', '-loglevel', 'error', '-progress', 'pipe:2', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    job._proc = proc
    let stderr = ''

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderr += text
      if (stderr.length > 16384) stderr = stderr.slice(-16384)

      // Parse out_time_ms=NNNNN ou out_time=HH:MM:SS.sss
      const timeMatch = text.match(/out_time_ms=(\d+)/)
      if (timeMatch && totalDurationMs && totalDurationMs > 0) {
        const elapsedMs = Number(timeMatch[1]) / 1000  // out_time_ms é em microssegundos
        const ratio = Math.min(1, elapsedMs / totalDurationMs)
        job.progress = ratio
        const now = Date.now()
        const wallElapsedMs = now - (job.startedAt ?? now)
        if (ratio > 0.01) {
          job.etaMs = Math.max(0, Math.round(wallElapsedMs / ratio - wallElapsedMs))
        }
      }
    })

    proc.on('error', err => {
      job._proc = undefined
      reject(err)
    })
    proc.on('close', code => {
      job._proc = undefined
      if (code === 0) {
        job.progress = 1
        resolve()
      } else if (job.status === 'cancelled') {
        reject(new Error('cancelled'))
      } else {
        reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`))
      }
    })
  })
}

// ─── Runners ─────────────────────────────────────────────────────────────────

async function runSnapshot(job: JobState, opts: SnapshotOpts): Promise<void> {
  const ext = opts.format
  const outPath = join(EXPORTS_DIR, `${job.id}.${ext}`)
  let intermediateMp4: string | null = null

  try {
    // Encontra segmento que contém `at`
    const seg = await prisma.recordingSegment.findFirst({
      where: {
        cameraId: opts.cameraId,
        startedAt: { lte: opts.at },
        endedAt:   { gt: opts.at },
      },
      orderBy: { startedAt: 'desc' },
    })
    if (!seg) throw new Error('no_segment_at_timestamp')

    const integradorId = await getCameraIntegradorId(opts.cameraId)
    const localAbs = recordingStorage.absolutePath(seg.storagePath)
    let inputPath = localAbs
    let exists = true
    try { await fs.access(localAbs) } catch { exists = false }
    if (!exists) {
      const stream = await recordingStorage.getReadStream(integradorId, seg.storagePath)
      if (!stream) throw new Error('segment_file_unavailable')
      const tmp = join(os.tmpdir(), `icv-snap-${randomUUID()}.ts`)
      await new Promise<void>((resolve, reject) => {
        const ws = require('fs').createWriteStream(tmp)
        stream.pipe(ws)
        ws.on('finish', () => resolve())
        ws.on('error', reject)
        stream.on('error', reject)
      })
      inputPath = tmp
      intermediateMp4 = tmp
    }

    const offsetSec = Math.max(0, (opts.at.getTime() - seg.startedAt.getTime()) / 1000)
    job.progress = 0.1

    await runFfmpegOnce([
      '-ss', String(offsetSec),
      '-i', inputPath,
      '-frames:v', '1',
      '-q:v', '2',
      '-y', outPath,
    ])

    job.progress = 0.9

    const sha = await sha256OfFile(outPath)
    const size = await fileSize(outPath)
    let certId: string | null = null

    if (opts.includeCertificate) {
      const cert = await signMediaInternal({
        tenantId: opts.tenantId,
        cameraId: opts.cameraId,
        type: 'SNAPSHOT',
        capturedAt: opts.at,
        sha256: sha,
        fileName: `${job.id}.${ext}`,
        fileSize: size,
        exportedBy: opts.userId,
        metadata: { jobId: job.id },
      })
      certId = cert.id
    }

    await recordExport(opts.tenantId, opts.userId, {
      cameraIds: [opts.cameraId],
      exportType: 'SNAPSHOT',
      fromAt: opts.at,
      toAt: opts.at,
      fileSizeBytes: size,
      destination: 'local',
      certificateId: certId,
      metadata: { jobId: job.id, format: ext },
    })

    // Ticket assinado de 1h embutido na URL — middleware estático verifica
    // antes de servir (vide app.ts/exportDownloadGate).
    const ticket = exportService.issueDownloadTicket(job.id, job.tenantId)
    job.result = {
      url: `/exports/${job.id}.${ext}?ticket=${encodeURIComponent(ticket)}`,
      sha256: sha,
      certId,
      sizeBytes: size,
    }
    job.status = 'done'
    job.progress = 1
  } catch (err: any) {
    if (job.status !== 'cancelled') {
      job.status = 'error'
      job.error = err?.message ?? String(err)
      logger.warn({ err, jobId: job.id }, 'export_snapshot_failed')
    }
  } finally {
    if (intermediateMp4) await fs.unlink(intermediateMp4).catch(() => {})
  }
}

async function runRecording(job: JobState, opts: RecordingOpts): Promise<void> {
  const outPath = join(EXPORTS_DIR, `${job.id}.mp4`)
  let staged: { cleanup: () => Promise<void> } | null = null
  let concatPath: string | null = null
  const totalDurationMs = opts.to.getTime() - opts.from.getTime()

  try {
    const stagedRes = await fetchAndStageSegments(opts.cameraId, opts.from, opts.to)
    staged = stagedRes
    if (stagedRes.localPaths.length === 0) throw new Error('no_segments_in_range')

    job.progress = 0.05

    // Concatena segmentos em 1 mp4 intermediário, depois recorta o range exato.
    concatPath = join(os.tmpdir(), `icv-concat-${job.id}.mp4`)
    await concatSegments(stagedRes.localPaths, concatPath)

    // Calcula offset relativo ao início do PRIMEIRO segmento usado
    const firstSegStart = stagedRes.segments[0].startedAt.getTime()
    const offsetSec = Math.max(0, (opts.from.getTime() - firstSegStart) / 1000)
    const durationSec = Math.max(0.1, totalDurationMs / 1000)

    await runFfmpegWithProgress(job, [
      '-ss', String(offsetSec),
      '-i', concatPath,
      '-t', String(durationSec),
      '-c', 'copy',
      '-y', outPath,
    ], totalDurationMs)

    if (job.status === 'cancelled') return

    const sha = await sha256OfFile(outPath)
    const size = await fileSize(outPath)
    let certId: string | null = null

    if (opts.includeCertificate) {
      const cert = await signMediaInternal({
        tenantId: opts.tenantId,
        cameraId: opts.cameraId,
        type: 'RECORDING',
        capturedAt: opts.from,
        sha256: sha,
        fileName: `${job.id}.mp4`,
        fileSize: size,
        exportedBy: opts.userId,
        metadata: { jobId: job.id, from: opts.from.toISOString(), to: opts.to.toISOString() },
      })
      certId = cert.id
    }

    await recordExport(opts.tenantId, opts.userId, {
      cameraIds: [opts.cameraId],
      exportType: 'RECORDING',
      fromAt: opts.from,
      toAt: opts.to,
      fileSizeBytes: size,
      destination: 'local',
      certificateId: certId,
      metadata: { jobId: job.id },
    })

    const ticket = exportService.issueDownloadTicket(job.id, job.tenantId)
    job.result = {
      url: `/exports/${job.id}.mp4?ticket=${encodeURIComponent(ticket)}`,
      sha256: sha, certId, sizeBytes: size,
    }
    job.status = 'done'
    job.progress = 1
  } catch (err: any) {
    if (job.status !== 'cancelled') {
      job.status = 'error'
      job.error = err?.message ?? String(err)
      logger.warn({ err, jobId: job.id }, 'export_recording_failed')
    }
  } finally {
    if (concatPath) await fs.unlink(concatPath).catch(() => {})
    if (staged) await staged.cleanup()
  }
}

async function runMosaic(job: JobState, opts: MosaicOpts): Promise<void> {
  const outPath = join(EXPORTS_DIR, `${job.id}.mp4`)
  const stagedAll: Array<{ cleanup: () => Promise<void> }> = []
  const intermediates: string[] = []
  const totalDurationMs = opts.to.getTime() - opts.from.getTime()

  try {
    if (opts.cameraIds.length < 2 || opts.cameraIds.length > 4) {
      throw new Error('mosaic_requires_2_to_4_cameras')
    }

    job.progress = 0.05

    // Para cada câmera, baixa segmentos + concat em 1 mp4 alinhado ao range.
    const camMp4s: string[] = []
    for (let i = 0; i < opts.cameraIds.length; i++) {
      const cid = opts.cameraIds[i]
      const staged = await fetchAndStageSegments(cid, opts.from, opts.to)
      stagedAll.push(staged)
      if (staged.localPaths.length === 0) {
        throw new Error(`no_segments_for_camera:${cid}`)
      }
      const concatTmp = join(os.tmpdir(), `icv-mosaic-${job.id}-${i}.mp4`)
      intermediates.push(concatTmp)
      await concatSegments(staged.localPaths, concatTmp)

      const firstStart = staged.segments[0].startedAt.getTime()
      const offsetSec = Math.max(0, (opts.from.getTime() - firstStart) / 1000)
      const durSec = Math.max(0.1, totalDurationMs / 1000)
      const trimmed = join(os.tmpdir(), `icv-mosaic-${job.id}-${i}-trim.mp4`)
      intermediates.push(trimmed)
      await runFfmpegOnce([
        '-ss', String(offsetSec),
        '-i', concatTmp,
        '-t', String(durSec),
        '-c', 'copy',
        '-y', trimmed,
      ])
      camMp4s.push(trimmed)
      job.progress = 0.05 + (0.4 * (i + 1) / opts.cameraIds.length)
    }

    // Layout filter
    const filterArgs = buildMosaicFilter(opts.layout, camMp4s.length)

    const inputArgs: string[] = []
    for (const f of camMp4s) inputArgs.push('-i', f)

    await runFfmpegWithProgress(job, [
      ...inputArgs,
      '-filter_complex', filterArgs,
      '-map', '[v]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
      '-y', outPath,
    ], totalDurationMs)

    if (job.status === 'cancelled') return

    const sha = await sha256OfFile(outPath)
    const size = await fileSize(outPath)
    let certId: string | null = null

    if (opts.includeCertificate) {
      const cert = await signMediaInternal({
        tenantId: opts.tenantId,
        type: 'MOSAIC_EXPORT',
        capturedAt: opts.from,
        sha256: sha,
        fileName: `${job.id}.mp4`,
        fileSize: size,
        exportedBy: opts.userId,
        metadata: {
          jobId: job.id,
          cameraIds: opts.cameraIds,
          layout: opts.layout,
          from: opts.from.toISOString(),
          to: opts.to.toISOString(),
        },
      })
      certId = cert.id
    }

    await recordExport(opts.tenantId, opts.userId, {
      cameraIds: opts.cameraIds,
      exportType: 'MOSAIC',
      fromAt: opts.from,
      toAt: opts.to,
      fileSizeBytes: size,
      destination: 'local',
      certificateId: certId,
      metadata: { jobId: job.id, layout: opts.layout },
    })

    const ticket = exportService.issueDownloadTicket(job.id, job.tenantId)
    job.result = {
      url: `/exports/${job.id}.mp4?ticket=${encodeURIComponent(ticket)}`,
      sha256: sha, certId, sizeBytes: size,
    }
    job.status = 'done'
    job.progress = 1
  } catch (err: any) {
    if (job.status !== 'cancelled') {
      job.status = 'error'
      job.error = err?.message ?? String(err)
      logger.warn({ err, jobId: job.id }, 'export_mosaic_failed')
    }
  } finally {
    for (const f of intermediates) await fs.unlink(f).catch(() => {})
    for (const s of stagedAll) await s.cleanup()
  }
}

/**
 * Constrói filtro -filter_complex apropriado pra layout + qtd câmeras.
 * Câmeras faltantes (ex: 3 câmeras em layout 2x2) recebem padding preto.
 */
function buildMosaicFilter(layout: '2x2' | '1x4' | '4x1', count: number): string {
  // Normaliza todas pra 640x360 antes de empilhar — evita problema com
  // câmeras de resoluções diferentes que quebram h/vstack.
  const SCALE = 'scale=640:360,setsar=1'
  const scaleParts: string[] = []
  for (let i = 0; i < count; i++) {
    scaleParts.push(`[${i}:v]${SCALE}[c${i}]`)
  }

  if (layout === '1x4') {
    // 4 vídeos lado a lado; se count<4, hstack só com os existentes.
    const inputs = Array.from({ length: count }, (_, i) => `[c${i}]`).join('')
    return scaleParts.join(';') + `;${inputs}hstack=inputs=${count}[v]`
  }

  if (layout === '4x1') {
    const inputs = Array.from({ length: count }, (_, i) => `[c${i}]`).join('')
    return scaleParts.join(';') + `;${inputs}vstack=inputs=${count}[v]`
  }

  // 2x2 default — preenche com black até 4
  // Pra count<4 usamos `color` filter como input sintético dummy.
  if (count === 4) {
    return scaleParts.join(';') +
      ';[c0][c1]hstack[t];[c2][c3]hstack[b];[t][b]vstack[v]'
  }
  if (count === 3) {
    // 3 câmeras: top dois, bottom um centralizado com pad
    return scaleParts.join(';') +
      ';[c0][c1]hstack[t]' +
      ';color=c=black:s=640x360,setsar=1[blk]' +
      ';[c2][blk]hstack[b]' +
      ';[t][b]vstack[v]'
  }
  // count === 2 → 2x1 hstack
  return scaleParts.join(';') + ';[c0][c1]hstack[v]'
}
