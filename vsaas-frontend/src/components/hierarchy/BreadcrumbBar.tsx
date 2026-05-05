/**
 * BreadcrumbBar — Hierarquical breadcrumb (Fabricante › Integrador › Cliente › Site › Box).
 *
 * Adapts automatically based on which segments are passed. Each segment is clickable
 * (uses Link from react-router-dom). The last segment is rendered as plain text.
 *
 * Persona-aware: just don't pass the segments the persona shouldn't see (e.g. cliente
 * never sees the Fabricante or Integrador segments).
 */
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface BreadcrumbSegment {
  /** Emoji or icon string shown before the label */
  icon?: string
  /** Visible label */
  label: string
  /** Path to navigate. If omitted, segment renders as plain text (current). */
  to?: string
}

export interface BreadcrumbBarProps {
  segments: BreadcrumbSegment[]
  className?: string
}

export function BreadcrumbBar({ segments, className }: BreadcrumbBarProps) {
  if (segments.length === 0) return null

  return (
    <nav aria-label="breadcrumb" className={cn('flex items-center gap-1 text-sm flex-wrap', className)}>
      {segments.map((seg, idx) => {
        const isLast = idx === segments.length - 1
        const content = (
          <span className="inline-flex items-center gap-1.5">
            {seg.icon && <span aria-hidden>{seg.icon}</span>}
            <span>{seg.label}</span>
          </span>
        )
        return (
          <span key={idx} className="inline-flex items-center gap-1">
            {seg.to && !isLast ? (
              <Link to={seg.to} className="text-slate-400 hover:text-violet-300 transition">
                {content}
              </Link>
            ) : (
              <span className={isLast ? 'text-white font-medium' : 'text-slate-400'}>
                {content}
              </span>
            )}
            {!isLast && <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
          </span>
        )
      })}
    </nav>
  )
}
