/**
 * White-label service — resolução de capabilities por tier.
 *
 * Defaults por tier (sem override):
 *   NONE       → tudo false (sem white-label)
 *   BASIC      → branding apenas
 *   PRO        → branding + domain + pricing + email
 *   ENTERPRISE → PRO + clientCustomization (cascade Modelo D)
 *
 * SUPER_ADMIN edita tier/capabilities via /admin/whitelabel/:integradorId/*.
 * Override granular permite ligar/desligar capability sem mexer no tier.
 *
 * resolveCapabilities() é a fonte da verdade — middleware
 * `requireWhitelabelCapability()` chama essa função.
 */
import { prisma } from '../lib/prisma'

export type WhitelabelTier = 'NONE' | 'BASIC' | 'PRO' | 'ENTERPRISE'

export interface WhitelabelCapabilities {
  branding: boolean
  domain: boolean
  pricing: boolean
  email: boolean
  clientCustomization: boolean
}

const TIER_DEFAULTS: Record<WhitelabelTier, WhitelabelCapabilities> = {
  NONE:       { branding: false, domain: false, pricing: false, email: false, clientCustomization: false },
  BASIC:      { branding: true,  domain: false, pricing: false, email: false, clientCustomization: false },
  PRO:        { branding: true,  domain: true,  pricing: true,  email: true,  clientCustomization: false },
  ENTERPRISE: { branding: true,  domain: true,  pricing: true,  email: true,  clientCustomization: true  },
}

export function defaultCapabilitiesForTier(tier: WhitelabelTier): WhitelabelCapabilities {
  return { ...TIER_DEFAULTS[tier] }
}

// Cache leve (60s) por integradorId
type CacheEntry = { ts: number; tier: WhitelabelTier; caps: WhitelabelCapabilities }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000

export function invalidateCapabilityCache(integradorId: string) {
  cache.delete(integradorId)
}
export function invalidateAllCapabilityCache() {
  cache.clear()
}

export async function resolveCapabilities(
  integradorId: string,
): Promise<{ tier: WhitelabelTier; capabilities: WhitelabelCapabilities }> {
  const cached = cache.get(integradorId)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { tier: cached.tier, capabilities: cached.caps }
  }

  const row = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: { whitelabelTier: true, whitelabelCapabilities: true },
  })

  if (!row) {
    return { tier: 'NONE', capabilities: TIER_DEFAULTS.NONE }
  }

  const tier = row.whitelabelTier as WhitelabelTier
  const defaults = defaultCapabilitiesForTier(tier)
  const overrides = (row.whitelabelCapabilities ?? {}) as Partial<WhitelabelCapabilities>

  const merged: WhitelabelCapabilities = {
    branding: overrides.branding ?? defaults.branding,
    domain: overrides.domain ?? defaults.domain,
    pricing: overrides.pricing ?? defaults.pricing,
    email: overrides.email ?? defaults.email,
    clientCustomization: overrides.clientCustomization ?? defaults.clientCustomization,
  }

  cache.set(integradorId, { ts: Date.now(), tier, caps: merged })
  return { tier, capabilities: merged }
}

export async function hasCapability(
  integradorId: string,
  capability: keyof WhitelabelCapabilities,
): Promise<boolean> {
  const { capabilities } = await resolveCapabilities(integradorId)
  return capabilities[capability]
}
