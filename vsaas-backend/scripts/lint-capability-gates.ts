#!/usr/bin/env node
/**
 * Linter customizado: garante que TODA rota Express declara `requires()` ou `publicRoute()`.
 *
 * Roda no CI antes do build. Se uma rota nova for adicionada sem declaração,
 * o build quebra com mensagem clara apontando arquivo + linha + rota.
 *
 * Como configurar no package.json:
 *   "scripts": {
 *     "lint:capabilities": "tsx scripts/lint-capability-gates.ts",
 *     "prebuild": "npm run lint:capabilities"
 *   }
 *
 * Como ignorar um arquivo (raro, ex: rotas internas só do edge):
 *   adicione o caminho em IGNORE_FILES abaixo
 *
 * Fonte: docs/32-IMPLEMENTACAO-CAPABILITY-GATING.md (peça 4.F)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const ROUTES_DIR = join(__dirname, '..', 'src', 'routes')
const ROOT = join(__dirname, '..')

// Arquivos ignorados (rotas internas de infra que não devem ter capability check)
const IGNORE_FILES = new Set<string>([
  // Adicione aqui se necessário, ex:
  // 'src/routes/internal/healthcheck.ts',
])

interface Violation {
  file: string
  line: number
  route: string
  context: string
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

function lint(file: string): Violation[] {
  const rel = relative(ROOT, file)
  if (IGNORE_FILES.has(rel)) return []

  const content = readFileSync(file, 'utf8')
  const lines = content.split('\n')
  const violations: Violation[] = []

  // Encontra rotas: router.(get|post|put|patch|delete)('path', ...)
  // Match inicia de \b para evitar pegar customRouter.foo
  const routeRegex = /^\s*\w*[Rr]outer\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(routeRegex)
    if (!m) continue

    // Procura nas próximas 30 linhas (rotas multiline) se tem requires() ou publicRoute()
    const blockEnd = Math.min(i + 30, lines.length)
    const block = lines.slice(i, blockEnd).join(' ')

    const hasGate =
      /\brequires\s*\(/.test(block) ||
      /\bpublicRoute\s*\(\s*\)/.test(block)

    if (!hasGate) {
      violations.push({
        file: rel,
        line: i + 1,
        route: `${m[1].toUpperCase()} ${m[2]}`,
        context: lines[i].trim(),
      })
    }
  }

  return violations
}

function main() {
  const files = findFiles(ROUTES_DIR)
  console.log(`[lint:capabilities] varrendo ${files.length} arquivos em src/routes/...`)

  const allViolations: Violation[] = []
  for (const f of files) allViolations.push(...lint(f))

  if (allViolations.length === 0) {
    console.log(`✓ Capability gates: todas as ${files.length} arquivos OK\n`)
    process.exit(0)
  }

  // Modo SOFT inicial: durante adoção, só warn. Quando o backlog zerar,
  // mudar a env CAPABILITY_LINT_STRICT=true pra falhar o build.
  const strict = (process.env.CAPABILITY_LINT_STRICT || 'false').toLowerCase() === 'true'
  const level = strict ? 'ERRO' : 'AVISO'

  console.error(`\n${strict ? '✗' : '⚠'}  ${level}: ${allViolations.length} rota(s) sem capability gate declarada:\n`)

  // Agrupa por arquivo pra leitura mais fácil
  const byFile = new Map<string, Violation[]>()
  for (const v of allViolations) {
    if (!byFile.has(v.file)) byFile.set(v.file, [])
    byFile.get(v.file)!.push(v)
  }

  for (const [file, vs] of byFile) {
    console.error(`  ${file}`)
    for (const v of vs) {
      console.error(`    L${v.line}: ${v.route}`)
    }
  }

  console.error(`
Toda rota DEVE declarar uma das duas:
  - requires(CAPABILITIES.XYZ)  → se exige subscription
  - publicRoute()                → se é pública/core (login, health, marketplace browse)

Exemplo:
  router.post('/foo',
    requireAuth,
    requires(CAPABILITIES.STORAGE_RECORDING_CONTINUOUS),
    asyncHandler(handler)
  )

Modos:
  CAPABILITY_LINT_STRICT=true → falha o build (use após zerar backlog)
  CAPABILITY_LINT_STRICT=false → só avisa (atual, durante adoção)
`)

  if (strict) process.exit(1)
  // Modo soft: passa
  process.exit(0)
}

main()
