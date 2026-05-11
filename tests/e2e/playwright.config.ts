import { defineConfig, devices } from '@playwright/test'

/**
 * Smoke E2E — IA Cloud Vision
 *
 * Configurar em CI/local via env:
 *   BASE_URL    — URL da app (ex: https://app.iacloud.com.br ou http://localhost:5173)
 *   E2E_USER    — email do usuário de teste
 *   E2E_PASS    — senha do usuário de teste
 *
 * Em CI usar `vars` (BASE_URL) e `secrets` (E2E_USER/E2E_PASS).
 * Em local: `cp .env.example .env` e preencher.
 */

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,        // login compartilhado; ordem importa
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },          // 412×915, dpr 2.625
      testMatch: '**/12-mobile-responsivo.spec.ts',
    },
    {
      name: 'iphone-14',
      use: { ...devices['iPhone 14'] },         // 390×844, dpr 3
      testMatch: '**/12-mobile-responsivo.spec.ts',
    },
    {
      name: 'ipad',
      use: { ...devices['iPad (gen 7)'] },      // 810×1080, dpr 2
      testMatch: '**/12-mobile-responsivo.spec.ts',
    },
  ],
})
