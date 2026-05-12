/**
 * AutoBreadcrumb — Breadcrumb hierárquico que se adapta automaticamente à
 * URL atual e à persona logada.
 *
 * Mapeia path → segmentos hierárquicos do mental model:
 *   Fabricante (🏭) › Integrador (🤝) › Cliente (👤) › Site (📍) › Box (📦) › Câmera (📹)
 *
 * Não aparece em rotas raiz (/, /portal/home, etc) onde o hero da página já
 * comunica o contexto.
 */
import { useLocation } from 'react-router-dom'
import { BreadcrumbBar, type BreadcrumbSegment } from './BreadcrumbBar'

const FABRICANTE_NAME = 'VSaaS'

function buildSegments(pathname: string, role: string): BreadcrumbSegment[] {
  const segs: BreadcrumbSegment[] = []
  const parts = pathname.split('/').filter(Boolean)

  // Não mostrar breadcrumb em rotas top-level (já têm hero próprio)
  const skipPaths = new Set([
    '', '/', 'login', 'change-password',
    'portal', 'portal/home',
    'integrador', 'meu-negocio',
  ])
  if (parts.length === 0) return []
  if (skipPaths.has(pathname.replace(/^\/+/, ''))) return []

  const isSuper = role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL'
  const isIntegrador = role === 'INTEGRADOR_ADMIN' || role === 'INTEGRADOR_TECNICO'
  const isCliente = role.startsWith('CLIENTE_') || role === 'CLIENT_ADMIN'

  // Raiz por persona
  if (isSuper) {
    segs.push({ icon: '🏭', label: FABRICANTE_NAME, to: '/' })
  } else if (isIntegrador) {
    segs.push({ icon: '🤝', label: 'Meu Negócio', to: '/integrador' })
  } else if (isCliente) {
    segs.push({ icon: '👤', label: 'Cliente', to: '/portal/home' })
  }

  // Mapeamento de paths principais → label friendly
  const pathLabels: Record<string, { icon?: string; label: string }> = {
    'admin/tenants':      { icon: '🤝', label: 'Tenants' },
    'admin/comercial':    { icon: '💼', label: 'Comercial' },
    'admin/alerts':       { icon: '⚠',  label: 'Alertas' },
    'admin/whitelabel':   { icon: '🎨', label: 'White-label' },
    'admin/catalog':      { icon: '🧩', label: 'Catálogo' },
    'admin/integrations': { icon: '⚡', label: 'Integrações' },
    'admin/leads':        { icon: '📋', label: 'Leads' },
    'admin/logs':         { icon: '📜', label: 'Logs' },
    'audit':              { icon: '🛡', label: 'Auditoria' },
    'clientes-finais':    { icon: '👤', label: 'Clientes' },
    'sites':              { icon: '📍', label: 'Sites' },
    'edge':               { icon: '📦', label: 'Edge Boxes' },
    'fleet':              { icon: '📦', label: 'Frota' },
    'cameras':            { icon: '📹', label: 'Câmeras' },
    'recordings':         { icon: '🎬', label: 'Gravações' },
    'live':               { icon: '🔴', label: 'Ao Vivo' },
    'review':             { icon: '🔔', label: 'Eventos' },
    'analytics':          { icon: '📊', label: 'Analytics' },
    'faces':              { icon: '👥', label: 'Faces' },
    'plates':             { icon: '🚗', label: 'Placas' },
    'heatmap':            { icon: '🔥', label: 'Heatmap' },
    'demographics':       { icon: '📊', label: 'Demografia' },
    'users':              { icon: '👥', label: 'Usuários' },
    'modulos':            { icon: '🧩', label: 'Módulos' },
    'admin/modulos':      { icon: '🧩', label: 'Módulos' },
    'quota':              { icon: '📊', label: 'Quota' },
    'custom-domains':     { icon: '🌐', label: 'Domínio' },
    'settings':           { icon: '⚙', label: 'Configurações' },
    'integrador':         { icon: '🤝', label: 'Cockpit' },
  }

  // Tentar match por path completo primeiro, depois por path parcial
  // /admin/tenants/:id → 🏭 ICV › 🤝 Tenants › [id]
  const pathStr = parts.join('/')
  for (const [pattern, label] of Object.entries(pathLabels)) {
    if (pathStr === pattern) {
      segs.push({ icon: label.icon, label: label.label })
      return segs
    }
    if (pathStr.startsWith(pattern + '/')) {
      segs.push({ icon: label.icon, label: label.label, to: '/' + pattern })
      // O resto da URL vira último segmento (pode ser id)
      const tail = pathStr.slice(pattern.length + 1)
      if (tail) segs.push({ label: shortenId(tail) })
      return segs
    }
  }

  // Fallback genérico: cada parte da URL vira segmento
  let acc = ''
  for (let i = 0; i < parts.length; i++) {
    acc += '/' + parts[i]
    const isLast = i === parts.length - 1
    segs.push({
      label: humanize(parts[i]),
      to: isLast ? undefined : acc,
    })
  }

  return segs
}

function humanize(s: string): string {
  if (s.length <= 4 && /^\d+$/.test(s)) return s
  if (s.length > 12 && /^[a-z0-9-]+$/i.test(s)) return s.slice(0, 8) + '…'  // id-like
  return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function shortenId(s: string): string {
  if (s.length > 16) return s.slice(0, 12) + '…'
  return s
}

export function AutoBreadcrumb({ className }: { className?: string }) {
  const location = useLocation()
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  const segments = buildSegments(location.pathname, role)
  if (segments.length === 0) return null
  return <BreadcrumbBar segments={segments} className={className} />
}
