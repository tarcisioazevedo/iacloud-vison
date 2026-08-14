/**
 * <LgpdConsentModal> — modal bloqueante de consentimento LGPD.
 *
 * Renderiza overlay full-screen quando o tenant exige consentimento e o user
 * ainda não aceitou (ou versão da política mudou). User NÃO consegue usar o
 * sistema sem aceitar. Pode fazer logout se quiser sair.
 *
 * Usado pelo <LgpdConsentGate> que envolve o Layout autenticado.
 *
 * Sprint C · docs/40-PLAN-GESTAO-USUARIOS.md
 */
import { useEffect, useState } from 'react'
import { Shield, AlertTriangle, Loader2, LogOut } from 'lucide-react'
import { api } from '../../api/client'
import { useUiToast } from '../Toast'

interface PolicyResponse {
  version: string
  text: string
  useDefault: boolean
}

interface Props {
  currentVersion: string
  reason: 'never_accepted' | 'version_outdated' | string | null
  onAccepted: () => void
  onLogout: () => void
}

export function LgpdConsentModal({ currentVersion, reason, onAccepted, onLogout }: Props) {
  const toast = useUiToast()
  const [policy, setPolicy] = useState<PolicyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.get<PolicyResponse>('/me/lgpd/policy')
      .then(({ data }) => { if (alive) setPolicy(data) })
      .catch((e: any) => {
        if (alive) setError(e.response?.data?.message || 'Erro ao carregar política')
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const reachedBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
    if (reachedBottom && !scrolledToBottom) setScrolledToBottom(true)
  }

  async function handleAccept() {
    if (!policy) return
    setAccepting(true); setError(null)
    try {
      await api.post('/me/lgpd/accept', { policyVersion: policy.version })
      toast.success('Política aceita. Bem-vindo!')
      onAccepted()
    } catch (e: any) {
      setError(e.response?.data?.message || 'Erro ao registrar aceite')
    } finally {
      setAccepting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-slate-900 border-2 border-cyan-500/30 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
              <Shield className="w-6 h-6 text-cyan-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white">Política de Uso e LGPD</h2>
              <p className="text-xs text-slate-400">
                {reason === 'version_outdated'
                  ? `A política foi atualizada (versão ${currentVersion}). Releia e aceite para continuar.`
                  : 'Antes do primeiro acesso, precisamos do seu consentimento.'}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando política...
            </div>
          ) : error && !policy ? (
            <div className="p-6 text-rose-400">{error}</div>
          ) : policy ? (
            <>
              <div
                className="flex-1 overflow-y-auto px-6 py-4 prose prose-invert prose-sm max-w-none"
                onScroll={handleScroll}
              >
                <pre className="text-sm text-slate-200 leading-relaxed font-sans whitespace-pre-wrap">
                  {policy.text}
                </pre>
              </div>

              {!scrolledToBottom && (
                <div className="px-6 py-2 bg-amber-500/10 border-t border-amber-500/30 text-xs text-amber-200 flex items-center gap-2 shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Role até o fim do texto para poder aceitar
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        {policy && (
          <div className="p-6 border-t border-white/10 shrink-0 space-y-3">
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                disabled={!scrolledToBottom}
                className="mt-0.5 w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0 disabled:opacity-40"
              />
              <span className="text-sm text-slate-300">
                Li e aceito a Política de Uso e Tratamento de Dados (versão{' '}
                <code className="text-cyan-300 font-mono">{policy.version}</code>).
              </span>
            </label>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={onLogout}
                className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-semibold flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" /> Sair
              </button>
              <button
                onClick={handleAccept}
                disabled={!agreed || accepting || !scrolledToBottom}
                className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {accepting ? <><Loader2 className="w-4 h-4 animate-spin" /> Registrando...</> : 'Aceitar e continuar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
