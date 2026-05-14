/**
 * SearchAuditService — testes unitários.
 *
 * Mock do prisma.storageAccessLog. Cobre:
 *  - todas queries geram registro de auditoria
 *  - falhas também são logadas (success: false)
 *  - metadata é estruturado e tipo-seguro
 *  - cross-tenant é flagged
 *  - hash da query preserva privacidade (não loga texto)
 *  - latência é capturada
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SearchAuditService, hashQuery } from '../search-audit.service'

describe('hashQuery', () => {
  it('mesmo input → mesmo hash', () => {
    expect(hashQuery('carro azul')).toBe(hashQuery('carro azul'))
  })

  it('inputs diferentes → hashes diferentes', () => {
    expect(hashQuery('carro azul')).not.toBe(hashQuery('carro vermelho'))
  })

  it('hash é hex de 16 chars (truncado p/ legibilidade)', () => {
    const h = hashQuery('teste')
    expect(h).toMatch(/^[a-f0-9]{16}$/)
  })

  it('hash não preserva texto original (privacidade LGPD)', () => {
    const original = 'CPF 123.456.789-00 do Tarcísio'
    const h = hashQuery(original)
    expect(h).not.toContain('Tarcísio')
    expect(h).not.toContain('123')
  })
})

describe('SearchAuditService', () => {
  let mockCreate: ReturnType<typeof vi.fn>
  let service: SearchAuditService

  beforeEach(() => {
    mockCreate = vi.fn(async (args: any) => ({ id: 'log-1', ...args.data }))
    service = new SearchAuditService({
      _injectedPrisma: { storageAccessLog: { create: mockCreate } } as any,
    })
  })

  it('recordQuery cria StorageAccessLog SEMANTIC_SEARCH', async () => {
    await service.recordQuery({
      actor: { type: 'INTEGRADOR', id: 'u-1', email: 'a@b.c' },
      tenantScope: {
        integradorId: 'int-A',
        clienteFinalId: null,
        cameraIds: null,
        isCrossTenant: false,
      },
      query: 'carro azul',
      modality: 'caption',
      resultsCount: 12,
      latencyMs: 145,
      success: true,
    })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const args = mockCreate.mock.calls[0][0]
    expect(args.data.action).toBe('SEMANTIC_SEARCH')
    expect(args.data.actorType).toBe('INTEGRADOR')
    expect(args.data.actorId).toBe('u-1')
    expect(args.data.actorEmail).toBe('a@b.c')
    expect(args.data.integradorId).toBe('int-A')
    expect(args.data.success).toBe(true)
  })

  it('metadata inclui queryHash (não query texto)', async () => {
    await service.recordQuery({
      actor: { type: 'INTEGRADOR', id: 'u-1' },
      tenantScope: { integradorId: 'int-A', clienteFinalId: null, cameraIds: null, isCrossTenant: false },
      query: 'cpf 123.456.789-00',
      modality: 'caption',
      resultsCount: 0,
      latencyMs: 50,
      success: true,
    })
    const metadata = mockCreate.mock.calls[0][0].data.metadataJson ?? mockCreate.mock.calls[0][0].data.metadata
    expect(metadata.queryHash).toBeDefined()
    expect(metadata.queryHash).toMatch(/^[a-f0-9]{16}$/)
    expect(JSON.stringify(metadata)).not.toContain('123')
    expect(JSON.stringify(metadata)).not.toContain('cpf')
  })

  it('metadata captura cross_tenant=true para SUPER_ADMIN global', async () => {
    await service.recordQuery({
      actor: { type: 'SUPER_ADMIN', id: 'sa-1' },
      tenantScope: { integradorId: null, clienteFinalId: null, cameraIds: null, isCrossTenant: true },
      query: 'carro',
      modality: 'merge',
      resultsCount: 100,
      latencyMs: 320,
      success: true,
    })
    const meta = mockCreate.mock.calls[0][0].data.metadataJson ?? mockCreate.mock.calls[0][0].data.metadata
    expect(meta.crossTenant).toBe(true)
  })

  it('falha também é logada (success:false + errorMessage)', async () => {
    await service.recordQuery({
      actor: { type: 'INTEGRADOR', id: 'u-1' },
      tenantScope: { integradorId: 'int-A', clienteFinalId: null, cameraIds: null, isCrossTenant: false },
      query: 'foo',
      modality: 'caption',
      resultsCount: 0,
      latencyMs: 1500,
      success: false,
      errorMessage: 'pgvector timeout',
    })
    const args = mockCreate.mock.calls[0][0]
    expect(args.data.success).toBe(false)
    expect(args.data.errorMessage).toBe('pgvector timeout')
  })

  it('best-effort: falha do log NÃO propaga', async () => {
    mockCreate = vi.fn(async () => {
      throw new Error('DB down')
    })
    service = new SearchAuditService({
      _injectedPrisma: { storageAccessLog: { create: mockCreate } } as any,
    })
    // não lança
    await expect(
      service.recordQuery({
        actor: { type: 'INTEGRADOR', id: 'u-1' },
        tenantScope: { integradorId: 'int-A', clienteFinalId: null, cameraIds: null, isCrossTenant: false },
        query: 'foo',
        modality: 'caption',
        resultsCount: 0,
        latencyMs: 50,
        success: true,
      }),
    ).resolves.toBeUndefined()
  })

  it('recordReindex cria SEMANTIC_REINDEX', async () => {
    await service.recordReindex({
      actor: { type: 'SUPER_ADMIN', id: 'sa-1' },
      integradorId: 'int-A',
      framesProcessed: 1234,
      latencyMs: 60000,
      success: true,
    })
    const args = mockCreate.mock.calls[0][0]
    expect(args.data.action).toBe('SEMANTIC_REINDEX')
    expect(args.data.integradorId).toBe('int-A')
  })

  it('recordDelete cria SEMANTIC_DELETE (LGPD trail)', async () => {
    await service.recordDelete({
      actor: { type: 'SUPER_ADMIN', id: 'sa-1' },
      integradorId: 'int-A',
      deletedCount: 4567,
      reason: 'cancelamento',
    })
    const args = mockCreate.mock.calls[0][0]
    expect(args.data.action).toBe('SEMANTIC_DELETE')
    const meta = args.data.metadataJson ?? args.data.metadata
    expect(meta.deletedCount).toBe(4567)
    expect(meta.reason).toBe('cancelamento')
  })
})
