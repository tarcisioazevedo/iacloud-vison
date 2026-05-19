/**
 * Cameras Routes — CRUD completo Frigate-inspired.
 *
 * POST   /cameras                        → criar câmera
 * GET    /cameras                        → listar (com filtros)
 * GET    /cameras/:id                    → detalhe completo
 * PATCH  /cameras/:id                    → atualizar
 * PATCH  /cameras/:id/config             → atualizar apenas config avançada (JSON merge)
 * DELETE /cameras/:id                    → desativar
 * POST   /cameras/:id/test               → testar RTSP (ffprobe)
 * POST   /cameras/:id/snapshot           → gerar snapshot atual
 * GET    /cameras/:id/stream-tests       → histórico de testes
 * GET    /cameras/:id/logs               → logs da câmera
 * POST   /cameras/:id/zones              → criar zona
 * PATCH  /cameras/:id/zones/:zoneId      → atualizar zona
 * DELETE /cameras/:id/zones/:zoneId      → deletar zona
 * GET    /cameras/presets                → presets Frigate (ffmpeg, hwaccel)
 */
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { enforceTrialCameraLimit } from '../middleware/trial-camera-limit'
import { blockReadOnly } from '../middleware/block-read-only'
import { asyncHandler } from '../middleware/async-handler'
import { auditAction, auditUpdate, auditDelete } from '../lib/audit-helpers'
import { vertexService } from '../services/vertex.service'
import { rtspTestService } from '../services/rtsp-test.service'
import { cameraLogService } from '../services/camera-log.service'
import { liveService } from '../services/live.service'
import { prisma } from '../lib/prisma'
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors'
import { logger } from '../lib/logger'
import {
  cameraTenantWhere,
  requireCameraForUser,
  assertSiteBelongsToUser,
  resolveCreateCameraSiteId,
} from '../lib/tenant-scope'
import { resolveCameraPrice } from '../lib/pricing'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { go2rtcService } from '../services/go2rtc.service'
import { scheduleGo2rtcConfigSync } from '../services/go2rtc-config.service'

export const cameraRouter = Router()
cameraRouter.use(requireAuth)
cameraRouter.use(blockReadOnly)  // Lote 2: CLIENTE_SUPERVISOR = read-only

// =============================================================================
// PRESETS — catálogo de referência (Frigate)
// =============================================================================

const FFMPEG_INPUT_PRESETS = [
  { id: 'rtsp-generic',       name: 'RTSP Genérico',               args: '-avoid_negative_ts make_zero -fflags +genpts+discardcorrupt -rtsp_transport tcp -timeout 5000000 -use_wallclock_as_timestamps 1' },
  { id: 'rtsp-restream',      name: 'RTSP via go2rtc restream',    args: '-avoid_negative_ts make_zero -fflags +genpts -flags low_delay -strict experimental -rtsp_transport tcp -analyzeduration 1000000 -probesize 1000000' },
  { id: 'rtsp-udp',           name: 'RTSP UDP (menor latência)',   args: '-avoid_negative_ts make_zero -fflags +genpts -rtsp_transport udp -timeout 5000000' },
  { id: 'http-mjpeg',         name: 'HTTP MJPEG',                  args: '-r 5' },
  { id: 'rtmp-generic',       name: 'RTMP Genérico',               args: '-rw_timeout 5000000' },
]

const FFMPEG_OUTPUT_PRESETS = [
  { id: 'record-generic',               name: 'Record genérico (copy)',          args: '-f segment -segment_time 10 -segment_format mp4 -strftime 1 -c copy -an' },
  { id: 'record-generic-audio-copy',    name: 'Record com áudio (copy)',         args: '-f segment -segment_time 10 -segment_format mp4 -strftime 1 -c copy' },
  { id: 'record-generic-audio-aac',     name: 'Record com áudio AAC',            args: '-f segment -segment_time 10 -segment_format mp4 -strftime 1 -c:v copy -c:a aac' },
  { id: 'detect-generic',               name: 'Detect genérico',                 args: '-f rawvideo -pix_fmt yuv420p' },
]

const HWACCEL_PRESETS = [
  { id: 'NONE',             label: 'Software (CPU)',            hint: 'Sem aceleração. Evitar em 4K ou >10 fps.' },
  { id: 'VAAPI',            label: 'VAAPI (Intel/AMD Linux)',   hint: 'iGPU Intel ou AMD Radeon, requer /dev/dri.' },
  { id: 'INTEL_QSV_H264',   label: 'Intel QSV H.264',           hint: 'Quick Sync Video H.264.' },
  { id: 'INTEL_QSV_H265',   label: 'Intel QSV H.265/HEVC',      hint: 'Quick Sync Video HEVC.' },
  { id: 'NVIDIA_NVDEC',     label: 'NVIDIA NVDEC/CUDA',         hint: 'GPU NVIDIA com suporte NVDEC.' },
  { id: 'RPI_V4L2_H264',    label: 'Raspberry Pi V4L2 H.264',   hint: 'RPi4/RPi5 com decodificador H264.' },
  { id: 'RPI_V4L2_H265',    label: 'Raspberry Pi V4L2 H.265',   hint: 'RPi5 somente (H.265 hw).' },
  { id: 'ROCKCHIP_RKMPP',   label: 'Rockchip RKMPP',            hint: 'RK3568/RK3588 via MPP.' },
  { id: 'AMD_ROCM',         label: 'AMD ROCm',                  hint: 'GPU AMD com ROCm.' },
]

const DETECTOR_PRESETS = [
  { id: 'CPU',           label: 'CPU',                    speed: '⭐', accuracy: '⭐⭐',  hint: 'Fallback, não recomendado em produção.' },
  { id: 'CORAL_USB',     label: 'Coral Edge TPU USB',     speed: '⭐⭐⭐⭐', accuracy: '⭐⭐⭐', hint: 'Google Coral USB (~15W TPU)' },
  { id: 'CORAL_PCI',     label: 'Coral Edge TPU PCIe',    speed: '⭐⭐⭐⭐', accuracy: '⭐⭐⭐', hint: 'Coral M.2 ou mini-PCIe' },
  { id: 'OPENVINO_CPU',  label: 'OpenVINO CPU',           speed: '⭐⭐', accuracy: '⭐⭐⭐', hint: 'Intel OpenVINO CPU inference' },
  { id: 'OPENVINO_GPU',  label: 'OpenVINO Intel iGPU',    speed: '⭐⭐⭐', accuracy: '⭐⭐⭐', hint: 'Intel iGPU via OpenVINO' },
  { id: 'TENSORRT',      label: 'NVIDIA TensorRT',        speed: '⭐⭐⭐⭐⭐', accuracy: '⭐⭐⭐⭐', hint: 'GPU NVIDIA (Jetson, RTX)' },
  { id: 'ONNX',          label: 'ONNX (genérico)',        speed: '⭐⭐⭐', accuracy: '⭐⭐⭐', hint: 'Runtime ONNX genérico' },
  { id: 'HAILO8',        label: 'Hailo-8 (26 TOPS)',      speed: '⭐⭐⭐⭐⭐', accuracy: '⭐⭐⭐⭐', hint: 'Acelerador NPU Hailo-8' },
  { id: 'HAILO8L',       label: 'Hailo-8L (13 TOPS)',     speed: '⭐⭐⭐⭐', accuracy: '⭐⭐⭐⭐', hint: 'Hailo-8 Light (RPi AI Kit)' },
  { id: 'RKNN',          label: 'Rockchip RKNN NPU',      speed: '⭐⭐⭐⭐', accuracy: '⭐⭐⭐', hint: 'RK3588 NPU 6 TOPS' },
  { id: 'ROCM',          label: 'AMD ROCm',               speed: '⭐⭐⭐⭐', accuracy: '⭐⭐⭐⭐', hint: 'GPU AMD via ROCm' },
  { id: 'VERTEX_AI',     label: 'Vertex AI (cloud)',      speed: '⭐⭐⭐⭐', accuracy: '⭐⭐⭐⭐⭐', hint: 'Inferência no Google Cloud' },
]

const TRACKABLE_OBJECTS = [
  'person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck',
  'cat', 'dog', 'bird', 'horse', 'sheep', 'cow',
  'backpack', 'handbag', 'suitcase', 'umbrella',
  'package', 'license_plate', 'face', 'gun', 'knife',
  'fire', 'smoke',
]

const AUDIO_LABELS = [
  'bark', 'scream', 'yell', 'crying_baby', 'fire_alarm', 'smoke_alarm',
  'glass_breaking', 'gunshot', 'siren', 'car_alarm', 'speech',
  'music', 'laughter', 'cough', 'sneeze', 'engine',
]

cameraRouter.get('/presets', (_req, res) => {
  res.json({
    ffmpegInputPresets:  FFMPEG_INPUT_PRESETS,
    ffmpegOutputPresets: FFMPEG_OUTPUT_PRESETS,
    hwaccelPresets:      HWACCEL_PRESETS,
    detectorPresets:     DETECTOR_PRESETS,
    trackableObjects:    TRACKABLE_OBJECTS,
    audioLabels:         AUDIO_LABELS,
  })
})

// =============================================================================
// SCHEMAS (Zod)
// =============================================================================

const Point = z.object({ x: z.number(), y: z.number() })

const ZoneSchema = z.object({
  name:         z.string().min(1),
  type:         z.enum(['COUNTING_LINE','POLYGON_ZONE','HEAT_MAP','PPE_CHECK',
                        'QUEUE_MONITOR','DWELL_TIME','RESTRICTED_AREA','PARKING_SPOT',
                        'CHECKOUT_LINE','DISPLAY_ZONE']),
  color:        z.string().optional(),
  coordinates:  z.array(Point).min(2),
  direction:    z.enum(['IN','OUT','BOTH']).optional(),
  inertia:      z.number().int().min(1).max(30).optional(),
  loiteringTimeSec: z.number().int().min(0).max(3600).optional(),
  objects:      z.array(z.string()).optional(),
  filters:      z.record(z.any()).optional(),
  distances:    z.array(z.number()).optional(),
  requiredForAlert: z.boolean().optional(),
  maxOccupancy: z.number().int().positive().optional(),
  alertOnViolation: z.boolean().optional(),
})

const CameraSchema = z.object({
  // siteId é opcional aqui pra permitir auto-fill quando o tenant tem
  // exatamente 1 site (caso comum do primeiro cadastro). A regra final é
  // aplicada em resolveCreateCameraSiteId() — se ambíguo, joga 400.
  siteId:          z.string().optional().nullable(),
  edgeNodeId:      z.string().min(1).optional(),
  name:            z.string().min(1),
  description:     z.string().optional(),
  location:        z.string().optional(),
  zipCode:         z.string().max(10).optional(),
  city:            z.string().max(80).optional(),
  state:           z.string().max(40).optional(),
  latitude:        z.number().min(-90).max(90).optional().nullable(),
  longitude:       z.number().min(-180).max(180).optional().nullable(),

  // Modo de ingestão: RTSP_PULL (backend puxa) | RTMP_PUSH (câmera empurra)
  // | SRT_PUSH (câmera empurra via SRT — mais robusto em redes instáveis)
  ingestMode:      z.enum(['RTSP_PULL', 'RTMP_PUSH', 'SRT_PUSH']).optional(),

  // Modo de deployment: EDGE_BOX (gerenciada por box local) ou CLOUD_DIRECT (avulsa)
  deploymentMode:  z.enum(['EDGE_BOX', 'CLOUD_DIRECT']).optional(),

  // Streams — rtspMainUrl obrigatório apenas para RTSP_PULL
  rtspMainUrl:     z.string().optional(),
  rtspSubUrl:      z.string().optional(),
  rtspUsername:    z.string().optional(),
  rtspPassword:    z.string().optional(),
  rtmpPushUrl:     z.string().optional(),

  // Identificação
  brand:           z.string().optional(),
  model:           z.string().optional(),
  firmwareVersion: z.string().optional(),
  serialNumber:    z.string().optional(),
  macAddress:      z.string().optional(),
  resolution:      z.string().optional(),
  fps:             z.number().int().optional(),
  codec:           z.string().optional(),

  // Pipeline — aceita tiers técnicos (legado) + comerciais (novo rebrand).
  tier:            z.enum([
    'STATIC_VISION', 'STREAMING_ANALYTICS',
    'BRONZE', 'SILVER', 'GOLD', 'PLATINUM',
  ]),
  pipeline:        z.enum(['EDGE_HYBRID', 'VERTEX_STREAMING', 'EDGE_YOLO']),

  // FFmpeg / HW
  hwAccel:            z.enum(['NONE','VAAPI','NVIDIA_NVDEC','INTEL_QSV_H264','INTEL_QSV_H265',
                              'RPI_V4L2_H264','RPI_V4L2_H265','ROCKCHIP_RKMPP','AMD_ROCM']).optional(),
  ffmpegInputArgs:    z.string().optional(),
  ffmpegOutputArgs:   z.string().optional(),
  ffmpegGlobalArgs:   z.string().optional(),

  // Detector
  detectorType:       z.enum(['CPU','CORAL_USB','CORAL_PCI','OPENVINO_CPU','OPENVINO_GPU',
                              'TENSORRT','ONNX','HAILO8','HAILO8L','RKNN','ROCM','VERTEX_AI']).optional(),
  detectorWidth:      z.number().int().optional(),
  detectorHeight:     z.number().int().optional(),
  detectorFps:        z.number().int().optional(),
  detectorModelType:  z.string().optional(),

  // Motion
  motionEnabled:         z.boolean().optional(),
  motionThreshold:       z.number().int().min(1).max(255).optional(),
  motionContourArea:     z.number().int().optional(),
  motionImproveContrast: z.boolean().optional(),

  // Objects tracking
  objectsTrack:       z.array(z.string()).optional(),
  objectsFilters:     z.record(z.any()).optional(),

  // Snapshots
  snapshotsEnabled:    z.boolean().optional(),
  snapshotBoundingBox: z.boolean().optional(),
  snapshotQuality:     z.number().int().min(1).max(100).optional(),
  snapshotRetainDays:  z.number().int().optional(),

  // Record
  recordEnabled:          z.boolean().optional(),
  recordMode:             z.enum(['ALL','MOTION','ACTIVE_OBJECTS','DISABLED']).optional(),
  recordRetainDays:       z.number().int().optional(),
  recordAlertRetainDays:  z.number().int().optional(),
  recordDetectionRetainDays: z.number().int().optional(),
  recordPreCaptureSec:    z.number().int().optional(),
  recordPostCaptureSec:   z.number().int().optional(),

  // Review
  reviewAlertLabels:     z.array(z.string()).optional(),
  reviewDetectionLabels: z.array(z.string()).optional(),

  // Audio
  audioEnabled:       z.boolean().optional(),
  audioListen:        z.array(z.string()).optional(),
  audioMinVolume:     z.number().int().optional(),

  // Semantic
  semanticSearchEnabled: z.boolean().optional(),
  semanticModelSize:     z.enum(['small','large']).optional(),

  // Face
  faceRecognitionEnabled: z.boolean().optional(),
  faceMinScore:           z.number().min(0).max(1).optional(),

  // LPR
  lprEnabled:          z.boolean().optional(),
  lprFormatRegex:      z.string().optional(),

  // GenAI
  genaiEnabled:       z.boolean().optional(),
  genaiProvider:      z.string().optional(),
  genaiModel:         z.string().optional(),
  genaiPromptGlobal:  z.string().optional(),

  // PTZ
  onvifHost:          z.string().optional(),
  onvifPort:          z.number().int().optional(),
  onvifUsername:      z.string().optional(),
  onvifPassword:      z.string().optional(),
  ptzEnabled:         z.boolean().optional(),
  ptzAutotrackEnabled: z.boolean().optional(),

  // Birdseye
  birdseyeEnabled:    z.boolean().optional(),
  birdseyeMode:       z.enum(['continuous','motion','objects']).optional(),

  // Models + Zones (nested)
  enabledModels:      z.array(z.string()).optional(),
  zones:              z.array(ZoneSchema).optional(),
  // Opcional: se ausente e tier é comercial (SILVER/GOLD/...), resolve via
  // pricing table. Tiers técnicos (STATIC_VISION/STREAMING_ANALYTICS) exigem
  // o valor explícito — pay-as-you-go não tem preço-padrão.
  priceMonthlyBrl:    z.number().positive().optional(),
})

// =============================================================================
// RTMP URL helpers
// =============================================================================

function getRtmpHost(): { host: string; port: number } {
  const host = process.env.RTMP_INGEST_HOST ?? 'app.iacloud.com.br'
  const port = Number(process.env.RTMP_INGEST_PORT ?? 1935)
  return { host, port }
}

function buildRtmpUrl(streamKey: string): string {
  const { host, port } = getRtmpHost()
  return `rtmp://${host}:${port}/${streamKey}`
}

function getSrtHost(): { host: string; port: number } {
  const host = process.env.SRT_INGEST_HOST ?? 'app.iacloud.com.br'
  const port = Number(process.env.SRT_INGEST_PORT ?? 8890)
  return { host, port }
}

/**
 * URL pra encoder SRT empurrar via MediaMTX (não go2rtc — go2rtc 1.9 não
 * suporta SRT). Formato MediaMTX:
 *   srt://host:port?streamid=publish:<path>&latency=<ms>
 *
 * Path = streamKey. MediaMTX aceita publish em qualquer path por default
 * (sem auth). Pra produção: configurar passphrase via env do mediamtx.
 *
 * `latency=500ms` é bom default — robusto a perda de pacote em Wi-Fi/4G
 * sem virar slideshow. Cliente avançado pode tunar pra 200ms (LAN) ou
 * 2000ms (rede móvel ruim).
 */
function buildSrtUrl(streamKey: string): string {
  const { host, port } = getSrtHost()
  return `srt://${host}:${port}?streamid=publish:${streamKey}&latency=500`
}

// =============================================================================
// POST /cameras — criar
// =============================================================================

cameraRouter.post('/', enforceTrialCameraLimit, asyncHandler(async (req, res) => {
    const parse = CameraSchema.safeParse(req.body)
    if (!parse.success) {
      // Mostra o caminho do campo inválido + mensagem.
      // Ex.: "siteId: Required" (antes era apenas "Required").
      const first = parse.error.errors[0]
      const path = first.path.length ? first.path.join('.') : 'body'
      throw new ValidationError(`${path}: ${first.message}`)
    }

    const b   = parse.data
    const jwt = req.jwtPayload!
    const integradorId = jwt.integradorId
    if (!integradorId && jwt.role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Apenas integradores podem cadastrar câmeras')
    }

    // Isolamento multi-tenant + auto-fill quando trivial:
    //   - siteId fornecido + pertence ao tenant → ok
    //   - siteId vazio + tenant com 1 site → autoresolve (UX do 1º cadastro)
    //   - siteId vazio + 0 sites ou múltiplos → 400 com mensagem clara
    //   - siteId fornecido mas não pertence → 404 (anti-vazamento)
    const resolvedSiteId = await resolveCreateCameraSiteId(b.siteId, jwt)

    // Pre-check de unicidade (siteId, name) — UX. A constraint do Prisma
    // pega a corrida real, mas verificar aqui devolve erro 422 amigável em
    // vez de 500 + stack trace pra tentativa óbvia.
    const dup = await prisma.camera.findFirst({
      where: { siteId: resolvedSiteId, name: b.name },
      select: { id: true },
    })
    if (dup) {
      throw new ValidationError(
        `Já existe uma câmera com o nome "${b.name}" neste site (id: ${dup.id.slice(0, 8)}). Escolha outro nome.`,
      )
    }

    // Validação tenant: edgeNodeId, quando presente, deve existir, pertencer
    // ao mesmo tenant do operador (anti-IDOR) e estar no MESMO site da câmera
    // (invariante multi-tenant). Antes desta checagem, o composite FK do banco
    // (Camera_siteId_edgeNodeId_fkey) joga FK violation crua — devolve mensagem
    // amigável aqui pra UX. Espelha a lógica do PATCH /cameras/:id.
    if (b.edgeNodeId) {
      const edge = await prisma.edgeNode.findFirst({
        where: {
          id: b.edgeNodeId,
          ...(jwt.role === 'SUPER_ADMIN'
            ? {}
            : jwt.clienteFinalId
              ? { site: { clienteFinalId: jwt.clienteFinalId } }
              : jwt.integradorId
                ? { site: { clienteFinal: { integradorId: jwt.integradorId } } }
                : { id: '__no_access__' }),
        },
        select: { id: true, siteId: true },
      })
      if (!edge) throw new NotFoundError('Edge node')
      if (edge.siteId !== resolvedSiteId) {
        throw new ValidationError('Edge node não pertence ao mesmo site da câmera')
      }
    }

    // Determina modo de ingestão (default: RTSP_PULL para retrocompat)
    const ingestMode = b.ingestMode ?? 'RTSP_PULL'

    // Validação: RTSP_PULL exige rtspMainUrl; PUSH modes não exigem
    if (ingestMode === 'RTSP_PULL' && !b.rtspMainUrl) {
      throw new ValidationError('rtspMainUrl é obrigatório para modo RTSP_PULL')
    }

    // Para PUSH modes (RTMP/SRT), gera stream key automaticamente.
    // SRT usa mesma rtmpIngestKeyEnc — semanticamente é "ingest key", não
    // protocol-specific. URL final monta com srt:// ou rtmp:// conforme.
    let rtmpIngestKeyEnc: string | null = null
    if (ingestMode === 'RTMP_PUSH' || ingestMode === 'SRT_PUSH') {
      const { generateRtmpStreamKey } = await import('../lib/rtmp-key')
      rtmpIngestKeyEnc = encryptSecret(generateRtmpStreamKey())
    }

    // rtspMainUrl placeholder pra PUSH modes (campo NOT NULL no schema)
    const rtspMainUrl =
      ingestMode === 'RTMP_PUSH' ? 'rtmp-push://ingest'
    : ingestMode === 'SRT_PUSH'  ? 'srt-push://ingest'
    : b.rtspMainUrl!

    let camera
    try {
      camera = await prisma.camera.create({
      data: {
        siteId:      resolvedSiteId,
        edgeNodeId:  b.edgeNodeId ?? null,
        name:        b.name,
        description: b.description ?? null,
        location:    b.location ?? null,
        zipCode:     b.zipCode   ?? null,
        city:        b.city      ?? null,
        state:       b.state     ?? null,
        latitude:    b.latitude  ?? null,
        longitude:   b.longitude ?? null,

        ingestMode:     ingestMode as any,
        rtmpIngestKeyEnc,
        // EDGE_BOX se há edgeNodeId; CLOUD_DIRECT explícito ou se body informar
        deploymentMode: (b.deploymentMode ?? (b.edgeNodeId ? 'EDGE_BOX' : 'CLOUD_DIRECT')) as any,

        rtspMainUrl:    rtspMainUrl,
        rtspSubUrl:     b.rtspSubUrl ?? null,
        rtspUsername:   b.rtspUsername ?? null,
        // Senha cifrada com AES-256-GCM antes de persistir.
        rtspPasswordEnc: b.rtspPassword ? encryptSecret(b.rtspPassword) : null,
        rtmpPushUrl:    b.rtmpPushUrl ?? null,

        brand:        b.brand ?? null,
        model:        b.model ?? null,
        firmwareVersion: b.firmwareVersion ?? null,
        serialNumber: b.serialNumber ?? null,
        macAddress:   b.macAddress ?? null,
        resolution:   b.resolution ?? null,
        fps:          b.fps ?? null,
        codec:        b.codec ?? null,

        tier:     b.tier,
        pipeline: b.pipeline,
        status:   'PENDING_CONFIG',

        hwAccel:          (b.hwAccel ?? 'NONE') as any,
        ffmpegInputArgs:  b.ffmpegInputArgs ?? null,
        ffmpegOutputArgs: b.ffmpegOutputArgs ?? null,
        ffmpegGlobalArgs: b.ffmpegGlobalArgs ?? null,

        detectorType:      (b.detectorType ?? 'CPU') as any,
        detectorWidth:     b.detectorWidth ?? 1280,
        detectorHeight:    b.detectorHeight ?? 720,
        detectorFps:       b.detectorFps ?? 5,
        detectorModelType: b.detectorModelType ?? null,

        motionEnabled:         b.motionEnabled ?? true,
        motionThreshold:       b.motionThreshold ?? 30,
        motionContourArea:     b.motionContourArea ?? 10,
        motionImproveContrast: b.motionImproveContrast ?? true,

        objectsTrackJson:   (b.objectsTrack ?? ['person']) as any,
        objectsFiltersJson: (b.objectsFilters ?? {}) as any,

        snapshotsEnabled:    b.snapshotsEnabled ?? true,
        snapshotBoundingBox: b.snapshotBoundingBox ?? true,
        snapshotQuality:     b.snapshotQuality ?? 85,
        snapshotRetainDays:  b.snapshotRetainDays ?? 10,

        recordEnabled:             b.recordEnabled ?? true,
        recordMode:                (b.recordMode ?? 'MOTION') as any,
        recordRetainDays:          b.recordRetainDays ?? 7,
        recordAlertRetainDays:     b.recordAlertRetainDays ?? 30,
        recordDetectionRetainDays: b.recordDetectionRetainDays ?? 14,
        recordPreCaptureSec:       b.recordPreCaptureSec ?? 5,
        recordPostCaptureSec:      b.recordPostCaptureSec ?? 10,

        reviewAlertLabelsJson:     (b.reviewAlertLabels ?? ['person','car']) as any,
        reviewDetectionLabelsJson: (b.reviewDetectionLabels ?? []) as any,

        audioEnabled:     b.audioEnabled ?? false,
        audioListenJson:  (b.audioListen ?? []) as any,
        audioMinVolume:   b.audioMinVolume ?? 500,

        semanticSearchEnabled: b.semanticSearchEnabled ?? false,
        semanticModelSize:     b.semanticModelSize ?? 'small',

        faceRecognitionEnabled: b.faceRecognitionEnabled ?? false,
        faceMinScore:           b.faceMinScore ?? 0.8,

        lprEnabled:     b.lprEnabled ?? false,
        lprFormatRegex: b.lprFormatRegex ?? '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$',

        genaiEnabled:      b.genaiEnabled ?? false,
        genaiProvider:     b.genaiProvider ?? 'gemini',
        genaiModel:        b.genaiModel ?? 'gemini-1.5-flash',
        genaiPromptGlobal: b.genaiPromptGlobal ?? null,

        onvifHost:     b.onvifHost ?? null,
        onvifPort:     b.onvifPort ?? 8000,
        onvifUsername: b.onvifUsername ?? null,
        // Senha ONVIF cifrada antes de persistir.
        onvifPasswordEnc: b.onvifPassword ? encryptSecret(b.onvifPassword) : null,
        ptzEnabled:    b.ptzEnabled ?? false,
        ptzAutotrackEnabled: b.ptzAutotrackEnabled ?? false,

        birdseyeEnabled: b.birdseyeEnabled ?? false,
        birdseyeMode:    b.birdseyeMode ?? 'objects',

        enabledModels: b.enabledModels?.length
          ? { create: b.enabledModels.map(m => ({ model: m as any, enabled: true })) }
          : undefined,
        zones: b.zones?.length
          ? { create: b.zones.map(z => ({
              name:             z.name,
              type:             z.type as any,
              color:            z.color ?? '#06b6d4',
              coordinates:      z.coordinates as any,
              direction:        z.direction ?? null,
              inertia:          z.inertia ?? 3,
              loiteringTimeSec: z.loiteringTimeSec ?? 0,
              objectsJson:      (z.objects ?? []) as any,
              filtersJson:      (z.filters ?? {}) as any,
              distancesJson:    (z.distances ?? []) as any,
              requiredForAlert: z.requiredForAlert ?? false,
              maxOccupancy:     z.maxOccupancy ?? null,
              alertOnViolation: z.alertOnViolation ?? false,
            }))}
          : undefined,
        subscription: {
          create: {
            tier:           b.tier,
            monthlyApiLimit: b.tier === 'STATIC_VISION' ? 10000 : null,
            monthlyStreamHoursLimit: b.tier === 'STREAMING_ANALYTICS' ? 720 : null,
            // Se o caller não informar priceMonthlyBrl, pricing table resolve.
            // Lança ValidationError se tier técnico sem preço (pay-as-you-go).
            priceMonthlyBrl: resolveCameraPrice(b.tier, b.priceMonthlyBrl),
            startDate:       new Date(),
            renewDate:       new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        },
      },
      include: { zones: true, enabledModels: true, subscription: true },
    })
    } catch (err: any) {
      // P2002 = unique constraint violada. Acontece em race condition real
      // (2 POSTs simultâneos passando pelo pre-check) — convertemos para 422
      // amigável em vez de 500 + stack trace genérico do Prisma.
      if (err?.code === 'P2002' && Array.isArray(err?.meta?.target) && err.meta.target.includes('name')) {
        throw new ValidationError(
          `Já existe uma câmera com o nome "${b.name}" neste site. Escolha outro nome.`,
        )
      }
      throw err
    }

    await cameraLogService.logCamera({
      cameraId: camera.id, level: 'INFO', source: 'SYSTEM',
      message: `Câmera "${camera.name}" criada`,
      details: { pipeline: camera.pipeline, tier: camera.tier },
    })

    // Pipeline 2: provisionar Vertex AI Vision de forma assíncrona
    if (b.pipeline === 'VERTEX_STREAMING' && integradorId) {
      const models = (b.enabledModels ?? []).filter(
        m => m === 'OCCUPANCY_ANALYTICS' || m === 'PPE_DETECTION',
      ) as ('OCCUPANCY_ANALYTICS' | 'PPE_DETECTION')[]

      vertexService
        .provisionCamera(camera.id, integradorId, models.length ? models : ['OCCUPANCY_ANALYTICS'])
        .then(result =>
          prisma.camera.update({
            where: { id: camera.id },
            data: {
              vertexStreamId: result.streamId,
              vertexAppId:    result.appId,
              bqDatasetId:    result.bqDatasetId,
              bqTableId:      result.bqTableId,
              status:         'ACTIVE',
            },
          }),
        )
        .catch((err: any) => {
          logger.error({ err, cameraId: camera.id }, 'vertex_provision_failed')
          cameraLogService.logCamera({
            cameraId: camera.id, level: 'ERROR', source: 'VERTEX',
            message: `Provisionamento Vertex falhou: ${err.message}`,
            errorCode: 'VERTEX_PROVISION_FAIL',
          })
        })
    } else {
      await prisma.camera.update({ where: { id: camera.id }, data: { status: 'ACTIVE' } })
    }

    // Para PUSH modes (RTMP/SRT), registra stream no go2rtc e inclui URL de
    // ingestão na resposta — operador copia e cola no encoder/Larix.
    const response: Record<string, unknown> = { ...camera }
    if ((ingestMode === 'RTMP_PUSH' || ingestMode === 'SRT_PUSH') && rtmpIngestKeyEnc) {
      const streamKey = decryptSecret(rtmpIngestKeyEnc)
      if (!streamKey) throw new ValidationError('Chave de ingestão inválida')
      response.rtmpStreamKey = streamKey  // mesma key serve pra ambos protocolos
      if (ingestMode === 'RTMP_PUSH') {
        response.rtmpIngestUrl = buildRtmpUrl(streamKey)
        response.ingestProtocol = 'rtmp'
      } else {
        response.srtIngestUrl  = buildSrtUrl(streamKey)
        response.ingestProtocol = 'srt'
      }

      // Registra stream no go2rtc — fluxo idêntico (mesmo nome no registry,
      // protocolo é decidido pela porta onde o cliente push'a).
      go2rtcService.registerStream(streamKey).catch(err => {
        logger.warn({ err, streamKey, cameraId: camera.id }, 'go2rtc_register_failed_will_retry')
      })

      // go2rtcStreamId = streamKey — ingest.service e cloud-direct-recorder usam.
      prisma.camera.update({
        where: { id: camera.id },
        data: { go2rtcStreamId: streamKey },
      }).catch(err => logger.warn({ err }, 'camera_go2rtc_stream_id_update_failed'))

      // Persiste no YAML (Docker Config) — eventual consistency via cron host.
      scheduleGo2rtcConfigSync()

      // Registra path no mediamtx com alwaysAvailable=true → viewer vê
      // "Câmera Offline" em vez de erro quando câmera EDGE_BOX está offline.
      if (b.edgeNodeId && streamKey) {
        import('../services/mediamtx-paths.service').then(({ registerCameraPath }) => {
          registerCameraPath(b.edgeNodeId!, streamKey).catch(() => {})
        }).catch(() => {})
      }
    }

    res.status(201).json(response)
}))

// =============================================================================
// GET /cameras — listar
// =============================================================================

cameraRouter.get('/', asyncHandler(async (req, res) => {
    const { clienteFinalId, integradorId, role } = req.jwtPayload!
    const { siteId, pipeline, tier, status, q } = req.query

    const where: any = {
      active: true,   // exclui câmeras soft-deletadas (active=false)
      ...(siteId   ? { siteId:   siteId as string } : {}),
      ...(pipeline ? { pipeline: pipeline as any }  : {}),
      ...(tier     ? { tier:     tier as any }      : {}),
      ...(status   ? { status:   status as any }    : {}),
      ...(q        ? { OR: [
        { name:     { contains: q as string, mode: 'insensitive' } },
        { location: { contains: q as string, mode: 'insensitive' } },
        { brand:    { contains: q as string, mode: 'insensitive' } },
      ]} : {}),
    }

    if (role !== 'SUPER_ADMIN') {
      where.site = clienteFinalId
        ? { clienteFinalId }
        : integradorId
        ? { clienteFinal: { integradorId } }
        : { id: '__none__' }
    }

    const cameras = await prisma.camera.findMany({
      where,
      include: {
        zones:         { where: { active: true } },
        enabledModels: { where: { enabled: true } },
        subscription:  true,
        edgeNode:      { select: { id: true, name: true, status: true, serialNumber: true } },
        site:          { select: {
          id: true, name: true, clienteFinalId: true,
          latitude: true, longitude: true, address: true,
          city: true, state: true,
        } },
        _count:        { select: { logs: true, analyticsEvents: true, reviewItems: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Agregados rápidos
    const stats = {
      total:      cameras.length,
      online:     cameras.filter(c => c.status === 'ACTIVE').length,
      offline:    cameras.filter(c => c.status === 'INACTIVE').length,
      error:      cameras.filter(c => c.status === 'ERROR').length,
      pending:    cameras.filter(c => c.status === 'PENDING_CONFIG').length,
      maintenance: cameras.filter(c => c.status === 'MAINTENANCE').length,
    }

    res.json({ cameras, stats, total: cameras.length })
}))

// =============================================================================
// GET /cameras/:id — detalhe completo (escopo de tenant aplicado)
// =============================================================================

cameraRouter.get('/:id', asyncHandler(async (req, res) => {
    const camera = await requireCameraForUser(req.params.id, req.jwtPayload, {
      include: {
        zones: true, enabledModels: true,
        subscription: true, edgeNode: true, site: true,
        alertRules: true,
        _count: {
          select: {
            logs: true, analyticsEvents: true, reviewItems: true,
            faceEvents: true, plateEvents: true, audioEvents: true,
          },
        },
      },
    })

    // Últimos 5 testes
    const recentTests = await prisma.cameraStreamTest.findMany({
      where: { cameraId: camera.id },
      orderBy: { testedAt: 'desc' },
      take: 5,
    })

    // Sanitização — não vazar campos cifrados/sensíveis. Substituímos por
    // booleans virtuais que o UI usa pra mostrar "configurado / vazio".
    // (rtspPasswordEnc / onvifPasswordEnc seguem o mesmo padrão se forem
    // expostos no futuro — hoje já não saem do select default.)
    const { rtmpPushUrlEnc, rtmpIngestKeyEnc, ...safe } = camera as Record<string, unknown> & {
      rtmpPushUrlEnc: string | null
      rtmpIngestKeyEnc: string | null
    }

    res.json({
      ...safe,
      rtmpPushConfigured: !!rtmpPushUrlEnc,
      // Boolean virtual — UI sabe que existe key sem ver o valor.
      // Pra revelar, o operador chama GET /cameras/:id/rtmp-ingest-key.
      rtmpIngestKeyConfigured: !!rtmpIngestKeyEnc,
      recentTests,
    })
}))

// =============================================================================
// PATCH /cameras/:id — atualizar (whitelist + escopo de tenant)
// =============================================================================

// Whitelist explícita de campos editáveis via PATCH. Evita mass-assignment:
// - `clienteFinalId`, `integradorId`, `priceMonthlyBrl`, `tier`, `pipeline`
//   só podem mudar via fluxo administrativo dedicado.
// - `status`, `id`, `createdAt` nunca são editáveis pelo cliente.
const UpdateCameraSchema = z.object({
  name:         z.string().min(1).max(120).optional(),
  description:  z.string().max(500).optional().nullable(),
  location:     z.string().max(120).optional().nullable(),
  zipCode:      z.string().max(10).optional().nullable(),
  city:         z.string().max(80).optional().nullable(),
  state:        z.string().max(40).optional().nullable(),
  latitude:     z.number().min(-90).max(90).optional().nullable(),
  longitude:    z.number().min(-180).max(180).optional().nullable(),

  // edgeNodeId pode mudar quando operador realoca a câmera para outro
  // edge node (manutenção, hardware novo, ou desassociar com `null` para
  // só usar snapshot via ffmpeg local). Backend valida ownership do edge
  // antes de aceitar (no handler).
  edgeNodeId:   z.string().min(1).optional().nullable(),

  // siteId — atribui a câmera a outro site (DnD do MapsHubPage). Reseta
  // edgeNodeId pra null pois edge anterior pode não existir no novo site.
  // Tenant cross-cliente é bloqueado no handler (mesmo clienteFinal).
  siteId:       z.string().min(1).optional(),

  rtspMainUrl:  z.string().min(1).max(500).optional(),
  rtspSubUrl:   z.string().max(500).optional().nullable(),
  rtspUsername: z.string().max(100).optional().nullable(),
  rtspPassword: z.string().max(200).optional().nullable(),

  brand:        z.string().max(80).optional().nullable(),
  model:        z.string().max(80).optional().nullable(),
  firmwareVersion: z.string().max(40).optional().nullable(),
  resolution:   z.string().max(20).optional().nullable(),
  fps:          z.number().int().min(1).max(60).optional().nullable(),
  codec:        z.string().max(20).optional().nullable(),

  hwAccel:          z.enum(['NONE','VAAPI','NVIDIA_NVDEC','INTEL_QSV_H264','INTEL_QSV_H265',
                            'RPI_V4L2_H264','RPI_V4L2_H265','ROCKCHIP_RKMPP','AMD_ROCM']).optional(),
  ffmpegInputArgs:  z.string().max(1000).optional().nullable(),
  ffmpegOutputArgs: z.string().max(1000).optional().nullable(),
  ffmpegGlobalArgs: z.string().max(1000).optional().nullable(),

  detectorType:      z.enum(['CPU','CORAL_USB','CORAL_PCI','OPENVINO_CPU','OPENVINO_GPU',
                             'TENSORRT','ONNX','HAILO8','HAILO8L','RKNN','ROCM','VERTEX_AI']).optional(),
  detectorWidth:     z.number().int().min(160).max(3840).optional(),
  detectorHeight:    z.number().int().min(120).max(2160).optional(),
  detectorFps:       z.number().int().min(1).max(30).optional(),

  motionEnabled:         z.boolean().optional(),
  motionThreshold:       z.number().int().min(1).max(255).optional(),
  motionContourArea:     z.number().int().min(0).max(10000).optional(),
  motionImproveContrast: z.boolean().optional(),

  snapshotsEnabled:    z.boolean().optional(),
  snapshotBoundingBox: z.boolean().optional(),
  snapshotQuality:     z.number().int().min(1).max(100).optional(),
  // Limites superiores evitam que tenant estoure armazenamento.
  snapshotRetainDays:  z.number().int().min(1).max(365).optional(),
  // Sprint Q.3 — Clean copy (sem overlay).
  cleanSnapshotEnabled: z.boolean().optional(),
  // Sprint Q.5 — Cooldown anti-spam por câmera (segundos). null = herda do tenant.
  notificationCooldownSec: z.number().int().min(0).max(86400).nullable().optional(),
  // Sprint Q.6 — Stationary objects threshold (já existem no schema).
  detectStationaryInterval:  z.number().int().min(1).max(10000).nullable().optional(),
  detectStationaryThreshold: z.number().int().min(1).max(10000).nullable().optional(),

  recordEnabled:          z.boolean().optional(),
  recordMode:             z.enum(['ALL','MOTION','ACTIVE_OBJECTS','DISABLED']).optional(),
  recordRetainDays:       z.number().int().min(1).max(365).optional(),
  recordAlertRetainDays:  z.number().int().min(1).max(365).optional(),
  recordDetectionRetainDays: z.number().int().min(1).max(365).optional(),
  recordPreCaptureSec:    z.number().int().min(0).max(60).optional(),
  recordPostCaptureSec:   z.number().int().min(0).max(60).optional(),

  audioEnabled:     z.boolean().optional(),
  audioMinVolume:   z.number().int().min(0).max(10000).optional(),

  semanticSearchEnabled: z.boolean().optional(),
  semanticModelSize:     z.enum(['small','large']).optional(),

  faceRecognitionEnabled: z.boolean().optional(),
  faceMinScore:           z.number().min(0).max(1).optional(),

  lprEnabled:     z.boolean().optional(),
  lprFormatRegex: z.string().max(200).optional().nullable(),

  genaiEnabled:      z.boolean().optional(),
  genaiProvider:     z.string().max(40).optional(),
  genaiModel:        z.string().max(80).optional(),
  genaiPromptGlobal: z.string().max(2000).optional().nullable(),

  aiEnabled:        z.boolean().optional(),
  aiConfidenceMin:  z.number().min(0).max(1).optional(),

  onvifHost:     z.string().max(120).optional().nullable(),
  onvifPort:     z.number().int().min(1).max(65535).optional(),
  onvifUsername: z.string().max(100).optional().nullable(),
  onvifPassword: z.string().max(200).optional().nullable(),
  ptzEnabled:    z.boolean().optional(),
  ptzAutotrackEnabled: z.boolean().optional(),

  birdseyeEnabled: z.boolean().optional(),
  birdseyeMode:    z.enum(['continuous','motion','objects']).optional(),

  // RTMP push out — broadcast da câmera pra YouTube/Twitch/Facebook/CDN.
  // URL completa (com stream key) é cifrada antes de persistir em
  // rtmpPushUrlEnc; aceitamos string vazia/null para limpar.
  // Exemplos: rtmp://a.rtmp.youtube.com/live2/<key>,
  //           rtmp://live.twitch.tv/app/<key>,
  //           rtmps://live-api-s.facebook.com:443/rtmp/<key>
  rtmpPushUrl:     z.string().max(500).optional().nullable(),
  rtmpPushEnabled: z.boolean().optional(),

  // Modo de ingestão — RTSP_PULL (default) ou RTMP_PUSH (camera empurra).
  // Quando muda pra RTMP_PUSH sem key cadastrada, o handler gera uma
  // automaticamente — operador vê no UI e copia pra config da câmera.
  ingestMode:      z.enum(['RTSP_PULL', 'RTMP_PUSH']).optional(),

  // Mudança de pipeline — operação cara (cria/destrói recursos no GCP).
  // Apenas INTEGRADOR_ADMIN+ pode alterar; o handler dispara teardown do
  // pipeline antigo e provisionamento do novo (assíncrono).
  pipeline:        z.enum(['EDGE_HYBRID', 'VERTEX_STREAMING', 'EDGE_YOLO']).optional(),
}).strict()

cameraRouter.patch('/:id', asyncHandler(async (req, res) => {
  // 1. Isolamento: só busca se for do tenant do usuário. Selecionamos campos
  //    Vertex pra detectar transição de pipeline — sem isso, mudar de
  //    EDGE_HYBRID → VERTEX_STREAMING no UI deixava o registro inconsistente
  //    (pipeline novo no banco, mas sem stream/app provisionado no GCP).
  const existing = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: {
      id: true, pipeline: true, name: true,
      siteId: true,
      vertexStreamId: true, vertexAppId: true,
      site: { select: { clienteFinal: { select: { integradorId: true } } } },
    },
  })

  // 2. Whitelist: rejeita campos não permitidos. `.strict()` acima faz isso.
  const parse = UpdateCameraSchema.safeParse(req.body)
  if (!parse.success) {
    throw new ValidationError(parse.error.errors[0]?.message ?? 'Dados inválidos')
  }
  const patch = parse.data

  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Nenhum campo para atualizar')
  }

  // 2b. Mudança de pipeline — operação sensível. Apenas SUPER_ADMIN /
  //     INTEGRADOR_ADMIN podem alterar (operador/viewer não muda arquitetura).
  //     Cliente final pode? Não: a mudança envolve custo GCP que é do
  //     integrador, então a decisão é dele.
  const pipelineChanging = !!patch.pipeline && patch.pipeline !== existing.pipeline
  if (pipelineChanging) {
    const role = req.jwtPayload?.role
    if (role !== 'SUPER_ADMIN' && role !== 'INTEGRADOR_ADMIN') {
      throw new ValidationError('Apenas SUPER_ADMIN ou INTEGRADOR_ADMIN podem alterar o pipeline')
    }
  }

  // 3a. Validar siteId quando presente — defesa anti-IDOR (integrador não
  //     pode mover câmera pra site de outro tenant). Cliente final só pode
  //     reatribuir entre sites do MESMO ClienteFinal.
  //     Quando muda siteId, força edgeNodeId=null pois edge antigo
  //     necessariamente é de outro site (regra de negócio existente).
  let siteIdChanged = false
  if ('siteId' in patch && patch.siteId && patch.siteId !== existing.siteId) {
    const jwt = req.jwtPayload!
    const newSite = await prisma.site.findFirst({
      where: {
        id: patch.siteId,
        ...(jwt.role === 'SUPER_ADMIN'
          ? {}
          : jwt.clienteFinalId
            ? { clienteFinalId: jwt.clienteFinalId }
            : jwt.integradorId
              ? { clienteFinal: { integradorId: jwt.integradorId } }
              : { id: '__no_access__' }),
      },
      select: { id: true, clienteFinalId: true },
    })
    if (!newSite) throw new NotFoundError('Site')

    // Cross-cliente é proibido mesmo pra integrador (LGPD: dados de uma
    // câmera não podem migrar entre clientes finais sem cadeia de custódia).
    const currentSite = await prisma.site.findUnique({
      where:  { id: existing.siteId },
      select: { clienteFinalId: true },
    })
    if (currentSite && currentSite.clienteFinalId !== newSite.clienteFinalId) {
      throw new ValidationError('Câmera não pode ser movida entre clientes finais distintos')
    }

    siteIdChanged = true
    // Quando troca de site, descarta edge atual a menos que o caller
    // explicitamente passe um novo edgeNodeId pertencente ao novo site
    // (validado na seção 3b).
    if (!('edgeNodeId' in patch)) {
      (patch as any).edgeNodeId = null
    }
  }

  // 3b. Validar edgeNodeId quando presente — defesa anti-IDOR (integrador não
  //    pode "roubar" edge de outro tenant). `null` é válido (desassocia).
  //    Adicionalmente: edge deve pertencer ao mesmo site da câmera — impede
  //    atribuições cross-site dentro do mesmo tenant (regra de negócio).
  if ('edgeNodeId' in patch && patch.edgeNodeId) {
    const jwt = req.jwtPayload!
    const edge = await prisma.edgeNode.findFirst({
      where: {
        id: patch.edgeNodeId,
        ...(jwt.role === 'SUPER_ADMIN'
          ? {}
          : jwt.clienteFinalId
            ? { site: { clienteFinalId: jwt.clienteFinalId } }
            : jwt.integradorId
              ? { site: { clienteFinal: { integradorId: jwt.integradorId } } }
              : { id: '__no_access__' }),
      },
      select: { id: true, status: true, siteId: true },
    })
    if (!edge) {
      // 404 propositalmente — não vaza existência cross-tenant.
      throw new NotFoundError('Edge node')
    }
    // Regra de negócio: câmera e edge devem pertencer ao mesmo site.
    // Se siteId está mudando neste mesmo PATCH, valida contra o NOVO site.
    const targetSiteId = (siteIdChanged ? (patch as any).siteId : existing.siteId) as string
    if (edge.siteId !== targetSiteId) {
      throw new ValidationError('Edge node não pertence ao mesmo site da câmera')
    }
  }

  // 4. Mapeamento para nomes reais do schema Prisma (campos Enc) +
  // criptografia AES-256-GCM em senhas antes de persistir.
  const data: Record<string, unknown> = { ...patch }
  if ('rtspPassword' in patch) {
    data.rtspPasswordEnc = patch.rtspPassword ? encryptSecret(patch.rtspPassword) : null
    delete data.rtspPassword
  }
  if ('onvifPassword' in patch) {
    data.onvifPasswordEnc = patch.onvifPassword ? encryptSecret(patch.onvifPassword) : null
    delete data.onvifPassword
  }
  // RTMP push: cifra URL completa (pode conter stream key sensível).
  // String vazia ou null limpa o campo. Validação básica de protocolo.
  if ('rtmpPushUrl' in patch) {
    const v = patch.rtmpPushUrl?.trim()
    if (v) {
      if (!/^rtmps?:\/\//i.test(v)) {
        throw new ValidationError('rtmpPushUrl deve começar com rtmp:// ou rtmps://')
      }
      data.rtmpPushUrlEnc = encryptSecret(v)
    } else {
      data.rtmpPushUrlEnc = null
    }
    delete data.rtmpPushUrl
  }
  // Defesa: não permitir habilitar push sem URL (mesmo se URL antiga estiver
  // presente, é melhor evitar surpresa onde toggle "Habilitar" reativa stream
  // pra destino antigo). Frontend já garante isso, backend é defesa final.
  if (patch.rtmpPushEnabled === true && !('rtmpPushUrl' in patch)) {
    const cur = await prisma.camera.findUnique({
      where: { id: existing.id },
      select: { rtmpPushUrlEnc: true },
    })
    if (!cur?.rtmpPushUrlEnc) {
      throw new ValidationError('Não é possível habilitar RTMP push sem URL configurada')
    }
  }

  // Auto-gera stream key quando muda pra RTMP_PUSH e a câmera ainda
  // não tem uma. Operador vê a key no UI imediatamente (pode rotacionar
  // depois). Sem isso, o operador teria que clicar "regenerate" como
  // segundo passo — fricção desnecessária.
  if (patch.ingestMode === 'RTMP_PUSH') {
    const cur = await prisma.camera.findUnique({
      where: { id: existing.id },
      select: { rtmpIngestKeyEnc: true },
    })
    if (!cur?.rtmpIngestKeyEnc) {
      const { generateRtmpStreamKey } = await import('../lib/rtmp-key')
      data.rtmpIngestKeyEnc = encryptSecret(generateRtmpStreamKey())
    }
  }

  // Se mudou pipeline saindo de VERTEX_STREAMING, limpa os IDs Vertex
  // ANTES do update — o teardown roda em background com os IDs salvos
  // em variável local. Sem isso, ficaríamos com referências órfãs no banco.
  if (pipelineChanging && existing.pipeline === 'VERTEX_STREAMING') {
    data.vertexStreamId = null
    data.vertexAppId    = null
    data.bqDatasetId    = null
    data.bqTableId      = null
  }

  const camera = await prisma.camera.update({
    where: { id: existing.id },
    data,
  })

  // Invalida o cache do stream embarcado se algum campo que afeta o
  // pipeline go2rtc mudou (RTSP url/senha, RTMP push, edge node).
  // O próximo ticket WHEP/MJPEG vai recriar o stream com a config nova
  // (DELETE+PUT no go2rtc dentro de ensureEmbeddedStream).
  const affectsStream = (
    'rtspMainUrl' in patch || 'rtspUsername' in patch || 'rtspPassword' in patch ||
    'rtmpPushUrl' in patch || 'rtmpPushEnabled' in patch ||
    'edgeNodeId' in patch || pipelineChanging
  )
  if (affectsStream) {
    const streamId = camera.go2rtcStreamId ?? `cam-${camera.id}`
    liveService.invalidateEmbeddedStream(streamId)
  }

  // ── Mudança de pipeline: dispatch teardown/provision em background ──────
  // Importante: a resposta HTTP já saiu antes desses awaits longos. Logamos
  // resultado em cameraLog pra ops poder auditar (ex.: stream Vertex órfão
  // que falhou de apagar). Idempotente — se uma das etapas falhar, próxima
  // chamada de PATCH resolve.
  if (pipelineChanging) {
    const oldPipeline = existing.pipeline
    const newPipeline = patch.pipeline!
    const integradorId = (existing as any).site?.clienteFinal?.integradorId

    // Sai de VERTEX → derruba stream/app/BQ no GCP
    if (oldPipeline === 'VERTEX_STREAMING' && (existing.vertexStreamId || existing.vertexAppId)) {
      ;(vertexService as any)
        .teardownCamera({
          vertexAppId:    existing.vertexAppId,
          vertexStreamId: existing.vertexStreamId,
        })
        .then((result: any) => {
          cameraLogService.logCamera({
            cameraId: camera.id, level: result.ok ? 'INFO' : 'WARN', source: 'VERTEX',
            message: result.ok
              ? `Pipeline mudou para ${newPipeline} — Vertex teardown OK`
              : `Pipeline mudou para ${newPipeline} — Vertex teardown com erros: ${result.errors.join('; ')}`,
            details: { from: oldPipeline, to: newPipeline, errors: result.errors },
          })
        })
        .catch((err: any) => {
          logger.error({ err, cameraId: camera.id }, 'pipeline_change_teardown_failed')
        })
    }

    // Entra em VERTEX → provisiona novo stream/app/BQ
    if (newPipeline === 'VERTEX_STREAMING' && integradorId) {
      const enabledModels = await prisma.cameraModel.findMany({
        where: { cameraId: camera.id, enabled: true },
        select: { model: true },
      })
      const models = enabledModels
        .map(m => m.model)
        .filter(m => m === 'OCCUPANCY_ANALYTICS' || m === 'PPE_DETECTION') as
        ('OCCUPANCY_ANALYTICS' | 'PPE_DETECTION')[]

      vertexService
        .provisionCamera(camera.id, integradorId, models.length ? models : ['OCCUPANCY_ANALYTICS'])
        .then(result =>
          prisma.camera.update({
            where: { id: camera.id },
            data: {
              vertexStreamId: result.streamId,
              vertexAppId:    result.appId,
              bqDatasetId:    result.bqDatasetId,
              bqTableId:      result.bqTableId,
            },
          }).then(() =>
            cameraLogService.logCamera({
              cameraId: camera.id, level: 'INFO', source: 'VERTEX',
              message: `Pipeline mudou para VERTEX_STREAMING — recursos GCP provisionados`,
              details: { streamId: result.streamId, appId: result.appId },
            }),
          ),
        )
        .catch(err => {
          logger.error({ err, cameraId: camera.id }, 'pipeline_change_provision_failed')
          cameraLogService.logCamera({
            cameraId: camera.id, level: 'ERROR', source: 'VERTEX',
            message: `Pipeline mudou para VERTEX_STREAMING — provision FALHOU: ${err.message}`,
            errorCode: 'VERTEX_PROVISION_FAIL',
          })
        })
    }
  }

  await cameraLogService.logCamera({
    cameraId: camera.id, level: 'INFO', source: 'SYSTEM',
    message: pipelineChanging
      ? `Configuração atualizada — pipeline ${existing.pipeline} → ${patch.pipeline} (${Object.keys(patch).length} campos)`
      : `Configuração atualizada (${Object.keys(patch).length} campos)`,
    details: { updatedFields: Object.keys(patch), pipelineChanged: pipelineChanging },
  })

  // Onda 12.3 — CAMERA_UPDATED com action específico se credenciais sensíveis
  // foram tocadas. Helpers redactam automaticamente rtspPassword/onvifPassword
  // do metadata; campos não-sensíveis vão como diff legível.
  const sensitiveFieldsTouched =
    'rtspPassword' in patch || 'onvifPassword' in patch || 'rtmpPushUrl' in patch
  const action = sensitiveFieldsTouched
    ? 'CAMERA_CREDENTIALS_ROTATED'
    : pipelineChanging
      ? 'CAMERA_PIPELINE_CHANGED'
      : 'CAMERA_UPDATED'
  await auditAction(prisma, {
    action,
    resource:   'Camera',
    resourceId: camera.id,
    metadata: {
      cameraName:       camera.name,
      changedFields:    Object.keys(patch),
      sensitiveFieldsTouched,
      pipelineBefore:   existing.pipeline,
      pipelineAfter:    pipelineChanging ? patch.pipeline : existing.pipeline,
      // Campos não-sensíveis com novos valores (sanitizer redacta os sensíveis)
      patch,
    },
    req,
  })

  // Sanitiza resposta — nunca devolve campos cifrados (rtmpPushUrlEnc pode
  // conter stream key sensível de YouTube/Twitch; rtmpIngestKeyEnc tem a
  // credencial de PUSH de entrada; rtspPassword/onvifPassword são da câmera).
  // Substitui por booleans virtuais que o UI usa pra mostrar status.
  const { rtmpPushUrlEnc, rtmpIngestKeyEnc, rtspPasswordEnc: _rsp, onvifPasswordEnc: _osp, ...safe } =
    camera as Record<string, unknown> & {
      rtmpPushUrlEnc: string | null
      rtmpIngestKeyEnc: string | null
      rtspPasswordEnc: string | null
      onvifPasswordEnc: string | null
    }
  res.json({
    ...safe,
    rtmpPushConfigured: !!rtmpPushUrlEnc,
    rtmpIngestKeyConfigured: !!rtmpIngestKeyEnc,
  })
}))

// =============================================================================
// GET /cameras/:id/uptime-history?days=7 — uptime sparkline
// =============================================================================
//
// Retorna 1 bucket por hora nos últimos N dias (default 7), com:
//   - hasSegment: bool — houve ao menos 1 RecordingSegment iniciado nessa hora
//   - segmentsCount: número
//   - durationSec: soma das durações cobertas
//   - uptimePct: % da hora coberta por gravação
//
// Frontend desenha sparkline 7×24 = 168 pontos.
// Onda 1 / P2 #15.
cameraRouter.get('/:id/uptime-history', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: { id: true, name: true },
  })
  const days = Math.max(1, Math.min(30, Number(req.query.days ?? 7)))
  const since = new Date(Date.now() - days * 24 * 3600_000)

  // Agrega por hora UTC usando date_trunc. CTE com generate_series garante que
  // horas SEM gravação aparecem como 0 (não some do gráfico).
  const rows = await prisma.$queryRaw<{
    hour: Date
    segments: bigint
    total_sec: number
  }[]>`
    WITH hours AS (
      SELECT generate_series(
        date_trunc('hour', ${since}::timestamptz),
        date_trunc('hour', NOW()),
        '1 hour'::interval
      ) AS hour
    ),
    segs AS (
      SELECT
        date_trunc('hour', "startedAt") AS hour,
        COUNT(*) AS segments,
        SUM("durationSec") AS total_sec
      FROM "RecordingSegment"
      WHERE "cameraId" = ${cam.id} AND "startedAt" >= ${since}
      GROUP BY 1
    )
    SELECT
      h.hour,
      COALESCE(s.segments, 0)::bigint AS segments,
      COALESCE(s.total_sec, 0)::int   AS total_sec
    FROM hours h
    LEFT JOIN segs s ON s.hour = h.hour
    ORDER BY h.hour ASC
  `

  const buckets = rows.map(r => {
    const segs = Number(r.segments)
    const sec  = Number(r.total_sec ?? 0)
    return {
      hour: r.hour,
      segments: segs,
      durationSec: sec,
      uptimePct: Math.min(100, Math.round((sec / 3600) * 100)),
    }
  })

  // Agregado total
  const totalSeconds = buckets.reduce((s, b) => s + b.durationSec, 0)
  const totalHours   = days * 24
  const overallUptimePct = Math.round((totalSeconds / (totalHours * 3600)) * 100)

  res.json({
    cameraId: cam.id,
    cameraName: cam.name,
    days,
    buckets,
    overall: {
      totalSeconds,
      totalHours,
      uptimePct: overallUptimePct,
    },
  })
}))

// =============================================================================
// GET /cameras/:id/diagnostics — diagnóstico em tempo real
// =============================================================================
//
// Resposta:
//   - status:    'STREAMING' | 'OFFLINE' | 'RECOVERING' | 'NEVER_STREAMED'
//   - push:      { active, lastFrameAt, secondsSinceLastFrame, remoteAddr, bytesRecv }
//   - recording: { active, lastSegmentAt, lastUploadAt, gapsLast24h, segmentsLast24h }
//   - hint:      mensagem em PT-BR para o operador
//
// Permite o front mostrar "Câmera offline há X minutos" em vez de erros crus.
cameraRouter.get('/:id/diagnostics', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: {
      id: true, name: true, deploymentMode: true, ingestMode: true,
      go2rtcStreamId: true, rtmpIngestLastFrameAt: true,
      lastOnlineAt: true, lastSegmentStartedAt: true, status: true,
    },
  })

  const now = Date.now()
  const lastFrameMs = cam.rtmpIngestLastFrameAt?.getTime() ?? 0
  const secNoFrame = lastFrameMs ? Math.round((now - lastFrameMs) / 1000) : null

  // 1. Push status — consulta go2rtc para bytes/s
  let push: any = {
    active: false, lastFrameAt: cam.rtmpIngestLastFrameAt,
    secondsSinceLastFrame: secNoFrame,
    remoteAddr: null, bytesRecv: null, formatName: null,
  }
  if (cam.go2rtcStreamId) {
    try {
      const url = `${process.env.EMBEDDED_GO2RTC_URL ?? 'http://172.17.0.1:1984'}/api/streams?src=${encodeURIComponent(cam.go2rtcStreamId)}`
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (r.ok) {
        const info: any = await r.json()
        const rtmpProd = (info?.producers ?? []).find((p: any) =>
          p.format_name === 'rtmp' || p.protocol === 'rtmp',
        )
        if (rtmpProd) {
          push.active     = true
          push.remoteAddr = rtmpProd.remote_addr ?? null
          push.bytesRecv  = rtmpProd.bytes_recv ?? null
          push.formatName = rtmpProd.format_name ?? null
        }
      }
    } catch { /* go2rtc offline ou stream inexistente */ }
  }

  // 2. Recording status — últimas 24h
  // startedAt vem de Camera.lastSegmentStartedAt (cached) — evita scan no
  // RecordingSegment quando a câmera tem milhões de segments. findFirst aqui
  // só pra trazer uploadedAt + uploadStatus (Camera ainda não cacheia isso).
  const since24h = new Date(now - 24 * 3600_000)
  const lastSeg = await prisma.recordingSegment.findFirst({
    where: { cameraId: cam.id },
    orderBy: { startedAt: 'desc' },
    select: { uploadedAt: true, uploadStatus: true },
  })
  const segCount24h = await prisma.recordingSegment.count({
    where: { cameraId: cam.id, startedAt: { gt: since24h } },
  })

  // Gaps: contagem rápida — segmentos com gap >5s desde o anterior
  const gapsRaw = await prisma.$queryRaw<{ gaps: number }[]>`
    WITH ordered AS (
      SELECT "startedAt", LAG("endedAt") OVER (ORDER BY "startedAt") AS prev_end
      FROM "RecordingSegment"
      WHERE "cameraId" = ${cam.id} AND "startedAt" > ${since24h}
    )
    SELECT COUNT(*)::int AS gaps
    FROM ordered
    WHERE EXTRACT(EPOCH FROM ("startedAt" - prev_end)) > 5
  `
  const gapsLast24h = gapsRaw[0]?.gaps ?? 0

  const lastSegMs = cam.lastSegmentStartedAt?.getTime() ?? 0
  const secondsSinceLastSeg = lastSegMs ? Math.round((now - lastSegMs) / 1000) : null
  const recording = {
    active:               push.active && lastSeg?.uploadStatus !== 'FAILED',
    lastSegmentAt:        cam.lastSegmentStartedAt,
    secondsSinceLastSeg,  // diagnostica push ativo mas sem segmentação real
    lastUploadAt:         lastSeg?.uploadedAt ?? null,
    segmentsLast24h:      segCount24h,
    gapsLast24h,
  }

  // 3. Status agregado + hint UX
  let status: 'STREAMING' | 'OFFLINE' | 'RECOVERING' | 'NEVER_STREAMED'
  let hint: string
  if (push.active) {
    status = 'STREAMING'
    hint   = `Câmera enviando vídeo. ${recording.segmentsLast24h} segmentos gravados nas últimas 24h.`
  } else if (!cam.rtmpIngestLastFrameAt) {
    status = 'NEVER_STREAMED'
    hint   = 'Câmera nunca enviou vídeo. Verifique se foi configurada corretamente com a URL de push RTMP.'
  } else if (secNoFrame !== null && secNoFrame < 60) {
    status = 'RECOVERING'
    hint   = `Push interrompido há ${secNoFrame}s. Aguardando reconexão automática.`
  } else {
    status = 'OFFLINE'
    const mins = Math.round((secNoFrame ?? 0) / 60)
    hint   = `Câmera offline há ${mins} minuto${mins === 1 ? '' : 's'}. Verifique se a câmera está ligada, com internet e configurada para push RTMP.`
  }

  res.json({
    cameraId: cam.id,
    cameraName: cam.name,
    status,
    hint,
    push,
    recording,
    serverTime: new Date(),
  })
}))

// =============================================================================
// DELETE /cameras/:id/recordings — limpa gravações desta câmera
// =============================================================================
//
// Apaga todos os RecordingSegment + SpriteSheet desta câmera e os objetos
// correspondentes no R2. A câmera continua ativa e seguirá gravando novas
// gravações imediatamente (não para o ffmpeg).
//
// Quem pode chamar: qualquer usuário com acesso à câmera (mesmo escopo de
// PATCH /cameras/:id). Cliente final que vê a câmera pode resetar.
//
// Audita: AuditLog action='CAMERA_RECORDINGS_RESET' com counts deletados.
cameraRouter.delete('/:id/recordings', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: {
      id: true, name: true, siteId: true,
      site: { select: { clienteFinal: { select: { integradorId: true } } } },
    },
  })

  const integradorId = (cam as any).site?.clienteFinal?.integradorId
  if (!integradorId) {
    throw new Error('Câmera sem integrador resolvível — abortando reset')
  }

  // ── 1. Lista storagePaths dos segmentos pra deletar do R2 ─────────────────
  const segments = await prisma.recordingSegment.findMany({
    where:  { cameraId: cam.id },
    select: { storagePath: true },
  })
  const storagePaths = segments.map(s => s.storagePath).filter(Boolean) as string[]

  // ── 2. Deleta do R2 em batch (até 1000 por request) ───────────────────────
  const { r2Storage } = await import('../services/r2-storage.service')
  let r2Deleted = 0
  if (r2Storage.isEnabled() && storagePaths.length > 0) {
    r2Deleted = await r2Storage.deleteMany(integradorId, storagePaths).catch(() => 0)
  }

  // ── 3. Deleta SpriteSheets do R2 + DB ─────────────────────────────────────
  const sprites = await prisma.spriteSheet.findMany({
    where:  { cameraId: cam.id },
    select: { storagePath: true },
  }).catch(() => [] as { storagePath: string | null }[])
  const spritePaths = sprites.map(s => s.storagePath).filter(Boolean) as string[]
  if (r2Storage.isEnabled() && spritePaths.length > 0) {
    await r2Storage.deleteMany(integradorId, spritePaths).catch(() => 0)
  }
  const spriteDel = await prisma.spriteSheet.deleteMany({ where: { cameraId: cam.id } }).catch(() => ({ count: 0 }))

  // ── 4. Deleta arquivos locais no tmpfs (cloud-direct dir) ─────────────────
  try {
    const { execSync } = await import('child_process')
    execSync(`rm -rf /recordings/cloud-direct/${cam.id} 2>/dev/null || true`, { timeout: 5000 })
  } catch { /* ignore */ }

  // ── 5. Deleta RecordingSegment do banco ───────────────────────────────────
  const segDel = await prisma.recordingSegment.deleteMany({ where: { cameraId: cam.id } })

  // ── 6. AuditLog ───────────────────────────────────────────────────────────
  await auditAction(prisma, {
    action:     'CAMERA_RECORDINGS_RESET',
    resource:   'Camera',
    resourceId: cam.id,
    metadata: {
      cameraName: cam.name,
      recordingSegmentsDeleted: segDel.count,
      spriteSheetsDeleted: spriteDel.count,
      r2ObjectsDeleted: r2Deleted,
    },
    req,
  }).catch(() => { /* não fatal */ })

  res.json({
    ok: true,
    cameraId: cam.id,
    cameraName: cam.name,
    deleted: {
      recordingSegments: segDel.count,
      spriteSheets:      spriteDel.count,
      r2Objects:         r2Deleted,
    },
  })
}))

// =============================================================================
// DELETE /cameras/:id — soft delete
// =============================================================================

cameraRouter.delete('/:id', asyncHandler(async (req, res) => {
  // Precisamos dos campos Vertex pra fazer teardown e impedir cobrança
  // continuada no GCP após o usuário "remover" a câmera. Sem isso, a app
  // marcava active=false mas Stream/Application Vertex permaneciam ativos
  // e custos seguiam contando até a expiração da quota mensal.
  // Onda 12.3 — também buscamos campos para snapshot forense (LGPD).
  const existing = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: {
      id: true, pipeline: true,
      vertexStreamId: true, vertexAppId: true,
      // Campos para snapshot completo no AuditLog (forense pós-deleção)
      name: true, location: true, brand: true, resolution: true, fps: true,
      tier: true, status: true, siteId: true, edgeNodeId: true,
      rtspMainUrl: true, rtspSubUrl: true, // sanitizer redact url com password
      createdAt: true,
    },
  })

  // Teardown Vertex (fire-and-log). Só relevante para VERTEX_STREAMING e
  // só quando há resource Vertex de fato gravado — câmera órfã (provision
  // falhou) não tem nada pra deletar.
  let vertexTeardown: { ok: boolean; errors: string[] } | undefined
  if (
    existing.pipeline === 'VERTEX_STREAMING' &&
    (existing.vertexStreamId || existing.vertexAppId)
  ) {
    try {
      vertexTeardown = await (vertexService as any).teardownCamera({
        vertexStreamId: existing.vertexStreamId,
        vertexAppId:    existing.vertexAppId,
      })
    } catch (err: any) {
      vertexTeardown = { ok: false, errors: [err?.message ?? String(err)] }
    }
  }

  // Hard delete — remove o registro definitivamente do banco.
  // Limpando dependentes manualmente (Prisma não tem onDelete:Cascade em todos).
  // ATENÇÃO: nomes dos models devem bater com schema.prisma (PascalCase exato).
  await prisma.$transaction([
    prisma.cameraModel.deleteMany({ where: { cameraId: existing.id } }),       // model CameraModel
    prisma.cameraAlertRule.deleteMany({ where: { cameraId: existing.id } }),   // model CameraAlertRule
    prisma.reviewItem.deleteMany({ where: { cameraId: existing.id } }),        // model ReviewItem
    prisma.cameraSubscription.deleteMany({ where: { cameraId: existing.id } }), // model CameraSubscription
    prisma.cameraLog.deleteMany({ where: { cameraId: existing.id } }),         // model CameraLog
    prisma.cameraStreamTest.deleteMany({ where: { cameraId: existing.id } }), // model CameraStreamTest
    prisma.cameraZone.deleteMany({ where: { cameraId: existing.id } }),        // model CameraZone
    prisma.analyticsEvent.deleteMany({ where: { cameraId: existing.id } }),   // model AnalyticsEvent
    prisma.faceRecognitionEvent.deleteMany({ where: { cameraId: existing.id } }), // model FaceRecognitionEvent
    prisma.licensePlateEvent.deleteMany({ where: { cameraId: existing.id } }), // model LicensePlateEvent
    prisma.audioDetectionEvent.deleteMany({ where: { cameraId: existing.id } }), // model AudioDetectionEvent
    prisma.camera.delete({ where: { id: existing.id } }),
  ])

  // Onda 12.3 — CAMERA_DELETED com snapshot completo (forense pós-deleção).
  // RTSP/ONVIF passwords são automaticamente redacted pelo sanitizer.
  await auditDelete(prisma, {
    action:     'CAMERA_DELETED',
    resource:   'Camera',
    resourceId: existing.id,
    snapshot:   existing,
    metadata:   { vertexTeardown: vertexTeardown ?? null },
    req,
  })

  // Remove stream do go2rtc YAML se era RTMP_PUSH
  if (existing.ingestMode === 'RTMP_PUSH') scheduleGo2rtcConfigSync()

  res.json({ ok: true, vertexTeardown })
}))

// =============================================================================
// POST /cameras/:id/test — testar RTSP
// =============================================================================

cameraRouter.post('/:id/test', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload)
  const url = (req.body?.rtspUrl as string) ?? cam.rtspMainUrl
  const result = await rtspTestService.testCamera(cam.id, url)
  res.json(result)
}))

// =============================================================================
// POST /cameras/probe — sondar URL pré-criação (Gap 3)
// =============================================================================
//
// Versão "stateless" do teste de RTSP/RTMP — útil ANTES de a câmera existir
// no banco (AddCameraWizard chama no botão "Testar Conexão").
//
// Não persiste em CameraStreamTest (sem cameraId pra associar) — apenas
// retorna o resultado do ffprobe. Em DEV é mock; em PROD chama ffprobe real
// com SSRF guard.
//
// Limites:
//   - Body: { url: string, timeoutMs?: number }
//   - Aceita rtsp/rtsps/rtmp/rtmps/http/https; bloqueia loopback em prod.
//   - Não exige role específica — qualquer usuário autenticado pode probar.
//     (Justificativa: integradores precisam testar URLs durante o cadastro;
//     guard SSRF + timeout curto cobrem o risco.)
//
const ProbeSchema = z.object({
  url:       z.string().min(8).max(500),
  timeoutMs: z.number().int().min(1000).max(30_000).optional(),
})

// Rate-limit DEDICADO ao probe — defesa contra abuso de scanner.
// Probe é caro (spawn ffprobe + tcp connect) e expõe alvo arbitrário, então
// fica MUITO mais apertado que o limite global por tenant. Chave preferencial:
// integradorId (tenant). Sem JWT cai por IP.
const probeRateLimit = rateLimit({
  windowMs:        Number(process.env.PROBE_RATE_WINDOW_MS ?? 60_000),
  max:             Number(process.env.PROBE_RATE_MAX     ?? 10),
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => {
    const jwt = req.jwtPayload
    if (jwt?.integradorId)   return `probe:tenant:${jwt.integradorId}`
    if (jwt?.clienteFinalId) return `probe:cf:${jwt.clienteFinalId}`
    if (jwt?.sub)            return `probe:user:${jwt.sub}`
    return `probe:ip:${req.ip ?? 'unknown'}`
  },
  message: { error: 'PROBE_RATE_LIMITED', message: 'Muitas sondagens — tente novamente em 1 minuto.' },
})

cameraRouter.post('/probe', probeRateLimit, asyncHandler(async (req, res) => {
  const parse = ProbeSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(422).json({ error: 'INVALID_BODY', message: parse.error.errors[0].message })
    return
  }
  const result = await (rtspTestService as any).probe(parse.data.url)
  res.json(result)
}))

// =============================================================================
// GET /cameras/:id/stream-tests — histórico
// =============================================================================

cameraRouter.get('/:id/stream-tests', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })
  const tests = await prisma.cameraStreamTest.findMany({
    where: { cameraId: cam.id },
    orderBy: { testedAt: 'desc' },
    take: 50,
  })
  res.json(tests)
}))

// =============================================================================
// GET /cameras/:id/logs — logs da câmera
// =============================================================================

cameraRouter.get('/:id/logs', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })
  const { level, source, from, to, limit } = req.query
  const logs = await prisma.cameraLog.findMany({
    where: {
      cameraId: cam.id,
      ...(level  ? { level:  level as any }  : {}),
      ...(source ? { source: source as any } : {}),
      ...(from || to
        ? { recordedAt: {
            ...(from ? { gte: new Date(from as string) } : {}),
            ...(to   ? { lte: new Date(to as string) }   : {}),
          } }
        : {}),
    },
    orderBy: { recordedAt: 'desc' },
    take: Math.min(Number(limit ?? 200), 1000),
  })
  res.json(logs)
}))

// =============================================================================
// POST /cameras/:id/snapshot — gerar snapshot agora
// =============================================================================

cameraRouter.post('/:id/snapshot', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload)

  // Emite ticket de snapshot (60s, single-frame).
  // O frontend usa esta URL como `<img src=...>`; ao expirar, basta
  // refazer POST /cameras/:id/snapshot para obter ticket novo.
  // O backend NÃO captura o JPEG aqui — quem fizer GET na URL aciona
  // o ffmpeg. Isso evita capturar inutilmente quando UI nunca carrega
  // a imagem (ex: usuário fechou o modal).
  const access = await liveService.issueTicket(req.jwtPayload!, cam.id, 'snapshot')

  const snapshotUrl = `/live/${cam.id}/snapshot-jpeg?ticket=${encodeURIComponent(access.ticket)}`
  const snapshotAt = new Date()

  // Persiste o timestamp; lastSnapshotUrl fica null porque a URL contém
  // ticket curto e não pode ser cached. Se quisermos thumb persistente,
  // futuro: salvar em GCS com signed URL de 1h.
  await prisma.camera.update({
    where: { id: cam.id },
    data:  { lastSnapshotAt: snapshotAt },
  })
  await cameraLogService.logCamera({
    cameraId: cam.id, level: 'INFO', source: 'SNAPSHOT',
    message: 'Snapshot solicitado (ticket emitido)',
  })

  res.json({
    snapshotUrl,
    snapshotAt,
    expiresInSec: 60,
  })
}))

// =============================================================================
// GET /cameras/:id/snapshot?variant=annotated|clean — Sprint Q.3 (Frigate clean copy)
// =============================================================================
//
// Retorna 302 redirect para a URL final (mock em DEV; GCS em prod).
// `variant=clean` corresponde ao `<id>-clean.webp` do Frigate — sem bbox/labels,
// usado por integrações ML downstream e portais públicos.
//
// Reliability: 404 se câmera sem snapshot OU se cleanSnapshotEnabled=false e
// variant=clean foi pedido. Caller decide fallback.
const SnapshotQuerySchema = z.object({
  variant: z.enum(['annotated', 'clean']).optional().default('annotated'),
})

cameraRouter.get('/:id/snapshot', asyncHandler(async (req, res) => {
  const parse = SnapshotQuerySchema.safeParse(req.query)
  if (!parse.success) throw new ValidationError('variant deve ser annotated|clean')
  const { variant } = parse.data

  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: { id: true, lastSnapshotUrl: true, lastSnapshotAt: true, cleanSnapshotEnabled: true, snapshotBoundingBox: true },
  })

  if (!cam.lastSnapshotUrl) throw new NotFoundError('snapshot')

  if (variant === 'clean' && !cam.cleanSnapshotEnabled) {
    throw new NotFoundError('clean snapshot (cleanSnapshotEnabled=false na câmera)')
  }

  // DEV mock: para 'clean' troca o seed para gerar imagem distinta sem overlay.
  // PROD: estrutura GCS prevista é `cameras/<id>/snapshots/<eventId>{,-clean}.webp`.
  const IS_DEV = process.env.NODE_ENV !== 'production'
  let finalUrl = cam.lastSnapshotUrl
  if (variant === 'clean') {
    if (IS_DEV) {
      // Re-derive mock URL com seed limpo (sem suffix de timestamp)
      finalUrl = `https://picsum.photos/seed/${cam.id}-clean/1280/720`
    } else {
      // Em produção: tenta variante `-clean` no nome do arquivo
      finalUrl = cam.lastSnapshotUrl.replace(/(\.\w+)(\?|$)/, '-clean$1$2')
    }
  }

  // Cache curto — snapshot muda a cada N segundos
  res.set('Cache-Control', 'private, max-age=10')
  res.set('X-Snapshot-Variant', variant)
  res.redirect(302, finalUrl)
}))

// =============================================================================
// ZONES
// =============================================================================

cameraRouter.post('/:id/zones', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })
  const parse = ZoneSchema.safeParse(req.body)
  if (!parse.success) {
    const first = parse.error.errors[0]
    const path = first.path.length ? first.path.join('.') : 'body'
    throw new ValidationError(`${path}: ${first.message}`)
  }
  const z = parse.data
  const zone = await prisma.cameraZone.create({
    data: {
      cameraId:         cam.id,
      name:             z.name,
      type:             z.type as any,
      color:            z.color ?? '#06b6d4',
      coordinates:      z.coordinates as any,
      direction:        z.direction ?? null,
      inertia:          z.inertia ?? 3,
      loiteringTimeSec: z.loiteringTimeSec ?? 0,
      objectsJson:      (z.objects ?? []) as any,
      filtersJson:      (z.filters ?? {}) as any,
      distancesJson:    (z.distances ?? []) as any,
      requiredForAlert: z.requiredForAlert ?? false,
      maxOccupancy:     z.maxOccupancy ?? null,
      alertOnViolation: z.alertOnViolation ?? false,
    },
  })
  await cameraLogService.logCamera({
    cameraId: cam.id, level: 'INFO', source: 'ZONE',
    message: `Zona "${zone.name}" criada (${zone.type})`, zoneId: zone.id,
  })
  res.status(201).json(zone)
}))

cameraRouter.patch('/:id/zones/:zoneId', asyncHandler(async (req, res) => {
  // Isolamento duplo: câmera precisa ser do tenant, E a zona precisa pertencer
  // a ESSA câmera (evita editar zone de camera alheia só informando o zoneId).
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })
  const existing = await prisma.cameraZone.findFirst({
    where: { id: req.params.zoneId, cameraId: cam.id },
    select: { id: true },
  })
  if (!existing) throw new NotFoundError('Zona')

  // Whitelist: mesmos campos do ZoneSchema. Rejeita `cameraId` no body.
  const parse = ZoneSchema.partial().safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'Dados inválidos')

  const zone = await prisma.cameraZone.update({
    where: { id: existing.id },
    data:  parse.data as any,
  })
  res.json(zone)
}))

cameraRouter.delete('/:id/zones/:zoneId', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })
  const existing = await prisma.cameraZone.findFirst({
    where: { id: req.params.zoneId, cameraId: cam.id },
    select: { id: true },
  })
  if (!existing) throw new NotFoundError('Zona')
  await prisma.cameraZone.update({
    where: { id: existing.id },
    data:  { active: false },
  })
  res.json({ ok: true })
}))

// =============================================================================
// LIVE STREAMING — WHEP (WebRTC) + MJPEG fallback
// =============================================================================

/**
 * GET /cameras/:id/live-token?kind=whep|mjpeg|snapshot
 * Emite um ticket JWT de 60s que o browser usa como query param nas rotas de proxy.
 *
 * kinds:
 *   whep     — ticket para POST /live/:id/whep (negocia WebRTC)
 *   mjpeg    — ticket para GET /live/:id/mjpeg (multipart MJPEG via go2rtc)
 *   snapshot — ticket para GET /live/:id/snapshot-jpeg (1 frame via ffmpeg local)
 *
 * O kind é gravado no payload do ticket; o endpoint downstream verifica que
 * o ticket recebido bate com o kind esperado (defesa contra reuso entre
 * endpoints — ex: ticket de snapshot não vale para WHEP).
 */
cameraRouter.get('/:id/live-token', asyncHandler(async (req, res) => {
  // Isolamento: só emite token se a câmera pertence ao tenant.
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })
  const rawKind = req.query.kind
  const kind: 'whep' | 'mjpeg' | 'snapshot' =
    rawKind === 'mjpeg' ? 'mjpeg' :
    rawKind === 'snapshot' ? 'snapshot' :
    'whep'
  const result = await liveService.issueTicket(req.jwtPayload!, cam.id, kind)
  res.json(result)
}))

// =============================================================================
// RTMP PUSH — Revelar / Rotacionar stream key
// =============================================================================
//
// A stream key nunca volta no GET /cameras (campo sanitizado → boolean
// rtmpIngestKeyConfigured). Para revelar ou rotacionar o operador usa
// os dois endpoints abaixo. Cada reveal é logado para auditoria.
//
// GET  /:id/rtmp-ingest-key           → decifra e devolve key + url completa
// POST /:id/rtmp-ingest-key/regenerate→ gera nova key, persiste, devolve

cameraRouter.get('/:id/rtmp-ingest-key', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: { id: true, rtmpIngestKeyEnc: true },
  }) as { id: string; rtmpIngestKeyEnc: string | null }

  const key = decryptSecret(cam.rtmpIngestKeyEnc)
  if (!key) {
    res.json({ key: null, url: null })
    return
  }

  const { host, port } = getRtmpHost()
  const url = buildRtmpUrl(key)

  logger.info(
    { cameraId: cam.id, userId: req.jwtPayload?.sub, role: req.jwtPayload?.role },
    'rtmp-ingest-key revealed (audit)',
  )

  res.json({ key, url, host, port })
}))

cameraRouter.post('/:id/rtmp-ingest-key/regenerate', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: { id: true },
  })

  const { generateRtmpStreamKey } = await import('../lib/rtmp-key')
  const newKey = generateRtmpStreamKey()
  const { host, port } = getRtmpHost()
  const url = buildRtmpUrl(newKey)

  await prisma.camera.update({
    where: { id: cam.id },
    data:  { rtmpIngestKeyEnc: encryptSecret(newKey) },
  })

  logger.info(
    { cameraId: cam.id, userId: req.jwtPayload?.sub, role: req.jwtPayload?.role },
    'rtmp-ingest-key rotated (audit)',
  )

  res.json({ key: newKey, url, host, port })
}))

// ─── PTZ — controle de movimento e presets ───────────────────────────────────
//
// POST /:id/ptz                       → proxy para go2rtc PTZ (move/zoom/stop)
// GET  /:id/ptz/presets               → lista presets salvos no banco
// POST /:id/ptz/presets               → salva preset com nome
// POST /:id/ptz/presets/:pid/goto     → vai para preset
// DELETE /:id/ptz/presets/:pid        → remove preset

const GO2RTC_BASE = (process.env.EMBEDDED_GO2RTC_URL ?? 'http://go2rtc:1984').replace(/\/$/, '')

// Mapa command → move param do go2rtc
const PTZ_MOVE_MAP: Record<string, string> = {
  up:      'up',
  down:    'down',
  left:    'left',
  right:   'right',
  zoomIn:  'zoom_in',
  zoomOut: 'zoom_out',
  stop:    'stop',
}

const PtzCommandBody = z.object({
  command: z.enum(['up','down','left','right','zoomIn','zoomOut','stop']),
  speed:   z.number().min(0).max(1).default(0.5),
})

cameraRouter.post('/:id/ptz', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: { id: true, go2rtcStreamId: true, ptzEnabled: true },
  }) as { id: string; go2rtcStreamId: string | null; ptzEnabled: boolean }

  if (!cam.go2rtcStreamId) {
    res.status(422).json({ error: 'Câmera não tem stream configurado para PTZ' })
    return
  }

  const { command, speed } = PtzCommandBody.parse(req.body)
  const move  = PTZ_MOVE_MAP[command] ?? 'stop'
  const url   = `${GO2RTC_BASE}/api/ptz?src=${encodeURIComponent(cam.go2rtcStreamId)}&move=${move}&speed=${speed}`

  try {
    const resp = await fetch(url, { method: 'PUT', signal: AbortSignal.timeout(4000) })
    if (!resp.ok) {
      logger.warn({ status: resp.status, cameraId: cam.id, command }, 'ptz_go2rtc_error')
      res.status(502).json({ error: `go2rtc retornou ${resp.status}` })
      return
    }
  } catch (err: any) {
    logger.warn({ err: err?.message, cameraId: cam.id }, 'ptz_go2rtc_unreachable')
    res.status(502).json({ error: 'go2rtc inacessível' })
    return
  }

  res.json({ ok: true })
}))

// Helper: lê lista de presets do campo Json no banco (sem migration nova)
async function readPresets(cameraId: string): Promise<{ id: string; name: string; createdAt: string }[]> {
  const rows = await prisma.$queryRaw<{ ptz: unknown }[]>`
    SELECT "ptzPresetsJson" AS ptz FROM "Camera" WHERE id = ${cameraId}::uuid
  `.catch(() => null)

  if (!rows || rows.length === 0) return []
  const raw = rows[0]?.ptz
  if (!Array.isArray(raw)) return []
  return raw as { id: string; name: string; createdAt: string }[]
}

async function writePresets(cameraId: string, presets: { id: string; name: string; createdAt: string }[]) {
  await prisma.$executeRaw`
    UPDATE "Camera" SET "ptzPresetsJson" = ${JSON.stringify(presets)}::jsonb
    WHERE id = ${cameraId}::uuid
  `
}

cameraRouter.get('/:id/ptz/presets', asyncHandler(async (req, res) => {
  await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })
  const presets = await readPresets(req.params.id)
  res.json({ presets })
}))

cameraRouter.post('/:id/ptz/presets', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: { id: true, go2rtcStreamId: true },
  }) as { id: string; go2rtcStreamId: string | null }

  const name = z.string().min(1).max(50).parse(req.body.name)

  // Tenta salvar via go2rtc se disponível
  if (cam.go2rtcStreamId) {
    const saveUrl = `${GO2RTC_BASE}/api/ptz?src=${encodeURIComponent(cam.go2rtcStreamId)}&save_preset=${encodeURIComponent(name)}`
    await fetch(saveUrl, { method: 'PUT', signal: AbortSignal.timeout(4000) }).catch(() => {})
  }

  const presets = await readPresets(cam.id)
  const newPreset = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }
  presets.push(newPreset)
  await writePresets(cam.id, presets).catch(() => {
    // ptzPresetsJson pode não existir no schema — não fatal, preset vai em memória apenas
    logger.warn({ cameraId: cam.id }, 'ptz_preset_save_skipped_no_column')
  })

  res.status(201).json(newPreset)
}))

cameraRouter.post('/:id/ptz/presets/:pid/goto', asyncHandler(async (req, res) => {
  const cam = await requireCameraForUser(req.params.id, req.jwtPayload, {
    select: { id: true, go2rtcStreamId: true },
  }) as { id: string; go2rtcStreamId: string | null }

  const presets = await readPresets(cam.id)
  const preset  = presets.find(p => p.id === req.params.pid)
  if (!preset) { res.status(404).json({ error: 'Preset não encontrado' }); return }

  if (cam.go2rtcStreamId) {
    const gotoUrl = `${GO2RTC_BASE}/api/ptz?src=${encodeURIComponent(cam.go2rtcStreamId)}&recall_preset=${encodeURIComponent(preset.name)}`
    const resp = await fetch(gotoUrl, { method: 'PUT', signal: AbortSignal.timeout(4000) }).catch(() => null)
    if (!resp?.ok) {
      logger.warn({ cameraId: cam.id, preset: preset.name }, 'ptz_goto_preset_failed')
    }
  }

  res.json({ ok: true, preset })
}))

cameraRouter.delete('/:id/ptz/presets/:pid', asyncHandler(async (req, res) => {
  await requireCameraForUser(req.params.id, req.jwtPayload, { select: { id: true } })
  const presets = await readPresets(req.params.id)
  const next    = presets.filter(p => p.id !== req.params.pid)
  await writePresets(req.params.id, next).catch(() => {})
  res.json({ ok: true })
}))
