/**
 * tenant-scope — invariantes de domínio Sites × Câmeras
 *
 * Testes unitários para resolveCreateCameraSiteId() e assertSiteBelongsToUser().
 * Cobre as 5 regras documentadas em docs/INVARIANTES-DOMINIO.md:
 *
 *   I-1  Tenant 0 sites           → ValidationError 400 (cadastre um site)
 *   I-2  Tenant 1 site            → autopreenche o único site
 *   I-3  Tenant 2+ sites          → ValidationError 400 (escolha explícita)
 *   I-4  siteId de outro tenant   → NotFoundError 404 (anti-vazamento)
 *   I-5  siteId válido do tenant  → echo do id (passa direto)
 *
 * Nota: a regra "câmera + box no mesmo site" é garantida por FK composto no
 * banco (não testável em unit; depende de Postgres). Testes integrados
 * cobrindo isso ficam num futuro setup com banco efêmero (testcontainers).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.mock precisa vir antes do import da lib que consome ./prisma.
vi.mock('./prisma', () => ({
  prisma: {
    site: {
      findFirst:  vi.fn(),
      findMany:   vi.fn(),
      findUnique: vi.fn(),
    },
    clienteFinal: {
      findFirst: vi.fn(),
    },
  },
}))

import {
  resolveCreateCameraSiteId, assertSiteBelongsToUser,
  resolveClienteScope, clienteScopeDirectWhere, clienteScopeViaCameraWhere,
} from './tenant-scope'
import { prisma } from './prisma'
import { NotFoundError, UnauthorizedError, ValidationError } from './errors'
import type { JwtPayload } from '../middleware/auth'

// Cast para handle dos mocks
const mockPrisma = prisma as unknown as {
  site: {
    findFirst:  ReturnType<typeof vi.fn>
    findMany:   ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
  }
  clienteFinal: {
    findFirst: ReturnType<typeof vi.fn>
  }
}

const baseJwt = { sub: 'u1', iat: 0, exp: 9999999999 }

const integradorJwt: JwtPayload = {
  ...baseJwt,
  sub: 'u1',
  role: 'INTEGRADOR_ADMIN',
  integradorId: 'integ-1',
}

const clienteJwt: JwtPayload = {
  ...baseJwt,
  sub: 'u2',
  role: 'CLIENTE_ADMIN',
  integradorId: 'integ-1',
  clienteFinalId: 'cli-1',
}

const superAdminJwt: JwtPayload = {
  ...baseJwt,
  sub: 'u3',
  role: 'SUPER_ADMIN',
}

beforeEach(() => {
  mockPrisma.site.findFirst.mockReset()
  mockPrisma.site.findMany.mockReset()
  mockPrisma.site.findUnique.mockReset()
  mockPrisma.clienteFinal.findFirst.mockReset()
})

describe('resolveCreateCameraSiteId — invariantes site↔câmera', () => {
  // ─────────── I-2 ───────────
  it('I-2: tenant com 1 site + siteId vazio → autopreenche o único site', async () => {
    mockPrisma.site.findMany.mockResolvedValueOnce([
      { id: 'site-only', name: 'Único site' },
    ])

    const result = await resolveCreateCameraSiteId(undefined, integradorJwt)

    expect(result).toBe('site-only')
    expect(mockPrisma.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          clienteFinal: { integradorId: 'integ-1' },
        }),
        take: 2,
      }),
    )
  })

  it('I-2: idem para CLIENTE_ADMIN (escopo por clienteFinalId)', async () => {
    mockPrisma.site.findMany.mockResolvedValueOnce([
      { id: 'site-cli', name: 'Site cliente' },
    ])

    const result = await resolveCreateCameraSiteId('', clienteJwt)

    expect(result).toBe('site-cli')
    expect(mockPrisma.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          clienteFinalId: 'cli-1',
        }),
      }),
    )
  })

  // ─────────── I-1 ───────────
  it('I-1: tenant com 0 sites → ValidationError 400 com mensagem orientadora', async () => {
    mockPrisma.site.findMany.mockResolvedValueOnce([])

    await expect(resolveCreateCameraSiteId(null, integradorJwt))
      .rejects.toThrow(ValidationError)

    // Reaplica e checa mensagem exata
    mockPrisma.site.findMany.mockResolvedValueOnce([])
    await expect(resolveCreateCameraSiteId(null, integradorJwt))
      .rejects.toThrow(/nenhum site cadastrado/i)
  })

  it('I-1: erro 400 propaga statusCode correto', async () => {
    mockPrisma.site.findMany.mockResolvedValueOnce([])

    try {
      await resolveCreateCameraSiteId(undefined, integradorJwt)
      throw new Error('should have thrown')
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError)
      expect(err.statusCode).toBe(400)
      expect(err.code).toBe('VALIDATION_ERROR')
    }
  })

  // ─────────── I-3 ───────────
  it('I-3: tenant com 2+ sites + siteId vazio → ValidationError 400 (escolha)', async () => {
    mockPrisma.site.findMany.mockResolvedValueOnce([
      { id: 'site-a', name: 'A' },
      { id: 'site-b', name: 'B' },
    ])

    await expect(resolveCreateCameraSiteId('', integradorJwt))
      .rejects.toThrow(/múltiplos sites/i)
  })

  // ─────────── I-5 ───────────
  it('I-5: siteId fornecido + pertence ao tenant → retorna o mesmo id', async () => {
    mockPrisma.site.findFirst.mockResolvedValueOnce({ id: 'site-x' })

    const result = await resolveCreateCameraSiteId('site-x', integradorJwt)

    expect(result).toBe('site-x')
    expect(mockPrisma.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'site-x',
          clienteFinal: { integradorId: 'integ-1' },
        }),
      }),
    )
    // Não chama findMany quando siteId é fornecido (otimização)
    expect(mockPrisma.site.findMany).not.toHaveBeenCalled()
  })

  // ─────────── I-4 ───────────
  it('I-4: siteId fornecido mas de outro tenant → NotFoundError 404', async () => {
    // findFirst com filtro de tenant não encontra → 404
    mockPrisma.site.findFirst.mockResolvedValueOnce(null)

    await expect(resolveCreateCameraSiteId('site-de-outro-tenant', integradorJwt))
      .rejects.toThrow(NotFoundError)
  })

  it('I-4: 404 não vaza existência cross-tenant (mensagem genérica "Site não encontrado")', async () => {
    mockPrisma.site.findFirst.mockResolvedValueOnce(null)

    try {
      await resolveCreateCameraSiteId('site-de-outro-tenant', clienteJwt)
      throw new Error('should have thrown')
    } catch (err: any) {
      expect(err).toBeInstanceOf(NotFoundError)
      expect(err.statusCode).toBe(404)
      expect(err.message).toMatch(/site/i)
      // Não vaza id nem informação de "existe mas é de outro"
      expect(err.message).not.toMatch(/outro tenant|outro cliente|forbidden|integrador/i)
    }
  })

  // ─────────── Auth guard ───────────
  it('rejeita com UnauthorizedError se JWT ausente', async () => {
    await expect(resolveCreateCameraSiteId('site-x', undefined))
      .rejects.toThrow(UnauthorizedError)
  })

  // ─────────── SUPER_ADMIN ───────────
  it('SUPER_ADMIN sem siteId vê todos os sites do produto', async () => {
    mockPrisma.site.findMany.mockResolvedValueOnce([
      { id: 's1', name: 'Single' },
    ])

    const result = await resolveCreateCameraSiteId(undefined, superAdminJwt)

    expect(result).toBe('s1')
    // Sem filtro por tenant — só active:true
    expect(mockPrisma.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true },
      }),
    )
  })
})

describe('assertSiteBelongsToUser', () => {
  it('SUPER_ADMIN: site existe → ok; site não existe → 404', async () => {
    mockPrisma.site.findUnique.mockResolvedValueOnce({ id: 's1' })
    await expect(assertSiteBelongsToUser('s1', superAdminJwt)).resolves.toBeUndefined()

    mockPrisma.site.findUnique.mockResolvedValueOnce(null)
    await expect(assertSiteBelongsToUser('ghost', superAdminJwt))
      .rejects.toThrow(NotFoundError)
  })

  it('Integrador: aceita só site do próprio integrador', async () => {
    mockPrisma.site.findFirst.mockResolvedValueOnce({ id: 'site-meu' })
    await expect(assertSiteBelongsToUser('site-meu', integradorJwt)).resolves.toBeUndefined()

    mockPrisma.site.findFirst.mockResolvedValueOnce(null)
    await expect(assertSiteBelongsToUser('site-de-outro', integradorJwt))
      .rejects.toThrow(NotFoundError)
  })

  it('Cliente final: aceita só site do próprio clienteFinalId', async () => {
    mockPrisma.site.findFirst.mockResolvedValueOnce({ id: 'site-cli' })
    await expect(assertSiteBelongsToUser('site-cli', clienteJwt)).resolves.toBeUndefined()

    expect(mockPrisma.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'site-cli', clienteFinalId: 'cli-1' },
      }),
    )
  })

  it('JWT sem clienteFinalId nem integradorId nem SUPER_ADMIN → 404 (sentinel id)', async () => {
    mockPrisma.site.findFirst.mockResolvedValueOnce(null)
    const stranger: JwtPayload = { ...baseJwt, sub: 'x', role: 'CLIENTE_VIEWER' }

    await expect(assertSiteBelongsToUser('any', stranger))
      .rejects.toThrow(NotFoundError)
  })

  it('JWT ausente → UnauthorizedError', async () => {
    await expect(assertSiteBelongsToUser('any', undefined))
      .rejects.toThrow(UnauthorizedError)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// fix A3 — resolveClienteScope: o param clienteFinalId só ESTREITA, nunca substitui
// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveClienteScope — invariante A3', () => {
  const integradorOnly: JwtPayload = { ...baseJwt, sub: 'i', role: 'INTEGRADOR_ADMIN', integradorId: 'integ-1' }

  it('SUPER_ADMIN sem param → { all }', async () => {
    expect(await resolveClienteScope(superAdminJwt)).toEqual({ kind: 'all' })
  })

  it('SUPER_ADMIN com param → { cliente } (livre)', async () => {
    expect(await resolveClienteScope(superAdminJwt, 'qualquer'))
      .toEqual({ kind: 'cliente', clienteFinalId: 'qualquer' })
  })

  it('CLIENTE_* sem param → o próprio', async () => {
    expect(await resolveClienteScope(clienteJwt)).toEqual({ kind: 'cliente', clienteFinalId: 'cli-1' })
  })

  it('CLIENTE_* com param == próprio → o próprio (ignora o param)', async () => {
    expect(await resolveClienteScope(clienteJwt, 'cli-1')).toEqual({ kind: 'cliente', clienteFinalId: 'cli-1' })
  })

  it('CLIENTE_* com param de OUTRO tenant → NotFoundError (404, sem tocar o banco)', async () => {
    await expect(resolveClienteScope(clienteJwt, 'cli-vitima')).rejects.toThrow(NotFoundError)
    expect(mockPrisma.clienteFinal.findFirst).not.toHaveBeenCalled()
  })

  it('INTEGRADOR_* sem param → { integrador }', async () => {
    expect(await resolveClienteScope(integradorOnly)).toEqual({ kind: 'integrador', integradorId: 'integ-1' })
  })

  it('INTEGRADOR_* com cliente FILHO → { cliente }', async () => {
    mockPrisma.clienteFinal.findFirst.mockResolvedValueOnce({ id: 'cli-filho' })
    expect(await resolveClienteScope(integradorOnly, 'cli-filho'))
      .toEqual({ kind: 'cliente', clienteFinalId: 'cli-filho' })
  })

  it('INTEGRADOR_* com cliente de OUTRO integrador → NotFoundError (404)', async () => {
    mockPrisma.clienteFinal.findFirst.mockResolvedValueOnce(null)
    await expect(resolveClienteScope(integradorOnly, 'cli-de-outro')).rejects.toThrow(NotFoundError)
  })

  it('JWT ausente → UnauthorizedError', async () => {
    await expect(resolveClienteScope(undefined)).rejects.toThrow(UnauthorizedError)
  })

  it('JWT sem tenant (não-super, sem cliente/integrador) → UnauthorizedError', async () => {
    const semTenant: JwtPayload = { ...baseJwt, sub: 'x', role: 'CLIENTE_VIEWER' }
    await expect(resolveClienteScope(semTenant)).rejects.toThrow(UnauthorizedError)
  })
})

describe('builders de escopo — where seguro por kind', () => {
  it('clienteScopeDirectWhere', () => {
    expect(clienteScopeDirectWhere({ kind: 'all' })).toEqual({})
    expect(clienteScopeDirectWhere({ kind: 'cliente', clienteFinalId: 'c1' })).toEqual({ clienteFinalId: 'c1' })
    expect(clienteScopeDirectWhere({ kind: 'integrador', integradorId: 'i1' }))
      .toEqual({ clienteFinal: { integradorId: 'i1' } })
  })

  it('clienteScopeViaCameraWhere', () => {
    expect(clienteScopeViaCameraWhere({ kind: 'all' })).toEqual({})
    expect(clienteScopeViaCameraWhere({ kind: 'cliente', clienteFinalId: 'c1' }))
      .toEqual({ site: { clienteFinalId: 'c1' } })
    expect(clienteScopeViaCameraWhere({ kind: 'integrador', integradorId: 'i1' }))
      .toEqual({ site: { clienteFinal: { integradorId: 'i1' } } })
  })
})
