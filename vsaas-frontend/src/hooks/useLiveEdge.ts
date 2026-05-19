/**
 * useLiveEdge — poola o endpoint /playback/:id/live-edge a cada 10s.
 *
 * Retorna:
 *   lastSegmentAt — ISO string do último segmento gravado
 *   delaySec      — segundos de atraso em relação ao live (null = sem dados)
 *   isOnlineNow   — true se delaySec < 30s (câmera está gravando ativamente)
 */
import useSWR from 'swr'
import { api } from '../api/client'

export interface LiveEdgeData {
  lastSegmentAt: string | null
  delaySec:      number | null
  isOnlineNow:   boolean
  uploadStatus?: string
}

async function fetchLiveEdge(url: string): Promise<LiveEdgeData> {
  const { data } = await api.get(url)
  return data
}

export function useLiveEdge(cameraId: string | null, enabled = true) {
  const key = cameraId && enabled ? `/playback/${cameraId}/live-edge` : null
  return useSWR<LiveEdgeData>(key, fetchLiveEdge, {
    refreshInterval: 10_000,
    dedupingInterval: 8_000,
    revalidateOnFocus: false,
  })
}
