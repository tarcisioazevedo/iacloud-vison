/**
 * Sprint E.2 — MQTT settings + smoke endpoints.
 *
 *   GET  /mqtt/status          → connected / broker / topics published
 *   POST /mqtt/test            → publica mensagem em iacv/<int>/test/ping
 *   GET  /mqtt/topics-catalog  → catálogo de tópicos suportados (UI usa)
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError } from '../lib/errors'
import { isConnected, publish } from '../lib/mqtt-publisher'
import { publicRoute } from '../middleware/require-capability'

export const mqttRouter = Router()
mqttRouter.use(requireAuth)

mqttRouter.get('/status',
  publicRoute(),
  asyncHandler(async (_req, res) => {
  res.json({
    connected: isConnected(),
    brokerUrl: process.env.IACV_MQTT_BROKER_URL ?? null,
    clientId:  process.env.IACV_MQTT_CLIENT_ID ?? `iacv-backend-${process.pid}`,
  })
}))

const TestSchema = z.object({
  topic:   z.string().min(1).max(200).optional(),
  payload: z.any().optional(),
})

mqttRouter.post('/test',
  publicRoute(),
  requireRole('SUPER_ADMIN', 'INTEGRADOR_ADMIN'), asyncHandler(async (req, res) => {
  const parse = TestSchema.safeParse(req.body ?? {})
  if (!parse.success) throw new ValidationError('payload inválido')
  const integradorId =
    req.jwtPayload!.role === 'INTEGRADOR_ADMIN'
      ? req.jwtPayload!.sub
      : (req.jwtPayload!.integradorId ?? 'super-admin')
  const topic = parse.data.topic ?? 'test/ping'
  await publish(integradorId, topic, parse.data.payload ?? { ts: Date.now(), source: 'manual_test' })
  res.json({ published: true, topic: `iacv/${integradorId}/${topic}`, brokerConnected: isConnected() })
}))

mqttRouter.get('/topics-catalog',
  publicRoute(),
  asyncHandler(async (_req, res) => {
  res.json({
    prefix: 'iacv/<integradorId>/',
    topics: [
      { topic: 'available',                                  retain: true,  example: 'online' },
      { topic: 'cameras/<cameraId>/state',                   retain: true,  example: 'active' },
      { topic: 'cameras/<cameraId>/snapshot',                retain: false, example: '{url, ts}' },
      { topic: 'cameras/<cameraId>/events/<eventId>',        retain: false, example: 'review item full' },
      { topic: 'cameras/<cameraId>/objects/<class>/active',  retain: true,  example: '3' },
      { topic: 'cameras/<cameraId>/objects/<class>/score',   retain: false, example: '0.91' },
      { topic: 'cameras/<cameraId>/motion',                  retain: false, example: '1' },
      { topic: 'cameras/<cameraId>/audio/<class>',           retain: false, example: '1' },
      { topic: 'cameras/<cameraId>/face/<identity>',         retain: false, example: '1' },
      { topic: 'cameras/<cameraId>/plate/<plate>',           retain: false, example: '1' },
      { topic: 'cameras/<cameraId>/recordings/state',        retain: true,  example: 'on' },
      { topic: 'cameras/<cameraId>/siren',                   retain: false, example: '1' },
      { topic: 'cameras/<cameraId>/notifications/state',     retain: true,  example: 'on' },
      { topic: 'edge/<nodeId>/state',                        retain: true,  example: 'online' },
      { topic: 'edge/<nodeId>/heartbeat',                    retain: false, example: '{cpu,mem,temp}' },
      { topic: 'triggers/<triggerId>/hit',                   retain: false, example: '{score, cameraId}' },
      { topic: 'quota/usage',                                retain: false, example: '{vision, vertex, gcs}' },
    ],
  })
}))
