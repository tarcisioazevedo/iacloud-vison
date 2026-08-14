/**
 * admin-billing-actions — tests E2E dos endpoints de ação operacional.
 * Cobre: reprocess (single + bulk), audit-log. Sem auth/role middleware (mockado).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import express from 'express'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

vi.mock('../lib/prisma', () => ({
  prisma: {
    asaasWebhookEvent: {
      findUnique: vi.fn(),
      update:     vi.fn(),
      updateMany: vi.fn(),
      findMany:   vi.fn(),
      count:      vi.fn(),
    },
    asaasConfigAudit: {
      findMany: vi.fn(),
    },
    asaasCustomer:     { count: vi.fn(), findMany: vi.fn() },
    asaasSubscription: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    asaasGlobalConfig: { findUnique: vi.fn() },
    user:              { findMany: vi.fn() },
  },
}))
vi.mock('../services/asaas-webhook-processor.service', () => ({
  asaasWebhookProcessor: { triggerNow: vi.fn() },
}))
vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.jwtPayload = { sub: 'usr_test', role: 'SUPER_ADMIN' }; next() },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

import { adminBillingActionsRouter } from './admin-billing-actions'
import { prisma } from '../lib/prisma'
import { asaasWebhookProcessor } from '../services/asaas-webhook-processor.service'

const mockPrisma = prisma as any
const mockProcessor = asaasWebhookProcessor as any

interface Res { status: number; body: any }
function request(port: number, path: string, method: string, body?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {},
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let parsed: any = raw
        try { parsed = JSON.parse(raw) } catch {}
        resolve({ status: res.statusCode ?? 0, body: parsed })
      })
    })
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
  app.use('/admin/billing', adminBillingActionsRouter)
  server = app.listen(0)
  await new Promise<void>(r => server.on('listening', r))
  const addr = server.address() as AddressInfo
  baseUrl = { port: addr.port }
})

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()))
})

beforeEach(() => { vi.clearAllMocks() })

// ─── reprocess single ────────────────────────────────────────────────────────

describe('POST /webhook-events/:id/reprocess', () => {
  it('volta FAILED → PENDING e dispara worker', async () => {
    mockPrisma.asaasWebhookEvent.findUnique.mockResolvedValue({
      id: 'evt_db_id', eventId: 'evt_ext', eventName: 'PAYMENT_CREATED', status: 'FAILED',
    })
    mockPrisma.asaasWebhookEvent.update.mockResolvedValue({})

    const r = await request(baseUrl.port, '/admin/billing/webhook-events/evt_db_id/reprocess', 'POST')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, status: 'PENDING' })
    expect(mockPrisma.asaasWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt_db_id' },
      data:  expect.objectContaining({ status: 'PENDING', errorMessage: null }),
    })
    expect(mockProcessor.triggerNow).toHaveBeenCalledOnce()
  })

  it('rejeita reprocess de PROCESSED (409)', async () => {
    mockPrisma.asaasWebhookEvent.findUnique.mockResolvedValue({
      id: 'evt_db_id', status: 'PROCESSED', eventId: 'x', eventName: 'x',
    })
    const r = await request(baseUrl.port, '/admin/billing/webhook-events/evt_db_id/reprocess', 'POST')
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('already_processed')
    expect(mockPrisma.asaasWebhookEvent.update).not.toHaveBeenCalled()
  })

  it('404 quando id não existe', async () => {
    mockPrisma.asaasWebhookEvent.findUnique.mockResolvedValue(null)
    const r = await request(baseUrl.port, '/admin/billing/webhook-events/nope/reprocess', 'POST')
    expect(r.status).toBe(404)
  })
})

// ─── bulk reprocess ──────────────────────────────────────────────────────────

describe('POST /webhook-events/reprocess-all-failed', () => {
  it('atualiza todos FAILED dos últimos 7d', async () => {
    mockPrisma.asaasWebhookEvent.updateMany.mockResolvedValue({ count: 5 })
    const r = await request(baseUrl.port, '/admin/billing/webhook-events/reprocess-all-failed', 'POST')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, count: 5 })
    expect(mockPrisma.asaasWebhookEvent.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'FAILED' }),
      data:  expect.objectContaining({ status: 'PENDING' }),
    })
    expect(mockProcessor.triggerNow).toHaveBeenCalledOnce()
  })
})

// ─── audit-log ───────────────────────────────────────────────────────────────

describe('GET /audit-log', () => {
  it('retorna rotações enriquecidas com email do ator', async () => {
    mockPrisma.asaasConfigAudit.findMany.mockResolvedValue([
      {
        id: 'a1', action: 'ROTATE_API_KEY', actorUserId: 'usr_x',
        metadata: { environment: 'PROD' }, createdAt: new Date('2026-06-24T15:00:00Z'),
      },
    ])
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'usr_x', email: 'admin@vsaas.com.br', name: 'Admin' },
    ])

    const r = await request(baseUrl.port, '/admin/billing/audit-log', 'GET')
    expect(r.status).toBe(200)
    expect(r.body).toHaveLength(1)
    expect(r.body[0]).toMatchObject({
      action:     'ROTATE_API_KEY',
      actorEmail: 'admin@vsaas.com.br',
      actorName:  'Admin',
      metadata:   { environment: 'PROD' },
    })
  })

  it('respeita limit query param (max 200)', async () => {
    mockPrisma.asaasConfigAudit.findMany.mockResolvedValue([])
    mockPrisma.user.findMany.mockResolvedValue([])
    const r = await request(baseUrl.port, '/admin/billing/audit-log?limit=10', 'GET')
    expect(r.status).toBe(200)
    expect(mockPrisma.asaasConfigAudit.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      take:    10,
    })
  })
})

// ─── cancel subscription ─────────────────────────────────────────────────────

describe('DELETE /subscriptions/:id', () => {
  it('404 quando subscription não existe', async () => {
    mockPrisma.asaasSubscription.findUnique.mockResolvedValue(null)
    const r = await request(baseUrl.port, '/admin/billing/subscriptions/sub_xxx', 'DELETE')
    expect(r.status).toBe(404)
  })

  it('409 quando subscription já não está ACTIVE', async () => {
    mockPrisma.asaasSubscription.findUnique.mockResolvedValue({
      id: 'sub_xxx', asaasSubscriptionId: 'sub_ext', status: 'INACTIVE',
    })
    const r = await request(baseUrl.port, '/admin/billing/subscriptions/sub_xxx', 'DELETE')
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('not_active')
  })
})
