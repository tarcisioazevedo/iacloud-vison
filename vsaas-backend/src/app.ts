// Patch Express Router para suportar handlers async nativamente.
// DEVE ser o primeiro import — antes de importar Router/rotas.
import './lib/express-async-patch'

import path from 'path'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import pinoHttp from 'pino-http'
import { randomUUID } from 'crypto'
import { prisma } from './lib/prisma'
import { logger } from './lib/logger'
import { errorHandler } from './middleware/error-handler'
import { softAuth } from './middleware/auth'
import { proxyAuth } from './middleware/proxy-auth'
import { tenantContext } from './middleware/tenant-context'
import { authRouter } from './routes/auth'
import { edgeRouter } from './routes/edge'
import { edgeNodesRouter } from './routes/edge-nodes'
import { cameraRouter } from './routes/cameras'
import { sitesRouter } from './routes/sites'
import { biRouter } from './routes/bi'
import { integradorRouter } from './routes/integradores'
import { modulesRouter } from './routes/modules'
import { logsRouter } from './routes/logs'
import { facesRouter } from './routes/faces'
import { platesRouter } from './routes/plates'
import { semanticSearchRouter } from './routes/semantic-search'
import { reviewRouter } from './routes/review'
import { liveRouter } from './routes/live'
import { pushRouter } from './routes/push'
import { triggersRouter } from './routes/triggers'
import { mqttRouter } from './routes/mqtt'
import { openapiRouter } from './routes/openapi'
import { quotaRouter } from './routes/quota'
import { usersRouter } from './routes/users'
import { clientesFinaisRouter } from './routes/clientes-finais'
import { portalRouter } from './routes/portal'
import { auditRouter } from './routes/audit'
import { internalRouter } from './routes/internal'
import { ingestRouter } from './routes/ingest'
import { leadsRouter } from './routes/leads'
import {
  demoInvitesRouter,
  demoPublicRouter,
  leadActionsRouter,
} from './routes/demo-invites'
import { technicianAccessRouter } from './routes/technician-access'
import { customDomainsRouter }    from './routes/custom-domains'
import { impersonationRouter }    from './routes/impersonation'
import { approvalsRouter }        from './routes/approvals'
import { notificationsRouter }    from './routes/notifications'
import { iacvBoxRouter }          from './routes/iacv-box'
import { fleetRouter }            from './routes/fleet'
import { telegramRouter }         from './routes/telegram'
import { ingestService } from './services/ingest.service'
import { playbackRouter } from './routes/playback'
import { recordingService } from './services/recording.service'
import { emailConfigRouter }      from './routes/email-config'
import { alertRecipientsRouter }  from './routes/alert-recipients'
import { alertConfigRouter, alertDeliveriesRouter } from './routes/alert-config'
import { cameraWatchdogService }  from './services/camera-watchdog.service'
import { digestService }          from './services/digest.service'
import { storageConfigRouter }    from './routes/storage-config'
import { floorPlansRouter }       from './routes/floor-plans'
import { bookmarksRouter }        from './routes/bookmarks'
import { recordingScheduleRouter } from './routes/recording-schedule'
import { recordingsSegmentsRouter } from './routes/recordings-segments'
import { detectionsRouter }       from './routes/detections'
import { exportAuditRouter }      from './routes/export-audit'
import { certificatesRouter }     from './routes/certificates'
import { exportsRouter }          from './routes/exports'
import fs from 'fs'

const app = express()

// ── CORS — permite localhost (dev) e domínios de produção ────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin ?? ''
  const allowed = [
    'http://localhost:5173', 'http://localhost:4173',
    'http://127.0.0.1:5173', 'http://127.0.0.1:4173',
    'https://app.iacloud.com.br', 'http://app.iacloud.com.br',
    'https://evolution.iacloud.com.br',
  ]
  const isAllowed = allowed.includes(origin) ||
                    process.env.NODE_ENV === 'development' ||
                    origin.endsWith('.iacloud.com.br') ||
                    origin.startsWith('http://192.168.') ||
                    origin.startsWith('http://10.')

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,X-ICV-Tenant,Idempotency-Key')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

// ── Segurança ────────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}))
app.use(express.json({ limit: '10mb' }))  // crop JPEG + snapshot WebP base64 do IACV Box

// ── Logging ──────────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    // Propaga x-request-id entre serviços para correlação em multi-tenant.
    genReqId: (req, res) => {
      const incoming = (req.headers['x-request-id'] as string) || randomUUID()
      res.setHeader('x-request-id', incoming)
      return incoming
    },
    // Não polui log com healthchecks (K8s/Cloud Run bate a cada 10s).
    autoLogging: {
      ignore: req =>
        req.url === '/health' ||
        req.url === '/health/live' ||
        req.url === '/health/ready',
    },
  }),
)

// ── Soft auth ────────────────────────────────────────────────────────────────
// Decodifica JWT sem enforcement, populando req.jwtPayload quando válido.
// Permite que o rate limiter use a chave por tenant antes do requireAuth.
app.use(softAuth)

// ── Proxy Auth (Sprint E.1) ──────────────────────────────────────────────────
// Aceita auth via header de proxy reverso (Authentik/Authelia/oauth2-proxy).
// No-op se PROXY_AUTH_ENABLED!=true. Roda APÓS softAuth para permitir que JWT
// Bearer tradicional ainda funcione em paralelo durante migração.
app.use(proxyAuth)

// ── Tenant Context via Cloudflare Worker (Sprint CF.2) ──────────────────────
// Lê e valida o header X-ICV-Tenant injetado pelo Worker no edge. Quando
// presente e válido, popula req.tenantContext.integradorId — fonte preferida
// pra resolver tenant em rotas tenant-scoped (precedência sobre JWT, ver
// resolveIntegradorId() em middleware/tenant-context.ts).
//
// Roda APÓS softAuth + proxyAuth pra que o conflito JWT × header possa ser
// detectado (ambos populados → middleware rejeita 403). Header ausente é
// no-op silencioso (compatibilidade com clientes Bearer-only).
app.use(tenantContext)

// ── Rate limiting global ─────────────────────────────────────────────────────
// Em multi-tenant, rate limit por IP é problemático: vários tenants podem
// compartilhar o mesmo IP (escritório com NAT, mobile carrier-grade NAT) e
// um único tenant barulhento derrubaria os outros. A chave certa é o
// integradorId (ou clienteFinalId, ou superAdmin sub) extraído do JWT.
//
// Quando ainda não há JWT (login, healthcheck), caímos pra IP — limite mais
// frouxo só nesse caso pra não impedir login válido.
app.use(
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    max:      Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 200),
    standardHeaders: true,
    legacyHeaders:   false,
    keyGenerator: (req) => {
      const jwt = req.jwtPayload
      if (jwt?.integradorId) return `tenant:integ:${jwt.integradorId}`
      if (jwt?.clienteFinalId) return `tenant:cf:${jwt.clienteFinalId}`
      if (jwt?.sub && jwt.role === 'SUPER_ADMIN') return `super:${jwt.sub}`
      // sem JWT (auth/login, health…) — chave por IP. express-rate-limit já
      // detecta IPv6 corretamente quando tem trust proxy configurado.
      return `ip:${req.ip ?? 'unknown'}`
    },
    // Sem JWT (login) tem limite menor pra dificultar brute force.
    skip: (req) => req.path === '/health/live' || req.path === '/health/ready',
  }),
)

// Rate limit mais restrito para edge ingest (evitar spam por edge node).
// Edge bate com x-edge-token, não com JWT — chave é o token da edge.
app.use(
  '/edge/ingest',
  rateLimit({
    windowMs: 1_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const tok = req.headers['x-edge-token']
      return typeof tok === 'string' && tok.length > 0
        ? `edge:${tok.slice(0, 16)}`  // só prefixo do token na chave
        : `ip:${req.ip ?? 'unknown'}`
    },
  }),
)

// ── Healthchecks ─────────────────────────────────────────────────────────────
// /health/live  — o processo está vivo? (sempre 200 se Express responde)
// /health/ready — pronto para receber tráfego? (checa dependências)
// /health       — mantido por compat; equivale a /health/live
app.get(['/health', '/health/live'], (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

// ── Pricing público (planos comerciais) ─────────────────────────────────────
// Frontend usa pra exibir preços na seleção de tier. Auth não exigida —
// preços de plano não são informação sensível e ajuda em UX (tela de plans
// pré-login pode mostrar valores).
app.get('/pricing', async (_req, res) => {
  // import dinâmico para evitar carregar pricing antes do soft-auth.
  const { COMMERCIAL_PRICING } = await import('./lib/pricing')
  res.json({
    currency: 'BRL',
    period:   'month',
    tiers: [
      { tier: 'BRONZE',   price: COMMERCIAL_PRICING.BRONZE   },
      { tier: 'SILVER',   price: COMMERCIAL_PRICING.SILVER   },
      { tier: 'GOLD',     price: COMMERCIAL_PRICING.GOLD     },
      { tier: 'PLATINUM', price: COMMERCIAL_PRICING.PLATINUM },
    ],
    technical: [
      { tier: 'STATIC_VISION',       model: 'pay-per-call' },
      { tier: 'STREAMING_ANALYTICS', model: 'pay-per-hour' },
    ],
  })
})

app.get('/health/ready', async (_req, res) => {
  try {
    // Query barata; timeout curto para não travar probe do orquestrador.
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ready', ts: new Date().toISOString() })
  } catch (err) {
    // 503 é o código correto — orquestrador remove da rotação sem matar o pod.
    logger.warn({ err }, 'readiness_probe_failed')
    res.status(503).json({ status: 'not_ready', reason: 'database_unreachable' })
  }
})

// ── Rotas ────────────────────────────────────────────────────────────────────

// Config pública do ingestor RTMP — usada pelo frontend no card "Modo de ingestão"
// para montar a URL que o operador cola na câmera. Não contém segredos.
app.get('/config/ingest', (_req, res) => {
  const host = process.env.RTMP_INGEST_PUBLIC_HOST ?? '192.168.0.114'
  const port = Number(process.env.RTMP_INGEST_PUBLIC_PORT ?? 1936)
  const portSuffix = port === 1935 ? '' : `:${port}`
  res.json({
    rtmpHost:    host,
    rtmpPort:    port,
    rtmpUrlBase: `rtmp://${host}${portSuffix}/live`,
  })
})

app.use('/config/email',      emailConfigRouter)
app.use('/alert-recipients', alertRecipientsRouter)
app.use('/alert-config',     alertConfigRouter)
app.use('/alert-deliveries', alertDeliveriesRouter)
app.use('/auth',          authRouter)
app.use('/edge',          edgeRouter)
app.use('/edge-nodes',    edgeNodesRouter)
app.use('/cameras',       cameraRouter)
app.use('/sites',         sitesRouter)
app.use('/bi',            biRouter)
app.use('/admin/integradores', integradorRouter)
app.use('/modules',            modulesRouter)
app.use('/logs',               logsRouter)
app.use('/faces',              facesRouter)
app.use('/plates',             platesRouter)
app.use('/semantic-search',    semanticSearchRouter)
app.use('/review',             reviewRouter)
app.use('/live',               liveRouter)

// ── Sprint Q.1 / S / E.2 / Q.4 ───────────────────────────────────────────────
app.use('/push',     pushRouter)         // WebPush VAPID
app.use('/triggers', triggersRouter)     // Semantic Triggers
app.use('/mqtt',     mqttRouter)         // MQTT status / test / catalog
app.use('/',         openapiRouter)      // /openapi.json + /docs (Swagger UI)
app.use('/',         quotaRouter)        // /quota/status + /quota/me
app.use('/users',    usersRouter)        // GET /users + POST /users/invite (Gap 4)
app.use('/clientes-finais', clientesFinaisRouter)  // CRUD clientes finais + commercialPlan (Gap 5)
app.use('/portal',          portalRouter)          // Portal cliente-final público (CF.4): branding + exchange
app.use('/audit',           auditRouter)           // Transparência LGPD: ações da plataforma (Gap 6)
app.use('/internal',        internalRouter)        // Endpoints chamados por workers/cron (auth: INTERNAL_API_TOKEN)
app.use('/leads',           leadsRouter)           // Lote 0: funil de leads público (POST) + CRM admin (GET/PATCH) + BrasilAPI proxy
app.use('/leads',           leadActionsRouter)     // Lote 1: POST /leads/:id/invite + POST /leads/:id/convert
app.use('/demo-invites',    demoInvitesRouter)     // Lote 1: GET listagem + POST /:id/revoke (SUPER_ADMIN)
app.use('/demo',            demoPublicRouter)      // Lote 1: GET /demo/:token + POST /demo/:token/accept (público)
app.use('/technician-access', technicianAccessRouter) // Lote 3: ACL técnicos → clientes
app.use('/custom-domains',    customDomainsRouter)    // Lote 4: white-label domains
app.use('/auth/impersonate',  impersonationRouter)    // Lote 5: impersonation (SUPER_ADMIN)
app.use('/approvals',         approvalsRouter)         // Lote 6: deletion approvals + sensitive actions
app.use('/notifications',     notificationsRouter)     // WhatsApp Evolution API + future channels
app.use('/iacv-box',          iacvBoxRouter)           // IACV Box: licenciamento + heartbeat + eventos edge
app.use('/fleet',             fleetRouter)             // Fleet UI: gestão centralizada de Edge Nodes
app.use('/telegram',          telegramRouter)          // Telegram: link/verify/status para notificações
app.use('/storage',           storageConfigRouter)     // Storage S3: config por integrador + browser + stats
app.use('/floor-plans',       floorPlansRouter)        // Mapa Sinótico: plantas baixas com câmeras
app.use('/uploads',           express.static(path.join(process.cwd(), 'uploads')))  // Imagens de plantas sinóticas

// ── Recordings UX (bookmarks, schedule, timeline segmentos, detections, audit, certificates) ──
app.use('/bookmarks',         bookmarksRouter)         // Bookmarks (manual + auto)
app.use('/cameras',           recordingScheduleRouter) // /cameras/:id/recording-schedule
app.use('/recordings',        recordingsSegmentsRouter) // /recordings/segments (Timeline)
app.use('/detections',        detectionsRouter)        // /detections/ingest (edge) + /detections/zone-search (operador)
app.use('/export-audit',      exportAuditRouter)       // Auditoria LGPD de exportações
app.use('/certificates',      certificatesRouter)      // Assinatura digital HMAC + verify público

// Static dos arquivos exportados (snapshots, mp4, mosaics).
// Diretório criado no boot — paths são UUIDs aleatórios, não enumeráveis.
// Static vem ANTES do router para que GET /exports/<uuid>.mp4 sirva o arquivo
// direto e POST/DELETE /exports/* (não-GET) caiam no router. GET /exports/
// (sem filename) e /exports/:jobId/status passam por static (next()) e caem
// no router.
const EXPORTS_DIR = path.join(process.cwd(), 'exports')
fs.mkdirSync(EXPORTS_DIR, { recursive: true })
app.use('/exports', express.static(EXPORTS_DIR, { fallthrough: true, index: false }))
app.use('/exports', exportsRouter)                     // Fila de export jobs (snapshot/recording/mosaic)
app.use('/v1',                edgeRouter)              // alias /v1/rules, /v1/config → mesma lógica edge
app.use('/',                  edgeRouter)              // alias /rules → GET /rules sem prefixo

// RTMP push ingest (camera→cloud) — endpoints expõem várias rotas:
//   /admin/ingest-log          (SUPER_ADMIN, auditoria global)
//   /cameras/:id/rtmp-ingest-key (operador, com scope tenant)
//   /config/ingest             (público, retorna FQDN do ingest)
// Por isso registramos sem prefixo único — cada handler já carrega o path.
app.use('/', ingestRouter)

// HLS Playback de gravações:
//   POST /playback/token              (operador, requireAuth)
//   GET  /playback/:id/manifest.m3u8  (auth via ticket query string)
//   GET  /playback/:id/segments/:sid.ts (auth via ticket)
//   GET  /playback/:id/timeline       (operador, requireAuth)
//   GET  /playback/:id/index          (operador, requireAuth)
app.use('/playback', playbackRouter)

// Inicia o serviço de sincronização go2rtc → DB (5s tick).
// Idempotente em HMR: chamadas extras são no-op.
ingestService.start()

// Inicia o supervisor de gravação (ffmpeg por câmera + retention).
// Pode ser desabilitado via RECORDING_ENABLED=false em dev/CI.
recordingService.start()

// Inicia watchdog de câmeras (tick 60s): detecta offline/recovery e envia alertas.
cameraWatchdogService.start()

// Inicia serviço de digest diário (check a cada 5min).
digestService.start()

// ── Erro global ──────────────────────────────────────────────────────────────
app.use(errorHandler)

export { app }
