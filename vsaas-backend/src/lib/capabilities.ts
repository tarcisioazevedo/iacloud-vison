/**
 * Registro central de capabilities do VSaaS.
 *
 * Uma capability é uma "permissão de ação" que o cliente pode exercer.
 * Cada produto do marketplace declara que capabilities ele libera.
 *
 * Convenção de nomenclatura: <categoria>.<recurso>.<ação>
 *   storage.recording.continuous
 *   ai.semantic.create_rule
 *   timelapse.generate.daily
 *
 * REGRAS:
 *   1. NUNCA remover capabilities daqui (apenas marcar como deprecated)
 *      → remover quebra subscriptions ativas e seed.
 *   2. Capability nova exige seed em product-capabilities.ts.
 *   3. core.* são sempre permitidas (sem subscription).
 *
 * Fonte da auditoria: docs/31-AUDIT-CAPABILITIES.md
 */

export const CAPABILITIES = {
  // ── CORE (sempre permitido) ────────────────────────────────────────
  CORE_AUTH_LOGIN:                'core.auth.login',
  CORE_AUTH_SIGNUP:               'core.auth.signup',
  CORE_AUTH_RESET_PASSWORD:       'core.auth.reset_password',
  CORE_HEALTH_PING:               'core.health.ping',
  CORE_USER_VIEW_OWN:             'core.user.view_own',
  CORE_USER_UPDATE_OWN:           'core.user.update_own',
  CORE_USER_LIST_INVITES:         'core.user.list_invites',
  CORE_CAMERA_LIST_OWN:           'core.camera.list_own',
  CORE_CAMERA_VIEW_LIVE:          'core.camera.view_live',
  CORE_CAMERA_CREATE:             'core.camera.create',
  CORE_CAMERA_UPDATE:             'core.camera.update',
  CORE_CAMERA_DELETE:             'core.camera.delete',
  CORE_SITE_LIST_OWN:             'core.site.list_own',
  CORE_MARKETPLACE_BROWSE:        'core.marketplace.browse',
  CORE_SUBSCRIPTION_MANAGE_OWN:   'core.subscription.manage_own',

  // ── STORAGE ────────────────────────────────────────────────────────
  STORAGE_RECORDING_CONTINUOUS:    'storage.recording.continuous',
  STORAGE_RECORDING_MOTION_ONLY:   'storage.recording.motion_only',
  STORAGE_RETENTION_7D:            'storage.retention.7d',
  STORAGE_RETENTION_15D:           'storage.retention.15d',
  STORAGE_RETENTION_30D:           'storage.retention.30d',
  STORAGE_RETENTION_60D:           'storage.retention.60d',
  STORAGE_RETENTION_90D:           'storage.retention.90d',
  STORAGE_RESOLUTION_SD:           'storage.resolution.sd',
  STORAGE_RESOLUTION_HD:           'storage.resolution.hd',
  STORAGE_RESOLUTION_FHD:          'storage.resolution.fhd',
  STORAGE_DOWNLOAD_CLIP:           'storage.download.clip',
  STORAGE_EXPORT_BULK:             'storage.export.bulk',
  STORAGE_PLAYBACK_TIMELINE:       'storage.playback.timeline',
  STORAGE_BOOKMARK_CREATE:         'storage.bookmark.create',
  STORAGE_SPRITE_PREVIEW:          'storage.sprite.preview',

  // ── AI · SEMANTIC ──────────────────────────────────────────────────
  AI_SEMANTIC_CREATE_RULE:         'ai.semantic.create_rule',
  AI_SEMANTIC_PROCESS:             'ai.semantic.process',
  AI_SEMANTIC_TEST_RULE:           'ai.semantic.test_rule',
  AI_SEMANTIC_LIST_ALERTS:         'ai.semantic.list_alerts',

  // ── AI · DETECÇÃO (YOLO/Roboflow) ──────────────────────────────────
  AI_DETECTION_BASIC:              'ai.detection.basic',
  AI_DETECTION_PERSON:             'ai.detection.person',
  AI_DETECTION_VEHICLE:            'ai.detection.vehicle',
  AI_DETECTION_PPE:                'ai.detection.ppe',
  AI_DETECTION_WEAPON:             'ai.detection.weapon',
  AI_DETECTION_FALL:               'ai.detection.fall',
  AI_DETECTION_CROWD:              'ai.detection.crowd',

  // ── AI · LPR (placas) ──────────────────────────────────────────────
  AI_LPR_READ_PLATE:               'ai.lpr.read_plate',
  AI_LPR_MANAGE_LISTS:             'ai.lpr.manage_lists',
  AI_LPR_HISTORY:                  'ai.lpr.history',

  // ── AI · OUTROS ────────────────────────────────────────────────────
  AI_HEATMAP_GENERATE:             'ai.heatmap.generate',
  AI_FR_INDEX_FACE:                'ai.fr.index_face',
  AI_FR_SEARCH_FACE:               'ai.fr.search_face',
  AI_ASSISTANT_CHAT:               'ai.assistant.chat',
  AI_ASSISTANT_DESCRIBE_LIVE:      'ai.assistant.describe_live',
  AI_SEMANTIC_SEARCH_QUERY:        'ai.semantic_search.query',
  AI_TRIGGERS_VISION:              'ai.triggers.vision',

  // ── TIMELAPSE ──────────────────────────────────────────────────────
  TIMELAPSE_GENERATE_DAILY:        'timelapse.generate.daily',
  TIMELAPSE_GENERATE_WEEKLY:       'timelapse.generate.weekly',
  TIMELAPSE_GENERATE_MONTHLY:      'timelapse.generate.monthly',
  TIMELAPSE_DOWNLOAD:              'timelapse.download',

  // ── PLAYBACK / EXPORT ──────────────────────────────────────────────
  EXPORT_SNAPSHOT:                 'export.snapshot',
  EXPORT_RECORDING_CLIP:           'export.recording.clip',
  EXPORT_MOSAIC:                   'export.mosaic',

  // ── NOTIFY ─────────────────────────────────────────────────────────
  NOTIFY_WHATSAPP_SEND:            'notify.whatsapp.send',
  NOTIFY_EMAIL_SEND:               'notify.email.send',
  NOTIFY_TELEGRAM_SEND:            'notify.telegram.send',
  NOTIFY_WEBHOOK_FIRE:             'notify.webhook.fire',
  NOTIFY_PUSH_SEND:                'notify.push.send',

  // ── ANALYTICS ──────────────────────────────────────────────────────
  ANALYTICS_BASIC:                 'analytics.basic',
  ANALYTICS_PRO:                   'analytics.pro',
  ANALYTICS_PEOPLE_COUNT:          'analytics.people_count',

  // ── PTZ / AUDIO ────────────────────────────────────────────────────
  PTZ_CONTROL:                     'ptz.control',
  AUDIO_TALKBACK:                  'audio.talkback',

  // ── WHITELABEL / MAP / BOX ─────────────────────────────────────────
  WHITELABEL_CUSTOM_DOMAIN:        'whitelabel.custom_domain',
  WHITELABEL_CUSTOM_BRANDING:      'whitelabel.custom_branding',
  WHITELABEL_EMAIL_BYOK:           'whitelabel.email.byok',
  WHITELABEL_GEMINI_BYOK:          'whitelabel.gemini.byok',
  WHITELABEL_PRICING_OVERRIDE:     'whitelabel.pricing.override',
  WHITELABEL_RETENTION_PLAN:       'whitelabel.retention.plan',
  WHITELABEL_STORAGE_CONFIG:       'whitelabel.storage.config',
  MAP_SYNOPTIC:                    'map.synoptic',
  BOX_TUNNEL_CLOUD_ACCESS:         'box.tunnel.cloud_access',

  // ── EXTENSÕES DA AUDITORIA ─────────────────────────────────────────
  NOTIFY_SMTP_BYOK:                'notify.smtp.byok',
  AI_SEMANTIC_FP_FEEDBACK:         'ai.semantic.fp_feedback',
  ALERT_CONFIG_MANAGE:             'alert.config.manage',
  ALERT_RECIPIENT_MANAGE:          'alert.recipient.manage',
  VAULT_CLIP_ACCESS:               'vault.clip.access',

  // ── MOSAICOS (docs/42 — Ondas 1+2) ─────────────────────────────────
  // Listadas como CORE (UX básica, sem gate de subscription). RBAC efetivo
  // é por role no handler:
  //   - CLIENT_SHARED  → role === CLIENTE_ADMIN
  //   - INTEGRATOR_TEMPLATE → role.startsWith('INTEGRADOR_')
  MOSAIC_SHARE_CLIENT:             'mosaic.share.client',
  MOSAIC_CREATE_TEMPLATE:          'mosaic.create.template',
} as const

export type Capability = typeof CAPABILITIES[keyof typeof CAPABILITIES]

/**
 * Capability "core" — sempre permitida, não precisa de subscription.
 * Inclui auth, healthcheck, listagens próprias, browse de marketplace.
 */
export const CORE_CAPABILITIES = new Set<string>([
  CAPABILITIES.CORE_AUTH_LOGIN,
  CAPABILITIES.CORE_AUTH_SIGNUP,
  CAPABILITIES.CORE_AUTH_RESET_PASSWORD,
  CAPABILITIES.CORE_HEALTH_PING,
  CAPABILITIES.CORE_USER_VIEW_OWN,
  CAPABILITIES.CORE_USER_UPDATE_OWN,
  CAPABILITIES.CORE_USER_LIST_INVITES,
  CAPABILITIES.CORE_CAMERA_LIST_OWN,
  CAPABILITIES.CORE_CAMERA_VIEW_LIVE,
  CAPABILITIES.CORE_CAMERA_CREATE,
  CAPABILITIES.CORE_CAMERA_UPDATE,
  CAPABILITIES.CORE_CAMERA_DELETE,
  CAPABILITIES.CORE_SITE_LIST_OWN,
  CAPABILITIES.CORE_MARKETPLACE_BROWSE,
  CAPABILITIES.CORE_SUBSCRIPTION_MANAGE_OWN,
  // Mosaicos — UX básica, sem gate de subscription (RBAC por role no handler)
  CAPABILITIES.MOSAIC_SHARE_CLIENT,
  CAPABILITIES.MOSAIC_CREATE_TEMPLATE,
])

export function isCoreCapability(cap: string): boolean {
  return CORE_CAPABILITIES.has(cap)
}

/**
 * Lista todas as capabilities conhecidas (pra validações e UI admin).
 */
export function allCapabilities(): string[] {
  return Object.values(CAPABILITIES)
}
