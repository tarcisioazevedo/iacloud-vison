import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { UnauthorizedError, ForbiddenError } from '../lib/errors'
import { prisma } from '../lib/prisma'

// Cache em memória de existência de User (60s TTL) para evitar 1 query por
// request. Invalidação automática por expiração — se um user for desativado,
// no máximo 60s depois ele será barrado.
const userActiveCache = new Map<string, { active: boolean; expiresAt: number }>()
const USER_CACHE_TTL_MS = 60_000

async function isUserStillActive(userId: string): Promise<boolean> {
  // Sub virtuais (portal, box) não correspondem a entidade — sempre passa.
  if (userId.startsWith('portal:') || userId.startsWith('box:')) return true

  const now = Date.now()
  const cached = userActiveCache.get(userId)
  if (cached && cached.expiresAt > now) return cached.active

  // Login resolve actor em 3 tabelas: SuperAdmin, Integrador, User.
  // Verifica em paralelo — primeira que casar valida.
  const [user, superAdmin, integrador] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { active: true } }),
    prisma.superAdmin.findUnique({ where: { id: userId }, select: { active: true } }).catch(() => null),
    prisma.integrador.findUnique({ where: { id: userId }, select: { active: true } }).catch(() => null),
  ])
  const active =
    (!!user && user.active) ||
    (!!superAdmin && superAdmin.active) ||
    (!!integrador && integrador.active)
  userActiveCache.set(userId, { active, expiresAt: now + USER_CACHE_TTL_MS })
  return active
}

export interface JwtPayload {
  sub: string           // userId
  role: string
  integradorId?: string
  clienteFinalId?: string
  impersonatedBy?: string  // Lote 5: set when actor (SUPER_ADMIN ou INTEGRADOR_ADMIN) is impersonating
  // Lote 5++: papel do ator que iniciou a sessão de impersonação.
  // Necessário para distinguir suporte do fabricante (SUPER_ADMIN) do suporte
  // do integrador (INTEGRADOR_ADMIN) — ambos podem virar CLIENTE_*, mas o
  // raio de impacto e o audit log são diferentes.
  impersonatorRole?: 'SUPER_ADMIN' | 'INTEGRADOR_ADMIN'
  iat: number
  exp: number
}

declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JwtPayload
    }
  }
}

/**
 * Autenticação baseada em Bearer JWT.
 *
 * Usa `next(err)` em vez de `throw` — em Node 20, throw em middleware que é
 * eventualmente chamado de contexto async pode virar unhandledRejection em
 * alguns caminhos. next(err) é o contrato idiomático do Express e vai direto
 * pro errorHandler global.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  // Bearer no header (caminho normal) OU ?token=... no query (para SSE/EventSource
  // que não suporta headers customizados). Query param só é aceito em GET.
  const header = req.headers.authorization
  let token: string | null = null

  if (header?.startsWith('Bearer ')) {
    token = header.slice(7)
  } else if (req.method === 'GET') {
    const q = (req.query as Record<string, string | undefined>)['token']
    if (q && q.length > 10) token = q
  }

  if (!token) {
    next(new UnauthorizedError())
    return
  }

  const secret = process.env.JWT_SECRET
  if (!secret) {
    next(new Error('JWT_SECRET not configured'))
    return
  }

  try {
    const payload = jwt.verify(token, secret) as JwtPayload
    req.jwtPayload = payload
    // Defesa contra JWT órfão: rejeita se o User foi removido/desativado após
    // a emissão do token (cenário de seed reset, exclusão administrativa).
    isUserStillActive(payload.sub).then(ok => {
      if (!ok) {
        next(new UnauthorizedError('Sessão inválida — refaça login'))
        return
      }
      next()
    }).catch(() => {
      // Erro de DB não deve barrar — degrada gracioso (libera, log warn).
      next()
    })
  } catch {
    next(new UnauthorizedError('Token inválido ou expirado'))
  }
}

/**
 * Decodifica o Bearer JWT se presente — sem enforcement.
 *
 * Use ANTES do rate limiter para que `req.jwtPayload` esteja disponível na
 * keyGenerator (rate limit por tenant). Endpoints que precisam de auth
 * continuam protegidos pelo `requireAuth` colocado no router específico.
 *
 * Não loga falha — JWT inválido/ausente é OK aqui (o requireAuth depois
 * que decide se barra ou não).
 */
export function softAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    next()
    return
  }
  const secret = process.env.JWT_SECRET
  if (!secret) {
    next()
    return
  }
  try {
    req.jwtPayload = jwt.verify(header.slice(7), secret) as JwtPayload
  } catch {
    // ignora — token inválido vira não-autenticado para rate limit
  }
  next()
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.jwtPayload) {
      next(new UnauthorizedError())
      return
    }
    if (!roles.includes(req.jwtPayload.role)) {
      next(new ForbiddenError(`Role '${req.jwtPayload.role}' não tem acesso`))
      return
    }
    next()
  }
}

/**
 * Step-up auth ("sudo") — exige reautenticação por senha pra acessar dados
 * sensíveis do cliente (live/recordings/faces/plates) quando o ator é um
 * integrador. CLIENTE_* (acesso direto ou impersonado), SUPER_ADMIN e
 * ADMIN_GLOBAL passam livre — eles não são gated por essa regra.
 *
 * O integrador chama POST /auth/sudo com senha + motivo → ganha um JWT
 * separado curto (15min default) que envia no header `X-ICV-Sudo` em cada
 * request sensível. Esse middleware valida esse JWT.
 *
 * Razão: LGPD finalidade. Sidebar oculta esses itens por default; só ADMIN
 * que clicar e justificar consegue acesso. Audit log fica `ELEVATED_ACCESS_GRANT`
 * + cada request individual continua loggada na timeline normal.
 */
export interface SudoTokenPayload {
  sub:        string  // mesmo userId do parent
  parentSub:  string  // bind ao token principal (impede troca de identidade)
  scope:      'sudo'
  reason:     string
  iat:        number
  exp:        number
}

export function requireSudo(req: Request, _res: Response, next: NextFunction): void {
  const p = req.jwtPayload
  if (!p) { next(new UnauthorizedError()); return }

  // SUPER_ADMIN/ADMIN_GLOBAL não precisam (já é fabricante operando).
  // CLIENTE_* não precisam (é o próprio dono dos dados, ou impersonado com
  // motivo já registrado). Apenas INTEGRADOR_* tomam o gate.
  if (!p.role.startsWith('INTEGRADOR_')) { next(); return }

  const sudoToken = req.header('x-icv-sudo')
  if (!sudoToken) {
    next(new ForbiddenError('Operação requer reautenticação (sudo)'))
    return
  }

  const secret = process.env.JWT_SECRET
  if (!secret) { next(new Error('JWT_SECRET not configured')); return }

  try {
    const sp = jwt.verify(sudoToken, secret) as SudoTokenPayload
    if (sp.scope !== 'sudo' || sp.parentSub !== p.sub) {
      next(new ForbiddenError('Token sudo inválido pra esta sessão'))
      return
    }
    // Anexa pra handlers consultarem o motivo se quiserem (audit fino-grão).
    (req as Request & { sudoPayload?: SudoTokenPayload }).sudoPayload = sp
    next()
  } catch {
    next(new ForbiddenError('Token sudo expirado ou inválido — refaça a elevação'))
  }
}
