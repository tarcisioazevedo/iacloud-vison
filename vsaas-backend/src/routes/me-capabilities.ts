/**
 * GET /me/capabilities — retorna lista de capabilities ativas do request.
 *
 * Usado pelo frontend (HOC <RequireCapability>) pra decidir se mostra/esconde
 * botões e telas baseado em quais features o cliente contratou.
 *
 * Comportamento:
 *   - Se JWT tem clienteFinalId: retorna capabilities do cliente
 *   - Se JWT é integrador/admin: retorna capabilities do cliente do ?clienteFinalId=
 *     (ou todas as capabilities core se não informado)
 *
 * Cacheado no Redis 60s via canUse(). Endpoint barato.
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { publicRoute } from '../middleware/require-capability'
import { listCapabilitiesForCliente } from '../lib/capability-check'
import { CORE_CAPABILITIES } from '../lib/capabilities'

export const meCapabilitiesRouter = Router()
meCapabilitiesRouter.use(requireAuth)

meCapabilitiesRouter.get('/',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = (req as any).jwtPayload

    // Tenta resolver clienteFinalId (mesmo padrão do middleware requires())
    let clienteFinalId: string | null = jwt?.clienteFinalId ?? null
    if (!clienteFinalId) {
      const qs = (req.query as Record<string, string>)?.clienteFinalId
      if (qs) clienteFinalId = qs
    }

    if (!clienteFinalId) {
      // Integrador/admin sem cliente alvo → retorna apenas core capabilities
      return res.json({ capabilities: Array.from(CORE_CAPABILITIES) })
    }

    const caps = await listCapabilitiesForCliente(clienteFinalId)
    // Frontend sempre tem acesso a core caps + as do cliente
    const all = [...new Set([...Array.from(CORE_CAPABILITIES), ...caps])]
    res.json({ capabilities: all })
  }),
)

/**
 * GET /me/cliente/account-state
 * Retorna estado consolidado da conta pra decidir qual banner mostrar.
 *
 * Usado pelo <AccountStateBanner> no frontend para regra de exclusão mútua.
 * Substitui os múltiplos hooks/checks espalhados que faziam 3 banners
 * empilharem na mesma tela.
 *
 * Ordem de prioridade (frontend renderiza só o primeiro true):
 *   1. isSuspended (inadimplência real)
 *   2. hasGrace (cancelado, em período de graça)
 *   3. trialDaysLeft <= 3 (trial expirando)
 *   4. systemIncident (status page)
 */
// Endpoint duplicado em /account-state para acessar via /me/capabilities/account-state.
// Frontend pode consumir em /me/capabilities/account-state OU /me/cliente/account-state
// (ambos chegam aqui via diferentes mounts).
meCapabilitiesRouter.get('/account-state',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = (req as any).jwtPayload
    let clienteFinalId: string | null = jwt?.clienteFinalId ?? null
    if (!clienteFinalId) {
      const qs = (req.query as Record<string, string>)?.clienteFinalId
      if (qs) clienteFinalId = qs
    }

    if (!clienteFinalId) {
      // Sem cliente — retorna estado vazio (banner não aparece)
      return res.json({
        isSuspended: false,
        hasGrace: false,
        trialDaysLeft: null,
        systemIncident: null,
      })
    }

    // Carrega assinaturas do cliente (1 query)
    const subs = await prisma.clienteSubscription.findMany({
      where: { clienteFinalId },
      select: {
        id: true,
        status: true,
        cancelGraceUntil: true,
        cancelReason: true,
        trialUntil: true,
      },
    })

    // Suspensão por inadimplência: alguma sub SUSPENDED
    const suspendedSub = subs.find(s => s.status === 'SUSPENDED')
    const isSuspended = !!suspendedSub

    // Período de graça: subs em GRACE (e ainda dentro da janela)
    const now = new Date()
    const graceSubs = subs.filter(s =>
      s.status === 'GRACE' &&
      (!s.cancelGraceUntil || s.cancelGraceUntil > now)
    )
    const hasGrace = graceSubs.length > 0
    const minGraceUntil = graceSubs
      .map(s => s.cancelGraceUntil)
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null

    // Trial expirando: pega o TRIAL com trialUntil mais próximo do agora.
    // Banner cyan renderiza quando <= 3 dias (regra do AccountStateBanner).
    const trialSubs = subs.filter(
      s => s.status === 'TRIAL' && s.trialUntil && s.trialUntil > now,
    )
    const nextTrial = trialSubs
      .map(s => s.trialUntil!)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
    const trialDaysLeft: number | null = nextTrial
      ? Math.max(0, Math.ceil((nextTrial.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : null

    // System incident: por enquanto null. Pode integrar Uptime Kuma futuramente.
    const systemIncident = null

    res.json({
      isSuspended,
      hasGrace,
      trialDaysLeft,
      systemIncident,
      graceUntil: minGraceUntil?.toISOString() ?? null,
      graceCount: graceSubs.length,
      suspendedReason: suspendedSub?.cancelReason ?? null,
    })
  }),
)

/**
 * GET /me/capabilities/product-for/:capability
 * Retorna o produto recomendado que libera aquela capability.
 *
 * Usado pelo frontend (<CapabilityBlockedView>) pra mostrar "Contrate X
 * para liberar essa funcionalidade".
 *
 * Estratégia:
 *   1. Busca todos produtos ACTIVE que listam essa capability
 *   2. Ordena: comingSoon=false primeiro, depois sortOrder ASC, depois basePrice ASC
 *   3. Retorna o "mais simples/barato/disponível"
 */
meCapabilitiesRouter.get('/product-for/:capability',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
    const capability = String(req.params.capability)
    if (!capability) {
      return res.status(400).json({ error: 'capability_required' })
    }

    // Busca produtos que liberam essa capability
    const products = await prisma.marketplaceProduct.findMany({
      where: {
        active: true,
        capabilities: { has: capability },
      },
      select: {
        id: true, slug: true, name: true, tagline: true, description: true,
        category: true, basePriceUsd: true, pricingModel: true,
        comingSoon: true, sortOrder: true, features: true, metadata: true,
      },
      orderBy: [
        { comingSoon: 'asc' },   // disponíveis primeiro
        { sortOrder: 'asc' },     // ordem editorial do fabricante
        { basePriceUsd: 'asc' },  // mais barato primeiro (entry-level)
      ],
    })

    if (products.length === 0) {
      // Nenhum produto cobre essa capability — pode ser capability nova ou
      // restrita só pra integradores. Devolve link genérico pro marketplace.
      return res.json({
        capability,
        product: null,
        suggestion: 'Entre em contato com seu integrador para ativar esse recurso.',
        marketplaceUrl: '/marketplace',
      })
    }

    const best = products[0]
    const all = products.slice(0, 3)  // até 3 alternativas

    res.json({
      capability,
      product: {
        ...best,
        basePriceBrl: Number(best.basePriceUsd) * 5,  // conversão simples USD→BRL ~5x
      },
      alternatives: all.slice(1).map(p => ({
        ...p,
        basePriceBrl: Number(p.basePriceUsd) * 5,
      })),
      marketplaceUrl: `/marketplace?suggest=${encodeURIComponent(capability)}`,
    })
  }),
)
