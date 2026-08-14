import { Router, Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { requireAiWorkerAuth } from '../middleware/ai-worker-auth'
import { asyncHandler } from '../middleware/async-handler'
import { logger } from '../lib/logger'

export const internalRouter = Router()

// ── Segurança: /internal só aceita requests de origem interna ────────────────
// Caddy chama domain-check via `ask http://127.0.0.1:3000/...`. Em Docker
// Swarm o ingress mesh roteia esse pedido pelo overlay e o remoteAddress chega
// como 10.0.0.2 (gateway do ingress), não 127.0.0.1. Por isso aceitamos toda
// a faixa privada 10.x.x.x (range de overlay Swarm) + loopback + 172.16-31.x.
// IPs externos nunca chegam aqui pois o Caddy ouve na porta 80/443 e repassa
// internamente; o backend não expõe 3000 pra fora.
function requireLocalhost(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? req.socket?.remoteAddress ?? ''
  const plain = ip.replace(/^::ffff:/, '')
  const ok =
    plain === '127.0.0.1' ||
    plain === '::1'        ||
    plain === 'localhost'  ||
    /^10\./.test(plain)    ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(plain)
  if (ok) return next()
  logger.warn({ ip, url: req.url }, 'internal_route_blocked_non_localhost')
  res.status(403).json({ error: 'FORBIDDEN' })
}

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
  requireLocalhost,
  asyncHandler(async (req, res) => {
    const domain = (req.query.domain as string ?? '').trim().toLowerCase()

    if (!domain || domain.length < 4 || domain.length > 253) {
      return res.status(400).json({ error: 'domain inválido' })
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
