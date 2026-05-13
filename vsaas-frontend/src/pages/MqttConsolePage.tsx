/**
 * Sprint U.1.1 — MQTT Console (página dedicada)
 *
 * Versão completa do MqttCard que estava no SettingsPage. Agrupa em um lugar:
 *   - Status da conexão com o broker (auto-refresh 5s)
 *   - Catálogo de tópicos suportados (com filtro + copy-to-clipboard)
 *   - Console de teste para publicar mensagens (apenas SUPER_ADMIN/INTEGRADOR_ADMIN
 *     no backend; UI mostra grayed-out para outros papéis)
 *
 * Nota: tópicos retornados pelo backend são templates (cameras/<cameraId>/state).
 * Na publicação de teste, o backend faz prefix `iacv/<integradorId>/` e retorna
 * o tópico final no response — exibimos para confirmar que foi onde a mensagem
 * caiu de fato.
 */
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Wifi, WifiOff, Send, Loader2, Search, Copy, Check, AlertTriangle,
  Radio, Activity, Server, Clock,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import {
  useMqttStatus, useMqttTopicsCatalog, mqttTestPublish,
  formatApiError, type MqttTestResponse,
} from '../api/client'
import { cn } from '../lib/utils'

export function MqttConsolePage() {
  const role = localStorage.getItem('icv_role') ?? ''
  const canPublish = role === 'SUPER_ADMIN' || role === 'INTEGRADOR_ADMIN'

  const { data: status, error: statusErr, isLoading: statusLoading } = useMqttStatus()
  const { data: catalog, error: catalogErr } = useMqttTopicsCatalog()

  const connected = !!status?.connected
  const brokerSet = !!status?.brokerUrl

  return (
    <div className="space-y-4">
      {/* Hero */}
      <GlassCard className="p-5 bg-gradient-to-br from-emerald-500/10 via-cyan-500/5 to-transparent border-emerald-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center shadow-lg',
              connected
                ? 'bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-emerald-500/20'
                : 'bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-700 dark:to-slate-800 shadow-slate-300/40 dark:shadow-slate-900/40',
            )}>
              {connected ? <Wifi className="w-6 h-6 text-white" /> : <WifiOff className="w-6 h-6 text-slate-700 dark:text-slate-400" />}
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                MQTT Console
                <ConnectionBadge connected={connected} brokerSet={brokerSet} />
              </h1>
              <p className="text-sm text-slate-700 dark:text-slate-400 mt-1 max-w-2xl">
                Espelho de tópicos compatível com <strong className="text-slate-900 dark:text-white">Frigate</strong> e
                <strong className="text-slate-900 dark:text-white"> Home Assistant</strong>. Hierarquia
                fixa <code className="text-cyan-700 dark:text-cyan-300">iacv/&lt;integradorId&gt;/...</code> garante
                isolamento multi-tenant via ACL no broker.
              </p>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Status grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatTile
          icon={Server}
          label="Broker URL"
          value={status?.brokerUrl ?? '—'}
          tone={brokerSet ? 'ok' : 'warn'}
          loading={statusLoading}
          mono
        />
        <StatTile
          icon={Radio}
          label="Client ID"
          value={status?.clientId ?? '—'}
          tone="neutral"
          loading={statusLoading}
          mono
        />
        <StatTile
          icon={Activity}
          label="Conexão"
          value={connected ? 'Conectado' : brokerSet ? 'Reconectando' : 'NOOP (sem broker)'}
          tone={connected ? 'ok' : brokerSet ? 'warn' : 'neutral'}
          loading={statusLoading}
        />
      </div>

      {statusErr && (
        <GlassCard className="p-4 border-rose-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Falha ao consultar status</p>
              <p className="text-xs text-slate-700 dark:text-slate-400 mt-1">{formatApiError(statusErr)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {!brokerSet && (
        <GlassCard className="p-4 border-amber-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-semibold text-amber-700 dark:text-amber-300">Modo NOOP ativo</p>
              <p className="text-slate-700 dark:text-slate-400 mt-1 max-w-2xl">
                A variável <code className="text-amber-700 dark:text-amber-300">IACV_MQTT_BROKER_URL</code> não está
                configurada. Mensagens publicadas pelo sistema só são logadas — não chegam ao broker.
                Configure a variável (ex.: <code className="text-amber-700 dark:text-amber-300">mqtt://broker.local:1883</code>)
                e reinicie o backend para ativar.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Test publisher */}
      <TestPublisherCard
        prefix={catalog?.prefix ?? 'iacv/<integradorId>/'}
        canPublish={canPublish}
        connected={connected}
      />

      {/* Catálogo */}
      <CatalogCard
        prefix={catalog?.prefix ?? 'iacv/<integradorId>/'}
        topics={catalog?.topics ?? []}
        error={catalogErr}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function ConnectionBadge({ connected, brokerSet }: { connected: boolean; brokerSet: boolean }) {
  if (connected) {
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30 border font-mono uppercase">
        online
      </span>
    )
  }
  if (brokerSet) {
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30 border font-mono uppercase">
        reconectando
      </span>
    )
  }
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 border-slate-200 dark:bg-white/10 dark:text-slate-400 dark:border-white/10 border font-mono uppercase">
      noop
    </span>
  )
}

function StatTile({
  icon: Icon, label, value, tone = 'neutral', loading, mono,
}: {
  icon: any; label: string; value: string
  tone?: 'ok' | 'warn' | 'neutral'
  loading?: boolean; mono?: boolean
}) {
  const colors = {
    ok:      'text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20',
    warn:    'text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20',
    neutral: 'text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10',
  }[tone]
  return (
    <GlassCard className={cn('p-4', colors)}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className={cn('mt-1.5 text-sm truncate', mono && 'font-mono')}>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : value}
      </p>
    </GlassCard>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function TestPublisherCard({
  prefix, canPublish, connected,
}: { prefix: string; canPublish: boolean; connected: boolean }) {
  const [topic, setTopic] = useState('test/ping')
  const [payload, setPayload] = useState('{"hello":"world","ts":"now"}')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MqttTestResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function handlePublish() {
    setBusy(true)
    setErr(null)
    setResult(null)
    let parsedPayload: unknown = payload
    try {
      // tenta JSON; se falhar publica como string crua (broker aceita ambos)
      parsedPayload = JSON.parse(payload)
    } catch {
      parsedPayload = payload
    }
    try {
      const r = await mqttTestPublish({ topic, payload: parsedPayload })
      setResult(r)
    } catch (e) {
      setErr(formatApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <GlassCard className="p-5 space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Send className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
            Publicar mensagem de teste
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            O backend prefixa automaticamente com <code className="text-cyan-700 dark:text-cyan-300">{prefix}</code>.
            Payload pode ser JSON (parseado) ou string crua.
          </p>
        </div>
        {!canPublish && (
          <span className="px-2 py-1 rounded text-[10px] bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30 border font-mono uppercase">
            requer admin
          </span>
        )}
      </header>

      <div className="space-y-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Sub-tópico</label>
          <div className="flex items-stretch">
            <span className="px-3 py-2 rounded-l-lg bg-slate-100 dark:bg-white/[0.03] border border-r-0 border-slate-200 dark:border-white/10 text-[11px] text-slate-500 font-mono whitespace-nowrap">
              {prefix}
            </span>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              disabled={!canPublish || busy}
              placeholder="cameras/cam1/state"
              className="flex-1 px-3 py-2 rounded-r-lg bg-slate-50 border border-slate-200 text-slate-900 dark:bg-white/5 dark:border-white/10 dark:text-white text-[11px] font-mono focus:outline-none focus:border-cyan-500/50 disabled:opacity-40"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Payload (JSON ou string)</label>
          <textarea
            value={payload}
            onChange={e => setPayload(e.target.value)}
            disabled={!canPublish || busy}
            rows={3}
            placeholder='{"online":true} ou "active"'
            className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 dark:bg-white/5 dark:border-white/10 dark:text-white text-[11px] font-mono focus:outline-none focus:border-cyan-500/50 disabled:opacity-40 resize-y"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handlePublish}
          disabled={!canPublish || busy || !topic.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-100 hover:bg-cyan-200 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/15 dark:hover:bg-cyan-500/25 dark:border-cyan-500/30 dark:text-cyan-200 text-xs font-semibold transition disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Publicar
        </button>
        {!connected && (
          <span className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
            <WifiOff className="w-3 h-3" />
            broker desconectado — mensagem ainda será aceita pelo publisher (modo NOOP loga)
          </span>
        )}
      </div>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/5 dark:border-emerald-500/20 text-[11px] space-y-1"
        >
          <p className="text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> Mensagem publicada
          </p>
          <p className="text-slate-700 dark:text-slate-400">
            Tópico final: <code className="text-cyan-700 dark:text-cyan-300">{result.topic}</code>
          </p>
          <p className="text-slate-500">
            Broker conectado no momento: {result.brokerConnected ? 'sim' : 'não (NOOP)'}
          </p>
        </motion.div>
      )}

      {err && (
        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 dark:bg-rose-500/5 dark:border-rose-500/20 text-[11px] text-rose-700 dark:text-rose-300">
          {err}
        </div>
      )}
    </GlassCard>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function CatalogCard({
  prefix, topics, error,
}: { prefix: string; topics: { topic: string; retain: boolean; example: string }[]; error: any }) {
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!search) return topics
    const q = search.toLowerCase()
    return topics.filter(t => t.topic.toLowerCase().includes(q) || t.example.toLowerCase().includes(q))
  }, [topics, search])

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(text)
      setTimeout(() => setCopied(null), 1200)
    })
  }

  return (
    <GlassCard className="p-5 space-y-3">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-violet-700 dark:text-violet-400" />
            Catálogo de tópicos
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Tópicos publicados automaticamente pelo backend. Use no Home Assistant
            como <code className="text-violet-700 dark:text-violet-300">mqtt.subscribe</code> ou no Frigate
            como <code className="text-violet-700 dark:text-violet-300">mqtt.topic_prefix</code>.
          </p>
        </div>
        <span className="px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 dark:bg-white/5 dark:border-white/10 text-xs text-slate-700 dark:text-slate-400 font-mono">
          {filtered.length} / {topics.length}
        </span>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filtrar por nome ou exemplo..."
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-slate-600 text-xs focus:outline-none focus:border-cyan-500/50"
        />
      </div>

      {error ? (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 dark:bg-rose-500/5 dark:border-rose-500/20 text-[11px] text-rose-700 dark:text-rose-300">
          Falha ao carregar catálogo: {formatApiError(error)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-[11px] text-slate-500 py-6">Nenhum tópico encontrado.</p>
      ) : (
        <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1
                        [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.08)_transparent]
                        [&::-webkit-scrollbar]:w-1
                        [&::-webkit-scrollbar-thumb]:rounded-full
                        [&::-webkit-scrollbar-thumb]:bg-slate-100 dark:bg-white/10">
          {filtered.map(t => {
            const fullTopic = prefix + t.topic
            const isCopied = copied === fullTopic
            return (
              <div key={t.topic} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-300 dark:bg-white/[0.03] dark:border-white/5 dark:hover:border-slate-200 dark:border-white/10 transition group">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-[11px] text-cyan-700 dark:text-cyan-300 truncate">{fullTopic}</code>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {t.retain && (
                      <span className="px-1.5 rounded text-[9px] bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30 border font-mono">
                        retain
                      </span>
                    )}
                    <button
                      onClick={() => copy(fullTopic)}
                      title="Copiar tópico"
                      className="opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-slate-400 hover:text-cyan-700 dark:hover:text-cyan-300"
                    >
                      {isCopied ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 mt-1 font-mono truncate">
                  ex: {t.example}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </GlassCard>
  )
}
