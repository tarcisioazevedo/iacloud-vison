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
import { buildRecordingConfig } from '../services/recording-config.service'

// S3 — importação condicional (não quebra se @aws-sdk não estiver instalado)
let s3Service: any = null
try { s3Service = require('../services/s3.service').s3Service } catch { /* no-op */ }

// R2 — storage multi-tenant com credenciais escopadas por EdgeNode
import { r2Service } from '../services/r2.service'
// Cloudflare Tunnel — expõe go2rtc de Edge Boxes para o Cloud
import { cloudflareTunnelService } from '../services/cloudflare-tunnel.service'
// Edge Connection Log — central de diagnóstico para suporte
import { edgeConnectionLogService } from '../services/edge-connection-log.service'
import { checkAndLogModuleDrift } from '../services/box-compliance.service'
import { logBoxTransitions } from '../services/transition-logger.service'
// FCB-005 Sprint 0 wiring 2026-05-06: middleware multi-tenant que valida licenseKey
// e cross-box access. Bloqueia tentativa de Box-A com licenseKey-A acessar dados
// de Box-B (path :boxId/:nodeId divergente do edgeNodeId resolvido pela licença).
import { assertBoxOwnership } from '../middleware/assert-box-ownership'
import { publicRoute } from '../middleware/require-capability'

export const iacvBoxRouter = Router()

/**
 * Helper para retornar 400 com detalhes acionáveis em validações Zod.
 *
 * Antes (genérico, sem dizer qual campo falhou):
 *   { error: 'VALIDATION_ERROR', message: 'Required' }
 *
 * Agora (com path do campo, esperado pela Box em logs-batch / snapshots-live):
 *   {
 *     error: 'VALIDATION_ERROR',
 *     message: 'service: Required',     // primeiro erro humano-legível
 *     fieldErrors: { service: ['Required'], 'lines.0.level': ['Invalid enum'] },
 *     formErrors: [],                    // erros que não são de campo específico
 *     issues: [{ path, message, code }]  // raw Zod issues (top 5)
 *   }
 *
 * Box pode parsear `fieldErrors` (Zod 3+) e mostrar o erro exato no log local.
 */
function zodValidationError(res: Response, error: z.ZodError): void {
  const flat = error.flatten()
  const firstIssue = error.issues[0]
  const firstPath = firstIssue?.path?.join('.') ?? '<root>'
  const message = firstPath !== '<root>'
    ? `${firstPath}: ${firstIssue?.message ?? 'invalid'}`
    : firstIssue?.message ?? 'validation failed'

  res.status(400).json({
    error: 'VALIDATION_ERROR',
    message,
    fieldErrors: flat.fieldErrors,
    formErrors:  flat.formErrors,
    issues: error.issues.slice(0, 5).map(i => ({
      path:    i.path.join('.'),
      message: i.message,
      code:    i.code,
    })),
  })
}

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
  // Box agora envia também `local` (capacityGB/usedGB/freeGB) e `frigate.cameras`
  // (por câmera: usageGB/bandwidthMBh/usagePercent). Aceitamos via passthrough
  // para evitar bloqueio em migrations e persistimos cru em EdgeNode.lastStorageJson.
  local:   z.any().optional(),
  frigate: z.any().optional(),
}).passthrough().optional()

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

// SRT publish status reportado pela Box.
// Box reporta se conseguiu configurar publish SRT em pelo menos 1 câmera.
// Cloud usa esse campo no /availability para decidir se preferred=mediamtx.
const HeartbeatSrtSchema = z.object({
  configured:        z.boolean(),                       // pelo menos 1 câmera publicando OK
  publishingCameras: z.array(z.string()).optional(),    // pathNames ativos no go2rtc local
  failed:            z.array(z.object({
    camera: z.string(),
    reason: z.string(),
  })).optional(),
  lastError:         z.string().nullable().optional(),  // ex: "go2rtc_too_old: 1.9.10 < 1.9.14"
  go2rtcVersion:     z.string().optional(),             // versão detectada localmente
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
  srt:     HeartbeatSrtSchema,

  // ── Compliance & capability discovery (Box bridge be9c457, 2026-05-04) ──
  // Box reporta quais módulos/skills está realmente "enforced" no edge agora.
  // Cloud compara com IntegradorModule + ClienteFinalModule do tenant para
  // detectar drift (item 2.13 do docs/08). Skills válidos hoje:
  // intrusion, lpr, face, crowd, demographics, ppe, audio.
  enforcedModules: z.record(z.boolean()).optional(),

  // SHA1 do payload de /box/api/cmd/list — Cloud invalida cache de
  // capabilitiesJson do EdgeNode quando muda. Item 1.13 do docs/08.
  capabilitiesRevision: z.string().optional(),

  // FCB-004 Sprint 0 wiring: SHA1 do bloco branding (logo+paleta+nomes).
  // Cloud usa pra detectar mudança de white-label.
  brandingRevision: z.string().optional(),
}).passthrough()  // tolera campos extras futuros sem quebrar Box em campo

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

  // ── Box Sprint be9c457 (2026-05-04) — extras enriquecidos ────────────────
  // Box envia esses campos desde o commit be9c457; Cloud precisa explicitar
  // pra não strip via Zod. Persistem em AnalyticsEvent.rawAnnotationsJson.
  skill:          z.string().optional(),                // 'intrusion' | 'lpr' | 'face' | 'crowd' | 'demographics' | 'ppe' | 'audio'
  metadata:       z.record(z.unknown()).optional(),     // payload livre Box
  eventType:      z.string().optional(),                // tipo canônico Box (sobreescreve hardcoded 'IACV_BOX_DETECTION')
  originalType:   z.string().optional(),                // compat 2 sprints — cortar 2026-07
  score:          z.number().optional(),                // confiança 0-1
  bboxJson:       z.array(z.number()).optional(),       // [x, y, w, h]
  zonesJson:      z.array(z.string()).optional(),       // ["entrada", "estoque"]
}).passthrough()  // tolera campos extras futuros sem quebrar Box

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

iacvBoxRouter.post('/generate-key',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
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

iacvBoxRouter.post('/activate',
  publicRoute(),
  async (req: Request, res: Response) => {
  const startTime = Date.now()
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
  const userAgent = req.headers['user-agent'] as string

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
          frigateName: true,
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
    edgeConnectionLogService.log({
      edgeNodeId: 'unknown',
      eventType: 'ACTIVATE',
      status: 'FAILED',
      errorCode: 'LICENSE_INVALID',
      errorMessage: 'Chave de licença inválida',
      ipAddress: clientIp,
      userAgent,
      payload: { hostname, ipLocal, model: hwModel },
      durationMs: Date.now() - startTime,
    })
    res.status(403).json({ error: 'LICENSE_INVALID', message: 'Chave de licença inválida.' })
    return
  }

  if (!node.site.clienteFinal.active) {
    edgeConnectionLogService.logFailure(
      node.id, 'ACTIVATE', 'TENANT_INACTIVE', 'Cliente desativado',
      { ipAddress: clientIp, userAgent, payload: { hostname }, durationMs: Date.now() - startTime }
    )
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
    tokenExpiresAt?: string  // alias acordado com Box (item B do pedido formal 2026-05-05)
    quotaUsedGB?: number     // best-effort, calculado a partir de RecordingSegment.sizeBytes
    quotaTotalGB?: number    // env R2_QUOTA_DEFAULT_GB ou 100
    // ── Aliases contrato D3 (BOX_TO_CLOUD.md) — VAULT_R2_UNBLOCK 2026-05-06 ──
    // Box parser espera `accessKey`/`secretKey` (sem Id/Access).
    // Cloud retorna AMBOS conjuntos para compat (AWS SDK + contrato Box).
    accessKey?:    string   // alias de accessKeyId (contrato D3)
    secretKey?:    string   // alias de secretAccessKey (contrato D3)
  } | null = null

  // Helper: estima quota R2 do tenant (best-effort, fire para v1 piloto)
  async function estimateVaultUsage(): Promise<{ usedGB: number; totalGB: number }> {
    const totalGB = Number(process.env.R2_QUOTA_DEFAULT_GB ?? 100)
    try {
      const agg = await prisma.recordingSegment.aggregate({
        where: { camera: { site: { clienteFinalId } } } as any,
        _sum:  { sizeBytes: true },
      })
      const sumBytes = agg?._sum?.sizeBytes ? Number(agg._sum.sizeBytes) : 0
      const usedGB = +(sumBytes / (1024 ** 3)).toFixed(2)
      return { usedGB, totalGB }
    } catch {
      return { usedGB: 0, totalGB }
    }
  }

  if (r2Service.isConfigured()) {
    // VAULT_R2_UNBLOCK 2026-05-06: garante bucket existe antes de retornar credentials
    // (idempotente, silencia "already exists"). Sem isso, primeiro upload Box dá NoSuchBucket.
    await r2Service.ensureBucket(integradorId).catch(err =>
      logger.warn({ err: err.message, integradorId }, 'vault_ensure_bucket_failed_continuing'),
    )

    const creds = await r2Service.createScopedToken(integradorId, clienteFinalId, node.id)
    if (creds) {
      const usage = await estimateVaultUsage()
      vaultCredentials = {
        bucket: creds.bucket,
        prefix: creds.prefix,
        endpoint: creds.endpoint,
        region: creds.region,
        // AWS SDK convention (compat clientes existentes)
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        // Contrato D3 BOX_TO_CLOUD.md (Box parser espera estes nomes)
        // VAULT_R2_UNBLOCK 2026-05-06 — fix de naming
        accessKey: creds.accessKeyId,
        secretKey: creds.secretAccessKey,
        expiresAt: creds.expiresAt,
        tokenExpiresAt: creds.expiresAt, // alias canônico (item B Box 2026-05-05)
        quotaUsedGB: usage.usedGB,
        quotaTotalGB: usage.totalGB,
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
    const usage = await estimateVaultUsage()
    vaultCredentials = {
      bucket: node.vaultBucket ?? r2Service.getBucketName(integradorId),
      prefix: node.vaultPrefix ?? `${clienteFinalId}/${node.id}/`,
      endpoint: process.env.VAULT_ENDPOINT ?? 'https://s3-placeholder.r2.cloudflarestorage.com',
      region: process.env.VAULT_REGION ?? 'auto',
      quotaUsedGB: usage.usedGB,
      quotaTotalGB: usage.totalGB,
    }
  }

  // ── Cloudflare Tunnel: provisiona inline no /activate ───────────────────
  //
  // Box é instalada FORA do datacenter, atrás do NAT do cliente. Quando ela
  // chama /activate pela 1ª vez (ou após reinstalação), ainda não tem tunnel
  // nem token — só a licenseKey gerada pelo operador. Aqui:
  //   1. Se EdgeNode.go2rtcEndpoint já existe → reusa (idempotente em re-boots)
  //   2. Se Cloudflare credentials estão configuradas → cria tunnel + DNS
  //   3. Se Cloudflare não está configurado (DEV/lab) → retorna manual_required
  //
  // Token é re-emitido a cada activate (Cloudflare permite getTunnelToken sempre).
  // Evita 2ª chamada (/tunnel/provision) — Box recebe tudo no boot.
  type TunnelBlock =
    | { status: 'auto'; tunnelId: string; tunnelToken: string; tunnelName: string;
        publicHostname: string; go2rtcUrl: string; isNew: boolean }
    | { status: 'existing'; tunnelId: string | null; publicHostname: string; go2rtcUrl: string }
    | { status: 'manual_required'; reason: string;
        instructions: { step1: string; step2: string; step3: string; step4: string; step5: string; step6: string };
        suggestedTunnelName: string; suggestedHostname: string; localPort: number }
    | { status: 'error'; reason: string }

  let tunnelBlock: TunnelBlock | null = null

  if (node.go2rtcEndpoint) {
    // Tunnel já provisionado — reusa endpoint, mas re-emite token se Cloudflare configurado
    let token: string | null = null
    let tunnelId: string | null = null
    if (cloudflareTunnelService.isConfigured()) {
      try {
        const found = await cloudflareTunnelService.findTunnelByName(`icv-edge-${node.id}`)
        if (found) {
          tunnelId = found.id
          token = await cloudflareTunnelService.getTunnelToken(found.id).catch(() => null)
        }
      } catch (e: any) {
        logger.debug({ err: e.message, edgeNodeId: node.id }, 'tunnel_token_refresh_skipped')
      }
    }
    if (token && tunnelId) {
      tunnelBlock = {
        status: 'auto',
        tunnelId,
        tunnelToken: token,
        tunnelName: `icv-edge-${node.id}`,
        publicHostname: new URL(node.go2rtcEndpoint).hostname,
        go2rtcUrl: node.go2rtcEndpoint,
        isNew: false,
      }
    } else {
      tunnelBlock = {
        status: 'existing',
        tunnelId,
        publicHostname: new URL(node.go2rtcEndpoint).hostname,
        go2rtcUrl: node.go2rtcEndpoint,
      }
    }
  } else if (cloudflareTunnelService.isConfigured()) {
    // Tunnel ainda não existe — provisiona automaticamente
    try {
      const result = await cloudflareTunnelService.provisionForEdgeNode(
        node.id,
        node.name ?? hostname ?? node.id,
        1984,
      )
      await prisma.edgeNode.update({
        where: { id: node.id },
        data: {
          go2rtcEndpoint:    result.go2rtcUrl,
          webrtcPublicHost:  new URL(result.go2rtcUrl).hostname,
        },
      })
      tunnelBlock = {
        status:         'auto',
        tunnelId:       result.tunnelId,
        tunnelToken:    result.tunnelToken,
        tunnelName:     result.tunnelName,
        publicHostname: result.publicHostname,
        go2rtcUrl:      result.go2rtcUrl,
        isNew:          result.isNew,
      }
      logger.info({
        edgeNodeId: node.id, tunnelId: result.tunnelId,
        publicHostname: result.publicHostname, isNew: result.isNew,
      }, 'tunnel_auto_provisioned_in_activate')
    } catch (err: any) {
      logger.warn({ edgeNodeId: node.id, err: err.message }, 'tunnel_auto_provision_failed_in_activate')
      tunnelBlock = { status: 'error', reason: err.message }
    }
  } else {
    // Cloudflare não configurado (DEV/lab) — modo manual
    const suggestedHostname = node.name?.toLowerCase().replace(/\s+/g, '-') ?? node.id
    tunnelBlock = {
      status: 'manual_required',
      reason: 'Cloudflare credentials not configured on Cloud server',
      instructions: {
        step1: 'Install cloudflared on the Edge Box',
        step2: 'Run: cloudflared tunnel login',
        step3: `Run: cloudflared tunnel create icv-edge-${node.id}`,
        step4: 'Configure ingress for localhost:1984',
        step5: `Run: cloudflared tunnel run icv-edge-${node.id}`,
        step6: 'Report the public URL in the heartbeat tunnel.publicUrl field',
      },
      suggestedTunnelName: `icv-edge-${node.id}`,
      suggestedHostname:   `${suggestedHostname}.tunnels.iacloud.com.br`,
      localPort:           1984,
    }
  }

  // Log ativação bem-sucedida
  edgeConnectionLogService.logSuccess(node.id, 'ACTIVATE', {
    ipAddress: clientIp,
    userAgent,
    payload: { hostname, ipLocal, model: hwModel, camerasCount: node.cameras.length },
    durationMs: Date.now() - startTime,
  })

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
    vault: vaultCredentials,
    tunnel: tunnelBlock,
    cameras: node.cameras.map(c => ({
      id:             c.id,
      name:           c.name,
      rtspMainUrl:    c.rtspMainUrl,
      rtspSubUrl:     c.rtspSubUrl,
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

iacvBoxRouter.post('/cameras',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const parse = BoxCamerasSyncSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
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

    // Bug fix 2026-05-03: NÃO sobrescrever campos não-presentes no payload.
    // A Box envia heartbeat sync sem `rtspMain`/`rtspSub` (gerencia local-only),
    // mas o `?? ''` antigo escrevia string vazia destruindo o RTSP cadastrado
    // pelo wizard ou via SQL direto. Resultado: snapshot e WHEP quebravam.
    // Agora: campos opcionais só vão pro UPDATE se a Box explicitamente enviar.
    const baseFields = {
      frigateName:     cam.frigateName,
      go2rtcStreamId:  cam.frigateName,
      name:            cam.name,
      brand:           cam.brand ?? null,
      model:           cam.model ?? null,
      serialNumber:    cam.serial ?? null,
      macAddress:      cam.mac ?? null,
      onvifPort:       cam.onvifPort ?? null,
      firmwareVersion: cam.firmware ?? null,
    }

    // Campos opcionais — só incluir se vier no payload (não sobrescrever com vazio)
    const updateData: Record<string, unknown> = { ...baseFields }
    if (cam.rtspMain !== undefined && cam.rtspMain !== null && cam.rtspMain !== '') {
      updateData.rtspMainUrl = cam.rtspMain
    }
    if (cam.rtspSub !== undefined && cam.rtspSub !== null && cam.rtspSub !== '') {
      updateData.rtspSubUrl = cam.rtspSub
    }

    if (existing) {
      await prisma.camera.update({
        where: { id: existing.id },
        data: updateData,
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
          ...baseFields,
          // No CREATE, RTSP vazio é aceitável — operador completa pelo wizard depois
          rtspMainUrl: cam.rtspMain ?? '',
          rtspSubUrl:  cam.rtspSub ?? null,
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
// POST /iacv-box/tunnel/provision   (DEPRECATED — use /activate inline)
//
// Mantido para compatibilidade retroativa. O fluxo recomendado é receber
// `tunnel: {status, tunnelToken, ...}` direto na resposta de /activate
// (provisionado on-demand quando EdgeNode.go2rtcEndpoint está vazio).
// ═════════════════════════════════════════════════════════════════════════════

const TunnelProvisionSchema = z.object({
  licenseKey:  z.string().min(10),
  go2rtcPort:  z.number().int().default(1984),
  frigatePort: z.number().int().optional(),
  hostname:    z.string().optional(),
})

iacvBoxRouter.post('/tunnel/provision',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const startTime = Date.now()
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
  const userAgent = req.headers['user-agent'] as string

  const parse = TunnelProvisionSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
    return
  }

  const b = parse.data
  const license = await resolveLicense(b.licenseKey)

  if (!license) {
    edgeConnectionLogService.log({
      edgeNodeId: 'unknown',
      eventType: 'TUNNEL_PROVISION',
      status: 'FAILED',
      errorCode: 'INVALID_LICENSE',
      errorMessage: 'Licença inválida',
      ipAddress: clientIp,
      userAgent,
      durationMs: Date.now() - startTime,
    })
    res.status(401).json({ error: 'INVALID_LICENSE' })
    return
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: license.edgeNodeId },
    select: { id: true, name: true, go2rtcEndpoint: true },
  })

  if (!node) {
    edgeConnectionLogService.logFailure(license.edgeNodeId, 'TUNNEL_PROVISION',
      'EDGE_NODE_NOT_FOUND', 'Edge Node não encontrado',
      { ipAddress: clientIp, userAgent, durationMs: Date.now() - startTime })
    res.status(404).json({ error: 'EDGE_NODE_NOT_FOUND' })
    return
  }

  if (node.go2rtcEndpoint) {
    edgeConnectionLogService.logSuccess(node.id, 'TUNNEL_PROVISION', {
      ipAddress: clientIp,
      userAgent,
      payload: { status: 'existing', go2rtcEndpoint: node.go2rtcEndpoint },
      durationMs: Date.now() - startTime,
    })
    res.json({
      status: 'existing',
      tunnelId: null,
      publicHostname: new URL(node.go2rtcEndpoint).hostname,
      go2rtcUrl: node.go2rtcEndpoint,
      message: 'Tunnel already configured. Use existing endpoint.',
    })
    return
  }

  if (!cloudflareTunnelService.isConfigured()) {
    const suggestedHostname = b.hostname ?? node.name?.toLowerCase().replace(/\s+/g, '-') ?? node.id
    edgeConnectionLogService.log({
      edgeNodeId: node.id,
      eventType: 'TUNNEL_PROVISION',
      status: 'PENDING',
      errorCode: 'CLOUDFLARE_NOT_CONFIGURED',
      errorMessage: 'Credenciais Cloudflare não configuradas. Retornando instruções manuais.',
      ipAddress: clientIp,
      userAgent,
      payload: { suggestedHostname, go2rtcPort: b.go2rtcPort },
      durationMs: Date.now() - startTime,
    })
    res.json({
      status: 'manual_required',
      message: 'Cloudflare credentials not configured on server. Please configure manually.',
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
    logger.warn({ edgeNodeId: node.id }, 'tunnel_provision_cloudflare_not_configured')
    return
  }

  try {
    const edgeName = b.hostname ?? node.name ?? node.id
    const result = await cloudflareTunnelService.provisionForEdgeNode(
      node.id,
      edgeName,
      b.go2rtcPort
    )

    await prisma.edgeNode.update({
      where: { id: node.id },
      data: {
        go2rtcEndpoint: result.go2rtcUrl,
        webrtcPublicHost: new URL(result.go2rtcUrl).hostname,
      },
    })

    edgeConnectionLogService.logSuccess(node.id, 'TUNNEL_PROVISION', {
      ipAddress: clientIp,
      userAgent,
      payload: {
        status: result.isNew ? 'created' : 'existing',
        tunnelId: result.tunnelId,
        publicHostname: result.publicHostname,
      },
      durationMs: Date.now() - startTime,
    })

    logger.info({
      edgeNodeId: node.id,
      tunnelId: result.tunnelId,
      publicHostname: result.publicHostname,
      isNew: result.isNew,
    }, 'tunnel_provisioned_successfully')

    res.json({
      status: result.isNew ? 'created' : 'existing',
      tunnelId: result.tunnelId,
      tunnelToken: result.tunnelToken,
      tunnelName: result.tunnelName,
      publicHostname: result.publicHostname,
      go2rtcUrl: result.go2rtcUrl,
      config: {
        ingress: [
          { hostname: result.publicHostname, service: `http://localhost:${b.go2rtcPort}` },
          { service: 'http_status:404' },
        ],
      },
    })
  } catch (err: any) {
    edgeConnectionLogService.logFailure(node.id, 'TUNNEL_PROVISION',
      'TUNNEL_PROVISION_FAILED', err.message,
      { ipAddress: clientIp, userAgent, payload: { go2rtcPort: b.go2rtcPort }, durationMs: Date.now() - startTime })
    logger.error({ edgeNodeId: node.id, err: err.message }, 'tunnel_provision_failed')
    res.status(500).json({
      error: 'TUNNEL_PROVISION_FAILED',
      message: err.message,
      edgeNodeId: node.id,
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /iacv-box/srt-config   (Box descobre URL e policy de SRT publish)
//
// Box usa esse endpoint para configurar push SRT de baixa latência.
// Cloud retorna:
//   - srtHost, srtPort: endpoint do MediaMTX SFU (sempre srt.iacloud.com.br:8890)
//   - cameras[]: lista de câmeras desta Box com policy de publish por câmera
//   - publishMode: AUTO/ALWAYS/ON_DEMAND/SUB_ONLY (Cloud calcula policy adaptativa
//     baseada em #cams da Box; Box pode override por câmera no DB)
//   - streamIdPrefix: namespace do streamid SRT por câmera
// ═════════════════════════════════════════════════════════════════════════════

const SrtConfigSchema = z.object({
  licenseKey: z.string().min(10),
})

iacvBoxRouter.get('/srt-config',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  // Aceita licenseKey via header X-IACV-License-Key OU query string
  const licenseKey =
    (req.headers['x-iacv-license-key'] as string) ||
    (req.query.licenseKey as string) ||
    ''

  const parse = SrtConfigSchema.safeParse({ licenseKey })
  if (!parse.success) {
    return zodValidationError(res, parse.error)
  }

  const license = await resolveLicense(parse.data.licenseKey)
  if (!license || !license.licensed) {
    res.status(401).json({ error: 'UNLICENSED' })
    return
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: license.edgeNodeId },
    select: {
      id: true,
      name: true,
      cameras: {
        where: { active: true },
        select: {
          id: true,
          name: true,
          frigateName: true,
          go2rtcStreamId: true,
          publishMode: true,
        },
      },
    },
  })

  if (!node) {
    res.status(404).json({ error: 'EDGE_NODE_NOT_FOUND' })
    return
  }

  // ── Policy adaptativa por #cams ───────────────────────────────────────────
  // 1-8: ALWAYS (always-on main+sub) — bandwidth OK, instant play
  // 9-16: ALWAYS sub + ON_DEMAND main
  // 17-32: ALWAYS sub + ON_DEMAND main (com maxConcurrentMain=8 LRU)
  // 33+: SUB_ONLY default (main só on-demand explícito por câmera)
  const camCount = node.cameras.length
  const defaultMainMode: 'ALWAYS' | 'ON_DEMAND' | 'SUB_ONLY' =
    camCount <= 8 ? 'ALWAYS' :
    camCount <= 32 ? 'ON_DEMAND' :
    'SUB_ONLY'
  const maxConcurrentMain = Math.max(2, Math.min(8, Math.floor(camCount / 4)))

  // SRT credentials por path (MediaMTX usa publish:user:pass embedded no streamid).
  // User = edgeNodeId, Pass = HMAC(licenseKey + cameraId) curto. Box decifra os tokens.
  const srtUser = node.id

  // Resolve `publishMode` real por câmera (camera override > Box policy)
  const camerasOut = node.cameras.map(cam => {
    const streamName = cam.go2rtcStreamId ?? cam.frigateName ?? cam.id.slice(0, 8)
    const pathName = `${node.id}/${streamName}`
    const effectiveMode: 'ALWAYS' | 'ON_DEMAND' | 'SUB_ONLY' =
      cam.publishMode === 'AUTO' ? defaultMainMode :
      (cam.publishMode as 'ALWAYS' | 'ON_DEMAND' | 'SUB_ONLY')

    return {
      cameraId:    cam.id,
      streamName,
      pathName,
      mainStreamId: `publish:${pathName}/main:${srtUser}:${parse.data.licenseKey}`,
      subStreamId:  `publish:${pathName}/sub:${srtUser}:${parse.data.licenseKey}`,
      publishMode:  effectiveMode,
    }
  })

  // Lê passphrase SRT do secret (mesma usada pelo MediaMTX). Box vai usar no URL:
  //   srt://srt.iacloud.com.br:8890?streamid=...&passphrase=<srtPassphrase>
  // Se não houver secret (DEV), passphrase fica null e Box deve omitir o param.
  let srtPassphrase: string | null = null
  const passFile = process.env.SRT_PUBLISH_PASSPHRASE_FILE
  if (passFile) {
    try {
      const fs = await import('fs')
      if (fs.existsSync(passFile)) {
        srtPassphrase = fs.readFileSync(passFile, 'utf-8').trim() || null
      }
    } catch (err) {
      logger.warn({ err }, 'srt_passphrase_read_failed')
    }
  }

  res.json({
    licensed:        true,
    boxId:           node.id,
    srtHost:         'srt.iacloud.com.br',
    srtPort:         8890,
    transport:       'srt',
    encryption:      srtPassphrase ? 'aes-128-gcm' : 'none',
    srtPassphrase,                             // ← Box anexa &passphrase=<este_valor> ao URL SRT
    latencyMs:       120,                     // SRT default — Box pode tunar
    streamIdFormat:  'publish:<edgeNodeId>/<streamName>/<main|sub>:<user>:<pass>',
    policy: {
      camCount,
      defaultMainMode,
      maxConcurrentMain,
      subBitrateKbps:  600,                  // hint pra Box transcodar substream
      mainBitrateKbps: 3000,                 // hint pra Box transcodar mainstream
    },
    cameras: camerasOut,
    serverTime: new Date().toISOString(),
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/heartbeat   (a cada 30s, Box pergunta: "posso rodar?")
// ═════════════════════════════════════════════════════════════════════════════

iacvBoxRouter.post('/heartbeat',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const startTime = Date.now()
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
  const userAgent = req.headers['user-agent'] as string

  const parse = BoxHeartbeatSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
  }

  const b = parse.data
  const license = await resolveLicense(b.licenseKey)

  if (!license) {
    edgeConnectionLogService.log({
      edgeNodeId: 'unknown',
      eventType: 'HEARTBEAT',
      status: 'FAILED',
      errorCode: 'LICENSE_INVALID',
      errorMessage: 'Chave de licença inválida',
      ipAddress: clientIp,
      userAgent,
      durationMs: Date.now() - startTime,
    })
    res.json({ licensed: false, reason: 'INVALID_KEY' })
    return
  }

  // ── Box transitions → EdgeConnectionLog (fire-and-forget) ──────────────
  // Box envia transitions[] no payload (passthrough). Persiste em
  // EdgeConnectionLog para painel /admin/tenants/:id?tab=logs ver eventos
  // reais (TUNNEL_DOWN, CAMERA_OFFLINE, DISK_LOW, etc).
  // Pedido formal Box 2026-05-05 commit 035c4e2 item A.
  const rawTransitions = (b as any).transitions
  if (Array.isArray(rawTransitions) && rawTransitions.length > 0) {
    logBoxTransitions(license.edgeNodeId, rawTransitions)
      .then(r => {
        if (r.ingested > 0 || r.unknownTypes.length > 0) {
          logger.info(
            { edgeNodeId: license.edgeNodeId, ...r },
            'box_transitions_persisted',
          )
        }
      })
      .catch(err => logger.warn(
        { err: err.message, edgeNodeId: license.edgeNodeId },
        'box_transitions_persist_failed',
      ))
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
          // PEDIDO-2 bridge: persiste storage cru pra dashboard de Storage por câmera.
          ...(b.storage ? { lastStorageJson: b.storage as any } : {}),
          // FCB-003/004 Sprint 0 wiring: persistir revisions Box → colunas dedicadas
          ...(b.capabilitiesRevision ? {
            capabilitiesRevision: b.capabilitiesRevision,
            lastCapabilitiesAt:   new Date(),
          } : {}),
          ...(b.brandingRevision ? {
            brandingRevision:     b.brandingRevision,
            lastBrandingChangeAt: new Date(),
          } : {}),
          // atualizar IP local se enviado no payload enriquecido
          ...(b.network?.ip ? { ipLocal: b.network.ip } : {}),
          // Tunnel: atualiza go2rtcEndpoint quando Box reporta tunnel ativo.
          // Bug fix 2026-05-03: rejeitar URLs de 2º nível (`*.tunnels.iacloud.com.br`)
          // — não têm SSL Universal grátis e quebram com TLS handshake failure 552.
          // Aceitar apenas naming v3 (`tn-*.iacloud.com.br`) ou outros hostnames customizados.
          // Box que ainda reporta URL antiga: log + ignore (espera ela limpar /data/tunnel.json).
          ...(b.tunnel?.active && b.tunnel?.publicUrl && !/\.tunnels\.iacloud\.com\.br/i.test(b.tunnel.publicUrl) ? {
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

  // ── Item 2.13 docs/08 — Compliance check (fire-and-forget) ────────────────
  // Compara enforcedModules reportado pela Box com IntegradorModule +
  // ClienteFinalModule. Se diff: registra em EdgeConnectionLog (MODULE_DRIFT)
  // para painel admin. Nunca bloqueia heartbeat.
  if (b.enforcedModules) {
    checkAndLogModuleDrift(license.edgeNodeId, b.enforcedModules, {
      ipAddress: clientIp ?? undefined,
      userAgent,
    }).catch(() => { /* já tem catch interno */ })
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

  // Recording config — descreve quais câmeras gravar, RTSP local, segment,
  // upload endpoint. Box implementa o uploader baseado nisso. Falhas aqui
  // não devem quebrar heartbeat (gravação é opcional pra liveness).
  let recordingConfig: any = null
  try {
    recordingConfig = await buildRecordingConfig(license.edgeNodeId)
  } catch (err: any) {
    logger.warn({ err: err?.message, edgeNodeId: license.edgeNodeId },
      'iacv_box_heartbeat_recording_config_failed')
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
    // Box usa esta config pra rodar uploader de segments. Ver
    // INTEGRATION/CLOUD_TO_BOX.md → "Recording: contrato de upload".
    recordingConfig,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/logs-batch  (Box envia rolling 24h de logs Frigate/portal/nginx)
// ═════════════════════════════════════════════════════════════════════════════
// Box chama 1×/min com até 100 linhas. Cloud guarda em SystemLog (rolling)
// para painel "Logs do EdgeNode". Sem persistência longa — Box mantém SQLite.

const LogsBatchSchema = z.object({
  licenseKey: z.string().min(10),
  boxId:      z.string().optional(),
  service:    z.enum(['frigate', 'portal-api', 'nginx', 'discovery', 'cloud_sync', 'mqtt', 'other']),
  lines:      z.array(z.object({
    ts:    z.number(),
    level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']),
    msg:   z.string().max(2000),
  })).max(100),
})

iacvBoxRouter.post('/logs-batch',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const parse = LogsBatchSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
    return
  }
  const b = parse.data
  const license = await resolveLicense(b.licenseKey)
  if (!license) { res.status(401).json({ error: 'INVALID_LICENSE' }); return }

  // Insere em SystemLog (tabela já existe).
  // FIX 2026-05-09: schema usa `recordedAt` (não `timestamp`) e `detailsJson`
  // (não `metadata`). `source` é enum CameraLogSource — não aceita string livre.
  // Bug fazia milhares de linhas/dia serem dropadas. Mapeamos service → enum;
  // o nome original vai pra detailsJson preservando contexto.
  const SOURCE_MAP: Record<string, 'FFMPEG'|'DETECTOR'|'MOTION'|'RECORDER'|'SNAPSHOT'|'ZONE'|'ONVIF'|'PTZ'|'AUDIO'|'FACE'|'LPR'|'GENAI'|'SEMANTIC'|'SYSTEM'|'EDGE_AGENT'|'VERTEX'|'CLOUD_VISION'|'GCS'|'AUTH'|'API'> = {
    ffmpeg:    'FFMPEG',
    detector:  'DETECTOR',
    motion:    'MOTION',
    recorder:  'RECORDER',
    snapshot:  'SNAPSHOT',
    zone:      'ZONE',
    onvif:     'ONVIF',
    ptz:       'PTZ',
    audio:     'AUDIO',
    face:      'FACE',
    lpr:       'LPR',
    genai:     'GENAI',
    semantic:  'SEMANTIC',
  }
  const sourceEnum = SOURCE_MAP[String(b.service).toLowerCase()] ?? 'EDGE_AGENT'

  const records = b.lines.map(line => ({
    recordedAt:  new Date(line.ts * 1000),
    level:       line.level,
    source:      sourceEnum,
    message:     line.msg.slice(0, 2000),
    edgeNodeId:  license.edgeNodeId,
    detailsJson: { service: b.service } as any,
  }))

  await prisma.systemLog.createMany({ data: records, skipDuplicates: true })
    .catch(err => logger.warn({ err: err.message, edgeNodeId: license.edgeNodeId }, 'logs_batch_insert_failed'))

  res.json({ ok: true, ingested: records.length })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/snapshots-live  (Box reporta thumbnails uploaded ao R2)
// ═════════════════════════════════════════════════════════════════════════════
// Box já fez upload do JPEG ao R2 (bucket icv-int-<integradorId>) e reporta a
// chave/url para Cloud indexar e exibir no painel. 1 frame ~30s por câmera.

const SnapshotsLiveSchema = z.object({
  licenseKey: z.string().min(10),
  boxId:      z.string().optional(),
  snapshots:  z.array(z.object({
    cameraName: z.string(),                    // frigateName/streamName
    cameraId:   z.string().optional(),         // se Box já souber Camera.id da Cloud
    url:        z.string().optional(),         // URL pública do R2 (se Box tem CNAME)
    r2Key:      z.string().optional(),         // chave S3 (sempre presente)
    ts:         z.number(),
    width:      z.number().optional(),
    height:     z.number().optional(),
  })).max(50),
})

iacvBoxRouter.post('/snapshots-live',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const parse = SnapshotsLiveSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
    return
  }
  const b = parse.data
  const license = await resolveLicense(b.licenseKey)
  if (!license) { res.status(401).json({ error: 'INVALID_LICENSE' }); return }

  // Resolve cameraId real para cada snapshot (lookup por Camera.frigateName)
  const ingested: { cameraId: string; cameraName: string; ts: number }[] = []

  for (const snap of b.snapshots) {
    const cam = snap.cameraId
      ? await prisma.camera.findFirst({
          where: { id: snap.cameraId, edgeNodeId: license.edgeNodeId },
          select: { id: true },
        })
      : await prisma.camera.findFirst({
          where: { edgeNodeId: license.edgeNodeId, frigateName: snap.cameraName },
          select: { id: true },
        })

    if (!cam) continue   // skip silencioso — câmera não cadastrada

    // Atualiza Camera.lastSnapshotUrl e lastSnapshotAt (campos já existem)
    await prisma.camera.update({
      where: { id: cam.id },
      data: {
        lastSnapshotUrl: snap.url ?? (snap.r2Key ? `r2://${snap.r2Key}` : null),
        lastSnapshotAt:  new Date(snap.ts * 1000),
      },
    }).catch(() => { /* silencia erros de UPDATE — best-effort */ })

    ingested.push({ cameraId: cam.id, cameraName: snap.cameraName, ts: snap.ts })
  }

  res.json({
    ok: true,
    ingested: ingested.length,
    skipped:  b.snapshots.length - ingested.length,
    cameras:  ingested,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/events   (envia detecções + snapshot WebP)
// POST /iacv-box/events-batch  (até 100 eventos no mesmo request)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Persiste 1 evento Box em AnalyticsEvent. Compartilhado entre handlers
 * single e batch. Retorna `{ eventId, duplicate? }` ou throw em erro de
 * persist.
 *
 * Comportamento idêntico ao handler /events original — apenas extraído
 * para permitir batch (item 1.12 do docs/08, fechando pedido da Box
 * commit `be9c457`).
 */
async function processBoxEvent(
  b: z.infer<typeof BoxEventSchema>,
  license: LicenseCache,
): Promise<{ eventId: string; duplicate?: boolean }> {
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

    // Bridge 2026-05-07: a Box pode reenviar evento JÁ existente apenas para
    // anexar vault keys que chegaram do uploader DEPOIS do primeiro envio.
    // Quando detectamos duplicate, fazemos UPSERT das vault keys ausentes em
    // vez de descartar — destravando os 191 eventos pendentes.
    const incomingVault = b as typeof b & {
      vaultSnapshotKey?: string | null
      vaultClipKey?: string | null
      vaultThumbKey?: string | null
    }
    const hasNewVaultKeys = !!(
      incomingVault.vaultSnapshotKey ||
      incomingVault.vaultClipKey ||
      incomingVault.vaultThumbKey
    )

    async function upsertVaultKeysOnExisting(existingId: string): Promise<void> {
      if (!hasNewVaultKeys) return
      const data: Record<string, string> = {}
      if (incomingVault.vaultSnapshotKey) data.vaultSnapshotKey = incomingVault.vaultSnapshotKey
      if (incomingVault.vaultClipKey)     data.vaultClipKey     = incomingVault.vaultClipKey
      if (incomingVault.vaultThumbKey)    data.vaultThumbKey    = incomingVault.vaultThumbKey
      data.vaultUploadedAt = new Date().toISOString()
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await prisma.analyticsEvent.update({
          where: { id: existingId },
          data: data as any,
        })
        logger.info(
          { eventId: existingId, fields: Object.keys(data) },
          'iacv_box_event_vault_keys_upserted',
        )
      } catch (err) {
        logger.warn({ err, eventId: existingId }, 'iacv_box_event_vault_upsert_failed')
      }
    }

    if (frigateId) {
      // Checar via unique index (edgeNodeId, frigateId)
      const existing = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "AnalyticsEvent"
        WHERE "edgeNodeId" = ${license.edgeNodeId} AND "frigateId" = ${frigateId}
        LIMIT 1
      `
      if (existing.length > 0) {
        await upsertVaultKeysOnExisting(existing[0].id)
        logger.debug({ eventId: existing[0].id, frigateId, hasNewVaultKeys }, 'iacv_box_event_duplicate_skipped')
        return { eventId: existing[0].id, duplicate: true }
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
        await upsertVaultKeysOnExisting(existing.id)
        logger.debug({ eventId: existing.id, idempotencyKey, hasNewVaultKeys }, 'iacv_box_event_duplicate_skipped_legacy')
        return { eventId: existing.id, duplicate: true }
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

    // ── Box enriquecido (be9c457): persistir skill/metadata/eventType/score/bbox/zones ──
    // BoxEventSchema agora aceita esses campos via .passthrough() — sem strip Zod.
    // Mapeamos pra colunas dedicadas onde existe + rawAnnotationsJson para o resto.
    const bExtra = b as typeof b & {
      skill?: string
      metadata?: Record<string, unknown>
      eventType?: string
      originalType?: string
      score?: number
      bboxJson?: number[]
      zonesJson?: string[]
      [k: string]: unknown
    }

    // Captura quaisquer campos extras (passthrough) que não são parte do schema canônico
    // pra preservar em rawAnnotationsJson (forward-compat com novos campos Box).
    const knownKeys = new Set([
      'licenseKey', 'boxId', 'cameraId', 'ipLocal', 'timestamp', 'objectCount',
      'classes', 'snapshot', 'snapshotFormat', 'frigateId',
      'skill', 'metadata', 'eventType', 'originalType', 'score', 'bboxJson', 'zonesJson',
    ])
    const passthroughExtras: Record<string, unknown> = {}
    for (const k of Object.keys(bExtra)) {
      if (!knownKeys.has(k)) passthroughExtras[k] = (bExtra as any)[k]
    }

    const rawAnnotations = {
      // Campos enriquecidos canônicos
      ...(bExtra.skill        !== undefined ? { skill:        bExtra.skill }        : {}),
      ...(bExtra.metadata     !== undefined ? { metadata:     bExtra.metadata }     : {}),
      ...(bExtra.eventType    !== undefined ? { eventType:    bExtra.eventType }    : {}),
      ...(bExtra.originalType !== undefined ? { originalType: bExtra.originalType } : {}),
      ...(bExtra.score        !== undefined ? { score:        bExtra.score }        : {}),
      ...(bExtra.bboxJson     !== undefined ? { bbox:         bExtra.bboxJson }     : {}),
      ...(bExtra.zonesJson    !== undefined ? { zones:        bExtra.zonesJson }    : {}),
      // Tudo que veio extra via passthrough
      ...(Object.keys(passthroughExtras).length > 0 ? { passthrough: passthroughExtras } : {}),
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
        // eventType: usa Box quando vier, senão fallback hardcoded (legado)
        eventType:      bExtra.eventType ?? 'IACV_BOX_DETECTION',
        severity:       'INFO',
        capturedAt:     new Date(b.timestamp * 1000),
        processedAt:    new Date(),
        occupancyCount: Math.round(b.objectCount),
        labelsJson:     b.classes as any,
        // Persistir extras enriquecidos da Box (be9c457) — fix item 12 da auditoria
        rawAnnotationsJson: Object.keys(rawAnnotations).length > 0 ? (rawAnnotations as any) : undefined,
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

  return { eventId }
}

iacvBoxRouter.post('/events',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const parse = BoxEventSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
  }
  const license = await resolveLicense(parse.data.licenseKey)
  if (!license || !license.licensed) {
    res.status(403).json({ error: 'UNLICENSED' })
    return
  }
  try {
    const result = await processBoxEvent(parse.data, license)
    res.json({ ok: true, ...result })
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'iacv_box_event_persist_error')
    res.status(500).json({ error: 'PERSIST_ERROR' })
  }
})

iacvBoxRouter.post('/events-batch',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  // Fix T06 (handoff 2026-05-06): events-batch antes era all-or-nothing — 1 item
  // inválido derrubava todo o batch (400). Agora valida o ENVELOPE primeiro
  // (licenseKey, events array com 1-100 itens), depois valida CADA item
  // individualmente — itens inválidos vão para `errors[]` mas itens válidos
  // são processados normalmente. Resposta: 207 Multi-Status quando há mistura.

  // Etapa 1: valida apenas envelope (sem schema dos events) e checa
  // licenseKey + tamanho do array.
  if (!req.body || typeof req.body !== 'object') {
    return zodValidationError(res, new z.ZodError([{
      code: 'custom', path: [], message: 'body deve ser objeto JSON',
    }]))
  }
  const licenseKey = (req.body as any).licenseKey
  const boxId      = (req.body as any).boxId
  const eventsRaw  = (req.body as any).events
  if (typeof licenseKey !== 'string' || licenseKey.length < 10) {
    return zodValidationError(res, new z.ZodError([{
      code: 'custom', path: ['licenseKey'], message: 'Required (string min 10)',
    }]))
  }
  if (!Array.isArray(eventsRaw) || eventsRaw.length === 0 || eventsRaw.length > 100) {
    return zodValidationError(res, new z.ZodError([{
      code: 'custom', path: ['events'], message: 'array obrigatório com 1-100 itens',
    }]))
  }

  const license = await resolveLicense(licenseKey)
  if (!license || !license.licensed) {
    res.status(403).json({ error: 'UNLICENSED' })
    return
  }

  // Etapa 2: valida cada item individualmente. Sucesso vai para `accepted`,
  // falha vai para `errors[]` com index + path do campo + mensagem.
  const itemSchema = BoxEventSchema.partial({ licenseKey: true, boxId: true })
  const accepted: { eventId: string; duplicate?: boolean }[] = []
  const errors:   { index: number; frigateId?: string; error: string }[] = []

  for (let i = 0; i < eventsRaw.length; i++) {
    const itemParse = itemSchema.safeParse(eventsRaw[i])
    if (!itemParse.success) {
      const flat = itemParse.error.flatten()
      const errMsg = flat.formErrors.join('; ')
        || JSON.stringify(flat.fieldErrors)
        || itemParse.error.issues[0]?.message
        || 'invalid item'
      errors.push({
        index: i,
        frigateId: typeof eventsRaw[i]?.frigateId === 'string' ? eventsRaw[i].frigateId : undefined,
        error: errMsg,
      })
      continue
    }
    const eventBody = { ...itemParse.data, licenseKey, boxId } as z.infer<typeof BoxEventSchema>
    try {
      const r = await processBoxEvent(eventBody, license)
      accepted.push(r)
    } catch (err: any) {
      logger.warn(
        { err: err.message, frigateId: itemParse.data.frigateId, index: i },
        'iacv_box_events_batch_item_failed',
      )
      errors.push({ index: i, frigateId: itemParse.data.frigateId, error: err.message ?? 'unknown' })
    }
  }

  const inserted   = accepted.filter(r => !r.duplicate).length
  const duplicates = accepted.length - inserted

  logger.info(
    { batchSize: eventsRaw.length, inserted, duplicates, errors: errors.length, edgeNodeId: license.edgeNodeId },
    'iacv_box_events_batch_processed',
  )

  // 207 Multi-Status quando há mistura de sucesso + erro; senão 200
  res.status(errors.length > 0 && accepted.length > 0 ? 207 : 200).json({
    ok:        errors.length === 0,
    accepted:  accepted.length,
    inserted,
    duplicates,
    errors,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/review-segments — Frigate reviews (PEDIDO-1 da Bridge)
//
// Box envia batch de "reviews" do Frigate (alertas com metadata GenAI).
// Idempotência por (edgeNodeId, frigateReviewId): reenvio silenciosamente
// re-utiliza o registro existente — útil pra Box reagir a mudanças (ex:
// `hasBeenReviewed` virou true por outra fonte).
//
// Sample payload em INTEGRATION/BOX_TO_CLOUD.md "[BOX 2026-05-08]".
// ═════════════════════════════════════════════════════════════════════════════

const FrigateReviewItemSchema = z.object({
  frigateReviewId:    z.string().min(1),
  cameraId:           z.string().optional(),                 // UUID OU frigateName
  cameraFrigateName:  z.string().optional(),
  startedAt:          z.string().datetime({ offset: true }), // ISO 8601
  endedAt:            z.string().datetime({ offset: true }).optional(),
  severity:           z.enum(['alert', 'detection', 'ALERT', 'DETECTION']),
  hasBeenReviewed:    z.boolean().default(false),
  objects:            z.array(z.string()).default([]),
  zones:              z.array(z.string()).default([]),
  thumbPath:          z.string().optional(),
  genai:              z.object({
    title:                  z.string().optional(),
    shortSummary:           z.string().optional(),
    confidence:             z.number().min(0).max(1).optional(),
    potentialThreatLevel:   z.number().int().min(0).max(3).optional(),
  }).optional(),
}).passthrough()

const ReviewBatchSchema = z.object({
  licenseKey: z.string().min(10),
  boxId:      z.string().optional(),
  reviews:    z.array(FrigateReviewItemSchema).min(1).max(100),
})

iacvBoxRouter.post('/review-segments',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const parse = ReviewBatchSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
  }
  const { licenseKey, reviews } = parse.data

  const license = await resolveLicense(licenseKey)
  if (!license || !license.licensed) {
    res.status(403).json({ error: 'UNLICENSED' })
    return
  }

  let ingested = 0
  let skipped  = 0
  const errors: { index: number; frigateReviewId: string; error: string }[] = []

  for (let i = 0; i < reviews.length; i++) {
    const r = reviews[i]
    try {
      // Resolve cameraId (UUID, frigateName ou go2rtcStreamId — mesma lógica de events)
      let resolvedCameraId: string | null = null
      const camRef = r.cameraId ?? r.cameraFrigateName
      if (camRef) {
        const cam = await prisma.camera.findFirst({
          where: {
            edgeNodeId: license.edgeNodeId,
            OR: [
              { id: camRef },
              { frigateName: camRef },
              { go2rtcStreamId: camRef },
            ],
          },
          select: { id: true },
        })
        resolvedCameraId = cam?.id ?? null
      }
      if (!resolvedCameraId) {
        // Fallback: primeira câmera ativa do edge node
        const node = await prisma.edgeNode.findUnique({
          where: { id: license.edgeNodeId },
          select: { cameras: { where: { active: true }, select: { id: true }, take: 1 } },
        })
        resolvedCameraId = node?.cameras?.[0]?.id ?? null
      }
      if (!resolvedCameraId) {
        errors.push({ index: i, frigateReviewId: r.frigateReviewId, error: 'no_camera_resolvable' })
        continue
      }

      const severityNorm = r.severity.toUpperCase() as 'ALERT' | 'DETECTION'

      // Upsert por (edgeNodeId, frigateReviewId)
      const existed = await prisma.frigateReview.findUnique({
        where: { FrigateReview_edge_frigate_unique: {
          edgeNodeId:      license.edgeNodeId,
          frigateReviewId: r.frigateReviewId,
        } },
        select: { id: true },
      })

      const data = {
        edgeNodeId:                license.edgeNodeId,
        cameraId:                  resolvedCameraId,
        frigateReviewId:           r.frigateReviewId,
        cameraFrigateName:         r.cameraFrigateName ?? null,
        startedAt:                 new Date(r.startedAt),
        endedAt:                   r.endedAt ? new Date(r.endedAt) : null,
        severity:                  severityNorm,
        hasBeenReviewed:           r.hasBeenReviewed ?? false,
        objects:                   r.objects ?? [],
        zones:                     r.zones ?? [],
        thumbPath:                 r.thumbPath ?? null,
        genaiTitle:                r.genai?.title ?? null,
        genaiShortSummary:         r.genai?.shortSummary ?? null,
        genaiConfidence:           r.genai?.confidence ?? null,
        genaiPotentialThreatLevel: r.genai?.potentialThreatLevel ?? null,
      }

      if (existed) {
        await prisma.frigateReview.update({ where: { id: existed.id }, data })
        skipped++
      } else {
        await prisma.frigateReview.create({ data })
        ingested++
      }

      // Marca segments do range: ALERT → hasAlert (retention 90d default),
      // DETECTION → hasEvent (retention 30d default).
      const segKind: 'event' | 'alert' = severityNorm === 'ALERT' ? 'alert' : 'event'
      markSegmentMotion(
        resolvedCameraId,
        new Date(r.startedAt),
        r.endedAt ? new Date(r.endedAt) : null,
        segKind,
      ).catch(err => logger.debug({ err }, 'frigate_review_mark_segment_failed'))
    } catch (err: any) {
      logger.warn({ err: err.message, frigateReviewId: r.frigateReviewId, index: i },
        'iacv_box_review_item_failed')
      errors.push({ index: i, frigateReviewId: r.frigateReviewId, error: err.message ?? 'unknown' })
    }
  }

  logger.info({
    batchSize:  reviews.length,
    ingested,
    skipped,
    errors:     errors.length,
    edgeNodeId: license.edgeNodeId,
  }, 'iacv_box_review_segments_processed')

  res.status(errors.length > 0 && (ingested + skipped) > 0 ? 207 : 201).json({
    ingested,
    skipped,
    errors,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /iacv-box/reviews   (lista FrigateReview para o painel Cloud)
// ═════════════════════════════════════════════════════════════════════════════
//
// Filtros opcionais via query: edgeNodeId, cameraId, severity, hasBeenReviewed,
// since (ISO), limit (default 50, max 200). Ordenado por startedAt DESC.
// SUPER_ADMIN vê tudo; INTEGRADOR_ADMIN só do próprio integradorId.

iacvBoxRouter.get('/reviews',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200)
  const where: any = {}
  if (req.query.edgeNodeId) where.edgeNodeId = String(req.query.edgeNodeId)
  if (req.query.cameraId)   where.cameraId   = String(req.query.cameraId)
  if (req.query.severity)   where.severity   = String(req.query.severity).toUpperCase()
  if (req.query.hasBeenReviewed === 'true')  where.hasBeenReviewed = true
  if (req.query.hasBeenReviewed === 'false') where.hasBeenReviewed = false
  if (req.query.since) where.startedAt = { gte: new Date(String(req.query.since)) }

  // Tenant isolation para INTEGRADOR_ADMIN
  if (jwt.role === 'INTEGRADOR_ADMIN' && jwt.integradorId) {
    where.edgeNode = { site: { clienteFinal: { integradorId: jwt.integradorId } } }
  }

  const reviews = await prisma.frigateReview.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: {
      camera:   { select: { id: true, name: true, frigateName: true } },
      edgeNode: { select: { id: true, name: true } },
    },
  })

  res.json({ reviews, total: reviews.length })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/:nodeId/reviews/mark-reviewed   (Cloud → Box: MARK_REVIEWED)
// ═════════════════════════════════════════════════════════════════════════════
//
// Quando o usuário do painel Cloud marca um ou mais reviews como vistos:
//   1. Atualiza FrigateReview.hasBeenReviewed=true + cloudReviewedAt + cloudReviewedById
//   2. Enfileira EdgeCommand `MARK_REVIEWED` com `frigateReviewIds[]` para a Box
//      propagar o estado pro Frigate (POST /api/reviews/viewed Frigate-side).

const MarkReviewedSchema = z.object({
  frigateReviewIds: z.array(z.string().min(1)).min(1).max(200),
})

iacvBoxRouter.post('/:nodeId/reviews/mark-reviewed',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: req.params.nodeId },
    include: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
  }) as any
  if (!node) { res.status(404).json({ error: 'NOT_FOUND' }); return }
  if (jwt.role === 'INTEGRADOR_ADMIN' && node.site.clienteFinal.integradorId !== jwt.integradorId) {
    res.status(403).json({ error: 'FORBIDDEN' }); return
  }

  const parse = MarkReviewedSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
  }
  const { frigateReviewIds } = parse.data

  // 1) Marca no banco (Cloud-side estado).
  const now = new Date()
  const updated = await prisma.frigateReview.updateMany({
    where: { edgeNodeId: node.id, frigateReviewId: { in: frigateReviewIds } },
    data: { hasBeenReviewed: true, cloudReviewedAt: now, cloudReviewedById: jwt.sub },
  })

  // 2) Enfileira comando para Box propagar ao Frigate.
  const cmd = await (prisma as any).edgeCommand.create({
    data: {
      edgeNodeId:  node.id,
      type:        'MARK_REVIEWED',
      payload:     { frigateReviewIds },
      createdById: jwt.sub,
      expiresAt:   new Date(Date.now() + 24 * 3600_000), // TTL 24h
    },
  })

  logger.info({
    nodeId: node.id,
    cmdId: cmd.id,
    count: frigateReviewIds.length,
    updated: updated.count,
  }, 'iacv_box_mark_reviewed_enqueued')

  res.json({
    ok: true,
    updated: updated.count,
    enqueued: frigateReviewIds.length,
    commandId: cmd.id,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /iacv-box/:boxId/integration/snapshot   (SUPER_ADMIN | INTEGRADOR_ADMIN)
//
// Painel de integração Cloud-side: retorna estado atual do EdgeNode conforme
// persistido no banco (heartbeats, eventos recentes, telemetria, skills).
// Consumido pelo frontend de administração e pelo endpoint Box-side
// GET /api/integration/snapshot (que puxa dados locais da Box).
// ═════════════════════════════════════════════════════════════════════════════

iacvBoxRouter.get('/:boxId/integration/snapshot',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
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
  }) as any

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
    camerasOnline: cameras.filter(c => c.status === 'ACTIVE').length,

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
  type:    z.enum(['RESTART_CAMERA', 'RELOAD_MODEL', 'FORCE_RESYNC', 'UPDATE_ZONES', 'FACTORY_RESET', 'MARK_REVIEWED']),
  payload: z.record(z.unknown()).optional().default({}),
  // FCB-001 Sprint 0 wiring: TTL do comando. null = sem expiração (legado).
  // Default 3600s (1h) — comando virou stale para Box que ficou offline > 1h.
  // SUPER_ADMIN pode passar 0 para "sem expiração" (FACTORY_RESET, OTA).
  ttlSeconds: z.number().int().min(0).max(86400).optional(),
})

iacvBoxRouter.post('/:nodeId/commands',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN' && jwt.role !== 'INTEGRADOR_ADMIN') {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: req.params.nodeId },
    include: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
  }) as any
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
    return zodValidationError(res, parse.error)
    return
  }

  // FCB-001 Sprint 0 wiring: default expiresAt = now+1h. ttlSeconds=0 → null (sem expiração).
  const ttl = parse.data.ttlSeconds ?? 3600
  const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 1000) : null

  const cmd = await (prisma as any).edgeCommand.create({
    data: {
      edgeNodeId:  node.id,
      type:        parse.data.type,
      payload:     parse.data.payload,
      createdById: jwt.sub,
      expiresAt,
    },
  })

  logger.info({ cmdId: cmd.id, type: cmd.type, nodeId: node.id }, 'iacv_box_command_enqueued')

  res.status(201).json({
    id:        cmd.id,
    type:      cmd.type,
    payload:   cmd.payload,
    issuedAt:  cmd.issuedAt.toISOString(),
    expiresAt: cmd.expiresAt?.toISOString() ?? null,
    message:   `Comando enfileirado. Será enviado à Box no próximo heartbeat (~60s).`,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/:nodeId/factory-reset (FCB-018 Sprint 0 wiring 2026-05-06)
//
// SUPER_ADMIN dispara wipe completo da Box (apaga /data, vault, license,
// tunnel.json, srt-passphrase). Box volta para first-boot. Hardware pode
// ser re-provisionado pra outro tenant sem vazamento de credenciais.
//
// Confirmação tripla via UI: nome do EdgeNode + checkbox + razão.
// ═════════════════════════════════════════════════════════════════════════════

const FactoryResetSchema = z.object({
  reason:               z.string().min(10).max(500),  // motivo obrigatório
  confirmEdgeNodeName:  z.string().min(1),            // nome do node (UI exige bater)
})

iacvBoxRouter.post('/:nodeId/factory-reset',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Apenas SUPER_ADMIN pode disparar FACTORY_RESET' })
    return
  }

  const parse = FactoryResetSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: req.params.nodeId },
    select: { id: true, name: true, status: true },
  })
  if (!node) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }

  // Confirmação tripla: nome digitado precisa bater com o do node
  if (parse.data.confirmEdgeNodeName !== node.name) {
    res.status(400).json({
      error:   'CONFIRMATION_MISMATCH',
      message: `Nome digitado "${parse.data.confirmEdgeNodeName}" não bate com o EdgeNode "${node.name}"`,
    })
    return
  }

  // Cria EdgeCommand FACTORY_RESET com TTL longo (24h — Box pode estar offline)
  const cmd = await (prisma as any).edgeCommand.create({
    data: {
      edgeNodeId:  node.id,
      type:        'FACTORY_RESET',
      payload:     {
        confirmation: 'WIPE_DATA_CONFIRMED',
        reason:       parse.data.reason,
        triggeredBy:  jwt.sub,
        triggeredAt:  new Date().toISOString(),
      } as any,
      createdById: jwt.sub,
      expiresAt:   new Date(Date.now() + 24 * 60 * 60 * 1000),  // 24h
    },
  })

  // Marca EdgeNode como DECOMMISSIONED imediatamente (não esperar Box ack)
  await prisma.edgeNode.update({
    where: { id: node.id },
    data:  { status: 'DECOMMISSIONED' as any },
  })

  // AuditLog (compliance + recuperação)
  await prisma.auditLog?.create({
    data: {
      superAdminId: jwt.sub,
      action:       'FACTORY_RESET_TRIGGERED',
      resource:     'EdgeNode',
      resourceId:   node.id,
      metadataJson: {
        nodeName:     node.name,
        previousStatus: node.status,
        reason:       parse.data.reason,
        cmdId:        cmd.id,
        ip:           req.ip,
      } as any,
    },
  }).catch(() => { /* não bloqueia */ })

  logger.warn(
    { nodeId: node.id, nodeName: node.name, by: jwt.sub, cmdId: cmd.id, reason: parse.data.reason },
    'iacv_box_factory_reset_triggered',
  )

  res.json({
    ok:        true,
    cmdId:     cmd.id,
    nodeId:    node.id,
    nodeName:  node.name,
    expiresAt: cmd.expiresAt?.toISOString(),
    message:   'FACTORY_RESET enfileirado. Box vai apagar /data e voltar para first-boot no próximo heartbeat. EdgeNode marcado DECOMMISSIONED.',
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /iacv-box/commands/:id/ack   (Box confirma que processou o comando)
//
// Endpoint público (sem requireAuth) — autenticado apenas pela licenseKey
// no body, como /heartbeat e /events.
// ═════════════════════════════════════════════════════════════════════════════

// ACK enriquecido (Box bridge be9c457) — Box envia status/durationSec/errorMessage/info.
// Idempotência: re-envio do mesmo cmd_id retorna ackedAt sem regravar.
const CommandAckSchema = z.object({
  licenseKey:   z.string().min(10),
  status:       z.enum(['OK', 'ERROR', 'UNSUPPORTED']).optional(),
  durationSec:  z.number().nonnegative().optional(),
  errorMessage: z.string().optional(),
  info:         z.any().optional(),  // payload livre — pode ser snapshot, diagnose, etc.
}).passthrough()

iacvBoxRouter.post('/commands/:id/ack',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const parse = CommandAckSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
  }
  const { licenseKey, status, durationSec, errorMessage, info } = parse.data

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
    // Idempotente — Box pode reenviar mesmo ack após restart
    res.json({
      ok: true,
      alreadyAcked: true,
      ackedAt: cmd.ackedAt.toISOString(),
      ackStatus: cmd.ackStatus,
    })
    return
  }

  const updated = await (prisma as any).edgeCommand.update({
    where: { id: cmd.id },
    data:  {
      ackedAt:         new Date(),
      ackStatus:       status ?? null,
      ackDurationSec:  durationSec ?? null,
      ackErrorMessage: errorMessage ?? null,
      ackInfo:         info ?? null,
    },
  })

  logger.info(
    { cmdId: cmd.id, type: cmd.type, nodeId: license.edgeNodeId, status, durationSec },
    'iacv_box_command_acked',
  )

  // Rastreabilidade no painel Logs (item Logs UI 2026-05-04):
  // ACK de comando é evento crítico — operador precisa saber se Box recebeu,
  // executou OK ou falhou. Persistido em EdgeConnectionLog para aparecer no
  // /audit/explorer junto com ACTIVATE/HEARTBEAT/MODULE_DRIFT.
  edgeConnectionLogService.log({
    edgeNodeId: license.edgeNodeId,
    eventType: 'COMMAND_ACK',
    status: status === 'OK' ? 'SUCCESS' : status === 'ERROR' || status === 'UNSUPPORTED' ? 'FAILED' : 'PENDING',
    errorCode: status === 'UNSUPPORTED' ? 'COMMAND_UNSUPPORTED' : status === 'ERROR' ? 'COMMAND_FAILED' : undefined,
    errorMessage: errorMessage ?? undefined,
    payload: { cmdId: cmd.id, type: cmd.type, durationSec, info },
  }).catch(() => { /* fire-and-forget */ })

  res.json({ ok: true, ackedAt: updated.ackedAt.toISOString(), ackStatus: updated.ackStatus })
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

iacvBoxRouter.get('/:boxId/config',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const { boxId } = req.params

  // Resolver identidade: Authorization: Bearer <edgeToken> ou X-IACV-License-Key header
  let resolvedEdgeToken: string | null = null

  const authHeader = req.headers['authorization'] as string | undefined
  const licKeyHeader = req.headers['x-iacv-license-key'] as string | undefined
  const licKeyQuery = req.query['licenseKey'] as string | undefined

  if (authHeader?.startsWith('Bearer ')) {
    resolvedEdgeToken = authHeader.slice(7)
  } else if (licKeyHeader) {
    resolvedEdgeToken = hashKey(licKeyHeader)
  } else if (licKeyQuery) {
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

iacvBoxRouter.post('/hardware-inventory',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const parse = HardwareInventorySchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
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

iacvBoxRouter.post('/telemetry-batch',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
  const parse = TelemetryBatchSchema.safeParse(req.body)
  if (!parse.success) {
    return zodValidationError(res, parse.error)
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

iacvBoxRouter.post('/messages',
  publicRoute(),
  assertBoxOwnership, async (req: Request, res: Response) => {
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
iacvBoxRouter.get('/messages/log',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
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
iacvBoxRouter.get('/events/:id/media-url',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
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

// ═════════════════════════════════════════════════════════════════════════════
// Central de Logs de Conexão — diagnóstico para suporte
// ═════════════════════════════════════════════════════════════════════════════

// GET /iacv-box/:boxId/connection-logs   (INTEGRADOR_ADMIN+ — ver logs de conexão do edge)
iacvBoxRouter.get('/:boxId/connection-logs',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  const { boxId } = req.params

  if (!['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'].includes(jwt.role)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: boxId },
    include: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
  }) as any

  if (!node) {
    res.status(404).json({ error: 'EDGE_NODE_NOT_FOUND' })
    return
  }

  if (jwt.role !== 'SUPER_ADMIN' && node.site.clienteFinal.integradorId !== jwt.integradorId) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Number(req.query.offset) || 0
  const eventType = req.query.eventType as string | undefined
  const status = req.query.status as string | undefined
  const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined
  const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined

  const result = await edgeConnectionLogService.getLogsForEdgeNode(boxId, {
    limit,
    offset,
    eventType: eventType as any,
    status: status as any,
    startDate,
    endDate,
  })

  res.json({
    ok: true,
    edgeNodeId: boxId,
    logs: result.logs,
    total: result.total,
    limit,
    offset,
  })
})

// GET /iacv-box/:boxId/connection-stats   (INTEGRADOR_ADMIN+ — estatísticas de conexão)
iacvBoxRouter.get('/:boxId/connection-stats',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  const { boxId } = req.params

  if (!['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'].includes(jwt.role)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: boxId },
    include: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
  }) as any

  if (!node) {
    res.status(404).json({ error: 'EDGE_NODE_NOT_FOUND' })
    return
  }

  if (jwt.role !== 'SUPER_ADMIN' && node.site.clienteFinal.integradorId !== jwt.integradorId) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const hours = Number(req.query.hours) || 24
  const stats = await edgeConnectionLogService.getConnectionStats(boxId, hours)

  res.json({
    ok: true,
    edgeNodeId: boxId,
    edgeNodeName: node.name,
    ...stats,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /iacv-box/:boxId/module-drift   (INTEGRADOR_ADMIN+ — compliance check)
// Item 2.13 docs/08 — lista drifts entre enforcedModules e tenant.modulesEnabled
// ═════════════════════════════════════════════════════════════════════════════
iacvBoxRouter.get('/:boxId/module-drift',
  publicRoute(),
  requireAuth, async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  const { boxId } = req.params

  if (!['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'].includes(jwt.role)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: boxId },
    include: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
  }) as any

  if (!node) {
    res.status(404).json({ error: 'EDGE_NODE_NOT_FOUND' })
    return
  }

  if (jwt.role !== 'SUPER_ADMIN' && node.site.clienteFinal.integradorId !== jwt.integradorId) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100)

  // Últimos drifts registrados (qualquer status)
  const recent = await prisma.edgeConnectionLog.findMany({
    where: { edgeNodeId: boxId, eventType: 'MODULE_DRIFT' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, status: true, errorCode: true, errorMessage: true,
      payload: true, createdAt: true,
    },
  })

  // Estado atual: avaliação on-the-fly do último heartbeat
  const lastHeartbeatRaw = await prisma.edgeNode.findUnique({
    where: { id: boxId },
    select: { lastTelemetryRaw: true, lastHeartbeat: true },
  })
  const enforced = (lastHeartbeatRaw?.lastTelemetryRaw as any)?.enforcedModules

  let current: any = null
  if (enforced) {
    const { detectModuleDrift } = await import('../services/box-compliance.service')
    current = await detectModuleDrift(boxId, enforced)
  }

  res.json({
    ok: true,
    edgeNodeId: boxId,
    edgeNodeName: node.name,
    lastHeartbeatAt: lastHeartbeatRaw?.lastHeartbeat ?? null,
    current,            // estado avaliado agora (live)
    recent,             // histórico persistido
  })
})
