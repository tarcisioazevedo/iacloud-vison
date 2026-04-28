/**
 * RTSP Test Service — valida conexão RTSP via ffprobe + probe de metadata.
 *
 * Em dev (sem ffprobe instalado) → retorna mock realista.
 * Em prod → invoca `ffprobe -v error -show_streams -of json <url>` com timeout.
 */
import { spawn } from 'child_process'
import { prisma } from '../lib/prisma'
import { cameraLogService } from './camera-log.service'

const IS_DEV = process.env.NODE_ENV !== 'production'
const FFPROBE_BIN = process.env.FFPROBE_BIN ?? 'ffprobe'
const TIMEOUT_MS = Number(process.env.RTSP_TEST_TIMEOUT_MS ?? 15_000)

export interface RtspTestResult {
  success:    boolean
  stage:      'dns' | 'tcp' | 'rtsp_describe' | 'rtsp_play' | 'ffmpeg_probe' | 'onvif_probe' | 'complete'
  resolution?: string
  fps?:        number
  codec?:      string
  bitrateKbps?: number
  latencyMs?:   number
  errorCode?:   string
  errorMessage?: string
  rawOutput?:   string
}

class RtspTestService {
  async testCamera(cameraId: string, rtspUrl: string): Promise<RtspTestResult> {
    const started = Date.now()

    // DEV mock
    if (IS_DEV) {
      const mock: RtspTestResult = {
        success:      true,
        stage:        'complete',
        resolution:   '1920x1080',
        fps:          25,
        codec:        'h264',
        bitrateKbps:  4096,
        latencyMs:    120 + Math.floor(Math.random() * 100),
        rawOutput:    '[dev mock] ffprobe simulated OK',
      }
      await this.persist(cameraId, rtspUrl, mock)
      return mock
    }

    // PROD — invoca ffprobe
    try {
      const raw = await this.runFfprobe(rtspUrl)
      const parsed = this.parseFfprobeJson(raw)
      const result: RtspTestResult = {
        ...parsed,
        success: true,
        stage: 'complete',
        latencyMs: Date.now() - started,
        rawOutput: raw.slice(0, 4096),
      }
      await this.persist(cameraId, rtspUrl, result)
      return result
    } catch (err: any) {
      const result: RtspTestResult = {
        success:      false,
        stage:        err.stage ?? 'ffmpeg_probe',
        errorCode:    err.code ?? 'FFPROBE_ERROR',
        errorMessage: err.message ?? 'Erro desconhecido',
        rawOutput:    err.rawOutput?.slice(0, 4096),
        latencyMs:    Date.now() - started,
      }
      await this.persist(cameraId, rtspUrl, result)
      return result
    }
  }

  private runFfprobe(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'error',
        '-rtsp_transport', 'tcp',
        '-show_streams',
        '-show_format',
        '-of', 'json',
        '-i', url,
      ]
      const proc = spawn(FFPROBE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL')
        reject(Object.assign(new Error('ffprobe timeout'), { code: 'TIMEOUT', stage: 'rtsp_describe' }))
      }, TIMEOUT_MS)
      proc.stdout.on('data', d => stdout += d.toString())
      proc.stderr.on('data', d => stderr += d.toString())
      proc.on('close', code => {
        clearTimeout(timeout)
        if (code === 0) resolve(stdout)
        else reject(Object.assign(new Error(stderr || `ffprobe exit ${code}`), {
          code: 'FFPROBE_FAIL', stage: 'rtsp_describe', rawOutput: stderr,
        }))
      })
      proc.on('error', err => {
        clearTimeout(timeout)
        reject(Object.assign(err, { code: 'SPAWN_FAIL', stage: 'ffmpeg_probe' }))
      })
    })
  }

  private parseFfprobeJson(raw: string) {
    try {
      const data = JSON.parse(raw)
      const video = data.streams?.find((s: any) => s.codec_type === 'video')
      if (!video) return { codec: undefined, resolution: undefined, fps: undefined }
      const fpsParts = (video.avg_frame_rate ?? '0/0').split('/').map(Number)
      const fps = fpsParts[1] > 0 ? +(fpsParts[0] / fpsParts[1]).toFixed(2) : undefined
      return {
        codec:       video.codec_name,
        resolution:  video.width && video.height ? `${video.width}x${video.height}` : undefined,
        fps,
        bitrateKbps: video.bit_rate ? Math.round(video.bit_rate / 1000) : undefined,
      }
    } catch {
      return {}
    }
  }

  private async persist(cameraId: string, _url: string, result: RtspTestResult) {
    try {
      await prisma.cameraStreamTest.create({
        data: {
          cameraId,
          success:      result.success,
          stage:        result.stage,
          resolution:   result.resolution ?? null,
          fps:          result.fps ?? null,
          codec:        result.codec ?? null,
          bitrateKbps:  result.bitrateKbps ?? null,
          latencyMs:    result.latencyMs ?? null,
          errorCode:    result.errorCode ?? null,
          errorMessage: result.errorMessage ?? null,
          rawOutput:    result.rawOutput ?? null,
        },
      })
      await cameraLogService.logCamera({
        cameraId,
        level:   result.success ? 'INFO' : 'ERROR',
        source:  'FFMPEG',
        message: result.success
          ? `Teste RTSP OK (${result.resolution ?? '?'} @ ${result.fps ?? '?'}fps ${result.codec ?? ''})`
          : `Teste RTSP FALHOU em ${result.stage}: ${result.errorMessage}`,
        details: { stage: result.stage, latencyMs: result.latencyMs },
        errorCode: result.errorCode,
      })
    } catch { /* swallow */ }
  }
}

export const rtspTestService = new RtspTestService()
