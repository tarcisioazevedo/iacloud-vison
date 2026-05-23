/**
 * Sprint Gap 5 — ClientesFinaisPage
 *
 * Cadastro/listagem de clientes finais B2B2B do integrador.
 * Inclui campo `commercialPlan` (textarea livre) onde o integrador descreve
 * o pacote contratado — o sistema NÃO interpreta o conteúdo, apenas guarda.
 *
 * Escopo:
 *   - SUPER_ADMIN     vê todos / cria em qualquer integrador
 *   - INTEGRADOR_ADMIN vê os próprios / cria no próprio integ
 *   - INTEGRADOR_TECNICO vê os próprios (somente leitura)
 *   - CLIENTE_*       vê apenas o próprio (read-only)
 */
import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useSWRConfig } from 'swr'
import {
  Building2, Plus, Search, X, Loader2, Mail, MapPin, FileText,
  Edit3, AlertTriangle, CheckCircle2, Briefcase, Link as LinkIcon,
  UserCog, Trash2, MessageCircle, ScanLine, RefreshCw, Link2,
  WifiOff, PhoneCall, Wifi, Users, LayoutGrid, Network, UserCheck,
  MoreHorizontal, Pause, Play, KeyRound, Send, Copy, Power, Shield,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useUiToast } from '../components/Toast'
import { PortalTokenModal } from '../components/portal/PortalTokenModal'
import { WhatsAppRecipientsPanel } from '../components/notifications/WhatsAppRecipientsPanel'
import { WhatsAppLogsPanel } from '../components/notifications/WhatsAppLogsPanel'
import { LogoUploader } from '../components/branding/LogoUploader'
import { TreeView, ImpersonateModal } from '../components/hierarchy'
import {
  useClientesFinais, createClienteFinal, updateClienteFinal,
  deactivateClienteFinal, reactivateClienteFinal,
  useUsersByClienteFinal, inviteUser, updateUser, deleteUser,
  resetUserPassword, resendUserInvite,
  useMyIntegradorTree,
  formatApiError, api,
  type ClienteFinalRow, type ClienteFinalPayload, type Vertical,
  type UserRow,
} from '../api/client'
import { cn } from '../lib/utils'
import { confirm } from '../components/ConfirmDialog'

const userRole = (typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : '')
const canManage = ['SUPER_ADMIN', 'INTEGRADOR_ADMIN'].includes(userRole)
const isSuperAdmin = userRole === 'SUPER_ADMIN'

const VERTICALS: { value: Vertical; label: string }[] = [
  { value: 'RETAIL',        label: 'Varejo' },
  { value: 'SHOPPING',      label: 'Shopping' },
  { value: 'EDUCATION',     label: 'Educação' },
  { value: 'INDUSTRY',      label: 'Indústria' },
  { value: 'LOGISTICS',     label: 'Logística' },
  { value: 'PARKING',       label: 'Estacionamento' },
  { value: 'CONDOMINIUM',   label: 'Condomínio' },
  { value: 'PUBLIC_SAFETY', label: 'Segurança Pública' },
  { value: 'OTHER',         label: 'Outro' },
]
const VERTICAL_COLORS: Record<Vertical, string> = {
  RETAIL:        'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  SHOPPING:      'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-500/15 dark:text-pink-300 dark:border-pink-500/30',
  EDUCATION:     'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  INDUSTRY:      'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
  LOGISTICS:     'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
  PARKING:       'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30',
  CONDOMINIUM:   'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  PUBLIC_SAFETY: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  OTHER:         'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30',
}

export function ClientesFinaisPage() {
  const navigate = useNavigate()
  const toast = useUiToast()
  const { data, error, isLoading } = useClientesFinais()
  const [search, setSearch] = useState('')
  const [verticalFilter, setVerticalFilter] = useState<Vertical | ''>('')
  const [viewMode, setViewMode] = useState<'cards' | 'tree'>(() => {
    if (typeof window === 'undefined') return 'cards'
    return (localStorage.getItem('icv_clientes_view') as 'cards' | 'tree') ?? 'cards'
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ClienteFinalRow | null>(null)
  const [portalFor,    setPortalFor]    = useState<ClienteFinalRow | null>(null)
  const [techFor,      setTechFor]      = useState<ClienteFinalRow | null>(null)
  const [whatsappFor,  setWhatsappFor]  = useState<ClienteFinalRow | null>(null)
  const [usersFor,     setUsersFor]     = useState<ClienteFinalRow | null>(null)
  const [impersonateFor, setImpersonateFor] = useState<{ id: string; name: string } | null>(null)
  const [toggling,     setToggling]     = useState<string | null>(null)
  const { mutate: globalMutate } = useSWRConfig()

  const handleToggleActive = useCallback(async (c: ClienteFinalRow) => {
    if (toggling) return
    const consequencia = c.active
      ? 'Os usuários do cliente perderão acesso. Gravações e câmeras continuam (ingestão e portal serão bloqueados em novos logins).'
      : 'O cliente volta a ter acesso ao portal e à plataforma.'
    const ok = await confirm({
      title: `${c.active ? 'Suspender' : 'Reativar'} "${c.tradeName ?? c.name}"?`,
      description: consequencia,
      destructive: c.active,
      confirmLabel: c.active ? 'Suspender' : 'Reativar',
    })
    if (!ok) return
    setToggling(c.id)
    try {
      if (c.active) {
        await deactivateClienteFinal(c.id)
      } else {
        await reactivateClienteFinal(c.id)
      }
      await globalMutate('/clientes-finais')
    } catch (e) {
      toast.error(formatApiError(e))
    } finally {
      setToggling(null)
    }
  }, [toggling, globalMutate, toast])

  // Tree mode é exclusivo de INTEGRADOR_* (super-admin usa /admin/tenants/:id para drill-down).
  const treeAvailable = userRole === 'INTEGRADOR_ADMIN' || userRole === 'INTEGRADOR_TECNICO'
  const effectiveViewMode = treeAvailable ? viewMode : 'cards'

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('icv_clientes_view', viewMode)
  }, [viewMode])

  const treeQuery = useMyIntegradorTree(3)
  const treeData = treeQuery.data
  const treeLoading = treeQuery.isLoading
  const treeError = treeQuery.error

  const clientes = data?.clientes ?? []
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return clientes.filter(c => {
      if (verticalFilter && c.vertical !== verticalFilter) return false
      if (!s) return true
      return (
        c.name.toLowerCase().includes(s) ||
        (c.tradeName ?? '').toLowerCase().includes(s) ||
        c.email.toLowerCase().includes(s) ||
        (c.cnpj ?? '').toLowerCase().includes(s) ||
        (c.commercialPlan ?? '').toLowerCase().includes(s)
      )
    })
  }, [clientes, search, verticalFilter])

  // Para o tree-mode: mesmo termo de busca, mas sem filtro vertical (não disponível no shape do tree).
  const filteredTree = useMemo(() => {
    const list = treeData?.clientes ?? []
    const s = search.trim().toLowerCase()
    if (!s) return list
    return list.filter(c =>
      c.name.toLowerCase().includes(s) ||
      (c.tradeName ?? '').toLowerCase().includes(s) ||
      c.email.toLowerCase().includes(s)
    )
  }, [treeData, search])

  // Onda 6.A: hero premium harmonizado com cockpits
  const totalClientes = clientes.length
  const totalAtivos = clientes.filter(c => c.active).length

  return (
    <div className="space-y-4">
      {/* Hero — paridade com Cockpit do Integrador */}
      <GlassCard className="p-6 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent border-cyan-500/20">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-2xl">
              👤
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Meus Clientes Finais</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {totalClientes} cliente{totalClientes !== 1 ? 's' : ''} cadastrado{totalClientes !== 1 ? 's' : ''} · {totalAtivos} ativo{totalAtivos !== 1 ? 's' : ''}
                {' '}· cada cliente tem seus próprios sites, câmeras e usuários (isolados)
              </p>
              <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
                <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono uppercase">
                  B2B2B
                </span>
                <span className="text-slate-500">Modelo de revenda multi-tenant</span>
              </div>
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 text-white text-sm font-bold shadow-lg shadow-cyan-500/20 transition shrink-0"
            >
              <Plus className="w-4 h-4" />
              Novo Cliente Final
            </button>
          )}
        </div>
      </GlassCard>

      {/* Filtros */}
      <GlassCard className="p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder={effectiveViewMode === 'tree'
                ? 'Buscar cliente por nome, razão social ou email…'
                : 'Buscar por nome, CNPJ, email ou plano…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select
            value={verticalFilter}
            onChange={e => setVerticalFilter(e.target.value as Vertical | '')}
            disabled={effectiveViewMode === 'tree'}
            title={effectiveViewMode === 'tree' ? 'Filtro vertical disponível apenas na visão Cards' : undefined}
            className={cn(inputCls, 'md:w-56', effectiveViewMode === 'tree' && 'opacity-50 cursor-not-allowed')}
          >
            <option value="">Todas as verticais</option>
            {VERTICALS.map(v => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
          {treeAvailable && (
            <div className="inline-flex rounded-lg border border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                aria-pressed={viewMode === 'cards'}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-bold inline-flex items-center gap-1.5 transition',
                  viewMode === 'cards'
                    ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-600 dark:text-slate-300',
                )}
                title="Visão em cards (cadastral)"
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Cards
              </button>
              <button
                type="button"
                onClick={() => setViewMode('tree')}
                aria-pressed={viewMode === 'tree'}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-bold inline-flex items-center gap-1.5 transition',
                  viewMode === 'tree'
                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-600 dark:text-slate-300',
                )}
                title="Visão em árvore (operacional · drill-down sites/boxes/câmeras)"
              >
                <Network className="w-3.5 h-3.5" /> Árvore
              </button>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Lista — Cards (cadastral) ou Árvore (operacional) */}
      {effectiveViewMode === 'cards' ? (
        <>
          {isLoading && (
            <GlassCard className="p-12 text-center">
              <Loader2 className="w-6 h-6 text-cyan-700 dark:text-cyan-400 mx-auto animate-spin" />
              <p className="text-slate-700 dark:text-slate-400 text-sm mt-3">Carregando clientes…</p>
            </GlassCard>
          )}
          {error && (
            <GlassCard className="p-6 border-rose-500/30 bg-rose-50 dark:bg-rose-500/5">
              <div className="flex items-center gap-3 text-rose-700 dark:text-rose-300">
                <AlertTriangle className="w-5 h-5" />
                <p className="text-sm">{formatApiError(error)}</p>
              </div>
            </GlassCard>
          )}
          {!isLoading && !error && filtered.length === 0 && (
            <GlassCard className="p-12 text-center">
              <Building2 className="w-10 h-10 text-slate-400 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-slate-700 dark:text-slate-400 text-sm">
                {clientes.length === 0
                  ? 'Nenhum cliente final cadastrado ainda.'
                  : 'Nenhum cliente corresponde ao filtro.'}
              </p>
            </GlassCard>
          )}
          {!isLoading && filtered.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filtered.map(c => (
                <ClienteCard
                  key={c.id}
                  cliente={c}
                  canEdit={canManage}
                  toggling={toggling === c.id}
                  onEdit={() => setEditing(c)}
                  onOpenPortal={canManage ? () => setPortalFor(c) : undefined}
                  onOpenTech={canManage ? () => setTechFor(c) : undefined}
                  onOpenWhatsApp={canManage ? () => setWhatsappFor(c) : undefined}
                  onOpenUsers={canManage ? () => setUsersFor(c) : undefined}
                  onToggleActive={canManage ? () => handleToggleActive(c) : undefined}
                  onImpersonate={canManage ? () => setImpersonateFor({ id: c.id, name: c.tradeName ?? c.name }) : undefined}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <GlassCard className="p-4">
          <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Network className="w-4 h-4 text-emerald-500" />
                Hierarquia operacional ({filteredTree.length})
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Clique em um cliente para ver sites · expanda o site para ver boxes e câmeras · ações inline para provisionar
              </p>
            </div>
            <span className="text-[10px] text-slate-500 italic">
              dados em tempo real · refresh 60s
            </span>
          </div>
          {treeLoading && (
            <div className="py-8 text-center">
              <Loader2 className="w-6 h-6 text-emerald-400 mx-auto animate-spin" />
              <p className="text-slate-500 text-sm mt-3">Carregando árvore…</p>
            </div>
          )}
          {treeError && (
            <div className="p-6 rounded-lg border border-rose-500/30 bg-rose-50 dark:bg-rose-500/5 flex items-center gap-3 text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-5 h-5" />
              <p className="text-sm">{formatApiError(treeError)}</p>
            </div>
          )}
          {!treeLoading && !treeError && (
            <TreeView
              clientes={filteredTree}
              onImpersonateClient={canManage ? (id) => {
                const c = filteredTree.find(x => x.id === id)
                if (c) setImpersonateFor({ id: c.id, name: c.tradeName ?? c.name })
              } : undefined}
              onAddSite={() => navigate('/sites')}
              onAddBox={() => navigate('/edge')}
              onAddCamera={() => navigate('/cameras')}
              addCameraMode="callback"
              onOpenUsers={canManage ? (id) => {
                const c = clientes.find(x => x.id === id)
                if (c) setUsersFor(c)
              } : undefined}
              onEditClient={canManage ? (id) => {
                const c = clientes.find(x => x.id === id)
                if (c) setEditing(c)
              } : undefined}
              onOpenWhatsApp={canManage ? (id) => {
                const c = clientes.find(x => x.id === id)
                if (c) setWhatsappFor(c)
              } : undefined}
              onOpenTech={canManage ? (id) => {
                const c = clientes.find(x => x.id === id)
                if (c) setTechFor(c)
              } : undefined}
              onOpenPortal={canManage ? (id) => {
                const c = clientes.find(x => x.id === id)
                if (c) setPortalFor(c)
              } : undefined}
              onToggleActive={canManage ? (id) => {
                const c = clientes.find(x => x.id === id)
                if (c) handleToggleActive(c)
              } : undefined}
              togglingClienteId={toggling}
              emptyState={
                <>
                  <div className="text-4xl mb-2">🤝</div>
                  <div className="text-sm">
                    {treeData?.clientes.length === 0
                      ? 'Você ainda não tem clientes cadastrados'
                      : `Nenhum cliente encontrado para "${search}"`}
                  </div>
                  <div className="text-xs mt-1 text-slate-600">
                    {treeData?.clientes.length === 0 && 'Use o botão "Novo Cliente Final" acima para começar'}
                  </div>
                </>
              }
            />
          )}
        </GlassCard>
      )}

      <AnimatePresence>
        {createOpen && (
          <UpsertModal
            mode="create"
            onClose={() => setCreateOpen(false)}
          />
        )}
        {editing && (
          <UpsertModal
            mode="edit"
            cliente={editing}
            onClose={() => setEditing(null)}
          />
        )}
        {portalFor && (
          <PortalTokenModal
            cliente={portalFor}
            onClose={() => setPortalFor(null)}
          />
        )}
        {techFor && (
          <TechAccessModal
            cliente={techFor}
            onClose={() => setTechFor(null)}
          />
        )}
        {whatsappFor && (
          <WhatsAppModal
            cliente={whatsappFor}
            onClose={() => setWhatsappFor(null)}
          />
        )}
        {usersFor && (
          <UsersModal
            cliente={usersFor}
            onClose={() => setUsersFor(null)}
          />
        )}
      </AnimatePresence>

      <ImpersonateModal
        open={!!impersonateFor}
        onClose={() => setImpersonateFor(null)}
        clienteFinalId={impersonateFor?.id}
        clienteName={impersonateFor?.name}
      />
    </div>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────
function ClienteCard({
  cliente, canEdit, toggling, onEdit, onOpenPortal, onOpenTech, onOpenWhatsApp,
  onOpenUsers, onToggleActive, onImpersonate,
}: {
  cliente: ClienteFinalRow
  canEdit: boolean
  toggling?: boolean
  onEdit: () => void
  onOpenPortal?: () => void
  onOpenTech?: () => void
  onOpenWhatsApp?: () => void
  onOpenUsers?: () => void
  onToggleActive?: () => void
  onImpersonate?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!menuOpen) return
    function onDoc(ev: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])
  const verticalLbl = VERTICALS.find(v => v.value === cliente.vertical)?.label ?? cliente.vertical
  return (
    <GlassCard className={cn(
      'p-5 transition hover:border-cyan-500/30',
      !cliente.active && 'opacity-60',
    )}>
      <div className="flex items-start gap-3 mb-3">
        {/* Avatar com gradient (paridade com mockup) */}
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-[0_0_18px_-4px_rgba(34,211,238,0.5)]">
          {cliente.name[0]?.toUpperCase() ?? 'C'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="font-bold text-slate-900 dark:text-white truncate">{cliente.name}</h3>
            {cliente.active ? (
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">● Ativo</span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">⏸ Inativo</span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">
            {cliente.tradeName ?? cliente.email}
          </p>
        </div>
        <span className={cn('text-[10px] px-2 py-1 rounded-full border whitespace-nowrap shrink-0', VERTICAL_COLORS[cliente.vertical])}>
          {verticalLbl}
        </span>
      </div>

      <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-400 mb-3">
        <div className="flex items-center gap-2">
          <Mail className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{cliente.email}</span>
        </div>
        {(cliente.city || cliente.state) && (
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>{[cliente.city, cliente.state].filter(Boolean).join(' / ')}</span>
          </div>
        )}
        {cliente.cnpj && (
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono">{cliente.cnpj}</span>
          </div>
        )}
      </div>

      {/* Plano comercial — destaque */}
      {cliente.commercialPlan ? (
        <div className="mb-3 p-3 rounded-lg bg-cyan-50 border border-cyan-200 dark:bg-cyan-500/5 dark:border-cyan-500/20">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300 font-semibold mb-1">
            <Briefcase className="w-3 h-3" />
            Plano comercial
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap line-clamp-3">
            {cliente.commercialPlan}
          </p>
        </div>
      ) : canEdit ? (
        <div className="mb-3 p-2 rounded-lg bg-slate-100 border border-dashed border-slate-300 dark:bg-slate-800/40 dark:border-slate-700">
          <p className="text-[11px] text-slate-500 italic">Plano comercial não preenchido</p>
        </div>
      ) : null}

      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-3 border-t border-slate-200 dark:border-white/5">
        <div className="flex items-center gap-3">
          <span>{cliente._count?.sites ?? 0} sites</span>
          <span>·</span>
          <span>{cliente._count?.users ?? 0} usuários</span>
          {isSuperAdmin && cliente.integrador && (
            <>
              <span>·</span>
              <span className="text-cyan-700 dark:text-cyan-300">{cliente.integrador.name}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 relative" ref={menuRef}>
          {/* Ações primárias — sempre visíveis */}
          {onOpenUsers && (
            <button
              onClick={onOpenUsers}
              className="flex items-center gap-1 px-2 py-1 rounded text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-500/10 transition"
              title="Usuários do cliente"
            >
              <Users className="w-3 h-3" />
              Usuários
            </button>
          )}
          {onImpersonate && (
            <button
              onClick={onImpersonate}
              className="flex items-center gap-1 px-2 py-1 rounded text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/10 transition"
              title="Acessar como este cliente (auditado)"
            >
              <UserCheck className="w-3 h-3" />
              Acessar
            </button>
          )}
          {canEdit && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1 px-2 py-1 rounded text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-500/10 transition"
              title="Editar"
            >
              <Edit3 className="w-3 h-3" />
              Editar
            </button>
          )}

          {/* Menu kebab — ações secundárias */}
          {(onOpenWhatsApp || onOpenTech || onOpenPortal || onToggleActive) && (
            <>
              <button
                onClick={() => setMenuOpen(o => !o)}
                aria-label="Mais ações"
                aria-expanded={menuOpen}
                className="flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 hover:text-slate-700 dark:hover:text-slate-200 transition"
                title="Mais ações"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 bottom-full mb-1 z-20 w-52 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-space-900 shadow-xl py-1 text-xs">
                  {onOpenWhatsApp && (
                    <KebabItem
                      icon={<MessageCircle className="w-3.5 h-3.5 text-emerald-500" />}
                      label="WhatsApp"
                      onClick={() => { setMenuOpen(false); onOpenWhatsApp() }}
                    />
                  )}
                  {onOpenTech && (
                    <KebabItem
                      icon={<UserCog className="w-3.5 h-3.5 text-violet-500" />}
                      label="Acessos de técnicos"
                      onClick={() => { setMenuOpen(false); onOpenTech() }}
                    />
                  )}
                  {onOpenPortal && (
                    <KebabItem
                      icon={<LinkIcon className="w-3.5 h-3.5 text-emerald-500" />}
                      label="Magic-links do portal"
                      onClick={() => { setMenuOpen(false); onOpenPortal() }}
                    />
                  )}
                  {onToggleActive && (
                    <>
                      <div className="my-1 border-t border-slate-100 dark:border-white/5" />
                      <KebabItem
                        icon={
                          toggling
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                            : cliente.active
                              ? <Pause className="w-3.5 h-3.5 text-amber-500" />
                              : <Play  className="w-3.5 h-3.5 text-emerald-500" />
                        }
                        label={cliente.active ? 'Suspender cliente' : 'Reativar cliente'}
                        danger={cliente.active}
                        disabled={toggling}
                        onClick={() => { setMenuOpen(false); onToggleActive() }}
                      />
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </GlassCard>
  )
}

function KebabItem({
  icon, label, onClick, disabled, danger,
}: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left transition',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : danger
            ? 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10'
            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

// ─── Modal Create/Edit ───────────────────────────────────────────────────────
function UpsertModal({
  mode, cliente, onClose,
}: { mode: 'create' | 'edit'; cliente?: ClienteFinalRow; onClose: () => void }) {
  const { mutate } = useSWRConfig()
  const [form, setForm] = useState<ClienteFinalPayload>({
    name:           cliente?.name ?? '',
    tradeName:      cliente?.tradeName ?? '',
    cnpj:           cliente?.cnpj ?? '',
    email:          cliente?.email ?? '',
    phone:          cliente?.phone ?? '',
    city:           cliente?.city ?? '',
    state:          cliente?.state ?? '',
    country:        'BR',
    vertical:       cliente?.vertical ?? 'RETAIL',
    commercialPlan: cliente?.commercialPlan ?? '',
    portalSlug:     cliente?.portalSlug ?? '',
    primaryColor:   cliente?.primaryColor ?? '',
    secondaryColor: cliente?.secondaryColor ?? '',
    logoUrl:        cliente?.logoUrl ?? '',
    integradorId:   undefined,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof ClienteFinalPayload>(k: K, v: ClienteFinalPayload[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function submit() {
    setBusy(true); setErr(null)
    try {
      // Limpa campos vazios para o zod aceitar
      const payload: any = { ...form }
      Object.keys(payload).forEach(k => {
        if (payload[k] === '' || payload[k] === undefined) delete payload[k]
      })
      if (mode === 'create') {
        await createClienteFinal(payload)
      } else {
        await updateClienteFinal(cliente!.id, payload)
      }
      await mutate('/clientes-finais')
      onClose()
    } catch (e) {
      setErr(formatApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={mode === 'create' ? 'Novo Cliente Final' : `Editar: ${cliente?.name}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Razão social *">
            <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <Field label="Nome fantasia">
            <input className={inputCls} value={form.tradeName ?? ''} onChange={e => set('tradeName', e.target.value)} />
          </Field>
          <Field label="CNPJ">
            <input className={inputCls + ' font-mono'} value={form.cnpj ?? ''} onChange={e => set('cnpj', e.target.value)} placeholder="00.000.000/0000-00" />
          </Field>
          <Field label="Email *">
            <input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} />
          </Field>
          <Field label="Telefone">
            <input className={inputCls} value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} />
          </Field>
          <Field label="Vertical *">
            <select className={inputCls} value={form.vertical} onChange={e => set('vertical', e.target.value as Vertical)}>
              {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Cidade">
            <input className={inputCls} value={form.city ?? ''} onChange={e => set('city', e.target.value)} />
          </Field>
          <Field label="UF">
            <input className={inputCls} maxLength={2} value={form.state ?? ''} onChange={e => set('state', e.target.value.toUpperCase())} />
          </Field>
        </div>

        {/* commercialPlan — campo central do Gap 5 */}
        <Field label="Plano comercial (texto livre)" hint="Descreva o pacote acordado: nº de câmeras, módulos contratados, SLA, condições de suporte etc.">
          <textarea
            rows={5}
            className={inputCls + ' resize-y leading-relaxed'}
            value={form.commercialPlan ?? ''}
            onChange={e => set('commercialPlan', e.target.value)}
            placeholder={'Ex.:\n- Pacote 50 câmeras + 2 módulos (Faces + LPR)\n- SLA 99,5% • Suporte 8x5\n- Vigência 12 meses, reajuste IPCA'}
          />
        </Field>

        {/* Branding do portal cliente-final (CF.4) ──────────────────── */}
        <div className="pt-4 mt-4 border-t border-slate-200 dark:border-white/5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-semibold">
              Portal white-label
            </span>
            <span className="text-[10px] text-slate-500">
              Aparência do portal entregue ao cliente final
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Slug do portal" hint="Aparece na URL: /portal/{slug}. Lowercase, números, hífen. 2–40 chars.">
              <input
                className={inputCls + ' font-mono text-xs lowercase'}
                value={form.portalSlug ?? ''}
                onChange={e => set('portalSlug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="acme-corp"
                maxLength={40}
              />
            </Field>
            <Field label="Logo do cliente" hint="Aparece no portal e no painel do integrador.">
              {mode === 'edit' && cliente?.id ? (
                <LogoUploader
                  currentUrl={form.logoUrl || null}
                  uploadUrl={`/clientes-finais/${cliente.id}/logo`}
                  deleteUrl={`/clientes-finais/${cliente.id}/logo`}
                  hint="SVG, PNG, JPEG ou WebP — até 2 MB"
                  onUploaded={url => set('logoUrl', url)}
                  onDeleted={() => set('logoUrl', '')}
                />
              ) : (
                <p className="text-xs text-slate-500 italic px-2 py-3">
                  Salve o cliente primeiro para fazer upload do logo.
                </p>
              )}
            </Field>
            <Field label="Cor primária" hint="Hex #RRGGBB. Usada no header e botões.">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="w-10 h-10 rounded border border-slate-200 dark:border-white/10 bg-transparent cursor-pointer"
                  value={form.primaryColor || '#00C0D0'}
                  onChange={e => set('primaryColor', e.target.value)}
                />
                <input
                  className={inputCls + ' font-mono text-xs flex-1'}
                  value={form.primaryColor ?? ''}
                  onChange={e => set('primaryColor', e.target.value)}
                  placeholder="#00C0D0"
                  maxLength={7}
                />
              </div>
            </Field>
            <Field label="Cor secundária" hint="Hex #RRGGBB. Acentos e destaques.">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="w-10 h-10 rounded border border-slate-200 dark:border-white/10 bg-transparent cursor-pointer"
                  value={form.secondaryColor || '#8b5cf6'}
                  onChange={e => set('secondaryColor', e.target.value)}
                />
                <input
                  className={inputCls + ' font-mono text-xs flex-1'}
                  value={form.secondaryColor ?? ''}
                  onChange={e => set('secondaryColor', e.target.value)}
                  placeholder="#8b5cf6"
                  maxLength={7}
                />
              </div>
            </Field>
          </div>
        </div>

        {isSuperAdmin && mode === 'create' && (
          <Field label="ID do Integrador (somente SUPER_ADMIN)" hint="UUID do integrador que vai ser dono deste cliente final.">
            <input className={inputCls + ' font-mono text-xs'} value={form.integradorId ?? ''} onChange={e => set('integradorId', e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          </Field>
        )}
      </div>

      {err && (
        <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 rounded-lg transition">
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={busy || !form.name || !form.email}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-100 hover:bg-cyan-200 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/20 dark:hover:bg-cyan-500/30 dark:border-cyan-500/40 dark:text-cyan-200 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {mode === 'create' ? 'Cadastrar' : 'Salvar'}
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const inputCls =
  'w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 ' +
  'dark:bg-space-800/40 dark:border-white/10 dark:text-white dark:placeholder:text-slate-600 rounded-lg text-sm ' +
  'focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-slate-700 dark:text-slate-400 font-medium mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-slate-500 dark:text-slate-600 mt-1">{hint}</span>}
    </label>
  )
}

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white border border-slate-200 dark:bg-space-900 dark:border-white/10 rounded-2xl p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-200 dark:border-white/5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="p-1 rounded text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}

// ─── WhatsAppModal — Evolution API por ClienteFinal ─────────────────────────

interface EvolutionChannel {
  id: string
  instanceName: string
  connectionState: string
  phoneNumber: string | null
  profileName: string | null
  pairingCode: string | null
  qrCodePayload: string | null
  lastQrAt: string | null
  lastConnectedAt: string | null
  isActive: boolean
  recipients: string[]
}

const QR_POLL = 5_000
const QR_EXPIRY = 60

function WhatsAppModal({ cliente, onClose }: { cliente: ClienteFinalRow; onClose: () => void }) {
  const qs = `?clienteFinalId=${encodeURIComponent(cliente.id)}`
  const [channel,     setChannel]     = useState<EvolutionChannel | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [testPhone,   setTestPhone]   = useState('')
  const [testMsg,     setTestMsg]     = useState('')
  const [testResult,  setTestResult]  = useState<string | null>(null)
  const [testBusy,    setTestBusy]    = useState(false)
  const [qrExpiry,    setQrExpiry]    = useState(QR_EXPIRY)
  const [logsKey,     setLogsKey]     = useState(0)
  const [subTab,      setSubTab]      = useState<'conexao' | 'destinatarios' | 'extrato'>('conexao')
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isConnected  = channel?.connectionState === 'open'
  const isConnecting = !isConnected && (channel?.connectionState === 'connecting' || !!channel?.qrCodePayload)

  function stopPolling() {
    if (pollRef.current)  { clearInterval(pollRef.current);  pollRef.current  = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const { data } = await api.get(`/notifications/whatsapp${qs}`)
      setChannel(data.channel ?? null)
      if (data.channel?.connectionState === 'open') stopPolling()
    } catch (e) {
      if (!silent) setError(formatApiError(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [qs])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  useEffect(() => {
    if (isConnecting && !pollRef.current) {
      setQrExpiry(QR_EXPIRY)
      pollRef.current  = setInterval(() => fetchStatus(true), QR_POLL)
      timerRef.current = setInterval(() => setQrExpiry(s => Math.max(0, s - 1)), 1_000)
    }
    if (!isConnecting) stopPolling()
    return stopPolling
  }, [isConnecting, fetchStatus])

  async function provision() {
    setLoading(true); setError(null)
    try {
      const { data } = await api.post(`/notifications/whatsapp/instance${qs}`)
      setChannel(data.channel); setQrExpiry(QR_EXPIRY)
    } catch (e) { setError(formatApiError(e)) }
    finally { setLoading(false) }
  }

  async function refresh() {
    setLoading(true); setError(null)
    try {
      const { data } = await api.post(`/notifications/whatsapp/refresh${qs}`)
      setChannel(data.channel); setQrExpiry(QR_EXPIRY)
    } catch (e) { setError(formatApiError(e)) }
    finally { setLoading(false) }
  }

  async function logout() {
    const ok = await confirm({
      title: 'Desconectar WhatsApp?',
      description: 'O número precisará escanear o QR novamente.',
      destructive: true,
      confirmLabel: 'Desconectar',
    })
    if (!ok) return
    setLoading(true); setError(null)
    try {
      const { data } = await api.post(`/notifications/whatsapp/logout${qs}`)
      setChannel(data.channel)
    } catch (e) { setError(formatApiError(e)) }
    finally { setLoading(false) }
  }

  async function deleteInst() {
    const ok = await confirm({
      title: 'Excluir instância por completo?',
      description: 'Esta ação não pode ser desfeita.',
      destructive: true,
      confirmLabel: 'Excluir',
    })
    if (!ok) return
    setLoading(true); setError(null)
    try {
      await api.post(`/notifications/whatsapp/delete${qs}`)
      setChannel(null)
    } catch (e) { setError(formatApiError(e)) }
    finally { setLoading(false) }
  }

  async function sendTest() {
    if (!testPhone) return
    setTestBusy(true); setTestResult(null)
    try {
      await api.post(`/notifications/whatsapp/test${qs}`, { phoneNumber: testPhone, message: testMsg || undefined })
      setTestResult('✅ Mensagem enviada com sucesso!')
      setLogsKey(k => k + 1)
    } catch (e) {
      setTestResult('❌ ' + formatApiError(e))
      setLogsKey(k => k + 1)
    } finally { setTestBusy(false) }
  }

  const qrSrc = channel?.qrCodePayload
  const qrEl = qrSrc
    ? qrSrc.startsWith('data:image/')
      ? <img src={qrSrc} alt="QR Code WhatsApp" loading="lazy" className="w-52 h-52 rounded-xl object-contain" />
      : <div className="w-52 h-52 flex items-center justify-center bg-white rounded-xl border-2 border-emerald-400 p-3">
          <ScanLine className="w-16 h-16 text-emerald-500" />
        </div>
    : null

  const WA_SUBTABS = [
    {
      id: 'conexao' as const,
      label: 'Conexão',
      icon: Wifi,
      badge: isConnected ? '●' : undefined,
      badgeColor: 'text-emerald-500',
    },
    {
      id: 'destinatarios' as const,
      label: 'Destinatários',
      icon: Users,
      badge: channel ? String(channel.recipients.length) : undefined,
      badgeColor: 'text-cyan-500',
    },
    {
      id: 'extrato' as const,
      label: 'Extrato',
      icon: MessageCircle,
      badge: undefined,
      badgeColor: '',
    },
  ]

  return (
    <ModalShell title={`WhatsApp — ${cliente.tradeName ?? cliente.name}`} onClose={onClose}>
      {loading && !channel ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando instância…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status cards — sempre visíveis */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: 'Instância', value: channel?.instanceName ?? '—', mono: true },
              {
                label: 'Conexão',
                value: isConnected ? 'Conectado' : isConnecting ? 'Aguardando scan' : channel ? 'Desconectado' : 'Não criado',
                color: isConnected ? 'text-emerald-600 dark:text-emerald-400' : isConnecting ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500',
              },
              { label: 'Número', value: channel?.phoneNumber ? `+${channel.phoneNumber}` : '—' },
              { label: 'Perfil', value: channel?.profileName ?? '—' },
            ].map(c => (
              <div key={c.label} className="p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
                <p className="text-[9px] uppercase text-slate-500 tracking-wider mb-1">{c.label}</p>
                <p className={cn('text-[11px] font-semibold truncate', c.mono && 'font-mono', c.color ?? 'text-slate-900 dark:text-white')}>{c.value}</p>
              </div>
            ))}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-[11px] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {/* ── Sub-tab nav bar ── */}
          <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/8">
            {WA_SUBTABS.map(tab => {
              const Icon = tab.icon
              const active = subTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setSubTab(tab.id)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition',
                    active
                      ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {tab.label}
                  {tab.badge !== undefined && (
                    <span className={cn('text-[10px] font-bold', tab.badgeColor)}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* ── Aba: Conexão ── */}
          {subTab === 'conexao' && (
            <div className="space-y-4">
              {/* QR / Pairing panel */}
              {!isConnected && (
                <div className="flex flex-col md:flex-row gap-4 items-center p-4 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
                  <div className="flex flex-col items-center gap-3 shrink-0">
                    {channel?.pairingCode && (
                      <div className="text-center">
                        <p className="text-[10px] uppercase text-slate-500 mb-1">Código (digit no celular)</p>
                        <p className="text-2xl font-mono font-bold tracking-[0.3em] text-emerald-700 dark:text-emerald-400 select-all">
                          {channel.pairingCode}
                        </p>
                      </div>
                    )}
                    {qrEl ? (
                      <div className={cn(
                        'relative rounded-2xl overflow-hidden ring-4',
                        isConnecting ? 'ring-emerald-400/80 animate-pulse' : 'ring-slate-200 dark:ring-white/10',
                      )}>
                        {qrEl}
                        {isConnecting && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-200 dark:bg-white/10">
                            <div className="h-full bg-emerald-500 transition-all duration-1000"
                              style={{ width: `${(qrExpiry / QR_EXPIRY) * 100}%` }} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-52 h-52 flex items-center justify-center rounded-2xl bg-slate-100 dark:bg-white/5 border-2 border-dashed border-slate-300 dark:border-white/10">
                        <div className="text-center">
                          <ScanLine className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                          <p className="text-[10px] text-slate-500">QR não disponível</p>
                        </div>
                      </div>
                    )}
                    {isConnecting && (
                      <p className="text-[10px] text-slate-500 text-center">
                        Expira em <strong>{qrExpiry}s</strong> · refresh automático
                      </p>
                    )}
                  </div>

                  <div className="flex-1 space-y-3 text-[11px] text-slate-600 dark:text-slate-300">
                    <p className="font-semibold text-slate-900 dark:text-white text-sm">Pareamento da instância</p>
                    <ol className="space-y-2 list-decimal list-inside">
                      <li>Abra o <strong>WhatsApp Business</strong> no celular do cliente</li>
                      <li>Toque em <strong>Mais opções → Dispositivos conectados → Conectar</strong></li>
                      <li>Escaneie o QR Code <em>ou</em> digite o código de pareamento</li>
                      <li>Aguarde — a página atualiza automaticamente a cada 5s</li>
                    </ol>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <button onClick={provision} disabled={loading}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-60">
                        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                        {channel ? 'Reconectar / Preparar' : 'Criar instância'}
                      </button>
                      {channel && (
                        <button onClick={refresh} disabled={loading}
                          className="px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 dark:bg-white/5 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-60">
                          <RefreshCw className="w-3.5 h-3.5" /> Atualizar código
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Connected state */}
              {isConnected && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">WhatsApp conectado!</p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate">
                      {channel?.phoneNumber ? `+${channel.phoneNumber}` : ''}
                      {channel?.profileName ? ` · ${channel.profileName}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={logout} disabled={loading}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-[11px] font-semibold flex items-center gap-1 transition disabled:opacity-60">
                      <WifiOff className="w-3.5 h-3.5" /> Logout
                    </button>
                    <button onClick={deleteInst} disabled={loading}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-[11px] font-semibold flex items-center gap-1 transition disabled:opacity-60">
                      <Trash2 className="w-3.5 h-3.5" /> Excluir
                    </button>
                  </div>
                </div>
              )}

              {/* Envio de mensagem de teste (sempre visível nesta aba) */}
              <div className={cn(
                'rounded-xl border p-4 space-y-3',
                isConnected
                  ? 'bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/8'
                  : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/5 opacity-60',
              )}>
                <div className="flex items-center gap-2">
                  <PhoneCall className={cn('w-4 h-4', isConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')} />
                  <p className="text-[11px] font-semibold text-slate-900 dark:text-white">Enviar mensagem de teste</p>
                  {!isConnected && (
                    <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-2 py-0.5 rounded-full">
                      Conecte o WhatsApp para habilitar
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Número de destino</label>
                  <input
                    type="tel"
                    value={testPhone}
                    onChange={e => setTestPhone(e.target.value)}
                    placeholder="5511999999999  (código do país + DDD + número)"
                    disabled={!isConnected}
                    className={inputCls + ' disabled:cursor-not-allowed'}
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Mensagem</label>
                  <textarea
                    rows={3}
                    value={testMsg}
                    onChange={e => setTestMsg(e.target.value)}
                    placeholder={"Deixe vazio para usar a mensagem padrão:\n✅ VSaaS — Teste de notificação\nCanal WhatsApp conectado com sucesso!"}
                    disabled={!isConnected}
                    className={inputCls + ' resize-none text-xs leading-relaxed disabled:cursor-not-allowed'}
                  />
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={sendTest}
                    disabled={testBusy || !testPhone || !isConnected}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
                    Enviar mensagem de teste
                  </button>
                  {testResult && (
                    <span className={cn(
                      'text-[11px] font-medium px-2.5 py-1 rounded-lg border',
                      testResult.startsWith('✅')
                        ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                        : 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20',
                    )}>
                      {testResult}
                    </span>
                  )}
                </div>

                {channel?.instanceName && (
                  <p className="text-[10px] text-slate-400">
                    Instância: <code className="font-mono">{channel.instanceName}</code>
                  </p>
                )}
              </div>

              {/* Not yet created */}
              {!channel && !loading && (
                <div className="text-center py-4 space-y-3">
                  <MessageCircle className="w-10 h-10 text-slate-400 mx-auto" />
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Nenhuma instância WhatsApp criada para este cliente.
                  </p>
                  <button onClick={provision} disabled={loading}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center gap-2 mx-auto transition disabled:opacity-60">
                    <Link2 className="w-4 h-4" /> Criar instância
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Aba: Destinatários ── */}
          {subTab === 'destinatarios' && (
            <div className="rounded-xl border border-slate-200 dark:border-white/8 p-4">
              {channel ? (
                <WhatsAppRecipientsPanel
                  recipients={channel.recipients}
                  qs={qs}
                  onUpdate={recipients => setChannel(ch => ch ? { ...ch, recipients } : ch)}
                  disabled={!isConnected}
                  onLogRefresh={() => setLogsKey(k => k + 1)}
                />
              ) : (
                <div className="text-center py-6 space-y-2">
                  <Users className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm text-slate-500">Crie a instância WhatsApp primeiro para gerenciar destinatários.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Aba: Extrato ── */}
          {subTab === 'extrato' && (
            <div className="rounded-xl border border-slate-200 dark:border-white/8 p-4">
              {channel ? (
                <WhatsAppLogsPanel key={logsKey} qs={qs} autoLoad={true} />
              ) : (
                <div className="text-center py-6 space-y-2">
                  <MessageCircle className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm text-slate-500">Crie a instância WhatsApp primeiro para ver o extrato.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ModalShell>
  )
}

// ─── TechAccessModal — Lote 3 ────────────────────────────────────────────────

interface TechAccessEntry {
  id:               string
  technicianUserId: string
  scope:            string
  grantedAt:        string
  technician: { id: string; name: string; email: string; role: string }
}

function TechAccessModal({ cliente, onClose }: { cliente: ClienteFinalRow; onClose: () => void }) {
  const [accesses, setAccesses]     = useState<TechAccessEntry[]>([])
  const [loading,  setLoading]      = useState(true)
  const [fetchErr, setFetchErr]     = useState('')
  const [grantEmail, setGrantEmail] = useState('')
  const [grantScope, setGrantScope] = useState<'FULL' | 'OPERATOR' | 'VIEWER'>('FULL')
  const [granting,   setGranting]   = useState(false)
  const [grantErr,   setGrantErr]   = useState('')
  const [revoking,   setRevoking]   = useState<string | null>(null)

  const loadAccesses = async () => {
    try {
      const r = await api.get(`/technician-access?clienteFinalId=${cliente.id}`)
      setAccesses(r.data.accesses ?? [])
    } catch (e) {
      setFetchErr(formatApiError(e))
    } finally {
      setLoading(false)
    }
  }

  useState(() => { loadAccesses() })

  async function grant() {
    if (!grantEmail.trim()) return
    setGranting(true)
    setGrantErr('')
    try {
      // Look up user by email first
      const usersResp = await api.get(`/users?role=INTEGRADOR_TECNICO&q=${encodeURIComponent(grantEmail.trim())}`)
      const users = usersResp.data.users ?? []
      const tech = users.find((u: any) => u.email.toLowerCase() === grantEmail.trim().toLowerCase())
      if (!tech) { setGrantErr('Técnico não encontrado — verifique o e-mail'); return }
      await api.post('/technician-access', {
        technicianUserId: tech.id,
        clienteFinalId:   cliente.id,
        scope:            grantScope,
      })
      setGrantEmail('')
      await loadAccesses()
    } catch (e) {
      setGrantErr(formatApiError(e))
    } finally {
      setGranting(false)
    }
  }

  async function revoke(id: string) {
    setRevoking(id)
    try {
      await api.delete(`/technician-access/${id}`)
      setAccesses((prev) => prev.filter((a) => a.id !== id))
    } finally {
      setRevoking(null)
    }
  }

  return (
    <ModalShell title={`Acessos de Técnicos — ${cliente.name}`} onClose={onClose}>
      {/* Conceder acesso */}
      <div className="mb-5 p-4 rounded-xl bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20">
        <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-3">Conceder acesso a técnico</p>
        <div className="flex gap-2 flex-wrap">
          <input
            value={grantEmail}
            onChange={(e) => setGrantEmail(e.target.value)}
            placeholder="E-mail do técnico"
            className={inputCls + ' flex-1 min-w-[180px]'}
          />
          <select
            value={grantScope}
            onChange={(e) => setGrantScope(e.target.value as any)}
            className={inputCls + ' w-32'}
          >
            <option value="FULL">FULL</option>
            <option value="OPERATOR">OPERATOR</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <button
            onClick={grant}
            disabled={granting || !grantEmail.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-40 flex items-center gap-1.5 transition"
          >
            {granting ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <UserCog className="w-3.5 h-3.5"/>}
            Conceder
          </button>
        </div>
        {grantErr && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0"/> {grantErr}
          </p>
        )}
      </div>

      {/* Lista de acessos */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2"/> Carregando…
        </div>
      ) : fetchErr ? (
        <p className="text-xs text-rose-500 text-center py-4">{fetchErr}</p>
      ) : accesses.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-6 italic">
          Sem restrições de acesso — todos os técnicos do integrador podem acessar este cliente.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {accesses.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">{a.technician.name}</p>
                <p className="text-xs text-slate-500">{a.technician.email}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Escopo: <strong>{a.scope}</strong> · Concedido {new Date(a.grantedAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <button
                onClick={() => revoke(a.id)}
                disabled={revoking === a.id}
                className="ml-3 px-2 py-1.5 rounded-lg text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition disabled:opacity-40"
              >
                {revoking === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Trash2 className="w-3.5 h-3.5"/>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  )
}

// ─── UsersModal — gestão de usuários do ClienteFinal ─────────────────────────

const ROLE_LABEL: Record<string, string> = {
  CLIENTE_ADMIN:    'Admin do cliente',
  CLIENTE_OPERADOR: 'Operador',
  CLIENTE_VIEWER:   'Visualizador',
  INTEGRADOR_ADMIN: 'Admin Integrador',
  INTEGRADOR_TECNICO:'Técnico Integrador',
  SUPER_ADMIN:      'Super Admin',
}

const ROLE_COLOR: Record<string, string> = {
  CLIENTE_ADMIN:    'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  CLIENTE_OPERADOR: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  CLIENTE_VIEWER:   'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
}

function UsersModal({ cliente, onClose }: { cliente: ClienteFinalRow; onClose: () => void }) {
  const { data, error, isLoading, mutate } = useUsersByClienteFinal(cliente.id)
  const { mutate: globalMutate } = useSWRConfig()
  const toast = useUiToast()

  // Form state
  const [name,  setName]  = useState('')
  const [email, setEmail] = useState('')
  const [role,  setRole]  = useState<'CLIENTE_ADMIN' | 'CLIENTE_OPERADOR' | 'CLIENTE_VIEWER'>('CLIENTE_ADMIN')
  const [busy,  setBusy]  = useState(false)
  const [err,   setErr]   = useState<string | null>(null)
  const [tempPwd, setTempPwd] = useState<{ pwd: string; emailSent: boolean; reason: string | null } | null>(null)
  const [actionId, setActionId] = useState<string | null>(null)

  const users = data?.users ?? []

  async function submitInvite() {
    if (!name.trim() || !email.trim()) return
    setBusy(true); setErr(null); setTempPwd(null)
    try {
      const resp = await inviteUser({
        email: email.trim(),
        name:  name.trim(),
        role,
        clienteFinalId: cliente.id,
      })
      setTempPwd({
        pwd:       resp.invitation.tempPassword,
        emailSent: resp.invitation.emailSent,
        reason:    resp.invitation.emailReason,
      })
      setName(''); setEmail('')
      await mutate()
      // Atualiza contador no card
      await globalMutate('/clientes-finais')
    } catch (e) {
      setErr(formatApiError(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleUser(u: UserRow) {
    if (actionId) return
    const ok = await confirm({
      title: `${u.active ? 'Suspender' : 'Reativar'} ${u.email}?`,
      destructive: u.active,
      confirmLabel: u.active ? 'Suspender' : 'Reativar',
    })
    if (!ok) return
    setActionId(u.id)
    try {
      if (u.active) await deleteUser(u.id)
      else          await updateUser(u.id, { active: true })
      await mutate()
    } catch (e) {
      toast.error(formatApiError(e))
    } finally {
      setActionId(null)
    }
  }

  async function handleResetPwd(u: UserRow) {
    if (actionId) return
    const ok = await confirm({
      title: `Gerar nova senha temporária?`,
      description: `Para o usuário ${u.email}.`,
      confirmLabel: 'Gerar nova senha',
    })
    if (!ok) return
    setActionId(u.id)
    try {
      const r = await resetUserPassword(u.id)
      setTempPwd({ pwd: r.tempPassword, emailSent: r.emailSent, reason: r.emailReason })
    } catch (e) {
      toast.error(formatApiError(e))
    } finally {
      setActionId(null)
    }
  }

  async function handleResend(u: UserRow) {
    if (actionId) return
    setActionId(u.id)
    try {
      const r = await resendUserInvite(u.id)
      setTempPwd({ pwd: r.tempPassword, emailSent: r.emailSent, reason: r.emailReason })
    } catch (e) {
      toast.error(formatApiError(e))
    } finally {
      setActionId(null)
    }
  }

  function copyPwd() {
    if (!tempPwd) return
    navigator.clipboard.writeText(tempPwd.pwd).catch(() => {})
  }

  return (
    <ModalShell title={`Usuários — ${cliente.tradeName ?? cliente.name}`} onClose={onClose}>
      {/* Senha temporária — destaque (aparece UMA vez) */}
      {tempPwd && (
        <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30">
          <div className="flex items-start gap-2 mb-2">
            <KeyRound className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                Senha temporária — anote agora! (não voltará a aparecer)
              </p>
              <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5">
                {tempPwd.emailSent
                  ? '✉️ Email enviado ao usuário com a senha.'
                  : `⚠️ Email NÃO enviado${tempPwd.reason ? ` (${tempPwd.reason})` : ''} — repasse manualmente.`}
              </p>
            </div>
            <button
              onClick={() => setTempPwd(null)}
              className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-slate-900 dark:text-white shrink-0"
              title="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-black/30 border border-amber-300 dark:border-amber-500/40 font-mono text-sm text-slate-900 dark:text-white select-all break-all">
              {tempPwd.pwd}
            </code>
            <button
              onClick={copyPwd}
              className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 transition shrink-0"
              title="Copiar senha"
            >
              <Copy className="w-3.5 h-3.5" /> Copiar
            </button>
          </div>
        </div>
      )}

      {/* Form de convite */}
      <div className="mb-5 p-4 rounded-xl bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20">
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">Convidar novo usuário</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nome completo"
            disabled={busy}
            className={inputCls}
          />
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="email@cliente.com"
            disabled={busy}
            className={inputCls}
          />
          <select
            value={role}
            onChange={e => setRole(e.target.value as any)}
            disabled={busy}
            className={inputCls}
          >
            <option value="CLIENTE_ADMIN">Admin do cliente</option>
            <option value="CLIENTE_OPERADOR">Operador</option>
            <option value="CLIENTE_VIEWER">Visualizador</option>
          </select>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            <Shield className="inline w-3 h-3 mr-1" />
            Admin gerencia operadores/visualizadores · Operador opera câmeras · Visualizador só vê
          </p>
          <button
            onClick={submitInvite}
            disabled={busy || !name.trim() || !email.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-40 flex items-center gap-1.5 transition"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Convidar
          </button>
        </div>
        {err && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {err}
          </p>
        )}
      </div>

      {/* Lista de usuários */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando usuários…
        </div>
      ) : error ? (
        <p className="text-xs text-rose-500 text-center py-4">{formatApiError(error)}</p>
      ) : users.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <Users className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="text-sm text-slate-500">
            Nenhum usuário cadastrado para este cliente ainda.
          </p>
          <p className="text-[10px] text-slate-400">
            Convide o admin do cliente para começar — ele poderá adicionar operadores depois.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {users.map(u => {
            const isBusy = actionId === u.id
            const roleColor = ROLE_COLOR[u.role] ?? 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30'
            return (
              <li key={u.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0',
                    u.active
                      ? 'bg-gradient-to-br from-cyan-500 to-emerald-500 text-white'
                      : 'bg-slate-300 dark:bg-slate-700 text-slate-500',
                  )}>
                    {(u.name ?? u.email)[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={cn('text-sm font-semibold truncate', !u.active && 'line-through text-slate-500')}>
                        {u.name ?? u.email}
                      </p>
                      <span className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap', roleColor)}>
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                      {!u.active && (
                        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 whitespace-nowrap">
                          Suspenso
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">{u.email}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {u.lastLoginAt
                        ? `Último login ${new Date(u.lastLoginAt).toLocaleString('pt-BR')}`
                        : 'Nunca acessou'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleResend(u)}
                    disabled={isBusy}
                    title="Reenviar convite (gera nova senha)"
                    className="p-1.5 rounded text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-40 transition"
                  >
                    {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Send className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleResetPwd(u)}
                    disabled={isBusy}
                    title="Resetar senha"
                    className="p-1.5 rounded text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 disabled:opacity-40 transition"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleToggleUser(u)}
                    disabled={isBusy}
                    title={u.active ? 'Suspender' : 'Reativar'}
                    className={cn(
                      'p-1.5 rounded disabled:opacity-40 transition',
                      u.active
                        ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10'
                        : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
                    )}
                  >
                    {u.active ? <Power className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </ModalShell>
  )
}
