/**
 * webhooks-asaas — bateria E2E do endpoint POST /webhooks/asaas.
 *
 * Cobre os 7 cenários da doc Asaas:
 *   1. signature válida + body OK              → 200 + PENDING criado
 *   2. signature inválida                      → 401 invalid_signature
 *   3. header signature ausente                → 401
 *   4. body sem id/event                       → 400 malformed_event
 *   5. idempotência (mesmo eventId 2x)         → 2ª resposta idempotent=true
 *   6. billing desabilitado                    → 503 billing_disabled
 *   7. webhook secret não configurado          → 503 webhook_secret_missing
 *
 * Mocka prisma e asaasWebhookProcessor; usa Express + http nativo (sem
 * dependência extra como supertest).
 */
import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest'
import express from 'express'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

vi.mock('../lib/prisma', () => ({
  prisma: {
    asaasWebhookEvent: {
      findUnique: vi.fn(),
      create:     vi.fn(),
    },
  },
}))
vi.mock('../services/asaas-webhook-processor.service', () => ({
  asaasWebhookProcessor: { triggerNow: vi.fn() },
}))
vi.mock('../middleware/require-capability', () => ({
  publicRoute: () => (_req: any, _res: any, next: any) => next(),
}))

import webhooksAsaasRouter from './webhooks-asaas'
import { prisma } from '../lib/prisma'
import { asaasWebhookProcessor } from '../services/asaas-webhook-processor.service'
import { invalidateAsaasConfigCache } from '../services/asaas-config.service'

const mockPrisma = prisma as unknown as {
  asaasWebhookEvent: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }
}
const mockProcessor = asaasWebhookProcessor as unknown as { triggerNow: ReturnType<typeof vi.fn> }

const WEBHOOK_SECRET = 'a'.repeat(64)

interface ResReq {
  status: number
  body:   any
}

function request(
  port: number, path: string, method: string,
  headers: Record<string, string>, body?: string,
): Promise<ResReq> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers },
      res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let parsed: any = raw
          try { parsed = JSON.parse(raw) } catch {}
          resolve({ status: res.statusCode ?? 0, body: parsed })
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

let server: http.Server
let baseUrl: { port: number }

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/webhooks', webhooksAsaasRouter)
  server = app.listen(0)
  await new Promise<void>(r => server.on('listening', r))
  const addr = server.address() as AddressInfo
  baseUrl = { port: addr.port }
})

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()))
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BILLING_ENABLED        = 'true'
  process.env.ASAAS_API_KEY          = '$aact_test_key_with_at_least_thirty_two_characters'
  process.env.ASAAS_WEBHOOK_SECRET   = WEBHOOK_SECRET
  // Invalida cache em memória do asaas-config pra cada test ler env do zero
  invalidateAsaasConfigCache()
  mockPrisma.asaasWebhookEvent.findUnique.mockResolvedValue(null)
  mockPrisma.asaasWebhookEvent.create.mockResolvedValue({})
})

// ─── Cenário 1: signature válida + body OK ───────────────────────────────────

describe('POST /webhooks/asaas — happy path', () => {
  it('aceita request válida e persiste como PENDING', async () => {
    const body = JSON.stringify({
      id: 'evt_test_001',
      event: 'PAYMENT_CREATED',
      payment: { id: 'pay_xxx' },
    })
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': WEBHOOK_SECRET,
      'content-length':     String(Buffer.byteLength(body)),
    }, body)

    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, status: 'PENDING' })
    expect(mockPrisma.asaasWebhookEvent.create).toHaveBeenCalledWith({
      data: {
        eventId:     'evt_test_001',
        eventName:   'PAYMENT_CREATED',
        payloadJson: expect.objectContaining({ event: 'PAYMENT_CREATED' }),
        status:      'PENDING',
      },
    })
    expect(mockProcessor.triggerNow).toHaveBeenCalledOnce()
  })
})

// ─── Cenário 2: signature inválida ───────────────────────────────────────────

describe('POST /webhooks/asaas — auth', () => {
  it('rejeita signature errada com 401', async () => {
    const body = JSON.stringify({ id: 'evt_x', event: 'PAYMENT_CREATED' })
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': 'wrong-secret-' + 'x'.repeat(50),
      'content-length':     String(Buffer.byteLength(body)),
    }, body)
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'invalid_signature' })
    expect(mockPrisma.asaasWebhookEvent.create).not.toHaveBeenCalled()
  })

  it('rejeita ausência de header asaas-access-token com 401', async () => {
    const body = JSON.stringify({ id: 'evt_x', event: 'PAYMENT_CREATED' })
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    }, body)
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'invalid_signature' })
  })

  it('rejeita token com tamanho diferente do esperado (timing-safe guard)', async () => {
    const body = JSON.stringify({ id: 'evt_x', event: 'PAYMENT_CREATED' })
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': 'short',
      'content-length':     String(Buffer.byteLength(body)),
    }, body)
    expect(r.status).toBe(401)
  })
})

// ─── Cenário 3: body malformado ──────────────────────────────────────────────

describe('POST /webhooks/asaas — payload validation', () => {
  it('rejeita body sem id/event com 400', async () => {
    const body = JSON.stringify({})
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': WEBHOOK_SECRET,
      'content-length':     String(Buffer.byteLength(body)),
    }, body)
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'malformed_event' })
  })

  it('rejeita body com só id (sem event)', async () => {
    const body = JSON.stringify({ id: 'evt_x' })
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': WEBHOOK_SECRET,
      'content-length':     String(Buffer.byteLength(body)),
    }, body)
    expect(r.status).toBe(400)
  })

  it('rejeita body com só event (sem id)', async () => {
    const body = JSON.stringify({ event: 'PAYMENT_CREATED' })
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': WEBHOOK_SECRET,
      'content-length':     String(Buffer.byteLength(body)),
    }, body)
    expect(r.status).toBe(400)
  })
})

// ─── Cenário 4: idempotência ─────────────────────────────────────────────────

describe('POST /webhooks/asaas — idempotência', () => {
  it('quando eventId já existe, responde idempotent=true sem persistir de novo', async () => {
    mockPrisma.asaasWebhookEvent.findUnique.mockResolvedValue({
      id:        'internal-id',
      eventId:   'evt_dup',
      eventName: 'PAYMENT_CREATED',
      status:    'PROCESSED',
    })
    const body = JSON.stringify({ id: 'evt_dup', event: 'PAYMENT_CREATED' })
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': WEBHOOK_SECRET,
      'content-length':     String(Buffer.byteLength(body)),
    }, body)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, status: 'PROCESSED', idempotent: true })
    expect(mockPrisma.asaasWebhookEvent.create).not.toHaveBeenCalled()
    expect(mockProcessor.triggerNow).not.toHaveBeenCalled()
  })
})

// ─── Cenário 5: billing desabilitado ─────────────────────────────────────────

describe('POST /webhooks/asaas — billing gating', () => {
  it('retorna 503 quando BILLING_ENABLED=false', async () => {
    delete process.env.BILLING_ENABLED
    const body = JSON.stringify({ id: 'evt_x', event: 'PAYMENT_CREATED' })
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': WEBHOOK_SECRET,
      'content-length':     String(Buffer.byteLength(body)),
    }, body)
    expect(r.status).toBe(503)
    expect(r.body.error).toBe('billing_disabled')
  })

  it('retorna 401 quando ASAAS_WEBHOOK_SECRET não configurado (nem env nem DB)', async () => {
    // Após task 12, webhook handler usa verifyWebhookSignatureAsync que tenta
    // DB primeiro (mock retorna undefined) e cai no env. Sem nenhum dos dois,
    // a verificação falha em "signature inválida" — semanticamente mesma defesa
    // que o antigo 503 webhook_secret_missing (request rejeitada).
    delete process.env.ASAAS_WEBHOOK_SECRET
    const body = JSON.stringify({ id: 'evt_x', event: 'PAYMENT_CREATED' })
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': WEBHOOK_SECRET,
      'content-length':     String(Buffer.byteLength(body)),
    }, body)
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'invalid_signature' })
  })
})

// ─── Cenário 6: erro de persistência ─────────────────────────────────────────

describe('POST /webhooks/asaas — error handling', () => {
  it('retorna 500 quando DB falha (não vaza stack pro Asaas)', async () => {
    mockPrisma.asaasWebhookEvent.create.mockRejectedValue(new Error('DB connection lost'))
    const body = JSON.stringify({ id: 'evt_x', event: 'PAYMENT_CREATED' })
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': WEBHOOK_SECRET,
      'content-length':     String(Buffer.byteLength(body)),
    }, body)
    expect(r.status).toBe(500)
    expect(r.body).toEqual({ error: 'persist_failed' })
  })

  it('responde em <= 1000ms (margem ampla; Asaas timeout é 10s)', async () => {
    const body = JSON.stringify({ id: 'evt_perf', event: 'PAYMENT_CREATED' })
    const start = Date.now()
    const r = await request(baseUrl.port, '/webhooks/asaas', 'POST', {
      'content-type':       'application/json',
      'asaas-access-token': WEBHOOK_SECRET,
      'content-length':     String(Buffer.byteLength(body)),
    }, body)
    const elapsed = Date.now() - start
    expect(r.status).toBe(200)
    expect(elapsed).toBeLessThan(1000)
  })
})
