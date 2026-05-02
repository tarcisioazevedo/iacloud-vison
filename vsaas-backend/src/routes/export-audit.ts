/**
 * Export Audit Routes — auditoria de exportações de mídia.
 *
 * GET /export-audit?cameraId=X&from=ISO&to=ISO&userId=Y → tenant-filtered list
 *
 * Também exporta `recordExport(...)` — helper que outras rotas (snapshot
 * download, recording export, mosaic print) chamam para registrar a ação.
 *
 * Multi-tenant: tenantId resolvido via JWT no momento de gravar e via
 * jwt.clienteFinalId / jwt.integradorId no momento de listar.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, UnauthorizedError } from '../lib/errors'
import type { JwtPayload } from '../middleware/auth'

export const exportAuditRouter = Router()
exportAuditRouter.use(requireAuth)

// =============================================================================
// Helpers de tenant
// =============================================================================

/**
 * Lista de tenantIds que o JWT do usuário pode ver na tabela ExportAudit.
 *
 * - SUPER_ADMIN: vê tudo (retorna null = sem filtro).
 * - clienteFinal direto: somente o próprio tenantId.
 * - integrador: tenantId pode ser o integradorId OU qualquer clienteFinal
 *   pertencente a ele — buscamos os clientesFinais relacionados e
 *   compomos a lista.
 */
async function resolveTenantIdsForRead(jwt: JwtPayload | undefined): Promise<string[] | null> {
  if (!jwt) throw new UnauthorizedError()
  if (jwt.role === 'SUPER_ADMIN') return null
  if (jwt.clienteFinalId) return [jwt.clienteFinalId]
  if (jwt.integradorId) {
    const cfs = await prisma.clienteFinal.findMany({
      where: { integradorId: jwt.integradorId },
      select: { id: true },
    })
    return [jwt.integradorId, ...cfs.map(c => c.id)]
  }
  throw new UnauthorizedError('JWT sem tenant')
}

function resolveTenantIdForWrite(jwt: JwtPayload): string {
  return jwt.clienteFinalId ?? jwt.integradorId ?? jwt.sub ?? 'SUPER_ADMIN'
}

// =============================================================================
// Helper exportado: recordExport(...)
// =============================================================================

export interface RecordExportOptions {
  cameraIds:     string[]
  exportType:    'SNAPSHOT' | 'RECORDING' | 'BULK' | 'MOSAIC' | 'PRINT'
  fromAt?:       Date | null
  toAt?:         Date | null
  fileSizeBytes?: bigint | number | null
  fileCount?:    number
  destination?:  string | null
  certificateId?: string | null
  ipAddress?:    string | null
  userAgent?:    string | null
  userEmail?:    string | null
  metadata?:     Record<string, unknown> | null
}

/**
 * Registra uma exportação. Chame depois que o download/print foi efetivamente
 * entregue pro usuário (ou pelo menos depois de validado e iniciado).
 *
 * Não throws — log+swallow se a query falhar (auditoria nunca deve quebrar
 * o fluxo do usuário).
 */
export async function recordExport(
  tenantId: string,
  userId: string | null | undefined,
  opts: RecordExportOptions,
): Promise<{ id: string } | null> {
  try {
    const sizeBig: bigint | null =
      opts.fileSizeBytes === null || opts.fileSizeBytes === undefined
        ? null
        : typeof opts.fileSizeBytes === 'bigint'
        ? opts.fileSizeBytes
        : BigInt(Math.max(0, Math.floor(opts.fileSizeBytes)))

    const created = await prisma.exportAudit.create({
      data: {
        tenantId,
        userId:        userId ?? null,
        userEmail:     opts.userEmail ?? null,
        cameraIds:     opts.cameraIds,
        fromAt:        opts.fromAt ?? null,
        toAt:          opts.toAt ?? null,
        exportType:    opts.exportType,
        fileSizeBytes: sizeBig,
        fileCount:     opts.fileCount ?? 1,
        destination:   opts.destination ?? null,
        certificateId: opts.certificateId ?? null,
        ipAddress:     opts.ipAddress ?? null,
        userAgent:     opts.userAgent ?? null,
        metadata:      (opts.metadata as any) ?? null,
      },
      select: { id: true },
    })
    return created
  } catch {
    // Auditoria não pode bloquear ação principal — apenas log.
    return null
  }
}

// =============================================================================
// GET /export-audit
// =============================================================================

const ListExportAuditQuery = z.object({
  cameraId:   z.string().uuid().optional(),
  from:       z.string().datetime().optional(),
  to:         z.string().datetime().optional(),
  userId:     z.string().optional(),
  exportType: z.enum(['SNAPSHOT', 'RECORDING', 'BULK', 'MOSAIC', 'PRINT']).optional(),
  limit:      z.coerce.number().int().min(1).max(500).optional(),
})

exportAuditRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!

  const parse = ListExportAuditQuery.safeParse(req.query)
  if (!parse.success) {
    const first = parse.error.errors[0]
    throw new ValidationError(`${first.path.join('.') || 'query'}: ${first.message}`)
  }
  const q = parse.data

  const tenantIds = await resolveTenantIdsForRead(jwt)

  const where: Record<string, unknown> = {
    ...(tenantIds ? { tenantId: { in: tenantIds } } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.exportType ? { exportType: q.exportType } : {}),
    ...(q.cameraId ? { cameraIds: { has: q.cameraId } } : {}),
  }

  if (q.from || q.to) {
    where.createdAt = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to   ? { lte: new Date(q.to) }   : {}),
    }
  }

  const rows = await prisma.exportAudit.findMany({
    where: where as any,
    orderBy: { createdAt: 'desc' },
    take: q.limit ?? 200,
  })

  // BigInt → string
  const out = rows.map(r => ({
    ...r,
    fileSizeBytes: r.fileSizeBytes !== null && r.fileSizeBytes !== undefined
      ? r.fileSizeBytes.toString()
      : null,
  }))

  res.json({ exports: out, total: out.length })
}))

// =============================================================================
// POST /export-audit — endpoint interno (uso direto raro; prefira recordExport)
// =============================================================================

const PostExportAuditSchema = z.object({
  cameraIds:     z.array(z.string()).min(0).max(100),
  exportType:    z.enum(['SNAPSHOT', 'RECORDING', 'BULK', 'MOSAIC', 'PRINT']),
  fromAt:        z.string().datetime().optional().nullable(),
  toAt:          z.string().datetime().optional().nullable(),
  fileSizeBytes: z.union([z.number(), z.string()]).optional().nullable(),
  fileCount:     z.number().int().min(1).max(100000).optional(),
  destination:   z.string().max(500).optional().nullable(),
  certificateId: z.string().uuid().optional().nullable(),
  metadata:      z.record(z.string(), z.any()).optional().nullable(),
})

exportAuditRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const jwt = req.jwtPayload!
  const parse = PostExportAuditSchema.safeParse(req.body)
  if (!parse.success) {
    const first = parse.error.errors[0]
    throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
  }
  const b = parse.data

  const tenantId = resolveTenantIdForWrite(jwt)
  const sizeNum =
    b.fileSizeBytes === null || b.fileSizeBytes === undefined
      ? null
      : typeof b.fileSizeBytes === 'string'
      ? Number(b.fileSizeBytes)
      : b.fileSizeBytes

  const created = await recordExport(tenantId, jwt.sub, {
    cameraIds:     b.cameraIds,
    exportType:    b.exportType,
    fromAt:        b.fromAt ? new Date(b.fromAt) : null,
    toAt:          b.toAt ? new Date(b.toAt) : null,
    fileSizeBytes: sizeNum,
    fileCount:     b.fileCount,
    destination:   b.destination ?? null,
    certificateId: b.certificateId ?? null,
    ipAddress:     req.ip ?? null,
    userAgent:     req.headers['user-agent']?.toString() ?? null,
    userEmail:     null,
    metadata:      (b.metadata as Record<string, unknown> | null | undefined) ?? null,
  })

  res.status(201).json({ ok: true, id: created?.id ?? null })
}))
