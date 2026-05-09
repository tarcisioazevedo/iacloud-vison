/**
 * Cloud-Direct Recorder — grava câmeras RTMP_PUSH / CLOUD_DIRECT direto no R2.
 *
 * Fluxo:
 *   1. Câmera push RTMP → go2rtc:1935  (ingest.service detecta AUTH_OK)
 *   2. ingest.service chama cloudDirectRecorder.startRecording()
 *   3. ffmpeg lê RTSP de go2rtc:8554/{streamKey} e segmenta em /recordings/cloud-direct/{cameraId}/
 *   4. Polling a cada 2s detecta segmentos completos (todos exceto o último)
 *   5. Cada segmento completo → upload R2 → delete local → RecordingSegment no DB
 *   6. Quando câmera para (PUBLISH_END), ingest.service chama stopRecording()
 *
 * Zero disco em produção:
 *   A pasta /recordings é montada como tmpfs no Docker Swarm (RAM pura).
 *   Segmento de 6s FHD H.264 ≈ 10-15 MB → a cada tick, o segmento anterior
 *   já está no R2 e deletado do tmpfs. Pico de uso = 1 segmento em escrita
 *   por câmera (≈ 15 MB × N câmeras). Para 50 câmeras = ~750 MB tmpfs.
 *
 * Por que polling e não fs.watch:
 *   fs.watch tem comportamento inconsistente em tmpfs (inotify) para detectar
 *   "arquivo fechado". Polling de 2s em diretório pequeno é O(n) com n ≤ 6
 *   arquivos — custo desprezível vs confiabilidade.
 *
 * Segurança:
 *   - segDir por cameraId (UUID) — sem path traversal
 *   - ffmpeg lê apenas RTSP interno (rede Docker, não exposta)
 *   - Credenciais R2 via env (não passadas ao ffmpeg)
 */
import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { r2Storage } from './r2-storage.service'
import { getCameraContext } from './camera-context.service'

const BASE_PATH      = process.env.RECORDINGS_BASE_PATH       ?? '/recordings'
const SEGMENT_SEC    = Number(process.env.RECORDING_SEGMENT_SECONDS ?? 6)
const GO2RTC_RTSP    = (process.env.GO2RTC_RTSP_URL ?? 'rtsp://go2rtc:8554').replace(/\/$/, '')
const ENABLED        = process.env.RECORDING_ENABLED !== 'false'
const POLL_MS        = 2_000

interface RecorderState {
  cameraId:     string
  streamKey:    string
  integradorId: string
  proc:         ChildProcess
  segDir:       string
  pollTimer:    NodeJS.Timeout
}

const active = new Map<string, RecorderState>()

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Parseia timestamp strftime do nome do arquivo: "20240101_120000" → Date (UTC) */
function parseSegTimestamp(name: string): Date {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
  if (!m) return new Date()
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
}

/** R2 key para um segmento cloud-direct */
function makeR2Key(cameraId: string, date: string, filename: string, segmentId: string): string {
  return `${cameraId}/${date}/${filename.replace('.ts', '')}_${segmentId}.ts`
}

async function uploadSegment(
  segDir: string,
  filename: string,
  cameraId: string,
  integradorId: string,
): Promise<void> {
  const localPath = join(segDir, filename)

  let sizeBytes: number
  try {
    sizeBytes = (await fs.stat(localPath)).size
  } catch {
    return // arquivo sumiu (cleanup anterior) — ok
  }

  if (sizeBytes === 0) {
    await fs.unlink(localPath).catch(() => {})
    return
  }

  const startedAt  = parseSegTimestamp(filename)
  const endedAt    = new Date(startedAt.getTime() + SEGMENT_SEC * 1_000)
  const segmentId  = randomUUID()
  const date       = startedAt.toISOString().slice(0, 10)
  const r2Key      = makeR2Key(cameraId, date, filename, segmentId)

  const uploaded = await r2Storage.uploadFile(integradorId, localPath, r2Key)
  await fs.unlink(localPath).catch(() => {})

  try {
    await prisma.recordingSegment.create({
      data: {
        id:             segmentId,
        cameraId,
        startedAt,
        endedAt,
        durationSec:    SEGMENT_SEC,
        sizeBytes:      BigInt(sizeBytes),
        storagePath:    r2Key,
        uploadStatus:   uploaded ? 'UPLOADED' : 'FAILED',
        uploadedAt:     uploaded ? new Date() : null,
        uploadBucket:   uploaded ? `icv-${integradorId}` : null,
        uploadAttempts: 1,
        hasMotion:      true,
      },
    })
  } catch (err) {
    logger.warn({ err, cameraId, r2Key }, 'cloud_direct_segment_db_err')
  }

  logger.debug({ cameraId, r2Key, uploaded, sizeBytes }, 'cloud_direct_seg_uploaded')
}

/** Poll: lista dir, faz upload de todos os .ts exceto o último (ainda em escrita) */
async function pollSegments(state: RecorderState): Promise<void> {
  let files: string[]
  try {
    files = (await fs.readdir(state.segDir))
      .filter(f => f.endsWith('.ts'))
      .sort()
  } catch {
    return
  }

  // O arquivo com nome mais alto (strftime order) é o que ffmpeg está escrevendo agora.
  // Todos os anteriores estão fechados → upload seguro.
  const done = files.slice(0, -1)
  for (const f of done) {
    await uploadSegment(state.segDir, f, state.cameraId, state.integradorId)
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export const cloudDirectRecorder = {
  async startRecording(
    cameraId:     string,
    streamKey:    string,
    integradorId: string,
  ): Promise<boolean> {
    if (!ENABLED) return false
    if (active.has(cameraId)) return true

    const segDir   = join(BASE_PATH, 'cloud-direct', cameraId)
    const rtspUrl  = `${GO2RTC_RTSP}/${streamKey}`
    const pattern  = join(segDir, '%Y%m%d_%H%M%S.ts')

    await fs.mkdir(segDir, { recursive: true })

    const proc = spawn('ffmpeg', [
      '-loglevel',          'error',
      '-rtsp_transport',    'tcp',
      '-i',                 rtspUrl,
      '-c:v',               'copy',
      '-c:a',               'copy',
      '-f',                 'segment',
      '-segment_time',      String(SEGMENT_SEC),
      '-segment_format',    'mpegts',
      '-strftime',          '1',
      '-reset_timestamps',  '1',
      pattern,
    ], { detached: false })

    proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) logger.debug({ cameraId, msg }, 'cloud_direct_ffmpeg')
    })

    proc.on('exit', (code) => {
      logger.info({ cameraId, streamKey, code }, 'cloud_direct_ffmpeg_exit')
      const s = active.get(cameraId)
      if (s) {
        clearInterval(s.pollTimer)
        active.delete(cameraId)
        // Upload dos segmentos restantes no disco ao sair
        pollSegments(s).catch(() => {})
      }
    })

    const state: RecorderState = { cameraId, streamKey, integradorId, proc, segDir, pollTimer: null as any }
    state.pollTimer = setInterval(() => {
      pollSegments(state).catch(err => logger.warn({ err, cameraId }, 'cloud_direct_poll_err'))
    }, POLL_MS)

    active.set(cameraId, state)
    logger.info({ cameraId, streamKey, rtspUrl, segDir }, 'cloud_direct_recording_started')
    return true
  },

  stopRecording(cameraId: string): void {
    const state = active.get(cameraId)
    if (!state) return
    clearInterval(state.pollTimer)
    state.proc.kill('SIGTERM')
    // Não deletamos do active aqui — o handler proc.on('exit') faz isso
    // e ainda roda o poll final para capturar o último segmento.
    logger.info({ cameraId }, 'cloud_direct_recording_stop_requested')
  },

  isRecording(cameraId: string): boolean {
    return active.has(cameraId)
  },

  stopAll(): void {
    for (const [cameraId] of active) this.stopRecording(cameraId)
  },

  /**
   * Resolve integradorId de uma câmera via getCameraContext (com cache 5min).
   * Retorna 'default' se não achar — não bloqueia o start do recorder.
   */
  async resolveIntegradorId(cameraId: string): Promise<string> {
    const ctx = await getCameraContext(cameraId).catch(() => null)
    return ctx?.integradorId ?? 'default'
  },
}
