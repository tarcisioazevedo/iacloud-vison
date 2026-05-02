# Diagnóstico Técnico — IA Cloud Vision

**Data:** 2026-05-02
**Autor:** Claude Code (Tech Lead virtual)
**Versão:** 1.0

---

## Sumário Executivo

O IA Cloud Vision é um VMS Cloud multi-tenant construído como fork do Frigate NVR, com uma camada VSaaS completa (23k linhas TS backend + 38k linhas TSX frontend) sobreposta ao core Python. O backbone operacional está funcional: login JWT com 8 roles hierárquicos, CRUD de câmeras com RTSP pull e RTMP push, live WebRTC/WHEP com fallback automático, gravação contínua via ffmpeg com segmentos HLS, playback com timeline minuto-a-minuto, storage multi-tenant S3/R2, e notificações multi-canal (WebPush, WhatsApp, Telegram, e-mail). A arquitetura B2B2B (SuperAdmin → Integrador → ClienteFinal) está madura com tenant-scope em todas as queries. No entanto, o projeto tem **falhas de segurança P0** — credenciais em plaintext commitadas no git (senhas de DB, access keys R2, chave de criptografia AES), **zero testes automatizados** no VSaaS, backend rodando via `tsx` sem compilação em produção, e todas as funcionalidades de IA (face, LPR, PPE, semantic search) são "vitrine" — schema e telas existem, mas sem pipeline de execução real. Para homologação de campo em 120-150 dias, a prioridade absoluta é segurança (rotacionar credenciais), testes mínimos, e estabilizar o pipeline de gravação. O score de prontidão MVP é **52/100**: backbone funcional com gaps críticos.

---

## 1. Inventário Técnico

### 1.1. Stack Completa

| Camada | Tecnologia | Versão | Runtime |
|--------|-----------|--------|---------|
| Backend VSaaS | Express + TypeScript | Express 4.21, TS 5.7 | Node.js 20 Alpine |
| ORM | Prisma Client | 5.22 | — |
| Banco de dados | PostgreSQL | 16 Alpine | Docker |
| Cache | Redis | 7 Alpine | Docker, allkeys-lru 384MB |
| Frontend VSaaS | React + Vite + Tailwind CSS | React 19, Vite 5, TW 3.4 | nginx Alpine |
| Streaming | go2rtc | latest | Docker |
| Gravação | ffmpeg (segmenter nativo) | Alpine pkg | Spawn via backend |
| Mensageria IoT | Eclipse Mosquitto MQTT | 2.0 | Docker |
| WhatsApp | Evolution API | v2.2.3 | Docker |
| Cloud AI | Google Cloud Vision + Vertex AI Vision | — | API calls |
| Analytics | Google BigQuery | — | API calls |
| Storage objetos | Cloudflare R2 + Hetzner S3 | — | S3-compatible |
| Core NVR (herdado) | Python 3.11 (Frigate fork) | ≥3.9 | Não em uso no VSaaS |
| Frigate Manager | Node.js + TypeScript | Prisma 6.0 | Não montado |
| CI/CD | GitHub Actions | — | build-cloud.yml + ci.yml |
| Deploy | Docker Swarm | Compose 3.9 | deploy.sh |

### 1.2. Estrutura de Diretórios

```
iacloud-vison/                     # Raiz do monorepo
├── vsaas-backend/                 # ★ Backend principal (23.188 linhas TS)
│   ├── src/
│   │   ├── routes/                # 37 arquivos de rota
│   │   ├── services/              # 22 serviços
│   │   ├── middleware/            # 8 middlewares
│   │   ├── lib/                   # 18 módulos utilitários
│   │   └── jobs/                  # 2 jobs agendados
│   ├── prisma/
│   │   ├── schema.prisma          # 2.475 linhas, 56 models, 131 indexes
│   │   └── migrations/            # 22 migrations
│   ├── Dockerfile                 # Multi-stage (dev + production)
│   ├── .env                       # ⚠️ COMMITADO com credenciais
│   └── docker-compose.yml         # Dev local
│
├── vsaas-frontend/                # ★ Frontend principal (38.562 linhas TSX/TS)
│   ├── src/
│   │   ├── pages/                 # 42 páginas
│   │   ├── components/            # 26 componentes compartilhados
│   │   ├── api/                   # Client axios + SWR hooks
│   │   ├── hooks/                 # usePushSubscription
│   │   └── lib/                   # utils, csv, theme
│   └── Dockerfile                 # Build Vite + nginx
│
├── frigate/                       # Core Frigate NVR (Python, herdado)
│   ├── api/                       # API Flask do Frigate
│   ├── camera/                    # Câmera processing
│   ├── detectors/                 # YOLO, Coral, ONNX, etc.
│   ├── record/                    # Recording pipeline do Frigate
│   └── ...                        # ~40 subdiretórios Python
│
├── frigate-manager/               # Orchestrator multi-tenant Frigate (não integrado)
│   └── src/                       # Routes, services, types
│
├── web/                           # Frontend Frigate original (não usado no VSaaS)
│   ├── src/                       # React + Vite + i18n (50+ locales)
│   └── e2e/                       # Playwright tests (do Frigate)
│
├── docker/                        # Dockerfiles Frigate (multi-arch: amd64, arm64, rpi, rocm)
├── docker-stack.yml               # ⚠️ Deploy Swarm com credenciais em plaintext
├── deploy.sh                      # Script automatizado de deploy
├── docker-compose.yml             # Dev compose original do Frigate
├── config/                        # Config Frigate YAML
├── scripts/                       # backup-postgres.sh
├── secrets/                       # s3.env, jwt_secret.txt (gitignored)
└── docs/                          # Docusaurus (herdado do Frigate)
```

### 1.3. Serviços Docker (docker-stack.yml)

| Serviço | Imagem | Porta | RAM limit | Função |
|---------|--------|-------|-----------|--------|
| `postgres` | postgres:16-alpine | — (interno) | 1024M | Banco principal |
| `redis` | redis:7-alpine | — (interno) | 512M | Cache + rate limit |
| `mqtt` | eclipse-mosquitto:2.0 | 1883 (host), 9001 (ws) | 256M | IoT messaging |
| `evolution` | atendai/evolution-api:v2.2.3 | 8081 (host) | 512M | WhatsApp API |
| `backend` | icv_backend:latest | 3000 (host) | 1024M | API VSaaS |
| `go2rtc` | alexxit/go2rtc:latest | 1935,1984,8554,8555 | 1024M | RTSP/RTMP/WebRTC |
| `frontend` | icv_frontend:latest | 8082 (host) | 256M | SPA nginx |

**Total alocado:** ~4.6 GB RAM. VPS com 7.6 GB disponível.
**Capacidade estimada (comentário no código):** 60-80 câmeras streaming simultâneo, 200+ cadastradas, ~20k eventos/hora.

### 1.4. Banco de Dados

**Engine:** PostgreSQL 16 Alpine
**ORM:** Prisma 5.22 com `schema.prisma` de 2.475 linhas
**Models:** 56 modelos Prisma
**Indexes:** 131 (`@@index` + `@@unique`)
**Migrations:** 22 versionadas (2026-04-24 a 2026-05-01)

**Principais entidades:**

| Modelo | Linhas | Função |
|--------|--------|--------|
| `SuperAdmin` | ~12 | Admin global da plataforma |
| `Integrador` | ~45 | Revendedor B2B (tenant principal) |
| `ClienteFinal` | ~55 | Cliente do integrador |
| `User` | ~35 | Usuário com role (8 níveis) |
| `Site` | ~18 | Unidade física (filial, loja) |
| `EdgeNode` | ~60 | Nó edge (RPi5, NUC, Jetson) |
| `Camera` | ~200 | Câmera IP (maior model: config RTSP, ffmpeg, detector, motion, zones, record, audio, PTZ, ONVIF, Vertex) |
| `CameraZone` | ~25 | Zona de analytics (polígono, tripwire, heatmap) |
| `RecordingSegment` | ~10 | Segmento .ts de gravação |
| `AnalyticsEvent` | ~60 | Evento de IA detectado |
| `AuditLog` | ~20 | Log de auditoria LGPD |
| `ApiQuota` / `Invoice` | ~20/~20 | Billing e quota por integrador |
| `ReviewItem` | ~15 | Item de revisão (alert/detection) |
| `FaceIdentity` / `FaceRecognitionEvent` | ~10/~15 | Face recognition |
| `LicensePlate` / `LicensePlateEvent` | ~10/~15 | LPR |
| `NotificationChannel` / `NotificationLog` | ~10/~10 | WhatsApp Evolution |
| `AlertConfig` / `AlertRecipient` | ~15/~10 | Configuração de alertas |
| `EdgeCommand` / `EdgeHeartbeat` | ~15/~15 | Comunicação Cloud↔Box |
| `PortalAccessToken` | ~20 | Magic-link portal cliente final |

### 1.5. APIs e Endpoints

**Total:** 37+ arquivos de rota, estimativa de ~120 endpoints REST.

| Prefixo | Arquivo | Auth | Função |
|---------|---------|------|--------|
| `POST /auth/login` | auth.ts | Público | Login JWT |
| `POST /auth/register` | auth.ts | requireRole(SUPER_ADMIN) | Registro integrador |
| `GET/POST /cameras` | cameras.ts | requireAuth | CRUD câmeras (wizard) |
| `POST /cameras/:id/test` | cameras.ts | requireAuth | Teste RTSP |
| `GET/POST /sites` | sites.ts | requireAuth | CRUD sites |
| `GET /live/:id/whep` | live.ts | ticket JWT | WebRTC WHEP proxy |
| `GET /live/:id/snapshot-jpeg` | live.ts | ticket JWT | Frame JPEG via ffmpeg |
| `POST /playback/token` | playback.ts | requireAuth | Ticket para HLS |
| `GET /playback/:id/manifest.m3u8` | playback.ts | ticket query | Manifest HLS dinâmico |
| `GET /playback/:id/timeline` | playback.ts | requireAuth | Bitmap 1440 min/dia |
| `GET /edge-nodes` | edge-nodes.ts | requireAuth | CRUD edge nodes |
| `POST /iacv-box/heartbeat` | iacv-box.ts | x-edge-token | Heartbeat do box |
| `POST /iacv-box/events` | iacv-box.ts | x-edge-token | Eventos do Frigate |
| `POST /edge/ingest` | edge.ts | x-edge-token | Ingest de analytics |
| `GET/POST /faces` | faces.ts | requireAuth | Face library |
| `GET/POST /plates` | plates.ts | requireAuth | License plates |
| `GET /review` | review.ts | requireAuth | Review items |
| `GET /bi/dashboard` | bi.ts | requireAuth | Dashboard KPIs |
| `GET /audit` | audit.ts | requireAuth | Audit logs |
| `GET /quota/status` | quota.ts | requireAuth | Quota usage |
| `POST /push/subscribe` | push.ts | requireAuth | WebPush VAPID |
| `POST /triggers` | triggers.ts | requireAuth | Semantic triggers |
| `POST /leads` | leads.ts | Público | Funil de leads |
| `GET /admin/integradores` | integradores.ts | requireRole(SUPER_ADMIN) | CRUD integradores |
| `GET /modules` | modules.ts | requireAuth | Módulos por tenant |
| `POST /portal/exchange` | portal.ts | Público (token) | Magic-link exchange |
| `GET /notifications` | notifications.ts | requireAuth | WhatsApp/Telegram |
| `GET /fleet` | fleet.ts | requireAuth | Fleet management |
| `GET /storage/stats` | storage-config.ts | requireAuth | Storage S3 stats |
| `GET /storage/browse` | storage-config.ts | requireAuth | S3 file browser |
| `GET /health` | app.ts (inline) | Público | Healthcheck |
| `GET /pricing` | app.ts (inline) | Público | Planos comerciais |
| `GET /openapi.json` | openapi.ts | Público | Spec OpenAPI |

### 1.6. Pipeline de Mídia

```
CÂMERA                     CLOUD (VPS)                      STORAGE
──────                     ────────────                     ───────

 ┌─────────┐  RTSP pull   ┌──────────┐
 │ Câmera  │◄────────────│  go2rtc  │
 │  (LAN)  │              │  :8554   │
 └─────────┘              └────┬─────┘
                               │ RTSP out
 ┌─────────┐  RTMP push  ┌────┴─────┐     ┌──────────────┐
 │ Câmera  │─────────────►│  go2rtc  │────►│ ffmpeg       │
 │  (NAT)  │  :1935      │  API     │     │ -c:v copy    │
 └─────────┘              │  :1984   │     │ -f segment   │──► /recordings/{cam}/{date}/{HH-MM-SS}.ts
                          └────┬─────┘     │ -segment 6s  │         │
                               │            └──────────────┘         │
                               │ WebRTC/WHEP                         │ upload async
                          ┌────┴─────┐                          ┌────▼─────┐
                          │ Browser  │                          │  R2/S3   │
                          │ (live)   │                          │ (bucket  │
                          └──────────┘                          │  /integ) │
                                                                └────┬─────┘
                          ┌──────────┐                               │
                          │ HLS.js   │◄──── manifest.m3u8 ◄──────────┘
                          │ (playback)│     segments .ts
                          └──────────┘
```

**Ingestão:** Duas modalidades — RTSP_PULL (backend puxa da câmera via go2rtc) e RTMP_PUSH (câmera empurra RTMP para go2rtc:1935, atravessa NAT).
**Live:** WebRTC/WHEP via go2rtc (sub-segundo latência), fallback automático para snapshot-poll (frame JPEG a cada 5s via ffmpeg do backend).
**Gravação:** Supervisor em `recording.service.ts` spawna 1 processo ffmpeg por câmera. Copy H.264 sem transcode (CPU ~zero). Segmentos de 6s em .ts. Reconcile a cada 30s.
**Storage:** Local + upload assíncrono para R2/S3 (bucket-per-integrador). Retention job horário remove segmentos expirados.
**Playback:** Manifest HLS dinâmico construído on-demand a partir de `RecordingSegment` no DB. Timeline bitmap de 1440 minutos. Auth via ticket JWT no query string.

### 1.7. Frontend

**Framework:** React 19 + Vite 5 + Tailwind CSS 3.4 + TypeScript 5.5
**State:** SWR para data fetching, useState local
**Routing:** React Router DOM 6.22
**UI:** Glassmorphism theme, dark/light mode, Lucide icons, Framer Motion
**Mapas:** Leaflet + react-leaflet + marker clusters
**Charts:** Recharts
**Player:** HLS.js (playback), RTCPeerConnection nativo (live)

**42 páginas, incluindo:**

| Página | Função | Status |
|--------|--------|--------|
| LoginPage | Auth JWT | ✅ Funcional |
| DashboardPage | KPIs, charts, stats | ✅ Funcional |
| CamerasPage | Grid/list de câmeras + wizard | ✅ Funcional |
| CameraDetailPage | Detalhe + config de câmera | ✅ Funcional |
| LivePage | Mosaico multi-câmera live | ✅ Funcional |
| RecordingsPage | Playback HLS + storage + config | ✅ Funcional |
| ReviewPage | Eventos/alarmes | ✅ Funcional |
| SitesPage | CRUD de sites | ✅ Funcional |
| EdgeNodesPage | Edge nodes + telemetria | ✅ Funcional |
| FleetPage | Fleet management | ✅ Funcional |
| FacesPage | Face library | ⚠️ Tela OK, sem pipeline ML |
| PlatesPage | License plates | ⚠️ Tela OK, sem OCR engine |
| SemanticSearchPage | Busca semântica | ⚠️ Tela OK, sem embeddings |
| HeatmapPage | Mapas de calor | ⚠️ Tela OK, sem dados reais |
| DemographicsPage | Demografia | ⚠️ Tela OK, sem dados reais |
| PpePage | Auditoria EPI | 🔴 PlaceholderPage |
| SettingsPage | Configurações | ✅ Funcional |
| UsersPage | Gestão de usuários | ✅ Funcional |
| ClientesFinaisPage | Clientes finais | ✅ Funcional |
| AuditPage | Auditoria LGPD | ✅ Funcional |
| LeadsPage | CRM de leads | ✅ Funcional |
| QuotaPage | Quota/billing | ✅ Funcional |
| CameraMapPage | Mapa Leaflet | ✅ Funcional |
| TriggersPage | Triggers semânticos | ✅ Funcional |
| MqttConsolePage | Console MQTT | ⚠️ Tela OK, integração parcial |
| PortalEntryPage/PortalHomePage | Portal white-label | ✅ Funcional |

### 1.8. Multi-tenancy

**Modelo:** Row-level security via Prisma queries com filtro por `integradorId` / `clienteFinalId`.

```
SuperAdmin (1)
 └── Integrador (N)          # tenant principal
      ├── ClienteFinal (N)    # cliente do integrador
      │    ├── Site (N)       # filial/loja
      │    │    ├── EdgeNode (N)  # box local
      │    │    └── Camera (N)    # câmera IP
      │    └── User (N)      # roles: CLIENTE_ADMIN, SUPERVISOR, OPERADOR, VIEWER
      └── User (N)            # roles: INTEGRADOR_ADMIN, INTEGRADOR_TECNICO
```

**Implementação:**
- `middleware/tenant-context.ts` — extrai tenant do header `X-ICV-Tenant` (Cloudflare Worker) ou JWT
- `lib/tenant-scope.ts` — funções `requireCameraForUser()`, `resolveIntegradorId()` que adicionam WHERE clauses
- Todas as queries de listagem filtram por integradorId/clienteFinalId conforme JWT
- Storage: bucket separado por integrador (`icv-{integradorId}` no R2)

### 1.9. Autenticação / Autorização

**Auth:** JWT HS256, expiração 8h, emitido em `POST /auth/login`
**Roles (8 níveis):** SUPER_ADMIN, ADMIN_GLOBAL, INTEGRADOR_ADMIN, INTEGRADOR_TECNICO, CLIENTE_ADMIN, CLIENTE_SUPERVISOR, CLIENTE_OPERADOR, CLIENTE_VIEWER
**Middleware:**
- `softAuth` — decodifica JWT sem enforcement (rate limiter usa)
- `requireAuth` — barra sem JWT válido
- `requireRole(...roles)` — verifica role no JWT
- `proxyAuth` — aceita auth via header de proxy reverso (Authentik/Authelia)
- `edge-auth.ts` — auth via `x-edge-token` para edge nodes
- `block-read-only.ts` — bloqueia writes para roles viewer

**Features avançadas:**
- Impersonation (SUPER_ADMIN simula sessão de outro user)
- Force change password no primeiro login
- Portal magic-link (token SHA-256, single-use opcional)
- Technician access ACL (técnico ↔ clientes finais)

### 1.10. Observabilidade

**No VSaaS backend:**
- Logger: Pino + pino-http (structured JSON, request-id correlation)
- Healthchecks: `/health/live` (liveness), `/health/ready` (readiness com DB check)
- Rate limiting: express-rate-limit por tenant JWT / IP
- Graceful shutdown: `process-guards.ts` com SIGTERM/SIGINT handler

**Na infra (mencionado pelo user, não verificável nos arquivos do repo):**
- Prometheus, Grafana, Alertmanager em `/opt/stacks/`
- Uptime Kuma, Zabbix 7 instalados
- Overlay networks `proxy` e `monitoring-net`

**Faltando no VSaaS:**
- 🔴 Sem métricas Prometheus expostas pelo backend (sem `/metrics` endpoint)
- 🔴 Sem tracing distribuído (OpenTelemetry, Jaeger)
- 🔴 Sem dashboards Grafana específicos para o VSaaS
- 🔴 Sem alertas para falha de gravação, câmera offline, quota excedida

---

## 2. Matriz de Funcionalidades VMS

| # | Funcionalidade | Status | Evidência | Esforço para completar |
|---|---------------|--------|-----------|----------------------|
| 1 | Cadastro de câmeras RTSP | ✅ Funcional | `routes/cameras.ts` + `AddCameraWizard.tsx`, teste de conectividade `rtsp-test.service.ts` | — |
| 2 | Cadastro RTMP push (NAT traversal) | ✅ Funcional | `ingestMode: RTMP_PUSH`, `rtmpIngestKeyEnc`, go2rtc :1935 | — |
| 3 | ONVIF discovery | ❌ Faltando | Schema tem `onvifHost/Port/Username/PasswordEnc` mas sem service de probe. `routes/cameras.ts:242-245` só persiste campos manuais | 3-5 dias (lib onvif + scan) |
| 4 | Multi-tenancy hierárquico | ✅ Funcional | 3 níveis (Integrador→CF→Site→Camera), tenant-scope em todas queries | — |
| 5 | Live view single câmera | ✅ Funcional | `LivePlayer.tsx`: WebRTC/WHEP + fallback snapshot-poll. Auto-reconnect com backoff exponencial | — |
| 6 | Mosaico multi-câmera | 🟡 Parcial | `LivePage.tsx` monta grid de LivePlayers, mas sem layout fixo 4/9/16/36. Testado com múltiplas câmeras | 2-3 dias (grid presets) |
| 7 | Gravação 24/7 contínua | ✅ Funcional | `recording.service.ts`: supervisor ffmpeg, copy H.264, segmentos 6s, reconcile 30s, recovery automático | — |
| 8 | Gravação por evento/movimento | 🟡 Parcial | `RecordingMode.MOTION` existe no schema mas service trata como ALL. Comentário: "Motion-gating é P1" (`recording.service.ts:17`) | 5-8 dias (integração edge/detector) |
| 9 | Gravação por agendamento | ❌ Faltando | Sem modelo Schedule/Agenda no schema, sem UI de agenda | 3-5 dias |
| 10 | Pipeline de transcoding adaptativo | ❌ Faltando | ffmpeg faz copy H.264 sem transcode. Sem SD/HD adaptativo | 8-15 dias (complexo) |
| 11 | Storage S3 com lifecycle/retenção | ✅ Funcional | R2 + Hetzner S3, bucket-per-integrador, `storageRetainDays` configurável 1-365, retention job horário | — |
| 12 | Playback HLS com timeline | ✅ Funcional | `playback.ts` + `PlaybackPlayer.tsx` + `PlaybackTimelineZoom.tsx`: manifest dinâmico, bitmap 1440min, date picker | — |
| 13 | Timeline multi-câmera sincronizada | ❌ Faltando | Playback é single-camera. Sem view side-by-side temporal | 5-8 dias |
| 14 | Snapshot/clip download | ❌ Faltando | Snapshot live existe (`/live/:id/snapshot-jpeg`), mas sem download de clip recortado por range temporal | 3-5 dias |
| 15 | Health monitoring de câmeras | ✅ Funcional | `camera-watchdog.service.ts`: tick 60s, offline detection, recovery, alertas, healthScore 0-100 | — |
| 16 | Mudança de cena (scene change) | ❌ Faltando | Sem implementação | 5-8 dias |
| 17 | Eventos e alarmes | ✅ Funcional | `AnalyticsEvent` + `ReviewItem`, `AlertConfig` + `AlertRecipient`, severity levels, status workflow | — |
| 18 | Notificações push web | ✅ Funcional | WebPush VAPID, `usePushSubscription.ts`, cooldown anti-spam configurável por câmera | — |
| 19 | Notificações Telegram | ✅ Funcional | `telegram.ts` route, bot por cliente final, chatId por user | — |
| 20 | Notificações webhook | 🟡 Parcial | `trigger-executor.service.ts` existe mas sem endpoint de webhook genérico para integração | 2-3 dias |
| 21 | Auditoria LGPD | ✅ Funcional | `AuditLog`, `LgpdDataRequest`, evidence TTL 72h, lifecycle GCS, `audit.ts` route | — |
| 22 | White-label (logo, cores, domínio) | 🟡 Parcial | `primaryColor/secondaryColor`, `portalSlug`, `cfSubdomain`, `CustomDomain` model — mas sem logo dinâmico CSS | 3-5 dias |
| 23 | App mobile / PWA cliente final | ❌ Faltando | Portal web responsivo existe, mas sem service worker, manifest PWA, ou app nativo | 8-15 dias (PWA) |
| 24 | API pública para integração | 🟡 Parcial | `/openapi.json` + `/docs` (Swagger UI) existem. Endpoints existem mas spec não está completa | 3-5 dias (documentar) |
| 25 | Dashboards consumo (storage, banda) | ✅ Funcional | `RecordingsPage` tab Storage com stats + browser S3, `QuotaPage` com uso/limite | — |
| 26 | Onboarding self-service integrador | 🟡 Parcial | Funil de leads (`LeadsPage`), demo invites, conversão lead→integrador. Mas onboarding post-conversão é manual | 5-8 dias |
| 27 | Integração SW alarme (Sigma, Moni) | ❌ Faltando | Sem API/webhook para receivers de alarme. Sem protocolo ContactID/SIA | 10-20 dias |

---

## 3. Top 15 Débitos Técnicos por Criticidade

| ID | Descrição | Arquivo / Linha | Crit. | Esforço | Risco se ignorar |
|----|-----------|----------------|-------|---------|-----------------|
| DT-01 | **Credenciais em plaintext no docker-stack.yml** (commitado). Senha DB (`6NuBX8WPEmpWbknN72VrggacUQsxdLytPM1fDZxnGz4=`), ICV_ENCRYPTION_KEY, R2 keys, VAPID keys, SMTP password, Evolution API key — tudo visível | `docker-stack.yml:162,207-208,228-243` | **P0** | 2h | Comprometimento total se repo vazar. Clone = acesso ao DB, storage, criptografia |
| DT-02 | **`.env` com credenciais commitado no git**. `.gitignore` tem `*.env` mas o arquivo já existia antes da regra | `vsaas-backend/.env` (55 linhas) | **P0** | 1h | Histórico git contém segredos mesmo após remoção |
| DT-03 | **Zero testes automatizados no VSaaS**. `vitest` no package.json mas 0 arquivos de teste. Frontend sem testes. Testes do Frigate (web/e2e) são do código herdado, não do VSaaS | `vsaas-backend/package.json:16` | **P0** | 5-10 dias (suite mínima) | Qualquer mudança pode quebrar funcionalidades sem detecção. Inaceitável para campo |
| DT-04 | **Backend produção roda via `tsx`** (esbuild runtime) sem compilação TypeScript. `tsc` foi abandonado por erros de tipo (TS6059). `npx tsx` resolve pacote a cada start | `vsaas-backend/Dockerfile:22` | **P1** | 2-3 dias (fix TS errors) | Startup lento, sem type-checking, sem tree-shaking, risco de erros de tipo em runtime |
| DT-05 | **Gravação por movimento é stub**. Schema `RecordingMode.MOTION`, config tab no frontend permite selecionar, mas service grava 24/7 sempre. Comentário explícito | `recording.service.ts:17` ("Motion-gating é P1") | **P1** | 5-8 dias | Storage 5-10x maior que prometido ao cliente. Custo explode |
| DT-06 | **Pipeline de IA é "vitrine"**. Face, LPR, PPE, GenAI, Semantic Search — schema + telas + rotas existem mas sem pipeline de execução ML real | `vertex-face.service.ts`, `vision.service.ts`, etc. | **P1** | 20-40 dias (por módulo) | Cliente compra IA e recebe telas vazias. Risco reputacional |
| DT-07 | **CORS aceita wildcard para redes privadas**. `origin.startsWith('http://192.168.')` permite qualquer máquina na LAN | `app.ts:78-79` | **P1** | 1h | CSRF/data exfiltration em redes corporativas compartilhadas |
| DT-08 | **Sem backup automatizado do PostgreSQL**. `scripts/backup-postgres.sh` existe mas não está agendado (sem cron, sem job no deploy) | `scripts/backup-postgres.sh` | **P1** | 2h (cron + S3 upload) | Perda total de dados em caso de crash/corruption do volume |
| DT-09 | **Sem SSL/TLS**. docker-stack.yml expõe portas HTTP diretas. Sem Caddy/Traefik/nginx TLS. Referências a `https://app.iacloud.com.br` assumem proxy externo | `docker-stack.yml` (todas as portas em `mode: host`) | **P1** | 4h (Caddy + Let's Encrypt) | Tráfego em texto claro. Credenciais JWT interceptáveis. Inaceitável em produção |
| DT-10 | **ONVIF discovery inexistente**. Campos no schema, mas sem service de scan. Cadastro 100% manual | `routes/cameras.ts:242-245` (só persiste campos) | **P2** | 3-5 dias | Competidores têm auto-discovery. Setup demorado pra integrador |
| DT-11 | **Frigate Manager não integrado**. Módulo escrito com exports, routes, services — mas `mountFrigateManager(app)` nunca chamado no `app.ts` | `frigate-manager/src/index.ts` vs `vsaas-backend/src/app.ts` | **P2** | 2 dias | Orquestração multi-tenant de Frigate desconectada do VSaaS |
| DT-12 | **Inconsistência de versão Prisma**. Backend usa 5.22, frigate-manager usa 6.0 | `vsaas-backend/package.json` vs `frigate-manager/package.json` | **P2** | 1h | Schema incompatível se tentar compartilhar Prisma client |
| DT-13 | **Sem métricas Prometheus no backend**. Observabilidade da infra existe (Prometheus/Grafana instalados), mas o backend não expõe `/metrics` | Nenhum `prom-client` no package.json | **P2** | 4h (prom-client + middleware) | Sem visibilidade de performance, latência, erros do VSaaS |
| DT-14 | **MQTT sem autenticação**. Mosquitto configurado com `allow_anonymous true` | `deploy.sh:86-91` | **P2** | 1h | Qualquer cliente na rede pode publicar mensagens MQTT |
| DT-15 | **`gcp-service-account.json` é placeholder vazio (`{}`)**. BigQuery, GCS, Vertex AI não funcionam em produção sem credencial real | `vsaas-backend/gcp-service-account.json` (3 bytes) | **P3** | Config (não código) | Funcionalidades GCP são silenciosamente ignoradas (try/catch swallow) |

---

## 4. Riscos de Go-to-Market

### P0 — Bloqueantes

| # | Risco | Impacto | Mitigação |
|---|-------|---------|-----------|
| R1 | **Vazamento de credenciais** via git history. docker-stack.yml e .env já commitados com senhas reais | Comprometimento total | Rotacionar TODAS as credenciais imediatamente. `git filter-branch` ou BFG Repo-Cleaner. Mover para Docker secrets / env externo |
| R2 | **Sem testes = sem confiança para deploy**. Qualquer hotfix pode quebrar gravação, auth, ou playback | Downtime em produção | Sprint de 5 dias: testes para auth, CRUD câmeras, recording service, playback |
| R3 | **Sem SSL em produção**. JWT e credenciais trafegam em texto claro se proxy não estiver configurado | Interceptação de sessão | Caddy/Traefik com Let's Encrypt na frente do stack |
| R4 | **Sem backup do PostgreSQL**. Volume Docker em disco local, sem redundância | Perda total de dados | Cron pg_dump + upload S3 diário |

### P1 — Alto risco

| # | Risco | Impacto | Mitigação |
|---|-------|---------|-----------|
| R5 | **Storage explode sem motion-gating**. Clientes configuram "Movimento" mas gravam 24/7 | Custo 5-10x. Cliente reclama | Implementar motion-gating real OU comunicar limitação e ajustar pricing |
| R6 | **IA é promessa sem entrega**. Telas de Face, LPR, PPE existem mas sem processamento | Risco reputacional. Churn de integrador | Esconder telas não funcionais no MVP OU implementar pipeline mínimo para 1 módulo (LPR é mais impactante para integradores) |
| R7 | **Performance com 60+ câmeras não validada**. 60 processos ffmpeg + go2rtc + Node.js em 1 VPS 4 CPU / 8GB | Saturação de CPU/RAM/IO. Drops de frame | Load test real antes de homologar. go2rtc copy é leve, mas 60 ffmpeg simultâneos competem por IO |
| R8 | **Single point of failure**. Tudo em 1 VPS — se o hardware falhar, tudo cai | Downtime total | Aceitar para MVP, mas ter snapshot/backup do volume e plano de recovery documentado (RTO < 2h) |

### P2 — Médio risco

| # | Risco | Impacto | Mitigação |
|---|-------|---------|-----------|
| R9 | **Sem ONVIF = setup manual**. Concorrentes (Monuv, Segware) têm auto-discovery. Integrador perde tempo | Experiência inferior. Churn | Implementar ONVIF scan básico (probe multicast + GetProfiles) |
| R10 | **Sem integração com SW de alarme** (Sigma, Moni, Commbox). Integradores já usam esses sistemas | Inviável como substituto completo | Implementar webhook genérico + adapter para Sigma/Moni |
| R11 | **Custo unitário não mensurado**. Sem benchmark de storage/banda por câmera. Pricing pode estar errado | Margin squeeze ou preço alto demais | Benchmark: 1 câmera 1080p H.264 @15fps ≈ 2-3 GB/dia. 30 dias ≈ 60-90 GB. Custo S3 Hetzner ≈ €0.006/GB = ~€0.36-0.54/mês por câmera |
| R12 | **Sem disaster recovery documentado**. RTO/RPO não definidos | Sem SLA para cliente | Documentar: RPO = último backup (1 dia), RTO = 2h (restore de snapshot + redeploy) |

---

## 5. Score de Prontidão MVP: **52/100**

### Justificativa por categoria:

| Categoria | Peso | Score | Justificativa |
|-----------|------|-------|---------------|
| **Core VMS** (live, gravação, playback) | 25% | 80 | Live WebRTC funcional com fallback robusto. Gravação 24/7 com recovery. Playback HLS com timeline. Motion-gating é stub. Sem clip download. |
| **Multi-tenancy & Auth** | 15% | 90 | 3 níveis B2B2B completos. 8 roles. Tenant-scope em todas queries. Impersonation. Portal magic-link. Technician ACL. Muito sólido. |
| **Segurança** | 20% | 15 | Credenciais em plaintext no git (P0). Sem SSL documentado. CORS permissiva. tsx em prod sem type-check. MQTT sem auth. **Bloqueante.** |
| **UI/UX Frontend** | 10% | 75 | 42 páginas. Design glassmorphism coerente. Dark/light mode. Responsivo. Wizard de câmera. Muitas telas são polidas. |
| **IA / Analytics** | 10% | 20 | Schema e telas de Face, LPR, PPE, Semantic Search existem. Pipeline de execução = zero. É "vitrine" sem motor. |
| **Infraestrutura** | 10% | 50 | Docker Swarm funcional. Deploy automatizado. Healthchecks. Mas sem backup, sem SSL, sem HA, sem métricas Prometheus. |
| **Testes & Qualidade** | 10% | 5 | Zero testes no VSaaS. Vitest configurado mas vazio. Sem lint no CI. Sem code review automatizado. |

**Cálculo ponderado:**
(0.25 × 80) + (0.15 × 90) + (0.20 × 15) + (0.10 × 75) + (0.10 × 20) + (0.10 × 50) + (0.10 × 5) = **52.0**

**Interpretação:** Backbone funcional com gaps críticos. O projeto tem uma base sólida de multi-tenancy, streaming e UI, mas as falhas de segurança e a ausência de testes impedem qualquer deploy em campo. Com 2-3 semanas focadas em segurança + testes mínimos + SSL, o score subiria para ~65 (piloto controlado viável).

---

## 6. Perguntas Pendentes para Tarcísio

1. **As credenciais no docker-stack.yml são as de produção real?** O arquivo tem senha PostgreSQL, R2 access keys, ICV_ENCRYPTION_KEY, VAPID keys em plaintext. Se o repo foi compartilhado com qualquer pessoa, TODAS precisam ser rotacionadas imediatamente.

2. **Existe proxy reverso (Caddy/Nginx/Traefik) na frente do stack?** O docker-stack.yml expõe portas HTTP diretas. Se app.iacloud.com.br está em HTTPS, quem faz SSL termination? Está na stack de proxy em `/opt/stacks/`?

3. **O Frigate core (Python) será usado em produção?** O repo tem todo o código do Frigate, mas o backend VSaaS opera independentemente via go2rtc/ffmpeg. O `frigate-manager` foi escrito mas nunca montado no `app.ts` — foi abandono intencional ou esquecimento?

4. **Quais módulos de IA são prioridade para homologação?** Face Recognition, LPR, PPE, Semantic Search, GenAI — todos modelados sem pipeline. Qual é a expectativa dos integradores que vão testar?

5. **O IACV Box (edge RPi5) está funcional em campo?** Os endpoints `/iacv-box/*` existem e são robustos (heartbeat, events, commands), mas dependem de firmware no RPi5. Existe hardware pronto para teste?

6. **Quantas câmeras o piloto vai ter?** Impacta decisão de infra: 10 câmeras cabem no VPS atual tranquilo. 100+ podem precisar de scale-out ou otimização do supervisor de gravação.

7. **O frontend Frigate original (`web/`) ainda é necessário?** Ocupa ~30MB no repo, tem CI/CD próprio, 50+ locales. Se o `vsaas-frontend` substitui, pode ser removido para reduzir noise.

8. **A integração com Prometheus/Grafana/Zabbix que já está em `/opt/stacks/` está monitorando o stack do VSaaS?** Ou só monitora infra base?

9. **Qual o SLA esperado pelos integradores?** Uptime 99.5%? 99.9%? Recovery em minutos ou horas? Isso define se precisamos de HA antes do MVP ou se aceita single VPS.

10. **Existe contrato/termo de uso LGPD?** O schema tem `LgpdDataRequest` e evidence TTL, mas compliance LGPD exige DPO nomeado, termo de uso do operador, e política de retenção documentada.

---

*Relatório gerado por análise automatizada do codebase em 2026-05-02. Todas as afirmações baseadas em leitura direta dos arquivos — sem suposições. Caminhos de arquivo e trechos de código citados como evidência.*
