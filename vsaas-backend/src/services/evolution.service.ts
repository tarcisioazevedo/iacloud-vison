/**
 * Evolution API service — cliente HTTP para a API WhatsApp Evolution v2.
 *
 * Portado e adaptado de VSaaS Access para o contexto multi-tenant
 * do iacloud-vison (Integrador-scoped, não School-scoped).
 *
 * Lazy-initialized: o axios instance é criado na primeira chamada,
 * garantindo que EVOLUTION_API_URL e EVOLUTION_API_KEY estejam carregados.
 */

import axios, { AxiosInstance } from 'axios'
import { logger } from '../lib/logger'

// ── Config ────────────────────────────────────────────────────────────────────

function getEvolutionUrl(): string {
  return (process.env.EVOLUTION_API_URL ?? 'http://icv_evolution:8080').replace(/\/$/, '')
}

function getEvolutionKey(): string {
  return process.env.EVOLUTION_API_KEY ?? ''
}

let _client: AxiosInstance | null = null

function client(): AxiosInstance {
  if (!_client) {
    _client = axios.create({
      baseURL: getEvolutionUrl(),
      headers: {
        'Content-Type': 'application/json',
        apikey: getEvolutionKey(),
      },
      timeout: 15_000,
    })
  }
  return _client
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EvolutionInstanceSnapshot {
  instanceName: string
  instanceId:   string | null
  connectionState: string   // open | connecting | close
  phoneNumber:  string | null
  profileName:  string | null
}

export interface EvolutionConnectPayload {
  pairingCode:    string | null
  qrCodePayload:  string | null   // base64 data URL ou string raw
  count:          number
  raw:            unknown
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extrai QR code de qualquer formato de resposta que a Evolution retorna */
function extractQrPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>

  // Formato 1: { base64: 'data:image/png;base64,...' }
  if (typeof d['base64'] === 'string' && d['base64'].length > 10) return d['base64']

  // Formato 2: { qrcode: { base64: '...' } }
  if (d['qrcode'] && typeof d['qrcode'] === 'object') {
    const qr = d['qrcode'] as Record<string, unknown>
    if (typeof qr['base64'] === 'string' && qr['base64'].length > 10) return qr['base64']
    if (typeof qr['code']   === 'string' && qr['code'].length > 10)   return qr['code']
  }

  // Formato 3: { qrcode: '2@abc...' }
  if (typeof d['qrcode'] === 'string' && d['qrcode'].length > 10) return d['qrcode']

  // Formato 4: { response: { qrcode: { base64: '...' } } }
  if (d['response'] && typeof d['response'] === 'object') {
    const inner = extractQrPayload(d['response'])
    if (inner) return inner
  }

  // Formato 5: { code: '...' }
  if (typeof d['code'] === 'string' && d['code'].length > 10) return d['code']

  return null
}

function extractPairingCode(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (typeof d['pairingCode'] === 'string' && d['pairingCode'].length > 0) return d['pairingCode']
  if (d['qrcode'] && typeof d['qrcode'] === 'object') {
    const qr = d['qrcode'] as Record<string, unknown>
    if (typeof qr['pairingCode'] === 'string') return qr['pairingCode']
  }
  return null
}

/** Normaliza telefone para formato Evolution (55 + DDD + número, sem +) */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return ''
  return digits.startsWith('55') ? digits : `55${digits}`
}

/**
 * Gera nome de instância único para o tenant (ClienteFinal).
 * Formato: icv-{slug}-{id8}
 * onde {slug} é o nome sanitizado e {id8} são os primeiros 8 chars do UUID do ClienteFinal.
 */
export function buildInstanceName(opts: {
  name: string
  id:   string
}): string {
  const slug = opts.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20) || 'tenant'
  const id8 = opts.id.replace(/-/g, '').slice(0, 8)
  return `icv-${slug}-${id8}`
}

// ── Core API calls ────────────────────────────────────────────────────────────

/** Cria uma nova instância no Evolution API */
export async function createInstance(instanceName: string): Promise<EvolutionInstanceSnapshot | null> {
  try {
    const { data } = await client().post('/instance/create', {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    })
    logger.info({ instanceName }, 'evolution.create_instance')

    return {
      instanceName,
      instanceId:      data?.instance?.instanceId ?? data?.instanceId ?? null,
      connectionState: data?.instance?.status     ?? 'connecting',
      phoneNumber:     null,
      profileName:     null,
    }
  } catch (err: unknown) {
    logger.warn({ err, instanceName }, 'evolution.create_instance_failed')
    return null
  }
}

/** Conecta instância e obtém QR Code / Pairing Code */
export async function connectInstance(
  instanceName: string,
  phoneNumber?: string | null,
): Promise<EvolutionConnectPayload> {
  try {
    const params = phoneNumber ? { number: normalizePhone(phoneNumber) } : {}
    const { data } = await client().get(`/instance/connect/${instanceName}`, { params })

    const qrCodePayload = extractQrPayload(data)
    const pairingCode   = extractPairingCode(data) ?? extractPairingCode(data?.qrcode)
    const count         = (data as Record<string, unknown>)['count'] as number ?? 0

    return { pairingCode: pairingCode ?? null, qrCodePayload: qrCodePayload ?? null, count, raw: data }
  } catch (err: unknown) {
    logger.warn({ err, instanceName }, 'evolution.connect_instance_failed')
    return { pairingCode: null, qrCodePayload: null, count: 0, raw: null }
  }
}

/** Busca estado atual da instância.
 *  Evolution v2 mudou os campos do response:
 *   - Top-level "name" (antes "instanceName")
 *   - Top-level "id"   (antes "instanceId")
 *   - "connectionStatus" no nível raiz
 *  Mantém compatibilidade com formato v1 (nested em .instance).
 */
export async function fetchInstance(instanceName: string): Promise<EvolutionInstanceSnapshot | null> {
  try {
    const { data } = await client().get('/instance/fetchInstances', {
      params: { instanceName },
    })

    const arr = Array.isArray(data) ? data : [data]
    const inst = arr.find((i: Record<string, any>) => {
      const candidates = [
        i?.name,                       // v2 (Evolution 2.x)
        i?.instanceName,               // v1 legacy
        i?.instance?.instanceName,     // v1 legacy nested
        i?.instance?.name,             // v2 nested (raro)
      ]
      return candidates.includes(instanceName)
    })
    if (!inst) {
      logger.warn({ instanceName, available: arr.map((i: any) => i?.name ?? i?.instanceName) }, 'evolution.instance_not_in_response')
      return null
    }

    const state = inst['connectionStatus']
                ?? inst['state']
                ?? inst['instance']?.['status']
                ?? inst['instance']?.['state']
                ?? 'close'
    const phone = (inst['ownerJid'] ?? inst['instance']?.['ownerJid']) as string | undefined
    const cleaned = phone ? phone.replace('@s.whatsapp.net', '').replace(/@.*/, '') : null
    const profileName = (inst['profileName'] ?? inst['instance']?.['profileName']) as string | null

    return {
      instanceName,
      instanceId:      (inst['id'] ?? inst['instanceId'] ?? inst['instance']?.['instanceId']) as string ?? null,
      connectionState: state as string,
      phoneNumber:     cleaned,
      profileName,
    }
  } catch (err: unknown) {
    logger.warn({ err, instanceName }, 'evolution.fetch_instance_failed')
    return null
  }
}

/** Obtém connectionState direto (mais leve que fetchInstance) */
export async function getConnectionState(instanceName: string): Promise<string | null> {
  try {
    const { data } = await client().get(`/instance/connectionState/${instanceName}`)
    return (data?.instance?.state ?? data?.state ?? null) as string | null
  } catch {
    return null
  }
}

/** Sincroniza: fetch + atualiza estado. Retorna null se instância não existe. */
export async function syncInstance(instanceName: string): Promise<EvolutionInstanceSnapshot | null> {
  const snapshot = await fetchInstance(instanceName)
  if (!snapshot) return null
  const state = await getConnectionState(instanceName)
  if (state) snapshot.connectionState = state
  return snapshot
}

/** Logout da instância (desconecta WhatsApp sem apagar) */
export async function logoutInstance(instanceName: string): Promise<void> {
  try {
    await client().delete(`/instance/logout/${instanceName}`)
    logger.info({ instanceName }, 'evolution.logout')
  } catch (err: unknown) {
    logger.warn({ err, instanceName }, 'evolution.logout_failed')
  }
}

/** Remove instância completamente do Evolution */
export async function deleteInstance(instanceName: string): Promise<void> {
  try {
    await client().delete(`/instance/delete/${instanceName}`)
    logger.info({ instanceName }, 'evolution.delete')
  } catch (err: unknown) {
    logger.warn({ err, instanceName }, 'evolution.delete_failed')
  }
}

/** Restart = delete + create + connect */
export async function restartInstance(instanceName: string): Promise<{
  snapshot: EvolutionInstanceSnapshot | null
  connect:  EvolutionConnectPayload
}> {
  logger.info({ instanceName }, 'evolution.restart')
  await deleteInstance(instanceName)
  const snapshot = await createInstance(instanceName)
  const connect  = await connectInstance(instanceName)
  return { snapshot, connect }
}

/** Envia mensagem de texto */
export async function sendText(
  instanceName: string,
  phoneNumber:  string,
  text:         string,
): Promise<unknown> {
  // Evolution v2.2.3: payload é { number, text } — sem wrapper textMessage
  const { data } = await client().post(`/message/sendText/${instanceName}`, {
    number: normalizePhone(phoneNumber),
    text,
  })
  logger.info({ instanceName, phoneNumber }, 'evolution.send_text')
  return data
}

/**
 * Envia mídia (imagem) com legenda — formato Evolution API v2.2.3.
 * `media` aceita URL público OU base64 (sem prefixo `data:`).
 */
export async function sendMedia(
  instanceName: string,
  phoneNumber:  string,
  media:        string,           // URL público OU base64 raw
  caption?:     string,
  opts?:        { mimetype?: string; fileName?: string },
): Promise<unknown> {
  const { data } = await client().post(`/message/sendMedia/${instanceName}`, {
    number:    normalizePhone(phoneNumber),
    mediatype: 'image',
    mimetype:  opts?.mimetype ?? 'image/jpeg',
    media,
    caption:   caption ?? '',
    fileName:  opts?.fileName ?? `alerta-${Date.now()}.jpg`,
  })
  logger.info({ instanceName, phoneNumber }, 'evolution.send_media')
  return data
}
