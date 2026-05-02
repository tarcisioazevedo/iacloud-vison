/**
 * S3 Storage Service — armazenamento externo S3-compatible (Hetzner/AWS/MinIO).
 *
 * Usado para:
 *   1. Upload de segmentos de gravação após ffmpeg escrever localmente
 *   2. Download de segmentos para playback (quando local não existe)
 *   3. Deleção na retenção
 *
 * Hetzner Object Storage é S3-compatible. Endpoints por região:
 *   - fsn1.your-objectstorage.com (Falkenstein)
 *   - nbg1.your-objectstorage.com (Nuremberg)
 *   - hel1.your-objectstorage.com (Helsinki)
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createReadStream, promises as fs } from 'fs'
import type { Readable } from 'stream'
import { logger } from '../lib/logger'

// Configuração via env
const S3_ENDPOINT = process.env.S3_ENDPOINT // e.g., https://fsn1.your-objectstorage.com
const S3_REGION = process.env.S3_REGION ?? 'fsn1'
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY_ID
const S3_SECRET_KEY = process.env.S3_SECRET_ACCESS_KEY
const S3_BUCKET = process.env.S3_RECORDINGS_BUCKET ?? 'icv-recordings'
const S3_ENABLED = !!(S3_ENDPOINT && S3_ACCESS_KEY && S3_SECRET_KEY)

let s3Client: S3Client | null = null

if (S3_ENABLED) {
  s3Client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY!,
      secretAccessKey: S3_SECRET_KEY!,
    },
    forcePathStyle: true, // Hetzner usa path-style
  })
  logger.info({ endpoint: S3_ENDPOINT, bucket: S3_BUCKET }, 's3_storage_initialized')

  // Auto-create bucket if it doesn't exist
  ensureBucketExists().catch(err => {
    logger.warn({ err, bucket: S3_BUCKET }, 's3_bucket_autocreate_failed')
  })
} else {
  logger.info('s3_storage_disabled (S3_ENDPOINT/credentials not configured)')
}

async function ensureBucketExists(): Promise<void> {
  if (!s3Client) return

  const { HeadBucketCommand, CreateBucketCommand } = await import('@aws-sdk/client-s3')

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
    logger.info({ bucket: S3_BUCKET }, 's3_bucket_exists')
  } catch (err: any) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      logger.info({ bucket: S3_BUCKET }, 's3_bucket_creating')
      await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }))
      logger.info({ bucket: S3_BUCKET }, 's3_bucket_created')
    } else {
      throw err
    }
  }
}

export const s3Storage = {
  /** Retorna true se S3 está configurado e habilitado. */
  isEnabled(): boolean {
    return S3_ENABLED && s3Client !== null
  },

  /** Nome do bucket configurado. */
  getBucket(): string {
    return S3_BUCKET
  },

  /**
   * Upload de arquivo local para S3.
   * @param localPath Caminho absoluto do arquivo local
   * @param s3Key Chave no S3 (e.g., "cameraId/2026-05-01/segment.ts")
   * @returns true se upload OK, false se S3 não configurado ou erro
   */
  async uploadFile(localPath: string, s3Key: string): Promise<boolean> {
    if (!s3Client) return false

    try {
      const stat = await fs.stat(localPath)
      const stream = createReadStream(localPath)

      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: stream,
        ContentType: 'video/mp2t',
        ContentLength: stat.size,
      }))

      logger.debug({ key: s3Key, size: stat.size }, 's3_upload_ok')
      return true
    } catch (err) {
      logger.warn({ err, key: s3Key }, 's3_upload_failed')
      return false
    }
  },

  /**
   * Upload de buffer diretamente para S3.
   */
  async uploadBuffer(buffer: Buffer, s3Key: string, contentType = 'video/mp2t'): Promise<boolean> {
    if (!s3Client) return false

    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
        ContentLength: buffer.length,
      }))

      logger.debug({ key: s3Key, size: buffer.length }, 's3_upload_ok')
      return true
    } catch (err) {
      logger.warn({ err, key: s3Key }, 's3_upload_failed')
      return false
    }
  },

  /**
   * Verifica se objeto existe no S3.
   */
  async exists(s3Key: string): Promise<boolean> {
    if (!s3Client) return false

    try {
      await s3Client.send(new HeadObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
      }))
      return true
    } catch {
      return false
    }
  },

  /**
   * Obtém metadados do objeto (tamanho, etc).
   */
  async head(s3Key: string): Promise<{ size: number; lastModified?: Date } | null> {
    if (!s3Client) return null

    try {
      const result = await s3Client.send(new HeadObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
      }))
      return {
        size: result.ContentLength ?? 0,
        lastModified: result.LastModified,
      }
    } catch {
      return null
    }
  },

  /**
   * Stream de download do S3.
   */
  async getStream(s3Key: string): Promise<Readable | null> {
    if (!s3Client) return null

    try {
      const result = await s3Client.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
      }))
      return result.Body as Readable
    } catch {
      return null
    }
  },

  /**
   * Gera URL pré-assinada para download direto (bypass backend).
   * Útil para reduzir carga no backend em playback intensivo.
   */
  async getPresignedUrl(s3Key: string, expiresInSec = 3600): Promise<string | null> {
    if (!s3Client) return null

    try {
      const url = await getSignedUrl(s3Client, new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
      }), { expiresIn: expiresInSec })
      return url
    } catch {
      return null
    }
  },

  /**
   * Deleta objeto do S3.
   */
  async delete(s3Key: string): Promise<boolean> {
    if (!s3Client) return false

    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
      }))
      logger.debug({ key: s3Key }, 's3_delete_ok')
      return true
    } catch (err) {
      logger.warn({ err, key: s3Key }, 's3_delete_failed')
      return false
    }
  },

  /**
   * Deleta múltiplos objetos em batch (mais eficiente que deletar um a um).
   * @param s3Keys Lista de chaves a deletar
   * @returns Número de objetos deletados com sucesso
   */
  async deleteMany(s3Keys: string[]): Promise<number> {
    if (!s3Client || s3Keys.length === 0) return 0

    try {
      // S3 DeleteObjects aceita até 1000 por request
      const batches: string[][] = []
      for (let i = 0; i < s3Keys.length; i += 1000) {
        batches.push(s3Keys.slice(i, i + 1000))
      }

      let deleted = 0
      for (const batch of batches) {
        const result = await s3Client.send(new DeleteObjectsCommand({
          Bucket: S3_BUCKET,
          Delete: {
            Objects: batch.map(Key => ({ Key })),
            Quiet: true,
          },
        }))
        deleted += batch.length - (result.Errors?.length ?? 0)
      }

      logger.debug({ requested: s3Keys.length, deleted }, 's3_delete_many_ok')
      return deleted
    } catch (err) {
      logger.warn({ err, count: s3Keys.length }, 's3_delete_many_failed')
      return 0
    }
  },

  /**
   * Lista objetos com prefixo (útil para retenção por câmera/dia).
   */
  async listByPrefix(prefix: string, maxKeys = 1000): Promise<string[]> {
    if (!s3Client) return []

    try {
      const result = await s3Client.send(new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        MaxKeys: maxKeys,
      }))
      return (result.Contents ?? []).map(obj => obj.Key!).filter(Boolean)
    } catch (err) {
      logger.warn({ err, prefix }, 's3_list_failed')
      return []
    }
  },
}
