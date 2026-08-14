import { Request, Response, NextFunction } from 'express'
import { createHash } from 'crypto'
import jwt from 'jsonwebtoken'
import { UnauthorizedError, ForbiddenError } from '../lib/errors'
import { prisma } from '../lib/prisma'

// Cache em memória de existência de User (60s TTL) para evitar 1 query por
// request. Invalidação automática por expiração — se um user for desativado,
// no máximo 60s depois ele será barrado.
const userActiveCache = new Map<string, { active: boolean; expiresAt: number }>()
const USER_CACHE_TTL_MS = 60_000

// Sprint B — cache leve de tokenHashes REVOGADOS (60s TTL). Evita N+1 query
// no Postgres por request. Quando admin revoga sessão, no máximo 60s depois
// o token é barrado.
const revokedTokenCache = new Map<string, { revoked: boolean; expiresAt: number }>()
const TOKEN_REVOKE_CACHE_TTL_MS = 60_000
// Throttle de lastSeenAt: atualiza no máximo 1x por minuto por sessão.
const lastSeenUpdateAt = new Map<string, number>()
const LAST_SEEN_THROTTLE_MS = 60_000

async function isSessionStillValid(jti: string): Promise<boolean> {
  if (!jti) return true // JWT antigo sem jti — passa (legacy compat)
  const tokenHash = createHash('sha256').update(jti).digest('hex')

  const now = Date.now()
  const cached = revokedTokenCache.get(tokenHash)
  if (cached && cached.expiresAt > now) return !cached.revoked

  try {
    const session = await prisma.userSession.findUnique({
      where:  { tokenHash },
      select: { revokedAt: true, expiresAt: true },
    })
    // Sem registro = JWT antigo (criado antes do Sprint A/B) ou ator não-User
    // (SuperAdmin/Integrador). Passa. Não cacheia (registro pode aparecer depois).
    if (!session) return true

    const revoked = !!session.revokedAt || session.expiresAt < new Date()
    revokedTokenCache.set(tokenHash, { revoked, expiresAt: now + TOKEN_REVOKE_CACHE_TTL_MS })
    return !revoked
  } catch {
    // Erro de DB → libera (não barra produção por hiccup de DB)
    return true
  }
}

function touchLastSeen(jti: string, ip: string | null): void {
  if (!jti) return
  const tokenHash = createHash('sha256').update(jti).digest('hex')
  const lastAt = lastSeenUpdateAt.get(tokenHash) ?? 0
  const now = Date.now()
  if (now - lastAt < LAST_SEEN_THROTTLE_MS) return
  lastSeenUpdateAt.set(tokenHash, now)

  // Fire-and-forget. Se sessão não existe (JWT pré-Sprint A), o updateMany
  // simplesmente retorna 0 — sem erro.
  prisma.userSession.updateMany({
    where: { tokenHash, revokedAt: null },
    data:  { lastSeenAt: new Date(), ...(ip ? { ip } : {}) },
  }).catch(() => { /* best-effort */ })
}

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
  /// Sprint B — JWT id único pra correlacionar JWT ↔ UserSession.tokenHash.
  /// Permite revogar uma sessão específica sem manter o JWT armazenado.
  jti?: string
  /// Sprint C — challenge token de MFA emitido por /auth/login (TTL 5min)
  /// quando user tem TOTP ativo. NÃO concede acesso — só serve para
  /// /auth/login-mfa-verify. requireAuth deve rejeitar.
  mfaPending?: boolean
  iat: number
  exp: number
}

declare global {
  namespace Express {
    interface Request {
      jwtPayload: JwtPayload
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
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload

    // Sprint C · P0 — challenge token de MFA (mfaPending=true) NÃO concede
    // acesso. Só serve para /auth/login-mfa-verify (que valida via jwt.verify
    // direto, sem passar por requireAuth). Sem essa checagem, se o challenge
    // de 5min vaza, vira bypass total do 2FA.
    if (payload.mfaPending) {
      next(new UnauthorizedError('Token de desafio MFA não autoriza acesso — complete o 2FA primeiro'))
      return
    }

    req.jwtPayload = payload

    // Sprint B — toca lastSeenAt da UserSession (throttle 1min) pra admin ver
    // "online" e cron ter base pra inactivity timeout. Fire-and-forget.
    if (payload.jti) touchLastSeen(payload.jti, req.ip ?? null)

    // Defesa contra JWT órfão: rejeita se o User foi removido/desativado após
    // a emissão do token (cenário de seed reset, exclusão administrativa).
    // Sprint B — também rejeita se a UserSession associada ao jti foi revogada
    // (admin forçou logout, lockout, password_changed).
    Promise.all([
      isUserStillActive(payload.sub),
      payload.jti ? isSessionStillValid(payload.jti) : Promise.resolve(true),
    ]).then(([userOk, sessionOk]) => {
      if (!userOk) {
        next(new UnauthorizedError('Sessão inválida — refaça login'))
        return
      }
      if (!sessionOk) {
        next(new UnauthorizedError('Sessão revogada — refaça login'))
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
    req.jwtPayload = jwt.verify(header.slice(7), secret, { algorithms: ['HS256'] }) as JwtPayload
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
    const sp = jwt.verify(sudoToken, secret, { algorithms: ['HS256'] }) as SudoTokenPayload
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
