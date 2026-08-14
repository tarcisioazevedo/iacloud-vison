/**
 * Mosaics Routes — layouts de live view persistidos no backend.
 *
 * Fonte: docs/42-PLAN-MOSAICOS.md (Onda 1 + Onda 2).
 *
 * Endpoints:
 *   GET    /me/mosaics                → lista visível pro usuário atual
 *   POST   /me/mosaics                → cria (default scope=PRIVATE)
 *   GET    /me/mosaics/:id            → detalhe (com check de visibilidade)
 *   PUT    /me/mosaics/:id            → atualiza
 *   DELETE /me/mosaics/:id            → remove
 *   POST   /me/mosaics/:id/duplicate  → clona como PRIVATE meu
 *
 * Escopo de visibilidade:
 *   - PRIVATE              → só o criador
 *   - CLIENT_SHARED        → todos do mesmo ClienteFinal (requer role CLIENTE_ADMIN
 *                            pra criar/promover)
 *   - INTEGRATOR_TEMPLATE  → templates do integrador (requer role INTEGRADOR_*)
 *
 * Mudança de scope vira AuditLog LIVE_LAYOUT_SCOPE_CHANGED (LGPD-relevante).
 *
 * NB: SUPER_ADMIN tem acesso amplo via filtros tenant — não tem CRUD próprio.
 *     Usuários sem tenant (caso raro) só conseguem PRIVATE.
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, type JwtPayload } from '../middleware/auth'
import { blockReadOnly } from '../middleware/block-read-only'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors'
import { auditAction } from '../lib/audit-helpers'
import { requires } from '../middleware/require-capability'
import { CAPABILITIES } from '../lib/capabilities'
import { LiveLayoutScope } from '@prisma/client'

export const mosaicsRouter = Router()
mosaicsRouter.use(requireAuth)

// =============================================================================
// Schemas (Zod)
// =============================================================================

const GRID_TYPES = ['1x1', '2x2', '3x3', '4x4', '5x5', '6x6', '1+5', '1+7', '1+9'] as const

const SlotSchema = z.object({
  slot:     z.number().int().min(0).max(63),
  cameraId: z.string().uuid().nullable(),
  label:    z.string().max(40).optional(),
})

const CreateLayoutSchema = z.object({
  name:     z.string().min(1).max(80),
  gridType: z.enum(GRID_TYPES),
  slots:    z.array(SlotSchema).max(64),
  scope:    z.nativeEnum(LiveLayoutScope).optional(),
  pinned:   z.boolean().optional(),
})

const UpdateLayoutSchema = CreateLayoutSchema.partial()

// =============================================================================
// Helpers
// =============================================================================

/**
 * Resolve owner-context do JWT pra gravação nos campos clienteFinalId/integradorId
 * do LiveLayout. Permite query eficiente por tenant depois.
 */
function resolveOwnerContext(jwt: JwtPayload): {
  clienteFinalId: string | null
  integradorId:   string | null
} {
  return {
    clienteFinalId: jwt.clienteFinalId ?? null,
    integradorId:   jwt.integradorId   ?? null,
  }
}

/**
 * Verifica se a role pode criar/promover pro scope solicitado.
 * Throws ForbiddenError se não pode.
 */
function assertScopeAllowed(scope: LiveLayoutScope, jwt: JwtPayload): void {
  const role = jwt.role ?? ''

  switch (scope) {
    case 'PRIVATE':
      // Qualquer usuário autenticado pode criar PRIVATE
      return

    case 'CLIENT_SHARED':
      // Precisa ser admin do cliente final E ter clienteFinalId
      if (role !== 'CLIENTE_ADMIN') {
        throw new ForbiddenError('Apenas administradores do cliente podem compartilhar mosaicos com o tenant')
      }
      if (!jwt.clienteFinalId) {
        throw new ForbiddenError('Usuário sem cliente final vinculado não pode usar CLIENT_SHARED')
      }
      return

    case 'INTEGRATOR_TEMPLATE':
      // Precisa ser do integrador
      if (!role.startsWith('INTEGRADOR_')) {
        throw new ForbiddenError('Apenas usuários do integrador podem criar templates')
      }
      if (!jwt.integradorId) {
        throw new ForbiddenError('Usuário sem integrador vinculado não pode usar INTEGRATOR_TEMPLATE')
      }
      return

    default:
      throw new ValidationError(`Escopo desconhecido: ${scope}`)
  }
}

/**
 * Verifica que slots não referenciam câmeras de outro tenant (anti-vazamento).
 *
 * Trade-off: vamos só conferir que TODAS as câmeras citadas pertencem ao
 * cliente final do JWT (ou integrador, se super-admin). UX-side já filtra
 * a biblioteca, mas backend tem que validar contra forge.
 */
async function assertCamerasBelongToTenant(
  cameraIds: string[],
  jwt: JwtPayload,
): Promise<void> {
  if (cameraIds.length === 0) return

  const where: any = { id: { in: cameraIds } }

  // Filtro por tenant — depende do role
  if (jwt.clienteFinalId) {
    where.site = { clienteFinalId: jwt.clienteFinalId }
  } else if (jwt.integradorId) {
    where.site = { clienteFinal: { integradorId: jwt.integradorId } }
  }
  // SUPER_ADMIN não restringe — verifica só que câmeras existem.

  const found = await prisma.camera.count({ where })
  if (found !== cameraIds.length) {
    throw new ForbiddenError('Mosaico referencia câmeras que não pertencem ao seu escopo')
  }
}

/**
 * Visibilidade: que layouts esse JWT consegue ver?
 *
 * - PRIVATE meus
 * - CLIENT_SHARED do meu clienteFinal
 * - INTEGRATOR_TEMPLATE do meu integrador
 */
function visibleLayoutsWhere(jwt: JwtPayload): any {
  const orClauses: any[] = []

  // PRIVATE meus (sempre)
  if (jwt.sub) {
    orClauses.push({ scope: 'PRIVATE', createdById: jwt.sub })
  }

  // CLIENT_SHARED do meu cliente
  if (jwt.clienteFinalId) {
    orClauses.push({ scope: 'CLIENT_SHARED', clienteFinalId: jwt.clienteFinalId })
  }

  // INTEGRATOR_TEMPLATE do meu integrador
  if (jwt.integradorId) {
    orClauses.push({ scope: 'INTEGRATOR_TEMPLATE', integradorId: jwt.integradorId })
  }

  // Integrador também vê templates dos clientes dele? NÃO — clientes só veem
  // os do PRÓPRIO integrador. Integrador admin só vê os templates dele e dos
  // PRIVATE seus.

  if (orClauses.length === 0) {
    // Sem contexto suficiente — não devolve nada (anti-vazamento)
    return { id: '__never__' }
  }

  return { OR: orClauses }
}

/**
 * Verifica que esse layout é visível e modificável pelo usuário.
 * 404 anti-vazamento se não pertence (segue padrão de bookmarks.ts).
 *
 * Editar: só o criador (createdById === jwt.sub).
 * Caso especial: SUPER_ADMIN edita qualquer um (audit log captura).
 */
async function requireLayoutForUser(
  id: string,
  jwt: JwtPayload,
  opts: { mustOwn?: boolean } = {},
) {
  const where = visibleLayoutsWhere(jwt)
  const layout = await prisma.liveLayout.findFirst({
    where: { AND: [{ id }, where] },
  })
  if (!layout) throw new NotFoundError('Mosaico')

  if (opts.mustOwn) {
    const isOwner = layout.createdById === jwt.sub
    const isSuperAdmin = jwt.role === 'SUPER_ADMIN' || jwt.role === 'ADMIN_GLOBAL'
    if (!isOwner && !isSuperAdmin) {
      throw new ForbiddenError('Apenas o criador pode modificar este mosaico')
    }
  }

  return layout
}

// =============================================================================
// GET /me/mosaics
// =============================================================================
//
// Lista todos visíveis pro usuário, agrupados por scope no retorno.
// Sem paginação — assumimos <100 layouts por contexto. Se passar disso,
// adicionar ?limit / ?cursor depois.

mosaicsRouter.get('/',
  requires(CAPABILITIES.CORE_CAMERA_VIEW_LIVE),
  asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const where = visibleLayoutsWhere(jwt)

  const layouts = await prisma.liveLayout.findMany({
    where,
    orderBy: [
      { pinned: 'desc' },
      { updatedAt: 'desc' },
    ],
    take: 200,  // teto duro pra evitar payload absurdo
  })

  res.json({
    count: layouts.length,
    layouts: layouts.map(l => ({
      id:             l.id,
      name:           l.name,
      gridType:       l.gridType,
      slots:          l.slots,
      scope:          l.scope,
      pinned:         l.pinned,
      createdById:    l.createdById,
      clienteFinalId: l.clienteFinalId,
      integradorId:   l.integradorId,
      isOwner:        l.createdById === jwt.sub,
      createdAt:      l.createdAt,
      updatedAt:      l.updatedAt,
    })),
  })
}))

// =============================================================================
// POST /me/mosaics
// =============================================================================

mosaicsRouter.post('/',
  blockReadOnly,
  requires(CAPABILITIES.CORE_CAMERA_VIEW_LIVE),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const body = CreateLayoutSchema.parse(req.body)
    const scope = body.scope ?? 'PRIVATE'

    assertScopeAllowed(scope, jwt)

    const cameraIds = body.slots
      .map(s => s.cameraId)
      .filter((id): id is string => !!id)
    await assertCamerasBelongToTenant(cameraIds, jwt)

    const ownerCtx = resolveOwnerContext(jwt)

    // Para CLIENT_SHARED, exige clienteFinalId (já validado em assertScopeAllowed)
    // Para INTEGRATOR_TEMPLATE, força clienteFinalId=null (template não pertence
    // a cliente específico) e exige integradorId.
    const clienteFinalId = scope === 'INTEGRATOR_TEMPLATE' ? null : ownerCtx.clienteFinalId
    const integradorId   = ownerCtx.integradorId

    const created = await prisma.liveLayout.create({
      data: {
        name:           body.name,
        gridType:       body.gridType,
        slots:          body.slots as any,
        scope,
        pinned:         body.pinned ?? false,
        createdById:    jwt.sub!,
        clienteFinalId,
        integradorId,
      },
    })

    await auditAction(prisma, {
      action:     'LIVE_LAYOUT_CREATED',
      resource:   'LiveLayout',
      resourceId: created.id,
      metadata: {
        name:     created.name,
        scope:    created.scope,
        gridType: created.gridType,
        slots:    body.slots.length,
      },
      req: req as Request,
    })

    res.status(201).json(created)
  })
)

// =============================================================================
// GET /me/mosaics/:id
// =============================================================================

mosaicsRouter.get('/:id',
  requires(CAPABILITIES.CORE_CAMERA_VIEW_LIVE),
  asyncHandler(async (req, res) => {
  const layout = await requireLayoutForUser(req.params.id, req.jwtPayload!)
  res.json({
    ...layout,
    isOwner: layout.createdById === req.jwtPayload!.sub,
  })
}))

// =============================================================================
// PUT /me/mosaics/:id
// =============================================================================

mosaicsRouter.put('/:id',
  blockReadOnly,
  requires(CAPABILITIES.CORE_CAMERA_VIEW_LIVE),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const before = await requireLayoutForUser(req.params.id, jwt, { mustOwn: true })
    const body = UpdateLayoutSchema.parse(req.body)

    // Se mudou scope, valida permissão pro novo scope
    const newScope = body.scope ?? before.scope
    if (newScope !== before.scope) {
      assertScopeAllowed(newScope, jwt)
    }

    // Valida câmeras se slots vieram
    if (body.slots) {
      const cameraIds = body.slots
        .map(s => s.cameraId)
        .filter((id): id is string => !!id)
      await assertCamerasBelongToTenant(cameraIds, jwt)
    }

    const updated = await prisma.liveLayout.update({
      where: { id: req.params.id },
      data: {
        ...(body.name     !== undefined && { name: body.name }),
        ...(body.gridType !== undefined && { gridType: body.gridType }),
        ...(body.slots    !== undefined && { slots: body.slots as any }),
        ...(body.scope    !== undefined && { scope: body.scope }),
        ...(body.pinned   !== undefined && { pinned: body.pinned }),
      },
    })

    // Audit: mudança de scope é LGPD-relevante (expõe câmeras pra mais gente)
    if (newScope !== before.scope) {
      await auditAction(prisma, {
        action:     'LIVE_LAYOUT_SCOPE_CHANGED',
        resource:   'LiveLayout',
        resourceId: updated.id,
        metadata: {
          layoutName: updated.name,
          from:       before.scope,
          to:         newScope,
        },
        req: req as Request,
      })
    } else {
      await auditAction(prisma, {
        action:     'LIVE_LAYOUT_UPDATED',
        resource:   'LiveLayout',
        resourceId: updated.id,
        metadata: { layoutName: updated.name },
        req: req as Request,
      })
    }

    res.json(updated)
  })
)

// =============================================================================
// DELETE /me/mosaics/:id
// =============================================================================

mosaicsRouter.delete('/:id',
  blockReadOnly,
  requires(CAPABILITIES.CORE_CAMERA_VIEW_LIVE),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const layout = await requireLayoutForUser(req.params.id, jwt, { mustOwn: true })

    await prisma.liveLayout.delete({ where: { id: layout.id } })

    await auditAction(prisma, {
      action:     'LIVE_LAYOUT_DELETED',
      resource:   'LiveLayout',
      resourceId: layout.id,
      metadata: { layoutName: layout.name, scope: layout.scope },
      req: req as Request,
    })

    res.status(204).end()
  })
)

// =============================================================================
// POST /me/mosaics/:id/duplicate
// =============================================================================
//
// Clona como PRIVATE meu. Útil pra cliente "pegar emprestado" um
// CLIENT_SHARED ou INTEGRATOR_TEMPLATE e personalizar sem afetar o original.
//
// Nome: "<nome original> (cópia)"
// Slots: copiados como-estão (validados contra tenant de quem clona).

mosaicsRouter.post('/:id/duplicate',
  blockReadOnly,
  requires(CAPABILITIES.CORE_CAMERA_VIEW_LIVE),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const src = await requireLayoutForUser(req.params.id, jwt)  // visível mas não precisa owner

    // Validar câmeras contra o tenant do duplicador (template do integrador
    // pode ter câmeras de outro cliente — filtramos pra não duplicar com
    // câmeras inválidas pro duplicador)
    const srcSlots = (src.slots as any[]) ?? []
    const slotsValid = await Promise.all(srcSlots.map(async (s: any) => {
      if (!s.cameraId) return s
      // Verifica se essa câmera pertence ao tenant — se não, zera o slot
      try {
        await assertCamerasBelongToTenant([s.cameraId], jwt)
        return s
      } catch {
        return { ...s, cameraId: null, label: s.label ?? `(câmera indisponível)` }
      }
    }))

    const ownerCtx = resolveOwnerContext(jwt)
    const newName = src.name.length <= 70 ? `${src.name} (cópia)` : src.name

    const dup = await prisma.liveLayout.create({
      data: {
        name:           newName,
        gridType:       src.gridType,
        slots:          slotsValid as any,
        scope:          'PRIVATE',
        pinned:         false,
        createdById:    jwt.sub!,
        clienteFinalId: ownerCtx.clienteFinalId,
        integradorId:   ownerCtx.integradorId,
      },
    })

    await auditAction(prisma, {
      action:     'LIVE_LAYOUT_DUPLICATED',
      resource:   'LiveLayout',
      resourceId: dup.id,
      metadata: {
        sourceId:   src.id,
        sourceName: src.name,
        sourceScope: src.scope,
      },
      req: req as Request,
    })

    res.status(201).json(dup)
  })
)
