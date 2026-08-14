/**
 * SynopticMapPage — Mapa Sinótico (Planta Baixa Indoor)
 *
 * Modos:
 *   - list:   lista de plantas cadastradas + botão nova planta
 *   - setup:  upload de imagem/PDF + drag de câmeras na planta (edição)
 *   - view:   visualização ao vivo — ícones das câmeras fixos, clique abre player
 */
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Upload, Camera, Eye, Settings2, Trash2, X, Check,
  Loader2, AlertCircle, MapPin, Move, ChevronLeft, Video,
} from 'lucide-react'
import {
  useFloorPlans, useFloorPlan, createFloorPlan, updateFloorPlan,
  deleteFloorPlan, saveFloorPlanCameras, uploadFloorPlanImage,
  useCameras, useSites, formatApiError, BASE_URL,
  type FloorPlan, type FloorPlanCamera,
} from '../api/client'
import { LivePlayer } from '../components/player/LivePlayer'
import { confirm } from '../components/ConfirmDialog'

// ── Types ──────────────────────────────────────────────────────────────────

type CameraPin = {
  cameraId: string
  xPct:     number
  yPct:     number
  label:    string | null
}

// ── Page ──────────────────────────────────────────────────────────────────

export function SynopticMapPage() {
  const [view, setView] = useState<'list' | 'setup' | 'viewer'>('list')
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null)

  function openSetup(id: string | null, siteId?: string | null) {
    setActivePlanId(id)
    if (siteId !== undefined) setActiveSiteId(siteId)
    setView('setup')
  }

  function openViewer(id: string) {
    setActivePlanId(id)
    setView('viewer')
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-space-950 p-4 md:p-6">
      <AnimatePresence mode="wait">
        {view === 'list' && (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <FloorPlanList
              onNew={(siteId) => openSetup(null, siteId)}
              onEdit={(id, siteId) => openSetup(id, siteId)}
              onView={openViewer}
            />
          </motion.div>
        )}
        {view === 'setup' && (
          <motion.div key="setup" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <FloorPlanSetup
              planId={activePlanId}
              defaultSiteId={activeSiteId}
              onBack={() => setView('list')}
              onSaved={(id) => { setActivePlanId(id); setView('viewer') }}
            />
          </motion.div>
        )}
        {view === 'viewer' && activePlanId && (
          <motion.div key="viewer" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <FloorPlanViewer
              planId={activePlanId}
              onBack={() => setView('list')}
              onEdit={() => openSetup(activePlanId)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── List ──────────────────────────────────────────────────────────────────

function FloorPlanList({
  onNew, onEdit, onView,
}: {
  onNew: (siteId: string | null) => void
  onEdit: (id: string, siteId: string | null) => void
  onView: (id: string) => void
}) {
  const { data: sitesData, isLoading: sitesLoading } = useSites()
  const sites = sitesData?.sites ?? []
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)

  const { data, isLoading, mutate } = useFloorPlans(selectedSiteId)
  const plans = data?.floorPlans ?? []
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Excluir esta planta?',
      destructive: true,
      confirmLabel: 'Excluir',
    })
    if (!ok) return
    setDeleting(id)
    try { await deleteFloorPlan(id); mutate() }
    finally { setDeleting(null) }
  }

  const canAddMore = plans.length < 5

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <MapPin className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            Mapas Sinóticos
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Plantas baixas indoor com câmeras posicionadas · máx. 5 por site</p>
        </div>
        {canAddMore && (
          <button
            onClick={() => onNew(selectedSiteId)}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-white text-sm font-semibold flex items-center gap-2 shadow-lg hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" /> Nova Planta
          </button>
        )}
      </div>

      {/* Site picker */}
      {!sitesLoading && sites.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-5">
          <button
            onClick={() => setSelectedSiteId(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${
              selectedSiteId === null
                ? 'bg-cyan-500 border-cyan-500 text-white'
                : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-cyan-400'
            }`}
          >
            Todos os sites
          </button>
          {sites.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedSiteId(s.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${
                selectedSiteId === s.id
                  ? 'bg-cyan-500 border-cyan-500 text-white'
                  : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-cyan-400'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {!canAddMore && selectedSiteId && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Limite de 5 mapas atingido para este site. Exclua um para criar outro.
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando…
        </div>
      )}

      {!isLoading && plans.length === 0 && (
        <div className="text-center py-20">
          <MapPin className="w-12 h-12 text-slate-600 dark:text-slate-300 dark:text-slate-600 mx-auto mb-4" />
          <p className="text-slate-500 text-sm">Nenhuma planta cadastrada ainda.</p>
          <button onClick={() => onNew(selectedSiteId)} className="mt-4 px-4 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 text-sm font-medium hover:bg-cyan-500/25 transition">
            Criar primeira planta
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans.map(plan => (
          <div key={plan.id} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] overflow-hidden shadow-sm hover:shadow-md transition group">
            {/* Preview */}
            <div className="relative h-40 bg-slate-100 dark:bg-white/5 overflow-hidden">
              {plan.imageUrl ? (
                <img
                  src={plan.imageUrl.startsWith('/') ? `${BASE_URL}${plan.imageUrl}` : plan.imageUrl}
                  alt={plan.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <MapPin className="w-10 h-10" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <span className="absolute bottom-2 left-3 text-slate-900 dark:text-white text-xs font-semibold">
                {plan._count?.cameras ?? 0} câmera{(plan._count?.cameras ?? 0) !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Info */}
            <div className="p-4">
              <h3 className="font-semibold text-slate-900 dark:text-white text-sm truncate">{plan.name}</h3>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => onView(plan.id)}
                  className="flex-1 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400 text-xs font-medium flex items-center justify-center gap-1 hover:bg-cyan-500/20 transition"
                >
                  <Eye className="w-3.5 h-3.5" /> Ver
                </button>
                <button
                  onClick={() => onEdit(plan.id, plan.siteId ?? null)}
                  className="flex-1 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-xs font-medium flex items-center justify-center gap-1 hover:bg-slate-200 dark:hover:bg-slate-100 dark:bg-white/10 transition"
                >
                  <Settings2 className="w-3.5 h-3.5" /> Editar
                </button>
                <button
                  onClick={() => handleDelete(plan.id)}
                  disabled={deleting === plan.id}
                  className="py-1.5 px-2.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-500 text-xs hover:bg-rose-100 dark:hover:bg-rose-500/20 transition"
                >
                  {deleting === plan.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Setup ─────────────────────────────────────────────────────────────────

function FloorPlanSetup({
  planId, defaultSiteId, onBack, onSaved,
}: {
  planId: string | null
  defaultSiteId: string | null
  onBack: () => void
  onSaved: (id: string) => void
}) {
  const { data: existing, mutate } = useFloorPlan(planId)
  const { data: sitesData } = useSites()
  const sites = sitesData?.sites ?? []
  const [siteId, setSiteId] = useState<string | null>(defaultSiteId)

  // Camera filter by site
  const { data: camerasData } = useCameras(siteId ? { siteId: siteId, limit: '200' } : { limit: '200' })
  const allCameras: Array<{ id: string; name: string; status: string }> = camerasData?.cameras ?? []

  const [name, setName] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imageNaturalW, setImageNaturalW] = useState<number | null>(null)
  const [imageNaturalH, setImageNaturalH] = useState<number | null>(null)
  const [pins, setPins] = useState<CameraPin[]>([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draggingCameraId, setDraggingCameraId] = useState<string | null>(null)
  const [_dragOverPin, setDragOverPin] = useState<string | null>(null)
  const imgContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Inicializa com planta existente
  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setImageUrl(existing.imageUrl)
      if (existing.siteId)      setSiteId(existing.siteId)
      if (existing.imageWidth)  setImageNaturalW(existing.imageWidth)
      if (existing.imageHeight) setImageNaturalH(existing.imageHeight)
      if (existing.cameras) {
        setPins(existing.cameras.map(c => ({
          cameraId: c.cameraId,
          xPct:     c.xPct,
          yPct:     c.yPct,
          label:    c.label,
        })))
      }
    }
  }, [existing])

  // ── Upload de arquivo ──

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    try {
      let blob: Blob = file
      let filename = file.name

      // PDF: renderiza primeira página como PNG via pdf.js (dynamic import)
      if (file.type === 'application/pdf') {
        blob = await renderPdfToBlob(file)
        filename = file.name.replace(/\.pdf$/i, '.png')
      }

      const { imageUrl: url, width, height } = await uploadFloorPlanImage(blob, filename)
      setImageUrl(url)
      if (width)  setImageNaturalW(width)
      if (height) setImageNaturalH(height)
    } catch (e: any) {
      setError(formatApiError(e))
    } finally {
      setUploading(false)
    }
  }

  // ── Move pin existente dentro da planta ──

  function handlePinDragStart(e: React.DragEvent<HTMLDivElement>, cameraId: string) {
    e.stopPropagation()
    setDragOverPin(cameraId)
    e.dataTransfer.setData('movingPin', cameraId)
  }

  function handleImageDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  function handleImageDropAll(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const movingPin = e.dataTransfer.getData('movingPin')
    const camId     = movingPin || e.dataTransfer.getData('cameraId')
    if (!camId || !imgContainerRef.current) return

    const rect = imgContainerRef.current.getBoundingClientRect()
    const xPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width)  * 100))
    const yPct = Math.max(0, Math.min(100, ((e.clientY - rect.top)  / rect.height) * 100))

    setPins(prev => {
      const exists = prev.find(p => p.cameraId === camId)
      if (exists) return prev.map(p => p.cameraId === camId ? { ...p, xPct, yPct } : p)
      const cam = allCameras.find(c => c.id === camId)
      return [...prev, { cameraId: camId, xPct, yPct, label: cam?.name ?? null }]
    })
    setDragOverPin(null)
  }

  function removePin(cameraId: string) {
    setPins(prev => prev.filter(p => p.cameraId !== cameraId))
  }

  // ── Salvar ──

  async function handleSave() {
    if (!name.trim()) { setError('Nome é obrigatório'); return }
    if (!imageUrl)    { setError('Faça upload da planta primeiro'); return }
    setSaving(true)
    setError(null)
    try {
      let plan: FloorPlan
      if (planId) {
        plan = await updateFloorPlan(planId, {
          name: name.trim(),
          imageUrl,
          siteId:      siteId ?? undefined,
          imageWidth:  imageNaturalW ?? undefined,
          imageHeight: imageNaturalH ?? undefined,
        })
      } else {
        plan = await createFloorPlan({
          name: name.trim(),
          imageUrl,
          siteId:      siteId ?? undefined,
          imageWidth:  imageNaturalW ?? undefined,
          imageHeight: imageNaturalH ?? undefined,
        })
      }
      await saveFloorPlanCameras(plan.id, pins.map(p => ({
        cameraId: p.cameraId,
        xPct:     p.xPct,
        yPct:     p.yPct,
        label:    p.label ?? undefined,
      })))
      mutate()
      onSaved(plan.id)
    } catch (e: any) {
      setError(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  const pinnedIds = new Set(pins.map(p => p.cameraId))
  const unpinnedCameras = allCameras.filter(c => !pinnedIds.has(c.id))

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-slate-400">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            {planId ? 'Editar Planta' : 'Nova Planta'}
          </h1>
          <p className="text-xs text-slate-500">Arraste câmeras sobre a imagem para posicioná-las</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !imageUrl || !name.trim()}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Salvar
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Nome + Site */}
      <div className="flex gap-4 flex-wrap mb-4">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Nome da Planta *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Piso 1 — Ala Norte"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
          />
        </div>
        {sites.length > 0 && (
          <div className="w-64">
            <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Site</label>
            <select
              value={siteId ?? ''}
              onChange={e => setSiteId(e.target.value || null)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="">— Sem site —</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="flex gap-4 flex-col lg:flex-row">
        {/* Canvas da planta */}
        <div className="flex-1 min-w-0">
          {!imageUrl ? (
            <DropZone onFile={handleFile} uploading={uploading} fileInputRef={fileInputRef} />
          ) : (
            <div
              ref={imgContainerRef}
              className="relative w-full rounded-xl overflow-hidden border-2 border-dashed border-cyan-400/40 bg-slate-100 dark:bg-white/5 cursor-crosshair select-none"
              onDrop={handleImageDropAll}
              onDragOver={handleImageDragOver}
              style={{ aspectRatio: imageNaturalW && imageNaturalH ? `${imageNaturalW}/${imageNaturalH}` : '16/9' }}
            >
              <img
                src={imageUrl.startsWith('/') ? `${BASE_URL}${imageUrl}` : imageUrl}
                alt="Planta"
                className="w-full h-full object-contain"
                onLoad={e => {
                  const img = e.currentTarget
                  if (!imageNaturalW) setImageNaturalW(img.naturalWidth)
                  if (!imageNaturalH) setImageNaturalH(img.naturalHeight)
                }}
              />

              {/* Pins das câmeras */}
              {pins.map(pin => {
                const cam = allCameras.find(c => c.id === pin.cameraId)
                return (
                  <div
                    key={pin.cameraId}
                    draggable
                    onDragStart={e => handlePinDragStart(e, pin.cameraId)}
                    style={{ left: `${pin.xPct}%`, top: `${pin.yPct}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 group z-10 cursor-grab active:cursor-grabbing"
                  >
                    <div className="relative flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-cyan-500 border-2 border-white shadow-lg flex items-center justify-center">
                        <Camera className="w-4 h-4 text-slate-900 dark:text-white" />
                      </div>
                      <span className="mt-1 text-[10px] font-semibold bg-black/70 text-slate-900 dark:text-white px-1.5 py-0.5 rounded whitespace-nowrap max-w-[100px] truncate">
                        {pin.label ?? cam?.name ?? pin.cameraId.slice(0, 6)}
                      </span>
                      <button
                        onClick={() => removePin(pin.cameraId)}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                )
              })}

              {/* Overlay "trocar imagem" */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] bg-black/50 text-slate-900 dark:text-white hover:bg-black/70 flex items-center gap-1"
              >
                <Upload className="w-3 h-3" /> Trocar
              </button>
              <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          )}
          {imageUrl && (
            <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1">
              <Move className="w-3.5 h-3.5" /> Arraste as câmeras do painel direito ou reposicione arrastando os pins
            </p>
          )}
        </div>

        {/* Painel lateral de câmeras */}
        <div className="w-full lg:w-64 shrink-0">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-1">
            <Camera className="w-3.5 h-3.5" /> Câmeras disponíveis
          </p>
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {unpinnedCameras.length === 0 && allCameras.length > 0 && (
              <p className="text-xs text-slate-400 text-center py-4">Todas as câmeras já estão na planta ✓</p>
            )}
            {allCameras.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">Nenhuma câmera cadastrada</p>
            )}
            {unpinnedCameras.map(cam => (
              <div
                key={cam.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('cameraId', cam.id)
                  setDraggingCameraId(cam.id)
                }}
                onDragEnd={() => setDraggingCameraId(null)}
                className={`flex items-center gap-2 p-2 rounded-lg border cursor-grab active:cursor-grabbing select-none transition ${
                  draggingCameraId === cam.id
                    ? 'opacity-50 border-cyan-400 bg-cyan-50 dark:bg-cyan-500/10'
                    : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-cyan-300 dark:hover:border-cyan-500/40'
                }`}
              >
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center shrink-0">
                  <Camera className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                </div>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{cam.name}</span>
              </div>
            ))}
          </div>

          {pins.length > 0 && (
            <>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mt-4 mb-2">Na planta ({pins.length})</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {pins.map(pin => {
                  const cam = allCameras.find(c => c.id === pin.cameraId)
                  return (
                    <div key={pin.cameraId} className="flex items-center gap-2 p-2 rounded-lg border border-cyan-200 dark:border-cyan-500/20 bg-cyan-50/50 dark:bg-cyan-500/5">
                      <Camera className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                      <span className="text-xs text-slate-700 dark:text-slate-300 truncate flex-1">{pin.label ?? cam?.name}</span>
                      <button onClick={() => removePin(pin.cameraId)} className="text-slate-400 hover:text-rose-500 transition">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── DropZone ──────────────────────────────────────────────────────────────

function DropZone({
  onFile, uploading, fileInputRef,
}: {
  onFile: (f: File) => void
  uploading: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onClick={() => fileInputRef.current?.click()}
      className={`relative w-full rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition select-none`
        + (dragOver ? ' border-cyan-400 bg-cyan-50 dark:bg-cyan-500/10' : ' border-slate-300 dark:border-white/20 bg-white dark:bg-white/[0.02] hover:border-cyan-400 hover:bg-cyan-50/50 dark:hover:bg-cyan-500/5')}
      style={{ minHeight: 320 }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/bmp,image/gif,application/pdf"
        className="hidden"
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      {uploading ? (
        <div className="flex flex-col items-center gap-3 text-cyan-500">
          <Loader2 className="w-10 h-10 animate-spin" />
          <p className="text-sm font-medium">Enviando imagem…</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
          <Upload className="w-12 h-12" />
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Arraste ou clique para fazer upload</p>
            <p className="text-xs mt-1">JPEG · PNG · BMP · GIF · PDF (primeira página)</p>
            <p className="text-xs text-slate-400 mt-0.5">Máximo 20 MB</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Viewer ────────────────────────────────────────────────────────────────

function FloorPlanViewer({
  planId, onBack, onEdit,
}: {
  planId: string
  onBack: () => void
  onEdit: () => void
}) {
  const { data: plan, isLoading } = useFloorPlan(planId)
  const [activeCamera, setActiveCamera] = useState<FloorPlanCamera | null>(null)
  const [imageNaturalW, setImageNaturalW] = useState<number | null>(null)
  const [imageNaturalH, setImageNaturalH] = useState<number | null>(null)

  if (isLoading || !plan) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando planta…
      </div>
    )
  }

  const cameras = plan.cameras ?? []

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-slate-400">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">{plan.name}</h1>
          <p className="text-xs text-slate-500">{cameras.length} câmera{cameras.length !== 1 ? 's' : ''} posicionada{cameras.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={onEdit}
          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 text-sm flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5"
        >
          <Settings2 className="w-4 h-4" /> Editar layout
        </button>
      </div>

      {/* Mapa */}
      <div
        className="relative w-full rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 shadow-lg"
        style={{ aspectRatio: imageNaturalW && imageNaturalH ? `${imageNaturalW}/${imageNaturalH}` : '16/9' }}
      >
        <img
          src={plan.imageUrl.startsWith('/') ? `${BASE_URL}${plan.imageUrl}` : plan.imageUrl}
          alt={plan.name}
          className="w-full h-full object-contain"
          onLoad={e => {
            const img = e.currentTarget
            setImageNaturalW(img.naturalWidth)
            setImageNaturalH(img.naturalHeight)
          }}
        />

        {cameras.map(fc => (
          <CameraMarker
            key={fc.id}
            fc={fc}
            onClick={() => setActiveCamera(fc)}
          />
        ))}
      </div>

      {/* Modal do player ao vivo */}
      <AnimatePresence>
        {activeCamera && (
          <LiveModal camera={activeCamera} onClose={() => setActiveCamera(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Camera Marker ─────────────────────────────────────────────────────────

function CameraMarker({ fc, onClick }: { fc: FloorPlanCamera; onClick: () => void }) {
  const online = fc.camera.status === 'ONLINE'
  const [hovered, setHovered] = useState(false)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)

  // Snapshot poll a cada 5s enquanto hover ativo
  const [snapshotKey, setSnapshotKey] = useState(0)
  useEffect(() => {
    if (!hovered) return
    const t = setInterval(() => setSnapshotKey(k => k + 1), 5000)
    return () => clearInterval(t)
  }, [hovered])

  function handleEnter(e: React.MouseEvent) {
    setHovered(true)
    setHoverPos({ x: e.clientX, y: e.clientY })
  }
  function handleMove(e: React.MouseEvent) {
    if (hovered) setHoverPos({ x: e.clientX, y: e.clientY })
  }
  function handleLeave() {
    setHovered(false)
    setHoverPos(null)
  }

  return (
    <>
      <button
        onClick={onClick}
        onMouseEnter={handleEnter}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={{ left: `${fc.xPct}%`, top: `${fc.yPct}%` }}
        className="absolute -translate-x-1/2 -translate-y-1/2 group z-10 focus:outline-none"
      >
        <div className="relative flex flex-col items-center">
          {online && (
            <span className="absolute inset-0 rounded-full bg-cyan-400 opacity-30 animate-ping scale-150" />
          )}
          <div className={`w-9 h-9 rounded-full border-2 border-white shadow-lg flex items-center justify-center transition group-hover:scale-110 ${
            online ? 'bg-cyan-500' : 'bg-slate-400'
          }`}>
            <Camera className="w-4 h-4 text-slate-900 dark:text-white" />
          </div>
          <span className="mt-1 text-[10px] font-semibold bg-black/75 text-slate-900 dark:text-white px-1.5 py-0.5 rounded whitespace-nowrap max-w-[120px] truncate shadow">
            {fc.label ?? fc.camera.name}
          </span>
        </div>
      </button>

      {/* Hover preview tooltip — fixed na viewport para não cortar */}
      {hovered && hoverPos && (
        <CameraHoverPreview
          fc={fc}
          x={hoverPos.x}
          y={hoverPos.y}
          snapshotKey={snapshotKey}
        />
      )}
    </>
  )
}

function CameraHoverPreview({
  fc, x, y, snapshotKey,
}: {
  fc: FloorPlanCamera
  x: number
  y: number
  snapshotKey: number
}) {
  // Snapshot URL do backend com cache-buster pelo snapshotKey (refresh a cada 5s)
  const snapshotUrl = `${BASE_URL}/cameras/${fc.cameraId}/snapshot?_=${snapshotKey}`

  // Inverter direção do tooltip se estiver perto da borda direita/inferior
  const vw = typeof window !== 'undefined' ? window.innerWidth  : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const placeRight  = x + 280 < vw
  const placeBottom = y + 200 < vh

  const style: React.CSSProperties = {
    position: 'fixed',
    left: placeRight ? x + 16 : x - 280,
    top:  placeBottom ? y + 16 : y - 200,
    width: 260,
    pointerEvents: 'none',
    zIndex: 100,
  }

  const online = fc.camera.status === 'ONLINE'

  return (
    <div
      style={style}
      className="rounded-xl overflow-hidden shadow-2xl border border-white/20 bg-black/95 backdrop-blur-sm animate-in fade-in duration-150"
    >
      {/* Snapshot preview */}
      <div className="relative bg-white dark:bg-slate-900 aspect-video">
        <img
          src={snapshotUrl}
          alt={fc.camera.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none'
          }}
        />
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
          <span className="text-[10px] font-semibold text-slate-900 dark:text-white bg-black/60 px-1.5 py-0.5 rounded">
            {online ? 'AO VIVO' : 'OFFLINE'}
          </span>
        </div>
      </div>
      {/* Info da câmera */}
      <div className="p-2.5 space-y-0.5">
        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{fc.label ?? fc.camera.name}</p>
        <p className="text-[10px] text-slate-400 truncate">ID: {fc.cameraId.slice(0, 8)}</p>
        <p className="text-[10px] text-slate-500 mt-1">Clique para abrir o player</p>
      </div>
    </div>
  )
}

// ── Live Modal ────────────────────────────────────────────────────────────

function LiveModal({ camera, onClose }: { camera: FloorPlanCamera; onClose: () => void }) {
  const hasStream = !!(camera.camera.go2rtcStreamId || camera.camera.whepUrl)

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl bg-white dark:bg-space-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-white/10"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-cyan-500" />
            <h3 className="font-semibold text-slate-900 dark:text-white text-sm">
              {camera.label ?? camera.camera.name}
            </h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              camera.camera.status === 'ONLINE'
                ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400'
            }`}>
              {camera.camera.status}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Player */}
        <div className="bg-black aspect-video w-full">
          {hasStream ? (
            <LivePlayer cameraId={camera.cameraId} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
              {camera.camera.lastSnapshotUrl ? (
                <img
                  src={camera.camera.lastSnapshotUrl}
                  alt="Último snapshot"
                  className="max-h-full max-w-full object-contain opacity-70"
                />
              ) : (
                <>
                  <Camera className="w-12 h-12 opacity-30" />
                  <p className="text-sm">Sem stream ao vivo — edge node não conectado</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer link */}
        <div className="p-3 border-t border-slate-200 dark:border-white/10 flex justify-end">
          <a
            href={`/cameras/${camera.cameraId}`}
            className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
          >
            Ver detalhes da câmera →
          </a>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── PDF → PNG helper (usa pdf.js via CDN dynamic import) ─────────────────

async function renderPdfToBlob(pdfFile: File): Promise<Blob> {
  try {
    // Tenta carregar pdf.js da CDN via URL (evita dep de build-time)
    // Se falhar, devolve o arquivo original — backend aceita PDF direto
    const cdnUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs'
    const pdfjsLib = await import(/* @vite-ignore */ cdnUrl)
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs'

    const arrayBuffer = await pdfFile.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 2.0 })

    const canvas = document.createElement('canvas')
    canvas.width  = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise

    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas.toBlob falhou')), 'image/png')
    )
  } catch {
    // pdf.js não disponível — envia o arquivo original (o servidor pode armazenar o PDF)
    return pdfFile
  }
}
