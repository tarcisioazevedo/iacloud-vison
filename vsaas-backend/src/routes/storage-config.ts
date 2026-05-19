/**
 * Storage Config Routes — configuração de storage por Integrador.
 *
 * Arquitetura:
 *   - R2 Centralizado: bucket-por-integrador gerenciado pelo sistema
 *   - Custom S3: integrador pode usar seu próprio storage (Hetzner, AWS, MinIO)
 *
 * Endpoints:
 *   GET  /storage/global     — Super Admin: visão global de todos os buckets
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
import { auditAction, auditUpdate } from '../lib/audit-helpers'

export const storageConfigRouter = Router()

// Helper: verifica se user pode gerenciar storage do integrador
async function requireIntegradorAdmin(req: Request): Promise<string> {
  const { role, integradorId } = req.jwtPayload!
  if (role === 'SUPER_ADMIN') {
    return req.query.integradorId?.toString() || ''
  }
  if (role === 'INTEGRADOR_ADMIN' && integradorId) {
    return integradorId
  }
  throw new ForbiddenError('Apenas INTEGRADOR_ADMIN ou SUPER_ADMIN pode gerenciar storage')
}

// ─── GET /storage/global — Super Admin dashboard ─────────────────────────────
storageConfigRouter.get('/global', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { role } = req.jwtPayload!
  if (role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Apenas SUPER_ADMIN pode acessar visão global de storage')
  }

  const integradores = await prisma.integrador.findMany({
    select: {
      id: true,
      name: true,
      tradeName: true,
      email: true,
      active: true,
      storageEndpoint: true,
      storageRegion: true,
      storageBucket: true,
      storageRetainDays: true,
      storageAccessKeyEnc: true,
      retentionContract: {
        select: {
          markupPct: true,
          defaultPlano: {
            select: { id: true, slug: true, name: true, retainDays: true,
                     pricePerCameraMonthUsd: true, costR2EstimatedUsd: true },
          },
        },
      },
      clienteFinais: {
        where: { active: true },
        select: {
          id: true,
          name: true,
          tradeName: true,
          retentionPlanDefault: {
            select: { id: true, slug: true, name: true, retainDays: true,
                     pricePerCameraMonthUsd: true, costR2EstimatedUsd: true },
          },
          sites: {
            select: {
              id: true,
              name: true,
              active: true,
              cameras: {
                where: { active: true },
                select: {
                  id: true,
                  retentionPlan: {
                    select: { id: true, slug: true, name: true, retainDays: true,
                             pricePerCameraMonthUsd: true, costR2EstimatedUsd: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  const r2Enabled = r2Storage.isEnabled()
  const usdBrlRate = Number(process.env.USD_BRL_RATE ?? 5.30)

  const buckets = await Promise.all(integradores.map(async (integrador) => {
    const hasCustomStorage = !!(integrador.storageEndpoint && integrador.storageAccessKeyEnc)
    const storageType = hasCustomStorage ? 'custom' : (r2Enabled ? 'r2' : 'none')

    let bucketName = integrador.storageBucket || null
    let totalBytes = 0
    let objectCount = 0
    let bucketExists = false

    if (storageType === 'r2' && r2Enabled) {
      bucketName = r2Storage.getBucketName(integrador.id)
      bucketExists = await r2Storage.bucketExists(integrador.id)
      if (bucketExists) {
        try {
          const stats = await r2Storage.getStats(integrador.id)
          totalBytes = stats.totalBytes
          objectCount = stats.count
        } catch {
          // bucket might be empty or inaccessible
        }
      }
    } else if (storageType === 'custom' && integrador.storageAccessKeyEnc) {
      bucketName = integrador.storageBucket
      bucketExists = true // assume exists if configured
      // For custom storage, we'd need to query each one - skip for performance
      // Stats will show as 0 until sync job runs
    }

    // Calcular storage por cliente final agregando por site (cada site soma o
    // usedBytes das suas câmeras; cliente é a soma dos seus sites).
    const clientesFinais = await Promise.all(integrador.clienteFinais.map(async (cf) => {
      // Cache de bytes por câmera para evitar query duplicada (usado em site+cliente)
      const camBytesCache: Record<string, number> = {}
      const fetchCam = async (camId: string): Promise<number> => {
        if (camBytesCache[camId] !== undefined) return camBytesCache[camId]
        let bytes = 0
        if (storageType === 'r2' && r2Enabled && bucketExists) {
          try {
            const camStats = await r2Storage.getStats(integrador.id, `${camId}/`)
            bytes = camStats.totalBytes
          } catch {
            // Câmera pode não ter gravações
          }
        }
        camBytesCache[camId] = bytes
        return bytes
      }

      const sites = await Promise.all(cf.sites.map(async (site) => {
        const siteCameraIds = site.cameras.map(c => c.id)
        let siteBytes = 0
        for (const camId of siteCameraIds) {
          siteBytes += await fetchCam(camId)
        }
        return {
          id: site.id,
          name: site.name,
          active: site.active,
          cameras: siteCameraIds.length,
          usedBytes: siteBytes,
          usedGB: Number((siteBytes / (1024 * 1024 * 1024)).toFixed(2)),
        }
      }))

      const totalBytes = sites.reduce((acc, s) => acc + s.usedBytes, 0)
      const totalCameras = sites.reduce((acc, s) => acc + s.cameras, 0)

      return {
        id: cf.id,
        name: cf.name,
        tradeName: cf.tradeName,
        cameras: totalCameras,
        usedGB: Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2)),
        sites: sites.map(({ usedBytes: _, ...rest }) => rest), // omit usedBytes wire
      }
    }))

    const totalCameras = clientesFinais.reduce((acc, cf) => acc + cf.cameras, 0)

    // ─── Receita / Margem / Câmeras sem plano (cascata câm > cliente > contrato) ──
    const markupPct = integrador.retentionContract?.markupPct
      ? Number(integrador.retentionContract.markupPct)
      : 30
    let revenueBrl = 0
    let costR2Brl  = 0
    let camerasWithoutPlan = 0
    let camerasWithPlan = 0
    for (const cf of integrador.clienteFinais) {
      for (const site of cf.sites) {
        for (const cam of site.cameras) {
          const effective =
            cam.retentionPlan
            ?? cf.retentionPlanDefault
            ?? integrador.retentionContract?.defaultPlano
            ?? null
          if (!effective) { camerasWithoutPlan++; continue }
          camerasWithPlan++
          const baseUsd = Number(effective.pricePerCameraMonthUsd)
          const finalUsd = baseUsd * (1 + markupPct / 100)
          revenueBrl += finalUsd * usdBrlRate
          costR2Brl  += Number(effective.costR2EstimatedUsd ?? 0) * usdBrlRate
        }
      }
    }
    revenueBrl = Number(revenueBrl.toFixed(2))
    costR2Brl  = Number(costR2Brl.toFixed(2))
    const marginPct = revenueBrl > 0
      ? Math.round(((revenueBrl - costR2Brl) / revenueBrl) * 100)
      : null

    return {
      integradorId: integrador.id,
      integrador: {
        id: integrador.id,
        name: integrador.name,
        tradeName: integrador.tradeName,
        email: integrador.email,
        active: integrador.active,
      },
      active: integrador.active,
      type: storageType,
      bucket: bucketName,
      bucketExists,
      endpoint: storageType === 'custom' ? integrador.storageEndpoint : (r2Enabled ? process.env.R2_ENDPOINT : null),
      region: integrador.storageRegion,
      retainDays: integrador.storageRetainDays ?? 30,
      totalBytes,
      totalGB: Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2)),
      objectCount,
      totalCameras,
      clientesFinaisCount: clientesFinais.length,
      clientesFinais,
      // ── Money & plano ────────────────────────────────────────────────
      contract: integrador.retentionContract ? {
        markupPct,
        defaultPlanSlug: integrador.retentionContract.defaultPlano?.slug ?? null,
        defaultPlanName: integrador.retentionContract.defaultPlano?.name ?? null,
        defaultPlanRetainDays: integrador.retentionContract.defaultPlano?.retainDays ?? null,
      } : null,
      revenueBrl,
      costR2Brl,
      marginPct,
      camerasWithPlan,
      camerasWithoutPlan,
    }
  }))

  const activeBuckets = buckets.filter(b => b.active)
  const totalRevenueBrl = Number(activeBuckets.reduce((acc, b) => acc + b.revenueBrl, 0).toFixed(2))
  const totalCostR2Brl  = Number(activeBuckets.reduce((acc, b) => acc + b.costR2Brl,  0).toFixed(2))
  // Margem média ponderada pela receita (mais fiel que média simples).
  const totalMarginPct = totalRevenueBrl > 0
    ? Math.round(((totalRevenueBrl - totalCostR2Brl) / totalRevenueBrl) * 100)
    : null
  const totalCamerasWithoutPlan = activeBuckets.reduce((acc, b) => acc + b.camerasWithoutPlan, 0)
  const integradoresLowMargin   = activeBuckets.filter(b => (b.marginPct ?? 100) < 50).length
  const integradoresSuspended   = buckets.length - activeBuckets.length

  const totals = {
    totalBuckets: buckets.filter(b => b.bucketExists || b.type !== 'none').length,
    totalGB: Number(buckets.reduce((acc, b) => acc + b.totalGB, 0).toFixed(2)),
    totalCameras: buckets.reduce((acc, b) => acc + b.totalCameras, 0),
    totalClientes: buckets.reduce((acc, b) => acc + b.clientesFinaisCount, 0),
    totalIntegradores: integradores.length,
    totalIntegradoresAtivos: activeBuckets.length,
    totalRevenueBrl,
    totalCostR2Brl,
    totalMarginPct,
    totalCamerasWithoutPlan,
    integradoresLowMargin,
    integradoresSuspended,
    usdBrlRate,
  }

  res.json({
    r2Enabled,
    r2Endpoint: process.env.R2_ENDPOINT || null,
    buckets,
    totals,
  })
}))

// ─── GET /storage/me/usage ───────────────────────────────────────────────────
// Storage usado no escopo do JWT (CLIENTE_* → próprio cliente; INTEGRADOR_* →
// agregado do integrador; SUPER_ADMIN → exige ?clienteFinalId ou ?integradorId).
// Fonte: soma de `RecordingSegment.sizeBytes` para câmeras do tenant na janela
// de retenção atual (`Integrador.storageRetainDays`, default 30d).
storageConfigRouter.get('/me/usage', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const p = req.jwtPayload!
  const queryClienteFinalId = req.query.clienteFinalId?.toString()
  const queryIntegradorId   = req.query.integradorId?.toString()

  // Resolve escopo: prioridade CLIENTE_* → INTEGRADOR_* → SUPER_ADMIN com query.
  let clienteFinalId: string | null = null
  let integradorId:   string | null = null

  if (p.role.startsWith('CLIENTE_')) {
    if (!p.clienteFinalId) throw new ForbiddenError('Token sem clienteFinalId — sessão inválida')
    clienteFinalId = p.clienteFinalId
    integradorId   = p.integradorId ?? null
  } else if (p.role.startsWith('INTEGRADOR_')) {
    if (!p.integradorId) throw new ForbiddenError('Token sem integradorId — sessão inválida')
    integradorId = p.integradorId
    // Integrador pode pedir foco em um cliente específico do próprio tenant
    if (queryClienteFinalId) {
      const cf = await prisma.clienteFinal.findUnique({
        where: { id: queryClienteFinalId },
        select: { integradorId: true },
      })
      if (!cf || cf.integradorId !== integradorId) {
        throw new ForbiddenError('Cliente final não pertence ao seu tenant')
      }
      clienteFinalId = queryClienteFinalId
    }
  } else if (p.role === 'SUPER_ADMIN' || p.role === 'ADMIN_GLOBAL') {
    if (queryClienteFinalId) clienteFinalId = queryClienteFinalId
    else if (queryIntegradorId) integradorId = queryIntegradorId
    else throw new ValidationError('Informe clienteFinalId ou integradorId')
  } else {
    throw new ForbiddenError(`Role '${p.role}' não tem acesso a storage`)
  }

  // Janela de retenção (default 30d). Storage só guarda segmentos dentro dela.
  let retainDays = 30
  if (integradorId) {
    const integ = await prisma.integrador.findUnique({
      where:  { id: integradorId },
      select: { storageRetainDays: true },
    })
    retainDays = integ?.storageRetainDays ?? 30
  }
  const since = new Date(Date.now() - retainDays * 24 * 3600 * 1000)

  // Cota acordada com o cliente (BigInt, null = sem cota explícita).
  // Para escopo INTEGRADOR sem foco em cliente específico, somamos as cotas
  // dos clientes do tenant; se nenhum tem cota, fica null.
  let quotaBytes: number | null = null
  if (clienteFinalId) {
    const cf = await prisma.clienteFinal.findUnique({
      where:  { id: clienteFinalId },
      select: { storageQuotaBytes: true },
    })
    quotaBytes = cf?.storageQuotaBytes != null ? Number(cf.storageQuotaBytes) : null
  } else if (integradorId) {
    const sumQ = await prisma.clienteFinal.aggregate({
      where: { integradorId },
      _sum:  { storageQuotaBytes: true },
    })
    quotaBytes = sumQ._sum.storageQuotaBytes != null ? Number(sumQ._sum.storageQuotaBytes) : null
  }

  // Filtro de câmeras pelo escopo (Camera → Site → ClienteFinal → Integrador).
  const cameraWhere: Record<string, unknown> = clienteFinalId
    ? { site: { clienteFinalId } }
    : { site: { clienteFinal: { integradorId } } }

  // Soma sizeBytes + count em uma única query agregada.
  const agg = await prisma.recordingSegment.aggregate({
    where: {
      camera:  cameraWhere,
      startedAt: { gte: since },
    },
    _sum:   { sizeBytes: true },
    _count: { _all: true },
  })

  // BigInt → number (ok até ~9 PB, suficiente para qualquer cliente realista).
  const usedBytes = Number(agg._sum.sizeBytes ?? 0n)
  const objects   = agg._count._all

  // Percentual + classificação de saúde para UI (verde/amarelo/vermelho)
  let usagePct: number | null = null
  let status: 'ok' | 'warning' | 'critical' | 'unmetered' = 'unmetered'
  if (quotaBytes != null && quotaBytes > 0) {
    usagePct = Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10)
    status = usagePct >= 90 ? 'critical' : usagePct >= 75 ? 'warning' : 'ok'
  }

  // ── Sprint 1: enriquecimento — custo estimado, contato do integrador, freshness ─
  // Custo R2 base ($0.015/GB-mês × USD_BRL). NÃO inclui markup do integrador
  // (esse vem no Sprint 4). É um indicativo do "custo de prateleira" só.
  const usedGB        = usedBytes / (1024 * 1024 * 1024)
  const usdBrlRate    = Number(process.env.USD_BRL_RATE ?? 5.30)
  const r2GbMonthUsd  = 0.015
  const estimatedMonthlyUsd = usedGB * r2GbMonthUsd
  const estimatedMonthlyBrl = Number((estimatedMonthlyUsd * usdBrlRate).toFixed(2))

  // Contato do integrador (útil ao CF: "se algo travou, fale com fulano").
  // Ocultar para SUPER_ADMIN que está espiando — só faz sentido pro CF/INT.
  let integradorContact: { name: string; email: string | null; phone: string | null } | null = null
  if (integradorId && p.role.startsWith('CLIENTE_')) {
    const integ = await prisma.integrador.findUnique({
      where:  { id: integradorId },
      select: { name: true, email: true, phone: true },
    })
    if (integ) integradorContact = { name: integ.name, email: integ.email, phone: integ.phone }
  }

  // Cancelamento — se cliente está em graça LGPD, expor pra UI alertar
  let cancellation: { canceledAt: string; cancelGraceUntil: string } | null = null
  if (clienteFinalId) {
    const cf = await prisma.clienteFinal.findUnique({
      where:  { id: clienteFinalId },
      select: { canceledAt: true, cancelGraceUntil: true },
    })
    if (cf?.canceledAt && cf?.cancelGraceUntil) {
      cancellation = {
        canceledAt:        cf.canceledAt.toISOString(),
        cancelGraceUntil: cf.cancelGraceUntil.toISOString(),
      }
    }
  }

  // Freshness — quando foi o último evento processado pelo r2-event-consumer
  // (StorageBucket do integrador). Útil pra UI dizer "atualizado há 30s" ou
  // alertar "dados defasados >24h".
  let lastUpdatedAt: string | null = null
  if (integradorId) {
    const sb = await prisma.storageBucket.findFirst({
      where:  { integradorId, active: true },
      select: { lastEventTime: true, lastReconciledAt: true, updatedAt: true },
    })
    // Prioridade: evento real > reconcile > updatedAt do registro
    const ts = sb?.lastEventTime ?? sb?.lastReconciledAt ?? sb?.updatedAt ?? null
    lastUpdatedAt = ts ? ts.toISOString() : null
  }

  res.json({
    scope: clienteFinalId
      ? { kind: 'CLIENTE_FINAL', clienteFinalId, integradorId }
      : { kind: 'INTEGRADOR', integradorId },
    usedBytes,
    usedMB: Number((usedBytes / (1024 * 1024)).toFixed(2)),
    usedGB: Number(usedGB.toFixed(3)),
    quotaBytes,
    quotaGB: quotaBytes != null ? Number((quotaBytes / (1024 * 1024 * 1024)).toFixed(3)) : null,
    usagePct,
    status,
    objectCount: objects,
    retainDays,
    windowSinceIso: since.toISOString(),
    asOf: new Date().toISOString(),
    // Sprint 1 — campos novos
    estimatedMonthlyBrl,
    estimatedMonthlyUsd: Number(estimatedMonthlyUsd.toFixed(4)),
    usdBrlRate,
    integradorContact,
    cancellation,
    lastUpdatedAt,
  })
}))

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

  // Snapshot do estado antes da mudança — para diff e auditoria
  const before = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: {
      storageEndpoint: true, storageRegion: true, storageBucket: true,
      storageRetainDays: true,
      // Flags booleans dos secrets (não pegamos os valores cifrados)
      storageAccessKeyEnc: true, storageSecretKeyEnc: true,
    },
  })

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

  // Auditoria semântica — mudança de storage redireciona gravações.
  // CRÍTICO: senhas cifradas viram booleans (presence) — nunca persistir o valor.
  // Sub-action distingue mudança de provider vs apenas retenção.
  const providerChanged =
    (body.useR2 && before?.storageEndpoint != null) ||
    (body.customEndpoint !== undefined && body.customEndpoint !== before?.storageEndpoint)
  const action = providerChanged
    ? (body.useR2 ? 'STORAGE_CONFIG_SWITCHED_TO_R2' : 'STORAGE_CONFIG_SWITCHED_TO_CUSTOM')
    : 'STORAGE_CONFIG_CHANGED'

  await auditAction(prisma, {
    req,
    action,
    resource: 'Integrador',
    resourceId: integradorId,
    result: 'SUCCESS',
    metadata: {
      integradorId,
      previousProvider: before?.storageEndpoint ? 'custom' : 'r2',
      newProvider: body.useR2 ? 'r2' : (body.customEndpoint ? 'custom' : 'unchanged'),
      retainDaysChanged: body.retainDays !== undefined && body.retainDays !== before?.storageRetainDays,
      retainDaysFrom: before?.storageRetainDays,
      retainDaysTo: body.retainDays,
      customEndpoint: body.customEndpoint ?? null,
      customBucket: body.customBucket ?? null,
      customRegion: body.customRegion ?? null,
      // Flag de rotação — sem expor o valor
      accessKeyRotated: !!body.customAccessKey,
      secretKeyRotated: !!body.customSecretKey,
    },
  })

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

// =============================================================================
// FASE 1 & 2 — Detalhamento por Cliente Final
// =============================================================================

// ─── GET /storage/cliente/:id — Detalhes de storage do cliente final ─────────
storageConfigRouter.get('/cliente/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { role, integradorId: userIntegradorId } = req.jwtPayload!
  const clienteFinalId = req.params.id

  const clienteFinal = await prisma.clienteFinal.findUnique({
    where: { id: clienteFinalId },
    select: {
      id: true,
      name: true,
      tradeName: true,
      integradorId: true,
      integrador: {
        select: {
          id: true,
          name: true,
          storageRetainDays: true,
          storageEndpoint: true,
          storageBucket: true,
          storageAccessKeyEnc: true,
        },
      },
      sites: {
        where: { active: true },
        select: {
          id: true,
          name: true,
          cameras: {
            where: { active: true },
            select: {
              id: true,
              name: true,
              lastSnapshotUrl: true,
              lastSnapshotAt: true,
              status: true,
              recordEnabled: true,
              recordRetainDays: true,
            },
          },
        },
      },
    },
  }) as any

  if (!clienteFinal) throw new NotFoundError('Cliente Final')

  // Verificar permissão
  if (role !== 'SUPER_ADMIN' && userIntegradorId !== clienteFinal.integradorId) {
    throw new ForbiddenError('Sem permissão para acessar este cliente')
  }

  const integradorId = clienteFinal.integradorId
  const hasCustomStorage = !!(clienteFinal.integrador.storageEndpoint && clienteFinal.integrador.storageAccessKeyEnc)
  const storageType = hasCustomStorage ? 'custom' : (r2Storage.isEnabled() ? 'r2' : 'none')

  // Estrutura real do bucket: {cameraId}/{date}/{file}.ts
  // Calcular storage por câmera
  let totalBytes = 0
  let totalObjects = 0

  const cameras = await Promise.all(clienteFinal.sites.flatMap((site: any) =>
    site.cameras.map(async (cam: any) => {
      let usedBytes = 0
      let objectCount = 0

      if (storageType === 'r2' && r2Storage.isEnabled()) {
        try {
          const camStats = await r2Storage.getStats(integradorId, `${cam.id}/`)
          usedBytes = camStats.totalBytes
          objectCount = camStats.count
          totalBytes += usedBytes
          totalObjects += objectCount
        } catch {
          // Câmera pode não ter gravações
        }
      }

      return {
        id: cam.id,
        name: cam.name,
        siteName: site.name,
        siteId: site.id,
        lastSnapshotUrl: cam.lastSnapshotUrl,
        lastSnapshotAt: cam.lastSnapshotAt,
        status: cam.status,
        recordEnabled: cam.recordEnabled,
        retainDays: cam.recordRetainDays,
        usedBytes,
        usedMB: Number((usedBytes / (1024 * 1024)).toFixed(2)),
        objectCount,
      }
    })
  ))

  res.json({
    clienteFinal: {
      id: clienteFinal.id,
      name: clienteFinal.name,
      tradeName: clienteFinal.tradeName,
    },
    integrador: {
      id: clienteFinal.integrador.id,
      name: clienteFinal.integrador.name,
    },
    storage: {
      type: storageType,
      bucket: storageType === 'r2' ? r2Storage.getBucketName(integradorId) : clienteFinal.integrador.storageBucket,
      retainDays: clienteFinal.integrador.storageRetainDays ?? 30,
      totalBytes,
      totalGB: Number((totalBytes / (1024 * 1024 * 1024)).toFixed(3)),
      totalObjects,
    },
    cameras,
    summary: {
      totalCameras: cameras.length,
      activeCameras: cameras.filter(c => c.status === 'ONLINE').length,
      recordingCameras: cameras.filter(c => c.recordEnabled).length,
    },
  })
}))

// ─── GET /storage/cliente/:id/browse — Object browser para cliente final ─────
// Estrutura real: {cameraId}/{date}/{file}.ts
storageConfigRouter.get('/cliente/:id/browse', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { role, integradorId: userIntegradorId } = req.jwtPayload!
  const clienteFinalId = req.params.id
  const subPath = req.query.path?.toString() || ''
  const maxKeys = Math.min(Number(req.query.limit) || 100, 1000)

  const clienteFinal = await prisma.clienteFinal.findUnique({
    where: { id: clienteFinalId },
    select: {
      integradorId: true,
      sites: {
        select: {
          cameras: {
            where: { active: true },
            select: { id: true, name: true },
          },
        },
      },
      integrador: {
        select: {
          storageEndpoint: true,
          storageRegion: true,
          storageBucket: true,
          storageAccessKeyEnc: true,
          storageSecretKeyEnc: true,
        },
      },
    },
  }) as any

  if (!clienteFinal) throw new NotFoundError('Cliente Final')

  if (role !== 'SUPER_ADMIN' && userIntegradorId !== clienteFinal.integradorId) {
    throw new ForbiddenError('Sem permissão para acessar este cliente')
  }

  const integradorId = clienteFinal.integradorId
  const hasCustomStorage = !!(clienteFinal.integrador.storageEndpoint && clienteFinal.integrador.storageAccessKeyEnc)

  // Mapear câmeras do cliente (estrutura: {cameraId}/{date}/{file}.ts)
  const cameraMap = new Map<string, string>()
  for (const site of clienteFinal.sites) {
    for (const cam of site.cameras) {
      cameraMap.set(cam.id, cam.name)
    }
  }
  const cameraIds = Array.from(cameraMap.keys())

  if (!hasCustomStorage && r2Storage.isEnabled()) {
    // Se path vazio, mostrar câmeras como pastas virtuais
    if (!subPath) {
      const items = await Promise.all(cameraIds.map(async (camId) => {
        const stats = await r2Storage.getStats(integradorId, `${camId}/`)
        return {
          type: 'folder' as const,
          key: `${camId}/`,
          name: cameraMap.get(camId) || camId,
          path: `${camId}/`,
          cameraId: camId,
          objectCount: stats.count,
          totalBytes: stats.totalBytes,
          sizeFormatted: formatBytes(stats.totalBytes),
        }
      }))

      return res.json({
        clienteFinalId,
        bucket: r2Storage.getBucketName(integradorId),
        currentPath: '',
        items: items.filter(i => i.objectCount > 0), // só mostrar câmeras com dados
        totalItems: items.length,
        truncated: false,
        breadcrumbs: [],
      })
    }

    // Navegar dentro de uma câmera
    const result = await r2Storage.browse(integradorId, subPath, maxKeys)

    const items = [
      ...result.folders.map(f => ({
        type: 'folder' as const,
        key: f,
        name: f.replace(subPath, '').replace(/\/$/, ''),
        path: f,
      })),
      ...result.files.map(f => {
        const ext = f.name.split('.').pop()?.toLowerCase() || ''
        const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)
        const isVideo = ['mp4', 'webm', 'mkv', 'ts'].includes(ext)
        return {
          type: 'file' as const,
          key: f.key,
          name: f.name,
          path: f.key,
          size: f.size,
          sizeFormatted: formatBytes(f.size || 0),
          lastModified: f.lastModified,
          mediaType: isImage ? 'image' : isVideo ? 'video' : 'other',
          ext,
        }
      }),
    ]

    return res.json({
      clienteFinalId,
      bucket: result.bucket,
      currentPath: subPath,
      items,
      totalItems: items.length,
      truncated: result.truncated,
      breadcrumbs: buildBreadcrumbs(subPath),
    })
  }

  // Custom storage
  if (!hasCustomStorage) {
    return res.json({ items: [], error: 'Storage não configurado' })
  }

  const basePrefix = ''
  const fullPrefix = subPath ? (subPath.endsWith('/') ? subPath : `${subPath}/`) : ''

  const client = new S3Client({
    endpoint: clienteFinal.integrador.storageEndpoint!,
    region: clienteFinal.integrador.storageRegion || 'us-east-1',
    credentials: {
      accessKeyId: decryptSecret(clienteFinal.integrador.storageAccessKeyEnc!) || '',
      secretAccessKey: decryptSecret(clienteFinal.integrador.storageSecretKeyEnc) || '',
    },
    forcePathStyle: true,
  })

  const listResult = await client.send(new ListObjectsV2Command({
    Bucket: clienteFinal.integrador.storageBucket!,
    Prefix: fullPrefix,
    MaxKeys: maxKeys,
    Delimiter: '/',
  }))

  const folders = (listResult.CommonPrefixes || []).map(p => ({
    type: 'folder' as const,
    key: p.Prefix!,
    name: p.Prefix!.replace(fullPrefix, '').replace(/\/$/, ''),
    path: p.Prefix!.replace(basePrefix, ''),
  }))

  const files = (listResult.Contents || []).filter(o => o.Key !== fullPrefix).map(o => {
    const name = o.Key!.replace(fullPrefix, '')
    const ext = name.split('.').pop()?.toLowerCase() || ''
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)
    const isVideo = ['mp4', 'webm', 'mkv', 'ts'].includes(ext)
    return {
      type: 'file' as const,
      key: o.Key!,
      name,
      path: o.Key!.replace(basePrefix, ''),
      size: o.Size,
      sizeFormatted: formatBytes(o.Size || 0),
      lastModified: o.LastModified,
      mediaType: isImage ? 'image' : isVideo ? 'video' : 'other',
      ext,
    }
  })

  res.json({
    clienteFinalId,
    bucket: clienteFinal.integrador.storageBucket,
    basePrefix,
    currentPath: subPath,
    fullPrefix,
    items: [...folders, ...files],
    totalItems: folders.length + files.length,
    truncated: listResult.IsTruncated,
    breadcrumbs: buildBreadcrumbs(subPath),
  })
}))

// ─── GET /storage/preview — URL assinada para preview de objeto ──────────────
// Estrutura: {cameraId}/{date}/{file}
storageConfigRouter.get('/preview', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { role, integradorId: userIntegradorId } = req.jwtPayload!
  const key = req.query.key?.toString()
  const clienteFinalId = req.query.clienteFinalId?.toString()

  if (!key || !clienteFinalId) {
    throw new ValidationError('key e clienteFinalId são obrigatórios')
  }

  // Extrair cameraId do key (primeira parte do path)
  const cameraIdFromKey = key.split('/')[0]

  const clienteFinal = await prisma.clienteFinal.findUnique({
    where: { id: clienteFinalId },
    select: {
      integradorId: true,
      sites: {
        select: {
          cameras: {
            where: { active: true },
            select: { id: true },
          },
        },
      },
      integrador: {
        select: {
          storageEndpoint: true,
          storageBucket: true,
          storageAccessKeyEnc: true,
          storageSecretKeyEnc: true,
        },
      },
    },
  })

  if (!clienteFinal) throw new NotFoundError('Cliente Final')

  // Validar que a câmera pertence ao cliente final
  const cameraIds = clienteFinal.sites.flatMap(s => s.cameras.map(c => c.id))
  if (!cameraIds.includes(cameraIdFromKey)) {
    throw new ForbiddenError('Objeto não pertence a este cliente')
  }

  if (role !== 'SUPER_ADMIN' && userIntegradorId !== clienteFinal.integradorId) {
    throw new ForbiddenError('Sem permissão')
  }

  const hasCustomStorage = !!(clienteFinal.integrador.storageEndpoint && clienteFinal.integrador.storageAccessKeyEnc)

  if (!hasCustomStorage && r2Storage.isEnabled()) {
    const url = await r2Storage.getPresignedUrl(clienteFinal.integradorId, key, 3600) // 1h
    return res.json({ url, expiresIn: 3600 })
  }

  // Para custom storage, retornar URL direta (se público) ou implementar signed URL
  if (hasCustomStorage) {
    // Simplificado: retorna path relativo, frontend constrói URL
    return res.json({
      url: `${clienteFinal.integrador.storageEndpoint}/${clienteFinal.integrador.storageBucket}/${key}`,
      expiresIn: null,
      note: 'URL direta - requer credenciais se bucket privado',
    })
  }

  throw new ValidationError('Storage não configurado')
}))

// ─── GET /storage/camera/:id/usage — Storage usage por câmera ────────────────
storageConfigRouter.get('/camera/:id/usage', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { role, integradorId: userIntegradorId } = req.jwtPayload!
  const cameraId = req.params.id

  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: {
      id: true,
      name: true,
      edgeNodeId: true,
      site: {
        select: {
          clienteFinalId: true,

          clienteFinal: {
            select: {
              integradorId: true,
              integrador: {
                select: {
                  storageEndpoint: true,
                  storageBucket: true,
                  storageAccessKeyEnc: true,
                },
              },
            },
          },
        },
      },
    },
  }) as any

  if (!camera) throw new NotFoundError('Câmera')

  const integradorId = camera.site.clienteFinal.integradorId
  if (role !== 'SUPER_ADMIN' && userIntegradorId !== integradorId) {
    throw new ForbiddenError('Sem permissão')
  }

  // Estrutura real: {cameraId}/{date}/{file}.ts
  const prefix = `${cameraId}/`
  const hasCustomStorage = !!(camera.site.clienteFinal.integrador.storageEndpoint && camera.site.clienteFinal.integrador.storageAccessKeyEnc)

  let totalBytes = 0
  let objectCount = 0
  const folders: string[] = []

  if (!hasCustomStorage && r2Storage.isEnabled()) {
    try {
      // getStats para total recursivo
      const stats = await r2Storage.getStats(integradorId, prefix)
      totalBytes = stats.totalBytes
      objectCount = stats.count

      // browse para listar pastas (datas)
      const result = await r2Storage.browse(integradorId, prefix, 100)
      folders.push(...result.folders.map(f => f.replace(prefix, '').replace(/\/$/, '')))
    } catch {
      // Câmera pode não ter gravações ainda
    }
  }

  res.json({
    cameraId,
    cameraName: camera.name,
    prefix,
    totalBytes,
    totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    totalGB: Number((totalBytes / (1024 * 1024 * 1024)).toFixed(3)),
    objectCount,
    folders, // Datas disponíveis
  })
}))

// ─── GET /storage/orphans — Lista gravações órfãs (cameraIds no bucket sem registro no banco) ───
storageConfigRouter.get('/orphans', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { role, integradorId: userIntegradorId } = req.jwtPayload!
  const queryIntegradorId = req.query.integradorId?.toString()

  // Determinar integradorId
  let integradorId: string
  if (role === 'SUPER_ADMIN') {
    if (!queryIntegradorId) {
      throw new ValidationError('integradorId é obrigatório para SUPER_ADMIN')
    }
    integradorId = queryIntegradorId
  } else if (role === 'INTEGRADOR_ADMIN' && userIntegradorId) {
    integradorId = userIntegradorId
  } else {
    throw new ForbiddenError('Apenas SUPER_ADMIN ou INTEGRADOR_ADMIN pode visualizar gravações órfãs')
  }

  const integrador = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: { id: true, name: true },
  })
  if (!integrador) throw new NotFoundError('Integrador')

  if (!r2Storage.isEnabled()) {
    return res.json({ orphans: [], message: 'R2 storage não habilitado' })
  }

  // Buscar todos os prefixos únicos (cameraIds) no bucket
  const bucketPrefixes = await r2Storage.listUniquePrefixes(integradorId)

  // Buscar todas as câmeras ativas E inativas do integrador
  const allCameras = await prisma.camera.findMany({
    where: {
      site: {
        clienteFinal: { integradorId },
      },
    },
    select: {
      id: true,
      name: true,
      active: true,
      site: {
        select: {
          name: true,
          clienteFinal: {
            select: { id: true, name: true },
          },
        },
      },
    },
  })

  const cameraMap = new Map(allCameras.map(c => [c.id, c]))
  const activeCameraIds = new Set(allCameras.filter(c => c.active).map(c => c.id))

  // Classificar prefixos
  const orphans: Array<{
    cameraId: string
    status: 'deleted' | 'inactive' | 'orphan'
    cameraName?: string
    clienteFinalId?: string
    clienteFinalName?: string
    siteName?: string
    totalBytes: number
    totalGB: number
    objectCount: number
  }> = []

  for (const prefixId of bucketPrefixes) {
    const camera = cameraMap.get(prefixId)
    const stats = await r2Storage.getStats(integradorId, `${prefixId}/`)

    if (stats.count === 0) continue // Prefixo vazio

    if (!camera) {
      // Câmera não existe mais no banco = excluída
      orphans.push({
        cameraId: prefixId,
        status: 'deleted',
        totalBytes: stats.totalBytes,
        totalGB: Number((stats.totalBytes / (1024 * 1024 * 1024)).toFixed(3)),
        objectCount: stats.count,
      })
    } else if (!camera.active) {
      // Câmera existe mas está inativa
      orphans.push({
        cameraId: prefixId,
        status: 'inactive',
        cameraName: camera.name,
        clienteFinalId: camera.site.clienteFinal.id,
        clienteFinalName: camera.site.clienteFinal.name,
        siteName: camera.site.name,
        totalBytes: stats.totalBytes,
        totalGB: Number((stats.totalBytes / (1024 * 1024 * 1024)).toFixed(3)),
        objectCount: stats.count,
      })
    }
    // Câmeras ativas não são órfãs
  }

  // Ordenar por tamanho (maior primeiro)
  orphans.sort((a, b) => b.totalBytes - a.totalBytes)

  const totalOrphanBytes = orphans.reduce((acc, o) => acc + o.totalBytes, 0)
  const totalOrphanObjects = orphans.reduce((acc, o) => acc + o.objectCount, 0)

  // Registrar acesso no log
  await logStorageAccess(req, 'VIEW_BUCKET', {
    integradorId,
    metadata: { action: 'list_orphans', orphanCount: orphans.length },
  })

  res.json({
    integradorId,
    integradorName: integrador.name,
    bucket: r2Storage.getBucketName(integradorId),
    orphans,
    summary: {
      totalOrphans: orphans.length,
      deletedCameras: orphans.filter(o => o.status === 'deleted').length,
      inactiveCameras: orphans.filter(o => o.status === 'inactive').length,
      totalBytes: totalOrphanBytes,
      totalGB: Number((totalOrphanBytes / (1024 * 1024 * 1024)).toFixed(3)),
      totalObjects: totalOrphanObjects,
    },
  })
}))

// ─── DELETE /storage/orphans — Exclui gravações órfãs ────────────────────────
storageConfigRouter.delete('/orphans', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { role, integradorId: userIntegradorId, sub: actorId } = req.jwtPayload!
  const { integradorId: bodyIntegradorId, cameraIds, confirmDelete } = req.body as {
    integradorId?: string
    cameraIds: string[]
    confirmDelete?: boolean
  }

  // Determinar integradorId
  let integradorId: string
  if (role === 'SUPER_ADMIN') {
    if (!bodyIntegradorId) {
      throw new ValidationError('integradorId é obrigatório para SUPER_ADMIN')
    }
    integradorId = bodyIntegradorId
  } else if (role === 'INTEGRADOR_ADMIN' && userIntegradorId) {
    integradorId = userIntegradorId
  } else {
    throw new ForbiddenError('Apenas SUPER_ADMIN ou INTEGRADOR_ADMIN pode excluir gravações órfãs')
  }

  if (!cameraIds || !Array.isArray(cameraIds) || cameraIds.length === 0) {
    throw new ValidationError('cameraIds deve ser um array com ao menos um ID')
  }

  if (!confirmDelete) {
    throw new ValidationError('confirmDelete deve ser true para confirmar a exclusão')
  }

  const integrador = await prisma.integrador.findUnique({
    where: { id: integradorId },
    select: { id: true, name: true },
  })
  if (!integrador) throw new NotFoundError('Integrador')

  if (!r2Storage.isEnabled()) {
    throw new ValidationError('R2 storage não habilitado')
  }

  // Verificar que as câmeras são realmente órfãs (não ativas)
  const activeCameras = await prisma.camera.findMany({
    where: {
      id: { in: cameraIds },
      active: true,
      site: {
        clienteFinal: { integradorId },
      },
    },
    select: { id: true },
  })

  if (activeCameras.length > 0) {
    throw new ValidationError(`Câmeras ativas não podem ser excluídas: ${activeCameras.map(c => c.id).join(', ')}`)
  }

  // Excluir objetos de cada câmera
  const results: Array<{ cameraId: string; deletedCount: number; deletedBytes: number }> = []
  let totalDeletedBytes = 0
  let totalDeletedCount = 0

  for (const cameraId of cameraIds) {
    const stats = await r2Storage.getStats(integradorId, `${cameraId}/`)
    const deletedCount = await r2Storage.deleteByPrefix(integradorId, `${cameraId}/`)

    results.push({
      cameraId,
      deletedCount,
      deletedBytes: stats.totalBytes,
    })
    totalDeletedBytes += stats.totalBytes
    totalDeletedCount += deletedCount
  }

  // Registrar no log de auditoria
  await logStorageAccess(req, 'DELETE_ORPHANS', {
    integradorId,
    objectCount: totalDeletedCount,
    bytesAffected: BigInt(totalDeletedBytes),
    metadata: { cameraIds, results },
  })

  logger.info({
    action: 'storage_orphans_deleted',
    integradorId,
    actorId,
    role,
    cameraIds,
    totalDeletedCount,
    totalDeletedBytes,
  }, 'Orphan recordings deleted')

  res.json({
    success: true,
    integradorId,
    deleted: results,
    summary: {
      camerasProcessed: cameraIds.length,
      totalObjectsDeleted: totalDeletedCount,
      totalBytesFreed: totalDeletedBytes,
      totalGBFreed: Number((totalDeletedBytes / (1024 * 1024 * 1024)).toFixed(3)),
    },
  })
}))

// ─── GET /storage/logs — Logs de acesso ao storage (multi-tenant) ────────────
storageConfigRouter.get('/logs', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { role, integradorId: userIntegradorId, clienteFinalId: userClienteFinalId, sub: actorId } = req.jwtPayload!
  const {
    integradorId: queryIntegradorId,
    clienteFinalId: queryClienteFinalId,
    action,
    startDate,
    endDate,
    page = '1',
    limit = '50',
  } = req.query as Record<string, string>

  const pageNum = Math.max(1, parseInt(page))
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)))
  const skip = (pageNum - 1) * limitNum

  // Construir filtro baseado no role
  const where: any = {}

  if (role === 'SUPER_ADMIN') {
    // Super admin vê tudo, pode filtrar por integrador/cliente
    if (queryIntegradorId) where.integradorId = queryIntegradorId
    if (queryClienteFinalId) where.clienteFinalId = queryClienteFinalId
  } else if (role === 'INTEGRADOR_ADMIN' || role === 'INTEGRADOR_TECNICO') {
    // Integrador só vê logs do seu tenant
    where.integradorId = userIntegradorId
    if (queryClienteFinalId) where.clienteFinalId = queryClienteFinalId
  } else if (userClienteFinalId) {
    // Cliente final só vê seus próprios logs
    where.clienteFinalId = userClienteFinalId
  } else {
    throw new ForbiddenError('Sem permissão para visualizar logs de storage')
  }

  // Filtros adicionais
  if (action) {
    where.action = action
  }

  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) where.createdAt.gte = new Date(startDate)
    if (endDate) where.createdAt.lte = new Date(endDate)
  }

  const [logs, total] = await Promise.all([
    prisma.storageAccessLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum,
      select: {
        id: true,
        actorType: true,
        actorId: true,
        actorEmail: true,
        integradorId: true,
        clienteFinalId: true,
        action: true,
        bucketName: true,
        objectKey: true,
        cameraId: true,
        objectCount: true,
        bytesAffected: true,
        metadata: true,
        ipAddress: true,
        success: true,
        errorMessage: true,
        createdAt: true,
        integrador: { select: { name: true } },
        clienteFinal: { select: { name: true } },
      },
    }),
    prisma.storageAccessLog.count({ where }),
  ])

  // Formatar logs para resposta
  const formattedLogs = logs.map(log => ({
    ...log,
    bytesAffected: log.bytesAffected ? Number(log.bytesAffected) : null,
    integradorName: log.integrador?.name,
    clienteFinalName: log.clienteFinal?.name,
    integrador: undefined,
    clienteFinal: undefined,
  }))

  res.json({
    logs: formattedLogs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
    filters: {
      integradorId: where.integradorId,
      clienteFinalId: where.clienteFinalId,
      action: where.action,
      dateRange: where.createdAt,
    },
  })
}))

// ─── GET /storage/logs/actions — Lista ações disponíveis para filtro ─────────
storageConfigRouter.get('/logs/actions', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    actions: [
      { value: 'VIEW_DASHBOARD', label: 'Visualização do Dashboard' },
      { value: 'VIEW_BUCKET', label: 'Visualização de Bucket' },
      { value: 'VIEW_CLIENTE', label: 'Visualização de Cliente' },
      { value: 'BROWSE_OBJECTS', label: 'Navegação de Objetos' },
      { value: 'PREVIEW_OBJECT', label: 'Preview de Arquivo' },
      { value: 'DOWNLOAD_OBJECT', label: 'Download de Arquivo' },
      { value: 'DELETE_OBJECT', label: 'Exclusão de Arquivo' },
      { value: 'DELETE_ORPHANS', label: 'Exclusão de Órfãos' },
      { value: 'UPDATE_CONFIG', label: 'Atualização de Config' },
      { value: 'UPDATE_LIFECYCLE', label: 'Atualização de Lifecycle' },
    ],
  })
}))

// ─── Helper: Registrar log de acesso ao storage ──────────────────────────────
async function logStorageAccess(
  req: Request,
  action: string,
  data: {
    integradorId?: string
    clienteFinalId?: string
    bucketName?: string
    objectKey?: string
    cameraId?: string
    objectCount?: number
    bytesAffected?: bigint
    metadata?: any
    success?: boolean
    errorMessage?: string
  }
) {
  const { role, sub: actorId } = req.jwtPayload!

  // Determinar actorType
  let actorType = 'USER'
  if (role === 'SUPER_ADMIN') actorType = 'SUPER_ADMIN'
  else if (role === 'INTEGRADOR_ADMIN' || role === 'INTEGRADOR_TECNICO') actorType = 'INTEGRADOR'

  // Buscar email do ator
  let actorEmail: string | undefined
  if (actorType === 'SUPER_ADMIN') {
    const admin = await prisma.superAdmin.findUnique({ where: { id: actorId }, select: { email: true } })
    actorEmail = admin?.email
  } else if (actorType === 'INTEGRADOR') {
    const integrador = await prisma.integrador.findUnique({ where: { id: actorId }, select: { email: true } })
    actorEmail = integrador?.email
  } else {
    const user = await prisma.user.findUnique({ where: { id: actorId }, select: { email: true } })
    actorEmail = user?.email
  }

  await prisma.storageAccessLog.create({
    data: {
      actorType,
      actorId,
      actorEmail,
      action: action as any,
      integradorId: data.integradorId,
      clienteFinalId: data.clienteFinalId,
      bucketName: data.bucketName,
      objectKey: data.objectKey,
      cameraId: data.cameraId,
      objectCount: data.objectCount,
      bytesAffected: data.bytesAffected,
      metadata: data.metadata,
      ipAddress: req.ip || req.headers['x-forwarded-for']?.toString(),
      userAgent: req.headers['user-agent'],
      success: data.success ?? true,
      errorMessage: data.errorMessage,
    },
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function buildBreadcrumbs(path: string): Array<{ name: string; path: string }> {
  if (!path) return []
  const parts = path.split('/').filter(Boolean)
  const crumbs: Array<{ name: string; path: string }> = []
  let currentPath = ''
  for (const part of parts) {
    currentPath += part + '/'
    crumbs.push({ name: part, path: currentPath })
  }
  return crumbs
}
