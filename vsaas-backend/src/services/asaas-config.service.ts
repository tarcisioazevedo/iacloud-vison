/**
 * asaas-config.service — fonte única para credenciais Asaas.
 *
 * Estratégia em camadas (primeiro que retornar valor vence):
 *   1. AsaasGlobalConfig (DB criptografado) — rotação via UI SUPER_ADMIN
 *   2. Docker secret via env (ASAAS_API_KEY, ASAAS_WEBHOOK_SECRET) — fallback
 *
 * Por que essa ordem? Permite rotação a quente via painel sem redeploy.
 * Quando DB cai, o env mantém o serviço vivo (ainda valida webhooks).
 *
 * Cache em memória (10s) pra evitar SELECT a cada request — invalida quando
 * `set*` é chamado.
 */
import { prisma } from '../lib/prisma'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { logger } from '../lib/logger'

const SINGLETON_ID = 'singleton'
const CACHE_TTL_MS = 10_000

interface CachedConfig {
  apiKey:           string | null
  webhookSecret:    string | null
  environment:      'PROD' | 'SANDBOX'
  lastValidatedAt:  Date | null
  lastValidatedOk:  boolean
  lastError:        string | null
  accountName:      string | null
  accountEmail:     string | null
  source:           'db' | 'env'
  fetchedAt:        number
}

let _cache: CachedConfig | null = null

function envFallback(): CachedConfig {
  return {
    apiKey:          process.env.ASAAS_API_KEY ?? null,
    webhookSecret:   process.env.ASAAS_WEBHOOK_SECRET ?? null,
    environment:     (process.env.ASAAS_BASE_URL ?? '').includes('sandbox') ? 'SANDBOX' : 'PROD',
    lastValidatedAt: null,
    lastValidatedOk: false,
    lastError:       null,
    accountName:     null,
    accountEmail:    null,
    source:          'env',
    fetchedAt:       Date.now(),
  }
}

/**
 * Lê config do DB com cache 10s. Se DB vazio, cai no env.
 * Cache evita SELECT em cada request do cliente axios.
 */
export async function getAsaasConfig(opts: { forceReload?: boolean } = {}): Promise<CachedConfig> {
  if (!opts.forceReload && _cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache
  }

  try {
    const row = await prisma.asaasGlobalConfig.findUnique({ where: { id: SINGLETON_ID } })
    if (row) {
      _cache = {
        apiKey:          decryptSecret(row.apiKeyEnc),
        webhookSecret:   decryptSecret(row.webhookSecretEnc),
        environment:     row.environment as 'PROD' | 'SANDBOX',
        lastValidatedAt: row.lastValidatedAt,
        lastValidatedOk: row.lastValidatedOk,
        lastError:       row.lastError,
        accountName:     row.accountName,
        accountEmail:    row.accountEmail,
        source:          'db',
        fetchedAt:       Date.now(),
      }
      return _cache
    }
  } catch (err) {
    logger.warn({ err }, 'asaas_config_db_read_failed')
  }

  _cache = envFallback()
  return _cache
}

/** Invalida cache (chamar após qualquer mutação). */
export function invalidateAsaasConfigCache(): void {
  _cache = null
}

/**
 * Bootstrap: se DB está vazio e env tem ASAAS_API_KEY, popula DB a partir do env.
 * Roda 1× no startup. Idempotente.
 */
export async function bootstrapAsaasConfigFromEnv(): Promise<void> {
  try {
    const existing = await prisma.asaasGlobalConfig.findUnique({ where: { id: SINGLETON_ID } })
    if (existing) return  // já bootstrapped

    const envKey    = process.env.ASAAS_API_KEY
    const envSecret = process.env.ASAAS_WEBHOOK_SECRET
    if (!envKey || !envSecret) {
      logger.info('asaas_config_bootstrap_skipped_no_env')
      return
    }

    const environment = (process.env.ASAAS_BASE_URL ?? '').includes('sandbox') ? 'SANDBOX' : 'PROD'
    await prisma.asaasGlobalConfig.create({
      data: {
        id:               SINGLETON_ID,
        apiKeyEnc:        encryptSecret(envKey),
        webhookSecretEnc: encryptSecret(envSecret),
        environment,
        lastValidatedAt:  null,
        lastValidatedOk:  false,
      },
    })
    logger.info({ environment }, 'asaas_config_bootstrap_from_env_ok')
    invalidateAsaasConfigCache()
  } catch (err) {
    logger.error({ err }, 'asaas_config_bootstrap_failed')
  }
}

export interface RotateKeyResult {
  ok:           boolean
  validatedAt?: Date
  accountName?: string
  accountEmail?: string
  errors?:      Array<{ code: string; description: string }>
}

/**
 * Atualiza API key — valida com /myAccount no Asaas ANTES de persistir.
 * Se a key não funcionar, rollback (DB não é alterado).
 */
export async function rotateApiKey(
  newKey: string,
  environment: 'PROD' | 'SANDBOX',
  actorUserId?: string,
): Promise<RotateKeyResult> {
  if (newKey.length < 16) {
    return { ok: false, errors: [{ code: 'invalid_value', description: 'API key muito curta' }] }
  }

  // Validar contra Asaas antes de salvar
  const axios = (await import('axios')).default
  const baseUrl = environment === 'SANDBOX'
    ? 'https://api-sandbox.asaas.com/v3'
    : 'https://api.asaas.com/v3'
  let accountInfo: { name?: string; email?: string } = {}

  try {
    const r = await axios.get(`${baseUrl}/myAccount`, {
      headers: { access_token: newKey, 'User-Agent': 'IACloudVision/1.0-rotate' },
      timeout: 10_000,
    })
    accountInfo = { name: r.data?.name, email: r.data?.email }
  } catch (err: any) {
    const status = err.response?.status
    const errs = err.response?.data?.errors as Array<{ code: string; description: string }> | undefined
    logger.warn({ status, errs }, 'asaas_rotate_key_validation_failed')
    return {
      ok: false,
      errors: errs?.length ? errs : [{
        code:        'asaas_rejected',
        description: `Asaas rejeitou a chave (HTTP ${status ?? '?'})`,
      }],
    }
  }

  // Validação passou — persiste
  const existing = await prisma.asaasGlobalConfig.findUnique({ where: { id: SINGLETON_ID } })
  const data = {
    apiKeyEnc:        encryptSecret(newKey),
    environment,
    lastValidatedAt:  new Date(),
    lastValidatedOk:  true,
    lastError:        null,
    accountName:      accountInfo.name ?? null,
    accountEmail:     accountInfo.email ?? null,
    updatedById:      actorUserId ?? null,
  }

  if (existing) {
    await prisma.asaasGlobalConfig.update({ where: { id: SINGLETON_ID }, data })
  } else {
    // Primeira execução — precisa webhookSecretEnc obrigatório no schema.
    // Usa env como base; UI deve rotacionar logo em seguida.
    const fallbackSecret = process.env.ASAAS_WEBHOOK_SECRET ?? ''
    await prisma.asaasGlobalConfig.create({
      data: { id: SINGLETON_ID, webhookSecretEnc: encryptSecret(fallbackSecret), ...data },
    })
  }

  invalidateAsaasConfigCache()
  await prisma.asaasConfigAudit.create({
    data: {
      action:      'ROTATE_API_KEY',
      actorUserId: actorUserId ?? null,
      metadata:    {
        environment,
        accountName:  accountInfo.name ?? null,
        accountEmail: accountInfo.email ?? null,
      },
    },
  }).catch(err => logger.warn({ err }, 'asaas_audit_insert_failed'))

  logger.info({
    environment, accountName: accountInfo.name, actorUserId,
  }, 'asaas_api_key_rotated')

  return {
    ok:           true,
    validatedAt:  data.lastValidatedAt,
    accountName:  accountInfo.name,
    accountEmail: accountInfo.email,
  }
}

export async function rotateWebhookSecret(actorUserId?: string): Promise<{ ok: boolean; newSecret: string }> {
  const { randomBytes } = await import('crypto')
  const newSecret = randomBytes(32).toString('hex')

  const existing = await prisma.asaasGlobalConfig.findUnique({ where: { id: SINGLETON_ID } })
  const data = {
    webhookSecretEnc: encryptSecret(newSecret),
    updatedById:      actorUserId ?? null,
  }

  if (existing) {
    await prisma.asaasGlobalConfig.update({ where: { id: SINGLETON_ID }, data })
  } else {
    const fallbackKey = process.env.ASAAS_API_KEY ?? ''
    await prisma.asaasGlobalConfig.create({
      data: {
        id:        SINGLETON_ID,
        apiKeyEnc: encryptSecret(fallbackKey),
        ...data,
      },
    })
  }

  invalidateAsaasConfigCache()
  await prisma.asaasConfigAudit.create({
    data: {
      action:      'ROTATE_WEBHOOK_SECRET',
      actorUserId: actorUserId ?? null,
      metadata:    {},
    },
  }).catch(err => logger.warn({ err }, 'asaas_audit_insert_failed'))

  logger.info({ actorUserId }, 'asaas_webhook_secret_rotated')
  return { ok: true, newSecret }
}

/**
 * Testa conexão atual via /myAccount. Atualiza lastValidated* no DB.
 * Retorna info da conta + status.
 */
export async function testAsaasConnection(): Promise<{
  ok:           boolean
  accountName?: string
  accountEmail?: string
  errors?:      Array<{ code: string; description: string }>
}> {
  const cfg = await getAsaasConfig({ forceReload: true })
  if (!cfg.apiKey) {
    return { ok: false, errors: [{ code: 'no_key', description: 'API key não configurada' }] }
  }
  const axios = (await import('axios')).default
  const baseUrl = cfg.environment === 'SANDBOX'
    ? 'https://api-sandbox.asaas.com/v3'
    : 'https://api.asaas.com/v3'

  let result: { ok: boolean; accountName?: string; accountEmail?: string; errors?: Array<{ code: string; description: string }> }
  let errorMsg: string | null = null
  try {
    const r = await axios.get(`${baseUrl}/myAccount`, {
      headers: { access_token: cfg.apiKey, 'User-Agent': 'IACloudVision/1.0-test' },
      timeout: 10_000,
    })
    result = { ok: true, accountName: r.data?.name, accountEmail: r.data?.email }
  } catch (err: any) {
    const errs = err.response?.data?.errors as Array<{ code: string; description: string }> | undefined
    errorMsg = errs?.[0]?.description ?? `HTTP ${err.response?.status ?? '?'}`
    result = {
      ok: false,
      errors: errs?.length ? errs : [{ code: 'asaas_rejected', description: errorMsg }],
    }
  }

  // Atualiza last validated no DB (best-effort)
  await prisma.asaasGlobalConfig.update({
    where: { id: SINGLETON_ID },
    data: {
      lastValidatedAt: new Date(),
      lastValidatedOk: result.ok,
      lastError:       errorMsg,
      accountName:     result.accountName ?? null,
      accountEmail:    result.accountEmail ?? null,
    },
  }).catch(() => {})

  invalidateAsaasConfigCache()
  return result
}

export const __testables__ = { envFallback }
