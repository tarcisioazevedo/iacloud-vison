#!/usr/bin/env node
/**
 * Linter customizado B-3a (2026-06-15): proíbe `prisma.<model>.findUnique({
 * where: { id: req.params.id } })` em rotas user-facing sem helper de tenant
 * scope adjacente (cameraTenantWhere / requireCameraForUser /
 * assertCameraBelongsToUser / requireBookmarkForUser / etc.).
 *
 * Motivação: a auditoria 2026-06-15 (docs/SECURITY-AUDIT-2026-06-15.md) achou
 * 5+ IDOR comprovados. Esta lint previne regressão.
 *
 * Como configurar no package.json:
 *   "scripts": {
 *     "lint:tenant-scope": "tsx scripts/lint-tenant-scope.ts",
 *     "prebuild": "npm run lint:capabilities && npm run lint:tenant-scope"
 *   }
 *
 * Pode ser desligado por arquivo via IGNORE_FILES (rotas administrativas
 * intencionalmente cross-tenant — apenas SUPER_ADMIN).
 *
 * Falsos positivos esperados: rotas que usam findUnique com filtros próprios
 * (ex: by-token, by-email). Esses arquivos vão pra IGNORE_FILES.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const ROUTES_DIR = join(__dirname, '..', 'src', 'routes')
const ROOT = join(__dirname, '..')

// Arquivos ignorados — rotas que LEGITIMAMENTE não precisam de tenant scope
const IGNORE_FILES = new Set<string>([
  'src/routes/auth.ts',                      // login/refresh — sem tenant ainda
  'src/routes/leads.ts',                     // Lead é global do fabricante
  'src/routes/iacv-box.ts',                  // box auth via license key
  'src/routes/admin-billing-actions.ts',     // SUPER_ADMIN only
  'src/routes/admin-marketplace.ts',         // SUPER_ADMIN cataloga
  'src/routes/admin-gemini-key.ts',          // SUPER_ADMIN ops
  'src/routes/admin-gemini-callogs.ts',      // SUPER_ADMIN ops
  'src/routes/admin-pricing.ts',             // SUPER_ADMIN ops
  'src/routes/admin-sprites.ts',             // SUPER_ADMIN ops
  'src/routes/admin-notifications.ts',       // SUPER_ADMIN ops
  'src/routes/admin-whitelabel.ts',          // SUPER_ADMIN ops
  'src/routes/admin-alerts.ts',              // SUPER_ADMIN ops
  'src/routes/admin-dashboard.ts',           // SUPER_ADMIN ops
  'src/routes/admin-deal-registration.ts',   // SUPER_ADMIN/FABRICANTE ops
  'src/routes/admin-genai.ts',               // SUPER_ADMIN ops
  'src/routes/admin-health.ts',              // SUPER_ADMIN ops
  'src/routes/admin-integradores-plans.ts',  // SUPER_ADMIN ops
  'src/routes/admin-trials.ts',              // SUPER_ADMIN ops
  'src/routes/internal.ts',                  // chamadas internas (worker, edge)
  'src/routes/internal-mediamtx-auth.ts',    // webhook MediaMTX (não user-facing)
  'src/routes/webhooks-asaas.ts',            // webhook externo (auth via signature)
])

// Padrões que indicam tenant scope adjacente (em janela de ±10 linhas)
const TENANT_HELPERS = [
  'cameraTenantWhere',
  'requireCameraForUser',
  'assertCameraBelongsToUser',
  'requireBookmarkForUser',
  'requireForUser',
  'canUserAccess',
  'isSuperAdmin',
  'tenantWhere',
  'ownerWhere',
  'tenantId:',
  'integradorId:',
  'clienteFinalId:',
]

interface Violation {
  file: string
  line: number
  snippet: string
}

function findFiles(dir: string): string[] {
  const out: string[] = []
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) out.push(...findFiles(full))
      else if (extname(full) === '.ts') out.push(full)
    }
  } catch (_) { /* dir não existe */ }
  return out
}

function checkFile(path: string): Violation[] {
  const rel = relative(ROOT, path)
  if (IGNORE_FILES.has(rel)) return []

  const src = readFileSync(path, 'utf8')
  const lines = src.split('\n')
  const violations: Violation[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Pattern: prisma.<algo>.findUnique({ where: { id: <algo>req.params
    if (!/\.findUnique\s*\(/.test(line)) continue

    // Janela ±10 linhas: precisa conter (1) req.params/req.body AND (2) tenant helper
    const start = Math.max(0, i - 10)
    const end = Math.min(lines.length, i + 10)
    const window = lines.slice(start, end).join('\n')

    // Pula se findUnique é com chave NÃO controlada pelo cliente
    // (ex: req.jwtPayload.sub, jwt.sub, jwt.clienteFinalId, env, const interno)
    const hasUserControlledId =
      /req\.params|req\.body\.[a-zA-Z]+Id|req\.query\.[a-zA-Z]+Id/.test(window) &&
      !/where:\s*\{\s*(id|cameraId|clienteFinalId|integradorId):\s*(jwt|req\.jwtPayload)/.test(window)

    if (!hasUserControlledId) continue

    // Tem helper de tenant scope adjacente?
    const hasTenantGuard = TENANT_HELPERS.some(h => window.includes(h))
    if (hasTenantGuard) continue

    violations.push({
      file: rel,
      line: i + 1,
      snippet: line.trim().slice(0, 120),
    })
  }
  return violations
}

function main() {
  const files = findFiles(ROUTES_DIR)
  let total = 0
  const allViolations: Violation[] = []

  for (const f of files) {
    const vs = checkFile(f)
    allViolations.push(...vs)
    total += vs.length
  }

  if (total === 0) {
    console.log('✓ lint:tenant-scope OK — nenhum findUnique IDOR-vulnerable encontrado')
    process.exit(0)
  }

  console.error(`\n✗ lint:tenant-scope encontrou ${total} possível(eis) IDOR:\n`)
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    ${v.snippet}`)
    console.error('')
  }
  console.error('Como corrigir: troque findUnique({where:{id:req.params.id}}) por')
  console.error('findFirst({where:{id:req.params.id, ...cameraTenantWhere(jwt)}}).')
  console.error('')
  console.error('Falso positivo? Adicione o arquivo em scripts/lint-tenant-scope.ts → IGNORE_FILES')
  console.error('(com comentário explicando por que é seguro).')
  console.error('')

  // STRICT_MODE = bloqueia o build
  if (process.env.TENANT_SCOPE_LINT_STRICT === 'true') {
    process.exit(1)
  }
  console.warn('⚠ TENANT_SCOPE_LINT_STRICT=true bloqueia o build.\n')
  process.exit(0)
}

main()
