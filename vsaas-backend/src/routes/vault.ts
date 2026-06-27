/**
 * Vault Routes — acesso a clips/snapshots do edge box (Frigate).
 *
 * Por que existe:
 *   A box (Frigate) sobe clips de detecção pro bucket `iacv-vault-{integradorId}`
 *   no esquema `{edgeNodeId}/{YYYY}/{MM}/{DD}/clip|snap|thumb/{frigateId}.{ext}`.
 *   Hoje esses clips ficam órfãos: AnalyticsEvent na cloud não tem `frigateId`
 *   nem `vaultClipKey` populados (eventos PEOPLE_COUNTING são agregados
 *   estatísticos, fluxo paralelo ao Frigate detection).
 *
 *   Esta rota expõe os clips diretamente ao frontend para fallback de playback
 *   quando RecordingSegment HLS está vazio (situação atual em todos os tenants).
 *
 * Endpoints:
 *   GET /vault/cameras/:cameraId/clips?from=ISO&to=ISO
 *     Lista clips do edge box associado à câmera, na janela temporal.
 *     Retorna [{ key, type: 'clip|snap|thumb', timestamp, sizeMB, presignedUrl }]
 *
 * RBAC:
 *   - SUPER_ADMIN: qualquer câmera
 *   - INTEGRADOR_*: câmeras do próprio tenant
 *   - CLIENTE_*:    câmeras do próprio cliente
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { r2Storage } from '../services/r2-storage.service'
import { logger } from '../lib/logger'
import { publicRoute } from '../middleware/require-capability'

export const vaultRouter = Router()

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to:   z.string().datetime().optional(),
})

/** Extrai timestamp Unix do nome do arquivo Frigate: "1778072597.776972-gxpenl.mp4" */
function tsFromKey(key: string): Date | null {
  const filename = key.split('/').pop() ?? ''
  const m = /^(\d+)(?:\.\d+)?-/.exec(filename)
  if (!m) return null
  const sec = Number(m[1])
  if (!Number.isFinite(sec) || sec < 1_000_000_000) return null
  return new Date(sec * 1000)
}

/** Detecta o tipo do objeto pelo segmento de path: '.../clip/...' / '.../snap/...' */
function typeFromKey(key: string): 'clip' | 'snap' | 'thumb' | 'event' | 'other' {
  if (key.includes('/clip/'))   return 'clip'
  if (key.includes('/snap/'))   return 'snap'
  if (key.includes('/thumb/'))  return 'thumb'
  if (key.includes('/events/')) return 'event'
  return 'other'
}

vaultRouter.get('/cameras/:cameraId/clips',
  publicRoute(), // leitura de clips do próprio tenant (já tenant-scoped); feature gated no front via VAULT_CLIP_ACCESS
  requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const p = req.jwtPayload!
  const { from, to } = querySchema.parse(req.query)

  // Resolve camera + edge node + tenant — valida RBAC
  const cam = await prisma.camera.findUnique({
    where: { id: String(req.params.cameraId) },
    select: {
      id: true, name: true,
      site: { select: { clienteFinal: { select: { id: true, integradorId: true } } } },
      edgeNode: { select: {
        id: true, vaultBucket: true, vaultPrefix: true, integradorId: true,
      } },
    },
  })
  if (!cam) throw new NotFoundError('Câmera não encontrada')
  const integradorId   = cam.site.clienteFinal.integradorId
  const clienteFinalId = cam.site.clienteFinal.id

  // RBAC
  if (p.role !== 'SUPER_ADMIN' && p.role !== 'ADMIN_GLOBAL'
      && !(p.role.startsWith('INTEGRADOR_') && p.integradorId === integradorId)
      && !(p.role.startsWith('CLIENTE_')    && p.clienteFinalId === clienteFinalId)) {
    throw new ForbiddenError('Sem acesso a esta câmera')
  }

  if (!cam.edgeNode || !cam.edgeNode.vaultBucket) {
    return res.json({
      clips:    [],
      camera:   { id: cam.id, name: cam.name, deploymentMode: 'CLOUD_DIRECT' },
      reason:   'no_edge_node_or_vault_configured',
    })
  }

  const bucket    = cam.edgeNode.vaultBucket
  const basePref  = cam.edgeNode.vaultPrefix ?? `${cam.edgeNode.id}/`

  // Janela temporal: padrão "últimas 24h" se from/to ausentes
  const toDate    = to   ? new Date(to)   : new Date()
  const fromDate  = from ? new Date(from) : new Date(toDate.getTime() - 24 * 3600 * 1000)
  if (fromDate > toDate) throw new ValidationError('from > to')

  // Estrutura no bucket: {prefix}/{YYYY}/{MM}/{DD}/clip/...
  // Listamos os dias dentro da janela (no máximo ~7 dias por request).
  const dates: string[] = []
  for (let d = new Date(fromDate); d <= toDate && dates.length < 14; d = new Date(d.getTime() + 86400_000)) {
    dates.push(`${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`)
  }

  // Lista cada dia × tipo (clip|snap|thumb), agrega
  const all: { key: string; size: number; lastModified?: Date }[] = []
  for (const date of dates) {
    for (const kind of ['clip', 'snap', 'thumb'] as const) {
      const prefix = `${basePref}${date}/${kind}/`
      const items  = await r2Storage.listObjectsAtBucket(bucket, prefix, 1000)
      all.push(...items)
    }
  }

  // Filtra por timestamp (extraído do nome) na janela [from, to]
  const filtered = all
    .map(o => {
      const ts = tsFromKey(o.key) ?? o.lastModified ?? null
      return { ...o, ts }
    })
    .filter(o => o.ts && o.ts >= fromDate && o.ts <= toDate)
    .sort((a, b) => (a.ts as Date).getTime() - (b.ts as Date).getTime())

  // Gera presigned URL para cada clip (TTL 10min — suficiente pra UI carregar)
  // Em listas grandes, isso pode ficar caro — capamos em 200 itens (UI pagina).
  const capped = filtered.slice(0, 200)
  const clips = await Promise.all(capped.map(async o => ({
    key:           o.key,
    type:          typeFromKey(o.key),
    timestamp:     (o.ts as Date).toISOString(),
    sizeMB:        Number((o.size / (1024 * 1024)).toFixed(3)),
    presignedUrl:  await r2Storage.getPresignedUrlAtBucket(bucket, o.key, 600),
  })))

  logger.info({
    cameraId: cam.id, bucket, prefix: basePref,
    from: fromDate, to: toDate, totalListed: all.length, returned: clips.length,
  }, 'vault_clips_listed')

  res.json({
    clips,
    camera:    { id: cam.id, name: cam.name, deploymentMode: 'EDGE_BOX' },
    edgeNode:  { id: cam.edgeNode.id, vaultBucket: bucket, vaultPrefix: basePref },
    range:     { from: fromDate.toISOString(), to: toDate.toISOString() },
    truncated: filtered.length > capped.length,
    totalAvailable: filtered.length,
  })
}))
