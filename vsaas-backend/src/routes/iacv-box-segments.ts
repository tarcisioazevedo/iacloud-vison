/**
 * iacv-box-segments — rotas de ingest de segmentos de gravação vindos
 * do edge box (deploymentMode=EDGE_BOX) ou do simulator de dev.
 *
 * Três fluxos:
 *
 *   1. POST /iacv-box/segments/upload
 *        Multipart simples — file (.ts) + meta JSON. Backend recebe,
 *        salva local, sobe pra R2 async, registra RecordingSegment.
 *        Vantagem: 1 round-trip. Desvantagem: bandwidth no servidor.
 *        Recomendado pra MVP / volumes baixos.
 *
 *   2. POST /iacv-box/segments/presign
 *        Box pede URL pré-assinada R2 + segmentId provisional.
 *        Retorna { uploadUrl, storagePath, expiresInSec }.
 *
 *   3. POST /iacv-box/segments/register
 *        Box chama depois do PUT no R2. Backend valida via HEAD
 *        que objeto existe e cria RecordingSegment.
 *
 * Auth: assertBoxOwnership em todas (licenseKey via body/query/header).
 *
 * Anti-IDOR cross-camera:
 *   Box-A não pode enviar segmento de Camera-B (de outro site/box).
 *   Validamos `camera.edgeNodeId === boxLicense.edgeNodeId`.
 */
import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { asyncHandler } from '../middleware/async-handler'
import { assertBoxOwnership } from '../middleware/assert-box-ownership'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'
import { recordingIngest } from '../services/recording-ingest.service'
import { recordingStorage } from '../services/recording-storage.service'
import { r2Storage } from '../services/r2-storage.service'

export const iacvBoxSegmentsRouter = Router()

const MAX_SEGMENT_BYTES = 50 * 1024 * 1024  // 50 MB — folga 16x sobre 1080p/6s
const PRESIGN_TTL_SEC   = 600                // 10 min pra fazer upload R2

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_SEGMENT_BYTES },
})

// ── Schemas Zod compartilhados ────────────────────────────────────────────

const SegmentMetaSchema = z.object({
  cameraId:    z.string().uuid(),
  startedAt:   z.string().datetime(),
  durationSec: z.number().min(0.1).max(60),
  codec:       z.enum(['h264', 'h265']).optional(),
  fps:         z.number().int().min(1).max(120).optional(),
  width:       z.number().int().min(1).max(7680).optional(),
  height:      z.number().int().min(1).max(4320).optional(),
  hasMotion:   z.boolean().optional(),
  hasEvent:    z.boolean().optional(),
})
type SegmentMeta = z.infer<typeof SegmentMetaSchema>

/**
 * Resolve câmera + valida ownership + retorna integradorId multi-tenant.
 * Lança ForbiddenError se a câmera não pertence ao edgeNodeId da box,
 * NotFoundError se câmera não existe.
 */
async function resolveCameraForBox(
  cameraId: string,
  edgeNodeId: string,
): Promise<{ integradorId: string }> {
  const cam = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: {
      edgeNodeId:     true,
      deploymentMode: true,
      site: { select: { clienteFinal: { select: { integradorId: true } } } },
    },
  })
  if (!cam) throw new NotFoundError('Câmera não encontrada')
  if (cam.edgeNodeId !== edgeNodeId) {
    throw new ForbiddenError('Câmera não pertence a esta box')
  }
  if (cam.deploymentMode !== 'EDGE_BOX') {
    throw new ValidationError('Câmera não está em deploymentMode=EDGE_BOX')
  }
  const integradorId = cam.site?.clienteFinal?.integradorId
  if (!integradorId) {
    throw new ValidationError('Câmera sem integradorId resolvível')
  }
  return { integradorId }
}

// ── 1. POST /iacv-box/segments/upload ─────────────────────────────────────
// Multipart: campo `file` (.ts binário) + campo `meta` (JSON string).

/**
 * Detecta se um buffer é MPEG-TS (sync byte 0x47 a cada 188 bytes) ou
 * algum outro formato — em particular MP4 (`ftyp` ou `moov` no início).
 *
 * Por que importa: HLS.js no browser SÓ toca:
 *   - MPEG-TS (legacy HLS — magic byte 0x47)
 *   - fMP4 fragmentado (HLS v6+ — `styp` no início ou explicit fMP4 init)
 * MP4 normal (com MOOV completo no início, gerado por `-f mp4`) NÃO funciona
 * porque cada segment vira um arquivo "self-contained" sem alinhamento HLS.
 *
 * Detecção via primeiros 16 bytes (suficiente pra distinguir formatos).
 */
function detectSegmentFormat(buf: Buffer): {
  format: 'mpegts' | 'mp4_fragmented' | 'mp4_invalid' | 'unknown'
  reason?: string
} {
  if (buf.length < 16) return { format: 'unknown', reason: 'buffer too small' }

  // MPEG-TS: byte 0 deve ser 0x47, e idealmente byte 188 também
  if (buf[0] === 0x47) {
    if (buf.length >= 189 && buf[188] === 0x47) return { format: 'mpegts' }
    if (buf.length < 189) return { format: 'mpegts' }   // muito curto pra checar 2x
    return { format: 'unknown', reason: '0x47 no offset 0 mas não em 188 (truncado?)' }
  }

  // MP4: primeiros 8 bytes = [size:4][type:4]. Type pode ser ftyp/moov/styp.
  // ISO BMFF (.mp4/.mov): bytes 4-7 = "ftyp" 0x66747970
  // fMP4: começa com "styp" 0x73747970 (segment type box)
  const boxType = buf.slice(4, 8).toString('ascii')
  if (boxType === 'styp') return { format: 'mp4_fragmented' }
  if (boxType === 'ftyp' || boxType === 'moov') {
    return { format: 'mp4_invalid', reason: `MP4 normal com '${boxType}' no início — HLS.js NÃO toca. Use mpegts (-segment_format mpegts) ou fMP4 (CMAF).` }
  }

  return { format: 'unknown', reason: `magic bytes desconhecidos: ${buf.slice(0, 8).toString('hex')}` }
}

iacvBoxSegmentsRouter.post(
  '/upload',
  assertBoxOwnership,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const file = req.file
    if (!file) throw new ValidationError('Campo "file" obrigatório (multipart .ts)')
    if (file.size === 0) throw new ValidationError('Arquivo vazio')

    // Validação de FORMATO — rejeita MP4 mascarado de .ts (HLS.js não toca).
    const detected = detectSegmentFormat(file.buffer)
    if (detected.format === 'mp4_invalid') {
      throw new ValidationError(
        `Formato inválido: ${detected.reason}. ` +
        `Ajuste o ffmpeg da box: trocar -f mp4 por -f segment -segment_format mpegts. ` +
        `Ver INTEGRATION/CLOUD_TO_BOX.md.`,
      )
    }
    if (detected.format === 'unknown') {
      // Não rejeita (pode ser fMP4 com magic bytes não-padrão), só loga
      logger.warn({ reason: detected.reason, size: file.size },
        'segment_unknown_format')
    }

    const metaRaw = typeof req.body?.meta === 'string' ? req.body.meta : null
    if (!metaRaw) throw new ValidationError('Campo "meta" obrigatório (JSON)')
    let meta: SegmentMeta
    try {
      meta = SegmentMetaSchema.parse(JSON.parse(metaRaw))
    } catch (err) {
      if (err instanceof z.ZodError) throw err
      throw new ValidationError('"meta" inválido (JSON malformado)')
    }

    const box = req.boxLicense!
    const { integradorId } = await resolveCameraForBox(meta.cameraId, box.edgeNodeId)

    const result = await recordingIngest.ingestSegment({
      cameraId:    meta.cameraId,
      startedAt:   new Date(meta.startedAt),
      durationSec: meta.durationSec,
      fileBuffer:  file.buffer,
      source:      'BOX',
      integradorId,
      meta: {
        codec:     meta.codec,
        fps:       meta.fps,
        width:     meta.width,
        height:    meta.height,
        hasMotion: meta.hasMotion,
        hasEvent:  meta.hasEvent,
      },
    })

    res.status(result.persisted === 'created' ? 201 : 200).json({
      segmentId:   result.segmentId,
      storagePath: result.storagePath,
      persisted:   result.persisted,
      sizeBytes:   result.sizeBytes,
      endedAt:     result.endedAt.toISOString(),
    })
  }),
)

// ── 2. POST /iacv-box/segments/presign ────────────────────────────────────
// Box pede URL pré-assinada pra fazer PUT direto no R2. Retorna o
// storagePath sugerido pra ela referenciar depois no /register.

const PresignBody = z.object({
  cameraId:  z.string().uuid(),
  startedAt: z.string().datetime(),
})

iacvBoxSegmentsRouter.post(
  '/presign',
  assertBoxOwnership,
  asyncHandler(async (req: Request, res: Response) => {
    const body = PresignBody.parse(req.body)
    const box = req.boxLicense!
    const { integradorId } = await resolveCameraForBox(body.cameraId, box.edgeNodeId)

    if (!r2Storage.isEnabled()) {
      throw new ValidationError('R2 não configurado nesta instalação — use /upload (multipart)')
    }

    // Storage path determinístico: box vai PUT exatamente nesse path.
    // Provisional segmentId NÃO é gerado — UUID real fica no /register
    // (deduplicação por startedAt continua funcionando).
    const startedAt = new Date(body.startedAt)
    const datePart = startedAt.toISOString().slice(0, 10)
    const timePart = startedAt.toISOString().slice(11, 19).replace(/:/g, '-')
    // Marker `__PRESIGN__` é placeholder — register() vai mover/registrar
    // com UUID final. Box envia EXATAMENTE esse path no /register.
    const storagePath = `${body.cameraId}/${datePart}/${timePart}_presign.ts`

    const uploadUrl = await r2Storage.getPresignedUploadUrl(
      integradorId, storagePath, 'video/mp2t', PRESIGN_TTL_SEC,
    )
    if (!uploadUrl) throw new ValidationError('Falha ao gerar URL pré-assinada')

    res.json({ uploadUrl, storagePath, expiresInSec: PRESIGN_TTL_SEC })
  }),
)

// ── 3. POST /iacv-box/segments/register ───────────────────────────────────
// Após PUT direto no R2, box chama isso pra registrar o RecordingSegment.
// Backend valida via HEAD que objeto existe.

const RegisterBody = SegmentMetaSchema.extend({
  storagePath: z.string().min(1),
})

iacvBoxSegmentsRouter.post(
  '/register',
  assertBoxOwnership,
  asyncHandler(async (req: Request, res: Response) => {
    const body = RegisterBody.parse(req.body)
    const box = req.boxLicense!
    const { integradorId } = await resolveCameraForBox(body.cameraId, box.edgeNodeId)

    // Confirma que o objeto realmente foi PUTado no R2.
    const head = await r2Storage.head(integradorId, body.storagePath)
    if (!head) {
      await recordingIngest.logFailure(body.cameraId, 'PRESIGNED', 'object_not_found_on_r2', {
        storagePath: body.storagePath,
      })
      throw new NotFoundError('Objeto não encontrado no R2 — fez o PUT antes de /register?')
    }

    const result = await recordingIngest.ingestSegment({
      cameraId:    body.cameraId,
      startedAt:   new Date(body.startedAt),
      durationSec: body.durationSec,
      fileBuffer:  null,
      uploaded:    true,
      storagePathOverride: body.storagePath,
      sizeBytesOverride:   head.size,
      source:      'PRESIGNED',
      integradorId,
      meta: {
        codec:     body.codec,
        fps:       body.fps,
        width:     body.width,
        height:    body.height,
        hasMotion: body.hasMotion,
        hasEvent:  body.hasEvent,
      },
    })

    res.status(result.persisted === 'created' ? 201 : 200).json({
      segmentId:   result.segmentId,
      storagePath: result.storagePath,
      persisted:   result.persisted,
      sizeBytes:   result.sizeBytes,
      endedAt:     result.endedAt.toISOString(),
    })
  }),
)

// Multer error handler — converte file-too-large pra 400 com mensagem clara.
iacvBoxSegmentsRouter.use((
  err: any,
  _req: Request,
  res: Response,
  next: (err?: any) => void,
) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      error: 'FILE_TOO_LARGE',
      message: `Segmento excede o limite de ${MAX_SEGMENT_BYTES} bytes (50MB)`,
    })
    return
  }
  next(err)
})

// Suprime "import not used" se logger ou recordingStorage não forem
// usados em um cenário de runtime. Mantemos pois ajudam debugar.
void logger; void recordingStorage
