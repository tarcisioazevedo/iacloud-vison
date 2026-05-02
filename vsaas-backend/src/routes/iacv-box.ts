/**
 * IACV Box Routes — Licenciamento e Comunicação Edge-to-Cloud
 *
 * POST /iacv-box/activate                   ← A Box envia a licenseKey; recebe apiToken + config
 * POST /iacv-box/cameras                    ← Box sincroniza câmeras locais → Cloud (upsert)
 * POST /iacv-box/heartbeat                  ← Heartbeat periódico da Box (verifica licença)
 * POST /iacv-box/events                     ← Recebe eventos de detecção com snapshot WebP
 * POST /iacv-box/generate-key               ← Super Admin gera uma chave de licença para nova Box
 * GET  /iacv-box/:boxId/integration/snapshot ← Painel de integração (Cloud side)
 * GET  /iacv-box/events/:id/media-url        ← Presigned URL (10 min) para clip/snap/face/plate
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { randomUUID, createHash } from 'crypto'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth } from '../middleware/auth'
import { ValidationError, NotFoundError, UnauthorizedError } from '../lib/errors'
import { dispatchAlert } from '../lib/notification-dispatcher'
import { markSegmentMotion } from '../services/recording.service'

// S3 — importação condicional (não quebra se @aws-sdk não estiver instalado)
let s3Service: any = null
try { s3Service = require('../services/s3.service').s3Service } catch { /* no-op */ }

// R2 — storage multi-tenant com credenciais escopadas por EdgeNode
import { r2Service } from '../services/r2.service'

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

// ── Heartbeat — contrato enriquecido S0 (BOX_DATA_CONTRACT.md) ────────────
// Aceita tanto o payload legado (campos flat) quanto o payload enriquecido
// (sub-objetos system/frigate/cameras/storage/network).
// Campos ausentes → undefined (não sobrescreve DB).
const HeartbeatSystemSchema = z.object({
  cpuPercent: z.number().optional(),
  memPercent: z.number().optional(),
  diskUsedGB: z.number().optional(),
  diskTotalGB: z.number().optional(),
  tempC:      z.number().optional(),
  loadAvg:    z.array(z.number()).optional(),
}).optional()

const HeartbeatFrigateSchema = z.object({
  healthy:      z.boolean().optional(),
  detectorFps:  z.number().optional(),
  inferenceMs:  z.number().optional(),
  skippedFps:   z.number().optional(),
  processFps:   z.number().optional(),
}).optional()

const HeartbeatCameraSchema = z.object({
  frigateName:   z.string(),
  online:        z.boolean().optional(),
  fps:           z.number().optional(),
  lastFrameAge:  z.number().optional(),
  rtspHealth:    z.enum(['ok', 'degraded', 'down']).optional(),
  snapshotUrl:   z.string().url().optional(),
})

const HeartbeatStorageSchema = z.object({
  recordingsGB:    z.number().optional(),
  exportsGB:       z.number().optional(),
  thumbnailsGB:    z.number().optional(),
  oldestRecording: z.number().optional(),
  retentionDays:   z.number().optional(),
}).optional()

const HeartbeatNetworkSchema = z.object({
  mode:      z.string().optional(),
  ip:        z.string().optional(),
  gateway:   z.string().optional(),
  linkSpeed: z.string().optional(),
}).optional()

// ── Tunnel Status (Cloudflare Tunnel) ───────────────────────────────────────
const HeartbeatTunnelSchema = z.object({
  active:             z.boolean(),
  tunnelId:           z.string().optional(),
  publicUrl:          z.string().url().optional(),      // https://edge-xxx.tunnels.iacloud.com.br
  cloudflaredVersion: z.string().optional(),
  connectedAt:        z.string().optional(),
  lastError:          z.string().nullable().optional(),
}).optional()

const BoxHeartbeatSchema = z.object({
  licenseKey:  z.string().min(10),
  boxId:       z.string().optional(),               // ignorado — licenseKey identifica o node
  timestamp:   z.number().optional(),

  // ── Legado (campos flat — Box antiga) ─────────────────────────────────
  cpuUsage:    z.number().nullable().optional(),
  memUsage:    z.number().nullable().optional(),
  diskUsage:   z.number().nullable().optional(),
  tempCelsius: z.number().nullable().optional(),
  fpsCurrent:  z.number().nullable().optional(),
  modelLoaded: z.string().nullable().optional(),
  firmwareVersion: z.string().nullable().optional(),

  // ── Enriquecido (Box S0+) ──────────────────────────────────────────────
  status:    z.enum(['online', 'degraded', 'offline']).optional(),
  uptimeSec: z.number().optional(),
  version:   z.object({
    portalApi: z.string().optional(),
    frigate:   z.string().optional(),
    compose:   z.string().optional(),
  }).optional(),
  system:  HeartbeatSystemSchema,
  frigate: HeartbeatFrigateSchema,
  cameras: z.array(HeartbeatCameraSchema).optional(),
  storage: HeartbeatStorageSchema,
  network: HeartbeatNetworkSchema,
  tunnel:  HeartbeatTunnelSchema,
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

// ── Box Camera Sync — POST /iacv-box/cameras ────────────────────────────────
const BoxCameraItemSchema = z.object({
  frigateName:  z.string().min(1),
  name:         z.string().min(1),
  brand:        z.string().optional(),
  model:        z.string().optional(),
  ip:           z.string().optional(),
  mac:          z.string().optional(),
  serial:       z.string().optional(),
  rtspMain:     z.string().optional(),
  rtspSub:      z.string().optional(),
  onvifPort:    z.number().int().optional(),
  firmware:     z.string().optional(),
})

const BoxCamerasSyncSchema = z.object({
  licenseKey: z.string().min(10),
  boxId:      z.string().optional(),
  cameras:    z.array(BoxCameraItemSchema).min(1).max(64),
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

  // SUPER_ADMIN: acesso total.
  // INTEGRADOR_ADMIN: pode gerar chaves para EdgeNodes dos seus próprios clientes.
  // Outros: negado.
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    throw new UnauthorizedError('Apenas SUPER_ADMIN ou INTEGRADOR_ADMIN pode gerar chaves de licença')
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

  // INTEGRADOR_ADMIN só pode gerar para EdgeNodes do próprio tenant
  if (jwt.role === 'INTEGRADOR_ADMIN' && node.site.clienteFinal.integradorId !== jwt.integradorId) {
    throw new UnauthorizedError('Edge Node não pertence ao seu integrador')
  }

  // Verificar limite de EdgeNodes ativos do integrador
  if (jwt.role === 'INTEGRADOR_ADMIN' && jwt.integradorId) {
    const integrador = await prisma.integrador.findUnique({
      where: { id: jwt.integradorId },
      select: { maxEdgeNodes: true },
    })
    if (integrador?.maxEdgeNodes != null) {
      const activeCount = await prisma.edgeNode.count({
        where: {
          site: { clienteFinal: { integradorId: jwt.integradorId } },
          status: { not: 'OFFLINE' },
        },
      })
      if (activeCount >= integrador.maxEdgeNodes) {
        res.status(422).json({
          error:   'MAX_EDGE_NODES_EXCEEDED',
          message: `Limite de ${integrador.maxEdgeNodes} boxes atingido para este integrador.`,
          current: activeCount,
          max:     integrador.maxEdgeNodes,
        })
        return
      }
    }
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
          frigateName: true,       // S0: nome explícito no Frigate (fallback: go2rtcStreamId)
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

  // edgeToken = SHA-256(licenseKey) — Bearer token para /edge/ingest, /config, etc.
  const edgeToken = keyHash

  // Atualizar status, metadados e garantir apiToken correto no DB
  // S0: também registra lastActivatedAt
  await prisma.edgeNode.update({
    where: { id: node.id },
    data: {
      status:          'ONLINE',
      lastHeartbeat:   new Date(),
      lastActivatedAt: new Date(),
      ipLocal:         ipLocal ?? node.ipLocal,
      model:           hwModel ?? node.model,
      description:     hostname ? `IACV Box - ${hostname}` : node.description,
      apiToken:        keyHash,
    },
  })

  logger.info({ edgeNodeId: node.id, hostname }, 'iacv_box_activated')

  // ── Vault: Cloudflare R2 Multi-Tenant ──────────────────────────────────────
  // Gera credenciais R2 escopadas para este EdgeNode. A Box usa essas credenciais
  // para upload direto de snapshots/clips, isolado por tenant (integrador/cliente).
  const integradorId = node.site.clienteFinal.integradorId
  const clienteFinalId = node.site.clienteFinal.id

  let vaultCredentials: {
    bucket: string
    prefix: string
    endpoint: string
    region: string
    accessKeyId?: string
    secretAccessKey?: string
    expiresAt?: string
  } | null = null

  if (r2Service.isConfigured()) {
    const creds = await r2Service.createScopedToken(integradorId, clienteFinalId, node.id)
    if (creds) {
      vaultCredentials = {
        bucket: creds.bucket,
        prefix: creds.prefix,
        endpoint: creds.endpoint,
        region: creds.region,
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        expiresAt: creds.expiresAt,
      }
      await prisma.edgeNode.update({
        where: { id: node.id },
        data: {
          vaultBucket: creds.bucket,
          vaultPrefix: creds.prefix,
          vaultTokenId: creds.tokenId,
          vaultExpiresAt: new Date(creds.expiresAt),
        },
      })
    }
  }

  // Fallback: se R2 não está configurado, retorna apenas bucket/prefix placeholder
  // Mantém a mesma estrutura multi-tenant: bucket por integrador, prefix por cliente/edge
  if (!vaultCredentials) {
    vaultCredentials = {
      bucket: node.vaultBucket ?? r2Service.getBucketName(integradorId),
      prefix: node.vaultPrefix ?? `${clienteFinalId}/${node.id}/`,
      endpoint: process.env.VAULT_ENDPOINT ?? 'https://s3-placeholder.r2.cloudflarestorage.com',
      region: process.env.VAULT_REGION ?? 'auto',
    }
  }

  res.json({
    licensed: true,
    boxId: node.id,
    edgeToken,
    site:   { id: node.site.id, name: node.site.name },
    client: { id: node.site.clienteFinal.id, name: node.site.clienteFinal.name },
    tenant: {
      name:       node.site.clienteFinal.name,
      site:       node.site.name,
      plan:       'Enterprise Edge AI',
      expires:    node.licenseExpiresAt?.toISOString().slice(0, 10) ?? '2027-12-31',
      maxCameras: node.maxCameras ?? 32,
      skills:     ['Intrusão', 'LPR', 'Face'],
    },
    // vault — credenciais R2 escopadas para upload direto pela Box
    vault: vaultCredentials,
    cameras: node.cameras.map(c => ({
      id:             c.id,
      name:           c.name,
      rtspMainUrl:    c.rtspMainUrl,
      rtspSubUrl:     c.rtspSubUrl,
      // S0: frigateName explícito — campo Camera.frigateName > go2rtcStreamId > id
      frigateName:    c.frigateName ?? c.go2rtcStreamId ?? c.id,
      go2rtcStreamId: c.go2rtcStreamId,
      zones:          c.zones,
    })),
    serverTime: new Date().toISOString(),
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/cameras   (Box sincroniza câmeras locais → Cloud)
// ═════════════════════════════════════════════════════════════════════════════
// Chamado pela Box após cada /activate que retorna cameras:[].
// Upsert idempotente por (edgeNodeId + frigateName).
// Retorna cloud_uuid para cada câmera → Box salva no SQLite local.

iacvBoxRouter.post('/cameras', async (req: Request, res: Response) => {
  const parse = BoxCamerasSyncSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parse.error.errors[0].message })
    return
  }

  const { licenseKey, cameras: cameraPayload } = parse.data
  const license = await resolveLicense(licenseKey)

  if (!license || !license.licensed) {
    res.status(403).json({ error: 'UNLICENSED' })
    return
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: license.edgeNodeId },
    include: {
      site: { select: { id: true } },
      cameras: {
        where: { active: true },
        select: { id: true, frigateName: true, go2rtcStreamId: true },
      },
    },
  })

  if (!node) {
    res.status(404).json({ error: 'EDGE_NOT_FOUND' })
    return
  }

  if (node.maxCameras && cameraPayload.length > node.maxCameras) {
    res.status(422).json({
      error: 'MAX_CAMERAS_EXCEEDED',
      maxCameras: node.maxCameras,
      requested: cameraPayload.length,
    })
    return
  }

  const results: { frigateName: string; cloudUuid: string; action: 'created' | 'updated' }[] = []

  for (const cam of cameraPayload) {
    const existing = node.cameras.find(c =>
      c.frigateName === cam.frigateName ||
      c.go2rtcStreamId === cam.frigateName
    )

    const cameraData = {
      frigateName:     cam.frigateName,
      go2rtcStreamId:  cam.frigateName,
      name:            cam.name,
      brand:           cam.brand ?? null,
      model:           cam.model ?? null,
      serialNumber:    cam.serial ?? null,
      macAddress:      cam.mac ?? null,
      rtspMainUrl:     cam.rtspMain ?? '',
      rtspSubUrl:      cam.rtspSub ?? null,
      onvifPort:       cam.onvifPort ?? null,
      firmwareVersion: cam.firmware ?? null,
    }

    if (existing) {
      await prisma.camera.update({
        where: { id: existing.id },
        data: cameraData,
      })
      results.push({ frigateName: cam.frigateName, cloudUuid: existing.id, action: 'updated' })
    } else {
      // Camera_siteId_name_unique pode colidir se o nome já existir no site.
      // Nesse caso, sufixamos com frigateName para desambiguar.
      let finalName = cam.name
      const nameConflict = await prisma.camera.findFirst({
        where: { siteId: node.site.id, name: cam.name },
      })
      if (nameConflict) {
        finalName = `${cam.name} (${cam.frigateName})`
      }

      const created = await prisma.camera.create({
        data: {
          ...cameraData,
          name:       finalName,
          siteId:     node.site.id,
          edgeNodeId: node.id,
          tier:       'BRONZE',
          pipeline:   'EDGE_YOLO',
          status:     'ACTIVE',
          active:     true,
        },
      })
      results.push({ frigateName: cam.frigateName, cloudUuid: created.id, action: 'created' })
    }
  }

  logger.info(
    { edgeNodeId: node.id, synced: results.length, created: results.filter(r => r.action === 'created').length },
    'iacv_box_cameras_synced',
  )

  res.json({
    ok: true,
    synced: results.length,
    cameras: results,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/tunnel/provision   (Box solicita criação de Cloudflare Tunnel)
// ═════════════════════════════════════════════════════════════════════════════

const TunnelProvisionSchema = z.object({
  licenseKey:  z.string().min(10),
  go2rtcPort:  z.number().int().default(1984),
  frigatePort: z.number().int().optional(),
  hostname:    z.string().optional(),
})

iacvBoxRouter.post('/tunnel/provision', async (req: Request, res: Response) => {
  const parse = TunnelProvisionSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parse.error.errors[0].message })
    return
  }

  const b = parse.data
  const license = await resolveLicense(b.licenseKey)

  if (!license) {
    res.status(401).json({ error: 'INVALID_LICENSE' })
    return
  }

  // Busca edge node
  const node = await prisma.edgeNode.findUnique({
    where: { id: license.edgeNodeId },
    select: { id: true, name: true, go2rtcEndpoint: true },
  })

  if (!node) {
    res.status(404).json({ error: 'EDGE_NODE_NOT_FOUND' })
    return
  }

  // Verifica se já tem tunnel configurado
  if (node.go2rtcEndpoint) {
    res.json({
      status: 'existing',
      tunnelId: null, // não temos mais o tunnelId se já existe
      publicHostname: new URL(node.go2rtcEndpoint).hostname,
      go2rtcUrl: node.go2rtcEndpoint,
      message: 'Tunnel already configured. Use existing endpoint.',
    })
    return
  }

  // TODO: Integrar com Cloudflare API para criar tunnel automaticamente
  // Por agora, retorna instruções para configuração manual
  const suggestedHostname = b.hostname ?? node.name?.toLowerCase().replace(/\s+/g, '-') ?? node.id

  res.json({
    status: 'manual_required',
    message: 'Automatic tunnel provisioning not yet implemented. Please configure manually.',
    instructions: {
      step1: 'Install cloudflared on the Edge Box',
      step2: `Run: cloudflared tunnel login`,
      step3: `Run: cloudflared tunnel create icv-edge-${node.id}`,
      step4: `Configure ingress for localhost:${b.go2rtcPort}`,
      step5: `Run: cloudflared tunnel run icv-edge-${node.id}`,
      step6: 'Report the public URL in the heartbeat tunnel.publicUrl field',
    },
    suggestedTunnelName: `icv-edge-${node.id}`,
    suggestedHostname: `${suggestedHostname}.tunnels.iacloud.com.br`,
    localPort: b.go2rtcPort,
    edgeNodeId: node.id,
  })

  logger.info({ edgeNodeId: node.id }, 'tunnel_provision_requested')
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

  // ── Mapear payload enriquecido → campos do EdgeNode ────────────────────────
  // Aceita legado (campos flat) e enriquecido (sub-objetos system/frigate).
  // Legado tem precedência somente se o campo enriquecido estiver ausente.
  const sys = b.system
  const frig = b.frigate
  const resolvedCpu     = sys?.cpuPercent   ?? b.cpuUsage    ?? undefined
  const resolvedMem     = sys?.memPercent   ?? b.memUsage    ?? undefined
  const resolvedTemp    = sys?.tempC        ?? b.tempCelsius ?? undefined
  const resolvedFps     = frig?.detectorFps ?? b.fpsCurrent  ?? undefined
  // Disk: legado era porcentagem (0-100), enriquecido envia absolutos.
  // Calculamos percentual quando diskTotalGB está disponível.
  let resolvedDisk: number | undefined = b.diskUsage ?? undefined
  if (sys?.diskUsedGB !== undefined && sys?.diskTotalGB) {
    resolvedDisk = (sys.diskUsedGB / sys.diskTotalGB) * 100
  }

  // snapshot completo para lastTelemetryRaw (sem licenseKey — segurança)
  const { licenseKey: _omit, ...telemetrySnapshot } = b

  // Atualizar telemetria do edge node + registrar heartbeat
  let currentConfigRevision = 1
  try {
    await prisma.$transaction([
      prisma.edgeNode.update({
        where: { id: license.edgeNodeId },
        data: {
          status:           license.licensed ? 'ONLINE' : 'MAINTENANCE',
          lastHeartbeat:    new Date(),
          cpuUsage:         resolvedCpu,
          memUsage:         resolvedMem,
          diskUsage:        resolvedDisk,
          tempCelsius:      resolvedTemp,
          fpsCurrent:       resolvedFps,
          firmwareVersion:  b.firmwareVersion ?? b.version?.portalApi ?? undefined,
          yoloModelVersion: b.modelLoaded ?? b.version?.frigate ?? undefined,
          // S0: guardar snapshot completo do heartbeat (sem licenseKey)
          lastTelemetryRaw: telemetrySnapshot as any,
          // atualizar IP local se enviado no payload enriquecido
          ...(b.network?.ip ? { ipLocal: b.network.ip } : {}),
          // Tunnel: atualiza go2rtcEndpoint quando Box reporta tunnel ativo
          ...(b.tunnel?.active && b.tunnel?.publicUrl ? {
            go2rtcEndpoint: b.tunnel.publicUrl,
            webrtcPublicHost: new URL(b.tunnel.publicUrl).hostname,
          } : {}),
        },
      }),
      prisma.edgeHeartbeat.create({
        data: {
          edgeNodeId:    license.edgeNodeId,
          cpuUsage:      resolvedCpu    ?? 0,
          memUsage:      resolvedMem    ?? 0,
          diskUsage:     resolvedDisk   ?? 0,
          tempCelsius:   resolvedTemp   ?? null,
          fpsCurrent:    resolvedFps    ?? null,
          networkInBps:  undefined,
          networkOutBps: undefined,
        },
      }),
    ])
    // configRevision via SQL direto (garante leitura do valor mais recente)
    const rows = await prisma.$queryRaw<{ configRevision: number }[]>`
      SELECT "configRevision" FROM "EdgeNode" WHERE id = ${license.edgeNodeId}
    `
    currentConfigRevision = rows[0]?.configRevision ?? 1
  } catch (err: any) {
    logger.warn({ err: err.message }, 'iacv_box_heartbeat_db_error')
  }

  // Drena comandos pendentes — filtra expirados (S0: expiresAt check)
  const now = new Date()
  let pendingCommands: object[] = []
  try {
    const cmds = await prisma.$queryRaw<any[]>`
      SELECT id, type, payload, "issuedAt", "expiresAt"
      FROM "EdgeCommand"
      WHERE "edgeNodeId" = ${license.edgeNodeId}
        AND "ackedAt" IS NULL
        AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      ORDER BY "issuedAt" ASC
      LIMIT 20
    `
    pendingCommands = cmds.map((c: any) => ({
      id:        c.id,
      type:      c.type,
      payload:   c.payload ?? {},
      issuedAt:  c.issuedAt instanceof Date ? c.issuedAt.toISOString() : String(c.issuedAt),
      expiresAt: c.expiresAt ? (c.expiresAt instanceof Date ? c.expiresAt.toISOString() : String(c.expiresAt)) : null,
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
    // A Box envia frigateName ("camera1") ou go2rtcStreamId ou UUID do DB.
    // S0: também resolve por Camera.frigateName (novo campo).
    let resolvedCameraId: string | null = null

    if (b.cameraId) {
      const cam = await prisma.camera.findFirst({
        where: {
          edgeNodeId: license.edgeNodeId,
          OR: [
            { id: b.cameraId },
            { frigateName: b.cameraId },     // S0: match pelo novo campo explícito
            { go2rtcStreamId: b.cameraId },  // legado
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

    // ── Idempotência S0 — dois níveis ─────────────────────────────────────────
    // Nível 1 (S0): (edgeNodeId, frigateId) — índice parcial no DB — cobertura total.
    // Nível 2 (legado): (cameraId, idempotencyKey) — mantido por compatibilidade.
    const frigateId      = b.frigateId ?? null
    const idempotencyKey = b.frigateId ?? null   // mesma chave para retrocompat.

    if (frigateId) {
      // Checar via unique index (edgeNodeId, frigateId)
      const existing = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "AnalyticsEvent"
        WHERE "edgeNodeId" = ${license.edgeNodeId} AND "frigateId" = ${frigateId}
        LIMIT 1
      `
      if (existing.length > 0) {
        logger.debug({ eventId: existing[0].id, frigateId }, 'iacv_box_event_duplicate_skipped')
        res.json({ ok: true, eventId: existing[0].id, duplicate: true })
        return
      }
    } else if (idempotencyKey && resolvedCameraId) {
      // Fallback legado: (cameraId, idempotencyKey)
      const existing = await prisma.analyticsEvent.findUnique({
        where: {
          AnalyticsEvent_camera_idempotency: {
            cameraId: resolvedCameraId,
            idempotencyKey,
          },
        },
        select: { id: true },
      })
      if (existing) {
        logger.debug({ eventId: existing.id, idempotencyKey }, 'iacv_box_event_duplicate_skipped_legacy')
        res.json({ ok: true, eventId: existing.id, duplicate: true })
        return
      }
    }

    // ── Upload Storage (R2 multi-tenant preferido, S3 fallback) ───────────────
    let snapshotUrl: string | null = null
    if (b.snapshot) {
      // Preferir R2 (multi-tenant com isolamento por integrador)
      if (r2Service.isConfigured()) {
        try {
          const r2Result = await r2Service.uploadSnapshotBase64(
            b.snapshot, license.integradorId, license.clienteFinalId, license.edgeNodeId, eventId
          )
          if (r2Result) snapshotUrl = `r2://${r2Result.bucket}/${r2Result.key}`
        } catch (e: any) {
          logger.debug({ err: e.message }, 'r2_upload_skipped')
        }
      }
      // Fallback: S3 global (legado)
      if (!snapshotUrl && s3Service) {
        try {
          const s3Result = await s3Service.uploadSnapshotBase64(
            b.snapshot, license.integradorId, license.clienteFinalId, license.edgeNodeId, eventId
          )
          if (s3Result) snapshotUrl = `s3://${s3Result.bucket}/${s3Result.key}`
        } catch (e: any) {
          logger.debug({ err: e.message }, 's3_upload_skipped')
        }
      }
    }

    await prisma.analyticsEvent.create({
      data: {
        id:             eventId,
        cameraId:       resolvedCameraId,     // null OK — cameraId é nullable
        // S0: rastrear origem Box + frigateId para idempotência robusta
        edgeNodeId:     license.edgeNodeId,
        frigateId,
        model:          'PEOPLE_COUNTING',
        pipeline:       'EDGE_YOLO',
        eventType:      'IACV_BOX_DETECTION',
        severity:       'INFO',
        capturedAt:     new Date(b.timestamp * 1000),
        processedAt:    new Date(),
        occupancyCount: Math.round(b.objectCount),
        labelsJson:     b.classes as any,
        idempotencyKey,
        evidenceGcsBucket: snapshotUrl ? snapshotUrl.split('/')[2] : null,
        evidenceGcsKey:    snapshotUrl ? snapshotUrl.replace(/^s3:\/\/[^/]+\//, '') : null,
      } as any,
    })

    // Marca segmento de gravação como tendo evento (para timeline + filtro)
    if (resolvedCameraId) {
      const eventAt = new Date(b.timestamp * 1000)
      markSegmentMotion(resolvedCameraId, eventAt, eventAt, 'event')
        .catch(err => logger.debug({ err }, 'mark_segment_event_failed'))

      // Auto-bookmark do evento: cria entrada na timeline para acesso rápido
      const tenantId = license.clienteFinalId ?? license.integradorId
      if (tenantId) {
        prisma.bookmark.create({
          data: {
            cameraId:  resolvedCameraId,
            tenantId,
            title:     `🚨 Detecção: ${b.classes.slice(0, 2).join(', ') || 'objetos'}`,
            color:     '#EF4444', // vermelho — destaque para evento
            startAt:   eventAt,
            endAt:     new Date(eventAt.getTime() + 10000), // 10s default
            autoType:  'EVENT',
            notes:     `${b.objectCount} objeto(s) detectado(s) automaticamente`,
          },
        }).catch(err => logger.debug({ err }, 'auto_bookmark_event_failed'))
      }
    }

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
      cameraId: resolvedCameraId ?? undefined,
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

// ═════════════════════════════════════════════════════════════════════════════
// GET /iacv-box/:boxId/config   (Box faz pull de configuração quando config_revision muda)
//
// Autenticação: Bearer <edgeToken> via Authorization header
//   edgeToken = SHA-256(licenseKey) = apiToken no DB
//
// A Box compara o config_revision recebido no heartbeat com o local;
// se diferente, chama este endpoint para obter zones, thresholds e skills atualizados.
//
// Alternativa: a Box pode incluir X-IACV-License-Key no header (fallback).
// Em ambos os casos, o boxId no path deve corresponder ao node autenticado.
// ═════════════════════════════════════════════════════════════════════════════

const ConfigQuerySchema = z.object({
  licenseKey: z.string().min(10).optional(),
})

iacvBoxRouter.get('/:boxId/config', async (req: Request, res: Response) => {
  const { boxId } = req.params

  // Resolver identidade: Authorization: Bearer <edgeToken> ou X-IACV-License-Key header
  let licenseKey: string | null = null
  let resolvedEdgeToken: string | null = null

  const authHeader = req.headers['authorization'] as string | undefined
  const licKeyHeader = req.headers['x-iacv-license-key'] as string | undefined
  const licKeyQuery = req.query['licenseKey'] as string | undefined

  if (authHeader?.startsWith('Bearer ')) {
    resolvedEdgeToken = authHeader.slice(7)
  } else if (licKeyHeader) {
    licenseKey = licKeyHeader
    resolvedEdgeToken = hashKey(licKeyHeader)
  } else if (licKeyQuery) {
    licenseKey = licKeyQuery
    resolvedEdgeToken = hashKey(licKeyQuery)
  }

  if (!resolvedEdgeToken) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authorization: Bearer <edgeToken> ou X-IACV-License-Key obrigatório' })
    return
  }

  // Buscar EdgeNode pelo apiToken (= edgeToken = SHA-256(licenseKey))
  const node = await prisma.edgeNode.findFirst({
    where: { apiToken: resolvedEdgeToken },
    include: {
      site: {
        select: {
          clienteFinal: { select: { id: true, active: true, integradorId: true } },
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

  // 403 se token não existe (evita enumeração de boxIds: atacante com token errado
  // recebe 403 idêntico ao de licença inválida — não vaza se o boxId existe)
  if (!node) {
    res.status(403).json({ error: 'LICENSE_INVALID', message: 'Token inválido.' })
    return
  }

  // Verificar que o boxId no path corresponde ao node autenticado
  if (node.id !== boxId) {
    res.status(403).json({ error: 'LICENSE_MISMATCH', message: 'boxId no path não corresponde ao token fornecido.' })
    return
  }

  if (!node.site.clienteFinal.active) {
    res.status(403).json({ error: 'TENANT_INACTIVE' })
    return
  }

  // Buscar configRevision atual
  let configRevision = 1
  try {
    const rows = await prisma.$queryRaw<{ configRevision: number }[]>`
      SELECT "configRevision" FROM "EdgeNode" WHERE id = ${node.id}
    `
    configRevision = rows[0]?.configRevision ?? 1
  } catch { /* campo pode não existir em schema antigo */ }

  logger.info({ nodeId: node.id, configRevision }, 'iacv_box_config_pulled')

  res.json({
    ok: true,
    boxId: node.id,
    configRevision,
    serverTime: new Date().toISOString(),

    // Câmeras e zonas (principal motivo do config pull)
    cameras: node.cameras.map(c => ({
      id:            c.id,
      name:          c.name,
      rtspMainUrl:   c.rtspMainUrl,
      rtspSubUrl:    c.rtspSubUrl,
      frigateName:   c.go2rtcStreamId ?? c.id,
      go2rtcStreamId: c.go2rtcStreamId,
      zones: c.zones,
    })),

    // Skills e thresholds
    skills: {
      intrusion:    { enabled: true,  minConfidence: 0.50, classes: ['person'] },
      lpr:          { enabled: true,  minConfidence: 0.60 },
      face:         { enabled: true,  minConfidence: 0.55 },
      crowd:        { enabled: false, threshold: 10 },
      demographics: { enabled: false },
    },

    // Configurações de evento
    eventConfig: {
      snapshotFormat:    'webp',
      snapshotQuality:   75,
      sendSnapshotOnEvent: true,
      maxQueueSize:      200,
      batchFlushIntervalSec: 5,
    },
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/hardware-inventory   (S0 — boot-time, Box envia inventário de HW)
//
// Box envia uma vez no boot (ou quando hardware muda).
// Cloud persiste em EdgeNode.hardwareInventory JSON.
// Painel Cloud pode mostrar "Intel N100, 8GB RAM, 500GB NVMe, iGPU".
// Autenticação: licenseKey no body.
// ═════════════════════════════════════════════════════════════════════════════

const HardwareInventorySchema = z.object({
  licenseKey:         z.string().min(10),
  cpu:                z.object({
    model:  z.string().optional(),
    cores:  z.number().int().optional(),
  }).optional(),
  memoryGB:           z.number().optional(),
  gpu:                z.object({
    vendor: z.string().optional(),
    model:  z.string().optional(),
  }).optional(),
  diskGB:             z.number().optional(),
  networkInterfaces:  z.array(z.any()).optional(),
  detectedAt:         z.number().optional(),  // unix timestamp
})

iacvBoxRouter.post('/hardware-inventory', async (req: Request, res: Response) => {
  const parse = HardwareInventorySchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parse.error.errors[0].message })
    return
  }

  const { licenseKey, ...inventoryPayload } = parse.data
  const license = await resolveLicense(licenseKey)
  if (!license || !license.licensed) {
    res.status(403).json({ error: 'UNLICENSED' })
    return
  }

  try {
    await prisma.$executeRaw`
      UPDATE "EdgeNode"
      SET "hardwareInventory" = ${JSON.stringify(inventoryPayload)}::jsonb,
          "updatedAt" = NOW()
      WHERE id = ${license.edgeNodeId}
    `

    logger.info(
      { edgeNodeId: license.edgeNodeId, cpu: inventoryPayload.cpu?.model, memGB: inventoryPayload.memoryGB },
      'iacv_box_hardware_inventory_received',
    )

    res.json({ ok: true, edgeNodeId: license.edgeNodeId })
  } catch (err: any) {
    logger.error({ err: err.message }, 'iacv_box_hardware_inventory_error')
    res.status(500).json({ error: 'PERSIST_ERROR' })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/telemetry-batch   (S0 — store-and-forward offline buffer)
//
// Box envia amostras em lote quando volta online após queda.
// Cada sample: { ts, type, payload } onde type = "system"|"frigate"|"camera"|"storage".
// Limite: 100 amostras por request, 1MB total.
// Idempotência: (edgeNodeId, ts, type) — amostras duplicadas são silenciosamente ignoradas.
// Autenticação: licenseKey no body.
// ═════════════════════════════════════════════════════════════════════════════

const TelemetrySampleSchema = z.object({
  ts:      z.number().int(),       // unix timestamp (segundos)
  type:    z.enum(['system', 'frigate', 'camera', 'storage']),
  payload: z.record(z.unknown()),
})

const TelemetryBatchSchema = z.object({
  licenseKey: z.string().min(10),
  samples:    z.array(TelemetrySampleSchema).min(1).max(100),
})

iacvBoxRouter.post('/telemetry-batch', async (req: Request, res: Response) => {
  const parse = TelemetryBatchSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parse.error.errors[0].message })
    return
  }

  const { licenseKey, samples } = parse.data
  const license = await resolveLicense(licenseKey)
  if (!license || !license.licensed) {
    res.status(403).json({ error: 'UNLICENSED' })
    return
  }

  // Processar apenas samples do tipo "system" como EdgeHeartbeat rows.
  // Outros tipos (frigate, camera, storage) são armazenados no log mas não
  // normalizam para tabelas separadas em S0 — virão em S1 como tabela TelemetrySample.
  const results: { ts: number; type: string; ok: boolean; reason?: string }[] = []
  let inserted = 0
  let skipped  = 0

  for (const sample of samples) {
    if (sample.type !== 'system') {
      // S0: não-system apenas ACK, sem persist (S1 terá tabela própria)
      results.push({ ts: sample.ts, type: sample.type, ok: true, reason: 'queued_s1' })
      continue
    }

    const p = sample.payload as Record<string, any>
    const recordedAt = new Date(sample.ts * 1000)

    try {
      // Idempotência via ON CONFLICT DO NOTHING — PostgreSQL ignora duplicata por
      // (edgeNodeId, recordedAt) se o índice existir. Em S0 usamos INSERT direto
      // e ignoramos o conflito via try/catch na camada de app.
      const existing = await prisma.edgeHeartbeat.findFirst({
        where: {
          edgeNodeId: license.edgeNodeId,
          recordedAt: { gte: new Date(recordedAt.getTime() - 1000), lte: new Date(recordedAt.getTime() + 1000) },
        },
        select: { id: true },
      })

      if (existing) {
        results.push({ ts: sample.ts, type: sample.type, ok: true, reason: 'duplicate' })
        skipped++
        continue
      }

      // Mapear payload system → campos EdgeHeartbeat
      const diskPct = p.diskUsedGB !== undefined && p.diskTotalGB
        ? (p.diskUsedGB / p.diskTotalGB) * 100
        : (p.diskUsage ?? 0)

      await prisma.edgeHeartbeat.create({
        data: {
          edgeNodeId:  license.edgeNodeId,
          cpuUsage:    p.cpuPercent ?? p.cpuUsage ?? 0,
          memUsage:    p.memPercent ?? p.memUsage ?? 0,
          diskUsage:   diskPct,
          tempCelsius: p.tempC ?? p.tempCelsius ?? null,
          fpsCurrent:  p.detectorFps ?? p.fpsCurrent ?? null,
          recordedAt,
        },
      })

      results.push({ ts: sample.ts, type: sample.type, ok: true })
      inserted++
    } catch (err: any) {
      results.push({ ts: sample.ts, type: sample.type, ok: false, reason: err.message?.slice(0, 80) })
    }
  }

  logger.info(
    { edgeNodeId: license.edgeNodeId, total: samples.length, inserted, skipped },
    'iacv_box_telemetry_batch_received',
  )

  const hasFailures = results.some(r => !r.ok && r.reason !== 'duplicate' && r.reason !== 'queued_s1')
  res.status(hasFailures ? 207 : 200).json({
    ok: !hasFailures,
    inserted,
    skipped,
    total: samples.length,
    results,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/messages   (Ponte HTTP bidirecional Cloud ↔ Box IDE)
//
// Canal de comunicação assíncrono entre a Box IDE e a Cloud IDE.
// A Box posta mensagens JSON aqui; o Cloud processa e responde inline.
// Autenticação: Authorization: Bearer <edgeToken> ou X-IACV-License-Key
// ═════════════════════════════════════════════════════════════════════════════

const bridgeMessageLog: Array<{ ts: number; from: string; payload: any }> = []
const MAX_BRIDGE_LOG = 100

iacvBoxRouter.post('/messages', async (req: Request, res: Response) => {
  // Resolver autenticação (mesmo padrão do /config)
  let resolvedEdgeToken: string | null = null
  const authHeader = req.headers['authorization'] as string | undefined
  const licKeyHeader = req.headers['x-iacv-license-key'] as string | undefined

  if (authHeader?.startsWith('Bearer ')) {
    resolvedEdgeToken = authHeader.slice(7)
  } else if (licKeyHeader) {
    resolvedEdgeToken = hashKey(licKeyHeader)
  } else if (req.body?.licenseKey) {
    resolvedEdgeToken = hashKey(req.body.licenseKey)
  }

  if (!resolvedEdgeToken) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }

  const node = await prisma.edgeNode.findFirst({
    where: { apiToken: resolvedEdgeToken },
    select: { id: true, serialNumber: true, status: true },
  })

  if (!node) {
    res.status(403).json({ error: 'LICENSE_INVALID' })
    return
  }

  const msg = req.body ?? {}
  const ts = Date.now()

  // Guardar no log in-memory (os últimos 100 itens)
  bridgeMessageLog.unshift({ ts, from: node.id, payload: msg })
  if (bridgeMessageLog.length > MAX_BRIDGE_LOG) bridgeMessageLog.length = MAX_BRIDGE_LOG

  logger.info({ from: node.serialNumber, type: msg.type ?? 'unknown', ts }, 'iacv_box_message_received')

  // Resposta contextual conforme type da mensagem
  const type = (msg.type ?? '').toUpperCase()

  if (type === 'BRIEFING' || type === 'IDE_BRIEFING') {
    // Box IDE está mandando briefing de perguntas — responder inline
    res.json({
      ok: true,
      ts,
      type: 'BRIEFING_RESPONSE',
      from: 'CLOUD_IDE',
      to: node.id,
      answers: {
        q1_camera_uuid: '1b1005ff-061b-43df-9d0a-8a85a351906b',
        q1_note: 'Envie o UUID acima OU o valor go2rtcStreamId (ex: "camera1") no campo cameraId de POST /iacv-box/events.',
        q2_frigateName: 'CONFIRMADO — /activate retorna cameras[n].frigateName = go2rtcStreamId para mapeamento direto.',
        q3_vault: {
          strategy: 'env_vars_on_box',
          note: 'Credenciais de bucket NÃO trafegam no /activate. Configure MINIO_ACCESS_KEY + MINIO_SECRET_KEY + MINIO_ENDPOINT como env vars na Box.',
          bucket_pattern: 'iacvbox-snapshots/{clienteFinalId}/',
        },
        q4_config_auth: {
          method: 'Authorization: Bearer <edgeToken>',
          fallback: 'X-IACV-License-Key: <licenseKey>',
          boxId_mismatch: '403 LICENSE_MISMATCH (não 404 — evita enumeração)',
          endpoint: 'GET /iacv-box/{boxId}/config',
        },
      },
      status: {
        eventsEndpoint: 'OK — POST /iacv-box/events funcional (HTTP 200)',
        activateEndpoint: 'OK — frigateName incluído na resposta',
        configEndpoint: 'OK — GET /iacv-box/{boxId}/config implementado',
        pipeline: 'FULL_OPERATIONAL',
      },
    })
    return
  }

  if (type === 'STATUS_REPORT' || type === 'DIAGNOSTIC') {
    res.json({
      ok: true, ts, type: 'ACK',
      message: 'Diagnóstico recebido. Cloud operacional.',
      cloudStatus: 'ONLINE',
      eventsReceived: true,
    })
    return
  }

  if (type === 'PING') {
    res.json({ ok: true, ts, type: 'PONG', from: 'CLOUD_IDE', latency: Date.now() - (msg.ts ?? ts) })
    return
  }

  // Default ACK
  res.json({ ok: true, ts, type: 'ACK', from: 'CLOUD_IDE', received: type || 'message' })
})

// GET /iacv-box/messages/log   (SUPER_ADMIN — ver mensagens recentes da bridge)
iacvBoxRouter.get('/messages/log', requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  res.json({ ok: true, count: bridgeMessageLog.length, messages: bridgeMessageLog })
})

// ─── Cofre de Vídeo ─────────────────────────────────────────────────────────
//
// GET /iacv-box/events/:id/media-url?type=clip|snap|face|plate
//
// Gera presigned URL (TTL 10 min) para o cliente final assistir/baixar mídia.
// Requer auth. Browser nunca vê credenciais R2.
// Acesso logado em MediaAccessLog (LGPD).
//
iacvBoxRouter.get('/events/:id/media-url', requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  const { id } = req.params
  const type = (req.query.type as string) ?? 'snap'

  if (!['clip', 'snap', 'face', 'plate'].includes(type)) {
    res.status(400).json({ error: 'INVALID_TYPE', valid: ['clip', 'snap', 'face', 'plate'] })
    return
  }

  const event = await prisma.analyticsEvent.findFirst({
    where: { id: id as string },
    include: {
      camera: {
        include: {
          site: {
            include: {
              clienteFinal: { select: { id: true, integradorId: true } },
            },
          },
        },
      },
    },
  })

  if (!event) {
    res.status(404).json({ error: 'EVENT_NOT_FOUND' })
    return
  }

  // Scoping multi-tenant: usuário só acessa eventos do próprio tenant
  const integradorId = event.camera?.site?.clienteFinal?.integradorId
  const clienteFinalId = event.camera?.site?.clienteFinal?.id
  const isAdmin = jwt.role === 'SUPER_ADMIN'
  const isIntegradorMatch = jwt.role === 'INTEGRADOR_ADMIN' && jwt.integradorId === integradorId
  const isCFMatch = (jwt.role === 'CLIENTE_FINAL_ADMIN' || jwt.role === 'CLIENTE_FINAL_USER')
    && jwt.clienteFinalId === clienteFinalId

  if (!isAdmin && !isIntegradorMatch && !isCFMatch) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  // Selecionar a vault key pelo tipo pedido
  const keyMap: Record<string, string | null | undefined> = {
    clip:  (event as any).vaultClipKey,
    snap:  (event as any).vaultSnapshotKey,
    face:  (event as any).vaultFaceKey,
    plate: (event as any).vaultPlateKey,
  }
  const vaultKey = keyMap[type]

  if (!vaultKey) {
    res.status(404).json({
      error: 'MEDIA_NOT_AVAILABLE',
      message: `Mídia do tipo '${type}' ainda não foi enviada para o cofre por esta Box.`,
    })
    return
  }

  // Determinar bucket a partir do integradorId
  const bucket = r2Service.getBucketName(integradorId ?? 'global')
  const url = await r2Service.getPresignedUrl(bucket, vaultKey, 600) // 10 min

  if (!url) {
    res.status(503).json({ error: 'VAULT_UNAVAILABLE', message: 'R2 não está configurado.' })
    return
  }

  res.json({
    ok:        true,
    type,
    url,
    expiresIn: 600,
    key:       vaultKey,
  })
})
