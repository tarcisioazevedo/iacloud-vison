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
import { getEffectiveRecordingMode } from './recording-effective-mode.service'
import { isRecordingPaused } from './recording-tmpfs-watchdog.service'
import { detectCodec, ffmpegCopyArgs, hasAudioStream, ffmpegAudioArgs } from './ffprobe-codec.service'

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
  /** Codec detectado via ffprobe — anotado em RecordingSegment.codec. */
  codec:        'h264' | 'h265' | 'unknown'
}

const active = new Map<string, RecorderState>()

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Parseia timestamp strftime do nome do arquivo: "20240101_120000" → Date (UTC) */
function parseSegTimestamp(name: string): Date {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
  if (!m) return new Date()
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
}

/**
 * Pipeline de upload (G1 fix — 2026-05-09):
 *
 *   1. Renomeia arquivo do tmpfs pro layout canônico
 *      `{cameraId}/{YYYY-MM-DD}/{HH-MM-SS}_{uuid}.ts` (mesmo do recording-storage).
 *   2. INSERT RecordingSegment com uploadStatus=PENDING + storagePath canônico.
 *   3. Tenta upload R2.
 *   4a. Sucesso → UPDATE UPLOADED + unlink local.
 *   4b. Falha   → mantém arquivo local. Worker reprocessa a partir de PENDING.
 *
 * Por que mover o arquivo:
 *   recordingStorage.uploadToCloud(integradorId, storagePath) assume
 *   localPath = BASE_PATH + storagePath. Sem mover, o worker não acharia
 *   o arquivo local pra retry.
 */
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

  // Layout canônico (igual ao recording-storage e recording-ingest).
  const datePart = startedAt.toISOString().slice(0, 10)                 // YYYY-MM-DD
  const timePart = startedAt.toISOString().slice(11, 19).replace(/:/g, '-')  // HH-mm-ss
  const storagePath = `${cameraId}/${datePart}/${timePart}_${segmentId}.ts`
  const canonicalLocal = join(BASE_PATH, storagePath)

  // ── 1. Move pro layout canônico ──────────────────────────────────────────
  try {
    await fs.mkdir(join(BASE_PATH, cameraId, datePart), { recursive: true })
    await fs.rename(localPath, canonicalLocal)
  } catch (err) {
    logger.warn({ err, localPath, canonicalLocal }, 'cloud_direct_rename_failed')
    return
  }

  // ── 2. INSERT PENDING ────────────────────────────────────────────────────
  // G3 fix: lê recordMode pra decidir motion-gate.
  const cam = await prisma.camera.findUnique({
    where:  { id: cameraId },
    select: { recordMode: true },
  }).catch(() => null)
  const isMotionGated = cam?.recordMode === 'MOTION' || cam?.recordMode === 'ACTIVE_OBJECTS'
  const motionGateGraceMs = Number(process.env.MOTION_GATE_GRACE_MS ?? 5 * 60_000)
  const deleteAfterReviewAt = isMotionGated
    ? new Date(Date.now() + motionGateGraceMs)
    : null

  // G10 fix: codec do RecorderState (detectado via ffprobe no startRecording).
  const recState = active.get(cameraId)
  const detectedCodec = recState?.codec === 'h265' ? 'h265' : 'h264'

  try {
    await prisma.recordingSegment.create({
      data: {
        id:             segmentId,
        cameraId,
        startedAt,
        endedAt,
        durationSec:    SEGMENT_SEC,
        sizeBytes:      BigInt(sizeBytes),
        storagePath,
        codec:          detectedCodec,
        uploadStatus:   'PENDING',
        uploadAttempts: 0,
        // hasMotion: false (default no schema) — flips via markSegmentMotion
        deleteAfterReviewAt,
      },
    })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Duplicado (cameraId, startedAt) — idempotente. Apaga arquivo, sai.
      await fs.unlink(canonicalLocal).catch(() => {})
      return
    }
    logger.warn({ err, cameraId, storagePath }, 'cloud_direct_segment_insert_err')
    await fs.unlink(canonicalLocal).catch(() => {})
    return
  }

  // ── 3. Tenta upload R2 ───────────────────────────────────────────────────
  const uploaded = await r2Storage.uploadFile(integradorId, canonicalLocal, storagePath)

  // ── 4. Atualiza estado ───────────────────────────────────────────────────
  if (uploaded) {
    await prisma.recordingSegment.update({
      where: { id: segmentId },
      data: {
        uploadStatus:   'UPLOADED',
        uploadedAt:     new Date(),
        uploadBucket:   `icv-${integradorId}`,
        uploadAttempts: 1,
      },
    }).catch(err => logger.warn({ err, segmentId }, 'cloud_direct_status_update_err'))
    await fs.unlink(canonicalLocal).catch(() => {})
    logger.debug({ cameraId, storagePath, sizeBytes }, 'cloud_direct_seg_uploaded')
  } else {
    await prisma.recordingSegment.update({
      where: { id: segmentId },
      data: {
        uploadAttempts: 1,
        uploadError:    'cloud_direct first attempt failed',
      },
    }).catch(() => {})
    logger.warn({ cameraId, storagePath }, 'cloud_direct_seg_upload_failed_will_retry')
    // Arquivo permanece em canonicalLocal — worker pega.
  }
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

    // G4 fix: tmpfs cheio → não inicia novos ffmpeg.
    if (isRecordingPaused()) {
      logger.warn({ cameraId }, 'cloud_direct_skip_tmpfs_paused')
      return false
    }

    // G2 fix: respeita RecordingSchedule. Se modo efetivo = DISABLED no
    // momento atual, não inicia gravação. O reconcile-tick reinicia quando
    // a janela permitida começar.
    const eff = await getEffectiveRecordingMode(cameraId).catch(() => null)
    if (eff && !eff.shouldRecord) {
      logger.info({ cameraId, baseMode: eff.baseMode, hasSchedule: eff.hasSchedule },
        'cloud_direct_skip_outside_schedule')
      return false
    }

    const segDir   = join(BASE_PATH, 'cloud-direct', cameraId)
    const rtspUrl  = `${GO2RTC_RTSP}/${streamKey}`
    const pattern  = join(segDir, '%Y%m%d_%H%M%S.ts')

    await fs.mkdir(segDir, { recursive: true })

    // G10+G19 fix: detecta codec + presença de áudio antes do spawn.
    // Em paralelo via Promise.all pra economizar ~3s no boot.
    const [codec, hasAudio] = await Promise.all([
      detectCodec(rtspUrl),
      hasAudioStream(rtspUrl),
    ])
    const codecArgs = ffmpegCopyArgs(codec)
    const audioArgs = ffmpegAudioArgs(hasAudio)

    logger.info({ cameraId, streamKey, codec, hasAudio }, 'cloud_direct_ffmpeg_starting')

    const proc = spawn('ffmpeg', [
      '-loglevel',          'error',
      '-rtsp_transport',    'tcp',
      '-i',                 rtspUrl,
      ...codecArgs,
      ...audioArgs,
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

    // Flag pra distinguir "stop solicitado" vs "ffmpeg morreu sozinho".
    // Quando user chama stopRecording, marca → exit handler não auto-restart.
    let stopRequested = false
    ;(proc as any).__stopRequested = () => { stopRequested = true }

    proc.on('exit', (code, signal) => {
      logger.info({ cameraId, streamKey, code, signal, stopRequested }, 'cloud_direct_ffmpeg_exit')
      const s = active.get(cameraId)
      if (s) {
        clearInterval(s.pollTimer)
        active.delete(cameraId)
        // Upload dos segmentos restantes no disco ao sair
        pollSegments(s).catch(() => {})
      }

      // Auto-restart: se ffmpeg morreu sozinho (não solicitado) E push real
      // continua ativo no go2rtc, reinicia em 3s. Cobre casos:
      //  - go2rtc reiniciou
      //  - segment rotation ffmpeg crash
      //  - rede instável momentânea entre cloud-direct-recorder ↔ go2rtc
      if (!stopRequested && code === 0) {
        setTimeout(async () => {
          try {
            // Confirma que o push ainda está chegando (rtmpIngestLastFrameAt < 30s)
            const cam = await prisma.camera.findUnique({
              where: { id: cameraId },
              select: { rtmpIngestLastFrameAt: true, deploymentMode: true, ingestMode: true },
            })
            if (!cam) return
            const lastFrame = cam.rtmpIngestLastFrameAt?.getTime() ?? 0
            const ageSec = (Date.now() - lastFrame) / 1000
            if (ageSec < 30 && cam.deploymentMode === 'CLOUD_DIRECT' &&
                (cam.ingestMode === 'RTMP_PUSH' || cam.ingestMode === 'SRT_PUSH')) {
              logger.info({ cameraId, streamKey, lastFrameAgeSec: ageSec },
                'cloud_direct_auto_restart_recording')
              cloudDirectRecorder.startRecording(cameraId, streamKey, integradorId).catch(err =>
                logger.warn({ err, cameraId, streamKey }, 'cloud_direct_auto_restart_failed'),
              )
            }
          } catch (err) {
            logger.warn({ err, cameraId }, 'cloud_direct_auto_restart_check_failed')
          }
        }, 3000)
      }
    })

    const state: RecorderState = { cameraId, streamKey, integradorId, proc, segDir, pollTimer: null as any, codec }
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
    // Marca stop solicitado pra exit handler NÃO auto-restartar.
    if ((state.proc as any).__stopRequested) (state.proc as any).__stopRequested()
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
   * G12 fix: retorna null se não achar (em vez de 'default').
   * Caller deve abortar gravação e logar tenancy_misconfigured.
   */
  async resolveIntegradorId(cameraId: string): Promise<string | null> {
    const ctx = await getCameraContext(cameraId).catch(() => null)
    return ctx?.integradorId ?? null
  },

  /**
   * Reconcile-tick: percorre câmeras ativas e para gravação das que estão
   * fora da janela de schedule. Inicia também as que estão dentro mas não
   * iniciaram (ex: virou meia-noite e schedule abriu).
   * Chamado a cada 60s pelo timer registrado em start().
   */
  async tickReconcileSchedule(): Promise<void> {
    if (!ENABLED) return
    const now = new Date()

    // 1. Para gravações ativas que saíram da janela.
    for (const [cameraId] of active) {
      const eff = await getEffectiveRecordingMode(cameraId, now).catch(() => null)
      if (eff && !eff.shouldRecord) {
        logger.info({ cameraId }, 'cloud_direct_stopping_outside_schedule')
        this.stopRecording(cameraId)
      }
    }

    // 2. Inicia gravações para câmeras com push ativo + dentro da janela
    //    + não-rodando. Filtra recente: rtmpIngestLastFrameAt < 30s.
    const since = new Date(Date.now() - 30_000)
    const candidates = await prisma.camera.findMany({
      where: {
        deploymentMode: 'CLOUD_DIRECT',
        ingestMode:     { in: ['RTMP_PUSH', 'SRT_PUSH'] },
        active:         true,
        recordEnabled:  true,
        rtmpIngestLastFrameAt: { gt: since },
      },
      select: { id: true, go2rtcStreamId: true },
    })
    for (const cam of candidates) {
      if (!cam.go2rtcStreamId) continue
      if (active.has(cam.id)) continue
      const eff = await getEffectiveRecordingMode(cam.id, now).catch(() => null)
      if (!eff?.shouldRecord) continue
      const integradorId = await this.resolveIntegradorId(cam.id)
      if (!integradorId) continue   // G12 — sem tenant, não grava
      this.startRecording(cam.id, cam.go2rtcStreamId, integradorId).catch(() => {})
    }
  },
}

// Schedule reconcile timer — registrado em app.ts no boot.
let scheduleTimer: NodeJS.Timeout | null = null
export function startCloudDirectScheduleReconcile(): void {
  if (scheduleTimer) return
  if (!ENABLED) return
  scheduleTimer = setInterval(() => {
    cloudDirectRecorder.tickReconcileSchedule().catch(err =>
      logger.warn({ err }, 'cloud_direct_schedule_tick_failed'),
    )
  }, 60_000)
  logger.info('cloud_direct_schedule_reconcile_started')
}
export function stopCloudDirectScheduleReconcile(): void {
  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null }
}
