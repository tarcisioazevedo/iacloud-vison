/**
 * Camera Log Service — persistência estruturada de logs operacionais
 * estilo Frigate. Emite para DB + pino logger simultaneamente.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'
export type LogSource =
  | 'FFMPEG' | 'DETECTOR' | 'MOTION' | 'RECORDER' | 'SNAPSHOT'
  | 'ZONE' | 'ONVIF' | 'PTZ' | 'AUDIO' | 'FACE' | 'LPR' | 'GENAI'
  | 'SEMANTIC' | 'SYSTEM' | 'EDGE_AGENT' | 'VERTEX' | 'CLOUD_VISION'
  | 'GCS' | 'AUTH' | 'API'

export interface CameraLogInput {
  cameraId: string
  level: LogLevel
  source: LogSource
  message: string
  details?: Record<string, unknown>
  correlationId?: string
  durationMs?: number
  errorCode?: string
  stackTrace?: string
  eventId?: string
  zoneId?: string
}

export interface SystemLogInput {
  level: LogLevel
  source: LogSource
  message: string
  details?: Record<string, unknown>
  integradorId?: string
  clienteFinalId?: string
  siteId?: string
  edgeNodeId?: string
  userId?: string
  correlationId?: string
  requestId?: string
  method?: string
  path?: string
  statusCode?: number
  durationMs?: number
  ipAddress?: string
  userAgent?: string
  errorCode?: string
  stackTrace?: string
}

class CameraLogService {
  async logCamera(input: CameraLogInput) {
    try {
      await prisma.cameraLog.create({
        data: {
          cameraId:      input.cameraId,
          level:         input.level,
          source:        input.source,
          message:       input.message,
          detailsJson:   input.details as any ?? undefined,
          correlationId: input.correlationId ?? null,
          durationMs:    input.durationMs ?? null,
          errorCode:     input.errorCode ?? null,
          stackTrace:    input.stackTrace ?? null,
          eventId:       input.eventId ?? null,
          zoneId:        input.zoneId ?? null,
        },
      })
    } catch (err) {
      logger.error({ err, input }, 'camera_log_persist_failed')
    }
    const pinoFn = input.level === 'FATAL' ? logger.fatal
      : input.level === 'ERROR' ? logger.error
      : input.level === 'WARN'  ? logger.warn
      : input.level === 'INFO'  ? logger.info
      : logger.debug
    pinoFn.call(logger, {
      cameraId: input.cameraId, source: input.source, ...input.details,
    }, input.message)
  }

  async logSystem(input: SystemLogInput) {
    try {
      await prisma.systemLog.create({
        data: {
          level:          input.level,
          source:         input.source,
          message:        input.message,
          detailsJson:    input.details as any ?? undefined,
          integradorId:   input.integradorId ?? null,
          clienteFinalId: input.clienteFinalId ?? null,
          siteId:         input.siteId ?? null,
          edgeNodeId:     input.edgeNodeId ?? null,
          userId:         input.userId ?? null,
          correlationId:  input.correlationId ?? null,
          requestId:      input.requestId ?? null,
          method:         input.method ?? null,
          path:           input.path ?? null,
          statusCode:     input.statusCode ?? null,
          durationMs:     input.durationMs ?? null,
          ipAddress:      input.ipAddress ?? null,
          userAgent:      input.userAgent ?? null,
          errorCode:      input.errorCode ?? null,
          stackTrace:     input.stackTrace ?? null,
        },
      })
    } catch (err) {
      logger.error({ err, input }, 'system_log_persist_failed')
    }
  }

  // Atalhos
  info(cameraId: string, source: LogSource, message: string, details?: Record<string, unknown>) {
    return this.logCamera({ cameraId, level: 'INFO', source, message, details })
  }
  warn(cameraId: string, source: LogSource, message: string, details?: Record<string, unknown>) {
    return this.logCamera({ cameraId, level: 'WARN', source, message, details })
  }
  error(cameraId: string, source: LogSource, message: string, details?: Record<string, unknown>, errorCode?: string) {
    return this.logCamera({ cameraId, level: 'ERROR', source, message, details, errorCode })
  }
  debug(cameraId: string, source: LogSource, message: string, details?: Record<string, unknown>) {
    return this.logCamera({ cameraId, level: 'DEBUG', source, message, details })
  }
}

export const cameraLogService = new CameraLogService()
