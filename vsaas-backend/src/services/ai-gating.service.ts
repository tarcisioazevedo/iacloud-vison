/**
 * ai-gating.service.ts — porta única para TODA chamada Gemini no sistema.
 *
 * Responsabilidades (endereça gaps P0 do audit):
 *   #1  Gating subscription:  verifica se cliente tem add-on ativo
 *   #2  GeminiCallLog:        loga cada call (sucesso/falha + custo)
 *   #5  LGPD opt-in:          bloqueia se cliente nao deu consentimento
 *   #12 BYOK resolution:      cliente > integrador > fabricante (cascade)
 *   #13 Fallback BYOK→Pool:   se chave self falha 3x, volta pra pool
 *   #14 Quota Gemini:         enforce cap diario do integrador
 *
 * Uso (a partir de qualquer pipeline IA):
 *
 *   const gate = await aiGatingService.checkAndOpen({
 *     cameraId,
 *     feature: 'semantic-rule',  // ou lpr | describe-live | etc
 *     productSlug: 'ai-semantic-alert',
 *   })
 *   if (!gate.allowed) {
 *     logger.info({ reason: gate.reason }, 'gating_blocked')
 *     return
 *   }
 *   // gate.apiKey contem a chave correta (pool ou BYOK)
 *   const result = await someGeminiCall(gate.apiKey, ...)
 *   await aiGatingService.logCall(gate, { tokensIn, tokensOut, latencyMs, outcome: 'success' })
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { decryptSecret } from '../lib/crypto'

// Slug do produto Marketplace -> feature interna
// Mapeia subscriptions ativas pra autorizar chamadas Gemini correspondentes
const FEATURE_PRODUCT_SLUG: Record<string, string[]> = {
  'lpr':              ['ai-lpr', 'lpr-inteligente'],
  'semantic-rule':    ['ai-semantic-alert', 'alertas-semanticos'],
  'describe-live':    ['ai-assistant', 'ai-describe', 'smart-plus'],
  'describe-event':   ['ai-describe', 'smart', 'smart-plus', 'enterprise'],
  'caption-frame':    ['ai-semantic-search', 'busca-semantica'],
  'compare-subjects': ['ai-fr', 'reconhecimento-facial'],
  'point-to-object':  ['lgpd-auto-blur', 'ai-assistant'],
  'chat-tools':       ['ai-assistant'],
}

// Custo Gemini estimado por modelo (USD per 1M tokens) -> R$ (1 USD = 5.0)
const COST_TABLE_BRL: Record<string, { in: number; out: number }> = {
  'gemini-1.5-flash':       { in: 0.000375, out: 0.0015 }, // R$/1k tokens
  'gemini-1.5-pro':         { in: 0.00625,  out: 0.025 },
  'gemini-2.0-flash':       { in: 0.0005,   out: 0.002 },
}

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const t = COST_TABLE_BRL[model] ?? COST_TABLE_BRL['gemini-1.5-flash']
  return (tokensIn / 1000) * t.in + (tokensOut / 1000) * t.out
}

export interface GateRequest {
  cameraId?: string
  /** Slug genérico da feature interna (vê tabela acima) */
  feature: 'lpr' | 'semantic-rule' | 'describe-live' | 'describe-event' |
           'caption-frame' | 'compare-subjects' | 'point-to-object' | 'chat-tools'
  /** Override do slug de produto a verificar (se múltiplos possíveis) */
  productSlug?: string
  /** Modelo Gemini que será usado (pra estimar custo) */
  model?: string
}

export interface GateResult {
  allowed:        boolean
  /** Quando !allowed: 'no_subscription' | 'lgpd_block' | 'quota_block' | 'no_camera' | 'inactive_camera' */
  reason?:        string
  /** Apenas em allowed=true: chave em texto para chamar Gemini */
  apiKey?:        string
  /** Para logCall — propagar contexto */
  paidBy?:        'fabricante' | 'integrador' | 'cliente'
  payerId?:       string
  subscriptionId?: string
  model?:         string
  cameraId?:      string
  feature?:       string
  /** Marca de tempo do início da chamada — usada no logCall pra latência */
  startedAt?:     number
}

export const aiGatingService = {

  /**
   * Verifica gating completo. Se ok, devolve chave + contexto pra log.
   * Não chama o Gemini — caller decide. Mas a chave é resolvida aqui.
   */
  async checkAndOpen(req: GateRequest): Promise<GateResult> {
    const startedAt = Date.now()
    const model     = req.model ?? 'gemini-1.5-flash'

    // ── 1. Resolve cliente/integrador via câmera ──────────────────────────
    let clienteFinalId: string | null = null

    if (req.cameraId) {
      const cam = await prisma.camera.findUnique({
        where: { id: req.cameraId },
        select: {
          id: true, active: true,
          site: {
            select: {
              clienteFinalId: true,
              clienteFinal: {
                select: {
                  id: true,
                  integradorId: true,
                  geminiApiKeyEnc: true,
                  geminiByokMode: true,
                  integrador: {
                    select: {
                      id: true, active: true,
                      geminiApiKeyEnc: true,
                      geminiByokMode: true,
                      geminiCallCapDaily: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!cam) {
        return { allowed: false, reason: 'no_camera', startedAt, model, feature: req.feature }
      }
      if (!cam.active) {
        return { allowed: false, reason: 'inactive_camera', startedAt, model, feature: req.feature }
      }

      clienteFinalId = cam.site.clienteFinalId

      // ── 2. Gating subscription (P0 #1) ─────────────────────────────────
      const slugsAceitos = req.productSlug
        ? [req.productSlug]
        : (FEATURE_PRODUCT_SLUG[req.feature] ?? [])

      // 'chat-tools' e 'caption-frame' podem rodar mesmo sem subscription específica
      // se cliente tem plano base com IA (Smart+) — mantemos lookup flexível.
      const requireSubscription = !['describe-event', 'caption-frame', 'point-to-object'].includes(req.feature)

      if (requireSubscription && slugsAceitos.length > 0) {
        const sub = await prisma.clienteSubscription.findFirst({
          where: {
            clienteFinalId,
            status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] as any },
            product: { slug: { in: slugsAceitos } },
          },
          select: { id: true, status: true, productId: true },
        })
        if (!sub) {
          return { allowed: false, reason: 'no_subscription', startedAt, model, feature: req.feature }
        }

        // ── 3. LGPD opt-in (P0 #5) ───────────────────────────────────────
        const scope = req.feature === 'compare-subjects' ? 'ai_facial' : 'ai_gemini'
        const consent = await prisma.lgpdConsent.findUnique({
          where: { clienteFinalId_scope: { clienteFinalId, scope } },
          select: { accepted: true, revokedAt: true },
        })
        if (!consent || !consent.accepted || consent.revokedAt) {
          return { allowed: false, reason: 'lgpd_block', startedAt, model, feature: req.feature }
        }

        // ── 4. Quota integrador (P0 #14) ─────────────────────────────────
        const integ = cam.site.clienteFinal.integrador
        if (integ.geminiCallCapDaily > 0) {
          // Conta calls success do integrador nas últimas 24h
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
          const callsToday = await prisma.geminiCallLog.count({
            where: {
              paidBy: 'integrador',
              payerId: integ.id,
              outcome: 'success',
              ts: { gte: since },
            },
          })
          if (callsToday >= integ.geminiCallCapDaily) {
            return { allowed: false, reason: 'quota_block', startedAt, model, feature: req.feature }
          }
        }

        // ── 5. Resolve chave: cliente > integrador > fabricante (P1 #12) ─
        let apiKey: string | null = null
        let paidBy: 'fabricante' | 'integrador' | 'cliente' = 'fabricante'
        let payerId = 'fabricante'

        const cliente = cam.site.clienteFinal
        if (cliente.geminiByokMode === 'self' && cliente.geminiApiKeyEnc && !isByokDisabled(cliente.id)) {
          apiKey = decryptSecret(cliente.geminiApiKeyEnc)
          paidBy = 'cliente'; payerId = cliente.id
        }
        if (!apiKey && integ.geminiByokMode === 'self' && integ.geminiApiKeyEnc && !isByokDisabled(integ.id)) {
          apiKey = decryptSecret(integ.geminiApiKeyEnc)
          paidBy = 'integrador'; payerId = integ.id
        }
        if (!apiKey) {
          // Pool fabricante — vem do SystemConfig ou env (já carregado em genai.service)
          apiKey = await loadFabricanteKey()
          paidBy = 'fabricante'; payerId = 'fabricante'
        }
        if (!apiKey) {
          return { allowed: false, reason: 'no_key_configured', startedAt, model, feature: req.feature }
        }

        return {
          allowed: true, startedAt, model,
          apiKey, paidBy, payerId,
          subscriptionId: sub.id,
          cameraId: req.cameraId,
          feature: req.feature,
        }
      }
    }

    // ── system call (sem câmera específica, ex: caption-worker bg job) ──
    const apiKey = await loadFabricanteKey()
    if (!apiKey) {
      return { allowed: false, reason: 'no_key_configured', startedAt, model, feature: req.feature }
    }
    return {
      allowed: true, startedAt, model,
      apiKey, paidBy: 'fabricante', payerId: 'fabricante',
      cameraId: req.cameraId,
      feature: req.feature,
    }
  },

  /**
   * Loga o resultado da call. Chame após cada chamada Gemini (sucesso ou falha).
   */
  async logCall(
    gate: GateResult,
    info: {
      tokensIn?:    number
      tokensOut?:   number
      outcome:      'success' | 'rate_limited' | 'api_error' | 'gating_block' | 'quota_block' | 'lgpd_block'
      errorMessage?: string
    },
  ): Promise<void> {
    if (!gate.startedAt) return
    const tokensIn  = info.tokensIn  ?? 0
    const tokensOut = info.tokensOut ?? 0
    const latencyMs = Date.now() - gate.startedAt
    const cost = info.outcome === 'success' ? estimateCost(gate.model ?? 'gemini-1.5-flash', tokensIn, tokensOut) : 0

    await prisma.geminiCallLog.create({
      data: {
        feature:        gate.feature ?? 'unknown',
        paidBy:         gate.paidBy ?? 'fabricante',
        payerId:        gate.payerId ?? 'fabricante',
        cameraId:       gate.cameraId ?? null,
        subscriptionId: gate.subscriptionId ?? null,
        modelName:      gate.model ?? 'gemini-1.5-flash',
        tokensIn,
        tokensOut,
        estimatedCost:  cost as any,
        latencyMs,
        outcome:        info.outcome,
        errorMessage:   info.errorMessage ?? null,
      },
    }).catch(err => {
      logger.warn({ err: err.message }, 'gemini_call_log_failed')
    })
  },

  /**
   * Loga uma rejeição de gating (não foi chamado Gemini de fato).
   * Útil pra dashboard "calls bloqueadas" + atribuir preservação de receita.
   */
  async logBlock(req: GateRequest, gate: GateResult): Promise<void> {
    if (!gate.reason) return
    const outcome = gate.reason === 'lgpd_block' ? 'lgpd_block'
                  : gate.reason === 'quota_block' ? 'quota_block'
                  : 'gating_block'
    await prisma.geminiCallLog.create({
      data: {
        feature:        req.feature,
        paidBy:         'fabricante',
        payerId:        'unknown',
        cameraId:       req.cameraId ?? null,
        modelName:      req.model ?? 'gemini-1.5-flash',
        outcome,
        errorMessage:   gate.reason,
      },
    }).catch(() => {})
  },
}

/**
 * Carrega chave do fabricante (cascata: SystemConfig → env → secret file).
 * Usa decryptSecret se chave for criptografada.
 */
async function loadFabricanteKey(): Promise<string | null> {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: 'ai.gemini_api_key_enc' },
    })
    if (row?.value) {
      return decryptSecret(row.value) ?? row.value
    }
  } catch { /* fall through */ }
  return process.env.GEMINI_API_KEY ?? null
}

// ─── P1 #13: BYOK fallback ───
// Estado em memória: chaves BYOK que falharam consecutivamente.
// Após N falhas → marca como inválida + força pool no próximo checkAndOpen.
// Reset acontece via /admin endpoint quando integrador atualiza chave.
const BYOK_FAIL_THRESHOLD = 3
const byokFailureCount = new Map<string, number>()  // payerId → fails

export function reportByokFailure(payerId: string): boolean {
  const count = (byokFailureCount.get(payerId) ?? 0) + 1
  byokFailureCount.set(payerId, count)
  if (count >= BYOK_FAIL_THRESHOLD) {
    logger.warn({ payerId, count }, 'byok_marked_invalid_fallback_to_pool')
    return true
  }
  return false
}

export function resetByokFailures(payerId: string): void {
  byokFailureCount.delete(payerId)
}

function isByokDisabled(payerId: string): boolean {
  return (byokFailureCount.get(payerId) ?? 0) >= BYOK_FAIL_THRESHOLD
}
