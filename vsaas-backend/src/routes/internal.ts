import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAiWorkerAuth } from '../middleware/ai-worker-auth'
import { asyncHandler } from '../middleware/async-handler'

export const internalRouter = Router()

internalRouter.get(
  '/cameras/ai-enabled',
  requireAiWorkerAuth,
  asyncHandler(async (_req, res) => {
    const cameras = await prisma.camera.findMany({
      where: { aiEnabled: true, active: true },
      select: {
        id: true,
        name: true,
        go2rtcStreamId: true,
        rtspMainUrl: true,
        rtspSubUrl: true,
        aiConfidenceMin: true,
      },
    })
    res.json({ cameras })
  }),
)
