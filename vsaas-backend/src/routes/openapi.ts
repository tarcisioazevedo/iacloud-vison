/**
 * Sprint Q.4 — OpenAPI 3.1 + Swagger UI standalone (sem dep externa).
 *
 * Estratégia: schema curado à mão (não auto-derivado de Zod) — mais leve,
 * sem dep `zod-to-openapi`. Swagger UI via CDN inline em /docs.
 *
 *   GET /openapi.json    → schema OpenAPI 3.1
 *   GET /docs            → HTML standalone com Swagger UI (CDN)
 */
import { Router, Request, Response } from 'express'

export const openapiRouter = Router()

// ── Schema (curado) ────────────────────────────────────────────────────────
function buildSchema(req: Request) {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'http'
  const host = req.headers.host ?? 'localhost:3000'
  const base = `${proto}://${host}`

  return {
    openapi: '3.1.0',
    info: {
      title: 'VSaaS — API Reference',
      version: process.env.npm_package_version ?? '1.0.0',
      description:
        'API multi-tenant B2B2B para analytics de vídeo. ' +
        'JWT Bearer obrigatório em rotas protegidas. ' +
        'Header `X-Edge-Token` em /edge/* para edge agents.',
      contact: { name: 'Suporte VSaaS', email: 'suporte@iacloudvision.com.br' },
    },
    servers: [{ url: base, description: 'Atual' }],
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        EdgeToken:  { type: 'apiKey', in: 'header', name: 'X-Edge-Token' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
            code:    { type: 'string' },
          },
        },
        LoginRequest: {
          type: 'object', required: ['email', 'password'],
          properties: {
            email:    { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            role:  { type: 'string', enum: ['SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'CLIENTE_ADMIN', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER'] },
          },
        },
        PushSubscriptionRequest: {
          type: 'object', required: ['endpoint', 'keys'],
          properties: {
            endpoint:  { type: 'string', format: 'uri' },
            keys: {
              type: 'object', required: ['p256dh', 'auth'],
              properties: {
                p256dh: { type: 'string' },
                auth:   { type: 'string' },
              },
            },
            userAgent: { type: 'string' },
          },
        },
        SemanticTrigger: {
          type: 'object',
          properties: {
            id:             { type: 'string', format: 'uuid' },
            name:           { type: 'string' },
            description:    { type: 'string' },
            enabled:        { type: 'boolean' },
            sourceType:     { type: 'string', enum: ['IMAGE', 'TEXT', 'THUMBNAIL_REF'] },
            threshold:      { type: 'number', minimum: 0.5, maximum: 0.99 },
            cooldownSec:    { type: 'integer' },
            hitsCount:      { type: 'integer' },
            lastHitAt:      { type: 'string', format: 'date-time', nullable: true },
            clienteFinalId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    paths: {
      // ─── Health ────────────────────────────────────────────────────────────
      '/health':        { get: { tags: ['health'], summary: 'Liveness', security: [], responses: { 200: { description: 'OK' } } } },
      '/health/ready':  { get: { tags: ['health'], summary: 'Readiness (DB)', security: [], responses: { 200: { description: 'OK' }, 503: { description: 'Not ready' } } } },

      // ─── Auth ──────────────────────────────────────────────────────────────
      '/auth/login': {
        post: {
          tags: ['auth'], summary: 'Login (e-mail + senha)', security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
            401: { description: 'Credenciais inválidas', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/auth/me': {
        get:   { tags: ['auth'], summary: 'Dados do ator autenticado', responses: { 200: { description: 'OK' }, 401: { description: 'Sem token' } } },
        patch: { tags: ['auth'], summary: 'Atualiza nome/preferências', responses: { 200: { description: 'OK' } } },
      },
      '/auth/me/avatar': {
        patch: { tags: ['auth'], summary: 'Atualiza avatar (data URL base64)', responses: { 200: { description: 'OK' } } },
      },
      '/auth/change-password': {
        post: { tags: ['auth'], summary: 'Troca senha do ator atual', responses: { 200: { description: 'OK' }, 400: { description: 'Senha atual inválida' } } },
      },
      '/auth/box-token': {
        post: { tags: ['auth'], summary: 'SSO Box — emite JWT escopado para EdgeNode (1h, aud=box:{id})', responses: { 200: { description: 'OK' }, 403: { description: 'Sem acesso ao EdgeNode' } } },
      },

      // ─── Cameras ───────────────────────────────────────────────────────────
      '/cameras': {
        get:  { tags: ['cameras'], summary: 'Lista câmeras do tenant', parameters: [{ name: 'siteId', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'status', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } },
        post: { tags: ['cameras'], summary: 'Cria câmera (RTSP/RTMP)', responses: { 201: { description: 'Created' } } },
      },
      '/cameras/{id}': {
        get:    { tags: ['cameras'], summary: 'Detalhe da câmera', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        patch:  { tags: ['cameras'], summary: 'Atualiza câmera',   parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        delete: { tags: ['cameras'], summary: 'Desativa câmera',   parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'No Content' } } },
      },
      '/cameras/{id}/test': {
        post: { tags: ['cameras'], summary: 'Testa RTSP via ffprobe', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK + codec/fps/resolução' }, 502: { description: 'RTSP inacessível' } } },
      },
      '/cameras/{id}/snapshot': {
        get: { tags: ['cameras'], summary: 'Snapshot JPEG/WebP', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'variant', in: 'query', schema: { type: 'string', enum: ['annotated', 'clean'] } }], responses: { 200: { description: 'image/*' }, 404: { description: 'Não encontrado' } } },
      },
      '/cameras/probe': {
        post: { tags: ['cameras'], summary: 'Probe RTSP de URL ad-hoc (rate-limited)', responses: { 200: { description: 'OK' }, 429: { description: 'Rate limit' } } },
      },
      '/cameras/presets': {
        get: { tags: ['cameras'], summary: 'Catálogo de presets FFmpeg', security: [], responses: { 200: { description: 'OK' } } },
      },

      // ─── Sites ─────────────────────────────────────────────────────────────
      '/sites': {
        get:  { tags: ['sites'], summary: 'Lista sites (filiais) do tenant', responses: { 200: { description: 'OK' } } },
        post: { tags: ['sites'], summary: 'Cria site',                       responses: { 201: { description: 'Created' } } },
      },
      '/sites/{id}': {
        get:    { tags: ['sites'], summary: 'Detalhe',     parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        patch:  { tags: ['sites'], summary: 'Atualiza',    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        delete: { tags: ['sites'], summary: 'Desativa',    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'No Content' } } },
      },

      // ─── Edge Nodes ────────────────────────────────────────────────────────
      '/edge-nodes': {
        get: { tags: ['edge-nodes'], summary: 'Lista boxes do tenant', responses: { 200: { description: 'OK' } } },
      },
      '/edge-nodes/provision': {
        post: { tags: ['edge-nodes'], summary: 'Provisiona EdgeNode (gera license key)', responses: { 201: { description: 'Created' }, 402: { description: 'Quota excedida' } } },
      },
      '/edge-nodes/{id}': {
        get:    { tags: ['edge-nodes'], summary: 'Detalhe EdgeNode',   parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        delete: { tags: ['edge-nodes'], summary: 'Desprovisiona',      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'No Content' } } },
      },
      '/edge-nodes/{id}/license-key': {
        get: { tags: ['edge-nodes'], summary: 'Recupera license key', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
      },
      '/edge-nodes/{id}/rotate-token': {
        post: { tags: ['edge-nodes'], summary: 'Rotaciona token do edge', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
      },
      '/edge-nodes/{id}/suspend': {
        post: { tags: ['edge-nodes'], summary: 'Suspende edge', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
      },
      '/edge-nodes/{id}/resume': {
        post: { tags: ['edge-nodes'], summary: 'Reativa edge suspenso', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
      },

      // ─── Live ──────────────────────────────────────────────────────────────
      '/live/{id}/availability': {
        get: { tags: ['live'], summary: 'Verifica disponibilidade WHEP/MediaMTX/go2rtc', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
      },
      '/live/{id}/snapshot-jpeg': {
        get: { tags: ['live'], summary: 'Snapshot live JPEG (poll para fallback de WHEP)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'ticket', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'image/jpeg' } } },
      },

      // ─── Playback / Recordings ─────────────────────────────────────────────
      '/playback/token': {
        post: { tags: ['playback'], summary: 'Emite ticket HLS para acesso à gravação', responses: { 200: { description: 'OK + manifestUrl' } } },
      },
      '/playback/{id}/manifest.m3u8': {
        get: { tags: ['playback'], summary: 'HLS manifest (com ticket)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'ticket', in: 'query', required: true, schema: { type: 'string' } }], security: [], responses: { 200: { description: 'application/vnd.apple.mpegurl' } } },
      },
      '/playback/{id}/timeline': {
        get: { tags: ['playback'], summary: 'Markers de evento na timeline', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } },
      },
      '/recordings/segments': {
        get: { tags: ['playback'], summary: 'Lista segmentos por câmera/intervalo', parameters: [{ name: 'cameraId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }], responses: { 200: { description: 'OK' } } },
      },

      // ─── Bookmarks ─────────────────────────────────────────────────────────
      '/bookmarks': {
        get:  { tags: ['bookmarks'], summary: 'Lista bookmarks do ator', responses: { 200: { description: 'OK' } } },
        post: { tags: ['bookmarks'], summary: 'Cria bookmark (timestamp + título + opcional protectedUntil)', responses: { 201: { description: 'Created' } } },
      },
      '/bookmarks/{id}': {
        get:    { tags: ['bookmarks'], summary: 'Detalhe',   parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        patch:  { tags: ['bookmarks'], summary: 'Atualiza',  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        delete: { tags: ['bookmarks'], summary: 'Remove',    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'No Content' } } },
      },

      // ─── Review (eventos) ──────────────────────────────────────────────────
      '/review': {
        get: { tags: ['review'], summary: 'Lista review items (eventos)', parameters: [{ name: 'severity', in: 'query', schema: { type: 'string', enum: ['ALERT','DETECTION','SIGNIFICANT'] } }, { name: 'status', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } },
      },

      // ─── Triggers (Semantic Search) ────────────────────────────────────────
      '/triggers': {
        get:  { tags: ['triggers'], summary: 'Lista Semantic Triggers do tenant', responses: { 200: { description: 'OK' } } },
        post: { tags: ['triggers'], summary: 'Cria Semantic Trigger (text/image)', responses: { 201: { description: 'Created' } } },
      },
      '/triggers/{id}': {
        get:    { tags: ['triggers'], summary: 'Detalhe + últimos hits', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        patch:  { tags: ['triggers'], summary: 'Atualiza',               parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        delete: { tags: ['triggers'], summary: 'Remove',                 parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'No Content' } } },
      },
      '/triggers/{id}/test': {
        post: { tags: ['triggers'], summary: 'Simula match — retorna score sem disparar ações', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
      },

      // ─── Faces (Reconhecimento Facial) ─────────────────────────────────────
      '/faces/identities': {
        get:  { tags: ['faces'], summary: 'Lista identidades faciais', responses: { 200: { description: 'OK' } } },
        post: { tags: ['faces'], summary: 'Cria identidade', responses: { 201: { description: 'Created' } } },
      },
      '/faces/identities/{id}': {
        get:    { tags: ['faces'], summary: 'Detalhe identidade',  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        patch:  { tags: ['faces'], summary: 'Atualiza identidade', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        delete: { tags: ['faces'], summary: 'Remove identidade',   parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'No Content' } } },
      },
      '/faces/identities/{id}/enroll': {
        post: { tags: ['faces'], summary: 'Enrolla embedding novo a partir de imagem', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 201: { description: 'Created' } } },
      },

      // ─── Plates (LPR) ──────────────────────────────────────────────────────
      '/plates': {
        get:  { tags: ['plates'], summary: 'Lista placas cadastradas', responses: { 200: { description: 'OK' } } },
        post: { tags: ['plates'], summary: 'Cadastra placa (categoria: AUTHORIZED/VIP/FLEET/SERVICE/BLACKLIST/VISITOR)', responses: { 201: { description: 'Created' } } },
      },
      '/plates/{id}': {
        get:    { tags: ['plates'], summary: 'Detalhe',  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        patch:  { tags: ['plates'], summary: 'Atualiza', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        delete: { tags: ['plates'], summary: 'Remove',   parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'No Content' } } },
      },
      '/plates/events/list': {
        get: { tags: ['plates'], summary: 'Eventos LPR (timeline)', responses: { 200: { description: 'OK' } } },
      },

      // ─── BI Analytics ──────────────────────────────────────────────────────
      '/bi/kpis':              { get: { tags: ['bi'], summary: 'KPIs principais do tenant',     responses: { 200: { description: 'OK' } } } },
      '/bi/flow/hourly':       { get: { tags: ['bi'], summary: 'Fluxo por hora (contagem)',     responses: { 200: { description: 'OK' } } } },
      '/bi/demographics':      { get: { tags: ['bi'], summary: 'Demografia (idade/gênero)',     responses: { 200: { description: 'OK' } } } },
      '/bi/ppe/compliance':    { get: { tags: ['bi'], summary: 'Conformidade EPI por câmera',   responses: { 200: { description: 'OK' } } } },
      '/bi/occupancy':         { get: { tags: ['bi'], summary: 'Ocupação atual por zona',        responses: { 200: { description: 'OK' } } } },
      '/bi/counting':          { get: { tags: ['bi'], summary: 'Contagem people-counting',       responses: { 200: { description: 'OK' } } } },

      // ─── Notifications ─────────────────────────────────────────────────────
      '/notifications/stream': {
        get: { tags: ['notifications'], summary: 'SSE stream de alertas em tempo real', responses: { 200: { description: 'text/event-stream' } } },
      },
      '/notifications/whatsapp': {
        get: { tags: ['notifications'], summary: 'Status da instância WhatsApp Evolution do tenant', responses: { 200: { description: 'OK' } } },
      },
      '/notifications/whatsapp/instance': {
        post: { tags: ['notifications'], summary: 'Cria/recria instância WhatsApp (retorna QR code)', responses: { 200: { description: 'OK' } } },
      },
      '/notifications/whatsapp/test': {
        post: { tags: ['notifications'], summary: 'Envia mensagem de teste WhatsApp', responses: { 200: { description: 'OK' } } },
      },

      // ─── Push (WebPush VAPID) ──────────────────────────────────────────────
      '/push/vapid-public-key': {
        get: { tags: ['push'], summary: 'Chave pública VAPID (frontend usa para subscribe)', security: [], responses: { 200: { description: 'OK' } } },
      },
      '/push/subscribe': {
        post: { tags: ['push'], summary: 'Cria/atualiza PushSubscription', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PushSubscriptionRequest' } } } }, responses: { 201: { description: 'Created' } } },
      },
      '/push/subscriptions': {
        get: { tags: ['push'], summary: 'Lista subscriptions ativas do ator', responses: { 200: { description: 'OK' } } },
      },
      '/push/test': {
        post: { tags: ['push'], summary: 'Dispara push de teste', responses: { 200: { description: 'OK' } } },
      },

      // ─── Portal (cliente final, white-label) ───────────────────────────────
      '/portal/branding/{slug}': {
        get: { tags: ['portal'], summary: 'Retorna branding (cores, logo) por slug', security: [], parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: { description: 'Slug inexistente' } } },
      },
      '/portal/exchange': {
        post: { tags: ['portal'], summary: 'Troca magic-link token por JWT CLIENTE_VIEWER', security: [], responses: { 200: { description: 'OK' }, 410: { description: 'Token expirado' } } },
      },

      // ─── Modules (feature flags) ───────────────────────────────────────────
      '/modules/catalog': {
        get: { tags: ['modules'], summary: 'Catálogo público de módulos disponíveis', security: [], responses: { 200: { description: 'OK' } } },
      },
      '/modules/effective': {
        get: { tags: ['modules'], summary: 'Módulos efetivamente habilitados para o ator', responses: { 200: { description: 'OK' } } },
      },

      // ─── Quota ─────────────────────────────────────────────────────────────
      '/quota/me': {
        get: { tags: ['quota'], summary: 'Cota e uso atual do ator/tenant', responses: { 200: { description: 'OK' } } },
      },

      // ─── Leads (funil público) ─────────────────────────────────────────────
      '/leads': {
        post: { tags: ['leads'], summary: 'Captura lead público (sem auth)', security: [], responses: { 201: { description: 'Created' } } },
      },

      // ─── Edge ingest (X-Edge-Token) ────────────────────────────────────────
      '/edge/ingest': {
        post: { tags: ['edge'], summary: 'Ingest de evento/snapshot do edge agent', security: [{ EdgeToken: [] }], responses: { 200: { description: 'OK' }, 401: { description: 'Token inválido' }, 429: { description: 'Rate limit' } } },
      },

      // ─── OpenAPI ────────────────────────────────────────────────────────────
      '/openapi.json': { get: { tags: ['meta'], summary: 'Este schema OpenAPI 3.1', security: [], responses: { 200: { description: 'OK' } } } },
      '/docs':         { get: { tags: ['meta'], summary: 'Redoc (referência limpa para integradores)', security: [], responses: { 200: { description: 'text/html' } } } },
      '/swagger':      { get: { tags: ['meta'], summary: 'Swagger UI (try-it-out interativo)', security: [], responses: { 200: { description: 'text/html' } } } },
    },
    tags: [
      { name: 'health',        description: 'Probes de saúde do serviço' },
      { name: 'auth',          description: 'Autenticação, perfil, SSO Box' },
      { name: 'cameras',       description: 'CRUD de câmeras + snapshot + probe RTSP' },
      { name: 'sites',         description: 'Filiais (Site) do cliente final' },
      { name: 'edge-nodes',    description: 'Boxes ICV-Bridge: provisionamento, license, suspend' },
      { name: 'live',          description: 'Live view (WHEP/snapshot fallback)' },
      { name: 'playback',      description: 'HLS playback, timeline e segmentos' },
      { name: 'bookmarks',     description: 'Marcadores de gravação (com legal hold opcional)' },
      { name: 'review',        description: 'Eventos / review items (motion + IA)' },
      { name: 'triggers',      description: 'Semantic Triggers (busca por NLP/imagem)' },
      { name: 'faces',         description: 'Reconhecimento Facial (identidades + embeddings)' },
      { name: 'plates',        description: 'License Plate Recognition (LPR)' },
      { name: 'bi',            description: 'BI Analytics (KPIs, fluxo, demografia, ocupação, EPI)' },
      { name: 'notifications', description: 'SSE stream + WhatsApp Evolution' },
      { name: 'push',          description: 'WebPush (VAPID) — browser/PWA' },
      { name: 'portal',        description: 'Portal cliente final (white-label, magic-link)' },
      { name: 'modules',       description: 'Feature flags por integrador/cliente' },
      { name: 'quota',         description: 'Cotas e uso de API' },
      { name: 'leads',         description: 'Funil público de leads (sem auth)' },
      { name: 'edge',          description: 'Ingest do agente edge (X-Edge-Token)' },
      { name: 'meta',          description: 'OpenAPI / docs' },
    ],
  }
}

openapiRouter.get('/openapi.json', (req: Request, res: Response) => {
  res.set('Cache-Control', 'public, max-age=300')
  res.json(buildSchema(req))
})

/**
 * /docs — Redoc UI (item 2.3 docs/08).
 *
 * Trocou Swagger UI por Redoc:
 *   - Visual mais limpo, layout 3-col (sidebar tags + endpoint detail + sample request)
 *   - Performance melhor em specs grandes (50+ endpoints)
 *   - "Try it out" não nativo — para testar interativo, usar Postman/Bruno
 *     com a spec exportada de /openapi.json
 *
 * Backwards-compat: /swagger mantém UI antiga via CDN para quem prefere o
 * "try it out" interativo (clientes acostumados).
 */
openapiRouter.get('/docs', (req: Request, res: Response) => {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'http'
  const host = req.headers.host ?? 'localhost:3000'
  const specUrl = `${proto}://${host}/openapi.json`
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>VSaaS — API Reference</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='8' fill='%2306b6d4'/></svg>" />
  <link href="https://fonts.googleapis.com/css?family=Inter:300,400,600,700|Roboto+Mono" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; font-family: 'Inter', system-ui, sans-serif; }
    redoc { display: block; }
  </style>
</head>
<body>
  <redoc
    spec-url="${specUrl}"
    theme='{
      "colors": {
        "primary": { "main": "#06b6d4" },
        "success": { "main": "#10b981" },
        "warning": { "main": "#f59e0b" },
        "error":   { "main": "#ef4444" }
      },
      "typography": {
        "fontFamily": "Inter, system-ui, sans-serif",
        "code": { "fontFamily": "Roboto Mono, monospace" },
        "headings": { "fontFamily": "Inter, system-ui, sans-serif", "fontWeight": "600" }
      },
      "sidebar": {
        "backgroundColor": "#f8fafc",
        "width": "280px"
      },
      "rightPanel": {
        "backgroundColor": "#0a111f",
        "width": "40%"
      }
    }'
    expand-responses="200,201"
    sort-props-alphabetically
    hide-loading
    suppress-warnings
  ></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
})

// /swagger — UI legado interativa (try-it-out). Mantida para clientes que
// preferem testar requests direto do navegador.
openapiRouter.get('/swagger', (req: Request, res: Response) => {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'http'
  const host = req.headers.host ?? 'localhost:3000'
  const specUrl = `${proto}://${host}/openapi.json`
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>VSaaS — API (Swagger UI)</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0a111f; }
    .topbar { display: none; }
    .swagger-ui .info .title { color: #06b6d4; }
  </style>
</head>
<body>
  <div id="swagger"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: ${JSON.stringify(specUrl)},
      dom_id: '#swagger',
      deepLinking: true,
      docExpansion: 'list',
      tryItOutEnabled: true,
      persistAuthorization: true,
    });
  </script>
</body>
</html>`
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
})
