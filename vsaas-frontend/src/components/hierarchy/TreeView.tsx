/**
 * TreeView — Drill-down acordeão para a hierarquia Cliente→Site→Box→Câmera.
 *
 * Consome o response do endpoint /admin/integradores/:id/tree (depth=3) e renderiza
 * acordeões aninhados que expandem/colapsam in-place sem sair da página.
 *
 * Inputs vêm tipados como TreeNode hierarchy (cliente | site | box | direct-cam).
 * Mesmo componente reaproveitado em todos os 3 cockpits (Fabricante / Integrador / Cliente)
 * — só muda quem chama o endpoint e qual escopo o backend devolve via RBAC.
 *
 * Atualização 2026-05-06 — fechados gaps do mockup `03-drill-down-acordeao.html`:
 *   - EdgeNodeRow agora mostra CPU/RAM/Disk/uptime inline (telemetria cacheada
 *     do último heartbeat na coluna do EdgeNode)
 *   - EdgeNodeRow é expansível e renderiza câmeras EDGE_BOX nested
 *   - CameraRow ganhou botão "▶ Live" inline que abre LivePlayer em modal
 */
import { useEffect, useRef, useState, ReactNode } from 'react'
import {
  ChevronDown, ChevronRight, Building2, MapPin, Server, Camera, Plus,
  Cpu, MemoryStick, HardDrive, Clock, Play, X,
  Users, UserCheck, Edit3, MoreHorizontal, MessageCircle, UserCog,
  Link as LinkIcon, Pause, Loader2,
  Box, Wifi, User,
} from 'lucide-react'
import { HealthScoreBadge } from './HealthScoreBadge'
import { AddCameraWizard } from './AddCameraWizard'
import { LivePlayer } from '../player/LivePlayer'
import { cn } from '../../lib/utils'

export interface TreeCamera {
  id: string
  name: string
  deploymentMode: 'EDGE_BOX' | 'CLOUD_DIRECT'
  edgeNodeId?: string | null
  latitude?: number | null
  longitude?: number | null
}

export interface TreeEdgeNode {
  id: string
  name: string
  status: string
  lastHeartbeat: string | null
  firmwareVersion: string | null
  cameraCount: number
  // Telemetria cacheada do último heartbeat (mockup 03).
  cpuUsage?: number | null
  memUsage?: number | null
  diskUsage?: number | null
  tempCelsius?: number | null
  uptimeSeconds?: number | null
  fpsCurrent?: number | null
  cameras?: TreeCamera[]
}

export interface TreeSite {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
  timezone: string | null
  counts: { cameras: number; edgeNodes: number }
  edgeNodes?: TreeEdgeNode[]
  standaloneCameras?: TreeCamera[]
}

export interface TreeCliente {
  id: string
  name: string
  tradeName: string | null
  email: string
  active: boolean
  createdAt: string
  counts: {
    sites: number
    users: number
    cameras: number
    edgeNodes: number
    edgeNodesOnline: number
  }
  sites?: TreeSite[]
}

export interface TreeViewProps {
  clientes: TreeCliente[]
  /** Callback opcional quando o usuário clica em "Acessar como cliente" / impersonate. */
  onImpersonateClient?: (clienteId: string) => void
  /** Callback opcional quando clica em "+ Novo site" / "+ Novo box" / "+ Câmera". */
  onAddSite?: (clienteId: string) => void
  onAddBox?: (siteId: string) => void
  onAddCamera?: (siteId: string, mode: 'EDGE_BOX' | 'CLOUD_DIRECT') => void
  /**
   * Como tratar o clique em "+ Câmera":
   *   - 'inline-wizard' (default): abre o AddCameraWizard inline no SiteRow.
   *   - 'callback': chama onAddCamera(siteId, mode) e deixa o parent decidir
   *     (ex: navegar para /cameras). Quando 'callback', onAddCamera é obrigatório
   *     na prática — sem ele o botão vira no-op.
   * Modos mutuamente exclusivos (antes os dois disparavam juntos e a navegação
   * desmontava o wizard recém-aberto).
   */
  addCameraMode?: 'inline-wizard' | 'callback'
  /** Ações inline na linha do cliente (paridade com o card). Quando undefined, o botão correspondente some. */
  onOpenUsers?: (clienteId: string) => void
  onEditClient?: (clienteId: string) => void
  onOpenWhatsApp?: (clienteId: string) => void
  onOpenTech?: (clienteId: string) => void
  onOpenPortal?: (clienteId: string) => void
  onToggleActive?: (clienteId: string) => void
  /** Id do cliente cuja ação de toggle (suspender/reativar) está em flight. */
  togglingClienteId?: string | null
  /** Caminho base para navegação drill-in (default: '/clientes-finais'). */
  basePath?: string
  className?: string
  emptyState?: ReactNode
}

function healthFromCounts(c: TreeCliente['counts']): number | null {
  if (c.edgeNodes === 0) return null
  return Math.round((c.edgeNodesOnline / c.edgeNodes) * 100)
}

/**
 * Calcula a divisão Box Cams (sob box) × Direct Cams (CLOUD_DIRECT, no site)
 * a partir dos sites carregados. Retorna `null` quando os sites ainda não
 * foram materializados (depth=1) — chamador deve cair no total agregado.
 */
function camBreakdown(sites: TreeSite[] | undefined): { boxCams: number; directCams: number } | null {
  if (!sites) return null
  let boxCams = 0, directCams = 0
  for (const s of sites) {
    boxCams += (s.edgeNodes ?? []).reduce((a, e) => a + (e.cameraCount ?? 0), 0)
    directCams += (s.standaloneCameras?.length ?? 0)
  }
  return { boxCams, directCams }
}

function camBreakdownForSite(site: TreeSite): { boxCams: number; directCams: number } {
  const boxCams = (site.edgeNodes ?? []).reduce((a, e) => a + (e.cameraCount ?? 0), 0)
  const directCams = site.standaloneCameras?.length ?? 0
  return { boxCams, directCams }
}

export function TreeView({
  clientes,
  onImpersonateClient,
  onAddSite,
  onAddBox,
  onAddCamera,
  addCameraMode = 'inline-wizard',
  onOpenUsers,
  onEditClient,
  onOpenWhatsApp,
  onOpenTech,
  onOpenPortal,
  onToggleActive,
  togglingClienteId,
  className,
  emptyState,
}: TreeViewProps) {
  // Modal global de live — qualquer CameraRow filho pode abrir.
  const [livePreview, setLivePreview] = useState<TreeCamera | null>(null)

  if (clientes.length === 0) {
    return (
      <div className={cn('text-center py-12 text-slate-500', className)}>
        {emptyState ?? (
          <>
            <div className="text-4xl mb-2">🏢</div>
            <div className="text-sm">Nenhum cliente ainda</div>
            <div className="text-xs mt-1 text-slate-600">Adicione o primeiro cliente para começar</div>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <div className={cn('space-y-2', className)}>
        {clientes.map(c => (
          <ClienteRow
            key={c.id}
            cliente={c}
            onImpersonate={onImpersonateClient}
            onAddSite={onAddSite}
            onAddBox={onAddBox}
            onAddCamera={onAddCamera}
            addCameraMode={addCameraMode}
            onPreviewCamera={setLivePreview}
            onOpenUsers={onOpenUsers}
            onEditClient={onEditClient}
            onOpenWhatsApp={onOpenWhatsApp}
            onOpenTech={onOpenTech}
            onOpenPortal={onOpenPortal}
            onToggleActive={onToggleActive}
            toggling={togglingClienteId === c.id}
          />
        ))}
      </div>
      {livePreview && (
        <LivePreviewModal camera={livePreview} onClose={() => setLivePreview(null)} />
      )}
    </>
  )
}

function ClienteRow({
  cliente,
  onImpersonate,
  onAddSite,
  onAddBox,
  onAddCamera,
  addCameraMode,
  onPreviewCamera,
  onOpenUsers,
  onEditClient,
  onOpenWhatsApp,
  onOpenTech,
  onOpenPortal,
  onToggleActive,
  toggling,
}: {
  cliente: TreeCliente
  onImpersonate?: (id: string) => void
  onAddSite?: (id: string) => void
  onAddBox?: (siteId: string) => void
  onAddCamera?: (siteId: string, mode: 'EDGE_BOX' | 'CLOUD_DIRECT') => void
  addCameraMode?: 'inline-wizard' | 'callback'
  onPreviewCamera?: (cam: TreeCamera) => void
  onOpenUsers?: (id: string) => void
  onEditClient?: (id: string) => void
  onOpenWhatsApp?: (id: string) => void
  onOpenTech?: (id: string) => void
  onOpenPortal?: (id: string) => void
  onToggleActive?: (id: string) => void
  toggling?: boolean
}) {
  const [open, setOpen] = useState(false)
  const sites = cliente.sites ?? []
  const health = healthFromCounts(cliente.counts)
  const initial = cliente.name.charAt(0).toUpperCase()

  return (
    <div className={cn(
      'rounded-xl border transition',
      open
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-slate-700/50 bg-slate-900/50 hover:border-emerald-500/30',
    )}>
      {/* Linha do cliente — toggle de expandir + ações inline */}
      <div className="px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex-1 min-w-0 flex items-center gap-3 text-left"
        >
          {open
            ? <ChevronDown className="w-4 h-4 text-emerald-400 shrink-0" />
            : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
          }
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center font-bold text-sm shrink-0 text-white">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white">{cliente.name}</span>
              <HealthScoreBadge score={health} />
              <span className={cn(
                'text-[10px] px-2 py-0.5 rounded border',
                cliente.active
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/30',
              )}>
                {cliente.active ? '● Ativo' : '⏸ Suspenso'}
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5 truncate">
              {cliente.email}
              {cliente.tradeName && <span> · {cliente.tradeName}</span>}
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-2.5 text-xs text-slate-400 shrink-0">
            <span title="Sites" className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3 text-amber-400/80" />
              {cliente.counts.sites} <span className="text-slate-600">{cliente.counts.sites === 1 ? 'site' : 'sites'}</span>
            </span>
            <span title="Boxes online" className={cn('inline-flex items-center gap-1',
              cliente.counts.edgeNodesOnline === cliente.counts.edgeNodes ? 'text-emerald-400' : 'text-amber-400')}>
              <Server className="w-3 h-3" />
              {cliente.counts.edgeNodesOnline}/{cliente.counts.edgeNodes} <span className="text-slate-600">box{cliente.counts.edgeNodes !== 1 ? 'es' : ''}</span>
            </span>
            {(() => {
              const breakdown = camBreakdown(cliente.sites)
              if (breakdown) {
                return (
                  <>
                    <span title="Box Cams (câmeras gerenciadas por box)" className="inline-flex items-center gap-1 text-emerald-300/90">
                      <Box className="w-3 h-3" />
                      {breakdown.boxCams} <span className="text-slate-600">box cam{breakdown.boxCams !== 1 ? 's' : ''}</span>
                    </span>
                    <span title="Direct Cams (CLOUD_DIRECT)" className="inline-flex items-center gap-1 text-violet-300/90">
                      <Wifi className="w-3 h-3" />
                      {breakdown.directCams} <span className="text-slate-600">direct cam{breakdown.directCams !== 1 ? 's' : ''}</span>
                    </span>
                  </>
                )
              }
              // Fallback: depth=1 sem sites materializados
              return (
                <span title="Câmeras (total)" className="inline-flex items-center gap-1">
                  <Camera className="w-3 h-3" />
                  {cliente.counts.cameras} <span className="text-slate-600">câm</span>
                </span>
              )
            })()}
            <span title="Usuários" className="inline-flex items-center gap-1">
              <User className="w-3 h-3" />
              {cliente.counts.users} <span className="text-slate-600">usr</span>
            </span>
          </div>
        </button>
        <ClienteActionsInline
          cliente={cliente}
          onOpenUsers={onOpenUsers}
          onImpersonate={onImpersonate}
          onEditClient={onEditClient}
          onOpenWhatsApp={onOpenWhatsApp}
          onOpenTech={onOpenTech}
          onOpenPortal={onOpenPortal}
          onToggleActive={onToggleActive}
          toggling={toggling}
        />
      </div>

      {/* Conteúdo expandido — sites */}
      {open && (
        <div className="border-t border-slate-800 bg-slate-950/30 px-3 py-3 space-y-2">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold flex items-center gap-1.5">
              <MapPin className="w-3 h-3" /> Sites do cliente ({sites.length})
            </span>
            {onAddSite && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAddSite(cliente.id) }}
                className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-[10px] border border-emerald-500/30 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Novo site
              </button>
            )}
          </div>
          {sites.length === 0 ? (
            <div className="text-xs text-slate-500 italic px-2 py-3 text-center">
              Nenhum site cadastrado para este cliente
            </div>
          ) : (
            sites.map(s => (
              <SiteRow key={s.id} site={s} onAddBox={onAddBox} onAddCamera={onAddCamera} addCameraMode={addCameraMode} onPreviewCamera={onPreviewCamera} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function ClienteActionsInline({
  cliente,
  onOpenUsers,
  onImpersonate,
  onEditClient,
  onOpenWhatsApp,
  onOpenTech,
  onOpenPortal,
  onToggleActive,
  toggling,
}: {
  cliente: TreeCliente
  onOpenUsers?: (id: string) => void
  onImpersonate?: (id: string) => void
  onEditClient?: (id: string) => void
  onOpenWhatsApp?: (id: string) => void
  onOpenTech?: (id: string) => void
  onOpenPortal?: (id: string) => void
  onToggleActive?: (id: string) => void
  toggling?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!menuOpen) return
    function onDoc(ev: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const stop = (fn?: (id: string) => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn?.(cliente.id)
  }
  const hasKebab = !!(onOpenWhatsApp || onOpenTech || onOpenPortal || onToggleActive)
  if (!onOpenUsers && !onImpersonate && !onEditClient && !hasKebab) return null

  return (
    <div ref={wrapRef} className="shrink-0 flex items-center gap-1 relative">
      {onOpenUsers && (
        <button
          type="button"
          onClick={stop(onOpenUsers)}
          className="px-2 py-1 rounded text-[11px] inline-flex items-center gap-1 text-cyan-300 hover:bg-cyan-500/10 transition"
          title="Usuários do cliente"
        >
          <Users className="w-3 h-3" /> <span className="hidden md:inline">Usuários</span>
        </button>
      )}
      {onImpersonate && (
        <button
          type="button"
          onClick={stop(onImpersonate)}
          className="px-2 py-1 rounded text-[11px] inline-flex items-center gap-1 text-amber-300 hover:bg-amber-500/10 transition"
          title="Acessar como este cliente (auditado)"
        >
          <UserCheck className="w-3 h-3" /> <span className="hidden md:inline">Acessar</span>
        </button>
      )}
      {onEditClient && (
        <button
          type="button"
          onClick={stop(onEditClient)}
          className="px-2 py-1 rounded text-[11px] inline-flex items-center gap-1 text-cyan-300 hover:bg-cyan-500/10 transition"
          title="Editar cliente"
        >
          <Edit3 className="w-3 h-3" /> <span className="hidden md:inline">Editar</span>
        </button>
      )}
      {hasKebab && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o) }}
            aria-label="Mais ações"
            aria-expanded={menuOpen}
            className="flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:bg-white/5 hover:text-slate-200 transition"
            title="Mais ações"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 bottom-full mb-1 z-30 w-56 rounded-lg border border-white/10 bg-slate-900 shadow-xl py-1 text-xs"
            >
              {onOpenWhatsApp && (
                <TreeKebabItem
                  icon={<MessageCircle className="w-3.5 h-3.5 text-emerald-400" />}
                  label="WhatsApp"
                  onClick={() => { setMenuOpen(false); onOpenWhatsApp(cliente.id) }}
                />
              )}
              {onOpenTech && (
                <TreeKebabItem
                  icon={<UserCog className="w-3.5 h-3.5 text-violet-400" />}
                  label="Acessos de técnicos"
                  onClick={() => { setMenuOpen(false); onOpenTech(cliente.id) }}
                />
              )}
              {onOpenPortal && (
                <TreeKebabItem
                  icon={<LinkIcon className="w-3.5 h-3.5 text-emerald-400" />}
                  label="Magic-links do portal"
                  onClick={() => { setMenuOpen(false); onOpenPortal(cliente.id) }}
                />
              )}
              {onToggleActive && (
                <>
                  <div className="my-1 border-t border-white/5" />
                  <TreeKebabItem
                    icon={
                      toggling
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                        : cliente.active
                          ? <Pause className="w-3.5 h-3.5 text-amber-400" />
                          : <Play className="w-3.5 h-3.5 text-emerald-400" />
                    }
                    label={cliente.active ? 'Suspender cliente' : 'Reativar cliente'}
                    danger={cliente.active}
                    disabled={toggling}
                    onClick={() => { setMenuOpen(false); onToggleActive(cliente.id) }}
                  />
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TreeKebabItem({
  icon, label, onClick, disabled, danger,
}: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left transition',
        disabled
          ? 'opacity-50 cursor-not-allowed text-slate-400'
          : danger
            ? 'text-amber-300 hover:bg-amber-500/10'
            : 'text-slate-200 hover:bg-white/5',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function SiteRow({
  site,
  onAddBox,
  onAddCamera,
  addCameraMode = 'inline-wizard',
  onPreviewCamera,
  clienteName,
  defaultOpen = false,
}: {
  site: TreeSite
  onAddBox?: (siteId: string) => void
  onAddCamera?: (siteId: string, mode: 'EDGE_BOX' | 'CLOUD_DIRECT') => void
  /** Ver TreeViewProps.addCameraMode. */
  addCameraMode?: 'inline-wizard' | 'callback'
  onPreviewCamera?: (cam: TreeCamera) => void
  /** Se passado, mostra o nome do cliente como sub-label do site (útil quando o SiteRow é renderizado fora de um ClienteRow). */
  clienteName?: string
  /** Inicia já expandido. Default: false. */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [wizardOpen, setWizardOpen] = useState(false)
  const edgeNodes = site.edgeNodes ?? []
  const standalone = site.standaloneCameras ?? []
  const health = site.counts.edgeNodes > 0
    ? Math.round((edgeNodes.filter(n => n.status === 'ONLINE').length / site.counts.edgeNodes) * 100)
    : null

  return (
    <div className={cn(
      'rounded-lg border transition',
      open ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-slate-800 bg-slate-900/40 hover:border-cyan-500/30',
    )}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 flex items-center gap-2 text-left"
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        }
        <span className="text-base">📍</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-white text-sm">{site.name}</span>
            <HealthScoreBadge score={health} size="xs" />
            {clienteName && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 truncate max-w-[160px]">
                {clienteName}
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {site.address && <span>{site.address}</span>}
            {site.city && <span>{site.address ? ' · ' : ''}{site.city}, {site.state}</span>}
            {!site.address && !site.city && <span className="italic">Sem endereço cadastrado</span>}
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400 shrink-0">
          <span title="Edge Boxes" className="inline-flex items-center gap-1">
            <Server className="w-3 h-3 text-cyan-400/80" />
            {site.counts.edgeNodes} <span className="text-slate-600">box{site.counts.edgeNodes !== 1 ? 'es' : ''}</span>
          </span>
          {(() => {
            const { boxCams, directCams } = camBreakdownForSite(site)
            return (
              <>
                <span title="Box Cams" className="inline-flex items-center gap-1 text-emerald-300/90">
                  <Box className="w-3 h-3" />
                  {boxCams} <span className="text-slate-600">box cam{boxCams !== 1 ? 's' : ''}</span>
                </span>
                <span title="Direct Cams" className="inline-flex items-center gap-1 text-violet-300/90">
                  <Wifi className="w-3 h-3" />
                  {directCams} <span className="text-slate-600">direct cam{directCams !== 1 ? 's' : ''}</span>
                </span>
              </>
            )
          })()}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-800 px-3 py-2.5 pl-9 bg-slate-950/40 space-y-2">
          {/* Edge boxes do site */}
          {edgeNodes.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1.5">
                <Server className="w-3 h-3" /> Edge Boxes ({edgeNodes.length})
              </div>
              {edgeNodes.map(n => (
                <EdgeNodeRow key={n.id} node={n} onPreviewCamera={onPreviewCamera} />
              ))}
            </div>
          )}

          {/* Direct Cams — câmeras CLOUD_DIRECT do site (sem box intermediária) */}
          {standalone.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-violet-400 font-bold flex items-center gap-1.5">
                <Camera className="w-3 h-3" /> Direct Cams ({standalone.length})
              </div>
              {standalone.map(c => (
                <CameraRow key={c.id} camera={c} onPreviewCamera={onPreviewCamera} variant="standalone" />
              ))}
            </div>
          )}

          {edgeNodes.length === 0 && standalone.length === 0 && (
            <div className="text-xs text-slate-500 italic text-center py-2">
              Nenhuma box ou câmera neste site ainda
            </div>
          )}

          {/* Ações inline */}
          <div className="pt-2 mt-1 border-t border-slate-800/70 flex flex-wrap gap-1.5 text-[11px]">
            {onAddBox && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAddBox(site.id) }}
                className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 transition inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Provisionar box
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (addCameraMode === 'callback') onAddCamera?.(site.id, 'EDGE_BOX')
                else setWizardOpen(true)
              }}
              className="px-2 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Câmera
            </button>
          </div>
        </div>
      )}

      <AddCameraWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        siteId={site.id}
      />
    </div>
  )
}

function EdgeNodeRow({
  node,
  onPreviewCamera,
}: {
  node: TreeEdgeNode
  onPreviewCamera?: (cam: TreeCamera) => void
}) {
  const [open, setOpen] = useState(false)
  const isOnline = node.status === 'ONLINE'
  const cams = node.cameras ?? []
  const hasMetrics = node.cpuUsage != null || node.memUsage != null || node.diskUsage != null

  return (
    <div className="rounded bg-slate-900 border border-amber-500/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full p-2.5 flex items-center gap-2 text-left hover:bg-amber-500/5 transition"
      >
        {open
          ? <ChevronDown className="w-3 h-3 text-amber-400 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
        }
        <Server className="w-4 h-4 text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-white text-sm truncate">{node.name}</span>
            <span className={cn(
              'text-[10px] flex items-center gap-1',
              isOnline ? 'text-emerald-400' : 'text-rose-400',
            )}>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400',
              )} />
              {node.status.toLowerCase()}
            </span>
            {node.firmwareVersion && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                v{node.firmwareVersion}
              </span>
            )}
          </div>
          {/* Metrics inline (mockup 03) */}
          {hasMetrics && (
            <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-1 flex-wrap">
              {node.cpuUsage != null && (
                <span title="CPU" className="inline-flex items-center gap-1"><Cpu className="w-2.5 h-2.5" />{Math.round(node.cpuUsage)}%</span>
              )}
              {node.memUsage != null && (
                <span title="RAM" className="inline-flex items-center gap-1"><MemoryStick className="w-2.5 h-2.5" />{Math.round(node.memUsage)}%</span>
              )}
              {node.diskUsage != null && (
                <span title="Disk" className="inline-flex items-center gap-1"><HardDrive className="w-2.5 h-2.5" />{Math.round(node.diskUsage)}%</span>
              )}
              {node.uptimeSeconds != null && node.uptimeSeconds > 0 && (
                <span title="Uptime" className="inline-flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{formatUptime(node.uptimeSeconds)}</span>
              )}
              {node.fpsCurrent != null && node.fpsCurrent > 0 && (
                <span title="FPS local" className="inline-flex items-center gap-1">⚡{node.fpsCurrent.toFixed(1)} fps</span>
              )}
            </div>
          )}
          {!hasMetrics && (
            <div className="text-[10px] text-slate-500 mt-0.5">
              {node.cameraCount} câmera{node.cameraCount !== 1 ? 's' : ''}
              {node.lastHeartbeat && ` · last seen ${new Date(node.lastHeartbeat).toLocaleString('pt-BR')}`}
            </div>
          )}
        </div>
        <span title="Box Cams (gerenciadas por esta box)" className="text-[10px] text-emerald-300/90 shrink-0 inline-flex items-center gap-1">
          <Box className="w-3 h-3" />
          {node.cameraCount} <span className="text-slate-600">box cam{node.cameraCount !== 1 ? 's' : ''}</span>
        </span>
      </button>

      {/* Câmeras EDGE_BOX nested */}
      {open && (
        <div className="border-t border-amber-500/20 bg-slate-950/30 px-3 py-2 space-y-1.5">
          {cams.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic text-center py-2">
              Nenhuma câmera vinculada a esta box ainda
            </div>
          ) : (
            cams.map(c => (
              <CameraRow key={c.id} camera={c} onPreviewCamera={onPreviewCamera} variant="edgebox" />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function CameraRow({
  camera,
  onPreviewCamera,
  variant,
}: {
  camera: TreeCamera
  onPreviewCamera?: (cam: TreeCamera) => void
  variant: 'edgebox' | 'standalone'
}) {
  const accent = variant === 'edgebox'
    ? { border: 'border-amber-500/20', text: 'text-amber-300', icon: 'text-amber-400', label: 'EDGE_BOX' }
    : { border: 'border-violet-500/20', text: 'text-violet-300', icon: 'text-violet-400', label: 'CLOUD_DIRECT' }

  return (
    <div className={cn('rounded bg-slate-900 p-2 flex items-center gap-2 border', accent.border)}>
      <Camera className={cn('w-3.5 h-3.5 shrink-0', accent.icon)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-white text-xs truncate">{camera.name}</span>
          <span className={cn(
            'text-[9px] px-1.5 py-0.5 rounded font-mono border',
            variant === 'edgebox'
              ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
              : 'bg-violet-500/10 text-violet-300 border-violet-500/30',
          )}>
            {accent.label}
          </span>
        </div>
      </div>
      {onPreviewCamera && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPreviewCamera(camera) }}
          className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 text-[10px] inline-flex items-center gap-1 transition shrink-0"
          title="Ver ao vivo"
        >
          <Play className="w-2.5 h-2.5 fill-current" /> Live
        </button>
      )}
    </div>
  )
}

function LivePreviewModal({ camera, onClose }: { camera: TreeCamera; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-slate-900 border border-rose-500/30 rounded-2xl shadow-2xl shadow-rose-500/10 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <h3 className="text-sm font-bold text-white">{camera.name}</h3>
            <span className={cn(
              'text-[10px] px-2 py-0.5 rounded font-mono border',
              camera.deploymentMode === 'EDGE_BOX'
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'bg-violet-500/10 text-violet-300 border-violet-500/30',
            )}>
              {camera.deploymentMode}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="aspect-video bg-black">
          <LivePlayer cameraId={camera.id} cameraName={camera.name} muted={false} showOverlay />
        </div>
      </div>
    </div>
  )
}

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

// Re-export ícones úteis para consumers
export { Building2, MapPin, Server, Camera }
