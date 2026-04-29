/**
 * IACV Box Routes — Licenciamento e Comunicação Edge-to-Cloud
 *
 * POST /iacv-box/activate                   ← A Box envia a licenseKey; recebe apiToken + config
 * POST /iacv-box/heartbeat                  ← Heartbeat periódico da Box (verifica licença)
 * POST /iacv-box/events                     ← Recebe eventos de detecção com snapshot WebP
 * POST /iacv-box/generate-key               ← Super Admin gera uma chave de licença para nova Box
 * GET  /iacv-box/:boxId/integration/snapshot ← Painel de integração (Cloud side)
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { randomUUID, createHash } from 'crypto'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth } from '../middleware/auth'
import { ValidationError, NotFoundError, UnauthorizedError } from '../lib/errors'
import { dispatchAlert } from '../lib/notification-dispatcher'

// S3 — importação condicional (não quebra se @aws-sdk não estiver instalado)
let s3Service: any = null
try { s3Service = require('../services/s3.service').s3Service } catch { /* no-op */ }

export const iacvBoxRouter = Router()

// ─── Schemas ────────────────────────────────────────────────────────────────

const GenerateKeySchema = z.object({
  edgeNodeId:  z.string().min(1),
  description: z.string().optional(),
})

const ActivateSchema = z.object({
  licenseKey: z.string().min(10),
  hostname:   z.string().optional(),
  ipLocal:    z.string().optional(),
  model:      z.string().optional(),   // "Raspberry Pi 5"
})

const BoxHeartbeatSchema = z.object({
  licenseKey:  z.string().min(10),
  cpuUsage:    z.number().nullable().optional(),
  memUsage:    z.number().nullable().optional(),
  diskUsage:   z.number().nullable().optional(),
  tempCelsius: z.number().nullable().optional(),
  fpsCurrent:  z.number().nullable().optional(),
  modelLoaded: z.string().nullable().optional(),
  firmwareVersion: z.string().nullable().optional(),
})

const BoxEventSchema = z.object({
  licenseKey:   z.string().min(10),
  cameraId:     z.string().optional(),
  timestamp:    z.number(),
  objectCount:  z.number().int(),
  classes:      z.array(z.string()),
  snapshot:     z.string().optional(),  // base64 WebP
})

// ─── Cache de licenças (em memória, TTL 60s) ───────────────────────────────

interface LicenseCache {
  edgeNodeId: string
  integradorId: string
  clienteFinalId: string
  licensed: boolean
  exp: number
}

const licenseCache = new Map<string, LicenseCache>()
const LICENSE_CACHE_TTL_MS = 60_000

/**
 * Gera uma licenseKey legível e única no formato: IACV-XXXX-XXXX-XXXX-XXXX
 */
function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sem I/O/0/1 para evitar confusão
  const segments: string[] = []
  for (let s = 0; s < 4; s++) {
    let seg = ''
    for (let i = 0; i < 4; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)]
    }
    segments.push(seg)
  }
  return `IACV-${segments.join('-')}`
}

/**
 * Hash da licenseKey para armazenamento seguro (não guardamos a chave em plain text)
 */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Resolve a licença a partir da key (com cache)
 */
async function resolveLicense(licenseKey: string): Promise<LicenseCache | null> {
  // DEV BYPASS: Para testes de laboratório rápidos sem depender da UI
  if (licenseKey === 'IACV-LAB-TEST-KEY-123') {
    const node = await prisma.edgeNode.findFirst({
      where: { serialNumber: 'ICV-EDGE-001' },
      include: { site: { select: { clienteFinal: true } } },
    })
    if (node) {
      return {
        edgeNodeId: node.id,
        integradorId: node.site.clienteFinal.integradorId,
        clienteFinalId: node.site.clienteFinal.id,
        licensed: true,
        exp: Date.now() + LICENSE_CACHE_TTL_MS,
      }
    }
  }

  const keyHash = hashKey(licenseKey)

  // Checar cache
  const cached = licenseCache.get(keyHash)
  if (cached && cached.exp > Date.now()) return cached

  // Buscar no banco pelo hash da chave
  const node = await prisma.edgeNode.findFirst({
    where: { apiToken: keyHash },
    include: {
      site: {
        select: {
          clienteFinal: {
            select: {
              id: true,
              integradorId: true,
              active: true,
            },
          },
        },
      },
    },
  })

  if (!node) return null

  const licensed =
    node.status !== 'OFFLINE' &&
    node.status !== 'MAINTENANCE' &&
    node.site.clienteFinal.active

  const entry: LicenseCache = {
    edgeNodeId: node.id,
    integradorId: node.site.clienteFinal.integradorId,
    clienteFinalId: node.site.clienteFinal.id,
    licensed,
    exp: Date.now() + LICENSE_CACHE_TTL_MS,
  }

  licenseCache.set(keyHash, entry)
  return entry
}

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/generate-key  (SUPER_ADMIN ou INTEGRADOR_ADMIN)
// ═════════════════════════════════════════════════════════════════════════════

iacvBoxRouter.post('/generate-key', requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    throw new UnauthorizedError('Apenas administradores podem gerar chaves de licença')
  }

  const parse = GenerateKeySchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const { edgeNodeId, description } = parse.data

  // Verificar se o edge node existe e pertence ao tenant
  const node = await prisma.edgeNode.findUnique({
    where: { id: edgeNodeId },
    include: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
  })
  if (!node) throw new NotFoundError('Edge Node')

  // Verificar tenant
  if (jwt.role !== 'SUPER_ADMIN' && node.site.clienteFinal.integradorId !== jwt.integradorId) {
    throw new UnauthorizedError('Edge Node não pertence ao seu tenant')
  }

  // Gerar a chave legível
  const licenseKey = generateLicenseKey()
  const keyHash = hashKey(licenseKey)

  // Atualizar o apiToken do EdgeNode com o hash da chave
  await prisma.edgeNode.update({
    where: { id: edgeNodeId },
    data: {
      apiToken: keyHash,
      status: 'PROVISIONING',
      description: description ?? node.description,
    },
  })

  logger.info({ edgeNodeId, keyPrefix: licenseKey.slice(0, 9) }, 'iacv_box_license_generated')

  // IMPORTANTE: A licenseKey em plain text só é mostrada UMA VEZ.
  // Depois disso, só temos o hash. O operador deve anotar a chave.
  res.json({
    licenseKey,
    edgeNodeId,
    message: 'Chave gerada com sucesso. COPIE E GUARDE — ela não será exibida novamente.',
    instructions: {
      step1: 'No terminal do IACV Box (Raspberry Pi), configure a variável de ambiente:',
      command: `export IACV_LICENSE_KEY="${licenseKey}"`,
      step2: 'Reinicie o serviço: docker compose restart iacv-box',
    },
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/activate   (A Box se auto-registra na primeira inicialização)
// ═════════════════════════════════════════════════════════════════════════════

iacvBoxRouter.post('/activate', async (req: Request, res: Response) => {
  const parse = ActivateSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  const { licenseKey, hostname, ipLocal, model: hwModel } = parse.data
  const keyHash = hashKey(licenseKey)

  // DEV BYPASS
  const whereClause = licenseKey === 'IACV-LAB-TEST-KEY-123' 
    ? { serialNumber: 'ICV-EDGE-001' } 
    : { apiToken: keyHash }

  const node = await prisma.edgeNode.findFirst({
    where: whereClause,
    include: {
      site: {
        select: {
          id: true,
          name: true,
          clienteFinal: {
            select: {
              id: true,
              name: true,
              integradorId: true,
              active: true,
            },
          },
        },
      },
      cameras: {
        where: { active: true },
        select: {
          id: true,
          name: true,
          rtspMainUrl: true,
          rtspSubUrl: true,
          go2rtcStreamId: true,
          zones: {
            where: { active: true },
            select: {
              id: true,
              name: true,
              type: true,
              coordinates: true,
              direction: true,
              maxOccupancy: true,
            },
          },
        },
      },
    },
  })

  if (!node) {
    res.status(403).json({ error: 'LICENSE_INVALID', message: 'Chave de licença inválida.' })
    return
  }

  if (!node.site.clienteFinal.active) {
    res.status(403).json({ error: 'TENANT_INACTIVE', message: 'Cliente desativado. Contate o integrador.' })
    return
  }

  // Atualizar status e metadados da Box
  await prisma.edgeNode.update({
    where: { id: node.id },
    data: {
      status: 'ONLINE',
      lastHeartbeat: new Date(),
      ipLocal: ipLocal ?? node.ipLocal,
      model: hwModel ?? node.model,
      description: hostname ? `IACV Box - ${hostname}` : node.description,
    },
  })

  logger.info({ edgeNodeId: node.id, hostname }, 'iacv_box_activated')

  res.json({
    licensed: true,
    boxId: node.id,
    site: { id: node.site.id, name: node.site.name },
    client: { id: node.site.clienteFinal.id, name: node.site.clienteFinal.name },
    tenant: {
      name: node.site.clienteFinal.name,
      site: node.site.name,
      plan: 'Enterprise Edge AI', // TODO: Puxar do billing/commercialPlan
      expires: '2027-12-31',      // TODO: Puxar da tabela de subscrição
      maxCameras: 32,
      skills: ['Intrusão', 'LPR', 'Face'] // TODO: Puxar dos módulos ativos
    },
    cameras: node.cameras,
    serverTime: new Date().toISOString(),
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/heartbeat   (a cada 30s, Box pergunta: "posso rodar?")
// ═════════════════════════════════════════════════════════════════════════════

iacvBoxRouter.post('/heartbeat', async (req: Request, res: Response) => {
  const parse = BoxHeartbeatSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' })
    return
  }

  const b = parse.data
  const license = await resolveLicense(b.licenseKey)

  if (!license) {
    res.json({ licensed: false, reason: 'INVALID_KEY' })
    return
  }

  // Atualizar telemetria do edge node
  try {
    await prisma.$transaction([
      prisma.edgeNode.update({
        where: { id: license.edgeNodeId },
        data: {
          status: license.licensed ? 'ONLINE' : 'MAINTENANCE',
          lastHeartbeat: new Date(),
          cpuUsage: b.cpuUsage ?? undefined,
          memUsage: b.memUsage ?? undefined,
          diskUsage: b.diskUsage ?? undefined,
          tempCelsius: b.tempCelsius ?? undefined,
          firmwareVersion: b.firmwareVersion ?? undefined,
          yoloModelVersion: b.modelLoaded ?? undefined,
        },
      }),
      prisma.edgeHeartbeat.create({
        data: {
          edgeNodeId: license.edgeNodeId,
          cpuUsage: b.cpuUsage ?? 0,
          memUsage: b.memUsage ?? 0,
          diskUsage: b.diskUsage ?? 0,
          tempCelsius: b.tempCelsius ?? null,
          fpsCurrent: b.fpsCurrent ?? null,
        },
      }),
    ])
  } catch (err: any) {
    logger.warn({ err: err.message }, 'iacv_box_heartbeat_db_error')
  }

  res.json({
    licensed: license.licensed,
    serverTime: new Date().toISOString(),
    skills: {
      "lpr": { "enabled": true, "name": "Reconhecimento de Placas" },
      "face": { "enabled": true, "name": "Reconhecimento Facial" }
    },
    dynamic_update_enabled: true,
    // Command Queue: a Box processa e confirma no próximo heartbeat
    pendingCommands: [],
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/events   (envia detecções + snapshot WebP)
// ═════════════════════════════════════════════════════════════════════════════

iacvBoxRouter.post('/events', async (req: Request, res: Response) => {
  const parse = BoxEventSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' })
    return
  }

  const b = parse.data
  const license = await resolveLicense(b.licenseKey)

  if (!license || !license.licensed) {
    res.status(403).json({ error: 'UNLICENSED' })
    return
  }

  try {
    const eventId = randomUUID()
    
    // Resolver cameraId: usar o fornecido, ou buscar a primeira câmera do edge node
    let resolvedCameraId = b.cameraId || null
    if (!resolvedCameraId) {
      const edgeNode = await prisma.edgeNode.findUnique({
        where: { id: license.edgeNodeId },
        select: { cameras: { select: { id: true }, take: 1 } },
      })
      resolvedCameraId = edgeNode?.cameras?.[0]?.id ?? null
    }

    // Upload S3 (Zero-Trust)
    let snapshotUrl: string | null = null
    if (b.snapshot && s3Service) {
      try {
        const s3Result = await s3Service.uploadSnapshotBase64(
          b.snapshot, license.integradorId, license.clienteFinalId, license.edgeNodeId, eventId
        )
        if (s3Result) snapshotUrl = `s3://${s3Result.bucket}/${s3Result.key}`
      } catch (e: any) {
        logger.debug({ err: e.message }, 's3_upload_skipped')
      }
    }

    await prisma.analyticsEvent.create({
      data: {
        id: eventId,
        cameraId: resolvedCameraId,
        model: 'PEOPLE_COUNTING',
        pipeline: 'EDGE_YOLO',
        eventType: 'IACV_BOX_DETECTION',
        severity: 'INFO',
        capturedAt: new Date(b.timestamp * 1000),
        processedAt: new Date(),
        occupancyCount: b.objectCount,
        labelsJson: b.classes as any,
        evidenceGcsBucket: snapshotUrl ? snapshotUrl.split('/')[2] : null,
        evidenceGcsKey: snapshotUrl ? snapshotUrl.replace(/^s3:\/\/[^/]+\//, '') : null,
      },
    })

    logger.info(
      { eventId, objects: b.objectCount, classes: b.classes.slice(0, 3) },
      'iacv_box_event_received',
    )

    // ── Disparar notificações (WebPush + Telegram) ──────────────────────
    // Fire-and-forget: não bloqueamos a resposta da Box
    const classeSummary = b.classes.slice(0, 3).join(', ')
    dispatchAlert({
      integradorId: license.integradorId,
      clienteFinalId: license.clienteFinalId,
      title: `🚨 IACV Box — ${b.objectCount} objeto(s)`,
      body: `Detectado: ${classeSummary}${b.classes.length > 3 ? ` +${b.classes.length - 3}` : ''}`,
      snapshot: b.snapshot ?? undefined,
      severity: b.objectCount > 5 ? 'WARNING' : 'INFO',
      eventId,
    }).catch((err: any) => logger.debug({ err: err.message }, 'dispatch_bg_error'))

    res.json({ ok: true, eventId })
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'iacv_box_event_persist_error')
    res.status(500).json({ error: 'PERSIST_ERROR' })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /iacv-box/:boxId/integration/snapshot   (SUPER_ADMIN | INTEGRADOR_ADMIN)
//
// Painel de integração Cloud-side: retorna estado atual do EdgeNode conforme
// persistido no banco (heartbeats, eventos recentes, telemetria, skills).
// Consumido pelo frontend de administração e pelo endpoint Box-side
// GET /api/integration/snapshot (que puxa dados locais da Box).
// ═════════════════════════════════════════════════════════════════════════════

iacvBoxRouter.get('/:boxId/integration/snapshot', requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Apenas administradores podem ver o snapshot de integração' })
    return
  }

  const { boxId } = req.params

  const node = await prisma.edgeNode.findUnique({
    where: { id: boxId },
    include: {
      site: {
        select: {
          id: true,
          name: true,
          clienteFinal: {
            select: {
              id: true,
              name: true,
              integradorId: true,
            },
          },
        },
      },
    },
  })

  if (!node) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Edge Node não encontrado' })
    return
  }

  // Verificar tenant: INTEGRADOR_ADMIN só enxerga seus próprios edge nodes
  if (jwt.role === 'INTEGRADOR_ADMIN' && node.site.clienteFinal.integradorId !== jwt.integradorId) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Edge Node não pertence ao seu tenant' })
    return
  }

  // Buscar últimos 10 heartbeats (telemetria histórica)
  const recentHeartbeats = await prisma.edgeHeartbeat.findMany({
    where: { edgeNodeId: node.id },
    orderBy: { recordedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      cpuUsage: true,
      memUsage: true,
      diskUsage: true,
      tempCelsius: true,
      fpsCurrent: true,
      recordedAt: true,
    },
  })

  // Buscar últimos 20 eventos de detecção das câmeras neste edge
  const recentEvents = await prisma.analyticsEvent.findMany({
    where: {
      camera: { edgeNodeId: node.id },
    },
    orderBy: { capturedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      eventType: true,
      severity: true,
      occupancyCount: true,
      labelsJson: true,
      capturedAt: true,
      processedAt: true,
      camera: { select: { id: true, name: true } },
    },
  })

  // Câmeras deste edge
  const cameras = await prisma.camera.findMany({
    where: { edgeNodeId: node.id },
    select: {
      id: true,
      name: true,
      status: true,
      go2rtcStreamId: true,
    },
  })

  const isLicensed =
    node.status !== 'OFFLINE' &&
    node.status !== 'MAINTENANCE'

  res.json({
    // ── Identidade ────────────────────────────────────────────────────────
    boxId: node.id,
    serialNumber: node.serialNumber,
    name: node.name,
    description: node.description ?? null,

    // ── Licença / Status ─────────────────────────────────────────────────
    licensed: isLicensed,
    status: node.status,

    // ── Temporal ─────────────────────────────────────────────────────────
    lastHeartbeatAt: node.lastHeartbeat ? Math.floor(node.lastHeartbeat.getTime() / 1000) : null,
    serverTime: new Date().toISOString(),

    // ── Telemetria atual (última snapshot persistida pelo heartbeat) ───────
    telemetry: {
      cpuUsage: node.cpuUsage ?? null,
      memUsage: node.memUsage ?? null,
      diskUsage: node.diskUsage ?? null,
      tempCelsius: node.tempCelsius ?? null,
    },

    // ── Firmware / Modelo ─────────────────────────────────────────────────
    firmwareVersion: node.firmwareVersion ?? null,
    yoloModelVersion: node.yoloModelVersion ?? null,

    // ── Site / Cliente ────────────────────────────────────────────────────
    site: {
      id: node.site.id,
      name: node.site.name,
    },
    client: {
      id: node.site.clienteFinal.id,
      name: node.site.clienteFinal.name,
    },

    // ── Câmeras ───────────────────────────────────────────────────────────
    cameras: cameras.map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      go2rtcStreamId: c.go2rtcStreamId ?? null,
    })),
    camerasTotal: cameras.length,
    camerasOnline: cameras.filter(c => c.status === 'STREAMING' || c.status === 'ACTIVE').length,

    // ── Skills (fixo por ora — dinâmico quando EdgeCommand table existir) ─
    skills: {
      lpr: { enabled: true, name: 'Reconhecimento de Placas' },
      face: { enabled: true, name: 'Reconhecimento Facial' },
    },

    // ── Comandos pendentes (stub — EdgeCommand table não existe ainda) ────
    pendingCommands: [],
    pendingCommandsCount: 0,

    // ── Histórico ─────────────────────────────────────────────────────────
    recentHeartbeats,
    recentEvents: recentEvents.map(e => ({
      id: e.id,
      eventType: e.eventType,
      severity: e.severity,
      objectCount: e.occupancyCount ?? 0,
      classes: Array.isArray(e.labelsJson) ? e.labelsJson : [],
      capturedAt: e.capturedAt.toISOString(),
      processedAt: e.processedAt.toISOString(),
      camera: e.camera,
    })),

    // ── Meta ──────────────────────────────────────────────────────────────
    openApiVersion: 'stub-2026-04-29',
  })
})
