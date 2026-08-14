/**
 * GuestLinkDetailDrawer — Sprint F.
 *
 * Drawer lateral com 3 abas:
 *  - Resumo:    dados do convidado, escopo, validade, usos, status
 *  - Auditoria: tabela cronológica de GuestAccessLog (paginação por cursor)
 *  - Ações:    revogar, exportar audit log CSV
 */
import { useEffect, useState } from 'react'
import {
  X, User, Calendar, Eye, Shield, Globe, RefreshCw, Trash2, FileDown, Loader2, AlertTriangle, Activity,
} from 'lucide-react'
import {
  getGuestLink, getGuestLinkAudit, revokeGuestLink,
  type GuestLinkDetail, type GuestAccessLogEntry, formatApiError,
} from '../../api/client'
import { useUiToast } from '../Toast'
import { confirm } from '../ConfirmDialog'

interface Props {
  linkId: string
  onClose: () => void
  onRevoked: () => void
}
type Tab = 'summary' | 'audit' | 'actions'

export function GuestLinkDetailDrawer({ linkId, onClose, onRevoked }: Props) {
  const toast = useUiToast()
  const [tab, setTab] = useState<Tab>('summary')
  const [detail, setDetail]   = useState<GuestLinkDetail | null>(null)
  const [logs, setLogs]       = useState<GuestAccessLogEntry[]>([])
  const [cursor, setCursor]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getGuestLink(linkId)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(err => toast.error({ title: 'Erro ao carregar', description: formatApiError(err) }))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [linkId, toast])

  async function loadMoreAudit() {
    setWorking(true)
    try {
      const res = await getGuestLinkAudit(linkId, cursor)
      setLogs(prev => cursor ? [...prev, ...res.logs] : res.logs)
      setCursor(res.nextCursor)
    } catch (err) {
      toast.error({ title: 'Erro de auditoria', description: formatApiError(err) })
    } finally {
      setWorking(false)
    }
  }

  useEffect(() => {
    if (tab === 'audit' && logs.length === 0) {
      loadMoreAudit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function handleRevoke() {
    const ok = await confirm({
      title: 'Revogar link?',
      description: 'O convidado perderá acesso imediatamente. Esta ação não pode ser desfeita.',
      destructive: true,
      confirmLabel: 'Revogar',
    })
    if (!ok) return
    try {
      await revokeGuestLink(linkId)
      toast.success('Link revogado')
      onRevoked()
      onClose()
    } catch (err) {
      toast.error({ title: 'Falha ao revogar', description: formatApiError(err) })
    }
  }

  function exportCsv() {
    if (logs.length === 0) {
      toast.warning('Nada pra exportar — carregue a auditoria primeiro')
      return
    }
    const headers = ['timestamp', 'action', 'ip', 'userAgent', 'durationSeconds', 'metadata']
    const lines = [headers.join(',')]
    for (const l of logs) {
      const row = [
        new Date(l.ts).toISOString(),
        l.action,
        l.ip ?? '',
        (l.userAgent ?? '').replace(/[",\n]/g, ' '),
        l.durationSeconds ?? '',
        l.metadata ? JSON.stringify(l.metadata).replace(/[",\n]/g, ' ') : '',
      ]
      lines.push(row.map(v => `"${String(v)}"`).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `guest-link-${linkId}-audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside className="w-full max-w-xl h-full bg-slate-900 border-l border-white/10 shadow-2xl flex flex-col"
             onClick={e => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Detalhes do link</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </header>

        <nav className="flex border-b border-white/10">
          {(['summary', 'audit', 'actions'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
                tab === t ? 'border-cyan-500 text-cyan-300 bg-cyan-500/5' : 'border-transparent text-slate-400 hover:text-white'
              }`}>
              {t === 'summary' ? 'Resumo' : t === 'audit' ? 'Auditoria' : 'Ações'}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
          )}

          {!loading && detail && tab === 'summary' && (
            <div className="space-y-3 text-sm">
              <Section title="Convidado" icon={User}>
                <KV label="Nome"     value={detail.guestName} />
                <KV label="E-mail"   value={detail.guestEmail ?? '—'} />
                <KV label="Telefone" value={detail.guestPhone ?? '—'} />
                <KV label="Motivo"   value={detail.purpose} />
              </Section>

              <Section title="Escopo" icon={Eye}>
                <KV label="Tipo"     value={detail.cameraId ? 'Câmera' : detail.siteId ? 'Site' : 'Clipe'} />
                {detail.cameraId        && <KV label="Câmera ID"        value={detail.cameraId} mono />}
                {detail.siteId          && <KV label="Site ID"          value={detail.siteId} mono />}
                {detail.recordingClipId && <KV label="Clipe ID"         value={detail.recordingClipId} mono />}
                {detail.recordingFrom   && <KV label="Janela início"    value={new Date(detail.recordingFrom).toLocaleString('pt-BR')} />}
                {detail.recordingTo     && <KV label="Janela fim"       value={new Date(detail.recordingTo).toLocaleString('pt-BR')} />}
                <KV label="Live"      value={detail.canViewLive      ? 'sim' : 'não'} />
                <KV label="Gravação"  value={detail.canViewRecording ? 'sim' : 'não'} />
                <KV label="Download"  value={detail.canDownload      ? 'sim' : 'não'} />
              </Section>

              <Section title="Validade" icon={Calendar}>
                <KV label="Status"     value={statusLabel(detail.status)} />
                <KV label="Início"     value={new Date(detail.validFrom).toLocaleString('pt-BR')} />
                <KV label="Expira em"  value={new Date(detail.validUntil).toLocaleString('pt-BR')} />
                <KV label="Usos"       value={`${detail.usesCount} / ${detail.maxUses}`} />
                {detail.revokedAt   && <KV label="Revogado em"  value={new Date(detail.revokedAt).toLocaleString('pt-BR')} />}
                {detail.revokedReason && <KV label="Motivo revogação" value={detail.revokedReason} />}
              </Section>

              <Section title="Segurança" icon={Shield}>
                <KV label="PIN"               value={detail.hasPin       ? 'configurado' : 'não'} />
                <KV label="IP restrito"       value={detail.allowedIpCidr ?? '—'} />
                <KV label="Marca d'água"      value={detail.watermarkText ?? '(auto)'} />
              </Section>

              <Section title="Últimos acessos" icon={Activity}>
                {detail.lastAccesses.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhum acesso registrado ainda.</p>
                ) : (
                  <div className="space-y-1">
                    {detail.lastAccesses.slice(0, 5).map(l => (
                      <div key={l.id} className="text-xs flex justify-between text-slate-400">
                        <span className="text-slate-300">{l.action}</span>
                        <span>{new Date(l.ts).toLocaleString('pt-BR')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          )}

          {!loading && tab === 'audit' && (
            <div className="space-y-2">
              {logs.length === 0 && !working && (
                <p className="text-center text-sm text-slate-500 py-6">Sem registros.</p>
              )}
              {logs.map(l => (
                <div key={l.id} className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${actionPill(l.action)}`}>{l.action}</span>
                    <span className="text-slate-500">{new Date(l.ts).toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-slate-400">
                    <span><Globe className="w-3 h-3 inline mr-1" />{l.ip ?? '—'}</span>
                    <span>{l.durationSeconds ? `${l.durationSeconds}s` : '—'}</span>
                    <span className="truncate">{l.userAgent ?? ''}</span>
                  </div>
                  {l.metadata && (
                    <pre className="bg-black/30 rounded p-1.5 text-[10px] text-slate-400 mt-1 overflow-x-auto">{JSON.stringify(l.metadata)}</pre>
                  )}
                </div>
              ))}
              {cursor && (
                <button onClick={loadMoreAudit} disabled={working}
                  className="w-full mt-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300">
                  {working ? <Loader2 className="w-3 h-3 inline animate-spin" /> : <RefreshCw className="w-3 h-3 inline mr-1" />}
                  Carregar mais
                </button>
              )}
            </div>
          )}

          {!loading && detail && tab === 'actions' && (
            <div className="space-y-3">
              <button onClick={exportCsv} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-sm font-semibold">
                <FileDown className="w-4 h-4" /> Exportar audit log (CSV)
              </button>
              {!detail.revokedAt && (
                <button onClick={handleRevoke} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-sm font-semibold">
                  <Trash2 className="w-4 h-4" /> Revogar link agora
                </button>
              )}
              {detail.revokedAt && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-xs text-rose-300 flex gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>Link já revogado em {new Date(detail.revokedAt).toLocaleString('pt-BR')}.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function statusLabel(s: string): string {
  return ({
    active:   '🟢 Ativo',
    used:     '🟡 Em uso',
    used_up:  '⚪ Usado',
    expired:  '⚫ Expirado',
    revoked:  '🔴 Revogado',
  } as Record<string, string>)[s] ?? s
}

function actionPill(a: string): string {
  if (a.startsWith('denied') || a === 'revoked' || a === 'pin_failed')
    return 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
  if (a === 'pin_verified' || a === 'created') return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
  if (a === 'downloaded')                       return 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
  return 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5 mb-2"><Icon className="w-3.5 h-3.5" /> {title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={mono ? 'text-slate-300 font-mono' : 'text-slate-200'}>{value}</span>
    </div>
  )
}
