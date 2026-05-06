/**
 * Middleware: bloqueia POST /cameras se integrador está em trial e atingiu
 * o limite (`trialMaxCameras`, default 5).
 *
 * SUPER_ADMIN bypass — pra suporte/debug poder cadastrar mais.
 *
 * Usage em routes/cameras.ts:
 *   cameraRouter.post('/', requireAuth, enforceTrialCameraLimit, ...)
 */
import type { Request, Response, NextFunction } from 'express'
import { resolveIntegradorId } from './tenant-context'
import { getTrialStatus } from '../services/trial.service'

export async function enforceTrialCameraLimit(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  const role = req.jwtPayload?.role
  if (role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL') {
    next()
    return
  }
  const integradorId = resolveIntegradorId(req)
  if (!integradorId) { next(); return }

  try {
    const status = await getTrialStatus(integradorId)
    if (!status.isTrial) { next(); return }
    if (!status.isActive) {
      res.status(403).json({
        error: 'trial_expired',
        message: `Seu período trial expirou em ${status.endsAt?.toISOString().slice(0, 10)}. Converta para um plano pago para continuar.`,
      })
      return
    }
    if (status.camerasUsed >= status.maxCameras) {
      res.status(403).json({
        error: 'trial_camera_limit_reached',
        limit: status.maxCameras, used: status.camerasUsed,
        daysRemaining: status.daysRemaining,
        message: `Limite de ${status.maxCameras} câmeras durante o trial. Converta para um plano pago para adicionar mais.`,
      })
      return
    }
    next()
  } catch (err) {
    // Fail-open: se o check falhar, deixa passar (não bloqueia operação por erro de cache)
    console.warn('[trial-camera-limit] check failed', err)
    next()
  }
}
