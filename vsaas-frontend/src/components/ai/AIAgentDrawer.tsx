/**
 * AIAgentDrawer — chat conversacional sobre os events das câmeras.
 *
 * UX:
 *  • Botão flutuante ARRASTÁVEL (default canto inferior direito) que abre drawer
 *  • Input + envio
 *  • Histórico de mensagens com avatar
 *  • Indica ferramentas chamadas pelo modelo ("usou search_events, get_review_segments")
 *  • Sugestões clicáveis pra primeira interação
 *  • Stats no header (calls/cap)
 *
 * Drag UX:
 *  • PointerDown → começa a rastrear movimento
 *  • Se movimento > 5px → ativa drag (não dispara click ao soltar)
 *  • Se movimento <= 5px → trata como click normal (abre drawer)
 *  • Posição persistida em localStorage (icv_ai_button_pos)
 *  • Snap nas bordas (margin mínima 8px) e clamp para não sair da viewport
 *  • Touch + mouse via PointerEvents
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { MessageCircle, X, Send, Loader2, Bot, User, Wrench, GripVertical } from 'lucide-react'
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

// ── Drag state (posição persistida do botão) ─────────────────────────────────
interface ButtonPos {
  /** Distância da DIREITA em px. null = não foi movido ainda (usa default 24px). */
  right: number | null
  /** Distância de BAIXO em px. null = não foi movido ainda (usa default 24px). */
  bottom: number | null
}

const STORAGE_KEY = 'icv_ai_button_pos'
const DRAG_THRESHOLD_PX = 5
const EDGE_MARGIN_PX = 8

function loadPos(): ButtonPos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (typeof p.right === 'number' && typeof p.bottom === 'number') return p
    }
  } catch {}
  return { right: null, bottom: null }
}

function savePos(pos: ButtonPos): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)) } catch {}
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

  // ── Drag state ─────────────────────────────────────────────────────────
  const [pos, setPos] = useState<ButtonPos>(() => loadPos())
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    startX: number; startY: number
    origRight: number; origBottom: number
    moved: boolean
    pointerId: number
  } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Clamp para não deixar o botão sair da tela em resize de janela
  useEffect(() => {
    function onResize() {
      if (pos.right === null) return
      const btn = buttonRef.current
      if (!btn) return
      const w = btn.offsetWidth
      const h = btn.offsetHeight
      const maxRight = window.innerWidth  - w - EDGE_MARGIN_PX
      const maxBottom = window.innerHeight - h - EDGE_MARGIN_PX
      const clamped: ButtonPos = {
        right:  Math.max(EDGE_MARGIN_PX, Math.min(pos.right!,  maxRight)),
        bottom: Math.max(EDGE_MARGIN_PX, Math.min(pos.bottom!, maxBottom)),
      }
      if (clamped.right !== pos.right || clamped.bottom !== pos.bottom) {
        setPos(clamped)
        savePos(clamped)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pos])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    // Ignora botão direito do mouse
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    // Calcula posição atual relativa às bordas direita/baixo
    const currentRight  = pos.right  ?? (window.innerWidth  - rect.right)
    const currentBottom = pos.bottom ?? (window.innerHeight - rect.bottom)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origRight: currentRight,
      origBottom: currentBottom,
      moved: false,
      pointerId: e.pointerId,
    }
    btn.setPointerCapture(e.pointerId)
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    // Threshold: só ativa drag se moveu >5px (evita drag em click normal)
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    if (!d.moved) {
      d.moved = true
      setDragging(true)
    }
    const btn = buttonRef.current
    if (!btn) return
    const w = btn.offsetWidth
    const h = btn.offsetHeight
    // Movimento INVERTE direção: arrastar pra direita diminui o right
    const newRight  = d.origRight  - dx
    const newBottom = d.origBottom - dy
    // Clamp para ficar visível na tela
    const maxRight  = window.innerWidth  - w - EDGE_MARGIN_PX
    const maxBottom = window.innerHeight - h - EDGE_MARGIN_PX
    const clamped: ButtonPos = {
      right:  Math.max(EDGE_MARGIN_PX, Math.min(newRight,  maxRight)),
      bottom: Math.max(EDGE_MARGIN_PX, Math.min(newBottom, maxBottom)),
    }
    setPos(clamped)
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const btn = buttonRef.current
    if (btn) btn.releasePointerCapture(e.pointerId)
    if (d.moved) {
      // Foi drag: persistir e BLOQUEAR o click subsequente
      savePos(pos)
      // Pequeno delay pra evitar que o onClick dispare logo após mouseup
      setTimeout(() => setDragging(false), 50)
    } else {
      setDragging(false)
    }
    dragRef.current = null
  }, [pos])

  // Double-click pra resetar pra posição default (canto inferior direito)
  const resetPosition = useCallback(() => {
    const def: ButtonPos = { right: null, bottom: null }
    setPos(def)
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }, [])

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
      {/* Floating button (arrastável) */}
      {!open && (
        <button
          ref={buttonRef}
          onClick={() => {
            // Bloqueia o click se acabou de arrastar (evita abrir drawer ao terminar drag)
            if (dragging) return
            setOpen(true)
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => { e.stopPropagation(); resetPosition() }}
          style={{
            right:  `${pos.right  ?? 24}px`,
            bottom: `${pos.bottom ?? 24}px`,
            // Cursor visual para indicar drag
            cursor: dragging ? 'grabbing' : 'grab',
            touchAction: 'none', // impede scroll do mobile ao arrastar
            userSelect: 'none',
          }}
          className="fixed z-40 px-4 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 text-white shadow-lg hover:shadow-xl transition-shadow flex items-center gap-2 font-medium select-none"
          title="Clique para abrir · Arraste para mover · Duplo clique para resetar posição"
        >
          <GripVertical className="w-3 h-4 opacity-50 -ml-1" />
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
