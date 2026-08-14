/**
 * <RequireCapability> — esconde/desabilita filhos quando cliente não tem a capability.
 *
 * Três modos:
 *   - 'hide' (default): não renderiza nada
 *   - 'disable': renderiza children com pointer-events-none + opacity reduzida
 *   - 'upgrade': renderiza CTA "Contratar X →" linkando pro Marketplace
 *
 * Uso:
 *   <RequireCapability cap={CAP.STORAGE_RECORDING_CONTINUOUS}>
 *     <button onClick={startRecording}>Gravar</button>
 *   </RequireCapability>
 *
 *   <RequireCapability cap={CAP.AI_SEMANTIC_CREATE_RULE} mode="upgrade">
 *     <CreateRuleForm />
 *   </RequireCapability>
 *
 * Fonte: docs/32-IMPLEMENTACAO-CAPABILITY-GATING.md (peça 4.B)
 */
import { ReactNode } from 'react'
import { useMyCapabilities } from '../hooks/useMyCapabilities'
import type { Capability } from '../lib/capabilities'
import { CapabilityBlockedView } from './CapabilityBlockedView'

type Mode = 'hide' | 'disable' | 'upgrade'

interface Props {
  cap: Capability | string | (Capability | string)[]
  fallback?: ReactNode
  children: ReactNode
  mode?: Mode
  /** Se true, exige TODAS as caps (AND). Default: OR (qualquer uma libera). */
  requireAll?: boolean
}

export function RequireCapability({
  cap,
  fallback,
  children,
  mode = 'hide',
  requireAll = false,
}: Props) {
  const caps = Array.isArray(cap) ? cap : [cap]
  const { hasAny, hasAll, isLoading } = useMyCapabilities()

  if (isLoading) {
    // Renderiza nada enquanto carrega — evita flicker de "bloqueado → liberado"
    return null
  }

  const allowed = requireAll ? hasAll(caps) : hasAny(caps)
  if (allowed) return <>{children}</>

  // Bloqueado: aplica o modo escolhido
  if (fallback) return <>{fallback}</>

  if (mode === 'disable') {
    return (
      <div
        className="opacity-50 pointer-events-none cursor-not-allowed"
        title="Recurso bloqueado — requer assinatura"
        aria-disabled="true"
      >
        {children}
      </div>
    )
  }

  if (mode === 'upgrade') {
    // Tela completa "CTA inline" com produto sugerido — substitui conteúdo da página
    return <CapabilityBlockedView cap={caps[0]} />
  }

  return null // mode='hide'
}

/**
 * Versão inline / hook-only para casos onde JSX não cabe.
 *
 * Uso:
 *   const canRecord = useHasCapability(CAP.STORAGE_RECORDING_CONTINUOUS)
 *   if (!canRecord) return null
 */
export function useHasCapability(cap: Capability | string): boolean {
  const { has, isLoading } = useMyCapabilities()
  if (isLoading) return false
  return has(cap)
}
