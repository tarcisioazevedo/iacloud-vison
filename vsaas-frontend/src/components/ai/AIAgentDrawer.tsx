/**
 * AIAgentDrawer — chat conversacional sobre os events das câmeras.
 *
 * UX:
 *  • Botão flutuante (canto inferior direito) que abre drawer lateral
 *  • Input + envio
 *  • Histórico de mensagens com avatar
 *  • Indica ferramentas chamadas pelo modelo ("usou search_events, get_review_segments")
 *  • Sugestões clicáveis pra primeira interação
 *  • Stats no header (calls/cap)
 */

import { useState, useEffect, useRef } from 'react'
import { MessageCircle, X, Send, Loader2, Bot, User, Wrench } from 'lucide-react'
import {
  aiAgentChat,
  aiAgentStats,
  type AIAgentMessage,
} from '../../api/client'

const SUGGESTIONS = [
  'O que aconteceu nas últimas 6 horas?',
  'Quantas pessoas foram detectadas hoje?',
  'Mostre os 5 alertas mais recentes',
  'Houve algum carro estranho ontem à noite?',
]

interface UIMessage {
  role: 'user' | 'model'
  text: string
  toolsCalled?: string[]
}

export function AIAgentDrawer() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [history, setHistory] = useState<AIAgentMessage[]>([])
  const [uiMessages, setUiMessages] = useState<UIMessage[]>([])
  const [stats, setStats] = useState<{ available: boolean; callsToday: number; cap: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    aiAgentStats().then(setStats).catch(() => {})
  }, [open])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [uiMessages, sending])

  async function send(text?: string) {
    const message = text ?? input
    if (!message.trim() || sending) return
    setError(null)
    setSending(true)
    const userMsg: UIMessage = { role: 'user', text: message }
    setUiMessages(prev => [...prev, userMsg])
    setInput('')

    try {
      const resp = await aiAgentChat({ history, message })
      setUiMessages(prev => [
        ...prev,
        {
          role: 'model',
          text: resp.reply ?? '(sem resposta)',
          toolsCalled: resp.toolsCalled,
        },
      ])
      setHistory(resp.newHistory)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e.message ?? 'erro desconhecido')
    } finally {
      setSending(false)
    }
  }

  function reset() {
    setHistory([])
    setUiMessages([])
    setError(null)
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 px-4 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 text-white shadow-lg hover:shadow-xl hover:scale-105 transition flex items-center gap-2 font-medium"
        >
          <Bot className="w-5 h-5" />
          <span>Pergunte à IA</span>
          {stats && !stats.available && (
            <span className="text-[10px] bg-rose-500 px-1.5 py-0.5 rounded">off</span>
          )}
        </button>
      )}

      {/* Drawer */}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[420px] max-w-[95vw] h-[600px] max-h-[85vh] bg-white dark:bg-space-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-white/10 bg-gradient-to-r from-cyan-500/10 to-violet-500/10">
            <Bot className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-white">Assistente IA · CFTV</p>
              {stats && (
                <p className="text-[10px] text-slate-500">
                  {stats.available
                    ? `${stats.callsToday}/${stats.cap} consultas hoje`
                    : 'IA não configurada — admin deve configurar GEMINI_API_KEY'}
                </p>
              )}
            </div>
            {uiMessages.length > 0 && (
              <button
                onClick={reset}
                className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-500"
              >
                Limpar
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="p-1 hover:bg-white/10 rounded"
            >
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
            {uiMessages.length === 0 && (
              <div className="space-y-3">
                <p className="text-slate-500 text-xs">
                  Pergunte sobre as detecções das suas câmeras. Sugestões:
                </p>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 hover:border-cyan-400 hover:bg-cyan-500/5 transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {uiMessages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'model' && (
                  <div className="w-7 h-7 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-lg px-3 py-2 ${
                  m.role === 'user'
                    ? 'bg-cyan-500 text-white'
                    : 'bg-slate-100 dark:bg-white/[0.05] text-slate-800 dark:text-slate-200'
                }`}>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed">{m.text}</p>
                  {m.toolsCalled && m.toolsCalled.length > 0 && (
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-white/10">
                      <Wrench className="w-3 h-3 text-slate-400" />
                      <span className="text-[9px] text-slate-400">
                        usou: {m.toolsCalled.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
                {m.role === 'user' && (
                  <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Consultando câmeras...</span>
              </div>
            )}

            {error && (
              <div className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded p-2">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 dark:border-white/10 p-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !sending && send()}
                placeholder="Pergunte sobre suas câmeras..."
                disabled={sending}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm focus:outline-none focus:border-cyan-500 disabled:opacity-50"
              />
              <button
                onClick={() => send()}
                disabled={sending || !input.trim()}
                className="px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
