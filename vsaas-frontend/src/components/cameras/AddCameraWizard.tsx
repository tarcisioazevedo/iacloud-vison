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
  ShieldCheck, Database, CheckCircle2, AlertCircle, Loader2, Radar,
  Activity, Eye, Smile, FileBadge, Volume2, Search, Sparkles, Cloud,
  MapPin,
} from 'lucide-react'
import {
  createCamera,
  useCameraPresets,
  useSites,
  formatApiError,
  probeCameraUrl,
} from '../../api/client'

const STEPS = [
  { id: 'info',       label: 'Info',        icon: Camera },
  { id: 'rtsp',       label: 'RTSP',        icon: Video },
  { id: 'detector',   label: 'Detector',    icon: Cpu },
  { id: 'motion',     label: 'Motion',      icon: Activity },
  { id: 'advanced',   label: 'Avançado',    icon: Sparkles },
  { id: 'retention',  label: 'Retenção',    icon: Database },
  { id: 'review',     label: 'Revisar',     icon: CheckCircle2 },
] as const

type StepId = typeof STEPS[number]['id']

interface Props { onClose: () => void }

export function AddCameraWizard({ onClose }: Props) {
  const [step, setStep] = useState<StepId>('info')
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
  const { data: presets } = useCameraPresets()
  const { data: sitesData, isLoading: sitesLoading } = useSites()
  const sites = sitesData?.sites ?? []

  const [form, setForm] = useState<any>({
    // Info
    name:           '',
    siteId:         '',
    locationHint:   '',
    tier:           'SILVER',
    pipeline:       'EDGE_YOLO',
    // RTSP
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

        // Streams
        rtspMainUrl:  form.rtspUrl,
        rtspUsername: form.rtspUsername || undefined,
        rtspPassword: form.rtspPassword || undefined,
        rtmpPushUrl:  form.rtmpPushUrl || undefined,
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

      await createCamera(payload)
      onClose()
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
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg text-slate-500 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]">
          <div className="flex items-center justify-between gap-2">
            {STEPS.map((s, idx) => {
              const Icon = s.icon
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
          <AnimatePresence mode="wait">
            <motion.div key={step}
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}>

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

              {step === 'rtsp' && (
                <div className="space-y-4 max-w-2xl">
                  <Field label="URL RTSP *">
                    <input
                      value={form.rtspUrl}
                      onChange={e => {
                        setField('rtspUrl', e.target.value)
                        // Qualquer edição na URL invalida o probe anterior.
                        // Sem isso, operador editaria URL ruim mas o badge
                        // verde antigo continuaria mentindo "URL válida".
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
                  <Field label="URL Push RTMP (opcional · Pipeline 2 / Vertex AI Vision)">
                    <input
                      value={form.rtmpPushUrl}
                      onChange={e => setField('rtmpPushUrl', e.target.value)}
                      placeholder="rtmp://...-aiplatform.googleapis.com/v1/projects/.../streams/<id>"
                      className={inputCls + ' font-mono text-xs'}
                    />
                    <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-1 leading-snug">
                      Endpoint de ingestão para câmeras com pipeline VERTEX_STREAMING. Edge faz push contínuo
                      via FFmpeg. Deixe em branco para EDGE_YOLO/EDGE_HYBRID. <span className="text-slate-500 dark:text-slate-600">WebRTC live é
                      servido automaticamente pelo go2rtc do edge — não precisa configurar aqui.</span>
                    </p>
                  </Field>
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
                  <p className="text-[10px] text-slate-600 leading-relaxed">
                    Validação local de formato. Teste de conexão real (ffprobe) é executado pelo backend após salvar.
                  </p>

                  {/* Gate de avanço — força o operador a TESTAR antes de prosseguir.
                      Câmeras criadas com URL errada geram filas de logs de erro,
                      ocupam quota Vision em retentativas e poluem o dashboard. */}
                  {!testResult?.success && (
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1 text-xs text-amber-200 leading-relaxed">
                        <p className="font-semibold mb-1">Teste de conexão é recomendado antes de prosseguir.</p>
                        <p className="text-amber-200/70 mb-2">
                          Câmeras com URL inválida ficam erradas no sistema, geram alertas em loop e podem
                          consumir quota do Cloud Vision em retentativas.
                        </p>
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
                                     : 'bg-white/5 text-slate-500 border border-white/10 hover:text-white'}`}>
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
                      <option value="CONTINUOUS">Contínua</option>
                      <option value="ACTIVE_OBJECTS">Em objetos ativos</option>
                      <option value="ALL">Tudo</option>
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
                  <h3 className="text-sm font-bold text-white">Revisão Final</h3>
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
                    <ReviewGroup title="Stream">
                      <Row k="RTSP" v={form.rtspUrl.slice(0, 40) + (form.rtspUrl.length > 40 ? '…' : '')} />
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-white/10 bg-white/[0.02]">
          <button onClick={prev} disabled={stepIdx === 0}
            className="px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 flex items-center gap-1">
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
              // Gate específico do step RTSP: só libera "Próximo" se o probe
              // foi OK OU se o operador deu o ack explícito de "câmera offline".
              // Outros steps liberam livremente — back/forward sem fricção.
              const rtspGateBlocked = step === 'rtsp' && !testResult?.success && !skipProbeAck
              return (
                <button
                  onClick={next}
                  disabled={rtspGateBlocked}
                  title={rtspGateBlocked ? 'Teste a conexão ou marque que a câmera ainda não está instalada' : undefined}
                  className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-medium flex items-center gap-1 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Próximo <ChevronRight className="w-4 h-4" />
                </button>
              )
            })()
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Helpers ──
const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-slate-500 dark:focus:border-cyan-500/50 dark:focus:ring-cyan-500/20'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function ToggleRow({ label, value, onChange, icon: Icon, color, desc }: any) {
  const colorMap: Record<string, string> = {
    cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    violet:'bg-violet-500/15 text-violet-400 border-violet-500/30',
    rose: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    amber:'bg-amber-500/15 text-amber-400 border-amber-500/30',
    emerald:'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  }
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/10">
      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${colorMap[color]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-white">{label}</p>
        {desc && <p className="text-[11px] text-slate-500 mt-0.5">{desc}</p>}
      </div>
      <button onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition shrink-0 ${value ? 'bg-cyan-500' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

function ReviewGroup({ title, children }: any) {
  return (
    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10">
      <h4 className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider mb-2">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  )
}
function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between gap-2 text-[11px]">
      <span className="text-slate-500">{k}</span>
      <span className="text-white font-mono truncate">{String(v)}</span>
    </div>
  )
}
