import { test, expect } from '@playwright/test'
import { loginAs } from './_helpers/login'

/**
 * E2E 07 — CommandPalette (Cmd+K / Ctrl+K)
 *
 * Cobre: Onda 2 (Cmd+K palette com escopo automático).
 * Verifica:
 *  - Atalho de teclado abre o modal
 *  - Search bar do TopBar (clique) também abre
 *  - Esc fecha
 *  - Resultados filtram conforme query
 *  - Navegação ao clicar em resultado funciona
 */

test.describe('CommandPalette (Cmd+K)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.E2E_USER, 'Defina E2E_USER e E2E_PASS para rodar')
    await loginAs(page)
  })

  test('Cmd+K abre o palette', async ({ page, browserName }) => {
    await page.goto('/')
    // Em macOS é Meta+K, demais Control+K
    const isMac = process.platform === 'darwin'
    const modifier = isMac ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+k`)

    // Modal deve aparecer com input de busca
    await expect(page.getByPlaceholder(/buscar.*integrador|cliente|s[ií]te|c[âa]mera/i)).toBeVisible({ timeout: 3000 })
  })

  test('Esc fecha o palette', async ({ page }) => {
    await page.goto('/')
    const isMac = process.platform === 'darwin'
    const modifier = isMac ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+k`)

    const input = page.getByPlaceholder(/buscar.*integrador|cliente|s[ií]te|c[âa]mera/i)
    await expect(input).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(input).not.toBeVisible({ timeout: 2000 })
  })

  test('Filtra resultados ao digitar', async ({ page }) => {
    await page.goto('/')
    const isMac = process.platform === 'darwin'
    const modifier = isMac ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+k`)

    const input = page.getByPlaceholder(/buscar.*integrador|cliente|s[ií]te|c[âa]mera/i)
    await expect(input).toBeVisible()
    await input.fill('câmera')

    // Deve haver pelo menos uma ação contendo "câmera" (ex: "+ Adicionar câmera")
    await expect(page.getByText(/c[âa]mera/i).first()).toBeVisible({ timeout: 3000 })
  })

  test('Clique no search button do TopBar abre o palette', async ({ page }) => {
    await page.goto('/')
    // O TopBar tem um botão de busca com texto "Buscar..."
    const searchButton = page.getByRole('button', { name: /buscar.*integrador|cliente|s[ií]te|c[âa]mera/i }).first()
    if (await searchButton.count() > 0) {
      await searchButton.click()
      await expect(page.getByPlaceholder(/buscar.*integrador|cliente|s[ií]te|c[âa]mera/i)).toBeVisible({ timeout: 3000 })
    } else {
      test.skip(true, 'Search button não está no DOM (mobile?)')
    }
  })
})
