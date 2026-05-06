/**
 * auditWrite — middleware Express que registra TODA escrita HTTP no AuditLog.
 *
 * Mental model: trilha completa de mutações na plataforma. Cobertura total
 * (em vez dos 22 calls manuais que cobriam ~5% antes). Indispensável para
 * compliance LGPD ("direito ao acesso" do titular) e forense pós-incidente.
 *
 * Comportamento:
 *   - Skip métodos read-only (GET/HEAD/OPTIONS)
 *   - Skip paths de alta-frequência (heartbeat, webhooks externos, refresh)
 *   - Insert async em res.on('finish') — não bloqueia resposta
 *   - Sanitiza body (remove password/token/key) antes de salvar metadataJson
 *   - Falha silenciosa: erro no audit nunca derruba o request
 *
 * Coexistência com manuais:
 *   - 22 chamadas manuais (`prisma.auditLog.create()` em routes/) preservadas
 *   - Manuais usam action semântica ("USER_INVITED") — ricos em metadata
 *   - Middleware usa action HTTP-cru ("POST /users/invite") — cobertura total
 *   - Coexistem POR DESIGN (oferecem visões diferentes nos filtros)
 *   - Para evitar duplicação onde fizer sentido: handler manual seta
 *     `req.skipAuditMiddleware = true` (rota a rota, opcional)
 *
 * Convencao do action HTTP:
 *   - `${METHOD} ${path}` com path normalizado (param :id substituído).
 *   - Resource derivado do primeiro segmento (Users, Integradores, etc.).
 *   - Result derivado do statusCode: 2xx=SUCCESS, 4xx=BLOCKED, 5xx=ERROR.
 */
import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

// ─── Configuração ────────────────────────────────────────────────────────────

/**
 * Paths cuja escrita NÃO deve gerar AuditLog. Critérios:
 *   - Alto volume (telemetria, heartbeats) — polui o log
 *   - Webhooks externos (sem ator humano)
 *   - Endpoints internos de comunicação inter-serviço
 *
 * Match por prefixo. Adicionar com cuidado — todo skip é uma blind spot
 * para a auditoria. Melhor sobrar do que faltar.
 */
const SKIP_PATH_PREFIXES = [
  '/health',                          // healthcheck (K8s/Cloud Run a cada 10s)
  '/internal/',                       // comunicação inter-serviço
  '/auth/refresh',                    // refresh token (frequência alta, baixo valor)
  '/iacv-box/heartbeat',              // telemetria edge
  '/iacv-box/events',                 // eventos edge em batch (já têm próprio log)
  '/iacv-box/events-batch',
  '/notifications/whatsapp/webhook',  // Evolution callback
  '/webhooks/',                       // webhooks externos genéricos (Asaas, Stripe, etc.)
  '/notify/',                         // delivery dos canais (já tem NotificationLog)
  '/playback/segments',               // hot-path de streaming HLS
  '/live/',                           // streams de live (mjpeg/whep)
]

/**
 * Keys do body cujo VALOR é redacted antes de salvar em metadataJson.
 * Match case-insensitive em qualquer profundidade do JSON.
 */
const REDACT_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'tempPassword',
  'token',
  'tokens',
  'apiKey',
  'apiToken',
  'authToken',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'permanentToken',
  'rtspPassword',
  'onvifPassword',
  'rtmpPushUrl',
  'rtmpIngestKey',
  'gcpServiceAccountJson',
  'storageSecretKey',
  'storageAccessKey',
  'authentication',
  'jwtSecret',
  'icvEncryptionKey',
  'vapidPrivateKey',
  'evolutionApiKey',
  'smtpPass',
  'telegramBotToken',
  'asaasApiKey',
])

const REDACT_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /apikey/i,
  /authorization/i,
  /credential/i,
  /enc$/i,         // *Enc (rtspPasswordEnc, etc.)
]

const REDACTED = '[REDACTED]'

/** Tamanho máximo do body serializado (após sanitização) que vai ao AuditLog. */
const MAX_BODY_BYTES = 8_000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shouldSkip(path: string): boolean {
  return SKIP_PATH_PREFIXES.some(p => path.startsWith(p))
}

function shouldAuditMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

function isSensitiveKey(key: string): boolean {
  if (REDACT_KEYS.has(key)) return true
  return REDACT_KEY_PATTERNS.some(re => re.test(key))
}

/**
 * Sanitiza um objeto recursivamente, substituindo valores de chaves sensíveis
 * por '[REDACTED]'. Não modifica o original.
 */
function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]'
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    // strings muito longas são truncadas (defensive)
    return obj.length > 500 ? obj.slice(0, 500) + '…' : obj
  }
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.slice(0, 50).map(v => sanitize(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      out[k] = REDACTED
    } else {
      out[k] = sanitize(v, depth + 1)
    }
  }
  return out
}

/**
 * Normaliza o path para agrupamento (substitui IDs UUID/numéricos por :id).
 * Ex: /admin/integradores/abc-123/quota → /admin/integradores/:id/quota
 */
const UUID_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi
const NUMERIC_ID_RE = /\/\d{3,}(?=\/|$)/g

function normalizePath(path: string): string {
  return path
    .replace(UUID_RE, '/:id')
    .replace(NUMERIC_ID_RE, '/:id')
}

/**
 * Deriva o resource do path. Ex: /admin/integradores/:id/quota → "Integradores"
 */
function deriveResource(path: string): string {
  // Tira prefixos comuns: /api, /admin, /me
  const stripped = path.replace(/^\/(api|admin|me)\b/, '')
  const seg = stripped.split('/').filter(Boolean)[0] ?? 'unknown'
  // Capitaliza
  return seg.charAt(0).toUpperCase() + seg.slice(1)
}

function deriveResult(statusCode: number): 'SUCCESS' | 'BLOCKED' | 'ERROR' {
  if (statusCode >= 500) return 'ERROR'
  if (statusCode >= 400) return 'BLOCKED'
  return 'SUCCESS'
}

// ─── Middleware ──────────────────────────────────────────────────────────────

declare module 'express-serve-static-core' {
  interface Request {
    /** Setar para true em handlers manuais que já criam AuditLog próprio
     *  para evitar duplicação. Default: false (middleware audita). */
    skipAuditMiddleware?: boolean
    /** Timestamp inicial setado pelo middleware para calcular durationMs. */
    auditStartTime?: number
  }
}

export function auditWrite(req: Request, res: Response, next: NextFunction): void {
  // Skip rápido por método
  if (!shouldAuditMethod(req.method)) return next()
  // Skip rápido por path (telemetria/webhooks/etc.)
  if (shouldSkip(req.path)) return next()

  req.auditStartTime = Date.now()

  // Captura no fim da resposta — não bloqueia o handler
  res.on('finish', () => {
    if (req.skipAuditMiddleware) return // handler manual já cobriu

    const durationMs = req.auditStartTime ? Date.now() - req.auditStartTime : null
    const statusCode = res.statusCode
    const method     = req.method
    const fullPath   = req.originalUrl?.split('?')[0] ?? req.path
    const path       = normalizePath(fullPath)
    const action     = `${method} ${path}`
    const resource   = deriveResource(path)
    const result     = deriveResult(statusCode)

    // Sanitiza body (não persiste senhas/tokens)
    let metadata: unknown = null
    try {
      const sanitized = sanitize(req.body)
      const json = JSON.stringify(sanitized)
      metadata = json.length > MAX_BODY_BYTES
        ? { _truncated: true, preview: json.slice(0, MAX_BODY_BYTES) }
        : sanitized
    } catch {
      metadata = { _error: 'failed-to-serialize-body' }
    }

    // Ator pelo JWT decodificado pelo softAuth (já populado no app.ts)
    const jwt = req.jwtPayload
    const role = jwt?.role
    const sub  = jwt?.sub

    // Mapeia o sub para o tipo certo de ator. SuperAdmin/Integrador/User
    // têm IDs em namespaces diferentes — usamos role para roteamento.
    const actorFields = {
      superAdminId:   role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL' ? sub ?? null : null,
      integradorId:   role?.startsWith('INTEGRADOR_') ? jwt?.integradorId ?? sub ?? null : (jwt?.integradorId ?? null),
      clienteFinalId: role?.startsWith('CLIENTE_') ? jwt?.clienteFinalId ?? null : (jwt?.clienteFinalId ?? null),
      userId:         (role?.startsWith('CLIENTE_') || role?.startsWith('INTEGRADOR_TECNICO')) ? sub ?? null : null,
    }

    // Insert async — falha silenciosa
    prisma.auditLog.create({
      data: {
        ...actorFields,
        action,
        resource,
        resourceId:   (req.params?.id as string) ?? null,
        metadataJson: metadata as never,
        ipAddress:    (req.ip ?? req.headers['x-forwarded-for'] ?? null) as string | null,
        userAgent:    (req.headers['user-agent'] ?? null) as string | null,
        result,
        method,
        path,
        statusCode,
        durationMs,
      },
    }).catch(err => {
      // Nunca derrubar request por falha do audit. Log apenas em warn level.
      logger.warn({ err, action, statusCode }, 'audit-write.middleware.insert_failed')
    })
  })

  next()
}
