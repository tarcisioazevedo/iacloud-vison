import { test, expect } from '@playwright/test'
import { loginAs } from './_helpers/login'

/**
 * E2E 06 — Tenant Cockpit (super-admin)
 *
 * Cobre: Onda 1 (TreeView drill-down) + Onda 5 (paridade mockup 01) +
 *        Onda 7 (PresenceMap) + Onda 7.E (/ super-admin = TenantCockpit) +
 *        Onda 7.F (sidebar fixa, topbar minimalista).
 *
 * Pré-requisito: E2E_USER deve ter role SUPER_ADMIN ou ADMIN_GLOBAL.
 * Se a env não estiver definida o teste é pulado.
 */

test.describe('Tenant Cockpit — paridade mockup 01', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.E2E_USER, 'Defina E2E_USER e E2E_PASS para rodar')
    await loginAs(page)
  })

  test('Hero "Cockpit do Fabricante" + 4 cards densos visíveis', async ({ page }) => {
    await page.goto('/admin/tenants')

    // Hero
    await expect(page.getByText(/cockpit do fabricante/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/integrador.*cliente/i)).toBeVisible()

    // 4 cards densos (Saúde · Crescimento · Receita · Risco)
    await expect(page.getByText(/sa[úu]de/i).first()).toBeVisible()
    await expect(page.getByText(/crescimento/i).first()).toBeVisible()
    await expect(page.getByText(/receita.*mrr/i).first()).toBeVisible()
    await expect(page.getByText(/risco/i).first()).toBeVisible()
  })

  test('Tabela de integradores tem botão "+ Novo integrador"', async ({ page }) => {
    await page.goto('/admin/tenants')
    await expect(page.getByRole('heading', { name: /integradores/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /novo integrador/i })).toBeVisible()
  })

  test('Drill-down: clicar no chevron expande a árvore inline', async ({ page }) => {
    await page.goto('/admin/tenants')
    // Localiza o primeiro botão de expansão (ícone chevron)
    const firstExpandBtn = page.getByRole('button', { name: /expandir/i }).first()
    if (await firstExpandBtn.count() === 0) {
      test.skip(true, 'Sem integradores para expandir')
    }
    await firstExpandBtn.click()
    // Após expandir, deve aparecer "Hierarquia completa" ou tree view
    await expect(page.getByText(/hierarquia completa|sites?.*box|cliente/i).first()).toBeVisible({ timeout: 5000 })
  })

  test('Mapa de presença geográfica é renderizado', async ({ page }) => {
    await page.goto('/admin/tenants')
    await expect(page.getByText(/presen[çc]a geogr[áa]fica/i)).toBeVisible({ timeout: 8000 })
  })

  test('/ raiz redireciona super-admin para o mesmo cockpit (Onda 7.E)', async ({ page }) => {
    await page.goto('/')
    // Deve mostrar o mesmo conteúdo de /admin/tenants
    await expect(page.getByText(/cockpit do fabricante/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('heading', { name: /integradores/i })).toBeVisible()
  })
})
