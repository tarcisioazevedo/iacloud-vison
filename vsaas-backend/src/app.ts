// G11 fix: força UTC. ffmpeg strftime + Date#toISOString precisam ser
// coerentes. Em dev (Mac/Linux) sem TZ no env, processo herda timezone do
// host. Aqui garantimos UTC universal.
process.env.TZ ||= 'UTC'

// Patch Express Router para suportar handlers async nativamente.
// DEVE ser o primeiro import — antes de importar Router/rotas.
import './lib/express-async-patch'

import path from 'path'
import express from 'express'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import pinoHttp from 'pino-http'
import { randomUUID } from 'crypto'
import { prisma } from './lib/prisma'
import { logger } from './lib/logger'
import { sentryContextMiddleware } from './middleware/sentry-context'
import { errorHandler } from './middleware/error-handler'
import { softAuth } from './middleware/auth'
import { proxyAuth } from './middleware/proxy-auth'
import { auditWrite } from './middleware/audit-write'
import { tenantContext } from './middleware/tenant-context'
import { authRouter } from './routes/auth'
import { edgeRouter } from './routes/edge'
import { edgeNodesRouter } from './routes/edge-nodes'
import { cameraRouter } from './routes/cameras'
import { sitesRouter } from './routes/sites'
import { biRouter } from './routes/bi'
import { integradorRouter, meIntegradorRouter } from './routes/integradores'
import { adminAlertsRouter } from './routes/admin-alerts'
import { salesRouter } from './routes/sales'
import { modulesRouter } from './routes/modules'
import { logsRouter } from './routes/logs'
import { lgpdRouter } from './routes/lgpd'  // FCB-016 Sprint 0 wiring 2026-05-06
import { facesRouter } from './routes/faces'
import { platesRouter } from './routes/plates'
import { semanticSearchRouter } from './routes/semantic-search'
import { reviewRouter } from './routes/review'
import { liveRouter } from './routes/live'
import { liveDetectionsRouter } from './routes/live-detections'
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
import { adminNotificationsRouter } from './routes/admin-notifications'
import { notifyPrefsRouter }      from './routes/notify-prefs'
import { iacvBoxRouter }          from './routes/iacv-box'
import { iacvBoxSegmentsRouter }  from './routes/iacv-box-segments'
import { iacvBoxSpritesRouter }   from './routes/iacv-box-sprites'
import { fleetRouter }            from './routes/fleet'
import { telegramRouter }         from './routes/telegram'
import { ingestService } from './services/ingest.service'
import { playbackRouter } from './routes/playback'
import { recordingService } from './services/recording.service'
import { emailConfigRouter }      from './routes/email-config'
import { meIntegradorSmtpRouter }  from './routes/me-integrador-smtp'
import { alertRecipientsRouter }  from './routes/alert-recipients'
import { alertConfigRouter, alertDeliveriesRouter } from './routes/alert-config'
import { cameraWatchdogService }  from './services/camera-watchdog.service'
import { digestService }          from './services/digest.service'
import { storageConfigRouter }    from './routes/storage-config'
import { retentionRouter }        from './routes/retention'
import { marketplaceRouter }      from './routes/marketplace'
import { adminMarketplaceRouter } from './routes/admin-marketplace'
import timelapseWorkerRouter      from './routes/timelapse-worker'
import { vaultRouter }            from './routes/vault'
import { billingRouter }          from './routes/billing'
import { whitelabelRouter }       from './routes/whitelabel'
import { floorPlansRouter }       from './routes/floor-plans'
import { bookmarksRouter }        from './routes/bookmarks'
import { recordingScheduleRouter } from './routes/recording-schedule'
import { recordingsSegmentsRouter } from './routes/recordings-segments'
import { exportAuditRouter }      from './routes/export-audit'
import { detectionsRouter }      from './routes/detections'
import { certificatesRouter }     from './routes/certificates'
import { exportsRouter }          from './routes/exports'
import { exportService }          from './services/export.service'
import { adminHealthScoresRouter, meIntegradorHealthScoresRouter } from './routes/health-scores'
import { adminTrialsRouter, meTrialStatusRouter } from './routes/trials'
import { adminSpritesRouter } from './routes/admin-sprites'
import { adminHealthAlertsRouter, meHealthAlertsRouter } from './routes/health-alerts'
import { adminDealRegistrationRouter, meDealRegistrationRouter } from './routes/deal-registration'
import { streamManagerRouter } from './routes/stream-manager'
import pricingRouter         from './routes/pricing'
import adminPricingRouter    from './routes/admin-pricing'
import adminWhitelabelRouter from './routes/admin-whitelabel'
import adminBillingRouter    from './routes/admin-billing'
import mePricingRouter       from './routes/me-pricing'
import webhooksAsaasRouter   from './routes/webhooks-asaas'
import { requireWhitelabelCapability } from './middleware/whitelabel-capability'
import { startTrialExpirationCron } from './services/trial-expiration.service'
import { startHealthAlertCron } from './services/health-alert-cron.service'
import { startDealRegistrationCron } from './services/deal-registration-cron.service'
import { cloudDirectRecorder, startCloudDirectScheduleReconcile } from './services/cloud-direct-recorder.service'
import fs from 'fs'

const app = express()
const backgroundJobsEnabled = process.env.BACKGROUND_JOBS_ENABLED !== 'false'

// ── CORS — whitelist explícita + dev local ───────────────────────────────────
// P2 hardening 2026-05-12: removidos wildcards de rede privada (192.168.*, 10.*).
// Caso precise testar Box numa LAN, exporte ICV_CORS_PRIVATE_NETWORK=1 no env
// só naquele ambiente (NUNCA em produção). Whitelist atual cobre todos os
// caminhos legítimos: dev local + prod app.iacloud.com.br + subdomínios.
app.use((req, res, next) => {
  const origin = req.headers.origin ?? ''
  const allowed = [
    'http://localhost:5173', 'http://localhost:4173',
    'http://127.0.0.1:5173', 'http://127.0.0.1:4173',
    'https://app.iacloud.com.br', 'http://app.iacloud.com.br',
    'https://evolution.iacloud.com.br',
  ]

  // Permite redes privadas SÓ se explicitamente habilitado (ambiente de campo)
  const allowPrivateNets = process.env.ICV_CORS_PRIVATE_NETWORK === '1'

  const isAllowed = allowed.includes(origin) ||
                    process.env.NODE_ENV === 'development' ||
                    origin.endsWith('.iacloud.com.br') ||
                    (allowPrivateNets && (
                      origin.startsWith('http://192.168.') ||
                      origin.startsWith('http://10.')
                    ))

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

// ── Compressão (defesa em profundidade) ──────────────────────────────────────
// Caddy já faz `encode zstd gzip` na borda de app.iacloud.com.br, mas calls
// que chegam direto no backend (Box, healthcheck interno, integradores via
// IP) sairiam sem compressão. Express com `compression` resolve. Não-conflito
// com Caddy: se Content-Encoding já vier setado, Caddy passa direto.
// Pula playback de segmento (.ts já comprimido / streaming) e snapshots JPEG.
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false
    // Não recompactar mídia binária — segments .ts e JPEG/WebP snapshot.
    const ct = String(res.getHeader('Content-Type') || '')
    if (ct.startsWith('video/') || ct.startsWith('image/')) return false
    return compression.filter(req, res)
  },
  threshold: 1024, // só comprime payload >= 1KB
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

// ── Sentry context — enriquece scope com userId, tenantId, requestId ────
app.use(sentryContextMiddleware)

// ── Audit Write (Onda 0/1 do log-audit) ─────────────────────────────────────
// Captura TODA escrita HTTP (POST/PUT/PATCH/DELETE) e registra no AuditLog
// automaticamente. Cobertura LGPD-compliant: forense completo + trilha
// de mutações de qualquer endpoint, mesmo os ainda não auditados manualmente.
//
// Roda APÓS softAuth + tenantContext porque precisa de req.jwtPayload e do
// tenant resolvido para preencher os ator-IDs corretamente. Insert é async
// em res.on('finish'), então não impacta latência da resposta.
//
// Skip paths configurado em audit-write.ts: heartbeats, webhooks externos,
// endpoints internos, refresh token. Body é sanitizado (senhas/tokens
// redacted) antes de virar metadataJson.
app.use(auditWrite)

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
    skip: (req) => req.path === '/health' || req.path === '/health/live' || req.path === '/health/ready',
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
//
// Inclui tmpfs (G4) + R2 latency (Onda 1 / P2 #20). Cacheado 5s para não
// martelar o R2 a cada request — UI pode polling sem causar carga upstream.
let cachedR2Health: { ok: boolean; latencyMs: number | null; cachedAt: number } | null = null
async function getR2Health(): Promise<{ ok: boolean; latencyMs: number | null }> {
  if (cachedR2Health && Date.now() - cachedR2Health.cachedAt < 5000) {
    return { ok: cachedR2Health.ok, latencyMs: cachedR2Health.latencyMs }
  }
  try {
    const m = await import('./services/r2-storage.service')
    if (!m.r2Storage.isEnabled()) {
      cachedR2Health = { ok: false, latencyMs: null, cachedAt: Date.now() }
      return { ok: false, latencyMs: null }
    }
    const t0 = Date.now()
    const result = await m.r2Storage.healthCheck()
    const latencyMs = Date.now() - t0
    cachedR2Health = { ok: !!result?.ok, latencyMs, cachedAt: Date.now() }
    return { ok: !!result?.ok, latencyMs }
  } catch {
    cachedR2Health = { ok: false, latencyMs: null, cachedAt: Date.now() }
    return { ok: false, latencyMs: null }
  }
}

app.get(['/health', '/health/live'], async (_req, res) => {
  let tmpfs: any = null
  try {
    const m = await import('./services/recording-tmpfs-watchdog.service')
    tmpfs = {
      paused: m.tmpfsWatchdog.isPaused(),
      ...(m.tmpfsWatchdog.snapshot() ?? {}),
    }
  } catch { /* watchdog ainda não iniciou */ }

  const r2 = await getR2Health().catch(() => ({ ok: false, latencyMs: null }))
  res.json({ status: 'ok', ts: new Date().toISOString(), tmpfs, r2 })
})

// ── Pricing público (CMS multi-tenant) ──────────────────────────────────────
// Alimenta /pricing com dados editáveis no Admin. Multi-tenant: backend detecta
// integrador via X-ICV-Tenant e mescla overrides automaticamente.
// ── Pricing público (CMS multi-tenant) ──────────────────────────────────────
// Detecta integrador via X-ICV-Tenant e mescla overrides automaticamente.
app.use('/pricing', pricingRouter)
// Webhook Asaas (kill-switch BILLING_ENABLED)
app.use('/webhooks', webhooksAsaasRouter)

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
app.use('/admin/pricing',      adminPricingRouter)         // CMS master (SUPER_ADMIN)
app.use('/admin/whitelabel',   adminWhitelabelRouter)      // Tier+capabilities (SUPER_ADMIN)
app.use('/admin/billing',      adminBillingRouter)         // Asaas billing status (SUPER_ADMIN)
app.use('/admin/health-scores', adminHealthScoresRouter)   // Health Score fabricante view (SUPER_ADMIN)
app.use('/admin/health-alerts', adminHealthAlertsRouter)   // Health alerts (SUPER_ADMIN)
app.use('/admin/trials',        adminTrialsRouter)         // Trial flow (SUPER_ADMIN)
app.use('/admin/sprites',       adminSpritesRouter)        // Sprite backfill on-demand (SUPER_ADMIN)
app.use('/admin/deal-registration', adminDealRegistrationRouter) // Deal Registration (SUPER_ADMIN)
app.use('/admin/stream-manager',    streamManagerRouter)         // Stream ingest tools (SUPER_ADMIN)
app.use('/admin/integradores', integradorRouter)
// Tenant-scoped — mais específico antes do /me/integrador genérico (Express prefix matching)
app.use('/me/integrador/pricing', requireWhitelabelCapability('pricing'), mePricingRouter)
app.use('/me/integrador/smtp',    meIntegradorSmtpRouter)
app.use('/me/integrador/health-scores', meIntegradorHealthScoresRouter)
app.use('/me/integrador/health-alerts', meHealthAlertsRouter)
app.use('/me/integrador/deal-registration', meDealRegistrationRouter)
app.use('/me/integrador/trial-status', meTrialStatusRouter)
app.use('/me/integrador',      meIntegradorRouter)   // escopo automático via JWT
app.use('/admin/alerts',       adminAlertsRouter)
app.use('/sales',              salesRouter)
app.use('/modules',            modulesRouter)
app.use('/logs',               logsRouter)
app.use('/lgpd',               lgpdRouter)              // FCB-016 — LGPD Art. 18 (export/erasure/summary)
app.use('/faces',              facesRouter)
app.use('/plates',             platesRouter)
app.use('/semantic-search',    semanticSearchRouter)
app.use('/review',             reviewRouter)
// liveDetectionsRouter ANTES de liveRouter: /live/detections precisa vencer
// antes do path-param `/live/:id` consumir "detections" como cameraId.
app.use('/live/detections',    liveDetectionsRouter)   // SSE bbox em tempo real
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
app.use('/auth/impersonate',  impersonationRouter)    // Lote 5: impersonation (SUPER_ADMIN + INTEGRADOR_ADMIN scope-restricted)
app.use('/approvals',         approvalsRouter)         // Lote 6: deletion approvals + sensitive actions
app.use('/notifications',     notificationsRouter)     // WhatsApp Evolution API + future channels
app.use('/admin/notifications', adminNotificationsRouter) // WhatsApp singleton do fabricante (super-admin)
app.use('/notify',            notifyPrefsRouter)       // Preferências multi-canal + test + log
app.use('/iacv-box',          iacvBoxRouter)           // IACV Box: licenciamento + heartbeat + eventos edge
app.use('/iacv-box/segments', iacvBoxSegmentsRouter)  // IACV Box: ingest de segmentos de gravação (upload/presign/register)
app.use('/iacv-box/sprites',  iacvBoxSpritesRouter)   // IACV Box: ingest de sprite-sheets de preview (upload/presign/register)
app.use('/fleet',             fleetRouter)             // Fleet UI: gestão centralizada de Edge Nodes
app.use('/telegram',          telegramRouter)          // Telegram: link/verify/status para notificações
app.use('/storage',           storageConfigRouter)     // Storage S3: config por integrador + browser + stats
app.use('/retention',         retentionRouter)         // Sprint 2: catálogo de planos + contract + atribuição + upgrade requests
app.use('/marketplace',       marketplaceRouter)       // Sprint 1+2: marketplace de produtos + assinaturas + cancelamento + upgrade + approvals
app.use('/admin/marketplace', adminMarketplaceRouter)  // Sprint 2: admin CRUD MarketplaceProduct + stats
app.use('/timelapse/worker',  timelapseWorkerRouter)   // Sprint 4: worker API para processamento de TimelapseJobs
app.use('/vault',             vaultRouter)             // Acesso a clips/snaps Frigate (edge box) — fallback playback quando HLS está vazio
app.use('/billing',           billingRouter)           // Sprint 4: painel de margem + drill-down + reconciliação CF
app.use('/me/whitelabel',     whitelabelRouter)        // Sprint 5: custom domain por integrador (white-label CF Custom Hostnames)
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
//
// 2026-05-12 — P0-1 fix de auth bypass.
// Antes: express.static servia QUALQUER arquivo se o cliente soubesse o UUID.
// Tarcísio reportou: `curl -s http://app.iacloud.com.br/exports/abc.mp4` baixava
// sem auth nenhuma.
//
// Agora: middleware `exportDownloadGate` exige `?ticket=<JWT>` (assinado pelo
// exportService quando o job conclui). Ticket TTL=1h, vinculado a {jobId,
// tenantId}. Frontend não muda — `result.url` já vem com `?ticket=...`.
//
// Diretório criado no boot. POST/DELETE /exports/* (não-GET) e
// GET /exports/:jobId/status caem no router (gate só intercepta GET de arquivo).
const EXPORTS_DIR = path.join(process.cwd(), 'exports')
fs.mkdirSync(EXPORTS_DIR, { recursive: true })

// Gate: valida ticket antes de express.static.
// Padrão URL aceito: GET /exports/<uuid>.<ext>?ticket=<jwt>
// Path com extensão (.mp4, .jpg, .png) requer ticket; sem extensão (status
// endpoints) passa pra router.
app.use('/exports', (req, res, next) => {
  // Só GET de arquivo (com extensão) precisa de gate. Resto cai no router.
  if (req.method !== 'GET') return next()
  const m = req.path.match(/^\/([0-9a-f-]{36})\.(mp4|jpg|jpeg|png)$/i)
  if (!m) return next() // /exports/:id/status, /exports listing → router
  const jobIdFromPath = m[1]
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : null
  if (!ticket) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Download requer ticket assinado' })
    return
  }
  try {
    const decoded = exportService.verifyDownloadTicket(ticket)
    if (decoded.jobId !== jobIdFromPath) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Ticket não corresponde ao arquivo' })
      return
    }
    // Opcional: também valida que job ainda existe + match tenantId (defesa
    // em profundidade contra ticket roubado pós-purge do job).
    const job = exportService.getJob(decoded.jobId)
    if (job && job.tenantId !== decoded.tenantId) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Tenant não confere' })
      return
    }
    return next()
  } catch (err: any) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Ticket inválido ou expirado' })
    return
  }
})

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

// AI Agent — chat conversacional sobre events (Gemini Pro + function calling)
import { aiAgentRouter } from './routes/ai-agent'
app.use('/ai-agent', aiAgentRouter)

// Inicia o serviço de sincronização go2rtc → DB (5s tick).
// Idempotente em HMR: chamadas extras são no-op.
if (backgroundJobsEnabled) {
  ingestService.start()

  // SRT Ingest — detecta publishers SRT ativos no MediaMTX e mantém
  // status das câmeras SRT_PUSH CLOUD_DIRECT atualizadas (tick 2s).
  import('./services/srt-ingest.service').then(({ srtIngestService }) => {
    srtIngestService.start()
  }).catch(err => logger.error({ err }, 'srt_ingest_start_failed'))

  // GenAI — carrega chave global do SystemConfig (DB) sobrescrevendo a
  // que veio de env/secret no import do genai.service. Idempotente, no-op
  // se DB não tem entrada. Roda ANTES dos jobs pra eles já usarem a chave
  // correta na primeira execução.
  import('./services/ai-system-config.service').then(({ bootstrapAISystemConfig }) => {
    bootstrapAISystemConfig().catch(err =>
      logger.warn({ err: err?.message }, 'ai_system_config_bootstrap_failed_top'))
  })

  // GenAI describe job — roda a cada 30s, processa DetectionEvents pendentes.
  // No-op se GEMINI_API_KEY/gemini_api_key secret não estiver configurado.
  import('./services/event-genai-job.service').then(({ eventGenAIJob }) => {
    eventGenAIJob.start()
  })
  import('./services/daily-briefing.service').then(({ dailyBriefingJob }) => {
    dailyBriefingJob.start()
  })

  // Semantic Search caption worker — preenche captionText + captionEmbedding em
  // DetectionFrames pendentes. Opt-in via SEMANTIC_CAPTION_ENABLED=true.
  // No-op silencioso se desabilitado ou sem GEMINI_API_KEY.
  import('./services/semantic-search').then(({ startCaptionWorkerIfEnabled }) => {
    startCaptionWorkerIfEnabled()
  })

  // Registra no go2rtc todas as câmeras CLOUD_DIRECT RTMP_PUSH já cadastradas.
  // go2rtc 1.9.x requer entry prévia para aceitar RTMP push — workaround fake RTSP.
  // Delay de 3s para go2rtc ter tempo de subir antes do backend.
  import('./services/go2rtc.service').then(async ({ go2rtcService }) => {
    await new Promise(r => setTimeout(r, 3000))
    const cams = await prisma.camera.findMany({
      where: { ingestMode: 'RTMP_PUSH', deploymentMode: 'CLOUD_DIRECT', active: true, rtmpIngestKeyEnc: { not: null } },
      select: { id: true, rtmpIngestKeyEnc: true },
    })
    const { decryptSecret } = await import('./lib/crypto')
    let registered = 0
    for (const cam of cams) {
      const key = decryptSecret(cam.rtmpIngestKeyEnc)
      if (!key) continue
      const ok = await go2rtcService.registerStream(key).catch(() => false)
      if (ok) registered++
    }
    logger.info({ total: cams.length, registered }, 'go2rtc_startup_streams_registered')
  }).catch(err => logger.warn({ err }, 'go2rtc_startup_register_failed'))

  // Registra paths EDGE_BOX no mediamtx com alwaysAvailable=true para que
  // viewers vejam vídeo "Câmera Offline" em vez de erro quando box está down.
  // Delay de 5s para mediamtx ter tempo de subir antes do backend.
  import('./services/mediamtx-paths.service').then(async ({ reconcileAllPaths }) => {
    await new Promise(r => setTimeout(r, 5000))
    reconcileAllPaths().catch(err =>
      logger.warn({ err }, 'mediamtx_paths_reconcile_failed'),
    )
  }).catch(err => logger.warn({ err }, 'mediamtx_paths_import_failed'))

  // Registra o recorder cloud-direct para parar todos os processos ffmpeg
  // em shutdown gracioso. O start real acontece por evento no ingest.service.
  // γ-Day4: killOrphans() roda no boot pra matar ffmpegs órfãos de restarts
  // inesperados do processo Node dentro do mesmo container (crash + healthcheck
  // restart). Em rolling update normal (Swarm), o old container morre com seus
  // filhos — killOrphans é no-op nesses casos (proc já morto).
  //
  // γ-Day4 fix: usa import ESTÁTICO (no topo do arquivo) em vez de import()
  // dinâmico. O import() dinâmico criava uma SEGUNDA instância ESM do módulo
  // com active Map vazio (diferente da instância usada por ingest.service.ts),
  // fazendo tickReconcileSchedule ver 0 câmeras ativas e spawnar batch 2 a
  // cada 60s. Import estático garante instância única compartilhada.
  cloudDirectRecorder.killOrphans()
  process.once('SIGTERM', () => cloudDirectRecorder.stopAll())
  process.once('SIGINT',  () => cloudDirectRecorder.stopAll())
  startCloudDirectScheduleReconcile()
  logger.info('cloud_direct_recorder_registered')

  // Inicia o supervisor de gravação (ffmpeg por câmera + retention).
  // Pode ser desabilitado via RECORDING_ENABLED=false em dev/CI.
  recordingService.start()

  // Inicia worker de retry de upload R2/S3 (tick 60s, max 5 tentativas).
  // Recupera segments que ficaram PENDING por falha transitória de rede.
  import('./services/recording-upload-worker.service').then(m => {
    m.recordingUploadWorker.start()
  }).catch(err => logger.error({ err }, 'recording_upload_worker_start_failed'))

  // Motion-gate cleaner (G3 fix — 2026-05-09). Apaga segments de câmera
  // MOTION/ACTIVE_OBJECTS sem detecção dentro da janela grace.
  import('./services/motion-gate-cleaner.service').then(m => {
    m.motionGateCleaner.start()
  }).catch(err => logger.error({ err }, 'motion_gate_cleaner_start_failed'))

  // Contract bootstrap (2026-05-12) — garante 1 IntegradorRetentionContract
  // default ativo por integrador (markup 30% / plano hd-7d). Sem isso, cliente
  // final via preço estimado errado no upgrade modal.
  import('./services/contract-bootstrap.service').then(m => {
    m.bootstrapIntegradorContracts().catch(err =>
      logger.warn({ err }, 'contract_bootstrap_top_error'))
  }).catch(err => logger.error({ err }, 'contract_bootstrap_import_failed'))

  // Storage tier tagger (2026-05-12) — marca segments > HOT_DAYS como COLD.
  // Não move objeto R2 ainda (lifecycle = Fase D quando R2 IA disponível);
  // só atualiza coluna pra dashboards/billing identificarem.
  import('./services/storage-tier-tagger.service').then(m => {
    m.storageTierTagger.start()
  }).catch(err => logger.error({ err }, 'storage_tier_tagger_start_failed'))

  // Exports dir cleaner (2026-05-12) — apaga arquivos > EXPORTS_RETAIN_HOURS
  // (default 24h) de /app/exports. Sem ele, disk enche com mp4 antigos cujos
  // download tickets já expiraram.
  import('./services/exports-dir-cleaner.service').then(m => {
    m.exportsDirCleaner.start()
  }).catch(err => logger.error({ err }, 'exports_dir_cleaner_start_failed'))

  // Tmpfs watchdog (G4 fix — 2026-05-09). Monitora /recordings; pausa
  // recording quando uso ≥85% pra prevenir OOM.
  import('./services/recording-tmpfs-watchdog.service').then(m => {
    m.tmpfsWatchdog.start()
  }).catch(err => logger.error({ err }, 'tmpfs_watchdog_start_failed'))

  // Boot health check do R2 — descobre cedo se credenciais não funcionam.
  // Não trava o boot — só registra warning pra alertar operador.
  import('./services/r2-storage.service').then(async ({ r2Storage }) => {
    if (!r2Storage.isEnabled()) {
      logger.warn('r2_not_configured (uploads de gravação ficarão LOCAL_ONLY)')
      return
    }
    const h = await r2Storage.healthCheck()
    if (h.ok) {
      logger.info({ buckets: h.buckets }, 'r2_health_ok')
    } else {
      logger.error({ error: h.error }, 'r2_health_failed (gravações não vão pro bucket!)')
    }
  }).catch(err => logger.error({ err }, 'r2_health_check_crash'))

  // Inicia watchdog de câmeras (tick 60s): detecta offline/recovery e envia alertas.
  cameraWatchdogService.start()

  // Watchdog de UPLOAD de gravação: alerta CAMERA_NO_UPLOAD/RECOVERED quando
  // câmera enabled+EDGE_BOX fica >3min sem segment ingerido. Cobre o gap
  // "box online mas uploader/ffmpeg morreu" — invisível ao camera-watchdog.
  import('./services/recording-no-upload-watchdog.service').then(m => {
    m.recordingNoUploadWatchdog.start()
  }).catch(err => logger.error({ err }, 'recording_no_upload_watchdog_start_failed'))

  // Cron de auto-suspensão: marca SUSPENDED boxes sem heartbeat há > 7 dias.
  // Bloqueia uploads acidentais e sinaliza ao operador via BOX_SUSPENDED alert.
  import('./services/box-suspend-cron.service').then(m => {
    m.boxSuspendCron.start()
  }).catch(err => logger.error({ err }, 'box_suspend_cron_start_failed'))

  // Sprint 1 — R2 Event Consumer: pollea Cloudflare Queue HTTP a cada 30s e
  // atualiza StorageBucket.totalBytes + StorageUsage em tempo quase-real.
  // Sem R2_QUEUE_ID configurado, o consumer entra em modo no-op silenciosamente.
  import('./services/r2-event-consumer.service').then(m => {
    m.r2EventConsumer.start()
  }).catch(err => logger.error({ err }, 'r2_event_consumer_start_failed'))

  // Sprint 1 — Storage Reconciliation: cron semanal que faz ListObjectsV2 e
  // corrige drift do event consumer (mensagens perdidas, deletes sem size).
  import('./services/storage-reconciliation.service').then(m => {
    m.storageReconciliation.start()
  }).catch(err => logger.error({ err }, 'storage_reconciliation_start_failed'))

  // Sprint 4 — Storage Billing: 2 crons (daily snapshot + monthly finalize)
  // que produzem o painel de margem por bucket → cliente → câmera com
  // outliers (fair use) e câmbio congelado.
  import('./services/storage-billing.service').then(m => {
    m.storageBilling.start()
  }).catch(err => logger.error({ err }, 'storage_billing_start_failed'))

  // Sprint 4 — Storage Billing Reconciliation: cruza nossa medição com dados
  // autoritativos do Cloudflare via GraphQL Analytics. Alerta drift > 5%.
  import('./services/storage-billing-reconciliation.service').then(m => {
    m.storageBillingReconciliation.start()
  }).catch(err => logger.error({ err }, 'storage_billing_reconciliation_start_failed'))

  // Sprint 5 — Storage Health Summary: cron diário que agrega métricas de
  // saúde do subsistema de storage (buckets, eventos, recordings, billing,
  // crons). Output via GET /billing/health-summary + log estruturado.
  import('./services/storage-health-summary.service').then(m => {
    m.storageHealthSummary.start()
  }).catch(err => logger.error({ err }, 'storage_health_summary_start_failed'))

  // Inicia serviço de digest diário (check a cada 5min).
  digestService.start()

  // Trial expiration cron — roda a cada 6h, expira trials + envia lembretes T-7/T-3/T-1/T-0.
  startTrialExpirationCron()

  // Health Alert cron — roda a cada 6h, emite alertas pra clientes em estado crítico/ruim.
  startHealthAlertCron()

  // Deal Registration cron — roda 1×/dia, expira deals após 30d sem atividade.
  startDealRegistrationCron()

  // Sprint Comercial Hub — cron diário (02:00 BRT) que:
  //   - recompute LeadScores
  //   - auto-detect oportunidades cross-sell/upsell
  //   - recalcula goals.actual a partir das atividades do mês
  import('./services/sales-cron.service').then(m => m.startSalesCron())

  // Detecção contínua de eventos comerciais (HOT_LEAD sem contato, STALLED, OVERDUE).
  // Roda a cada 15 minutos. Idempotente via dedupeKey.
  import('./services/notify-detection.service').then(m => m.startNotifyDetectionCron())

  // Onda 1 do log-audit — purge diário (03:00 UTC) do AuditLog mais velho que
  // AUDIT_RETENTION_DAYS (default 180, LGPD-compliant). Sem cron lib externa.
  import('./services/audit-purge.service').then(m => m.startAuditPurgeService())

  // Purge diário (03:30 UTC) da DetectionFrame mais velha que
  // DETECTION_FRAME_RETENTION_DAYS (default 30). Sem isso, a tabela cresce
  // ~95k linhas/dia em piloto e degrada queries de BI.
  import('./services/detection-frame-purge.service').then(m => m.startDetectionFramePurgeService())
} else {
  logger.warn('background_jobs_disabled')
}

// ── Erro global ──────────────────────────────────────────────────────────────
app.use(errorHandler)

export { app }
