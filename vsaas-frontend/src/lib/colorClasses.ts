/**
 * Mapas estáticos de classes Tailwind por cor.
 *
 * Motivação: Tailwind JIT só ve classes que aparecem como texto literal no
 * source. Construções dinâmicas como `bg-${color}-500` são purgadas no build
 * de produção e os botões/badges saem sem cor.
 *
 * Estratégia preferida: usar estes mapas estáticos.
 * Rede de segurança: `safelist` em `tailwind.config.js`.
 *
 * Cada função aceita uma cor (ou string arbitrária) e devolve a classe
 * Tailwind correspondente, com fallback `slate` quando a cor não é conhecida.
 *
 * Adicione novas cores aqui conforme novos componentes precisarem — manter
 * a lista enxuta evita inflar o CSS final.
 */

export type BrandColor =
  | 'red'
  | 'green'
  | 'amber'
  | 'cyan'
  | 'violet'
  | 'emerald'
  | 'rose'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'pink'
  | 'orange'
  | 'teal'
  | 'fuchsia'
  | 'slate'

const COLORS: readonly BrandColor[] = [
  'red', 'green', 'amber', 'cyan', 'violet', 'emerald', 'rose',
  'sky', 'blue', 'indigo', 'purple', 'pink', 'orange', 'teal', 'fuchsia', 'slate',
] as const

function buildMap<T extends string>(builder: (color: BrandColor) => T): Record<string, T> {
  const map: Record<string, T> = {}
  for (const c of COLORS) map[c] = builder(c)
  return map
}

// ── bg-{color}-500 ────────────────────────────────────────────────
const BG_500 = buildMap((c) => `bg-${c}-500` as const)
export const bg500 = (color: string): string => BG_500[color] ?? 'bg-slate-500'

// ── bg-{color}-500/20 ─────────────────────────────────────────────
const BG_500_20 = buildMap((c) => `bg-${c}-500/20` as const)
export const bg500_20 = (color: string): string => BG_500_20[color] ?? 'bg-slate-500/20'

// ── bg-{color}-500/15 ─────────────────────────────────────────────
const BG_500_15 = buildMap((c) => `bg-${c}-500/15` as const)
export const bg500_15 = (color: string): string => BG_500_15[color] ?? 'bg-slate-500/15'

// ── bg-{color}-500/30 ─────────────────────────────────────────────
const BG_500_30 = buildMap((c) => `bg-${c}-500/30` as const)
export const bg500_30 = (color: string): string => BG_500_30[color] ?? 'bg-slate-500/30'

// ── bg-{color}-500/10 ─────────────────────────────────────────────
const BG_500_10 = buildMap((c) => `bg-${c}-500/10` as const)
export const bg500_10 = (color: string): string => BG_500_10[color] ?? 'bg-slate-500/10'

// ── bg-{color}-500/40 ─────────────────────────────────────────────
const BG_500_40 = buildMap((c) => `bg-${c}-500/40` as const)
export const bg500_40 = (color: string): string => BG_500_40[color] ?? 'bg-slate-500/40'

// ── hover:bg-{color}-500/20 ───────────────────────────────────────
const HOVER_BG_500_20 = buildMap((c) => `hover:bg-${c}-500/20` as const)
export const hoverBg500_20 = (color: string): string => HOVER_BG_500_20[color] ?? 'hover:bg-slate-500/20'

// ── hover:bg-{color}-500/25 ───────────────────────────────────────
const HOVER_BG_500_25 = buildMap((c) => `hover:bg-${c}-500/25` as const)
export const hoverBg500_25 = (color: string): string => HOVER_BG_500_25[color] ?? 'hover:bg-slate-500/25'

// ── text-{color}-100 / 200 / 300 / 400 / 500 ──────────────────────
const TEXT_100 = buildMap((c) => `text-${c}-100` as const)
const TEXT_200 = buildMap((c) => `text-${c}-200` as const)
const TEXT_300 = buildMap((c) => `text-${c}-300` as const)
const TEXT_400 = buildMap((c) => `text-${c}-400` as const)
const TEXT_500 = buildMap((c) => `text-${c}-500` as const)
const TEXT_700 = buildMap((c) => `text-${c}-700` as const)
const DARK_TEXT_300 = buildMap((c) => `dark:text-${c}-300` as const)
const DARK_TEXT_400 = buildMap((c) => `dark:text-${c}-400` as const)

export const text100 = (color: string): string => TEXT_100[color] ?? 'text-slate-100'
export const text200 = (color: string): string => TEXT_200[color] ?? 'text-slate-200'
export const text300 = (color: string): string => TEXT_300[color] ?? 'text-slate-300'
export const text400 = (color: string): string => TEXT_400[color] ?? 'text-slate-400'
export const text500 = (color: string): string => TEXT_500[color] ?? 'text-slate-500'
export const text700 = (color: string): string => TEXT_700[color] ?? 'text-slate-700'
export const darkText300 = (color: string): string => DARK_TEXT_300[color] ?? 'dark:text-slate-300'
export const darkText400 = (color: string): string => DARK_TEXT_400[color] ?? 'dark:text-slate-400'

// ── border-{color}-500/30, /40, /50, /60, /70 ─────────────────────
const BORDER_500_30 = buildMap((c) => `border-${c}-500/30` as const)
const BORDER_500_40 = buildMap((c) => `border-${c}-500/40` as const)
const BORDER_500_50 = buildMap((c) => `border-${c}-500/50` as const)
const BORDER_500_60 = buildMap((c) => `border-${c}-500/60` as const)
const BORDER_500_70 = buildMap((c) => `border-${c}-500/70` as const)
const HOVER_BORDER_500_40 = buildMap((c) => `hover:border-${c}-500/40` as const)

export const border500_30 = (color: string): string => BORDER_500_30[color] ?? 'border-slate-500/30'
export const border500_40 = (color: string): string => BORDER_500_40[color] ?? 'border-slate-500/40'
export const border500_50 = (color: string): string => BORDER_500_50[color] ?? 'border-slate-500/50'
export const border500_60 = (color: string): string => BORDER_500_60[color] ?? 'border-slate-500/60'
export const border500_70 = (color: string): string => BORDER_500_70[color] ?? 'border-slate-500/70'
export const hoverBorder500_40 = (color: string): string => HOVER_BORDER_500_40[color] ?? 'hover:border-slate-500/40'
