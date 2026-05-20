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
  /**
   * Direcao do IN relativa ao vetor (A -> B).
   * 'left'  = IN do lado esquerdo (default — produto cruzado > 0)
   * 'right' = IN do lado direito  (inverte a logica)
   */
  inDirection?: 'left' | 'right'
  /**
   * Rotulos customizaveis para cada direcao.
   * Defaults: "IN" e "OUT". Pode ser "Subindo"/"Descendo",
   * "Entrada"/"Saida", "Centro"/"Bairro", etc.
   */
  labelIn?:  string
  labelOut?: string
}

/** Contagem por direcao, segregada por tipo (person, car, motorcycle, ...) */
export type TypeCounts = Record<string, number>

interface TripwireCounter {
  in:  TypeCounts
  out: TypeCounts
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

  /** Incrementa contador na direcao + tipo (person, car, etc) */
  increment: (cameraId: string, direction: 'in' | 'out', objectType: string) => void
  resetCounter: (cameraId: string) => void
}

function emptyCounter(): TripwireCounter {
  return { in: {}, out: {}, resetAt: Date.now() }
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
          : { ...s.counters, [cameraId]: emptyCounter() },
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

      increment: (cameraId, direction, objectType) => set((s) => {
        const cur = s.counters[cameraId] ?? emptyCounter()
        const bucket = { ...cur[direction] }
        bucket[objectType] = (bucket[objectType] ?? 0) + 1
        return {
          counters: {
            ...s.counters,
            [cameraId]: { ...cur, [direction]: bucket },
          },
        }
      }),

      resetCounter: (cameraId) => set((s) => ({
        counters: { ...s.counters, [cameraId]: emptyCounter() },
      })),
    }),
    {
      name: 'icv-tripwire',
      // v2: schema do TripwireLine ganhou labelIn/labelOut; counter
      // mudou de {in:number,out:number} pra {in:TypeCounts,out:TypeCounts}.
      version: 2,
      // Não persistir counters — reset no reload é intencional (estado de sessão).
      partialize: (s) => ({ lines: s.lines }) as TripwireState,
    },
  ),
)
