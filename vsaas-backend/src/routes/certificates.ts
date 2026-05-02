/**
 * Media Certificates Routes — assinatura digital HMAC-SHA256 para autenticidade.
 *
 * POST /certificates/sign     → assina e armazena o certificate (auth: requireAuth)
 * GET  /certificates/:id      → leitura tenant-filtrada
 * POST /certificates/verify   → verificação pública (sem auth)
 *
 * Assinatura:
 *   - Algoritmo: HMAC-SHA256
 *   - Chave: process.env.ICV_SIGNING_KEY (warn + dev key se ausente)
 *   - Canonical JSON: chaves ordenadas alfabeticamente, sem espaços
 *
 * O endpoint /verify NÃO exige auth — qualquer pessoa pode validar um vídeo
 * exportado contra o backend. Mas só retorna metadados não-sensíveis (sem
 * tenantId, sem userId).
 */
import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { logger } from '../lib/logger'
import { ValidationError, NotFoundError, UnauthorizedError } from '../lib/errors'
import type { JwtPayload } from '../middleware/auth'

export const certificatesRouter = Router()

// =============================================================================
// Helpers
// =============================================================================

const DEV_FALLBACK_KEY = 'dev-only-icv-signing-key-please-set-ICV_SIGNING_KEY'
let warnedAboutKey = false

function getSigningKey(): string {
  const k = process.env.ICV_SIGNING_KEY
  if (!k || k.length < 16) {
    if (!warnedAboutKey) {
      logger.warn(
        { hasKey: !!k },
        'ICV_SIGNING_KEY não configurada (ou < 16 chars) — usando chave dev. NÃO use em produção.',
      )
      warnedAboutKey = true
    }
    return DEV_FALLBACK_KEY
  }
  return k
}

/**
 * JSON canônico: ordena chaves alfabeticamente recursivamente. Necessário para
 * que verify() reproduza exatamente o mesmo input, independente da ordem em
 * que o cliente envia os campos.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']'
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return (
    '{' +
    keys
      .map(k => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  )
}

interface SignablePayload {
  type:        string
  cameraId:    string | null
  tenantId:    string
  capturedAt:  string | null
  exportedAt:  string
  sha256:      string
  fileName:    string | null
}

function computeSignature(payload: SignablePayload): string {
  const canonical = canonicalJson(payload)
  return crypto.createHmac('sha256', getSigningKey()).update(canonical).digest('hex')
}

// =============================================================================
// signMediaInternal — helper exportado para uso programático (export.service)
// =============================================================================

export type SignMediaType = 'SNAPSHOT' | 'RECORDING' | 'PRINT' | 'MOSAIC_EXPORT'

export interface SignMediaInternalOpts {
  tenantId:    string
  cameraId?:   string | null
  type:        SignMediaType
  capturedAt?: Date | null
  sha256:      string
  fileName?:   string | null
  fileSize?:   number | bigint | null
  metadata?:   Record<string, unknown> | null
  exportedBy?: string | null
}

/**
 * Assina e persiste um MediaCertificate. Usado por fluxos internos (ex.
 * export.service) que já fizeram tudo (computaram sha256, chamaram ffmpeg)
 * e só precisam materializar o certificado.
 *
 * Não exige Request/JWT — caller já validou tenant e ownership.
 */
export async function signMediaInternal(opts: SignMediaInternalOpts) {
  const exportedAt = new Date()
  const sha = opts.sha256.toLowerCase()

  const payload: SignablePayload = {
    type:       opts.type,
    cameraId:   opts.cameraId ?? null,
    tenantId:   opts.tenantId,
    capturedAt: opts.capturedAt ? opts.capturedAt.toISOString() : null,
    exportedAt: exportedAt.toISOString(),
    sha256:     sha,
    fileName:   opts.fileName ?? null,
  }
  const signature = computeSignature(payload)

  const fileSizeBig: bigint | null =
    opts.fileSize === null || opts.fileSize === undefined
      ? null
      : typeof opts.fileSize === 'bigint'
      ? opts.fileSize
      : BigInt(Math.max(0, Math.floor(opts.fileSize)))

  return await prisma.mediaCertificate.create({
    data: {
      tenantId:   opts.tenantId,
      cameraId:   opts.cameraId ?? null,
      type:       opts.type,
      capturedAt: opts.capturedAt ?? null,
      exportedAt,
      exportedBy: opts.exportedBy ?? null,
      sha256:     sha,
      signature,
      fileSize:   fileSizeBig,
      fileName:   opts.fileName ?? null,
      metadata:   (opts.metadata as any) ?? null,
    },
  })
}

function resolveTenantIdForWrite(jwt: JwtPayload): string {
  return jwt.clienteFinalId ?? jwt.integradorId ?? jwt.sub ?? 'SUPER_ADMIN'
}

async function tenantIdsForRead(jwt: JwtPayload | undefined): Promise<string[] | null> {
  if (!jwt) throw new UnauthorizedError()
  if (jwt.role === 'SUPER_ADMIN') return null
  if (jwt.clienteFinalId) return [jwt.clienteFinalId]
  if (jwt.integradorId) {
    const cfs = await prisma.clienteFinal.findMany({
      where: { integradorId: jwt.integradorId },
      select: { id: true },
    })
    return [jwt.integradorId, ...cfs.map(c => c.id)]
  }
  throw new UnauthorizedError('JWT sem tenant')
}

// =============================================================================
// POST /certificates/sign — auth obrigatória
// =============================================================================

const SignSchema = z.object({
  type:       z.enum(['SNAPSHOT', 'RECORDING', 'PRINT', 'MOSAIC_EXPORT']),
  cameraId:   z.string().uuid().optional().nullable(),
  capturedAt: z.string().datetime().optional().nullable(),
  sha256:     z.string().regex(/^[a-fA-F0-9]{64}$/, 'sha256 deve ser hex de 64 chars'),
  fileName:   z.string().max(500).optional().nullable(),
  fileSize:   z.union([z.number(), z.string()]).optional().nullable(),
  metadata:   z.record(z.string(), z.any()).optional().nullable(),
})

certificatesRouter.post(
  '/sign',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = req.jwtPayload!

    const parse = SignSchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const b = parse.data

    const tenantId = resolveTenantIdForWrite(jwt)
    const exportedAt = new Date()

    const payload: SignablePayload = {
      type:       b.type,
      cameraId:   b.cameraId ?? null,
      tenantId,
      capturedAt: b.capturedAt ?? null,
      exportedAt: exportedAt.toISOString(),
      sha256:     b.sha256.toLowerCase(),
      fileName:   b.fileName ?? null,
    }

    const signature = computeSignature(payload)

    const fileSizeBig: bigint | null =
      b.fileSize === null || b.fileSize === undefined
        ? null
        : typeof b.fileSize === 'string'
        ? BigInt(b.fileSize)
        : BigInt(Math.max(0, Math.floor(b.fileSize)))

    const created = await prisma.mediaCertificate.create({
      data: {
        tenantId,
        cameraId:   b.cameraId ?? null,
        type:       b.type,
        capturedAt: b.capturedAt ? new Date(b.capturedAt) : null,
        exportedAt,
        exportedBy: jwt.sub,
        sha256:     payload.sha256,
        signature,
        fileSize:   fileSizeBig,
        fileName:   b.fileName ?? null,
        metadata:   (b.metadata as any) ?? null,
      },
    })

    res.status(201).json({
      id:         created.id,
      type:       created.type,
      cameraId:   created.cameraId,
      capturedAt: created.capturedAt,
      exportedAt: created.exportedAt,
      sha256:     created.sha256,
      signature:  created.signature,
      fileName:   created.fileName,
      fileSize:   created.fileSize !== null && created.fileSize !== undefined
                    ? created.fileSize.toString()
                    : null,
      metadata:   created.metadata,
    })
  }),
)

// =============================================================================
// GET /certificates/:id — auth obrigatória, tenant-filtrado
// =============================================================================

certificatesRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = req.jwtPayload!
    const tenantIds = await tenantIdsForRead(jwt)

    const cert = await prisma.mediaCertificate.findFirst({
      where: {
        id: String(req.params.id),
        ...(tenantIds ? { tenantId: { in: tenantIds } } : {}),
      },
    })
    if (!cert) throw new NotFoundError('Certificate')

    res.json({
      ...cert,
      fileSize: cert.fileSize !== null && cert.fileSize !== undefined
        ? cert.fileSize.toString()
        : null,
    })
  }),
)

// =============================================================================
// POST /certificates/verify — público, SEM auth
// =============================================================================

const VerifySchema = z.object({
  certificateId: z.string().uuid().optional(),
  signature:     z.string().min(32).max(256).optional(),
  sha256:        z.string().regex(/^[a-fA-F0-9]{64}$/),
}).refine(b => !!b.certificateId || !!b.signature, {
  message: 'certificateId ou signature obrigatório',
})

certificatesRouter.post(
  '/verify',
  asyncHandler(async (req: Request, res: Response) => {
    const parse = VerifySchema.safeParse(req.body)
    if (!parse.success) {
      const first = parse.error.errors[0]
      throw new ValidationError(`${first.path.join('.') || 'body'}: ${first.message}`)
    }
    const b = parse.data
    const inputSha = b.sha256.toLowerCase()

    const cert = await prisma.mediaCertificate.findFirst({
      where: b.certificateId
        ? { id: b.certificateId }
        : { signature: b.signature! },
    })

    if (!cert) {
      res.json({ valid: false, certificate: null, reason: 'NOT_FOUND' })
      return
    }

    // Re-computa assinatura do payload canônico e compara em tempo constante.
    const expected = computeSignature({
      type:       cert.type,
      cameraId:   cert.cameraId,
      tenantId:   cert.tenantId,
      capturedAt: cert.capturedAt ? cert.capturedAt.toISOString() : null,
      exportedAt: cert.exportedAt.toISOString(),
      sha256:     cert.sha256,
      fileName:   cert.fileName,
    })

    const sigMatch = safeEquals(expected, cert.signature)
    const sha256Match = safeEquals(inputSha, cert.sha256)
    const valid = sigMatch && sha256Match

    res.json({
      valid,
      reason: !sigMatch ? 'SIGNATURE_MISMATCH' : !sha256Match ? 'SHA256_MISMATCH' : null,
      certificate: {
        id:         cert.id,
        type:       cert.type,
        cameraId:   cert.cameraId,
        capturedAt: cert.capturedAt,
        exportedAt: cert.exportedAt,
        sha256:     cert.sha256,
        fileName:   cert.fileName,
        // tenantId, exportedBy e metadata sensível NÃO retornados em /verify público.
      },
    })
  }),
)

// =============================================================================
// GET /certificates/:id/pdf — folha imprimível (HTML que o browser pode imprimir)
// =============================================================================
//
// pdfkit não está instalado nesta versão; servimos uma página HTML self-
// contained com print-friendly CSS. O usuário usa Ctrl+P para gerar o PDF
// no próprio browser. Isso evita adicionar dependência grande (pdfkit + fonts)
// pra um caso de uso de baixa frequência.

certificatesRouter.get(
  '/:id/pdf',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const jwt = req.jwtPayload!
    const tenantIds = await tenantIdsForRead(jwt)

    const cert = await prisma.mediaCertificate.findFirst({
      where: {
        id: String(req.params.id),
        ...(tenantIds ? { tenantId: { in: tenantIds } } : {}),
      },
    })
    if (!cert) throw new NotFoundError('Certificate')

    let cameraName: string | null = null
    if (cert.cameraId) {
      const cam = await prisma.camera.findUnique({
        where: { id: cert.cameraId },
        select: { name: true },
      }).catch(() => null)
      cameraName = cam?.name ?? null
    }

    const meta = (cert.metadata ?? {}) as Record<string, unknown>
    const snapshotUrl = typeof meta.snapshotUrl === 'string' ? meta.snapshotUrl : null
    const sigShort = cert.signature.slice(0, 16) + '…' + cert.signature.slice(-8)
    const verifyUrl = `${req.protocol}://${req.get('host')}/certificates/${cert.id}`

    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8"/>
<title>Certificado ${cert.id}</title>
<style>
  @media print { .noprint { display: none !important; } }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 24px; color: #111; }
  h1 { font-size: 22px; border-bottom: 2px solid #000; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.k { font-weight: 600; width: 180px; color: #444; }
  .sig { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; word-break: break-all; }
  .thumb { max-width: 100%; border: 1px solid #ddd; margin: 12px 0; }
  .footer { margin-top: 32px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 8px; }
  button { padding: 8px 16px; font-size: 14px; cursor: pointer; }
</style></head><body>
<button class="noprint" onclick="window.print()">Imprimir / Salvar PDF</button>
<h1>Certificado de Autenticidade de Mídia</h1>
<table>
  <tr><td class="k">ID</td><td>${escapeHtml(cert.id)}</td></tr>
  <tr><td class="k">Tipo</td><td>${escapeHtml(cert.type)}</td></tr>
  <tr><td class="k">Câmera</td><td>${escapeHtml(cameraName ?? cert.cameraId ?? '—')}</td></tr>
  <tr><td class="k">Capturado em</td><td>${cert.capturedAt ? cert.capturedAt.toISOString() : '—'}</td></tr>
  <tr><td class="k">Exportado em</td><td>${cert.exportedAt.toISOString()}</td></tr>
  <tr><td class="k">Arquivo</td><td>${escapeHtml(cert.fileName ?? '—')}</td></tr>
  <tr><td class="k">SHA-256</td><td class="sig">${escapeHtml(cert.sha256)}</td></tr>
  <tr><td class="k">Assinatura HMAC</td><td class="sig">${escapeHtml(sigShort)}</td></tr>
</table>
${snapshotUrl ? `<img class="thumb" src="${escapeHtml(snapshotUrl)}" alt="snapshot"/>` : ''}
<div class="footer">
  Verificação: <code>${escapeHtml(verifyUrl)}</code><br/>
  Algoritmo: HMAC-SHA256 sobre payload JSON canônico (chaves ordenadas).
</div>
</body></html>`

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `inline; filename="cert-${cert.id}.html"`)
    res.send(html)
  }),
)

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}
