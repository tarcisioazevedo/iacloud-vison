import { Request, Response, NextFunction } from 'express'
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
    }
    res.status(err.statusCode).json({
      error: err.code ?? 'ERROR',
      message: err.message,
    })
    return
  }

  logger.error({ err, path: req.path }, 'unhandled_error')
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Erro interno' })
}
