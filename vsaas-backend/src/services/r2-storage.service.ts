/**
 * Cloudflare R2 Storage Service — armazenamento multi-tenant.
 *
 * Arquitetura: Bucket por Integrador
 *   - Bucket: icv-{integradorId}
 *   - Isolamento total entre tenants
 *   - Lifecycle rules por integrador (storageRetainDays)
 *
 * Usado para:
 *   1. Upload de segmentos de gravação HLS
 *   2. Upload de snapshots de eventos (via backend)
 *   3. Download para playback (egress grátis no R2!)
 *   4. Deleção na retenção (lifecycle automático)
 *
 * R2 Limits:
 *   - 1M buckets per account
 *   - Unlimited objects per bucket
 *   - 5 GiB single upload
 *   - 1 write/s per same key
 *   - Egress: FREE
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createReadStream, promises as fs } from 'fs'
import type { Readable } from 'stream'
import { Agent as HttpsAgent } from 'https'
import { logger } from '../lib/logger'

// Configuração R2 via env
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_ENDPOINT = process.env.R2_ENDPOINT
const R2_BUCKET_PREFIX   = process.env.R2_BUCKET_PREFIX ?? 'icv'
const R2_ENABLED         = !!(R2_ENDPOINT && R2_ACCESS_KEY && R2_SECRET_KEY)
const DEFAULT_RETAIN_DAYS = Number(process.env.R2_DEFAULT_RETAIN_DAYS ?? 30)

let r2Client: S3Client | null = null

if (R2_ENABLED) {
  // Pool de conexões aumentado de 50 (default AWS SDK) pra 200.
  // Por quê: playback HLS gera burst de ~100 segments simultâneos
  // (player tenta pre-fetch agressivo); workers de retention/sprite
  // backfill rodam em paralelo. Com 50 sockets ficava enfileirado e
  // requests do user davam timeout (sintoma: vídeo preto, manifest
  // OK mas segments .ts perdidos).
  // 200 cobre N usuários simultâneos × 100 segments + workers.
  // Cuidado: cada socket é ~few KB de RAM; 200 = ~200 KB total, OK.
  const MAX_SOCKETS = Number(process.env.S3_MAX_SOCKETS ?? 200)
  const httpsAgent = new HttpsAgent({
    keepAlive: true,
    maxSockets: MAX_SOCKETS,
    keepAliveMsecs: 5_000,
  })

  r2Client = new S3Client({
    endpoint: R2_ENDPOINT,
    region: 'auto', // R2 usa region 'auto'
    credentials: {
      accessKeyId: R2_ACCESS_KEY!,
      secretAccessKey: R2_SECRET_KEY!,
    },
    forcePathStyle: true,
    requestHandler: new NodeHttpHandler({ httpsAgent }),
  })
  logger.info({ endpoint: R2_ENDPOINT, prefix: R2_BUCKET_PREFIX, maxSockets: MAX_SOCKETS }, 'r2_storage_initialized')
} else {
  logger.info('r2_storage_disabled (R2_ENDPOINT/credentials not configured)')
}

/** Gera nome do bucket para um integrador. */
function bucketName(integradorId: string): string {
  // R2 bucket names: lowercase, 3-63 chars, alphanumeric + hyphens
  const sanitized = integradorId.toLowerCase().replace(/[^a-z0-9-]/g, '')
  return `${R2_BUCKET_PREFIX}-${sanitized}`
}

export const r2Storage = {
  /** Retorna true se R2 está configurado e habilitado. */
  isEnabled(): boolean {
    return R2_ENABLED && r2Client !== null
  },

  /** Gera nome do bucket para um integrador. */
  getBucketName(integradorId: string): string {
    return bucketName(integradorId)
  },

  /**
   * Health check — verifica que credenciais funcionam e que o R2 responde.
   * Chamado no boot do backend e pelo endpoint /admin/storage/health.
   *
   * Retorna:
   *   - { ok: true,  buckets: number } se ListBuckets retornar sucesso
   *   - { ok: false, error: string } se houver erro de credencial/rede
   */
  async healthCheck(): Promise<{ ok: boolean; buckets?: number; error?: string }> {
    if (!r2Client) return { ok: false, error: 'r2 not configured' }
    try {
      const r = await r2Client.send(new ListBucketsCommand({}))
      return { ok: true, buckets: (r.Buckets ?? []).length }
    } catch (err: any) {
      return {
        ok: false,
        error: `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`,
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BUCKET MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cria bucket para um integrador (se não existir).
   * Chamado no onboarding ou primeiro upload.
   */
  async ensureBucket(integradorId: string): Promise<boolean> {
    if (!r2Client) return false
    const bucket = bucketName(integradorId)

    try {
      await r2Client.send(new HeadBucketCommand({ Bucket: bucket }))
      return true // já existe
    } catch (err: any) {
      if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
        try {
          await r2Client.send(new CreateBucketCommand({ Bucket: bucket }))
          logger.info({ bucket, integradorId }, 'r2_bucket_created')
          // Lifecycle automático na criação — garante retenção mesmo sem
          // o admin passar pelo painel de storage-config. Default: 30 dias.
          // setLifecycleRule loga warn se falhar — não bloqueia o upload.
          this.setLifecycleRule(integradorId, DEFAULT_RETAIN_DAYS).catch(e =>
            logger.warn({ err: e, bucket }, 'r2_lifecycle_auto_set_failed'),
          )
          return true
        } catch (createErr: any) {
          logger.error({ err: createErr, bucket }, 'r2_bucket_create_failed')
          return false
        }
      }
      logger.warn({ err, bucket }, 'r2_bucket_head_failed')
      return false
    }
  },

  /**
   * Verifica se bucket existe.
   */
  async bucketExists(integradorId: string): Promise<boolean> {
    if (!r2Client) return false
    const bucket = bucketName(integradorId)

    try {
      await r2Client.send(new HeadBucketCommand({ Bucket: bucket }))
      return true
    } catch {
      return false
    }
  },

  /**
   * Deleta bucket e todos os objetos (offboarding de integrador).
   * CUIDADO: operação destrutiva!
   */
  async deleteBucket(integradorId: string): Promise<boolean> {
    if (!r2Client) return false
    const bucket = bucketName(integradorId)

    try {
      // Primeiro, deletar todos os objetos (bucket deve estar vazio para deletar)
      let continuationToken: string | undefined
      do {
        const list = await r2Client.send(new ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }))

        if (list.Contents && list.Contents.length > 0) {
          await r2Client.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: list.Contents.map(obj => ({ Key: obj.Key! })),
              Quiet: true,
            },
          }))
        }

        continuationToken = list.NextContinuationToken
      } while (continuationToken)

      // Agora deletar o bucket
      await r2Client.send(new DeleteBucketCommand({ Bucket: bucket }))
      logger.info({ bucket, integradorId }, 'r2_bucket_deleted')
      return true
    } catch (err) {
      logger.error({ err, bucket }, 'r2_bucket_delete_failed')
      return false
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE RULES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Configura lifecycle rule para retenção automática.
   * R2 suporta até 1000 regras por bucket.
   *
   * @param integradorId ID do integrador
   * @param retainDays Dias de retenção (após isso, objetos são deletados)
   * @param prefix Prefixo opcional (para regra por câmera, ex: "cam_xyz/")
   */
  async setLifecycleRule(
    integradorId: string,
    retainDays: number,
    prefix = '',
  ): Promise<boolean> {
    if (!r2Client) return false
    const bucket = bucketName(integradorId)

    try {
      // Buscar regras existentes
      let existingRules: any[] = []
      try {
        const existing = await r2Client.send(
          new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })
        )
        existingRules = existing.Rules ?? []
      } catch {
        // Não tem lifecycle config ainda
      }

      const ruleId = prefix ? `retention-${prefix.replace(/\//g, '-')}` : 'retention-default'

      // Remove regra existente com mesmo ID
      const filteredRules = existingRules.filter((r: any) => r.ID !== ruleId)

      // Adiciona nova regra
      // R2 não aceita Filter vazio — precisa de Prefix explícito (mesmo que '')
      const newRule = {
        ID: ruleId,
        Status: 'Enabled',
        Filter: { Prefix: prefix ?? '' },
        Expiration: { Days: retainDays },
      }

      await r2Client.send(new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: {
          Rules: [...filteredRules, newRule],
        },
      }))

      logger.info({ bucket, ruleId, retainDays, prefix }, 'r2_lifecycle_set')
      return true
    } catch (err) {
      logger.error({ err, bucket, retainDays }, 'r2_lifecycle_set_failed')
      return false
    }
  },

  /**
   * Remove lifecycle rule específica.
   */
  async removeLifecycleRule(integradorId: string, ruleId: string): Promise<boolean> {
    if (!r2Client) return false
    const bucket = bucketName(integradorId)

    try {
      const existing = await r2Client.send(
        new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })
      )
      const filteredRules = (existing.Rules ?? []).filter((r: any) => r.ID !== ruleId)

      if (filteredRules.length > 0) {
        await r2Client.send(new PutBucketLifecycleConfigurationCommand({
          Bucket: bucket,
          LifecycleConfiguration: { Rules: filteredRules },
        }))
      }
      // Se não sobrou regras, não precisa fazer nada (R2 aceita bucket sem lifecycle)

      logger.info({ bucket, ruleId }, 'r2_lifecycle_removed')
      return true
    } catch (err) {
      logger.error({ err, bucket, ruleId }, 'r2_lifecycle_remove_failed')
      return false
    }
  },

  /**
   * Lista todas as lifecycle rules do bucket.
   */
  async getLifecycleRules(integradorId: string): Promise<any[]> {
    if (!r2Client) return []
    const bucket = bucketName(integradorId)

    try {
      const result = await r2Client.send(
        new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })
      )
      return result.Rules ?? []
    } catch {
      return []
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OBJECT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Upload de arquivo local para R2.
   * @param integradorId ID do integrador (determina bucket)
   * @param localPath Caminho absoluto do arquivo local
   * @param key Chave no bucket (e.g., "cam_xyz/2026-05-01/segment.ts")
   * @param contentType MIME type
   */
  async uploadFile(
    integradorId: string,
    localPath: string,
    key: string,
    contentType = 'video/mp2t',
  ): Promise<boolean> {
    if (!r2Client) return false
    const bucket = bucketName(integradorId)

    try {
      // Garantir bucket existe
      await this.ensureBucket(integradorId)

      const stat = await fs.stat(localPath)
      const stream = createReadStream(localPath)

      await r2Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: stream,
        ContentType: contentType,
        ContentLength: stat.size,
      }))

      logger.debug({ bucket, key, size: stat.size }, 'r2_upload_ok')
      return true
    } catch (err) {
      logger.warn({ err, bucket, key }, 'r2_upload_failed')
      return false
    }
  },

  /**
   * Upload de buffer diretamente para R2.
   */
  async uploadBuffer(
    integradorId: string,
    buffer: Buffer,
    key: string,
    contentType = 'video/mp2t',
  ): Promise<boolean> {
    if (!r2Client) return false
    const bucket = bucketName(integradorId)

    try {
      await this.ensureBucket(integradorId)

      await r2Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ContentLength: buffer.length,
      }))

      logger.debug({ bucket, key, size: buffer.length }, 'r2_upload_ok')
      return true
    } catch (err) {
      logger.warn({ err, bucket, key }, 'r2_upload_failed')
      return false
    }
  },

  /**
   * Verifica se objeto existe.
   */
  async exists(integradorId: string, key: string): Promise<boolean> {
    if (!r2Client) return false
    const bucket = bucketName(integradorId)

    try {
      await r2Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      return true
    } catch {
      return false
    }
  },

  /**
   * Obtém metadados do objeto.
   */
  async head(integradorId: string, key: string): Promise<{ size: number; lastModified?: Date } | null> {
    if (!r2Client) return null
    const bucket = bucketName(integradorId)

    try {
      const result = await r2Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      return {
        size: result.ContentLength ?? 0,
        lastModified: result.LastModified,
      }
    } catch {
      return null
    }
  },

  /**
   * Stream de download do R2.
   */
  async getStream(integradorId: string, key: string): Promise<Readable | null> {
    if (!r2Client) return null
    const bucket = bucketName(integradorId)

    try {
      const result = await r2Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      return result.Body as Readable
    } catch {
      return null
    }
  },

  /**
   * Download como buffer.
   */
  async getBuffer(integradorId: string, key: string): Promise<Buffer | null> {
    const stream = await this.getStream(integradorId, key)
    if (!stream) return null

    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  },

  /**
   * Lê os primeiros N bytes via Range request — usado pra detectar formato
   * de segments uploaded via presigned URL (sem custo de baixar arquivo todo).
   */
  async getRangeBytes(integradorId: string, key: string, bytes = 32): Promise<Buffer | null> {
    if (!r2Client) return null
    const bucket = bucketName(integradorId)
    try {
      const result = await r2Client.send(new GetObjectCommand({
        Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}`,
      }))
      const stream = result.Body as Readable
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      return Buffer.concat(chunks)
    } catch {
      return null
    }
  },

  /**
   * Gera URL pré-assinada para download direto.
   * R2 egress é grátis, então isso é eficiente para playback.
   */
  async getPresignedUrl(
    integradorId: string,
    key: string,
    expiresInSec = 3600,
  ): Promise<string | null> {
    if (!r2Client) return null
    const bucket = bucketName(integradorId)

    try {
      const url = await getSignedUrl(r2Client, new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }), { expiresIn: expiresInSec })
      return url
    } catch {
      return null
    }
  },

  /**
   * Gera URL pré-assinada para upload direto (PUT).
   *
   * Usado pelo edge box para enviar segments sem passar pelo backend
   * (zero bandwidth no servidor cloud — escala melhor com 100s de boxes).
   *
   * Após upload, edge chama POST /iacv-box/segments/register com o
   * mesmo storagePath. Backend valida via HEAD que o objeto existe e
   * só então cria o RecordingSegment.
   */
  async getPresignedUploadUrl(
    integradorId: string,
    key: string,
    contentType = 'video/mp2t',
    expiresInSec = 600,
  ): Promise<string | null> {
    if (!r2Client) return null
    const bucket = bucketName(integradorId)

    try {
      const url = await getSignedUrl(r2Client, new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }), { expiresIn: expiresInSec })
      return url
    } catch (err) {
      logger.warn({ err, bucket, key }, 'r2_presigned_put_failed')
      return null
    }
  },

  /**
   * Deleta objeto.
   */
  async delete(integradorId: string, key: string): Promise<boolean> {
    if (!r2Client) return false
    const bucket = bucketName(integradorId)

    try {
      await r2Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      logger.debug({ bucket, key }, 'r2_delete_ok')
      return true
    } catch (err) {
      logger.warn({ err, bucket, key }, 'r2_delete_failed')
      return false
    }
  },

  /**
   * Deleta múltiplos objetos em batch.
   */
  async deleteMany(integradorId: string, keys: string[]): Promise<number> {
    if (!r2Client || keys.length === 0) return 0
    const bucket = bucketName(integradorId)

    try {
      const batches: string[][] = []
      for (let i = 0; i < keys.length; i += 1000) {
        batches.push(keys.slice(i, i + 1000))
      }

      let deleted = 0
      for (const batch of batches) {
        const result = await r2Client.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map(Key => ({ Key })),
            Quiet: true,
          },
        }))
        deleted += batch.length - (result.Errors?.length ?? 0)
      }

      logger.debug({ bucket, requested: keys.length, deleted }, 'r2_delete_many_ok')
      return deleted
    } catch (err) {
      logger.warn({ err, bucket, count: keys.length }, 'r2_delete_many_failed')
      return 0
    }
  },

  /**
   * Lista objetos com prefixo.
   */
  async listByPrefix(
    integradorId: string,
    prefix: string,
    maxKeys = 1000,
  ): Promise<Array<{ key: string; size: number; lastModified?: Date }>> {
    if (!r2Client) return []
    const bucket = bucketName(integradorId)

    try {
      const result = await r2Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      }))
      return (result.Contents ?? []).map(obj => ({
        key: obj.Key!,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified,
      }))
    } catch (err) {
      logger.warn({ err, bucket, prefix }, 'r2_list_failed')
      return []
    }
  },

  /**
   * Conta objetos e tamanho total por prefixo.
   */
  async getStats(integradorId: string, prefix = ''): Promise<{ count: number; totalBytes: number }> {
    if (!r2Client) return { count: 0, totalBytes: 0 }
    const bucket = bucketName(integradorId)

    try {
      let count = 0
      let totalBytes = 0
      let continuationToken: string | undefined

      do {
        const result = await r2Client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }))

        count += result.KeyCount ?? 0
        for (const obj of result.Contents ?? []) {
          totalBytes += obj.Size ?? 0
        }
        continuationToken = result.NextContinuationToken
      } while (continuationToken)

      return { count, totalBytes }
    } catch {
      return { count: 0, totalBytes: 0 }
    }
  },

  /**
   * Browse objects (para UI de storage browser).
   */
  async browse(
    integradorId: string,
    prefix = '',
    maxKeys = 100,
  ): Promise<{
    bucket: string
    prefix: string
    folders: string[]
    files: Array<{ key: string; name: string; size: number; lastModified?: Date }>
    truncated: boolean
  }> {
    if (!r2Client) {
      return { bucket: '', prefix, folders: [], files: [], truncated: false }
    }
    const bucket = bucketName(integradorId)

    try {
      const result = await r2Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
        Delimiter: '/',
      }))

      const folders = (result.CommonPrefixes ?? [])
        .map(p => p.Prefix!)
        .filter(Boolean)

      const files = (result.Contents ?? [])
        .filter(o => o.Key !== prefix)
        .map(o => ({
          key: o.Key!,
          name: o.Key!.replace(prefix, ''),
          size: o.Size ?? 0,
          lastModified: o.LastModified,
        }))

      return {
        bucket,
        prefix,
        folders,
        files,
        truncated: result.IsTruncated ?? false,
      }
    } catch {
      return { bucket, prefix, folders: [], files: [], truncated: false }
    }
  },

  /**
   * Lista todos os prefixos únicos de primeiro nível (cameraIds) no bucket.
   * Usado para detectar gravações órfãs.
   */
  async listUniquePrefixes(integradorId: string): Promise<string[]> {
    if (!r2Client) return []
    const bucket = bucketName(integradorId)

    try {
      const prefixes = new Set<string>()
      let continuationToken: string | undefined

      do {
        const result = await r2Client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Delimiter: '/',
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }))

        // CommonPrefixes contém os prefixos de primeiro nível
        for (const p of result.CommonPrefixes ?? []) {
          if (p.Prefix) {
            // Remove a barra final para obter o cameraId
            const prefix = p.Prefix.replace(/\/$/, '')
            if (prefix) prefixes.add(prefix)
          }
        }

        continuationToken = result.NextContinuationToken
      } while (continuationToken)

      return Array.from(prefixes)
    } catch (err) {
      logger.warn({ err, bucket }, 'r2_list_prefixes_failed')
      return []
    }
  },

  /**
   * Deleta todos os objetos com um determinado prefixo.
   * Usado para limpar gravações órfãs de câmeras excluídas.
   * Retorna a quantidade de objetos deletados.
   */
  async deleteByPrefix(integradorId: string, prefix: string): Promise<number> {
    if (!r2Client || !prefix) return 0
    const bucket = bucketName(integradorId)

    try {
      let totalDeleted = 0
      let continuationToken: string | undefined

      do {
        // Listar objetos com o prefixo
        const listResult = await r2Client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }))

        const keys = (listResult.Contents ?? [])
          .map(obj => obj.Key!)
          .filter(Boolean)

        if (keys.length > 0) {
          // Deletar em batch
          const deleteResult = await r2Client.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: keys.map(Key => ({ Key })),
              Quiet: true,
            },
          }))

          const deleted = keys.length - (deleteResult.Errors?.length ?? 0)
          totalDeleted += deleted
        }

        continuationToken = listResult.NextContinuationToken
      } while (continuationToken)

      logger.info({ bucket, prefix, totalDeleted }, 'r2_delete_by_prefix_ok')
      return totalDeleted
    } catch (err) {
      logger.error({ err, bucket, prefix }, 'r2_delete_by_prefix_failed')
      return 0
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GENERIC HELPERS — aceitam qualquer bucket (não derivam do integradorId)
  // Usados pelo /vault router que precisa ler de buckets configurados em
  // EdgeNode.vaultBucket (esquema legado, nem sempre = icv-{integradorId}).
  // ═══════════════════════════════════════════════════════════════════════════

  /** Lista objetos de um bucket arbitrário em um prefix. */
  async listObjectsAtBucket(
    bucket: string,
    prefix: string,
    maxKeys = 1000,
  ): Promise<{ key: string; size: number; lastModified?: Date }[]> {
    if (!r2Client) return []
    try {
      const r = await r2Client.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix, MaxKeys: maxKeys,
      }))
      return (r.Contents ?? []).map(o => ({
        key:          o.Key ?? '',
        size:         o.Size ?? 0,
        lastModified: o.LastModified,
      }))
    } catch (err) {
      logger.warn({ err, bucket, prefix }, 'r2_list_at_bucket_failed')
      return []
    }
  },

  /** Presigned GET URL para um objeto em bucket arbitrário. */
  async getPresignedUrlAtBucket(
    bucket: string, key: string, expiresInSec = 600,
  ): Promise<string | null> {
    if (!r2Client) return null
    try {
      return await getSignedUrl(r2Client, new GetObjectCommand({
        Bucket: bucket, Key: key,
      }), { expiresIn: expiresInSec })
    } catch (err) {
      logger.warn({ err, bucket, key }, 'r2_presign_at_bucket_failed')
      return null
    }
  },
}
