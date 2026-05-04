import { test, expect } from '@playwright/test'

/**
 * Smoke 01 — health checks públicos do backend
 *
 * Não requer login. Garante que o stack respondeu antes dos testes pesados.
 */

test.describe('Health checks', () => {
  test('GET /health responde 200', async ({ request, baseURL }) => {
    const res = await request.get(new URL('/health', baseURL).toString())
    expect(res.status()).toBe(200)
  })

  test('GET /health/ready responde 200 (DB ok)', async ({ request, baseURL }) => {
    const res = await request.get(new URL('/health/ready', baseURL).toString())
    expect(res.status()).toBe(200)
  })

  test('GET /openapi.json é JSON válido OpenAPI 3.1', async ({ request, baseURL }) => {
    const res = await request.get(new URL('/openapi.json', baseURL).toString())
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.openapi).toMatch(/^3\.1/)
    expect(body.info?.title).toBeTruthy()
    expect(body.paths).toBeTruthy()
  })
})
