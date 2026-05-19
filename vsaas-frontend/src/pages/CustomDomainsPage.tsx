/**
 * CustomDomainsPage — /custom-domains  (Lote 4)
 *
 * White-label: Integradores e ClientesFinais configuram domínios próprios.
 *
 * Fluxo:
 *   1. Adicionar hostname → backend retorna instruções CNAME + TXT
 *   2. Cliente configura DNS
 *   3. Clicar "Verificar" → backend valida TXT via dns.resolveTxt()
 *   4. Status → ACTIVE
 */
import { useState } from 'react'
import useSWR from 'swr'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Globe, Plus, X, Loader2, AlertTriangle, CheckCircle2,
  RefreshCw, Copy, Check, Trash2, ShieldCheck, Clock, AlertCircle,
} from 'lucide-react'
import { api, formatApiError } from '../api/client'

interface CustomDomain {
  id:             string
  hostname:       string
  status:         'PENDING_DNS' | 'PENDING_VERIFICATION' | 'ACTIVE' | 'ERROR'
  verifyToken:    string
  verifiedAt:     string | null
  lastCheckedAt:  string | null
  lastError:      string | null
  createdAt:      string
}

const STATUS_CONFIG = {
  PENDING_DNS:          { label: 'Aguardando CNAME', color: '#f59e0b', icon: Clock },
  PENDING_VERIFICATION: { label: 'Verificar TXT',    color: '#3b82f6', icon: AlertCircle },
  ACTIVE:               { label: 'Ativo',             color: '#10b981', icon: CheckCircle2 },
  ERROR:                { label: 'Erro DNS',          color: '#ef4444', icon: AlertCircle },
}

const fetcher = (url: string) => api.get(url).then((r) => r.data)

export function CustomDomainsPage() {
  const { data, error, isLoading, mutate } = useSWR<{ domains: CustomDomain[] }>(
    '/custom-domains', fetcher, { refreshInterval: 30_000 },
  )
  const [showAdd,    setShowAdd]    = useState(false)
  const [hostname,   setHostname]   = useState('')
  const [adding,     setAdding]     = useState(false)
  const [addErr,     setAddErr]     = useState('')
  const [addResult,  setAddResult]  = useState<{ cname: any; txt: any } | null>(null)
  const [copied,     setCopied]     = useState<string | null>(null)
  const [verifying,  setVerifying]  = useState<string | null>(null)
  const [deleting,   setDeleting]   = useState<string | null>(null)

  const domains = data?.domains ?? []

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  async function addDomain() {
    if (!hostname.trim()) return
    setAdding(true)
    setAddErr('')
    try {
      const r = await api.post('/custom-domains', { hostname: hostname.trim() })
      setAddResult(r.data.instructions)
      setHostname('')
      mutate()
    } catch (e) {
      setAddErr(formatApiError(e))
    } finally {
      setAdding(false)
    }
  }

  async function verify(id: string) {
    setVerifying(id)
    try {
      await api.post(`/custom-domains/${id}/verify`)
      mutate()
    } finally {
      setVerifying(null)
    }
  }

  async function deleteDomain(id: string) {
    setDeleting(id)
    try {
      await api.delete(`/custom-domains/${id}`)
      mutate()
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="px-6 py-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-indigo-100 dark:bg-indigo-500/20">
            <Globe className="w-5 h-5 text-indigo-600 dark:text-indigo-400"/>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Domínios Personalizados</h1>
            <p className="text-xs text-slate-500">White-label — aponte seu domínio para o portal</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => mutate()}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 transition">
            <RefreshCw className="w-4 h-4"/>
          </button>
          <button
            onClick={() => { setShowAdd(true); setAddResult(null); setAddErr('') }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #6366f1)' }}
          >
            <Plus className="w-4 h-4"/> Adicionar domínio
          </button>
        </div>
      </div>

      {/* Add modal */}
      <AnimatePresence>
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={() => setShowAdd(false)}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-900 dark:text-white">Adicionar domínio</h3>
                <button onClick={() => setShowAdd(false)}>
                  <X className="w-4 h-4 text-slate-400"/>
                </button>
              </div>

              {!addResult ? (
                <>
                  <p className="text-xs text-slate-500 mb-4">
                    Após adicionar, configure CNAME e TXT no seu provedor DNS.
                  </p>
                  <input
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    placeholder="Ex.: monitor.suaempresa.com.br"
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none mb-3 border border-slate-200 dark:border-white/10 dark:bg-slate-800 dark:text-white"
                  />
                  {addErr && (
                    <p className="text-xs text-rose-500 mb-3 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0"/> {addErr}
                    </p>
                  )}
                  <button
                    onClick={addDomain}
                    disabled={adding || !hostname.trim()}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, #4f46e5, #6366f1)' }}
                  >
                    {adding ? <Loader2 className="w-4 h-4 animate-spin"/> : <Globe className="w-4 h-4"/>}
                    Criar domínio
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 mb-4">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600"/>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">
                      Domínio criado! Configure os registros abaixo:
                    </p>
                  </div>
                  <DnsRecord type="CNAME" record={addResult.cname} onCopy={copyText} copied={copied}/>
                  <DnsRecord type="TXT"   record={addResult.txt}   onCopy={copyText} copied={copied}/>
                  <p className="text-xs text-slate-400 mt-4 text-center">
                    Após configurar o DNS, clique em "Verificar" no domínio para ativar.
                  </p>
                  <button
                    onClick={() => setShowAdd(false)}
                    className="w-full mt-4 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-slate-50 dark:bg-white/5"
                  >
                    Fechar
                  </button>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Domains list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2"/> Carregando…
        </div>
      ) : error ? (
        <div className="text-center py-10 text-rose-500 text-sm">
          <AlertTriangle className="w-5 h-5 mx-auto mb-2"/>
          {formatApiError(error)}
        </div>
      ) : domains.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Globe className="w-10 h-10 mx-auto mb-3 opacity-30"/>
          <p className="text-sm font-medium">Nenhum domínio configurado ainda</p>
          <p className="text-xs mt-1">Adicione um domínio para ativar o white-label</p>
        </div>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => {
            const sc = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.ERROR
            const Icon = sc.icon
            return (
              <div key={d.id} className="bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-white/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Globe className="w-4 h-4 text-indigo-500 shrink-0"/>
                      <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{d.hostname}</p>
                      <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"
                        style={{ background: `${sc.color}20`, color: sc.color }}>
                        <Icon className="w-2.5 h-2.5"/> {sc.label}
                      </span>
                    </div>
                    {d.lastError && d.status !== 'ACTIVE' && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">⚠ {d.lastError}</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1">
                      Adicionado {new Date(d.createdAt).toLocaleDateString('pt-BR')}
                      {d.verifiedAt && ` · Verificado ${new Date(d.verifiedAt).toLocaleDateString('pt-BR')}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {d.status !== 'ACTIVE' && (
                      <button
                        onClick={() => verify(d.id)}
                        disabled={verifying === d.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition disabled:opacity-40"
                      >
                        {verifying === d.id
                          ? <Loader2 className="w-3 h-3 animate-spin"/>
                          : <ShieldCheck className="w-3 h-3"/>}
                        Verificar
                      </button>
                    )}
                    <button
                      onClick={() => deleteDomain(d.id)}
                      disabled={deleting === d.id}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition disabled:opacity-40"
                    >
                      {deleting === d.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin"/>
                        : <Trash2 className="w-3.5 h-3.5"/>}
                    </button>
                  </div>
                </div>

                {/* DNS instructions inline (collapsed for ACTIVE) */}
                {d.status !== 'ACTIVE' && (
                  <div className="mt-3 space-y-2">
                    <DnsRecord
                      type="CNAME"
                      record={{ name: d.hostname, value: 'app.vsaas.com.br' }}
                      onCopy={copyText}
                      copied={copied}
                      compact
                    />
                    <DnsRecord
                      type="TXT"
                      record={{ name: `_icv-verify.${d.hostname}`, value: d.verifyToken }}
                      onCopy={copyText}
                      copied={copied}
                      compact
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── DnsRecord helper ──────────────────────────────────────────────────────────

function DnsRecord({
  type, record, onCopy, copied, compact,
}: {
  type:    string
  record:  { name: string; value: string }
  onCopy:  (text: string, key: string) => void
  copied:  string | null
  compact?: boolean
}) {
  const key = `${type}-${record.name}`
  return (
    <div className={`rounded-lg border bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 ${compact ? 'p-2' : 'p-3 mb-3'}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
          {type}
        </span>
        {!compact && <span className="text-xs text-slate-500">Configure no seu painel DNS</span>}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        <span className="text-slate-400 font-semibold">Nome:</span>
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-mono text-slate-700 dark:text-slate-300 truncate">{record.name}</span>
          <button onClick={() => onCopy(record.name, `name-${key}`)}
            className="shrink-0 p-0.5 hover:text-indigo-500 transition">
            {copied === `name-${key}` ? <Check className="w-3 h-3 text-emerald-500"/> : <Copy className="w-3 h-3 text-slate-400"/>}
          </button>
        </div>
        <span className="text-slate-400 font-semibold">Valor:</span>
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-mono text-slate-700 dark:text-slate-300 truncate text-[11px]">{record.value}</span>
          <button onClick={() => onCopy(record.value, `val-${key}`)}
            className="shrink-0 p-0.5 hover:text-indigo-500 transition">
            {copied === `val-${key}` ? <Check className="w-3 h-3 text-emerald-500"/> : <Copy className="w-3 h-3 text-slate-400"/>}
          </button>
        </div>
      </div>
    </div>
  )
}
