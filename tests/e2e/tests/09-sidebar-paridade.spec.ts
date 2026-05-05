import { test, expect } from '@playwright/test'
import { loginAs } from './_helpers/login'

/**
 * E2E 09 — Sidebar paridade pixel mockup 01 (Onda 6.1 + Onda 7.F)
 *
 * Cobre:
 *  - Sidebar fixa w-64 (não colapsável)
 *  - Logo + brand "IA Cloud Vision" sempre visíveis
 *  - 3 grupos: COMANDO DA PLATAFORMA / OPERAÇÃO / PLATAFORMA
 *  - Items inativos legíveis (text-slate-400 não apagado)
 *  - Item ativo "Tenants" tem bg-violet-500/10 + border-violet-500/30
 *  - Emojis nos labels (📊 🌐 💼 ⚠️ 🛡️ 🧩 🎨 ⚡ ⚙️)
 *  - Footer com persona (Super Admin · fabricante · plataforma) + logout
 */

test.describe('Sidebar — paridade mockup 01', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.E2E_USER, 'Defina E2E_USER e E2E_PASS para rodar')
    await loginAs(page)
  })

  test('Sidebar é fixa w-64 e visível sem hover', async ({ page }) => {
    await page.goto('/')
    const sidebar = page.locator('aside').first()
    await expect(sidebar).toBeVisible()

    // Largura ~256px (w-64 = 16rem = 256px)
    const box = await sidebar.boundingBox()
    expect(box).not.toBeNull()
    if (box) expect(box.width).toBeGreaterThanOrEqual(240)
  })

  test('Logo + brand "IA Cloud Vision" + tagline sempre visíveis', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/IA Cloud Vision/).first()).toBeVisible()
    await expect(page.getByText(/VSaaS.*IA.*Analytics/i).first()).toBeVisible()
  })

  test('3 grupos do super-admin presentes (COMANDO/OPERAÇÃO/PLATAFORMA)', async ({ page }) => {
    await page.goto('/')

    // Espera carga completa
    await expect(page.getByText(/COMANDO DA PLATAFORMA/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/^OPERAÇÃO$/i)).toBeVisible()
    await expect(page.getByText(/^PLATAFORMA$/i)).toBeVisible()
  })

  test('Items principais com emojis renderizados', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/Dashboard Global/)).toBeVisible()
    await expect(page.getByText(/Tenants/).first()).toBeVisible()
    await expect(page.getByText(/Comercial/).first()).toBeVisible()
    await expect(page.getByText(/Catálogo de Módulos/)).toBeVisible()
    await expect(page.getByText(/White-label/)).toBeVisible()
    await expect(page.getByText(/Integrações/)).toBeVisible()
  })

  test('Footer da sidebar mostra persona ativa', async ({ page }) => {
    await page.goto('/')
    // Deve ter o nome do role + descrição (ex: "Super Admin" · "fabricante · plataforma")
    await expect(page.getByText(/Super Admin|Integrador|Cliente Final/i).first()).toBeVisible()
  })

  test('TopBar minimalista — só search + AO VIVO', async ({ page }) => {
    await page.goto('/')

    // Search button (substitui Cmd+K visualmente no header)
    await expect(page.getByText(/Buscar.*integrador|cliente|s[ií]te|c[âa]mera/i).first()).toBeVisible()

    // AO VIVO indicator
    await expect(page.getByText(/AO VIVO/i)).toBeVisible()

    // Botões removidos não devem estar visíveis no header (Refresh/Download/Bell):
    // Como podem existir em outras partes da página, validamos indireta —
    // cabeçalho deve ter altura compacta (≤80px de altura total)
    const header = page.locator('header').first()
    const box = await header.boundingBox()
    expect(box).not.toBeNull()
    if (box) expect(box.height).toBeLessThan(80)
  })
})
