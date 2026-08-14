/**
 * Middleware Express: `requires(...capabilities)`
 *
 * Marca uma rota como exigindo determinada(s) capability(ies). Antes do handler
 * rodar, verifica se o clienteFinal do request tem TODAS as capabilities ativas.
 *
 * Default-deny: rotas sem `requires()` nem `publicRoute()` são bloqueadas pelo
 * linter CI (scripts/lint-capability-gates.ts). Esquecer = build quebra.
 *
 * Uso:
 *   router.post('/cameras/:id/recording',
 *     requireAuth,
 *     requires(CAPABILITIES.STORAGE_RECORDING_CONTINUOUS),
 *     asyncHandler(handler)
 *   )
 *
 * Modo "warn" vs "enforce":
 *   - Variável de ambiente CAPABILITY_GATING_MODE
 *   - 'warn'    → loga negação mas DEIXA PASSAR (rollout gradual)
 *   - 'enforce' → bloqueia com 402 Payment Required (default em produção)
 *   - 'off'     → desabilitado totalmente (dev/debug)
 *
 * Fonte: docs/32-IMPLEMENTACAO-CAPABILITY-GATING.md (peça 4.A)
 */
import type { Request, Response, NextFunction } from 'express'
import { canUse } from '../lib/capability-check'
import { CORE_CAPABILITIES } from '../lib/capabilities'
import { logger } from '../lib/logger'

type Mode = 'enforce' | 'warn' | 'off'

function getMode(): Mode {
  const m = (process.env.CAPABILITY_GATING_MODE || 'enforce').toLowerCase()
  if (m === 'warn' || m === 'off') return m
  return 'enforce'
}

/**
 * Resolve clienteFinalId de um request.
 *
 * Suporta múltiplos caminhos:
 *   1. JWT do cliente final (jwtPayload.clienteFinalId)
 *   2. Query param ?clienteFinalId= (admin/integrador agindo em nome do cliente)
 *   3. Header X-Cliente-Final-Id (legacy)
 *
 * Retorna null se não conseguir resolver (não lança — middleware decide).
 */
function resolveClienteFinalId(req: Request): string | null {
  const jwt = (req as any).jwtPayload
  if (jwt?.clienteFinalId) return jwt.clienteFinalId

  const qsId = (req.query as Record<string, string>)?.clienteFinalId
  if (qsId) return qsId

  const hdrId = req.header('x-cliente-final-id')
  if (hdrId) return hdrId

  return null
}

/**
 * Middleware: exige que o cliente do request tenha TODAS as capabilities listadas.
 *
 * Comportamento se NEGADO:
 *   - mode=enforce → 402 Payment Required + JSON com link de upgrade
 *   - mode=warn    → loga + passa (next())
 *   - mode=off     → passa silenciosamente
 */
export function requires(...caps: string[]) {
  if (caps.length === 0) {
    throw new Error('requires() exige pelo menos 1 capability')
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const mode = getMode()
    if (mode === 'off') return next()

    // Se TODAS as caps exigidas são core, libera sem precisar de clienteFinalId
    const allCore = caps.every(c => CORE_CAPABILITIES.has(c))
    if (allCore) return next()

    const clienteFinalId = resolveClienteFinalId(req)

    // Sem cliente resolvido → bloqueia (impossível verificar)
    if (!clienteFinalId) {
      if (mode === 'warn') {
        logger.warn({ caps, path: req.path, method: req.method },
          'capability_check_no_tenant_warn')
        return next()
      }
      return res.status(400).json({
        error: 'no_tenant_context',
        message: 'Informe clienteFinalId pra acessar este recurso',
      })
    }

    // Verifica TODAS as capabilities (AND lógico)
    for (const cap of caps) {
      const ok = await canUse(clienteFinalId, cap)
      if (!ok) {
        logger.info({
          clienteFinalId,
          capability: cap,
          path: req.path,
          method: req.method,
          mode,
        }, mode === 'enforce' ? 'capability_denied' : 'capability_denied_warn')

        if (mode === 'warn') {
          // continua, mas registra
          return next()
        }

        return res.status(402).json({
          error: 'subscription_required',
          message: `Esse recurso requer assinatura ativa que libere: ${cap}`,
          capability: cap,
          upgrade_url: `/marketplace?suggest=${encodeURIComponent(cap)}`,
        })
      }
    }

    next()
  }
}

/**
 * Marca uma rota como PÚBLICA (não exige capability).
 *
 * Útil para:
 *   - Auth (login, signup, reset password)
 *   - Healthcheck (/health)
 *   - Listagens próprias (perfil, câmeras do próprio cliente)
 *   - Browse do marketplace (qualquer um pode ver o catálogo)
 *
 * IMPORTANTE: o linter CI obriga TODA rota a declarar
 *   - requires(...) OU
 *   - publicRoute()
 *
 * Esquecer = build quebra. Isso garante que nenhuma rota nova vaze por
 * desatenção.
 */
export function publicRoute() {
  return (_req: Request, _res: Response, next: NextFunction) => next()
}

/**
 * Helper para uso programático (fora de middleware Express).
 * Útil em background jobs, scripts, ai-worker.
 */
export { canUse, canUseAll, canUseAny } from '../lib/capability-check'
