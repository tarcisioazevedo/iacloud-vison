/**
 * Espelho do registro de capabilities do backend.
 * Mantém sincronizado com vsaas-backend/src/lib/capabilities.ts.
 *
 * Quando adicionar capability nova: atualize OS DOIS arquivos.
 */
export const CAP = {
  // CORE
  CORE_AUTH_LOGIN:                'core.auth.login',
  CORE_AUTH_SIGNUP:               'core.auth.signup',
  CORE_USER_VIEW_OWN:             'core.user.view_own',
  CORE_CAMERA_LIST_OWN:           'core.camera.list_own',
  CORE_CAMERA_VIEW_LIVE:          'core.camera.view_live',
  CORE_CAMERA_CREATE:             'core.camera.create',
  CORE_CAMERA_UPDATE:             'core.camera.update',
  CORE_MARKETPLACE_BROWSE:        'core.marketplace.browse',
  CORE_SUBSCRIPTION_MANAGE_OWN:   'core.subscription.manage_own',

  // STORAGE
  STORAGE_RECORDING_CONTINUOUS:   'storage.recording.continuous',
  STORAGE_RECORDING_MOTION_ONLY:  'storage.recording.motion_only',
  STORAGE_RETENTION_7D:           'storage.retention.7d',
  STORAGE_RETENTION_15D:          'storage.retention.15d',
  STORAGE_RETENTION_30D:          'storage.retention.30d',
  STORAGE_RETENTION_60D:          'storage.retention.60d',
  STORAGE_RETENTION_90D:          'storage.retention.90d',
  STORAGE_RESOLUTION_SD:          'storage.resolution.sd',
  STORAGE_RESOLUTION_HD:          'storage.resolution.hd',
  STORAGE_RESOLUTION_FHD:         'storage.resolution.fhd',
  STORAGE_DOWNLOAD_CLIP:          'storage.download.clip',
  STORAGE_EXPORT_BULK:            'storage.export.bulk',
  STORAGE_PLAYBACK_TIMELINE:      'storage.playback.timeline',
  STORAGE_BOOKMARK_CREATE:        'storage.bookmark.create',

  // AI
  AI_SEMANTIC_CREATE_RULE:        'ai.semantic.create_rule',
  AI_SEMANTIC_PROCESS:            'ai.semantic.process',
  AI_SEMANTIC_TEST_RULE:          'ai.semantic.test_rule',
  AI_SEMANTIC_LIST_ALERTS:        'ai.semantic.list_alerts',
  AI_SEMANTIC_SEARCH_QUERY:       'ai.semantic_search.query',
  AI_DETECTION_BASIC:             'ai.detection.basic',
  AI_LPR_READ_PLATE:              'ai.lpr.read_plate',
  AI_LPR_MANAGE_LISTS:            'ai.lpr.manage_lists',
  AI_HEATMAP_GENERATE:            'ai.heatmap.generate',
  AI_ASSISTANT_CHAT:              'ai.assistant.chat',

  // TIMELAPSE
  TIMELAPSE_GENERATE_DAILY:       'timelapse.generate.daily',
  TIMELAPSE_DOWNLOAD:             'timelapse.download',

  // EXPORT
  EXPORT_SNAPSHOT:                'export.snapshot',
  EXPORT_RECORDING_CLIP:          'export.recording.clip',
  EXPORT_MOSAIC:                  'export.mosaic',

  // NOTIFY
  NOTIFY_WHATSAPP_SEND:           'notify.whatsapp.send',
  NOTIFY_EMAIL_SEND:              'notify.email.send',

  // PTZ
  PTZ_CONTROL:                    'ptz.control',
  AUDIO_TALKBACK:                 'audio.talkback',
} as const

export type Capability = typeof CAP[keyof typeof CAP]
