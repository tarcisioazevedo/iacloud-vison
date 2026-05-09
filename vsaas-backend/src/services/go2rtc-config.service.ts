/**
 * go2rtc Config Service
 *
 * Atualiza dinamicamente o Docker Config do go2rtc quando câmeras RTMP_PUSH
 * são criadas ou removidas. Usa Docker CLI via socket montado.
 *
 * Por que não usar PUT /api/streams:
 *   go2rtc 1.9.x evicta imediatamente streams registrados via API quando
 *   o source RTSP falha a conexão. Apenas entradas no YAML config (Docker Config)
 *   sobrevivem indefinidamente. O script update-go2rtc-config.sh faz o ciclo:
 *   ler YAML atual → adicionar stream key → criar novo Docker Config → update service.
 */
import { execFile } from 'node:child_process'
import { logger } from '../lib/logger'

const SCRIPT_PATH = process.env.GO2RTC_UPDATE_SCRIPT ?? '/app/scripts/update-go2rtc-config.sh'
const DOCKER_SOCK = '/var/run/docker.sock'
const ENABLED = process.env.GO2RTC_YAML_SYNC !== 'false'

let pending = false

/**
 * Dispara atualização do go2rtc YAML config em background.
 * Debounce simples: se já há uma rodando, ignora (ela vai pegar o estado atual do DB).
 */
export function scheduleGo2rtcConfigSync(): void {
  if (!ENABLED) return
  if (pending) return
  pending = true

  // Delay de 3s para agrupar criações em lote (CSV import etc.)
  setTimeout(async () => {
    pending = false
    try {
      await runUpdateScript()
    } catch (err: any) {
      logger.warn({ err: err.message }, 'go2rtc_config_sync_failed')
    }
  }, 3000)
}

function runUpdateScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Verifica se Docker socket está disponível
    const fs = require('node:fs')
    if (!fs.existsSync(DOCKER_SOCK)) {
      logger.debug('go2rtc_config_sync_skipped_no_docker_sock')
      resolve()
      return
    }

    logger.info('go2rtc_config_sync_starting')
    execFile('bash', [SCRIPT_PATH], { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        logger.warn({ err: err.message, stderr }, 'go2rtc_config_sync_error')
        reject(err)
        return
      }
      const lines = stdout.trim().split('\n').filter(Boolean)
      logger.info({ output: lines }, 'go2rtc_config_sync_done')
      resolve()
    })
  })
}
