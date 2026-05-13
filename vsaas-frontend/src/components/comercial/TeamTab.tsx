/**
 * TeamTab — Equipe comercial: SDRs/AEs/CS, metas mensais, ranking.
 */
import { useState } from 'react'
import { Award, Plus, Trophy, Phone, Sparkles, Target, Users, DollarSign, AlertTriangle, Loader2 } from 'lucide-react'
import { GlassCard } from '../cards/GlassCard'
import { useSalesTeam, useSalesRanking, createSalesUser, useEligibleUsers, formatApiError, type SalesUser } from '../../api/client'
import { cn } from '../../lib/utils'

const ROLE_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  SDR:      { label: 'SDR (Prospecção)',  color: 'cyan',    emoji: '📞' },
  AE:       { label: 'AE (Account Executive)', color: 'violet', emoji: '🎯' },
  CS:       { label: 'CS (Customer Success)',  color: 'emerald', emoji: '🤝' },
  MANAGER:  { label: 'Gerente',           color: 'amber',  emoji: '👔' },
  DIRECTOR: { label: 'Diretor / CCO',     color: 'rose',   emoji: '🏆' },
}

export function TeamTab() {
  const { data: teamData, isLoading, mutate } = useSalesTeam()
  const { data: rankingData } = useSalesRanking()
  const [showAdd, setShowAdd] = useState(false)
  const [coachingFor, setCoachingFor] = useState<SalesUser | null>(null)

  if (isLoading) return <div className="h-64 rounded-lg bg-slate-50 dark:bg-white/5 animate-pulse" />

  const team = teamData?.team ?? []
  const rankings = rankingData?.rankings ?? []

  return (
    <div className="space-y-4">
      <GlassCard className="p-4 border-rose-500/30 bg-gradient-to-r from-rose-500/10 via-amber-500/5 to-transparent">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <Award className="w-6 h-6 text-rose-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Equipe Comercial</h3>
              <p className="text-xs text-slate-400 mt-1">{team.length} membros · gestão de metas, ranking e produtividade.</p>
            </div>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Adicionar Vendedor
          </button>
        </div>
      </GlassCard>

      {/* Ranking */}
      {rankings.length > 0 && (
        <GlassCard className="p-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" /> Ranking do mês
          </h3>
          <div className="space-y-2">
            {rankings.map((r: any, idx: number) => (
              <div key={r.salesUser.id} className="flex items-center gap-3 p-2 rounded bg-white/[0.02] border border-slate-200 dark:border-white/5">
                <span className="text-base font-bold w-8 text-center">
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{r.salesUser.name}</p>
                  <p className="text-[10px] text-slate-500">{ROLE_CONFIG[r.salesUser.role]?.label ?? r.salesUser.role}</p>
                </div>
                <div className="grid grid-cols-4 gap-3 text-xs text-right">
                  <div><p className="text-emerald-300 font-bold">R$ {r.mrr.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p><p className="text-[9px] text-slate-500">MRR</p></div>
                  <div><p className="text-cyan-300 font-bold">{r.deals}</p><p className="text-[9px] text-slate-500">deals</p></div>
                  <div><p className="text-amber-300 font-bold">{r.demos}</p><p className="text-[9px] text-slate-500">demos</p></div>
                  <div><p className="text-violet-300 font-bold">{r.calls}</p><p className="text-[9px] text-slate-500">calls</p></div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Lista de membros */}
      {team.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <Users className="w-12 h-12 mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-400">Nenhum vendedor cadastrado ainda.</p>
          <p className="text-xs text-slate-500 mt-1">Adicione SDRs, AEs e CSs para começar a operar comercialmente.</p>
          <button onClick={() => setShowAdd(true)}
            className="mt-4 px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Adicionar primeiro vendedor
          </button>
        </GlassCard>
      ) : (
        <div className="grid gap-2">
          {team.map(m => <MemberCard key={m.id} member={m} onCoach={() => setCoachingFor(m)} />)}
        </div>
      )}

      {showAdd && <AddMemberModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); mutate() }} />}
      {coachingFor && <CoachingDrawer member={coachingFor} onClose={() => setCoachingFor(null)} />}
    </div>
  )
}

// Coaching drawer — notas privadas do gerente sobre o vendedor (localStorage por enquanto)
function CoachingDrawer({ member, onClose }: { member: SalesUser; onClose: () => void }) {
  const storageKey = `coaching_${member.id}`
  const [notes, setNotes] = useState<{ id: string; date: string; text: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') } catch { return [] }
  })
  const [newNote, setNewNote] = useState('')

  function add() {
    if (!newNote.trim()) return
    const next = [{ id: String(Date.now()), date: new Date().toISOString(), text: newNote.trim() }, ...notes]
    setNotes(next)
    localStorage.setItem(storageKey, JSON.stringify(next))
    setNewNote('')
  }
  function remove(id: string) {
    const next = notes.filter(n => n.id !== id)
    setNotes(next)
    localStorage.setItem(storageKey, JSON.stringify(next))
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full sm:max-w-md bg-space-900 border-l border-rose-500/30 p-5 overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Coaching: {member.name}</h3>
            <p className="text-[10px] text-slate-500">{member.role} · {member.email}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:text-white">✕</button>
        </div>

        <div className="p-2 rounded bg-rose-500/5 border border-rose-500/20 text-[10px] text-slate-400 mb-3">
          📝 Notas privadas de coaching · {notes.length} registros · armazenadas localmente neste navegador
        </div>

        <div className="space-y-2 mb-3">
          <textarea value={newNote} onChange={e => setNewNote(e.target.value)}
            placeholder="Ex: 1:1 em 04/05 — combinou que vai focar em qualificação BANT antes de marcar demo..."
            className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white h-24 resize-none" />
          <button onClick={add} disabled={!newNote.trim()}
            className="w-full px-3 py-2 rounded bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold disabled:opacity-50">
            + Adicionar nota
          </button>
        </div>

        <div className="space-y-2">
          {notes.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">Sem notas ainda. Comece com seu próximo 1:1.</p>
          ) : notes.map(n => (
            <div key={n.id} className="p-2 rounded bg-white/[0.02] border border-slate-200 dark:border-white/10">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(n.date).toLocaleString('pt-BR')}
                </span>
                <button onClick={() => remove(n.id)} className="text-slate-600 hover:text-rose-400 text-[10px]">excluir</button>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{n.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MemberCard({ member, onCoach }: { member: SalesUser; onCoach: () => void }) {
  const cfg = ROLE_CONFIG[member.role] ?? ROLE_CONFIG.SDR
  return (
    <GlassCard className="p-3 hover:bg-white/[0.02] transition">
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-lg', `bg-${cfg.color}-500/20`)}>
          {cfg.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{member.name}</p>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{cfg.label}</span>
            <span>·</span>
            <span className="font-mono text-[10px]">{member.email}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold',
            member.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400')}>
            {member.active ? 'Ativo' : 'Inativo'}
          </span>
          <button onClick={onCoach}
            className="text-rose-400 hover:text-rose-300 text-xs px-2 py-1 rounded hover:bg-rose-500/10">
            🎯 Coaching
          </button>
        </div>
      </div>
    </GlassCard>
  )
}

function AddMemberModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: eligibleData, isLoading: loadingEligible } = useEligibleUsers()
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<'SDR'|'HUNTER'|'CLOSER'|'AE'|'CS'|'MANAGER'|'DIRECTOR'>('SDR')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const eligible = eligibleData?.users ?? []
  const selectedUser = eligible.find(u => u.id === userId)

  async function save() {
    if (!selectedUser) { setErr('Selecione um usuário'); return }
    setBusy(true); setErr(null)
    try {
      await createSalesUser({
        userId: selectedUser.id,
        name: selectedUser.name,
        email: selectedUser.email,
        role,
      })
      onSaved()
    }
    catch (e) { setErr(formatApiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md bg-white dark:bg-space-900 border border-rose-500/30 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Adicionar vendedor</h3>
        <p className="text-[10px] text-slate-500">Selecione um usuário existente da plataforma e atribua o papel comercial.</p>
        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Usuário *</label>
          {loadingEligible ? (
            <div className="h-9 rounded bg-slate-50 dark:bg-white/5 animate-pulse" />
          ) : eligible.length === 0 ? (
            <p className="text-xs text-amber-300 p-2 rounded bg-amber-500/10 border border-amber-500/20">
              Nenhum usuário elegível. Cadastre primeiro um User em /admin/users ou no cockpit do tenant.
            </p>
          ) : (
            <select value={userId} onChange={e => setUserId(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
              <option value="">Selecione um usuário...</option>
              {eligible.map(u => (
                <option key={u.id} value={u.id}>{u.name} · {u.email} · {u.role}</option>
              ))}
            </select>
          )}
        </div>
        {selectedUser && (
          <div className="p-2 rounded bg-emerald-500/5 border border-emerald-500/20 text-[10px] text-slate-600 dark:text-slate-300">
            ✓ Selecionado: <strong>{selectedUser.name}</strong> · <span className="font-mono">{selectedUser.email}</span>
          </div>
        )}
        <div>
          <label className="text-[10px] uppercase text-slate-500 mb-1 block">Papel comercial *</label>
          <select value={role} onChange={e => setRole(e.target.value as any)}
            className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white [&>option]:bg-white dark:bg-slate-900 [&>option]:text-slate-900 dark:text-white">
            <option value="SDR">📞 SDR — Sales Development Rep (prospecção)</option>
            <option value="HUNTER">🔍 HUNTER — Caça e qualifica</option>
            <option value="CLOSER">💼 CLOSER — Executivo de vendas (fecha)</option>
            <option value="AE">🎯 AE — Account Executive</option>
            <option value="CS">🤝 CS — Customer Success</option>
            <option value="MANAGER">👔 MANAGER — Gerente comercial</option>
            <option value="DIRECTOR">🏆 DIRECTOR — Diretor / CCO</option>
          </select>
        </div>
        {err && <p className="text-xs text-rose-300">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-400">Cancelar</button>
          <button onClick={save} disabled={busy || !userId}
            className="flex-1 px-3 py-2 rounded bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Adicionar
          </button>
        </div>
      </div>
    </div>
  )
}
