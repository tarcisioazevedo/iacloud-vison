/**
 * sprite-generator — gera sprite-sheet de preview a partir dos segments
 * de gravação já em R2. Usado pra:
 *
 *   1. Backfill retroativo: gravações anteriores ao deploy do pipeline de
 *      sprite na Box ficam sem preview no hover. Esse service preenche.
 *
 *   2. Garantia de cobertura: se a Box falhar em gerar/uploadar sprite
 *      pra uma hora (rede instável, ffmpeg crash, etc), o worker
 *      periódico detecta e regenera Cloud-side. Operador NUNCA fica sem
 *      preview enquanto houver segments uploaded.
 *
 * Algoritmo:
 *   - Lista segments da hora alvo (UTC).
 *   - Pra cada um dos 120 timestamps-alvo (1 a cada 30s, cobre 1h),
 *     localiza o segment que cobre o timestamp e calcula offset interno.
 *   - Baixa segments únicos do R2 pra temp dir.
 *   - Pra cada timestamp, extrai 1 frame via `ffmpeg -ss {offset} -i seg.ts`.
 *   - Compõe sprite-sheet via `ffmpeg -filter_complex tile=12x10`.
 *   - Upload pro R2 + UPSERT SpriteSheet.
 *   - Limpa temp dir.
 *
 * Tradeoffs:
 *   - **Não usa concat de segments**: evita re-encoding pesado.
 *     Preço: faz 120 chamadas separadas de ffmpeg (uma por frame).
 *     Cada extract é ~50-200ms — total ~10-25s por hora. Aceitável.
 *   - **Frames duplicados quando segments faltam**: se hora 12-13 só tem
 *     20 segments (cobre só os primeiros 2min), os 116 timestamps restantes
 *     ficam sem segment cobertor → frame placeholder preto. Isso é ok —
 *     `sizeBytes` baixo (frames pretos comprimem) e o backend ignora
 *     sprites <100KB pra cálculo de gaps.
 */
import { spawn } from 'child_process'
import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { prisma } from '../lib/prisma'
import { r2Storage } from './r2-storage.service'
import { logger } from '../lib/logger'

const FRAMES_PER_SPRITE   = 120
const FRAME_INTERVAL_SEC  = 30
const FRAME_W             = 160
const FRAME_H             = 90
const GRID_COLS           = 12
const GRID_ROWS           = 10
const JPEG_QUALITY        = 5  // ffmpeg -qscale:v 2-31, menor = melhor; 5 ≈ q=82

interface GenerateResult {
  ok:         boolean
  reason?:    string
  sizeBytes?: number
  frameCount?: number
}

/**
 * Roda comando shell e captura stdout/stderr. Rejeita em exit != 0.
 * Buffers de saída limitados pra evitar OOM em logs muito longos.
 */
function execCmd(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', d => {
      if (stderr.length < 4000) stderr += d.toString()
    })
    const timer = opts.timeoutMs
      ? setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`timeout ${opts.timeoutMs}ms: ${cmd} ${args.slice(0,3).join(' ')}…`)) }, opts.timeoutMs)
      : null
    proc.on('exit', code => {
      if (timer) clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-500)}`))
    })
    proc.on('error', err => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Resolve integradorId da câmera. Sem tenant resolvido, não dá pra
 * acessar bucket no R2.
 */
async function resolveIntegradorId(cameraId: string): Promise<string | null> {
  const cam = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
  })
  return cam?.site?.clienteFinal?.integradorId ?? null
}

export const spriteGenerator = {
  /**
   * Gera sprite-sheet pra (cameraId, day, hour) e persiste em R2 + DB.
   * Idempotente: se sprite já existe e `force=false`, retorna ok sem refazer.
   *
   * @param day    YYYY-MM-DD (UTC)
   * @param hour   0..23
   * @param force  Reprocessa mesmo se sprite já existe
   */
  async generateForHour(
    cameraId: string,
    day: string,
    hour: number,
    opts: { force?: boolean } = {},
  ): Promise<GenerateResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, reason: 'invalid day' }
    if (hour < 0 || hour > 23) return { ok: false, reason: 'invalid hour' }

    // 0. Skip se já existe (a menos que force)
    const existing = await prisma.spriteSheet.findUnique({
      where: { uq_sprite_camera_day_hour: { cameraId, day, hour } },
      select: { id: true, sizeBytes: true },
    })
    if (existing && !opts.force) {
      return { ok: true, reason: 'already exists', sizeBytes: Number(existing.sizeBytes) }
    }

    // 1. Tenant + R2
    const integradorId = await resolveIntegradorId(cameraId)
    if (!integradorId) return { ok: false, reason: 'integradorId not resolvable' }
    if (!r2Storage.isEnabled()) return { ok: false, reason: 'R2 disabled' }

    // 2. Lista segments dessa hora
    const dayStart   = new Date(`${day}T00:00:00.000Z`)
    const hourStart  = new Date(dayStart.getTime() + hour * 3600_000)
    const hourEnd    = new Date(hourStart.getTime() + 3600_000)
    const segments = await prisma.recordingSegment.findMany({
      where: {
        cameraId,
        startedAt: { lt: hourEnd },
        endedAt:   { gt: hourStart },
        uploadStatus: 'UPLOADED',
      },
      select: { startedAt: true, endedAt: true, durationSec: true, storagePath: true },
      orderBy: { startedAt: 'asc' },
    })
    if (segments.length === 0) return { ok: false, reason: 'no segments' }

    // 3. Temp dir
    const tmp = await mkdtemp(join(tmpdir(), `sprite-${cameraId.slice(0, 8)}-${day}-${String(hour).padStart(2, '0')}-`))
    const framesDir = join(tmp, 'frames')
    await mkdir(framesDir, { recursive: true })

    try {
      // 4. Pra cada timestamp alvo (1 a cada 30s), acha segment + offset
      const frameJobs: Array<{ idx: number; segPath: string; offsetSec: number }> = []
      for (let i = 0; i < FRAMES_PER_SPRITE; i++) {
        const targetSec = hour * 3600 + i * FRAME_INTERVAL_SEC
        const targetMs  = dayStart.getTime() + targetSec * 1000
        const seg = segments.find(s =>
          s.startedAt.getTime() <= targetMs &&
          s.endedAt.getTime()   >  targetMs,
        )
        if (!seg) continue  // sem segment cobrindo → placeholder preto
        const offsetSec = (targetMs - seg.startedAt.getTime()) / 1000
        frameJobs.push({ idx: i, segPath: seg.storagePath, offsetSec })
      }

      if (frameJobs.length === 0) return { ok: false, reason: 'no covered frames' }

      // 5. Baixa segments únicos do R2 (dedup — múltiplos frames podem
      //    apontar pro mesmo segment se durar >30s).
      const uniqueSegPaths = [...new Set(frameJobs.map(j => j.segPath))]
      const localSegPath: Record<string, string> = {}
      for (let i = 0; i < uniqueSegPaths.length; i++) {
        const remoteKey = uniqueSegPaths[i]
        const localFile = join(tmp, `seg-${i}.ts`)
        const buf = await r2Storage.getBuffer(integradorId, remoteKey)
        if (!buf) {
          logger.warn({ remoteKey, integradorId }, 'sprite_seg_download_failed')
          continue
        }
        await writeFile(localFile, buf)
        localSegPath[remoteKey] = localFile
      }

      // 6. Extrai 1 frame por job via ffmpeg. Frame que falha vira preto.
      //    Limita paralelismo a 4 pra não estourar CPU/memória.
      const PARALLEL = 4
      const blackFrame = join(tmp, 'black.jpg')
      // Cria 1 frame preto base pra usar quando ffmpeg falhar (mais rápido
      // que gerar de novo).
      try {
        await execCmd('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', `color=black:s=${FRAME_W}x${FRAME_H}:d=0.04`,
          '-frames:v', '1', '-qscale:v', String(JPEG_QUALITY), blackFrame,
        ], { timeoutMs: 5000 })
      } catch {}

      let extracted = 0
      for (let batch = 0; batch < frameJobs.length; batch += PARALLEL) {
        const slice = frameJobs.slice(batch, batch + PARALLEL)
        await Promise.all(slice.map(async job => {
          const local = localSegPath[job.segPath]
          if (!local) return
          const out = join(framesDir, `${String(job.idx).padStart(4, '0')}.jpg`)
          try {
            await execCmd('ffmpeg', [
              '-y',
              '-ss', job.offsetSec.toFixed(2),
              '-i', local,
              '-frames:v', '1',
              '-vf', `scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=decrease,pad=${FRAME_W}:${FRAME_H}:(ow-iw)/2:(oh-ih)/2:black`,
              '-qscale:v', String(JPEG_QUALITY),
              out,
            ], { timeoutMs: 8000 })
            extracted++
          } catch (err) {
            // Frame extract falhou — cai pra placeholder preto
            try {
              const blackBuf = await readFile(blackFrame)
              await writeFile(out, blackBuf)
            } catch {}
          }
        }))
      }

      if (extracted === 0) return { ok: false, reason: 'no frames extracted' }

      // 7. Cria 120 placeholders pretos pros índices que não foram cobertos
      //    (necessário pro tile ffmpeg ter input contínuo 0..119).
      for (let i = 0; i < FRAMES_PER_SPRITE; i++) {
        const out = join(framesDir, `${String(i).padStart(4, '0')}.jpg`)
        try { await stat(out) } catch {
          try {
            const blackBuf = await readFile(blackFrame)
            await writeFile(out, blackBuf)
          } catch {}
        }
      }

      // 8. Compõe sprite-sheet 12x10 via tile filter.
      const spriteFile = join(tmp, 'sprite.jpg')
      await execCmd('ffmpeg', [
        '-y',
        '-framerate', '1',
        '-i', join(framesDir, '%04d.jpg'),
        '-frames:v', '1',
        '-vf', `tile=${GRID_COLS}x${GRID_ROWS}`,
        '-qscale:v', String(JPEG_QUALITY),
        spriteFile,
      ], { timeoutMs: 30_000 })

      const spriteBuf = await readFile(spriteFile)
      if (spriteBuf.length === 0) return { ok: false, reason: 'sprite empty' }

      // 9. Upload pro R2 (mesmo path usado pelos uploads da Box).
      const storagePath = `${cameraId}/sprites/${day}/${String(hour).padStart(2, '0')}.jpg`
      const uploaded = await r2Storage.uploadBuffer(
        integradorId, spriteBuf, storagePath, 'image/jpeg',
      )
      if (!uploaded) return { ok: false, reason: 'R2 upload failed' }

      // 10. UPSERT SpriteSheet
      const data = {
        cameraId,
        day,
        hour,
        storagePath,
        sizeBytes:        BigInt(spriteBuf.length),
        frameCount:       extracted,
        gridCols:         GRID_COLS,
        gridRows:         GRID_ROWS,
        frameWidth:       FRAME_W,
        frameHeight:      FRAME_H,
        frameIntervalSec: FRAME_INTERVAL_SEC,
        firstFrameAt:     hourStart,
        uploadedAt:       new Date(),
      }
      if (existing) {
        await prisma.spriteSheet.update({ where: { id: existing.id }, data })
      } else {
        await prisma.spriteSheet.create({ data })
      }

      logger.debug({
        cameraId, day, hour,
        sizeBytes: spriteBuf.length, extracted,
      }, 'sprite_backfill_ok')

      return { ok: true, sizeBytes: spriteBuf.length, frameCount: extracted }
    } finally {
      // Limpeza obrigatória — temp dirs acumulam GB se não rodar.
      try { await rm(tmp, { recursive: true, force: true }) } catch {}
    }
  },

  /**
   * Lista pares (cameraId, day, hour) que têm segments uploaded mas
   * não têm sprite. Usado pelo worker periódico + endpoint admin.
   *
   * @param limit Quantos retornar (worker processa N por ciclo)
   * @param sinceDays Limita pra últimos N dias (default 7)
   */
  async findHoursMissingSprite(opts: {
    limit?: number
    sinceDays?: number
    cameraId?: string
  } = {}): Promise<Array<{ cameraId: string; day: string; hour: number; segCount: number }>> {
    const limit     = opts.limit ?? 20
    const sinceDays = opts.sinceDays ?? 7
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    // Skip da hora corrente (Box ainda pode estar gravando) — só considera
    // hours fechadas (>= hora atual + buffer 5min).
    const cutoff = new Date(Date.now() - 5 * 60 * 1000)

    const camFilter = opts.cameraId ? `AND rs."cameraId" = '${opts.cameraId}'` : ''

    // Query agregada: agrupa segments uploaded por (cam, day, hour),
    // LEFT JOIN sprite e filtra os sem.
    const rows = await prisma.$queryRawUnsafe<Array<{
      cameraId: string; day: string; hour: number; seg_count: bigint
    }>>(`
      SELECT
        rs."cameraId" AS "cameraId",
        TO_CHAR(rs."startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
        EXTRACT(HOUR FROM rs."startedAt" AT TIME ZONE 'UTC')::int AS hour,
        COUNT(*) AS seg_count
      FROM "RecordingSegment" rs
      LEFT JOIN "SpriteSheet" ss
        ON ss."cameraId" = rs."cameraId"
       AND ss.day = TO_CHAR(rs."startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
       AND ss.hour = EXTRACT(HOUR FROM rs."startedAt" AT TIME ZONE 'UTC')::int
      WHERE rs."uploadStatus" = 'UPLOADED'
        AND rs."startedAt" >= $1
        AND rs."startedAt" <  $2
        ${camFilter}
        AND ss.id IS NULL
      GROUP BY rs."cameraId",
               TO_CHAR(rs."startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
               EXTRACT(HOUR FROM rs."startedAt" AT TIME ZONE 'UTC')::int
      ORDER BY day DESC, hour DESC
      LIMIT $3
    `, since, cutoff, limit)

    return rows.map(r => ({
      cameraId: r.cameraId,
      day:      r.day,
      hour:     r.hour,
      segCount: Number(r.seg_count),
    }))
  },
}
