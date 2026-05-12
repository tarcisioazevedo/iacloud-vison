/**
 * Recording Storage — abstração de filesystem + R2/S3 para gravações HLS.
 *
 * Arquitetura híbrida multi-tenant:
 *   1. ffmpeg escreve segmentos localmente (disco rápido, sem latência de rede)
 *   2. Worker assíncrono faz upload para R2 (bucket-per-integrador)
 *   3. Após upload confirmado, arquivo local pode ser deletado (economiza disco)
 *   4. Playback: tenta local primeiro, fallback para R2/S3
 *
 * Layout (multi-tenant com R2):
 *   Local: <BASE>/<cameraId>/<YYYY-MM-DD>/<HH-mm-ss>_<segmentId>.ts
 *   R2:    icv-<integradorId>/<cameraId>/<YYYY-MM-DD>/<HH-mm-ss>_<segmentId>.ts
 *
 * Prioridade de storage:
 *   1. R2 (centralizado, bucket-per-integrador) — preferido
 *   2. S3 (custom do integrador) — fallback se configurado
 *   3. Local only — se nenhum cloud configurado
 */
import { promises as fs, createReadStream, existsSync } from 'fs'
import { dirname, join } from 'path'
import type { Readable } from 'stream'
import { logger } from '../lib/logger'
import { r2Storage } from './r2-storage.service'
import { s3Storage } from './s3-storage.service'

const BASE_PATH = process.env.RECORDINGS_BASE_PATH ?? '/recordings'
const DELETE_LOCAL_AFTER_UPLOAD = process.env.RECORDING_DELETE_LOCAL_AFTER_S3 === 'true'

export const recordingStorage = {
  /** Caminho absoluto do segmento, dado seu storagePath relativo. */
  absolutePath(relativePath: string): string {
    return join(BASE_PATH, relativePath)
  },

  /** Retorna true se algum cloud storage está habilitado. */
  isCloudEnabled(): boolean {
    return r2Storage.isEnabled() || s3Storage.isEnabled()
  },

  /** Retorna qual storage está ativo. */
  getActiveStorage(): 'r2' | 's3' | 'local' {
    if (r2Storage.isEnabled()) return 'r2'
    if (s3Storage.isEnabled()) return 's3'
    return 'local'
  },

  /**
   * Garante que o diretório de destino existe.
   */
  async ensureDir(relativePath: string): Promise<void> {
    const abs = this.absolutePath(relativePath)
    await fs.mkdir(dirname(abs), { recursive: true })
  },

  /**
   * Upload de segmento local para cloud storage (R2 ou S3).
   *
   * @param integradorId ID do integrador (dono da câmera)
   * @param relativePath Caminho relativo do segmento
   * @returns true se upload OK ou cloud não configurado
   */
  /**
   * Upload de segmento com fallback Modo A (2026-05-12):
   *
   *   1. Tenta R2 (primário, multi-tenant, egress-free)
   *   2. Se R2 falhar AND S3 estiver configurado → tenta S3 Hetzner
   *      (mesmo região da VPS — Falkenstein, ~5ms latency, €5.5/TB)
   *   3. Se ambos falharem → retorna false (worker reprocessa)
   *
   * Quando S3 (fallback) sobe sucesso, marcamos como UPLOADED mesmo assim —
   * playback faz fallback transparente (getReadStream tenta R2 → S3 → local).
   * Worker async reconcilia depois (TODO Modo B: sync S3→R2 quando R2 voltar).
   *
   * Modo A é graceful: se S3 não está configurado, comportamento volta a
   * ser idêntico ao anterior (só R2).
   */
  async uploadToCloud(integradorId: string, relativePath: string): Promise<boolean> {
    const localPath = this.absolutePath(relativePath)

    // Modo A: ambos R2 e S3 disponíveis (R2 primário, S3 fallback)
    if (r2Storage.isEnabled()) {
      const uploadedR2 = await r2Storage.uploadFile(integradorId, localPath, relativePath)
      if (uploadedR2) {
        if (DELETE_LOCAL_AFTER_UPLOAD) {
          try { await fs.unlink(localPath) }
          catch (err) { logger.warn({ err, path: relativePath }, 'recording_local_delete_failed') }
        }
        return true
      }

      // R2 falhou — tenta S3 Hetzner como fallback (Modo A — 2026-05-12)
      if (s3Storage.isEnabled()) {
        const uploadedS3 = await s3Storage.uploadFile(localPath, relativePath)
        if (uploadedS3) {
          logger.info({ path: relativePath, integradorId },
            'recording_upload_s3_fallback_after_r2_failed')
          if (DELETE_LOCAL_AFTER_UPLOAD) {
            try { await fs.unlink(localPath) }
            catch (err) { logger.warn({ err, path: relativePath }, 'recording_local_delete_failed') }
          }
          return true
        }
        logger.warn({ path: relativePath }, 'recording_upload_both_r2_s3_failed')
      }
      return false
    }

    // Sem R2 configurado — S3-only (instalação on-premise)
    if (s3Storage.isEnabled()) {
      const uploaded = await s3Storage.uploadFile(localPath, relativePath)
      if (uploaded && DELETE_LOCAL_AFTER_UPLOAD) {
        try { await fs.unlink(localPath) }
        catch (err) { logger.warn({ err, path: relativePath }, 'recording_local_delete_failed') }
      }
      return uploaded
    }

    // Nenhum cloud configurado — local only
    return true
  },

  /**
   * Stream de leitura com fallback cloud.
   * Retorna null se não encontrar em nenhum lugar.
   *
   * G17 fix (2026-05-09): aceita `hint` com bucket conhecido vindo de
   * RecordingSegment.uploadBucket. Quando setado e começa com 'icv-' (R2),
   * pula existsSync local + vai direto pro R2. Economiza 1 syscall + busca
   * em /recordings (típicamente ~50ms em tmpfs cheio com muitos arquivos).
   *
   * Quando hint não informado (uploadBucket null no segment), mantém
   * comportamento histórico: local → R2 → S3.
   */
  async getReadStream(
    integradorId: string,
    relativePath: string,
    hint?: { knownBucket?: string | null },
  ): Promise<Readable | null> {
    // Atalho: bucket conhecido do segment row → vai direto pra cloud.
    const knownBucket = hint?.knownBucket
    if (knownBucket?.startsWith('icv-') && r2Storage.isEnabled()) {
      const stream = await r2Storage.getStream(integradorId, relativePath)
      if (stream) return stream
      // Se R2 não tem (improvável), cai pro caminho clássico.
    }

    const localPath = this.absolutePath(relativePath)

    // Tenta local primeiro (mais rápido)
    if (existsSync(localPath)) {
      return createReadStream(localPath)
    }

    // Fallback R2
    if (r2Storage.isEnabled()) {
      const stream = await r2Storage.getStream(integradorId, relativePath)
      if (stream) return stream
    }

    // Fallback S3
    if (s3Storage.isEnabled()) {
      return await s3Storage.getStream(relativePath)
    }

    return null
  },

  /**
   * Stat apenas do arquivo local (não consulta cloud).
   * Usado pelo recording.service ao registrar segmento recém-escrito.
   */
  async localStat(relativePath: string): Promise<{ size: number } | null> {
    const localPath = this.absolutePath(relativePath)
    try {
      const s = await fs.stat(localPath)
      return { size: s.size }
    } catch {
      return null
    }
  },

  /**
   * Stat do arquivo — usado pra Content-Length na resposta HTTP.
   */
  async stat(integradorId: string, relativePath: string): Promise<{ size: number } | null> {
    const localPath = this.absolutePath(relativePath)

    // Tenta local primeiro
    try {
      const s = await fs.stat(localPath)
      return { size: s.size }
    } catch {
      // Local não existe
    }

    // Fallback R2
    if (r2Storage.isEnabled()) {
      const head = await r2Storage.head(integradorId, relativePath)
      if (head) return head
    }

    // Fallback S3
    if (s3Storage.isEnabled()) {
      return await s3Storage.head(relativePath)
    }

    return null
  },

  /**
   * Remove segmento — usado pelo retention job.
   * Remove de ambos: local e cloud.
   */
  async remove(integradorId: string, relativePath: string): Promise<void> {
    // Remove local
    try {
      await fs.unlink(this.absolutePath(relativePath))
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        logger.warn({ err, path: relativePath }, 'recording_storage_remove_local_failed')
      }
    }

    // Remove R2
    if (r2Storage.isEnabled()) {
      await r2Storage.delete(integradorId, relativePath)
    }

    // Remove S3
    if (s3Storage.isEnabled()) {
      await s3Storage.delete(relativePath)
    }
  },

  /**
   * Remove múltiplos segmentos em batch (mais eficiente).
   */
  async removeMany(integradorId: string, relativePaths: string[]): Promise<void> {
    // Remove locais
    await Promise.all(relativePaths.map(async (p) => {
      try {
        await fs.unlink(this.absolutePath(p))
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          logger.warn({ err, path: p }, 'recording_storage_remove_local_failed')
        }
      }
    }))

    // Remove R2 em batch
    if (r2Storage.isEnabled()) {
      await r2Storage.deleteMany(integradorId, relativePaths)
    }

    // Remove S3 em batch
    if (s3Storage.isEnabled()) {
      await s3Storage.deleteMany(relativePaths)
    }
  },

  /**
   * Gera URL pré-assinada para download direto.
   * R2 tem egress grátis, então isso é muito eficiente!
   */
  async getPresignedUrl(integradorId: string, relativePath: string, expiresInSec = 3600): Promise<string | null> {
    // R2 primeiro (egress grátis)
    if (r2Storage.isEnabled()) {
      return await r2Storage.getPresignedUrl(integradorId, relativePath, expiresInSec)
    }

    // Fallback S3
    if (s3Storage.isEnabled()) {
      return await s3Storage.getPresignedUrl(relativePath, expiresInSec)
    }

    return null
  },

  /**
   * Constrói storagePath relativo no padrão da app.
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

  // ═══════════════════════════════════════════════════════════════════════════
  // LEGACY COMPAT (sem integradorId — assume bucket único ou local)
  // Mantido para código existente que ainda não foi migrado.
  // ═══════════════════════════════════════════════════════════════════════════

  /** @deprecated Use uploadToCloud(integradorId, relativePath) */
  async uploadToS3(relativePath: string): Promise<boolean> {
    if (!s3Storage.isEnabled()) return true
    const localPath = this.absolutePath(relativePath)
    return await s3Storage.uploadFile(localPath, relativePath)
  },

  /** @deprecated Use getReadStream(integradorId, relativePath) */
  openReadStream(relativePath: string): Readable {
    const localPath = this.absolutePath(relativePath)
    if (existsSync(localPath)) {
      return createReadStream(localPath)
    }
    throw new Error('LOCAL_NOT_FOUND')
  },

  /** @deprecated Use isCloudEnabled() */
  isS3Enabled(): boolean {
    return s3Storage.isEnabled()
  },
}
