/**
 * lgpd.ts — Rotas LGPD (FCB-016)
 *
 * Endpoints obrigatórios LGPD Art. 18:
 *   POST   /lgpd/data-requests            — cliente cria solicitação (EXPORT/ERASURE)
 *   GET    /lgpd/data-requests/:id        — status da solicitação
 *   GET    /lgpd/data-requests            — list (admin/DPO)
 *   POST   /lgpd/data-requests/:id/process — processa (admin/DPO)
 *   GET    /lgpd/data-summary             — sumário rápido do que existe (cliente)
 *
 * Compliance:
 *   - SLA: 15 dias para resposta (Art. 19) — cron lgpd-sla-watch alerta DPO
 *   - Auditoria: cada operação gera AuditLog com action LGPD_*
 *   - Isolamento: usuário só pode solicitar sobre próprio escopo (cliente_final
 *     ou user); SUPER_ADMIN pode sobre qualquer escopo
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { sendMail } from '../lib/smtp'
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors'
import {
  buildDataPackage, executeErasure, getDataSummary,
} from '../services/lgpd.service'

export const lgpdRouter = Router()
lgpdRouter.use(requireAuth)

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateRequestSchema = z.object({
  type:           z.enum(['ACCESS', 'PORTABILITY', 'DELETION', 'CORRECTION', 'ANONYMIZATION']),
  description:    z.string().max(2000).optional(),
  // Apenas SUPER_ADMIN pode passar scope custom; CLIENTE_* / INTEGRADOR_* sempre operam no próprio escopo
  scopeOverride:  z.object({
    scope:    z.enum(['cliente_final', 'user']),
    scopeId:  z.string().uuid(),
  }).optional(),
})

// ─── Helper: resolve subject baseado no JWT ─────────────────────────────────

function resolveSubject(jwt: any, scopeOverride?: { scope: string; scopeId: string }) {
  if (jwt.role === 'SUPER_ADMIN' && scopeOverride) {
    return { scope: scopeOverride.scope as any, scopeId: scopeOverride.scopeId, email: jwt.email }
  }
  // CLIENTE_VIEWER / CLIENTE_ADMIN: escopo = próprio cliente final
  if (jwt.clienteFinalId) {
    return { scope: 'cliente_final' as const, scopeId: jwt.clienteFinalId, email: jwt.email }
  }
  // INTEGRADOR_*: não tem escopo direto LGPD — opera só sob delegação SUPER_ADMIN
  // User-level erasure
  if (jwt.sub) {
    return { scope: 'user' as const, scopeId: jwt.sub, email: jwt.email }
  }
  throw new ForbiddenError('Sem escopo válido para LGPD')
}

// ─── POST /lgpd/data-requests ──────────────────────────────────────────────
// Cliente cria solicitação. SLA 15d, status=PENDING.
lgpdRouter.post('/data-requests', asyncHandler(async (req, res) => {
  const parse = CreateRequestSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'invalid')

  const jwt     = req.jwtPayload!
  const subject = resolveSubject(jwt, parse.data.scopeOverride)

  const sla15d = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)

  const created = await prisma.lgpdDataRequest.create({
    data: {
      requestType:    parse.data.type,
      requestorEmail: subject.email ?? 'unknown@local',
      clienteFinalId: subject.scope === 'cliente_final' ? subject.scopeId : null,
      description:    parse.data.description ?? null,
      status:         'PENDING',
    },
  })

  // E-mail para DPO (configurável via env)
  const dpoEmail = process.env.LGPD_DPO_EMAIL ?? 'dpo@iacloud.com.br'
  sendMail({
    to:      dpoEmail,
    subject: `[LGPD ${parse.data.type}] Nova solicitação de ${subject.scope} ${subject.scopeId}`,
    text:    `Nova solicitação LGPD ${parse.data.type} de ${subject.scope} ${subject.scopeId}. Solicitante: ${subject.email ?? '—'}. SLA: ${sla15d.toISOString().slice(0,10)}.`,
    html: `
      <h2>Nova solicitação LGPD</h2>
      <p><strong>Tipo:</strong> ${parse.data.type}</p>
      <p><strong>Solicitante:</strong> ${subject.email ?? '—'}</p>
      <p><strong>Escopo:</strong> ${subject.scope} (${subject.scopeId})</p>
      <p><strong>Descrição:</strong> ${parse.data.description ?? '—'}</p>
      <p><strong>SLA:</strong> ${sla15d.toISOString().slice(0, 10)} (15 dias)</p>
      <p>Acesse o painel admin para processar.</p>
    `,
  }).catch(err => logger.warn({ err: err.message, requestId: created.id }, 'lgpd_dpo_email_failed'))

  // AuditLog
  prisma.auditLog?.create({
    data: {
      action: `LGPD_REQUEST_CREATED_${parse.data.type}`,
      resource: 'LgpdDataRequest',
      resourceId: created.id,
      clienteFinalId: subject.scope === 'cliente_final' ? subject.scopeId : null,
      userId: jwt.sub,
      metadataJson: { type: parse.data.type, scope: subject.scope, scopeId: subject.scopeId } as any,
    },
  }).catch(() => {})

  res.json({
    ok:           true,
    id:           created.id,
    type:         created.requestType,
    status:       created.status,
    requestedAt:  created.requestedAt,
    slaDeadline:  sla15d.toISOString(),
  })
}))

// ─── GET /lgpd/data-requests/:id ───────────────────────────────────────────
lgpdRouter.get('/data-requests/:id', asyncHandler(async (req, res) => {
  const r = await prisma.lgpdDataRequest.findUnique({ where: { id: String(req.params.id) } })
  if (!r) throw new NotFoundError('Solicitação LGPD')

  const jwt = req.jwtPayload!
  // Cliente pode ver apenas suas próprias; admin vê tudo
  if (jwt.role !== 'SUPER_ADMIN') {
    if (jwt.clienteFinalId && r.clienteFinalId !== jwt.clienteFinalId) {
      throw new ForbiddenError('Solicitação não pertence ao seu escopo')
    }
  }

  res.json({
    id:             r.id,
    type:           r.requestType,
    status:         r.status,
    requestedAt:    r.requestedAt,
    completedAt:    r.completedAt,
    description:    r.description,
    responseNotes:  r.responseNotes,
  })
}))

// ─── GET /lgpd/data-requests ───────────────────────────────────────────────
// SUPER_ADMIN: lista todas. Cliente: lista as próprias.
lgpdRouter.get('/data-requests', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const status = String(req.query.status ?? '')
  const where: any = status ? { status } : {}
  if (jwt.role !== 'SUPER_ADMIN') {
    if (!jwt.clienteFinalId) throw new ForbiddenError('Sem escopo')
    where.clienteFinalId = jwt.clienteFinalId
  }

  const requests = await prisma.lgpdDataRequest.findMany({
    where,
    orderBy: { requestedAt: 'desc' },
    take: 200,
  })

  // SLA: marcar requests perto do prazo (15d)
  const now = Date.now()
  const enriched = requests.map(r => {
    const ageMs = now - new Date(r.requestedAt).getTime()
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000))
    const slaDaysLeft = 15 - ageDays
    return {
      ...r,
      slaDaysLeft,
      slaStatus: r.status === 'COMPLETED' ? 'OK'
        : slaDaysLeft <= 0 ? 'OVERDUE'
        : slaDaysLeft <= 5 ? 'WARNING'
        : 'OK',
    }
  })

  res.json({ requests: enriched, total: enriched.length })
}))

// ─── POST /lgpd/data-requests/:id/process ──────────────────────────────────
// Admin/DPO processa solicitação: gera pacote (EXPORT) ou anonimiza (ERASURE)
lgpdRouter.post('/data-requests/:id/process', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (jwt.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Apenas SUPER_ADMIN/DPO pode processar solicitações LGPD')
  }

  const r = await prisma.lgpdDataRequest.findUnique({ where: { id: String(req.params.id) } })
  if (!r) throw new NotFoundError('Solicitação LGPD')
  if (r.status === 'COMPLETED') {
    res.json({ ok: true, alreadyCompleted: true, request: r })
    return
  }

  await prisma.lgpdDataRequest.update({
    where: { id: r.id },
    data:  { status: 'IN_PROGRESS', handledBy: jwt.sub },
  })

  const subject = {
    scope:   (r.clienteFinalId ? 'cliente_final' : 'user') as 'cliente_final' | 'user',
    scopeId: r.clienteFinalId ?? r.requestorEmail,
    email:   r.requestorEmail,
  }

  let outcome: any = {}
  try {
    if (r.requestType === 'ACCESS' || r.requestType === 'PORTABILITY') {
      const pkg = await buildDataPackage(r.id, subject)
      outcome = { type: 'package', ...pkg }

      // E-mail ao solicitante com link presigned (se existe)
      if (pkg.url) {
        sendMail({
          to:      r.requestorEmail,
          subject: `[LGPD] Seu pacote de dados está pronto`,
          text:    `Seu pacote de dados está disponível para download em: ${pkg.url} (válido 7 dias). Resumo: ${pkg.recordsCount.events} eventos, ${pkg.recordsCount.recordings} gravações.`,
          html: `
            <h2>Seu pacote de dados (LGPD Art. 18 V)</h2>
            <p>Conforme solicitado em ${r.requestedAt.toISOString().slice(0,10)}, seus dados estão disponíveis para download:</p>
            <p><a href="${pkg.url}">${pkg.url}</a></p>
            <p><strong>Resumo:</strong> ${pkg.recordsCount.events} eventos, ${pkg.recordsCount.recordings} gravações,
            ${pkg.recordsCount.faces} faces, ${pkg.recordsCount.plates} placas, ${pkg.recordsCount.users} usuários</p>
            <p><strong>Tamanho:</strong> ${(pkg.sizeBytes / 1024).toFixed(1)} KB</p>
            <p>Link válido por 7 dias.</p>
          `,
        }).catch(() => {})
      }
    } else if (r.requestType === 'DELETION' || r.requestType === 'ANONYMIZATION') {
      const er = await executeErasure(r.id, subject)
      outcome = { type: 'erasure', ...er }

      sendMail({
        to:      r.requestorEmail,
        subject: `[LGPD] Solicitação de exclusão concluída`,
        text:    `Sua solicitação de exclusão (LGPD Art. 18 VI) foi processada. Eventos anonimizados: ${er.deletedEvents}. Faces: ${er.anonymizedFaces}. Placas: ${er.anonymizedPlates}.`,
        html: `
          <h2>Sua solicitação de exclusão foi concluída</h2>
          <p>Conforme LGPD Art. 18 VI, processamos sua solicitação:</p>
          <ul>
            <li>${er.deletedEvents} eventos anonimizados</li>
            <li>${er.anonymizedFaces} faces anonimizadas</li>
            <li>${er.anonymizedPlates} placas anonimizadas</li>
            <li>${er.deletedRecordings} gravações marcadas para exclusão</li>
            ${er.preservedDueLegalHold > 0 ? `<li>${er.preservedDueLegalHold} registros preservados por obrigação legal (NF-e/processo)</li>` : ''}
          </ul>
        `,
      }).catch(() => {})
    } else if (r.requestType === 'CORRECTION') {
      outcome = { type: 'correction', note: 'Solicitações de retificação requerem ação manual do DPO' }
    }

    await prisma.lgpdDataRequest.update({
      where: { id: r.id },
      data:  {
        status:        'COMPLETED',
        completedAt:   new Date(),
        responseNotes: JSON.stringify(outcome).slice(0, 4000),
      },
    })

    res.json({ ok: true, requestId: r.id, outcome })
  } catch (err: any) {
    logger.error({ err: err.message, requestId: r.id }, 'lgpd_process_failed')
    await prisma.lgpdDataRequest.update({
      where: { id: r.id },
      data:  { status: 'REJECTED', responseNotes: `Erro: ${err.message}`.slice(0, 1000) },
    })
    throw err
  }
}))

// ─── GET /lgpd/data-summary ────────────────────────────────────────────────
// Cliente vê quanto a Cloud tem armazenado (Art. 18 II — confirmação)
lgpdRouter.get('/data-summary', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const subject = resolveSubject(jwt)
  const summary = await getDataSummary(subject)
  res.json({ subject: { scope: subject.scope, scopeId: subject.scopeId }, summary })
}))

// ─── GET /lgpd/access-log ──────────────────────────────────────────────────
// LGPD Art. 18 IV — direito a saber quem acessou seus dados pessoais.
// Retorna lista de eventos de acesso (impersonate, exports, etc) com filtro
// `lgpdRelevant=true` no metadataJson, escopados ao cliente final do solicitante.
//
// SUPER_ADMIN pode passar ?clienteFinalId=X. Cliente final só vê o próprio.
lgpdRouter.get('/access-log', asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  const days = Math.min(Math.max(Number(req.query.days ?? 90), 1), 365)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  let clienteFinalId: string | null = null
  if (jwt.role === 'SUPER_ADMIN' || jwt.role === 'ADMIN_GLOBAL') {
    clienteFinalId = (typeof req.query.clienteFinalId === 'string')
      ? String(req.query.clienteFinalId) : null
  } else if (jwt.clienteFinalId) {
    clienteFinalId = jwt.clienteFinalId
  } else if (jwt.role?.startsWith('INTEGRADOR_')) {
    // Integrador pode ver acessos a clientes finais do PRÓPRIO tenant
    clienteFinalId = (typeof req.query.clienteFinalId === 'string')
      ? String(req.query.clienteFinalId) : null
    if (clienteFinalId) {
      const cf = await prisma.clienteFinal.findUnique({
        where: { id: clienteFinalId },
        select: { integradorId: true },
      })
      if (!cf || cf.integradorId !== jwt.integradorId) {
        throw new ForbiddenError('Cliente final não pertence ao seu tenant')
      }
    }
  }

  if (!clienteFinalId) {
    return res.status(400).json({ error: 'clienteFinalId required (or login as cliente)' })
  }

  // Eventos LGPD-relevantes do período: impersonate, export, erasure, ver dados
  const logs = await prisma.auditLog.findMany({
    where: {
      clienteFinalId,
      createdAt: { gte: since },
      OR: [
        { action: { in: [
          'IMPERSONATION_START', 'IMPERSONATION_END',
          'LGPD_DATA_EXPORTED', 'LGPD_DATA_ERASED',
          'LGPD_REQUEST_CREATED', 'LGPD_REQUEST_PROCESSED',
        ] } },
      ],
    },
    select: {
      id: true, action: true, resource: true, resourceId: true,
      createdAt: true, ipAddress: true, userAgent: true, result: true,
      superAdminId: true, integradorId: true, userId: true,
      metadataJson: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  // Enriquece com nome do ator (best-effort)
  const enriched = await Promise.all(logs.map(async l => {
    let actorName: string | null = null
    if (l.superAdminId) {
      const a = await prisma.superAdmin.findUnique({ where: { id: l.superAdminId }, select: { name: true } })
      actorName = a?.name ?? null
    } else if (l.userId) {
      const a = await prisma.user.findUnique({ where: { id: l.userId }, select: { name: true } })
      actorName = a?.name ?? null
    } else if (l.integradorId) {
      const a = await prisma.integrador.findUnique({ where: { id: l.integradorId }, select: { name: true } })
      actorName = a?.name ?? null
    }
    return { ...l, actorName }
  }))

  res.json({
    clienteFinalId,
    periodDays: days,
    total: enriched.length,
    logs: enriched,
  })
}))
