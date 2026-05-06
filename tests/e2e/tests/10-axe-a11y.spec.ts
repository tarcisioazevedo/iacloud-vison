import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs } from './_helpers/login'

/**
 * E2E 10 — Acessibilidade WCAG 2.1 AA via axe-core (Hardening Iteração 1).
 *
 * Cobre as páginas premium das Ondas 1-9 que o usuário bate primeiro.
 *
 * Critério de pass: zero violações em regras `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
 * (excluindo a regra `color-contrast` por enquanto — gradientes premium têm contraste
 * intencionalmente abaixo de 7:1 em algumas labels decorativas; auditoria manual
 * de contrastes prioritários fica fora do scope desse spec smoke).
 *
 * Pré-requisito: E2E_USER com role SUPER_ADMIN (acessa todas as rotas).
 * Pula se as envs não estiverem setadas — não bloqueia CI sem ambiente pareado.
 */

const ROUTES_TO_AUDIT: Array<{ path: string; name: string }> = [
  { path: '/',                  name: 'Home / TenantCockpit' },
  { path: '/admin/tenants',     name: 'Cockpit do Fabricante' },
  { path: '/clientes-finais',   name: 'Meus Clientes Finais' },
  { path: '/sites',             name: 'Meus Sites' },
  { path: '/cameras',           name: 'Câmeras' },
  { path: '/live',              name: 'Live' },
  { path: '/audit',             name: 'Auditoria' },
  { path: '/settings',          name: 'Configurações' },
  { path: '/integrador/theme',  name: 'Theme Builder' },
]

const AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

test.describe('Acessibilidade — axe-core WCAG AA', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.E2E_USER, 'Defina E2E_USER e E2E_PASS para rodar')
    await loginAs(page)
  })

  for (const route of ROUTES_TO_AUDIT) {
    test(`${route.name} (${route.path}) — zero violações WCAG AA`, async ({ page }) => {
      await page.goto(route.path)
      // Dá tempo pro SWR/React popular o conteúdo dinâmico antes da varredura
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(500)

      const results = await new AxeBuilder({ page })
        .withTags(AA_TAGS)
        // color-contrast tem falsos positivos sobre gradientes/glassmorphism;
        // auditoria de contraste real será manual e dedicada.
        .disableRules(['color-contrast'])
        .analyze()

      // Imprime detalhes para facilitar debug local
      if (results.violations.length > 0) {
        console.log(`\n  Violações em ${route.path}:`)
        for (const v of results.violations) {
          console.log(`    · [${v.id}] ${v.help} — ${v.nodes.length} ocorrência(s)`)
          console.log(`      ${v.helpUrl}`)
        }
      }

      expect(results.violations, 'Violações de acessibilidade detectadas').toEqual([])
    })
  }
})
