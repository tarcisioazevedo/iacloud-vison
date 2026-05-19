/**
 * useFavoriteCameras — persistência local de câmeras favoritas.
 * Armazena os IDs em localStorage ("icv_favs") como JSON array.
 */
import { useState, useCallback } from 'react'

const KEY = 'icv_favs'

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch { return new Set() }
}

function save(set: Set<string>) {
  localStorage.setItem(KEY, JSON.stringify([...set]))
}

export function useFavoriteCameras() {
  const [favs, setFavs] = useState<Set<string>>(load)

  const toggle = useCallback((id: string) => {
    setFavs(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      save(next)
      return next
    })
  }, [])

  const isFav = useCallback((id: string) => favs.has(id), [favs])

  return { favs, isFav, toggle }
}
