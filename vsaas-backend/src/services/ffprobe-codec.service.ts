/**
 * ffprobe codec detection — descobre codec de uma fonte RTSP/RTMP antes
 * do supervisor spawn-ar ffmpeg. Cache em memória (TTL 5min) pra evitar
 * fazer probe a cada reconcile-tick.
 *
 * Retorna 'h264' | 'h265' | 'unknown'. Caller usa pra decidir bitstream
 * filter:
 *   h264  → -c:v copy
 *   h265  → -c:v copy -bsf:v hevc_mp4toannexb -tag:v hvc1
 *   unknown → tenta h264 (fallback histórico), loga warning
 *
 * Por que cache:
 *   reconcile-tick a cada 30s + supervisor pode crashar e reiniciar.
 *   ffprobe leva 1-3s (timeout 5s) — sem cache trava o tick.
 *
 * Limitações:
 *   - Sem retry: 1 tentativa só. Se ffprobe falhar (rede instável, RTSP
 *     intermitente), retorna 'unknown' e supervisor segue com fallback h264.
 *   - Não detecta troca de codec mid-stream. Câmera reconfigurada de h264
 *     pra h265 sem reboot do supervisor continua usando o codec antigo.
 *     Aceitar: troca de codec é evento raro; reboot do backend resolve.
 */
import { spawn } from 'child_process'
import { logger } from '../lib/logger'

const FFPROBE_BIN = process.env.FFPROBE_BIN ?? 'ffprobe'
const TTL_MS      = Number(process.env.FFPROBE_CACHE_TTL_MS ?? 5 * 60_000)
const TIMEOUT_MS  = Number(process.env.FFPROBE_TIMEOUT_MS ?? 5_000)

export type DetectedCodec = 'h264' | 'h265' | 'unknown'

interface CacheEntry {
  codec:    DetectedCodec
  detectedAt: number
}

const cache = new Map<string, CacheEntry>()

function execFfprobe(url: string): Promise<DetectedCodec> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-rtsp_transport', 'tcp',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=nokey=1:noprint_wrappers=1',
      url,
    ]

    const proc = spawn(FFPROBE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    proc.stdout?.on('data', (d) => { stdout += d.toString() })

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch {}
      resolve('unknown')
    }, TIMEOUT_MS)

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        resolve('unknown')
        return
      }
      const name = stdout.trim().toLowerCase()
      if (name === 'h264' || name === 'avc' || name === 'avc1') resolve('h264')
      else if (name === 'h265' || name === 'hevc' || name === 'hvc1') resolve('h265')
      else resolve('unknown')
    })
    proc.on('error', () => {
      clearTimeout(timer)
      resolve('unknown')
    })
  })
}

/**
 * Detecta codec da fonte com cache. Chave de cache = url completa.
 */
export async function detectCodec(url: string): Promise<DetectedCodec> {
  const cached = cache.get(url)
  if (cached && Date.now() - cached.detectedAt < TTL_MS) {
    return cached.codec
  }
  const codec = await execFfprobe(url)
  cache.set(url, { codec, detectedAt: Date.now() })
  if (codec === 'unknown') {
    logger.warn({ url: url.replace(/:[^:]+@/, ':***@') }, 'ffprobe_codec_unknown')
  } else {
    logger.info({ url: url.replace(/:[^:]+@/, ':***@'), codec }, 'ffprobe_codec_detected')
  }
  return codec
}

/**
 * Retorna args de ffmpeg pro codec detectado. h265 precisa de bitstream
 * filter pra MPEG-TS funcionar em HLS.js; h264 vai copy puro.
 *
 * Quando codec='unknown', usa fallback h264 (caso histórico — mantém
 * compatibilidade com câmeras já configuradas, só quebra em h265 raro).
 */
export function ffmpegCopyArgs(codec: DetectedCodec): string[] {
  if (codec === 'h265') {
    return ['-c:v', 'copy', '-bsf:v', 'hevc_mp4toannexb', '-tag:v', 'hvc1']
  }
  return ['-c:v', 'copy']
}

/**
 * Limpa entry do cache (caller chama quando câmera é PATCHED ou ffmpeg
 * crashou repetidamente — pode indicar codec mudou).
 */
export function invalidateCache(url: string): void {
  cache.delete(url)
}
