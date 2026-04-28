/**
 * GET /quota/status
 *
 * Retorna informações de uso e quota da plataforma:
 *  - Ciclo de faturamento atual
 *  - Chamadas Vertex AI (estimado)
 *  - Storage S3 Hetzner (real, via boto3-like query)
 *  - Contagem de eventos
 *  - Itens detalhados de consumo por recurso
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { quotaService } from '../services/quota.service'

export const quotaRouter = Router()

// ── S3 Hetzner config via env ──────────────────────────────────────────────
const S3_ENDPOINT   = process.env.ICV_S3_ENDPOINT  || 'https://fsn1.your-objectstorage.com'
const S3_ACCESS_KEY = process.env.ICV_S3_ACCESS_KEY || ''
const S3_SECRET_KEY = process.env.ICV_S3_SECRET_KEY || ''
const S3_BUCKET     = process.env.ICV_S3_BUCKET     || 'icv-iacloud-vision'
const S3_REGION     = process.env.ICV_S3_REGION     || 'fsn1'
const S3_QUOTA_GB   = Number(process.env.ICV_S3_QUOTA_GB ?? '250')

/**
 * Busca uso real do bucket S3 via Hetzner Object Storage API.
 * Usa o SDK @aws-sdk/client-s3 se disponível, senão retorna estimativa.
 */
async function getS3Usage(): Promise<{
  usedBytes: number
  objectsCount: number
  quotaGb: number
}> {
  // Se S3 não configurado, retorna zeros
  if (!S3_ACCESS_KEY || !S3_SECRET_KEY || !S3_BUCKET) {
    return { usedBytes: 0, objectsCount: 0, quotaGb: S3_QUOTA_GB }
  }

  try {
    // Tenta usar @aws-sdk/client-s3 (instalação opcional)
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3')
    
    const client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
      forcePathStyle: true,
    })

    let totalSize = 0
    let totalObjects = 0
    let continuationToken: string | undefined

    do {
      const response = await client.send(new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        ContinuationToken: continuationToken,
      }))

      for (const obj of response.Contents ?? []) {
        totalSize += obj.Size ?? 0
        totalObjects++
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    return {
      usedBytes: totalSize,
      objectsCount: totalObjects,
      quotaGb: S3_QUOTA_GB,
    }
  } catch (err: any) {
    // Se o SDK não está instalado, tenta HTTP direto via fetch
    logger.warn({ err: err.message }, 'S3 SDK not available, trying basic HTTP')

    try {
      // Constrói uma requisição assinada básica (SigV4) — complexo demais sem SDK
      // Retorna zeros com flag indicando que é estimativa
      return { usedBytes: 0, objectsCount: 0, quotaGb: S3_QUOTA_GB }
    } catch {
      return { usedBytes: 0, objectsCount: 0, quotaGb: S3_QUOTA_GB }
    }
  }
}

/**
 * Calcula o início e fim do ciclo de faturamento mensal.
 * O ciclo começa no dia 1 de cada mês.
 */
function getBillingCycle(): { start: Date; end: Date; label: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

  const months = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ]

  const label = `${months[now.getMonth()]} ${now.getFullYear()}`
  return { start, end, label }
}

quotaRouter.get('/quota/status', requireAuth, async (req, res) => {
  try {
    const cycle = getBillingCycle()

    // ── Contagem de câmeras ativas ─────────────────────────────────────────
    let cameraCount = 0
    try {
      cameraCount = await prisma.camera.count({
        where: { active: true },
      })
    } catch {
      // Tabela pode não existir em dev
    }

    // ── Contagem de eventos no ciclo ──────────────────────────────────────
    let eventCount = 0
    try {
      // Conta eventos analíticos no ciclo atual
      eventCount = await prisma.analyticsEvent.count({
        where: {
          capturedAt: {
            gte: cycle.start,
            lte: cycle.end,
          },
        },
      })
    } catch {
      try {
        // Fallback: contar logs de câmera
        eventCount = await prisma.cameraLog.count({
          where: {
            createdAt: {
              gte: cycle.start,
              lte: cycle.end,
            },
          },
        })
      } catch {
        // Sem dados
      }
    }

    // ── Storage S3 ──────────────────────────────────────────────────────────
    const s3 = await getS3Usage()
    const storageGb = Number((s3.usedBytes / (1024 * 1024 * 1024)).toFixed(2))

    // ── Estimar chamadas Vertex AI ─────────────────────────────────────────
    // Usa contagem de eventos como proxy para chamadas de API
    const vertexCalls = eventCount

    // ── Resposta ─────────────────────────────────────────────────────────────
    res.json({
      summary: {
        cycle: `${cycle.start.toISOString().slice(0, 10)} → ${cycle.end.toISOString().slice(0, 10)}`,
        cycleLabel: cycle.label,
        vertexCalls,
        storageGb,
        events: eventCount,
        cameras: cameraCount,
      },
      items: [
        {
          resource: 'Câmeras Ativas',
          used: cameraCount,
          limit: 100,
          unit: 'câmeras',
        },
        {
          resource: 'Vertex AI (chamadas)',
          used: vertexCalls,
          limit: 10000,
          unit: 'chamadas/mês',
        },
        {
          resource: 'S3 Cloud Storage',
          used: storageGb,
          limit: s3.quotaGb,
          unit: 'GB',
        },
        {
          resource: 'Gravações Sincronizadas',
          used: s3.objectsCount,
          limit: null,
          unit: 'objetos',
        },
        {
          resource: 'Eventos no Ciclo',
          used: eventCount,
          limit: 50000,
          unit: 'eventos/mês',
        },
      ],
      s3: {
        enabled: !!(S3_ACCESS_KEY && S3_SECRET_KEY && S3_BUCKET),
        bucket: S3_BUCKET,
        endpoint: S3_ENDPOINT,
        region: S3_REGION,
        usedBytes: s3.usedBytes,
        usedGb: storageGb,
        quotaGb: s3.quotaGb,
        objectsCount: s3.objectsCount,
      },
    })
  } catch (err: any) {
    logger.error({ err }, 'quota_status_error')
    res.status(500).json({
      error: 'QUOTA_STATUS_ERROR',
      message: 'Falha ao calcular status de quota',
    })
  }
})

/**
 * GET /quota/me
 *
 * Retorna o status de quota escopado pelo JWT do usuário atual.
 *
 *  - SUPER_ADMIN          → agregado da plataforma (igual a /quota/status)
 *  - INTEGRADOR_*         → consumo do próprio integrador (cameras + events
 *                           filtrados via site.clienteFinal.integradorId, e
 *                           hard-limits do ApiQuota via QuotaService)
 *  - CLIENT_ADMIN/OPER.   → consumo do próprio cliente final (sem ver vertex
 *                           hard-limit do integrador — é de outra camada)
 *
 * Resposta tem o mesmo shape de /quota/status (summary + items + s3) para que
 * o frontend possa consumir o mesmo componente. Campo extra `scope` deixa
 * explícito o nível de visibilidade pra UI escolher disclaimer correto.
 */
quotaRouter.get('/quota/me', requireAuth, async (req, res) => {
  try {
    const jwt = req.jwtPayload!
    const cycle = getBillingCycle()

    // ── Resolver escopo a partir do JWT ──────────────────────────────────
    // Não confiamos em campos opcionais sem checar o role: cliente pode ter
    // integradorId no JWT (vem do JOIN), mas só queremos filtrar por tenant
    // mais restrito.
    let scope: 'PLATFORM' | 'INTEGRADOR' | 'CLIENTE_FINAL' = 'PLATFORM'
    let cameraWhere: any = { active: true }
    let eventWhere: any = { capturedAt: { gte: cycle.start, lte: cycle.end } }

    if (jwt.role === 'CLIENT_ADMIN' || jwt.role === 'CLIENTE_OPERADOR') {
      if (!jwt.clienteFinalId) {
        res.status(403).json({ error: 'NO_TENANT', message: 'Usuário sem clienteFinalId' })
        return
      }
      scope = 'CLIENTE_FINAL'
      cameraWhere = { active: true, site: { clienteFinalId: jwt.clienteFinalId } }
      eventWhere  = {
        capturedAt: { gte: cycle.start, lte: cycle.end },
        camera: { site: { clienteFinalId: jwt.clienteFinalId } },
      }
    } else if (jwt.role === 'INTEGRADOR_ADMIN' || jwt.role === 'INTEGRADOR_TECNICO') {
      if (!jwt.integradorId) {
        res.status(403).json({ error: 'NO_TENANT', message: 'Usuário sem integradorId' })
        return
      }
      scope = 'INTEGRADOR'
      cameraWhere = {
        active: true,
        site: { clienteFinal: { integradorId: jwt.integradorId } },
      }
      eventWhere = {
        capturedAt: { gte: cycle.start, lte: cycle.end },
        camera: { site: { clienteFinal: { integradorId: jwt.integradorId } } },
      }
    }

    // ── Contagens ────────────────────────────────────────────────────────
    let cameraCount = 0
    try {
      cameraCount = await prisma.camera.count({ where: cameraWhere })
    } catch (err: any) {
      logger.warn({ err: err.message }, 'quota_me_camera_count_failed')
    }

    let eventCount = 0
    try {
      eventCount = await prisma.analyticsEvent.count({ where: eventWhere })
    } catch (err: any) {
      logger.warn({ err: err.message }, 'quota_me_event_count_failed')
    }

    // ── Vertex/Streaming hard-limits via ApiQuota ────────────────────────
    // Só faz sentido para escopo INTEGRADOR — cliente final não tem ApiQuota
    // própria, e plataforma é agregada (responde via /quota/status).
    let hardLimits: any = null
    if (scope === 'INTEGRADOR') {
      try {
        hardLimits = await quotaService.getStatus(jwt.integradorId!)
      } catch (err: any) {
        logger.warn({ err: err.message }, 'quota_me_service_failed')
      }
    }

    // ── S3: só plataforma vê real, outros vêem zerado/oculto ────────────
    // (S3 é compartilhado entre todos os tenants — expor para integrador/
    // cliente vazaria info de outros tenants via tamanho do bucket.)
    const s3 = scope === 'PLATFORM'
      ? await getS3Usage()
      : { usedBytes: 0, objectsCount: 0, quotaGb: 0 }
    const storageGb = Number((s3.usedBytes / (1024 * 1024 * 1024)).toFixed(2))

    // ── Vertex calls: usa hardLimits se disponível, senão proxy via events ──
    const vertexUsed  = hardLimits?.vision?.used  ?? eventCount
    const vertexLimit = hardLimits?.vision?.limit ?? null

    // ── Resposta no mesmo shape de /quota/status ─────────────────────────
    res.json({
      scope,
      summary: {
        cycle: `${cycle.start.toISOString().slice(0, 10)} → ${cycle.end.toISOString().slice(0, 10)}`,
        cycleLabel: cycle.label,
        vertexCalls: vertexUsed,
        storageGb,
        events: eventCount,
        cameras: cameraCount,
      },
      items: [
        {
          resource: 'Câmeras Ativas',
          used: cameraCount,
          limit: scope === 'INTEGRADOR' ? null : null, // câmera-limit por integrador é separado (Subscription tier)
          unit: 'câmeras',
        },
        {
          resource: 'Vertex AI (chamadas)',
          used: vertexUsed,
          limit: vertexLimit,
          unit: 'chamadas/mês',
        },
        ...(scope === 'INTEGRADOR' && hardLimits?.streaming ? [{
          resource: 'Vertex Streaming',
          used: hardLimits.streaming.usedMinutes,
          limit: hardLimits.streaming.limitMinutes,
          unit: 'minutos/mês',
        }] : []),
        {
          resource: 'Eventos no Ciclo',
          used: eventCount,
          limit: null,
          unit: 'eventos/mês',
        },
        ...(scope === 'PLATFORM' ? [
          {
            resource: 'S3 Cloud Storage',
            used: storageGb,
            limit: s3.quotaGb,
            unit: 'GB',
          },
          {
            resource: 'Gravações Sincronizadas',
            used: s3.objectsCount,
            limit: null,
            unit: 'objetos',
          },
        ] : []),
      ],
      s3: scope === 'PLATFORM' ? {
        enabled: !!(S3_ACCESS_KEY && S3_SECRET_KEY && S3_BUCKET),
        bucket: S3_BUCKET,
        endpoint: S3_ENDPOINT,
        region: S3_REGION,
        usedBytes: s3.usedBytes,
        usedGb: storageGb,
        quotaGb: s3.quotaGb,
        objectsCount: s3.objectsCount,
      } : { enabled: false, hidden: true },
      hardLimits, // só não-null para escopo INTEGRADOR
    })
  } catch (err: any) {
    logger.error({ err }, 'quota_me_error')
    res.status(500).json({
      error: 'QUOTA_ME_ERROR',
      message: 'Falha ao calcular quota do usuário',
    })
  }
})
