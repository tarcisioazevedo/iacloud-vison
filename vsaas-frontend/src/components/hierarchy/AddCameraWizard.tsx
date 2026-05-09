/**
 * AddCameraWizard — modal wizard 4-step para adicionar câmera.
 *
 * Onda 2.D do docs/13-PLAN-COCKPIT-PREMIUM.md.
 *
 * Step 1: Modo de conexão (Edge Box vs Cloud Direct/avulsa)
 * Step 2: Configuração (URL RTSP/ONVIF/RTMP, credenciais, tier)
 * Step 3: Validação (probe + preview)
 * Step 4: Concluído
 */
import { useState } from 'react'
import { X, Camera, Server, Wifi, ArrowRight, ArrowLeft, Check, Loader2, Plus, Copy, MapPin } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { api, useSites } from '../../api/client'
import { cn } from '../../lib/utils'

export interface AddCameraWizardProps {
  open: boolean
  onClose: () => void
  /** Site onde a câmera será criada. Se não passar, mostra select de sites. */
  siteId?: string
  /** EdgeNode pré-selecionado (forçar modo EDGE_BOX). Se omitido, usuário escolhe. */
  edgeNodeId?: string
  /** Callback quando câmera criada com sucesso (passa o id da nova câmera). */
  onCreated?: (cameraId: string) => void
}

type Step = 1 | 2 | 3 | 4
type DeployMode = 'EDGE_BOX' | 'CLOUD_DIRECT'
type Protocol = 'ONVIF' | 'RTSP' | 'RTMP_PUSH' | 'SRT_PUSH' | 'P2P'

export function AddCameraWizard({ open, onClose, siteId: siteIdProp, edgeNodeId: initialEdgeNodeId, onCreated }: AddCameraWizardProps) {
  const [step, setStep] = useState<Step>(1)
  const [deployMode, setDeployMode] = useState<DeployMode>(initialEdgeNodeId ? 'EDGE_BOX' : 'EDGE_BOX')
  const [protocol, setProtocol] = useState<Protocol>('RTSP')
  const [name, setName] = useState('')
  // Site obrigatório — se não veio por contexto, operador escolhe.
  // Toda câmera precisa pertencer a 1 site (organiza permissões/retenção/billing).
  const [siteIdSelected, setSiteIdSelected] = useState<string>('')
  const siteId = siteIdProp ?? siteIdSelected
  const { data: sitesData } = useSites()
  const availableSites = sitesData?.sites ?? []
  const [rtspMainUrl, setRtspMainUrl] = useState('rtsp://')
  const [rtspUsername, setRtspUsername] = useState('')
  const [rtspPassword, setRtspPassword] = useState('')
  const [edgeNodeId] = useState(initialEdgeNodeId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [rtmpIngestUrl, setRtmpIngestUrl] = useState<string | null>(null)
  const [srtIngestUrl, setSrtIngestUrl] = useState<string | null>(null)
  const [rtmpStreamKey, setRtmpStreamKey] = useState<string | null>(null)

  if (!open) return null

  function reset() {
    setStep(1)
    setDeployMode('EDGE_BOX')
    setProtocol('RTSP')
    setName('')
    setRtspMainUrl('rtsp://')
    setRtspUsername('')
    setRtspPassword('')
    setSubmitting(false)
    setError(null)
    setCreatedId(null)
    setRtmpIngestUrl(null)
    setSrtIngestUrl(null)
    setRtmpStreamKey(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      // Validação: site obrigatório (mesmo CLOUD_DIRECT). Sem site, organização
      // de permissões/retenção/billing não funciona.
      if (!siteId) {
        setError('Selecione o site onde a câmera vai ser instalada (obrigatório).')
        setSubmitting(false)
        return
      }
      const payload: Record<string, unknown> = {
        name: name.trim() || `Câmera ${Date.now().toString(36)}`,
        siteId,
        deploymentMode: deployMode,
        // Defaults sensatos
        tier: 'BRONZE',
        pipeline: 'EDGE_HYBRID',
      }
      // Mapeamento Protocol → IngestMode. PUSH modes (RTMP/SRT) não têm
      // rtspMainUrl da câmera; RTSP/ONVIF/P2P puxam via RTSP_PULL.
      const ingestMode =
        protocol === 'RTMP_PUSH' ? 'RTMP_PUSH'
      : protocol === 'SRT_PUSH'  ? 'SRT_PUSH'
      :                            'RTSP_PULL'
      const isPush = ingestMode === 'RTMP_PUSH' || ingestMode === 'SRT_PUSH'

      if (deployMode === 'EDGE_BOX') {
        payload.edgeNodeId = edgeNodeId
        payload.ingestMode = ingestMode
        if (!isPush) {
          payload.rtspMainUrl = rtspMainUrl
          if (rtspUsername) payload.rtspUsername = rtspUsername
          if (rtspPassword) payload.rtspPassword = rtspPassword
        }
      } else {
        // CLOUD_DIRECT: sem edgeNodeId
        payload.ingestMode = ingestMode
        if (!isPush) {
          payload.rtspMainUrl = rtspMainUrl
        }
      }

      const res = await api.post('/cameras', payload)
      const newCamera = res.data?.camera ?? res.data
      const id = newCamera?.id
      setCreatedId(id ?? null)
      setRtmpIngestUrl(newCamera?.rtmpIngestUrl ?? null)
      setSrtIngestUrl(newCamera?.srtIngestUrl ?? null)
      setRtmpStreamKey(newCamera?.rtmpStreamKey ?? null)
      setStep(4)
      onCreated?.(id)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string }
      setError(err.response?.data?.message ?? err.message ?? 'Erro ao criar câmera')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-3xl bg-slate-900 border border-rose-500/30 rounded-2xl shadow-2xl shadow-rose-500/10 overflow-hidden my-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 bg-gradient-to-r from-rose-500/5 to-violet-500/5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-violet-500 flex items-center justify-center text-xl">📹</div>
              <div>
                <h2 className="text-lg font-bold text-white">Adicionar câmera</h2>
                <p className="text-xs text-slate-400">Configure como esta câmera vai se conectar</p>
              </div>
            </div>
            <button onClick={handleClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mt-4 text-xs">
            <StepDot n={1} active={step >= 1} done={step > 1} label="Modo" />
            <span className="flex-1 h-px bg-slate-700" />
            <StepDot n={2} active={step >= 2} done={step > 2} label="Configurar" />
            <span className="flex-1 h-px bg-slate-700" />
            <StepDot n={3} active={step >= 3} done={step > 3} label="Validar" />
            <span className="flex-1 h-px bg-slate-700" />
            <StepDot n={4} active={step === 4} done={false} label="Concluído" />
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          {step === 1 && (
            <Step1ModeSelect
              deployMode={deployMode}
              onChange={setDeployMode}
              protocol={protocol}
              onProtocolChange={setProtocol}
              needsSiteSelector={!siteIdProp}
              sites={availableSites}
              siteIdSelected={siteIdSelected}
              onSiteChange={setSiteIdSelected}
            />
          )}
          {step === 2 && (
            <Step2Config
              deployMode={deployMode}
              protocol={protocol}
              name={name} setName={setName}
              rtspMainUrl={rtspMainUrl} setRtspMainUrl={setRtspMainUrl}
              rtspUsername={rtspUsername} setRtspUsername={setRtspUsername}
              rtspPassword={rtspPassword} setRtspPassword={setRtspPassword}
            />
          )}
          {step === 3 && (
            <Step3Review
              deployMode={deployMode}
              protocol={protocol}
              name={name}
              rtspMainUrl={rtspMainUrl}
              rtspUsername={rtspUsername}
              edgeNodeId={edgeNodeId}
              error={error}
              submitting={submitting}
            />
          )}
          {step === 4 && <Step4Success cameraId={createdId} rtmpIngestUrl={rtmpIngestUrl} srtIngestUrl={srtIngestUrl} rtmpStreamKey={rtmpStreamKey} protocol={protocol} onClose={handleClose} />}
        </div>

        {/* Footer */}
        {step !== 4 && (
          <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between">
            <button
              onClick={() => step > 1 ? setStep((step - 1) as Step) : handleClose()}
              className="px-4 py-2 rounded-lg text-slate-400 hover:text-white text-sm transition flex items-center gap-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {step > 1 ? 'Voltar' : 'Cancelar'}
            </button>
            {step < 3 && (
              <button
                onClick={() => setStep((step + 1) as Step)}
                disabled={
                  // Step 1: bloqueia se site é obrigatório (sem siteIdProp) e
                  // operador ainda não selecionou nenhum no dropdown.
                  (step === 1 && !siteId) ||
                  // Step 2: rtspMainUrl obrigatório só pra modos PULL (RTSP/ONVIF)
                  (step === 2 && protocol !== 'RTMP_PUSH' && protocol !== 'SRT_PUSH' && protocol !== 'P2P' && !rtspMainUrl)
                }
                title={
                  step === 1 && !siteId ? 'Selecione um site antes de continuar' :
                  undefined
                }
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-rose-500 to-violet-500 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold text-white shadow-lg shadow-rose-500/20 transition flex items-center gap-2"
              >
                Próximo
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 hover:opacity-90 disabled:opacity-50 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition flex items-center gap-2"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Criar câmera
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StepDot({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition',
        done ? 'bg-emerald-500 text-white' : active ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-400',
      )}>
        {done ? <Check className="w-3 h-3" /> : n}
      </span>
      <span className={cn(active ? 'text-white font-bold' : 'text-slate-500')}>{label}</span>
    </span>
  )
}

function Step1ModeSelect({
  deployMode, onChange, protocol, onProtocolChange,
  needsSiteSelector, sites, siteIdSelected, onSiteChange,
}: {
  deployMode: DeployMode
  onChange: (m: DeployMode) => void
  protocol: Protocol
  onProtocolChange: (p: Protocol) => void
  needsSiteSelector: boolean
  sites: Array<{ id: string; name: string; clienteFinal?: { name?: string } | null }>
  siteIdSelected: string
  onSiteChange: (id: string) => void
}) {
  return (
    <>
      {/* Seletor de site obrigatório (só aparece quando wizard aberto sem
          contexto de site — ex: pelo botão "Adicionar câmera" do menu global).
          Toda câmera, mesmo CLOUD_DIRECT, precisa de site pra organizar
          permissões/retenção/billing. */}
      {needsSiteSelector && (
        <div className="mb-5 p-4 rounded-xl bg-rose-500/10 border-2 border-rose-500/40">
          <label className="flex items-center gap-2 text-sm font-bold text-rose-300 mb-2">
            <MapPin className="w-4 h-4" />
            Site da câmera <span className="text-rose-400">*</span>
          </label>
          <select
            value={siteIdSelected}
            onChange={e => onSiteChange(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-rose-400 focus:outline-none"
          >
            <option value="" style={{ backgroundColor: '#0f172a' }}>— Selecione um site —</option>
            {sites.map(s => (
              <option key={s.id} value={s.id} style={{ backgroundColor: '#0f172a' }}>
                {s.name}{s.clienteFinal?.name ? ` (${s.clienteFinal.name})` : ''}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-2">
            Toda câmera precisa de site — mesmo Cloud Direto. O site organiza
            permissões, retenção de gravação e billing por cliente.
          </p>
        </div>
      )}

      <div className="text-sm text-slate-300 mb-5">
        <strong className="text-white">Como esta câmera vai se conectar?</strong>
        <span className="text-slate-500 block mt-1 text-xs">
          Você pode mudar depois, mas afeta capacidades de IA, gravação local e dependência de internet.
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ModeCard
          selected={deployMode === 'EDGE_BOX'}
          onSelect={() => onChange('EDGE_BOX')}
          icon={<Server className="w-6 h-6" />}
          accent="amber"
          recommended
          title="Via Edge Box"
          subtitle="deploymentMode = EDGE_BOX"
          features={[
            'Streaming local (latência <100ms)',
            'IA on-device (pessoas, placas, faces)',
            'Funciona offline (continua gravando)',
            'Gravação local + sync cloud',
            'Não consome banda do cliente',
          ]}
        />
        <ModeCard
          selected={deployMode === 'CLOUD_DIRECT'}
          onSelect={() => onChange('CLOUD_DIRECT')}
          icon={<Wifi className="w-6 h-6" />}
          accent="violet"
          title="Avulsa (cloud direto)"
          subtitle="deploymentMode = CLOUD_DIRECT"
          features={[
            'Sem hardware no local',
            'Setup em minutos',
            'Compatível ONVIF, RTSP, RTMP push, P2P',
            '⚠ Bandwidth do cliente (uplink)',
            '⚠ IA pesada limitada',
            '⚠ Sem gravação local',
          ]}
        />
      </div>

      {/* Protocolo (só se CLOUD_DIRECT) */}
      {deployMode === 'CLOUD_DIRECT' && (
        <div className="mt-5 pt-5 border-t border-slate-800">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2">
            Protocolo
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {(['ONVIF', 'RTSP', 'RTMP_PUSH', 'SRT_PUSH', 'P2P'] as Protocol[]).map(p => (
              <button
                key={p}
                onClick={() => onProtocolChange(p)}
                className={cn(
                  'p-2.5 rounded-lg border-2 text-xs font-bold transition',
                  protocol === p
                    ? 'border-violet-500 bg-violet-500/10 text-white'
                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-violet-500/50',
                )}
                title={
                  p === 'SRT_PUSH' ? 'SRT push — mais robusto que RTMP em redes instáveis (recomendado pra Wi-Fi/4G)' :
                  p === 'RTMP_PUSH' ? 'RTMP push — câmera/encoder empurra pra cloud' :
                  undefined
                }
              >
                {p === 'RTMP_PUSH' ? 'RTMP push' :
                 p === 'SRT_PUSH'  ? 'SRT push' : p}
              </button>
            ))}
          </div>
          {protocol === 'SRT_PUSH' && (
            <div className="mt-2 px-3 py-2 text-[11px] text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-lg">
              ✨ <b>SRT</b>: protocolo UDP com retransmissão automática.
              Recomendado pra câmeras em rede móvel/Wi-Fi instável.
              Latência de ~500ms (configurável).
            </div>
          )}
        </div>
      )}

      {/* Outras opções */}
      <div className="mt-5 p-4 rounded-xl bg-slate-900/50 border border-slate-800">
        <div className="text-xs font-bold text-slate-300 mb-2">⚡ Outras opções (em breve)</div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          <span className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50">📋 Importar lote (CSV)</span>
          <span className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50">🔍 Auto-discovery ONVIF</span>
          <span className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50">📡 QR code (box-installer)</span>
        </div>
      </div>
    </>
  )
}

function ModeCard({
  selected, onSelect, icon, accent, recommended, title, subtitle, features,
}: {
  selected: boolean
  onSelect: () => void
  icon: React.ReactNode
  accent: 'amber' | 'violet'
  recommended?: boolean
  title: string
  subtitle: string
  features: string[]
}) {
  const colorMap = accent === 'amber' ? {
    border: 'border-amber-500/50', selectedBorder: 'border-amber-500', bg: 'bg-amber-500/5',
    iconBg: 'bg-amber-500/20', iconColor: 'text-amber-300', check: 'text-amber-400',
  } : {
    border: 'border-violet-500/30', selectedBorder: 'border-violet-500', bg: 'bg-violet-500/5',
    iconBg: 'bg-violet-500/20', iconColor: 'text-violet-300', check: 'text-violet-400',
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'text-left p-5 rounded-2xl border-2 relative transition',
        colorMap.border, colorMap.bg,
        selected ? `ring-2 ring-offset-2 ring-offset-slate-900 ${colorMap.selectedBorder.replace('border-', 'ring-')}` : 'hover:border-opacity-100',
      )}
    >
      {recommended && (
        <span className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full bg-amber-500 text-black text-[10px] font-bold uppercase">
          Recomendado
        </span>
      )}
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', colorMap.iconBg, colorMap.iconColor)}>
          {icon}
        </div>
        <div>
          <div className="text-base font-bold text-white">{title}</div>
          <div className={cn('text-[10px] uppercase tracking-wider font-mono', colorMap.iconColor)}>{subtitle}</div>
        </div>
      </div>
      <ul className="space-y-1.5 text-xs text-slate-300">
        {features.map((f, i) => (
          <li key={i} className="flex gap-2">
            <span className={f.startsWith('⚠') ? 'text-amber-400' : colorMap.check}>
              {f.startsWith('⚠') ? '⚠' : '✓'}
            </span>
            <span>{f.replace(/^⚠ /, '')}</span>
          </li>
        ))}
      </ul>
    </button>
  )
}

interface Step2Props {
  deployMode: DeployMode
  protocol: Protocol
  name: string
  setName: (v: string) => void
  rtspMainUrl: string
  setRtspMainUrl: (v: string) => void
  rtspUsername: string
  setRtspUsername: (v: string) => void
  rtspPassword: string
  setRtspPassword: (v: string) => void
}

function Step2Config(p: Step2Props) {
  const isPush = p.protocol === 'RTMP_PUSH'
  const isP2P = p.protocol === 'P2P'

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-1 block">
          Nome da câmera
        </label>
        <input
          type="text"
          value={p.name}
          onChange={e => p.setName(e.target.value)}
          placeholder="Ex: Porta principal, Estacionamento sul..."
          className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:border-rose-500/50 focus:outline-none"
        />
      </div>

      {!isPush && !isP2P && (
        <>
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-1 block">
              URL principal {p.protocol === 'ONVIF' ? '(endpoint ONVIF)' : '(RTSP)'}
            </label>
            <input
              type="text"
              value={p.rtspMainUrl}
              onChange={e => p.setRtspMainUrl(e.target.value)}
              placeholder={p.protocol === 'ONVIF' ? 'http://192.168.1.100:8000/onvif/device_service' : 'rtsp://192.168.1.100:554/stream1'}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white font-mono placeholder:text-slate-500 focus:border-rose-500/50 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-1 block">
                Usuário
              </label>
              <input
                type="text"
                value={p.rtspUsername}
                onChange={e => p.setRtspUsername(e.target.value)}
                placeholder="admin"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:border-rose-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-1 block">
                Senha
              </label>
              <input
                type="password"
                value={p.rtspPassword}
                onChange={e => p.setRtspPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:border-rose-500/50 focus:outline-none"
              />
            </div>
          </div>
        </>
      )}

      {isPush && (
        <div className="p-4 rounded-xl bg-violet-500/5 border border-violet-500/30">
          <div className="text-sm text-violet-300 font-bold mb-1">RTMP Push — chave gerada automaticamente</div>
          <div className="text-xs text-slate-400">
            Após criar, o sistema gera a URL + stream key únicos. Configure sua câmera/encoder
            para fazer push para essa URL. Cópia disponível no detalhe da câmera.
          </div>
        </div>
      )}

      {isP2P && (
        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/30">
          <div className="text-sm text-amber-300 font-bold mb-1">P2P — em integração</div>
          <div className="text-xs text-slate-400">
            Suporte a HikConnect/EZVIZ via UID será adicionado em breve. Por ora, use ONVIF ou RTSP.
          </div>
        </div>
      )}
    </div>
  )
}

interface Step3Props {
  deployMode: DeployMode
  protocol: Protocol
  name: string
  rtspMainUrl: string
  rtspUsername: string
  edgeNodeId?: string
  error: string | null
  submitting: boolean
}

function Step3Review(p: Step3Props) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-300">
        <strong className="text-white">Confira os dados antes de criar:</strong>
      </div>

      <GlassCard className="p-4 border-emerald-500/20 bg-emerald-500/5">
        <dl className="space-y-2 text-sm">
          <Row label="Nome">{p.name || <span className="italic text-slate-500">(será gerado)</span>}</Row>
          <Row label="Modo">
            <span className={cn('px-2 py-0.5 rounded text-[10px] font-mono uppercase border',
              p.deployMode === 'EDGE_BOX' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-violet-500/20 text-violet-300 border-violet-500/30',
            )}>
              {p.deployMode === 'EDGE_BOX' ? '📦 Via Edge Box' : '🌐 Cloud Direct (avulsa)'}
            </span>
          </Row>
          <Row label="Protocolo">{
            p.protocol === 'RTMP_PUSH' ? 'RTMP push'
          : p.protocol === 'SRT_PUSH'  ? 'SRT push'
          :                              p.protocol
          }</Row>
          {p.deployMode === 'EDGE_BOX' && p.edgeNodeId && <Row label="Edge Box">{p.edgeNodeId.slice(0, 12)}...</Row>}
          {p.protocol !== 'RTMP_PUSH' && p.protocol !== 'SRT_PUSH' && p.protocol !== 'P2P' && <Row label="URL"><span className="font-mono text-xs">{p.rtspMainUrl}</span></Row>}
          {p.rtspUsername && <Row label="Usuário">{p.rtspUsername}</Row>}
        </dl>
      </GlassCard>

      {p.error && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-sm text-rose-300">
          ❌ {p.error}
        </div>
      )}

      <div className="text-xs text-slate-500">
        ℹ️ Ao clicar em "Criar câmera", os dados serão validados pelo backend (RBAC + posse hierárquica).
        Você poderá testar a conectividade RTSP no detalhe da câmera após criação.
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-800/50 pb-2 last:border-0">
      <dt className="text-xs uppercase tracking-wider text-slate-500 font-medium">{label}</dt>
      <dd className="text-sm text-white text-right">{children}</dd>
    </div>
  )
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{label}</div>
      <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
        <span className="flex-1 font-mono text-xs text-emerald-300 truncate">{value}</span>
        <button onClick={copy} className="shrink-0 text-slate-400 hover:text-white transition">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )
}

function Step4Success({ cameraId, rtmpIngestUrl, srtIngestUrl, rtmpStreamKey, protocol, onClose }: {
  cameraId: string | null
  rtmpIngestUrl: string | null
  srtIngestUrl: string | null
  rtmpStreamKey: string | null
  protocol: Protocol
  onClose: () => void
}) {
  const isRtmp = protocol === 'RTMP_PUSH'
  const isSrt  = protocol === 'SRT_PUSH'
  const isPush = isRtmp || isSrt
  return (
    <div className="py-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center shrink-0">
          <Check className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Câmera criada! 🎉</h3>
          <p className="text-xs text-slate-400">
            {cameraId ? <span className="font-mono">{cameraId.slice(0, 20)}…</span> : 'Configure agora na câmera física'}
          </p>
        </div>
      </div>

      {isRtmp && rtmpIngestUrl && rtmpStreamKey ? (
        <div className="mb-4">
          <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/30 mb-3">
            <p className="text-xs text-violet-300 font-bold mb-1">Configure RTMP na câmera</p>
            <p className="text-[11px] text-slate-400">
              Use os dados abaixo para configurar o RTMP push na câmera.
              Na Hikvision: <em>Rede → RTMP</em>. Na Dahua: <em>Rede → Fluxo → RTMP</em>.
              No Larix Broadcaster: <em>Settings → Connections → Add</em>.
            </p>
          </div>
          <CopyField label="URL RTMP (servidor)" value={rtmpIngestUrl} />
          <CopyField label="Stream Key" value={rtmpStreamKey} />
          <p className="text-[11px] text-slate-500 mt-2">
            ⏱ A câmera aparecerá online em ~5-10s após iniciar o push.
          </p>
        </div>
      ) : isSrt && srtIngestUrl && rtmpStreamKey ? (
        <div className="mb-4">
          <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/30 mb-3">
            <p className="text-xs text-violet-300 font-bold mb-1">Configure SRT na câmera</p>
            <p className="text-[11px] text-slate-400">
              SRT é mais robusto que RTMP em redes instáveis (Wi-Fi/4G).
              Use a URL completa abaixo no encoder/Larix —
              o <code className="bg-slate-800 px-1 rounded">streamid</code> e a
              <code className="bg-slate-800 px-1 rounded">latency</code> já vão embutidos.
              Pra latência menor (LAN): trocar <code>latency=500</code> por <code>latency=200</code>.
            </p>
          </div>
          <CopyField label="URL SRT completa" value={srtIngestUrl} />
          <CopyField label="Stream Key (referência)" value={rtmpStreamKey} />
          <p className="text-[11px] text-slate-500 mt-2">
            ⏱ A câmera aparecerá online em ~3-5s após iniciar o push (SRT é mais rápido pra estabelecer).
          </p>
        </div>
      ) : !isPush ? (
        <div className="mb-4 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-slate-400">
          Você pode testar a conectividade RTSP no detalhe da câmera.
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 text-sm text-white transition"
        >
          Fechar
        </button>
        {cameraId && (
          <button
            onClick={() => { window.location.href = `/cameras/${cameraId}` }}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-rose-500 to-violet-500 hover:opacity-90 text-sm font-bold text-white transition flex items-center gap-2"
          >
            Ver detalhe <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/** Botão pequeno para integrar em qualquer lugar */
export function AddCameraButton({
  siteId, edgeNodeId, label = 'Câmera', className, onCreated,
}: {
  siteId?: string
  edgeNodeId?: string
  label?: string
  className?: string
  onCreated?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'px-2 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition text-[11px] inline-flex items-center gap-1',
          className,
        )}
      >
        <Plus className="w-3 h-3" /> {label}
      </button>
      <AddCameraWizard
        open={open}
        onClose={() => setOpen(false)}
        siteId={siteId}
        edgeNodeId={edgeNodeId}
        onCreated={onCreated}
      />
    </>
  )
}
