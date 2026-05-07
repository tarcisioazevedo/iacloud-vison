/**
 * OnboardingClientePage — Wizard de 5 steps pra onboarding completo de um
 * novo cliente final pelo INTEGRADOR_ADMIN.
 *
 * Steps (commit incremental — falha em 1 step não desfaz os anteriores):
 *   1. Cliente          → POST /clientes-finais
 *   2. Site principal   → POST /sites + PATCH /clientes-finais/:id (storage quota)
 *   3. Edge Box (opt)   → POST /edge-nodes/provision (skip-able)
 *   4. Câmeras          → POST /cameras/probe (validar) + POST /cameras (criar)
 *   5. Admin do cliente → POST /users/invite role=CLIENTE_ADMIN
 *
 * Step 4 substitui a necessidade do "Live no menu" pra setup: cada validação
 * gera entrada de audit `STREAM_VALIDATION` com finalidade de "onboarding".
 *
 * Fluxo: dados ficam no state do componente. Cada Next chama API; em sucesso
 * persiste id retornado e avança. Em erro mostra mensagem e mantém step.
 */
import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Rocket, ChevronRight, ChevronLeft, Check, X, Plus, Loader2,
  Building2, Cpu, Camera as CameraIcon, UserPlus, Trash2, AlertTriangle,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { api, formatApiError } from '../api/client'
import { cn } from '../lib/utils'

const VERTICALS = [
  { value: 'RETAIL',        label: 'Varejo' },
  { value: 'SHOPPING',      label: 'Shopping' },
  { value: 'EDUCATION',     label: 'Educação' },
  { value: 'INDUSTRY',      label: 'Indústria' },
  { value: 'LOGISTICS',     label: 'Logística' },
  { value: 'PARKING',       label: 'Estacionamento' },
  { value: 'CONDOMINIUM',   label: 'Condomínio' },
  { value: 'PUBLIC_SAFETY', label: 'Segurança Pública' },
  { value: 'OTHER',         label: 'Outro' },
] as const

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Recife',
  'America/Bahia',
  'America/Fortaleza',
  'America/Belem',
  'America/Cuiaba',
  'America/Porto_Velho',
  'America/Rio_Branco',
  'America/Noronha',
]

interface ClienteForm {
  name: string
  tradeName: string
  cnpj: string
  email: string
  phone: string
  vertical: typeof VERTICALS[number]['value']
}

interface SiteForm {
  /** UUID local — chave estável da row enquanto o site não foi criado. */
  localId: string
  name: string
  address: string
  city: string
  state: string
  timezone: string
  /** Preenchido após POST /sites. Sites já criados ficam read-only no UI. */
  createdId?: string
}

interface EdgeForm {
  skip: boolean
  name: string
  serialNumber: string
  model: string
}

interface CameraForm {
  id: string  // local uuid (não persistido)
  name: string
  rtspMainUrl: string
  rtspUsername: string
  rtspPassword: string
  // populados após probe/create
  probeStatus?: 'idle' | 'probing' | 'ok' | 'failed'
  probeMessage?: string
  createdId?: string
  createError?: string
}

interface InviteForm {
  name: string
  email: string
}

const STEPS = [
  { idx: 1, label: 'Cliente',     icon: Rocket },
  { idx: 2, label: 'Site',        icon: Building2 },
  { idx: 3, label: 'Edge Box',    icon: Cpu },
  { idx: 4, label: 'Câmeras',     icon: CameraIcon },
  { idx: 5, label: 'Admin',       icon: UserPlus },
] as const

export function OnboardingClientePage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // IDs persistidos depois de cada step
  const [clienteId, setClienteId]     = useState<string | null>(null)
  const [edgeNodeId, setEdgeNodeId]   = useState<string | null>(null)

  const [cliente, setCliente] = useState<ClienteForm>({
    name: '', tradeName: '', cnpj: '', email: '', phone: '', vertical: 'RETAIL',
  })
  // Lista de sites (1+). Casos cobertos: residencial (1 site casa), B2B
  // simples (1 site sede), múltiplos (casa + escritório, ou rede de filiais).
  // Step 3-4 usam o PRIMEIRO site como destino default; sites extras ficam
  // pro integrador adicionar boxes/câmeras depois em /sites.
  const [sites, setSites] = useState<SiteForm[]>([{
    localId: crypto.randomUUID(),
    name: 'Sede', address: '', city: '', state: '', timezone: 'America/Sao_Paulo',
  }])
  // Cota é por cliente final (não por site). Pergunta uma vez só.
  const [storageQuotaGB, setStorageQuotaGB] = useState('100')
  const [edge, setEdge] = useState<EdgeForm>({
    skip: true, name: '', serialNumber: '', model: '',
  })
  const [cameras, setCameras] = useState<CameraForm[]>([])
  const [invite, setInvite] = useState<InviteForm>({ name: '', email: '' })

  // Site principal — onde a box e as câmeras do wizard vão. É sempre o primeiro
  // da lista; integrador pode reordenar arrastando no UI ou criando o de cima
  // primeiro. Sites adicionais ficam pro fluxo regular em /sites.
  const primarySiteId = sites[0]?.createdId ?? null

  // Pré-popula email/name do invite com base no cliente quando entra no step 5
  useEffect(() => {
    if (step === 5 && !invite.email) {
      setInvite({ name: cliente.tradeName || cliente.name, email: cliente.email })
    }
  }, [step, cliente, invite.email])

  // ── Validações por step ────────────────────────────────────────────────
  const canAdvance = useMemo(() => {
    switch (step) {
      case 1: return cliente.name.length >= 2 && /\S+@\S+\.\S+/.test(cliente.email)
      case 2: return sites.length >= 1 && sites.every(s => s.name.trim().length >= 1)
      case 3: return edge.skip || (edge.name.length >= 1 && edge.serialNumber.length >= 1)
      case 4: return cameras.length > 0 && cameras.every(c => !!c.createdId)
      case 5: return invite.name.length >= 2 && /\S+@\S+\.\S+/.test(invite.email)
      default: return false
    }
  }, [step, cliente, sites, edge, cameras, invite])

  // ── Handlers de Next ──────────────────────────────────────────────────
  async function handleStep1Next() {
    setSubmitting(true)
    setError(null)
    try {
      const { data } = await api.post('/clientes-finais', {
        name:      cliente.name,
        tradeName: cliente.tradeName || undefined,
        cnpj:      cliente.cnpj || undefined,
        email:     cliente.email,
        phone:     cliente.phone || undefined,
        vertical:  cliente.vertical,
      })
      setClienteId(data.cliente?.id ?? data.id)
      setStep(2)
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStep2Next() {
    if (!clienteId) return
    setSubmitting(true)
    setError(null)
    try {
      // Cria todos os sites em sequência. Os já criados (createdId) não
      // re-postam — permite voltar pro step 2, adicionar mais e seguir sem
      // duplicar os anteriores.
      const next: SiteForm[] = []
      for (const s of sites) {
        if (s.createdId) { next.push(s); continue }
        const { data } = await api.post('/sites', {
          clienteFinalId: clienteId,
          name:           s.name.trim(),
          address:        s.address || undefined,
          city:           s.city || undefined,
          state:          s.state || undefined,
          timezone:       s.timezone,
        })
        next.push({ ...s, createdId: data.site?.id ?? data.id })
      }
      setSites(next)

      // Cota de storage (opcional, do cliente). Converte GB→bytes string.
      const gb = Number(storageQuotaGB)
      if (Number.isFinite(gb) && gb > 0) {
        const bytes = String(Math.floor(gb * 1024 * 1024 * 1024))
        await api.patch(`/clientes-finais/${clienteId}`, { storageQuotaBytes: bytes })
      }

      setStep(3)
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStep3Next() {
    if (!primarySiteId) return
    if (edge.skip) { setStep(4); return }
    setSubmitting(true)
    setError(null)
    try {
      const { data } = await api.post('/edge-nodes/provision', {
        siteId:       primarySiteId,
        name:         edge.name,
        serialNumber: edge.serialNumber,
        model:        edge.model || undefined,
      })
      setEdgeNodeId(data.edgeNode?.id ?? data.id)
      setStep(4)
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStep5Finish() {
    if (!clienteId) return
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/users/invite', {
        email:           invite.email,
        name:            invite.name,
        role:            'CLIENTE_ADMIN',
        clienteFinalId:  clienteId,
      })
      // Sucesso → redireciona pro detalhe do cliente
      navigate('/clientes-finais', { state: { onboarded: clienteId } })
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Câmeras (step 4): probe + create ──────────────────────────────────
  function addCamera() {
    setCameras(prev => [...prev, {
      id: crypto.randomUUID(), name: '', rtspMainUrl: '', rtspUsername: '', rtspPassword: '',
      probeStatus: 'idle',
    }])
  }

  function removeCamera(id: string) {
    setCameras(prev => prev.filter(c => c.id !== id))
  }

  function updateCamera(id: string, patch: Partial<CameraForm>) {
    setCameras(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  async function probeCamera(c: CameraForm) {
    if (!c.rtspMainUrl) return
    updateCamera(c.id, { probeStatus: 'probing', probeMessage: undefined })
    try {
      const { data } = await api.post('/cameras/probe', { url: c.rtspMainUrl })
      const ok = data?.ok === true || data?.success === true || data?.reachable === true
      updateCamera(c.id, {
        probeStatus: ok ? 'ok' : 'failed',
        probeMessage: ok ? 'Stream alcançável' : (data?.error ?? data?.message ?? 'Stream não responde'),
      })
    } catch (e) {
      updateCamera(c.id, { probeStatus: 'failed', probeMessage: formatApiError(e) })
    }
  }

  async function createCamera(c: CameraForm) {
    if (!primarySiteId) return
    updateCamera(c.id, { createError: undefined })
    try {
      const { data } = await api.post('/cameras', {
        siteId:         primarySiteId,
        edgeNodeId:     edgeNodeId ?? undefined,
        name:           c.name,
        rtspMainUrl:    c.rtspMainUrl,
        rtspUsername:   c.rtspUsername || undefined,
        rtspPassword:   c.rtspPassword || undefined,
        ingestMode:     'RTSP_PULL',
        deploymentMode: edgeNodeId ? 'EDGE_BOX' : 'CLOUD_DIRECT',
      })
      updateCamera(c.id, { createdId: data.camera?.id ?? data.id })
    } catch (e) {
      updateCamera(c.id, { createError: formatApiError(e) })
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6">
      {/* Header + Stepper */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center">
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Onboarding de cliente</h1>
            <p className="text-sm text-slate-500">5 passos · cada passo pode ser revisitado · audit log forte</p>
          </div>
        </div>
        <Stepper currentStep={step} />
      </div>

      <GlassCard className="p-6">
        {/* Step content */}
        {step === 1 && (
          <Step1Cliente cliente={cliente} setCliente={setCliente} disabled={submitting} />
        )}
        {step === 2 && (
          <Step2Sites
            sites={sites}
            setSites={setSites}
            storageQuotaGB={storageQuotaGB}
            setStorageQuotaGB={setStorageQuotaGB}
            disabled={submitting}
            clienteName={cliente.tradeName || cliente.name}
          />
        )}
        {step === 3 && (
          <Step3Edge
            edge={edge}
            setEdge={setEdge}
            disabled={submitting}
            primarySiteName={sites[0]?.name ?? ''}
            extraSitesCount={sites.length - 1}
          />
        )}
        {step === 4 && (
          <Step4Cameras
            cameras={cameras}
            onAdd={addCamera}
            onRemove={removeCamera}
            onUpdate={updateCamera}
            onProbe={probeCamera}
            onCreate={createCamera}
            primarySiteName={sites[0]?.name ?? ''}
            extraSitesCount={sites.length - 1}
            hasBox={!edge.skip}
          />
        )}
        {step === 5 && (
          <Step5Invite invite={invite} setInvite={setInvite} clienteName={cliente.tradeName || cliente.name} disabled={submitting} />
        )}

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-sm text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Footer / nav */}
        <div className="flex items-center justify-between gap-3 pt-5 mt-5 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => step > 1 ? setStep(step - 1) : navigate('/clientes-finais')}
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-700 dark:hover:text-white transition disabled:opacity-50"
          >
            <ChevronLeft className="w-4 h-4" />
            {step > 1 ? 'Voltar' : 'Cancelar'}
          </button>

          {step < 5 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 1) handleStep1Next()
                else if (step === 2) handleStep2Next()
                else if (step === 3) handleStep3Next()
                else if (step === 4) setStep(5)
              }}
              disabled={!canAdvance || submitting}
              className={cn(
                'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white transition',
                canAdvance && !submitting
                  ? 'bg-gradient-to-r from-cyan-500 to-violet-500 hover:opacity-90 shadow-lg shadow-cyan-500/30'
                  : 'bg-slate-700 cursor-not-allowed opacity-50',
              )}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
              {submitting ? 'Salvando…' : step === 4 ? 'Avançar para convite' : 'Próximo'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStep5Finish}
              disabled={!canAdvance || submitting}
              className={cn(
                'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white transition',
                canAdvance && !submitting
                  ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 hover:opacity-90 shadow-lg shadow-emerald-500/30'
                  : 'bg-slate-700 cursor-not-allowed opacity-50',
              )}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {submitting ? 'Finalizando…' : 'Concluir onboarding'}
            </button>
          )}
        </div>
      </GlassCard>
    </div>
  )
}

// ── Stepper ───────────────────────────────────────────────────────────────
function Stepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => {
        const Icon = s.icon
        const done = currentStep > s.idx
        const active = currentStep === s.idx
        return (
          <div key={s.idx} className="flex items-center flex-1">
            <div className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition',
              done   ? 'text-emerald-700 dark:text-emerald-300' :
              active ? 'text-cyan-700 dark:text-cyan-300' :
                       'text-slate-400 dark:text-slate-500',
            )}>
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center shrink-0 border-2',
                done   ? 'bg-emerald-500/20 border-emerald-500/50' :
                active ? 'bg-cyan-500/20 border-cyan-500/60 shadow-md shadow-cyan-500/20' :
                         'bg-slate-200 border-slate-300 dark:bg-slate-800 dark:border-slate-700',
              )}>
                {done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <span className="whitespace-nowrap">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn(
                'flex-1 h-0.5 mx-1 transition',
                done ? 'bg-emerald-500/40' : 'bg-slate-200 dark:bg-slate-800',
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1 — Cliente ──────────────────────────────────────────────────────
function Step1Cliente({ cliente, setCliente, disabled }: {
  cliente: ClienteForm
  setCliente: (c: ClienteForm) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">1 · Identificação do cliente</h2>
      <p className="text-sm text-slate-500 -mt-2">Razão social + contato. CNPJ é opcional, dá pra adicionar depois.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Razão social" required>
          <input
            type="text" value={cliente.name} disabled={disabled}
            onChange={e => setCliente({ ...cliente, name: e.target.value })}
            placeholder="ACME Comércio LTDA"
            className={inputCls}
          />
        </Field>
        <Field label="Nome fantasia">
          <input
            type="text" value={cliente.tradeName} disabled={disabled}
            onChange={e => setCliente({ ...cliente, tradeName: e.target.value })}
            placeholder="ACME"
            className={inputCls}
          />
        </Field>
        <Field label="CNPJ">
          <input
            type="text" value={cliente.cnpj} disabled={disabled}
            onChange={e => setCliente({ ...cliente, cnpj: e.target.value })}
            placeholder="00.000.000/0001-00"
            className={inputCls}
          />
        </Field>
        <Field label="E-mail principal" required>
          <input
            type="email" value={cliente.email} disabled={disabled}
            onChange={e => setCliente({ ...cliente, email: e.target.value })}
            placeholder="contato@acme.com.br"
            className={inputCls}
          />
        </Field>
        <Field label="Telefone">
          <input
            type="tel" value={cliente.phone} disabled={disabled}
            onChange={e => setCliente({ ...cliente, phone: e.target.value })}
            placeholder="(11) 99999-0000"
            className={inputCls}
          />
        </Field>
        <Field label="Vertical de mercado" required>
          <select
            value={cliente.vertical} disabled={disabled}
            onChange={e => setCliente({ ...cliente, vertical: e.target.value as ClienteForm['vertical'] })}
            className={inputCls}
          >
            {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </Field>
      </div>
    </div>
  )
}

// ── Step 2 — Site ─────────────────────────────────────────────────────────
function Step2Sites({
  sites, setSites, storageQuotaGB, setStorageQuotaGB, disabled, clienteName,
}: {
  sites: SiteForm[]
  setSites: (s: SiteForm[]) => void
  storageQuotaGB: string
  setStorageQuotaGB: (v: string) => void
  disabled: boolean
  clienteName: string
}) {
  function updateSite(localId: string, patch: Partial<SiteForm>) {
    setSites(sites.map(s => s.localId === localId ? { ...s, ...patch } : s))
  }
  function addSite() {
    setSites([...sites, {
      localId: crypto.randomUUID(),
      name: '', address: '', city: '', state: '',
      timezone: sites[0]?.timezone ?? 'America/Sao_Paulo',
    }])
  }
  function removeSite(localId: string) {
    if (sites.length <= 1) return
    setSites(sites.filter(s => s.localId !== localId))
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">2 · Sites de {clienteName}</h2>
      <p className="text-sm text-slate-500 -mt-2">
        Cada local físico é um site (casa, escritório, filial, galpão).
        O <strong>primeiro</strong> recebe a edge box e câmeras configuradas nos próximos passos —
        sites adicionais podem receber depois em <code>/sites</code>.
      </p>

      <div className="space-y-3">
        {sites.map((s, idx) => {
          const isPrimary = idx === 0
          const isLocked  = !!s.createdId
          return (
            <div
              key={s.localId}
              className={cn(
                'rounded-lg border p-4 transition',
                isLocked
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : isPrimary
                    ? 'border-cyan-500/40 bg-cyan-500/5'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30',
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                  <span>Site #{idx + 1}</span>
                  {isPrimary && (
                    <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 text-[10px]">
                      principal
                    </span>
                  )}
                  {isLocked && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px]">
                      criado ✓
                    </span>
                  )}
                </div>
                {!isLocked && sites.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSite(s.localId)}
                    disabled={disabled}
                    className="p-1 rounded text-rose-400 hover:bg-rose-500/10 transition disabled:opacity-50"
                    title="Remover site"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Nome do site" required compact>
                  <input
                    type="text" value={s.name} disabled={disabled || isLocked}
                    onChange={e => updateSite(s.localId, { name: e.target.value })}
                    placeholder={isPrimary ? 'Sede · Casa · Galpão A' : 'Filial · Escritório · Casa de Praia'}
                    className={inputCls}
                  />
                </Field>
                <Field label="Endereço" compact>
                  <input
                    type="text" value={s.address} disabled={disabled || isLocked}
                    onChange={e => updateSite(s.localId, { address: e.target.value })}
                    placeholder="Av. Paulista, 1000"
                    className={inputCls}
                  />
                </Field>
                <Field label="Cidade" compact>
                  <input
                    type="text" value={s.city} disabled={disabled || isLocked}
                    onChange={e => updateSite(s.localId, { city: e.target.value })}
                    placeholder="São Paulo"
                    className={inputCls}
                  />
                </Field>
                <Field label="UF" compact>
                  <input
                    type="text" value={s.state} maxLength={2} disabled={disabled || isLocked}
                    onChange={e => updateSite(s.localId, { state: e.target.value.toUpperCase() })}
                    placeholder="SP"
                    className={inputCls}
                  />
                </Field>
                <Field label="Fuso horário" compact>
                  <select
                    value={s.timezone} disabled={disabled || isLocked}
                    onChange={e => updateSite(s.localId, { timezone: e.target.value })}
                    className={inputCls}
                  >
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={addSite}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 text-slate-500 hover:border-cyan-500/60 hover:text-cyan-600 dark:hover:text-cyan-300 transition disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Adicionar outro site
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 mt-4 border-t border-slate-200 dark:border-slate-700">
        <Field label="Cota de storage do cliente (GB)" hint="Total compartilhado entre todos os sites · pode editar depois">
          <input
            type="number" min={1} value={storageQuotaGB} disabled={disabled}
            onChange={e => setStorageQuotaGB(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>
    </div>
  )
}

// ── Step 3 — Edge Box ─────────────────────────────────────────────────────
function Step3Edge({ edge, setEdge, disabled, primarySiteName, extraSitesCount }: {
  edge: EdgeForm
  setEdge: (e: EdgeForm) => void
  disabled: boolean
  primarySiteName: string
  extraSitesCount: number
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">3 · Edge Box (opcional)</h2>
      <p className="text-sm text-slate-500 -mt-2">
        A box vai ficar no site <strong className="text-slate-700 dark:text-slate-200">{primarySiteName || 'principal'}</strong>.
        {extraSitesCount > 0 && (
          <> Pra adicionar boxes nos outros {extraSitesCount} site{extraSitesCount === 1 ? '' : 's'},
          use <code>/edge</code> depois do onboarding.</>
        )}
        {' '}Pode pular este passo e provisionar depois em Frota Edge.
      </p>

      <label className={cn(
        'flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition',
        edge.skip
          ? 'border-amber-500/50 bg-amber-500/5 text-amber-700 dark:text-amber-300'
          : 'border-slate-300 dark:border-slate-700',
      )}>
        <input
          type="checkbox" checked={edge.skip} disabled={disabled}
          onChange={e => setEdge({ ...edge, skip: e.target.checked })}
          className="mt-0.5 w-4 h-4 accent-amber-500 shrink-0"
        />
        <div>
          <div className="text-sm font-bold">Pular este passo — câmeras serão CLOUD_DIRECT</div>
          <div className="text-xs opacity-80 mt-0.5">
            Sem edge box, gravação fica direto na cloud (consome mais banda do cliente).
          </div>
        </div>
      </label>

      {!edge.skip && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nome da box" required>
            <input
              type="text" value={edge.name} disabled={disabled}
              onChange={e => setEdge({ ...edge, name: e.target.value })}
              placeholder="Box-Sede-01"
              className={inputCls}
            />
          </Field>
          <Field label="Serial Number" required>
            <input
              type="text" value={edge.serialNumber} disabled={disabled}
              onChange={e => setEdge({ ...edge, serialNumber: e.target.value })}
              placeholder="ICV-XYZ-001234"
              className={inputCls}
            />
          </Field>
          <Field label="Modelo">
            <input
              type="text" value={edge.model} disabled={disabled}
              onChange={e => setEdge({ ...edge, model: e.target.value })}
              placeholder="ICV-Box-Pro · Hailo8L · 8 cams"
              className={inputCls}
            />
          </Field>
        </div>
      )}
    </div>
  )
}

// ── Step 4 — Câmeras ──────────────────────────────────────────────────────
function Step4Cameras({
  cameras, onAdd, onRemove, onUpdate, onProbe, onCreate,
  primarySiteName, extraSitesCount, hasBox,
}: {
  cameras: CameraForm[]
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, patch: Partial<CameraForm>) => void
  onProbe: (c: CameraForm) => void
  onCreate: (c: CameraForm) => void
  primarySiteName: string
  extraSitesCount: number
  hasBox: boolean
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">4 · Câmeras</h2>
      <p className="text-sm text-slate-500 -mt-2">
        Câmeras vão pro site <strong className="text-slate-700 dark:text-slate-200">{primarySiteName || 'principal'}</strong>
        {hasBox ? <> (vinculadas à edge box configurada no passo 3)</> : <> em modo <code>cloud-direct</code></>}.
        {extraSitesCount > 0 && (
          <> Pra adicionar câmeras nos outros {extraSitesCount} site{extraSitesCount === 1 ? '' : 's'},
          use <code>/cameras</code> depois do onboarding.</>
        )}
        {' '}Use <strong>Validar stream</strong> antes de criar — gera audit log <code>STREAM_VALIDATION</code> com finalidade "onboarding".
      </p>

      <div className="space-y-3">
        {cameras.map((c, idx) => (
          <CameraRow
            key={c.id}
            idx={idx + 1}
            camera={c}
            onUpdate={p => onUpdate(c.id, p)}
            onRemove={() => onRemove(c.id)}
            onProbe={() => onProbe(c)}
            onCreate={() => onCreate(c)}
          />
        ))}

        <button
          type="button"
          onClick={onAdd}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 text-slate-500 hover:border-cyan-500/60 hover:text-cyan-600 dark:hover:text-cyan-300 transition"
        >
          <Plus className="w-4 h-4" />
          Adicionar câmera
        </button>
      </div>
    </div>
  )
}

function CameraRow({ idx, camera, onUpdate, onRemove, onProbe, onCreate }: {
  idx: number
  camera: CameraForm
  onUpdate: (p: Partial<CameraForm>) => void
  onRemove: () => void
  onProbe: () => void
  onCreate: () => void
}) {
  const created = !!camera.createdId
  const probing = camera.probeStatus === 'probing'
  const probeOk = camera.probeStatus === 'ok'
  const probeFail = camera.probeStatus === 'failed'
  const canCreate = !created && camera.name.length > 0 && camera.rtspMainUrl.length > 0
  const canProbe = !created && camera.rtspMainUrl.length > 0 && !probing

  return (
    <div className={cn(
      'rounded-lg border p-4 space-y-3 transition',
      created
        ? 'border-emerald-500/40 bg-emerald-500/5'
        : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30',
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Câmera #{idx} {created && <span className="text-emerald-500">· criada ✓</span>}
        </div>
        {!created && (
          <button onClick={onRemove} className="p-1 rounded hover:bg-rose-500/10 text-rose-400 transition">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Nome" required compact>
          <input
            type="text" value={camera.name} disabled={created}
            onChange={e => onUpdate({ name: e.target.value })}
            placeholder="cam-porta-01"
            className={inputCls}
          />
        </Field>
        <Field label="RTSP URL" required compact>
          <input
            type="text" value={camera.rtspMainUrl} disabled={created}
            onChange={e => onUpdate({ rtspMainUrl: e.target.value, probeStatus: 'idle' })}
            placeholder="rtsp://192.168.1.10:554/stream1"
            className={inputCls}
          />
        </Field>
        <Field label="Usuário RTSP" compact>
          <input
            type="text" value={camera.rtspUsername} disabled={created}
            onChange={e => onUpdate({ rtspUsername: e.target.value })}
            placeholder="admin"
            className={inputCls}
          />
        </Field>
        <Field label="Senha RTSP" compact>
          <input
            type="password" value={camera.rtspPassword} disabled={created}
            onChange={e => onUpdate({ rtspPassword: e.target.value })}
            className={inputCls}
          />
        </Field>
      </div>

      {camera.probeMessage && (
        <div className={cn(
          'text-xs px-3 py-1.5 rounded',
          probeOk   ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
          probeFail ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' :
                      'bg-slate-500/10 text-slate-600',
        )}>
          {probeOk ? '✓ ' : probeFail ? '✗ ' : ''}{camera.probeMessage}
        </div>
      )}

      {camera.createError && (
        <div className="text-xs px-3 py-1.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300">
          ✗ {camera.createError}
        </div>
      )}

      {!created && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button" onClick={onProbe} disabled={!canProbe}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-cyan-500/60 hover:text-cyan-600 dark:hover:text-cyan-300 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {probing ? <Loader2 className="w-3 h-3 animate-spin" /> : '🔍'}
            {probing ? 'Validando…' : 'Validar stream'}
          </button>
          <button
            type="button" onClick={onCreate} disabled={!canCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-cyan-500/15 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/25 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3 h-3" />
            Criar câmera
          </button>
        </div>
      )}
    </div>
  )
}

// ── Step 5 — Convidar admin ───────────────────────────────────────────────
function Step5Invite({ invite, setInvite, clienteName, disabled }: {
  invite: InviteForm
  setInvite: (i: InviteForm) => void
  clienteName: string
  disabled: boolean
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">5 · Convidar admin de {clienteName}</h2>
      <p className="text-sm text-slate-500 -mt-2">
        Esse usuário terá role <code>CLIENTE_ADMIN</code> — pode operar o cockpit do cliente,
        adicionar mais usuários (operador/viewer) e configurar notificações.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Nome" required>
          <input
            type="text" value={invite.name} disabled={disabled}
            onChange={e => setInvite({ ...invite, name: e.target.value })}
            placeholder="Maria Silva"
            className={inputCls}
          />
        </Field>
        <Field label="E-mail" required>
          <input
            type="email" value={invite.email} disabled={disabled}
            onChange={e => setInvite({ ...invite, email: e.target.value })}
            placeholder="maria@cliente.com.br"
            className={inputCls}
          />
        </Field>
      </div>
      <div className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800/50 rounded-lg p-3">
        💌 O sistema gera senha temporária e tenta enviar por SMTP. Caso falhe, a senha
        aparece na resposta e você precisa repassar manualmente.
      </div>
    </div>
  )
}

// ── Helpers visuais ───────────────────────────────────────────────────────
const inputCls = 'w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none disabled:opacity-50'

function Field({ label, hint, required, compact, children }: {
  label: string
  hint?: string
  required?: boolean
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className={cn(
        'block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400',
        compact ? 'mb-1' : 'mb-1.5',
      )}>
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}
