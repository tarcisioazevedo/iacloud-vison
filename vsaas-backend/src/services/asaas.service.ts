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
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import crypto from 'crypto'
import { logger } from '../lib/logger'
import { getAsaasConfig } from './asaas-config.service'

export class BillingDisabledError extends Error {
  constructor() {
    super('Billing está provisionado mas inativo. Defina BILLING_ENABLED=true e ASAAS_API_KEY.')
    this.name = 'BillingDisabledError'
  }
}

/**
 * Erro estruturado vindo da API Asaas. Asaas usa envelope:
 *   { errors: [{ code: "invalid_value", description: "CPF inválido" }] }
 * Esta classe preserva code+description acessíveis pelo handler de UI,
 * em vez do `err.message` genérico do axios.
 */
export class AsaasApiError extends Error {
  readonly status: number
  readonly errors: Array<{ code: string; description: string }>
  constructor(status: number, errors: Array<{ code: string; description: string }>) {
    const first = errors[0]
    super(first ? `${first.code}: ${first.description}` : `Asaas API error (HTTP ${status})`)
    this.name = 'AsaasApiError'
    this.status = status
    this.errors = errors
  }
}

/**
 * Extrai o envelope `errors[]` do response Asaas e lança AsaasApiError.
 * Fallback: re-throw do AxiosError original.
 */
function asAsaasError(err: AxiosError): Error {
  const r = err.response
  if (!r) return err
  const data = r.data as { errors?: Array<{ code: string; description: string }> } | undefined
  if (data?.errors?.length) return new AsaasApiError(r.status, data.errors)
  return err
}

export function isBillingEnabled(): boolean {
  // Considera ativo se BILLING_ENABLED + (DB tem key OU env tem key).
  // O check estrito (DB) acontece em runtime dentro do client().
  return process.env.BILLING_ENABLED === 'true' && !!process.env.ASAAS_API_KEY
}

/**
 * Invalida o singleton do axios para forçar releitura da config após rotação.
 * Chamar de asaas-config.service ao rotacionar key ou ambiente.
 */
export function invalidateAsaasClient(): void {
  _client = null
}

const RETRY_DELAYS_MS = [1_000, 3_000, 9_000] as const

function isRetryable(err: AxiosError): boolean {
  if (!err.response) return false
  const s = err.response.status
  return s === 429 || (s >= 500 && s <= 599)
}

function retryAfterMs(err: AxiosError): number | null {
  const h = err.response?.headers?.['retry-after']
  if (!h) return null
  const n = Number(h)
  if (Number.isFinite(n)) return Math.max(0, n * 1000)
  const d = Date.parse(String(h))
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : null
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

let _client: AxiosInstance | null = null
let _clientKey: string | null = null  // identifica a config corrente (key+baseURL)
let _clientBaseURL: string | null = null

/**
 * Retorna client axios configurado com a key/baseURL atual.
 * Se a key/baseURL mudou (rotação via UI), recria a instance.
 * `getAsaasConfig` tem cache 10s — chamadas frequentes são baratas.
 */
async function client(): Promise<AxiosInstance> {
  if (!isBillingEnabled()) throw new BillingDisabledError()

  const cfg = await getAsaasConfig()
  const apiKey = cfg.apiKey
  if (!apiKey) throw new BillingDisabledError()

  const baseURL = cfg.environment === 'SANDBOX'
    ? 'https://api-sandbox.asaas.com/v3'
    : 'https://api.asaas.com/v3'

  if (_client && _clientKey === apiKey && _clientBaseURL === baseURL) {
    return _client
  }

  _clientKey = apiKey
  _clientBaseURL = baseURL
  _client = axios.create({
    baseURL,
    headers: {
      access_token: apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'IACloudVision/1.0',
    },
    timeout: 15_000,
  })

  _client.interceptors.response.use(
    r => r,
    async (err: AxiosError) => {
      const reqCfg = err.config as (AxiosRequestConfig & { __retryAttempt?: number }) | undefined
      if (!reqCfg || !isRetryable(err)) throw err
      const attempt = (reqCfg.__retryAttempt ?? 0)
      if (attempt >= RETRY_DELAYS_MS.length) throw err
      const wait = retryAfterMs(err) ?? RETRY_DELAYS_MS[attempt]
      const status = err.response?.status
      logger.warn({ status, attempt: attempt + 1, waitMs: wait, url: reqCfg.url, method: reqCfg.method }, 'asaas_retry')
      await sleep(wait)
      reqCfg.__retryAttempt = attempt + 1
      return _client!.request(reqCfg)
    },
  )

  return _client
}

export interface AsaasCreateCustomerInput {
  name: string; cpfCnpj: string; email?: string; phone?: string; externalReference?: string
}
export interface AsaasCustomer {
  id: string; name: string; cpfCnpj: string; email?: string; phone?: string
}

export async function createCustomer(input: AsaasCreateCustomerInput): Promise<AsaasCustomer> {
  try {
    const r = await (await client()).post('/customers', input)
    return r.data
  } catch (err: any) {
    throw asAsaasError(err)
  }
}
export async function findCustomer(asaasCustomerId: string): Promise<AsaasCustomer | null> {
  try {
    const r = await (await client()).get(`/customers/${asaasCustomerId}`)
    return r.data
  } catch (err: any) {
    if (err?.response?.status === 404) return null
    throw asAsaasError(err)
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
  try {
    const r = await (await client()).post('/payments', input)
    return r.data
  } catch (err: any) {
    throw asAsaasError(err)
  }
}
export async function getPayment(paymentId: string): Promise<AsaasPayment> {
  try {
    const r = await (await client()).get(`/payments/${paymentId}`)
    return r.data
  } catch (err: any) {
    throw asAsaasError(err)
  }
}

export interface AsaasCreateSubscriptionInput {
  customer: string
  billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX' | 'UNDEFINED'
  value: number; nextDueDate: string
  cycle: 'MONTHLY' | 'YEARLY' | 'WEEKLY' | 'BIWEEKLY' | 'QUARTERLY' | 'SEMIANNUALLY'
  description?: string; externalReference?: string
}
export async function createSubscription(input: AsaasCreateSubscriptionInput) {
  try {
    const r = await (await client()).post('/subscriptions', input)
    return r.data
  } catch (err: any) {
    throw asAsaasError(err)
  }
}
export async function cancelSubscription(subscriptionId: string) {
  try {
    const r = await (await client()).delete(`/subscriptions/${subscriptionId}`)
    return r.data
  } catch (err: any) {
    throw asAsaasError(err)
  }
}

/**
 * Variante síncrona (legada) — usa apenas env. Mantida para tests + fallback.
 * Use `verifyWebhookSignatureAsync` em código de produção.
 */
export function verifyWebhookSignature(req: { headers: Record<string, any> }): boolean {
  const expected = process.env.ASAAS_WEBHOOK_SECRET
  if (!expected) return false
  const provided = req.headers['asaas-access-token'] ?? req.headers['Asaas-Access-Token']
  if (typeof provided !== 'string' || provided.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

/**
 * Versão async — preferida em runtime. Lê webhook secret do DB (com cache 10s)
 * e cai no env como fallback. Permite rotação a quente sem redeploy.
 */
export async function verifyWebhookSignatureAsync(req: { headers: Record<string, any> }): Promise<boolean> {
  const cfg = await getAsaasConfig()
  const expected = cfg.webhookSecret ?? process.env.ASAAS_WEBHOOK_SECRET
  if (!expected) return false
  const provided = req.headers['asaas-access-token'] ?? req.headers['Asaas-Access-Token']
  if (typeof provided !== 'string' || provided.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}
