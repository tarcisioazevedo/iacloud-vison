/**
 * FederationPage — Segurança Colaborativa (paridade Monuv /sharing-groups).
 *
 * Permite que integradores compartilhem câmeras entre si ou com clientes-parceiros,
 * formando "grupos de federação". Cada grupo define:
 *   • Membros (integradores e/ou clientes finais)
 *   • Câmeras compartilhadas (ou sites inteiros)
 *   • Permissões (visualização, eventos, LPR, download de vídeo)
 *   • Validade (período da federação)
 *
 * Esta é uma feature PRO — reservada a integradores com plano Scale+ ou Enterprise.
 *
 * Backend-ready: quando disponível, os grupos serão sincronizados com o Authentik
 * (grupo `icv:federation:{fed_id}`) via API e o backend emitirá a claim
 * `federations: [...ids]` no token para expansão de scope. Por ora, scaffold
 * persistido em localStorage (chave `icv_federations_v1`).
 *
 * Contrato futuro:
 *   GET    /federation/groups
 *   POST   /federation/groups
 *   PATCH  /federation/groups/:id
 *   DELETE /federation/groups/:id
 *   POST   /federation/groups/:id/members
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Plus, Trash2, Edit3, Shield, Lock, Calendar,
  Building2, CameraOff, Camera as CameraIcon, CheckCircle2,
  AlertTriangle, Sparkles, X, Search, Filter, ExternalLink,
  Eye, Bell, Download, Activity, Crown,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { KpiCard } from '../components/cards/KpiCard'
import { useCameras, useMe } from '../api/client'
import { cn } from '../lib/utils'
import { confirm } from '../components/ConfirmDialog'

// ── Tipagem ──────────────────────────────────────────────────────────────
interface FederationMember {
  kind: 'INTEGRADOR' | 'CLIENTE_FINAL'
  refId: string         // id do integrador ou cliente
  name: string
  email?: string
}
interface FederationPermissions {
  view: boolean
  events: boolean       // central de eventos da câmera compartilhada
  lpr: boolean          // ver eventos LPR
  download: boolean     // baixar snapshot/vídeo
}
interface FederationGroup {
  id: string
  name: string
  description: string
  createdAt: string
  ownerIntegradorId: string | null
  members: FederationMember[]
  sharedCameraIds: string[]
  permissions: FederationPermissions
  validFrom?: string    // ISO date
  validUntil?: string   // ISO date
  active: boolean
}
const FED_KEY = 'icv_federations_v1'
function loadFeds(): FederationGroup[] {
  try { return JSON.parse(localStorage.getItem(FED_KEY) ?? '[]') } catch { return [] }
}
function saveFeds(list: FederationGroup[]) {
  localStorage.setItem(FED_KEY, JSON.stringify(list))
}
function uid() { return Math.random().toString(36).slice(2, 10) }

const DEFAULT_PERMISSIONS: FederationPermissions = {
  view: true, events: true, lpr: false, download: false,
}

// ── Page ─────────────────────────────────────────────────────────────────
export function FederationPage() {
  const { data: me } = useMe()
  const [groups, setGroups] = useState<FederationGroup[]>(loadFeds)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<FederationGroup | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => { saveFeds(groups) }, [groups])

  const selected = groups.find(g => g.id === selectedId) ?? null

  const filtered = useMemo(() => groups.filter(g =>
    !q || g.name.toLowerCase().includes(q.toLowerCase()) || g.description.toLowerCase().includes(q.toLowerCase())
  ), [groups, q])

  const stats = useMemo(() => {
    const active = groups.filter(g => g.active).length
    const members = groups.reduce((s, g) => s + g.members.length, 0)
    const cameras = new Set(groups.flatMap(g => g.sharedCameraIds)).size
    return { total: groups.length, active, members, cameras }
  }, [groups])

  function createNew() {
    const g: FederationGroup = {
      id: uid(),
      name: `Federação ${groups.length + 1}`,
      description: '',
      createdAt: new Date().toISOString(),
      ownerIntegradorId: me?.integrador?.id ?? null,
      members: [],
      sharedCameraIds: [],
      permissions: { ...DEFAULT_PERMISSIONS },
      active: true,
    }
    setGroups(gs => [...gs, g])
    setEditing(g)
    setSelectedId(g.id)
  }

  function save(g: FederationGroup) {
    setGroups(gs => gs.map(x => x.id === g.id ? g : x))
    setEditing(null)
  }

  async function removeGroup(id: string) {
    const ok = await confirm({
      title: 'Remover esta federação?',
      description: 'Os membros perderão o acesso.',
      destructive: true,
      confirmLabel: 'Remover',
    })
    if (!ok) return
    setGroups(gs => gs.filter(g => g.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  // PRO gate — super-admin e integrador têm acesso; user comum vê paywall.
  const hasAccess = me?.kind === 'SUPER_ADMIN' || me?.kind === 'INTEGRADOR'

  if (!hasAccess) return <ProPaywall />

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-400" />
            Segurança Colaborativa
            <span className="px-1.5 py-0.5 rounded-md bg-gradient-to-r from-violet-500/30 to-cyan-500/30 border border-violet-500/40 text-violet-200 text-[9px] font-bold tracking-wider ml-1">
              <Crown className="inline w-2.5 h-2.5 mr-0.5" /> PRO
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Federação entre integradores e clientes · compartilhamento seguro de câmeras, eventos e LPR
          </p>
        </div>

        <button
          onClick={createNew}
          className="px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 text-white text-xs font-semibold hover:opacity-90 flex items-center gap-2 shadow-cyan-glow"
        >
          <Plus className="w-3.5 h-3.5" />
          Nova federação
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="Federações"       value={stats.total}   icon={<Users />}     accent="violet" delay={0.0} />
        <KpiCard title="Ativas"            value={stats.active}  icon={<CheckCircle2 />} accent="emerald" delay={0.1} />
        <KpiCard title="Membros totais"    value={stats.members} icon={<Building2 />} accent="cyan"   delay={0.2} />
        <KpiCard title="Câmeras compart."  value={stats.cameras} icon={<CameraIcon />} accent="amber"  delay={0.3} />
      </div>

      {/* Corpo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lista */}
        <GlassCard className="p-3 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar federação..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              {q ? 'Nenhum resultado.' : (
                <div>
                  <Users className="w-10 h-10 mx-auto mb-2 text-slate-700" />
                  Nenhuma federação criada ainda.<br />
                  <button onClick={createNew} className="mt-2 text-cyan-400 hover:text-cyan-300 underline">
                    Criar a primeira
                  </button>
                </div>
              )}
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map(g => {
                const active = g.id === selectedId
                return (
                  <li key={g.id}>
                    <button
                      onClick={() => setSelectedId(g.id)}
                      className={cn(
                        'w-full text-left p-2.5 rounded-lg border transition',
                        active
                          ? 'bg-violet-500/10 border-violet-500/40'
                          : 'bg-white/[0.02] border-slate-200 dark:border-white/5 hover:bg-white/[0.04]',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={cn('w-1.5 h-1.5 rounded-full', g.active ? 'bg-emerald-400' : 'bg-slate-600')} />
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate flex-1">{g.name}</p>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                        <span><Building2 className="inline w-2.5 h-2.5 mr-0.5" />{g.members.length}</span>
                        <span><CameraIcon className="inline w-2.5 h-2.5 mr-0.5" />{g.sharedCameraIds.length}</span>
                        {g.validUntil && <span><Calendar className="inline w-2.5 h-2.5 mr-0.5" />até {new Date(g.validUntil).toLocaleDateString('pt-BR')}</span>}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </GlassCard>

        {/* Detalhes */}
        <div className="lg:col-span-2">
          {selected ? (
            <FederationDetail
              group={selected}
              onEdit={() => setEditing(selected)}
              onRemove={() => removeGroup(selected.id)}
              onToggleActive={() => save({ ...selected, active: !selected.active })}
            />
          ) : (
            <GlassCard className="p-8 text-center">
              <Users className="w-12 h-12 mx-auto mb-3 text-slate-600" />
              <p className="text-sm text-slate-500 dark:text-slate-400">Selecione uma federação à esquerda ou crie uma nova.</p>
              <p className="text-[11px] text-slate-500 mt-2 max-w-md mx-auto">
                Federações permitem que você autorize outros integradores ou clientes finais
                a visualizar, receber alertas ou baixar vídeos de câmeras selecionadas.
              </p>
            </GlassCard>
          )}
        </div>
      </div>

      {/* Aviso scaffold */}
      <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/20 text-[11px] text-violet-300 flex items-start gap-2">
        <Shield className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <strong className="text-violet-700 dark:text-violet-200">Scaffold ativo.</strong>{' '}
          As federações ficam salvas localmente. O sincronismo com o IdP (Authentik — grupo{' '}
          <code className="text-violet-700 dark:text-violet-200">icv:federation:&#123;id&#125;</code>) e a propagação de scope
          no backend serão ativados quando os endpoints{' '}
          <code className="text-violet-700 dark:text-violet-200">POST /federation/groups</code> estiverem disponíveis. Ver{' '}
          <Link to="#" className="underline">plano de arquitetura Authentik</Link>.
        </div>
      </div>

      {/* Editor modal */}
      <AnimatePresence>
        {editing && (
          <FederationEditor
            group={editing}
            onSave={save}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Paywall ──────────────────────────────────────────────────────────────
function ProPaywall() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <GlassCard className="p-8 max-w-md text-center space-y-4">
        <Lock className="w-12 h-12 mx-auto text-amber-400" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Segurança Colaborativa</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          A federação entre integradores e clientes está disponível apenas nas
          contas <strong className="text-slate-900 dark:text-white">Scale</strong> e <strong className="text-slate-900 dark:text-white">Enterprise</strong>.
        </p>
        <div className="flex gap-2 justify-center pt-2">
          <Link to="/pricing" className="px-4 py-2 rounded-lg bg-cyan-500 text-white text-xs font-semibold hover:bg-cyan-400">
            Ver planos
          </Link>
          <Link to="/" className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:bg-white/10">
            Voltar
          </Link>
        </div>
      </GlassCard>
    </div>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────
function FederationDetail({
  group, onEdit, onRemove, onToggleActive,
}: {
  group: FederationGroup
  onEdit: () => void
  onRemove: () => void
  onToggleActive: () => void
}) {
  const { data: camData } = useCameras()
  const allCameras: any[] = camData?.items ?? []
  const cams = allCameras.filter(c => group.sharedCameraIds.includes(c.id))

  const perms = Object.entries(group.permissions).filter(([, v]) => v).map(([k]) => k)

  return (
    <GlassCard className="p-5 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {group.name}
            <span className={cn(
              'px-2 py-0.5 rounded-full text-[9px] font-bold border',
              group.active
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-slate-500/10 border-slate-500/30 text-slate-400',
            )}>
              {group.active ? 'ATIVA' : 'PAUSADA'}
            </span>
          </h2>
          {group.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{group.description}</p>}
          <p className="text-[10px] text-slate-500 mt-1 font-mono">
            #{group.id} · criada em {new Date(group.createdAt).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={onToggleActive} className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 text-xs hover:bg-slate-100 dark:bg-white/10">
            {group.active ? 'Pausar' : 'Ativar'}
          </button>
          <button onClick={onEdit} className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs hover:bg-cyan-500/25 flex items-center gap-1">
            <Edit3 className="w-3 h-3" /> Editar
          </button>
          <button onClick={onRemove} className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs hover:bg-rose-500/25 flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Remover
          </button>
        </div>
      </header>

      {/* Permissões */}
      <section className="pt-3 border-t border-slate-200 dark:border-white/5">
        <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">Permissões</h3>
        <div className="flex gap-1.5 flex-wrap">
          {perms.length === 0 ? (
            <span className="text-[11px] text-slate-500 italic">Nenhuma permissão concedida</span>
          ) : perms.map(p => (
            <span key={p} className="px-2 py-1 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] text-slate-600 dark:text-slate-300 font-semibold">
              {p === 'view'     && <><Eye       className="inline w-3 h-3 mr-1" /> Visualizar</>}
              {p === 'events'   && <><Bell      className="inline w-3 h-3 mr-1" /> Eventos</>}
              {p === 'lpr'      && <><Activity  className="inline w-3 h-3 mr-1" /> LPR</>}
              {p === 'download' && <><Download  className="inline w-3 h-3 mr-1" /> Download</>}
            </span>
          ))}
        </div>
      </section>

      {/* Membros */}
      <section className="pt-3 border-t border-slate-200 dark:border-white/5">
        <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">
          Membros ({group.members.length})
        </h3>
        {group.members.length === 0 ? (
          <p className="text-[11px] text-slate-500 italic">Nenhum membro ainda. Clique em "Editar" para adicionar.</p>
        ) : (
          <ul className="space-y-1.5">
            {group.members.map(m => (
              <li key={`${m.kind}-${m.refId}`} className="flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.02] border border-slate-200 dark:border-white/5">
                <Building2 className={cn('w-4 h-4', m.kind === 'INTEGRADOR' ? 'text-violet-400' : 'text-cyan-400')} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{m.name}</p>
                  <p className="text-[10px] text-slate-500">{m.kind === 'INTEGRADOR' ? 'Integrador' : 'Cliente Final'} · {m.email ?? m.refId}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Câmeras */}
      <section className="pt-3 border-t border-slate-200 dark:border-white/5">
        <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">
          Câmeras compartilhadas ({group.sharedCameraIds.length})
        </h3>
        {cams.length === 0 && group.sharedCameraIds.length > 0 ? (
          <p className="text-[11px] text-amber-400">
            <AlertTriangle className="inline w-3 h-3 mr-1" />
            {group.sharedCameraIds.length} IDs referenciados mas não encontrados no catálogo atual.
          </p>
        ) : cams.length === 0 ? (
          <p className="text-[11px] text-slate-500 italic">Nenhuma câmera compartilhada.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {cams.map(c => (
              <div key={c.id} className="flex items-center gap-2 p-2 rounded bg-white/[0.02] border border-slate-200 dark:border-white/5">
                <CameraIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-xs text-slate-200 truncate flex-1">{c.name}</span>
                <Link to={`/cameras/${c.id}`} className="text-slate-500 hover:text-cyan-300">
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Validade */}
      {(group.validFrom || group.validUntil) && (
        <section className="pt-3 border-t border-slate-200 dark:border-white/5">
          <h3 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">Validade</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {group.validFrom  && <>De <span className="font-mono">{new Date(group.validFrom).toLocaleDateString('pt-BR')}</span> </>}
            {group.validUntil && <>até <span className="font-mono">{new Date(group.validUntil).toLocaleDateString('pt-BR')}</span></>}
          </p>
        </section>
      )}
    </GlassCard>
  )
}

// ── Editor Modal ─────────────────────────────────────────────────────────
function FederationEditor({
  group, onSave, onClose,
}: {
  group: FederationGroup
  onSave: (g: FederationGroup) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<FederationGroup>(group)
  const { data: camData } = useCameras()
  const allCameras: any[] = camData?.items ?? []
  const [memberDraft, setMemberDraft] = useState<FederationMember>({
    kind: 'INTEGRADOR', refId: '', name: '', email: '',
  })
  const [camQuery, setCamQuery] = useState('')

  function addMember() {
    if (!memberDraft.name.trim()) return
    const m: FederationMember = { ...memberDraft, refId: memberDraft.refId || uid() }
    setDraft(d => ({ ...d, members: [...d.members, m] }))
    setMemberDraft({ kind: 'INTEGRADOR', refId: '', name: '', email: '' })
  }
  function removeMember(idx: number) {
    setDraft(d => ({ ...d, members: d.members.filter((_, i) => i !== idx) }))
  }
  function toggleCamera(id: string) {
    setDraft(d => ({
      ...d,
      sharedCameraIds: d.sharedCameraIds.includes(id)
        ? d.sharedCameraIds.filter(x => x !== id)
        : [...d.sharedCameraIds, id],
    }))
  }

  const camsFiltered = allCameras.filter(c =>
    !camQuery || c.name?.toLowerCase().includes(camQuery.toLowerCase())
  )

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[85vh] bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            <Sparkles className="inline w-4 h-4 text-violet-400 mr-1" />
            Editar federação
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100 dark:bg-white/10 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Basics */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Nome</span>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                     className="w-full mt-1 px-3 py-2 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50" />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Validade final</span>
              <input type="date" value={draft.validUntil?.slice(0, 10) ?? ''}
                     onChange={e => setDraft({ ...draft, validUntil: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                     className="w-full mt-1 px-3 py-2 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50" />
            </label>
            <label className="block md:col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Descrição</span>
              <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
                        rows={2}
                        className="w-full mt-1 px-3 py-2 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50" />
            </label>
          </section>

          {/* Permissões */}
          <section>
            <h4 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">Permissões concedidas</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(Object.keys(DEFAULT_PERMISSIONS) as Array<keyof FederationPermissions>).map(k => (
                <label key={k} className={cn(
                  'flex items-center gap-2 p-2 rounded border cursor-pointer',
                  draft.permissions[k]
                    ? 'bg-violet-500/10 border-violet-500/40'
                    : 'bg-white/[0.02] border-slate-200 dark:border-white/10',
                )}>
                  <input type="checkbox" checked={draft.permissions[k]}
                         onChange={e => setDraft({ ...draft, permissions: { ...draft.permissions, [k]: e.target.checked } })}
                         className="accent-violet-500" />
                  <span className="text-xs text-slate-900 dark:text-white capitalize">{k}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Membros */}
          <section>
            <h4 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">
              Membros ({draft.members.length})
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
              <select value={memberDraft.kind}
                      onChange={e => setMemberDraft({ ...memberDraft, kind: e.target.value as any })}
                      className="px-2 py-1.5 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white">
                <option value="INTEGRADOR">Integrador</option>
                <option value="CLIENTE_FINAL">Cliente Final</option>
              </select>
              <input placeholder="Nome" value={memberDraft.name}
                     onChange={e => setMemberDraft({ ...memberDraft, name: e.target.value })}
                     className="px-2 py-1.5 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white" />
              <input placeholder="E-mail (opcional)" value={memberDraft.email ?? ''}
                     onChange={e => setMemberDraft({ ...memberDraft, email: e.target.value })}
                     className="px-2 py-1.5 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white" />
              <button onClick={addMember}
                      className="px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-semibold hover:bg-violet-500/25 flex items-center justify-center gap-1">
                <Plus className="w-3 h-3" /> Adicionar
              </button>
            </div>
            {draft.members.length > 0 && (
              <ul className="space-y-1">
                {draft.members.map((m, idx) => (
                  <li key={idx} className="flex items-center gap-2 p-2 rounded bg-white/[0.02] border border-slate-200 dark:border-white/5">
                    <Building2 className={cn('w-3.5 h-3.5', m.kind === 'INTEGRADOR' ? 'text-violet-400' : 'text-cyan-400')} />
                    <span className="text-xs text-slate-900 dark:text-white flex-1">{m.name}</span>
                    <span className="text-[10px] text-slate-500">{m.email}</span>
                    <button onClick={() => removeMember(idx)} className="text-slate-500 hover:text-rose-300">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Câmeras */}
          <section>
            <h4 className="text-[11px] uppercase text-slate-500 tracking-wider mb-2">
              Câmeras compartilhadas ({draft.sharedCameraIds.length} / {allCameras.length})
            </h4>
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={camQuery} onChange={e => setCamQuery(e.target.value)}
                     placeholder="Filtrar câmeras..."
                     className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50" />
            </div>
            {camsFiltered.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic text-center py-4">
                <CameraOff className="inline w-4 h-4 mr-1" /> Nenhuma câmera disponível.
              </p>
            ) : (
              <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-white/5 rounded-md divide-y divide-slate-200 dark:divide-white/5">
                {camsFiltered.map(c => {
                  const checked = draft.sharedCameraIds.includes(c.id)
                  return (
                    <label key={c.id} className={cn(
                      'flex items-center gap-2 p-2 cursor-pointer hover:bg-slate-50 dark:bg-white/5',
                      checked && 'bg-violet-500/5',
                    )}>
                      <input type="checkbox" checked={checked} onChange={() => toggleCamera(c.id)}
                             className="accent-violet-500" />
                      <CameraIcon className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-xs text-slate-900 dark:text-white flex-1 truncate">{c.name}</span>
                      <span className="text-[10px] text-slate-500">{c.site?.name ?? '—'}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-white/10 flex items-center justify-between bg-white/[0.02]">
          <p className="text-[10px] text-slate-500">
            <Filter className="inline w-3 h-3 mr-1" />
            Scaffold — salva localmente até o endpoint <code>POST /federation/groups</code> estar disponível
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
                    className="px-3 py-1.5 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 text-xs hover:bg-slate-100 dark:bg-white/10">
              Cancelar
            </button>
            <button onClick={() => onSave(draft)}
                    className="px-3 py-1.5 rounded-md bg-violet-500 text-white text-xs font-semibold hover:bg-violet-400">
              Salvar
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
