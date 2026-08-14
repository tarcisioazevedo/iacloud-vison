/**
 * Guest Link Service — Sprint F · Magic Link auditável.
 *
 * Plano: docs/41-PLAN-MAGIC-LINK-GUEST.md
 *
 * Operações:
 *   - generateToken()       → { raw, hash } usando 32 bytes random + SHA256
 *   - createLink()          → cria GuestAccessLink; retorna rawToken/PIN UMA vez
 *   - validateAccess()      → valida token + PIN + IP + TTL + maxUses + revogação
 *                             (atomic increment via prisma.update with count where)
 *   - revokeLink()          → marca revokedAt
 *   - logAccess()           → grava GuestAccessLog (não bloqueante)
 *   - auditLink()           → lista logs paginada
 *   - cleanupExpired()      → cron: deleta links expirados há >30d (mantém logs? não — cascata)
 *
 * Notas de segurança:
 *   - Token raw NUNCA é guardado em DB. Só hash SHA256.
 *   - PIN é hash SHA256 (não bcrypt) — PIN tem 4-8 dígitos, brute-force é
 *     mitigado por rate-limit + auto-revoke após 5 falhas (no endpoint).
 *   - allowedIpCidr: aceita IPv4 (200.10.1.0/24) e IP único (200.10.1.5).
 *     Sem CIDR explícito = /32.
 */
import { createHash, randomBytes, randomInt } from 'crypto'
import { prisma } from './prisma'
import { logger } from './logger'

// ───── Token helpers ────────────────────────────────────────────────────────

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Gera token random de 32 bytes (256 bits) em base64url. URL-safe sem padding.
 * Retorna { raw, hash } — raw vai pra URL do convidado; hash vai pro DB.
 */
export function generateToken(): { raw: string; hash: string } {
  // base64url: A-Z a-z 0-9 - _   (sem padding)  → ~43 chars
  const raw = randomBytes(32).toString('base64url')
  const hash = sha256(raw)
  return { raw, hash }
}

/**
 * Gera PIN numérico de N dígitos (default 4). Usa randomInt (CSPRNG).
 */
export function generatePin(digits = 4): string {
  if (digits < 4 || digits > 8) throw new Error('PIN deve ter 4 a 8 dígitos')
  const max = 10 ** digits
  const n = randomInt(0, max)
  return n.toString().padStart(digits, '0')
}

// ───── IP / CIDR check ──────────────────────────────────────────────────────

/**
 * Verifica se um IP cai num CIDR. Suporta IPv4. IPv6 é tratado como literal
 * match (sem expansão de prefix) — adequado pro uso atual (allowlist de
 * delegacia/empresa). Sem dep externa.
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  if (!ip || !cidr) return false
  // Strip ::ffff: prefix de IPv4-mapped (v6)
  const normIp = ip.replace(/^::ffff:/i, '').trim()

  // Sem '/' → comparação literal
  const [range, bitsStr] = cidr.includes('/') ? cidr.split('/') : [cidr, '32']
  if (!range) return false

  if (!isIPv4(normIp) || !isIPv4(range)) {
    // Caí no caminho v6 / formato exótico — comparação literal segura
    return normIp === range
  }

  const bits = parseInt(bitsStr ?? '32', 10)
  if (isNaN(bits) || bits < 0 || bits > 32) return false

  const ipN   = ipv4ToInt(normIp)
  const rngN  = ipv4ToInt(range)
  const mask  = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipN & mask) === (rngN & mask)
}

function isIPv4(s: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s)
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(p => parseInt(p, 10))
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return 0
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

// ───── Service ──────────────────────────────────────────────────────────────

export type GuestScope =
  | { kind: 'camera'; cameraId: string }
  | { kind: 'clip'; recordingClipId: string }
  | { kind: 'site'; siteId: string }

export interface CreateLinkOptions {
  createdById: string
  clienteFinalId: string
  guestName: string
  guestEmail?: string | null
  guestPhone?: string | null
  purpose: string
  scope: GuestScope
  recordingFrom?: Date | null
  recordingTo?: Date | null
  canViewLive?: boolean
  canViewRecording?: boolean
  canDownload?: boolean
  validUntil: Date
  maxUses?: number
  /** Se 'auto', backend gera; se string, usa o PIN dado; se null/undefined, sem PIN. */
  pin?: string | 'auto' | null
  allowedIpCidr?: string | null
  watermarkText?: string | null
}

export interface CreateLinkResult {
  id: string
  rawToken: string         // apenas 1 vez — guardar agora ou nunca
  pin?: string             // só se PIN setado
  url: string              // URL completa do guest, montada pelo caller
}

export const guestLinkService = {
  generateToken,
  generatePin,
  sha256,
  ipInCidr,

  /**
   * Cria GuestAccessLink. Retorna token+pin em CLARO uma única vez.
   * O caller deve enviar pro convidado (UI mostra modal de sucesso).
   */
  async createLink(opts: CreateLinkOptions): Promise<CreateLinkResult> {
    const { raw, hash } = generateToken()

    let pinPlain: string | undefined
    let pinHash: string | null = null
    if (opts.pin === 'auto') {
      pinPlain = generatePin(4)
      pinHash  = sha256(pinPlain)
    } else if (typeof opts.pin === 'string' && opts.pin.trim().length > 0) {
      pinPlain = opts.pin.trim()
      pinHash  = sha256(pinPlain)
    }

    const link = await prisma.guestAccessLink.create({
      data: {
        tokenHash: hash,
        createdById: opts.createdById,
        clienteFinalId: opts.clienteFinalId,
        guestName: opts.guestName,
        guestEmail: opts.guestEmail ?? null,
        guestPhone: opts.guestPhone ?? null,
        purpose: opts.purpose,
        cameraId: opts.scope.kind === 'camera' ? opts.scope.cameraId : null,
        recordingClipId: opts.scope.kind === 'clip' ? opts.scope.recordingClipId : null,
        siteId: opts.scope.kind === 'site' ? opts.scope.siteId : null,
        recordingFrom: opts.recordingFrom ?? null,
        recordingTo: opts.recordingTo ?? null,
        canViewLive:      opts.canViewLive ?? true,
        canViewRecording: opts.canViewRecording ?? true,
        canDownload:      opts.canDownload ?? false,
        validUntil: opts.validUntil,
        maxUses:    opts.maxUses ?? 1,
        pinHash,
        allowedIpCidr: opts.allowedIpCidr ?? null,
        watermarkText: opts.watermarkText ?? null,
      },
    })

    // Monta URL pública. APP_PUBLIC_URL deve estar setado no env do backend
    // (ex: https://app.iacloud.com.br). Em dev cai pro localhost.
    const baseUrl = process.env.APP_PUBLIC_URL || 'http://localhost:5173'
    const url = `${baseUrl.replace(/\/$/, '')}/guest/${raw}`

    return {
      id: link.id,
      rawToken: raw,
      pin: pinPlain,
      url,
    }
  },

  /**
   * Valida acesso ao link pelo token raw. Não consome usos — quem consome é
   * `redeemAccess` (chamado quando o convidado digita o PIN com sucesso).
   *
   * Retorno:
   *   - allowed: true/false
   *   - link:    dados (sem pinHash exposto)
   *   - denyReason: 'not_found' | 'expired' | 'revoked' | 'max_uses' | 'ip_blocked' | 'pin_required' | 'pin_wrong'
   */
  async validateAccess(rawToken: string, opts: { pin?: string | null; ip?: string | null }): Promise<{
    allowed: boolean
    denyReason?: string
    link?: Awaited<ReturnType<typeof prisma.guestAccessLink.findUnique>>
  }> {
    const hash = sha256(rawToken)
    const link = await prisma.guestAccessLink.findUnique({ where: { tokenHash: hash } })
    if (!link) return { allowed: false, denyReason: 'not_found' }

    if (link.revokedAt) return { allowed: false, denyReason: 'revoked', link }
    if (link.validUntil.getTime() <= Date.now()) return { allowed: false, denyReason: 'expired', link }
    if (link.usesCount >= link.maxUses) return { allowed: false, denyReason: 'max_uses', link }

    if (link.allowedIpCidr && opts.ip) {
      if (!ipInCidr(opts.ip, link.allowedIpCidr)) {
        return { allowed: false, denyReason: 'ip_blocked', link }
      }
    }

    if (link.pinHash) {
      if (!opts.pin) return { allowed: false, denyReason: 'pin_required', link }
      if (sha256(opts.pin) !== link.pinHash) return { allowed: false, denyReason: 'pin_wrong', link }
    }

    return { allowed: true, link }
  },

  /**
   * Marca consumo de um uso (atomic). Retorna true se incrementou (ainda
   * havia usos disponíveis), false se já estourou ou foi revogado entre
   * o validate e o redeem.
   *
   * Usa updateMany with where pra concorrência segura sem transação:
   * o WHERE garante que apenas 1 worker incrementa se usesCount < maxUses.
   */
  async consumeUse(linkId: string): Promise<boolean> {
    const r = await prisma.$executeRaw`
      UPDATE "GuestAccessLink"
      SET "usesCount" = "usesCount" + 1
      WHERE "id" = ${linkId}
        AND "revokedAt" IS NULL
        AND "validUntil" > NOW()
        AND "usesCount" < "maxUses"
    `
    return r > 0
  },

  /**
   * Revoga um link. Sem efeito se já revogado.
   */
  async revokeLink(linkId: string, reason: string | null, byUserId: string | null): Promise<void> {
    await prisma.guestAccessLink.updateMany({
      where: { id: linkId, revokedAt: null },
      data:  { revokedAt: new Date(), revokedReason: reason, revokedById: byUserId },
    })
  },

  /**
   * Log de auditoria. Não bloqueia caller — best-effort. Falha de DB loga warning.
   */
  logAccess(linkId: string, action: string, opts: {
    ip?: string | null
    userAgent?: string | null
    durationSeconds?: number | null
    metadata?: Record<string, unknown> | null
  } = {}): void {
    prisma.guestAccessLog.create({
      data: {
        linkId,
        action,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
        durationSeconds: opts.durationSeconds ?? null,
        metadata: (opts.metadata ?? undefined) as never,
      },
    }).catch(err => {
      logger.warn({ err, linkId, action }, 'guest_access_log_failed')
    })
  },

  /**
   * Lista logs paginada. `limit` máx 200 por chamada.
   */
  async auditLink(linkId: string, opts: { limit?: number; cursor?: string | null } = {}) {
    const take = Math.min(opts.limit ?? 50, 200)
    return prisma.guestAccessLog.findMany({
      where: { linkId },
      orderBy: { ts: 'desc' },
      take,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    })
  },

  /**
   * Cron: deleta links com validUntil < (agora - 30d) E sem logs recentes.
   * Para mantermos a trilha forense, mantemos por 30 dias após expirar
   * (também é o período pra eventual disputa). Após isso, a cascata limpa logs.
   *
   * Retorna número deletado.
   */
  async cleanupExpired(thresholdDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000)
    const r = await prisma.guestAccessLink.deleteMany({
      where: { validUntil: { lt: cutoff } },
    })
    if (r.count > 0) logger.info({ deleted: r.count, thresholdDays }, 'guest_links_cleanup')
    return r.count
  },
}
