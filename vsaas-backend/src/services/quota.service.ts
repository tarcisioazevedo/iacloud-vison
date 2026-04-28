/**
 * Quota Service — proteção crítica de custos GCP.
 *
 * Antes de cada chamada à Cloud Vision API ou ativação de stream Vertex,
 * este serviço verifica se o integrador tem quota disponível.
 * Se não tiver e hardLimitEnabled=true, lança QuotaExceededError.
 */
import { prisma } from '../lib/prisma'
import { QuotaExceededError } from '../lib/errors'
import { logger } from '../lib/logger'

export class QuotaService {
  /**
   * Verifica + incrementa quota de Cloud Vision API.
   * Deve ser chamado ANTES de invocar a Vision API.
   */
  async checkAndIncrementVision(
    integradorId: string,
    callCount: number = 1,
  ): Promise<void> {
    const quota = await this._getQuota(integradorId)
    if (!quota) return // sem quota cadastrada = sem limite

    const after = quota.staticVisionUsedThisMonth + callCount

    if (quota.hardLimitEnabled && after > quota.staticVisionMonthlyLimit) {
      logger.warn({ integradorId, used: quota.staticVisionUsedThisMonth, limit: quota.staticVisionMonthlyLimit }, 'quota_hard_block_vision')
      throw new QuotaExceededError(integradorId)
    }

    // Emitir warning se passou threshold
    const pct = (after / quota.staticVisionMonthlyLimit) * 100
    if (pct >= quota.warningThreshold) {
      logger.warn({ integradorId, pct: pct.toFixed(1) }, 'quota_warning_vision')
      // TODO: disparar email via job assíncrono
    }

    await prisma.apiQuota.update({
      where: { id: quota.id },
      data: { staticVisionUsedThisMonth: { increment: callCount } },
    })
  }

  /**
   * Verifica + incrementa quota de Vertex AI Streaming (minutos).
   */
  async checkAndIncrementStreaming(
    integradorId: string,
    minutes: number,
  ): Promise<void> {
    const quota = await this._getQuota(integradorId)
    if (!quota) return

    const after = quota.streamingMinutesUsed + minutes

    if (quota.hardLimitEnabled && after > quota.streamingMinutesLimit) {
      logger.warn({ integradorId }, 'quota_hard_block_streaming')
      throw new QuotaExceededError(integradorId)
    }

    await prisma.apiQuota.update({
      where: { id: quota.id },
      data: { streamingMinutesUsed: { increment: minutes } },
    })
  }

  async getStatus(integradorId: string) {
    const quota = await this._getQuota(integradorId)
    if (!quota) return null

    return {
      vision: {
        used: quota.staticVisionUsedThisMonth,
        limit: quota.staticVisionMonthlyLimit,
        pct: Math.round((quota.staticVisionUsedThisMonth / quota.staticVisionMonthlyLimit) * 100),
        blocked: quota.staticVisionUsedThisMonth >= quota.staticVisionMonthlyLimit,
      },
      streaming: {
        usedMinutes: quota.streamingMinutesUsed,
        limitMinutes: quota.streamingMinutesLimit,
        pct: Math.round((quota.streamingMinutesUsed / quota.streamingMinutesLimit) * 100),
        blocked: quota.streamingMinutesUsed >= quota.streamingMinutesLimit,
      },
      periodEnd: quota.periodEnd,
    }
  }

  private async _getQuota(integradorId: string) {
    const now = new Date()
    return prisma.apiQuota.findFirst({
      where: {
        integradorId,
        periodStart: { lte: now },
        periodEnd: { gte: now },
      },
    })
  }
}

export const quotaService = new QuotaService()
