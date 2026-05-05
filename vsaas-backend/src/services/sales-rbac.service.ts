/**
 * Sales RBAC granular — resolve nível de permissão por (user, screen).
 *
 * Hierarquia: NONE < VIEW < EDIT < ADMIN.
 * Resolução:
 *   1) Override individual em SalesPermission(salesUserId, screen) — se houver
 *   2) Default da role em SalesPermission(role, screen)
 *   3) NONE
 *
 * SUPER_ADMIN/ADMIN_GLOBAL sempre ADMIN.
 */
import { prisma } from '../lib/prisma'

export type PermLevel = 'NONE' | 'VIEW' | 'EDIT' | 'ADMIN'

const RANK: Record<PermLevel, number> = { NONE: 0, VIEW: 1, EDIT: 2, ADMIN: 3 }

export const SCREENS = [
  'executive',
  'pipeline',
  'demos',
  'opportunities',
  'activities',
  'team',
  'materials',
  'modules',
  'config',
] as const

export type Screen = (typeof SCREENS)[number]

export async function resolveLevel(userId: string, screen: string): Promise<PermLevel> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  if (!user) return 'NONE'
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN_GLOBAL') return 'ADMIN'

  const su = await prisma.salesUser.findFirst({
    where: { userId, active: true },
    select: { id: true, role: true },
  })
  if (!su) return 'NONE'

  // 1) Override individual
  const override = await prisma.salesPermission.findFirst({
    where: { salesUserId: su.id, screen },
    select: { level: true },
  })
  if (override) return (override.level as PermLevel) || 'NONE'

  // 2) Default da role
  const def = await prisma.salesPermission.findFirst({
    where: { role: su.role as any, screen },
    select: { level: true },
  })
  if (def) return (def.level as PermLevel) || 'NONE'

  return 'NONE'
}

export async function canAccessScreen(
  userId: string,
  screen: string,
  required: PermLevel = 'VIEW'
): Promise<boolean> {
  const lvl = await resolveLevel(userId, screen)
  return RANK[lvl] >= RANK[required]
}

export async function getMyPermissionsMap(userId: string): Promise<Record<string, PermLevel>> {
  const out: Record<string, PermLevel> = {}
  for (const s of SCREENS) {
    out[s] = await resolveLevel(userId, s)
  }
  return out
}
