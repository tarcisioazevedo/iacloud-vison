/**
 * Rampa de cor compartilhada para visualizações de densidade (heatmap/grid).
 * Extraído de HeatmapGrid.tsx para reuso em outras views de densidade
 * (ex.: densidade espacial x/y por câmera).
 */
export function densityToColor(v: number): string {
  // Cool (blue) → warm (yellow) → hot (red)
  if (v < 0.2)  return `rgba(6, 182, 212, ${v * 2})`
  if (v < 0.5)  return `rgba(139, 92, 246, ${0.3 + v})`
  if (v < 0.75) return `rgba(251, 191, 36, ${0.4 + v * 0.6})`
  return `rgba(244, 63, 94, ${0.5 + v * 0.5})`
}
