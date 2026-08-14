/**
 * billing-notification — cron que notifica integradores sobre faturas a vencer
 * ou em atraso. Despacha email + push (WebPush via PushSubscription).
 *
 * Janelas (UTC):
 *   T-3  →  fatura vence em 3 dias
 *   T-1  →  fatura vence em 1 dia
 *   T-0  →  fatura vence HOJE
 *   OVERDUE → fatura vencida (notifica 1× por dia até cobrar/pagar)
 *
 * Idempotência: BillingNotificationLog grava (invoiceId, kind) — não envia 2x.
 * (Esse modelo é simples; podemos criar uma tabela dedicada futuramente.)
 *
 * Por simplicidade nesta versão, idempotência é em memória (in-process Set).
 * Em multi-réplica precisaria DB-backed — TODO se virar problema.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { sendMail } from '../lib/smtp'
import { broadcast } from '../lib/webpush'

const POLL_MS = Number(process.env.BILLING_NOTIF_TICK_MS ?? 6 * 3600_000) // 4× ao dia
let _timer: ReturnType<typeof setInterval> | null = null

type NotifKind = 'T-3' | 'T-1' | 'T-0' | 'OVERDUE'

// Idempotência in-process — chave: `${invoiceId}:${kind}:${YYYY-MM-DD}`
const _sentToday = new Set<string>()
function dedupeKey(invoiceId: string, kind: NotifKind): string {
  return `${invoiceId}:${kind}:${new Date().toISOString().slice(0, 10)}`
}

interface InvoiceLite {
  id:              string
  integradorId:    string
  totalAmountBrl:  any
  dueDate:         Date | null
  status:          string
  asaasPaymentUrl: string | null
}

interface IntegradorContact {
  id: string
  name: string
  email: string
}

async function getIntegradorContact(integradorId: string): Promise<IntegradorContact | null> {
  // Pega admin do integrador como contato. Se não tiver, cai no email principal do tenant.
  const integ = await prisma.integrador.findUnique({
    where:  { id: integradorId },
    select: {
      id: true, name: true, email: true,
      users: {
        where:   { role: 'INTEGRADOR_ADMIN', active: true },
        select:  { email: true, name: true },
        take:    1,
      },
    },
  })
  if (!integ) return null
  const userEmail = (integ as any).users?.[0]?.email
  return {
    id:    integ.id,
    name:  integ.name,
    email: userEmail ?? integ.email,
  }
}

function buildSubject(kind: NotifKind, valor: number): string {
  switch (kind) {
    case 'T-3':     return `Sua fatura iaCloud Vision vence em 3 dias (R$ ${valor.toFixed(2).replace('.', ',')})`
    case 'T-1':     return `Sua fatura iaCloud Vision vence amanhã (R$ ${valor.toFixed(2).replace('.', ',')})`
    case 'T-0':     return `Sua fatura iaCloud Vision vence hoje (R$ ${valor.toFixed(2).replace('.', ',')})`
    case 'OVERDUE': return `[ATRASADA] Fatura iaCloud Vision em aberto (R$ ${valor.toFixed(2).replace('.', ',')})`
  }
}

function buildEmailBody(kind: NotifKind, integ: IntegradorContact, inv: InvoiceLite): { text: string; html: string } {
  const valor = Number(inv.totalAmountBrl).toFixed(2).replace('.', ',')
  const due   = inv.dueDate ? inv.dueDate.toLocaleDateString('pt-BR') : '—'
  const link  = inv.asaasPaymentUrl ?? 'https://app.vsaas.com.br/me/integrador/billing'

  const intro = kind === 'OVERDUE'
    ? `Sua fatura está <strong>em atraso desde ${due}</strong>. Regularize agora para evitar suspensão das suas câmeras.`
    : kind === 'T-0'
      ? `Sua fatura vence <strong>hoje</strong> (${due}).`
      : kind === 'T-1'
        ? `Sua fatura vence <strong>amanhã</strong> (${due}).`
        : `Sua fatura vence em <strong>3 dias</strong> (${due}).`

  const text = `Olá, ${integ.name},\n\n${intro.replace(/<[^>]+>/g, '')}\n\nValor: R$ ${valor}\nPagar: ${link}\n\nDúvidas: app.vsaas.com.br/me/integrador/billing\n— Equipe iaCloud Vision`

  const html = `
    <p>Olá, <strong>${integ.name}</strong>,</p>
    <p>${intro}</p>
    <table style="border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding:6px 12px; color:#666;">Valor</td><td style="padding:6px 12px;"><strong>R$ ${valor}</strong></td></tr>
      <tr><td style="padding:6px 12px; color:#666;">Vencimento</td><td style="padding:6px 12px;">${due}</td></tr>
    </table>
    <p>
      <a href="${link}" style="background:#10b981; color:white; padding:10px 18px; border-radius:6px; text-decoration:none; display:inline-block;">
        Pagar agora
      </a>
    </p>
    <p style="font-size:12px; color:#666; margin-top:24px;">
      Ver detalhes em
      <a href="https://app.vsaas.com.br/me/integrador/billing">app.vsaas.com.br/me/integrador/billing</a>
    </p>
    <p style="font-size:11px; color:#999;">— Equipe iaCloud Vision</p>
  `
  return { text, html }
}

async function sendNotification(invoice: InvoiceLite, kind: NotifKind): Promise<void> {
  const key = dedupeKey(invoice.id, kind)
  if (_sentToday.has(key)) return
  _sentToday.add(key)

  const integ = await getIntegradorContact(invoice.integradorId)
  if (!integ?.email) {
    logger.warn({ invoiceId: invoice.id }, 'billing_notif_no_contact')
    return
  }

  const valor = Number(invoice.totalAmountBrl)
  const subject = buildSubject(kind, valor)
  const { text, html } = buildEmailBody(kind, integ, invoice)

  // Email + Push em paralelo (ambos best-effort)
  await Promise.all([
    sendMail({ to: integ.email, subject, text, html, integradorId: invoice.integradorId })
      .catch(err => logger.warn({ err, invoiceId: invoice.id, kind }, 'billing_notif_email_failed')),
    broadcast({ integradorId: invoice.integradorId }, {
      title: subject,
      body:  kind === 'OVERDUE' ? 'Toque para pagar agora.' : `Vencimento: ${invoice.dueDate?.toLocaleDateString('pt-BR') ?? ''}`,
      tag:   `billing-${invoice.id}-${kind}`,
      url:   '/me/integrador/billing',
    } as any)
      .catch(err => logger.warn({ err, invoiceId: invoice.id, kind }, 'billing_notif_push_failed')),
  ])

  logger.info({ invoiceId: invoice.id, integradorId: invoice.integradorId, kind, email: integ.email }, 'billing_notif_sent')
}

/**
 * Roda 1 tick: busca invoices em janelas T-3/T-1/T-0/OVERDUE e dispara.
 */
export async function tickBillingNotifications(): Promise<{
  found: number; sent: number; skipped: number
}> {
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // Calcular ranges (UTC dia-a-dia)
  const inDays = (n: number) => new Date(today.getTime() + n * 86400_000)
  const ranges: Array<{ kind: NotifKind; start: Date; end: Date; status: string[] }> = [
    { kind: 'T-3',     start: inDays(3), end: inDays(4), status: ['PENDING'] },
    { kind: 'T-1',     start: inDays(1), end: inDays(2), status: ['PENDING'] },
    { kind: 'T-0',     start: inDays(0), end: inDays(1), status: ['PENDING'] },
    { kind: 'OVERDUE', start: new Date(0), end: today, status: ['OVERDUE', 'PENDING'] },
  ]

  let found = 0, sent = 0, skipped = 0

  for (const r of ranges) {
    const invs = await prisma.invoice.findMany({
      where: {
        status: { in: r.status },
        dueDate: { gte: r.start, lt: r.end },
      },
      select: {
        id: true, integradorId: true, totalAmountBrl: true,
        dueDate: true, status: true, asaasPaymentUrl: true,
      },
    })
    found += invs.length

    for (const inv of invs) {
      const key = dedupeKey(inv.id, r.kind)
      if (_sentToday.has(key)) { skipped++; continue }
      try {
        await sendNotification(inv, r.kind)
        sent++
      } catch (err) {
        logger.error({ err, invoiceId: inv.id, kind: r.kind }, 'billing_notif_failed')
      }
    }
  }

  logger.info({ found, sent, skipped }, 'billing_notif_tick_done')
  return { found, sent, skipped }
}

// Limpa cache de dedupe à meia-noite UTC
function clearDedupeIfNewDay(): void {
  const today = new Date().toISOString().slice(0, 10)
  // Mantém só chaves de hoje (descarta de ontem)
  for (const k of _sentToday) {
    if (!k.endsWith(`:${today}`)) _sentToday.delete(k)
  }
}

export const billingNotificationService = {
  start(): void {
    if (_timer) return
    _timer = setInterval(() => {
      clearDedupeIfNewDay()
      tickBillingNotifications().catch(err =>
        logger.error({ err }, 'billing_notif_tick_error'),
      )
    }, POLL_MS)
    logger.info({ pollMs: POLL_MS }, 'billing_notification_service_started')
  },
  stop(): void {
    if (_timer) { clearInterval(_timer); _timer = null }
  },
  triggerNow: tickBillingNotifications,
}
