/**
 * Box Compliance Service
 *
 * Item 2.13 do `docs/08-PLAN-MERCADO-NACIONAL-B2B2B.md` — fechado pedido (d)
 * da Box (commit `be9c457`).
 *
 * Compara `enforcedModules` reportado pela Box no heartbeat vs módulos
 * efetivamente concedidos pelo tenant (IntegradorModule + ClienteFinalModule).
 *
 * Detecta:
 *   - Box reporta skill X enforced=true MAS tenant não concedeu → "extra"
 *     (Box rodando feature não-paga; alerta de billing/segurança)
 *   - Tenant concedeu skill X MAS Box não reporta → "missing"
 *     (provavelmente Box não recebeu config recente; verificar config_revision)
 *
 * Quando diff != 0, regista `EdgeConnectionLog { eventType: 'MODULE_DRIFT' }`
 * com payload sanitizado para o painel SUPER_ADMIN/INTEGRADOR_ADMIN
 * inspecionar.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { edgeConnectionLogService } from './edge-connection-log.service'

/**
 * Skills da Box (catálogo `intrusion | lpr | face | crowd | demographics | ppe | audio`)
 * mapeadas para o enum `AnalyticsModel` do Cloud. Box pode reportar skills
 * desconhecidas — tratamos como "extra" sem mapping (potencial flag de
 * versão Box mais nova que Cloud).
 */
const SKILL_TO_MODEL: Record<string, string[]> = {
  intrusion:    ['MOTION_DETECTION', 'OBJECT_LOCALIZATION'],
  lpr:          ['LICENSE_PLATE_RECOGNITION'],
  face:         ['FACE_RECOGNITION', 'FACE_ANNOTATION'],
  crowd:        ['CROWD_DENSITY', 'OCCUPANCY_ANALYTICS'],
  demographics: ['OCCUPANCY_ANALYTICS', 'FACE_ANNOTATION'],
  ppe:          ['PPE_DETECTION'],
  audio:        ['AUDIO_DETECTION'],
}

export interface ModuleDriftReport {
  hasDrift: boolean
  /** skills enforced=true na Box que tenant NÃO concedeu */
  extra: string[]
  /** skills concedidas pelo tenant que Box NÃO reporta enforced */
  missing: string[]
  /** skills reportadas pela Box mas sem mapping conhecido no Cloud */
  unknown: string[]
  /** snapshot completo para auditoria */
  reported: Record<string, boolean>
  expected: Record<string, boolean>
}

/**
 * Resolve o conjunto de skills esperadas para um EdgeNode com base nos
 * módulos do Integrador e do Cliente Final (intersecção: cliente só pode
 * usar o que integrador também tem).
 */
async function resolveExpectedSkills(edgeNodeId: string): Promise<Set<string>> {
  const node = await prisma.edgeNode.findUnique({
    where: { id: edgeNodeId },
    select: {
      site: { select: { clienteFinalId: true, clienteFinal: { select: { integradorId: true } } } },
    },
  })
  if (!node?.site?.clienteFinalId) return new Set()

  const integradorId   = node.site.clienteFinal.integradorId
  const clienteFinalId = node.site.clienteFinalId

  const [integradorMods, clienteMods] = await Promise.all([
    prisma.integradorModule.findMany({
      where: { integradorId, enabled: true },
      select: { module: true },
    }),
    prisma.clienteFinalModule.findMany({
      where: { clienteFinalId, enabled: true },
      select: { module: true },
    }),
  ])

  const intSet = new Set(integradorMods.map(m => m.module as string))
  const cliSet = new Set(clienteMods.map(m => m.module as string))

  // Intersecção: cliente só usa o que integrador também tem
  const effective = new Set<string>()
  for (const m of cliSet) if (intSet.has(m)) effective.add(m)

  // Converter de AnalyticsModel para "skill names" da Box
  const expectedSkills = new Set<string>()
  for (const [skill, models] of Object.entries(SKILL_TO_MODEL)) {
    // skill habilitada se PELO MENOS UM dos models mapeados está effective
    if (models.some(m => effective.has(m))) {
      expectedSkills.add(skill)
    }
  }
  return expectedSkills
}

/**
 * Compara `enforcedModules` da Box vs skills esperadas. Retorna report
 * estruturado para gravação em audit log + UI.
 */
export async function detectModuleDrift(
  edgeNodeId: string,
  reported: Record<string, boolean>,
): Promise<ModuleDriftReport> {
  const expectedSet = await resolveExpectedSkills(edgeNodeId)

  // Skills que Box reporta enforced=true
  const reportedEnabledSet = new Set(
    Object.entries(reported).filter(([, v]) => v === true).map(([k]) => k.toLowerCase()),
  )

  // Skills com mapping conhecido no Cloud
  const knownSkills = new Set(Object.keys(SKILL_TO_MODEL))

  const extra:   string[] = []
  const missing: string[] = []
  const unknown: string[] = []

  // (1) Box reporta enforced=true mas tenant não autorizou
  for (const skill of reportedEnabledSet) {
    if (!knownSkills.has(skill)) {
      unknown.push(skill)
      continue
    }
    if (!expectedSet.has(skill)) {
      extra.push(skill)
    }
  }

  // (2) Tenant autorizou mas Box não reporta
  for (const skill of expectedSet) {
    if (!reportedEnabledSet.has(skill)) {
      missing.push(skill)
    }
  }

  const expected: Record<string, boolean> = {}
  for (const s of knownSkills) expected[s] = expectedSet.has(s)

  return {
    hasDrift: extra.length > 0 || missing.length > 0,
    extra,
    missing,
    unknown,
    reported,
    expected,
  }
}

/**
 * Helper para o handler /heartbeat: avalia drift e persiste log se diff
 * detectado. Fire-and-forget — nunca bloqueia ou erra a requisição da Box.
 *
 * `extra` = severidade ALTA (Box rodando feature não-paga)
 * `missing` ou `unknown` = severidade INFO (config drift, normal pós-update)
 */
export async function checkAndLogModuleDrift(
  edgeNodeId: string,
  reported: Record<string, boolean> | undefined,
  context: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  if (!reported || Object.keys(reported).length === 0) return  // Box antiga não envia

  try {
    const report = await detectModuleDrift(edgeNodeId, reported)
    if (!report.hasDrift && report.unknown.length === 0) return  // tudo ok

    const status = report.extra.length > 0 ? 'FAILED' : 'PENDING'
    const errorCode = report.extra.length > 0 ? 'MODULE_OVER_ENFORCED' : 'MODULE_DRIFT'
    const errorMessage =
      report.extra.length   > 0 ? `Box rodando módulos não autorizados: ${report.extra.join(', ')}` :
      report.missing.length > 0 ? `Box não habilitou módulos autorizados: ${report.missing.join(', ')}` :
      report.unknown.length > 0 ? `Box reporta skills desconhecidas: ${report.unknown.join(', ')}` :
                                  'Module drift'

    await edgeConnectionLogService.log({
      edgeNodeId,
      eventType: 'MODULE_DRIFT' as any,
      status,
      errorCode,
      errorMessage,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        extra:    report.extra,
        missing:  report.missing,
        unknown:  report.unknown,
        reported: report.reported,
        expected: report.expected,
      },
    })

    logger.warn(
      { edgeNodeId, extra: report.extra, missing: report.missing, unknown: report.unknown },
      'box_module_drift_detected',
    )
  } catch (err: any) {
    // Nunca quebrar heartbeat por causa de compliance check
    logger.debug({ err: err.message, edgeNodeId }, 'module_drift_check_failed')
  }
}
