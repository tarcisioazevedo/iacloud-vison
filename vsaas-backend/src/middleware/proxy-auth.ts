/**
 * Sprint E.1 — Header Proxy Auth (Authentik / Authelia / oauth2-proxy / Cloudflare Access).
 *
 * Espelha a `HeaderMappingConfig` do Frigate (frigate/api/auth.py + proxy.py).
 *
 * Cenário enterprise: cliente já tem SSO corporativo (Authentik, Keycloak,
 * Azure AD via oauth2-proxy). O proxy reverso autentica o usuário e injeta
 * headers HTTP no request — backend confia nesses headers e SKIP o JWT login.
 *
 * Configuração (ENV):
 *   PROXY_AUTH_ENABLED=true
 *   PROXY_AUTH_TRUSTED_IPS=10.0.0.0/8,172.16.0.0/12   (CIDR list)
 *   PROXY_AUTH_HEADER_USER=X-Forwarded-User           (default)
 *   PROXY_AUTH_HEADER_EMAIL=X-Forwarded-Email
 *   PROXY_AUTH_HEADER_GROUPS=X-Forwarded-Groups       (comma-sep)
 *   PROXY_AUTH_ROLE_MAP=admin:SUPER_ADMIN,integrators:INTEGRADOR_ADMIN,viewers:CLIENTE_VIEWER
 *   PROXY_AUTH_SECRET=<hex>                           (HMAC opcional do header)
 *
 * Reliability:
 * - REJEITA request se IP de origem não está em TRUSTED_IPS — defesa contra
 *   header spoofing por cliente externo (Frigate faz a mesma validação).
 * - Se header HMAC presente, valida assinatura (defense-in-depth).
 * - Se nenhum header de auth presente, deixa o requireAuth padrão tratar.
 */
import type { Request, Response, NextFunction } from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { logger } from '../lib/logger'

interface ProxyAuthConfig {
  enabled: boolean
  trustedCidrs: string[]
  userHeader: string
  emailHeader: string
  groupsHeader: string
  roleMap: Map<string, string>
  hmacSecret: string | null
}

let _cfg: ProxyAuthConfig | null = null

function loadConfig(): ProxyAuthConfig {
  if (_cfg) return _cfg
  const enabled = (process.env.PROXY_AUTH_ENABLED ?? 'false').toLowerCase() === 'true'
  const cidrs = (process.env.PROXY_AUTH_TRUSTED_IPS ?? '127.0.0.1/32,::1/128')
    .split(',').map(s => s.trim()).filter(Boolean)

  const roleMap = new Map<string, string>()
  for (const pair of (process.env.PROXY_AUTH_ROLE_MAP ?? '').split(',')) {
    const [group, role] = pair.split(':').map(s => s?.trim())
    if (group && role) roleMap.set(group.toLowerCase(), role)
  }

  _cfg = {
    enabled,
    trustedCidrs: cidrs,
    userHeader: (process.env.PROXY_AUTH_HEADER_USER ?? 'X-Forwarded-User').toLowerCase(),
    emailHeader: (process.env.PROXY_AUTH_HEADER_EMAIL ?? 'X-Forwarded-Email').toLowerCase(),
    groupsHeader: (process.env.PROXY_AUTH_HEADER_GROUPS ?? 'X-Forwarded-Groups').toLowerCase(),
    roleMap,
    hmacSecret: process.env.PROXY_AUTH_SECRET?.trim() || null,
  }
  if (enabled) {
    logger.info(
      { cidrs, headers: [_cfg.userHeader, _cfg.emailHeader, _cfg.groupsHeader], roles: roleMap.size },
      'proxy_auth_enabled',
    )
  }
  return _cfg
}

// CIDR matching minimalista — suporta IPv4 (a.b.c.d/n) e IPv6 (::1/128).
// Para produção HA com proxies em dezenas de IPs, considere `ipaddr.js`.
function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  const a = +m[1], b = +m[2], c = +m[3], d = +m[4]
  if ([a, b, c, d].some(n => n < 0 || n > 255)) return null
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}
function ipMatches(ip: string, cidrs: string[]): boolean {
  // strip ipv6-mapped prefix
  const cleaned = ip.replace(/^::ffff:/, '')
  for (const cidr of cidrs) {
    if (cidr === cleaned) return true
    const [base, maskStr] = cidr.split('/')
    if (!base) continue
    if (base === cleaned) return true
    if (cleaned.includes(':') || base.includes(':')) {
      // ipv6 match exato apenas (sem cálculo de prefix)
      if (cleaned === base) return true
      continue
    }
    const ipInt = ipv4ToInt(cleaned)
    const baseInt = ipv4ToInt(base)
    if (ipInt == null || baseInt == null) continue
    const mask = +maskStr
    if (!Number.isFinite(mask) || mask < 0 || mask > 32) continue
    if (mask === 0) return true
    const m = (~0 << (32 - mask)) >>> 0
    if ((ipInt & m) === (baseInt & m)) return true
  }
  return false
}

/**
 * Middleware Express. Se config desabilitada, é no-op imediato.
 *
 * Quando ativa e com headers válidos: popula `req.jwtPayload` com mesmo formato
 * do JWT padrão para que o resto da stack (requireAuth, requireRole, rate-limit
 * keyGenerator) funcione transparente.
 */
export function proxyAuth(req: Request, res: Response, next: NextFunction): void {
  const cfg = loadConfig()
  if (!cfg.enabled) { next(); return }

  // Se já existe JWT payload (de cookie/Bearer), proxy headers não sobrescrevem.
  if (req.jwtPayload) { next(); return }

  const userHeader = req.headers[cfg.userHeader] as string | undefined
  if (!userHeader) { next(); return }

  // Validar IP de origem
  const sourceIp = req.ip ?? req.socket.remoteAddress ?? ''
  if (!ipMatches(sourceIp, cfg.trustedCidrs)) {
    logger.warn(
      { sourceIp, headerUser: userHeader },
      'proxy_auth_rejected_untrusted_ip',
    )
    res.status(403).json({ error: 'forbidden', code: 'UNTRUSTED_PROXY' })
    return
  }

  // Validar HMAC opcional
  if (cfg.hmacSecret) {
    const sig = (req.headers['x-forwarded-auth-signature'] as string | undefined) ?? ''
    const expected = createHmac('sha256', cfg.hmacSecret).update(userHeader).digest('hex')
    try {
      const ok = sig.length === expected.length &&
                 timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      if (!ok) {
        logger.warn({ sourceIp, headerUser: userHeader }, 'proxy_auth_invalid_hmac')
        res.status(403).json({ error: 'forbidden', code: 'INVALID_PROXY_SIGNATURE' })
        return
      }
    } catch {
      res.status(403).json({ error: 'forbidden', code: 'INVALID_PROXY_SIGNATURE' })
      return
    }
  }

  const groupsRaw = (req.headers[cfg.groupsHeader] as string | undefined) ?? ''
  const groups = groupsRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

  // Mapeia primeiro grupo conhecido → role
  let role = 'CLIENTE_VIEWER'
  for (const g of groups) {
    const mapped = cfg.roleMap.get(g)
    if (mapped) { role = mapped; break }
  }

  // Popula como se fosse JWT verificado.
  req.jwtPayload = {
    sub: userHeader,
    role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  } as any

  // Tag para auditoria — outras middlewares podem inspecionar.
  ;(req as any).authSource = 'proxy_header'

  logger.debug(
    { user: userHeader, role, groups, sourceIp },
    'proxy_auth_accepted',
  )
  next()
}
