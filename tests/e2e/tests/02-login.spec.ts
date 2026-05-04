import { test, expect } from '@playwright/test'

/**
 * Smoke 02 — fluxo de login
 *
 * Pré-requisito: usuário E2E_USER/E2E_PASS criado no banco com role
 * INTEGRADOR_ADMIN ou CLIENTE_ADMIN.
 */

test.describe('Login', () => {
  test('LoginPage renderiza', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle(/IA Cloud Vision|iaCloud|Login/i)
    await expect(page.getByRole('textbox', { name: /e-?mail/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /senha|password/i })).toBeVisible()
  })

  test('Credencial inválida mostra erro', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('textbox', { name: /e-?mail/i }).fill('naoexiste@iacloud.com.br')
    await page.getByRole('textbox', { name: /senha|password/i }).fill('senhaerrada')
    await page.getByRole('button', { name: /entrar|login/i }).click()
    // tolera variações de mensagem
    await expect(page.locator('body')).toContainText(/inv[áa]lid|incorret|erro/i, { timeout: 8000 })
  })

  test('Credencial válida redireciona para dashboard', async ({ page }) => {
    const user = process.env.E2E_USER
    const pass = process.env.E2E_PASS
    test.skip(!user || !pass, 'Defina E2E_USER e E2E_PASS para rodar este teste')

    await page.goto('/login')
    await page.getByRole('textbox', { name: /e-?mail/i }).fill(user!)
    await page.getByRole('textbox', { name: /senha|password/i }).fill(pass!)
    await page.getByRole('button', { name: /entrar|login/i }).click()

    await expect(page).toHaveURL(/\/(dashboard)?$|^\/[^login]/, { timeout: 10000 })
    // Sidebar deve estar visível (Layout carregado)
    await expect(page.locator('nav, [role="navigation"], aside')).toBeVisible({ timeout: 5000 })
  })
})
