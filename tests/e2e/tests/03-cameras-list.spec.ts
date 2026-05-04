import { test, expect } from '@playwright/test'
import { loginAs } from './_helpers/login'

/**
 * Smoke 03 — lista de câmeras carrega após login
 */

test.beforeEach(async ({ page }) => {
  await loginAs(page)
})

test('Página /cameras lista câmeras (ou estado vazio claro)', async ({ page }) => {
  await page.goto('/cameras')
  await expect(page).toHaveURL(/\/cameras/)

  // Se houver câmeras, espera ver pelo menos um card. Senão, ver empty state.
  const cards = page.locator('[data-testid="camera-card"], article, .camera-card')
  const empty = page.locator('text=/sem c[âa]meras|nenhuma c[âa]mera|adicione/i')

  await Promise.race([
    cards.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => null),
    empty.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => null),
  ])

  const hasCards = await cards.count()
  const hasEmpty = await empty.count()
  expect(hasCards + hasEmpty).toBeGreaterThan(0)
})
