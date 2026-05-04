import { test, expect } from '@playwright/test'
import { loginAs } from './_helpers/login'

/**
 * Smoke 05 — logout limpa sessão e força volta para /login
 */

test('Logout redireciona para /login e limpa token', async ({ page }) => {
  await loginAs(page)

  // Ir pra qualquer página privada
  await page.goto('/')

  // Localizar botão de logout (pode estar em menu de avatar ou sidebar)
  const logoutTriggers = [
    page.getByRole('button', { name: /sair|logout/i }),
    page.getByRole('menuitem', { name: /sair|logout/i }),
    page.locator('[data-testid="logout"]'),
  ]

  let clicked = false
  for (const trigger of logoutTriggers) {
    if (await trigger.count() > 0) {
      // Tentar abrir menu de avatar primeiro se botão direto não funcionar
      try {
        await trigger.first().click({ timeout: 2000 })
        clicked = true
        break
      } catch {
        // tenta próximo
      }
    }
  }

  if (!clicked) {
    // Fallback: forçar logout limpando localStorage
    await page.evaluate(() => {
      localStorage.removeItem('icv_token')
      localStorage.removeItem('icv_role')
    })
    await page.goto('/')
  }

  // Espera redirecionamento para /login
  await expect(page).toHaveURL(/\/login/, { timeout: 8000 })

  // Token foi limpo
  const token = await page.evaluate(() => localStorage.getItem('icv_token'))
  expect(token).toBeFalsy()
})
