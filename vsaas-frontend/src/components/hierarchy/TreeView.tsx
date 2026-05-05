/**
 * TreeView — Drill-down acordeão para a hierarquia Cliente→Site→Box→Câmera.
 *
 * Consome o response do endpoint /admin/integradores/:id/tree (depth=3) e renderiza
 * acordeões aninhados que expandem/colapsam in-place sem sair da página.
 *
 * Inputs vêm tipados como TreeNode hierarchy (cliente | site | box | camera-avulsa).
 * Mesmo componente reaproveitado em todos os 3 cockpits (Fabricante / Integrador / Cliente)
 * — só muda quem chama o endpoint e qual escopo o backend devolve via RBAC.
 */
import { useState, ReactNode } from 'react'
import { ChevronDown, ChevronRight, Building2, MapPin, Server, Camera, Plus } from 'lucide-react'
import { HealthScoreBadge } from './HealthScoreBadge'
import { cn } from '../../lib/utils'

export interface TreeCamera {
  id: string
  name: string
  deploymentMode: 'EDGE_BOX' | 'CLOUD_DIRECT'
  edgeNodeId: string | null
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
  /** Caminho base para navegação drill-in (default: '/clientes-finais'). */
  basePath?: string
  className?: string
  emptyState?: ReactNode
}

function healthFromCounts(c: TreeCliente['counts']): number | null {
  if (c.edgeNodes === 0) return null
  return Math.round((c.edgeNodesOnline / c.edgeNodes) * 100)
}

export function TreeView({
  clientes,
  onImpersonateClient,
  onAddSite,
  onAddBox,
  onAddCamera,
  className,
  emptyState,
}: TreeViewProps) {
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
    <div className={cn('space-y-2', className)}>
      {clientes.map(c => (
        <ClienteRow
          key={c.id}
          cliente={c}
          onImpersonate={onImpersonateClient}
          onAddSite={onAddSite}
          onAddBox={onAddBox}
          onAddCamera={onAddCamera}
        />
      ))}
    </div>
  )
}

function ClienteRow({
  cliente,
  onImpersonate,
  onAddSite,
  onAddBox,
  onAddCamera,
}: {
  cliente: TreeCliente
  onImpersonate?: (id: string) => void
  onAddSite?: (id: string) => void
  onAddBox?: (siteId: string) => void
  onAddCamera?: (siteId: string, mode: 'EDGE_BOX' | 'CLOUD_DIRECT') => void
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
      {/* Linha do cliente — clicável para expandir */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
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
        <div className="hidden md:flex items-center gap-3 text-xs text-slate-400 shrink-0">
          <span title="Sites">{cliente.counts.sites} <span className="text-slate-600">sites</span></span>
          <span title="Boxes online" className={cliente.counts.edgeNodesOnline === cliente.counts.edgeNodes ? 'text-emerald-400' : 'text-amber-400'}>
            {cliente.counts.edgeNodesOnline}/{cliente.counts.edgeNodes} <span className="text-slate-600">boxes</span>
          </span>
          <span title="Câmeras">{cliente.counts.cameras} <span className="text-slate-600">câm</span></span>
          <span title="Usuários">{cliente.counts.users} <span className="text-slate-600">usr</span></span>
        </div>
      </button>

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
              <SiteRow key={s.id} site={s} onAddBox={onAddBox} onAddCamera={onAddCamera} />
            ))
          )}

          {/* Ações no nível cliente */}
          <div className="pt-2 mt-2 border-t border-slate-800/70 flex flex-wrap gap-2 text-xs">
            {onImpersonate && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onImpersonate(cliente.id) }}
                className="px-3 py-1 rounded bg-slate-800 border border-slate-700 hover:border-violet-500/50 hover:text-violet-300 text-slate-400 transition"
              >
                👤 Acessar como cliente
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SiteRow({
  site,
  onAddBox,
  onAddCamera,
}: {
  site: TreeSite
  onAddBox?: (siteId: string) => void
  onAddCamera?: (siteId: string, mode: 'EDGE_BOX' | 'CLOUD_DIRECT') => void
}) {
  const [open, setOpen] = useState(false)
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
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {site.address && <span>{site.address}</span>}
            {site.city && <span>{site.address ? ' · ' : ''}{site.city}, {site.state}</span>}
            {!site.address && !site.city && <span className="italic">Sem endereço cadastrado</span>}
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400 shrink-0">
          <span>{site.counts.edgeNodes} <span className="text-slate-600">box</span></span>
          <span>{site.counts.cameras} <span className="text-slate-600">câm</span></span>
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
              {edgeNodes.map(n => <EdgeNodeRow key={n.id} node={n} />)}
            </div>
          )}

          {/* Câmeras avulsas */}
          {standalone.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-violet-400 font-bold flex items-center gap-1.5">
                <Camera className="w-3 h-3" /> Câmeras avulsas — cloud direct ({standalone.length})
              </div>
              {standalone.map(c => <CameraRow key={c.id} camera={c} />)}
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
            {onAddCamera && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAddCamera(site.id, 'EDGE_BOX') }}
                className="px-2 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Câmera
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EdgeNodeRow({ node }: { node: TreeEdgeNode }) {
  const isOnline = node.status === 'ONLINE'
  return (
    <div className="rounded bg-slate-900 border border-amber-500/20 p-2.5 flex items-center gap-2">
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
        <div className="text-[10px] text-slate-500 mt-0.5">
          {node.cameraCount} câmera{node.cameraCount !== 1 ? 's' : ''}
          {node.lastHeartbeat && ` · last seen ${new Date(node.lastHeartbeat).toLocaleString('pt-BR')}`}
        </div>
      </div>
    </div>
  )
}

function CameraRow({ camera }: { camera: TreeCamera }) {
  return (
    <div className="rounded bg-slate-900 border border-violet-500/20 p-2.5 flex items-center gap-2">
      <Camera className="w-4 h-4 text-violet-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-white text-sm truncate">{camera.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/30 font-mono">
            CLOUD_DIRECT
          </span>
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">avulsa · não pertence a edge box</div>
      </div>
    </div>
  )
}

// Re-export ícones úteis para consumers
export { Building2, MapPin, Server, Camera }
