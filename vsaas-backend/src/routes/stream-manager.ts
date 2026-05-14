/**
 * Stream Manager — ingestão de streams externos (YouTube, RTSP, arquivo) para go2rtc.
 * Restrito a SUPER_ADMIN. Streams são processos ffmpeg em memória — não sobrevivem
 * a restart do backend. Usar só para testes e demonstrações.
 */
import { Router } from 'express'
import { execFile } from 'child_process'
import { spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { requireAuth, requireRole } from '../middleware/auth'
import { logger } from '../lib/logger'

const execFileAsync = promisify(execFile)

export const streamManagerRouter = Router()
streamManagerRouter.use(requireAuth)
streamManagerRouter.use(requireRole('SUPER_ADMIN'))

interface StreamEntry {
  youtubeUrl: string
  streamName: string
  startedAt: string
  proc: ChildProcess | null
  restarting: boolean
  stopped: boolean
}

const activeStreams = new Map<string, StreamEntry>()

const GO2RTC_RTSP = process.env.GO2RTC_RTSP_BASE ?? 'rtsp://go2rtc:8554'

const SAFE_NAME = /^[a-z0-9][a-z0-9\-]{0,47}$/

async function resolveUrl(inputUrl: string): Promise<string> {
  // Se já é uma URL direta (não YouTube), retorna como está
  if (!inputUrl.includes('youtube.com') && !inputUrl.includes('youtu.be')) {
    return inputUrl
  }
  const { stdout } = await execFileAsync('yt-dlp', [
    '-f', 'best[height<=720][ext=mp4]/best[height<=720]/best',
    '--get-url',
    inputUrl,
  ], { timeout: 30_000 })
  return stdout.trim().split('\n')[0]
}

function spawnFfmpeg(entry: StreamEntry) {
  if (entry.stopped) return

  const target = `${GO2RTC_RTSP}/${entry.streamName}`

  resolveUrl(entry.youtubeUrl).then((directUrl) => {
    if (entry.stopped) return

    const proc = spawn('ffmpeg', [
      '-re', '-i', directUrl,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-c:a', 'aac',
      '-f', 'rtsp', target,
    ])

    entry.proc = proc

    proc.stderr.on('data', (chunk) => {
      logger.debug({ stream: entry.streamName }, chunk.toString().slice(0, 200))
    })

    proc.on('exit', (code) => {
      logger.info({ stream: entry.streamName, code }, 'ffmpeg exited')
      entry.proc = null

      if (!entry.stopped) {
        entry.restarting = true
        // Aguarda 5s e tenta novamente com URL fresh do yt-dlp
        setTimeout(() => {
          if (!entry.stopped) {
            entry.restarting = false
            spawnFfmpeg(entry)
          }
        }, 5_000)
      }
    })
  }).catch((err) => {
    logger.warn({ stream: entry.streamName, err: err.message }, 'yt-dlp falhou — tentando em 30s')
    if (!entry.stopped) {
      setTimeout(() => spawnFfmpeg(entry), 30_000)
    }
  })
}

// GET /admin/stream-manager/list
streamManagerRouter.get('/list', (_req, res) => {
  const streams = [...activeStreams.entries()].map(([name, s]) => ({
    name,
    youtubeUrl: s.youtubeUrl,
    startedAt: s.startedAt,
    restarting: s.restarting,
    running: s.proc !== null && !s.restarting,
    rtspUrl: `${GO2RTC_RTSP}/${name}`,
    rtspLocal: `rtsp://localhost:8554/${name}`,
  }))
  res.json({ streams })
})

// POST /admin/stream-manager/start
streamManagerRouter.post('/start', async (req, res) => {
  const { youtubeUrl, streamName } = req.body as { youtubeUrl?: string; streamName?: string }

  if (!youtubeUrl || !streamName) {
    return res.status(400).json({ error: 'youtubeUrl e streamName são obrigatórios' })
  }
  if (!SAFE_NAME.test(streamName)) {
    return res.status(400).json({ error: 'streamName deve ter só letras minúsculas, números e hífens (max 48 chars)' })
  }
  if (activeStreams.has(streamName)) {
    return res.status(409).json({ error: `Stream "${streamName}" já está ativo` })
  }

  const entry: StreamEntry = {
    youtubeUrl,
    streamName,
    startedAt: new Date().toISOString(),
    proc: null,
    restarting: false,
    stopped: false,
  }

  activeStreams.set(streamName, entry)
  spawnFfmpeg(entry)

  logger.info({ streamName, youtubeUrl }, 'stream-manager: iniciado')

  res.json({
    streamName,
    rtspUrl: `${GO2RTC_RTSP}/${streamName}`,
    rtspLocal: `rtsp://localhost:8554/${streamName}`,
    message: 'Stream iniciando — aguarde ~10s para o go2rtc receber o sinal',
  })
})

// DELETE /admin/stream-manager/:name
streamManagerRouter.delete('/:name', (req, res) => {
  const { name } = req.params
  const entry = activeStreams.get(name)
  if (!entry) {
    return res.status(404).json({ error: 'Stream não encontrado' })
  }

  entry.stopped = true
  entry.proc?.kill('SIGTERM')
  activeStreams.delete(name)

  logger.info({ name }, 'stream-manager: parado')
  res.json({ stopped: name })
})
