/**
 * go2rtc Service
 *
 * Gerencia streams no go2rtc via API HTTP.
 * Usado para registrar/remover streams RTMP push dinamicamente.
 */
import { logger } from '../lib/logger'

const GO2RTC_API = process.env.GO2RTC_API_URL ?? 'http://go2rtc:1984'

interface StreamInfo {
  producers: unknown[] | null
  consumers: unknown[] | null
}

export const go2rtcService = {
  /**
   * Registra um stream RTMP push no go2rtc.
   * O stream name deve corresponder ao path usado pelo encoder (ex: "cam2/live").
   */
  async registerStream(streamName: string): Promise<boolean> {
    try {
      // go2rtc API: PUT /api/streams com body { "streamName": { ... } }
      // Para RTMP push, o source pode ser null (aceita push externo)
      const response = await fetch(`${GO2RTC_API}/api/streams`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [streamName]: null }),
      })

      if (!response.ok) {
        const text = await response.text()
        logger.warn({ streamName, status: response.status, body: text }, 'go2rtc_register_stream_failed')
        return false
      }

      logger.info({ streamName }, 'go2rtc_stream_registered')
      return true
    } catch (err: any) {
      logger.error({ err: err.message, streamName }, 'go2rtc_register_stream_error')
      return false
    }
  },

  /**
   * Remove um stream do go2rtc.
   */
  async removeStream(streamName: string): Promise<boolean> {
    try {
      const response = await fetch(`${GO2RTC_API}/api/streams?src=${encodeURIComponent(streamName)}`, {
        method: 'DELETE',
      })

      if (!response.ok && response.status !== 404) {
        logger.warn({ streamName, status: response.status }, 'go2rtc_remove_stream_failed')
        return false
      }

      logger.info({ streamName }, 'go2rtc_stream_removed')
      return true
    } catch (err: any) {
      logger.error({ err: err.message, streamName }, 'go2rtc_remove_stream_error')
      return false
    }
  },

  /**
   * Lista todos os streams registrados.
   */
  async listStreams(): Promise<Record<string, StreamInfo> | null> {
    try {
      const response = await fetch(`${GO2RTC_API}/api/streams`)
      if (!response.ok) return null
      return await response.json()
    } catch (err: any) {
      logger.error({ err: err.message }, 'go2rtc_list_streams_error')
      return null
    }
  },

  /**
   * Verifica se um stream existe e está recebendo dados.
   */
  async getStreamStatus(streamName: string): Promise<{
    exists: boolean
    hasProducers: boolean
    hasConsumers: boolean
  }> {
    try {
      const response = await fetch(`${GO2RTC_API}/api/streams/${encodeURIComponent(streamName)}`)
      if (!response.ok) {
        return { exists: false, hasProducers: false, hasConsumers: false }
      }

      const data: StreamInfo = await response.json()
      return {
        exists: true,
        hasProducers: Array.isArray(data.producers) && data.producers.length > 0,
        hasConsumers: Array.isArray(data.consumers) && data.consumers.length > 0,
      }
    } catch {
      return { exists: false, hasProducers: false, hasConsumers: false }
    }
  },

  /**
   * Registra streams RTMP para uma câmera.
   * Registra tanto o streamKey quanto streamKey/live para compatibilidade.
   */
  async registerRtmpStreams(streamKey: string): Promise<boolean> {
    const streams = [
      streamKey,           // para rtmp://host:1935/streamKey
      `${streamKey}/live`, // para rtmp://host:1935/streamKey/live
    ]

    let success = true
    for (const name of streams) {
      const result = await this.registerStream(name)
      if (!result) success = false
    }

    return success
  },

  /**
   * Atualiza a config do go2rtc adicionando um stream.
   * Nota: Esta abordagem persiste na config do Docker, mas requer redeploy.
   * Prefira registerStream() para registro dinâmico via API.
   */
  async persistStreamToConfig(streamKey: string): Promise<void> {
    // Para persistir, precisamos atualizar o Docker config
    // Isso é feito externamente via deploy script
    logger.info({ streamKey }, 'go2rtc_stream_should_be_persisted_to_config')
  },
}
