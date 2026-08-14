/**
 * Hook que carrega capabilities ativas do cliente logado.
 * Cacheado por 60s via SWR + cache no backend (Redis 60s).
 *
 * Uso:
 *   const { has, hasAny, hasAll, isLoading } = useMyCapabilities()
 *   if (has(CAP.STORAGE_RECORDING_CONTINUOUS)) { ... }
 */
import useSWR from 'swr'
import { api } from '../api/client'
import type { Capability } from '../lib/capabilities'

interface ApiResponse {
  capabilities: string[]
}

export function useMyCapabilities() {
  const { data, error, isLoading, mutate } = useSWR<ApiResponse>(
    '/me/capabilities',
    async (url: string) => {
      const { data } = await api.get(url)
      return data
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,   // 1min: alinha com TTL do Redis
      refreshInterval:  120_000,  // refetch a cada 2min
    },
  )

  const caps = data?.capabilities ?? []
  const setCaps = new Set(caps)

  return {
    capabilities: caps,
    isLoading,
    error,
    refresh: mutate,
    /** Cliente tem essa capability? */
    has: (cap: Capability | string): boolean => setCaps.has(cap),
    /** Cliente tem pelo menos UMA das capabilities? */
    hasAny: (caps: (Capability | string)[]): boolean => caps.some(c => setCaps.has(c)),
    /** Cliente tem TODAS as capabilities? */
    hasAll: (caps: (Capability | string)[]): boolean => caps.every(c => setCaps.has(c)),
  }
}
