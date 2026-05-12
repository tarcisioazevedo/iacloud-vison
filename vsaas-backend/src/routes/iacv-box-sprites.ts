/**
 * iacv-box-sprites — ingest de sprite-sheets de preview vindos da Box.
 *
 * Sprite-sheet = 1 imagem JPG por hora de gravação, com grid de N frames
 * (default 12×10 = 120 frames, 1 frame a cada 30s = cobre 1h exato).
 * Frontend usa CSS `background-position` pra mostrar preview instantâneo
 * no hover da timeline (padrão YouTube/Twitch).
 *
 * Storage path: `{cameraId}/sprites/{day}/{hour}.jpg` no bucket do integrador.
 * Tamanho típico: ~400KB/JPG → ~10MB/cam/dia (24h).
 *
 * Três fluxos (espelham iacv-box-segments):
 *
 *   1. POST /iacv-box/sprites/upload
 *        Multipart simples (.jpg) + meta JSON. Backend recebe, sobe pra R2,
 *        registra SpriteSheet. Vantagem: 1 round-trip. Recomendado MVP.
 *
 *   2. POST /iacv-box/sprites/presign
 *        Retorna { uploadUrl, storagePath, expiresInSec } pra Box fazer
 *        PUT direto no R2 (zero bandwidth no servidor).
 *
 *   3. POST /iacv-box/sprites/register
 *        Após PUT no R2, Box registra o SpriteSheet. Backend valida via HEAD
 *        que objeto existe.
 *
 * Idempotência: UNIQUE (cameraId, day, hour) no banco. Reenvio = upsert
 * (substitui o JPG anterior + atualiza row).
 *
 * Auth: assertBoxOwnership (licenseKey via body/query/header) + tenant
 * resolve via Camera.site.clienteFinal.integradorId.
 */
import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { asyncHandler } from '../middleware/async-handler'
import { assertBoxOwnership } from '../middleware/assert-box-ownership'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'
import { r2Storage } from '../services/r2-storage.service'

export const iacvBoxSpritesRouter = Router()

// JPG sprite-sheet 12×10 (160×90) com qualidade 70 fica ~400KB. Limite
// folgado pra absorver picos de qualidade ou grids maiores no futuro.
const MAX_SPRITE_BYTES = 4 * 1024 * 1024  // 4 MB
const PRESIGN_TTL_SEC  = 600              // 10 min pra Box fazer PUT R2

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_SPRITE_BYTES },
})

// ── Schema base ────────────────────────────────────────────────────────────

const SpriteMetaSchema = z.object({
  cameraId:         z.string().uuid(),
  /** Dia UTC YYYY-MM-DD. */
  day:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day deve ser YYYY-MM-DD'),
  /** Hora UTC 0..23 que esse sprite cobre. */
  hour:             z.number().int().min(0).max(23),
  /** Timestamp do primeiro frame (segmento mais antigo da hora). */
  firstFrameAt:     z.string().datetime(),
  /** Frames realmente capturados (≤ gridCols*gridRows). */
  frameCount:       z.number().int().min(1).max(2000),
  /** Defaults batem com migration; Box pode override pra grids variantes. */
  gridCols:         z.number().int().min(1).max(50).default(12),
  gridRows:         z.number().int().min(1).max(50).default(10),
  frameWidth:       z.number().int().min(16).max(640).default(160),
  frameHeight:      z.number().int().min(9).max(480).default(90),
  frameIntervalSec: z.number().int().min(1).max(3600).default(30),
}).refine(b => b.frameCount <= b.gridCols * b.gridRows, {
  message: 'frameCount excede capacidade do grid (gridCols*gridRows)',
})

type SpriteMeta = z.infer<typeof SpriteMetaSchema>

/**
 * 2026-05-12 — P1-4 fix de clock skew em sprites.
 *
 * Mesmo problema dos segments (vide iacv-box-segments.ts): box com NTP off
 * envia `firstFrameAt` / `day` / `hour` no fuso errado. Sprite acaba
 * indexado em hora errada e o hover da timeline cai no slot vazio.
 *
 * Estratégia:
 *   - skew >5min: warn
 *   - skew >15min: reescreve firstFrameAt para now-frameInterval e RECALCULA
 *     `day`/`hour` baseado no novo timestamp. Operador vê preview correto
 *     no hover mesmo enquanto NTP do box não é corrigido.
 *   - futuro >5min: rejeita
 */
function normalizeSpriteTimestamps(
  cameraId: string, edgeNodeId: string, meta: SpriteMeta,
): SpriteMeta {
  const claimed = new Date(meta.firstFrameAt)
  const now = Date.now()
  const skewMs = now - claimed.getTime()

  if (skewMs < -5 * 60_000) {
    throw new ValidationError(
      `Sprite firstFrameAt no futuro (${Math.round(-skewMs / 1000)}s à frente) — ` +
      `verifique NTP do box ${edgeNodeId.slice(0, 8)}`,
    )
  }

  if (skewMs > 15 * 60_000) {
    // Reescreve pra now - frameInterval (aproximação do início real)
    const offsetMs   = (meta.frameIntervalSec ?? 30) * 1000
    const normalized = new Date(now - offsetMs)
    const newDay     = normalized.toISOString().slice(0, 10)
    const newHour    = normalized.getUTCHours()
    logger.warn({
      cameraId, edgeNodeId,
      claimed: claimed.toISOString(),
      skewSec: Math.round(skewMs / 1000),
      rewrittenTo: normalized.toISOString(),
      rewrittenDay: newDay, rewrittenHour: newHour,
    }, 'box_sprite_clock_skew_rewritten — corrija NTP no box')
    return {
      ...meta,
      firstFrameAt: normalized.toISOString(),
      day:          newDay,
      hour:         newHour,
    }
  }
  if (skewMs > 5 * 60_000) {
    logger.warn({
      cameraId, edgeNodeId, skewSec: Math.round(skewMs / 1000),
    }, 'box_sprite_clock_skew_warning')
  }
  return meta
}

/**
 * Resolve câmera + valida que pertence à box + retorna integradorId.
 * Mesma lógica de iacv-box-segments mas sem exigir EDGE_BOX (sprites
 * podem vir de qualquer deployment que tenha gravação).
 */
async function resolveCameraForBox(
  cameraId: string,
  edgeNodeId: string,
): Promise<{ integradorId: string }> {
  const cam = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: {
      edgeNodeId: true,
      site: { select: { clienteFinal: { select: { integradorId: true } } } },
    },
  })
  if (!cam) throw new NotFoundError('Câmera não encontrada')
  if (cam.edgeNodeId !== edgeNodeId) {
    throw new ForbiddenError('Câmera não pertence a esta box')
  }
  const integradorId = cam.site?.clienteFinal?.integradorId
  if (!integradorId) {
    throw new ValidationError('Câmera sem integradorId resolvível')
  }
  return { integradorId }
}

/** Path canônico do sprite no R2. Mesmo entre presign e register. */
function spriteStoragePath(meta: Pick<SpriteMeta, 'cameraId' | 'day' | 'hour'>): string {
  const hh = String(meta.hour).padStart(2, '0')
  return `${meta.cameraId}/sprites/${meta.day}/${hh}.jpg`
}

/**
 * Persiste o SpriteSheet (upsert). Centraliza pra upload + register
 * compartilharem a mesma escrita.
 */
async function upsertSpriteSheet(args: {
  meta: SpriteMeta
  storagePath: string
  sizeBytes: number
}): Promise<{ id: string; created: boolean }> {
  const { meta, storagePath, sizeBytes } = args
  const data = {
    cameraId:         meta.cameraId,
    day:              meta.day,
    hour:             meta.hour,
    storagePath,
    sizeBytes:        BigInt(sizeBytes),
    frameCount:       meta.frameCount,
    gridCols:         meta.gridCols,
    gridRows:         meta.gridRows,
    frameWidth:       meta.frameWidth,
    frameHeight:      meta.frameHeight,
    frameIntervalSec: meta.frameIntervalSec,
    firstFrameAt:     new Date(meta.firstFrameAt),
    uploadedAt:       new Date(),
  }
  const existing = await prisma.spriteSheet.findUnique({
    where: { uq_sprite_camera_day_hour: {
      cameraId: meta.cameraId, day: meta.day, hour: meta.hour,
    } },
    select: { id: true },
  })
  if (existing) {
    await prisma.spriteSheet.update({ where: { id: existing.id }, data })
    return { id: existing.id, created: false }
  }
  const created = await prisma.spriteSheet.create({ data, select: { id: true } })
  return { id: created.id, created: true }
}

// ── 1. POST /iacv-box/sprites/upload ──────────────────────────────────────
// Multipart: campo `file` (.jpg binário) + campo `meta` (JSON string).

iacvBoxSpritesRouter.post(
  '/upload',
  assertBoxOwnership,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const file = req.file
    if (!file) throw new ValidationError('Campo "file" obrigatório (multipart .jpg)')
    if (file.size === 0) throw new ValidationError('Arquivo vazio')

    // Sanity check magic bytes JPEG (FF D8 FF).
    if (file.buffer.length < 3
        || file.buffer[0] !== 0xff
        || file.buffer[1] !== 0xd8
        || file.buffer[2] !== 0xff) {
      throw new ValidationError('Arquivo não parece um JPEG válido (magic bytes esperados: FF D8 FF)')
    }

    const metaRaw = typeof req.body?.meta === 'string' ? req.body.meta : null
    if (!metaRaw) throw new ValidationError('Campo "meta" obrigatório (JSON)')
    let meta: SpriteMeta
    try {
      meta = SpriteMetaSchema.parse(JSON.parse(metaRaw))
    } catch (err) {
      if (err instanceof z.ZodError) throw err
      throw new ValidationError('"meta" inválido (JSON malformado)')
    }

    const box = req.boxLicense!
    const { integradorId } = await resolveCameraForBox(meta.cameraId, box.edgeNodeId)

    // 2026-05-12: normaliza day/hour/firstFrameAt se box está com clock skew
    meta = normalizeSpriteTimestamps(meta.cameraId, box.edgeNodeId, meta)

    const storagePath = spriteStoragePath(meta)

    // Upload pra R2 (preferencial). Se R2 desligado, falha — sprites NÃO
    // têm fallback local porque são opcionais (sem sprite o hover degrada
    // pra modo legacy). Erro 503 em vez de salvar local pra evitar lixo.
    if (!r2Storage.isEnabled()) {
      throw new ValidationError('R2 não configurado — sprites desabilitados nesta instalação')
    }
    const uploaded = await r2Storage.uploadBuffer(
      integradorId, file.buffer, storagePath, 'image/jpeg',
    )
    if (!uploaded) throw new ValidationError('Falha no upload para R2')

    const result = await upsertSpriteSheet({
      meta, storagePath, sizeBytes: file.size,
    })

    logger.debug({
      cameraId: meta.cameraId, day: meta.day, hour: meta.hour,
      sizeBytes: file.size, created: result.created,
    }, 'sprite_upload_ok')

    res.status(result.created ? 201 : 200).json({
      id:          result.id,
      storagePath,
      sizeBytes:   file.size,
      persisted:   result.created ? 'created' : 'updated',
    })
  }),
)

// ── 2. POST /iacv-box/sprites/presign ─────────────────────────────────────
// Box pede URL pré-assinada, faz PUT direto no R2 (zero bandwidth no servidor),
// depois chama /register pra confirmar.

const PresignBody = z.object({
  cameraId: z.string().uuid(),
  day:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day deve ser YYYY-MM-DD'),
  hour:     z.number().int().min(0).max(23),
})

iacvBoxSpritesRouter.post(
  '/presign',
  assertBoxOwnership,
  asyncHandler(async (req: Request, res: Response) => {
    const body = PresignBody.parse(req.body)
    const box = req.boxLicense!
    const { integradorId } = await resolveCameraForBox(body.cameraId, box.edgeNodeId)

    if (!r2Storage.isEnabled()) {
      throw new ValidationError('R2 não configurado — use /upload (multipart)')
    }

    const storagePath = spriteStoragePath(body)
    const uploadUrl = await r2Storage.getPresignedUploadUrl(
      integradorId, storagePath, 'image/jpeg', PRESIGN_TTL_SEC,
    )
    if (!uploadUrl) throw new ValidationError('Falha ao gerar URL pré-assinada')

    res.json({ uploadUrl, storagePath, expiresInSec: PRESIGN_TTL_SEC })
  }),
)

// ── 3. POST /iacv-box/sprites/register ────────────────────────────────────
// Após PUT no R2, Box chama isso pra registrar SpriteSheet. Backend valida
// via HEAD que objeto existe.

iacvBoxSpritesRouter.post(
  '/register',
  assertBoxOwnership,
  asyncHandler(async (req: Request, res: Response) => {
    let meta = SpriteMetaSchema.parse(req.body)
    const box = req.boxLicense!
    const { integradorId } = await resolveCameraForBox(meta.cameraId, box.edgeNodeId)

    // 2026-05-12: normaliza day/hour/firstFrameAt se box está com clock skew.
    // Atenção: /register pressupõe que o box já fez PUT no path antigo via
    // /presign. Se reescrevemos o day/hour AQUI, o storagePath diverge e o
    // HEAD falha. Por isso: o reescreve só faz sentido em /upload (single
    // round-trip). Em /register, só LOGA o warning (sem rewrite).
    if (Date.now() - new Date(meta.firstFrameAt).getTime() > 15 * 60_000) {
      logger.warn({
        cameraId: meta.cameraId, edgeNodeId: box.edgeNodeId,
        skewSec: Math.round((Date.now() - new Date(meta.firstFrameAt).getTime()) / 1000),
      }, 'box_sprite_register_skewed — corrija NTP no box, /presign path desalinha do dia real')
    }

    const storagePath = spriteStoragePath(meta)
    const head = await r2Storage.head(integradorId, storagePath)
    if (!head) {
      throw new NotFoundError('Sprite não encontrado no R2 — fez o PUT antes de /register?')
    }

    const result = await upsertSpriteSheet({
      meta, storagePath, sizeBytes: head.size,
    })

    logger.debug({
      cameraId: meta.cameraId, day: meta.day, hour: meta.hour,
      sizeBytes: head.size, created: result.created,
    }, 'sprite_register_ok')

    res.status(result.created ? 201 : 200).json({
      id:          result.id,
      storagePath,
      sizeBytes:   head.size,
      persisted:   result.created ? 'created' : 'updated',
    })
  }),
)

// Multer error handler — file too large.
iacvBoxSpritesRouter.use((
  err: any,
  _req: Request,
  res: Response,
  next: (err?: any) => void,
) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      error: 'FILE_TOO_LARGE',
      message: `Sprite excede o limite de ${MAX_SPRITE_BYTES} bytes (4MB)`,
    })
    return
  }
  next(err)
})
