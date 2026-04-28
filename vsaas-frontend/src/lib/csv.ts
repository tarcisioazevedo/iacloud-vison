// ─────────────────────────────────────────────────────────────────
// CSV export utility — gera CSV client-side a partir de arrays JS.
// Seguimos RFC 4180:
//   - campos com , " \n \r são quotados
//   - aspas duplas internas são escapadas duplicando ("")
//   - BOM UTF-8 prefixado para Excel interpretar acentos corretamente
// ─────────────────────────────────────────────────────────────────

export interface CsvColumn<T> {
  /** Cabeçalho exibido no CSV */
  header: string
  /** Função que extrai o valor da linha — pode retornar string/number/boolean/null/undefined */
  accessor: (row: T) => string | number | boolean | null | undefined | Date
}

function escapeField(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (v instanceof Date) {
    s = v.toISOString()
  } else if (typeof v === 'object') {
    s = JSON.stringify(v)
  } else {
    s = String(v)
  }
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const headerLine = columns.map(c => escapeField(c.header)).join(',')
  const bodyLines = rows.map(r =>
    columns.map(c => escapeField(c.accessor(r))).join(','),
  )
  return [headerLine, ...bodyLines].join('\r\n')
}

/** Triggers a browser download of the CSV. Filename recebe timestamp automaticamente. */
export function downloadCsv<T>(
  basename: string,
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): void {
  const csv = toCsv(rows, columns)
  const bom = '\uFEFF' // Excel UTF-8
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const a = document.createElement('a')
  a.href = url
  a.download = `${basename}_${ts}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
