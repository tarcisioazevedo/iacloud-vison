/**
 * applyTenantScope — testes de isolamento multi-tenant.
 *
 * Estes testes são a 1ª linha de defesa contra vazamento entre tenants.
 * Qualquer cenário descrito em docs/semantic-search/isolation-strategy.md
 * deve estar coberto aqui.
 */

import { describe, it, expect } from 'vitest'
import { applyTenantScope } from '../tenant-scope'

describe('applyTenantScope — isolamento por role', () => {
  it('SUPER_ADMIN sem integradorId: cross-tenant', () => {
    const scope = applyTenantScope(
      { role: 'SUPER_ADMIN', sub: 'sa-1' } as any,
      { integradorId: undefined, cameraIds: undefined },
    )
    expect(scope.integradorId).toBeNull()
    expect(scope.clienteFinalId).toBeNull()
    expect(scope.isCrossTenant).toBe(true)
  })

  it('SUPER_ADMIN com integradorId=X: scope a X (cross-tenant=false)', () => {
    const scope = applyTenantScope(
      { role: 'SUPER_ADMIN', sub: 'sa-1' } as any,
      { integradorId: 'int-x', cameraIds: undefined },
    )
    expect(scope.integradorId).toBe('int-x')
    expect(scope.isCrossTenant).toBe(false)
  })

  it('INTEGRADOR_ADMIN: força próprio integradorId mesmo se override', () => {
    const scope = applyTenantScope(
      { role: 'INTEGRADOR_ADMIN', sub: 'u-1', integradorId: 'int-A' } as any,
      { integradorId: 'int-B', cameraIds: undefined }, // tentativa de override
    )
    expect(scope.integradorId).toBe('int-A') // mantém o do JWT
    expect(scope.isCrossTenant).toBe(false)
  })

  it('INTEGRADOR_TECNICO: mesmo comportamento que ADMIN', () => {
    const scope = applyTenantScope(
      { role: 'INTEGRADOR_TECNICO', sub: 'u-1', integradorId: 'int-A' } as any,
      { integradorId: 'int-B', cameraIds: undefined },
    )
    expect(scope.integradorId).toBe('int-A')
  })

  it('INTEGRADOR_ADMIN sem integradorId no JWT: lança ForbiddenError', () => {
    expect(() =>
      applyTenantScope(
        { role: 'INTEGRADOR_ADMIN', sub: 'u-1' } as any,
        {},
      ),
    ).toThrow(/integradorId/i)
  })

  it('CLIENTE_ADMIN: força próprio clienteFinalId', () => {
    const scope = applyTenantScope(
      {
        role: 'CLIENTE_ADMIN',
        sub: 'u-1',
        integradorId: 'int-A',
        clienteFinalId: 'cf-1',
      } as any,
      { integradorId: 'int-B', cameraIds: undefined },
    )
    expect(scope.clienteFinalId).toBe('cf-1')
    expect(scope.integradorId).toBeNull() // não vaza integradorId
  })

  it('CLIENTE_VIEWER: intersecta allowedCameras com requested', () => {
    const scope = applyTenantScope(
      {
        role: 'CLIENTE_VIEWER',
        sub: 'u-1',
        clienteFinalId: 'cf-1',
        allowedCameras: ['cam-a', 'cam-b', 'cam-c'],
      } as any,
      { cameraIds: ['cam-b', 'cam-d', 'cam-e'] }, // d, e não permitidas
    )
    expect(scope.cameraIds).toEqual(['cam-b']) // só interseção
  })

  it('CLIENTE_VIEWER sem requested: pega allowedCameras', () => {
    const scope = applyTenantScope(
      {
        role: 'CLIENTE_VIEWER',
        sub: 'u-1',
        clienteFinalId: 'cf-1',
        allowedCameras: ['cam-a', 'cam-b'],
      } as any,
      {},
    )
    expect(scope.cameraIds).toEqual(['cam-a', 'cam-b'])
  })

  it('CLIENTE_VIEWER sem allowedCameras: lista vazia (nenhum resultado)', () => {
    const scope = applyTenantScope(
      {
        role: 'CLIENTE_VIEWER',
        sub: 'u-1',
        clienteFinalId: 'cf-1',
        allowedCameras: [],
      } as any,
      {},
    )
    expect(scope.cameraIds).toEqual([])
  })

  it('CLIENTE_ADMIN sem clienteFinalId no JWT: ForbiddenError', () => {
    expect(() =>
      applyTenantScope(
        { role: 'CLIENTE_ADMIN', sub: 'u-1' } as any,
        {},
      ),
    ).toThrow(/clienteFinalId/i)
  })

  it('Role desconhecida: ForbiddenError', () => {
    expect(() =>
      applyTenantScope(
        { role: 'HACKER', sub: 'u-1' } as any,
        {},
      ),
    ).toThrow()
  })

  it('Role null/vazia: ForbiddenError', () => {
    expect(() =>
      applyTenantScope({ role: '', sub: 'u-1' } as any, {}),
    ).toThrow()
  })

  it('SUPER_ADMIN com cameraIds: passa adiante (sem intersect)', () => {
    const scope = applyTenantScope(
      { role: 'SUPER_ADMIN', sub: 'sa-1' } as any,
      { cameraIds: ['c1', 'c2'] },
    )
    expect(scope.cameraIds).toEqual(['c1', 'c2'])
  })

  it('CLIENTE_OPERADOR: scoping idêntico a CLIENTE_ADMIN', () => {
    const scope = applyTenantScope(
      {
        role: 'CLIENTE_OPERADOR',
        sub: 'u-1',
        clienteFinalId: 'cf-1',
      } as any,
      {},
    )
    expect(scope.clienteFinalId).toBe('cf-1')
  })
})
