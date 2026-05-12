/**
 * Exports Dir Cleaner (2026-05-12) — apaga arquivos antigos de `/app/exports/`.
 *
 * Por que existe:
 *   Toda exportação (snapshot/recording/mosaic) grava o resultado em
 *   `EXPORTS_DIR` e expõe via `/exports/<jobId>.<ext>?ticket=...` (P0-1 fix).
 *   Ticket TTL = 1h; depois disso o arquivo continua no disco mas ninguém
 *   consegue baixar mais. Sem cleanup, o diretório enche até o disk full
 *   (especialmente exports de range que viram .mp4 de 100MB+).
 *
 * Regra:
 *   - Idade do arquivo > EXPORTS_RETAIN_HOURS (default 24h) → apaga
 *   - Job em memória ainda referenciando? Apaga mesmo assim — usuário
 *     teve 24h pra baixar; ticket já expirou faz tempo
 *   - Diretório criado externamente (sem ext .mp4/.jpg/.png) é ignorado
 *
 * Tick interval: 1h (não precisa ser preciso ao segundo).
 *
 * Métrica: loga total apagado + bytes liberados quando >0.
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import { logger } from '../lib/logger'

const EXPORTS_DIR     = join(process.cwd(), 'exports')
const RETAIN_HOURS    = Number(process.env.EXPORTS_RETAIN_HOURS ?? 24)
const TICK_MS         = Number(process.env.EXPORTS_CLEANER_TICK_MS ?? 60 * 60_000)
const ENABLED         = process.env.EXPORTS_CLEANER_ENABLED !== 'false'

// Extensões válidas — qualquer outra coisa no diretório é ignorada
// (defensiva contra apagar arquivos "soltos" de operador).
const VALID_EXTS = new Set(['.mp4', '.jpg', '.jpeg', '.png'])

let timer: NodeJS.Timeout | null = null

async function tick(): Promise<void> {
  try {
    const cutoffMs = Date.now() - RETAIN_HOURS * 60 * 60_000
    let entries: string[]
    try {
      entries = await fs.readdir(EXPORTS_DIR)
    } catch (err: any) {
      if (err?.code === 'ENOENT') return // diretório ainda não criado
      throw err
    }

    let removed = 0
    let bytesFreed = 0

    for (const name of entries) {
      // Só processa arquivos com extensão conhecida (UUID.ext)
      const dotIdx = name.lastIndexOf('.')
      if (dotIdx < 0) continue
      const ext = name.slice(dotIdx).toLowerCase()
      if (!VALID_EXTS.has(ext)) continue

      const full = join(EXPORTS_DIR, name)
      try {
        const st = await fs.stat(full)
        if (!st.isFile()) continue
        if (st.mtimeMs >= cutoffMs) continue

        await fs.unlink(full)
        removed++
        bytesFreed += st.size
      } catch (err: any) {
        // Race com export job que acabou de gerar — ignora
        if (err?.code === 'ENOENT') continue
        logger.warn({ err, file: name }, 'exports_dir_cleaner_unlink_failed')
      }
    }

    if (removed > 0) {
      logger.info({ removed, bytesFreed, retainHours: RETAIN_HOURS },
        'exports_dir_cleaner_done')
    }
  } catch (err) {
    logger.warn({ err }, 'exports_dir_cleaner_failed')
  }
}

export const exportsDirCleaner = {
  start(): void {
    if (!ENABLED) {
      logger.info('exports_dir_cleaner_disabled')
      return
    }
    if (timer) return
    logger.info({ retainHours: RETAIN_HOURS, tickMs: TICK_MS },
      'exports_dir_cleaner_starting')
    // Tick imediato pra limpar pendências do boot (overnight com pod morto)
    tick().catch(() => {})
    timer = setInterval(() => { tick().catch(() => {}) }, TICK_MS)
  },
  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },
  /** Pra debug — dispara tick sob demanda. */
  async tickNow(): Promise<void> { return tick() },
}
