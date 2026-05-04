import { test, expect } from '@playwright/test'
import { loginAs } from './_helpers/login'

/**
 * Smoke 04 — página live carrega sem erro fatal
 *
 * Não testa stream real (requer câmera ativa) — apenas que a UI renderiza
 * e não quebra em runtime. Falhas reais de WebRTC/HLS aparecem em testes
 * dedicados quando houver câmera de teste no ambiente.
 */

test.beforeEach(async ({ page }) => {
  await loginAs(page)
})

test('Página /live renderiza sem erros JS', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await page.goto('/live')
  await expect(page).toHaveURL(/\/live/)

  // Tempo razoável para o React montar e os SWR fetches iniciarem
  await page.waitForTimeout(3000)

  // Falhar em erros JS reais (ex: cannot read property of undefined)
  expect(errors, `Erros JS: ${errors.join(' | ')}`).toHaveLength(0)
})

test('Página /recordings renderiza', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await page.goto('/recordings')
  await expect(page).toHaveURL(/\/recordings/)
  await page.waitForTimeout(2000)

  expect(errors, `Erros JS: ${errors.join(' | ')}`).toHaveLength(0)
})
