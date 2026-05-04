/**
 * LogoUploader — campo de upload de logo white-label
 *
 * Drag & drop OU click para selecionar arquivo. Preview imediato.
 * POST multipart para o endpoint passado em prop.
 *
 * Aceita: SVG, PNG, JPEG, WebP. Limite 2 MB.
 */
import { useCallback, useRef, useState } from 'react'
import { api } from '../../api/client'

interface Props {
  /** URL atual do logo (vem do servidor). null = sem logo. */
  currentUrl: string | null
  /** Endpoint relativo (ex.: `/admin/integradores/<id>/logo`). */
  uploadUrl: string
  /** Endpoint DELETE para remover (mesma URL do POST normalmente). */
  deleteUrl?: string
  /** Texto auxiliar (ex.: "Logo do integrador — aparece no painel"). */
  hint?: string
  /** Callback após upload bem-sucedido — recebe a nova URL. */
  onUploaded?: (url: string) => void
  /** Callback após delete. */
  onDeleted?: () => void
}

const ACCEPTED = 'image/svg+xml,image/png,image/jpeg,image/webp'
const MAX_BYTES = 2 * 1024 * 1024

export function LogoUploader({
  currentUrl,
  uploadUrl,
  deleteUrl,
  hint,
  onUploaded,
  onDeleted,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(currentUrl)
  const [dragOver, setDragOver] = useState(false)

  const upload = useCallback(async (file: File) => {
    setErr(null)
    if (!ACCEPTED.split(',').includes(file.type)) {
      setErr('Formato inválido (use SVG, PNG, JPEG ou WebP)')
      return
    }
    if (file.size > MAX_BYTES) {
      setErr(`Arquivo grande demais (${(file.size / 1024 / 1024).toFixed(1)} MB > 2 MB)`)
      return
    }

    // Preview local imediato
    const reader = new FileReader()
    reader.onload = e => setPreview(String(e.target?.result || ''))
    reader.readAsDataURL(file)

    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post(uploadUrl, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (data?.logoUrl) {
        setPreview(data.logoUrl)
        onUploaded?.(data.logoUrl)
      }
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? e?.message ?? 'Falha no upload')
      setPreview(currentUrl) // rollback do preview
    } finally {
      setBusy(false)
    }
  }, [uploadUrl, currentUrl, onUploaded])

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) upload(file)
  }, [upload])

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) upload(file)
    // limpa input pra permitir re-selecionar mesmo arquivo
    e.target.value = ''
  }, [upload])

  const remove = useCallback(async () => {
    if (!deleteUrl) return
    setBusy(true)
    setErr(null)
    try {
      await api.delete(deleteUrl)
      setPreview(null)
      onDeleted?.()
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? e?.message ?? 'Falha ao remover')
    } finally {
      setBusy(false)
    }
  }, [deleteUrl, onDeleted])

  return (
    <div className="space-y-2">
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          'group relative cursor-pointer rounded-lg border-2 border-dashed transition',
          'flex items-center gap-4 p-4',
          'bg-slate-50 dark:bg-white/5',
          dragOver
            ? 'border-cyan-400 bg-cyan-50/50 dark:bg-cyan-500/10'
            : 'border-slate-300 dark:border-white/15 hover:border-cyan-400',
          busy && 'opacity-60 pointer-events-none',
        ].filter(Boolean).join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={onPick}
        />

        {/* Preview */}
        <div className="flex-none w-20 h-20 rounded-md bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 flex items-center justify-center overflow-hidden">
          {preview ? (
            <img
              src={preview}
              alt="Logo preview"
              className="max-w-full max-h-full object-contain"
              onError={() => setErr('Não foi possível carregar a imagem')}
            />
          ) : (
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16v16H4z" /><path d="M4 16l5-5 5 5 6-6" /><circle cx="9" cy="9" r="1.5" />
            </svg>
          )}
        </div>

        {/* Texto */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            {busy
              ? 'Enviando...'
              : preview
                ? 'Clique ou arraste para trocar'
                : 'Clique ou arraste o logo aqui'}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">
            {hint ?? 'SVG, PNG, JPEG ou WebP — até 2 MB. Recomendado: largura ≥ 320 px.'}
          </p>
        </div>

        {preview && deleteUrl && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); remove() }}
            className="flex-none px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-500/10 dark:hover:bg-red-500/20 dark:text-red-300"
          >
            Remover
          </button>
        )}
      </div>

      {err && (
        <p className="text-xs text-red-600 dark:text-red-400 font-mono">⚠ {err}</p>
      )}
    </div>
  )
}
