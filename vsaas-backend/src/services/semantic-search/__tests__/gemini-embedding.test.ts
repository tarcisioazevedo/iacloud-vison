/**
 * GeminiEmbeddingService — testes unitários.
 *
 * Mock do SDK do Google para evitar custo e dependência de rede.
 * Cobre:
 *  - normalização L2 (||v|| == 1)
 *  - truncamento Matryoshka (3072 → 768)
 *  - cache LRU (segunda chamada com mesma query não chama SDK)
 *  - retry exponencial em 429/5xx
 *  - validação de tamanho de entrada (texto vazio/muito longo)
 *  - tratamento de no-op quando API key ausente
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  GeminiEmbeddingService,
  l2Normalize,
  truncateMatryoshka,
} from '../gemini-embedding.service'

describe('l2Normalize', () => {
  it('vetor unitário fica idêntico', () => {
    const v = new Float32Array([1, 0, 0])
    const n = l2Normalize(v)
    expect(n[0]).toBeCloseTo(1, 5)
    expect(n[1]).toBeCloseTo(0, 5)
    expect(n[2]).toBeCloseTo(0, 5)
  })

  it('normaliza vetor [3,4] → [0.6, 0.8]', () => {
    const v = new Float32Array([3, 4])
    const n = l2Normalize(v)
    expect(n[0]).toBeCloseTo(0.6, 5)
    expect(n[1]).toBeCloseTo(0.8, 5)
    // ||n|| === 1
    const norm = Math.sqrt(n[0] ** 2 + n[1] ** 2)
    expect(norm).toBeCloseTo(1, 5)
  })

  it('vetor zero retorna zero (não NaN)', () => {
    const v = new Float32Array([0, 0, 0])
    const n = l2Normalize(v)
    expect(n[0]).toBe(0)
    expect(n[1]).toBe(0)
    expect(n[2]).toBe(0)
  })
})

describe('truncateMatryoshka', () => {
  it('trunca para o tamanho alvo', () => {
    const v = new Float32Array(3072).fill(0.5)
    const t = truncateMatryoshka(v, 768)
    expect(t.length).toBe(768)
    expect(t[0]).toBe(0.5)
    expect(t[767]).toBe(0.5)
  })

  it('mantém se já é menor', () => {
    const v = new Float32Array([1, 2, 3])
    const t = truncateMatryoshka(v, 768)
    expect(t.length).toBe(3)
  })

  it('rejeita target ≤ 0', () => {
    expect(() => truncateMatryoshka(new Float32Array([1, 2]), 0)).toThrow(/positive/i)
  })
})

describe('GeminiEmbeddingService (mocked SDK)', () => {
  let mockEmbed: ReturnType<typeof vi.fn>
  let service: GeminiEmbeddingService

  beforeEach(() => {
    // Mock do método embedContent que retorna 768 floats fixos
    mockEmbed = vi.fn(async () => ({
      embedding: { values: new Array(768).fill(0).map((_, i) => Math.sin(i / 100)) },
    }))
    service = new GeminiEmbeddingService({
      apiKey: 'test-key',
      model: 'gemini-embedding-001',
      _injectedClient: { embedContent: mockEmbed },
    })
  })

  it('embed retorna Float32Array de 768', async () => {
    const v = await service.embed('teste')
    expect(v).toBeInstanceOf(Float32Array)
    expect(v.length).toBe(768)
  })

  it('embed normaliza L2', async () => {
    const v = await service.embed('teste')
    let norm = 0
    for (const x of v) norm += x * x
    expect(Math.sqrt(norm)).toBeCloseTo(1, 4)
  })

  it('cache LRU evita 2ª chamada', async () => {
    await service.embed('carro azul')
    await service.embed('carro azul')
    expect(mockEmbed).toHaveBeenCalledTimes(1)
  })

  it('cache só por exact match (não normalização agressiva)', async () => {
    await service.embed('carro azul')
    await service.embed('carro  azul') // dois espaços
    expect(mockEmbed).toHaveBeenCalledTimes(2)
  })

  it('rejeita string vazia', async () => {
    await expect(service.embed('')).rejects.toThrow(/empty/i)
  })

  it('rejeita string muito longa (>10k chars)', async () => {
    const huge = 'a'.repeat(10001)
    await expect(service.embed(huge)).rejects.toThrow(/too long/i)
  })

  it('retry exponencial em 429', async () => {
    let calls = 0
    mockEmbed = vi.fn(async () => {
      calls++
      if (calls < 3) {
        const e: any = new Error('Rate limited')
        e.status = 429
        throw e
      }
      return { embedding: { values: new Array(768).fill(0.1) } }
    })
    service = new GeminiEmbeddingService({
      apiKey: 'test-key',
      model: 'gemini-embedding-001',
      _injectedClient: { embedContent: mockEmbed },
      _testBackoffMs: 1, // acelera teste
    })
    const v = await service.embed('teste')
    expect(v).toBeInstanceOf(Float32Array)
    expect(mockEmbed).toHaveBeenCalledTimes(3)
  })

  it('desiste após 3 tentativas em erro permanente', async () => {
    mockEmbed = vi.fn(async () => {
      const e: any = new Error('Server error')
      e.status = 500
      throw e
    })
    service = new GeminiEmbeddingService({
      apiKey: 'test-key',
      model: 'gemini-embedding-001',
      _injectedClient: { embedContent: mockEmbed },
      _testBackoffMs: 1,
    })
    await expect(service.embed('teste')).rejects.toThrow()
    expect(mockEmbed).toHaveBeenCalledTimes(3)
  })

  it('isAvailable() false quando sem apiKey', () => {
    const s = new GeminiEmbeddingService({ apiKey: '', model: 'gemini-embedding-001' })
    expect(s.isAvailable()).toBe(false)
  })

  it('embed lança quando sem apiKey', async () => {
    const s = new GeminiEmbeddingService({ apiKey: '', model: 'gemini-embedding-001' })
    await expect(s.embed('teste')).rejects.toThrow(/api key/i)
  })

  it('embedBatch chama API uma vez por item (sem batch nativo)', async () => {
    const v = await service.embedBatch(['a', 'b', 'c'])
    expect(v).toHaveLength(3)
    expect(mockEmbed).toHaveBeenCalledTimes(3)
  })
})
