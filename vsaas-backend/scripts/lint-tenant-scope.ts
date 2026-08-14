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
const STRICT_MODE =
  process.env.TENANT_SCOPE_LINT_STRICT === 'true' ||
  process.argv.includes('--strict')

// Exceções revisadas individualmente em 2026-08-14. A linha faz parte da
// chave para que qualquer alteração do código exija uma nova revisão.
const REVIEWED_FINDINGS = new Map<string, string>([
  ['src/routes/approvals.ts:166', 'ADMIN_GLOBAL validado por requestedByUserId; SUPER_ADMIN global'],
  ['src/routes/approvals.ts:185', 'rota exclusiva de SUPER_ADMIN'],
  ['src/routes/approvals.ts:295', 'rota exclusiva de SUPER_ADMIN'],
  ['src/routes/demo-invites.ts:77', 'requireFabricante protege operação global de leads'],
  ['src/routes/demo-invites.ts:200', 'requireFabricante protege operação global de leads'],
  ['src/routes/demo-invites.ts:387', 'requireFabricante protege operação global de convites'],
  ['src/routes/demo-invites.ts:405', 'consulta pública por token criptograficamente aleatório'],
  ['src/routes/demo-invites.ts:446', 'aceite público por token criptograficamente aleatório'],
  ['src/routes/edge-nodes.ts:435', 'guarda SUPER_ADMIN antes da consulta'],
  ['src/routes/edge-nodes.ts:471', 'guarda SUPER_ADMIN antes da consulta'],
  ['src/routes/faces.ts:317', 'canAccessCliente valida ownership antes da mutação'],
  ['src/routes/guest-links.ts:357', 'ensureCanAdminGuestLink valida ownership antes da resposta'],
  ['src/routes/integradores.ts:308', 'integradorRouter exige SUPER_ADMIN'],
  ['src/routes/integradores.ts:418', 'integradorRouter exige SUPER_ADMIN'],
  ['src/routes/integradores.ts:462', 'integradorRouter exige SUPER_ADMIN'],
  ['src/routes/integradores.ts:572', 'integradorRouter exige SUPER_ADMIN'],
  ['src/routes/integradores.ts:730', 'integradorRouter exige SUPER_ADMIN'],
  ['src/routes/integradores.ts:848', 'integradorRouter exige SUPER_ADMIN'],
  ['src/routes/integradores.ts:1013', 'integradorRouter exige SUPER_ADMIN'],
  ['src/routes/integradores.ts:1117', 'integradorRouter exige SUPER_ADMIN'],
  ['src/routes/integradores.ts:1183', 'integradorRouter exige SUPER_ADMIN'],
  ['src/routes/integradores.ts:1303', 'integradorRouter exige SUPER_ADMIN'],
  ['src/routes/integradores.ts:1487', 'integradorId vem do JWT; override só para admin global'],
  ['src/routes/lgpd.ts:201', 'guarda SUPER_ADMIN/DPO antes da consulta'],
  ['src/routes/marketplace.ts:196', 'MarketplaceProduct é catálogo global'],
  ['src/routes/marketplace.ts:476', 'assertCanAccessSubscription valida cliente/integrador'],
  ['src/routes/marketplace.ts:569', 'assertCanAccessSubscription valida cliente/integrador'],
  ['src/routes/marketplace.ts:626', 'assertCanAccessSubscription valida cliente/integrador'],
  ['src/routes/marketplace.ts:688', 'assertCanAccessSubscription valida cliente/integrador'],
  ['src/routes/marketplace.ts:913', 'assertCanAccessSubscription valida cliente/integrador'],
  ['src/routes/marketplace.ts:921', 'MarketplaceProduct é catálogo global'],
  ['src/routes/marketplace.ts:1461', 'MarketplaceProduct é catálogo global'],
  ['src/routes/marketplace.ts:1505', 'chave composta contém integradorId do JWT'],
  ['src/routes/marketplace.ts:1542', 'chave composta contém integradorId do JWT'],
  ['src/routes/marketplace.ts:1938', 'MarketplaceProduct é catálogo global'],
  ['src/routes/marketplace.ts:1945', 'chave composta contém integradorId resolvido do ator'],
  ['src/routes/me-integrador-billing.ts:283', 'produto global; vínculo usa integradorId do JWT'],
  ['src/routes/modules.ts:250', 'guarda SUPER_ADMIN antes da consulta'],
  ['src/routes/modules.ts:277', 'router administrativo restrito a SUPER_ADMIN'],
  ['src/routes/notifications.ts:793', 'assertIntegradorOwnsCliente valida ownership'],
  ['src/routes/notifications.ts:799', 'assertIntegradorOwnsCliente valida ownership'],
  ['src/routes/portal.ts:53', 'endpoint público resolve branding por portalSlug único'],
  ['src/routes/sales.ts:100', 'CRM global com router autenticado e roles comerciais'],
  ['src/routes/sales.ts:378', 'CRM global com router autenticado e roles comerciais'],
  ['src/routes/sales.ts:610', 'LeadScore é entidade global do CRM'],
  ['src/routes/sales.ts:612', 'Lead é entidade global do CRM'],
  ['src/routes/sales.ts:1017', 'SalesUser é entidade global do CRM'],
  ['src/routes/sales.ts:1198', 'configuração protegida por requireSalesScreen'],
  ['src/routes/semantic-rules.ts:219', 'rule já foi filtrada pelas câmeras do ator'],
  ['src/routes/subscription-trials.ts:285', 'MarketplaceProduct é catálogo global'],
  ['src/routes/telegram.ts:190', 'clienteFinalId é derivado do JWT'],
  ['src/routes/timelapse-worker.ts:63', 'router exige AI_WORKER_SECRET'],
  ['src/routes/timelapse-worker.ts:230', 'router exige AI_WORKER_SECRET'],
  ['src/routes/whitelabel.ts:66', 'integradorId vem do JWT; override só para SUPER_ADMIN'],
  ['src/routes/whitelabel.ts:199', 'integradorId vem do JWT; override só para SUPER_ADMIN'],
  ['src/routes/whitelabel.ts:241', 'integradorId vem do JWT; override só para SUPER_ADMIN'],
])
const reviewedFindingsSeen = new Set<string>()

// Arquivos ignorados — rotas que LEGITIMAMENTE não precisam de tenant scope
const IGNORE_FILES = new Set<string>([
  'src/routes/auth.ts',                      // login/refresh — sem tenant ainda
  'src/routes/leads.ts',                     // Lead é global do fabricante
  'src/routes/iacv-box.ts',                  // box auth via license key
  'src/routes/admin-billing-actions.ts',     // SUPER_ADMIN only
  'src/routes/admin-billing-explorer.ts',    // SUPER_ADMIN/ADMIN_GLOBAL cross-tenant explorer
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

    const reviewedKey = `${rel}:${i + 1}`
    if (REVIEWED_FINDINGS.has(reviewedKey)) {
      reviewedFindingsSeen.add(reviewedKey)
      continue
    }

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

  const staleReviews = [...REVIEWED_FINDINGS.keys()]
    .filter(key => !reviewedFindingsSeen.has(key))
  if (staleReviews.length > 0) {
    console.error('\n✗ lint:tenant-scope encontrou exceções revisadas obsoletas:')
    for (const key of staleReviews) console.error(`  ${key}`)
    console.error('Remova ou revise as entradas após confirmar o novo código.\n')
    process.exit(1)
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
  if (STRICT_MODE) {
    process.exit(1)
  }
  console.warn('⚠ TENANT_SCOPE_LINT_STRICT=true bloqueia o build.\n')
  process.exit(0)
}

main()
