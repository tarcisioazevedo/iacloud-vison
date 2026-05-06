/**
 * Asaas billing service — PROVISIONADO mas inativo enquanto BILLING_ENABLED!=true.
 *
 * Modo:
 *   - BILLING_ENABLED=false (default) → mutações lançam BillingDisabledError
 *   - BILLING_ENABLED=true → chama API real Asaas
 *
 * Env vars:
 *   BILLING_ENABLED         "true" | "false"
 *   ASAAS_API_KEY           chave produção/sandbox
 *   ASAAS_BASE_URL          https://api.asaas.com/v3 | https://sandbox.asaas.com/api/v3
 *   ASAAS_WEBHOOK_SECRET    segredo para validar webhook
 */
import axios, { AxiosInstance } from 'axios'
import crypto from 'crypto'

export class BillingDisabledError extends Error {
  constructor() {
    super('Billing está provisionado mas inativo. Defina BILLING_ENABLED=true e ASAAS_API_KEY.')
    this.name = 'BillingDisabledError'
  }
}

export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === 'true' && !!process.env.ASAAS_API_KEY
}

let _client: AxiosInstance | null = null
function client(): AxiosInstance {
  if (!isBillingEnabled()) throw new BillingDisabledError()
  if (_client) return _client
  _client = axios.create({
    baseURL: process.env.ASAAS_BASE_URL ?? 'https://sandbox.asaas.com/api/v3',
    headers: {
      access_token: process.env.ASAAS_API_KEY!,
      'Content-Type': 'application/json',
      'User-Agent': 'IACloudVision/1.0',
    },
    timeout: 15_000,
  })
  return _client
}

export interface AsaasCreateCustomerInput {
  name: string; cpfCnpj: string; email?: string; phone?: string; externalReference?: string
}
export interface AsaasCustomer {
  id: string; name: string; cpfCnpj: string; email?: string; phone?: string
}

export async function createCustomer(input: AsaasCreateCustomerInput): Promise<AsaasCustomer> {
  const r = await client().post('/customers', input)
  return r.data
}
export async function findCustomer(asaasCustomerId: string): Promise<AsaasCustomer | null> {
  try {
    const r = await client().get(`/customers/${asaasCustomerId}`)
    return r.data
  } catch (err: any) {
    if (err?.response?.status === 404) return null
    throw err
  }
}

export interface AsaasCreatePaymentInput {
  customer: string
  billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX' | 'UNDEFINED'
  value: number; dueDate: string
  description?: string; externalReference?: string
}
export interface AsaasPayment {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'RECEIVED' | 'OVERDUE' | 'DELETED' | 'REFUNDED'
  invoiceUrl: string
  bankSlip?: { identificationField: string; barCode: string }
  pixCode?: string
}

export async function createPayment(input: AsaasCreatePaymentInput): Promise<AsaasPayment> {
  const r = await client().post('/payments', input)
  return r.data
}
export async function getPayment(paymentId: string): Promise<AsaasPayment> {
  const r = await client().get(`/payments/${paymentId}`)
  return r.data
}

export interface AsaasCreateSubscriptionInput {
  customer: string
  billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX' | 'UNDEFINED'
  value: number; nextDueDate: string
  cycle: 'MONTHLY' | 'YEARLY' | 'WEEKLY' | 'BIWEEKLY' | 'QUARTERLY' | 'SEMIANNUALLY'
  description?: string; externalReference?: string
}
export async function createSubscription(input: AsaasCreateSubscriptionInput) {
  const r = await client().post('/subscriptions', input)
  return r.data
}
export async function cancelSubscription(subscriptionId: string) {
  const r = await client().delete(`/subscriptions/${subscriptionId}`)
  return r.data
}

export function verifyWebhookSignature(req: { headers: Record<string, any> }): boolean {
  const expected = process.env.ASAAS_WEBHOOK_SECRET
  if (!expected) return false
  const provided = req.headers['asaas-access-token'] ?? req.headers['Asaas-Access-Token']
  if (typeof provided !== 'string' || provided.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}
