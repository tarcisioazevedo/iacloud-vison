/**
 * Cliente Prisma com extensão para invalidação automática de cache de capabilities.
 *
 * Sempre que uma ClienteSubscription é criada/atualizada/deletada (em qualquer
 * lugar do código), o cache Redis de capabilities do clienteFinal afetado é
 * invalidado automaticamente. Isso garante que `canUse()` reflita estado real
 * em até 60s (TTL) ou imediatamente se for o cliente que mutou.
 *
 * Fonte: docs/32-IMPLEMENTACAO-CAPABILITY-GATING.md (peça 3)
 */
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  })

/**
 * Hook lazy de invalidação — importado dinâmico pra evitar ciclo
 * (capability-check.ts importa prisma daqui).
 */
async function invalidate(clienteFinalIds: string[]): Promise<void> {
  if (clienteFinalIds.length === 0) return
  try {
    const mod = await import('./capability-check')
    await mod.invalidateCapabilityCacheBulk(clienteFinalIds.filter(Boolean))
  } catch (_) {
    // Cache invalidation é best-effort. TTL de 60s garante convergência.
  }
}

export const prisma = basePrisma.$extends({
  query: {
    clienteSubscription: {
      async create({ args, query }) {
        const result = await query(args)
        if ((result as any)?.clienteFinalId) {
          await invalidate([(result as any).clienteFinalId])
        }
        return result
      },
      async update({ args, query }) {
        const result = await query(args)
        if ((result as any)?.clienteFinalId) {
          await invalidate([(result as any).clienteFinalId])
        }
        return result
      },
      async updateMany({ args, query }) {
        // updateMany não retorna IDs — precisamos buscar antes
        const affected = await basePrisma.clienteSubscription.findMany({
          where: args.where,
          select: { clienteFinalId: true },
        })
        const result = await query(args)
        await invalidate([...new Set(affected.map(a => a.clienteFinalId))])
        return result
      },
      async upsert({ args, query }) {
        const result = await query(args)
        if ((result as any)?.clienteFinalId) {
          await invalidate([(result as any).clienteFinalId])
        }
        return result
      },
      async delete({ args, query }) {
        const before = await basePrisma.clienteSubscription.findUnique({
          where: args.where,
          select: { clienteFinalId: true },
        })
        const result = await query(args)
        if (before?.clienteFinalId) {
          await invalidate([before.clienteFinalId])
        }
        return result
      },
      async deleteMany({ args, query }) {
        const affected = await basePrisma.clienteSubscription.findMany({
          where: args.where,
          select: { clienteFinalId: true },
        })
        const result = await query(args)
        await invalidate([...new Set(affected.map(a => a.clienteFinalId))])
        return result
      },
    },
    marketplaceProduct: {
      // Mudou capabilities de um produto: invalida cache de TODOS os clientes
      // que assinam esse produto. Evento raro (admin op), pode ser custoso.
      async update({ args, query }) {
        const result = await query(args)
        if ((result as any)?.id) {
          const subs = await basePrisma.clienteSubscription.findMany({
            where: { productId: (result as any).id, status: 'ACTIVE' },
            select: { clienteFinalId: true },
          })
          await invalidate([...new Set(subs.map(s => s.clienteFinalId))])
        }
        return result
      },
    },
  },
}) as unknown as PrismaClient  // ← cast: o $extends retorna tipo diferente,
                               //   mas a API runtime é a mesma. Mantém DX existente.

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
