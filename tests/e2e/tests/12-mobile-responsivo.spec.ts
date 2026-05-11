import { test, expect } from '@playwright/test'
import { loginAs } from './_helpers/login'

/**
 * Smoke 12 — Responsividade mobile/tablet
 *
 * Executa nos projetos: mobile-chrome, iphone-14, ipad (ver playwright.config.ts).
 * Testa o caminho crítico do usuário final em viewport reduzido:
 *   Login → Dashboard → Live → Cameras → Camera (busca)
 *
 * Não testa stream real — apenas que a UI renderiza sem erros JS e que
 * elementos críticos de mobile (hambúrguer, FAB, grid) estão presentes.
 */

test.beforeEach(async ({ page }) => {
  await loginAs(page)
})

test('Login page não transborda em mobile', async ({ page }) => {
  // Desloga para ver a tela de login limpa
  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  // Não deve haver scroll horizontal (largura do body == viewport)
  const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
  const viewportWidth = page.viewportSize()!.width
  expect(scrollWidth, 'Scroll horizontal na LoginPage').toBeLessThanOrEqual(viewportWidth + 2)
})

test('Dashboard renderiza sem erros JS em mobile', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  await page.goto('/')
  await page.waitForTimeout(2000)

  expect(errors, `Erros JS: ${errors.join(' | ')}`).toHaveLength(0)
})

test('Hambúrguer aparece e abre sidebar em mobile', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const vw = page.viewportSize()!.width

  if (vw < 768) {
    // Mobile: hambúrguer deve estar visível
    const hamburger = page.getByRole('button', { name: /abrir menu/i })
    await expect(hamburger).toBeVisible()

    // Clicar abre o drawer
    await hamburger.click()
    // Sidebar com link de navegação deve aparecer
    await expect(page.getByRole('link', { name: /câmeras|dashboard|ao vivo/i }).first()).toBeVisible()
  } else {
    // Tablet/desktop: sidebar já visível sem hambúrguer
    await expect(page.getByRole('navigation').first()).toBeVisible()
  }
})

test('LivePage renderiza sem erros JS e sem scroll horizontal', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  await page.goto('/live')
  await page.waitForTimeout(3000)

  expect(errors, `Erros JS: ${errors.join(' | ')}`).toHaveLength(0)

  const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
  const viewportWidth = page.viewportSize()!.width
  expect(scrollWidth, 'Scroll horizontal na LivePage').toBeLessThanOrEqual(viewportWidth + 2)
})

test('LivePage em mobile: FAB de câmera visível', async ({ page }) => {
  const vw = page.viewportSize()!.width
  if (vw >= 768) test.skip() // FAB só aparece em mobile

  await page.goto('/live')
  await page.waitForTimeout(2000)

  const fab = page.getByRole('button', { name: /câmera/i }).last()
  await expect(fab).toBeVisible()
})

test('LivePage em mobile: grid máximo 2 colunas', async ({ page }) => {
  const vw = page.viewportSize()!.width
  if (vw >= 768) test.skip()

  await page.goto('/live')
  await page.waitForTimeout(2000)

  // O grid do mosaico nunca deve ter mais de 2 colunas em mobile
  const cols = await page.evaluate(() => {
    const grid = document.querySelector('[id="live-mosaic-root"] .grid')
    if (!grid) return 0
    return getComputedStyle(grid).gridTemplateColumns.split(' ').length
  })

  expect(cols, 'Grid com mais de 2 colunas em mobile').toBeLessThanOrEqual(2)
})

test('Cameras page renderiza sem scroll horizontal', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  await page.goto('/cameras')
  await page.waitForTimeout(2000)

  expect(errors, `Erros JS: ${errors.join(' | ')}`).toHaveLength(0)

  const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
  const viewportWidth = page.viewportSize()!.width
  expect(scrollWidth, 'Scroll horizontal em CamerasPage').toBeLessThanOrEqual(viewportWidth + 2)
})

test('Dashboard não tem scroll horizontal', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(2000)

  const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
  const viewportWidth = page.viewportSize()!.width
  expect(scrollWidth, 'Scroll horizontal no Dashboard').toBeLessThanOrEqual(viewportWidth + 2)
})

test('Settings page renderiza sem erros JS', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  await page.goto('/settings')
  await page.waitForTimeout(2000)

  expect(errors, `Erros JS: ${errors.join(' | ')}`).toHaveLength(0)
})
