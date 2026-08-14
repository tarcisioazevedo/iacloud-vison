/**
 * admin-billing-explorer.ts — drill-down 3 níveis pro SUPER_ADMIN investigar billing
 * de um integrador específico → seus clientes finais → contratações de cada cliente.
 *
 *   GET /admin/billing/explorer/integradores
 *   GET /admin/billing/explorer/integradores/:id/clientes
 *   GET /admin/billing/explorer/integradores/:id/clientes.csv
 *   GET /admin/billing/explorer/clientes/:id/contratacoes
 *   GET /admin/billing/explorer/clientes/:id/contratacoes.csv
 */
import { Router } from 'express'
import { publicRoute } from '../middleware/require-capability'
import { prisma } from '../lib/prisma'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { NotFoundError } from '../lib/errors'

export const adminBillingExplorerRouter = Router()
adminBillingExplorerRouter.use(requireAuth)
adminBillingExplorerRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

type IntegradorStatus = 'EM_DIA' | 'EM_ATRASO' | 'VENCE_BREVE' | 'PENDENTE_CADASTRO'

function statusFromInvoices(invs: Array<{ status: string; dueDate: Date | null }>, customerConfigured: boolean): IntegradorStatus {
  if (!customerConfigured && invs.length === 0) return 'PENDENTE_CADASTRO'
  const now = Date.now()
  const hasOverdue = invs.some(i => i.status === 'OVERDUE' || (i.status === 'PENDING' && i.dueDate && i.dueDate.getTime() < now))
  if (hasOverdue) return 'EM_ATRASO'
  const dueSoon = invs.some(i => i.status === 'PENDING' && i.dueDate && i.dueDate.getTime() - now < 3 * 24 * 3600 * 1000)
  if (dueSoon) return 'VENCE_BREVE'
  return 'EM_DIA'
}

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

// ── GET /admin/billing/explorer/integradores ────────────────────────────────

adminBillingExplorerRouter.get('/integradores',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const q       = (req.query.q       as string ?? '').trim().toLowerCase()
    const status  =  req.query.status  as string | undefined
    const orderBy =  req.query.orderBy as string | undefined ?? 'mrr_desc'

    const integradores = await prisma.integrador.findMany({
      where: { active: true },
      select: {
        id: true, name: true, tradeName: true, cnpj: true, email: true,
        clienteFinais: {
          where: { active: true },
          select: {
            id: true,
            sites: { select: { cameras: { where: { active: true }, select: { id: true } } } },
            marketplaceSubscriptions: {
              where: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] } },
              select: { finalPriceBrl: true, cameraIds: true },
            },
          },
        },
        asaasCustomer: { select: { id: true } },
        invoices: {
          where: { status: { in: ['PENDING', 'OVERDUE', 'PAID'] } },
          orderBy: { periodStart: 'desc' },
          take: 6,
          select: { status: true, dueDate: true, totalAmountBrl: true, paidAt: true },
        },
      },
    })

    let rows = integradores.map(i => {
      const clientesCount = i.clienteFinais.length
      const camerasCount  = i.clienteFinais.reduce((s, cf) =>
        s + cf.sites.reduce((ss, st) => ss + st.cameras.length, 0), 0)
      const mrrBrl = i.clienteFinais.reduce((s, cf) =>
        s + cf.marketplaceSubscriptions.reduce((ss, sub) =>
          ss + Number(sub.finalPriceBrl) * (sub.cameraIds?.length ?? 0), 0), 0)
      const lastInvoice = i.invoices[0] ?? null
      const computedStatus = statusFromInvoices(i.invoices, !!i.asaasCustomer)
      return {
        id:           i.id,
        name:         i.name,
        tradeName:    i.tradeName,
        cnpj:         i.cnpj,
        email:        i.email,
        status:       computedStatus,
        clientesCount,
        camerasCount,
        mrrBrl:       Number(mrrBrl.toFixed(2)),
        lastInvoice:  lastInvoice ? {
          status:         lastInvoice.status,
          dueDate:        lastInvoice.dueDate,
          totalAmountBrl: Number(lastInvoice.totalAmountBrl),
          paidAt:         lastInvoice.paidAt,
        } : null,
      }
    })

    if (q) {
      rows = rows.filter(r =>
        (r.name?.toLowerCase().includes(q)) ||
        (r.tradeName?.toLowerCase().includes(q)) ||
        (r.cnpj?.toLowerCase().includes(q)) ||
        (r.email?.toLowerCase().includes(q)),
      )
    }
    if (status) rows = rows.filter(r => r.status === status)

    rows.sort((a, b) => {
      if (orderBy === 'name_asc')     return (a.tradeName ?? a.name).localeCompare(b.tradeName ?? b.name)
      if (orderBy === 'clientes_desc')return b.clientesCount - a.clientesCount
      if (orderBy === 'cameras_desc') return b.camerasCount  - a.camerasCount
      return b.mrrBrl - a.mrrBrl
    })

    res.json({ totalCount: rows.length, rows })
  }),
)

// ── GET /admin/billing/explorer/integradores/:id/clientes ───────────────────

adminBillingExplorerRouter.get('/integradores/:id/clientes',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = req.params.id
    const q       = (req.query.q       as string ?? '').trim().toLowerCase()
    const status  =  req.query.status  as string | undefined

    const integrador = await prisma.integrador.findUnique({
      where: { id: integradorId },
      select: { id: true, name: true, tradeName: true, cnpj: true, email: true },
    })
    if (!integrador) throw new NotFoundError('Integrador não encontrado')

    const clientes = await prisma.clienteFinal.findMany({
      where: { integradorId },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, tradeName: true, active: true, createdAt: true,
        sites: { select: { cameras: { where: { active: true }, select: { id: true } } } },
        marketplaceSubscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE', 'SUSPENDED'] } },
          select: { status: true, finalPriceBrl: true, cameraIds: true },
        },
      },
    })

    let rows = clientes.map(cf => {
      const camerasCount = cf.sites.reduce((s, st) => s + st.cameras.length, 0)
      const activeSubs   = cf.marketplaceSubscriptions.filter(s => s.status === 'ACTIVE' || s.status === 'TRIAL' || s.status === 'GRACE')
      const subscriptionsCount = activeSubs.length
      const mrrBrl = activeSubs.reduce((s, sub) =>
        s + Number(sub.finalPriceBrl) * (sub.cameraIds?.length ?? 0), 0)
      const isSuspended = cf.marketplaceSubscriptions.some(s => s.status === 'SUSPENDED')
      const statusComputed = !cf.active     ? 'CANCELADO'
                           : isSuspended    ? 'SUSPENSO'
                           : subscriptionsCount === 0 ? 'SEM_CONTRATO'
                           :                            'ATIVO'
      return {
        id:           cf.id,
        name:         cf.tradeName ?? cf.name,
        razaoSocial:  cf.name,
        status:       statusComputed,
        camerasCount,
        subscriptionsCount,
        mrrBrl:       Number(mrrBrl.toFixed(2)),
        since:        cf.createdAt,
      }
    })

    if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.razaoSocial.toLowerCase().includes(q))
    if (status) rows = rows.filter(r => r.status === status)

    // Totais do integrador
    const totals = {
      clientesCount:      rows.length,
      camerasCount:       rows.reduce((s, r) => s + r.camerasCount, 0),
      subscriptionsCount: rows.reduce((s, r) => s + r.subscriptionsCount, 0),
      mrrBrl:             Number(rows.reduce((s, r) => s + r.mrrBrl, 0).toFixed(2)),
    }

    res.json({ integrador, totals, rows })
  }),
)

// ── GET /admin/billing/explorer/integradores/:id/clientes.csv ───────────────

adminBillingExplorerRouter.get('/integradores/:id/clientes.csv',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const integradorId = req.params.id
    const integrador = await prisma.integrador.findUnique({
      where: { id: integradorId },
      select: { id: true, name: true, tradeName: true },
    })
    if (!integrador) throw new NotFoundError('Integrador não encontrado')

    const clientes = await prisma.clienteFinal.findMany({
      where: { integradorId },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, tradeName: true, active: true, createdAt: true,
        sites: { select: { cameras: { where: { active: true }, select: { id: true } } } },
        marketplaceSubscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE', 'SUSPENDED'] } },
          select: { status: true, finalPriceBrl: true, cameraIds: true },
        },
      },
    })

    const lines = ['cliente_id,razao_social,nome_fantasia,status,cameras,assinaturas,receita_mensal_brl,cadastrado_em']
    for (const cf of clientes) {
      const cameras = cf.sites.reduce((s, st) => s + st.cameras.length, 0)
      const activeSubs = cf.marketplaceSubscriptions.filter(s => s.status === 'ACTIVE' || s.status === 'TRIAL' || s.status === 'GRACE')
      const mrr = activeSubs.reduce((s, sub) => s + Number(sub.finalPriceBrl) * (sub.cameraIds?.length ?? 0), 0)
      const status = !cf.active ? 'CANCELADO' : cf.marketplaceSubscriptions.some(s => s.status === 'SUSPENDED') ? 'SUSPENSO' : (activeSubs.length === 0 ? 'SEM_CONTRATO' : 'ATIVO')
      lines.push([cf.id, cf.name, cf.tradeName ?? '', status, cameras, activeSubs.length, mrr.toFixed(2), cf.createdAt.toISOString()].map(csvEscape).join(','))
    }

    const filename = `clientes-${(integrador.tradeName ?? integrador.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(lines.join('\n'))
  }),
)

// ── GET /admin/billing/explorer/clientes/:id/contratacoes ───────────────────

adminBillingExplorerRouter.get('/clientes/:id/contratacoes',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const clienteFinalId = req.params.id

    const cliente = await prisma.clienteFinal.findUnique({
      where: { id: clienteFinalId },
      select: {
        id: true, name: true, tradeName: true, createdAt: true,
        integrador: { select: { id: true, name: true, tradeName: true } },
      },
    })
    if (!cliente) throw new NotFoundError('Cliente final não encontrado')

    const subs = await prisma.clienteSubscription.findMany({
      where: { clienteFinalId },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
      select: {
        id: true, status: true, startedAt: true, trialUntil: true, cameraIds: true,
        basePriceUsd: true, finalPriceBrl: true,
        product: { select: { slug: true, name: true, category: true } },
      },
    })

    const contratacoes = subs.map(s => {
      const cameraCount = s.cameraIds?.length ?? 0
      const finalPriceBrl = Number(s.finalPriceBrl)
      const subtotalBrl = Number((finalPriceBrl * cameraCount).toFixed(2))
      return {
        id:             s.id,
        productSlug:    s.product.slug,
        productName:    s.product.name,
        category:       s.product.category,
        status:         s.status,
        cameraCount,
        basePriceUsd:   Number(s.basePriceUsd),
        finalPriceBrl,
        subtotalBrl,
        startedAt:      s.startedAt,
        trialUntil:     s.trialUntil,
      }
    })

    const activeTotal = contratacoes
      .filter(c => c.status === 'ACTIVE' || c.status === 'TRIAL' || c.status === 'GRACE')
      .reduce((s, c) => s + c.subtotalBrl, 0)

    res.json({
      cliente,
      integrador: cliente.integrador,
      totalMensalBrl: Number(activeTotal.toFixed(2)),
      contratacoes,
    })
  }),
)

// ── GET /admin/billing/explorer/clientes/:id/contratacoes.csv ───────────────

adminBillingExplorerRouter.get('/clientes/:id/contratacoes.csv',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const clienteFinalId = req.params.id

    const cliente = await prisma.clienteFinal.findUnique({
      where: { id: clienteFinalId },
      select: { id: true, name: true, tradeName: true },
    })
    if (!cliente) throw new NotFoundError('Cliente final não encontrado')

    const subs = await prisma.clienteSubscription.findMany({
      where: { clienteFinalId },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
      select: {
        id: true, status: true, startedAt: true, trialUntil: true, cameraIds: true,
        basePriceUsd: true, finalPriceBrl: true,
        product: { select: { slug: true, name: true, category: true } },
      },
    })

    const lines = ['contratacao_id,produto_slug,produto_nome,categoria,status,cameras,preco_atacado_usd,preco_venda_brl,subtotal_brl,iniciada_em,trial_ate']
    for (const s of subs) {
      const cameras = s.cameraIds?.length ?? 0
      const finalPriceBrl = Number(s.finalPriceBrl)
      const subtotalBrl = (finalPriceBrl * cameras).toFixed(2)
      lines.push([s.id, s.product.slug, s.product.name, s.product.category, s.status, cameras, Number(s.basePriceUsd).toFixed(4), finalPriceBrl.toFixed(2), subtotalBrl, s.startedAt.toISOString(), s.trialUntil?.toISOString() ?? ''].map(csvEscape).join(','))
    }

    const filename = `contratacoes-${(cliente.tradeName ?? cliente.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(lines.join('\n'))
  }),
)
