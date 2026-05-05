/**
 * Leads — funil comercial pré-tenant (CRM interno do Fabricante).
 *
 * Lote 0 do onboarding revisado:
 *   - POST /leads             → público, recebe formulário "Solicitar acesso"
 *   - GET  /leads             → SUPER_ADMIN | ADMIN_GLOBAL, lista + filtros
 *   - GET  /leads/:id         → SUPER_ADMIN | ADMIN_GLOBAL
 *   - PATCH /leads/:id        → SUPER_ADMIN | ADMIN_GLOBAL, muda status/notes
 *   - POST /leads/cnpj/:cnpj  → público (rate-limited), proxy BrasilAPI
 *
 * Modelo: NÃO criamos tenant aqui. Lead vira Integrador/ClienteFinal só
 * quando o Admin global converter via fluxo de DemoInvite (Lote 1).
 *
 * Anti-spam: rate limit por IP (200/min global já cobre); deduplicamos por
 * email se a mesma pessoa enviar 2× em 24h (atualiza em vez de criar novo).
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { logger } from '../lib/logger'
import { sendMail, loadTemplate, renderTemplate } from '../lib/smtp'
import { broadcast } from '../lib/webpush'

// ── Notificação de novo lead para admins ──────────────────────────────────────

async function notifyAdminsNewLead(lead: {
  id: string
  contactName: string
  contactEmail: string
  companyName: string | null
  kind: string
  source: string
  cameraVolume: string | null
  message: string | null
}): Promise<void> {
  try {
    const baseUrl   = process.env.PUBLIC_APP_URL ?? 'http://localhost:5173'
    const leadsUrl  = `${baseUrl}/admin/leads`

    const VOLUME_LABEL: Record<string, string> = {
      LT_50: 'Até 50 câmeras', '50_500': '50–500 câmeras',
      '500_2000': '500–2.000 câmeras', GT_2000: '> 2.000 câmeras',
    }
    const vars: Record<string, string> = {
      contactName:      lead.contactName,
      contactEmail:     lead.contactEmail,
      companyName:      lead.companyName ?? '(não informado)',
      kind:             lead.kind === 'INTEGRADOR' ? 'Integrador' : 'Cliente Final',
      source:           lead.source,
      leadsUrl,
      cameraVolumeRow:  lead.cameraVolume
        ? `Volume:   ${VOLUME_LABEL[lead.cameraVolume] ?? lead.cameraVolume}\n`
        : '',
      messageRow:       lead.message
        ? `\nMensagem:\n${lead.message}\n`
        : '',
    }

    const tpl = await loadTemplate('lead_notification')
    if (!tpl) return

    const subject = renderTemplate(tpl.subject, vars)
    const text    = renderTemplate(tpl.body,    vars)

    // Busca todos os SUPER_ADMIN e ADMIN_GLOBAL com email
    const admins = await prisma.user.findMany({
      where: { role: { in: ['SUPER_ADMIN', 'ADMIN_GLOBAL'] }, active: true },
      select: { id: true, email: true },
    })

    // Envia email em paralelo (não-bloqueante — erros são absorvidos)
    await Promise.allSettled(
      admins.map(admin => sendMail({ to: admin.email, subject, text }))
    )

    // WebPush para subscriptions dos admins
    await Promise.allSettled(
      admins.map(admin =>
        broadcast({ userId: admin.id }, {
          title: `🔔 Novo lead: ${lead.contactName}`,
          body:  `${lead.companyName ?? lead.contactEmail} — ${lead.kind === 'INTEGRADOR' ? 'Integrador' : 'Cliente Final'}`,
          tag:   `lead-${lead.id}`,
          url:   leadsUrl,
        }),
      )
    )

    logger.info({ leadId: lead.id, adminCount: admins.length }, 'lead_notification_sent')
  } catch (err: any) {
    logger.warn({ err: err.message, leadId: lead.id }, 'lead_notification_failed')
  }
}

export const leadsRouter = Router()

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Roles que podem trabalhar leads no CRM:
 *   - SUPER_ADMIN  : acesso total (faz/aprova qualquer ação)
 *   - ADMIN_GLOBAL : opera o funil; algumas ações exigem aprovação Super (Lote 1)
 *
 * Por enquanto SUPER_ADMIN engloba os dois (ADMIN_GLOBAL será role separada
 * num lote futuro do schema).
 */
function requireFabricanteRole(req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) {
  const role = req.jwtPayload?.role
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN_GLOBAL') {
    throw new ForbiddenError('Apenas Fabricante (Super Admin / Admin global) acessa o funil de leads')
  }
}

const KindEnum   = z.enum(['INTEGRADOR', 'CLIENTE_FINAL'])
const StatusEnum = z.enum(['NEW', 'CONTACTED', 'DEMO_SENT', 'NEGOTIATION', 'CONVERTED', 'LOST'])

// Razões padronizadas de perda (para análise de churn)
export const LOST_REASONS = [
  'PRICE',          // preço alto
  'FEATURE',        // falta feature
  'COMPETITOR',     // foi para concorrente
  'NO_DECISION',    // empresa não decidiu
  'NO_BUDGET',      // sem orçamento
  'NO_FIT',         // perfil não bate
  'NO_RESPONSE',    // parou de responder
  'OTHER',          // outro
] as const

// Validação flexível — backend não exige CNPJ pra CLIENTE_FINAL, mas pra
// INTEGRADOR a empresa precisa estar identificada.
const CreateLeadSchema = z.object({
  kind:             KindEnum,
  contactName:      z.string().min(2).max(120),
  contactEmail:     z.string().email().max(180),
  contactPhone:     z.string().max(40).optional().nullable(),
  contactRole:      z.string().max(80).optional().nullable(),

  companyName:      z.string().max(180).optional().nullable(),
  companyTradeName: z.string().max(180).optional().nullable(),
  cnpj:             z.string().max(20).optional().nullable(),
  city:             z.string().max(80).optional().nullable(),
  state:            z.string().max(2).optional().nullable(),

  alarmCentral:     z.enum(['YES', 'NO', 'BUILDING']).optional().nullable(),
  cameraVolume:     z.enum(['LT_50', '50_500', '500_2000', 'GT_2000']).optional().nullable(),
  projectStage:     z.string().max(180).optional().nullable(),

  message:          z.string().max(2000).optional().nullable(),
  source:           z.string().max(40).optional(),
  acceptTerms:      z.literal(true),  // LGPD opt-in obrigatório
}).superRefine((data, ctx) => {
  if (data.kind === 'INTEGRADOR') {
    if (!data.companyName || !data.cnpj) {
      ctx.addIssue({
        code: 'custom',
        path: ['companyName'],
        message: 'Empresa e CNPJ são obrigatórios para integradores',
      })
    }
  }
})

const UpdateLeadSchema = z.object({
  status:    StatusEnum.optional(),
  notes:     z.string().max(4000).optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  lostReason:     z.string().max(280).optional().nullable(),
  lostCategory:   z.enum(['PRICE', 'TIMING', 'NO_FIT', 'NO_BUDGET', 'CHANGED_DECISOR', 'COMPETITOR', 'OTHER']).optional(),
  transitionNote: z.string().max(500).optional(), // motivo obrigatório em backward moves
})

// Funil canônico — ordem de progressão. Maior número = mais avançado.
const FUNNEL_RANK: Record<string, number> = {
  NEW:         0,
  CONTACTED:   1,
  DEMO_SENT:   2,
  NEGOTIATION: 3,
  CONVERTED:   4,
  LOST:        99, // terminal — pode vir de qualquer etapa
}

// Transições permitidas — protege a integridade do funil.
// LOST e CONVERTED podem ser alcançados de qualquer etapa exceto LOST/CONVERTED.
const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  NEW:         new Set(['CONTACTED', 'DEMO_SENT', 'LOST']),
  CONTACTED:   new Set(['NEW', 'DEMO_SENT', 'NEGOTIATION', 'LOST']),
  DEMO_SENT:   new Set(['CONTACTED', 'NEGOTIATION', 'CONVERTED', 'LOST']),
  NEGOTIATION: new Set(['DEMO_SENT', 'CONVERTED', 'LOST']),
  CONVERTED:   new Set([]), // terminal — não move
  LOST:        new Set(['NEW']), // permite reabrir
}

function isBackwardMove(from: string, to: string): boolean {
  const a = FUNNEL_RANK[from] ?? 0
  const b = FUNNEL_RANK[to] ?? 0
  // LOST não conta como backward (é terminal lateral)
  if (to === 'LOST') return false
  return b < a
}

// Sanitiza CNPJ — remove pontuação, mantém só dígitos.
function normalizeCnpj(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D+/g, '')
  return digits.length === 14 ? digits : null
}

// ── POST /leads — público (sem auth) ─────────────────────────────────────────

leadsRouter.post('/', asyncHandler(async (req, res) => {
  const parse = CreateLeadSchema.safeParse(req.body)
  if (!parse.success) {
    throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')
  }
  const data = parse.data

  const cnpjDigits = normalizeCnpj(data.cnpj)

  // Dedup leve: mesmo email + mesmo kind nas últimas 24h → atualiza em vez de
  // criar novo (evita inflar funil quando o usuário re-submete por hesitação).
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const existing = await prisma.lead.findFirst({
    where: {
      contactEmail: data.contactEmail,
      kind: data.kind,
      createdAt: { gte: yesterday },
      // NÃO sobrescreve leads já trabalhados — só os "frescos".
      status: 'NEW',
    },
    orderBy: { createdAt: 'desc' },
  })

  if (existing) {
    const updated = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        contactName:      data.contactName,
        contactPhone:     data.contactPhone ?? existing.contactPhone,
        contactRole:      data.contactRole  ?? existing.contactRole,
        companyName:      data.companyName  ?? existing.companyName,
        companyTradeName: data.companyTradeName ?? existing.companyTradeName,
        cnpj:             cnpjDigits ?? existing.cnpj,
        city:             data.city  ?? existing.city,
        state:            data.state?.toUpperCase() ?? existing.state,
        alarmCentral:     data.alarmCentral ?? existing.alarmCentral,
        cameraVolume:     data.cameraVolume ?? existing.cameraVolume,
        projectStage:     data.projectStage ?? existing.projectStage,
        message:          data.message      ?? existing.message,
      },
    })
    logger.info({ leadId: updated.id, kind: data.kind }, 'lead_updated_dedup')
    res.status(200).json({ id: updated.id, deduplicated: true })
    return
  }

  const created = await prisma.lead.create({
    data: {
      kind:             data.kind,
      status:           'NEW',
      contactName:      data.contactName,
      contactEmail:     data.contactEmail,
      contactPhone:     data.contactPhone ?? null,
      contactRole:      data.contactRole  ?? null,
      companyName:      data.companyName  ?? null,
      companyTradeName: data.companyTradeName ?? null,
      cnpj:             cnpjDigits,
      city:             data.city  ?? null,
      state:            data.state?.toUpperCase() ?? null,
      alarmCentral:     data.alarmCentral ?? null,
      cameraVolume:     data.cameraVolume ?? null,
      projectStage:     data.projectStage ?? null,
      message:          data.message      ?? null,
      source:           data.source       ?? 'login_cta',
    },
  })

  logger.info({ leadId: created.id, kind: data.kind, source: created.source }, 'lead_created')

  // Notifica admins assincronamente (não bloqueia a resposta).
  notifyAdminsNewLead(created).catch(() => {/* absorvido — log já feito dentro */})

  // Email de confirmação ao próprio lead (agradecimento + SLA 1 dia útil).
  sendLeadConfirmationEmail(created).catch(err =>
    logger.warn({ err: err.message, leadId: created.id }, 'lead_confirmation_email_failed')
  )

  // H1 — Hooks de integração comercial (LeadScore + Opportunity + Activity + round-robin)
  import('../services/sales-hooks.service').then(m => m.onLeadCreated(created))
    .catch(err => logger.warn({ err: err.message }, 'h1_failed'))

  res.status(201).json({ id: created.id, deduplicated: false })
}))

// ── Email de confirmação ao lead ─────────────────────────────────────────────
// Enviado imediatamente após cadastro. Comunica SLA de 1 dia útil.

async function sendLeadConfirmationEmail(lead: any): Promise<void> {
  const tpl = await loadTemplate('lead_confirmation')
  if (!tpl) {
    logger.warn('lead_confirmation template não encontrado')
    return
  }

  const supportEmail    = process.env.SUPPORT_EMAIL    ?? 'contato@iacloud.com.br'
  const supportWhatsapp = process.env.SUPPORT_WHATSAPP ?? '+55 11 99999-9999'
  const publicSiteUrl   = process.env.PUBLIC_SITE_URL  ?? 'https://app.iacloud.com.br'

  const vars: Record<string, string> = {
    contactName:     lead.contactName,
    contactEmail:    lead.contactEmail,
    phoneRow:        lead.contactPhone ? `Telefone:   ${lead.contactPhone}\n` : '',
    companyRow:      lead.companyName ? `Empresa:    ${lead.companyName}\n` : '',
    cameraRow:       lead.cameraVolume ? `Câmeras:    ${lead.cameraVolume}\n` : '',
    supportEmail,
    supportWhatsapp,
    publicSiteUrl,
  }

  const subject = renderTemplate(tpl.subject, vars)
  const body    = renderTemplate(tpl.body, vars)

  const result = await sendMail({ to: lead.contactEmail, subject, text: body })
  logger.info({
    leadId: lead.id, to: lead.contactEmail, sent: result.sent, reason: result.reason,
  }, 'lead_confirmation_email')
}

// ── GET /leads — listagem para Fabricante ────────────────────────────────────

const ListQuerySchema = z.object({
  status: StatusEnum.optional(),
  kind:   KindEnum.optional(),
  q:      z.string().max(120).optional(),    // busca em nome/empresa/email
  limit:  z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

leadsRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  requireFabricanteRole(req)

  const parse = ListQuerySchema.safeParse(req.query)
  if (!parse.success) throw new ValidationError('Filtros inválidos')

  const { status, kind, q, limit = 50, offset = 0 } = parse.data

  const where: any = {}
  if (status) where.status = status
  if (kind)   where.kind   = kind
  if (q && q.trim()) {
    where.OR = [
      { contactName:  { contains: q, mode: 'insensitive' } },
      { contactEmail: { contains: q, mode: 'insensitive' } },
      { companyName:  { contains: q, mode: 'insensitive' } },
      { cnpj:         { contains: q.replace(/\D+/g, '') } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.lead.count({ where }),
  ])

  // Contagem agregada por status (pra header com badges "X novos / Y contatados")
  const byStatusRaw = await prisma.lead.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  const byStatus: Record<string, number> = {
    NEW: 0, CONTACTED: 0, DEMO_SENT: 0, CONVERTED: 0, LOST: 0,
  }
  for (const row of byStatusRaw) byStatus[row.status] = row._count._all

  res.json({ items, total, limit, offset, byStatus })
}))

// ── GET /leads/metrics — CRM pipeline metrics (Lote 6) ──────────────────────
// IMPORTANTE: deve ficar ANTES de /:id para o Express não tratar "metrics" como ID.
//
// Retorna:
//   byStatus       — contagem por status (já existe no GET /, replicado aqui)
//   byKind         — NEW/CONTACTED/… por kind (INTEGRADOR vs CLIENTE_FINAL)
//   conversionRate — (CONVERTED) / (total excl. NEW) — percentual
//   lossRate       — LOST / total
//   avgDaysToConvert — média em dias de createdAt → convertedAt
//   avgDaysToContact — média em dias de createdAt → contactedAt
//   monthly        — últimos 6 meses: { month: "2025-01", total, converted, lost }

leadsRouter.get('/metrics', requireAuth, asyncHandler(async (req, res) => {
  requireFabricanteRole(req)

  // 1. Por status
  const byStatusRaw = await prisma.lead.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  const byStatus: Record<string, number> = { NEW: 0, CONTACTED: 0, DEMO_SENT: 0, CONVERTED: 0, LOST: 0 }
  for (const r of byStatusRaw) byStatus[r.status] = r._count._all

  // 2. Por kind × status
  const byKindRaw = await prisma.lead.groupBy({
    by: ['kind', 'status'],
    _count: { _all: true },
  })
  const byKind: Record<string, Record<string, number>> = {
    INTEGRADOR:   { NEW: 0, CONTACTED: 0, DEMO_SENT: 0, CONVERTED: 0, LOST: 0 },
    CLIENTE_FINAL:{ NEW: 0, CONTACTED: 0, DEMO_SENT: 0, CONVERTED: 0, LOST: 0 },
  }
  for (const r of byKindRaw) {
    if (byKind[r.kind]) byKind[r.kind][r.status] = r._count._all
  }

  // 3. Conversion + loss rates
  const total      = Object.values(byStatus).reduce((a, b) => a + b, 0)
  const worked     = total - byStatus.NEW
  const conversionRate = worked > 0 ? Math.round((byStatus.CONVERTED / worked) * 1000) / 10 : 0
  const lossRate       = total   > 0 ? Math.round((byStatus.LOST     / total)  * 1000) / 10 : 0

  // 4. Médias de tempo (dias) — calcula via JS após buscar campos relevantes
  const converted = await prisma.lead.findMany({
    where: { status: 'CONVERTED', convertedAt: { not: null } },
    select: { createdAt: true, convertedAt: true },
  })
  const contacted = await prisma.lead.findMany({
    where: { contactedAt: { not: null } },
    select: { createdAt: true, contactedAt: true },
  })

  const msToDay = 1000 * 60 * 60 * 24
  const avgDaysToConvert = converted.length > 0
    ? Math.round(converted.reduce((acc, l) => acc + (l.convertedAt!.getTime() - l.createdAt.getTime()) / msToDay, 0) / converted.length * 10) / 10
    : null
  const avgDaysToContact = contacted.length > 0
    ? Math.round(contacted.reduce((acc, l) => acc + (l.contactedAt!.getTime() - l.createdAt.getTime()) / msToDay, 0) / contacted.length * 10) / 10
    : null

  // 5. Tendência mensal — últimos 6 meses
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
  sixMonthsAgo.setDate(1)
  sixMonthsAgo.setHours(0, 0, 0, 0)

  const recentLeads = await prisma.lead.findMany({
    where: { createdAt: { gte: sixMonthsAgo } },
    select: { createdAt: true, status: true },
  })

  const monthMap: Record<string, { total: number; converted: number; lost: number }> = {}
  for (const lead of recentLeads) {
    const key = lead.createdAt.toISOString().slice(0, 7) // "YYYY-MM"
    if (!monthMap[key]) monthMap[key] = { total: 0, converted: 0, lost: 0 }
    monthMap[key].total++
    if (lead.status === 'CONVERTED') monthMap[key].converted++
    if (lead.status === 'LOST')      monthMap[key].lost++
  }

  const monthly = Object.entries(monthMap)
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month))

  res.json({
    byStatus,
    byKind,
    total,
    conversionRate,
    lossRate,
    avgDaysToConvert,
    avgDaysToContact,
    monthly,
  })
}))

// ── GET /leads/:id ───────────────────────────────────────────────────────────

leadsRouter.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  requireFabricanteRole(req)
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
  if (!lead) throw new NotFoundError('Lead')
  res.json(lead)
}))

// ── PATCH /leads/:id ─────────────────────────────────────────────────────────

leadsRouter.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  requireFabricanteRole(req)

  const parse = UpdateLeadSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
  if (!lead) throw new NotFoundError('Lead')

  const data: any = { ...parse.data }
  // Remove campos de meta que não existem na tabela Lead
  delete data.lostCategory
  delete data.transitionNote

  // ─── Validação de transições de status ────────────────────────────────────
  if (parse.data.status && parse.data.status !== lead.status) {
    const from = lead.status as string
    const to   = parse.data.status as string

    const allowed = ALLOWED_TRANSITIONS[from]
    if (!allowed || !allowed.has(to)) {
      throw new ValidationError(
        `Transição inválida: ${from} → ${to}. ` +
        `Transições permitidas a partir de ${from}: ${Array.from(allowed ?? []).join(', ') || 'nenhuma'}`
      )
    }

    // Backward moves exigem nota explícita do vendedor.
    if (isBackwardMove(from, to) && !parse.data.transitionNote?.trim()) {
      throw new ValidationError(
        `Movimento para trás (${from} → ${to}) exige um motivo. ` +
        `Forneça transitionNote explicando por quê.`
      )
    }

    // Para LOST: exige categoria estruturada.
    if (to === 'LOST' && !parse.data.lostCategory) {
      throw new ValidationError(
        'Marcar como perdido exige uma categoria (lostCategory). ' +
        'Use uma das: PRICE, TIMING, NO_FIT, NO_BUDGET, CHANGED_DECISOR, COMPETITOR, OTHER.'
      )
    }

    // Atualiza timestamps automáticos.
    if (to === 'CONTACTED' && !lead.contactedAt) data.contactedAt = new Date()
    if (to === 'DEMO_SENT' && !lead.demoSentAt)  data.demoSentAt  = new Date()
    if (to === 'CONVERTED')                       data.convertedAt = new Date()

    // Para LOST: monta campo livre lostReason a partir da categoria + nota.
    if (to === 'LOST') {
      const cat = parse.data.lostCategory!
      data.lostReason = parse.data.lostReason
        ? `[${cat}] ${parse.data.lostReason}`
        : `[${cat}]`
    }
  }

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data,
  })

  logger.info({
    leadId:   lead.id,
    actorId:  req.jwtPayload?.sub,
    statusOld: lead.status,
    statusNew: updated.status,
  }, 'lead_updated')

  // Audit trail persistido — sempre que o status muda, registra.
  if (parse.data.status && parse.data.status !== lead.status) {
    try {
      const actorId = req.jwtPayload?.sub
      let actorName: string | null = null
      let actorRole: string | null = req.jwtPayload?.role ?? null
      if (actorId) {
        const u = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true, role: true } })
        actorName = u?.name ?? null
        actorRole = u?.role ?? actorRole
      }
      // Compõe motivo: nota livre OU lostReason OU vazio
      const composedReason = parse.data.transitionNote
        ?? parse.data.lostReason
        ?? (parse.data.lostCategory ? `[${parse.data.lostCategory}]` : null)

      await prisma.leadStatusHistory.create({
        data: {
          leadId: lead.id,
          fromStatus: lead.status,
          toStatus: updated.status,
          reason: composedReason,
          changedByUserId: actorId ?? null,
          changedByName: actorName,
          changedByRole: actorRole,
          source: 'manual',
          createdAt: new Date(),
        },
      })
    } catch (err: any) {
      logger.warn({ err: err.message, leadId: lead.id }, 'lead_history_write_failed')
    }
  }

  // H3 — Hook de status changed
  if (parse.data.status && parse.data.status !== lead.status) {
    import('../services/sales-hooks.service').then(m =>
      m.onLeadStatusChanged(lead.id, lead.status, parse.data.status!, req.jwtPayload?.sub, parse.data.lostReason)
    ).catch(err => logger.warn({ err: err.message }, 'h3_failed'))
  }

  res.json(updated)
}))

// ── GET /leads/cycle-time — tempo médio em cada etapa do funil ──────────────
// Calcula, a partir do LeadStatusHistory, quanto tempo cada lead ficou em cada etapa.
// Útil para identificar gargalos ("leads ficam 8 dias em DEMO_SENT antes de NEG.").
leadsRouter.get('/cycle-time', requireAuth, asyncHandler(async (req, res) => {
  requireFabricanteRole(req)
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? '90'), 10) || 90, 7), 365)
  const since = new Date(Date.now() - days * 24 * 3600_000)

  // Pega todas as transições do período + leads sem transição (status inicial).
  const transitions = await prisma.leadStatusHistory.findMany({
    where: { createdAt: { gte: since } },
    orderBy: [{ leadId: 'asc' }, { createdAt: 'asc' }],
    select: { leadId: true, fromStatus: true, toStatus: true, createdAt: true },
  })

  // Agrupa por lead e calcula deltas.
  const byLead = new Map<string, typeof transitions>()
  for (const t of transitions) {
    if (!byLead.has(t.leadId)) byLead.set(t.leadId, [])
    byLead.get(t.leadId)!.push(t)
  }

  // Para cada par de transições consecutivas, conta tempo gasto na etapa "from".
  const stageTotals: Record<string, { totalMs: number; count: number }> = {}
  for (const events of byLead.values()) {
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]
      const curr = events[i]
      const stage = prev.toStatus // tempo gasto NA etapa onde estava
      const ms = +new Date(curr.createdAt) - +new Date(prev.createdAt)
      if (ms > 0 && ms < 90 * 24 * 3600_000) {
        stageTotals[stage] = stageTotals[stage] ?? { totalMs: 0, count: 0 }
        stageTotals[stage].totalMs += ms
        stageTotals[stage].count++
      }
    }
  }

  const stages = Object.entries(stageTotals).map(([stage, v]) => ({
    stage,
    avgDays: +(v.totalMs / v.count / (24 * 3600_000)).toFixed(2),
    sampleCount: v.count,
  })).sort((a, b) => b.avgDays - a.avgDays)

  // Identifica gargalo (etapa com maior tempo médio).
  const bottleneck = stages[0] ?? null

  res.json({ days, stages, bottleneck, totalLeads: byLead.size })
}))

// ── GET /leads/:id/history — audit trail de mudanças de status ──────────────
leadsRouter.get('/:id/history', requireAuth, asyncHandler(async (req, res) => {
  requireFabricanteRole(req)
  const lead = await prisma.lead.findUnique({ where: { id: String(req.params.id) }, select: { id: true } })
  if (!lead) throw new NotFoundError('Lead')
  const history = await prisma.leadStatusHistory.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  res.json({ history, total: history.length })
}))

// ── POST /leads/cnpj/:cnpj — proxy BrasilAPI (público, rate-limited) ────────
//
// Não armazenamos nada aqui. Só consultamos a BrasilAPI v1
// (https://brasilapi.com.br/api/cnpj/v1/{cnpj}) e devolvemos campos úteis
// pro auto-preenchimento do wizard. Se BrasilAPI falhar, devolvemos 404 e o
// usuário preenche manualmente.
//
// POST em vez de GET pra ficar fora de qualquer cache CDN agressivo e pra
// permitir adicionar token/captcha no futuro sem quebrar URLs.

// ── Follow-ups — CRM activity timeline ───────────────────────────────────────

const FollowUpTypeEnum = z.enum(['NOTE', 'CALL', 'EMAIL', 'WHATSAPP', 'MEETING', 'TASK'])

const CreateFollowUpSchema = z.object({
  type:     FollowUpTypeEnum.optional(),
  content:  z.string().min(1).max(4000),
  dueDate:  z.string().datetime({ offset: true }).optional().nullable(),
  parentId: z.string().uuid().optional(), // resposta a outro follow-up
})

const UpdateFollowUpSchema = z.object({
  content:   z.string().min(1).max(4000).optional(),
  dueDate:   z.string().datetime({ offset: true }).optional().nullable(),
  completed: z.boolean().optional(),
})

// POST /leads/:id/follow-ups
leadsRouter.post('/:id/follow-ups', requireAuth, asyncHandler(async (req, res) => {
  requireFabricanteRole(req)
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
  if (!lead) throw new NotFoundError('Lead')

  const parse = CreateFollowUpSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

  // Se for resposta, valida que o parent existe e pertence ao mesmo lead.
  if (parse.data.parentId) {
    const parent = await (prisma as any).leadFollowUp.findUnique({ where: { id: parse.data.parentId } })
    if (!parent || parent.leadId !== lead.id) {
      throw new ValidationError('Follow-up pai não encontrado ou pertence a outro lead')
    }
  }

  const followUp = await (prisma as any).leadFollowUp.create({
    data: {
      leadId:      lead.id,
      parentId:    parse.data.parentId ?? null,
      type:        parse.data.type ?? 'NOTE',
      content:     parse.data.content,
      dueDate:     parse.data.dueDate ? new Date(parse.data.dueDate) : null,
      createdById: req.jwtPayload!.sub,
    },
  })

  // Sync FollowUp → SalesActivity (consistência de métricas)
  // Se o User criador for um SalesUser, registra como activity para bumpar goals.
  ;(async () => {
    try {
      const su = await prisma.salesUser.findFirst({ where: { userId: req.jwtPayload!.sub } })
      if (!su) return
      const created = await prisma.salesActivity.create({
        data: {
          salesUserId: su.id,
          leadId: lead.id,
          type: followUp.type as any,
          notes: followUp.content,
        },
      })
      const m = await import('../services/sales-hooks.service')
      await m.onActivityCreated(created)
    } catch (err: any) {
      logger.warn({ err: err.message }, 'followup_to_activity_sync_failed')
    }
  })()

  logger.info({ leadId: lead.id, followUpId: followUp.id, type: followUp.type }, 'follow_up_created')
  res.status(201).json(followUp)
}))

// GET /leads/:id/follow-ups
leadsRouter.get('/:id/follow-ups', requireAuth, asyncHandler(async (req, res) => {
  requireFabricanteRole(req)
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
  if (!lead) throw new NotFoundError('Lead')

  const items = await (prisma as any).leadFollowUp.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'desc' },
  })

  // Enriquece com nome/role do criador para a UI mostrar quem comentou.
  const userIds = Array.from(new Set(items.map((i: any) => i.createdById).filter(Boolean)))
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds as string[] } },
        select: { id: true, name: true, role: true },
      })
    : []
  const userMap = new Map(users.map(u => [u.id, u]))
  const enriched = items.map((i: any) => ({
    ...i,
    createdByName: userMap.get(i.createdById)?.name ?? null,
    createdByRole: userMap.get(i.createdById)?.role ?? null,
  }))

  res.json({ items: enriched })
}))

// PATCH /leads/:id/follow-ups/:fid
leadsRouter.patch('/:id/follow-ups/:fid', requireAuth, asyncHandler(async (req, res) => {
  requireFabricanteRole(req)

  const followUp = await (prisma as any).leadFollowUp.findFirst({
    where: { id: req.params.fid, leadId: req.params.id },
  })
  if (!followUp) throw new NotFoundError('Follow-up')

  const parse = UpdateFollowUpSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

  const patch: Record<string, unknown> = {}
  if (parse.data.content   !== undefined) patch.content   = parse.data.content
  if (parse.data.dueDate   !== undefined) patch.dueDate   = parse.data.dueDate ? new Date(parse.data.dueDate) : null
  if (parse.data.completed !== undefined) patch.completed = parse.data.completed

  const updated = await (prisma as any).leadFollowUp.update({
    where: { id: followUp.id },
    data: patch,
  })

  res.json(updated)
}))

// DELETE /leads/:id/follow-ups/:fid
leadsRouter.delete('/:id/follow-ups/:fid', requireAuth, asyncHandler(async (req, res) => {
  requireFabricanteRole(req)

  const followUp = await (prisma as any).leadFollowUp.findFirst({
    where: { id: req.params.fid, leadId: req.params.id },
  })
  if (!followUp) throw new NotFoundError('Follow-up')

  await (prisma as any).leadFollowUp.delete({ where: { id: followUp.id } })
  res.status(204).end()
}))

// ── POST /leads/cnpj/:cnpj — proxy BrasilAPI (público, rate-limited) ────────

leadsRouter.post('/cnpj/:cnpj', asyncHandler(async (req, res) => {
  const cnpj = normalizeCnpj(req.params.cnpj)
  if (!cnpj) throw new ValidationError('CNPJ inválido (precisa ter 14 dígitos)')

  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { 'User-Agent': 'iacloudvision-leads/1.0' },
      // Timeout: usamos AbortController pra evitar pendurar o request.
      signal: AbortSignal.timeout(7_000),
    })
    if (!resp.ok) {
      logger.info({ cnpj, status: resp.status }, 'brasilapi_cnpj_not_found')
      throw new NotFoundError('CNPJ')
    }
    const json: any = await resp.json()
    res.json({
      cnpj,
      razaoSocial:    json.razao_social ?? json.nome ?? null,
      nomeFantasia:   json.nome_fantasia ?? null,
      situacao:       json.descricao_situacao_cadastral ?? null,
      cidade:         json.municipio ?? null,
      uf:             json.uf ?? null,
      bairro:         json.bairro ?? null,
      logradouro:     json.logradouro ?? null,
      cep:            json.cep ?? null,
      telefone:       json.ddd_telefone_1 ?? null,
      email:          json.email ?? null,
      cnaePrincipal:  json.cnae_fiscal_descricao ?? null,
    })
  } catch (err: any) {
    if (err instanceof NotFoundError) throw err
    logger.warn({ err: err?.message, cnpj }, 'brasilapi_cnpj_lookup_failed')
    // Não vaza detalhes do erro de upstream. Cliente preenche manual.
    throw new NotFoundError('CNPJ')
  }
}))
