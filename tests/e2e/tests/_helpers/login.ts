import type { Page } from '@playwright/test'

/**
 * Helper compartilhado: realiza login com E2E_USER / E2E_PASS via UI.
 *
 * Pula o teste se credenciais não estiverem configuradas — útil para CI sem
 * ambiente de QA pareado.
 */
export async function loginAs(page: Page) {
  const user = process.env.E2E_USER
  const pass = process.env.E2E_PASS

  if (!user || !pass) {
    throw new Error('E2E_USER e E2E_PASS devem estar definidos. Veja tests/e2e/.env.example')
  }

  await page.goto('/login')
  await page.getByRole('textbox', { name: /e-?mail/i }).fill(user)
  await page.getByRole('textbox', { name: /senha|password/i }).fill(pass)
  await page.getByRole('button', { name: /entrar|login/i }).click()

  // Espera redirecionamento para dashboard ou qualquer rota privada
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 })
}
