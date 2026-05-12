/**
 * FFmpeg Snapshot Service — captura um frame único de stream RTSP/HTTP
 * usando o `ffmpeg` instalado dentro do container. Devolve JPEG (Buffer).
 *
 * Por que não usar go2rtc/api/frame.jpeg:
 *   - O go2rtc do Frigate (1.9.13) só serve frame.jpeg quando o stream
 *     tem transcoder ativo (config explícita no go2rtc.yaml). Sem isso,
 *     retorna 500. Para snapshots avulsos no UI, é mais robusto fazermos
 *     localmente com ffmpeg — funciona com qualquer stream RTSP que a
 *     rede do container alcance.
 *
 * Segurança & Confiabilidade
 *   - URL é validada (apenas rtsp:/rtsps:/http:/https:) antes de spawn,
 *     evitando injeção de flags ffmpeg via parâmetros do usuário.
 *   - Argumentos passados como ARRAY (sem shell) — execve direto, não há
 *     interpretação de aspas/$/\\.
 *   - Timeout duro de 8s; se ffmpeg não terminar, recebe SIGKILL.
 *   - stdout limitado a 10 MB para impedir consumo de memória se algum
 *     stream malformado mandar dados gigantes.
 *   - tini está no PID 1 do container — reaping é correto mesmo com
 *     SIGKILL (sem zombies).
 *
 * Performance
 *   - `-rtsp_transport tcp`: transporte confiável; UDP perde pacotes
 *     em redes corporativas/NAT (a maioria dos casos).
 *   - `-frames:v 1`: encerra ao escrever 1 frame.
 *   - `-q:v 2`: qualidade JPEG alta (~90%) sem virar arquivo gigante.
 *   - `-an -sn`: descarta áudio e legendas; só vídeo.
 *   - Sem `-re`: lê o mais rápido possível, ideal para snapshot pontual.
 *
 * Uso típico:
 *   const buf = await captureSnapshot('rtsp://user:pass@host/stream')
 *   res.type('image/jpeg').send(buf)
 */
import { spawn } from 'child_process'
import { URL } from 'url'
import { logger } from '../lib/logger'

const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg'
// 15s default — câmeras Hikvision/Dahua geralmente respondem em 2-4s, mas
// quando há sessões concorrentes (ex: Frigate + nosso ffprobe) o handshake
// RTSP pode demorar. 8s mostrou ser muito apertado em testes reais.
const TIMEOUT_MS = Number(process.env.SNAPSHOT_TIMEOUT_MS ?? 15000)
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_PROTOCOLS = new Set(['rtsp:', 'rtsps:', 'http:', 'https:'])

export class FfmpegSnapshotError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_URL'
      | 'TIMEOUT'
      | 'FFMPEG_FAILED'
      | 'TOO_LARGE'
      | 'NO_OUTPUT'
      // 2026-05-12 — novo código pra distinguir CDN/tunnel offline de erro
      // genérico do ffmpeg. UI usa pra exibir mensagem específica.
      | 'TUNNEL_OFFLINE',
    public readonly stderrTail?: string,
  ) {
    super(message)
    this.name = 'FfmpegSnapshotError'
  }
}

/**
 * Valida URL e devolve a versão sanitizada para passar ao ffmpeg.
 * Throws FfmpegSnapshotError se inválida.
 */
function validateUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new FfmpegSnapshotError(`URL inválida: ${rawUrl.slice(0, 80)}`, 'INVALID_URL')
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new FfmpegSnapshotError(
      `Protocolo não suportado: ${parsed.protocol}`,
      'INVALID_URL',
    )
  }
  if (!parsed.hostname) {
    throw new FfmpegSnapshotError('URL sem host', 'INVALID_URL')
  }
  return parsed.toString()
}

/**
 * Captura um frame como JPEG. Retorna Buffer.
 */
export async function captureSnapshot(rtspUrl: string): Promise<Buffer> {
  const url = validateUrl(rtspUrl)

  // Argumentos para ffmpeg. Cada item é um arg separado — sem shell,
  // sem expansão. Strings como a URL viajam intactas para execve.
  // Notas sobre flags:
  //   -rtsp_transport tcp  : evita NAT/UDP-loss em redes corporativas
  //   -timeout 10000000    : 10s socket timeout (microsegundos). No ffmpeg
  //     7+ a flag pré-input para o demuxer RTSP é `-timeout`; `-stimeout`
  //     foi removido; `-rw_timeout` é só pra HTTP/TCP genérico.
  //   -analyzeduration / -probesize : limita o probing inicial pra
  //     acelerar o handshake (não precisamos detectar todas as streams).
  //   -frames:v 1          : encerra ao escrever 1 frame
  //   -q:v 2               : qualidade JPEG ~90%
  //   -an -sn              : descarta áudio/legendas
  //   -fflags +nobuffer    : reduz buffering inicial
  // Wall-clock timeout (TIMEOUT_MS) é o backup final se algo estourar.
  // -update 1 é OBRIGATÓRIO no ffmpeg 7+/8: o muxer image2 sem padrão
  // (%03d/%d.jpg) recusa-se a escrever quando o destino é um único path
  // ou pipe; exige -update para confirmar "sim, é 1 frame substituindo".
  // Sem isso, o ffmpeg 8 emite o warning "Use the -update option" e NÃO
  // escreve nada no stdout — provoca timeout do nosso wall-clock.
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-rtsp_transport', 'tcp',
    '-timeout', '10000000',
    '-analyzeduration', '500000',
    '-probesize', '500000',
    '-fflags', '+nobuffer',
    '-i', url,
    '-frames:v', '1',
    '-q:v', '2',
    '-an', '-sn',
    '-f', 'image2',
    '-c:v', 'mjpeg',
    '-update', '1',
    'pipe:1',
  ]

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Sem shell: sem interpolação de variáveis nem injection.
      shell: false,
    })

    const chunks: Buffer[] = []
    let total = 0
    let killed = false
    const stderrChunks: Buffer[] = []

    const timer = setTimeout(() => {
      killed = true
      proc.kill('SIGKILL')
    }, TIMEOUT_MS)
    timer.unref()

    proc.stdout.on('data', (c: Buffer) => {
      total += c.length
      if (total > MAX_BYTES) {
        killed = true
        proc.kill('SIGKILL')
        reject(
          new FfmpegSnapshotError(
            `output excedeu ${MAX_BYTES} bytes`,
            'TOO_LARGE',
          ),
        )
        return
      }
      chunks.push(c)
    })

    proc.stderr.on('data', (c: Buffer) => {
      // limita stderr a 8 KB para o log não estourar
      if (stderrChunks.reduce((s, b) => s + b.length, 0) < 8192) {
        stderrChunks.push(c)
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      // ENOENT = ffmpeg não encontrado (instalação faltando)
      reject(
        new FfmpegSnapshotError(
          `falha ao spawnar ffmpeg: ${err.message}`,
          'FFMPEG_FAILED',
        ),
      )
    })

    proc.on('close', (code, signal) => {
      clearTimeout(timer)
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()

      if (killed) {
        const err = new FfmpegSnapshotError(
          `ffmpeg morto por timeout (${TIMEOUT_MS}ms) ou limite de tamanho`,
          'TIMEOUT',
          stderr,
        )
        reject(err)
        return
      }

      if (code !== 0) {
        logger.warn(
          { code, signal, stderrTail: stderr.slice(-500) },
          'ffmpeg_snapshot_nonzero',
        )
        reject(
          new FfmpegSnapshotError(
            `ffmpeg saiu com código ${code}`,
            'FFMPEG_FAILED',
            stderr,
          ),
        )
        return
      }

      const buf = Buffer.concat(chunks)
      if (buf.length === 0) {
        reject(new FfmpegSnapshotError('ffmpeg gerou 0 bytes', 'NO_OUTPUT', stderr))
        return
      }

      // Sanity check: JPEG começa com FF D8 FF
      if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
        reject(
          new FfmpegSnapshotError(
            `output não é JPEG válido (magic: ${buf.slice(0, 3).toString('hex')})`,
            'NO_OUTPUT',
            stderr,
          ),
        )
        return
      }

      resolve(buf)
    })
  })
}
