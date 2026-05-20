/**
 * Edge Routes
 *
 * POST /edge/ingest    ← recebe crop do edge, invoca Vision API, persiste metadados
 * POST /edge/heartbeat ← telemetria do edge node
 * GET  /edge/config    ← configuração atualizada das câmeras
 */
import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { requireEdgeAuth } from '../middleware/edge-auth'
import { quotaService } from '../services/quota.service'
import { visionService } from '../services/vision.service'
import { gcsService } from '../services/gcs.service'
import { bigQueryService } from '../services/bigquery.service'
import { anonymize } from '../services/anonymize.service'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { ValidationError, NotFoundError } from '../lib/errors'

export const edgeRouter = Router()

// ─── Schemas de validação ──────────────────────────────────────────────────

const IngestSchema = z.object({
  cameraId:       z.string().min(1),
  edgeNodeId:     z.string().min(1).optional(),
  zoneId:         z.string().nullable().optional(),
  eventType:      z.string().min(1).max(50).default('DETECTION'),
  model:          z.string().min(1).optional(),
  trackId:        z.number().int().optional(),
  bbox:           z.array(z.number()).length(4).optional(),
  confidence:     z.number().min(0).max(1).optional(),
  className:      z.string().optional(),
  imageB64:       z.string().min(4),    // base64 JPEG do crop
  enabledModels:  z.array(z.string()).optional(),
  models:         z.array(z.string()).optional(),  // alias
  pipeline:       z.string().optional(),
  capturedAt:     z.string().optional(),
  occupancyCount: z.number().int().nullable().optional(),
  metadata:       z.record(z.unknown()).optional(),
})

const HeartbeatSchema = z.object({
  edgeNodeId:        z.string().min(1),
  cpuUsage:          z.number(),
  memUsage:          z.number(),
  diskUsage:         z.number(),
  tempCelsius:       z.number().nullable().optional(),
  networkInBps:      z.number().optional(),
  networkOutBps:     z.number().optional(),
  fpsCurrent:        z.number().optional(),
  apiCallsSent:      z.number().int().optional(),
  rtmpStreamsActive:  z.number().int().optional(),
})

// ─── Feature map: modelo → features Vision API solicitadas ────────────────

const MODEL_FEATURES: Record<string, ('FACE' | 'LABEL' | 'LOGO' | 'OBJECT' | 'SAFE_SEARCH')[]> = {
  FACE_ANNOTATION:      ['FACE'],
  LABEL_DETECTION:      ['LABEL'],
  LOGO_DETECTION:       ['LOGO'],
  OBJECT_LOCALIZATION:  ['OBJECT'],
  SAFE_SEARCH:          ['SAFE_SEARCH'],
}

function resolveFeatures(
  models: string[],
): ('FACE' | 'LABEL' | 'LOGO' | 'OBJECT' | 'SAFE_SEARCH')[] {
  const featureSet = new Set<'FACE' | 'LABEL' | 'LOGO' | 'OBJECT' | 'SAFE_SEARCH'>()
  for (const m of models) {
    for (const f of MODEL_FEATURES[m] ?? []) featureSet.add(f)
  }
  // Sempre incluir SAFE_SEARCH para moderação
  featureSet.add('SAFE_SEARCH')
  return [...featureSet]
}

// ─── POST /edge/ingest ─────────────────────────────────────────────────────

edgeRouter.post(
  '/ingest',
  requireEdgeAuth,
  async (req: Request, res: Response, _next: NextFunction) => {
    const parse = IngestSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

    const body          = parse.data
    const { integradorId } = req.edgeNode!

    // 1. Verificar se câmera pertence ao integrador e está ativa
    const camera = await prisma.camera.findFirst({
      where: { id: body.cameraId, active: true },
      include: { subscription: true },
    })
    if (!camera) throw new NotFoundError('Câmera')
    if (camera.tier === 'STREAMING_ANALYTICS') {
      throw new ValidationError('Câmera configurada para Pipeline 2 — use RTMP push direto')
    }

    // 2. Verificar e incrementar quota (BLOQUEIA se excedida)
    await quotaService.checkAndIncrementVision(integradorId, 1)

    // 3. Chamar Cloud Vision API
    const features = resolveFeatures(body.enabledModels ?? body.models ?? [])
    let annotations = null
    let rawAnnotations = null

    try {
      annotations    = await visionService.annotate(body.imageB64, features)
      rawAnnotations = annotations.rawResponse
    } catch (err: any) {
      logger.error({ err: err.message, cameraId: body.cameraId }, 'vision_api_failed')
      // Não falhar o request — persistir evento sem annotations
    }

    // 4. Upload da evidência para GCS (TTL 72h)
    let evidence = null
    try {
      evidence = await gcsService.uploadEvidence(body.imageB64, integradorId, body.cameraId)
    } catch (err: any) {
      logger.warn({ err: err.message }, 'gcs_upload_failed')
    }

    // 5. Anonimizar metadados (LGPD)
    const anon = annotations ? anonymize(annotations) : null

    // 6. Persistir AnalyticsEvent no PostgreSQL
    const eventId = randomUUID()
    const now     = new Date()

    await prisma.analyticsEvent.create({
      data: {
        id:              eventId,
        cameraId:        body.cameraId,
        zoneId:          body.zoneId ?? null,
        model:           (body.model ?? body.models?.[0] ?? 'LABEL_DETECTION') as any,
        pipeline:        (body.pipeline ?? 'EDGE_HYBRID') as any,
        eventType:       body.eventType,
        severity:        'INFO',
        capturedAt:      now,
        processedAt:     now,
        dominantEmotion: anon?.dominantEmotion,
        emotionJoy:      anon?.emotionJoy,
        emotionSorrow:   anon?.emotionSorrow,
        emotionAnger:    anon?.emotionAnger,
        emotionSurprise: anon?.emotionSurprise,
        hasHat:          anon?.hasHat,
        hasGlasses:      anon?.hasGlasses,
        hasFaceMask:     null,
        labelsJson:      anon?.labelsJson as any,
        logosJson:       anon?.logosJson as any,
        detectedObjectsJson: anon?.detectedObjectsJson as any,
        occupancyCount:  body.occupancyCount ?? null,
        evidenceGcsBucket: evidence?.bucket ?? null,
        evidenceGcsKey:    evidence?.key ?? null,
        evidenceExpiry:    evidence?.expiry ?? null,
        rawAnnotationsJson: rawAnnotations as any,
      },
    })

    // 7. Registrar uso de API (assíncrono — não bloqueia resposta)
    prisma.apiUsageLog.create({
      data: {
        integradorId,
        cameraId:       body.cameraId,
        edgeNodeId:     body.edgeNodeId ?? req.edgeNode!.id,
        visionApiCalls: 1,
        visionFeaturesJson: Object.fromEntries(features.map(f => [f, 1])) as any,
        framesSkipped:  0,
        framesUploaded: 1,
        periodDate:     new Date(now.getFullYear(), now.getMonth(), 1),
      },
    }).catch(err => logger.warn({ err }, 'usage_log_failed'))

    // 8. Sync BigQuery (assíncrono — não bloqueia)
    bigQueryService.insertEvent({
      event_id:        eventId,
      camera_id:       body.cameraId,
      zone_id:         body.zoneId ?? null,
      integrador_id:   integradorId,
      model:           body.model ?? body.models?.[0] ?? 'LABEL_DETECTION',
      pipeline:        body.pipeline ?? 'EDGE_HYBRID',
      event_type:      body.eventType,
      severity:        'INFO',
      captured_at:     now.toISOString(),
      processed_at:    now.toISOString(),
      dwell_time_sec:  null,
      age_range:       anon?.ageRange ?? null,
      gender:          anon?.gender ?? null,
      dominant_emotion:anon?.dominantEmotion ?? null,
      emotion_joy:     anon?.emotionJoy ?? null,
      emotion_sorrow:  anon?.emotionSorrow ?? null,
      person_count:    body.occupancyCount ?? null,
      has_hat:         anon?.hasHat ?? null,
      has_glasses:     anon?.hasGlasses ?? null,
      labels_json:     anon?.labelsJson ? JSON.stringify(anon.labelsJson) : null,
      logos_json:      anon?.logosJson ? JSON.stringify(anon.logosJson) : null,
      ppe_compliant:   null,
      occupancy_count: body.occupancyCount ?? null,
    }, integradorId).catch(() => {})

    // 9. Resposta
    const quotaStatus = await quotaService.getStatus(integradorId)

    res.json({
      eventId,
      evidenceKey:     evidence?.key ?? null,
      thumbnailUrl:    evidence?.signedUrl ?? null,
      quotaRemaining:  quotaStatus?.vision.limit
        ? quotaStatus.vision.limit - quotaStatus.vision.used
        : -1,
      quotaBlocked:    quotaStatus?.vision.blocked ?? false,
      annotations: anon
        ? {
            emotion:  anon.dominantEmotion,
            hasHat:   anon.hasHat,
            labels:   anon.labelsJson?.slice(0, 5),
            logos:    anon.logosJson?.slice(0, 3),
          }
        : null,
    })
  },
)

// ─── POST /edge/heartbeat ──────────────────────────────────────────────────

edgeRouter.post(
  '/heartbeat',
  requireEdgeAuth,
  async (req: Request, res: Response) => {
    const parse = HeartbeatSchema.safeParse(req.body)
    if (!parse.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR' })
      return
    }

    const b = parse.data
    const { id: nodeId } = req.edgeNode!

    await prisma.$transaction([
      prisma.edgeNode.update({
        where: { id: nodeId },
        data: {
          status:        'ONLINE',
          lastHeartbeat: new Date(),
          cpuUsage:      b.cpuUsage,
          memUsage:      b.memUsage,
          diskUsage:     b.diskUsage,
          tempCelsius:   b.tempCelsius ?? null,
        },
      }),
      prisma.edgeHeartbeat.create({
        data: {
          edgeNodeId:    nodeId,
          cpuUsage:      b.cpuUsage,
          memUsage:      b.memUsage,
          diskUsage:     b.diskUsage,
          tempCelsius:   b.tempCelsius ?? null,
          networkInBps:  b.networkInBps ?? null,
          networkOutBps: b.networkOutBps ?? null,
          fpsCurrent:    b.fpsCurrent ?? null,
          apiCallsSent:  b.apiCallsSent ?? null,
        },
      }),
    ])

    res.json({ ok: true, serverTime: new Date().toISOString() })
  },
)

// ─── GET /edge/rules  (+ aliases: /v1/rules e /rules) ─────────────────────
//
// Retorna as regras ativas para este Edge Node.
// A Box executa as regras localmente e gera eventos quando acionadas.
// Versão atual: stub com regras padrão + regras customizadas futuras (DB).

edgeRouter.get(
  '/rules',
  requireEdgeAuth,
  async (req: Request, res: Response) => {
    const { id: nodeId } = req.edgeNode!

    // Busca câmeras ativas para incluir IDs nas regras
    const cameras = await prisma.camera.findMany({
      where: { edgeNodeId: nodeId, active: true },
      select: { id: true, name: true },
    })
    const cameraIds = cameras.map(c => c.id)

    // ── Regras stub (Sprint 0) ───────────────────────────────────────────────
    // Quando a Rules Engine estiver pronta, isso virá de uma tabela EdgeRule no DB.
    const rules = [
      {
        id: 'rule_default_intrusion',
        name: 'Intrusão — Presença Humana',
        enabled: true,
        version: 1,
        trigger: {
          type: 'detection',
          classes: ['person'],
          minConfidence: 0.55,
          minObjectCount: 1,
          zones: ['all'],
          cameras: cameraIds.length > 0 ? cameraIds : ['*'],
        },
        cooldownSec: 30,
        actions: [
          { type: 'cloud_event',   eventType: 'INTRUSION_ALERT',   severity: 'WARNING' },
          { type: 'snapshot',      destination: 'cloud' },
          { type: 'notify',        channels: ['whatsapp', 'push'] },
        ],
      },
      {
        id: 'rule_default_crowd',
        name: 'Superlotação — Aglomeração',
        enabled: true,
        version: 1,
        trigger: {
          type: 'detection',
          classes: ['person'],
          minConfidence: 0.55,
          minObjectCount: 5,
          zones: ['all'],
          cameras: cameraIds.length > 0 ? cameraIds : ['*'],
        },
        cooldownSec: 60,
        actions: [
          { type: 'cloud_event',   eventType: 'CROWD_ALERT',       severity: 'WARNING' },
          { type: 'snapshot',      destination: 'cloud' },
          { type: 'notify',        channels: ['whatsapp', 'push'] },
        ],
      },
      {
        id: 'rule_test_presence',
        name: '⚙️ Rule Test — Engrenagem Sprint 0',
        enabled: true,
        version: 1,
        trigger: {
          type: 'detection',
          classes: ['person', 'car', 'truck', 'motorcycle'],
          minConfidence: 0.40,
          minObjectCount: 1,
          zones: ['all'],
          cameras: cameraIds.length > 0 ? cameraIds : ['*'],
        },
        cooldownSec: 10,
        actions: [
          { type: 'cloud_event',   eventType: 'rule_test',         severity: 'INFO' },
        ],
        _meta: { sprint: 0, purpose: 'validate_pipeline_end_to_end' },
      },
    ]

    res.json({
      ok: true,
      nodeId,
      rulesVersion: 1,
      generatedAt: new Date().toISOString(),
      count: rules.length,
      rules,
    })
  },
)

// ─── GET /edge/config ──────────────────────────────────────────────────────

edgeRouter.get(
  '/config',
  requireEdgeAuth,
  async (req: Request, res: Response) => {
    const { id: nodeId } = req.edgeNode!

    const cameras = await prisma.camera.findMany({
      where: { edgeNodeId: nodeId, active: true },
      include: {
        zones:         { where: { active: true } },
        enabledModels: { where: { enabled: true } },
      },
    })

    res.json({
      cameras: cameras.map(c => ({
        id:            c.id,
        name:          c.name,
        rtspSubUrl:    c.rtspSubUrl,
        rtmpPushUrl:   c.rtmpPushUrl,
        pipeline:      c.pipeline,
        fpsTarget:     c.fps ?? 5,
        enabledModels: c.enabledModels.map(m => m.model),
        zones:         c.zones.map(z => ({
          id:          z.id,
          name:        z.name,
          type:        z.type,
          coordinates: z.coordinates,
          direction:   z.direction,
          maxOccupancy:z.maxOccupancy,
        })),
      })),
    })
  },
)
