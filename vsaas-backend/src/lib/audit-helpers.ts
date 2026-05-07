/**
 * Audit helpers — utilities semânticas para auditoria de ações críticas.
 *
 * Onda 12 do log-audit (2026-05-06). Complementa o middleware auditWrite
 * (que captura HTTP-cru) com entradas de action SEMÂNTICO + diff before/after
 * + snapshot do registro em DELETE.
 *
 * Uso:
 *
 *   await auditAction(prisma, {
 *     action:    'LOGIN_FAILED',
 *     resource:  'User',
 *     resourceId: email,
 *     result:    'BLOCKED',
 *     metadata:  { reason: 'invalid_password', attempts: 3 },
 *     req,
 *   })
 *
 *   await auditUpdate(prisma, {
 *     action:    'ALERT_CONFIG_CHANGED',
 *     resource:  'AlertConfig',
 *     resourceId: cfg.id,
 *     before:    cfgAntes,
 *     after:     cfgDepois,
 *     req,
 *   })
 *
 *   await auditDelete(prisma, {
 *     action:    'CAMERA_DELETED',
 *     resource:  'Camera',
 *     resourceId: cam.id,
 *     snapshot:  cam,  // dump completo p/ forense
 *     req,
 *   })
 *
 * Coexistência com middleware:
 *   O handler que usa auditAction/Update/Delete deve setar
 *   `req.skipAuditMiddleware = true` para evitar duplicação. O middleware
 *   só captura quando esse flag é falsy.
 *
 * Falha silenciosa: erros de insert no AuditLog NÃO derrubam o request.
 */
import type { Request } from 'express'
import type { PrismaClient } from '@prisma/client'
import { logger } from './logger'

// Lista de keys cujo valor sai como '[REDACTED]' no metadataJson — espelha
// o sanitizer do middleware auditWrite. Manter sincronizado.
const REDACT_KEYS = new Set([
  'password', 'passwordHash', 'currentPassword', 'newPassword', 'tempPassword',
  'token', 'tokens', 'apiKey', 'apiToken', 'authToken', 'accessToken',
  'refreshToken', 'sessionToken', 'permanentToken', 'rtspPassword',
  'onvifPassword', 'rtmpPushUrl', 'rtmpIngestKey', 'gcpServiceAccountJson',
  'storageSecretKey', 'storageAccessKey', 'authentication', 'jwtSecret',
  'icvEncryptionKey', 'vapidPrivateKey', 'evolutionApiKey', 'smtpPass',
  'telegramBotToken', 'asaasApiKey',
])
const REDACT_PATTERNS = [
  /password/i, /token/i, /secret/i, /apikey/i, /credential/i, /enc$/i,
]
const REDACTED = '[REDACTED]'

function isSensitive(key: string): boolean {
  if (REDACT_KEYS.has(key)) return true
  return REDACT_PATTERNS.some(re => re.test(key))
}

/** Sanitiza objeto recursivo, redactando keys sensíveis. */
export function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]'
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return obj.length > 500 ? obj.slice(0, 500) + '…' : obj
  if (typeof obj !== 'object') return obj
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.slice(0, 50).map(v => sanitize(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitive(k)) out[k] = REDACTED
    else out[k] = sanitize(v, depth + 1)
  }
  return out
}

/**
 * Calcula diff raso entre antes/depois — útil para UPDATEs
 * onde queremos saber só os campos que mudaram. Não é deep diff, mas
 * cobre 90% dos casos de configuração.
 */
export function shallowDiff(
  before: Record<string, any>,
  after: Record<string, any>,
): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {}
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  for (const k of keys) {
    const b = before?.[k]
    const a = after?.[k]
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out[k] = { before: sanitize(b), after: sanitize(a) }
    }
  }
  return out
}

interface BaseAuditOpts {
  action:     string                                              // SCREAMING_SNAKE_CASE
  resource:   string                                              // 'User' | 'Camera' | etc.
  resourceId?: string | null
  result?:    'SUCCESS' | 'BLOCKED' | 'ERROR'
  metadata?:  Record<string, any>
  req?:       Request
}

/** Insert genérico de AuditLog com action semântico. Falha silenciosa. */
export async function auditAction(
  prisma: PrismaClient,
  opts: BaseAuditOpts,
): Promise<void> {
  const { req } = opts
  const jwt = req?.jwtPayload
  const role = jwt?.role
  const sub  = jwt?.sub

  const actorFields = {
    superAdminId:   role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL' ? sub ?? null : null,
    integradorId:   role?.startsWith('INTEGRADOR_') ? jwt?.integradorId ?? sub ?? null : (jwt?.integradorId ?? null),
    clienteFinalId: role?.startsWith('CLIENTE_') ? jwt?.clienteFinalId ?? null : (jwt?.clienteFinalId ?? null),
    userId:         (role?.startsWith('CLIENTE_') || role?.startsWith('INTEGRADOR_TECNICO')) ? sub ?? null : null,
  }

  try {
    await prisma.auditLog.create({
      data: {
        ...actorFields,
        action:       opts.action,
        resource:     opts.resource,
        resourceId:   opts.resourceId ?? null,
        result:       opts.result ?? 'SUCCESS',
        metadataJson: opts.metadata ? sanitize(opts.metadata) as never : undefined,
        ipAddress:    (req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null) as string | null,
        userAgent:    (req?.headers?.['user-agent'] ?? null) as string | null,
      },
    })
  } catch (err) {
    logger.warn({ err, action: opts.action }, 'audit.action.insert_failed')
  }

  // Marca o req para o middleware auditWrite NÃO duplicar
  if (req) (req as any).skipAuditMiddleware = true
}

/**
 * Variant de auditAction para UPDATE com diff before/after automático.
 * Action típico: '<RESOURCE>_UPDATED' ou semântico ('SMTP_CONFIG_CHANGED').
 */
export async function auditUpdate(
  prisma: PrismaClient,
  opts: BaseAuditOpts & {
    before: Record<string, any>
    after:  Record<string, any>
  },
): Promise<void> {
  const diff = shallowDiff(opts.before, opts.after)
  await auditAction(prisma, {
    ...opts,
    metadata: {
      ...(opts.metadata ?? {}),
      diff,
      changedFieldsCount: Object.keys(diff).length,
    },
  })
}

/**
 * Variant para DELETE — preserva snapshot completo do registro deletado
 * para forense. Action típico: '<RESOURCE>_DELETED'.
 */
export async function auditDelete(
  prisma: PrismaClient,
  opts: BaseAuditOpts & {
    snapshot: Record<string, any>
  },
): Promise<void> {
  await auditAction(prisma, {
    ...opts,
    result: opts.result ?? 'SUCCESS',
    metadata: {
      ...(opts.metadata ?? {}),
      snapshot: sanitize(opts.snapshot),
    },
  })
}
