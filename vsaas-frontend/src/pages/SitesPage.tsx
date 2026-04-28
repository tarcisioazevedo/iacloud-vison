/**
 * Sprint U.2.2 — SitesPage
 *
 * Listagem e cadastro de sites (locais físicos: filiais, lojas) que agrupam
 * câmeras dentro de um cliente final.
 *
 * Backend hoje expõe:
 *   - GET  /sites?includeInactive=true     → lista escopada por tenant (JWT)
 *   - GET  /sites/:id                      → detalhe
 *   - POST /sites                          → cria (SUPER_ADMIN, INTEGRADOR_ADMIN)
 *
 * Sem PATCH/DELETE no backend — UI é create + read + drill-in pra câmeras.
 *
 * Notas de UX:
 *   - INTEGRADOR_ADMIN cria sites para seus clientes finais (dropdown vem de
 *     /modules/clientes que devolve só os clientes do integrador).
 *   - SUPER_ADMIN vê sites de todos os tenants mas NÃO cria diretamente — fluxo
 *     dele é via Integrador (escolhe cliente do integrador certo). Banner amber
 *     explica.
 *   - CLIENTE_ADMIN/VIEWER veem apenas o próprio site (backend isola).
 */
import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Building2, Plus, Search, MapPin, Loader2, AlertTriangle, CheckCircle2,
  X, Camera as CameraIcon, ExternalLink, Globe, Info,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useSites, createSite, useClientesModules, formatApiError,
  type SiteRow,
} from '../api/client'
import { cn } from '../lib/utils'

const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
const canCreate = role === 'INTEGRADOR_ADMIN'
const isSuperAdmin = role === 'SUPER_ADMIN'

export function SitesPage() {
  const [includeInactive, setIncludeInactive] = useState(false)
  const { data, error, isLoading, mutate } = useSites(includeInactive)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [drawerId, setDrawerId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const list = data?.sites ?? []
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.clienteFinal.name.toLowerCase().includes(q) ||
      (s.city ?? '').toLowerCase().includes(q),
    )
  }, [data, search])

  const drawerSite = useMemo(
    () => (data?.sites ?? []).find(s => s.id === drawerId) ?? null,
    [data, drawerId],
  )

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-emerald-500/10 via-cyan-500/5 to-transparent border-emerald-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <MapPin className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Sites</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Locais físicos (filiais, lojas, unidades) que agrupam câmeras dentro
                de um <strong className="text-slate-900 dark:text-white">cliente final</strong>. Cada site
                pode ter seu próprio Edge Node, fuso horário e endereço.
              </p>
            </div>
          </div>

          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white text-sm font-bold shadow-lg shadow-emerald-500/20 transition"
            >
              <Plus className="w-4 h-4" />
              Novo site
            </button>
          )}
        </div>

        {isSuperAdmin && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200">
              Como super-admin, você vê sites de todos os tenants. Para criar um
              novo site, faça login como o integrador correspondente — o backend
              vincula o site ao cliente final do integrador.
            </p>
          </div>
        )}
      </GlassCard>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por site, cliente ou cidade..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400 cursor-pointer hover:text-slate-200">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={e => setIncludeInactive(e.target.checked)}
            className="accent-emerald-500"
          />
          Incluir inativos
        </label>
        <span className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400 font-mono">
          {filtered.length} {filtered.length === 1 ? 'site' : 'sites'}
        </span>
      </div>

      {/* Errors */}
      {error && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">Falha ao listar sites</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatApiError(error)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Empty / loading */}
      {isLoading && !data && (
        <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs">Carregando sites...</p>
        </GlassCard>
      )}

      {data && filtered.length === 0 && !search && (
        <GlassCard className="p-12 text-center">
          <Building2 className="w-12 h-12 mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum site cadastrado ainda.</p>
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-200 text-xs font-bold transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Cadastrar o primeiro
            </button>
          )}
        </GlassCard>
      )}

      {/* Tabela */}
      {filtered.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02] border-b border-white/5">
              <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5 text-left">Site</th>
                <th className="px-4 py-2.5 text-left">Cliente final</th>
                <th className="px-4 py-2.5 text-left w-44">Localização</th>
                <th className="px-4 py-2.5 text-left w-24">Câmeras</th>
                <th className="px-4 py-2.5 text-left w-24">Status</th>
                <th className="px-4 py-2.5 text-right w-32">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <SiteRowItem key={s.id} site={s} onSelect={() => setDrawerId(s.id)} />
              ))}
            </tbody>
          </table>
        </GlassCard>
      )}

      <AnimatePresence>
        {showCreate && (
          <CreateSiteModal
            onClose={() => setShowCreate(false)}
            onSuccess={() => { mutate(); setShowCreate(false) }}
          />
        )}
        {drawerSite && (
          <SiteDrawer site={drawerSite} onClose={() => setDrawerId(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function SiteRowItem({ site, onSelect }: { site: SiteRow; onSelect: () => void }) {
  return (
    <tr className="border-b border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition cursor-pointer" onClick={onSelect}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 border border-emerald-500/30 flex items-center justify-center text-[11px] font-bold text-emerald-200">
            {site.name[0]?.toUpperCase() ?? 'S'}
          </div>
          <span className="text-sm font-medium text-white">{site.name}</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-slate-300">
        {site.clienteFinal.tradeName || site.clienteFinal.name}
      </td>
      <td className="px-4 py-2.5 text-xs text-slate-400">
        {site.city || site.state ? (
          <span className="font-mono">
            {[site.city, site.state].filter(Boolean).join(' / ')}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono">
          {site._count.cameras}
        </span>
      </td>
      <td className="px-4 py-2.5">
        {site.active ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-300">
            <CheckCircle2 className="w-3 h-3" /> Ativo
          </span>
        ) : (
          <span className="text-[10px] text-slate-500">Inativo</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        <Link
          to={`/cameras?siteId=${site.id}`}
          onClick={e => e.stopPropagation()}
          title="Ver câmeras deste site"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition"
        >
          <CameraIcon className="w-3 h-3" />
          Câmeras
        </Link>
      </td>
    </tr>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function SiteDrawer({ site, onClose }: { site: SiteRow; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }}
        transition={{ type: 'tween', duration: 0.2 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg h-full bg-space-900 border-l border-white/10 overflow-y-auto"
      >
        <header className="sticky top-0 bg-space-900/95 backdrop-blur border-b border-white/10 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{site.name}</h3>
            <p className="text-xs text-slate-500">
              {site.clienteFinal.tradeName || site.clienteFinal.name}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-2">
            <Tile icon={CameraIcon} label="Câmeras" value={String(site._count.cameras)} accent="cyan" />
            <Tile icon={CheckCircle2} label="Status" value={site.active ? 'Ativo' : 'Inativo'} accent={site.active ? 'emerald' : 'slate'} />
          </div>

          {/* Endereço */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" />
              Endereço
            </h4>
            <div className="space-y-1 text-xs text-slate-300">
              {site.address ? <p>{site.address}</p> : <p className="text-slate-600 italic">Sem endereço cadastrado</p>}
              <p className="font-mono text-slate-400">
                {[site.city, site.state].filter(Boolean).join(' / ') || '—'}
              </p>
            </div>
          </div>

          {/* Ações */}
          <div className="pt-2 border-t border-white/5 space-y-2">
            <Link
              to={`/cameras?siteId=${site.id}`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-200 text-xs font-semibold transition"
            >
              <span className="flex items-center gap-2">
                <CameraIcon className="w-3.5 h-3.5" />
                Ver câmeras deste site
              </span>
              <ExternalLink className="w-3 h-3" />
            </Link>
            <Link
              to={`/edge`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 text-violet-200 text-xs font-semibold transition"
            >
              <span className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5" />
                Edge Nodes
              </span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <p className="text-[10px] text-slate-600 font-mono pt-2 border-t border-white/5">
            site_id: {site.id}
          </p>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function Tile({ icon: Icon, label, value, accent }: {
  icon: any; label: string; value: string; accent: 'cyan' | 'emerald' | 'violet' | 'slate'
}) {
  const colors = {
    cyan:    'text-cyan-300 border-cyan-500/20 bg-cyan-500/5',
    emerald: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/5',
    violet:  'text-violet-300 border-violet-500/20 bg-violet-500/5',
    slate:   'text-slate-400 border-white/10 bg-white/5',
  }[accent]
  return (
    <div className={cn('rounded-lg border p-3', colors)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <p className="mt-1 text-base font-bold">{value}</p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
interface ClienteFinalOpt {
  id: string
  name: string
  tradeName?: string | null
}

function CreateSiteModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { data: clientesData, error: clientesErr, isLoading: clientesLoading } =
    useClientesModules() as { data?: { clientes?: ClienteFinalOpt[] }; error?: any; isLoading: boolean }

  const clientes = clientesData?.clientes ?? []
  const [form, setForm] = useState({
    clienteFinalId: '',
    name: '',
    address: '',
    city: '',
    state: '',
    country: 'BR',
    timezone: 'America/Sao_Paulo',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)

  // Pré-seleciona o primeiro cliente quando carrega
  useEffect(() => {
    if (!form.clienteFinalId && clientes.length > 0) {
      setForm(f => ({ ...f, clienteFinalId: clientes[0].id }))
    }
  }, [clientes, form.clienteFinalId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitErr(null)
    if (!form.clienteFinalId) {
      setSubmitErr('Selecione um cliente final')
      return
    }
    if (form.name.trim().length < 2) {
      setSubmitErr('Nome do site deve ter ao menos 2 caracteres')
      return
    }
    setSubmitting(true)
    try {
      await createSite({
        clienteFinalId: form.clienteFinalId,
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        country: form.country.trim() || undefined,
        timezone: form.timezone.trim() || undefined,
      })
      onSuccess()
    } catch (err) {
      setSubmitErr(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        <header className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Novo site</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Cliente final dropdown */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Cliente final *
            </label>
            {clientesLoading ? (
              <div className="h-10 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
              </div>
            ) : clientesErr ? (
              <div className="text-xs text-rose-300">{formatApiError(clientesErr)}</div>
            ) : clientes.length === 0 ? (
              <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
                Nenhum cliente final cadastrado. Cadastre primeiro um cliente
                no painel do integrador.
              </div>
            ) : (
              <select
                value={form.clienteFinalId}
                onChange={e => setForm(f => ({ ...f, clienteFinalId: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500/50"
              >
                {clientes.map(c => (
                  <option key={c.id} value={c.id} className="bg-space-900">
                    {c.tradeName || c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <Input label="Nome do site *" value={form.name}
            onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Ex.: Loja Centro" />

          <Input label="Endereço" value={form.address}
            onChange={v => setForm(f => ({ ...f, address: v }))} placeholder="Rua, número, complemento" />

          <div className="grid grid-cols-2 gap-3">
            <Input label="Cidade" value={form.city}
              onChange={v => setForm(f => ({ ...f, city: v }))} placeholder="São Paulo" />
            <Input label="UF" value={form.state}
              onChange={v => setForm(f => ({ ...f, state: v }))} placeholder="SP" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="País" value={form.country}
              onChange={v => setForm(f => ({ ...f, country: v }))} placeholder="BR" />
            <Input label="Fuso horário" value={form.timezone}
              onChange={v => setForm(f => ({ ...f, timezone: v }))} placeholder="America/Sao_Paulo" />
          </div>

          {submitErr && (
            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{submitErr}</span>
            </div>
          )}
        </div>

        <footer className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 transition">
            Cancelar
          </button>
          <button type="submit" disabled={submitting || clientes.length === 0}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2 transition">
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Cadastrar site
          </button>
        </footer>
      </motion.form>
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function Input({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
        {label}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
      />
    </div>
  )
}
