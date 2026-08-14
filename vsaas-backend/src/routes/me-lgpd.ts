/**
 * Me LGPD Routes — consent self-service do user logado.
 *
 * Tenants podem exigir consentimento LGPD obrigatório antes do 1º acesso
 * (TenantPolicy.lgpdRequireConsent=true).
 *
 * Quando admin atualiza policyVersion, todos users precisam reaceitar.
 *
 * Fluxo:
 *   1. GET /me/lgpd/status → retorna se user precisa aceitar agora
 *   2. GET /me/lgpd/policy → retorna texto da política do tenant
 *   3. POST /me/lgpd/accept → registra aceite com timestamp + versão
 *
 * Sprint C · docs/40-PLAN-GESTAO-USUARIOS.md
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { publicRoute } from '../middleware/require-capability'
import { ValidationError, NotFoundError } from '../lib/errors'
import { logger } from '../lib/logger'

export const meLgpdRouter = Router()
meLgpdRouter.use(requireAuth)

const DEFAULT_POLICY_TEXT = `
# Política de Uso e Tratamento de Dados (LGPD)

Ao usar este sistema, você declara estar ciente de que:

1. **Captura de imagens**: as câmeras conectadas a este sistema captam imagens
   de pessoas em ambientes monitorados.
2. **Finalidade**: as imagens são utilizadas exclusivamente para fins de
   segurança patrimonial e operacional.
3. **Retenção**: as imagens são mantidas conforme o plano de armazenamento
   contratado (de 7 a 90 dias) e excluídas automaticamente após esse prazo.
4. **Acesso**: o acesso às imagens é restrito a usuários autenticados com
   permissão específica.
5. **Auditoria**: toda visualização, exportação e configuração é registrada
   em log de auditoria mantido por 90 dias.
6. **Compartilhamento**: imagens só podem ser compartilhadas via mecanismos
   oficiais do sistema (links convidado auditáveis) e com finalidade
   documentada (LGPD Art. 7).
7. **Seu papel**: ao operar este sistema, você assume responsabilidade pelo
   uso ético e legal das informações acessadas.
8. **Direitos do titular**: pessoas captadas podem solicitar acesso ou
   exclusão de imagens via canal oficial do controlador.

Ao clicar em "Aceito", você confirma ter lido e compreendido esta política.
`.trim()

// ── GET /me/lgpd/status ────────────────────────────────────────────────────
meLgpdRouter.get('/status',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const user = await prisma.user.findUnique({
      where: { id: jwt.sub },
      select: { lgpdAcceptedAt: true, lgpdPolicyVersion: true, clienteFinalId: true },
    })
    if (!user) throw new NotFoundError('User')

    // Sem cliente final = sem política aplicável (super_admin, integrador admin direto)
    if (!user.clienteFinalId) {
      return res.json({ required: false, accepted: true })
    }

    const policy = await prisma.tenantPolicy.findUnique({
      where: { clienteFinalId: user.clienteFinalId },
      select: { lgpdRequireConsent: true, lgpdPolicyVersion: true },
    })

    if (!policy?.lgpdRequireConsent) {
      return res.json({ required: false, accepted: true })
    }

    const currentVersion = policy.lgpdPolicyVersion
    const accepted = !!user.lgpdAcceptedAt && user.lgpdPolicyVersion === currentVersion

    res.json({
      required: true,
      accepted,
      currentVersion,
      acceptedVersion: user.lgpdPolicyVersion,
      acceptedAt: user.lgpdAcceptedAt,
      reason: accepted ? null
        : !user.lgpdAcceptedAt ? 'never_accepted'
        : 'version_outdated',
    })
  })
)

// ── GET /me/lgpd/policy ────────────────────────────────────────────────────
meLgpdRouter.get('/policy',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const user = await prisma.user.findUnique({
      where: { id: jwt.sub },
      select: { clienteFinalId: true },
    })

    if (!user?.clienteFinalId) {
      return res.json({
        version: 'v1',
        text: DEFAULT_POLICY_TEXT,
        useDefault: true,
      })
    }

    const policy = await prisma.tenantPolicy.findUnique({
      where: { clienteFinalId: user.clienteFinalId },
      select: { lgpdPolicyVersion: true, lgpdPolicyText: true },
    })

    res.json({
      version: policy?.lgpdPolicyVersion ?? 'v1',
      text: policy?.lgpdPolicyText ?? DEFAULT_POLICY_TEXT,
      useDefault: !policy?.lgpdPolicyText,
    })
  })
)

// ── POST /me/lgpd/accept ───────────────────────────────────────────────────
const AcceptSchema = z.object({
  policyVersion: z.string().min(1).max(20),
})

meLgpdRouter.post('/accept',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const parse = AcceptSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.errors[0].message)
    const { policyVersion } = parse.data

    const user = await prisma.user.findUnique({
      where: { id: jwt.sub },
      select: { clienteFinalId: true },
    })
    if (!user?.clienteFinalId) throw new ValidationError('Apenas usuários de cliente final aceitam política')

    // Valida que o version informado é o atual (anti-replay)
    const policy = await prisma.tenantPolicy.findUnique({
      where: { clienteFinalId: user.clienteFinalId },
      select: { lgpdPolicyVersion: true },
    })
    if (policy && policy.lgpdPolicyVersion !== policyVersion) {
      throw new ValidationError(`Versão da política mudou. Atual: ${policy.lgpdPolicyVersion}, recebido: ${policyVersion}. Recarregue e reaceite.`)
    }

    await prisma.user.update({
      where: { id: jwt.sub },
      data: {
        lgpdAcceptedAt: new Date(),
        lgpdPolicyVersion: policyVersion,
      },
    })

    await prisma.auditLog.create({
      data: {
        action: 'USER_LGPD_ACCEPTED',
        resource: 'User',
        resourceId: jwt.sub,
        userId: jwt.sub,
        clienteFinalId: user.clienteFinalId,
        integradorId: jwt.integradorId ?? null,
        metadataJson: { policyVersion, ip: (req as any).ip },
      },
    }).catch(() => {})

    logger.info({ userId: jwt.sub, policyVersion }, 'lgpd_consent_accepted')
    res.json({ success: true, acceptedAt: new Date() })
  })
)
