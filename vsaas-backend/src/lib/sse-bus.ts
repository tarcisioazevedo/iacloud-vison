/**
 * SSE Bus — broadcast de eventos em tempo real para painéis abertos.
 *
 * Cada usuário logado abre uma conexão GET /notifications/stream que fica
 * pendurada (Content-Type: text/event-stream). Quando algo relevante para o
 * tenant dele acontece, o backend faz res.write('data: ...\n\n') e o navegador
 * recebe via EventSource.
 *
 * Escopo de entrega:
 *   - integradorId   → todos os usuários daquele integrador veem
 *   - clienteFinalId → só usuários daquele cliente veem
 *   - userId         → só aquele usuário (notificação 1:1)
 *
 * Não usa Redis pubsub porque hoje o backend é um único processo. Quando
 * escalar horizontal, plugar Redis aqui.
 */
import type { Response } from 'express'
import { logger } from './logger'

export interface SseClient {
  id:             string
  res:            Response
  userId:         string
  integradorId:   string | null
  clienteFinalId: string | null
  role:           string
  connectedAt:    number
}

const clients = new Map<string, SseClient>()

export function registerClient(c: SseClient): void {
  clients.set(c.id, c)
  logger.debug({ id: c.id, userId: c.userId, total: clients.size }, 'sse_client_connected')
}

export function unregisterClient(id: string): void {
  if (clients.delete(id)) {
    logger.debug({ id, total: clients.size }, 'sse_client_disconnected')
  }
}

export interface SseAlertEvent {
  type:           'alert'
  severity:       'INFO' | 'WARNING' | 'CRITICAL'
  title:          string
  body:           string
  cameraName?:    string
  cameraId?:      string         // habilita "Reproduzir" instantâneo no popup
  snapshot?:      string         // base64 — opcional para popup com thumbnail
  eventId?:       string
  ts:             number
}

export interface BroadcastTarget {
  integradorId?:   string
  clienteFinalId?: string
  userId?:         string
}

export function broadcastSse(target: BroadcastTarget, event: SseAlertEvent): number {
  let sent = 0
  const payload = `event: alert\ndata: ${JSON.stringify(event)}\n\n`

  for (const c of clients.values()) {
    // Filtro por escopo: SUPER_ADMIN vê tudo do integrador, restante respeita tenant
    const matchUser    = target.userId         && target.userId         === c.userId
    const matchClient  = target.clienteFinalId && target.clienteFinalId === c.clienteFinalId
    const matchInt     = target.integradorId   && target.integradorId   === c.integradorId
    const isSuperAdmin = c.role === 'SUPER_ADMIN'

    if (matchUser || matchClient || matchInt || isSuperAdmin) {
      try {
        c.res.write(payload)
        sent++
      } catch (err: any) {
        logger.warn({ err: err.message, clientId: c.id }, 'sse_write_failed')
        unregisterClient(c.id)
      }
    }
  }

  return sent
}

/** Envia ping a cada 30s para manter conexão viva (proxies tendem a fechar). */
export function pingAllClients(): void {
  const ping = `: ping ${Date.now()}\n\n`
  for (const c of clients.values()) {
    try { c.res.write(ping) } catch { unregisterClient(c.id) }
  }
}

setInterval(pingAllClients, 30_000)

export function getClientsCount(): number { return clients.size }
