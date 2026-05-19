/**
 * useMobileGridLayout — persiste preferência de grade no mobile.
 * Valores: 1 (lista/1×1), 2 (2×2), 3 (3×3), 4 (4×4)
 */
import { useState, useCallback } from 'react'

export type GridMode = 1 | 2 | 3 | 4

const KEY = 'vsaas_mobile_grid'

function load(): GridMode {
  try {
    const v = Number(localStorage.getItem(KEY))
    if (v === 1 || v === 2 || v === 3 || v === 4) return v as GridMode
  } catch {}
  return 2
}

export function useMobileGridLayout() {
  const [mode, setModeState] = useState<GridMode>(load)

  const setMode = useCallback((m: GridMode) => {
    setModeState(m)
    try { localStorage.setItem(KEY, String(m)) } catch {}
  }, [])

  return { mode, setMode }
}
