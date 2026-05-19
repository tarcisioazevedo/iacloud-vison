/**
 * Tenant Context — extrai e valida `X-ICV-Tenant` injetado pelo Cloudflare
 * Worker.
 *
 * Formato do header: `<integradorId>.<unixSeconds>.<hmacHex>`
 *   onde hmac = HMAC-SHA256(`<integradorId>.<unixSeconds>`, sharedSecret)
 *
 * Razão da assinatura:
 *   - Sem HMAC, qualquer cliente que descubra a forma do header pode forjar
 *     identidade de tenant. Com HMAC, só quem tem o segredo (CF Worker e este
 *     backend) consegue gerar header válido.
 *   - Timestamp impede replay: rejeitamos headers com mais de 60s.
 *
 * Comportamento:
 *   - Header ausente → req.tenantContext = undefined; segue (compatibilidade
 *     com requests via JWT Bearer durante migração).
 *   - Header presente mas inválido → 401. Não é "soft" porque header inválido
 *     significa tentativa de forjar identidade — não é estado neutro.
 *   - Header válido → req.tenantContext = { integradorId, source: 'cf-worker' }.
 *
 * Compatibilidade com JWT:
 *   Se ambos vierem (header CF + Bearer JWT), tenantContext tem precedência
 *   sobre jwtPayload?.integradorId em rotas tenant-scoped — mas conflito é
 *   rejeitado: se JWT diz integrador X e header diz Y, retornamos 403. Isso
 *   evita confusões em ambientes de desenvolvimento onde alguém pode estar
 *   logado como outro tenant via JWT enquanto navega num subdomínio diferente.
 *
 * Configuração:
 *   ICV_TENANT_HMAC_SECRET (.env) — segredo compartilhado com o Worker.
 *   Se ausente em prod (NODE_ENV=production), o middleware loga error e
 *   rejeita 503 — fail-closed por questão de segurança.
 */
import { Request, Response, NextFunction } from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { logger } from '../lib/logger'
import { UnauthorizedError, ForbiddenError } from '../lib/errors'
import { prisma } from '../lib/prisma'

export interface TenantContext {
  integradorId: string
  source:       'cf-worker' | 'custom-domain'
  /** Idade do token em segundos no momento da validação. */
  ageSec:       number
}

// Cache simples hostname → integradorId com TTL de 30s.
// Evita query no DB a cada request para domínios custom.
const domainCache = new Map<string, { integradorId: string | null; cachedAt: number }>()
const DOMAIN_CACHE_TTL_MS = 30_000

async function resolveCustomDomain(hostname: string): Promise<string | null> {
  const now = Date.now()
  const cached = domainCache.get(hostname)
  if (cached && now - cached.cachedAt < DOMAIN_CACHE_TTL_MS) {
    return cached.integradorId
  }
  const domain = await prisma.customDomain.findUnique({
    where: { hostname, status: 'ACTIVE' },
    select: { integradorId: true },
  }).catch(() => null)
  const integradorId = domain?.integradorId ?? null
  domainCache.set(hostname, { integradorId, cachedAt: now })
  return integradorId
}

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext
    }
  }
}

// Janela curta — proxy CF→backend é sempre <1s. 60s tolera relógios
// dessincronizados em até 60s sem abrir janela perigosa de replay.
const MAX_AGE_SEC = 60

const HEADER = 'x-icv-tenant'

/**
 * Verifica HMAC com timingSafeEqual pra evitar timing attacks.
 * Strings de tamanhos diferentes retornam false sem comparar (também safe).
 */
function verifyHmac(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  // timingSafeEqual exige buffers de mesmo tamanho.
  if (expected.length !== signature.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}

export async function tenantContext(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const raw = req.header(HEADER)
  if (!raw) {
    // Sem header CF Worker — tenta resolver pelo hostname (domínio custom do integrador).
    const host = (req.header('x-forwarded-host') ?? req.header('host') ?? '')
      .split(':')[0].toLowerCase().trim()
    if (host && !host.endsWith('.vsaas.com.br') && host !== 'localhost' && host !== '127.0.0.1') {
      try {
        const integradorId = await resolveCustomDomain(host)
        if (integradorId) {
          req.tenantContext = { integradorId, source: 'custom-domain', ageSec: 0 }
          logger.debug({ host, integradorId }, 'tenant_resolved_custom_domain')
        }
      } catch (err) {
        logger.warn({ host, err }, 'tenant_custom_domain_lookup_error')
      }
    }
    next()
    return
  }

  const secret = process.env.ICV_TENANT_HMAC_SECRET
  if (!secret || secret.length < 32) {
    // Fail-closed: receber header de tenant sem ter segredo configurado é
    // estado de configuração incompleta — em produção isso é falha grave;
    // em dev ainda preferimos rejeitar pra não criar ilusão de autenticação.
    logger.error({ }, 'tenant_hmac_secret_missing_or_weak')
    next(new Error('ICV_TENANT_HMAC_SECRET not configured (need ≥32 chars)'))
    return
  }

  // Formato: <id>.<ts>.<hmac>
  const parts = raw.split('.')
  if (parts.length !== 3) {
    logger.warn({ headerLen: raw.length }, 'tenant_header_malformed')
    next(new UnauthorizedError('Header X-ICV-Tenant malformado'))
    return
  }
  const [integradorId, tsStr, sig] = parts

  // Sanity nos campos antes de gastar HMAC.
  if (!integradorId || integradorId.length < 8 || !/^[a-f0-9-]+$/i.test(integradorId)) {
    next(new UnauthorizedError('integradorId inválido'))
    return
  }
  const ts = Number(tsStr)
  if (!Number.isFinite(ts) || ts <= 0) {
    next(new UnauthorizedError('timestamp inválido'))
    return
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const ageSec = nowSec - ts
  // Tolerância pra relógio do Worker estar à frente: aceitamos -10s.
  if (ageSec > MAX_AGE_SEC || ageSec < -10) {
    logger.warn({ ageSec, integradorId }, 'tenant_header_stale_or_future')
    next(new UnauthorizedError('Header X-ICV-Tenant expirado ou de futuro'))
    return
  }

  if (!verifyHmac(`${integradorId}.${ts}`, sig, secret)) {
    logger.warn({ integradorId }, 'tenant_header_hmac_mismatch')
    next(new UnauthorizedError('Assinatura X-ICV-Tenant inválida'))
    return
  }

  // Conflito JWT × header (ver comentário do topo).
  const jwtIntegrador = req.jwtPayload?.integradorId
  if (jwtIntegrador && jwtIntegrador !== integradorId) {
    logger.warn({
      jwtIntegrador, headerIntegrador: integradorId,
    }, 'tenant_header_jwt_mismatch')
    next(new ForbiddenError('JWT pertence a outro tenant que o subdomínio acessado'))
    return
  }

  req.tenantContext = { integradorId, source: 'cf-worker', ageSec }
  next()
}

/**
 * Helper p/ rotas tenant-scoped. Resolve o integradorId efetivo da request
 * dando precedência ao tenantContext (vindo do CF Worker, prova
 * criptográfica do subdomínio acessado), com fallback ao JWT (compatibilidade
 * com clientes que ainda usam Bearer direto sem passar pelo Worker).
 *
 * Retorna null quando nem um nem outro identificou tenant — chamador decide
 * se 401, 403 ou comportamento default (ex: rotas SUPER_ADMIN não precisam).
 */
export function resolveIntegradorId(req: Request): string | null {
  return req.tenantContext?.integradorId
       ?? req.jwtPayload?.integradorId
       ?? null
}
