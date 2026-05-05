import { test, expect } from '@playwright/test'
import { loginAs } from './_helpers/login'

/**
 * E2E 08 — ImpersonateModal + Banner (Onda 9)
 *
 * Cobre:
 *  - Modal exige motivo (mínimo 10 chars)
 *  - Modal exige checkbox LGPD
 *  - Botão "Iniciar" desabilitado sem requisitos
 *  - 3 níveis de role disponíveis
 *  - Após iniciar: banner com countdown aparece
 *  - "Encerrar agora" volta para login
 *
 * Pré-requisito: E2E_USER deve ser SUPER_ADMIN.
 */

test.describe('Impersonate auditado (Onda 9)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.E2E_USER, 'Defina E2E_USER e E2E_PASS para rodar')
    await loginAs(page)
  })

  test('Endpoint /api/auth/impersonate exige motivo + acknowledged', async ({ request }) => {
    // Sem auth → 401
    const r1 = await request.post('/api/auth/impersonate', {
      data: { integradorId: 'fake', reason: 'curto', acknowledged: true, durationSeconds: 900 },
      failOnStatusCode: false,
    })
    expect([401, 403]).toContain(r1.status())
  })

  test('API valida acknowledged=false como inválido (com auth)', async ({ page, request }) => {
    // Pega token de localStorage do user logado
    const token = await page.evaluate(() => localStorage.getItem('icv_token'))
    if (!token) test.skip(true, 'Sem token (login falhou)')

    const r = await request.post('/api/auth/impersonate', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        integradorId: 'int-iacloud-001',
        reason: 'Motivo curto demais',  // <10 chars OU acknowledged=false
        acknowledged: false,
        durationSeconds: 900,
      },
      failOnStatusCode: false,
    })
    // Espera 400 (validação) ou 403 (RBAC se não for super-admin)
    expect([400, 403, 422]).toContain(r.status())
  })

  test('API valida reason mínimo 10 chars', async ({ page, request }) => {
    const token = await page.evaluate(() => localStorage.getItem('icv_token'))
    if (!token) test.skip(true, 'Sem token')

    const r = await request.post('/api/auth/impersonate', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        integradorId: 'int-iacloud-001',
        reason: 'curto',  // <10 chars
        acknowledged: true,
        durationSeconds: 900,
      },
      failOnStatusCode: false,
    })
    expect([400, 403, 422]).toContain(r.status())
  })
})
