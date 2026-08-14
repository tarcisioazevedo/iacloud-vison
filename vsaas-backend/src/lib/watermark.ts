/**
 * Watermark builder — constrói args FFmpeg pra burn-in de marca d'água em
 * MP4 (export) e JPEG (snapshot).
 *
 * Features:
 *   - Posição (5 cantos + tile/mosaico anti-recrop)
 *   - Opacidade configurável
 *   - Font size configurável
 *   - Logo PNG opcional (download e cache em /tmp)
 *   - Placeholder {frametime} = timestamp REAL do frame (não do export),
 *     permite reconstruir momento exato em forense
 *
 * Decisão: fonte é DejaVuSans-Bold (apk add ttf-dejavu no Dockerfile).
 * Sem isso o drawtext falha silencioso ("Cannot find a valid font").
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { logger } from './logger'

const FONT_PATH = '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'
const LOGO_CACHE_DIR = '/tmp/vsaas-watermark-cache'
const LOGO_CACHE_TTL_MS = 60 * 60_000  // 1h

export interface WatermarkConfig {
  /** Texto bruto (com placeholders já resolvidos exceto {frametime}). */
  text: string
  /** epoch (segundos) do início do range — usado em {frametime}. */
  startEpochSec?: number
  position:   'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'center' | 'tile'
  opacity:    number   // 0.0..1.0
  fontSize:   number   // px
  logoUrl?:   string | null
}

/**
 * Escapa caracteres especiais do drawtext.
 * Ref: https://ffmpeg.org/ffmpeg-filters.html#drawtext
 */
function escapeDrawText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
}

/**
 * Substitui {frametime} pela expressão pts:gmtime do FFmpeg.
 * O resto do texto fica como literal.
 *
 * Sem startEpochSec, {frametime} vira string vazia (degrada gracefully).
 */
function buildTextWithFrameTime(text: string, startEpochSec?: number): string {
  if (!text.includes('{frametime}')) return escapeDrawText(text)

  if (!startEpochSec) {
    return escapeDrawText(text.replace(/\{frametime\}/g, ''))
  }

  // Quebra ao redor do placeholder e remonta com expansão FFmpeg literal.
  const parts = text.split('{frametime}')
  const escapedParts = parts.map(escapeDrawText)
  // pts:gmtime calcula o epoch real do frame: startEpoch + frame.pts
  // A expansão %{pts...} vive dentro do parâmetro `text` do drawtext;
  // como já escapamos `:` e `%`, precisamos NÃO escapar essa parte.
  const expansion = `%{pts\\:gmtime\\:${startEpochSec}\\:%Y-%m-%d %H\\:%M\\:%S}`
  return escapedParts.join(expansion)
}

/**
 * Coordenadas drawtext x/y baseadas na posição.
 */
function positionExpr(pos: WatermarkConfig['position']): { x: string; y: string } {
  switch (pos) {
    case 'top-left':     return { x: '10',          y: '10' }
    case 'top-right':    return { x: 'w-tw-10',     y: '10' }
    case 'bottom-right': return { x: 'w-tw-10',     y: 'h-th-10' }
    case 'center':       return { x: '(w-tw)/2',    y: '(h-th)/2' }
    case 'tile':
    case 'bottom-left':
    default:             return { x: '10',          y: 'h-th-10' }
  }
}

/**
 * Baixa logo da URL e cacheia local. Retorna path local ou null se falhar.
 * Cache key = SHA256 do URL. TTL 1h.
 */
async function ensureLogo(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) {
    logger.warn({ url }, 'watermark_logo_url_invalid')
    return null
  }
  try {
    await fs.mkdir(LOGO_CACHE_DIR, { recursive: true })
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
    const ext = url.toLowerCase().endsWith('.jpg') || url.toLowerCase().endsWith('.jpeg') ? '.jpg' : '.png'
    const cachePath = path.join(LOGO_CACHE_DIR, `${hash}${ext}`)

    // Cache HIT se arquivo existe e é recente
    try {
      const st = await fs.stat(cachePath)
      if (Date.now() - st.mtimeMs < LOGO_CACHE_TTL_MS) return cachePath
    } catch { /* MISS */ }

    // Download (timeout 5s)
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 5000)
    const resp = await fetch(url, { signal: ac.signal })
    clearTimeout(t)
    if (!resp.ok) {
      logger.warn({ url, status: resp.status }, 'watermark_logo_fetch_failed')
      return null
    }
    const buf = Buffer.from(await resp.arrayBuffer())
    if (buf.length > 5 * 1024 * 1024) {
      logger.warn({ url, size: buf.length }, 'watermark_logo_too_large')
      return null
    }
    await fs.writeFile(cachePath, buf)
    return cachePath
  } catch (err) {
    logger.warn({ err, url }, 'watermark_logo_cache_error')
    return null
  }
}

/**
 * Monta os argumentos FFmpeg pra aplicar watermark.
 * Retorna array de args (pra spread em `spawn(ffmpeg, [...base, ...wmArgs, ...rest])`).
 *
 * Inputs:
 *   - O input principal já deve ter sido especificado pelo caller (`-i ...`).
 *   - Esta função adiciona o logo como segundo input (se tiver) E o filter chain.
 *
 * Retorno:
 *   { args, hasFilter } — args pra inserir entre `-i input.mp4` e o output.
 */
export async function buildWatermarkArgs(cfg: WatermarkConfig): Promise<{
  inputArgs:  string[]   // pra colocar ANTES do -i principal (segundo -i pra logo)
  filterArgs: string[]   // -vf / -filter_complex
  reencode:   boolean    // se precisa -c:v libx264 ou se pode -c copy
}> {
  const fullText = buildTextWithFrameTime(cfg.text, cfg.startEpochSec)
  const opacity  = Math.max(0.05, Math.min(1, cfg.opacity || 0.85)).toFixed(2)
  const fontSize = Math.max(10, Math.min(72, cfg.fontSize || 20))

  const drawtextBase = [
    `fontfile=${FONT_PATH}`,
    `text='${fullText}'`,
    `fontcolor=white@${opacity}`,
    `fontsize=${fontSize}`,
    `borderw=2`,
    `bordercolor=black@${(Number(opacity) * 0.8).toFixed(2)}`,
  ]

  let drawtextFilter: string
  if (cfg.position === 'tile') {
    // Tile: 3 instâncias do texto distribuídas pelo vídeo (anti-recrop).
    // Cantos diagonais + centro reduzido em opacidade.
    drawtextFilter = [
      `drawtext=${drawtextBase.join(':')}:x=10:y=10`,
      `drawtext=${drawtextBase.join(':')}:x=w-tw-10:y=h-th-10`,
      `drawtext=${drawtextBase.join(':')}:x=(w-tw)/2:y=(h-th)/2`,
    ].join(',')
  } else {
    const { x, y } = positionExpr(cfg.position)
    drawtextFilter = `drawtext=${drawtextBase.join(':')}:x=${x}:y=${y}`
  }

  // Logo overlay (opcional)
  const logoPath = cfg.logoUrl ? await ensureLogo(cfg.logoUrl) : null
  if (logoPath) {
    // Logo no canto superior direito, escala pra 10% da largura do vídeo
    // (ajusta automaticamente pro tamanho do conteúdo).
    return {
      inputArgs:  ['-i', logoPath],
      filterArgs: [
        '-filter_complex',
        `[1:v]scale=iw*0.5:-1[lg];[0:v][lg]overlay=W-w-10:10[ov];[ov]${drawtextFilter}[v]`,
        '-map', '[v]',
        '-map', '0:a?',
      ],
      reencode: true,
    }
  }

  return {
    inputArgs:  [],
    filterArgs: ['-vf', drawtextFilter],
    reencode:   true,
  }
}

/**
 * Aplica watermark num buffer JPEG (snapshot) via FFmpeg pipe in/out.
 * Retorna novo buffer JPEG marcado. Em caso de falha, retorna o original
 * (degrada gracefully — não bloqueia snapshot por causa de bug de filtro).
 */
export async function applyWatermarkToJpeg(
  inputBuf: Buffer,
  cfg: WatermarkConfig,
): Promise<Buffer> {
  const { spawn } = await import('node:child_process')

  try {
    const wm = await buildWatermarkArgs({ ...cfg, startEpochSec: undefined })  // snapshot = frame único, sem frametime

    const args = ['-y']
    if (wm.inputArgs.length > 0) {
      // Logo: precisa ordem -i input principal + -i logo
      args.push('-f', 'image2pipe', '-i', 'pipe:0', ...wm.inputArgs)
    } else {
      args.push('-f', 'image2pipe', '-i', 'pipe:0')
    }
    args.push(...wm.filterArgs, '-frames:v', '1', '-f', 'image2', 'pipe:1')

    return await new Promise<Buffer>((resolve, reject) => {
      const proc = spawn(process.env.FFMPEG_BIN ?? 'ffmpeg', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const chunks: Buffer[] = []
      let stderrTail = ''
      proc.stdout.on('data', (d: Buffer) => chunks.push(d))
      proc.stderr.on('data', (d: Buffer) => { stderrTail += d.toString().slice(-500) })
      proc.on('error', reject)
      proc.on('close', code => {
        if (code === 0 && chunks.length) {
          resolve(Buffer.concat(chunks))
        } else {
          reject(new Error(`ffmpeg snapshot watermark falhou (exit ${code}): ${stderrTail.slice(-200)}`))
        }
      })
      proc.stdin.write(inputBuf)
      proc.stdin.end()

      // Timeout 8s — snapshot deve ser rápido
      setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, 8000)
    })
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'watermark_jpeg_failed_falling_back')
    return inputBuf  // degrade gracefully
  }
}

/**
 * Resolve placeholders básicos do template ({name}, {email}, {timestamp},
 * {cameraId}). NÃO resolve {frametime} — esse fica pro FFmpeg expandir
 * em runtime (via pts:gmtime).
 */
export function resolveTemplate(
  template: string,
  ctx: { name?: string; email?: string; cameraId?: string },
): string {
  const tsBr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return template
    .replace(/\{name\}/g,      ctx.name     ?? '—')
    .replace(/\{email\}/g,     ctx.email    ?? '—')
    .replace(/\{timestamp\}/g, tsBr)
    .replace(/\{cameraId\}/g,  (ctx.cameraId ?? '').slice(0, 8))
    // {frametime} preservado intencionalmente
}
