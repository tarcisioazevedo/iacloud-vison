/**
 * AI System Config — chaves globais do sistema gerenciadas pelo SUPER_ADMIN.
 *
 * Persiste em SystemConfig (key/value) com namespace `ai.*`. Reflete na
 * camada genai (reloadGenaiClients) sem precisar restart do backend.
 *
 * Cascata de lookup (em genai.service.ts e ai-agent route):
 *   1. Integrador.geminiApiKeyEnc  — override por tenant
 *   2. SystemConfig "ai.gemini_api_key_enc"  ← este módulo
 *   3. process.env.GEMINI_API_KEY  (fallback estático)
 *   4. /run/secrets/gemini_api_key (fallback estático)
 *
 * Boot: bootstrapAISystemConfig() carrega a chave do DB e chama
 * reloadGenaiClients() — vence sobre env/secret quando presente.
 */

import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { reloadGenaiClients } from './genai.service'

// Namespaces de chave (mantém compatível com outros usos do SystemConfig)
const K_API_KEY_ENC          = 'ai.gemini_api_key_enc'
const K_DEFAULT_MODEL        = 'ai.gemini_default_model'
const K_GENAI_PROMPT_DEFAULT = 'ai.genai_prompt_default'
const K_BRIEFING_KILLSWITCH  = 'ai.briefing_global_killswitch'

export interface AISystemConfig {
  /** Decrypted plaintext key — apenas leitura interna. Nunca devolvido na API. */
  geminiApiKey:            string | null
  geminiDefaultModel:      string | null
  genaiPromptDefault:      string | null
  briefingGlobalKillswitch: boolean
}

async function readKey(key: string): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  return row?.value ?? null
}

async function writeKey(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await prisma.systemConfig.deleteMany({ where: { key } })
    return
  }
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

export async function getAISystemConfig(): Promise<AISystemConfig> {
  const [encKey, model, prompt, kill] = await Promise.all([
    readKey(K_API_KEY_ENC),
    readKey(K_DEFAULT_MODEL),
    readKey(K_GENAI_PROMPT_DEFAULT),
    readKey(K_BRIEFING_KILLSWITCH),
  ])
  return {
    geminiApiKey:             encKey ? decryptSecret(encKey) : null,
    geminiDefaultModel:       model,
    genaiPromptDefault:       prompt,
    briefingGlobalKillswitch: kill === 'true',
  }
}

export interface AISystemConfigPatch {
  /** Set nova chave em claro (será encrypted antes de gravar). */
  geminiApiKey?: string
  /** Remove a chave (volta a usar env/secret fallback). */
  clearGeminiApiKey?: boolean
  geminiDefaultModel?: string | null
  genaiPromptDefault?: string | null
  briefingGlobalKillswitch?: boolean
}

/**
 * Persiste mudanças e recarrega o client Gemini se necessário.
 * Retorna a quantidade de campos alterados.
 */
export async function setAISystemConfig(patch: AISystemConfigPatch): Promise<{ changed: number }> {
  let changed = 0
  let keyChanged = false
  let newKeyPlain: string | null | undefined

  if (patch.clearGeminiApiKey) {
    await writeKey(K_API_KEY_ENC, null)
    changed++
    keyChanged = true
    newKeyPlain = null
  } else if (patch.geminiApiKey) {
    await writeKey(K_API_KEY_ENC, encryptSecret(patch.geminiApiKey))
    changed++
    keyChanged = true
    newKeyPlain = patch.geminiApiKey
  }

  if (patch.geminiDefaultModel !== undefined) {
    await writeKey(K_DEFAULT_MODEL, patch.geminiDefaultModel)
    changed++
  }

  if (patch.genaiPromptDefault !== undefined) {
    await writeKey(K_GENAI_PROMPT_DEFAULT, patch.genaiPromptDefault)
    changed++
  }

  if (patch.briefingGlobalKillswitch !== undefined) {
    await writeKey(K_BRIEFING_KILLSWITCH, patch.briefingGlobalKillswitch ? 'true' : 'false')
    changed++
  }

  // Hot-reload do client Gemini se a chave mudou. Quando limpa, volta ao
  // fallback env/secret — recarregamos com esse valor pra não quebrar IA.
  if (keyChanged) {
    if (newKeyPlain === null) {
      const fallback = process.env.GEMINI_API_KEY?.trim()
        || tryReadFile('/run/secrets/gemini_api_key')
        || null
      reloadGenaiClients(fallback)
    } else if (newKeyPlain) {
      reloadGenaiClients(newKeyPlain)
    }
  }

  return { changed }
}

function tryReadFile(path: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs')
    return fs.readFileSync(path, 'utf-8').trim() || null
  } catch {
    return null
  }
}

/**
 * Bootstrap: chamado no start do backend. Se SystemConfig tem chave Gemini,
 * sobrescreve a inicialização que veio do env/secret (que aconteceu no import
 * do genai.service.ts).
 *
 * Idempotente — pode ser chamado várias vezes.
 */
export async function bootstrapAISystemConfig(): Promise<void> {
  try {
    const cfg = await getAISystemConfig()
    if (cfg.geminiApiKey) {
      reloadGenaiClients(cfg.geminiApiKey)
      logger.info({ source: 'system_config' }, 'genai_key_loaded_from_db')
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'ai_system_config_bootstrap_failed')
  }
}
