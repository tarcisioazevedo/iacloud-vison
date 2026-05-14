/**
 * PgVectorStore — testes de unidade.
 *
 * Escopo:
 *  - vector serialization (Float32Array → '[a,b,c]' string para pgvector)
 *  - cosine distance helper
 *  - SQL builder: tenant scope, camera filter, time range, ORDER BY
 *  - z-score merge entre caption e image
 *
 * NÃO testa o roundtrip real com Postgres aqui (integration test cabe num
 * arquivo *.spec.ts dedicado e requer `pg_isready`). Esse arquivo cobre
 * a lógica determinística sem dependência externa.
 */

import { describe, it, expect } from 'vitest'
import {
  toVectorLiteral,
  cosineDistance,
  mergeWithZScore,
  buildScopeWhere,
} from '../pgvector-store-helpers'
import type { TenantScope, RawVecHit } from '../types'

describe('toVectorLiteral', () => {
  it('serializa Float32Array para string pgvector [a,b,c]', () => {
    const v = new Float32Array([0.1, 0.2, -0.3])
    expect(toVectorLiteral(v)).toBe('[0.1,0.2,-0.3]')
  })

  it('preserva precisão razoável de floats', () => {
    const v = new Float32Array([0.123456789])
    // Float32 tem ~7 dígitos de precisão; aceitamos truncamento
    expect(toVectorLiteral(v)).toMatch(/^\[0\.12345/)
  })

  it('rejeita array vazio', () => {
    expect(() => toVectorLiteral(new Float32Array([]))).toThrow(/empty/i)
  })

  it('rejeita NaN', () => {
    expect(() => toVectorLiteral(new Float32Array([0.1, NaN, 0.3]))).toThrow(/NaN/)
  })
})

describe('cosineDistance', () => {
  it('vetores idênticos → 0', () => {
    const v = new Float32Array([1, 0, 0])
    expect(cosineDistance(v, v)).toBeCloseTo(0, 5)
  })

  it('vetores ortogonais → 1', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([0, 1, 0])
    expect(cosineDistance(a, b)).toBeCloseTo(1, 5)
  })

  it('vetores opostos → 2', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([-1, 0, 0])
    expect(cosineDistance(a, b)).toBeCloseTo(2, 5)
  })

  it('rejeita dimensões diferentes', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([1, 0, 0])
    expect(() => cosineDistance(a, b)).toThrow(/dimension/i)
  })
})

describe('mergeWithZScore', () => {
  it('hits idênticos em ambas modalidades → mantém min', () => {
    const captionHits: RawVecHit[] = [
      { frameId: 'a', distance: 0.5, source: 'caption' },
      { frameId: 'b', distance: 0.8, source: 'caption' },
    ]
    const imageHits: RawVecHit[] = [
      { frameId: 'a', distance: 0.3, source: 'image' }, // image vence em A
      { frameId: 'b', distance: 0.9, source: 'image' },
    ]
    // Stats escolhidas para image ter z menor em A:
    //   z_caption(0.5) = (0.5 - 0.65) / sqrt(0.045) ≈ -0.71
    //   z_image(0.3)   = (0.3 - 0.5)  / sqrt(0.01)  = -2.0
    // -2.0 < -0.71 → image vence
    const captionStats = { integradorId: 'i', modality: 'caption' as const, mean: 0.65, variance: 0.045, n: 100 }
    const imageStats = { integradorId: 'i', modality: 'image' as const, mean: 0.5, variance: 0.01, n: 100 }
    const merged = mergeWithZScore(captionHits, imageHits, captionStats, imageStats)
    expect(merged).toHaveLength(2)
    const a = merged.find(m => m.frameId === 'a')!
    expect(a.source).toBe('image')
  })

  it('hit só em uma modalidade', () => {
    const captionHits: RawVecHit[] = [{ frameId: 'a', distance: 0.4, source: 'caption' }]
    const imageHits: RawVecHit[] = []
    const stats = { integradorId: 'i', modality: 'caption' as const, mean: 0.5, variance: 0.04, n: 50 }
    const imgStats = { integradorId: 'i', modality: 'image' as const, mean: 0.5, variance: 0.04, n: 50 }
    const merged = mergeWithZScore(captionHits, imageHits, stats, imgStats)
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('caption')
  })

  it('ordena ascendente por z-score', () => {
    const captionHits: RawVecHit[] = [
      { frameId: 'far', distance: 1.0, source: 'caption' },
      { frameId: 'near', distance: 0.1, source: 'caption' },
      { frameId: 'mid', distance: 0.5, source: 'caption' },
    ]
    const stats = { integradorId: 'i', modality: 'caption' as const, mean: 0.5, variance: 0.04, n: 100 }
    const imgStats = { integradorId: 'i', modality: 'image' as const, mean: 0.5, variance: 0.04, n: 100 }
    const merged = mergeWithZScore(captionHits, [], stats, imgStats)
    expect(merged.map(m => m.frameId)).toEqual(['near', 'mid', 'far'])
  })
})

describe('buildScopeWhere — tenant isolation', () => {
  it('SUPER_ADMIN cross-tenant: nenhum filtro de tenant', () => {
    const scope: TenantScope = {
      integradorId: null,
      clienteFinalId: null,
      cameraIds: null,
      isCrossTenant: true,
    }
    const { sql, params } = buildScopeWhere(scope)
    // Para cross-tenant não há predicado de tenant — só o resto.
    expect(sql).not.toMatch(/integrador_id/i)
    expect(sql).not.toMatch(/cliente_final_id/i)
    expect(params).toEqual([])
  })

  it('INTEGRADOR_ADMIN: filtro por integrador_id obrigatório', () => {
    const scope: TenantScope = {
      integradorId: 'int-uuid',
      clienteFinalId: null,
      cameraIds: null,
      isCrossTenant: false,
    }
    const { sql, params } = buildScopeWhere(scope)
    expect(sql).toMatch(/"integradorId"\s*=\s*\$1/)
    expect(params).toEqual(['int-uuid'])
  })

  it('CLIENTE_ADMIN: filtro por clienteFinalId', () => {
    const scope: TenantScope = {
      integradorId: null,
      clienteFinalId: 'cf-uuid',
      cameraIds: null,
      isCrossTenant: false,
    }
    const { sql, params } = buildScopeWhere(scope)
    expect(sql).toMatch(/"clienteFinalId"\s*=\s*\$1/)
    expect(params).toEqual(['cf-uuid'])
  })

  it('CLIENTE_VIEWER com allowedCameras: filtro por cameraId IN', () => {
    const scope: TenantScope = {
      integradorId: null,
      clienteFinalId: 'cf-uuid',
      cameraIds: ['cam1', 'cam2'],
      isCrossTenant: false,
    }
    const { sql, params } = buildScopeWhere(scope)
    expect(sql).toMatch(/"clienteFinalId"\s*=\s*\$1/)
    expect(sql).toMatch(/"cameraId"\s*=\s*ANY\(\$2\)/)
    expect(params).toEqual(['cf-uuid', ['cam1', 'cam2']])
  })

  it('cameraIds vazio: força sem resultado (1=0)', () => {
    const scope: TenantScope = {
      integradorId: 'int',
      clienteFinalId: null,
      cameraIds: [],
      isCrossTenant: false,
    }
    const { sql } = buildScopeWhere(scope)
    expect(sql).toMatch(/1\s*=\s*0/)
  })
})
