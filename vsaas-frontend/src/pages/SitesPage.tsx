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
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2, Plus, Search, MapPin, Loader2, AlertTriangle, CheckCircle2,
  X, Camera as CameraIcon, ExternalLink, Globe, Info,
  LayoutList, Network, ChevronRight, ChevronDown, Play, Square,
  Settings, HardDrive, Activity, KeyRound, Cpu as CpuIcon,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { TreeView } from '../components/hierarchy'
import {
  api,
  useSites, createSite, useClientesModules, formatApiError,
  useMyIntegradorTree, useCameras, useEdgeNodes,
  type SiteRow,
  type IntegradorTreeSite,
} from '../api/client'
import { cn } from '../lib/utils'

export function SitesPage() {
  // Role lido em scope de componente — evita stale value se o módulo foi
  // carregado antes do login (chunk lazy-loaded em Vite pode pegar valor
  // antigo do localStorage de uma sessão anterior).
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  const canCreate = role === 'INTEGRADOR_ADMIN'
  const isSuperAdmin = role === 'SUPER_ADMIN'
  const isClienteFinal = role.startsWith('CLIENTE_')

  const navigate = useNavigate()
  const [includeInactive, setIncludeInactive] = useState(false)
  const { data, error, isLoading, mutate } = useSites(includeInactive)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [drawerId, setDrawerId] = useState<string | null>(null)
  // Default por persona: cliente final vai direto pra árvore (UX mais útil
  // pra eles — site→câmeras é o fluxo natural). Outros roles começam em lista.
  // Usamos chave v2 — a v1 (`icv_sites_view`) era escrita antes do toggle
  // existir pra cliente, então não reflete preferência real. Após primeira
  // escolha consciente sob v2, respeitamos.
  const [viewMode, setViewMode] = useState<'list' | 'tree'>(() => {
    if (typeof window === 'undefined') return 'list'
    const saved = localStorage.getItem('icv_sites_view_v2') as 'list' | 'tree' | null
    if (saved) return saved
    return isClienteFinal ? 'tree' : 'list'
  })

  // Tree mode disponível pra INTEGRADOR_* (via /me/integrador/tree) e
  // CLIENTE_* (accordion próprio site→câmeras, fonte: /sites + /cameras).
  // SUPER_ADMIN não tem (não há integradorId no JWT).
  const treeAvailable =
    role === 'INTEGRADOR_ADMIN' ||
    role === 'INTEGRADOR_TECNICO' ||
    isClienteFinal
  const effectiveViewMode = treeAvailable ? viewMode : 'list'

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('icv_sites_view_v2', viewMode)
  }, [viewMode])

  // Tree do integrador só é buscada quando ator é INTEGRADOR_*; CLIENTE_*
  // usa o accordion site-level baseado em useSites + useCameras lazy.
  const integradorTreeEnabled = role === 'INTEGRADOR_ADMIN' || role === 'INTEGRADOR_TECNICO'
  const treeQuery = useMyIntegradorTree(integradorTreeEnabled ? 3 : 1)
  const treeData = integradorTreeEnabled ? treeQuery.data : undefined
  const treeLoading = integradorTreeEnabled ? treeQuery.isLoading : false
  const treeError = integradorTreeEnabled ? treeQuery.error : undefined

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

  // Achata todos os sites de todos os clientes em uma única lista, anotando o nome do cliente.
  const flatTreeSites = useMemo(() => {
    const out: { site: IntegradorTreeSite; clienteName: string; clienteId: string }[] = []
    for (const cliente of treeData?.clientes ?? []) {
      const clienteName = cliente.tradeName ?? cliente.name
      for (const s of cliente.sites ?? []) {
        out.push({ site: s, clienteName, clienteId: cliente.id })
      }
    }
    if (!search) return out
    const q = search.toLowerCase()
    return out.filter(({ site, clienteName }) =>
      site.name.toLowerCase().includes(q) ||
      clienteName.toLowerCase().includes(q) ||
      (site.city ?? '').toLowerCase().includes(q),
    )
  }, [treeData, search])

  // Mesma fonte do flatTreeSites, mas preserva a hierarquia cliente→sites pra
  // o TreeView (acordeão drill-down). Filtra cliente fora se nenhum site bate.
  const treeClientes = useMemo(() => {
    const all = treeData?.clientes ?? []
    if (!search) return all
    const q = search.toLowerCase()
    return all
      .map(cliente => {
        const clienteName = (cliente.tradeName ?? cliente.name).toLowerCase()
        const matchedSites = (cliente.sites ?? []).filter(s =>
          s.name.toLowerCase().includes(q) ||
          (s.city ?? '').toLowerCase().includes(q),
        )
        // Se busca casa o nome do cliente, mantém todos os sites dele
        if (clienteName.includes(q)) return cliente
        if (matchedSites.length === 0) return null
        return { ...cliente, sites: matchedSites }
      })
      .filter((c): c is NonNullable<typeof c> => c != null)
  }, [treeData, search])

  const drawerSite = useMemo(
    () => (data?.sites ?? []).find(s => s.id === drawerId) ?? null,
    [data, drawerId],
  )

  return (
    <div className="space-y-4">
      {/* Hero — paridade com outros cockpits (Onda 6.B) */}
      <GlassCard className="p-5 bg-gradient-to-br from-emerald-500/10 via-cyan-500/5 to-transparent border-emerald-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-2xl">
              📍
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Meus Sites</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                {(data?.sites?.length ?? 0)} {(data?.sites?.length ?? 0) === 1 ? 'site cadastrado' : 'sites cadastrados'} ·
                Locais físicos (filiais, lojas, unidades) que agrupam câmeras de cada cliente final.
              </p>
              <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono uppercase">
                  Geo-localizados
                </span>
                <span className="text-slate-500">lat/lng · timezone · endereço · cliente</span>
              </div>
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
        <label className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400 cursor-pointer hover:text-slate-200',
          effectiveViewMode === 'tree' && 'opacity-50 cursor-not-allowed',
        )} title={effectiveViewMode === 'tree' ? 'Disponível apenas na visão Lista' : undefined}>
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={e => setIncludeInactive(e.target.checked)}
            disabled={effectiveViewMode === 'tree'}
            className="accent-emerald-500"
          />
          Incluir inativos
        </label>
        <span className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400 font-mono">
          {effectiveViewMode === 'tree' ? flatTreeSites.length : filtered.length} {(effectiveViewMode === 'tree' ? flatTreeSites.length : filtered.length) === 1 ? 'site' : 'sites'}
        </span>
        {treeAvailable && (
          <div className="inline-flex rounded-lg border border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-bold inline-flex items-center gap-1.5 transition',
                viewMode === 'list'
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-600 dark:text-slate-300',
              )}
              title="Lista plana (cadastral)"
            >
              <LayoutList className="w-3.5 h-3.5" /> Lista
            </button>
            <button
              type="button"
              onClick={() => setViewMode('tree')}
              aria-pressed={viewMode === 'tree'}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-bold inline-flex items-center gap-1.5 transition',
                viewMode === 'tree'
                  ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-600 dark:text-slate-300',
              )}
              title="Árvore (operacional · drill-down boxes/câmeras inline)"
            >
              <Network className="w-3.5 h-3.5" /> Árvore
            </button>
          </div>
        )}
      </div>

      {/* Errors */}
      {error && effectiveViewMode === 'list' && (
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
      {treeError && effectiveViewMode === 'tree' && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">Falha ao carregar árvore</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatApiError(treeError)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Empty / loading */}
      {((isLoading && !data && effectiveViewMode === 'list') || (treeLoading && !treeData && effectiveViewMode === 'tree')) && (
        <GlassCard className="p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs">Carregando sites...</p>
        </GlassCard>
      )}

      {effectiveViewMode === 'list' && data && filtered.length === 0 && !search && (
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

      {/* Tabela (lista plana) */}
      {effectiveViewMode === 'list' && filtered.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[480px]">
            <thead className="bg-white/[0.02] border-b border-slate-200 dark:border-white/5">
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
          </table></div>
        </GlassCard>
      )}

      {/* Árvore (drill-down acordeão) — comportamento por persona:
          INTEGRADOR_*: hierarquia completa cliente→site→box→câmera (TreeView)
          CLIENTE_*:    site→câmeras (próprio cliente é implícito) */}
      {effectiveViewMode === 'tree' && !treeLoading && !treeError && !isClienteFinal && (
        <GlassCard className="p-4">
          <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Network className="w-4 h-4 text-cyan-500" />
                Hierarquia operacional ({flatTreeSites.length} {flatTreeSites.length === 1 ? 'site' : 'sites'})
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Clique em um cliente para ver sites · expanda o site para ver boxes e câmeras · ações inline para provisionar
              </p>
            </div>
            <span className="text-[10px] text-slate-500 italic">
              dados em tempo real · refresh 60s
            </span>
          </div>
          {flatTreeSites.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <Building2 className="w-10 h-10 mx-auto mb-3 text-slate-700" />
              <p className="text-sm">
                {(treeData?.clientes ?? []).length === 0
                  ? 'Você ainda não tem clientes/sites cadastrados.'
                  : `Nenhum site corresponde a "${search}".`}
              </p>
            </div>
          ) : (
            <TreeView
              clientes={treeClientes}
              onAddSite={() => setShowCreate(true)}
              onAddBox={() => navigate('/edge')}
              onAddCamera={(siteId) => navigate(`/cameras?siteId=${siteId}`)}
              addCameraMode="callback"
            />
          )}
        </GlassCard>
      )}

      {/* Cliente final — lista hierárquica padrão /clientes-finais. Cada linha
          é um site; expandir mostra Box → Câmeras (ou câmeras flat se site
          não tem box). Box aparece com count no header pra ficar visível
          mesmo colapsado. */}
      {effectiveViewMode === 'tree' && isClienteFinal && (
        <GlassCard className="p-4">
          <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Network className="w-4 h-4 text-cyan-500" />
                Hierarquia operacional ({filtered.length} {filtered.length === 1 ? 'site' : 'sites'})
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Clique em um site pra expandir · cada site mostra suas boxes e câmeras inline
              </p>
            </div>
            <span className="text-[10px] text-slate-500 italic">
              dados em tempo real · refresh 60s
            </span>
          </div>
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <Building2 className="w-10 h-10 mx-auto mb-3 text-slate-400 dark:text-slate-700" />
              <p className="text-sm">
                {(data?.sites ?? []).length === 0
                  ? 'Nenhum site instalado ainda.'
                  : `Nenhum site corresponde a "${search}".`}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(s => (
                <ClienteSiteCard
                  key={s.id}
                  site={s}
                  onOpenCameras={() => navigate(`/cameras?siteId=${s.id}`)}
                  onOpenMap={() => navigate('/maps')}
                  onOpenDetail={() => setDrawerId(s.id)}
                />
              ))}
            </div>
          )}
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
// ClienteSiteCard — card visual para CLIENTE_*. Padrão visual alinhado a
// `/clientes-finais` (avatar gradient, badge ativo/inativo, info contato,
// contadores, ações primárias). Esconde dados técnicos (serial, firmware,
// EDGE_BOX label, "Provisionar box") — operações desse tipo são do integrador.
//
// Lazy fetch de cameras+edges acontece apenas pra mostrar contadores, sem
// expor a hierarquia técnica em si.
// ────────────────────────────────────────────────────────────────────────────
function ClienteSiteCard({
  site, onOpenCameras, onOpenMap, onOpenDetail,
}: {
  site: SiteRow
  onOpenCameras: () => void
  onOpenMap:     () => void
  onOpenDetail:  () => void
}) {
  // Lazy-fetch só pra contadores. Auto-revalidação de 60s já vem do hook.
  const { data: camData }  = useCameras({ siteId: site.id, limit: '500' })
  const { data: edgeData } = useEdgeNodes({ siteId: site.id, includeOffline: true })

  const cameras = ((camData?.cameras ?? camData?.items ?? []) as Array<{ id: string; name: string; status?: string; active?: boolean }>)
  const edges   = edgeData?.edgeNodes ?? []

  const camsTotal  = cameras.length
  const camsOnline = cameras.filter(c => c.status === 'ONLINE' || c.status === 'STREAMING' || c.status === 'ACTIVE').length
  const boxesTotal = edges.length
  const boxesOnline = edges.filter(b => b.status === 'ONLINE').length

  const addressLine = [site.address, [site.city, site.state].filter(Boolean).join(' / ')]
    .filter(Boolean).join(' · ')

  // ── Accordion drill-down: lista de câmeras inline ─────────────────────
  // UX: botão "Ver câmeras" expande/colapsa lista no próprio card; cada
  // câmera tem botão "Live" que abre player inline (mesmo InlineLivePreview
  // do tree antigo, agora usado dentro do card limpo).
  const [expanded, setExpanded] = useState(false)
  const [liveOpenIds, setLiveOpenIds] = useState<Set<string>>(new Set())
  // Boxes começam expandidas por default. Click no chevron colapsa (oculta câmeras).
  const [boxesCollapsed, setBoxesCollapsed] = useState<Set<string>>(new Set())
  // Menu de engrenagem (gestão) — só uma aberta por vez. Fechamento via clique
  // fora ou Escape.
  const [boxMenuOpenId, setBoxMenuOpenId] = useState<string | null>(null)
  const navigate = useNavigate()

  function toggleLive(cameraId: string) {
    setLiveOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(cameraId)) next.delete(cameraId)
      else next.add(cameraId)
      return next
    })
  }

  function toggleBoxCollapse(boxId: string) {
    setBoxesCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(boxId)) next.delete(boxId)
      else next.add(boxId)
      return next
    })
  }

  // Fecha o menu de engrenagem ao clicar fora ou apertar Escape
  useEffect(() => {
    if (!boxMenuOpenId) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('[data-box-menu]')) setBoxMenuOpenId(null)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setBoxMenuOpenId(null)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [boxMenuOpenId])

  // Cameras agrupadas por edgeNodeId pra hierarquia Site → Box → Câmeras
  const camerasByBox = useMemo(() => {
    const map = new Map<string, typeof cameras>()
    const cloudDirect: typeof cameras = []
    for (const cam of cameras) {
      const eid = (cam as any).edgeNodeId as string | undefined | null
      if (eid) {
        const arr = map.get(eid) ?? []
        arr.push(cam); map.set(eid, arr)
      } else cloudDirect.push(cam)
    }
    return { byBox: map, cloudDirect }
  }, [cameras])

  return (
    <div className={cn(
      'rounded-lg border bg-white/50 dark:bg-white/[0.02] overflow-hidden transition',
      'border-slate-200 dark:border-white/10 hover:border-cyan-500/40',
      !site.active && 'opacity-60',
    )}>
      {/* Header da row — clicável pra expandir, paridade visual com ClienteCard */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition text-left"
      >
        {expanded
          ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
          {site.name[0]?.toUpperCase() ?? 'S'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {site.name}
          </div>
          {addressLine && (
            <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 truncate">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{addressLine}</span>
            </div>
          )}
        </div>
        {/* Box count — visível mesmo colapsado (era o gap principal) */}
        {boxesTotal > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30 font-mono shrink-0 inline-flex items-center gap-1">
            📦 {boxesOnline}/{boxesTotal}
          </span>
        )}
        {/* Camera count */}
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 font-mono shrink-0 inline-flex items-center gap-1">
          📷 {camsOnline}/{camsTotal}
        </span>
        {/* Status pill */}
        {site.active ? (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Ativo
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-500 dark:text-slate-400 border border-slate-500/30 shrink-0">
            Inativo
          </span>
        )}
      </button>

      {/* Body expandido — Site → Box → Câmeras */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-t border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-black/20"
          >
            {/* Ações inline — atalhos secundários */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-white/5 bg-white/60 dark:bg-white/[0.02]">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenCameras() }}
                className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition flex items-center gap-1.5"
                title="Abrir página de câmeras"
              >
                <ExternalLink className="w-3 h-3" /> Câmeras
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenMap() }}
                className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition flex items-center gap-1.5"
                title="Abrir no mapa"
              >
                <MapPin className="w-3 h-3" /> Mapa
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenDetail() }}
                className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition flex items-center gap-1.5"
                title="Detalhes do site"
              >
                <Info className="w-3 h-3" /> Detalhes
              </button>
            </div>

            {camsTotal === 0 && boxesTotal === 0 ? (
              <p className="text-[11px] text-slate-500 italic text-center py-4">
                Nenhuma box ou câmera instalada neste site.
              </p>
            ) : (
              <>
                {/* Cenário 1: site SEM box — render flat */}
                {boxesTotal === 0 && camsTotal > 0 && (
                  <ul className="divide-y divide-slate-200 dark:divide-white/5">
                    {cameras.map(cam => (
                      <CardCameraRow
                        key={cam.id} cam={cam}
                        liveOpen={liveOpenIds.has(cam.id)}
                        onToggleLive={() => toggleLive(cam.id)}
                        onOpenDetail={() => navigate(`/cameras/${cam.id}`)}
                      />
                    ))}
                  </ul>
                )}

                {/* Cenário 2/3: site COM box — render Box → Cameras
                    Header: chevron (toggle câmeras) · área clicável (detalhe) ·
                    contadores · gear menu (gestão) */}
                {boxesTotal > 0 && edges.map(box => {
                  const boxCams       = camerasByBox.byBox.get(box.id) ?? []
                  const boxOnline     = box.status === 'ONLINE'
                  const boxCollapsed  = boxesCollapsed.has(box.id)
                  const menuOpen      = boxMenuOpenId === box.id
                  const lastBeatMs    = box.lastHeartbeat ? Date.now() - new Date(box.lastHeartbeat).getTime() : null
                  const minsAgo       = lastBeatMs != null ? Math.floor(lastBeatMs / 60_000) : null

                  return (
                    <div key={box.id} className="border-b border-slate-200 dark:border-white/5 last:border-b-0">
                      <div className="flex items-center gap-2 px-2 py-2 bg-violet-50/50 dark:bg-violet-500/[0.04]">
                        {/* Chevron — toggle câmeras */}
                        <button
                          type="button"
                          onClick={() => toggleBoxCollapse(box.id)}
                          className="p-0.5 rounded hover:bg-violet-500/10 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition shrink-0"
                          title={boxCollapsed ? 'Expandir câmeras' : 'Recolher câmeras'}
                          aria-expanded={!boxCollapsed}
                        >
                          {boxCollapsed
                            ? <ChevronRight className="w-4 h-4" />
                            : <ChevronDown className="w-4 h-4" />}
                        </button>

                        {/* Área clicável — navega pra detalhe completo (disco, licença, uptime, config) */}
                        <button
                          type="button"
                          onClick={() => navigate(`/fleet/${box.id}`)}
                          className="flex-1 flex items-center gap-3 min-w-0 text-left rounded px-1 -mx-1 py-1 -my-1 hover:bg-violet-500/10 transition"
                          title="Abrir detalhes completos da box"
                        >
                          <div className="w-7 h-7 rounded bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
                            <span className="text-xs">📦</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{box.name}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5 font-mono truncate">
                              {box.serialNumber}
                              {box.firmwareVersion ? ` · ${box.firmwareVersion}` : ''}
                              {box.tempCelsius != null ? ` · ${box.tempCelsius.toFixed(1)}°C` : ''}
                              {minsAgo != null ? ` · last beat ${minsAgo}min` : ''}
                            </div>
                          </div>
                        </button>

                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 font-mono shrink-0">
                          {boxCams.length} {boxCams.length === 1 ? 'câmera' : 'câmeras'}
                        </span>
                        <span className={cn(
                          'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-mono shrink-0',
                          boxOnline
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
                        )}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', boxOnline ? 'bg-emerald-500' : 'bg-rose-500')} />
                          {box.status}
                        </span>

                        {/* Gear menu — gestão */}
                        <div className="relative shrink-0" data-box-menu>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setBoxMenuOpenId(menuOpen ? null : box.id)
                            }}
                            className={cn(
                              'p-1.5 rounded transition',
                              menuOpen
                                ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300'
                                : 'text-slate-500 hover:bg-violet-500/10 hover:text-slate-700 dark:hover:text-slate-200',
                            )}
                            title="Gestão da box"
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          {menuOpen && (
                            <div
                              role="menu"
                              className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-lg z-20 overflow-hidden"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setBoxMenuOpenId(null); navigate(`/fleet/${box.id}`) }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition text-left"
                              >
                                <Info className="w-3.5 h-3.5 text-cyan-500" />
                                Ver detalhes completos
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setBoxMenuOpenId(null); navigate(`/fleet/${box.id}?tab=health`) }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition text-left"
                              >
                                <HardDrive className="w-3.5 h-3.5 text-emerald-500" />
                                Disco · CPU · memória
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setBoxMenuOpenId(null); navigate(`/fleet/${box.id}?tab=license`) }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition text-left"
                              >
                                <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                                Licença · validade
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setBoxMenuOpenId(null); navigate(`/fleet/${box.id}?tab=uptime`) }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition text-left"
                              >
                                <Activity className="w-3.5 h-3.5 text-violet-500" />
                                Uptime · dias ligado
                              </button>
                              <div className="border-t border-slate-200 dark:border-white/10" />
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setBoxMenuOpenId(null); navigate(`/fleet/${box.id}?tab=config`) }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition text-left"
                              >
                                <CpuIcon className="w-3.5 h-3.5 text-slate-500" />
                                Configuração da box
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Câmeras da box — só renderizam se NÃO estiver colapsada */}
                      {!boxCollapsed && (
                        boxCams.length === 0 ? (
                          <div className="px-10 py-2 text-[11px] text-slate-500 italic">
                            Nenhuma câmera vinculada a esta box.
                          </div>
                        ) : (
                          <ul className="divide-y divide-slate-200 dark:divide-white/5">
                            {boxCams.map(cam => (
                              <CardCameraRow
                                key={cam.id} cam={cam} indented
                                liveOpen={liveOpenIds.has(cam.id)}
                                onToggleLive={() => toggleLive(cam.id)}
                                onOpenDetail={() => navigate(`/cameras/${cam.id}`)}
                              />
                            ))}
                          </ul>
                        )
                      )}
                    </div>
                  )
                })}

                {/* Cloud-direct: só com header se há boxes coexistindo */}
                {boxesTotal > 0 && camerasByBox.cloudDirect.length > 0 && (
                  <div className="border-t border-slate-200 dark:border-white/5">
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 bg-slate-100/50 dark:bg-white/[0.03]">
                      ☁️ Câmeras Cloud-Direct (sem edge box)
                    </div>
                    <ul className="divide-y divide-slate-200 dark:divide-white/5">
                      {camerasByBox.cloudDirect.map(cam => (
                        <CardCameraRow
                          key={cam.id} cam={cam}
                          liveOpen={liveOpenIds.has(cam.id)}
                          onToggleLive={() => toggleLive(cam.id)}
                          onOpenDetail={() => navigate(`/cameras/${cam.id}`)}
                        />
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// CardCameraRow — variante de linha de câmera otimizada para o ClienteSiteCard.
//
// Diferenças do `renderCameraRow` original (que vive dentro do TreeView do
// integrador, com indentação `pl-10` pra hierarquia box→câmera):
//   • Sem indentação de árvore
//   • Preview Live encaixa no card com aspect mais compacto (16:9 cap em 220px)
//   • Animação retrátil suave (height + opacity 240ms cubic-bezier)
//   • Bordas/cores alinhadas com a paleta do card (cyan tone em vez de black)
// ────────────────────────────────────────────────────────────────────────────
function CardCameraRow({
  cam, liveOpen, onToggleLive, onOpenDetail, indented = false,
}: {
  cam:           { id: string; name: string; status?: string; active?: boolean }
  liveOpen:      boolean
  onToggleLive:  () => void
  onOpenDetail:  () => void
  /** Quando dentro de uma box (hierarquia 3-níveis), some com border/bg
   *  individual e adiciona indent à esquerda — visualmente "filho" da box. */
  indented?:     boolean
}) {
  const online = cam.status === 'ONLINE' || cam.status === 'STREAMING' || cam.status === 'ACTIVE'

  return (
    <li className={cn(
      'overflow-hidden',
      indented
        ? 'bg-transparent'
        : 'rounded-md border border-slate-200 dark:border-white/5 bg-slate-50/40 dark:bg-white/[0.02]',
    )}>
      <div className={cn('flex items-center gap-2.5 py-1.5', indented ? 'pl-12 pr-2.5' : 'px-2.5')}>
        <div className="w-7 h-7 rounded bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-white/10 flex items-center justify-center shrink-0">
          <CameraIcon className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
        </div>
        <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{cam.name}</span>
        <span className={cn(
          'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-mono shrink-0',
          online
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
            : 'bg-slate-500/15 text-slate-500 dark:text-slate-400 border-slate-500/30',
        )}>
          <span className={cn(
            'w-1.5 h-1.5 rounded-full',
            online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500',
          )} />
          {online ? 'ONLINE' : (cam.status ?? (cam.active === false ? 'INATIVA' : 'OFF'))}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleLive() }}
          className={cn(
            'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold border transition shrink-0',
            liveOpen
              ? 'bg-rose-500 hover:bg-rose-600 text-white border-rose-500 shadow-sm shadow-rose-500/30'
              : 'bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-500/10 dark:hover:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30',
          )}
          title={liveOpen ? 'Fechar preview ao vivo' : 'Ver preview ao vivo'}
        >
          {liveOpen
            ? <><Square className="w-3 h-3" /> Fechar</>
            : <><Play  className="w-3 h-3" /> Live</>}
        </button>
        <button
          type="button"
          onClick={onOpenDetail}
          className="text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300 transition shrink-0 p-1"
          title="Abrir detalhes da câmera"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Preview retrátil — animação height suave + cap de altura pra
          encaixar no card (16:9 mas limitado a 220px). */}
      <AnimatePresence initial={false}>
        {liveOpen && (
          <motion.div
            key="live"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2.5 pt-1">
              <CardLivePreview cameraId={cam.id} cameraName={cam.name} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// CardLivePreview — versão compacta do InlineLivePreview otimizada pra
// caber dentro de um card. Diferenças vs InlineLivePreview:
//   • aspect-video mas com max-height pra não estourar visualmente
//   • Bordas e overlay com paleta consistent (cyan border em vez de slate)
//   • Pulse LIVE menor + label da câmera embaixo mais discreto
// ────────────────────────────────────────────────────────────────────────────
function CardLivePreview({ cameraId, cameraName }: { cameraId: string; cameraName: string }) {
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [loading, setLoading]         = useState(true)
  const [tick, setTick]               = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api.post(`/cameras/${cameraId}/snapshot`)
      .then(r => {
        if (!alive) return
        setSnapshotUrl(r.data?.snapshotUrl ?? null)
        setLoading(false)
      })
      .catch(e => {
        if (!alive) return
        setError(formatApiError(e))
        setLoading(false)
      })
    return () => { alive = false }
  }, [cameraId, tick])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="rounded-lg overflow-hidden border border-cyan-300/60 dark:border-cyan-500/30 bg-black shadow-sm">
      {/* aspect-video define a forma 16:9; max-h limita altura no card sem
          bater grid em telas pequenas. Image fica object-contain pra mostrar
          frame inteiro (segurança = não cortar nada nas bordas) — letterbox
          preto aparece se a câmera filmar em 4:3 ou outro aspect. */}
      <div className="relative w-full aspect-video max-h-[360px] mx-auto">
        {loading && !snapshotUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Conectando à câmera…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-rose-400 text-xs gap-2 p-4 text-center">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {snapshotUrl && !error && (
          <img
            src={`${(import.meta as any).env?.VITE_API_URL ?? '/api'}${snapshotUrl}`}
            alt={`Snapshot ${cameraName}`}
            className="absolute inset-0 w-full h-full object-contain"
            onError={() => setError('Falha ao carregar imagem da câmera')}
          />
        )}
        {/* Pulse LIVE badge — compacto */}
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/90 text-white text-[9px] font-bold uppercase tracking-wider z-10">
          <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
          Live
        </div>
        {/* Footer overlay sutil — gradient pra legibilidade do label */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-2 py-1.5 text-[10px] text-slate-900 dark:text-white/90 font-mono bg-gradient-to-t from-black/80 to-transparent z-10">
          <span className="truncate">{cameraName}</span>
          <span className="opacity-60 shrink-0">↻ 30s</span>
        </div>
      </div>
    </div>
  )
}

// ClienteSiteAccordionRow removida — sem referência no JSX atual


// Renderiza uma linha de câmera no acordeão (compartilhada entre grupos
// "por box" e "cloud-direct"). Inclui status, botão Live (preview inline)
// e atalho pra detail page.
function renderCameraRow(
  cam: { id: string; name: string; status?: string; active?: boolean },
  liveOpenIds: Set<string>,
  toggleLive: (cameraId: string) => void,
  onCameraClick: (cameraId: string) => void,
) {
  const online   = cam.status === 'ONLINE' || cam.status === 'STREAMING' || cam.status === 'ACTIVE'
  const liveOpen = liveOpenIds.has(cam.id)
  return (
    <li key={cam.id}>
      <div className="flex items-center gap-3 px-3 pl-10 py-2 hover:bg-slate-100 dark:hover:bg-white/[0.04] transition">
        <div className="w-7 h-7 rounded bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-white/10 flex items-center justify-center shrink-0">
          <CameraIcon className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
        </div>
        <span className="flex-1 text-sm text-slate-800 dark:text-slate-200 truncate">{cam.name}</span>
        <span className={cn(
          'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-mono shrink-0',
          online
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
            : 'bg-slate-500/15 text-slate-500 dark:text-slate-400 border-slate-500/30',
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-slate-500')} />
          {cam.status ?? (cam.active === false ? 'INATIVA' : '—')}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleLive(cam.id) }}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border transition shrink-0',
            liveOpen
              ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40'
              : 'bg-slate-100 dark:bg-white/5 border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-rose-500/50 hover:text-rose-700 dark:hover:text-rose-300',
          )}
          title={liveOpen ? 'Fechar live' : 'Ver live nesta tela'}
        >
          {liveOpen ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {liveOpen ? 'Fechar' : 'Live'}
        </button>
        <button
          type="button"
          onClick={() => onCameraClick(cam.id)}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition shrink-0"
          title="Abrir detalhes da câmera"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      {liveOpen && (
        <div className="px-3 pl-10 pb-3 pt-1 bg-slate-100/60 dark:bg-black/30">
          <InlineLivePreview cameraId={cam.id} cameraName={cam.name} />
        </div>
      )}
    </li>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// InlineLivePreview — painel de preview "ao vivo" via snapshot ticket.
// Substitui o "Live" no menu raiz (decisão LGPD): cliente final vê o próprio
// vídeo aqui mesmo, sem sair de /sites. Usa POST /cameras/:id/snapshot que
// emite ticket de 60s e devolve URL pública (válida por ticket). Re-emite a
// cada 30s pra simular live (~baixa latência sem complexidade de HLS/WebRTC).
// ────────────────────────────────────────────────────────────────────────────
function InlineLivePreview({ cameraId, cameraName }: { cameraId: string; cameraName: string }) {
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [loading, setLoading]         = useState(true)
  const [tick, setTick]               = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api.post(`/cameras/${cameraId}/snapshot`)
      .then(r => {
        if (!alive) return
        setSnapshotUrl(r.data?.snapshotUrl ?? null)
        setLoading(false)
      })
      .catch(e => {
        if (!alive) return
        setError(formatApiError(e))
        setLoading(false)
      })
    return () => { alive = false }
  }, [cameraId, tick])

  // Refresh a cada 30s (ticket vive 60s, tem folga). Re-aciona effect via tick.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="rounded-lg overflow-hidden border border-slate-300 dark:border-white/10 bg-black">
      {/* aspect-video + max-h consistente com CardLivePreview. object-contain
          mostra o frame inteiro (sem crop) — câmera de segurança não pode
          perder bordas. Letterbox preto aparece se a câmera filmar em 4:3
          ou outro aspect que não 16:9. */}
      <div className="relative w-full aspect-video max-h-[360px] mx-auto">
        {loading && !snapshotUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Conectando à câmera…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-rose-400 text-xs gap-2 p-4 text-center">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {snapshotUrl && !error && (
          <img
            src={`${(import.meta as any).env?.VITE_API_URL ?? '/api'}${snapshotUrl}`}
            alt={`Snapshot ${cameraName}`}
            className="absolute inset-0 w-full h-full object-contain"
            onError={() => setError('Falha ao carregar imagem da câmera')}
          />
        )}
        {/* Pulse LIVE badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-500/85 text-white text-[10px] font-bold uppercase tracking-wider z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          Live
        </div>
        {/* Camera label — gradient pra legibilidade quando bate parte clara da imagem */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-2 py-1.5 text-[10px] text-slate-900 dark:text-white/90 font-mono bg-gradient-to-t from-black/80 to-transparent z-10">
          <span className="truncate max-w-[60%]">{cameraName}</span>
          <span className="opacity-60 shrink-0">↻ 30s</span>
        </div>
      </div>
    </div>
  )
}

function SiteRowItem({ site, onSelect }: { site: SiteRow; onSelect: () => void }) {
  return (
    <tr className="border-b border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition cursor-pointer" onClick={onSelect}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 border border-emerald-500/30 flex items-center justify-center text-[11px] font-bold text-emerald-200">
            {site.name[0]?.toUpperCase() ?? 'S'}
          </div>
          <span className="text-sm font-medium text-slate-900 dark:text-white">{site.name}</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
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
        className="w-full max-w-lg h-full bg-space-900 border-l border-slate-200 dark:border-white/10 overflow-y-auto"
      >
        <header className="sticky top-0 bg-space-900/95 backdrop-blur border-b border-slate-200 dark:border-white/10 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{site.name}</h3>
            <p className="text-xs text-slate-500">
              {site.clienteFinal.tradeName || site.clienteFinal.name}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:text-white">
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
            <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
              {site.address ? <p>{site.address}</p> : <p className="text-slate-600 italic">Sem endereço cadastrado</p>}
              <p className="font-mono text-slate-400">
                {[site.city, site.state].filter(Boolean).join(' / ') || '—'}
              </p>
            </div>
          </div>

          {/* Ações */}
          <div className="pt-2 border-t border-slate-200 dark:border-white/5 space-y-2">
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

          <p className="text-[10px] text-slate-600 font-mono pt-2 border-t border-slate-200 dark:border-white/5">
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
    slate:   'text-slate-400 border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5',
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
        <header className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-slate-900 dark:text-white" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Novo site</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:text-white">
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

        <footer className="px-5 py-4 border-t border-slate-200 dark:border-white/10 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-900 dark:text-white hover:bg-slate-50 dark:bg-white/5 transition">
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
