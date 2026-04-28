/**
 * Tenant scope helpers — ÚNICA fonte de verdade de isolamento multi-tenant.
 *
 * Regra de ouro:
 *   - SUPER_ADMIN pode ver tudo (operador da plataforma).
 *   - INTEGRADOR_ADMIN vê câmeras dos ClientesFinais que PERTENCEM a ele.
 *   - Qualquer outro role com clienteFinalId vê apenas câmeras desse cliente.
 *   - Nada sem JWT válido passa por aqui.
 *
 * Use em TODOS os endpoints que operam sobre recursos de tenant:
 *
 *   const camera = await requireCameraForUser(req.params.id, req.jwtPayload!)
 *
 * Se não tiver acesso, joga NotFoundError (404) em vez de ForbiddenError (403) —
 * evita revelar existência de recurso de outro tenant (side channel de enumeração).
 */
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { prisma } from './prisma'
import { NotFoundError, UnauthorizedError, ValidationError } from './errors'
import type { JwtPayload } from '../middleware/auth'

/**
 * Gera o `where` de Prisma para filtrar câmeras ao tenant do usuário.
 * Devolve o filtro vazio `{}` para SUPER_ADMIN (escopo global).
 */
export function cameraTenantWhere(
  jwt: JwtPayload | undefined,
): Prisma.CameraWhereInput {
  if (!jwt) throw new UnauthorizedError()

  if (jwt.role === 'SUPER_ADMIN') return {}

  if (jwt.clienteFinalId) {
    return { site: { clienteFinalId: jwt.clienteFinalId } }
  }

  if (jwt.integradorId) {
    return { site: { clienteFinal: { integradorId: jwt.integradorId } } }
  }

  // JWT válido mas sem tenant associado → não pode ver nada.
  throw new UnauthorizedError('JWT sem tenant')
}

/**
 * Variante async que para INTEGRADOR_TECNICO aplica a allowlist de clientes
 * (Lote 3 — IntegradorTechnicianAccess).
 *
 * Se o técnico não tem nenhuma entrada, comportamento = todos os clientes do
 * integrador (compatibilidade com antes do Lote 3).
 */
export async function cameraTenantWhereAsync(
  jwt: JwtPayload | undefined,
): Promise<Prisma.CameraWhereInput> {
  if (!jwt) throw new UnauthorizedError()
  if (jwt.role === 'SUPER_ADMIN') return {}
  if (jwt.clienteFinalId) return { site: { clienteFinalId: jwt.clienteFinalId } }

  if (jwt.integradorId) {
    if (jwt.role === 'INTEGRADOR_TECNICO') {
      const allowed = await prisma.integradorTechnicianAccess.findMany({
        where: { technicianUserId: jwt.sub, revokedAt: null },
        select: { clienteFinalId: true },
      })
      if (allowed.length > 0) {
        return {
          site: {
            clienteFinal: {
              integradorId: jwt.integradorId,
              id: { in: allowed.map((r) => r.clienteFinalId) },
            },
          },
        }
      }
    }
    return { site: { clienteFinal: { integradorId: jwt.integradorId } } }
  }

  throw new UnauthorizedError('JWT sem tenant')
}

/**
 * Versão do `cameraTenantWhere` que respeita `req.tenantContext` (Sprint CF.2).
 *
 * Quando o request chega via `<slug>.iacloud.com.br`, o Cloudflare Worker
 * injeta `X-ICV-Tenant` assinado HMAC e o middleware popula
 * `req.tenantContext.integradorId`. Esse contexto tem PRECEDÊNCIA sobre o
 * JWT — o subdomínio acessado é prova criptográfica de qual tenant é dono
 * do request, e mesmo um SUPER_ADMIN logado deve ver só dados daquele
 * tenant quando navega via subdomínio dele (UX correto pra "switch tenant").
 *
 * Conflito (jwt.integradorId !== tenantContext.integradorId) já foi pego
 * pelo middleware tenantContext com 403, então quando chegamos aqui os
 * dois estão alinhados — basta usar o tenantContext quando presente.
 *
 * Comportamento:
 *   - tenantContext.integradorId presente → filtra pelo integrador (sempre,
 *     mesmo se SUPER_ADMIN)
 *   - sem tenantContext → cai no `cameraTenantWhere(jwt)` clássico
 */
export function cameraTenantWhereFromRequest(req: Request): Prisma.CameraWhereInput {
  if (req.tenantContext) {
    return { site: { clienteFinal: { integradorId: req.tenantContext.integradorId } } }
  }
  return cameraTenantWhere(req.jwtPayload)
}

/**
 * Helper paralelo a `cameraTenantWhereFromRequest` mas para `IngestLog`.
 *
 * Como o `IngestLog` se relaciona com tenant via `camera.site.clienteFinal.
 * integradorId`, precisamos um `where` que case com a estrutura de relacionamento
 * do Prisma para esse modelo:
 *
 *     { camera: { site: { clienteFinal: { integradorId: X } } } }
 *
 * Dois cuidados específicos do IngestLog:
 *
 * 1) Eventos sem `cameraId` resolvido (AUTH_FAIL, UNKNOWN_PATH, ERROR antes
 *    da resolução) NÃO podem ser atribuídos a um tenant — não temos como
 *    saber. Para SUPER_ADMIN devolvemos esses junto. Para tenant-scoped
 *    excluímos via `camera: { isNot: null }` implicitamente pelo `where`.
 *
 * 2) Quando SUPER_ADMIN navega num subdomínio de tenant, o filtro tem
 *    precedência (mesma regra do cameraTenantWhereFromRequest).
 *
 * Retorna `{}` SOMENTE para SUPER_ADMIN sem tenantContext — única situação
 * em que vê tudo cross-tenant.
 */
export function ingestLogTenantWhere(req: Request): Prisma.IngestLogWhereInput {
  if (req.tenantContext) {
    return {
      camera: { site: { clienteFinal: { integradorId: req.tenantContext.integradorId } } },
    }
  }
  const jwt = req.jwtPayload
  if (!jwt) throw new UnauthorizedError()
  if (jwt.role === 'SUPER_ADMIN') return {}
  if (jwt.clienteFinalId) {
    return { camera: { site: { clienteFinalId: jwt.clienteFinalId } } }
  }
  if (jwt.integradorId) {
    return { camera: { site: { clienteFinal: { integradorId: jwt.integradorId } } } }
  }
  throw new UnauthorizedError('JWT sem tenant')
}

/**
 * Retorna a câmera apenas se o usuário tem acesso. Caso contrário 404.
 * Combina `id` + escopo de tenant em uma única query (previne IDOR).
 */
export async function requireCameraForUser<T extends Prisma.CameraFindFirstArgs>(
  id: string,
  jwt: JwtPayload | undefined,
  extra?: Omit<T, 'where'>,
) {
  const tenantWhere = cameraTenantWhere(jwt)
  const camera = await prisma.camera.findFirst({
    where: { id, ...tenantWhere },
    ...(extra ?? {}),
  })
  if (!camera) throw new NotFoundError('Câmera')
  return camera
}

/**
 * Valida que uma cameraId pertence ao tenant do usuário.
 * Use em endpoints que CRIAM recursos vinculados a uma câmera (review item,
 * alert rule, plate event manual...) — antes de aceitar `cameraId` do body.
 *
 * 404 propositalmente — não vaza existência de recurso de outro tenant.
 */
export async function assertCameraBelongsToUser(
  cameraId: string,
  jwt: JwtPayload | undefined,
): Promise<void> {
  const tenantWhere = cameraTenantWhere(jwt)
  const camera = await prisma.camera.findFirst({
    where: { id: cameraId, ...tenantWhere },
    select: { id: true },
  })
  if (!camera) throw new NotFoundError('Câmera')
}

/**
 * Resolve o siteId efetivo para criação de câmera.
 *
 * Comportamento:
 *   - siteId fornecido + pertence ao tenant → retorna esse mesmo id.
 *   - siteId vazio E tenant tem exatamente 1 site ativo → autopreenche.
 *   - siteId vazio E tenant tem 0 sites → 400 "cadastre um site primeiro".
 *   - siteId vazio E tenant tem 2+ sites → 400 pedindo escolha explícita.
 *   - siteId fornecido mas não pertence → 404 (anti-vazamento de existência).
 *
 * Isso destrava o cadastro inicial do integrador (1 site só, comum em demo)
 * sem comprometer correção quando o integrador cresce e tem múltiplos sites.
 */
export async function resolveCreateCameraSiteId(
  providedSiteId: string | undefined | null,
  jwt: JwtPayload | undefined,
): Promise<string> {
  if (!jwt) throw new UnauthorizedError()

  if (providedSiteId && providedSiteId.length > 0) {
    await assertSiteBelongsToUser(providedSiteId, jwt)
    return providedSiteId
  }

  // Sem siteId — tentar inferir.
  const tenantWhere: Prisma.SiteWhereInput =
    jwt.role === 'SUPER_ADMIN'
      ? { active: true }
      : jwt.clienteFinalId
        ? { active: true, clienteFinalId: jwt.clienteFinalId }
        : jwt.integradorId
          ? { active: true, clienteFinal: { integradorId: jwt.integradorId } }
          : { id: '__no_access__' }

  const sites = await prisma.site.findMany({
    where: tenantWhere,
    select: { id: true, name: true },
    take: 2, // só precisamos saber se há 0, 1 ou 2+
  })

  if (sites.length === 0) {
    throw new ValidationError(
      'siteId: nenhum site cadastrado no seu tenant. Cadastre um site antes de adicionar câmeras (POST /sites).',
    )
  }
  if (sites.length === 1) {
    return sites[0].id
  }
  throw new ValidationError(
    'siteId: você tem múltiplos sites — informe o siteId explicitamente.',
  )
}

/**
 * Valida que um siteId pertence ao tenant do usuário antes de criar câmera.
 * Garante que um integrador não possa "colar" câmera num site de outro.
 */
export async function assertSiteBelongsToUser(
  siteId: string,
  jwt: JwtPayload | undefined,
): Promise<void> {
  if (!jwt) throw new UnauthorizedError()

  if (jwt.role === 'SUPER_ADMIN') {
    const site = await prisma.site.findUnique({ where: { id: siteId }, select: { id: true } })
    if (!site) throw new NotFoundError('Site')
    return
  }

  const whereByTenant: Prisma.SiteWhereInput = jwt.clienteFinalId
    ? { id: siteId, clienteFinalId: jwt.clienteFinalId }
    : jwt.integradorId
      ? { id: siteId, clienteFinal: { integradorId: jwt.integradorId } }
      : { id: '__no_access__' }

  const site = await prisma.site.findFirst({ where: whereByTenant, select: { id: true } })
  // 404 consistente com requireCameraForUser — não vaza existência cross-tenant.
  if (!site) throw new NotFoundError('Site')
}
