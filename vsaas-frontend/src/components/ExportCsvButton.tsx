import { Download } from 'lucide-react'
import { cn } from '../lib/utils'
import { downloadCsv, type CsvColumn } from '../lib/csv'

interface Props<T> {
  basename: string
  rows: readonly T[]
  columns: readonly CsvColumn<T>[]
  label?: string
  className?: string
  variant?: 'primary' | 'ghost'
  disabled?: boolean
}

export function ExportCsvButton<T>({
  basename, rows, columns, label = 'CSV',
  className, variant = 'ghost', disabled,
}: Props<T>) {
  const empty = rows.length === 0
  const isDisabled = disabled || empty
  return (
    <button
      onClick={() => { if (!isDisabled) downloadCsv(basename, rows, columns) }}
      disabled={isDisabled}
      title={empty ? 'Sem dados para exportar' : `Exportar ${rows.length} linhas em CSV`}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition border',
        variant === 'primary'
          ? 'bg-brand-sky text-white hover:bg-brand-skyDeep border-transparent'
          : cn(
              'bg-slate-50 border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-100',
              'dark:bg-space-800/60 dark:border-white/10 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/5',
            ),
        isDisabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      <Download className="w-3.5 h-3.5" />
      {label}
      {rows.length > 0 && (
        <span className="text-[10px] font-mono opacity-70 ml-0.5">({rows.length})</span>
      )}
    </button>
  )
}
