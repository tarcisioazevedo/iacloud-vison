/**
 * AddCameraWizard — multi-step modal para criar câmera estilo Frigate.
 *
 * Etapas:
 *  1. Info básica (nome, site, local, tier, pipeline)
 *  2. Conexão RTSP + teste
 *  3. Detector / HwAccel
 *  4. Motion + Objects
 *  5. Recursos avançados (Face/LPR/Audio/Semantic/GenAI)
 *  6. Retenção (record/snapshot/review)
 *  7. Revisão + Criar
 */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, ChevronLeft, ChevronRight, Check, Camera, Video, Cpu, Zap,
  Database, CheckCircle2, AlertCircle, Loader2, Radar,
  Activity, Smile, FileBadge, Volume2, Search, Sparkles, Cloud,
  MapPin, Server, Wifi, FileSpreadsheet, QrCode, Network, Compass,
  Star,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  createCamera,
  useCameraPresets,
  useSites,
  formatApiError,
  probeCameraUrl,
} from '../../api/client'

const STEPS = [
  { id: 'mode',       label: 'Modo',        icon: Compass },
  { id: 'info',       label: 'Info',        icon: Camera },
  { id: 'connection', label: 'Conexão',     icon: Video },
  { id: 'detector',   label: 'Detector',    icon: Cpu },
  { id: 'motion',     label: 'Motion',      icon: Activity },
  { id: 'advanced',   label: 'Avançado',    icon: Sparkles },
  { id: 'retention',  label: 'Retenção',    icon: Database },
  { id: 'review',     label: 'Revisar',     icon: CheckCircle2 },
] as const

type StepId = typeof STEPS[number]['id']

interface Props { onClose: () => void }

export function AddCameraWizard({ onClose }: Props) {
  const [step, setStep] = useState<StepId>('mode')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    latencyMs?: number
    resolution?: string
    fps?: number
    codec?: string
    reason?: string
  } | null>(null)
  // Override explícito do operador quando ele quer prosseguir sem probe OK
  // (ex.: câmera ainda não instalada na obra, mas já cadastrando o registro).
  // Force o operador a clicar — não basta ignorar silenciosamente.
  const [skipProbeAck, setSkipProbeAck] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [createdCamera, setCreatedCamera] = useState<{
    cameraId?: string
    name: string
    rtmpIngestUrl?: string
    rtmpStreamKey?: string
  } | null>(null)
  const { data: presets } = useCameraPresets()
  const { data: sitesData, isLoading: sitesLoading } = useSites()
  const sites = sitesData?.sites ?? []

  const [form, setForm] = useState<any>({
    // Modo de deploy + protocolo (escolhidos no step 'mode' inicial)
    deploymentMode: 'EDGE_BOX',     // 'EDGE_BOX' | 'CLOUD_DIRECT'
    protocol:       'RTSP',          // 'ONVIF' | 'RTSP' | 'RTMP_PUSH' | 'SRT_PUSH' | 'P2P'
    // Info
    name:           '',
    siteId:         '',
    locationHint:   '',
    tier:           'SILVER',
    pipeline:       'EDGE_YOLO',
    // Ingest mode (derivado do protocol; mantido por retrocompat com backend)
    ingestMode:     'RTSP_PULL',  // 'RTSP_PULL' ou 'RTMP_PUSH'
    // RTSP (para RTSP_PULL)
    rtspUrl:        'rtsp://',
    rtspUsername:   '',
    rtspPassword:   '',
    rtmpPushUrl:    '',
    resolution:     '1920x1080',
    fps:            15,
    codec:          'h264',
    // Detector — backend espera UPPERCASE
    detectorType:   'CPU',
    detectorWidth:  320,
    detectorHeight: 320,
    detectorFps:    5,
    hwAccel:        'NONE',
    // Motion
    motionEnabled:      true,
    motionThreshold:    25,
    motionContourArea:  10,
    objectsTrack:       ['person'],
    // Advanced
    faceRecognitionEnabled: false,
    faceMinScore:           0.85,
    lprEnabled:             false,
    audioEnabled:           false,
    semanticSearchEnabled:  false,
    genaiEnabled:           false,
    // Localização
    zipCode:      '',
    streetName:   '',
    streetNumber: '',
    neighborhood: '',
    city:         '',
    state:        '',
    latitude:     null as number | null,
    longitude:    null as number | null,
    // Retention
    recordMode:           'MOTION',
    recordRetainDays:     7,
    recordAlertRetainDays:30,
    snapshotsEnabled:     true,
    snapshotRetainDays:   7,
  })

  // Auto-seleciona o site quando o tenant tem 1 só (UX comum no primeiro
  // cadastro). Backend faz o mesmo fallback se mandarmos vazio, mas pré-
  // selecionar deixa explícito na revisão final.
  useEffect(() => {
    if (!form.siteId && sites.length === 1) {
      setForm((f: any) => ({ ...f, siteId: sites[0].id }))
    }
  }, [sites, form.siteId])

  const stepIdx = STEPS.findIndex(s => s.id === step)
  const setField = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  /**
   * Sonda a URL RTSP/RTMP via POST /cameras/probe (Gap 3 fechado).
   *
   * Em DEV o backend retorna mock realista (sempre OK com 1080p25 h264).
   * Em PROD invoca ffprobe real com SSRF guard + timeout de 15s.
   *
   * O resultado popula o estado `testResult` que renderiza o badge ao lado
   * do botão. Se o probe trouxer resolução/fps/codec, atualizamos o form
   * automaticamente — economiza digitação na maioria dos casos onde o
   * backend já detectou os parâmetros corretos.
   */
  async function handleTest() {
    setTesting(true)
    setTestResult(null)

    const url = form.rtspUrl?.trim() ?? ''
    if (!url) {
      setTestResult({ success: false, reason: 'URL vazia' })
      setTesting(false)
      return
    }

    try {
      const probe = await probeCameraUrl(url)
      if (probe.success) {
        // Auto-preenche metadados se o backend descobriu algo melhor que o default
        setForm((f: any) => ({
          ...f,
          resolution: probe.resolution ?? f.resolution,
          fps:        probe.fps        ?? f.fps,
          codec:      probe.codec      ?? f.codec,
        }))
        setTestResult({
          success:    true,
          resolution: probe.resolution ?? form.resolution,
          fps:        probe.fps        ?? form.fps,
          codec:      probe.codec      ?? form.codec,
          latencyMs:  probe.latencyMs,
        })
      } else {
        setTestResult({
          success: false,
          reason:  probe.errorMessage
            ? `${probe.errorCode ?? 'ERRO'}: ${probe.errorMessage}`
            : 'Falha ao conectar',
        })
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        reason:  formatApiError(err),
      })
    } finally {
      setTesting(false)
    }
  }

  async function handleCepBlur() {
    const raw = form.zipCode.replace(/\D/g, '')
    if (raw.length !== 8) return
    setCepLoading(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${raw}/json/`)
      const data = await res.json()
      if (data.erro) return
      setForm((f: any) => ({
        ...f,
        streetName:   data.logradouro ?? f.streetName,
        neighborhood: data.bairro     ?? f.neighborhood,
        city:         data.localidade ?? f.city,
        state:        data.uf         ?? f.state,
        zipCode:      data.cep        ?? f.zipCode,
      }))
      // Geocode com Nominatim logo após preencher o endereço
      const parts = [data.logradouro, data.bairro, data.localidade, data.uf, 'Brasil'].filter(Boolean)
      setGeocoding(true)
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(parts.join(', '))}`,
          { headers: { 'Accept-Language': 'pt-BR' } }
        )
        const geoData = await geoRes.json()
        if (geoData[0]) {
          setForm((f: any) => ({
            ...f,
            latitude:  parseFloat(geoData[0].lat),
            longitude: parseFloat(geoData[0].lon),
          }))
        }
      } finally {
        setGeocoding(false)
      }
    } catch {
      // silencia — endereço é opcional
    } finally {
      setCepLoading(false)
    }
  }

  /**
   * Mapeia o estado do form para o payload exato que o backend POST /cameras
   * espera. Aqui acontecem as conversões críticas:
   *   - rtspUrl     → rtspMainUrl   (nome do schema Prisma)
   *   - locationHint→ location
   *   - enums lowercase → UPPERCASE (CPU, NONE, etc.)
   *   - siteId vazio é OMITIDO — backend faz auto-fill se 1 site só
   *   - priceMonthlyBrl é OMITIDO para tiers comerciais — pricing table
   *     resolve no backend (BRONZE 19.9, SILVER 49.9, GOLD 149.9, etc.)
   */
  async function handleCreate() {
    setSaving(true); setError(null)
    try {
      const payload: Record<string, unknown> = {
        // Identidade
        name:        form.name?.trim(),
        location:    form.locationHint || undefined,
        // Tenant — siteId só vai se preenchido; senão backend resolve.
        ...(form.siteId ? { siteId: form.siteId } : {}),

        // Localização
        ...(form.zipCode   ? { zipCode:   form.zipCode }   : {}),
        ...(form.city      ? { city:      form.city }      : {}),
        ...(form.state     ? { state:     form.state }     : {}),
        ...(form.latitude  != null ? { latitude:  form.latitude }  : {}),
        ...(form.longitude != null ? { longitude: form.longitude } : {}),

        // Modo de ingestão (RTSP_PULL ou RTMP_PUSH)
        ingestMode: form.ingestMode,

        // Streams — só manda RTSP se for modo RTSP_PULL
        ...(form.ingestMode === 'RTSP_PULL' ? {
          rtspMainUrl:  form.rtspUrl,
          rtspUsername: form.rtspUsername || undefined,
          rtspPassword: form.rtspPassword || undefined,
        } : {}),
        resolution:   form.resolution || undefined,
        fps:          form.fps,
        codec:        form.codec,

        // Plano
        tier:     form.tier,
        pipeline: form.pipeline,
        // priceMonthlyBrl: omitido propositalmente — backend resolve.

        // Hardware (UPPERCASE conforme enum Prisma)
        hwAccel:        String(form.hwAccel ?? 'NONE').toUpperCase(),
        detectorType:   String(form.detectorType ?? 'CPU').toUpperCase(),
        detectorWidth:  form.detectorWidth,
        detectorHeight: form.detectorHeight,
        detectorFps:    form.detectorFps,

        // Motion
        motionEnabled:     form.motionEnabled,
        motionThreshold:   form.motionThreshold,
        motionContourArea: form.motionContourArea,
        objectsTrack:      form.objectsTrack,

        // Advanced toggles
        faceRecognitionEnabled: form.faceRecognitionEnabled,
        faceMinScore:           form.faceMinScore,
        lprEnabled:             form.lprEnabled,
        audioEnabled:           form.audioEnabled,
        semanticSearchEnabled:  form.semanticSearchEnabled,
        genaiEnabled:           form.genaiEnabled,

        // Retention
        recordEnabled:         form.recordMode !== 'DISABLED',
        recordMode:            form.recordMode,
        recordRetainDays:      form.recordRetainDays,
        recordAlertRetainDays: form.recordAlertRetainDays,
        snapshotsEnabled:      form.snapshotsEnabled,
        snapshotRetainDays:    form.snapshotRetainDays,
      }

      const result = await createCamera(payload)

      // Se for RTMP_PUSH, mostra a URL de ingestão antes de fechar
      if (form.ingestMode === 'RTMP_PUSH' && result.rtmpIngestUrl) {
        setCreatedCamera({
          cameraId: result.id,
          name: result.name,
          rtmpIngestUrl: result.rtmpIngestUrl,
          rtmpStreamKey: result.rtmpStreamKey,
        })
      } else {
        onClose()
      }
    } catch (e) {
      setError(formatApiError(e))
    }
    setSaving(false)
  }

  function next() {
    if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1].id)
  }
  function prev() {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1].id)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header + stepper */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-white/10">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Camera className="w-5 h-5 text-cyan-700 dark:text-cyan-400" /> Nova Câmera
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">Configuração Frigate-inspired com Vertex AI</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10 rounded-lg text-slate-500 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-900 dark:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]">
          <div className="flex items-center justify-between gap-2">
            {STEPS.map((s, idx) => {
              const isActive = s.id === step
              const isDone = idx < stepIdx
              return (
                <div key={s.id} className="flex-1 flex items-center">
                  <button onClick={() => idx <= stepIdx + 1 && setStep(s.id)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition ${
                      isActive ? 'bg-cyan-100 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/30' :
                      isDone   ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-600'
                    }`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isActive ? 'bg-cyan-500 text-white' : isDone ? 'bg-emerald-100 dark:bg-emerald-500/20' : 'bg-slate-100 dark:bg-white/5'
                    }`}>
                      {isDone ? <Check className="w-3 h-3" /> : idx + 1}
                    </div>
                    <span className="text-[11px] font-semibold uppercase tracking-wide hidden md:inline">{s.label}</span>
                  </button>
                  {idx < STEPS.length - 1 && <div className={`flex-1 h-px mx-1 ${isDone ? 'bg-emerald-300 dark:bg-emerald-500/30' : 'bg-slate-200 dark:bg-white/10'}`} />}
                </div>
              )
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Tela de sucesso para RTMP Push */}
          {createdCamera ? (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Câmera Criada!</h3>
                <p className="text-sm text-slate-400">Configure seu app/dispositivo com os dados abaixo</p>
              </div>

              <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-5 space-y-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">URL de Ingestão RTMP</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-slate-200 dark:border-white/10 text-violet-300 font-mono text-sm break-all select-all">
                      {createdCamera.rtmpIngestUrl}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(createdCamera.rtmpIngestUrl || '')}
                      className="px-3 py-2 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-xs font-medium hover:bg-violet-500/30"
                    >
                      Copiar
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Stream Key</p>
                  <code className="block px-3 py-2 rounded-lg bg-black/30 border border-slate-200 dark:border-white/10 text-amber-300 font-mono text-sm select-all">
                    {createdCamera.rtmpStreamKey}
                  </code>
                </div>

              </div>

              {/* Polling do primeiro frame — operador acompanha em tempo real */}
              {createdCamera.cameraId && (
                <FirstFramePoll cameraId={createdCamera.cameraId} streamKey={createdCamera.rtmpStreamKey} />
              )}

              {/* Tutorial multimarca — abas com instruções passo-a-passo */}
              <BrandTutorialTabs
                rtmpUrl={createdCamera.rtmpIngestUrl}
                streamKey={createdCamera.rtmpStreamKey}
              />

              <div className="flex justify-center">
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-white text-sm font-semibold shadow-cyan-glow"
                >
                  Fechar
                </button>
              </div>
            </div>
          ) : (
          <AnimatePresence mode="wait">
            <motion.div key={step}
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}>

              {step === 'mode' && (
                <div className="space-y-4">
                  {sites.length === 0 && !sitesLoading && (
                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1 text-sm">
                        <p className="font-semibold text-amber-800 dark:text-amber-200">
                          Cadastre um site primeiro
                        </p>
                        <p className="text-xs text-amber-700/80 dark:text-amber-200/70 mt-1">
                          Toda câmera (Box Cam ou Direct Cam) precisa viver sob um site físico.
                          Cadastre um site no cliente e volte aqui.
                        </p>
                        <button
                          type="button"
                          onClick={() => window.open('/sites?new=1', '_blank', 'noopener')}
                          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white dark:text-slate-900 text-xs font-bold"
                        >
                          <MapPin className="w-3.5 h-3.5" /> Criar site agora ↗
                        </button>
                      </div>
                    </div>
                  )}
                  <div className={sites.length === 0 && !sitesLoading ? 'opacity-40 pointer-events-none' : ''}>
                    <ModeStep form={form} setForm={setForm} setField={setField}
                      onAdvance={() => setStep('info')} />
                  </div>
                </div>
              )}

              {step === 'info' && (
                <div className="space-y-4 max-w-2xl">
                  <Field label="Nome *">
                    <input value={form.name} onChange={e => setField('name', e.target.value)}
                      placeholder="Ex: Entrada Principal" className={inputCls} />
                  </Field>
                  <Field label="Local (hint)">
                    <input value={form.locationHint} onChange={e => setField('locationHint', e.target.value)}
                      placeholder="Ex: Piso 1 · Lobby Norte" className={inputCls} />
                  </Field>

                  {/* Dropdown de SITE — popula via GET /sites com filtro
                      multi-tenant. Mostra estado vazio com CTA quando o
                      tenant ainda não cadastrou nenhum. */}
                  <Field label="Site *">
                    {sitesLoading ? (
                      <div className={inputCls + ' flex items-center gap-2 text-slate-500 dark:text-slate-500'}>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Carregando sites…
                      </div>
                    ) : sites.length === 0 ? (
                      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div className="flex-1 text-xs text-amber-800 dark:text-amber-200">
                          <p className="font-semibold mb-1">Nenhum site cadastrado</p>
                          <p className="text-amber-700/80 dark:text-amber-200/70">
                            Antes de adicionar câmeras, cadastre um site (loja, prédio, agência) na aba <span className="font-mono">Sites</span>.
                          </p>
                          <button
                            type="button"
                            onClick={() => window.open('/sites?new=1', '_blank', 'noopener')}
                            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 text-white dark:text-slate-900 text-[11px] font-bold"
                          >
                            <MapPin className="w-3 h-3" /> Criar site agora ↗
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <select
                          value={form.siteId}
                          onChange={e => setField('siteId', e.target.value)}
                          className={inputCls}
                        >
                          {sites.length > 1 && <option value="">— Selecione um site —</option>}
                          {sites.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name} — {s.clienteFinal.name}
                              {s._count.cameras > 0 ? ` (${s._count.cameras} câm.)` : ''}
                            </option>
                          ))}
                        </select>
                        {sites.length === 1 && (
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            Único site disponível — selecionado automaticamente.
                          </p>
                        )}
                      </>
                    )}
                  </Field>

                  {/* ── Localização ── */}
                  <div className="border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3 bg-slate-50 dark:bg-white/[0.02]">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" /> Localização (opcional — para o mapa)
                    </p>

                    {/* CEP + Número — únicos campos visíveis. Logradouro/Cidade/UF
                        ficam ocultos: handleCepBlur popula esses campos no form
                        state (via ViaCEP) e o geocoding gera lat/lng pra mapa.
                        Campos extras eram ruído visual — usuário só precisa
                        digitar CEP + Número e o resto é auto. */}
                    <div className="flex gap-3 items-end">
                      <div className="w-40">
                        <Field label="CEP">
                          <div className="relative">
                            <input
                              value={form.zipCode}
                              onChange={e => setField('zipCode', e.target.value)}
                              onBlur={handleCepBlur}
                              placeholder="00000-000"
                              maxLength={9}
                              className={inputCls}
                            />
                            {(cepLoading || geocoding) && (
                              <Loader2 className="absolute right-2 top-2.5 w-4 h-4 animate-spin text-cyan-500" />
                            )}
                          </div>
                        </Field>
                      </div>
                      <div className="flex-1">
                        <Field label="Número">
                          <input
                            value={form.streetNumber}
                            onChange={e => setField('streetNumber', e.target.value)}
                            placeholder="Ex: 123"
                            className={inputCls}
                          />
                        </Field>
                      </div>
                    </div>

                    {/* Endereço resolvido (read-only, só pra confirmar visualmente) */}
                    {form.streetName && form.city ? (
                      <div className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300 bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2">
                        <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-cyan-400" />
                        <span>
                          {form.streetName}
                          {form.streetNumber ? `, ${form.streetNumber}` : ''}
                          {form.city ? ` — ${form.city}` : ''}
                          {form.state ? `/${form.state}` : ''}
                        </span>
                      </div>
                    ) : null}

                    {/* Coordenadas — exibição após geocoding */}
                    {form.latitude != null && form.longitude != null ? (
                      <div className="flex items-center gap-2 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        Coordenada obtida: {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}
                      </div>
                    ) : geocoding ? (
                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Geocodificando endereço…
                      </div>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Tier">
                      <select value={form.tier} onChange={e => setField('tier', e.target.value)} className={inputCls}>
                        {['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Pipeline">
                      <select value={form.pipeline} onChange={e => setField('pipeline', e.target.value)} className={inputCls}>
                        <option value="EDGE_YOLO">EDGE_YOLO (edge-only, sem custo cloud)</option>
                        <option value="EDGE_HYBRID">EDGE_HYBRID (edge + Cloud Vision)</option>
                        <option value="VERTEX_STREAMING">VERTEX_STREAMING (cloud, premium)</option>
                      </select>
                    </Field>
                  </div>
                </div>
              )}

              {step === 'connection' && (
                <div className="space-y-4 max-w-2xl">
                  {/* Seletor de modo de ingestão */}
                  <Field label="Modo de Ingestão">
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setField('ingestMode', 'RTSP_PULL')}
                        className={`p-4 rounded-lg border text-left transition ${
                          form.ingestMode === 'RTSP_PULL'
                            ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                            : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 hover:border-white/20'
                        }`}
                      >
                        <p className="font-semibold text-sm">RTSP Pull</p>
                        <p className="text-[10px] mt-1 opacity-70">
                          O sistema puxa o stream da câmera via RTSP. Requer IP acessível ou edge node.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setField('ingestMode', 'RTMP_PUSH')}
                        className={`p-4 rounded-lg border text-left transition ${
                          form.ingestMode === 'RTMP_PUSH'
                            ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                            : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 hover:border-white/20'
                        }`}
                      >
                        <p className="font-semibold text-sm">RTMP Push</p>
                        <p className="text-[10px] mt-1 opacity-70">
                          A câmera/app empurra RTMP para o servidor. Ideal para Larix, celulares, câmeras atrás de NAT.
                        </p>
                      </button>
                    </div>
                  </Field>

                  {form.ingestMode === 'RTSP_PULL' ? (
                    <>
                      <Field label="URL RTSP *">
                        <input
                          value={form.rtspUrl}
                          onChange={e => {
                            setField('rtspUrl', e.target.value)
                            if (testResult) setTestResult(null)
                            if (skipProbeAck) setSkipProbeAck(false)
                          }}
                          placeholder="rtsp://user:pass@ip:554/stream"
                          className={inputCls + ' font-mono text-xs'}
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-4">
                        <Field label="Usuário"><input value={form.rtspUsername} onChange={e => setField('rtspUsername', e.target.value)} className={inputCls} /></Field>
                        <Field label="Senha"><input type="password" value={form.rtspPassword} onChange={e => setField('rtspPassword', e.target.value)} className={inputCls} /></Field>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <Field label="Resolução"><input value={form.resolution} onChange={e => setField('resolution', e.target.value)} className={inputCls} /></Field>
                        <Field label="FPS"><input type="number" value={form.fps} onChange={e => setField('fps', +e.target.value)} className={inputCls} /></Field>
                        <Field label="Codec">
                          <select value={form.codec} onChange={e => setField('codec', e.target.value)} className={inputCls}>
                            <option>h264</option><option>h265</option><option>mjpeg</option>
                          </select>
                        </Field>
                      </div>
                      <div className="flex items-center gap-3 pt-2">
                        <button onClick={handleTest} disabled={testing || !form.rtspUrl}
                          className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-medium flex items-center gap-2 hover:bg-cyan-500/30 disabled:opacity-50">
                          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                          Testar Conexão
                        </button>
                        {testResult && (
                          <div className={`px-3 py-1.5 rounded-lg text-xs font-mono flex items-center gap-2 ${
                            testResult.success ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                               : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'}`}>
                            {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                            {testResult.success
                              ? `URL válida · ${testResult.resolution} @ ${testResult.fps}fps · ${testResult.codec}`
                              : (testResult.reason ?? 'URL inválida')}
                          </div>
                        )}
                      </div>

                      {!testResult?.success && (
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <div className="flex-1 text-xs text-amber-200 leading-relaxed">
                            <p className="font-semibold mb-1">Teste de conexão é recomendado antes de prosseguir.</p>
                            <label className="flex items-center gap-2 cursor-pointer text-amber-300 hover:text-amber-200 select-none">
                              <input
                                type="checkbox"
                                checked={skipProbeAck}
                                onChange={e => setSkipProbeAck(e.target.checked)}
                                className="w-4 h-4 accent-amber-400"
                              />
                              <span>Câmera ainda não está instalada — vou prosseguir mesmo assim.</span>
                            </label>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="p-4 rounded-lg bg-violet-500/10 border border-violet-500/30">
                        <p className="text-sm font-semibold text-violet-300 mb-2">Câmera RTMP Push</p>
                        <p className="text-xs text-slate-400 mb-3">
                          Após criar a câmera, você receberá uma URL e chave de stream para configurar no seu app/dispositivo (ex: Larix Broadcaster, OBS, câmeras IP com RTMP).
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <Cloud className="w-4 h-4" />
                          <span>Servidor: <code className="text-violet-300">rtmp://app.iacloud.com.br:1935/&#123;key&#125;/live/</code></span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <Field label="Resolução esperada"><input value={form.resolution} onChange={e => setField('resolution', e.target.value)} className={inputCls} /></Field>
                        <Field label="FPS esperado"><input type="number" value={form.fps} onChange={e => setField('fps', +e.target.value)} className={inputCls} /></Field>
                        <Field label="Codec">
                          <select value={form.codec} onChange={e => setField('codec', e.target.value)} className={inputCls}>
                            <option>h264</option><option>h265</option>
                          </select>
                        </Field>
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === 'detector' && (
                <div className="space-y-4 max-w-2xl">
                  <p className="text-xs text-slate-500 mb-3">Configuração do detector de objetos (inspirado no Frigate).</p>
                  <Field label="Tipo de Detector">
                    <select value={form.detectorType} onChange={e => setField('detectorType', e.target.value)} className={inputCls}>
                      {(presets?.detectors ?? [
                        { value: 'cpu',          label: 'CPU (fallback)',           hint: 'Lento mas sempre disponível' },
                        { value: 'coral_usb',    label: 'Google Coral USB',         hint: 'Edge TPU — 15ms/infer' },
                        { value: 'coral_pci',    label: 'Google Coral PCIe',        hint: 'Edge TPU PCIe' },
                        { value: 'hailo8',       label: 'Hailo-8 / Hailo-8L',       hint: 'NPU de alta performance' },
                        { value: 'tensorrt',     label: 'NVIDIA TensorRT',          hint: 'GPU com tensor cores' },
                        { value: 'onnx',         label: 'ONNX Runtime',             hint: 'Cross-platform' },
                        { value: 'openvino',     label: 'Intel OpenVINO',           hint: 'CPU/iGPU Intel' },
                        { value: 'rknn',         label: 'Rockchip NPU',             hint: 'SoCs RK3588/RK3566' },
                        { value: 'ncnn',         label: 'NCNN (ARM)',               hint: 'Raspberry Pi otimizado' },
                      ]).map((d: any) => <option key={d.value} value={d.value}>{d.label} — {d.hint}</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="Width"><input type="number" value={form.detectorWidth} onChange={e => setField('detectorWidth', +e.target.value)} className={inputCls} /></Field>
                    <Field label="Height"><input type="number" value={form.detectorHeight} onChange={e => setField('detectorHeight', +e.target.value)} className={inputCls} /></Field>
                    <Field label="FPS"><input type="number" value={form.detectorFps} onChange={e => setField('detectorFps', +e.target.value)} className={inputCls} /></Field>
                  </div>
                  <Field label="Hardware Acceleration (FFmpeg)">
                    <select value={form.hwAccel} onChange={e => setField('hwAccel', e.target.value)} className={inputCls}>
                      {(presets?.hwAccel ?? [
                        { value: 'none',      label: 'Nenhum (CPU)' },
                        { value: 'vaapi',     label: 'VAAPI (Intel)' },
                        { value: 'qsv',       label: 'Intel QuickSync' },
                        { value: 'nvidia',    label: 'NVIDIA NVENC/NVDEC' },
                        { value: 'rpi',       label: 'Raspberry Pi 4/5' },
                        { value: 'rockchip',  label: 'Rockchip MPP' },
                      ]).map((h: any) => <option key={h.value} value={h.value}>{h.label}</option>)}
                    </select>
                  </Field>
                </div>
              )}

              {step === 'motion' && (
                <div className="space-y-4 max-w-2xl">
                  <ToggleRow label="Habilitar detecção de movimento" value={form.motionEnabled}
                    onChange={v => setField('motionEnabled', v)} icon={Radar} color="amber" />
                  {form.motionEnabled && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <Field label={`Threshold (${form.motionThreshold})`}>
                          <input type="range" min={1} max={255} value={form.motionThreshold}
                            onChange={e => setField('motionThreshold', +e.target.value)} className="w-full" />
                        </Field>
                        <Field label={`Contour Area (${form.motionContourArea})`}>
                          <input type="range" min={1} max={100} value={form.motionContourArea}
                            onChange={e => setField('motionContourArea', +e.target.value)} className="w-full" />
                        </Field>
                      </div>
                    </>
                  )}
                  <Field label="Objetos a rastrear">
                    <div className="flex flex-wrap gap-2">
                      {['person', 'car', 'motorcycle', 'bicycle', 'bus', 'truck', 'dog', 'cat', 'bird', 'package'].map(obj => {
                        const active = form.objectsTrack.includes(obj)
                        return (
                          <button key={obj} type="button"
                            onClick={() => setField('objectsTrack',
                              active ? form.objectsTrack.filter((o: string) => o !== obj) : [...form.objectsTrack, obj])}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                              active ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                     : 'bg-slate-50 dark:bg-white/5 text-slate-500 border border-slate-200 dark:border-white/10 hover:text-slate-900 dark:text-white'}`}>
                            {obj}
                          </button>
                        )
                      })}
                    </div>
                  </Field>
                </div>
              )}

              {step === 'advanced' && (
                <div className="space-y-3 max-w-2xl">
                  <p className="text-xs text-slate-500 mb-2">Recursos avançados inspirados no Frigate 0.14+ e Vertex AI.</p>
                  <ToggleRow label="Reconhecimento Facial (Vertex AI)" value={form.faceRecognitionEnabled}
                    onChange={v => setField('faceRecognitionEnabled', v)} icon={Smile} color="cyan"
                    desc="Embeddings multimodal via Vertex + biblioteca de identidades" />
                  {form.faceRecognitionEnabled && (
                    <div className="pl-10 pr-2">
                      <Field label={`Min score: ${form.faceMinScore}`}>
                        <input type="range" min={0.5} max={0.99} step={0.01} value={form.faceMinScore}
                          onChange={e => setField('faceMinScore', +e.target.value)} className="w-full" />
                      </Field>
                    </div>
                  )}
                  <ToggleRow label="LPR — License Plate Recognition" value={form.lprEnabled}
                    onChange={v => setField('lprEnabled', v)} icon={FileBadge} color="violet"
                    desc="OCR de placas + matching contra cadastro" />
                  <ToggleRow label="Detecção de Áudio" value={form.audioEnabled}
                    onChange={v => setField('audioEnabled', v)} icon={Volume2} color="rose"
                    desc="Vidro quebrando, sirene, alarme, latido, grito" />
                  <ToggleRow label="Semantic Search" value={form.semanticSearchEnabled}
                    onChange={v => setField('semanticSearchEnabled', v)} icon={Search} color="emerald"
                    desc="Busca por linguagem natural (Vertex multimodal)" />
                  <ToggleRow label="GenAI Descriptions" value={form.genaiEnabled}
                    onChange={v => setField('genaiEnabled', v)} icon={Sparkles} color="amber"
                    desc="Resumos automáticos de alertas via Gemini" />
                </div>
              )}

              {step === 'retention' && (
                <div className="space-y-4 max-w-2xl">
                  <Field label="Modo de gravação">
                    <select value={form.recordMode} onChange={e => setField('recordMode', e.target.value)} className={inputCls}>
                      <option value="DISABLED">Desativada</option>
                      <option value="MOTION">Só em motion</option>
                      <option value="ALL">Contínua (24/7)</option>
                      <option value="ACTIVE_OBJECTS">Em objetos ativos</option>
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Retenção padrão (dias)"><input type="number" value={form.recordRetainDays} onChange={e => setField('recordRetainDays', +e.target.value)} className={inputCls} /></Field>
                    <Field label="Retenção alertas (dias)"><input type="number" value={form.recordAlertRetainDays} onChange={e => setField('recordAlertRetainDays', +e.target.value)} className={inputCls} /></Field>
                  </div>
                  <ToggleRow label="Snapshots automáticos" value={form.snapshotsEnabled}
                    onChange={v => setField('snapshotsEnabled', v)} icon={Camera} color="cyan" />
                  {form.snapshotsEnabled && (
                    <div className="pl-10">
                      <Field label="Retenção snapshots (dias)">
                        <input type="number" value={form.snapshotRetainDays}
                          onChange={e => setField('snapshotRetainDays', +e.target.value)} className={inputCls} />
                      </Field>
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 flex gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    Eventos com dados pessoais (faces, placas) seguem TTL de 72h por LGPD independente destes valores.
                  </div>
                </div>
              )}

              {step === 'review' && (
                <div className="space-y-4 max-w-2xl">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Revisão Final</h3>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <ReviewGroup title="Info básica">
                      <Row k="Nome" v={form.name} />
                      <Row
                        k="Site"
                        v={
                          sites.find(s => s.id === form.siteId)?.name
                          ?? (sites.length === 0 ? '— sem sites —' : '— não selecionado —')
                        }
                      />
                      <Row k="Tier" v={form.tier} />
                      <Row k="Pipeline" v={form.pipeline} />
                    </ReviewGroup>
                    {(form.city || form.zipCode || form.latitude != null) && (
                      <ReviewGroup title="Localização">
                        {form.zipCode   && <Row k="CEP"    v={form.zipCode} />}
                        {form.streetName && <Row k="Rua"   v={`${form.streetName}${form.streetNumber ? ', ' + form.streetNumber : ''}`} />}
                        {form.city      && <Row k="Cidade" v={`${form.city}${form.state ? ' — ' + form.state : ''}`} />}
                        {form.latitude  != null && <Row k="Coord." v={`${form.latitude.toFixed(4)}, ${form.longitude?.toFixed(4)}`} />}
                      </ReviewGroup>
                    )}
                    <ReviewGroup title="Conexão">
                      <Row k="Modo" v={form.ingestMode === 'RTMP_PUSH' ? 'RTMP Push' : 'RTSP Pull'} />
                      {form.ingestMode === 'RTSP_PULL' ? (
                        <Row k="RTSP" v={form.rtspUrl.slice(0, 40) + (form.rtspUrl.length > 40 ? '…' : '')} />
                      ) : (
                        <Row k="Servidor" v="rtmp://app.iacloud.com.br:1935/{key}/live/" />
                      )}
                      <Row k="Res" v={`${form.resolution} @ ${form.fps}fps`} />
                      <Row k="Codec" v={form.codec} />
                    </ReviewGroup>
                    <ReviewGroup title="Detecção">
                      <Row k="Detector" v={form.detectorType} />
                      <Row k="HwAccel" v={form.hwAccel} />
                      <Row k="Motion" v={form.motionEnabled ? 'ON' : 'OFF'} />
                      <Row k="Objetos" v={form.objectsTrack.join(', ')} />
                    </ReviewGroup>
                    <ReviewGroup title="Avançado">
                      <Row k="Face" v={form.faceRecognitionEnabled ? '✓' : '—'} />
                      <Row k="LPR" v={form.lprEnabled ? '✓' : '—'} />
                      <Row k="Audio" v={form.audioEnabled ? '✓' : '—'} />
                      <Row k="Semantic" v={form.semanticSearchEnabled ? '✓' : '—'} />
                      <Row k="GenAI" v={form.genaiEnabled ? '✓' : '—'} />
                    </ReviewGroup>
                    <ReviewGroup title="Retenção">
                      <Row k="Modo" v={form.recordMode} />
                      <Row k="Dias padrão" v={form.recordRetainDays} />
                      <Row k="Dias alerta" v={form.recordAlertRetainDays} />
                    </ReviewGroup>
                  </div>
                  {error && (
                    <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                      {error}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          )}
        </div>

        {/* Footer — oculto quando mostra sucesso RTMP */}
        {!createdCamera && (
        <div className="flex items-center justify-between p-4 border-t border-slate-200 dark:border-white/10 bg-white/[0.02]">
          <button onClick={prev} disabled={stepIdx === 0}
            className="px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-900 dark:text-white hover:bg-slate-50 dark:bg-white/5 disabled:opacity-30 flex items-center gap-1">
            <ChevronLeft className="w-4 h-4" /> Voltar
          </button>
          <span className="text-[11px] text-slate-500">{stepIdx + 1} / {STEPS.length}</span>
          {step === 'review' ? (
            <button
              onClick={handleCreate}
              // Bloqueia se: sem nome, salvando, OU sem sites cadastrados
              // (backend rejeitaria com mensagem orientando a cadastrar site).
              disabled={saving || !form.name || sites.length === 0}
              title={sites.length === 0 ? 'Cadastre um site antes de criar câmeras' : undefined}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50 shadow-cyan-glow"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Criar Câmera
            </button>
          ) : (
            (() => {
              // Gate específico do step conexão para modo RTSP_PULL: só libera
              // "Próximo" se o probe foi OK OU se o operador deu ack explícito.
              // Modo RTMP_PUSH não precisa de probe — câmera é quem conecta.
              const rtspGateBlocked = step === 'connection'
                && form.ingestMode === 'RTSP_PULL'
                && !testResult?.success
                && !skipProbeAck
              // Gate site: invariante I-1 (toda câmera vive sob um site).
              // Step 'mode': bloqueia se não há site cadastrado no tenant.
              // Step 'info': bloqueia se nenhum site foi escolhido ainda.
              const noSitesAvailable = !sitesLoading && sites.length === 0
              const siteGateBlocked =
                (step === 'mode' && noSitesAvailable) ||
                (step === 'info' && !form.siteId)
              const blocked = rtspGateBlocked || siteGateBlocked
              const tooltip = rtspGateBlocked
                ? 'Teste a conexão ou marque que a câmera ainda não está instalada'
                : step === 'mode' && noSitesAvailable
                  ? 'Cadastre um site primeiro'
                  : step === 'info' && !form.siteId
                    ? 'Selecione um site para esta câmera'
                    : undefined
              return (
                <button
                  onClick={next}
                  disabled={blocked}
                  title={tooltip}
                  className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-medium flex items-center gap-1 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Próximo <ChevronRight className="w-4 h-4" />
                </button>
              )
            })()
          )}
        </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ── Helpers ──
// Nota sobre <option>: o browser ignora estilos do <select> ao renderizar o
// popup nativo (fica branco-no-branco em dark mode). Aplicamos cores explícitas
// nas options via arbitrary variant do Tailwind. Funciona em Chrome/Edge/Firefox;
// no Safari macOS o popup é OS-native e ignora — limitação do browser.
const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500 dark:focus:border-cyan-500/50 dark:focus:ring-cyan-500/20 [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-white dark:bg-slate-900 dark:[&>option]:text-slate-900 dark:text-white'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function ToggleRow({ label, value, onChange, icon: Icon, color, desc }: { label: string; value: boolean; onChange: (v: boolean) => void; icon: any; color: string; desc?: string }) {
  const colorMap: Record<string, string> = {
    cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    violet:'bg-violet-500/15 text-violet-400 border-violet-500/30',
    rose: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    amber:'bg-amber-500/15 text-amber-400 border-amber-500/30',
    emerald:'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  }
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-slate-200 dark:border-white/10">
      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${colorMap[color]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
        {desc && <p className="text-[11px] text-slate-500 mt-0.5">{desc}</p>}
      </div>
      <button onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition shrink-0 ${value ? 'bg-cyan-500' : 'bg-slate-100 dark:bg-white/10'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

function ReviewGroup({ title, children }: any) {
  return (
    <div className="p-3 rounded-lg bg-white/[0.02] border border-slate-200 dark:border-white/10">
      <h4 className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider mb-2">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  )
}
function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between gap-2 text-[11px]">
      <span className="text-slate-500">{k}</span>
      <span className="text-slate-900 dark:text-white font-mono truncate">{String(v)}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ModeStep — Step 0 do wizard: escolha de modo de deploy + protocolo.
// Inspirado no fluxo Monuv: 2 cards lado-a-lado (Edge Box vs Cloud Direto)
// + chips de protocolo + atalhos de "outras opções" (em breve).
// ─────────────────────────────────────────────────────────────────────────────

const PROTOCOLS_BY_MODE: Record<string, { id: string; label: string; icon: any; hint?: string }[]> = {
  EDGE_BOX: [
    { id: 'ONVIF',     label: 'ONVIF',     icon: Radar,  hint: 'descoberta automática' },
    { id: 'RTSP',      label: 'RTSP',      icon: Video,  hint: 'pull via box' },
    { id: 'RTMP_PUSH', label: 'RTMP push', icon: Cloud },
    { id: 'SRT_PUSH',  label: 'SRT push',  icon: Network, hint: 'baixa latência' },
    { id: 'P2P',       label: 'P2P',       icon: Wifi },
  ],
  CLOUD_DIRECT: [
    { id: 'ONVIF',     label: 'ONVIF',     icon: Radar },
    { id: 'RTSP',      label: 'RTSP',      icon: Video, hint: 'precisa IP público' },
    { id: 'RTMP_PUSH', label: 'RTMP push', icon: Cloud, hint: 'recomendado' },
    { id: 'SRT_PUSH',  label: 'SRT push',  icon: Network },
    { id: 'P2P',       label: 'P2P',       icon: Wifi },
  ],
}

// Mapeia protocol → ingestMode interno do backend (que só conhece RTSP_PULL/RTMP_PUSH)
function protocolToIngestMode(p: string): 'RTSP_PULL' | 'RTMP_PUSH' {
  // ONVIF/SRT_PUSH/P2P caem em RTSP_PULL por enquanto (backend não tem tipo específico)
  return p === 'RTMP_PUSH' ? 'RTMP_PUSH' : 'RTSP_PULL'
}

function ModeStep({
  form, setForm, setField: _setField, onAdvance,
}: {
  form: any
  setForm: (fn: any) => void
  setField: (k: string, v: any) => void
  onAdvance: () => void
}) {
  const mode = form.deploymentMode as 'EDGE_BOX' | 'CLOUD_DIRECT'
  const protocol = form.protocol as string

  function pickMode(m: 'EDGE_BOX' | 'CLOUD_DIRECT') {
    // Cloud-direct: protocolo recomendado é RTMP_PUSH; Edge-box: RTSP
    const defaultProtocol = m === 'CLOUD_DIRECT' ? 'RTMP_PUSH' : 'RTSP'
    setForm((f: any) => ({
      ...f,
      deploymentMode: m,
      protocol: defaultProtocol,
      ingestMode: protocolToIngestMode(defaultProtocol),
      // Se cloud-direct, força pipeline VERTEX (não tem edge processando)
      ...(m === 'CLOUD_DIRECT' ? { pipeline: 'VERTEX_STREAMING' } : {}),
    }))
  }

  function pickProtocol(p: string) {
    setForm((f: any) => ({ ...f, protocol: p, ingestMode: protocolToIngestMode(p) }))
  }

  const protocols = PROTOCOLS_BY_MODE[mode] ?? PROTOCOLS_BY_MODE.EDGE_BOX

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="text-center">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Você pode mudar depois, mas afeta capacidades de IA, gravação local e dependência de internet.
        </p>
      </div>

      {/* Cards: Edge Box vs Cloud Direct */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ModeCard
          selected={mode === 'EDGE_BOX'}
          recommended
          onClick={() => pickMode('EDGE_BOX')}
          icon={Server}
          title="Via Edge Box"
          deployTag="DEPLOYMENTMODE = EDGE_BOX"
          color="amber"
          features={[
            { kind: 'pro', text: 'Streaming local (latência <100ms)' },
            { kind: 'pro', text: 'IA on-device (pessoas, placas, faces)' },
            { kind: 'pro', text: 'Funciona offline (continua gravando)' },
            { kind: 'pro', text: 'Gravação local + sync cloud' },
            { kind: 'pro', text: 'Não consome banda do cliente' },
          ]}
        />
        <ModeCard
          selected={mode === 'CLOUD_DIRECT'}
          onClick={() => pickMode('CLOUD_DIRECT')}
          icon={Wifi}
          title="Direct Cam (cloud direto)"
          deployTag="DEPLOYMENTMODE = CLOUD_DIRECT"
          color="violet"
          features={[
            { kind: 'pro',  text: 'Sem hardware no local' },
            { kind: 'pro',  text: 'Setup em minutos' },
            { kind: 'pro',  text: 'Compatível ONVIF, RTSP, RTMP push, P2P' },
            { kind: 'warn', text: 'Bandwidth do cliente (uplink)' },
            { kind: 'warn', text: 'IA pesada limitada' },
            { kind: 'warn', text: 'Sem gravação local' },
          ]}
        />
      </div>

      {/* Protocolo */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Protocolo</p>
        <div className="flex gap-2 flex-wrap">
          {protocols.map(p => {
            const Icon = p.icon
            const active = protocol === p.id
            return (
              <button key={p.id} onClick={() => pickProtocol(p.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition text-xs font-medium ${
                  active
                    ? 'bg-violet-500/15 border-violet-500/60 text-violet-200'
                    : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-violet-500/40 hover:text-slate-900 dark:hover:text-slate-900 dark:text-white'
                }`}>
                <Icon className="w-3.5 h-3.5" />
                <span>{p.label}</span>
                {p.hint && (
                  <span className={`text-[9px] uppercase font-mono ${active ? 'text-violet-300/70' : 'text-slate-500'}`}>
                    · {p.hint}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Calculadora de banda — só em CLOUD_DIRECT (banda do cliente final) */}
      {mode === 'CLOUD_DIRECT' && <BandwidthCalculator />}

      {/* Outras opções (em breve) */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] p-3">
        <p className="text-[10px] uppercase tracking-wider text-amber-500 font-bold mb-2 flex items-center gap-1">
          <Zap className="w-3 h-3" /> Outras opções (em breve)
        </p>
        <div className="flex gap-2 flex-wrap">
          {[
            { icon: FileSpreadsheet, label: 'Importar lote (CSV)' },
            { icon: Search,           label: 'Auto-discovery ONVIF' },
            { icon: QrCode,           label: 'QR code (box-installer)' },
          ].map((o, i) => {
            const Icon = o.icon
            return (
              <button key={i} disabled
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-white/10 text-xs text-slate-500 dark:text-slate-500 opacity-60 cursor-not-allowed">
                <Icon className="w-3.5 h-3.5" /> {o.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* CTA continuar */}
      <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-white/5">
        <button onClick={onAdvance}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-rose-500 to-violet-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-rose-500/20 hover:opacity-90 transition">
          Continuar com {mode === 'EDGE_BOX' ? 'Edge Box' : 'Cloud Direto'} · {protocol}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

function ModeCard({
  selected, recommended, onClick, icon: Icon, title, deployTag, color, features,
}: {
  selected: boolean
  recommended?: boolean
  onClick: () => void
  icon: any
  title: string
  deployTag: string
  color: 'amber' | 'violet'
  features: Array<{ kind: 'pro' | 'warn'; text: string }>
}) {
  const colorMap = {
    amber: {
      ring:   'border-amber-500 ring-2 ring-amber-500/40',
      idle:   'border-slate-200 dark:border-white/10 hover:border-amber-500/40',
      icon:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
      tag:    'text-amber-400',
    },
    violet: {
      ring:   'border-violet-500 ring-2 ring-violet-500/40',
      idle:   'border-slate-200 dark:border-white/10 hover:border-violet-500/40',
      icon:   'bg-violet-500/15 text-violet-400 border-violet-500/30',
      tag:    'text-violet-400',
    },
  }[color]

  return (
    <button onClick={onClick}
      className={`relative text-left p-4 rounded-xl border-2 transition bg-white dark:bg-space-900 ${
        selected ? colorMap.ring : colorMap.idle
      }`}>
      {recommended && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white tracking-wider flex items-center gap-1 shadow-lg shadow-amber-500/30">
          <Star className="w-3 h-3" fill="currentColor" /> RECOMENDADO
        </span>
      )}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${colorMap.icon}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
          <code className={`text-[9px] font-mono uppercase ${colorMap.tag}`}>{deployTag}</code>
        </div>
      </div>
      <ul className="space-y-1.5">
        {features.map((f, i) => (
          <li key={i} className={`flex items-start gap-2 text-[12px] ${
            f.kind === 'pro' ? 'text-slate-700 dark:text-slate-300' : 'text-amber-600 dark:text-amber-400'
          }`}>
            <span className="shrink-0 mt-0.5">{f.kind === 'pro' ? '✓' : '⚠'}</span>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BrandTutorialTabs — instruções pós-criação por marca de câmera CFTV.
//
// 2026-05-12: substitui o bloco antigo só-pra-Larix. Cobre as 4 marcas
// dominantes no mercado BR (Hikvision, Dahua, Intelbras, Axis) + um
// fallback genérico (Larix/OBS).
//
// Path dos menus baseado nos firmwares mais comuns em 2024-2026:
//   - Hikvision DS-2CDxxxx series (firmware 5.6+)
//   - Dahua IPC-HFW series (firmware 2.6+)
//   - Intelbras VIP/VHD series (firmware 4.0+)
//   - Axis Q/P series (firmware 10.0+)
// ═══════════════════════════════════════════════════════════════════════════
type BrandTab = 'hikvision' | 'dahua' | 'intelbras' | 'axis' | 'obs'

function BrandTutorialTabs({
  rtmpUrl, streamKey,
}: { rtmpUrl?: string; streamKey?: string }) {
  const [tab, setTab] = useState<BrandTab>('hikvision')

  const tabs: { id: BrandTab; label: string; emoji: string }[] = [
    { id: 'hikvision', label: 'Hikvision',  emoji: '📷' },
    { id: 'dahua',     label: 'Dahua',      emoji: '📷' },
    { id: 'intelbras', label: 'Intelbras',  emoji: '📷' },
    { id: 'axis',      label: 'Axis',       emoji: '📷' },
    { id: 'obs',       label: 'OBS / Larix', emoji: '💻' },
  ]

  return (
    <div className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
      <div className="border-b border-slate-200 dark:border-white/10 px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mr-1">
          Como configurar na câmera:
        </span>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-2.5 py-1 rounded-md text-[11px] font-semibold transition',
              tab === t.id
                ? 'bg-cyan-500 text-white shadow'
                : 'bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-100 dark:bg-white/10',
            )}
          >
            <span className="mr-1">{t.emoji}</span>{t.label}
          </button>
        ))}
      </div>

      <div className="p-4 text-xs text-slate-700 dark:text-slate-300">
        {tab === 'hikvision' && (
          <BrandSteps
            menuPath="Configuration → Network → Advanced Settings → Platform Access"
            altPath="OU: Configuration → Network → Advanced → RTMP"
            steps={[
              <>Acesse a interface web da câmera (geralmente <code>http://&lt;ip-da-camera&gt;</code>) com login admin.</>,
              <>No menu lateral, vá em <strong>Configuration → Network → Advanced Settings → RTMP</strong>.</>,
              <>Habilite o toggle <strong>Enable</strong>.</>,
              <>Em <strong>Server IP Address</strong>, cole a URL completa abaixo (inclui a Stream Key).</>,
              <>Clique <strong>Save</strong>. A câmera começa a empurrar em alguns segundos.</>,
            ]}
            note="Modelos antigos (firmware 5.3 ou anterior) podem não ter RTMP — use Platform Access → tipo ICVPlatform com URL customizada."
            rtmpUrl={rtmpUrl}
          />
        )}
        {tab === 'dahua' && (
          <BrandSteps
            menuPath="Setting → Network → RTMP"
            steps={[
              <>Acesse a interface web da câmera. Login padrão Dahua: <code>admin/admin</code>.</>,
              <>Vá em <strong>Setting → Network → RTMP</strong> (algumas versões: <em>Network → Advanced → RTMP</em>).</>,
              <>Marque <strong>Enable</strong>. Em <strong>Address</strong>, cole apenas a URL <em>sem</em> a Stream Key.</>,
              <>Em <strong>Stream</strong>: deixe Main Stream. Em <strong>Custom Name</strong>: cole apenas a Stream Key.</>,
              <>Save → Apply.</>,
            ]}
            note="Algumas Dahua exigem que o Audio Codec esteja em AAC (Setting → Audio → Encode)."
            rtmpUrl={rtmpUrl}
            streamKey={streamKey}
          />
        )}
        {tab === 'intelbras' && (
          <BrandSteps
            menuPath="Rede → Configurações Avançadas → RTMP"
            steps={[
              <>Acesse o IP da câmera no navegador. Login padrão Intelbras: <code>admin/admin</code>.</>,
              <>Menu <strong>Rede → Configurações Avançadas → RTMP</strong>.</>,
              <>Habilite <strong>Ativar</strong>.</>,
              <>Em <strong>Endereço do servidor RTMP</strong>: cole a URL completa.</>,
              <>Salvar.</>,
            ]}
            note="Linha VIP usa interface idêntica à Dahua. VHD WiFi precisa estar no mesmo segmento de rede que tenha saída TCP 1935."
            rtmpUrl={rtmpUrl}
          />
        )}
        {tab === 'axis' && (
          <BrandSteps
            menuPath="System → Events → Recipients → Add (HTTP/HTTPS)"
            steps={[
              <>Axis não tem RTMP nativo no menu — use <strong>ACAP "RTMP Streaming"</strong> grátis (axis.com/products/acap).</>,
              <>Instale o ACAP via <strong>Apps → Adicionar app</strong>.</>,
              <>Em <strong>Apps → RTMP Streaming → Configure</strong>: cole a URL completa.</>,
              <>Start.</>,
            ]}
            note="Alternativa sem ACAP: use go2rtc/ffmpeg num PC pra puxar RTSP da Axis e re-empurrar RTMP."
            rtmpUrl={rtmpUrl}
          />
        )}
        {tab === 'obs' && (
          <BrandSteps
            menuPath="Settings → Stream"
            steps={[
              <><strong>OBS Studio:</strong> Settings → Stream → Service "Custom".</>,
              <>Em <strong>Server</strong>: cole apenas o prefixo (sem a Stream Key).</>,
              <>Em <strong>Stream Key</strong>: cole o valor abaixo. Iniciar Transmissão.</>,
              <><strong>Larix Broadcaster (mobile):</strong> Connections → New → cole URL completa → Save → Stream.</>,
            ]}
            note="OBS é a forma mais rápida de testar antes de ir pra câmera real. Ideal pra demo pro cliente."
            rtmpUrl={rtmpUrl}
            streamKey={streamKey}
          />
        )}
      </div>
    </div>
  )
}

function BrandSteps({
  menuPath, altPath, steps, note, rtmpUrl: _rtmpUrl, streamKey,
}: {
  menuPath: string
  altPath?: string
  steps: React.ReactNode[]
  note?: string
  rtmpUrl?: string
  streamKey?: string
}) {
  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
        📍 {menuPath}
      </div>
      {altPath && (
        <div className="text-[10px] font-mono text-slate-500 dark:text-slate-500 -mt-2">
          {altPath}
        </div>
      )}
      <ol className="space-y-1.5 list-decimal list-inside">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {note && (
        <div className="mt-2 px-3 py-2 rounded bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-[11px] text-amber-800 dark:text-amber-200">
          💡 {note}
        </div>
      )}
      {streamKey && (
        <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-500">
          Lembrete: cole separadamente <code className="text-amber-600 dark:text-amber-300">URL</code> e <code className="text-amber-600 dark:text-amber-300">Stream Key</code> conforme o campo pede acima.
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// FirstFramePoll — polling pós-criação pra detectar primeiro frame da câmera.
//
// 2026-05-12: feedback imediato pro operador "está pushando ou não?".
// Sem isso, ele cola URL na câmera e fica olhando pro nada até abrir /live.
//
// Polling 3s no GET /cameras/:id. Detecta `rtmpIngestLastFrameAt` recente.
//   - <30s sem frame: spinner "Aguardando…"
//   - frame chegou: ✅ verde
//   - 60s sem frame: checklist troubleshooting
// ═══════════════════════════════════════════════════════════════════════════
function FirstFramePoll({ cameraId, streamKey: _streamKey }: { cameraId: string; streamKey?: string }) {
  const [phase, setPhase] = useState<'waiting' | 'detected' | 'timeout'>('waiting')
  const [secsElapsed, setSecsElapsed] = useState(0)

  useEffect(() => {
    if (phase !== 'waiting') return
    const startedAt = Date.now()
    const interval = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setSecsElapsed(elapsed)

      try {
        const r = await fetch(`/api/cameras/${cameraId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('icv_token') ?? ''}` },
        })
        if (r.ok) {
          const data = await r.json()
          const last = data?.rtmpIngestLastFrameAt
          if (last) {
            const age = (Date.now() - new Date(last).getTime()) / 1000
            // Frame "fresco" = registrado nos últimos 30s, depois do POST.
            // (Camera nova nunca teve frame antes — qualquer valor > "agora-criação" é prova)
            if (age < 30) {
              setPhase('detected')
              clearInterval(interval)
              return
            }
          }
        }
      } catch {
        // erro transitório — segue tentando
      }

      if (elapsed > 60) {
        setPhase('timeout')
        clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [cameraId, phase])

  if (phase === 'detected') {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
        <div>
          <p className="text-sm font-bold text-emerald-300">Stream recebido!</p>
          <p className="text-xs text-emerald-200/80">
            A câmera está empurrando vídeo agora. Gravação iniciando automaticamente.
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'timeout') {
    return (
      <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <p className="text-sm font-bold text-rose-300">Sem stream após 60s</p>
        </div>
        <p className="text-xs text-rose-200/80">Checklist de troubleshooting:</p>
        <ul className="text-xs text-rose-200/70 space-y-1 list-disc list-inside ml-2">
          <li>URL e Stream Key colados <strong>exatamente</strong> conforme acima (sem espaços)</li>
          <li>Firewall do local: liberar TCP <strong>outbound</strong> porta <strong>1935</strong></li>
          <li>Câmera tem internet? Faça ping pra <code>app.iacloud.com.br</code> da rede dela</li>
          <li>Toggle "Enable RTMP" está realmente ON e salvou</li>
          <li>Streamkey antigo cacheado? Disable + Enable na câmera força reconexão</li>
        </ul>
        <button
          onClick={() => { setPhase('waiting'); setSecsElapsed(0) }}
          className="mt-1 px-3 py-1 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-medium hover:bg-rose-500/30"
        >
          Tentar de novo (mais 60s)
        </button>
      </div>
    )
  }

  // waiting
  return (
    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 flex items-center gap-3">
      <Loader2 className="w-5 h-5 text-cyan-400 animate-spin shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-cyan-300">
          Aguardando primeiro frame… {secsElapsed}s
        </p>
        <p className="text-[11px] text-cyan-200/70">
          Vá na câmera agora e configure o RTMP com a URL acima. Esta caixa atualiza sozinha quando o stream chegar.
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BandwidthCalculator — estima banda upload necessária no link do cliente.
//
// 2026-05-12: bloqueio comercial — provedor ISP vende Cloud Direct
// pra cliente com internet 100/5 Mbps assimétrica e fica com 5 câmeras
// estourando o link. Calculadora mostra o número ANTES da venda.
//
// Bitrate de referência (H.264 main profile, 15 fps motion-typical):
//   - SD 480p (640x480)    → 400 Kbps   = 50 KB/s   = 4.3 GB/dia
//   - HD 720p (1280x720)   → 1.2 Mbps   = 150 KB/s  = 13 GB/dia
//   - FHD 1080p (1920x1080)→ 2.5 Mbps   = 312 KB/s  = 27 GB/dia
//   - 2K (2560x1440)       → 5 Mbps     = 625 KB/s  = 54 GB/dia
//   - 4K (3840x2160)       → 10 Mbps    = 1.25 MB/s = 108 GB/dia
//
// Overhead: +20% pra protocol + keyframes maiores em motion alto.
// ═══════════════════════════════════════════════════════════════════════════
const BITRATE_KBPS: Record<string, { mbps: number; gbDay: number; label: string }> = {
  '480p':  { mbps: 0.48, gbDay: 5.2,  label: 'SD 480p' },
  '720p':  { mbps: 1.44, gbDay: 15.6, label: 'HD 720p' },
  '1080p': { mbps: 3.0,  gbDay: 32.4, label: 'Full HD 1080p' },
  '1440p': { mbps: 6.0,  gbDay: 64.8, label: '2K 1440p' },
  '4k':    { mbps: 12.0, gbDay: 129.6, label: '4K 2160p' },
}

function BandwidthCalculator() {
  const [count, setCount] = useState(1)
  const [resolution, setResolution] = useState<keyof typeof BITRATE_KBPS>('1080p')
  const [clientUplinkMbps, setClientUplinkMbps] = useState<number | null>(5)

  const perCam = BITRATE_KBPS[resolution]
  const totalMbps = perCam.mbps * count
  const totalGbDay = perCam.gbDay * count
  const totalGbMonth = totalGbDay * 30

  const headroom = clientUplinkMbps ? clientUplinkMbps - totalMbps : null
  const overloaded = headroom != null && headroom < 0
  const tight     = headroom != null && headroom >= 0 && headroom < totalMbps * 0.3 // <30% folga

  return (
    <div className="rounded-xl border border-violet-300 dark:border-violet-500/30 bg-violet-50/60 dark:bg-violet-500/[0.06] p-3">
      <p className="text-[10px] uppercase tracking-wider text-violet-700 dark:text-violet-300 font-bold mb-2 flex items-center gap-1">
        🧮 Calculadora de banda — Cloud Direct
      </p>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold">Quantas câmeras?</span>
          <input
            type="number" min="1" max="100"
            value={count}
            onChange={e => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="px-2 py-1.5 rounded bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold">Resolução</span>
          <select
            value={resolution}
            onChange={e => setResolution(e.target.value as any)}
            className="px-2 py-1.5 rounded bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
          >
            {Object.entries(BITRATE_KBPS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold">Upload do cliente (Mbps)</span>
          <input
            type="number" min="0" max="1000"
            value={clientUplinkMbps ?? ''}
            onChange={e => setClientUplinkMbps(e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0))}
            placeholder="ex: 5"
            className="px-2 py-1.5 rounded bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="px-3 py-2 rounded bg-white/70 dark:bg-black/30 border border-slate-200 dark:border-white/10">
          <p className="text-slate-500 dark:text-slate-400">Banda upload contínua</p>
          <p className="text-base font-bold text-slate-900 dark:text-white font-mono">
            {totalMbps.toFixed(1)} Mbps
          </p>
        </div>
        <div className="px-3 py-2 rounded bg-white/70 dark:bg-black/30 border border-slate-200 dark:border-white/10">
          <p className="text-slate-500 dark:text-slate-400">Consumo mensal</p>
          <p className="text-base font-bold text-slate-900 dark:text-white font-mono">
            {totalGbMonth >= 1000 ? `${(totalGbMonth/1000).toFixed(1)} TB` : `${totalGbMonth.toFixed(0)} GB`}
          </p>
        </div>
      </div>

      {clientUplinkMbps !== null && (
        <div className={cn(
          'mt-2 px-3 py-2 rounded text-[11px] font-semibold flex items-center gap-2',
          overloaded
            ? 'bg-rose-500/15 border border-rose-500/40 text-rose-700 dark:text-rose-300'
            : tight
              ? 'bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300'
              : 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
        )}>
          {overloaded ? (
            <>
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                Banda do cliente <strong>insuficiente</strong>: precisa de {totalMbps.toFixed(1)} Mbps,
                tem {clientUplinkMbps} Mbps. Reduza resolução, qtd de câmeras, ou negocie upgrade do link.
              </span>
            </>
          ) : tight ? (
            <>
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                Vai funcionar mas <strong>sem folga</strong> ({headroom?.toFixed(1)} Mbps livres).
                Picos de movimento podem causar travamento. Considere reduzir 1 grau de resolução.
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Link suporta com folga ({headroom?.toFixed(1)} Mbps livres).
              </span>
            </>
          )}
        </div>
      )}

      <p className="text-[9px] text-slate-500 dark:text-slate-500 mt-2">
        💡 Cálculo H.264 motion-típico 15fps. Bitrate real pode variar ±30% conforme cena (mais movimento, mais banda).
      </p>
    </div>
  )
}

