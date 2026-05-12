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
import rateLimit from 'express-rate-limit'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { classifyClockSkew } from '../lib/clock-skew'
import { asyncHandler } from '../middleware/async-handler'
import { assertBoxOwnership } from '../middleware/assert-box-ownership'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'
import { recordingIngest } from '../services/recording-ingest.service'
import { recordingStorage } from '../services/recording-storage.service'
import { r2Storage } from '../services/r2-storage.service'

export const iacvBoxSegmentsRouter = Router()

const MAX_SEGMENT_BYTES = 50 * 1024 * 1024  // 50 MB — folga 16x sobre 1080p/6s
const PRESIGN_TTL_SEC   = 600                // 10 min pra fazer upload R2

// G5 fix (2026-05-09): multer.diskStorage em vez de memoryStorage.
// Antes: cada upload alocava até 50MB no heap → várias boxes simultâneas
// estouravam 1024M de memory limit do backend. Agora vai pra /tmp/icv-uploads
// e é apagado após ingest concluir.
const UPLOAD_TMP_DIR = process.env.ICV_UPLOAD_TMP_DIR ?? join(tmpdir(), 'icv-uploads')
fs.mkdir(UPLOAD_TMP_DIR, { recursive: true }).catch(() => {})

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
    filename:    (_req, _file, cb) => cb(null, `seg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.ts`),
  }),
  limits: { fileSize: MAX_SEGMENT_BYTES },
})

// G16 fix: rate-limit por box (chave = boxLicense.edgeNodeId).
// Box mal-configurada que tenta subir 100 segments/s não derruba o ingest
// das outras. 30 req/min sustained, 60 burst — 6s segments × 6 cams = 60/min.
const boxIngestRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const box = (req as any).boxLicense
    return box?.edgeNodeId ?? req.ip ?? 'anon'
  },
  message: { error: 'RATE_LIMIT', message: 'Limite de upload por box excedido — reduza concorrência' },
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
/**
 * 2026-05-12 fix — Validação defensiva de clock skew.
 *
 * Sintoma observado: edge box "Lab" entrega segmentos com startedAt 4h atrás
 * (clock host UTC-4 + `datetime.now()` sem `.astimezone(UTC)`).
 *
 * Sprint γ-Day1 (2026-05-12): lógica pura extraída para `lib/clock-skew.ts`
 * com cobertura unit tests (Vitest + fast-check). Esta função aqui só faz
 * o wiring: chama `classifyClockSkew`, traduz `reject` em ValidationError,
 * loga `warn`/`rewritten`. Caller continua igual.
 */
function validateAndNormalizeStartedAt(
  cameraId: string, edgeNodeId: string,
  startedAtRaw: string, durationSec: number,
): Date {
  const r = classifyClockSkew(startedAtRaw, durationSec)
  if (r.kind === 'reject') {
    throw new ValidationError(
      `Segmento com startedAt no futuro (${r.reasonSec}s à frente) — ` +
      `verifique relógio NTP do box ${edgeNodeId.slice(0, 8)}`,
    )
  }
  if (r.kind === 'rewritten') {
    logger.warn({
      cameraId, edgeNodeId,
      claimedStartedAt: r.original.toISOString(),
      skewSec: r.skewSec,
      rewrittenTo: r.normalized.toISOString(),
    }, 'box_segment_clock_skew_rewritten — corrija NTP no box')
  } else if (r.kind === 'warn') {
    logger.warn({
      cameraId, edgeNodeId,
      claimedStartedAt: r.normalized.toISOString(),
      skewSec: r.skewSec,
    }, 'box_segment_clock_skew_warning')
  }
  return r.normalized
}

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
export function detectSegmentFormat(buf: Buffer): {
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
  boxIngestRateLimiter,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const file = req.file
    if (!file) throw new ValidationError('Campo "file" obrigatório (multipart .ts)')
    if (file.size === 0) {
      await fs.unlink(file.path).catch(() => {})
      throw new ValidationError('Arquivo vazio')
    }

    // Cleanup garantido — arquivo sai de /tmp em qualquer cenário.
    let cleanedUp = false
    const cleanup = async () => {
      if (cleanedUp) return
      cleanedUp = true
      await fs.unlink(file.path).catch(() => {})
    }

    try {
      // Lê primeiros 256 bytes do disco pra validar formato.
      // Carrega em RAM apenas o head — segment inteiro fica no /tmp até ingest
      // consumir. recording-ingest aceita Buffer hoje (compat) — passamos o
      // file inteiro lido só agora pra evitar a alocação inicial.
      const fh = await fs.open(file.path, 'r')
      const headBuf = Buffer.alloc(256)
      await fh.read(headBuf, 0, 256, 0)
      await fh.close()

      const detected = detectSegmentFormat(headBuf)
      if (detected.format === 'mp4_invalid') {
        await cleanup()
        throw new ValidationError(
          `Formato inválido: ${detected.reason}. ` +
          `Ajuste o ffmpeg da box: trocar -f mp4 por -f segment -segment_format mpegts. ` +
          `Ver INTEGRATION/CLOUD_TO_BOX.md.`,
        )
      }
      if (detected.format === 'unknown') {
        logger.warn({ reason: detected.reason, size: file.size },
          'segment_unknown_format')
      }

      const metaRaw = typeof req.body?.meta === 'string' ? req.body.meta : null
      if (!metaRaw) {
        await cleanup()
        throw new ValidationError('Campo "meta" obrigatório (JSON)')
      }
      let meta: SegmentMeta
      try {
        meta = SegmentMetaSchema.parse(JSON.parse(metaRaw))
      } catch (err) {
        await cleanup()
        if (err instanceof z.ZodError) throw err
        throw new ValidationError('"meta" inválido (JSON malformado)')
      }

      const box = req.boxLicense!
      const { integradorId } = await resolveCameraForBox(meta.cameraId, box.edgeNodeId)

      // Lê arquivo inteiro do /tmp pra passar ao ingest (mantém compat com
      // recording-ingest que ainda aceita Buffer). Pico de RAM = 1 segment
      // por request, e cleanup é imediato.
      const fileBuffer = await fs.readFile(file.path)

      const normalizedStartedAt = validateAndNormalizeStartedAt(
        meta.cameraId, box.edgeNodeId, meta.startedAt, meta.durationSec,
      )

      const result = await recordingIngest.ingestSegment({
        cameraId:    meta.cameraId,
        startedAt:   normalizedStartedAt,
        durationSec: meta.durationSec,
        fileBuffer,
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

      await cleanup()

      res.status(result.persisted === 'created' ? 201 : 200).json({
        segmentId:   result.segmentId,
        storagePath: result.storagePath,
        persisted:   result.persisted,
        sizeBytes:   result.sizeBytes,
        endedAt:     result.endedAt.toISOString(),
      })
    } catch (err) {
      await cleanup()
      throw err
    }
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
  boxIngestRateLimiter,
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
  boxIngestRateLimiter,
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

    // Validação de FORMATO via Range request (16 primeiros bytes).
    // Sem isso, MP4 inválido upload via presigned não é detectado e quebra
    // o player no manifest. HLS.js só toca MPEG-TS (0x47) ou fMP4 (styp).
    const headBytes = await r2Storage.getRangeBytes(integradorId, body.storagePath, 16)
    if (headBytes) {
      const detected = detectSegmentFormat(headBytes)
      if (detected.format === 'mp4_invalid') {
        // Apaga o objeto inválido pra não acumular lixo no bucket
        await r2Storage.delete(integradorId, body.storagePath).catch(() => {})
        await recordingIngest.logFailure(body.cameraId, 'PRESIGNED', 'mp4_invalid_format', {
          storagePath: body.storagePath, reason: detected.reason,
        })
        throw new ValidationError(
          `Formato inválido: ${detected.reason}. ` +
          `Ajuste o ffmpeg da box: trocar -f mp4 por -f segment -segment_format mpegts. ` +
          `Ver INTEGRATION/CLOUD_TO_BOX.md.`,
        )
      }
      if (detected.format === 'unknown') {
        logger.warn({ reason: detected.reason, storagePath: body.storagePath },
          'presigned_segment_unknown_format')
      }
    }

    const normalizedStartedAt = validateAndNormalizeStartedAt(
      body.cameraId, box.edgeNodeId, body.startedAt, body.durationSec,
    )

    const result = await recordingIngest.ingestSegment({
      cameraId:    body.cameraId,
      startedAt:   normalizedStartedAt,
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
