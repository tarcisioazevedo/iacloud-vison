/**
 * Floor Plans Routes — Mapa Sinótico (planta baixa com câmeras posicionadas).
 *
 * GET    /floor-plans              → lista plantas do tenant (com _count.cameras)
 * POST   /floor-plans              → criar planta
 * GET    /floor-plans/:id          → detalhe com câmeras posicionadas
 * PATCH  /floor-plans/:id          → atualizar metadados
 * DELETE /floor-plans/:id          → deletar planta
 *
 * PUT    /floor-plans/:id/cameras  → substituição completa das câmeras na planta
 * DELETE /floor-plans/:id/cameras/:cameraId → remover câmera da planta
 *
 * Multi-tenant: FloorPlan.tenantId = clienteFinalId do site associado (ou do
 * usuário autenticado para integradores que criam plantas sem site fixo).
 * Isolamento via join ao site (quando siteId presente) ou comparação direta
 * de tenantId gravado na criação.
 */
import path from 'path'
import fs from 'fs'
import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { requireAuth } from '../middleware/auth'
import { blockReadOnly } from '../middleware/block-read-only'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors'
import type { JwtPayload } from '../middleware/auth'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'floor-plans')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png'
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|bmp|gif|webp)|application\/pdf$/.test(file.mimetype)
    cb(ok ? null : new Error('Tipo não permitido') as any, ok)
  },
})

export const floorPlansRouter = Router()
floorPlansRouter.use(requireAuth)

// =============================================================================
// Helpers de isolamento multi-tenant
// =============================================================================

/**
 * Constrói o filtro Prisma para FloorPlan considerando o tenant do usuário.
 * Segue o mesmo padrão de cameraTenantWhere: join via site→clienteFinal.
 */
function floorPlanTenantWhere(jwt: JwtPayload | undefined): Record<string, unknown> {
  if (!jwt) throw new ForbiddenError('Não autenticado')
  if (jwt.role === 'SUPER_ADMIN') return {}
  if (jwt.clienteFinalId) {
    // Câmeras/sites com clienteFinalId direto OU plantas sem site atribuído
    // mas criadas por este tenant (tenantId = clienteFinalId).
    return {
      OR: [
        { site: { clienteFinalId: jwt.clienteFinalId } },
        { tenantId: jwt.clienteFinalId, siteId: null },
      ],
    }
  }
  if (jwt.integradorId) {
    return {
      OR: [
        { site: { clienteFinal: { integradorId: jwt.integradorId } } },
        { tenantId: jwt.integradorId, siteId: null },
      ],
    }
  }
  throw new ForbiddenError('JWT sem tenant')
}

/**
 * Resolve o tenantId a gravar na criação — string não-nula para qualquer role.
 * Prioridade: clienteFinalId > integradorId > 'SUPER_ADMIN' (apenas em dev).
 */
function resolveTenantId(jwt: JwtPayload): string {
  return jwt.clienteFinalId ?? jwt.integradorId ?? jwt.sub ?? 'SUPER_ADMIN'
}

/**
 * Verifica se o floorPlan pertence ao tenant do usuário.
 * Lança NotFoundError (404, anti-vazamento) se não encontrado ou não autorizado.
 */
async function requireFloorPlanForUser(
  id: string | string[],
  jwt: JwtPayload | undefined,
  options?: { include?: Record<string, unknown> },
) {
  const planId = Array.isArray(id) ? id[0] : id
  if (!jwt) throw new ForbiddenError('Não autenticado')

  const where: Record<string, unknown> = { id: planId, ...floorPlanTenantWhere(jwt) }
  const plan = await prisma.floorPlan.findFirst({
    where: where as any,
    ...(options?.include ? { include: options.include as any } : {}),
  })
  if (!plan) throw new NotFoundError('FloorPlan')
  return plan
}

// =============================================================================
// Schemas (Zod)
// =============================================================================

// Aceita URL absoluta (https://...) OU path relativo interno (/uploads/...)
const imageUrlSchema = z.string().min(1).refine(
  v => v.startsWith('/') || /^https?:\/\//i.test(v),
  { message: 'imageUrl deve ser uma URL ou path relativo válido' },
)

const CreateFloorPlanSchema = z.object({
  name:        z.string().min(1).max(120),
  siteId:      z.string().optional().nullable(),
  imageUrl:    imageUrlSchema,
  imageWidth:  z.number().int().positive().optional().nullable(),
  imageHeight: z.number().int().positive().optional().nullable(),
})

const UpdateFloorPlanSchema = z.object({
  name:        z.string().min(1).max(120).optional(),
  siteId:      z.string().optional().nullable(),
  imageUrl:    imageUrlSchema.optional(),
  imageWidth:  z.number().int().positive().optional().nullable(),
  imageHeight: z.number().int().positive().optional().nullable(),
}).strict()

const FloorPlanCameraItemSchema = z.object({
  cameraId: z.string().min(1),
  xPct:     z.number().min(0).max(100),
  yPct:     z.number().min(0).max(100),
  label:    z.string().max(120).optional().nullable(),
})

const PutCamerasSchema = z.object({
  cameras: z.array(FloorPlanCameraItemSchema).max(200),
})

// =============================================================================
// POST /floor-plans/upload — upload de imagem da planta (retorna imageUrl)
// =============================================================================

floorPlansRouter.post('/upload', requireAuth, upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError('Arquivo não enviado')

  // Serve via /uploads/floor-plans/:filename (configurado no app.ts como estático)
  const imageUrl = `/uploads/floor-plans/${req.file.filename}`

  // Detecta dimensões da imagem se for imagem (não PDF)
  // — dimensões exatas não são críticas; frontend calcula pelo elemento <img>
  res.json({ imageUrl, width: null, height: null })
}))

// =============================================================================
// GET /floor-plans — lista plantas do tenant
// =============================================================================

floorPlansRouter.get('/', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const tenantWhere = floorPlanTenantWhere(jwt)
  const siteId = req.query.siteId as string | undefined

  const where: Record<string, unknown> = {
    ...tenantWhere,
    ...(siteId ? { siteId } : {}),
  }

  const plans = await prisma.floorPlan.findMany({
    where: where as any,
    orderBy: { createdAt: 'desc' },
    select: {
      id:          true,
      name:        true,
      tenantId:    true,
      siteId:      true,
      imageUrl:    true,
      imageWidth:  true,
      imageHeight: true,
      createdAt:   true,
      updatedAt:   true,
      site:        { select: { id: true, name: true, city: true, state: true } },
      _count:      { select: { cameras: true } },
    },
    take: 500,
  })

  res.json({ floorPlans: plans, total: plans.length })
}))

// =============================================================================
// POST /floor-plans — criar planta
// =============================================================================

floorPlansRouter.post('/', blockReadOnly, asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!

  const parse = CreateFloorPlanSchema.safeParse(req.body)
  if (!parse.success) {
    const first = parse.error.errors[0]
    const path = first.path.length ? first.path.join('.') : 'body'
    throw new ValidationError(`${path}: ${first.message}`)
  }
  const b = parse.data

  // Valida que o site (quando fornecido) pertence ao tenant do usuário.
  if (b.siteId) {
    const site = await prisma.site.findFirst({
      where: {
        id: b.siteId,
        ...(jwt.role === 'SUPER_ADMIN'
          ? {}
          : jwt.clienteFinalId
          ? { clienteFinalId: jwt.clienteFinalId }
          : jwt.integradorId
          ? { clienteFinal: { integradorId: jwt.integradorId } }
          : { id: '__no_access__' }),
      },
      select: { id: true },
    })
    if (!site) throw new NotFoundError('Site')
  }

  const tenantId = resolveTenantId(jwt)

  // Limite de 5 mapas sinóticos por site (ou por tenant se sem site)
  const limitWhere = b.siteId
    ? { siteId: b.siteId }
    : { tenantId, siteId: null }
  const existingCount = await prisma.floorPlan.count({ where: limitWhere })
  if (existingCount >= 5) {
    throw new ValidationError(
      b.siteId
        ? 'Limite de 5 mapas sinóticos por site atingido'
        : 'Limite de 5 mapas sinóticos por tenant atingido',
    )
  }

  const plan = await prisma.floorPlan.create({
    data: {
      tenantId,
      siteId:      b.siteId ?? null,
      name:        b.name,
      imageUrl:    b.imageUrl,
      imageWidth:  b.imageWidth ?? null,
      imageHeight: b.imageHeight ?? null,
    },
    include: {
      site:   { select: { id: true, name: true } },
      _count: { select: { cameras: true } },
    },
  })

  res.status(201).json(plan)
}))

// =============================================================================
// GET /floor-plans/:id — detalhe com câmeras posicionadas
// =============================================================================

floorPlansRouter.get('/:id', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!

  const plan = await requireFloorPlanForUser(req.params.id, jwt, {
    include: {
      site:    { select: { id: true, name: true, city: true, state: true } },
      cameras: {
        orderBy: { createdAt: 'asc' },
        include: {
          camera: {
            select: {
              id:          true,
              name:        true,
              status:      true,
              go2rtcStreamId: true,
              lastSnapshotUrl: true,
              lastSnapshotAt: true,
            },
          },
        },
      },
    },
  })

  res.json(plan)
}))

// =============================================================================
// PATCH /floor-plans/:id — atualizar metadados
// =============================================================================

floorPlansRouter.patch('/:id', blockReadOnly, asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!

  const existing = await requireFloorPlanForUser(req.params.id, jwt)

  const parse = UpdateFloorPlanSchema.safeParse(req.body)
  if (!parse.success) {
    throw new ValidationError(parse.error.errors[0]?.message ?? 'Dados inválidos')
  }
  const patch = parse.data

  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Nenhum campo para atualizar')
  }

  // Valida o novo siteId quando fornecido.
  if ('siteId' in patch && patch.siteId) {
    const site = await prisma.site.findFirst({
      where: {
        id: patch.siteId,
        ...(jwt.role === 'SUPER_ADMIN'
          ? {}
          : jwt.clienteFinalId
          ? { clienteFinalId: jwt.clienteFinalId }
          : jwt.integradorId
          ? { clienteFinal: { integradorId: jwt.integradorId } }
          : { id: '__no_access__' }),
      },
      select: { id: true },
    })
    if (!site) throw new NotFoundError('Site')
  }

  const updated = await prisma.floorPlan.update({
    where: { id: (existing as any).id },
    data: patch as any,
    include: {
      site:   { select: { id: true, name: true } },
      _count: { select: { cameras: true } },
    },
  })

  res.json(updated)
}))

// =============================================================================
// DELETE /floor-plans/:id — deletar planta (cascade em FloorPlanCamera via FK)
// =============================================================================

floorPlansRouter.delete('/:id', blockReadOnly, asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!

  const existing = await requireFloorPlanForUser(req.params.id, jwt)

  await prisma.floorPlan.delete({ where: { id: (existing as any).id } })

  res.json({ ok: true })
}))

// =============================================================================
// PUT /floor-plans/:id/cameras — substituição completa das câmeras na planta
// =============================================================================

floorPlansRouter.put('/:id/cameras', blockReadOnly, asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!

  const plan = await requireFloorPlanForUser(req.params.id, jwt)
  const planId = (plan as any).id

  const parse = PutCamerasSchema.safeParse(req.body)
  if (!parse.success) {
    const first = parse.error.errors[0]
    const path = first.path.length ? first.path.join('.') : 'body'
    throw new ValidationError(`${path}: ${first.message}`)
  }
  const { cameras } = parse.data

  // Valida que todas as câmeras fornecidas pertencem ao tenant do usuário.
  if (cameras.length > 0) {
    const cameraIds = cameras.map(c => c.cameraId)
    const cameraWhere: Record<string, unknown> = {
      id: { in: cameraIds },
      active: true,
    }
    if (jwt.role !== 'SUPER_ADMIN') {
      if (jwt.clienteFinalId) {
        cameraWhere.site = { clienteFinalId: jwt.clienteFinalId }
      } else if (jwt.integradorId) {
        cameraWhere.site = { clienteFinal: { integradorId: jwt.integradorId } }
      } else {
        cameraWhere.id = '__no_access__'
      }
    }

    const found = await prisma.camera.findMany({
      where: cameraWhere as any,
      select: { id: true },
    })

    if (found.length !== cameraIds.length) {
      const foundIds = new Set(found.map(c => c.id))
      const missing = cameraIds.filter(id => !foundIds.has(id))
      throw new ValidationError(`Câmeras não encontradas ou sem acesso: ${missing.join(', ')}`)
    }
  }

  // Substituição atômica: delete todas + insert novas na mesma transação.
  await prisma.$transaction([
    prisma.floorPlanCamera.deleteMany({ where: { floorPlanId: planId } }),
    ...(cameras.length > 0
      ? [
          prisma.floorPlanCamera.createMany({
            data: cameras.map(c => ({
              floorPlanId: planId,
              cameraId:    c.cameraId,
              xPct:        c.xPct,
              yPct:        c.yPct,
              label:       c.label ?? null,
            })),
          }),
        ]
      : []),
  ])

  // Retorna a planta atualizada com as câmeras.
  const updated = await prisma.floorPlan.findUnique({
    where: { id: planId },
    include: {
      cameras: {
        orderBy: { createdAt: 'asc' },
        include: {
          camera: {
            select: {
              id:     true,
              name:   true,
              status: true,
            },
          },
        },
      },
      _count: { select: { cameras: true } },
    },
  })

  res.json(updated)
}))

// =============================================================================
// DELETE /floor-plans/:id/cameras/:cameraId — remover câmera da planta
// =============================================================================

floorPlansRouter.delete('/:id/cameras/:cameraId', blockReadOnly, asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!

  const plan = await requireFloorPlanForUser(req.params.id, jwt)
  const planId = (plan as any).id

  const cameraId = Array.isArray(req.params.cameraId) ? req.params.cameraId[0] : req.params.cameraId
  const existing = await prisma.floorPlanCamera.findFirst({
    where: { floorPlanId: planId, cameraId },
    select: { id: true },
  })
  if (!existing) throw new NotFoundError('Câmera na planta')

  await prisma.floorPlanCamera.delete({ where: { id: existing.id } })

  res.json({ ok: true })
}))
