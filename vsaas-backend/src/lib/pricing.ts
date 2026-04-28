/**
 * Pricing table — preços mensais padrão por tier comercial.
 *
 * Por que isso fica no código e não no banco (ainda):
 *   - Faz parte do "contrato comercial" do VSaaS; muda raramente (trimestral?).
 *   - Muda via env vars para permitir overrides por ambiente sem redeploy.
 *   - Quando a operação crescer, migrar para tabela `PricingPlan` com histórico
 *     (promoções, descontos por volume, contratos customizados por integrador).
 *
 * Uso:
 *   const price = resolveCameraPrice(b.tier, b.priceMonthlyBrl)
 *
 * Tiers técnicos (STATIC_VISION / STREAMING_ANALYTICS) NÃO têm preço fixo —
 * são pay-as-you-go. Se o caller não informar priceMonthlyBrl para esses,
 * usamos 0 (operador seta depois) e logamos para auditoria.
 */
import { logger } from './logger'
import { ValidationError } from './errors'

type Tier =
  | 'BRONZE'
  | 'SILVER'
  | 'GOLD'
  | 'PLATINUM'
  | 'STATIC_VISION'
  | 'STREAMING_ANALYTICS'

/**
 * Valores em BRL/mês. Podem ser sobrescritos via env ICV_PRICE_<TIER>.
 * Ex.: `ICV_PRICE_SILVER=69.90` no .env aplica sem redeploy.
 */
function readPrice(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    logger.warn({ envKey, raw }, 'pricing_env_invalid_falling_back_to_default')
    return fallback
  }
  return n
}

// Valores placeholder. Ajustáveis via env ou em produção via tabela no DB.
const DEFAULT_PRICES: Record<Tier, number | null> = {
  BRONZE:              readPrice('ICV_PRICE_BRONZE',   19.90),
  SILVER:              readPrice('ICV_PRICE_SILVER',   49.90),
  GOLD:                readPrice('ICV_PRICE_GOLD',    149.90),
  PLATINUM:            readPrice('ICV_PRICE_PLATINUM', 399.90),
  // Tiers técnicos (pay-as-you-go) — sem preço fixo conhecido.
  STATIC_VISION:        null,
  STREAMING_ANALYTICS:  null,
}

/**
 * Retorna o preço efetivo para a câmera.
 *
 * Regra:
 *   - Caller passou `priceMonthlyBrl`? usa esse valor (admin override).
 *   - Tier comercial sem preço? usa pricing table.
 *   - Tier técnico sem preço? exige explicitar — joga ValidationError.
 */
export function resolveCameraPrice(tier: Tier, provided?: number): number {
  if (typeof provided === 'number' && provided > 0) {
    return provided
  }

  const fromTable = DEFAULT_PRICES[tier]
  if (fromTable && fromTable > 0) {
    logger.debug({ tier, priceMonthlyBrl: fromTable }, 'pricing_resolved_from_table')
    return fromTable
  }

  throw new ValidationError(
    `priceMonthlyBrl é obrigatório para tier técnico "${tier}" (pay-as-you-go)`,
  )
}

/**
 * Mapa exportado para o frontend poder mostrar os valores sem chamar a API.
 * Endpoint futuro `GET /pricing` pode expor isso filtrado pelo tenant.
 */
export const COMMERCIAL_PRICING = {
  BRONZE:   DEFAULT_PRICES.BRONZE,
  SILVER:   DEFAULT_PRICES.SILVER,
  GOLD:     DEFAULT_PRICES.GOLD,
  PLATINUM: DEFAULT_PRICES.PLATINUM,
} as const
