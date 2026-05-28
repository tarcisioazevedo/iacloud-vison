/**
 * CameraAuditCard — timeline de auditoria das mudanças feitas nesta câmera.
 *
 * Lê /audit/camera/:id (filtra AuditLog onde resource=Camera + resourceId=<id>).
 * Mostra os últimos 30 dias por padrão, com ator (quem fez), action e o
 * diff/metadata da mudança.
 *
 * Destaca mudanças relacionadas a gravação (recordMode, retentions, buffer,
 * salvaguardas, plano de retenção, etc.) com badge colorido.
 */
import { useState } from 'react'
import { History, User as UserIcon, Shield, Video, Loader2 } from 'lucide-react'
import { useCameraAudit, type CameraAuditEntry } from '../../api/client'

interface Props {
  cameraId: string
}

// Mapping action → label humano + cor. Foca nas ações de gravação que esta
// entrega introduz, mas mostra qualquer outra como genérica.
const ACTION_META: Record<string, { label: string; tone: string; icon?: any }> = {
  CAMERA_BULK_RECORDING_CONFIG: { label: 'Configuração de gravação (lote)', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', icon: Video },
  CAMERA_UPDATED:               { label: 'Câmera atualizada',               tone: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  CAMERA_DELETED:               { label: 'Câmera removida',                 tone: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  CAMERA_CREATED:               { label: 'Câmera criada',                   tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  EVIDENCE_VAULT_CREATE:        { label: 'Salvaguarda criada',              tone: 'bg-purple-500/15 text-purple-700 dark:text-purple-300', icon: Shield },
  EVIDENCE_VAULT_DELETE:        { label: 'Salvaguarda removida',            tone: 'bg-purple-500/15 text-purple-700 dark:text-purple-300', icon: Shield },
  CAMERA_RECORDINGS_CLEARED:    { label: 'Gravações apagadas',              tone: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
}

function actorName(e: CameraAuditEntry): string {
  if (e.user?.name)       return `${e.user.name} (${e.user.role})`
  if (e.user?.email)      return e.user.email
  if (e.superAdmin?.name) return `${e.superAdmin.name} (plataforma)`
  if (e.integrador?.name) return e.integrador.name
  if (e.clienteFinal?.name) return e.clienteFinal.name
  return '—'
}

/** Renderiza diff/metadata de forma compacta — mostra só as chaves alteradas. */
function summarizeMetadata(meta: Record<string, any> | null): string | null {
  if (!meta) return null
  // Common shape para PATCH unitário: { patch: {...} } ou { recordMode, recordRetainDays, ... }
  const payload = meta.patch ?? meta
  const keys = Object.keys(payload).filter(k =>
    typeof payload[k] !== 'object'
    && ![
      'cameraName', 'bulkSize', 'startAt', 'endAt', 'reason', 'expiresAt',
    ].includes(k))
  if (keys.length === 0) {
    // Show meaningful textual fields if no scalars
    if (meta.reason) return `Motivo: "${meta.reason}"`
    if (meta.cameraName) return `Câmera: ${meta.cameraName}`
    return null
  }
  return keys.slice(0, 4).map(k => `${k}=${payload[k]}`).join(' · ')
}

export function CameraAuditCard({ cameraId }: Props) {
  const [days, setDays] = useState(30)
  const { data, isLoading } = useCameraAudit(cameraId, days)
  const logs = data?.logs ?? []

  return (
    <div className="p-4 space-y-3 border border-slate-300 dark:border-white/10 rounded-2xl bg-white/50 dark:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <History className="w-4 h-4" />
          Histórico de mudanças
          {logs.length > 0 && (
            <span className="text-[10px] font-normal text-slate-500">
              ({logs.length} {logs.length === 1 ? 'entrada' : 'entradas'})
            </span>
          )}
        </h3>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white"
        >
          <option value={7}>últimos 7d</option>
          <option value={30}>últimos 30d</option>
          <option value={90}>últimos 90d</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[11px] text-slate-500 italic">
          <Loader2 className="w-3 h-3 animate-spin" />
          Carregando…
        </div>
      ) : logs.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">
          Nenhuma mudança registrada nesta janela.
        </p>
      ) : (
        <ol className="space-y-1.5 max-h-80 overflow-y-auto">
          {logs.map(e => {
            const meta = ACTION_META[e.action] ?? { label: e.action, tone: 'bg-slate-400/15 text-slate-600 dark:text-slate-400' }
            const Icon = meta.icon ?? UserIcon
            const summary = summarizeMetadata(e.metadataJson)
            return (
              <li key={e.id} className="flex items-start gap-2 p-2 rounded-lg border border-slate-200 dark:border-white/10 text-[11px]">
                <div className={`p-1.5 rounded ${meta.tone} shrink-0`}>
                  <Icon className="w-3 h-3" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{meta.label}</span>
                    <span className={`px-1 rounded text-[8px] font-mono uppercase ${
                      e.result === 'SUCCESS' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' :
                      e.result === 'BLOCKED' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' :
                                               'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                    }`}>
                      {e.result}
                    </span>
                  </div>
                  {summary && (
                    <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {summary}
                    </p>
                  )}
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {new Date(e.createdAt).toLocaleString('pt-BR')} · por {actorName(e)}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <p className="text-[9px] text-slate-400 italic">
        Auditoria gerada automaticamente. Não inclui logs operacionais (ingest,
        snapshots, segments) — apenas mudanças de configuração e ações administrativas.
      </p>
    </div>
  )
}
