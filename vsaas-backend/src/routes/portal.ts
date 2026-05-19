/**
 * Portal Cliente-Final — endpoints PÚBLICOS (Sprint CF.4).
 *
 * Estes endpoints NÃO exigem JWT Bearer. São o ponto de entrada do portal
 * white-label que o integrador entrega ao cliente final.
 *
 * Endpoints:
 *   GET  /portal/branding/:slug       → metadados visuais (logo, cores, nome)
 *                                       sem expor PII (cnpj, email, sites...)
 *   POST /portal/exchange { token }   → valida magic-link e devolve JWT scoped
 *                                       a clienteFinalId com role CLIENTE_VIEWER
 *
 * Por que `/branding/:slug` é público:
 *   - O portal precisa renderizar o tema ANTES de o cliente colar o token.
 *     Sem o branding antes do exchange, mostra-se um flash branco.
 *   - Slug não é segredo (vai aparecer na URL); a info exposta é estritamente
 *     visual (logo, cores, vertical) — nada que ajude um atacante.
 *
 * Rate limit:
 *   - Aplicado no app.ts via globalRateLimit. Reforço por slug seria útil
 *     mas exige Redis distribuído; deixamos como follow-up se houver abuso.
 */
import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { hashPortalToken } from '../lib/portal-token'
import { ValidationError, NotFoundError, UnauthorizedError } from '../lib/errors'
import { asyncHandler } from '../middleware/async-handler'

export const portalRouter = Router()

// Sessão JWT do portal: 8h por default — suficiente pra um turno do cliente,
// curta o bastante pra que magic-link comprometido tenha blast radius limitado.
const PORTAL_SESSION_TTL = process.env.PORTAL_SESSION_TTL ?? '8h'

const ExchangeSchema = z.object({
  token: z.string().min(20).max(200),
})

// ── GET /portal/branding/:slug ─────────────────────────────────────────────
portalRouter.get('/branding/:slug', asyncHandler(async (req: Request, res: Response) => {
  const slug = (req.params.slug as string).toLowerCase()
  // Sanity: slug malformado vira 404 sem hit no banco.
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) {
    throw new NotFoundError('Portal')
  }

  const cliente = await prisma.clienteFinal.findUnique({
    where: { portalSlug: slug },
    select: {
      name:           true,
      tradeName:      true,
      vertical:       true,
      logoUrl:        true,
      primaryColor:   true,
      secondaryColor: true,
      active:         true,
      // Logo do integrador como fallback visual ("powered by").
      integrador: { select: { name: true } },
    },
  })

  if (!cliente || !cliente.active) throw new NotFoundError('Portal')

  res.set('Cache-Control', 'public, max-age=300') // 5min — branding muda raramente
  res.json({
    name:           cliente.tradeName ?? cliente.name,
    vertical:       cliente.vertical,
    logoUrl:        cliente.logoUrl,
    primaryColor:   cliente.primaryColor,
    secondaryColor: cliente.secondaryColor,
    integradorName: cliente.integrador?.name ?? null,
  })
}))

// ── POST /portal/exchange ──────────────────────────────────────────────────
portalRouter.post('/exchange', asyncHandler(async (req: Request, res: Response) => {
  const parse = ExchangeSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
  const { token } = parse.data

  const tokenHash = hashPortalToken(token)

  const record = await prisma.portalAccessToken.findUnique({
    where: { tokenHash },
    include: {
      clienteFinal: {
        select: {
          id: true, integradorId: true, name: true, tradeName: true,
          active: true, vertical: true, portalSlug: true,
        },
      },
    },
  })

  if (!record) {
    // Mensagens genéricas — não vazamos se token "existiu mas expirou" vs
    // "nunca existiu", pra evitar enumeração.
    logger.warn({ }, 'portal_exchange_token_not_found')
    throw new UnauthorizedError('Token inválido')
  }

  if (record.revoked) {
    logger.warn({ tokenId: record.id }, 'portal_exchange_revoked')
    throw new UnauthorizedError('Token inválido')
  }
  if (record.expiresAt.getTime() < Date.now()) {
    logger.warn({ tokenId: record.id }, 'portal_exchange_expired')
    throw new UnauthorizedError('Token inválido')
  }
  if (record.singleUse && record.lastUsedAt) {
    logger.warn({ tokenId: record.id }, 'portal_exchange_consumed')
    throw new UnauthorizedError('Token inválido')
  }
  if (!record.clienteFinal.active) {
    logger.warn({ tokenId: record.id }, 'portal_exchange_cliente_inactive')
    throw new UnauthorizedError('Token inválido')
  }

  // Marca uso (best-effort — não bloqueia exchange se falhar).
  try {
    await prisma.portalAccessToken.update({
      where: { id: record.id },
      data:  { lastUsedAt: new Date() },
    })
  } catch (err: any) {
    logger.warn({ err: err.message, tokenId: record.id }, 'portal_token_lastuse_update_failed')
  }

  // Emite JWT scoped — role CLIENTE_VIEWER (somente leitura).
  // sub = identificador virtual prefixado pra distinguir de user real em logs.
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET not configured')

  const sessionToken = jwt.sign(
    {
      sub:            `portal:${record.clienteFinalId}`,
      role:           'CLIENTE_VIEWER',
      clienteFinalId: record.clienteFinalId,
      integradorId:   record.clienteFinal.integradorId,
      // Marca origem da sessão pra auditoria; `requireAuth` ignora campos extra.
      portalTokenId:  record.id,
    },
    secret,
    { expiresIn: PORTAL_SESSION_TTL } as jwt.SignOptions,
  )

  // Auditoria do exchange.
  try {
    await prisma.auditLog.create({
      data: {
        action:       'PORTAL_TOKEN_EXCHANGED',
        resource:     'PortalAccessToken',
        resourceId:   record.id,
        integradorId: record.clienteFinal.integradorId,
        // Não há userId (cliente final não é "user" no sistema).
      },
    })
  } catch (err: any) {
    logger.warn({ err: err.message }, 'portal_exchange_audit_log_failed')
  }

  logger.info({
    tokenId:        record.id,
    clienteFinalId: record.clienteFinalId,
  }, 'portal_token_exchanged')

  res.json({
    token: sessionToken,
    role:  'CLIENTE_VIEWER',
    cliente: {
      id:        record.clienteFinal.id,
      name:      record.clienteFinal.tradeName ?? record.clienteFinal.name,
      vertical:  record.clienteFinal.vertical,
      portalSlug: record.clienteFinal.portalSlug,
    },
    expiresIn: PORTAL_SESSION_TTL,
  })
}))
