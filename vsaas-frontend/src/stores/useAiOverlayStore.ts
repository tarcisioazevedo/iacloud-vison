/**
 * useAiOverlayStore — preferências do overlay de IA (bounding boxes ao vivo).
 *
 * Modelo hierárquico:
 *   1. globalEnabled — toggle master da toolbar (todas as câmeras visíveis)
 *   2. cameraEnabled — override por câmera (Map cameraId → boolean)
 *   3. enabledTypes  — filtros globais de tipo de objeto
 *   4. showLabels/showBoxes — visibilidade fina
 *   5. minConfidence — threshold global para filtrar ruído
 *
 * Resolução final:
 *   isOverlayActive(cameraId) =
 *     globalEnabled AND (cameraEnabled.get(cameraId) ?? true)
 *
 * Persistência:
 *   localStorage via zustand/persist — sobrevive a reloads.
 *
 * Defaults conservadores (mockup):
 *   - global ON, todas as câmeras herdando ON
 *   - tipos ativos: person, car (mais comum no varejo)
 *   - boxes + labels ON
 *   - minConfidence 0.5 (50%) — alinha com aiConfidenceMin default da câmera
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DEFAULT_ENABLED_TYPES: string[] = [
  // Pessoas e veículos
  'person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle',
  // Animais comuns
  'dog', 'cat',
  // Segurança — defaults críticos sempre ativos
  'knife', 'cell phone', 'backpack', 'scissors', 'baseball bat',
]

/**
 * Tipo de cada item no catálogo. `critical=true` muda o estilo visual
 * (borda vermelha em vez de verde) e habilita alertas mais intensos (Sprint 2).
 * `disabled=true` sinaliza recursos que exigem modelo custom não disponível
 * no YOLOv8 padrão — exibido como "PRO" no UI.
 */
export interface CatalogItem {
  id:        string
  emoji:     string
  label:     string
  /** Item de segurança crítica (faca, arma) — alerta destacado. */
  critical?: boolean
  /** Requer modelo custom (não YOLOv8 padrão) — exibe como PRO. */
  disabled?: boolean
  /** Descrição auxiliar mostrada no tooltip do painel. */
  hint?:     string
}

/**
 * Catálogo de objetos detectáveis com agrupamento por uso.
 * São 80 classes COCO suportadas pelo YOLOv8. Aqui listamos apenas as
 * relevantes para vigilância e contagem de fluxo. Acessível via painel.
 */
export const OBJECT_CATALOG: Record<string, { label: string; items: CatalogItem[] }> = {
  pessoas_veiculos: {
    label: 'Pessoas e Veículos',
    items: [
      { id: 'person',     emoji: '👤', label: 'Pessoa' },
      { id: 'car',        emoji: '🚗', label: 'Carro' },
      { id: 'motorcycle', emoji: '🏍️', label: 'Moto' },
      { id: 'bicycle',    emoji: '🚲', label: 'Bicicleta' },
      { id: 'bus',        emoji: '🚌', label: 'Ônibus' },
      { id: 'truck',      emoji: '🚚', label: 'Caminhão' },
    ],
  },
  seguranca: {
    label: 'Segurança',
    items: [
      { id: 'knife',      emoji: '🔪', label: 'Faca',     critical: true,
        hint: 'Detecção crítica · alerta imediato configurável' },
      { id: 'cell phone', emoji: '📱', label: 'Celular',
        hint: 'Identifica uso de celular em zonas restritas' },
      { id: 'backpack',   emoji: '🎒', label: 'Mochila',
        hint: 'Útil para identificar pacotes não atendidos' },
      { id: 'handbag',    emoji: '👜', label: 'Bolsa' },
      { id: 'suitcase',   emoji: '🧳', label: 'Mala' },
      { id: 'scissors',   emoji: '✂️', label: 'Tesoura', critical: true },
      { id: 'baseball bat', emoji: '🏏', label: 'Bastão', critical: true,
        hint: 'Possível arma improvisada' },
      // Modelo custom — não YOLOv8 padrão. Implementação Sprint 2:
      // carregar yolov8n-firearms.pt como detector secundário no worker.
      { id: 'weapon',     emoji: '🔫', label: 'Arma de fogo', critical: true, disabled: true,
        hint: 'Requer modelo custom treinado em dataset de armas (Sprint 2)' },
    ],
  },
  animais: {
    label: 'Animais',
    items: [
      { id: 'dog',   emoji: '🐕', label: 'Cachorro' },
      { id: 'cat',   emoji: '🐈', label: 'Gato' },
      { id: 'bird',  emoji: '🐦', label: 'Pássaro' },
      { id: 'horse', emoji: '🐴', label: 'Cavalo' },
    ],
  },
  objetos: {
    label: 'Objetos',
    items: [
      { id: 'laptop',     emoji: '💻', label: 'Notebook' },
      { id: 'umbrella',   emoji: '☂️', label: 'Guarda-chuva' },
      { id: 'bottle',     emoji: '🍾', label: 'Garrafa' },
      { id: 'book',       emoji: '📕', label: 'Livro' },
      { id: 'clock',      emoji: '🕐', label: 'Relógio' },
    ],
  },
  ambiente: {
    label: 'Ambiente',
    items: [
      { id: 'chair',        emoji: '🪑', label: 'Cadeira' },
      { id: 'couch',        emoji: '🛋️', label: 'Sofá' },
      { id: 'tv',           emoji: '📺', label: 'TV' },
      { id: 'potted plant', emoji: '🪴', label: 'Planta' },
    ],
  },
} as const

export type ObjectCategory = keyof typeof OBJECT_CATALOG

interface AiOverlayState {
  /** Master toggle — afeta todas as câmeras. */
  globalEnabled: boolean
  /** Override por câmera (true=ON, false=OFF, undefined=herda global). */
  cameraOverrides: Record<string, boolean>
  /** Tipos de objeto que aparecem como bbox. */
  enabledTypes: string[]
  /** Mostrar bounding box ao vivo. */
  showBoxes: boolean
  /** Mostrar label TIPO · % no canto. */
  showLabels: boolean
  /** Confiança mínima (0..1). Ruído abaixo disso é descartado client-side. */
  minConfidence: number

  // Actions
  setGlobalEnabled: (v: boolean) => void
  toggleGlobalEnabled: () => void
  setCameraEnabled: (cameraId: string, v: boolean | null) => void
  toggleCameraEnabled: (cameraId: string) => void
  setEnabledTypes: (types: string[]) => void
  toggleType: (type: string) => void
  setShowBoxes: (v: boolean) => void
  setShowLabels: (v: boolean) => void
  setMinConfidence: (v: number) => void
  resetToDefaults: () => void
}

export const useAiOverlayStore = create<AiOverlayState>()(
  persist(
    (set) => ({
      globalEnabled:   true,
      cameraOverrides: {},
      enabledTypes:    [...DEFAULT_ENABLED_TYPES],
      showBoxes:       true,
      showLabels:      true,
      minConfidence:   0.5,

      setGlobalEnabled: (v) => set({ globalEnabled: v }),
      toggleGlobalEnabled: () => set((s) => ({ globalEnabled: !s.globalEnabled })),

      setCameraEnabled: (cameraId, v) => set((s) => {
        const next = { ...s.cameraOverrides }
        if (v === null) delete next[cameraId]
        else            next[cameraId] = v
        return { cameraOverrides: next }
      }),
      toggleCameraEnabled: (cameraId) => set((s) => {
        const cur = s.cameraOverrides[cameraId] ?? s.globalEnabled
        return { cameraOverrides: { ...s.cameraOverrides, [cameraId]: !cur } }
      }),

      setEnabledTypes: (types) => set({ enabledTypes: types }),
      toggleType: (type) => set((s) => {
        const has = s.enabledTypes.includes(type)
        return {
          enabledTypes: has
            ? s.enabledTypes.filter(t => t !== type)
            : [...s.enabledTypes, type],
        }
      }),

      setShowBoxes:  (v) => set({ showBoxes: v }),
      setShowLabels: (v) => set({ showLabels: v }),
      setMinConfidence: (v) => set({ minConfidence: Math.max(0, Math.min(1, v)) }),

      resetToDefaults: () => set({
        globalEnabled:   true,
        cameraOverrides: {},
        enabledTypes:    [...DEFAULT_ENABLED_TYPES],
        showBoxes:       true,
        showLabels:      true,
        minConfidence:   0.5,
      }),
    }),
    {
      name: 'icv-ai-overlay',
      version: 1,
    },
  ),
)

/**
 * Hook utilitário — retorna se o overlay deve estar ativo para a câmera.
 *
 *   globalEnabled = true,  override undefined  → true  (herda global)
 *   globalEnabled = true,  override = false    → false (override desliga)
 *   globalEnabled = false, override = true     → true  (override liga)
 *   globalEnabled = false, override undefined  → false
 */
export function useIsOverlayActive(cameraId: string | null | undefined): boolean {
  return useAiOverlayStore((s) => {
    if (!cameraId) return false
    const override = s.cameraOverrides[cameraId]
    if (override !== undefined) return override
    return s.globalEnabled
  })
}
