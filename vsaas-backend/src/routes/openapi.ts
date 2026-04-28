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
      title: 'IA Cloud Vision — VSaaS API',
      version: process.env.npm_package_version ?? '1.0.0',
      description:
        'API multi-tenant B2B2B para analytics de vídeo. ' +
        'JWT Bearer obrigatório em rotas protegidas. ' +
        'Header `X-Edge-Token` em /edge/* para edge agents.',
      contact: { name: 'Suporte', email: 'suporte@iacloudvision.com.br' },
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
      '/health':        { get: { tags: ['health'], summary: 'Liveness', security: [], responses: { 200: { description: 'OK' } } } },
      '/health/ready':  { get: { tags: ['health'], summary: 'Readiness', security: [], responses: { 200: { description: 'OK' }, 503: { description: 'Not ready' } } } },
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
        get: { tags: ['auth'], summary: 'Dados do ator autenticado', responses: { 200: { description: 'OK' }, 401: { description: 'Sem token' } } },
        patch: { tags: ['auth'], summary: 'Atualiza nome/telefone', responses: { 200: { description: 'OK' } } },
      },
      '/push/vapid-public-key': {
        get: { tags: ['push'], summary: 'Chave pública VAPID', security: [], responses: { 200: { description: 'OK' } } },
      },
      '/push/subscribe': {
        post: {
          tags: ['push'], summary: 'Cria/atualiza PushSubscription do navegador',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PushSubscriptionRequest' } } } },
          responses: { 201: { description: 'Created' } },
        },
      },
      '/push/subscriptions': {
        get: { tags: ['push'], summary: 'Lista subscriptions ativas do ator', responses: { 200: { description: 'OK' } } },
      },
      '/push/test': {
        post: { tags: ['push'], summary: 'Dispara push de teste para todas as subscriptions do ator', responses: { 200: { description: 'OK' } } },
      },
      '/triggers': {
        get:  { tags: ['triggers'], summary: 'Lista Semantic Triggers do tenant', responses: { 200: { description: 'OK' } } },
        post: { tags: ['triggers'], summary: 'Cria Semantic Trigger (text/image)', responses: { 201: { description: 'Created' } } },
      },
      '/triggers/{id}': {
        get:    { tags: ['triggers'], summary: 'Detalhe + últimos hits',  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        patch:  { tags: ['triggers'], summary: 'Atualiza',                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        delete: { tags: ['triggers'], summary: 'Remove',                  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'No Content' } } },
      },
      '/triggers/{id}/test': {
        post: { tags: ['triggers'], summary: 'Simula match — retorna score sem disparar ações', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
      },
      '/cameras': {
        get:  { tags: ['cameras'], summary: 'Lista câmeras do tenant', responses: { 200: { description: 'OK' } } },
        post: { tags: ['cameras'], summary: 'Cria câmera', responses: { 201: { description: 'Created' } } },
      },
      '/cameras/{id}': {
        get:    { tags: ['cameras'], summary: 'Detalhe da câmera', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        patch:  { tags: ['cameras'], summary: 'Atualiza câmera',   parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'OK' } } },
        delete: { tags: ['cameras'], summary: 'Remove câmera',     parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'No Content' } } },
      },
      '/cameras/{id}/snapshot': {
        get: {
          tags: ['cameras'],
          summary: 'Snapshot atual',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'variant', in: 'query', required: false, schema: { type: 'string', enum: ['annotated', 'clean'] }, description: 'annotated (com bbox) ou clean (sem overlays)' },
          ],
          responses: { 200: { description: 'image/jpeg ou image/webp' }, 404: { description: 'Câmera ou snapshot não encontrados' } },
        },
      },
      '/review': {
        get: { tags: ['review'], summary: 'Review items', responses: { 200: { description: 'OK' } } },
      },
      '/edge/ingest': {
        post: {
          tags: ['edge'], summary: 'Ingest de evento do edge agent',
          security: [{ EdgeToken: [] }],
          responses: { 200: { description: 'OK' }, 401: { description: 'Token inválido' }, 429: { description: 'Rate limit' } },
        },
      },
    },
    tags: [
      { name: 'health',   description: 'Probes' },
      { name: 'auth',     description: 'Autenticação e perfil' },
      { name: 'cameras',  description: 'Câmeras e configuração' },
      { name: 'review',   description: 'Eventos / review items' },
      { name: 'push',     description: 'WebPush VAPID' },
      { name: 'triggers', description: 'Semantic Triggers' },
      { name: 'edge',     description: 'Edge agents' },
    ],
  }
}

openapiRouter.get('/openapi.json', (req: Request, res: Response) => {
  res.set('Cache-Control', 'public, max-age=300')
  res.json(buildSchema(req))
})

// Swagger UI standalone — único arquivo, sem dep npm. Carrega CSS/JS do CDN.
openapiRouter.get('/docs', (req: Request, res: Response) => {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'http'
  const host = req.headers.host ?? 'localhost:3000'
  const specUrl = `${proto}://${host}/openapi.json`
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>IA Cloud Vision — API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
  <link rel="icon" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='8' fill='%2306b6d4'/></svg>" />
  <style>
    body { margin: 0; background: #0a111f; }
    .topbar { display: none; }
    .swagger-ui .info .title { color: #4A90E2; }
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
