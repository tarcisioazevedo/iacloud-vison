/**
 * PortalEntryPage — Sprint CF.4
 *
 * Página pública sem PrivateRoute. Ponto de entrada do portal cliente-final
 * para magic-links. Fluxo:
 *
 *   1. Lê `?token=` da URL.
 *   2. Sem token → mostra UI "cole seu link aqui" (form de input).
 *   3. Com token → POST /portal/exchange.
 *      - Sucesso: persiste icv_token + icv_role + icv_cliente_final no
 *        localStorage e tenta carregar branding pelo portalSlug pra cachear
 *        as cores ANTES de navegar (evita flash). Depois redireciona pra
 *        /portal/home.
 *      - Falha: mostra mensagem genérica + ação "pedir novo link" (mailto).
 *
 * Não toca o sidebar nem o Layout normal — render é stand-alone.
 */
import { useEffect, useState, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, AlertTriangle, Link as LinkIcon, ArrowRight, Shield } from 'lucide-react'
import {
  exchangePortalToken, fetchPortalBranding, formatApiError,
  type PortalBranding,
} from '../../api/client'

export function PortalEntryPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tokenParam = params.get('token')?.trim() ?? ''

  const [phase, setPhase]     = useState<'idle' | 'exchanging' | 'error' | 'manual'>(
    tokenParam ? 'exchanging' : 'manual',
  )
  const [error, setError]     = useState<string | null>(null)
  const [branding, setBranding] = useState<PortalBranding | null>(null)
  const [manualToken, setManualToken] = useState('')

  // Token via query string → exchange automático.
  useEffect(() => {
    if (!tokenParam) return
    let cancelled = false

    ;(async () => {
      try {
        const resp = await exchangePortalToken(tokenParam)
        if (cancelled) return

        // Persistência igual ao LoginPage — interceptor do axios usa essas keys.
        localStorage.setItem('icv_token', resp.token)
        localStorage.setItem('icv_role',  resp.role)
        localStorage.setItem('icv_cliente_final', JSON.stringify(resp.cliente))

        // Branding: best-effort. Se falhar, segue sem tema customizado.
        if (resp.cliente.portalSlug) {
          try {
            const b = await fetchPortalBranding(resp.cliente.portalSlug)
            if (cancelled) return
            localStorage.setItem('icv_portal_branding', JSON.stringify(b))
            setBranding(b)
          } catch {
            // ignore — branding é decorativo
          }
        }

        // Limpa o token da URL — security hygiene (history, copy/paste).
        params.delete('token')
        setParams(params, { replace: true })

        // Pequena pausa pra mostrar "ok" antes de navegar.
        setTimeout(() => navigate('/portal/home', { replace: true }), 600)
      } catch (e) {
        if (cancelled) return
        setError(formatApiError(e))
        setPhase('error')
      }
    })()

    return () => { cancelled = true }
  }, [tokenParam])

  function submitManual(e: FormEvent) {
    e.preventDefault()
    if (!manualToken.trim()) return
    setParams({ token: manualToken.trim() })
  }

  return (
    <div className="min-h-screen bg-space-950 flex items-center justify-center p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md bg-space-900/80 backdrop-blur border border-slate-200 dark:border-white/10 rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <Shield className="w-5 h-5 text-emerald-300" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">Portal Cliente</h1>
            <p className="text-xs text-slate-500">Acesso por magic-link</p>
          </div>
        </div>

        {phase === 'exchanging' && (
          <div className="py-6 text-center">
            <Loader2 className="w-7 h-7 text-cyan-400 mx-auto animate-spin" />
            <p className="text-sm text-slate-300 mt-3">Validando seu acesso…</p>
            {branding && (
              <p className="text-xs text-emerald-300 mt-2">Bem-vindo a {branding.name}</p>
            )}
          </div>
        )}

        {phase === 'error' && (
          <div>
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Não foi possível abrir o portal</p>
                <p className="text-xs mt-0.5 opacity-80">{error}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Magic-links são únicos por sessão e expiram. Solicite um novo link
              ao seu integrador (responsável pelo contrato).
            </p>
            <button
              onClick={() => { setError(null); setPhase('manual'); setParams({}, { replace: true }) }}
              className="mt-4 w-full px-3 py-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-200 rounded-lg text-sm transition"
            >
              Tentar com outro link
            </button>
          </div>
        )}

        {phase === 'manual' && (
          <form onSubmit={submitManual}>
            <p className="text-sm text-slate-300 mb-4 leading-relaxed">
              Cole abaixo o magic-link recebido por email/WhatsApp. Apenas o
              campo <strong className="text-cyan-600 dark:text-cyan-300">token=</strong> é necessário —
              você pode colar a URL inteira.
            </p>
            <div className="relative mb-3">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={manualToken}
                onChange={e => {
                  // Aceita URL completa OU token cru — extrai automaticamente.
                  const v = e.target.value
                  const m = /[?&]token=([^&\s]+)/.exec(v)
                  setManualToken(m ? decodeURIComponent(m[1]) : v.trim())
                }}
                placeholder="Cole o magic-link ou token aqui"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-space-800/40 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-white placeholder:text-slate-600 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={!manualToken}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 rounded-lg text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Entrar no portal
              <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-[11px] text-slate-600 mt-4 leading-relaxed">
              Se você não recebeu nenhum link, fale com o responsável pelo
              contrato no seu integrador. Ele pode emitir um novo a qualquer
              momento.
            </p>
          </form>
        )}
      </motion.div>
    </div>
  )
}
