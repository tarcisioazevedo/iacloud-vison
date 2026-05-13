/**
 * CommandPalette — Cmd+K / Ctrl+K palette com busca cross-entidade.
 *
 * Persona-aware:
 * - SUPER_ADMIN: busca em integradores, clientes, sites, câmeras, ações
 * - INTEGRADOR_ADMIN: busca em próprios clientes, sites, boxes, câmeras
 * - CLIENTE_*: busca em próprias câmeras, sites
 *
 * Não usa libs externas (cmdk não instalado no projeto). Implementação
 * minimal mas funcional. Pode ser substituída por cmdk em onda futura.
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { Search, X, ArrowRight, Building2, MapPin, Server, Camera, Plus, ShieldCheck } from 'lucide-react'
import { api, useMyIntegradorTree } from '../../api/client'
import { cn } from '../../lib/utils'

interface CommandItem {
  id: string
  group: string
  label: string
  hint?: string
  icon?: typeof Building2
  keywords?: string[]
  action: () => void
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  const isSuper = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
  const isIntegrador = role === 'INTEGRADOR_ADMIN' || role === 'INTEGRADOR_TECNICO'

  // Listener Cmd/Ctrl + K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Data sources — busca de integradores APENAS para super-admin (rota /admin/integradores
  // retorna 401 para INTEGRADOR_*, o que dispara o auto-logout do interceptor).
  const { data: integradores } = useSWR<{ integradores: any[]; total: number }>(
    isSuper ? '/admin/integradores' : null,
    (url: string) => api.get(url).then(r => r.data),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  )
  const { data: myTree } = useMyIntegradorTree(2)

  const items = useMemo<CommandItem[]>(() => {
    const out: CommandItem[] = []

    // Tenants (super-admin) ou Meu Negócio (integrador)
    if (isSuper && integradores?.integradores) {
      for (const i of integradores.integradores) {
        out.push({
          id: `int-${i.id}`,
          group: 'Integradores',
          label: i.name,
          hint: i.email,
          icon: Building2,
          keywords: [i.email],
          action: () => navigate(`/admin/tenants/${i.id}`),
        })
      }
    }

    if (isIntegrador && myTree?.clientes) {
      for (const c of myTree.clientes) {
        out.push({
          id: `cli-${c.id}`,
          group: 'Clientes',
          label: c.name,
          hint: c.email,
          icon: Building2,
          keywords: [c.email],
          action: () => navigate(`/clientes-finais?id=${c.id}`),
        })
        for (const s of (c.sites ?? [])) {
          out.push({
            id: `site-${s.id}`,
            group: 'Sites',
            label: s.name,
            hint: `${c.name}${s.city ? ' · ' + s.city : ''}`,
            icon: MapPin,
            keywords: [c.name, s.city ?? ''],
            action: () => navigate(`/sites?id=${s.id}`),
          })
        }
      }
    }

    if (isSuper && integradores?.integradores) {
      // Para super-admin, agregar também os clientes via cada tree (lazy via SWR pode ser caro;
      // por ora deixamos só no detalhe do integrador)
    }

    // Ações comuns
    const navItems: Array<[string, string, typeof Building2]> = [
      ['Dashboard', '/', Building2],
      ['Câmeras', '/cameras', Camera],
      ['Sites', '/sites', MapPin],
      ['Edge Boxes', '/edge', Server],
      ['Ao Vivo', '/live', Camera],
      ['Gravações', '/recordings', Camera],
      ['Auditoria', '/audit', ShieldCheck],
    ]
    for (const [label, to, Icon] of navItems) {
      out.push({
        id: `nav-${to}`,
        group: 'Navegar para',
        label,
        icon: Icon,
        action: () => navigate(to),
      })
    }

    if (isSuper) {
      out.push({
        id: 'nav-tenants',
        group: 'Navegar para',
        label: 'Tenants',
        icon: Building2,
        action: () => navigate('/admin/tenants'),
      })
      out.push({
        id: 'nav-comercial',
        group: 'Navegar para',
        label: 'Comercial',
        icon: Building2,
        action: () => navigate('/admin/comercial'),
      })
    }

    if (isIntegrador) {
      out.push({
        id: 'nav-meu-negocio',
        group: 'Navegar para',
        label: 'Meu Negócio',
        icon: Building2,
        action: () => navigate('/integrador'),
      })
    }

    // Ações
    out.push({
      id: 'act-new-cliente',
      group: 'Ações',
      label: '+ Novo cliente',
      icon: Plus,
      action: () => navigate('/clientes-finais'),
    })
    out.push({
      id: 'act-new-box',
      group: 'Ações',
      label: '+ Provisionar edge box',
      icon: Plus,
      action: () => navigate('/edge'),
    })
    out.push({
      id: 'act-new-cam',
      group: 'Ações',
      label: '+ Adicionar câmera',
      icon: Plus,
      action: () => navigate('/cameras'),
    })

    return out
  }, [integradores, myTree, isSuper, isIntegrador, navigate])

  const filtered = useMemo(() => {
    if (!query.trim()) return items
    const q = query.toLowerCase()
    return items.filter(i =>
      i.label.toLowerCase().includes(q) ||
      i.hint?.toLowerCase().includes(q) ||
      i.keywords?.some(k => k.toLowerCase().includes(q)),
    )
  }, [items, query])

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>()
    for (const item of filtered) {
      const arr = map.get(item.group) ?? []
      arr.push(item)
      map.set(item.group, arr)
    }
    return Array.from(map.entries())
  }, [filtered])

  function executeActive() {
    const item = filtered[activeIdx]
    if (!item) return
    item.action()
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      executeActive()
    }
  }

  if (!open) return null

  let runningIdx = -1

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl mx-4 bg-white dark:bg-slate-900 border border-violet-500/30 rounded-2xl shadow-2xl shadow-violet-500/10 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-violet-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            onKeyDown={onKeyDown}
            placeholder="Buscar integrador, cliente, site, câmera ou ação…"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-white text-xs"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {grouped.length === 0 ? (
            <div className="text-center text-xs text-slate-500 py-8">
              Nenhum resultado para "{query}"
            </div>
          ) : (
            grouped.map(([group, gitems]) => (
              <div key={group} className="mb-1">
                <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-violet-400 font-bold">
                  {group}
                </div>
                {gitems.map(item => {
                  runningIdx++
                  const isActive = runningIdx === activeIdx
                  const Icon = item.icon ?? Building2
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { item.action(); setOpen(false) }}
                      onMouseEnter={(() => {
                        const myIdx = filtered.findIndex(f => f.id === item.id)
                        return () => setActiveIdx(myIdx)
                      })()}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2 text-left transition',
                        isActive ? 'bg-violet-500/10 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:bg-slate-800/50',
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0 text-slate-500" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{item.label}</div>
                        {item.hint && (
                          <div className="text-[10px] text-slate-500 truncate">{item.hint}</div>
                        )}
                      </div>
                      <ArrowRight className={cn('w-3.5 h-3.5 shrink-0', isActive ? 'text-violet-400' : 'text-slate-700')} />
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-2 flex items-center gap-3 text-[10px] text-slate-500">
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono">↑↓</kbd> navegar</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono">↵</kbd> abrir</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono">esc</kbd> fechar</span>
          <span className="ml-auto">{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  )
}
