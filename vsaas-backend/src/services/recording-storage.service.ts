/**
 * Recording Storage — abstração de filesystem para gravações HLS.
 *
 * Em dev usamos disco local (volume Docker). Em produção podemos plugar
 * S3/MinIO sem mudar caller — esta camada esconde o protocolo.
 *
 * Layout em disco:
 *   <BASE>/<cameraId>/<YYYY-MM-DD>/<HH-mm-ss>-<segmentId>.ts
 *
 * Por que diretório por dia:
 *   - 1 câmera 1080p contínua = ~21.600 segmentos/dia (4s cada)
 *   - Postgres aguenta milhões de rows, mas filesystem fica lento com
 *     >50k arquivos no mesmo dir (ext4/btrfs, ainda pior em FAT32)
 *   - Particionar por dia mantém ~22k arquivos/dir → operações rápidas
 *   - Bonus: retention diária = `rm -rf <BASE>/<cameraId>/<dia>/` instantâneo
 */
import { promises as fs, createReadStream } from 'fs'
import { dirname, join } from 'path'
import type { Readable } from 'stream'
import { logger } from '../lib/logger'

const BASE_PATH = process.env.RECORDINGS_BASE_PATH ?? '/recordings'

export const recordingStorage = {
  /** Caminho absoluto do segmento, dado seu storagePath relativo. */
  absolutePath(relativePath: string): string {
    return join(BASE_PATH, relativePath)
  },

  /**
   * Garante que o diretório de destino existe. Ffmpeg recusa escrever
   * em diretório inexistente — chamamos antes de spawnar o processo.
   */
  async ensureDir(relativePath: string): Promise<void> {
    const abs = this.absolutePath(relativePath)
    await fs.mkdir(dirname(abs), { recursive: true })
  },

  /**
   * Stream legível pro Express.send pipe. Lança se arquivo não existe.
   */
  openReadStream(relativePath: string): Readable {
    return createReadStream(this.absolutePath(relativePath))
  },

  /**
   * Stat do arquivo — usado pra Content-Length na resposta HTTP.
   * Retorna null se arquivo sumiu (segmento expirou entre o manifest
   * ser gerado e o cliente baixar).
   */
  async stat(relativePath: string): Promise<{ size: number } | null> {
    try {
      const s = await fs.stat(this.absolutePath(relativePath))
      return { size: s.size }
    } catch {
      return null
    }
  },

  /**
   * Remove segmento — usado pelo retention job. Idempotente (não falha
   * se já não existe). Loga warning em outros erros (permissão, etc).
   */
  async remove(relativePath: string): Promise<void> {
    try {
      await fs.unlink(this.absolutePath(relativePath))
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        logger.warn({ err, path: relativePath }, 'recording_storage_remove_failed')
      }
    }
  },

  /**
   * Constrói storagePath relativo no padrão da app.
   *   cameraId = "cam-abc"
   *   startedAt = 2026-04-26T14:32:08Z
   *   segmentId = "seg-xyz"
   *   → "cam-abc/2026-04-26/14-32-08_seg-xyz.ts"
   */
  buildPath(cameraId: string, startedAt: Date, segmentId: string): string {
    const yyyy = startedAt.getUTCFullYear()
    const mm = String(startedAt.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(startedAt.getUTCDate()).padStart(2, '0')
    const hh = String(startedAt.getUTCHours()).padStart(2, '0')
    const mi = String(startedAt.getUTCMinutes()).padStart(2, '0')
    const ss = String(startedAt.getUTCSeconds()).padStart(2, '0')
    return `${cameraId}/${yyyy}-${mm}-${dd}/${hh}-${mi}-${ss}_${segmentId}.ts`
  },
}
