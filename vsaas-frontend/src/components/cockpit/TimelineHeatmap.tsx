/**
 * TimelineHeatmap — barra horizontal 24h com densidade de events por hora.
 *
 * • h-20 alta, contraste forte mesmo sem dados
 * • Click → seek pro INÍCIO da hora (HH:00:00)
 * • Cursor playhead com label de hora atual
 * • Linha sutil "AGORA" quando for o dia atual
 * • Bookmarks como ⭐ clicáveis no topo
 * • Botão "Analisar com IA" (Gemini Pro)
 * • Hover tooltip com z-50 (não corta)
 */

import { useState, useEffect } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import type { TimelineHeatmapHour } from '../../api/client'
import { localSecOfDay, isoDate } from '../../lib/day-utils'

interface Bookmark {
  id:    string
  atSec: number
  label: string
}

interface Props {
  hours:        TimelineHeatmapHour[]
  currentSec?:  number | null
  bookmarks?:   Bookmark[]
  cameraId?:    string
  day?:         string
  onSeek?:      (secOfDay: number) => void
  onAnalyzeAI?: () => void
  analyzing?:   boolean
  className?:   string
}

function densityClass(total: number): string {
  if (total === 0) return 'bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700'
  if (total <= 10) return 'bg-emerald-500 hover:bg-emerald-400'
  if (total <= 50) return 'bg-amber-500 hover:bg-amber-400'
  return 'bg-rose-500 hover:bg-rose-400'
}

export function TimelineHeatmap({
  hours,
  currentSec,
  bookmarks = [],
  day,
  onSeek,
  onAnalyzeAI,
  analyzing = false,
  className,
}: Props) {
  const [hoverHour, setHoverHour] = useState<number | null>(null)
  const [nowSecUtc, setNowSecUtc] = useState<number>(() => localSecOfDay(new Date()))

  // Atualiza posição "AGORA" a cada minuto (se day = hoje local)
  useEffect(() => {
    const interval = setInterval(() => setNowSecUtc(localSecOfDay(new Date())), 60_000)
    return () => clearInterval(interval)
  }, [])

  const todayIso = isoDate(new Date())
  const isToday  = day === todayIso

  const totalAll  = hours.reduce((a, h) => a + h.total, 0)
  const alertsAll = hours.reduce((a, h) => a + h.alerts, 0)
  const peakHour  = hours.reduce((peak, h) => h.total > peak.total ? h : peak, hours[0] ?? { hour: 0, total: 0, alerts: 0 })

  // Click → INÍCIO exato da hora (HH:00:00) — operador quer "ver desde quando começou"
  const handleClickHour = (h: number) => {
    if (!onSeek) return
    onSeek(h * 3600)
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* Header com stats + botão IA */}
      <div className="flex items-center justify-between mb-2 text-[11px]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
            Timeline 24h
          </span>
          <span className="text-slate-500">
            <strong className="text-slate-700 dark:text-slate-200">{totalAll.toLocaleString('pt-BR')}</strong> events
            {alertsAll > 0 && (
              <> · <strong className="text-rose-500">{alertsAll.toLocaleString('pt-BR')}</strong> alertas</>
            )}
            {peakHour.total > 0 && (
              <> · <span className="text-amber-600 dark:text-amber-400">pico {String(peakHour.hour).padStart(2,'0')}h ({peakHour.total.toLocaleString('pt-BR')})</span></>
            )}
          </span>
        </div>
        {onAnalyzeAI && (
          <button
            onClick={onAnalyzeAI}
            disabled={analyzing || totalAll === 0}
            className="px-2.5 py-1 rounded bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed text-white text-[11px] font-medium flex items-center gap-1.5 shadow-sm"
            title={totalAll === 0 ? 'Sem events para analisar' : 'Gemini Pro interpreta o padrão do dia'}
          >
            {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {analyzing ? 'Analisando...' : 'Analisar com IA'}
          </button>
        )}
      </div>

      {/* Barra heatmap — h-20 com tick marks visuais a cada 3h */}
      <div
        className="relative h-20 bg-slate-50 dark:bg-slate-900 rounded-md overflow-visible flex border border-slate-300 dark:border-white/10 shadow-inner"
        onMouseLeave={() => setHoverHour(null)}
      >
        {/* Tick marks a cada hora (separadores sutis) */}
        {Array.from({ length: 23 }, (_, i) => (
          <div
            key={`tick-${i}`}
            className={`absolute top-0 bottom-0 w-px pointer-events-none ${
              (i + 1) % 3 === 0 ? 'bg-slate-300/60 dark:bg-white/10' : 'bg-slate-200/40 dark:bg-white/5'
            }`}
            style={{ left: `${((i + 1) / 24) * 100}%` }}
          />
        ))}

        {hours.map(h => (
          <button
            key={h.hour}
            onClick={() => handleClickHour(h.hour)}
            onMouseEnter={() => setHoverHour(h.hour)}
            className={`flex-1 relative transition-all duration-200 cursor-pointer ${densityClass(h.total)}`}
            aria-label={`${String(h.hour).padStart(2, '0')}:00 — ${h.total} events`}
          >
            {h.total > 0 && (
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white drop-shadow-md select-none">
                {h.total.toLocaleString('pt-BR')}
              </span>
            )}
          </button>
        ))}

        {/* Linha "AGORA" — só quando for o dia atual */}
        {isToday && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none z-10"
            style={{ left: `${(nowSecUtc / 86400) * 100}%` }}
          >
            <div className="absolute top-0 bottom-0 w-px bg-rose-400" />
            <span className="absolute -top-4 left-0 -translate-x-1/2 px-1 py-0.5 rounded text-[8px] font-bold bg-rose-500 text-white whitespace-nowrap">
              AGORA
            </span>
          </div>
        )}

        {/* Playhead — cursor de playback */}
        {currentSec != null && currentSec >= 0 && currentSec < 86400 && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none z-20"
            style={{ left: `${(currentSec / 86400) * 100}%` }}
          >
            <div className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-cyan-400 rounded-full ring-2 ring-white dark:ring-space-900" />
            <span className="absolute -bottom-5 left-0 -translate-x-1/2 px-1 py-0.5 rounded text-[8px] font-mono font-bold bg-cyan-500 text-white whitespace-nowrap">
              {String(Math.floor(currentSec / 3600)).padStart(2, '0')}:{String(Math.floor((currentSec % 3600) / 60)).padStart(2, '0')}
            </span>
          </div>
        )}

        {/* Bookmarks ⭐ no topo, clicáveis */}
        {bookmarks.map(b => (
          <button
            key={b.id}
            className="absolute -top-3 -translate-x-1/2 z-30 cursor-pointer text-lg hover:scale-125 transition"
            style={{ left: `${(b.atSec / 86400) * 100}%` }}
            title={b.label}
            onClick={(e) => { e.stopPropagation(); onSeek?.(b.atSec) }}
          >
            <span className="text-yellow-400 drop-shadow-lg">⭐</span>
          </button>
        ))}

        {/* Hover tooltip — z-50, fora do overflow */}
        {hoverHour != null && (
          <HourHoverTooltip
            hour={hoverHour}
            data={hours.find(h => h.hour === hoverHour) ?? { hour: hoverHour, total: 0, alerts: 0 }}
          />
        )}
      </div>

      {/* Labels horas (00h..24h) */}
      <div className="relative h-3 mt-1 text-[9px] text-slate-500 select-none">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => (
          <span
            key={h}
            className="absolute"
            style={{
              left: `${(h / 24) * 100}%`,
              transform: h === 0 ? 'translateX(0)' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {String(h).padStart(2, '0')}h
          </span>
        ))}
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-3 mt-1 text-[9px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm" /> 1-10
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-amber-500 rounded-sm" /> 11-50
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-rose-500 rounded-sm" /> 51+
        </span>
        {isToday && (
          <span className="flex items-center gap-1 text-rose-500">
            <span className="w-0.5 h-2.5 bg-rose-400" /> AGORA
          </span>
        )}
        {currentSec != null && (
          <span className="flex items-center gap-1 text-cyan-500">
            <span className="w-0.5 h-2.5 bg-cyan-400" /> Playback
          </span>
        )}
        {bookmarks.length > 0 && (
          <span className="flex items-center gap-1 text-yellow-400">
            ⭐ {bookmarks.length}
          </span>
        )}
        <span className="ml-auto text-slate-400 italic">
          Click numa hora → playback · Click no ⭐ → vai pro bookmark
        </span>
      </div>
    </div>
  )
}

// ============================================================================
// HourHoverTooltip — flutua acima da hora com hover, z-50
// ============================================================================

function HourHoverTooltip({ hour, data }: {
  hour: number
  data: TimelineHeatmapHour
}) {
  const leftPct = (hour / 24) * 100 + (100 / 24) / 2

  return (
    <div
      className="absolute z-50 pointer-events-none -translate-x-1/2"
      style={{ left: `${leftPct}%`, top: '-80px' }}
    >
      <div className="bg-slate-900 text-white rounded-lg shadow-2xl px-3 py-2 text-[11px] whitespace-nowrap border border-white/10">
        <p className="font-bold text-cyan-300">
          {String(hour).padStart(2, '0')}:00 → {String(hour).padStart(2, '0')}:59 UTC
        </p>
        {data.total > 0 ? (
          <>
            <p>
              <strong className="text-emerald-300">{data.total.toLocaleString('pt-BR')}</strong> event{data.total === 1 ? '' : 's'}
            </p>
            {data.alerts > 0 && (
              <p>
                <strong className="text-rose-300">{data.alerts.toLocaleString('pt-BR')}</strong> alert{data.alerts === 1 ? '' : 's'} (person/car/truck)
              </p>
            )}
            <p className="text-slate-400 italic text-[10px] mt-1">click para abrir playback</p>
          </>
        ) : (
          <p className="text-slate-400 italic">sem atividade</p>
        )}
      </div>
      <div className="w-0 h-0 mx-auto -mt-px border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-slate-900" />
    </div>
  )
}
