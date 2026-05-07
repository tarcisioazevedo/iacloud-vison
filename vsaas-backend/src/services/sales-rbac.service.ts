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

export async function resolveLevel(
  userId: string,
  screen: string,
  /** Role do JWT — fonte de verdade pra ator da sessão. Sem isso,
   * SUPER_ADMIN/ADMIN_GLOBAL caem em NONE porque o sub deles não está
   * na tabela `User` (tabela própria SuperAdmin), escondendo todas as
   * tabs do Hub Comercial pro fabricante. */
  jwtRole?: string,
): Promise<PermLevel> {
  // 1) Fabricante: ADMIN em tudo, sem hit no DB.
  if (jwtRole === 'SUPER_ADMIN' || jwtRole === 'ADMIN_GLOBAL') return 'ADMIN'

  // 2) Outras roles: User row é o caminho. Se sub não estiver lá (caso de
  // INTEGRADOR_ADMIN cujo id está em Integrador), cai em NONE — Hub Comercial
  // é do fabricante, integrador usa /me/sales-kit.
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
  required: PermLevel = 'VIEW',
  jwtRole?: string,
): Promise<boolean> {
  const lvl = await resolveLevel(userId, screen, jwtRole)
  return RANK[lvl] >= RANK[required]
}

export async function getMyPermissionsMap(
  userId: string,
  jwtRole?: string,
): Promise<Record<string, PermLevel>> {
  const out: Record<string, PermLevel> = {}
  for (const s of SCREENS) {
    out[s] = await resolveLevel(userId, s, jwtRole)
  }
  return out
}
