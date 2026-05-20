import { Router, Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { requireAiWorkerAuth } from '../middleware/ai-worker-auth'
import { asyncHandler } from '../middleware/async-handler'
import { logger } from '../lib/logger'

export const internalRouter = Router()

// ── Segurança: /internal aceita requests de loopback OU redes privadas ───────
// Caddy chama domain-check via 127.0.0.1:3000, mas o backend roda no Docker
// Swarm — o ingress mesh reescreve o source IP para o subnet interno
// (10.0.0.0/8). Permitimos esses ranges porque a porta 3000 não está
// exposta na internet (apenas Caddy local + swarm overlay).
function requireLocalNet(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? req.socket?.remoteAddress ?? ''
  const plain = ip.replace(/^::ffff:/, '')

  // Loopback
  if (plain === '127.0.0.1' || plain === '::1' || plain === 'localhost') {
    return next()
  }
  // Private IPv4 ranges (RFC 1918) + Docker Swarm overlay
  if (
    /^10\./.test(plain) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(plain) ||
    /^192\.168\./.test(plain)
  ) {
    return next()
  }
  // ULA IPv6 (fc00::/7)
  if (/^f[cd][0-9a-f]{2}:/i.test(plain)) {
    return next()
  }

  logger.warn({ ip, url: req.url }, 'internal_route_blocked_non_local_net')
  res.status(403).json({ error: 'FORBIDDEN' })
}

// Regex IPv4 — detecta scan bots batendo direto no IP via SNI vazio/literal.
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/

// Domínios internos que NUNCA devem ser aceitos via on-demand TLS.
// Têm cert próprio já gerenciado pelo Caddyfile.
const RESERVED_HOSTS = new Set([
  'app.vsaas.com.br', 'app.iacloud.com.br',
  'vsaas.com.br', 'www.vsaas.com.br',
  'evolution.vsaas.com.br', 'box.vsaas.com.br',
  'localhost', '127.0.0.1',
])

// ── GET /internal/domain-check?domain=<hostname> ─────────────────────────────
// Caddy chama este endpoint antes de emitir cert via on-demand TLS.
// Retorna 200 se o domínio é um CustomDomain ATIVO → Caddy emite cert.
// Retorna 4xx caso contrário → Caddy rejeita a conexão.
//
// Política de segurança:
//   - Só acessível de localhost (requireLocalhost)
//   - Rejeita domínios reservados da plataforma
//   - Rejeita domínios que terminem em .vsaas.com.br (gerenciados via CF Worker)
//   - Só aprova status=ACTIVE (não PENDING_DNS, PENDING_VERIFICATION, ERROR)
internalRouter.get(
  '/domain-check',
  requireLocalNet,
  asyncHandler(async (req, res) => {
    const domain = (req.query.domain as string ?? '').trim().toLowerCase()

    if (!domain || domain.length < 4 || domain.length > 253) {
      return res.status(400).json({ error: 'domain inválido' })
    }

    // Scan bots batem TLS direto no IP. Caddy pergunta "emito cert pra
    // 23.88.124.67?" — silencia sem warn (esperado, alto volume).
    if (IPV4_LITERAL.test(domain)) {
      return res.status(400).json({ error: 'ip literal' })
    }

    // Bloqueia domínios internos e subdomínios da plataforma
    if (RESERVED_HOSTS.has(domain) || domain.endsWith('.vsaas.com.br') || domain.endsWith('.iacloud.com.br')) {
      return res.status(403).json({ error: 'domínio reservado' })
    }

    const found = await prisma.customDomain.findUnique({
      where:  { hostname: domain, status: 'ACTIVE' },
      select: { id: true },
    })

    if (!found) {
      logger.info({ domain }, 'domain_check_not_found')
      return res.status(404).json({ error: 'domínio não cadastrado ou inativo' })
    }

    logger.info({ domain }, 'domain_check_approved')
    res.status(200).json({ ok: true })
  }),
)

internalRouter.get(
  '/cameras/ai-enabled',
  requireAiWorkerAuth,
  asyncHandler(async (_req, res) => {
    const cameras = await prisma.camera.findMany({
      where: { aiEnabled: true, active: true },
      select: {
        id: true,
        name: true,
        go2rtcStreamId: true,
        rtspMainUrl: true,
        rtspSubUrl: true,
        aiConfidenceMin: true,
      },
    })
    res.json({ cameras })
  }),
)
