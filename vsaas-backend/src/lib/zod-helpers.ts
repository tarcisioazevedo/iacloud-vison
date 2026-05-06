/**
 * Zod helpers compartilhados para validação de IDs de tenant.
 *
 * Por que existir: o modelo Prisma `Integrador.id` (e outros) usa
 * `@default(uuid())` mas aceita strings arbitrárias na criação. Seeds antigos
 * gravaram IDs no formato legacy `int-iacloud-001`, `cf-acme-shopping`,
 * etc. Endpoints que validavam `z.string().uuid()` rejeitavam esses tenants
 * com erro "Invalid uuid".
 *
 * Convenção:
 *   - tenantIdSchema:    aceita UUID v4 OU slug legacy `int-*`, `cf-*`, etc.
 *   - resourceIdSchema:  igual, mas para Camera/EdgeNode/Site (também podem
 *                        ter sido seedados com slug ex: `cam-loja-01`).
 *
 * Caso o projeto migre para UUIDs estritos no futuro (script de migração que
 * regrava ids), trocar por `z.string().uuid()` aqui propaga em todo lugar.
 */
import { z } from 'zod'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEGACY_SLUG_RE = /^[a-z][a-z0-9-]{1,99}$/i

/**
 * Valida ID de tenant (Integrador ou ClienteFinal). Aceita UUID ou slug
 * legacy (até 100 chars, alfanumérico + hífen).
 */
export const tenantIdSchema = z.string().refine(
  v => UUID_RE.test(v) || LEGACY_SLUG_RE.test(v),
  { message: 'ID inválido (esperado UUID ou slug alfanumérico)' },
)

/** Versão optional do tenantIdSchema. */
export const tenantIdOptional = tenantIdSchema.optional()

/** Versão optional+nullable. */
export const tenantIdNullable = tenantIdSchema.optional().nullable()

/**
 * Valida ID de recurso (Camera/EdgeNode/Site). Mesma regra do tenant —
 * pode ser UUID ou slug legacy.
 */
export const resourceIdSchema = tenantIdSchema
export const resourceIdOptional = tenantIdOptional
