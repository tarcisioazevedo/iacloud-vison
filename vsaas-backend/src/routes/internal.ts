/**
 * Internal Routes — disparados por workers/cron, NÃO por usuários finais.
 *
 * Autenticação por bearer token compartilhado (env INTERNAL_API_TOKEN).
 * Esses endpoints NÃO ficam atrás do JWT de usuário — quem chama é um
 * processo confiável (ex.: cron rodando dentro do mesmo cluster, k8s
 * CronJob, GCP Cloud Scheduler com OIDC, ou um worker em outro pod).
 *
 * Endpoints:
 *   POST /internal/edge-staleness-sweep
 *     Marca EdgeNode como OFFLINE quando o último heartbeat passou de
 *     `staleSec` (default 180s = 3× o intervalo padrão de 60s). Para os
 *     nodes que viram OFFLINE, propaga as câmeras associadas pra ERROR
 *     (UI mostra que a transmissão caiu — o operador precisa intervir).
 *     Retorna contadores pra observabilidade do worker.
 */
import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { cameraLogService } from '../services/camera-log.service'
import { ValidationError } from '../lib/errors'

export const internalRouter = Router()

// ─── Auth interna ──────────────────────────────────────────────────────────
//
// Token estático no header. Em produção, idealmente trocar por OIDC do
// scheduler (Google Cloud Scheduler com identidade) ou mTLS. Mas para o
// MVP, segredo compartilhado é suficiente — desde que o env esteja só
// em vars secrets do cluster (NUNCA commitado).
function requireInternalAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.INTERNAL_API_TOKEN
  if (!expected || expected.length < 16) {
    // Nunca aceitamos requisição interna sem token configurado — protege
    // contra deploy desconfigurado que abriria o endpoint pra mundo.
    logger.error({ }, 'internal_api_token_not_configured')
    res.status(503).json({ error: 'INTERNAL_AUTH_NOT_CONFIGURED' })
    return
  }
  const provided = (req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (provided !== expected) {
    logger.warn({ ip: req.ip }, 'internal_auth_rejected')
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  next()
}

// ─── POST /internal/edge-staleness-sweep ───────────────────────────────────

const SweepSchema = z.object({
  // Janela em segundos: nodes sem heartbeat dentro desta janela são
  // marcados OFFLINE. Default 180s = 3× o intervalo padrão de 60s,
  // tolera 2 retries de heartbeat antes de declarar morto.
  staleSec: z.number().int().min(30).max(3600).default(180),
  // Em modo dryRun apenas conta o que seria afetado — usado por
  // dashboards de healthcheck pra alertar antes do sweep real rodar.
  dryRun:   z.boolean().default(false),
}).strict()

internalRouter.post(
  '/edge-staleness-sweep',
  requireInternalAuth,
  async (req: Request, res: Response) => {
    const parse = SweepSchema.safeParse(req.body ?? {})
    if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
    const { staleSec, dryRun } = parse.data

    const cutoff = new Date(Date.now() - staleSec * 1000)

    // Candidatos: nodes que estão ONLINE/DEGRADED/PROVISIONING e cujo
    // último heartbeat ficou para trás. Excluímos OFFLINE (já marcado)
    // e MAINTENANCE (operador desativou intencionalmente — não mexer).
    const stale = await prisma.edgeNode.findMany({
      where: {
        status: { in: ['ONLINE', 'DEGRADED', 'PROVISIONING'] },
        OR: [
          { lastHeartbeat: { lt: cutoff } },
          { lastHeartbeat: null },          // node provisionado mas nunca apareceu
        ],
      },
      select: {
        id: true, name: true, status: true, lastHeartbeat: true,
        cameras: { where: { active: true }, select: { id: true, name: true } },
      },
    })

    if (dryRun) {
      res.json({
        dryRun: true,
        staleSec,
        cutoff: cutoff.toISOString(),
        wouldMarkOffline: stale.length,
        wouldAffectCameras: stale.reduce((s, n) => s + n.cameras.length, 0),
        nodes: stale.map(n => ({
          id: n.id, name: n.name, status: n.status,
          lastHeartbeat: n.lastHeartbeat,
          cameras: n.cameras.length,
        })),
      })
      return
    }

    // Aplicação real — feita em transações por node pra que falha em
    // um node não cancele o sweep inteiro. Em volume alto seria melhor
    // dispatchar via fila, mas pra começar isso resolve.
    let nodesMarked = 0
    let camerasAffected = 0

    for (const node of stale) {
      try {
        await prisma.$transaction([
          prisma.edgeNode.update({
            where: { id: node.id },
            data:  { status: 'OFFLINE' },
          }),
          // Câmeras do node ficam ERROR — UI mostra alerta vermelho.
          // Não usamos INACTIVE porque INACTIVE = soft delete (ver DELETE).
          // ERROR comunica "tem problema, mas o registro existe".
          prisma.camera.updateMany({
            where: { edgeNodeId: node.id, active: true, status: 'ACTIVE' },
            data:  { status: 'ERROR' },
          }),
        ])
        nodesMarked++
        camerasAffected += node.cameras.length

        // Log por câmera (assíncrono, não bloqueia o sweep).
        for (const cam of node.cameras) {
          cameraLogService.logCamera({
            cameraId: cam.id,
            level:    'ERROR',
            source:   'SYSTEM',
            message:  `Edge node "${node.name}" sem heartbeat há mais de ${staleSec}s — câmera marcada como ERRO`,
            details:  { edgeNodeId: node.id, lastHeartbeat: node.lastHeartbeat, staleSec },
            errorCode:'EDGE_OFFLINE',
          }).catch(() => {/* swallow */})
        }
      } catch (err: any) {
        logger.error({ err: err?.message, nodeId: node.id }, 'edge_sweep_node_failed')
      }
    }

    logger.info({ staleSec, nodesMarked, camerasAffected }, 'edge_staleness_sweep_done')
    res.json({
      dryRun: false,
      staleSec,
      cutoff: cutoff.toISOString(),
      nodesMarkedOffline: nodesMarked,
      camerasMarkedError: camerasAffected,
    })
  },
)

// ─── GET /internal/tenant-lookup?slug=… ────────────────────────────────────
//
// Chamado pelo Cloudflare Worker quando há miss no KV cache (slug → integradorId).
// Worker passa o slug do subdomínio (sem o root); backend retorna o integradorId
// se existir e estiver ativo. Retorno é cached pelo Worker em KV com TTL curto.
//
// Resposta:
//   200 → { slug, integradorId, active: true }
//   404 → { error: 'TENANT_NOT_FOUND' }   (Worker armazena negativo por TTL menor)
//   400 → slug malformado
//
// Auth: requireInternalAuth (mesmo INTERNAL_API_TOKEN do staleness-sweep).
const LookupSchema = z.object({
  slug: z.string().min(2).max(63).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
})

internalRouter.get(
  '/tenant-lookup',
  requireInternalAuth,
  async (req: Request, res: Response) => {
    const parse = LookupSchema.safeParse({ slug: req.query.slug })
    if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

    const integ = await prisma.integrador.findUnique({
      where:  { cfSubdomain: parse.data.slug },
      select: { id: true, active: true, cfSubdomain: true },
    })

    if (!integ || !integ.active) {
      // 404 mesmo pra inactive — não revela existência do registro pra um
      // Worker que pode estar comprometido. Active vira "not found" do POV do
      // edge.
      res.status(404).json({ error: 'TENANT_NOT_FOUND', slug: parse.data.slug })
      return
    }

    res.json({
      slug:         integ.cfSubdomain,
      integradorId: integ.id,
      active:       true,
    })
  },
)
