/**
 * Sparkline — gráfico mini sem dependência externa.
 * Renderiza array de números como barras verticais ou linha SVG.
 */
import { cn } from '../../lib/utils'

export interface SparklineProps {
  values: number[]
  color?: string
  height?: number
  width?: number
  variant?: 'bars' | 'line'
  className?: string
}

export function Sparkline({
  values,
  color = 'currentColor',
  height = 24,
  width,
  variant = 'bars',
  className,
}: SparklineProps) {
  if (values.length === 0) return null
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1

  if (variant === 'bars') {
    return (
      <div
        className={cn('inline-flex items-end gap-0.5', className)}
        style={{ height }}
        aria-hidden
      >
        {values.map((v, i) => {
          const h = ((v - min) / range) * 100
          return (
            <span
              key={i}
              className="rounded-sm"
              style={{
                width: 4,
                height: `${Math.max(8, h)}%`,
                background: color,
                opacity: 0.7,
              }}
            />
          )
        })}
      </div>
    )
  }

  // Line variant
  const w = width ?? values.length * 6
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * w
      const y = height - ((v - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg width={w} height={height} className={className} aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
