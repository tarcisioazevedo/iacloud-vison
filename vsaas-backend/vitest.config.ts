/**
 * Vitest config — backend
 *
 * Sprint γ-Day1 (2026-05-12): config explícita para evitar scan de
 * /prisma/migrations (permission denied em alguns containers) e ancorar
 * cobertura por padrão.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'prisma/migrations/**',  // sem permissão de scan + não é código fonte
    ],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts', 'src/**/*.spec.ts',
        'src/**/_*.ts',           // scripts ad-hoc (_set-rtmp-key, _wipe-r2)
        'src/index.ts',           // bootstrap
      ],
      thresholds: {
        // Inicial conservador — sobe semana a semana
        lines:      0,
        functions:  0,
        branches:   0,
        statements: 0,
      },
    },
  },
})
