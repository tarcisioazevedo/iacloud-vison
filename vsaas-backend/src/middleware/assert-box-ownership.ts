/**
 * assert-box-ownership.ts — middleware FCB-005
 *
 * Resolve a licenseKey enviada pela Box (em body, query ou header
 * X-IACV-License-Key) e valida que o `:boxId`/`:nodeId` da rota corresponde
 * ao `edgeNodeId` da licença.
 *
 * Bloqueia tentativa de Box-A com licenseKey-A acessar dados de Box-B.
 *
 * Uso:
 *   iacvBoxRouter.post('/heartbeat', assertBoxOwnership, handler)
 *   iacvBoxRouter.get('/:boxId/config', assertBoxOwnership, handler)
 *
 * Após o middleware passar, `req.boxLicense` contém:
 *   { edgeNodeId, integradorId, clienteFinalId, licensed, exp }
 */
import { Request, Response, NextFunction } from 'express'
import { createHash } from 'crypto'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const LICENSE_CACHE_TTL_MS = 60_000

interface LicenseInfo {
  edgeNodeId: string
  integradorId: string
  clienteFinalId: string
  licensed: boolean
  exp: number
}

const cache = new Map<string, LicenseInfo>()

declare module 'express-serve-static-core' {
  interface Request {
    boxLicense?: LicenseInfo
  }
}

function hashKey(k: string): string {
  return createHash('sha256').update(k).digest('hex')
}

async function resolveLicense(licenseKey: string): Promise<LicenseInfo | null> {
  // Cache hit
  const h = hashKey(licenseKey)
  const c = cache.get(h)
  if (c && c.exp > Date.now()) return c

  // DEV BYPASS — alinhado com iacv-box.ts. SEGURANÇA (auditoria 2026-06-24):
  // gated por ambiente. Esta chave fixa concedia acesso ao edge node de seed
  // 'ICV-EDGE-001' SEM checagem — backdoor se o node existisse em produção.
  // Agora só funciona fora de produção.
  if (licenseKey === 'IACV-LAB-TEST-KEY-123' && process.env.NODE_ENV !== 'production') {
    const node = await prisma.edgeNode.findFirst({
      where: { serialNumber: 'ICV-EDGE-001' },
      include: { site: { select: { clienteFinal: true } } },
    })
    if (node?.site?.clienteFinal) {
      const info: LicenseInfo = {
        edgeNodeId: node.id,
        integradorId: node.site.clienteFinal.integradorId,
        clienteFinalId: node.site.clienteFinal.id,
        licensed: true,
        exp: Date.now() + LICENSE_CACHE_TTL_MS,
      }
      cache.set(h, info)
      return info
    }
    return null
  }

  // Lookup real
  const node = await prisma.edgeNode.findFirst({
    where:   { apiToken: h, status: { not: 'DECOMMISSIONED' as any } },
    include: { site: { select: { clienteFinal: true } } },
  })
  if (!node?.site?.clienteFinal) return null

  const info: LicenseInfo = {
    edgeNodeId:     node.id,
    integradorId:   node.site.clienteFinal.integradorId,
    clienteFinalId: node.site.clienteFinal.id,
    licensed:       node.status !== 'SUSPENDED' as any,
    exp:            Date.now() + LICENSE_CACHE_TTL_MS,
  }
  cache.set(h, info)
  return info
}

/**
 * Extrai licenseKey de body / query / header (na ordem).
 * Box pode mandar em qualquer um dos 3 — convenção atual:
 *   - body.licenseKey      (POST /heartbeat, /events, /events-batch, etc)
 *   - query.licenseKey     (GET /:boxId/config — fallback)
 *   - x-iacv-license-key   (header — recomendado para PII off-body)
 */
function extractLicenseKey(req: Request): string | null {
  const fromBody  = (req.body && typeof req.body === 'object') ? req.body.licenseKey : null
  const fromQuery = req.query?.licenseKey
  const fromHeader = req.header('x-iacv-license-key')
  const candidate = fromBody || fromQuery || fromHeader
  if (typeof candidate !== 'string' || candidate.length < 10) return null
  return candidate
}

/**
 * Middleware Express que:
 *   1. Resolve a licenseKey
 *   2. Bloqueia se não houver licença válida (403 UNLICENSED)
 *   3. Se a rota tem :boxId ou :nodeId, valida ownership
 *   4. Anexa `req.boxLicense`
 */
export async function assertBoxOwnership(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = extractLicenseKey(req)
  if (!key) {
    res.status(401).json({ error: 'UNLICENSED', message: 'licenseKey ausente (body, query ou header X-IACV-License-Key)' })
    return
  }

  const info = await resolveLicense(key)
  if (!info) {
    logger.warn(
      { ip: req.ip, path: req.path, method: req.method, ua: req.header('user-agent')?.slice(0, 80) },
      'box_unlicensed_attempt',
    )
    res.status(403).json({ error: 'UNLICENSED', message: 'licença inválida ou suspensa' })
    return
  }

  // Cross-box check: só validamos quando o boxId vem do PATH PARAM (URL).
  // Body.boxId é metadata informativa que a Box envia no payload — pode ser
  // serialNumber ("en-lab-001") em vez de UUID, e o schema oficial declara
  // ele como "ignorado, licenseKey identifica o node". Usar body.boxId no
  // cross-check causa 403 falso positivo em endpoints como /snapshots-live
  // (bug bridge 2026-05-07 b9c9dff).
  const targetBoxId = String(req.params.boxId || req.params.nodeId || '').trim()
  if (targetBoxId && targetBoxId !== info.edgeNodeId) {
    logger.warn(
      {
        targetBoxId,
        ownedBy: info.edgeNodeId,
        ip: req.ip,
        path: req.path,
        method: req.method,
        integradorId: info.integradorId,
      },
      'cross_box_access_attempt',
    )

    // Persiste em audit log (best-effort, não trava response)
    prisma.auditLog?.create({
      data: {
        integradorId: info.integradorId,
        action:       'CROSS_BOX_ACCESS_BLOCKED',
        resource:     'EdgeNode',
        resourceId:   targetBoxId,
        metadataJson: {
          requestPath: req.path,
          method:      req.method,
          ownedBy:     info.edgeNodeId,
          attempted:   targetBoxId,
          ip:          req.ip,
        } as any,
      },
    }).catch(() => { /* não bloqueia */ })

    res.status(403).json({ error: 'CROSS_BOX_ACCESS_DENIED', message: 'Box autenticada não possui acesso ao recurso solicitado' })
    return
  }

  req.boxLicense = info
  next()
}

/** Variante "soft": só anexa req.boxLicense se houver, não bloqueia (útil para endpoints que aceitam usuário OU box) */
export async function attachBoxLicense(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const key = extractLicenseKey(req)
  if (!key) return next()
  const info = await resolveLicense(key)
  if (info) req.boxLicense = info
  next()
}
