/**
 * CreateGuestLinkModal — Sprint F.
 *
 * Modal multi-seção (collapsible) pra CLIENTE_ADMIN gerar Magic Link de
 * acesso temporário a um recurso (câmera / clipe / site).
 *
 * Após criar com sucesso, mostra modal de sucesso com URL + PIN + atalhos
 * (copiar, WhatsApp, e-mail). PIN deve ser enviado em canal SEPARADO.
 */
import { useMemo, useState } from 'react'
import {
  X, Link2, Mail, MessageCircle, Copy, Check, AlertTriangle, Camera, Building2, FileVideo,
  Calendar, Shield, Eye, Download, Loader2, KeyRound, Send,
} from 'lucide-react'
import {
  createGuestLink, useCameras, useSites,
  type CreateGuestLinkPayload, type CreateGuestLinkResponse,
} from '../../api/client'
import { useUiToast } from '../Toast'
import { formatApiError } from '../../api/client'

type Section = 'identity' | 'scope' | 'access' | 'validity' | 'security'

interface Props {
  onClose: () => void
  onCreated: () => void
}

type ScopeKind = 'camera' | 'clip' | 'site'

const VALIDITY_PRESETS = [
  { id: 'PT1H',  label: '1 hora' },
  { id: 'PT4H',  label: '4 horas' },
  { id: 'PT24H', label: '24 horas' },
  { id: 'P7D',   label: '7 dias' },
] as const

export function CreateGuestLinkModal({ onClose, onCreated }: Props) {
  const toast = useUiToast()
  const [open, setOpen] = useState<Set<Section>>(new Set(['identity', 'scope']))
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CreateGuestLinkResponse | null>(null)

  // Section 1 — Identidade
  const [guestName, setGuestName]   = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [purpose, setPurpose]       = useState('')

  // Section 2 — Escopo
  const [scopeKind, setScopeKind]       = useState<ScopeKind>('camera')
  const [cameraId, setCameraId]         = useState('')
  const [siteId, setSiteId]             = useState('')
  const [recordingClipId, setClipId]    = useState('')

  // Section 3 — Acesso
  const [canViewLive, setCanLive]           = useState(true)
  const [canViewRecording, setCanRecording] = useState(true)
  const [canDownload, setCanDownload]       = useState(false)
  const [hasWindow, setHasWindow]           = useState(false)
  const [recordingFrom, setRecordingFrom]   = useState('')
  const [recordingTo, setRecordingTo]       = useState('')

  // Section 4 — Validade
  const [validityPreset, setValidityPreset] = useState<string>('PT24H')
  const [customValidUntil, setCustomValid]  = useState<string>('')
  const [maxUses, setMaxUses]               = useState<number>(1)

  // Section 5 — Segurança
  const [requirePin, setRequirePin]   = useState(false)
  const [pinMode, setPinMode]         = useState<'auto' | 'manual'>('auto')
  const [pinManual, setPinManual]     = useState('')
  const [allowedIpCidr, setIpCidr]    = useState('')
  const [watermarkText, setWatermark] = useState('')
  const [notifyOnAccess, setNotify]   = useState(true)

  const { data: camerasData }  = useCameras()
  const { data: sitesData }    = useSites()
  const cameras: { id: string; name: string }[] = camerasData?.cameras ?? camerasData ?? []
  const sites = sitesData?.sites ?? []

  const toggleSection = (s: Section) => {
    const next = new Set(open)
    if (next.has(s)) next.delete(s)
    else next.add(s)
    setOpen(next)
  }

  const canSubmit = useMemo(() => {
    if (!guestName.trim() || !purpose.trim()) return false
    if (scopeKind === 'camera' && !cameraId) return false
    if (scopeKind === 'site'   && !siteId)   return false
    if (scopeKind === 'clip'   && !recordingClipId.trim()) return false
    if (validityPreset === 'custom' && !customValidUntil) return false
    if (requirePin && pinMode === 'manual' && !/^\d{4,8}$/.test(pinManual)) return false
    if (hasWindow && (!recordingFrom || !recordingTo)) return false
    return !submitting
  }, [
    guestName, purpose, scopeKind, cameraId, siteId, recordingClipId,
    validityPreset, customValidUntil, requirePin, pinMode, pinManual,
    hasWindow, recordingFrom, recordingTo, submitting,
  ])

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const scope: CreateGuestLinkPayload['scope'] =
        scopeKind === 'camera' ? { kind: 'camera', cameraId } :
        scopeKind === 'site'   ? { kind: 'site',   siteId } :
                                 { kind: 'clip',   recordingClipId: recordingClipId.trim() }

      const payload: CreateGuestLinkPayload = {
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim() || null,
        guestPhone: guestPhone.trim() || null,
        purpose: purpose.trim(),
        scope,
        canViewLive,
        canViewRecording,
        canDownload,
        recordingFrom: hasWindow && recordingFrom ? new Date(recordingFrom).toISOString() : null,
        recordingTo:   hasWindow && recordingTo   ? new Date(recordingTo).toISOString()   : null,
        validUntil: validityPreset === 'custom'
          ? new Date(customValidUntil).toISOString()
          : validityPreset,
        maxUses,
        pin: requirePin ? (pinMode === 'auto' ? 'auto' : pinManual) : null,
        allowedIpCidr: allowedIpCidr.trim() || null,
        watermarkText: watermarkText.trim() || null,
        notifyOnAccess,
      }

      const res = await createGuestLink(payload)
      setResult(res)
      onCreated()
    } catch (err) {
      toast.error({ title: 'Não foi possível gerar o link', description: formatApiError(err) })
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return <GuestLinkSuccessModal result={result} guestName={guestName} purpose={purpose} onClose={onClose} />
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
         onClick={onClose}>
      <div className="relative w-full max-w-2xl my-8 bg-slate-900 border border-cyan-500/30 rounded-2xl shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
              <Link2 className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Gerar link de acesso convidado</h2>
              <p className="text-xs text-slate-400">Acesso temporário e auditável (LGPD)</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* ───────────── 1. Identidade ───────────── */}
          <Accordion title="① Identificação do convidado" open={open.has('identity')} onToggle={() => toggleSection('identity')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Nome *">
                <input value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="Dr. João Silva (advogado)" className={inputCls} />
              </Field>
              <Field label="E-mail">
                <input type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)} placeholder="advogado@silva.adv.br" className={inputCls} />
              </Field>
              <Field label="Telefone (WhatsApp)">
                <input value={guestPhone} onChange={e => setGuestPhone(e.target.value)} placeholder="(11) 99999-9999" className={inputCls} />
              </Field>
              <Field label="Motivo * (LGPD)" full>
                <input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Investigação processo 12345/2026" className={inputCls} />
              </Field>
            </div>
          </Accordion>

          {/* ───────────── 2. Escopo ───────────── */}
          <Accordion title="② O que liberar" open={open.has('scope')} onToggle={() => toggleSection('scope')}>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <RadioPill label="1 câmera"     icon={Camera}     selected={scopeKind === 'camera'} onClick={() => setScopeKind('camera')} />
                <RadioPill label="1 clipe"      icon={FileVideo}  selected={scopeKind === 'clip'}   onClick={() => setScopeKind('clip')} />
                <RadioPill label="1 site"       icon={Building2}  selected={scopeKind === 'site'}   onClick={() => setScopeKind('site')} />
              </div>
              {scopeKind === 'camera' && (
                <Field label="Câmera">
                  <select value={cameraId} onChange={e => setCameraId(e.target.value)} className={inputCls}>
                    <option value="">— escolha uma câmera —</option>
                    {cameras.map((c: { id: string; name: string }) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              {scopeKind === 'site' && (
                <Field label="Site">
                  <select value={siteId} onChange={e => setSiteId(e.target.value)} className={inputCls}>
                    <option value="">— escolha um site —</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              )}
              {scopeKind === 'clip' && (
                <Field label="ID do clipe (Bookmark ou RecordingSegment)">
                  <input value={recordingClipId} onChange={e => setClipId(e.target.value)} placeholder="uuid do bookmark/segmento" className={inputCls} />
                </Field>
              )}
            </div>
          </Accordion>

          {/* ───────────── 3. Tipo de acesso ───────────── */}
          <Accordion title="③ Tipo de acesso" open={open.has('access')} onToggle={() => toggleSection('access')}>
            <div className="space-y-2">
              <CheckboxRow icon={Eye}      label="Ver ao vivo"        checked={canViewLive}      onChange={setCanLive} />
              <CheckboxRow icon={FileVideo}label="Ver gravação"       checked={canViewRecording} onChange={setCanRecording} />
              <CheckboxRow icon={Download} label="Permitir download"  checked={canDownload}      onChange={setCanDownload} />

              {canViewRecording && (
                <div className="mt-2 pl-7">
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={hasWindow} onChange={e => setHasWindow(e.target.checked)} />
                    Restringir gravação a uma janela específica
                  </label>
                  {hasWindow && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <Field label="De">
                        <input type="datetime-local" value={recordingFrom} onChange={e => setRecordingFrom(e.target.value)} className={inputCls} />
                      </Field>
                      <Field label="Até">
                        <input type="datetime-local" value={recordingTo} onChange={e => setRecordingTo(e.target.value)} className={inputCls} />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Accordion>

          {/* ───────────── 4. Validade ───────────── */}
          <Accordion title="④ Validade" open={open.has('validity')} onToggle={() => toggleSection('validity')}>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {VALIDITY_PRESETS.map(p => (
                  <RadioPill key={p.id} label={p.label} icon={Calendar} selected={validityPreset === p.id} onClick={() => setValidityPreset(p.id)} />
                ))}
                <RadioPill label="Custom" icon={Calendar} selected={validityPreset === 'custom'} onClick={() => setValidityPreset('custom')} />
              </div>
              {validityPreset === 'custom' && (
                <Field label="Expira em">
                  <input type="datetime-local" value={customValidUntil} onChange={e => setCustomValid(e.target.value)} className={inputCls} />
                </Field>
              )}
              <Field label="Máximo de usos">
                <input type="number" min={1} max={100} value={maxUses} onChange={e => setMaxUses(Math.max(1, parseInt(e.target.value || '1', 10)))} className={inputCls} />
              </Field>
            </div>
          </Accordion>

          {/* ───────────── 5. Segurança opcional ───────────── */}
          <Accordion title="⑤ Segurança adicional (opcional)" open={open.has('security')} onToggle={() => toggleSection('security')}>
            <div className="space-y-3">
              <CheckboxRow icon={KeyRound} label="Exigir PIN (2ª camada)" checked={requirePin} onChange={setRequirePin} />
              {requirePin && (
                <div className="pl-7 space-y-2">
                  <div className="flex gap-2">
                    <RadioPill label="Gerar automaticamente" icon={Shield} selected={pinMode === 'auto'}   onClick={() => setPinMode('auto')} />
                    <RadioPill label="Definir manualmente"   icon={Shield} selected={pinMode === 'manual'} onClick={() => setPinMode('manual')} />
                  </div>
                  {pinMode === 'manual' && (
                    <Field label="PIN (4 a 8 dígitos)">
                      <input value={pinManual} onChange={e => setPinManual(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="4567" className={inputCls} />
                    </Field>
                  )}
                </div>
              )}
              <Field label="Restringir a IP/CIDR (ex: 200.10.1.0/24)">
                <input value={allowedIpCidr} onChange={e => setIpCidr(e.target.value)} placeholder="opcional" className={inputCls} />
              </Field>
              <Field label="Texto da marca d'água (default: nome do convidado)">
                <input value={watermarkText} onChange={e => setWatermark(e.target.value)} placeholder="Auto: usa o nome do convidado + timestamp + IP" className={inputCls} />
              </Field>
              <CheckboxRow icon={Send} label="Notificar admin quando convidado acessar" checked={notifyOnAccess} onChange={setNotify} />
            </div>
          </Accordion>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-2 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong>LGPD:</strong> O motivo será registrado em todo acesso. Envie o link e o PIN
              por <strong>canais separados</strong> (link por WhatsApp, PIN por SMS, por exemplo).
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-semibold text-slate-300 border border-white/10">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            Gerar link
          </button>
        </footer>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub: Modal de sucesso
// ──────────────────────────────────────────────────────────────────────────────
function GuestLinkSuccessModal({ result, guestName, purpose, onClose }: {
  result: CreateGuestLinkResponse
  guestName: string
  purpose: string
  onClose: () => void
}) {
  const toast = useUiToast()
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedPin, setCopiedPin] = useState(false)

  function copy(text: string, kind: 'url' | 'pin') {
    void navigator.clipboard.writeText(text)
    if (kind === 'url') { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 1500) }
    else                { setCopiedPin(true); setTimeout(() => setCopiedPin(false), 1500) }
    toast.success({ title: kind === 'url' ? 'Link copiado' : 'PIN copiado' })
  }

  const waText = encodeURIComponent(
    `Olá! Acesse o vídeo: ${result.url}\nMotivo: ${purpose}\n\n(O PIN vai por canal separado.)`
  )
  const mailto = `mailto:?subject=${encodeURIComponent(`Acesso temporário · ${guestName}`)}&body=${waText}`

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-slate-900 border border-emerald-500/40 rounded-2xl shadow-2xl">
        <header className="px-6 py-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <Check className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Link gerado!</h2>
            <p className="text-xs text-slate-400">Mostre essas informações ao convidado agora — não aparecerão novamente</p>
          </div>
        </header>
        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400">URL do link</label>
            <div className="flex items-stretch gap-2">
              <input readOnly value={result.url} className={inputCls + ' font-mono text-xs'} />
              <button onClick={() => copy(result.url, 'url')} className="px-3 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold flex items-center gap-1">
                {copiedUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noopener noreferrer"
                 className="flex-1 px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2">
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </a>
              <a href={mailto}
                 className="flex-1 px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-2">
                <Mail className="w-4 h-4" /> E-mail
              </a>
            </div>
          </div>

          {result.pin && (
            <div className="space-y-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <label className="text-xs font-semibold text-amber-300 flex items-center gap-1">
                <KeyRound className="w-3.5 h-3.5" /> PIN de acesso
              </label>
              <div className="flex items-stretch gap-2">
                <input readOnly value={result.pin} className={inputCls + ' font-mono text-2xl tracking-[0.5em] text-center text-amber-300'} />
                <button onClick={() => copy(result.pin!, 'pin')} className="px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-900 text-xs font-bold flex items-center gap-1">
                  {copiedPin ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-amber-200/80">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                Envie o PIN por <strong>canal separado</strong> (SMS, ligação).
              </p>
            </div>
          )}

          <div className="text-xs text-slate-400 space-y-1">
            <div>Expira: <span className="text-white font-semibold">{new Date(result.validUntil).toLocaleString('pt-BR')}</span></div>
            <div>Convidado: <span className="text-white">{guestName}</span></div>
            <div>Motivo: <span className="text-white">{purpose}</span></div>
          </div>
        </div>
        <footer className="px-6 py-4 border-t border-white/10 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-sm font-bold text-white">
            Pronto
          </button>
        </footer>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// UI primitives
// ──────────────────────────────────────────────────────────────────────────────
const inputCls =
  'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40'

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? 'sm:col-span-2 space-y-1' : 'space-y-1'}>
      <label className="text-xs font-semibold text-slate-400">{label}</label>
      {children}
    </div>
  )
}

function Accordion({ title, open, onToggle, children }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="border border-white/10 rounded-xl bg-white/5">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-white">{title}</span>
        <span className="text-xs text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

function RadioPill({ label, icon: Icon, selected, onClick }: {
  label: string; icon: React.ComponentType<{ className?: string }>; selected: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition ${
        selected
          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
          : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
      }`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function CheckboxRow({ icon: Icon, label, checked, onChange }: {
  icon: React.ComponentType<{ className?: string }>; label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-white/5">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <Icon className="w-4 h-4 text-cyan-400" />
      <span className="text-sm text-slate-200">{label}</span>
    </label>
  )
}
