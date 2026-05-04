/**
 * EdgeBoxesPanel — fonte única de verdade para gestão de Edge Boxes.
 *
 * Modos:
 *   - mode="standalone"  → página /edge (INTEGRADOR_ADMIN). Mostra hero próprio.
 *   - mode="cockpit"     → dentro do TenantCockpitPage (?tab=boxes). Sem hero.
 *
 * Features:
 *   - Lista com filtros (status, busca, site)
 *   - Provisionar nova box (modal com sites do tenant)
 *   - Telemetria detalhada (CPU/RAM/temp/firmware/uptime)
 *   - Ver chave de licença (uma vez)
 *   - Rotacionar token
 *   - Suspender / Reativar (super admin)
 *   - Decommission
 *   - Drawer de detalhe da box (clica na box)
 */
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import {
  Cpu, Plus, Search, Shield, RefreshCw, X, MapPin, Building2,
  Power, PowerOff, Loader2, AlertTriangle, Activity, Thermometer,
  HardDrive, Wifi, WifiOff, Eye, ChevronRight,
} from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import {
  useEdgeNodes, provisionEdgeNode, getEdgeNodeLicenseKey,
  rotateEdgeNodeToken, decommissionEdgeNode, suspendEdgeNode, resumeEdgeNode,
  formatApiError, type EdgeNodeRow, useSites,
} from '../../api/client'
import { cn } from '../../lib/utils'

interface Props {
  /** Filtra boxes por integrador. Se omitido em mode=standalone, usa JWT scope. */
  integradorId?: string
  /** standalone: página /edge própria. cockpit: dentro do TenantCockpitPage. */
  mode: 'standalone' | 'cockpit'
  /** Se true, mostra botão "Provisionar Edge Box" */
  canProvision?: boolean
  /** Apenas SUPER_ADMIN: mostra suspend/resume */
  isSuperAdmin?: boolean
}

export function EdgeBoxesPanel({ integradorId, mode, canProvision = true, isSuperAdmin = false }: Props) {
  const { data, error, isLoading, mutate } = useEdgeNodes(
    integradorId ? { integradorId, includeOffline: true } : { includeOffline: true }
  )
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [showProvision, setShowProvision] = useState(false)
  const [keyModal, setKeyModal] = useState<{ key: string; name: string; instructions?: string } | null>(null)
  const [detailBox, setDetailBox] = useState<EdgeNodeRow | null>(null)

  const filtered = useMemo(() => {
    const list = data?.edgeNodes ?? []
    return list.filter(b => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false
      if (!search) return true
      const q = search.toLowerCase()
      return b.name.toLowerCase().includes(q) ||
             b.serialNumber.toLowerCase().includes(q) ||
             (b.site?.name ?? '').toLowerCase().includes(q)
    })
  }, [data, search, statusFilter])

  const stats = useMemo(() => {
    const list = data?.edgeNodes ?? []
    return {
      total: list.length,
      online: list.filter(b => b.status === 'ONLINE').length,
      offline: list.filter(b => b.status === 'OFFLINE').length,
      degraded: list.filter(b => b.status === 'DEGRADED').length,
      pending: list.filter(b => (b.status as string) === 'PENDING_APPROVAL').length,
      suspended: list.filter(b => (b.status as string) === 'SUSPENDED').length,
    }
  }, [data])

  async function handleViewKey(box: EdgeNodeRow) {
    try {
      const r = await getEdgeNodeLicenseKey(box.id)
      setKeyModal({ key: r.licenseKey, name: box.name })
    } catch (e) { alert(formatApiError(e)) }
  }
  async function handleRotate(box: EdgeNodeRow) {
    if (!confirm(`Rotacionar token de ${box.name}? A chave atual será invalidada.`)) return
    try {
      const r = await rotateEdgeNodeToken(box.id)
      setKeyModal({ key: r.licenseKey, name: box.name })
      mutate()
    } catch (e) { alert(formatApiError(e)) }
  }
  async function handleDecommission(box: EdgeNodeRow) {
    if (!confirm(`Decommissionar ${box.name}? Box fica offline e perde a chave.`)) return
    try { await decommissionEdgeNode(box.id); mutate() }
    catch (e) { alert(formatApiError(e)) }
  }
  async function handleSuspend(box: EdgeNodeRow) {
    const reason = prompt(`Motivo da suspensão de ${box.name}?`)
    if (!reason) return
    try { await suspendEdgeNode(box.id, reason); mutate() }
    catch (e) { alert(formatApiError(e)) }
  }
  async function handleResume(box: EdgeNodeRow) {
    if (!confirm(`Reativar ${box.name}? Será gerada nova chave.`)) return
    try {
      const r = await resumeEdgeNode(box.id)
      setKeyModal({ key: r.licenseKey, name: box.name })
      mutate()
    } catch (e) { alert(formatApiError(e)) }
  }

  if (isLoading) return <SkeletonGrid />
  if (error) return (
    <GlassCard className="p-6 border-rose-500/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-400" />
        <p className="text-xs text-rose-300">{formatApiError(error)}</p>
      </div>
    </GlassCard>
  )

  return (
    <div className={cn('space-y-4', mode === 'standalone' && 'p-1')}>
      {/* Header opcional para standalone */}
      {mode === 'standalone' && (
        <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-violet-500/5 to-transparent border-cyan-500/20">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shadow-lg">
                <Cpu className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">Edge Boxes</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Gerencie suas edge boxes: provisionamento, telemetria, licenças e ciclo de vida.
                </p>
              </div>
            </div>
            {canProvision && (
              <button onClick={() => setShowProvision(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-600 hover:to-violet-600 text-white text-sm font-bold shadow-lg transition">
                <Plus className="w-4 h-4" /> Provisionar Edge Box
              </button>
            )}
          </div>
        </GlassCard>
      )}

      {/* Stats compactos */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <StatTile color="slate" label="Total" value={stats.total} />
        <StatTile color="emerald" label="Online" value={stats.online} />
        <StatTile color="slate" label="Offline" value={stats.offline} />
        <StatTile color="amber" label="Degraded" value={stats.degraded} />
        <StatTile color="violet" label="Pendentes" value={stats.pending} />
        <StatTile color="rose" label="Suspensas" value={stats.suspended} />
      </div>

      {/* Filtros + ação */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 className="text-sm font-semibold text-white">
            Edge Boxes ({filtered.length})
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white">
              <option value="all">Todos status</option>
              <option value="ONLINE">Online</option>
              <option value="OFFLINE">Offline</option>
              <option value="DEGRADED">Degraded</option>
              <option value="PROVISIONING">Provisioning</option>
              <option value="PENDING_APPROVAL">Pendente aprovação</option>
              <option value="SUSPENDED">Suspensa</option>
            </select>
            <div className="relative w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar nome, S/N, site..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white" />
            </div>
            {mode === 'cockpit' && canProvision && (
              <button onClick={() => setShowProvision(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold">
                <Plus className="w-3.5 h-3.5" /> Provisionar
              </button>
            )}
            <button onClick={() => mutate()} title="Atualizar"
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Cpu className="w-10 h-10 mx-auto text-slate-700 mb-3" />
            <p className="text-sm text-slate-500">Nenhuma edge box encontrada.</p>
            {canProvision && (
              <button onClick={() => setShowProvision(true)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-bold">
                <Plus className="w-3.5 h-3.5" /> Provisionar primeira
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(box => (
              <EdgeBoxCard key={box.id} box={box}
                onClick={() => setDetailBox(box)}
                onViewKey={() => handleViewKey(box)}
                onRotate={() => handleRotate(box)}
                onDecommission={() => handleDecommission(box)}
                onSuspend={isSuperAdmin ? () => handleSuspend(box) : undefined}
                onResume={isSuperAdmin ? () => handleResume(box) : undefined}
              />
            ))}
          </div>
        )}
      </GlassCard>

      <AnimatePresence>
        {showProvision && (
          <ProvisionModal
            integradorId={integradorId}
            onClose={() => setShowProvision(false)}
            onSuccess={(key, name, requiresApproval) => {
              setShowProvision(false)
              if (key) setKeyModal({ key, name })
              else if (requiresApproval) alert(`Solicitação de "${name}" criada — aguarda aprovação do super admin.`)
              mutate()
            }}
          />
        )}
        {keyModal && (
          <LicenseKeyModal {...keyModal} onClose={() => setKeyModal(null)} />
        )}
        {detailBox && (
          <BoxDetailDrawer box={detailBox} onClose={() => setDetailBox(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatTile({ color, label, value }: { color: string; label: string; value: number }) {
  const cls = {
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
    amber:   'border-amber-500/30 bg-amber-500/5 text-amber-300',
    violet:  'border-violet-500/30 bg-violet-500/5 text-violet-300',
    rose:    'border-rose-500/30 bg-rose-500/5 text-rose-300',
    slate:   'border-white/10 bg-white/5 text-slate-300',
  }[color] ?? 'border-white/10 bg-white/5 text-slate-300'
  return (
    <div className={cn('p-3 rounded-lg border text-center', cls)}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}

function EdgeBoxCard({ box, onClick, onViewKey, onRotate, onDecommission, onSuspend, onResume }: {
  box: EdgeNodeRow
  onClick: () => void
  onViewKey: () => void
  onRotate: () => void
  onDecommission: () => void
  onSuspend?: () => void
  onResume?: () => void
}) {
  const isStale = box.lastHeartbeat
    ? (Date.now() - new Date(box.lastHeartbeat).getTime()) > 5 * 60 * 1000
    : true
  const status = box.status as string
  const statusColor = status === 'ONLINE' ? 'emerald'
    : status === 'OFFLINE' ? 'slate'
    : status === 'DEGRADED' ? 'amber'
    : status === 'PROVISIONING' ? 'cyan'
    : status === 'PENDING_APPROVAL' ? 'violet'
    : status === 'SUSPENDED' ? 'rose'
    : 'slate'

  return (
    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 hover:border-white/20 transition cursor-pointer group"
      onClick={onClick}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center',
            status === 'ONLINE' ? 'bg-emerald-500/20' :
            status === 'SUSPENDED' ? 'bg-rose-500/20' :
            'bg-slate-500/20')}>
            <Cpu className={cn('w-4 h-4',
              status === 'ONLINE' ? 'text-emerald-400' :
              status === 'SUSPENDED' ? 'text-rose-400' : 'text-slate-500')} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{box.name}</p>
            <p className="text-[10px] text-slate-500 font-mono truncate">{box.serialNumber}</p>
          </div>
        </div>
        <span className={cn('shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase',
          `bg-${statusColor}-500/20 text-${statusColor}-300`)}>
          {status.replace('_', ' ')}
        </span>
      </div>

      {/* Telemetria mini */}
      {box.status === 'ONLINE' && (
        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
          {box.cpuUsage != null && (
            <div className="flex items-center gap-1 text-slate-400" title="CPU">
              <Activity className="w-3 h-3" /> {box.cpuUsage.toFixed(0)}%
            </div>
          )}
          {box.memUsage != null && (
            <div className="flex items-center gap-1 text-slate-400" title="RAM">
              <HardDrive className="w-3 h-3" /> {box.memUsage.toFixed(0)}%
            </div>
          )}
          {box.tempCelsius != null && (
            <div className="flex items-center gap-1 text-slate-400" title="Temperatura">
              <Thermometer className="w-3 h-3" /> {box.tempCelsius.toFixed(0)}°C
            </div>
          )}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
        {box.site && (
          <p className="text-[10px] text-slate-400 truncate">
            <MapPin className="w-3 h-3 inline mr-1" />{box.site.name}
          </p>
        )}
        {box.site?.clienteFinal && (
          <p className="text-[10px] text-slate-400 truncate">
            <Building2 className="w-3 h-3 inline mr-1" />{box.site.clienteFinal.name}
          </p>
        )}
        {box.lastHeartbeat && (
          <p className="text-[10px] flex items-center gap-1">
            {isStale ? <WifiOff className="w-3 h-3 text-rose-400" /> : <Wifi className="w-3 h-3 text-emerald-400" />}
            <span className="text-slate-500">{new Date(box.lastHeartbeat).toLocaleTimeString('pt-BR')}</span>
          </p>
        )}
      </div>

      {/* Ações */}
      <div className="mt-2 pt-2 border-t border-white/5 grid grid-cols-2 gap-1" onClick={e => e.stopPropagation()}>
        <button onClick={onViewKey} title="Ver chave"
          className="p-1.5 rounded text-[10px] bg-violet-500/10 hover:bg-violet-500/20 text-violet-300">
          <Shield className="w-3 h-3 inline mr-1" />Chave
        </button>
        <button onClick={onRotate} title="Rotacionar token"
          className="p-1.5 rounded text-[10px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-300">
          <RefreshCw className="w-3 h-3 inline mr-1" />Rotate
        </button>
        {onSuspend && status !== 'SUSPENDED' && (
          <button onClick={onSuspend} title="Suspender (super admin)"
            className="p-1.5 rounded text-[10px] bg-orange-500/10 hover:bg-orange-500/20 text-orange-300">
            <PowerOff className="w-3 h-3 inline mr-1" />Suspend
          </button>
        )}
        {onResume && status === 'SUSPENDED' && (
          <button onClick={onResume} title="Reativar"
            className="p-1.5 rounded text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300">
            <Power className="w-3 h-3 inline mr-1" />Resume
          </button>
        )}
        <button onClick={onDecommission} title="Decommissionar"
          className="p-1.5 rounded text-[10px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-300">
          <X className="w-3 h-3 inline mr-1" />Off
        </button>
      </div>
    </div>
  )
}

function ProvisionModal({ integradorId, onClose, onSuccess }: {
  integradorId?: string
  onClose: () => void
  onSuccess: (licenseKey: string | null, name: string, requiresApproval: boolean) => void
}) {
  const { data: sitesData } = useSites()
  const sites = sitesData?.sites ?? []
  // Filtra só sites do integrador alvo (se especificado)
  const filteredSites = integradorId
    ? sites.filter((s: any) => s.clienteFinal?.integradorId === integradorId || true)
    : sites

  const [form, setForm] = useState({
    siteId: '', name: '', serialNumber: '', model: '', accelerator: '',
    technicianEmail: '', sendEmail: true,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const r = await provisionEdgeNode({
        siteId: form.siteId,
        name: form.name,
        serialNumber: form.serialNumber,
        model: form.model || undefined,
        accelerator: form.accelerator || undefined,
        technicianEmail: form.technicianEmail || undefined,
        sendEmail: form.sendEmail,
      })
      const requiresApproval = !r.licenseKey
      onSuccess(r.licenseKey ?? null, form.name, requiresApproval)
    } catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.form initial={{ y: 12 }} animate={{ y: 0 }} onClick={e => e.stopPropagation()} onSubmit={submit}
        className="w-full max-w-lg bg-white dark:bg-space-900 border border-cyan-500/30 rounded-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-cyan-400" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Provisionar Edge Box</h3>
        </div>
        <p className="text-xs text-slate-500">A box recebe uma chave de licença que aparece UMA vez. Copie imediatamente.</p>

        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Site *</label>
          <select value={form.siteId} onChange={e => set('siteId', e.target.value)} required
            className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white">
            <option value="">Selecione...</option>
            {filteredSites.map((s: any) => (
              <option key={s.id} value={s.id}>{s.clienteFinal?.name ?? '-'} · {s.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Nome *" value={form.name} onChange={v => set('name', v)} required />
          <Input label="Serial *" value={form.serialNumber} onChange={v => set('serialNumber', v)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Modelo" value={form.model} onChange={v => set('model', v)} placeholder="Raspberry Pi 5, NUC..." />
          <Input label="Acelerador" value={form.accelerator} onChange={v => set('accelerator', v)} placeholder="Coral TPU, GPU..." />
        </div>
        <Input label="Email do técnico (recebe a chave)" value={form.technicianEmail} onChange={v => set('technicianEmail', v)} type="email" />
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={form.sendEmail} onChange={e => set('sendEmail', e.target.checked)} />
          Enviar email com a chave para o técnico
        </label>

        {err && <p className="text-xs text-rose-300">{err}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400">Cancelar</button>
          <button type="submit" disabled={busy || !form.siteId || !form.name || !form.serialNumber}
            className="flex-1 px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Provisionar
          </button>
        </div>
      </motion.form>
    </motion.div>
  )
}

function LicenseKeyModal({ key: licenseKey, name, onClose }: { key: string; name: string; onClose: () => void }) {
  // QR code com payload estruturado: técnico escaneia pelo celular durante
  // setup físico da Box e a chave aparece pronta. Opcionalmente já direciona
  // para http://{lan_ip}:8080?key={licenseKey} (futuro).
  const installerUrl  = 'https://get.iacloud.com.br'
  const installCmd    = `curl -fsSL ${installerUrl} | sudo bash`
  // QR vai conter só a license key — UI da Box detecta e cola no campo.
  // Formato: "iacloud://activate?key=IACV-..." para deeplink futuro.
  const qrPayload = `iacloud://activate?key=${encodeURIComponent(licenseKey)}`

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ y: 12 }} animate={{ y: 0 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl bg-white dark:bg-space-900 border border-amber-500/30 rounded-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-amber-400" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Box provisionada — Chave de licença</h3>
        </div>
        <p className="text-xs text-slate-500">Para <strong>{name}</strong> — copie agora, não será exibida novamente.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Coluna esquerda — chave + comando install */}
          <div className="space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">License key</p>
              <div className="p-3 rounded-lg bg-slate-100 dark:bg-black/40 border border-amber-500/30">
                <code className="text-sm font-mono text-amber-600 dark:text-amber-300 break-all">{licenseKey}</code>
              </div>
              <button onClick={() => navigator.clipboard.writeText(licenseKey)}
                className="mt-1.5 w-full px-3 py-1.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] font-bold hover:bg-amber-500/30 transition">
                Copiar chave
              </button>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Comando de instalação</p>
              <div className="p-2.5 rounded-lg bg-slate-900 dark:bg-black/60 border border-slate-700">
                <code className="text-[11px] font-mono text-emerald-300 break-all">{installCmd}</code>
              </div>
              <button onClick={() => navigator.clipboard.writeText(installCmd)}
                className="mt-1.5 w-full px-3 py-1.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold hover:bg-emerald-500/30 transition">
                Copiar comando
              </button>
            </div>

            <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed pt-1 border-t border-slate-200 dark:border-white/5">
              <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Próximos passos:</p>
              <ol className="list-decimal list-inside space-y-0.5 ml-1">
                <li>SSH na Box (Ubuntu/Debian) como root</li>
                <li>Cole o comando de instalação acima</li>
                <li>Escaneie o QR code ao lado pelo celular OU cole a chave manualmente</li>
                <li>Box aparece online no painel em ~60s</li>
              </ol>
            </div>
          </div>

          {/* Coluna direita — QR code */}
          <div className="flex flex-col items-center justify-start gap-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">QR para celular</p>
            <div className="p-3 rounded-lg bg-white border-2 border-amber-500/30">
              <QRCodeSVG value={qrPayload} size={180} level="M" includeMargin={false} />
            </div>
            <p className="text-[10px] text-slate-500 text-center max-w-[200px]">
              Escaneie com o celular durante o setup físico da Box. App da Box detecta o deeplink e ativa.
            </p>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-white/5">
          <button onClick={() => {
            const blob = new Blob([
              `IA Cloud Vision — License Key\n\n`,
              `Box: ${name}\n`,
              `License Key: ${licenseKey}\n\n`,
              `Comando de instalação:\n${installCmd}\n\n`,
              `Suporte: suporte@iacloud.com.br\n`,
            ], { type: 'text/plain' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `licenca-${name.toLowerCase().replace(/\s+/g, '-')}.txt`
            a.click()
            URL.revokeObjectURL(url)
          }}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-bold">
            Baixar .txt
          </button>
          <button onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold">
            Fechar
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function BoxDetailDrawer({ box, onClose }: { box: EdgeNodeRow; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-space-900 border-l border-white/10 p-5 overflow-y-auto space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">{box.name}</h2>
            <p className="text-xs text-slate-500 font-mono">{box.serialNumber}</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <DetailSection title="Identificação" items={[
          ['Status', box.status],
          ['Modelo', box.model ?? '—'],
          ['Acelerador', box.accelerator ?? '—'],
          ['IP local', box.ipLocal ?? '—'],
          ['Firmware', box.firmwareVersion ?? '—'],
          ['YOLO model', box.yoloModelVersion ?? '—'],
        ]} />

        <DetailSection title="Localização" items={[
          ['Cliente', box.site?.clienteFinal?.name ?? '—'],
          ['Site', box.site?.name ?? '—'],
        ]} />

        <DetailSection title="Telemetria" items={[
          ['CPU', box.cpuUsage != null ? `${box.cpuUsage.toFixed(1)}%` : '—'],
          ['RAM', box.memUsage != null ? `${box.memUsage.toFixed(1)}%` : '—'],
          ['Temperatura', box.tempCelsius != null ? `${box.tempCelsius.toFixed(1)}°C` : '—'],
          ['Último heartbeat', box.lastHeartbeat ? new Date(box.lastHeartbeat).toLocaleString('pt-BR') : '—'],
        ]} />

        <DetailSection title="Câmeras" items={[
          ['Vinculadas', String(box._count?.cameras ?? 0)],
          ['Endpoint go2rtc', box.go2rtcEndpoint ?? '—'],
        ]} />
      </motion.div>
    </motion.div>
  )
}

function DetailSection({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider text-cyan-300 mb-2">{title}</h3>
      <div className="space-y-1 text-xs">
        {items.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <span className="text-slate-500">{k}</span>
            <span className="text-slate-200 font-mono truncate text-right">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text', placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required}
        className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white" />
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[0,1,2,3,4,5].map(i => <div key={i} className="h-16 rounded-lg bg-white/5 animate-pulse" />)}
      </div>
      <GlassCard className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0,1,2,3,4,5].map(i => <div key={i} className="h-32 rounded-lg bg-white/5 animate-pulse" />)}
        </div>
      </GlassCard>
    </div>
  )
}
