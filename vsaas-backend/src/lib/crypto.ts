/**
 * Criptografia simétrica para campos sensíveis (senhas RTSP/ONVIF, tokens).
 *
 * Esquema: AES-256-GCM
 *   - confidencialidade + autenticidade num único primitivo (resistente a
 *     tampering)
 *   - IV de 12 bytes aleatório por mensagem (recomendação NIST SP 800-38D)
 *   - tag de autenticação de 16 bytes anexada ao ciphertext
 *   - formato de armazenamento: `gcm:v1:<base64(iv|tag|ciphertext)>`
 *
 * Chave: ICV_ENCRYPTION_KEY (32 bytes em hex = 64 chars OU base64).
 * Em ausência (dev), gera uma chave de uso único na memória — alerta no log
 * porque assim os secrets gravados não sobrevivem a restart. Em produção,
 * a chave DEVE vir do secret manager (GCP Secret Manager / KMS).
 *
 * Uso:
 *   const sealed = encryptSecret(plaintext)   // string -> string
 *   const open   = decryptSecret(sealed)      // string -> string | null
 *
 * Ao ler do banco, sempre usar decryptSecret — ele aceita também o formato
 * legado plaintext (devolvendo a string como está) durante a migração.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { logger } from './logger'

const ALGORITHM = 'aes-256-gcm'
const IV_LEN = 12 // 96 bits — padrão GCM
const TAG_LEN = 16 // 128 bits
const PREFIX = 'gcm:v1:'

function loadKey(): Buffer {
  const raw = process.env.ICV_ENCRYPTION_KEY?.trim()
  if (raw && raw.length > 0) {
    // hex (64 chars) ou base64 (44 chars). Prefere hex se bater.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, 'hex')
    }
    try {
      const buf = Buffer.from(raw, 'base64')
      if (buf.length === 32) return buf
    } catch {
      /* fall-through */
    }
    logger.error(
      'ICV_ENCRYPTION_KEY tem formato inválido (esperado 64-char hex OU 32-byte base64). Gerando chave efêmera — segredos NÃO sobreviverão a restart.',
    )
  } else {
    logger.warn(
      'ICV_ENCRYPTION_KEY não configurado. Gerando chave efêmera para DEV. NÃO usar em produção.',
    )
  }
  return randomBytes(32)
}

const KEY = loadKey()

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return ''
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const blob = Buffer.concat([iv, tag, enc]).toString('base64')
  return `${PREFIX}${blob}`
}

/**
 * Decifra um valor.
 *   - Formato `gcm:v1:...` é decifrado e retornado.
 *   - Formato legado (plaintext, antes desta migração) é retornado como veio.
 *   - Erro de autenticação retorna null + log de WARN — DB pode estar
 *     corrompido OU chave foi rotacionada.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return stored ?? null
  if (!stored.startsWith(PREFIX)) {
    // Legado plaintext — pré-migração.
    return stored
  }
  try {
    const blob = Buffer.from(stored.slice(PREFIX.length), 'base64')
    if (blob.length < IV_LEN + TAG_LEN + 1) {
      logger.warn({ len: blob.length }, 'decryptSecret: blob curto demais')
      return null
    }
    const iv = blob.subarray(0, IV_LEN)
    const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
    const enc = blob.subarray(IV_LEN + TAG_LEN)
    const decipher = createDecipheriv(ALGORITHM, KEY, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return dec.toString('utf8')
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'decryptSecret falhou — chave incorreta ou dado corrompido',
    )
    return null
  }
}

/**
 * Mascarar para logs/UI sem expor valor real.
 *   "abc12345" -> "abc1***"
 *   ""         -> ""
 */
export function maskSecret(s: string | null | undefined): string {
  if (!s) return ''
  if (s.startsWith(PREFIX)) return '***encrypted***'
  if (s.length <= 4) return '***'
  return `${s.slice(0, Math.min(4, s.length - 4))}***`
}
