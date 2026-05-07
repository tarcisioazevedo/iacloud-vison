/**
 * ImpersonateQuickAccess — atalho global no TopBar pra integrador entrar como
 * um dos seus clientes. Abre seletor com search → ImpersonateModal pré-preenchido.
 *
 * Visível só pra INTEGRADOR_ADMIN. SUPER_ADMIN tem fluxo próprio em /admin/tenants.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { UserCheck, Search, X, Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import { ImpersonateModal } from '../hierarchy/ImpersonateModal'
import { cn } from '../../lib/utils'

interface ClienteRow {
  id: string
  name: string
  tradeName: string | null
  active: boolean
  _count?: { sites: number; users: number }
}

interface TreeResponse {
  clientes?: ClienteRow[]
}

const RECENTS_KEY = 'icv_impersonate_recents'
const MAX_RECENTS = 3

function loadRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') } catch { return [] }
}

function pushRecent(id: string) {
  const cur = loadRecents().filter(x => x !== id)
  cur.unshift(id)
  localStorage.setItem(RECENTS_KEY, JSON.stringify(cur.slice(0, MAX_RECENTS)))
}

export function ImpersonateQuickAccess() {
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  const visible = role === 'INTEGRADOR_ADMIN'

  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<ClienteRow | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const { data, isLoading } = useSWR<TreeResponse>(
    visible && pickerOpen ? '/me/integrador/tree?depth=1' : null,
    (url: string) => api.get(url).then(r => r.data),
    { revalidateOnFocus: false },
  )

  const clientes = data?.clientes ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = clientes.filter(c => c.active !== false)
    if (!q) return list
    return list.filter(c =>
      c.name.toLowerCase().includes(q) || (c.tradeName ?? '').toLowerCase().includes(q),
    )
  }, [clientes, search])

  const recents = useMemo(() => {
    const ids = loadRecents()
    return ids
      .map(id => clientes.find(c => c.id === id))
      .filter((c): c is ClienteRow => !!c && c.active !== false)
      .slice(0, MAX_RECENTS)
  }, [clientes])

  useEffect(() => {
    if (pickerOpen) {
      // Foca o search ao abrir
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    } else {
      setSearch('')
    }
  }, [pickerOpen])

  if (!visible) return null

  function handlePick(c: ClienteRow) {
    pushRecent(c.id)
    setChosen(c)
    setPickerOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        title="Acessar como cliente final (auditado · LGPD)"
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition border',
          'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100',
          'dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/20',
        )}
      >
        <UserCheck className="w-3.5 h-3.5" />
        Acessar como…
      </button>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 pt-20"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            onClick={e => e.stopPropagation()}
          >
            {/* Header com search */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar cliente…"
                className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white outline-none"
              />
              <button
                onClick={() => setPickerOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[60vh] overflow-y-auto">
              {isLoading && (
                <div className="flex items-center justify-center py-8 text-slate-400 text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando clientes…
                </div>
              )}

              {!isLoading && recents.length > 0 && !search && (
                <div className="px-2 pt-2 pb-1">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 px-2 py-1">
                    Recentes
                  </p>
                  {recents.map(c => (
                    <ClientePickerRow key={`r-${c.id}`} cliente={c} onPick={handlePick} />
                  ))}
                </div>
              )}

              {!isLoading && (
                <div className="px-2 pt-1 pb-2">
                  {recents.length > 0 && !search && (
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 px-2 pt-3 pb-1">
                      Todos os clientes
                    </p>
                  )}
                  {filtered.length === 0 ? (
                    <div className="text-center py-8 text-sm text-slate-400">
                      {search ? 'Nenhum cliente bate com a busca.' : 'Nenhum cliente cadastrado.'}
                    </div>
                  ) : (
                    filtered.map(c => (
                      <ClientePickerRow key={c.id} cliente={c} onPick={handlePick} />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
              <p className="text-[11px] text-slate-500">
                Ao escolher, você define motivo + LGPD ack. Cada ação fica visível ao cliente.
              </p>
            </div>
          </div>
        </div>
      )}

      {chosen && (
        <ImpersonateModal
          open={!!chosen}
          onClose={() => setChosen(null)}
          clienteFinalId={chosen.id}
          clienteName={chosen.tradeName ?? chosen.name}
        />
      )}
    </>
  )
}

function ClientePickerRow({ cliente, onPick }: { cliente: ClienteRow; onPick: (c: ClienteRow) => void }) {
  const display = cliente.tradeName ?? cliente.name
  return (
    <button
      type="button"
      onClick={() => onPick(cliente)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition group"
    >
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
        {display.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{display}</div>
        {cliente._count && (
          <div className="text-[11px] text-slate-500">
            {cliente._count.sites} site{cliente._count.sites === 1 ? '' : 's'} ·{' '}
            {cliente._count.users} usuário{cliente._count.users === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <UserCheck className="w-4 h-4 text-slate-400 group-hover:text-amber-500 transition" />
    </button>
  )
}
