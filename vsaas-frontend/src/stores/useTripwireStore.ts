/**
 * useTripwireStore — linhas de contagem (tripwire) por câmera.
 *
 * Cada câmera pode ter UMA linha configurada. Track que cruzar a linha
 * incrementa o contador. Direção (IN/OUT) determinada pelo lado em que
 * a track estava antes vs depois (sinal do produto cruzado).
 *
 * Persistência: localStorage via zustand/persist.
 *
 * Coordenadas normalizadas (0..1) — funciona em qualquer resolução.
 * Origem (0,0) = canto superior esquerdo do frame.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface TripwireLine {
  /** Endpoint A da linha (normalizado 0..1) */
  a: [number, number]
  /** Endpoint B da linha (normalizado 0..1) */
  b: [number, number]
  /** Label opcional ("Entrada principal", "Caixa", etc) */
  label?: string
  /** Habilitada? */
  enabled: boolean
}

interface TripwireCounter {
  in: number
  out: number
  /** Reset opcional — exibido em "desde HH:MM" */
  resetAt: number
}

interface TripwireState {
  /** Linhas por cameraId */
  lines: Record<string, TripwireLine>
  /** Contadores por cameraId — não-persistidos (reset no reload) */
  counters: Record<string, TripwireCounter>

  setLine: (cameraId: string, line: TripwireLine) => void
  removeLine: (cameraId: string) => void
  toggleLine: (cameraId: string) => void

  increment: (cameraId: string, direction: 'in' | 'out') => void
  resetCounter: (cameraId: string) => void
}

export const useTripwireStore = create<TripwireState>()(
  persist(
    (set) => ({
      lines: {},
      counters: {},

      setLine: (cameraId, line) => set((s) => ({
        lines: { ...s.lines, [cameraId]: line },
        counters: s.counters[cameraId]
          ? s.counters
          : { ...s.counters, [cameraId]: { in: 0, out: 0, resetAt: Date.now() } },
      })),

      removeLine: (cameraId) => set((s) => {
        const lines = { ...s.lines }
        delete lines[cameraId]
        const counters = { ...s.counters }
        delete counters[cameraId]
        return { lines, counters }
      }),

      toggleLine: (cameraId) => set((s) => {
        const cur = s.lines[cameraId]
        if (!cur) return s
        return { lines: { ...s.lines, [cameraId]: { ...cur, enabled: !cur.enabled } } }
      }),

      increment: (cameraId, direction) => set((s) => {
        const cur = s.counters[cameraId] ?? { in: 0, out: 0, resetAt: Date.now() }
        return {
          counters: {
            ...s.counters,
            [cameraId]: { ...cur, [direction]: cur[direction] + 1 },
          },
        }
      }),

      resetCounter: (cameraId) => set((s) => ({
        counters: {
          ...s.counters,
          [cameraId]: { in: 0, out: 0, resetAt: Date.now() },
        },
      })),
    }),
    {
      name: 'icv-tripwire',
      version: 1,
      // Não persistir counters — reset no reload é intencional (estado de sessão).
      partialize: (s) => ({ lines: s.lines }) as TripwireState,
    },
  ),
)
