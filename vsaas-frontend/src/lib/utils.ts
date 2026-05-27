import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export const EMOTION_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  joy:      { label: 'Feliz',     color: '#fbbf24', emoji: '😊' },
  neutral:  { label: 'Neutro',   color: '#94a3b8', emoji: '😐' },
  sorrow:   { label: 'Triste',   color: '#60a5fa', emoji: '😢' },
  anger:    { label: 'Raiva',    color: '#f87171', emoji: '😠' },
  surprise: { label: 'Surpreso', color: '#a78bfa', emoji: '😮' },
}

/**
 * Label humano + curto para o enum RecordingMode.
 * Aceita também os aliases antigos ('ALL', 'ACTIVE_OBJECTS') por compat retroativa
 * com câmeras que ainda não passaram pelo PATCH de normalização (2026-05-27).
 */
export function recordingModeLabel(m: string | null | undefined): string {
  switch (m) {
    case 'CONTINUOUS':
    case 'ALL':              return 'Contínuo'
    case 'MOTION':           return 'Motion'
    case 'EVENT':
    case 'ACTIVE_OBJECTS':   return 'Evento'
    case 'DISABLED':         return 'Desligado'
    default:                 return m ?? '—'
  }
}

export const VERTICAL_CONFIG: Record<string, { label: string; icon: string; accent: string }> = {
  SHOPPING_MALL: { label: 'Shopping',   icon: '🏬', accent: 'cyan'    },
  RETAIL:        { label: 'Varejo',     icon: '🛍️', accent: 'violet'  },
  INDUSTRIAL:    { label: 'Indústria',  icon: '🏭', accent: 'amber'   },
  OFFICE:        { label: 'Escritório', icon: '🏢', accent: 'emerald' },
  SCHOOL:        { label: 'Escola',     icon: '🏫', accent: 'rose'    },
  CONDOMINIUM:   { label: 'Condomínio', icon: '🏘️', accent: 'cyan'    },
  HEALTHCARE:    { label: 'Saúde',      icon: '🏥', accent: 'emerald' },
}
