/**
 * env.ts — Schema central de variáveis de ambiente CRÍTICAS.
 *
 * Objetivo: fail-fast no boot se uma env var essencial estiver faltando ou
 * com formato inválido. Sem isso, um typo em `process.env.JWT_SECERT` passa
 * silencioso e quebra só no primeiro login (descoberto em produção).
 *
 * Escopo: variáveis indispensáveis para o boot funcional (auth, DB, R2).
 * O resto (~180 envs opcionais espalhados) continua sendo lido via
 * `process.env.X` sem validação central — migração incremental se necessário.
 *
 * Uso: importar `env` e ler campos tipados em vez de `process.env.X`:
 *   import { env } from './config/env'
 *   const port = env.PORT
 *
 * Para variáveis NÃO listadas aqui (188 outras), continue usando
 * process.env.X — a validação é opt-in por enquanto.
 *
 * Como rodar a validação no boot:
 *   import { validateEnv } from './config/env'
 *   validateEnv()  // dispara em src/index.ts antes do server.listen
 */
import { z } from 'zod'
import { logger } from '../lib/logger'

const EnvSchema = z.object({
  // ── Runtime ─────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // ── Database ────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // ── Auth ────────────────────────────────────────────────────────────────
  // JWT_SECRET é populado por secrets-bootstrap a partir de /run/secrets/jwt_secret.
  // Comprimento mínimo: 32 bytes = ~256 bits de entropia, padrão HS256.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter >=32 chars (256 bits)'),
  BOX_JWT_SECRET: z.string().min(32).optional(),
  AI_WORKER_SECRET: z.string().min(16).optional(),

  // ── Retenção (defaults sensatos) ────────────────────────────────────────
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(180),
  DETECTION_FRAME_RETENTION_DAYS: z.coerce.number().int().min(0).default(30),

  // ── Background jobs ─────────────────────────────────────────────────────
  BACKGROUND_JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
  R2_EVENT_CONSUMER_DISABLED: z.enum(['true', 'false']).default('false'),

  // ── R2 / Cloudflare (opcional — só fail se feature estiver habilitada) ──
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET_PREFIX: z.string().optional(),
})

export type Env = z.infer<typeof EnvSchema>

let _env: Env | null = null

export function validateEnv(): Env {
  if (_env) return _env
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    logger.fatal({ issues: parsed.error.issues }, 'env_validation_failed')
    // Duplica em stderr cru pra garantir visibilidade humana no boot crash —
    // pino pode estar com transport mal configurado se LOG_LEVEL/etc falharem.
    // eslint-disable-next-line no-console
    console.error('\nFalha ao validar variaveis de ambiente:\n' + issues + '\n')
    throw new Error('env_validation_failed')
  }
  _env = parsed.data
  logger.info(
    {
      nodeEnv: _env.NODE_ENV,
      port: _env.PORT,
      logLevel: _env.LOG_LEVEL,
      auditRetentionDays: _env.AUDIT_RETENTION_DAYS,
      detectionFrameRetentionDays: _env.DETECTION_FRAME_RETENTION_DAYS,
      r2EventConsumerDisabled: _env.R2_EVENT_CONSUMER_DISABLED,
    },
    'env_validated',
  )
  return _env
}

// Acessor lazy: usar `env.X` em vez de `process.env.X` para campos cobertos.
export const env = new Proxy({} as Env, {
  get(_, key: string) {
    if (!_env) validateEnv()
    return (_env as never)[key]
  },
})
