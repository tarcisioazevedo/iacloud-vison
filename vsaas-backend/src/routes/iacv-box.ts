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
  licenseKey:     z.string().min(10),
  boxId:          z.string().optional(),  // ignorado — licenseKey já identifica o node
  cameraId:       z.string().optional(),  // UUID do DB ou nome lógico ("cam-demo-001")
  ipLocal:        z.string().optional(),
  timestamp:      z.number(),
  objectCount:    z.number(),             // aceita float (e.g. 1.0) — truncado para int
  classes:        z.array(z.string()),
  snapshot:       z.string().optional(),  // base64 WebP/JPEG
  snapshotFormat: z.string().optional(),  // "webp" | "jpeg"
  frigateId:      z.string().optional(),  // chave de idempotência externa
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
  // Apenas SUPER_ADMIN gera chaves de licença IACV Box.
  // Integradores e clientes finais NÃO têm acesso — chaves são emitidas centralmente
  // para garantir rastreabilidade comercial e prevenir uso paralelo/clonagem.
  if (jwt.role !== 'SUPER_ADMIN') {
    throw new UnauthorizedError('Apenas SUPER_ADMIN pode gerar chaves de licença IACV Box')
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

  // edgeToken = SHA-256(licenseKey) — Bearer token para /edge/ingest e /edge/rules
  // requireEdgeAuth faz findUnique({ where: { apiToken: token } }) com match exato.
  // Sempre usamos keyHash para que o valor seja determinístico e o middleware
  // consiga localizar o node. Se o apiToken no DB diverge (DEV BYPASS, migração),
  // corrigimos aqui atomicamente.
  const edgeToken = keyHash

  // Atualizar status, metadados e garantir apiToken correto no DB
  await prisma.edgeNode.update({
    where: { id: node.id },
    data: {
      status:       'ONLINE',
      lastHeartbeat: new Date(),
      ipLocal:      ipLocal ?? node.ipLocal,
      model:        hwModel ?? node.model,
      description:  hostname ? `IACV Box - ${hostname}` : node.description,
      // Sincroniza apiToken com keyHash para que requireEdgeAuth funcione
      // independente de como o node foi provisionado (generate-key, DEV BYPASS, etc.)
      apiToken:     keyHash,
    },
  })

  logger.info({ edgeNodeId: node.id, hostname }, 'iacv_box_activated')

  res.json({
    licensed: true,
    boxId: node.id,
    edgeToken,        // ← Bearer token para POST /edge/ingest (contrato v1)
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

  // Atualizar telemetria do edge node + registrar heartbeat
  let currentConfigRevision = 1
  try {
    // Nota: select: { configRevision } omitido pois o Prisma client pode estar
    // desatualizado em relação ao schema — usamos $queryRaw abaixo.
    await prisma.$transaction([
      prisma.edgeNode.update({
        where: { id: license.edgeNodeId },
        data: {
          status:           license.licensed ? 'ONLINE' : 'MAINTENANCE',
          lastHeartbeat:    new Date(),
          cpuUsage:         b.cpuUsage    ?? undefined,
          memUsage:         b.memUsage    ?? undefined,
          diskUsage:        b.diskUsage   ?? undefined,
          tempCelsius:      b.tempCelsius ?? undefined,
          fpsCurrent:       b.fpsCurrent  ?? undefined,
          firmwareVersion:  b.firmwareVersion ?? undefined,
          yoloModelVersion: b.modelLoaded ?? undefined,
        },
      }),
      prisma.edgeHeartbeat.create({
        data: {
          edgeNodeId:  license.edgeNodeId,
          cpuUsage:    b.cpuUsage    ?? 0,
          memUsage:    b.memUsage    ?? 0,
          diskUsage:   b.diskUsage   ?? 0,
          tempCelsius: b.tempCelsius ?? null,
          fpsCurrent:  b.fpsCurrent  ?? null,
        },
      }),
    ])
    // Busca configRevision via SQL direto (campo adicionado após geração do Prisma client)
    const rows = await prisma.$queryRaw<{ configRevision: number }[]>`
      SELECT "configRevision" FROM "EdgeNode" WHERE id = ${license.edgeNodeId}
    `
    currentConfigRevision = rows[0]?.configRevision ?? 1
  } catch (err: any) {
    logger.warn({ err: err.message }, 'iacv_box_heartbeat_db_error')
  }

  // Drena comandos pendentes do banco (EdgeCommand) para enviar à Box.
  // Após a Box processar, ela confirma via POST /iacv-box/commands/:id/ack.
  let pendingCommands: object[] = []
  try {
    const cmds = await (prisma as any).edgeCommand.findMany({
      where: { edgeNodeId: license.edgeNodeId, ackedAt: null },
      orderBy: { issuedAt: 'asc' },
      take: 20,
      select: { id: true, type: true, payload: true, issuedAt: true },
    })
    pendingCommands = cmds.map((c: any) => ({
      id: c.id,
      type: c.type,
      payload: c.payload ?? {},
      issuedAt: c.issuedAt.toISOString(),
    }))
  } catch (err: any) {
    logger.warn({ err: err.message }, 'iacv_box_heartbeat_cmds_error')
  }

  res.json({
    licensed:              license.licensed,
    serverTime:            new Date().toISOString(),
    // config_revision: Box compara com seu estado local; se divergir faz pull de
    // GET /iacv-box/{boxId}/config para receber zones/thresholds/skills atualizados.
    config_revision:       currentConfigRevision,
    skills: {
      "lpr":  { "enabled": true, "name": "Reconhecimento de Placas" },
      "face": { "enabled": true, "name": "Reconhecimento Facial"    },
    },
    dynamic_update_enabled: true,
    pendingCommands,
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

    // ── Resolver cameraId ────────────────────────────────────────────────────
    // A Box pode enviar um nome lógico ("cam-demo-001") ou um UUID real do DB.
    // Validamos contra o banco; se inválido, caímos para a 1ª câmera do edge node.
    let resolvedCameraId: string | null = null

    if (b.cameraId) {
      // Testar se o valor fornecido é um UUID válido existente neste edge node
      const cam = await prisma.camera.findFirst({
        where: {
          OR: [
            { id: b.cameraId, edgeNodeId: license.edgeNodeId },
            { go2rtcStreamId: b.cameraId, edgeNodeId: license.edgeNodeId },
          ],
        },
        select: { id: true },
      })
      resolvedCameraId = cam?.id ?? null
    }

    if (!resolvedCameraId) {
      // Fallback: primeira câmera ativa deste edge node
      const edgeNode = await prisma.edgeNode.findUnique({
        where: { id: license.edgeNodeId },
        select: { cameras: { where: { active: true }, select: { id: true }, take: 1 } },
      })
      resolvedCameraId = edgeNode?.cameras?.[0]?.id ?? null
    }

    // ── Idempotência via frigateId ───────────────────────────────────────────
    const idempotencyKey = b.frigateId ?? null

    if (idempotencyKey) {
      // Tentar pelo índice composto (cameraId + idempotencyKey) quando cameraId está resolvido
      let existing: { id: string } | null = null

      if (resolvedCameraId) {
        existing = await prisma.analyticsEvent.findUnique({
          where: {
            AnalyticsEvent_camera_idempotency: {
              cameraId: resolvedCameraId,
              idempotencyKey,
            },
          },
          select: { id: true },
        })
      }

      // Fallback: busca por idempotencyKey isolado (cobre casos sem câmera mapeada)
      if (!existing) {
        existing = await prisma.analyticsEvent.findFirst({
          where: { idempotencyKey, cameraId: resolvedCameraId },
          select: { id: true },
        })
      }

      if (existing) {
        logger.debug({ eventId: existing.id, frigateId: idempotencyKey }, 'iacv_box_event_duplicate_skipped')
        res.json({ ok: true, eventId: existing.id, duplicate: true })
        return
      }
    }

    // ── Upload S3 (Zero-Trust) ───────────────────────────────────────────────
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
        cameraId: resolvedCameraId,           // null OK — cameraId é nullable agora
        model: 'PEOPLE_COUNTING',
        pipeline: 'EDGE_YOLO',
        eventType: 'IACV_BOX_DETECTION',
        severity: 'INFO',
        capturedAt: new Date(b.timestamp * 1000),
        processedAt: new Date(),
        occupancyCount: Math.round(b.objectCount),
        labelsJson: b.classes as any,
        idempotencyKey,
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

    // ── Comandos pendentes (EdgeCommand table) ────────────────────────────
    pendingCommands: await (prisma as any).edgeCommand.findMany({
      where: { edgeNodeId: node.id, ackedAt: null },
      orderBy: { issuedAt: 'asc' },
      select: { id: true, type: true, payload: true, issuedAt: true, createdById: true },
    }).then((cmds: any[]) => cmds.map((c: any) => ({
      id: c.id,
      type: c.type,
      payload: c.payload ?? {},
      issuedAt: c.issuedAt.toISOString(),
      createdById: c.createdById,
    }))).catch(() => [] as object[]),
    pendingCommandsCount: await (prisma as any).edgeCommand.count({
      where: { edgeNodeId: node.id, ackedAt: null },
    }).catch(() => 0),

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

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/:nodeId/commands   (enfileira comando Cloud → Box)
//
// Admin usa este endpoint para enviar comandos à Box.
// A Box drena no próximo heartbeat (GET /iacv-box/heartbeat → pendingCommands).
// ═════════════════════════════════════════════════════════════════════════════

const EnqueueCommandSchema = z.object({
  type:    z.enum(['RESTART_CAMERA', 'RELOAD_MODEL', 'FORCE_RESYNC', 'UPDATE_ZONES']),
  payload: z.record(z.unknown()).optional().default({}),
})

iacvBoxRouter.post('/:nodeId/commands', requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: req.params.nodeId },
    include: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
  })
  if (!node) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  if (jwt.role === 'INTEGRADOR_ADMIN' && node.site.clienteFinal.integradorId !== jwt.integradorId) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const parse = EnqueueCommandSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parse.error.errors })
    return
  }

  const cmd = await (prisma as any).edgeCommand.create({
    data: {
      edgeNodeId:  node.id,
      type:        parse.data.type,
      payload:     parse.data.payload,
      createdById: jwt.sub,
    },
  })

  logger.info({ cmdId: cmd.id, type: cmd.type, nodeId: node.id }, 'iacv_box_command_enqueued')

  res.status(201).json({
    id:        cmd.id,
    type:      cmd.type,
    payload:   cmd.payload,
    issuedAt:  cmd.issuedAt.toISOString(),
    message:   `Comando enfileirado. Será enviado à Box no próximo heartbeat (~60s).`,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/commands/:id/ack   (Box confirma que processou o comando)
//
// Endpoint público (sem requireAuth) — autenticado apenas pela licenseKey
// no body, como /heartbeat e /events.
// ═════════════════════════════════════════════════════════════════════════════

iacvBoxRouter.post('/commands/:id/ack', async (req: Request, res: Response) => {
  const { licenseKey } = req.body ?? {}
  if (!licenseKey) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'licenseKey obrigatória' })
    return
  }

  const license = await resolveLicense(licenseKey)
  if (!license) {
    res.status(403).json({ error: 'UNLICENSED' })
    return
  }

  const cmd = await (prisma as any).edgeCommand.findUnique({
    where: { id: req.params.id },
  })
  if (!cmd || cmd.edgeNodeId !== license.edgeNodeId) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  if (cmd.ackedAt) {
    res.json({ ok: true, alreadyAcked: true, ackedAt: cmd.ackedAt.toISOString() })
    return
  }

  const updated = await (prisma as any).edgeCommand.update({
    where: { id: cmd.id },
    data:  { ackedAt: new Date() },
  })

  logger.info({ cmdId: cmd.id, type: cmd.type, nodeId: license.edgeNodeId }, 'iacv_box_command_acked')

  res.json({ ok: true, ackedAt: updated.ackedAt.toISOString() })
})
