/**
 * invoice-generator — gera Invoice mensal pra cada integrador.
 *
 * Modelo de cobrança (Opção Y, decidida 2026-06-24):
 *   1. Cron dia 1 às 04h do mês
 *   2. Pra cada integrador ativo (com AsaasCustomer):
 *      a. Soma ClienteSubscription ACTIVE do mês anterior
 *      b. Calcula totalBrl (basePriceUsd × cameras × USD→BRL)
 *      c. Cria 1 Invoice + N InvoiceLineItem
 *      d. Chama Asaas createPayment → boleto/PIX/cartão
 *      e. Salva asaasPaymentId + invoiceUrl no Invoice
 *   3. Asaas envia boleto/email pro integrador
 *   4. Quando pago → webhook PAYMENT_RECEIVED → handlePaid marca paidAt
 *
 * Idempotência: UNIQUE (integradorId, periodStart) — re-rodar é seguro.
 *
 * Modo dry-run: NÃO chama Asaas, NÃO cria nada. Útil pra validar números.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import {
  isBillingEnabled,
  createPayment,
  AsaasApiError,
  BillingDisabledError,
} from './asaas.service'

const USD_TO_BRL = Number(process.env.USD_TO_BRL ?? 5.20)
const DEFAULT_DUE_DAYS = Number(process.env.BILLING_DUE_DAYS ?? 7)
const DEFAULT_BILLING_TYPE = (process.env.BILLING_DEFAULT_TYPE ?? 'UNDEFINED') as
  'BOLETO' | 'CREDIT_CARD' | 'PIX' | 'UNDEFINED'

export interface GenerateOptions {
  /** Mês de referência (YYYY-MM). Default: mês corrente. */
  yearMonth?:    string
  /** Dia do vencimento. Default: ENV BILLING_DUE_DAYS dias após geração. */
  dueDays?:      number
  /** Se true, calcula tudo mas NÃO grava no DB nem chama Asaas. */
  dryRun?:       boolean
  /** Filtrar a 1 integrador (admin override). Null = todos. */
  integradorId?: string | null
  /** Se true, força regerar mesmo se já existe Invoice no período (ATENÇÃO: cancela payment Asaas antigo). */
  force?:        boolean
}

export interface GenerateResult {
  yearMonth:     string
  dryRun:        boolean
  processed:     number   /// integradores avaliados
  generated:     number   /// invoices novas criadas
  skipped:       number   /// já existia (idempotente)
  asaasErrors:   number   /// falhas ao criar payment no Asaas
  details:       Array<{
    integradorId:  string
    integradorName: string
    status:        'generated' | 'skipped' | 'asaas_failed' | 'no_subs'
    invoiceId?:    string
    totalBrl?:     number
    lineItems?:    number
    error?:        string
  }>
}

/**
 * Calcula período do mês (1º dia 00:00:00 → próximo 1º dia 00:00:00).
 * Aceita YYYY-MM ou Date.
 */
export function periodOf(yearMonth?: string | Date): { start: Date; end: Date; label: string } {
  let y: number, m: number
  if (typeof yearMonth === 'string') {
    const [ys, ms] = yearMonth.split('-')
    y = Number(ys); m = Number(ms) - 1
  } else if (yearMonth instanceof Date) {
    y = yearMonth.getUTCFullYear(); m = yearMonth.getUTCMonth()
  } else {
    const now = new Date()
    y = now.getUTCFullYear(); m = now.getUTCMonth()
  }
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0))
  const end   = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0))
  const label = `${y}-${String(m + 1).padStart(2, '0')}`
  return { start, end, label }
}

interface SubLineCalc {
  /// null = line-item da plataforma (mensalidade ou adicional do plano), não do marketplace
  clienteSubscriptionId: string | null
  clienteFinalId:        string | null
  productSlug:           string
  productName:           string
  cameraCount:           number
  cameraIds:             string[]
  /// USD pra produtos marketplace; 0 pra mensalidade/adicionais (são BRL direto)
  unitPriceUsd:          number
  subtotalBrl:           number
  metadata:              any
}

/// Slugs reservados pra line-items da plataforma (eixo 1).
/// Nunca colidem com slugs de MarketplaceProduct (validação no admin).
const SLUG_PLAN_FEE         = '__platform-plan-fee__'
const SLUG_PLAN_EXTRA_CLI   = '__platform-extra-client__'
const SLUG_PLAN_EXTRA_CAM   = '__platform-extra-camera__'

/**
 * Calcula as linhas da plataforma (mensalidade + adicionais) pro integrador no período.
 * Sprint 0 · Variação B · D3 SOMA.
 *
 * Pro-rata na ativação meio do mês (D1): se planActivatedAt cai dentro do período,
 * mensalidade é proporcional aos dias restantes.
 *
 * Soft cap (D4): cobra adicional automaticamente quando ultrapassa limite (sem trava).
 * Hard cap: não cobra adicional (porque cadastro já foi bloqueado no enforcement).
 */
async function computePlanLines(
  integradorId: string,
  period: { start: Date; end: Date; label: string },
): Promise<SubLineCalc[]> {
  const integ = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: {
      planActivatedAt: true,
      trialEndsAt: true,
      maxClientesFinaisOverride: true, maxCamerasOverride: true,
      plan: {
        select: {
          slug: true, name: true,
          priceMonthly: true,
          maxClientesFinais: true, maxCameras: true,
          extraClientePriceBrl: true, extraCameraPriceBrl: true,
          isTrial: true, enforcementMode: true,
        },
      },
    },
  })

  if (!integ?.plan) return []
  const plan = integ.plan

  // Trial não cobra mensalidade nem adicionais
  if (plan.isTrial) return []

  const lines: SubLineCalc[] = []
  const periodDays = Math.round((period.end.getTime() - period.start.getTime()) / 86400_000)

  // 1) Mensalidade do plano (com pro-rata se ativação meio do período)
  const monthly = Number(plan.priceMonthly ?? 0)
  if (monthly > 0) {
    let chargeBrl = monthly
    let activationNote: string | null = null

    if (integ.planActivatedAt && integ.planActivatedAt > period.start && integ.planActivatedAt < period.end) {
      const remainingDays = Math.max(1, Math.round((period.end.getTime() - integ.planActivatedAt.getTime()) / 86400_000))
      chargeBrl = Number((monthly * (remainingDays / periodDays)).toFixed(2))
      activationNote = `Pro-rata: ativado em ${integ.planActivatedAt.toISOString().slice(0, 10)} — ${remainingDays} de ${periodDays} dias`
    }

    lines.push({
      clienteSubscriptionId: null,
      clienteFinalId:        null,
      productSlug:           SLUG_PLAN_FEE,
      productName:           `Plano ${plan.name} · mensalidade`,
      cameraCount:           0,
      cameraIds:             [],
      unitPriceUsd:          0,
      subtotalBrl:           chargeBrl,
      metadata: {
        planSlug:    plan.slug,
        periodDays,
        proRated:    !!activationNote,
        proRataNote: activationNote,
      },
    })
  }

  // 2) Adicionais — só soft cap (hard cap bloqueia no enforcement, não cobra)
  if (plan.enforcementMode !== 'soft') return lines

  // Snapshot de uso no fim do período (= início do próximo mês)
  const [clientesAtivos, camerasAtivas] = await Promise.all([
    prisma.clienteFinal.count({ where: { integradorId, active: true } }),
    prisma.camera.count({
      where: {
        active: true,
        site: { clienteFinal: { integradorId, active: true } },
      },
    }),
  ])

  const limitClientes = integ.maxClientesFinaisOverride ?? plan.maxClientesFinais ?? null
  const limitCameras  = integ.maxCamerasOverride        ?? plan.maxCameras        ?? null

  if (limitClientes != null && clientesAtivos > limitClientes) {
    const excedente   = clientesAtivos - limitClientes
    const unitPrice   = Number(plan.extraClientePriceBrl ?? 0)
    if (unitPrice > 0) {
      lines.push({
        clienteSubscriptionId: null,
        clienteFinalId:        null,
        productSlug:           SLUG_PLAN_EXTRA_CLI,
        productName:           `${excedente} cliente${excedente > 1 ? 's' : ''} adiciona${excedente > 1 ? 'is' : 'l'} (acima do plano)`,
        cameraCount:           excedente,
        cameraIds:             [],
        unitPriceUsd:          0,
        subtotalBrl:           Number((unitPrice * excedente).toFixed(2)),
        metadata: {
          planSlug:  plan.slug,
          limit:     limitClientes,
          actual:    clientesAtivos,
          unitPriceBrl: unitPrice,
        },
      })
    }
  }

  if (limitCameras != null && camerasAtivas > limitCameras) {
    const excedente   = camerasAtivas - limitCameras
    const unitPrice   = Number(plan.extraCameraPriceBrl ?? 0)
    if (unitPrice > 0) {
      lines.push({
        clienteSubscriptionId: null,
        clienteFinalId:        null,
        productSlug:           SLUG_PLAN_EXTRA_CAM,
        productName:           `${excedente} câmera${excedente > 1 ? 's' : ''} adiciona${excedente > 1 ? 'is' : 'l'} (acima do plano)`,
        cameraCount:           excedente,
        cameraIds:             [],
        unitPriceUsd:          0,
        subtotalBrl:           Number((unitPrice * excedente).toFixed(2)),
        metadata: {
          planSlug:  plan.slug,
          limit:     limitCameras,
          actual:    camerasAtivas,
          unitPriceBrl: unitPrice,
        },
      })
    }
  }

  return lines
}

/**
 * Para um integrador, retorna a lista de linhas que comporiam a fatura do período.
 * Não persiste nada — só calcula. Útil pra preview no painel admin/integrador.
 */
export async function previewInvoice(
  integradorId: string,
  yearMonth?: string,
): Promise<{ period: ReturnType<typeof periodOf>; lines: SubLineCalc[]; totalBrl: number }> {
  const period = periodOf(yearMonth)

  const subs = await prisma.clienteSubscription.findMany({
    where: {
      status:       'ACTIVE',
      startedAt:    { lt: period.end },
      OR: [
        { canceledAt: null },
        { canceledAt: { gt: period.start } },
      ],
      clienteFinal: { integradorId },
    },
    include: {
      product:      { select: { slug: true, name: true, metadata: true } },
      clienteFinal: { select: { id: true, name: true, tradeName: true } },
    },
  })

  const marketplaceLines: SubLineCalc[] = subs.map(s => {
    const cameraCount = s.cameraIds?.length ?? 0
    const unit        = Number(s.basePriceUsd)
    const subtotal    = Number((unit * cameraCount * USD_TO_BRL).toFixed(2))
    return {
      clienteSubscriptionId: s.id,
      clienteFinalId:        s.clienteFinalId,
      productSlug:           s.product.slug,
      productName:           s.product.name,
      cameraCount,
      cameraIds:             s.cameraIds,
      unitPriceUsd:          unit,
      subtotalBrl:           subtotal,
      metadata:              s.product.metadata,
    }
  })

  // Sprint 0 · Variação B · D3 SOMA: junta plataforma (mensalidade + adicionais) + marketplace
  const platformLines = await computePlanLines(integradorId, period)
  const lines = [...platformLines, ...marketplaceLines]

  const totalBrl = Number(lines.reduce((s, l) => s + l.subtotalBrl, 0).toFixed(2))
  return { period, lines, totalBrl }
}

/**
 * Gera Invoice + lineItems pra UM integrador no período dado. Retorna o resultado.
 * Idempotente: se Invoice já existe pra (integradorId, periodStart), pula (ou regenera se force=true).
 */
async function generateForIntegrador(
  integ: { id: string; name: string; tradeName: string | null },
  opts: GenerateOptions,
): Promise<GenerateResult['details'][number]> {
  const period = periodOf(opts.yearMonth)
  const integradorId = integ.id
  const dryRun = !!opts.dryRun
  const force  = !!opts.force

  // Idempotência
  const existing = await prisma.invoice.findFirst({
    where: { integradorId, periodStart: period.start },
    select: { id: true },
  })
  if (existing && !force) {
    return {
      integradorId,
      integradorName: integ.tradeName ?? integ.name,
      status: 'skipped',
      invoiceId: existing.id,
    }
  }

  const { lines, totalBrl } = await previewInvoice(integradorId, opts.yearMonth)

  // Sprint 0: lines.length == 0 só quando NÃO há marketplace E NÃO há plano cobrável
  // (trial, sem plano, ou plano R$ 0). Nesse caso pula geração.
  if (lines.length === 0 || totalBrl === 0) {
    return {
      integradorId,
      integradorName: integ.tradeName ?? integ.name,
      status: 'no_subs',
    }
  }

  if (dryRun) {
    return {
      integradorId,
      integradorName: integ.tradeName ?? integ.name,
      status: 'generated',
      totalBrl,
      lineItems: lines.length,
    }
  }

  // Criar (ou regenerar) Invoice
  const dueDate = new Date(Date.now() + (opts.dueDays ?? DEFAULT_DUE_DAYS) * 86400_000)

  if (existing && force) {
    // delete cascade limpa lineItems
    await prisma.invoice.delete({ where: { id: existing.id } }).catch(() => {})
  }

  const invoice = await prisma.invoice.create({
    data: {
      integradorId,
      periodStart:           period.start,
      periodEnd:             period.end,
      totalAmountBrl:        totalBrl,
      gcpCostUsd:            0,
      dueDate,
      status:                'PENDING',
      // Snapshot agregado pra histórico mensal
      totalCamerasStatic:    lines.reduce((s, l) => s + l.cameraCount, 0),
      totalCamerasStreaming: 0,
      lineItems: {
        create: lines.map(l => ({
          clienteFinalId:        l.clienteFinalId,
          clienteSubscriptionId: l.clienteSubscriptionId,
          productSlug:           l.productSlug,
          productName:           l.productName,
          cameraCount:           l.cameraCount,
          cameraIds:             l.cameraIds,
          unitPriceUsd:          l.unitPriceUsd,
          fxRateBrl:             USD_TO_BRL,
          subtotalBrl:           l.subtotalBrl,
          metadata:              l.metadata as any,
        })),
      },
    },
  })

  // Chamar Asaas createPayment (só se billing ativo + integrador tem customer)
  let asaasError: string | undefined
  if (isBillingEnabled()) {
    const customer = await prisma.asaasCustomer.findUnique({ where: { integradorId } })
    if (customer) {
      try {
        const pay = await createPayment({
          customer:    customer.asaasCustomerId,
          billingType: DEFAULT_BILLING_TYPE,
          value:       totalBrl,
          dueDate:     dueDate.toISOString().slice(0, 10),
          description: `iaCloud Vision — fatura ${period.label}`,
          externalReference: invoice.id,
        })
        await prisma.invoice.update({
          where: { id: invoice.id },
          data:  {
            asaasPaymentId:  pay.id,
            asaasPaymentUrl: pay.invoiceUrl,
            billingType:     DEFAULT_BILLING_TYPE,
          },
        })
        logger.info({
          invoiceId: invoice.id, integradorId, totalBrl, asaasPaymentId: pay.id,
        }, 'invoice_generator_created_with_payment')
      } catch (err: any) {
        if (err instanceof BillingDisabledError) {
          asaasError = 'billing_disabled'
        } else if (err instanceof AsaasApiError) {
          asaasError = err.errors?.[0]?.description ?? err.message
        } else {
          asaasError = err?.message ?? 'unknown'
        }
        logger.warn({
          err, invoiceId: invoice.id, integradorId,
        }, 'invoice_generator_asaas_payment_failed')
      }
    } else {
      asaasError = 'sem_asaas_customer'
      logger.info({
        invoiceId: invoice.id, integradorId,
      }, 'invoice_generator_no_asaas_customer')
    }
  }

  return {
    integradorId,
    integradorName: integ.tradeName ?? integ.name,
    status:    asaasError ? 'asaas_failed' : 'generated',
    invoiceId: invoice.id,
    totalBrl,
    lineItems: lines.length,
    error:     asaasError,
  }
}

/**
 * Roda pra TODOS os integradores. Usado pelo cron mensal e pelo admin override.
 */
export async function generateMonthlyInvoices(
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const period = periodOf(opts.yearMonth)
  const integs = opts.integradorId
    ? await prisma.integrador.findMany({
        where:  { id: opts.integradorId, active: true },
        select: { id: true, name: true, tradeName: true },
      })
    : await prisma.integrador.findMany({
        where:  { active: true },
        select: { id: true, name: true, tradeName: true },
      })

  const details: GenerateResult['details'] = []
  for (const integ of integs) {
    try {
      const d = await generateForIntegrador(integ, opts)
      details.push(d)
    } catch (err: any) {
      logger.error({ err, integradorId: integ.id }, 'invoice_generator_failed')
      details.push({
        integradorId:   integ.id,
        integradorName: integ.tradeName ?? integ.name,
        status:         'asaas_failed',
        error:          err?.message ?? 'unknown',
      })
    }
  }

  const result: GenerateResult = {
    yearMonth:   period.label,
    dryRun:      !!opts.dryRun,
    processed:   integs.length,
    generated:   details.filter(d => d.status === 'generated').length,
    skipped:     details.filter(d => d.status === 'skipped').length,
    asaasErrors: details.filter(d => d.status === 'asaas_failed').length,
    details,
  }

  logger.info(result, 'invoice_generator_run')
  return result
}

// ─── cron ────────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null

/**
 * Cron: 1× por dia às 04h checa se hoje é dia 1 e roda. Mais simples e
 * resiliente que cron-string (pode rodar mesmo se restart no horário).
 */
async function tickIfFirstOfMonth(): Promise<void> {
  const now = new Date()
  if (now.getUTCDate() !== 1) return
  // Roda pro mês anterior — ex: hoje é 2026-07-01 → fatura 2026-06
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const yearMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`

  // Marca executado pra não rodar 2× no mesmo dia 1
  const ran = await prisma.invoice.findFirst({
    where: { periodStart: { gte: prev, lt: now } },
    select: { id: true },
  })
  if (ran) {
    logger.debug({ yearMonth }, 'invoice_generator_cron_skipped_already_ran')
    return
  }

  logger.info({ yearMonth }, 'invoice_generator_cron_starting')
  const r = await generateMonthlyInvoices({ yearMonth })
  logger.info({ yearMonth, processed: r.processed, generated: r.generated, asaasErrors: r.asaasErrors }, 'invoice_generator_cron_done')
}

const TICK_INTERVAL_MS = Number(process.env.INVOICE_GENERATOR_TICK_MS ?? 60 * 60_000) // 1h

export const invoiceGenerator = {
  start(): void {
    if (_timer) return
    _timer = setInterval(() => {
      tickIfFirstOfMonth().catch(err => logger.error({ err }, 'invoice_generator_tick_error'))
    }, TICK_INTERVAL_MS)
    logger.info({ tickMs: TICK_INTERVAL_MS }, 'invoice_generator_started')
  },
  stop(): void {
    if (_timer) { clearInterval(_timer); _timer = null }
  },
  /** Trigger imediato (usado pelo admin "gerar fatura agora"). */
  triggerNow: generateMonthlyInvoices,
  /** Preview pra UI (sem persistir). */
  preview: previewInvoice,
}

export const __testables__ = { periodOf, generateForIntegrador }
