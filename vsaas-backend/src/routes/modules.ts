/**
 * Módulos Routes — Gerenciamento de funcionalidades por nível de tenant
 *
 * SuperAdmin:
 *   GET  /modules/catalog                        → catálogo completo de módulos
 *   GET  /modules/admin/integradores             → todos integradores + módulos ativos
 *   GET  /modules/admin/integradores/:id         → módulos de um integrador
 *   PUT  /modules/admin/integradores/:id         → atualiza módulos de um integrador
 *
 * Integrador (autenticado):
 *   GET  /modules/me                             → meus módulos (concedidos pelo admin)
 *   GET  /modules/clientes                       → todos clientes + módulos ativos
 *   GET  /modules/clientes/:clienteFinalId       → módulos de um cliente final
 *   PUT  /modules/clientes/:clienteFinalId       → atualiza módulos de um cliente
 *
 * Qualquer autenticado:
 *   GET  /modules/effective                      → módulos efetivos do usuário atual
 */
import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'

export const modulesRouter = Router()
modulesRouter.use(requireAuth)

// ─── Catálogo de Módulos ──────────────────────────────────────────────────────

export const MODULE_CATALOG = [
  {
    id: 'FACE_ANNOTATION',
    name: 'Anotação Facial',
    description: 'Detecta emoções (alegria, tristeza, raiva, surpresa), acessórios (chapéu, óculos) e características faciais anônimas.',
    category: 'vision_api',
    tier: 'STATIC_VISION',
    icon: 'Smile',
    color: 'violet',
    gcpCost: 'R$ 0,004/imagem',
    verticals: ['RETAIL', 'SHOPPING_MALL', 'HOSPITALITY'],
  },
  {
    id: 'LABEL_DETECTION',
    name: 'Detecção de Etiquetas',
    description: 'Identifica categorias de roupas, itens carregados, cenários e objetos na cena com scores de confiança.',
    category: 'vision_api',
    tier: 'STATIC_VISION',
    icon: 'Tag',
    color: 'cyan',
    gcpCost: 'R$ 0,003/imagem',
    verticals: ['RETAIL', 'LOGISTICS', 'INDUSTRIAL'],
  },
  {
    id: 'LOGO_DETECTION',
    name: 'Detecção de Logos',
    description: 'Reconhece marcas e logotipos em sacolas, embalagens e roupas — útil para medir eficácia de campanhas.',
    category: 'vision_api',
    tier: 'STATIC_VISION',
    icon: 'Award',
    color: 'amber',
    gcpCost: 'R$ 0,003/imagem',
    verticals: ['RETAIL', 'SHOPPING_MALL'],
  },
  {
    id: 'OBJECT_LOCALIZATION',
    name: 'Localização de Objetos',
    description: 'Detecta e localiza objetos específicos com bounding boxes normalizadas (carrinhos, mochilas, veículos).',
    category: 'vision_api',
    tier: 'STATIC_VISION',
    icon: 'Crosshair',
    color: 'emerald',
    gcpCost: 'R$ 0,004/imagem',
    verticals: ['LOGISTICS', 'INDUSTRIAL', 'PARKING'],
  },
  {
    id: 'SAFE_SEARCH',
    name: 'Safe Search',
    description: 'Detecta conteúdo impróprio, violência e material sensível — moderação automática de imagens.',
    category: 'vision_api',
    tier: 'STATIC_VISION',
    icon: 'Shield',
    color: 'rose',
    gcpCost: 'R$ 0,002/imagem',
    verticals: ['SCHOOL', 'HEALTHCARE', 'OFFICE'],
  },
  {
    id: 'PEOPLE_COUNTING',
    name: 'Contagem de Pessoas',
    description: 'Contagem local via YOLOv8 no Edge Node — sem custo de API, sem latência de nuvem.',
    category: 'edge',
    tier: 'STATIC_VISION',
    icon: 'Users',
    color: 'cyan',
    gcpCost: 'Gratuito (Edge)',
    verticals: ['RETAIL', 'SHOPPING_MALL', 'SCHOOL', 'OFFICE', 'CONDOMINIUM'],
  },
  {
    id: 'OCCUPANCY_ANALYTICS',
    name: 'Analytics de Ocupação',
    description: 'Contagem em tempo real, dwell time, mapas de calor e alertas de lotação via Vertex AI Vision Streaming.',
    category: 'vertex',
    tier: 'STREAMING_ANALYTICS',
    icon: 'Activity',
    color: 'violet',
    gcpCost: 'R$ 0,80/hora de stream',
    verticals: ['SHOPPING_MALL', 'OFFICE', 'HOSPITALITY', 'LOGISTICS'],
  },
  {
    id: 'PPE_DETECTION',
    name: 'Detecção de EPI',
    description: 'Auditoria automática de EPIs: capacete, colete, luvas, máscara, óculos de proteção.',
    category: 'vertex',
    tier: 'STREAMING_ANALYTICS',
    icon: 'ShieldCheck',
    color: 'emerald',
    gcpCost: 'R$ 1,20/hora de stream',
    verticals: ['INDUSTRIAL', 'LOGISTICS', 'BANK', 'HEALTHCARE'],
  },
  {
    id: 'VEHICLE_DETECTION',
    name: 'Detecção de Veículos',
    description: 'Identifica e conta veículos (carros, motos, caminhões) com classificação por tipo.',
    category: 'edge',
    tier: 'STATIC_VISION',
    icon: 'Truck',
    color: 'amber',
    gcpCost: 'Gratuito (Edge)',
    verticals: ['PARKING', 'LOGISTICS', 'CONDOMINIUM'],
  },
  {
    id: 'CROWD_DENSITY',
    name: 'Densidade de Multidão',
    description: 'Estimativa de densidade e risco de aglomeração, com alertas automáticos por limiar.',
    category: 'edge',
    tier: 'STATIC_VISION',
    icon: 'Users2',
    color: 'rose',
    gcpCost: 'Gratuito (Edge)',
    verticals: ['SHOPPING_MALL', 'SCHOOL', 'HOSPITALITY', 'ENTERPRISE'],
  },
  {
    id: 'QUEUE_LENGTH',
    name: 'Comprimento de Fila',
    description: 'Mede tamanho de filas em caixas, portas e atendimentos — alerta quando supera limiar.',
    category: 'edge',
    tier: 'STATIC_VISION',
    icon: 'AlignJustify',
    color: 'amber',
    gcpCost: 'Gratuito (Edge)',
    verticals: ['RETAIL', 'BANK', 'HEALTHCARE'],
  },
] as const

const ALL_MODULE_IDS = MODULE_CATALOG.map(m => m.id) as string[]

// ─── Schema de validação ──────────────────────────────────────────────────────

const UpdateModulesSchema = z.object({
  modules: z.array(z.object({
    module:  z.enum(ALL_MODULE_IDS as [string, ...string[]]),
    enabled: z.boolean(),
  })),
})

// ─── GET /modules/catalog ─────────────────────────────────────────────────────

modulesRouter.get('/catalog', (_req, res) => {
  res.json(MODULE_CATALOG)
})

// ─── GET /modules/effective — módulos efetivos do usuário atual ───────────────

modulesRouter.get('/effective', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jwt = req.jwtPayload!
    const { role, integradorId, clienteFinalId } = jwt

    if (role === 'SUPER_ADMIN') {
      // SuperAdmin tem acesso a tudo
      return res.json({ modules: ALL_MODULE_IDS, source: 'super_admin' })
    }

    if (integradorId) {
      const mods = await prisma.integradorModule.findMany({
        where: { integradorId, enabled: true },
      })
      return res.json({
        modules: mods.map(m => m.module),
        source: 'integrador',
      })
    }

    if (clienteFinalId) {
      const mods = await prisma.clienteFinalModule.findMany({
        where: { clienteFinalId, enabled: true },
      })
      return res.json({
        modules: mods.map(m => m.module),
        source: 'cliente_final',
      })
    }

    res.json({ modules: [], source: 'none' })
  } catch (err) { next(err) }
})

// =============================================================================
// ROTAS SUPER ADMIN
// =============================================================================

// GET /modules/admin/integradores — lista todos integradores com seus módulos
modulesRouter.get('/admin/integradores', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.jwtPayload!.role !== 'SUPER_ADMIN') throw new ForbiddenError()

    const integradores = await prisma.integrador.findMany({
      where: { active: true },
      select: {
        id: true, name: true, tradeName: true, email: true, active: true,
        modulePermissions: { select: { module: true, enabled: true, grantedAt: true } },
        _count: { select: { clienteFinais: true } },
      },
      orderBy: { name: 'asc' },
    })

    res.json(integradores.map(i => ({
      ...i,
      modules: i.modulePermissions,
      enabledModules: i.modulePermissions.filter(m => m.enabled).map(m => m.module),
    })))
  } catch (err) { next(err) }
})

// GET /modules/admin/integradores/:id — módulos de um integrador específico
modulesRouter.get('/admin/integradores/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.jwtPayload!.role !== 'SUPER_ADMIN') throw new ForbiddenError()

    const integrador = await prisma.integrador.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, name: true, tradeName: true, email: true,
        modulePermissions: { select: { module: true, enabled: true, grantedAt: true } },
      },
    })
    if (!integrador) throw new NotFoundError('Integrador')

    res.json({
      ...integrador,
      enabledModules: integrador.modulePermissions.filter(m => m.enabled).map(m => m.module),
    })
  } catch (err) { next(err) }
})

// PUT /modules/admin/integradores/:id — SuperAdmin atualiza módulos do integrador
modulesRouter.put('/admin/integradores/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.jwtPayload!.role !== 'SUPER_ADMIN') throw new ForbiddenError()

    const parse = UpdateModulesSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

    const integradorId = req.params.id
    const integrador = await prisma.integrador.findUnique({ where: { id: integradorId } })
    if (!integrador) throw new NotFoundError('Integrador')

    // Upsert cada módulo
    await Promise.all(
      parse.data.modules.map(({ module, enabled }) =>
        prisma.integradorModule.upsert({
          where:  { integradorId_module: { integradorId, module: module as any } },
          update: { enabled, grantedBy: req.jwtPayload!.sub },
          create: { integradorId, module: module as any, enabled, grantedBy: req.jwtPayload!.sub },
        })
      )
    )

    // Quando um módulo é desativado para o integrador, desativar também nos seus clientes
    const disabledModules = parse.data.modules.filter(m => !m.enabled).map(m => m.module)
    if (disabledModules.length > 0) {
      const clients = await prisma.clienteFinal.findMany({
        where: { integradorId },
        select: { id: true },
      })
      if (clients.length > 0) {
        await prisma.clienteFinalModule.updateMany({
          where: {
            clienteFinalId: { in: clients.map(c => c.id) },
            module: { in: disabledModules as any[] },
          },
          data: { enabled: false },
        })
      }
    }

    logger.info({ integradorId, modules: parse.data.modules }, 'integrador_modules_updated')

    const updated = await prisma.integradorModule.findMany({
      where: { integradorId },
      select: { module: true, enabled: true },
    })

    // H5 — Hook cross-sell: módulos ativados podem fechar oportunidade aberta
    const enabledModules = parse.data.modules.filter(m => m.enabled).map(m => m.module)
    if (enabledModules.length > 0) {
      import('../services/sales-hooks.service').then(m => m.onIntegradorModulesUpdated(integradorId, enabledModules))
        .catch(err => logger.warn({ err: err.message }, 'h5_failed'))
    }

    res.json({ ok: true, modules: updated })
  } catch (err) { next(err) }
})

// =============================================================================
// ROTAS INTEGRADOR
// =============================================================================

// GET /modules/me — módulos do integrador autenticado
modulesRouter.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jwt = req.jwtPayload!
    const integradorId = jwt.integradorId

    if (!integradorId && jwt.role !== 'SUPER_ADMIN') throw new ForbiddenError()

    if (jwt.role === 'SUPER_ADMIN') {
      return res.json({ modules: ALL_MODULE_IDS.map(m => ({ module: m, enabled: true })) })
    }

    const mods = await prisma.integradorModule.findMany({
      where: { integradorId: integradorId! },
      select: { module: true, enabled: true, grantedAt: true },
    })

    res.json({ modules: mods })
  } catch (err) { next(err) }
})

// GET /modules/clientes — lista clientes do integrador com seus módulos
modulesRouter.get('/clientes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jwt = req.jwtPayload!
    if (!jwt.integradorId) throw new ForbiddenError()

    // Módulos que o integrador possui
    const myMods = await prisma.integradorModule.findMany({
      where: { integradorId: jwt.integradorId, enabled: true },
      select: { module: true },
    })
    const myModuleIds = myMods.map(m => m.module)

    const clientes = await prisma.clienteFinal.findMany({
      where: { integradorId: jwt.integradorId, active: true },
      select: {
        id: true, name: true, tradeName: true, email: true, vertical: true, city: true, state: true,
        modulePermissions: {
          where: { module: { in: myModuleIds as any[] } },
          select: { module: true, enabled: true, grantedAt: true },
        },
        _count: { select: { sites: true } },
      },
      orderBy: { name: 'asc' },
    })

    res.json({
      availableModules: myModuleIds,
      clientes: clientes.map(c => ({
        ...c,
        enabledModules: c.modulePermissions.filter(m => m.enabled).map(m => m.module),
      })),
    })
  } catch (err) { next(err) }
})

// GET /modules/clientes/:clienteFinalId — módulos de um cliente específico
modulesRouter.get('/clientes/:clienteFinalId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jwt = req.jwtPayload!
    if (!jwt.integradorId) throw new ForbiddenError()

    const cliente = await prisma.clienteFinal.findFirst({
      where: { id: req.params.clienteFinalId, integradorId: jwt.integradorId },
      select: {
        id: true, name: true, tradeName: true, email: true, vertical: true,
        modulePermissions: { select: { module: true, enabled: true, grantedAt: true } },
      },
    })
    if (!cliente) throw new NotFoundError('Cliente Final')

    // Módulos disponíveis para o integrador
    const myMods = await prisma.integradorModule.findMany({
      where: { integradorId: jwt.integradorId, enabled: true },
      select: { module: true },
    })

    res.json({
      ...cliente,
      availableModules: myMods.map(m => m.module),
      enabledModules: cliente.modulePermissions.filter(m => m.enabled).map(m => m.module),
    })
  } catch (err) { next(err) }
})

// PUT /modules/clientes/:clienteFinalId — Integrador atualiza módulos do cliente
modulesRouter.put('/clientes/:clienteFinalId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jwt = req.jwtPayload!
    if (!jwt.integradorId) throw new ForbiddenError()

    const parse = UpdateModulesSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

    const clienteFinalId = req.params.clienteFinalId
    const cliente = await prisma.clienteFinal.findFirst({
      where: { id: clienteFinalId, integradorId: jwt.integradorId },
    })
    if (!cliente) throw new NotFoundError('Cliente Final')

    // Verificar que o integrador tem acesso aos módulos que está tentando conceder
    const myMods = await prisma.integradorModule.findMany({
      where: { integradorId: jwt.integradorId, enabled: true },
      select: { module: true },
    })
    const myModuleIds = new Set(myMods.map(m => m.module))

    const requested = parse.data.modules.filter(m => m.enabled)
    const unauthorized = requested.filter(m => !myModuleIds.has(m.module as any))
    if (unauthorized.length > 0) {
      throw new ForbiddenError(
        `Módulos não disponíveis no seu plano: ${unauthorized.map(m => m.module).join(', ')}`
      )
    }

    // Upsert cada módulo
    await Promise.all(
      parse.data.modules.map(({ module, enabled }) =>
        prisma.clienteFinalModule.upsert({
          where:  { clienteFinalId_module: { clienteFinalId, module: module as any } },
          update: { enabled, grantedBy: jwt.integradorId },
          create: { clienteFinalId, module: module as any, enabled, grantedBy: jwt.integradorId },
        })
      )
    )

    logger.info({ clienteFinalId, integradorId: jwt.integradorId }, 'cliente_modules_updated')

    const updated = await prisma.clienteFinalModule.findMany({
      where: { clienteFinalId },
      select: { module: true, enabled: true },
    })

    res.json({ ok: true, modules: updated })
  } catch (err) { next(err) }
})
