/**
 * Sprint E.2 — MQTT padronizado (mirror da hierarquia Frigate).
 *
 * Hierarquia de tópicos `iacv/<integradorId>/<entity>/<id>/<event>`:
 *
 *   iacv/<int>/available                        retain  online|offline
 *   iacv/<int>/cameras/<cam>/state              retain  active|inactive|error
 *   iacv/<int>/cameras/<cam>/snapshot                   {url, ts}
 *   iacv/<int>/cameras/<cam>/events/<eventId>           full review item
 *   iacv/<int>/cameras/<cam>/objects/<class>/active     count int
 *   iacv/<int>/cameras/<cam>/objects/<class>/score      float
 *   iacv/<int>/cameras/<cam>/motion                     1|0
 *   iacv/<int>/cameras/<cam>/audio/<class>              1|0
 *   iacv/<int>/cameras/<cam>/face/<identity>            1
 *   iacv/<int>/cameras/<cam>/plate/<plate>              1
 *   iacv/<int>/cameras/<cam>/ptz/move                   command (sub)
 *   iacv/<int>/cameras/<cam>/recordings/state           on|off
 *   iacv/<int>/cameras/<cam>/siren                      0|1
 *   iacv/<int>/cameras/<cam>/notifications/state        on|off
 *   iacv/<int>/edge/<node>/state                retain  online|offline
 *   iacv/<int>/edge/<node>/heartbeat                    cpu/mem/temp
 *   iacv/<int>/triggers/<triggerId>/hit                 score, cameraId, ts
 *   iacv/<int>/quota/usage                              monthly snapshot
 *
 * Estratégia: dynamic import do `mqtt`. Sem lib instalada → modo NOOP (logs).
 * Para single-broker compartilhado, usar IACV_MQTT_BROKER_URL global.
 * Para per-tenant (futuro), trocar por per-integrador config.
 */
import { logger } from './logger'

interface MqttClient {
  publish(topic: string, payload: string, opts?: { qos?: 0 | 1 | 2; retain?: boolean }): void
  end(): void
  connected: boolean
}

let _client: MqttClient | null = null
let _attempted = false
let _enabled = false

async function ensureClient(): Promise<MqttClient | null> {
  if (_client?.connected) return _client
  if (_attempted) return _client
  _attempted = true

  const url = process.env.IACV_MQTT_BROKER_URL?.trim()
  if (!url) {
    logger.info('mqtt: IACV_MQTT_BROKER_URL ausente — publisher em modo NOOP')
    return null
  }

  try {
    // Dynamic import via eval para evitar resolução TS em compile-time.
    const dynamicImport: (mod: string) => Promise<any> =
      // eslint-disable-next-line no-new-func
      new Function('mod', 'return import(mod)') as any
    const mod = await dynamicImport('mqtt').catch(() => null)
    const mqttLib = mod ? (mod.default ?? mod) : null
    if (!mqttLib) {
      logger.warn('mqtt lib não instalada — `npm i mqtt` para ativar. Modo NOOP.')
      return null
    }

    const c = mqttLib.connect(url, {
      username: process.env.IACV_MQTT_USERNAME,
      password: process.env.IACV_MQTT_PASSWORD,
      clientId: process.env.IACV_MQTT_CLIENT_ID ?? `iacv-backend-${process.pid}`,
      reconnectPeriod: 5000,
      will: {
        topic: `iacv/backend/${process.pid}/state`,
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    })

    c.on('connect', () => { _enabled = true; logger.info({ url }, 'mqtt_connected') })
    c.on('error', (err: any) => logger.warn({ err: err?.message }, 'mqtt_error'))
    c.on('offline', () => { _enabled = false })

    _client = c as MqttClient
    return _client
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'mqtt_init_failed')
    return null
  }
}

export interface PublishOpts {
  qos?: 0 | 1 | 2
  retain?: boolean
}

/**
 * Publica em `iacv/<integradorId>/...subTopic` com payload JSON-stringified.
 * Em NOOP mode, apenas loga em debug — não bloqueia o caller.
 */
export async function publish(
  integradorId: string,
  subTopic: string,
  payload: unknown,
  opts: PublishOpts = {},
): Promise<void> {
  const topic = `iacv/${integradorId}/${subTopic.replace(/^\/+/, '')}`
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)

  const client = await ensureClient()
  if (!client || !client.connected) {
    logger.debug({ topic, payload }, 'mqtt_noop_publish')
    return
  }
  try {
    client.publish(topic, body, { qos: opts.qos ?? 0, retain: opts.retain ?? false })
  } catch (err) {
    logger.warn({ err: (err as Error).message, topic }, 'mqtt_publish_failed')
  }
}

export function isConnected(): boolean {
  return _enabled
}

/** Para testes / shutdown gracioso. */
export function close(): void {
  if (_client) {
    try { _client.end() } catch { /* ignore */ }
    _client = null
    _enabled = false
    _attempted = false
  }
}
