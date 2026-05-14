/**
 * applyTenantScope — resolve TenantScope a partir do JWT.
 *
 * 1ª linha de defesa contra vazamento entre tenants. Toda chamada a
 * `IVectorStore.search()` ou `IVectorStore.searchSimilar()` deve receber
 * um scope construído por essa função — nunca manual.
 *
 * Regras de RBAC (ver docs/semantic-search/isolation-strategy.md §3):
 *  - SUPER_ADMIN / ADMIN_GLOBAL:
 *      - sem integradorId no request: cross-tenant (audit registra)
 *      - com integradorId: scope ao tenant escolhido
 *  - INTEGRADOR_ADMIN / INTEGRADOR_TECNICO:
 *      - força integradorId do JWT, ignora override do request
 *  - CLIENTE_ADMIN / CLIENTE_OPERADOR / CLIENTE_VIEWER / CLIENTE_AUDITOR:
 *      - força clienteFinalId do JWT
 *      - CLIENTE_VIEWER/AUDITOR: intersecta cameraIds com allowedCameras
 *
 * Qualquer divergência = throw, não silent fallback.
 */

import type { TenantScope } from './types'

/** Subset do JwtPayload que importa pra este helper. */
export interface AuthContext {
  role: string
  sub: string
  integradorId?: string | null
  clienteFinalId?: string | null
  allowedCameras?: string[] | null
  email?: string
}

/** Input da função — apenas campos que o usuário pode controlar. */
export interface ScopeInput {
  /** Apenas SUPER_ADMIN pode usar (filtrar por integrador específico). */
  integradorId?: string
  /** Apenas SUPER_ADMIN pode usar. */
  clienteFinalId?: string
  /** Filtro adicional por câmera. CLIENTE_VIEWER recebe intersect com allowed. */
  cameraIds?: string[]
}

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantScopeError'
  }
}

const SUPER_ROLES = new Set(['SUPER_ADMIN', 'ADMIN_GLOBAL'])
const INT_ROLES = new Set(['INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO'])
const CLIENTE_RESTRICTED = new Set(['CLIENTE_VIEWER', 'CLIENTE_AUDITOR'])
const CLIENTE_FULL = new Set(['CLIENTE_ADMIN', 'CLIENTE_OPERADOR'])
const CLIENTE_ROLES = new Set([...CLIENTE_RESTRICTED, ...CLIENTE_FULL])

export function applyTenantScope(jwt: AuthContext, input: ScopeInput): TenantScope {
  if (!jwt?.role) {
    throw new TenantScopeError('Auth context missing role')
  }

  if (SUPER_ROLES.has(jwt.role)) {
    return {
      integradorId: input.integradorId ?? null,
      clienteFinalId: input.clienteFinalId ?? null,
      cameraIds: input.cameraIds ?? null,
      isCrossTenant: !input.integradorId && !input.clienteFinalId,
    }
  }

  if (INT_ROLES.has(jwt.role)) {
    if (!jwt.integradorId) {
      throw new TenantScopeError('INTEGRADOR_* sem integradorId no JWT')
    }
    return {
      integradorId: jwt.integradorId, // ignora override
      clienteFinalId: null,
      cameraIds: input.cameraIds ?? null,
      isCrossTenant: false,
    }
  }

  if (CLIENTE_ROLES.has(jwt.role)) {
    if (!jwt.clienteFinalId) {
      throw new TenantScopeError('CLIENTE_* sem clienteFinalId no JWT')
    }
    let cameraIds: string[] | null = input.cameraIds ?? null
    if (CLIENTE_RESTRICTED.has(jwt.role)) {
      const allowed = jwt.allowedCameras ?? []
      if (cameraIds === null) {
        cameraIds = allowed.slice() // default = todas allowed
      } else {
        const allowedSet = new Set(allowed)
        cameraIds = cameraIds.filter(id => allowedSet.has(id))
      }
    }
    return {
      integradorId: null,
      clienteFinalId: jwt.clienteFinalId, // força do JWT
      cameraIds,
      isCrossTenant: false,
    }
  }

  throw new TenantScopeError(`Role não autorizada para semantic search: ${jwt.role}`)
}
