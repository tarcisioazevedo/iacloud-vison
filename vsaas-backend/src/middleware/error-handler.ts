import { Request, Response, NextFunction } from 'express'
import * as Sentry from '@sentry/node'
import { AppError } from '../lib/errors'
import { logger } from '../lib/logger'

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path }, 'app_error')
      Sentry.captureException(err)
    }
    res.status(err.statusCode).json({
      error: err.code ?? 'ERROR',
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    })
    return
  }

  logger.error({ err, path: req.path }, 'unhandled_error')
  Sentry.captureException(err)
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Erro interno' })
}
