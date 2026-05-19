import { useRef, useState, useCallback } from 'react'

interface Options {
  onRefresh: () => Promise<void> | void
  threshold?: number  // px to pull, default 64
}

export function usePullToRefresh({ onRefresh, threshold = 64 }: Options) {
  const startY      = useRef<number | null>(null)
  const [pullY, setPullY]       = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    if (el.scrollTop > 0) return
    startY.current = e.clientY
    el.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (startY.current === null || refreshing) return
    const el = e.currentTarget as HTMLElement
    if (el.scrollTop > 4) { startY.current = null; setPullY(0); return }
    const dy = Math.max(0, e.clientY - startY.current)
    setPullY(Math.min(dy, threshold * 1.5))
  }, [refreshing, threshold])

  const onPointerUp = useCallback(async () => {
    if (startY.current === null) return
    const pulled = pullY
    startY.current = null
    setPullY(0)
    if (pulled >= threshold) {
      setRefreshing(true)
      try { await onRefresh() } finally { setRefreshing(false) }
    }
  }, [pullY, threshold, onRefresh])

  const onPointerCancel = useCallback(() => {
    startY.current = null
    setPullY(0)
  }, [])

  return {
    pullProgress: Math.min(1, pullY / threshold),
    isRefreshing: refreshing,
    containerProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  }
}
