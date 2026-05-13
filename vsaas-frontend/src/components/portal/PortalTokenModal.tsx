/**
 * PortalTokenModal — Sprint CF.4 (Portal Cliente-Final)
 *
 * Modal pra um cliente final específico onde o integrador:
 *   1. Lista magic-links existentes (status: pending/active/consumed/expired/revoked)
 *   2. Emite novo magic-link (form: label + ttlHours + singleUse)
 *   3. Revoga tokens ativos (soft delete — preserva trilha de auditoria)
 *
 * Importante:
 *   - O plaintext do token aparece UMA ÚNICA VEZ logo após o mint.
 *     Se o usuário fechar o modal, a única forma de recuperar é gerar outro.
 *   - Por isso a UX exige "copiar para clipboard" explícito + warning visual.
 *   - QR Code gerado via qrcode.react — integradores podem exibir a tela
 *     ou imprimir pra que o cliente escaneie diretamente (ex.: síndico, zelador).
 */
import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import {
  X, Loader2, Plus, Copy, Check, AlertTriangle, Trash2, Link as LinkIcon,
  Clock, ShieldOff, ShieldCheck, Tag, QrCode, Download, Eye, EyeOff,
} from 'lucide-react'
import {
  usePortalTokens, mintPortalToken, revokePortalToken, formatApiError,
  type PortalTokenRow, type PortalTokenMintResponse,
  type ClienteFinalRow,
} from '../../api/client'
import { useSWRConfig } from 'swr'
import { cn } from '../../lib/utils'

interface Props {
  cliente: ClienteFinalRow
  onClose: () => void
}

// Distância humana (ex.: "em 6h", "expirou há 2d") — sem date-fns pra evitar dep.
function relativeTime(iso: string): string {
  const ms   = new Date(iso).getTime() - Date.now()
  const abs  = Math.abs(ms)
  const sec  = Math.round(abs / 1000)
  const min  = Math.round(sec / 60)
  const hr   = Math.round(min / 60)
  const day  = Math.round(hr / 24)
  const past = ms < 0
  let val: string
  if (sec < 60)  val = `${sec}s`
  else if (min < 60) val = `${min}min`
  else if (hr  < 24) val = `${hr}h`
  else               val = `${day}d`
  return past ? `há ${val}` : `em ${val}`
}

const STATUS_STYLES: Record<PortalTokenRow['status'], { label: string; cls: string; icon: any }> = {
  pending:  { label: 'Pendente',  cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',     icon: Clock },
  active:   { label: 'Em uso',    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: ShieldCheck },
  consumed: { label: 'Consumido', cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30',     icon: ShieldOff },
  expired:  { label: 'Expirado',  cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',         icon: ShieldOff },
  revoked:  { label: 'Revogado',  cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',         icon: ShieldOff },
}

export function PortalTokenModal({ cliente, onClose }: Props) {
  const { data, error, isLoading, mutate } = usePortalTokens(cliente.id)
  const { mutate: globalMutate } = useSWRConfig()

  const [showForm, setShowForm] = useState(false)
  const [minted, setMinted]     = useState<PortalTokenMintResponse['token'] | null>(null)

  // form state
  const [label, setLabel]         = useState('')
  const [ttlHours, setTtlHours]   = useState(24)
  const [singleUse, setSingleUse] = useState(false)
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState<string | null>(null)

  async function submitMint() {
    setBusy(true); setErr(null); setMinted(null)
    try {
      const opts: { ttlHours?: number; singleUse?: boolean; label?: string } = {
        ttlHours, singleUse,
      }
      if (label.trim()) opts.label = label.trim()
      const resp = await mintPortalToken(cliente.id, opts)
      setMinted(resp.token)
      // Reset form (mas mantém modal aberto pra mostrar plaintext)
      setLabel(''); setSingleUse(false); setTtlHours(24)
      setShowForm(false)
      await mutate()
    } catch (e) {
      setErr(formatApiError(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(tokenId: string) {
    if (!window.confirm('Revogar este magic-link? Acessos em andamento continuam até a sessão JWT expirar.')) return
    try {
      await revokePortalToken(cliente.id, tokenId)
      await mutate()
      // invalida lista do dashboard também — caso alguém esteja exibindo contagem
      await globalMutate('/clientes-finais')
    } catch (e) {
      window.alert(formatApiError(e))
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-200 dark:border-white/5">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-cyan-300" />
              Portal — {cliente.tradeName ?? cliente.name}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Magic-links pro cliente final acessar o portal white-label.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Plaintext do token recém-criado — aparece uma única vez */}
        {minted && <MintedTokenPanel token={minted} onDismiss={() => setMinted(null)} />}

        {/* Lista de tokens */}
        {isLoading && (
          <div className="py-10 text-center">
            <Loader2 className="w-5 h-5 mx-auto animate-spin text-cyan-400" />
            <p className="text-xs text-slate-500 mt-2">Carregando tokens…</p>
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formatApiError(error)}</span>
          </div>
        )}
        {!isLoading && !error && data && (
          <>
            {data.tokens.length === 0 && !showForm && !minted && (
              <div className="py-8 text-center border border-dashed border-slate-200 dark:border-white/10 rounded-xl">
                <LinkIcon className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Nenhum magic-link emitido ainda.</p>
                <p className="text-xs text-slate-600 mt-1">
                  Gere um pra que o cliente final consiga abrir o portal.
                </p>
              </div>
            )}
            {data.tokens.length > 0 && (
              <ul className="space-y-2 mb-4">
                {data.tokens.map(t => <TokenRow key={t.id} token={t} onRevoke={handleRevoke} />)}
              </ul>
            )}
          </>
        )}

        {/* Form mint */}
        {showForm ? (
          <div className="mt-4 p-4 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-white/10 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-medium mb-1.5">
                  Rótulo (opcional)
                </span>
                <input
                  className={inputCls}
                  placeholder="Ex.: Diretor Operações"
                  maxLength={80}
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-medium mb-1.5">
                  Expira em (horas) — máx 168
                </span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  className={inputCls}
                  value={ttlHours}
                  onChange={e => setTtlHours(Math.max(1, Math.min(168, Number(e.target.value) || 1)))}
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={singleUse}
                onChange={e => setSingleUse(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-slate-100 dark:bg-slate-800"
              />
              <span>Uso único — invalida após o primeiro acesso</span>
            </label>
            {err && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{err}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setShowForm(false); setErr(null) }}
                className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                onClick={submitMint}
                disabled={busy}
                className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 rounded-lg text-sm font-medium transition disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Gerar magic-link
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2.5 border border-dashed border-cyan-500/30 hover:border-cyan-500/60 hover:bg-cyan-500/5 text-cyan-300 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            Novo magic-link
          </button>
        )}
      </motion.div>
    </motion.div>
  )
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function TokenRow({ token, onRevoke }: { token: PortalTokenRow; onRevoke: (id: string) => void }) {
  const status = STATUS_STYLES[token.status]
  const StatusIcon = status.icon
  const canRevoke = token.status === 'pending' || token.status === 'active'
  return (
    <li className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800/30 border border-slate-200 dark:border-white/5 flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {token.label ? (
            <span className="text-sm font-medium text-white flex items-center gap-1.5">
              <Tag className="w-3 h-3 text-slate-500" />
              {token.label}
            </span>
          ) : (
            <span className="text-sm font-mono text-slate-400">#{token.id.slice(0, 8)}</span>
          )}
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1', status.cls)}>
            <StatusIcon className="w-2.5 h-2.5" />
            {status.label}
          </span>
          {token.singleUse && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
              uso único
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
          <span>Expira {relativeTime(token.expiresAt)}</span>
          {token.lastUsedAt && <span>· Usado {relativeTime(token.lastUsedAt)}</span>}
          <span>· Criado {relativeTime(token.createdAt)}</span>
        </div>
      </div>
      {canRevoke && (
        <button
          onClick={() => onRevoke(token.id)}
          className="p-1.5 rounded text-rose-300 hover:bg-rose-500/10 transition shrink-0"
          title="Revogar"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  )
}

function MintedTokenPanel({
  token, onDismiss,
}: { token: NonNullable<PortalTokenMintResponse['token']>; onDismiss: () => void }) {
  const [copiedField, setCopiedField] = useState<'link' | 'token' | null>(null)
  const [showQr, setShowQr]           = useState(true)
  const qrRef                          = useRef<SVGSVGElement>(null)

  async function copy(field: 'link' | 'token', value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      window.prompt('Copie manualmente:', value)
    }
  }

  function downloadQr() {
    if (!qrRef.current) return
    const svg    = qrRef.current
    const xml    = new XMLSerializer().serializeToString(svg)
    const blob   = new Blob([xml], { type: 'image/svg+xml' })
    const url    = URL.createObjectURL(blob)
    const a      = document.createElement('a')
    a.href       = url
    a.download   = 'portal-qrcode.svg'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mb-4 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/30">
      {/* Header */}
      <div className="flex items-start gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-emerald-200">Magic-link emitido</p>
          <p className="text-[11px] text-emerald-300/70 mt-0.5">
            <strong>Aparece uma única vez.</strong> Copie o link ou escaneie o QR Code
            e envie ao cliente final. Se fechar este painel terá que gerar outro.
          </p>
        </div>
        <button onClick={onDismiss} className="text-emerald-300 hover:text-white transition">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* QR Code */}
      <div className="mb-3 rounded-xl border border-emerald-500/20 bg-black/30 overflow-hidden">
        {/* Toggle bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-emerald-500/10">
          <span className="flex items-center gap-1.5 text-[11px] text-emerald-300 font-medium">
            <QrCode className="w-3.5 h-3.5" />
            QR Code de acesso
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={downloadQr}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-emerald-300/70 hover:text-emerald-200 hover:bg-emerald-500/10 transition"
              title="Baixar QR Code como SVG"
            >
              <Download className="w-3 h-3" />
              Baixar SVG
            </button>
            <button
              onClick={() => setShowQr(v => !v)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-emerald-300/70 hover:text-emerald-200 hover:bg-emerald-500/10 transition"
            >
              {showQr ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showQr ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        {/* QR Code body */}
        {showQr && (
          <div className="flex flex-col items-center gap-3 py-5 px-4">
            {/* QR with white padding so scanners leiam corretamente */}
            <div className="p-3 rounded-xl bg-white shadow-lg shadow-black/40">
              <QRCodeSVG
                ref={qrRef}
                value={token.magicLink}
                size={192}
                level="M"
                bgColor="#ffffff"
                fgColor="#0f172a"
                includeMargin={false}
                imageSettings={{
                  src: '',
                  height: 0,
                  width: 0,
                  excavate: false,
                }}
              />
            </div>
            <p className="text-[10px] text-emerald-300/50 text-center max-w-[220px]">
              Mostre esta tela ao cliente ou imprima o SVG. O QR Code abre
              diretamente o portal sem precisar de login.
            </p>
          </div>
        )}
      </div>

      {/* Copy fields */}
      <CopyField
        label="Link completo (envie por email / WhatsApp)"
        value={token.magicLink}
        copied={copiedField === 'link'}
        onCopy={() => copy('link', token.magicLink)}
      />
      <div className="h-2" />
      <CopyField
        label="Token apenas (debug / re-uso manual)"
        value={token.plaintext}
        copied={copiedField === 'token'}
        onCopy={() => copy('token', token.plaintext)}
        mono
      />
    </div>
  )
}

function CopyField({
  label, value, copied, onCopy, mono,
}: { label: string; value: string; copied: boolean; onCopy: () => void; mono?: boolean }) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-wider text-emerald-300/80 font-medium mb-1">
        {label}
      </span>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          onClick={e => (e.target as HTMLInputElement).select()}
          className={cn(
            'flex-1 px-2.5 py-1.5 bg-space-950/60 border border-emerald-500/20 rounded text-xs text-emerald-100',
            mono && 'font-mono',
          )}
        />
        <button
          onClick={onCopy}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-200 rounded text-xs font-medium transition shrink-0"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}

const inputCls =
  'w-full px-3 py-2 bg-white dark:bg-space-800/40 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 ' +
  'focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition'
