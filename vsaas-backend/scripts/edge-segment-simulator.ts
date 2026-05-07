/**
 * edge-segment-simulator — simula o edge box ingerindo gravações.
 *
 * Faz o que a Raspberry Pi 5 faria em produção:
 *   1. Captura RTSP (ou arquivo de vídeo em loop) com ffmpeg
 *   2. Segmenta em arquivos .ts de 6s
 *   3. Para cada segmento fechado, POST /iacv-box/segments/upload
 *      com licenseKey + arquivo + meta JSON.
 *
 * Por que existe:
 *   Sem edge box rodando, é o único jeito de exercitar o pipeline
 *   ponta-a-ponta e ver a UI populando. Também útil pra reproduzir
 *   bugs de ingest sem depender do edge físico.
 *
 * Uso típico:
 *   docker exec -it iacloud_backend npx tsx scripts/edge-segment-simulator.ts \
 *     --cameraId=9f517770-... \
 *     --licenseKey=IACV-LAB-TEST-KEY-123 \
 *     --backend=http://localhost:3000 \
 *     --source="rtsp://demo.com/stream"
 *
 * Source pode ser:
 *   - "demo" → baixa Big Buck Bunny / sample mp4 público (cena real, padrão)
 *   - "testsrc" → ffmpeg gera padrão sintético colorido (validar pipeline)
 *   - URL RTSP (puxa direto)
 *   - URL HTTP de .mp4 (looping infinito com -stream_loop -1)
 *   - Caminho de arquivo .mp4/.mkv/.webm local (looping)
 *
 * Pra parar: Ctrl+C (envia SIGTERM ao ffmpeg, finaliza upload em curso).
 */
import { spawn, type ChildProcess } from 'child_process'
import { promises as fs, statSync, existsSync } from 'fs'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

// ── CLI args ────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2))
const cameraId   = required('cameraId',   args.cameraId)
const licenseKey = required('licenseKey', args.licenseKey)
const source     = args.source     ?? 'testsrc'
const backend    = args.backend    ?? 'http://localhost:3000'
const segmentSec = Number(args.segmentSec ?? 6)
const codec      = args.codec ?? 'h264'
const method     = (args.method ?? 'multipart').toLowerCase() as 'multipart' | 'presigned'

if (method !== 'multipart' && method !== 'presigned') {
  console.error('error: --method deve ser "multipart" ou "presigned"')
  process.exit(1)
}

console.log('🎬 Edge Segment Simulator')
console.log('  cameraId   :', cameraId)
console.log('  licenseKey :', licenseKey.slice(0, 12) + '…')
console.log('  source     :', source)
console.log('  backend    :', backend)
console.log('  segmentSec :', segmentSec)
console.log('  codec      :', codec)
console.log('  method     :', method)
console.log('')

// ── Setup ───────────────────────────────────────────────────────────────
const workDir = mkdtempSync(join(tmpdir(), 'icv-edge-sim-'))
console.log(`[boot] work dir: ${workDir}`)

const ffmpegArgs: string[] = [
  '-hide_banner',
  '-loglevel', 'error',
]

// Resolve source "demo" pra um vídeo real cacheado. Big Buck Bunny —
// pequeno (5MB), creative commons, cena natural. Diferente do testsrc
// (barras coloridas), simula uma câmera tipo "monitoramento".
async function resolveDemoSource(): Promise<string> {
  const cachePath = '/tmp/icv-demo-source.mp4'
  if (existsSync(cachePath)) return cachePath
  console.log('[demo] baixando vídeo de demonstração Big Buck Bunny (~1MB)…')
  const url = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ao baixar demo: HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  await fs.writeFile(cachePath, Buffer.from(buf))
  console.log(`[demo] cacheado em ${cachePath} (${buf.byteLength} bytes)`)
  return cachePath
}

// Resolvido pela bootstrap() async (tsx em CJS não suporta top-level await).
let resolvedSource = ''
// Variáveis compartilhadas entre bootstrap() e helpers (drainPending, uploadSegment).
let buffer = ''
const pendingFiles: string[] = []
let processing = false
let segmentsUploaded = 0
let segmentsDeduplicated = 0
let segmentsFailed = 0
let ff: ChildProcess | null = null

bootstrap().catch(err => { console.error('[boot] error:', err); process.exit(1) })

async function bootstrap(): Promise<void> {
resolvedSource = source === 'demo' ? await resolveDemoSource() : source
const isFile = /^https?:|^file:|\.mp4$|\.mkv$|\.webm$|\.mov$/i.test(resolvedSource)

if (resolvedSource === 'testsrc') {
  // Padrão colorido sintético — útil só pra validar o pipeline, sem cena real.
  ffmpegArgs.push(
    '-re',
    '-f', 'lavfi',
    '-i', `testsrc=size=640x360:rate=15`,
    '-pix_fmt', 'yuv420p',
    '-c:v', codec === 'h265' ? 'libx265' : 'libx264',
    '-preset', 'ultrafast',
    '-x264-params', `keyint=${segmentSec * 15}:min-keyint=${segmentSec * 15}:scenecut=0`,
    '-force_key_frames', `expr:gte(t,n_forced*${segmentSec})`,
    '-vsync', 'cfr',
  )
} else if (isFile) {
  // Arquivo MP4/MOV/MKV ou URL HTTP — looping infinito + RE-ENCODE.
  // Re-encode é necessário pra forçar keyframes nos segment boundaries
  // (sem isso, HLS.js falha em decodificar do início de cada segment).
  ffmpegArgs.push(
    '-re',
    '-stream_loop', '-1',
    '-i', resolvedSource,
    '-an',
    '-pix_fmt', 'yuv420p',
    '-c:v', codec === 'h265' ? 'libx265' : 'libx264',
    '-preset', 'ultrafast',
    '-vf', 'scale=640:-2',                   // reduz pra 640px de largura
    '-r', '15',                              // 15 fps consistente
    '-x264-params', `keyint=${segmentSec * 15}:min-keyint=${segmentSec * 15}:scenecut=0`,
    '-force_key_frames', `expr:gte(t,n_forced*${segmentSec})`,
    '-vsync', 'cfr',
  )
} else {
  // RTSP — assume codec compatível (copy, sem CPU)
  ffmpegArgs.push(
    '-rtsp_transport', 'tcp',
    '-i', resolvedSource,
    '-an',
    '-c:v', 'copy',
  )
}

// IMPORTANTE — remoção do `-reset_timestamps 1`:
//   Com reset, cada segment começa em PTS=0 → HLS.js detecta como
//   "tempo voltou" entre segments e quebra a continuidade. Sem reset,
//   PTS cresce monotonicamente (seg0:0s, seg1:4s, seg2:8s...) que é
//   o que HLS espera num playlist VOD.
// `-muxdelay 0 -muxpreload 0` remove os ~1.4s de delay padrão do
//   muxer mpegts — sem isso, primeiro keyframe fica em t=1.4s e
//   o player renderiza preto até lá.
ffmpegArgs.push(
  '-muxdelay', '0',
  '-muxpreload', '0',
  '-f', 'segment',
  '-segment_time', String(segmentSec),
  '-segment_format', 'mpegts',
  '-segment_list', 'pipe:1',
  '-segment_list_type', 'flat',
  `${workDir}/seg_%05d.ts`,
)

console.log('[boot] starting ffmpeg…\n')

ff = spawn('ffmpeg', ffmpegArgs, {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
})

ff.stdout!.on('data', (chunk: Buffer) => {
  buffer += chunk.toString('utf8')
  let nl
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    pendingFiles.push(line)
    void drainPending()
  }
})

ff.stderr!.on('data', (chunk: Buffer) => {
  process.stderr.write(`[ffmpeg] ${chunk.toString('utf8')}`)
})

ff.on('error', (err) => {
  console.error('[ffmpeg] spawn error:', err)
  process.exit(1)
})

ff.on('close', (code, sig) => {
  console.log(`\n[ffmpeg] closed (code=${code}, sig=${sig})`)
  console.log(`[stats] uploaded=${segmentsUploaded} deduplicated=${segmentsDeduplicated} failed=${segmentsFailed}`)
  process.exit(code ?? 0)
})

process.on('SIGINT', () => {
  console.log('\n[shutdown] SIGINT received, killing ffmpeg…')
  ff?.kill('SIGTERM')
})
process.on('SIGTERM', () => {
  ff?.kill('SIGTERM')
})

}  // end bootstrap()

// ── Upload loop ─────────────────────────────────────────────────────────
async function drainPending(): Promise<void> {
  if (processing) return
  processing = true
  try {
    while (pendingFiles.length > 0) {
      const file = pendingFiles.shift()!
      // ffmpeg às vezes emite a linha antes do arquivo estar fechado
      await new Promise(r => setTimeout(r, 200))
      try {
        await uploadSegment(file)
      } catch (err: any) {
        segmentsFailed++
        console.error(`  ✗ ${file}: ${err?.message ?? err}`)
      }
    }
  } finally {
    processing = false
  }
}

// Relógio simulado — começa 1h atrás e avança 1×segmentSec por segmento.
// Garante timestamps SEMPRE no passado (lastSegmentAgeSec sempre ≥ 0) e
// monotonicamente crescentes (sem colisão de dedup). testsrc gera arquivos
// muito rápido com mtime idêntico, então mtime não é usável.
const SIM_BACKDATE_MS = 60 * 60 * 1000   // 1h pro passado
const SIM_REF_MS = Date.now() - SIM_BACKDATE_MS

async function uploadSegment(filePath: string): Promise<void> {
  const fullPath = filePath.startsWith('/') ? filePath : join(workDir, filePath)
  statSync(fullPath)  // valida que arquivo existe; mtime descartado

  // Extrai índice do nome (seg_00042.ts → 42). Cada índice = 1 janela de segmentSec.
  const idxMatch = filePath.match(/seg_(\d+)\.ts/)
  const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0
  const startedAt = new Date(SIM_REF_MS + idx * segmentSec * 1000)

  const meta = {
    cameraId,
    startedAt:   startedAt.toISOString(),
    durationSec: segmentSec,
    codec,
  }

  const fileBytes = await fs.readFile(fullPath)
  const json: any = method === 'presigned'
    ? await uploadViaPresigned(fileBytes, meta)
    : await uploadViaMultipart(fileBytes, meta, filePath)

  if (json.persisted === 'created') {
    segmentsUploaded++
    console.log(`  ✓ ${filePath} → ${json.segmentId.slice(0, 8)} (${json.sizeBytes} bytes) [${method}]`)
  } else {
    segmentsDeduplicated++
    console.log(`  ↻ ${filePath} → ${json.segmentId.slice(0, 8)} (dedup) [${method}]`)
  }

  // Limpa arquivo local depois do upload (simulator não precisa reter)
  await fs.unlink(fullPath).catch(() => {})
}

async function uploadViaMultipart(
  fileBytes: Buffer,
  meta: Record<string, unknown>,
  filePath: string,
): Promise<unknown> {
  const fileBlob = new Blob([fileBytes], { type: 'video/mp2t' })
  const form = new FormData()
  form.append('licenseKey', licenseKey)
  form.append('meta', JSON.stringify(meta))
  form.append('file', fileBlob, filePath.split('/').pop() ?? 'segment.ts')

  const res = await fetch(`${backend}/iacv-box/segments/upload`, {
    method:  'POST',
    body:    form,
    headers: { 'X-IACV-License-Key': licenseKey },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`upload HTTP ${res.status}: ${txt.slice(0, 200)}`)
  }
  return res.json()
}

async function uploadViaPresigned(
  fileBytes: Buffer,
  meta: { cameraId: string; startedAt: string; durationSec: number; codec: string },
): Promise<unknown> {
  // 1. Pede URL pré-assinada
  const presignRes = await fetch(`${backend}/iacv-box/segments/presign`, {
    method:  'POST',
    headers: {
      'Content-Type':       'application/json',
      'X-IACV-License-Key': licenseKey,
    },
    body: JSON.stringify({
      licenseKey,
      cameraId:  meta.cameraId,
      startedAt: meta.startedAt,
    }),
  })
  if (!presignRes.ok) {
    const txt = await presignRes.text()
    throw new Error(`presign HTTP ${presignRes.status}: ${txt.slice(0, 200)}`)
  }
  const { uploadUrl, storagePath } = await presignRes.json() as {
    uploadUrl: string; storagePath: string
  }

  // 2. PUT arquivo direto no R2 com a URL pré-assinada
  const putRes = await fetch(uploadUrl, {
    method:  'PUT',
    body:    fileBytes,
    headers: { 'Content-Type': 'video/mp2t' },
  })
  if (!putRes.ok) {
    const txt = await putRes.text().catch(() => '')
    throw new Error(`R2 PUT HTTP ${putRes.status}: ${txt.slice(0, 200)}`)
  }

  // 3. Registra no backend (HEAD valida que objeto existe no R2)
  const regRes = await fetch(`${backend}/iacv-box/segments/register`, {
    method:  'POST',
    headers: {
      'Content-Type':       'application/json',
      'X-IACV-License-Key': licenseKey,
    },
    body: JSON.stringify({
      licenseKey,
      ...meta,
      storagePath,
    }),
  })
  if (!regRes.ok) {
    const txt = await regRes.text()
    throw new Error(`register HTTP ${regRes.status}: ${txt.slice(0, 200)}`)
  }
  return regRes.json()
}

// ── Helpers ─────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const arg of argv) {
    const m = /^--?([^=]+?)=(.+)$/.exec(arg) ?? /^--?([^=]+)$/.exec(arg)
    if (!m) continue
    out[m[1]] = m[2] ?? 'true'
  }
  return out
}

function required(name: string, val: string | undefined): string {
  if (!val) {
    console.error(`error: --${name} é obrigatório`)
    console.error('uso: npx tsx edge-segment-simulator.ts --cameraId=... --licenseKey=... [--source=...] [--backend=...]')
    process.exit(1)
  }
  return val
}
