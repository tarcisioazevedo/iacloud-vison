/**
 * Secrets bootstrap — popula `process.env.X` a partir de `process.env.X_FILE`.
 *
 * Por quê: Docker Swarm secrets ficam montados como arquivo em /run/secrets/<nome>.
 * O padrão é passar `X_FILE: /run/secrets/x` em vez de `X: <plaintext>` pra evitar
 * exposição em `docker inspect`, `docker ps -a -f`, logs do daemon, etc.
 *
 * Esse bootstrap roda 1× no startup do app, ANTES de qualquer import que leia
 * `process.env.X`. Pra cada `X_FILE` presente, lê o arquivo e seta `process.env.X`
 * (se ainda não definido). Resultado: o resto do código continua usando
 * `process.env.JWT_SECRET` normalmente, sem precisar saber se vem de file ou env.
 *
 * Convenção:
 *   X       → valor plaintext (legacy, ainda suportado pra compat)
 *   X_FILE  → caminho pra arquivo contendo o valor (preferido em prod)
 *
 * Precedência: se AMBOS X e X_FILE estão setados, X ganha (não sobrescreve).
 * Isso garante override manual em dev/debug.
 *
 * Importar como o PRIMEIRO import de `src/index.ts`:
 *   import './lib/secrets-bootstrap'
 */
import fs from 'node:fs'

const FILE_SUFFIX = '_FILE'
const loaded: string[] = []
const failed: Array<{ key: string; reason: string }> = []

for (const key of Object.keys(process.env)) {
  if (!key.endsWith(FILE_SUFFIX)) continue
  const baseKey = key.slice(0, -FILE_SUFFIX.length)
  const path = process.env[key]
  if (!path) continue

  // Se a env "base" (sem _FILE) já está setada, não sobrescreve.
  // Permite override manual (ex.: dev com `JWT_SECRET=local-test`) mesmo com
  // JWT_SECRET_FILE apontando pra arquivo.
  if (process.env[baseKey]) continue

  try {
    const value = fs.readFileSync(path, 'utf8').trim()
    if (value) {
      process.env[baseKey] = value
      loaded.push(baseKey)
    } else {
      failed.push({ key: baseKey, reason: `arquivo vazio em ${path}` })
    }
  } catch (err) {
    failed.push({ key: baseKey, reason: (err as Error).message })
  }
}

// Special case: DATABASE_URL / DIRECT_URL — Prisma lê direto da env sem suporte
// nativo a _FILE. Se DATABASE_URL_TEMPLATE + DB_PASSWORD_FILE existem, monta
// a URL final aqui ANTES do Prisma carregar.
//
// Template esperado (placeholder ${DB_PASSWORD} URL-encoded):
//   DATABASE_URL_TEMPLATE: postgresql://icvuser:${DB_PASSWORD}@postgres:5432/iacloudvision
//
// Útil pra evitar duplicar o secret de senha em N lugares e poder rotacionar
// só o arquivo db_password.txt + redeploy.
const dbTemplate = process.env.DATABASE_URL_TEMPLATE
const dbPassword = process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD
if (dbTemplate && dbPassword) {
  const encoded = encodeURIComponent(dbPassword)
  const final = dbTemplate.replace(/\$\{DB_PASSWORD\}/g, encoded)
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = final
    loaded.push('DATABASE_URL (montada via template)')
  }
  if (!process.env.DIRECT_URL && (process.env.DIRECT_URL_TEMPLATE || dbTemplate)) {
    const directTpl = process.env.DIRECT_URL_TEMPLATE ?? dbTemplate
    process.env.DIRECT_URL = directTpl.replace(/\$\{DB_PASSWORD\}/g, encoded)
    loaded.push('DIRECT_URL (montada via template)')
  }
}

// Log resumido (sem revelar VALORES) — útil pra debug de "por que minha env
// não está chegando?". Usa console.log porque o logger ainda não foi importado.
if (loaded.length > 0 || failed.length > 0) {
  // eslint-disable-next-line no-console
  console.log(
    `[secrets-bootstrap] loaded=${loaded.length} (${loaded.join(', ')})` +
    (failed.length > 0
      ? ` · failed=${failed.length} (${failed.map(f => `${f.key}: ${f.reason}`).join('; ')})`
      : ''),
  )
}
