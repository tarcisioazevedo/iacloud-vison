/**
 * Edge Connection Log Service
 *
 * Central de diagnóstico para suporte — registra todos os eventos de conexão
 * entre Edge Boxes e o Cloud (activate, heartbeat, tunnel, config pull, etc.)
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

export type EdgeEventType =
  | 'ACTIVATE'
  | 'HEARTBEAT'
  | 'TUNNEL_PROVISION'
  | 'TUNNEL_CONNECT'
  | 'TUNNEL_DISCONNECT'
  | 'CONFIG_PULL'
  | 'CAMERAS_SYNC'
  | 'COMMAND_ACK'
  | 'HARDWARE_INVENTORY'
  | 'TELEMETRY_BATCH'
  | 'EVENT_INGEST'
  | 'MODULE_DRIFT'  // Item 2.13 docs/08 — Box reporta enforcedModules ≠ tenant

export type EdgeEventStatus = 'SUCCESS' | 'FAILED' | 'PENDING'

export interface LogEdgeEventParams {
  edgeNodeId: string
  eventType: EdgeEventType
  status: EdgeEventStatus
  ipAddress?: string
  userAgent?: string
  errorCode?: string
  errorMessage?: string
  payload?: Record<string, unknown>
  durationMs?: number
}

function sanitizePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!payload) return undefined

  const sanitized = { ...payload }

  const sensitiveKeys = [
    'licenseKey', 'apiToken', 'token', 'password', 'secret',
    'tunnelToken', 'accessKeyId', 'secretAccessKey', 'credential',
    'authorization', 'auth', 'key', 'privateKey', 'encryptionKey',
  ]

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase()
    if (sensitiveKeys.some(sk => lowerKey.includes(sk.toLowerCase()))) {
      sanitized[key] = '[REDACTED]'
    }
  }

  return sanitized
}

export const edgeConnectionLogService = {
  async log(params: LogEdgeEventParams): Promise<string | null> {
    try {
      const record = await prisma.edgeConnectionLog.create({
        data: {
          edgeNodeId: params.edgeNodeId,
          eventType: params.eventType,
          status: params.status,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          errorCode: params.errorCode,
          errorMessage: params.errorMessage?.slice(0, 2000),
          payload: sanitizePayload(params.payload) as any,
          durationMs: params.durationMs,
        },
      })

      if (params.status === 'FAILED') {
        logger.warn({
          logId: record.id,
          edgeNodeId: params.edgeNodeId,
          eventType: params.eventType,
          errorCode: params.errorCode,
        }, 'edge_connection_event_failed')
      }

      return record.id
    } catch (err: any) {
      logger.error({ err: err.message, params }, 'edge_connection_log_persist_error')
      return null
    }
  },

  async logSuccess(
    edgeNodeId: string,
    eventType: EdgeEventType,
    options?: {
      ipAddress?: string
      userAgent?: string
      payload?: Record<string, unknown>
      durationMs?: number
    }
  ): Promise<string | null> {
    return this.log({
      edgeNodeId,
      eventType,
      status: 'SUCCESS',
      ...options,
    })
  },

  async logFailure(
    edgeNodeId: string,
    eventType: EdgeEventType,
    errorCode: string,
    errorMessage: string,
    options?: {
      ipAddress?: string
      userAgent?: string
      payload?: Record<string, unknown>
      durationMs?: number
    }
  ): Promise<string | null> {
    return this.log({
      edgeNodeId,
      eventType,
      status: 'FAILED',
      errorCode,
      errorMessage,
      ...options,
    })
  },

  async getLogsForEdgeNode(
    edgeNodeId: string,
    options?: {
      limit?: number
      offset?: number
      eventType?: EdgeEventType
      status?: EdgeEventStatus
      startDate?: Date
      endDate?: Date
    }
  ) {
    const where: any = { edgeNodeId }

    if (options?.eventType) where.eventType = options.eventType
    if (options?.status) where.status = options.status
    if (options?.startDate || options?.endDate) {
      where.createdAt = {}
      if (options?.startDate) where.createdAt.gte = options.startDate
      if (options?.endDate) where.createdAt.lte = options.endDate
    }

    const [logs, total] = await Promise.all([
      prisma.edgeConnectionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: options?.limit ?? 50,
        skip: options?.offset ?? 0,
      }),
      prisma.edgeConnectionLog.count({ where }),
    ])

    return { logs, total }
  },

  async getConnectionStats(edgeNodeId: string, hours: number = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    const stats = await prisma.edgeConnectionLog.groupBy({
      by: ['eventType', 'status'],
      where: {
        edgeNodeId,
        createdAt: { gte: since },
      },
      _count: true,
    })

    const lastHeartbeat = await prisma.edgeConnectionLog.findFirst({
      where: { edgeNodeId, eventType: 'HEARTBEAT', status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })

    const lastActivate = await prisma.edgeConnectionLog.findFirst({
      where: { edgeNodeId, eventType: 'ACTIVATE', status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })

    const recentFailures = await prisma.edgeConnectionLog.count({
      where: {
        edgeNodeId,
        status: 'FAILED',
        createdAt: { gte: since },
      },
    })

    const consecutiveFailures = await this.getConsecutiveFailures(edgeNodeId)

    return {
      periodHours: hours,
      stats: stats.map(s => ({
        eventType: s.eventType,
        status: s.status,
        count: s._count,
      })),
      lastHeartbeatAt: lastHeartbeat?.createdAt ?? null,
      lastActivateAt: lastActivate?.createdAt ?? null,
      recentFailures,
      consecutiveFailures,
      healthStatus: consecutiveFailures >= 5 ? 'CRITICAL' :
                    consecutiveFailures >= 3 ? 'WARNING' : 'HEALTHY',
    }
  },

  async getConsecutiveFailures(edgeNodeId: string): Promise<number> {
    const recentLogs = await prisma.edgeConnectionLog.findMany({
      where: { edgeNodeId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { status: true },
    })

    let count = 0
    for (const log of recentLogs) {
      if (log.status === 'FAILED') count++
      else break
    }
    return count
  },

  async cleanup(retentionDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

    const result = await prisma.edgeConnectionLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })

    logger.info({ deleted: result.count, retentionDays }, 'edge_connection_logs_cleaned_up')
    return result.count
  },
}
