/**
 * Portal Access Token — magic-link helpers (Sprint CF.4).
 *
 * Fluxo:
 *   1. Integrador chama POST /clientes-finais/:id/portal-token
 *      → backend gera plaintext (32 bytes random base64url),
 *        persiste só o SHA-256, devolve plaintext UMA vez no response.
 *   2. Frontend mostra o magic-link `https://<dominio>/portal?token=<plaintext>`
 *      e/ou QR code. Plaintext nunca volta ao integrador depois.
 *   3. Cliente final abre o link → POST /portal/exchange { token }
 *      → backend faz SHA-256(token), busca o registro, valida (não expirou,
 *        não revogado, não usado se singleUse), marca lastUsedAt, devolve
 *        JWT scoped a clienteFinalId com role CLIENTE_VIEWER.
 *
 * Por que SHA-256 e não bcrypt:
 *   - Tokens são randômicos longos (entropia ≥256 bits) — não há ataque
 *     viável de força bruta como em senhas. Hash rápido é OK e mantém o
 *     exchange instantâneo.
 *   - Equivalente em garantia ao que GitHub/Stripe fazem com PATs.
 *
 * Por que base64url e não hex:
 *   - URLs ficam mais curtas (32B → 43 chars vs 64 hex) e copy-paste-safe.
 */
import { createHash, randomBytes } from 'crypto'

/** Bytes aleatórios para o token. 32 bytes = 256 bits de entropia. */
const TOKEN_BYTES = 32

/** TTL default para magic-link (24h). */
export const PORTAL_TOKEN_DEFAULT_TTL_HOURS = 24

/** TTL máximo permitido (7 dias) — evita tokens "eternos" criados por engano. */
export const PORTAL_TOKEN_MAX_TTL_HOURS = 24 * 7

/**
 * Gera um token plaintext URL-safe.
 * Retorna apenas o plaintext — quem chama é responsável por hashear e persistir.
 */
export function generatePortalTokenPlaintext(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * SHA-256 hex do plaintext. Determinístico → safe pra usar como UNIQUE key.
 */
export function hashPortalToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

/**
 * Calcula `expiresAt` a partir do TTL em horas, com clamp em min/max.
 * - min: 1h (não faz sentido emitir token que expira em segundos)
 * - max: PORTAL_TOKEN_MAX_TTL_HOURS
 */
export function computeExpiresAt(ttlHours: number = PORTAL_TOKEN_DEFAULT_TTL_HOURS): Date {
  const clamped = Math.max(1, Math.min(PORTAL_TOKEN_MAX_TTL_HOURS, Math.floor(ttlHours)))
  return new Date(Date.now() + clamped * 3600 * 1000)
}

/**
 * Monta a URL do magic-link a partir do plaintext.
 * Usa `PORTAL_BASE_URL` do env (ex.: "https://app.iacloud.com.br/portal").
 * Em dev, cai pro localhost:5173.
 */
export function buildPortalMagicLink(plaintext: string): string {
  const base = process.env.PORTAL_BASE_URL ?? 'http://localhost:5173/portal'
  // base pode ou não ter query string — usamos URL pra robustez.
  const url = new URL(base)
  url.searchParams.set('token', plaintext)
  return url.toString()
}
