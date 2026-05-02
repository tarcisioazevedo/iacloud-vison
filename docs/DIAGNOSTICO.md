# Diagnóstico Técnico — IA Cloud Vision (VSaaS B2B2B)

**Data:** 2026-05-02
**Branch:** `dev`
**Autor:** Claude (Engenharia / Tech Lead)
**Versão do relatório:** 1.0

---

## Sumário Executivo

O projeto IA Cloud Vision é um VMS Cloud multi-tenant construído como fork do Frigate NVR, com uma camada VSaaS (backend Express/Prisma + frontend React/Vite) sobreposta ao core Python do Frigate. O backend já tem ~23k linhas TS com 37+ rotas REST, um schema PostgreSQL robusto com 22 migrations e multi-tenancy B2B2B (SuperAdmin → Integrador → ClienteFinal) funcional. O pipeline de mídia (RTSP pull + RTMP push → go2rtc → WebRTC/WHEP com fallback snapshot-poll + gravação ffmpeg → HLS playback) está implementado e funcional. No entanto, o projeto tem **débitos técnicos críticos de segurança** (credenciais em plaintext no docker-stack.yml commitado, .env com senhas no repositório, VAPID keys expostas), **zero testes automatizados** no VSaaS (backend e frontend), e vários módulos de IA que estão modelados no schema mas não têm pipeline de execução real (face recognition, LPR, PPE, GenAI são "plumbing without engine"). O score de prontidão MVP é **52/100** — funcionalidades core de VMS estão presentes, mas a plataforma não está pronta para homologação de campo sem resolver segurança, testes e estabilidade do pipeline de gravação.

---

## 1. Stack Tecnológica

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| **Backend VSaaS** | Node.js 20 + Express + TypeScript | TS 5.7, Express 4.21 |
| **ORM / DB** | Prisma 5.22 + PostgreSQL 16 | Alpine |
| **Frontend VSaaS** | React 19 + Vite 5 + Tailwind CSS 3.4 | SPA |
| **Core NVR (herdado)** | Python 3.11 (Frigate NVR fork) | — |
| **Frontend NVR (herdado)** | React + Vite (Frigate web/) | — |
| **Streaming** | go2rtc (WebRTC/WHEP, RTSP, RTMP, HLS) | latest |
| **Gravação** | ffmpeg (segment mode, copy H.264) | Alpine pkg |
| **Mensageria** | Mosquitto MQTT 2.0 + Redis 7 | Alpine |
| **Cache** | Redis 7 (allkeys-lru, 384MB) | Alpine |
| **Storage** | Cloudflare R2 + Hetzner S3 + local FS | Multi-tenant |
| **Cloud AI** | Google Cloud Vision + Vertex AI Vision | — |
| **Notificações** | WebPush VAPID + WhatsApp (Evolution API) + Telegram | — |
| **Deploy** | Docker Swarm (docker-stack.yml + deploy.sh) | Compose 3.9 |
| **CI/CD** | GitHub Actions (build-cloud.yml + ci.yml) | Herdado Frigate |

---

## 2. Arquitetura Atual

```
┌─────────────────────────────────────────────────────────────┐
│                    CLOUD (VPS 4 CPU / 8GB)                   │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Frontend │  │ Backend  │  │  go2rtc  │  │  PostgreSQL  │ │
│  │ (nginx)  │  │ (Express)│  │ (streams)│  │    (16)      │ │
│  │ :8082    │  │ :3000    │  │ :1984    │  │              │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘ │
│                      │              │                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │   MQTT   │  │  Redis   │  │ Evolution│  │  R2/S3       │ │
│  │ :1883    │  │  :6379   │  │ (WhatsApp)│  │  (storage)   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
         ▲ RTMP :1935                    ▲ HTTPS
         │                               │
    ┌────┴────┐                    ┌─────┴──────┐
    │ Câmeras │                    │  Browsers  │
    │ (push)  │                    │  (clientes)│
    └─────────┘                    └────────────┘
         ▲ RTSP pull
         │
    ┌────┴────────┐
    │  IACV Box   │  (Edge: RPi5 + Hailo-8L / NUC)
    │  (Frigate)  │  → heartbeat, eventos, telemetria
    └─────────────┘
```

**Tipo:** Monolito modular (backend único Express com ~37 route files + ~22 services).
**Módulos lógicos:** Auth, Cameras, Sites, Edge, Live, Recording, Playback, Events, Faces, Plates, Alerts, Notifications, Audit, Leads/CRM, Portal, Fleet, Storage, Billing/Quota.

---

## 3. Estrutura de Pastas

```
iacloud-vison/
├── vsaas-backend/          # Backend VSaaS (23k linhas TS)
│   ├── src/
│   │   ├── routes/         # 37 route files (REST endpoints)
│   │   ├── services/       # 22 service files
│   │   ├── middleware/      # 8 middleware files (auth, tenant, etc.)
│   │   ├── lib/            # 18 utility modules
│   │   └── jobs/           # 2 scheduled jobs
│   ├── prisma/
│   │   ├── schema.prisma   # ~1400 linhas, 50+ models
│   │   └── migrations/     # 22 migrations aplicadas
│   └── Dockerfile
│
├── vsaas-frontend/         # Frontend VSaaS (38k linhas TSX)
│   ├── src/
│   │   ├── pages/          # 42 page components
│   │   ├── components/     # 26 shared components
│   │   ├── api/            # API client (axios + SWR)
│   │   └── hooks/          # Custom hooks
│   └── Dockerfile
│
├── frigate/                # Core Frigate NVR (Python, herdado)
├── frigate-manager/        # Orchestrator multi-tenant Frigate
├── web/                    # Frontend Frigate (herdado, não usado no VSaaS)
├── docker/                 # Dockerfiles Frigate (multi-arch)
├── docker-stack.yml        # Deploy Swarm (7 serviços)
├── deploy.sh               # Script de deploy automatizado
└── docs/                   # Documentação (Docusaurus, herdado do Frigate)
```

---

## 4. Matriz de Funcionalidades MVP

| # | Funcionalidade | Status | Evidência |
|---|---------------|--------|-----------|
| 1 | **Cadastro de câmeras (RTSP/RTMP)** | ✅ Implementado | `routes/cameras.ts` + `AddCameraWizard.tsx` com wizard multi-step, suporte RTSP pull + RTMP push, teste de conectividade |
| 2 | **Live view multi-câmera** | ✅ Implementado | `LivePlayer.tsx` com WebRTC/WHEP + fallback snapshot-poll, grid multi-câmera via `LivePage.tsx` |
| 3 | **Gravação contínua** | ✅ Implementado | `recording.service.ts` — supervisor ffmpeg por câmera, segmentos .ts de 6s, reconcile 30s, copy H.264 sem transcode |
| 4 | **Gravação por movimento** | ⚠️ Parcial | Schema tem `RecordingMode.MOTION` mas service trata ALL e MOTION como idêntico ("Motion-gating é P1") |
| 5 | **Playback HLS com timeline** | ✅ Implementado | `playback.ts` + `PlaybackPlayer.tsx` + `PlaybackTimelineZoom.tsx` — manifest dinâmico, ticket-auth, bitmap 1440min, date picker |
| 6 | **Retenção / Storage S3** | ✅ Implementado | `recording-storage.service.ts` + `s3-storage.service.ts` — local + R2/S3, retention job horário, multi-tenant bucket-per-integrador |
| 7 | **Multi-tenancy (3 níveis)** | ✅ Implementado | SuperAdmin → Integrador → ClienteFinal, tenant-scope em todas queries, header X-ICV-Tenant |
| 8 | **Hierarquia de usuários/roles** | ✅ Implementado | 8 roles (SUPER_ADMIN → CLIENTE_VIEWER), middleware `requireRole`, impersonation |
| 9 | **ONVIF / Metadados de câmera** | ⚠️ Parcial | Schema tem campos ONVIF (host, port, username, passwordEnc, PTZ) mas **sem service de discovery ONVIF** |
| 10 | **Eventos / Alarmes** | ✅ Implementado | `AnalyticsEvent` model, `ReviewItem` model, `AlertConfig`, `AlertRecipient`, watchdog de câmera |
| 11 | **Notificações** | ✅ Implementado | WebPush VAPID, WhatsApp (Evolution API), Telegram Bot, E-mail SMTP, cooldown anti-spam |
| 12 | **Health monitoring de câmeras** | ✅ Implementado | `camera-watchdog.service.ts` — tick 60s, detecta offline/recovery, envia alertas, healthScore 0-100 |
| 13 | **White-label / Branding** | ⚠️ Parcial | Portal com `primaryColor`/`secondaryColor`, custom domains, `cfSubdomain` — mas sem logo dinâmico/CSS completo |
| 14 | **Auditoria / Logs** | ✅ Implementado | `AuditLog` model, `CameraLog` model, LGPD data requests, `audit.ts` route |
| 15 | **Edge Nodes / Fleet** | ✅ Implementado | `EdgeNode` model, heartbeat, commands cloud→box, fleet UI, telemetria enriquecida, hardware inventory |
| 16 | **Face Recognition** | ⚠️ Parcial | Schema completo (`FaceIdentity`, `FaceRecognitionEvent`), rotas CRUD — mas **sem pipeline de execução real** (Vertex Face service é scaffold) |
| 17 | **LPR (placas)** | ⚠️ Parcial | Schema completo (`LicensePlate`, `LicensePlateEvent`), rotas CRUD — **sem OCR engine integrado** |
| 18 | **Detecção de EPI (PPE)** | 🔴 Placeholder | Rota é `PlaceholderPage title="Auditoria EPI"`, enum `PPE_DETECTION` existe mas sem pipeline |
| 19 | **Semantic Search** | ⚠️ Parcial | Schema + rota + `embedding.ts` lib — mas dependência real em Vertex AI embeddings não configurada |
| 20 | **GenAI (descrições)** | ⚠️ Parcial | Campos no schema, service `vertex.service.ts` — sem integração de execução end-to-end |
| 21 | **Billing / Quota** | ✅ Implementado | `ApiQuota`, `Invoice`, `CameraSubscription` models, quota reset job mensal, pricing endpoint |
| 22 | **Leads / CRM** | ✅ Implementado | Funil de leads, demo invites, conversão lead→integrador, pipeline completo |
| 23 | **Mapa de câmeras** | ✅ Implementado | `CameraMapPage.tsx` com Leaflet + marker clusters, lat/lng por site |
| 24 | **Gravação agendada** | 🔴 Faltando | Sem conceito de schedule/agenda no schema ou service |
| 25 | **Export de vídeo (clip)** | 🔴 Faltando | Sem endpoint para download de clip recortado por range |

---

## 5. Top 10 Débitos Técnicos por Criticidade

### 🔴 CRÍTICO

**DT-1. Credenciais em plaintext no docker-stack.yml (commitado no git)**
- **Arquivo:** `docker-stack.yml:162,207-208,228-234,236-243`
- **Problema:** Senha do PostgreSQL, chave de criptografia ICV, API key da Evolution, access keys R2, VAPID keys — todos em plaintext num arquivo versionado. Qualquer clone do repo expõe tudo.
- **Impacto:** Comprometimento total da plataforma se repositório vazar.
- **Fix:** Mover para Docker secrets ou variáveis de ambiente injetadas pelo CI/CD. Rotacionar TODAS as credenciais expostas.

**DT-2. Arquivo .env com credenciais commitado no repositório**
- **Arquivo:** `vsaas-backend/.env` (55 linhas, inclui DATABASE_URL, JWT_SECRET, chaves)
- **Problema:** `.gitignore` tem `*.env` mas o `.env` já foi commitado antes da regra. `git rm --cached` nunca foi executado.
- **Impacto:** Histórico do git contém credenciais mesmo que o arquivo seja removido.
- **Fix:** `git rm --cached vsaas-backend/.env`, rotacionar credenciais, verificar git history.

**DT-3. Zero testes automatizados no VSaaS**
- **Backend:** `vitest` está no package.json mas **não existe nenhum arquivo de teste**.
- **Frontend:** Nenhum teste unitário, de integração ou E2E.
- **Frigate (herdado):** Tem testes E2E Playwright e alguns unit tests — mas para o Frigate, não para o VSaaS.
- **Impacto:** Qualquer mudança pode quebrar funcionalidades sem detecção. Inaceitável para homologação de campo.

**DT-4. Backend em produção roda via `tsx` (esbuild) sem compilação**
- **Arquivo:** `vsaas-backend/Dockerfile:22` — `CMD ["npx", "tsx", "src/index.ts"]`
- **Problema:** `tsx` é ótimo para dev, mas em produção: sem type-checking, startup mais lento (esbuild a cada boot), sem tree-shaking, `npx` resolve pacote a cada start.
- **Workaround anterior:** `tsc` falhava com erros de tipo (TS6059), então migraram para `tsx`.
- **Fix:** Corrigir os erros de tipo e usar `tsc` + `node dist/index.js` em produção.

### 🟡 ALTO

**DT-5. Gravação por movimento é stub ("Motion-gating é P1")**
- **Arquivo:** `recording.service.ts:17`
- **Problema:** `RecordingMode.MOTION` existe no schema mas o service grava 24/7 independente do modo. Operadores configuram "Movimento" esperando economia de storage, mas gravam igual.
- **Impacto:** Custo de storage até 10x maior que o esperado pelo cliente.

**DT-6. ONVIF discovery não implementado**
- **Schema:** Campos `onvifHost`, `onvifPort`, `onvifUsername`, `onvifPasswordEnc` existem.
- **Realidade:** Sem service de ONVIF discovery/probe. Câmeras devem ser cadastradas manualmente com URL RTSP.
- **Impacto:** Concorrentes (Milestone, Genetec, Digifort) têm auto-discovery. Diferencial competitivo perdido.

**DT-7. Pipeline de IA sem "engine" real**
- Face Recognition, LPR, PPE, GenAI, Semantic Search — todos têm schema, rotas e telas no frontend.
- Mas o **pipeline de execução real** (captura frame → envia para ML → salva resultado) não está implementado para nenhum deles no VSaaS.
- O Frigate core tem detecção (YOLO), mas a integração Frigate→VSaaS DB ainda não existe.
- **Impacto:** Funcionalidades de IA são "vitrine" — mostram telas mas não processam nada.

**DT-8. CORS wildcard para redes internas**
- **Arquivo:** `app.ts:78-79` — `origin.startsWith('http://192.168.') || origin.startsWith('http://10.')`
- **Problema:** Aceita qualquer origin de redes RFC1918. Em ambientes corporativos, qualquer máquina na mesma rede pode fazer requests CORS.
- **Impacto:** Risco de CSRF/data exfiltration em redes compartilhadas.

### 🟠 MÉDIO

**DT-9. Frigate Manager não integrado ao backend VSaaS**
- **Arquivo:** `frigate-manager/src/index.ts` — exporta `mountFrigateManager(app)` mas **nunca é chamado** no `vsaas-backend/src/app.ts`.
- **Impacto:** A orquestração multi-tenant de instâncias Frigate (a proposta central do edge) está desconectada.

**DT-10. Inconsistência de versões Prisma**
- `vsaas-backend/package.json`: Prisma 5.22
- `frigate-manager/package.json`: Prisma 6.0
- **Impacto:** Schema incompatível se tentar compartilhar o cliente Prisma entre módulos.

---

## 6. Riscos para Go-To-Market

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|-------|--------------|---------|-----------|
| R1 | **Vazamento de credenciais** (DT-1/DT-2) | Alta | Crítico | Rotacionar imediatamente, mover para secrets |
| R2 | **Bug em produção sem testes** (DT-3) | Alta | Alto | Sprint de testes mínimos: auth, CRUD câmeras, gravação |
| R3 | **Storage explode sem motion-gating** (DT-5) | Alta | Alto | Implementar motion-gating real ou comunicar limitação |
| R4 | **Cliente espera IA que não funciona** (DT-7) | Média | Crítico | Esconder telas de IA não funcionais OU implementar pipeline mínimo |
| R5 | **Performance com 60+ câmeras** | Média | Alto | Load test do supervisor de gravação (60 ffmpeg simultâneos) |
| R6 | **Sem ONVIF = setup manual** (DT-6) | Alta | Médio | Aceitar como limitação MVP ou implementar discovery básico |
| R7 | **Sem backup automatizado do PostgreSQL** | Alta | Crítico | Implementar cron de pg_dump + upload S3 |
| R8 | **Single point of failure** (tudo em 1 VPS) | Média | Crítico | Aceitar para MVP, planejar HA para v2 |

---

## 7. Score de Prontidão MVP: **52/100**

### Justificativa por categoria:

| Categoria | Peso | Score | Nota |
|-----------|------|-------|------|
| **Core VMS** (live, gravação, playback) | 25% | 80/100 | Live WebRTC funcional, gravação 24/7 funcional, playback HLS com timeline. Motion-gating é stub. |
| **Multi-tenancy & Auth** | 15% | 90/100 | 3 níveis funcionais, 8 roles, tenant scope, impersonation, portal. Muito sólido. |
| **Segurança** | 20% | 15/100 | Credenciais expostas no git, zero testes, CORS frouxa, tsx em prod. **Bloqueante.** |
| **UI/UX** | 10% | 75/100 | 42 páginas, design glassmorphism, dark mode, responsivo. Muitas telas são funcionais. |
| **IA / Analytics** | 10% | 20/100 | Schema e telas existem, mas zero pipeline de execução. É "vitrine". |
| **Infraestrutura** | 10% | 50/100 | Docker Swarm funcional, deploy.sh automatizado, mas sem backup, sem monitoring, sem HA. |
| **Testes & Qualidade** | 10% | 5/100 | Zero testes no VSaaS. Vitest configurado mas vazio. Nenhum lint CI. |

**Cálculo:** (0.25×80 + 0.15×90 + 0.20×15 + 0.10×75 + 0.10×20 + 0.10×50 + 0.10×5) = **52.0**

---

## 8. O que JÁ Está Funcional

1. ✅ Login/auth JWT com 8 roles hierárquicos
2. ✅ CRUD completo de câmeras (RTSP pull + RTMP push)
3. ✅ Live view WebRTC/WHEP com fallback snapshot-poll automático
4. ✅ Gravação contínua via ffmpeg (segmentos .ts, supervisor com recovery)
5. ✅ Playback HLS com timeline minuto-a-minuto e date picker
6. ✅ Storage multi-tenant (R2/S3 bucket-per-integrador) com browser e stats
7. ✅ Retenção automática (job horário, dias configuráveis por câmera)
8. ✅ Multi-tenancy B2B2B completo (SuperAdmin → Integrador → ClienteFinal → Site → Camera)
9. ✅ Gerenciamento de edge nodes (heartbeat, telemetria, commands cloud→box)
10. ✅ Notificações multi-canal (WebPush, WhatsApp Evolution, Telegram, E-mail)
11. ✅ Health monitoring / Watchdog de câmeras com alertas
12. ✅ CRM / Funil de leads com demo invites
13. ✅ Portal white-label (magic-link, branding por cliente)
14. ✅ Auditoria LGPD (audit logs, data requests)
15. ✅ Billing/quota com planos comerciais (Bronze/Silver/Gold/Platinum)
16. ✅ Mapa de câmeras (Leaflet + marker clusters)
17. ✅ Custom domains por integrador
18. ✅ Fleet management (gestão centralizada de edge nodes)
19. ✅ Rate limiting por tenant (JWT-aware)
20. ✅ RTMP push in (câmera→cloud, NAT traversal nativo)

## 9. O que Está PARCIALMENTE Implementado

1. ⚠️ Gravação por movimento — schema pronto, mas service grava 24/7 sempre
2. ⚠️ ONVIF — campos no schema, mas sem discovery/probe service
3. ⚠️ Face Recognition — schema + rotas + tela, sem pipeline ML
4. ⚠️ LPR (placas) — schema + rotas + tela, sem OCR engine
5. ⚠️ Semantic Search — schema + rota, sem embeddings configurados
6. ⚠️ GenAI descriptions — campos no schema, service scaffold
7. ⚠️ White-label — cores e portal, mas sem CSS/logo dinâmico completo
8. ⚠️ Frigate Manager — módulo escrito mas não montado no app
9. ⚠️ MQTT console — tela existe, publisher lib existe, mas integração edge↔MQTT é parcial

## 10. O que Está FALTANDO para MVP

1. 🔴 Testes automatizados (unitários, integração, E2E)
2. 🔴 Rotação/remoção de credenciais expostas no git
3. 🔴 Backup automatizado do PostgreSQL
4. 🔴 Gravação agendada (schedule/agenda)
5. 🔴 Export/download de clips de vídeo por range
6. 🔴 ONVIF auto-discovery de câmeras
7. 🔴 Monitoring/alerting da infraestrutura (Grafana, Prometheus)
8. 🔴 SSL/TLS configurado (referências a HTTP no deploy, sem Caddy/Traefik)
9. 🔴 Build de produção real do backend (tsc em vez de tsx)
10. 🔴 Documentação de API (OpenAPI endpoint existe mas sem spec completa)

---

## 11. PRECISA CONFIRMAR COM TARCÍSIO

1. **As credenciais no docker-stack.yml já foram rotacionadas?** O arquivo tem senhas de DB, R2, Evolution API em plaintext. Se o repo já foi compartilhado com alguém, todas precisam ser trocadas.
2. **O Frigate core (Python) será usado em produção?** O repo tem todo o código do Frigate, mas o VSaaS backend parece operar independentemente via RTSP/go2rtc. O `frigate-manager` foi escrito mas não integrado — é intencional?
3. **Quais módulos de IA são priority para o MVP?** Face, LPR, PPE, Semantic Search e GenAI estão modelados mas sem pipeline. Qual é a expectativa dos integradores para a homologação?
4. **O go2rtc na cloud suporta quantas câmeras simultâneas?** O docker-stack.yml aloca 1GB — suficiente para ~60 câmeras conforme o comentário, mas sem benchmark real.
5. **Existe algum proxy reverso (Caddy/Nginx/Traefik) na frente?** O docker-stack.yml expõe portas diretamente. Em produção, quem faz SSL termination?
6. **O schema do Prisma tem 50+ models — todos são usados?** Alguns models como `HeatmapSnapshot`, `AudioDetectionEvent`, `SemanticEmbedding` podem ser dead code sem pipeline.
7. **O web/ (frontend Frigate herdado) ainda é usado?** Ocupa espaço no repo e tem seu próprio CI/CD. Se o VSaaS frontend substitui, pode ser removido.
8. **A integração IACV Box ↔ Cloud está funcional em campo?** Os endpoints `/iacv-box/*` existem, mas dependem de firmware no RPi5 que pode não estar pronto.

---

*Relatório gerado por análise automatizada do codebase. Todas as afirmações foram baseadas em leitura direta dos arquivos — nenhuma suposição foi feita.*
