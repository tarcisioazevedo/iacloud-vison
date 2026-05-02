/**
 * Storage Config Routes — configuração de storage por Integrador.
 *
 * Arquitetura:
 *   - R2 Centralizado: bucket-por-integrador gerenciado pelo sistema
 *   - Custom S3: integrador pode usar seu próprio storage (Hetzner, AWS, MinIO)
 *
 * Endpoints:
 *   GET  /storage/config     — retorna config atual
 *   PUT  /storage/config     — atualiza retenção / habilita R2 / configura custom
 *   POST /storage/test       — testa conexão (custom S3)
 *   GET  /storage/stats      — estatísticas de uso
 *   GET  /storage/browse     — lista objetos (browser UI)
 *   GET  /storage/lifecycle  — lista lifecycle rules (R2)
 *   POST /storage/lifecycle  — atualiza lifecycle rule (R2)
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { S3Client, HeadBucketCommand, CreateBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { ForbiddenError, ValidationError, NotFoundError } from '../lib/errors'
import { logger } from '../lib/logger'
import { r2Storage } from '../services/r2-storage.service'

export const storageConfigRouter = Router()

// Helper: verifica se user pode gerenciar storage do integrador
async function requireIntegradorAdmin(req: Request): Promise<string> {
  const { role, integradorId } = req.jwtPayload
  if (role === 'SUPER_ADMIN') {
    return req.query.integradorId?.toString() || ''
  }
  if (role === 'INTEGRADOR_ADMIN' && integradorId) {
    return integradorId
  }
  throw new ForbiddenError('Apenas INTEGRADOR_ADMIN ou SUPER_ADMIN pode gerenciar storage')
}

// ─── GET /storage/config ─────────────────────────────────────────────────────
storageConfigRouter.get('/config', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const integradorId = await requireIntegradorAdmin(req)

  // Se não tem integrador (super admin sem query param), retorna status global
  if (!integradorId) {
    return res.json({
      r2Enabled: r2Storage.isEnabled(),
      customStorage: false,
      message: 'Selecione um integrador para ver configuração específica',
    })
  }

  const integrador = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: {
      storageEndpoint: true,
      storageRegion: true,
      storageBucket: true,
      storageRetainDays: true,
      storageAccessKeyEnc: true,
    },
  })
  if (!integrador) throw new NotFoundError('Integrador')

  const hasCustomStorage = !!(integrador.storageEndpoint && integrador.storageAccessKeyEnc)
  const r2Enabled = r2Storage.isEnabled()
  const r2Bucket = r2Enabled ? r2Storage.getBucketName(integradorId) : null
  const r2BucketExists = r2Enabled ? await r2Storage.bucketExists(integradorId) : false

  res.json({
    // R2 (centralizado)
    r2Enabled,
    r2Bucket,
    r2BucketExists,
    r2Endpoint: process.env.R2_ENDPOINT || null,

    // Custom S3 (opcional)
    customStorage: hasCustomStorage,
    customEndpoint: integrador.storageEndpoint,
    customRegion: integrador.storageRegion,
    customBucket: integrador.storageBucket,
    hasCustomCredentials: !!integrador.storageAccessKeyEnc,

    // Retenção (aplica a ambos)
    retainDays: integrador.storageRetainDays ?? 30,

    // Storage ativo
    activeStorage: hasCustomStorage ? 'custom' : (r2Enabled ? 'r2' : 'none'),
  })
}))

// ─── PUT /storage/config ─────────────────────────────────────────────────────
const StorageConfigBody = z.object({
  // Escolha de storage
  useR2: z.boolean().optional(),

  // Config custom S3
  customEndpoint: z.string().url().optional().nullable(),
  customRegion: z.string().max(20).optional().nullable(),
  customBucket: z.string().max(63).optional().nullable(),
  customAccessKey: z.string().optional().nullable(),
  customSecretKey: z.string().optional().nullable(),

  // Retenção
  retainDays: z.number().int().min(1).max(365).optional(),
})

storageConfigRouter.put('/config', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const integradorId = await requireIntegradorAdmin(req)
  if (!integradorId) throw new ForbiddenError('Integrador não identificado')

  const body = StorageConfigBody.parse(req.body)
  const updateData: any = {}

  // Atualizar retenção
  if (body.retainDays !== undefined) {
    updateData.storageRetainDays = body.retainDays

    // Se usando R2, atualizar lifecycle rule
    if (r2Storage.isEnabled() && !body.customEndpoint) {
      await r2Storage.ensureBucket(integradorId)
      await r2Storage.setLifecycleRule(integradorId, body.retainDays)
    }
  }

  // Configurar R2 (apenas garantir bucket existe)
  if (body.useR2 && r2Storage.isEnabled()) {
    await r2Storage.ensureBucket(integradorId)
    // Limpar custom storage se estava usando
    updateData.storageEndpoint = null
    updateData.storageRegion = null
    updateData.storageBucket = null
    updateData.storageAccessKeyEnc = null
    updateData.storageSecretKeyEnc = null

    // Definir lifecycle
    const integrador = await prisma.integrador.findUnique({
      where: { id: integradorId },
      select: { storageRetainDays: true },
    })
    const retainDays = body.retainDays ?? integrador?.storageRetainDays ?? 30
    await r2Storage.setLifecycleRule(integradorId, retainDays)
  }

  // Configurar custom S3
  if (body.customEndpoint) {
    updateData.storageEndpoint = body.customEndpoint
    updateData.storageRegion = body.customRegion ?? 'us-east-1'
    updateData.storageBucket = body.customBucket

    if (body.customAccessKey) {
      updateData.storageAccessKeyEnc = encryptSecret(body.customAccessKey)
    }
    if (body.customSecretKey) {
      updateData.storageSecretKeyEnc = encryptSecret(body.customSecretKey)
    }
  }

  // Limpar custom storage
  if (body.customEndpoint === null) {
    updateData.storageEndpoint = null
    updateData.storageRegion = null
    updateData.storageBucket = null
    updateData.storageAccessKeyEnc = null
    updateData.storageSecretKeyEnc = null
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.integrador.update({
      where: { id: integradorId },
      data: updateData,
    })
  }

  logger.info({ integradorId, useR2: body.useR2, retainDays: body.retainDays }, 'storage_config_updated')
  res.json({ success: true })
}))

// ─── POST /storage/test ──────────────────────────────────────────────────────
const TestStorageBody = z.object({
  type: z.enum(['r2', 'custom']),
  // Para custom:
  endpoint: z.string().url().optional(),
  region: z.string().max(20).optional(),
  bucket: z.string().max(63).optional(),
  accessKey: z.string().optional(),
  secretKey: z.string().optional(),
  createBucket: z.boolean().optional(),
})

storageConfigRouter.post('/test', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const integradorId = await requireIntegradorAdmin(req)
  const body = TestStorageBody.parse(req.body)

  if (body.type === 'r2') {
    // Testar R2
    if (!r2Storage.isEnabled()) {
      throw new ValidationError('R2 não está configurado no servidor')
    }

    const bucket = r2Storage.getBucketName(integradorId || 'test')
    const created = await r2Storage.ensureBucket(integradorId || 'test')

    if (created) {
      res.json({
        success: true,
        message: 'R2 conectado com sucesso',
        bucket,
        endpoint: process.env.R2_ENDPOINT,
      })
    } else {
      throw new ValidationError('Falha ao criar/verificar bucket R2')
    }
    return
  }

  // Testar custom S3
  if (!body.endpoint || !body.accessKey || !body.secretKey || !body.bucket) {
    throw new ValidationError('Endpoint, bucket e credenciais são obrigatórios para custom storage')
  }

  const client = new S3Client({
    endpoint: body.endpoint,
    region: body.region || 'us-east-1',
    credentials: {
      accessKeyId: body.accessKey,
      secretAccessKey: body.secretKey,
    },
    forcePathStyle: true,
  })

  try {
    await client.send(new HeadBucketCommand({ Bucket: body.bucket }))
    res.json({ success: true, message: 'Bucket existe e credenciais válidas' })
  } catch (err: any) {
    if ((err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) && body.createBucket) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: body.bucket }))
        res.json({ success: true, message: 'Bucket criado com sucesso', created: true })
      } catch (createErr: any) {
        throw new ValidationError(`Erro ao criar bucket: ${createErr.message}`)
      }
    } else if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      throw new ValidationError('Bucket não existe. Marque "Criar bucket" para criá-lo.')
    } else {
      throw new ValidationError(`Erro de conexão: ${err.message}`)
    }
  }
}))

// ─── GET /storage/stats ──────────────────────────────────────────────────────
storageConfigRouter.get('/stats', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const integradorId = await requireIntegradorAdmin(req)
  if (!integradorId) {
    return res.json({ configured: false })
  }

  const integrador = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: {
      storageEndpoint: true,
      storageRegion: true,
      storageBucket: true,
      storageAccessKeyEnc: true,
      storageSecretKeyEnc: true,
    },
  })

  const hasCustomStorage = !!(integrador?.storageEndpoint && integrador.storageAccessKeyEnc)

  // Usar R2 se não tem custom storage
  if (!hasCustomStorage && r2Storage.isEnabled()) {
    const bucketExists = await r2Storage.bucketExists(integradorId)
    if (!bucketExists) {
      return res.json({
        configured: true,
        type: 'r2',
        bucket: r2Storage.getBucketName(integradorId),
        totalObjects: 0,
        totalSizeBytes: 0,
        totalSizeMB: 0,
        message: 'Bucket será criado no primeiro upload',
      })
    }

    const stats = await r2Storage.getStats(integradorId)
    return res.json({
      configured: true,
      type: 'r2',
      bucket: r2Storage.getBucketName(integradorId),
      totalObjects: stats.count,
      totalSizeBytes: stats.totalBytes,
      totalSizeMB: Math.round(stats.totalBytes / (1024 * 1024) * 100) / 100,
    })
  }

  // Custom storage
  if (!hasCustomStorage) {
    return res.json({ configured: false })
  }

  const client = new S3Client({
    endpoint: integrador!.storageEndpoint!,
    region: integrador!.storageRegion || 'us-east-1',
    credentials: {
      accessKeyId: decryptSecret(integrador!.storageAccessKeyEnc!) || '',
      secretAccessKey: decryptSecret(integrador!.storageSecretKeyEnc) || '',
    },
    forcePathStyle: true,
  })

  try {
    let totalObjects = 0
    let totalSize = 0
    let token: string | undefined

    do {
      const result = await client.send(new ListObjectsV2Command({
        Bucket: integrador!.storageBucket!,
        MaxKeys: 1000,
        ContinuationToken: token,
      }))
      totalObjects += result.KeyCount || 0
      for (const obj of result.Contents || []) {
        totalSize += obj.Size || 0
      }
      token = result.NextContinuationToken
    } while (token)

    res.json({
      configured: true,
      type: 'custom',
      bucket: integrador!.storageBucket,
      totalObjects,
      totalSizeBytes: totalSize,
      totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
    })
  } catch (err: any) {
    res.json({
      configured: true,
      type: 'custom',
      error: err.message,
    })
  }
}))

// ─── GET /storage/browse ─────────────────────────────────────────────────────
storageConfigRouter.get('/browse', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const integradorId = await requireIntegradorAdmin(req)
  if (!integradorId) {
    return res.json({ items: [], error: 'Integrador não identificado' })
  }

  const prefix = req.query.prefix?.toString() || ''
  const maxKeys = Math.min(Number(req.query.limit) || 100, 1000)

  const integrador = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: {
      storageEndpoint: true,
      storageRegion: true,
      storageBucket: true,
      storageAccessKeyEnc: true,
      storageSecretKeyEnc: true,
    },
  })

  const hasCustomStorage = !!(integrador?.storageEndpoint && integrador.storageAccessKeyEnc)

  // Usar R2 se não tem custom storage
  if (!hasCustomStorage && r2Storage.isEnabled()) {
    const result = await r2Storage.browse(integradorId, prefix, maxKeys)
    return res.json({
      bucket: result.bucket,
      prefix: result.prefix,
      items: [
        ...result.folders.map(f => ({
          type: 'folder' as const,
          key: f,
          name: f.replace(prefix, '').replace(/\/$/, ''),
        })),
        ...result.files.map(f => ({
          type: 'file' as const,
          key: f.key,
          name: f.name,
          size: f.size,
          lastModified: f.lastModified,
        })),
      ],
      truncated: result.truncated,
    })
  }

  // Custom storage
  if (!hasCustomStorage) {
    return res.json({ items: [], error: 'Storage não configurado' })
  }

  const client = new S3Client({
    endpoint: integrador!.storageEndpoint!,
    region: integrador!.storageRegion || 'us-east-1',
    credentials: {
      accessKeyId: decryptSecret(integrador!.storageAccessKeyEnc!) || '',
      secretAccessKey: decryptSecret(integrador!.storageSecretKeyEnc) || '',
    },
    forcePathStyle: true,
  })

  try {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: integrador!.storageBucket!,
      Prefix: prefix,
      MaxKeys: maxKeys,
      Delimiter: '/',
    }))

    const folders = (result.CommonPrefixes || []).map(p => ({
      type: 'folder' as const,
      key: p.Prefix!,
      name: p.Prefix!.replace(prefix, '').replace(/\/$/, ''),
    }))

    const files = (result.Contents || []).filter(o => o.Key !== prefix).map(o => ({
      type: 'file' as const,
      key: o.Key!,
      name: o.Key!.replace(prefix, ''),
      size: o.Size,
      lastModified: o.LastModified,
    }))

    res.json({
      bucket: integrador!.storageBucket,
      prefix,
      items: [...folders, ...files],
      truncated: result.IsTruncated,
    })
  } catch (err: any) {
    res.json({ items: [], error: err.message })
  }
}))

// ─── GET /storage/lifecycle ──────────────────────────────────────────────────
storageConfigRouter.get('/lifecycle', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const integradorId = await requireIntegradorAdmin(req)
  if (!integradorId) {
    return res.json({ rules: [] })
  }

  if (!r2Storage.isEnabled()) {
    return res.json({ rules: [], message: 'R2 não configurado' })
  }

  const rules = await r2Storage.getLifecycleRules(integradorId)
  res.json({ rules })
}))

// ─── POST /storage/lifecycle ─────────────────────────────────────────────────
const LifecycleBody = z.object({
  retainDays: z.number().int().min(1).max(365),
  prefix: z.string().max(200).optional(),
})

storageConfigRouter.post('/lifecycle', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const integradorId = await requireIntegradorAdmin(req)
  if (!integradorId) throw new ForbiddenError('Integrador não identificado')

  if (!r2Storage.isEnabled()) {
    throw new ValidationError('R2 não está configurado')
  }

  const body = LifecycleBody.parse(req.body)

  await r2Storage.ensureBucket(integradorId)
  const success = await r2Storage.setLifecycleRule(integradorId, body.retainDays, body.prefix)

  if (success) {
    // Atualizar no DB também
    await prisma.integrador.update({
      where: { id: integradorId },
      data: { storageRetainDays: body.retainDays },
    })

    res.json({ success: true })
  } else {
    throw new ValidationError('Falha ao configurar lifecycle rule')
  }
}))
