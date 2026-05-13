/**
 * Recording Tmpfs Watchdog (G4 fix — 2026-05-09).
 *
 * Por que existe:
 *   /recordings é tmpfs 4GB no container backend (memory limit 1024M).
 *   Em cgroup v2, alocação de tmpfs conta na memória do container. Se R2
 *   ficar offline e segments forem acumulando como PENDING (esperando
 *   retry), o tmpfs cresce até OOM-kill do backend (~10min de outage).
 *
 * O que faz:
 *   Tick a cada 30s checa `df /recordings`. Estados:
 *     OK       (<70%): nada
 *     WARN  (≥70%): log warning + emite alerta (deduplicado pelo alert.service)
 *     PAUSE (≥85%): além do alerta, exporta flag global `recordingPaused=true`
 *                    que recording.service / cloud-direct-recorder consultam
 *                    pra NÃO criar novos ffmpeg até descer.
 *
 * Como pausar:
 *   `isRecordingPaused()` é checado em `recording.service::tickReconcile` e em
 *   `cloud-direct-recorder::startRecording`. Se true, ambos retornam early.
 *
 * Recovery:
 *   Sai do estado PAUSE quando uso desce para <60% (histerese de 25%).
 *   Worker continua rodando (esvazia a fila) — esse é o caminho de recovery.
 */
import { promises as fs } from 'fs'
import { logger } from '../lib/logger'

const BASE_PATH      = process.env.RECORDINGS_BASE_PATH ?? '/recordings'
const TICK_MS        = Number(process.env.TMPFS_WATCHDOG_TICK_MS ?? 30_000)
const WARN_PCT       = Number(process.env.TMPFS_WARN_PCT ?? 70)
const PAUSE_PCT      = Number(process.env.TMPFS_PAUSE_PCT ?? 85)
const RESUME_PCT     = Number(process.env.TMPFS_RESUME_PCT ?? 60)   // histerese
const ENABLED        = process.env.RECORDING_ENABLED !== 'false'
                    && process.env.TMPFS_WATCHDOG_ENABLED !== 'false'

let timer: NodeJS.Timeout | null = null
let paused = false
let lastSnapshot: { usedBytes: number; totalBytes: number; pct: number } | null = null

async function statTmpfs(): Promise<{ usedBytes: number; totalBytes: number; pct: number } | null> {
  // Usa `statfs` via /proc — disponível em Linux. fs.statfs (Node 18+) também
  // funciona. Aqui escolhemos via comando shell pra simplicidade + portátil.
  // Alternativa em Node: fs.statfs(BASE_PATH) (experimental); fica como follow-up.
  try {
    const { execSync } = await import('child_process')
    const out = execSync(`df -PB1 ${BASE_PATH} | tail -1`).toString().trim()
    // Layout: filesystem 1B-blocks used available capacity mounted-on
    const parts = out.split(/\s+/)
    const total = Number(parts[1])
    const used  = Number(parts[2])
    if (!isFinite(total) || total <= 0) return null
    const pct = Math.round((used / total) * 1000) / 10
    return { usedBytes: used, totalBytes: total, pct }
  } catch (err) {
    logger.warn({ err }, 'tmpfs_watchdog_df_failed')
    return null
  }
}

async function broadcastStateChange(state: 'PAUSE' | 'RESUME' | 'WARN', snap: NonNullable<typeof lastSnapshot>) {
  // SSE broadcast pra UI mostrar banner em tempo real (Onda 1 / P0 #3).
  // Import dinâmico para evitar ciclo: sse-bus depende de notification → alert → recorder.
  try {
    const { broadcastSse } = await import('../lib/sse-bus')
    // Broadcast global (target=null = todos os clientes SSE conectados)
    broadcastSse({ scope: 'all' } as any, {
      type:     'tmpfs_state',
      severity: state === 'PAUSE' ? 'CRITICAL' : state === 'WARN' ? 'WARNING' : 'INFO',
      title:    state === 'PAUSE'  ? 'Gravação pausada — disco cheio'
              : state === 'WARN'   ? 'Disco de gravação quase cheio'
              :                       'Gravação retomada',
      body:     `Tmpfs em ${snap.pct.toFixed(1)}% (${Math.round(snap.usedBytes / 1024 / 1024)} MB / ${Math.round(snap.totalBytes / 1024 / 1024)} MB)`,
      ts:       Date.now(),
      // payload extra pra UI usar
      meta: { tmpfsState: state, pct: snap.pct, paused: state === 'PAUSE' },
    } as any)
  } catch (err) {
    logger.warn({ err }, 'tmpfs_watchdog_sse_broadcast_failed')
  }
}

async function tick(): Promise<void> {
  const snap = await statTmpfs()
  if (!snap) return
  lastSnapshot = snap

  if (!paused && snap.pct >= PAUSE_PCT) {
    paused = true
    logger.error({
      pct: snap.pct, usedMb: Math.round(snap.usedBytes / 1024 / 1024),
      totalMb: Math.round(snap.totalBytes / 1024 / 1024),
    }, 'tmpfs_watchdog_PAUSE')
    broadcastStateChange('PAUSE', snap)
  } else if (paused && snap.pct < RESUME_PCT) {
    paused = false
    logger.info({ pct: snap.pct }, 'tmpfs_watchdog_resume')
    broadcastStateChange('RESUME', snap)
  } else if (snap.pct >= WARN_PCT) {
    logger.warn({ pct: snap.pct }, 'tmpfs_watchdog_warn')
    // WARN não dispara SSE a cada tick — só quando atravessa o threshold
    // (controle via tracker simples no escopo do módulo)
    if (!warnedAt || Date.now() - warnedAt > 10 * 60_000) {
      warnedAt = Date.now()
      broadcastStateChange('WARN', snap)
    }
  } else {
    logger.debug({ pct: snap.pct }, 'tmpfs_watchdog_ok')
    if (snap.pct < WARN_PCT - 5) warnedAt = null  // reset histerese WARN
  }
}

let warnedAt: number | null = null

export const tmpfsWatchdog = {
  start(): void {
    if (!ENABLED) {
      logger.info('tmpfs_watchdog_disabled')
      return
    }
    if (timer) return
    logger.info({
      tickMs: TICK_MS, warnPct: WARN_PCT, pausePct: PAUSE_PCT, resumePct: RESUME_PCT,
    }, 'tmpfs_watchdog_starting')
    tick().catch(err => logger.warn({ err }, 'tmpfs_watchdog_tick_failed'))
    timer = setInterval(() => {
      tick().catch(err => logger.warn({ err }, 'tmpfs_watchdog_tick_failed'))
    }, TICK_MS)
  },
  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },
  /** True quando uso passou de PAUSE_PCT — recording deve abortar novos spawns. */
  isPaused(): boolean { return paused },
  /** Snapshot pra /health endpoint. */
  snapshot(): typeof lastSnapshot { return lastSnapshot },
}

export function isRecordingPaused(): boolean {
  return paused
}

void fs    // marca import como usado (reservado pra futuro fs.statfs)
