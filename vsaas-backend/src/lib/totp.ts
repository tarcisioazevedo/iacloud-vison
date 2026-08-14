/**
 * TOTP RFC 6238 — implementação sem dependências externas.
 *
 * Compatível com Google Authenticator, Authy, 1Password, Microsoft Authenticator
 * e qualquer cliente TOTP padrão.
 *
 * Configuração default:
 *   - SHA1 (compatibilidade máxima — Google Authenticator)
 *   - 6 dígitos
 *   - Step de 30 segundos
 *   - Tolerância ±1 step (30s passados/futuros) — reduz falso negativo por clock drift
 *
 * Secret: 32 chars base32 = 160 bits (mesmo que Google usa)
 *
 * Fluxo:
 *   1. Backend: generateSecret() → { secret, otpauthUrl }
 *   2. Frontend: renderiza QR a partir de otpauthUrl (lib qrcode.react)
 *   3. User: escaneia QR no app
 *   4. User: digita código de 6 dígitos
 *   5. Backend: verify(secret, code) → boolean
 *   6. Se OK: persiste secret cifrado em User.totpSecret + User.totpEnabledAt = now
 *
 * Sprint C · docs/40-PLAN-GESTAO-USUARIOS.md
 */
import { createHmac, randomBytes } from 'node:crypto'

const STEP_SECONDS = 30
const DIGITS = 6
const TOLERANCE_STEPS = 1  // ±1 step de tolerância

// ── Base32 (RFC 4648) sem dependência ───────────────────────────────────────
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]
    bits += 8
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += B32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(str: string): Buffer {
  const cleaned = str.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (let i = 0; i < cleaned.length; i++) {
    const idx = B32_ALPHABET.indexOf(cleaned[i])
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/**
 * Gera secret base32 + URL otpauth pra QR code.
 *
 * @param accountName Email do user (aparece no app)
 * @param issuer Nome do app/empresa (aparece no app — "VSaaS")
 */
export function generateTotpSecret(accountName: string, issuer = 'VSaaS'): {
  secret: string
  otpauthUrl: string
} {
  const buf = randomBytes(20)  // 160 bits = padrão Google
  const secret = base32Encode(buf).replace(/=+$/, '')

  // RFC 6238 otpauth URI
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`
  const otpauthUrl = `otpauth://totp/${label}?${params.toString()}`

  return { secret, otpauthUrl }
}

/**
 * Gera o código TOTP atual baseado em secret + timestamp (para teste).
 */
export function generateTotpCode(secret: string, atUnixSeconds?: number): string {
  const now = atUnixSeconds ?? Math.floor(Date.now() / 1000)
  const counter = Math.floor(now / STEP_SECONDS)
  return computeHotp(secret, counter)
}

/**
 * Verifica código TOTP. Aceita ±TOLERANCE_STEPS de tolerância pra clock drift.
 *
 * @returns true se código está dentro da janela
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  if (!code || code.length !== DIGITS || !/^\d+$/.test(code)) return false
  const cleaned = code.replace(/\D/g, '')
  if (cleaned.length !== DIGITS) return false

  const now = Math.floor(Date.now() / 1000)
  const baseCounter = Math.floor(now / STEP_SECONDS)

  for (let offset = -TOLERANCE_STEPS; offset <= TOLERANCE_STEPS; offset++) {
    const counter = baseCounter + offset
    if (computeHotp(secret, counter) === cleaned) return true
  }
  return false
}

/**
 * HOTP (RFC 4226) — base do TOTP. Counter é o "time step".
 */
function computeHotp(secret: string, counter: number): string {
  const key = base32Decode(secret)

  // Counter como 8 bytes big-endian
  const counterBuf = Buffer.alloc(8)
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = counter & 0xff
    counter = Math.floor(counter / 256)
  }

  const hmac = createHmac('sha1', key).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  const code = (binary % Math.pow(10, DIGITS)).toString().padStart(DIGITS, '0')
  return code
}

/**
 * Gera N backup codes (recuperação se perder telefone).
 * Cada code: 8 dígitos numéricos. Single-use (verificar contra hash + remover).
 */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const buf = randomBytes(4)
    const num = buf.readUInt32BE(0) % 100_000_000
    codes.push(num.toString().padStart(8, '0'))
  }
  return codes
}
