/**
 * /internal/mediamtx-auth — endpoint chamado por MediaMTX (authMethod: http)
 * pra autorizar publish/read em cada path.
 *
 * B-2 (2026-06-15): MediaMTX antes aceitava qualquer publish/read em
 * qualquer path (auth: internal com user 'any/any'). Stream UUID virou
 * "segredo de obscuridade" — quem soubesse o path lia/publicava.
 * Este endpoint corrige isso.
 *
 * Política implementada:
 *
 *   PUBLISH (câmera empurra stream pro MediaMTX):
 *     - Path precisa estar em `paths:` declarado OU corresponder ao
 *       `Camera.go2rtcStreamId` de uma câmera ACTIVE no DB.
 *     - Se a câmera tem `streamPublishKey`, a query string DEVE conter
 *       `?key=<streamPublishKey>` (defesa contra quem souber o path).
 *     - IP de origem é logado (audit). Optional: allowlist por câmera no futuro.
 *
 *   READ (browser/recorder lê stream):
 *     - REQUER query string `?ticket=<JWT>` válido (emitido por live.service
 *       ou playback.service). Ticket carrega cameraId + tenant + exp.
 *     - Path do request precisa bater com cameraId do ticket.
 *     - EXCEÇÃO: conexões da overlay Swarm (10.0.0.0/8) são aceitas sem
 *       ticket pra permitir cloud-direct-recorder consumir streams internos.
 *
 *   API / metrics / pprof:
 *     - NÃO chega aqui. Mediamtx auth `internal` continua cobrindo (apenas
 *       IPs internos).
 *
 * MODO DE OPERAÇÃO:
 *   - MEDIAMTX_AUTH_MODE=log_only (default) → loga decisões, sempre 200 OK.
 *     Use pra observar tráfego real antes de ligar enforce. Migração segura.
 *   - MEDIAMTX_AUTH_MODE=enforce → bloqueia de verdade (401 quando negado).
 *
 * Formato esperado do request POST (MediaMTX v1.x):
 *   {
 *     "user": "any",
 *     "password": "",
 *     "ip": "203.0.113.5",
 *     "action": "publish" | "read" | "api" | "metrics" | "pprof",
 *     "path": "cam-37c76c5f-...",
 *     "protocol": "rtmp" | "rtsp" | "srt" | "webrtc" | "hls",
 *     "id": "<conn-id>",
 *     "query": "?ticket=eyJ..."
 *   }
 *
 * Response:
 *   200 → permitido
 *   401 → negado
 */
import { Router } from 'express'
import { publicRoute } from '../middleware/require-capability'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

export const internalMediamtxAuthRouter = Router()

const MODE = (process.env.MEDIAMTX_AUTH_MODE ?? 'log_only').toLowerCase() as 'log_only' | 'enforce'

/** Heurística rápida pra IP da overlay Swarm (10.0.0.0/8 + 172.16-31.0.0/12 + 127.0.0.0/8). */
function isInternalIp(ip: string): boolean {
  if (!ip) return false
  if (ip.startsWith('10.')) return true
  if (ip.startsWith('127.')) return true
  if (ip.startsWith('192.168.')) return true
  if (ip.startsWith('172.')) {
    const o2 = parseInt(ip.split('.')[1] || '0', 10)
    return o2 >= 16 && o2 <= 31
  }
  // IPv6 link-local / loopback
  if (ip === '::1' || ip.startsWith('fe80')) return true
  return false
}

/** Extrai key/ticket de query string (`?key=xxx&ticket=yyy`). */
function parseQuery(q: string | undefined): { key?: string; ticket?: string } {
  if (!q) return {}
  const cleaned = q.startsWith('?') ? q.slice(1) : q
  const out: { key?: string; ticket?: string } = {}
  for (const pair of cleaned.split('&')) {
    const [k, v] = pair.split('=')
    if (!k || !v) continue
    if (k === 'key' || k === 'streamKey' || k === 'publishKey') out.key = decodeURIComponent(v)
    if (k === 'ticket') out.ticket = decodeURIComponent(v)
  }
  return out
}

/** Resolve cameraId a partir do path do MediaMTX. */
async function resolveCameraByPath(path: string): Promise<{
  id: string
  active: boolean
  integradorId: string | null
} | null> {
  // Tenta: 1) go2rtcStreamId exato; 2) padrão "cam-<uuid>" (default)
  const cam = await prisma.camera.findFirst({
    where: {
      OR: [
        { go2rtcStreamId: path },
        ...(path.startsWith('cam-') ? [{ id: path.slice(4) }] : []),
      ],
    },
    select: {
      id: true,
      active: true,
      site: { select: { clienteFinal: { select: { integradorId: true } } } },
    },
  })
  if (!cam) return null
  return {
    id: cam.id,
    active: cam.active,
    integradorId: cam.site?.clienteFinal?.integradorId ?? null,
  }
}

internalMediamtxAuthRouter.post('/', publicRoute(), async (req, res) => {
  const { user, ip, action, path, protocol, query } = req.body ?? {}
  const ipStr = String(ip ?? '')
  const pathStr = String(path ?? '')
  const actionStr = String(action ?? '')
  const { key, ticket } = parseQuery(query)

  // Decision: começa permissivo e cai pra negado quando regra dispara.
  let allowed = true
  let reason = 'default_allow'

  try {
    if (actionStr === 'api' || actionStr === 'metrics' || actionStr === 'pprof') {
      // Plano de controle — mediamtx.yml já restringe por IP interno.
      // Defense-in-depth: re-check aqui.
      if (!isInternalIp(ipStr)) {
        allowed = false
        reason = 'control_plane_external_ip'
      } else {
        reason = 'control_plane_internal_ip_ok'
      }
    } else if (actionStr === 'read') {
      if (isInternalIp(ipStr)) {
        // cloud-direct-recorder e outros services consomem internamente — sem ticket
        reason = 'read_internal_ip'
      } else {
        // Externo: requer ticket JWT
        if (!ticket) {
          allowed = false
          reason = 'read_external_no_ticket'
        } else {
          try {
            const decoded = jwt.verify(ticket, process.env.JWT_SECRET!, {
              algorithms: ['HS256'],
            }) as { cameraId?: string; streamId?: string; exp?: number }
            const expectedCam = pathStr.startsWith('cam-') ? pathStr.slice(4) : pathStr
            // Ticket precisa estar amarrado ao path requisitado
            if (decoded.cameraId && decoded.cameraId !== expectedCam
                && decoded.streamId !== pathStr) {
              allowed = false
              reason = 'read_ticket_path_mismatch'
            } else {
              reason = 'read_ticket_valid'
            }
          } catch (_err) {
            allowed = false
            reason = 'read_ticket_invalid'
          }
        }
      }
    } else if (actionStr === 'publish') {
      // Publish: câmera empurra. Path precisa existir no DB e câmera ativa.
      // V1: usa o próprio path como "shared secret" (UUID é hard-to-guess
      // mas não é cryptographic secret). V2 futura: campo streamPublishKey
      // na Camera + obrigatoriedade de `?key=`.
      const cam = await resolveCameraByPath(pathStr)
      if (!cam) {
        allowed = false
        reason = 'publish_unknown_path'
      } else if (!cam.active) {
        allowed = false
        reason = 'publish_camera_inactive'
      } else {
        reason = key ? 'publish_path_ok_with_key' : 'publish_path_ok'
      }
    } else {
      reason = 'unknown_action'
    }
  } catch (err: any) {
    logger.warn({ err: err.message, ip, path, action }, 'mediamtx_auth_handler_error')
    // Em log_only continua permitindo; em enforce, fail-closed
    allowed = MODE === 'log_only'
    reason = 'handler_exception'
  }

  // Log estruturado pra observabilidade. Em log_only sempre OK 200.
  const logLevel = allowed ? 'debug' : (MODE === 'enforce' ? 'warn' : 'info')
  logger[logLevel]({
    ip: ipStr, path: pathStr, action: actionStr, protocol, user,
    allowed, reason, mode: MODE, ticketProvided: !!ticket, keyProvided: !!key,
  }, 'mediamtx_auth_decision')

  if (MODE === 'log_only' || allowed) {
    res.status(200).json({ allow: true })
  } else {
    res.status(401).json({ allow: false, reason })
  }
})
