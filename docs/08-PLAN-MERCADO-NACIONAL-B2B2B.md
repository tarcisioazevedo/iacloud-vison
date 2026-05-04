# Plano Definitivo de Mercado Nacional B2B2B — IA Cloud Vision

**Criado em:** 2026-05-03
**Última revisão:** 2026-05-03
**Substitui em parte:** `07-PLAN-MASTER-DIFERENCIACAO.md` (escrito antes do mapeamento real do código)
**Pré-requisito de leitura:** `06-MAPA-COMPETIDORES.md`

---

## 0. Por que este plano existe

O plano anterior (`07`) foi escrito **antes** de eu ler o código real do projeto. Era teórico, baseado em pesquisa de competidor. Após mapear `vsaas-backend` (65 modelos Prisma, 47 rotas, 30 services), `vsaas-frontend` (50 páginas, 85 componentes), `INTEGRATION/` (bridge Box↔Cloud em produção) e a infra (MediaMTX SFU + Cloudflare Tunnel v2 vivos), descobri uma realidade muito diferente:

**O produto tem ~85% das features que o `07-PLAN` planejava criar do zero.** O trabalho real é muito menor do que estimei e muito mais focado em **polimento, estabilização e go-to-market** do que em features novas.

Este documento substitui as Partes 2-5 do `07-PLAN`. Os Pilares (Parte 1), Anti-features (Parte 6), Riscos (Parte 8) e Apêndices do `07` permanecem válidos.

---

## 1. Sumário Executivo

### Estado real do produto (2026-05-03)

**Score MVP atualizado:** **68/100** (vs. 52/100 do diagnóstico de 2026-05-02 — saltou com Etapa 1 SRT em prod)

| Dimensão | Score | Observação |
|---|---|---|
| Multi-tenancy | 95/100 | 3 níveis (SuperAdmin → Integrador → ClienteFinal) totalmente implementados; 8 roles RBAC granular |
| Core VMS | 85/100 | Live (WHEP+fallback), playback HLS, gravação FFmpeg, mosaico sincronizado, motion search já existem |
| IA / Analytics | 70/100 | Schema, rotas, services e UI completos para Face/LPR/Semantic/Audio/PPE/Heatmap/Demographics. Pipeline ML real precisa validação produtiva |
| Edge Computing | 80/100 | iacv-bridge em produção, SSO Box ativo, Cloudflare Tunnel v2 inline, vault R2 escopado, SRT em produção |
| UX/UI | 80/100 | React 19 + 50 páginas + Tailwind + dark mode + PWA + branding white-label funcional |
| Notificações | 85/100 | Email + WebPush VAPID + WhatsApp Evolution v2 + Telegram + SSE alerts em produção |
| Auditoria/LGPD | 65/100 | AuditLog com diff, LgpdDataRequest, anonymize, ExportAudit, MediaCertificate HMAC já existem |
| Infra | 55/100 | Single-node Swarm, sem HA, sem off-site backup, sem observabilidade |
| Segurança | 30/100 | **P0 0/7 fechado** (9 credenciais ainda em git history). Sem 2FA. Mosquitto sem auth |
| Testes | 5/100 | Zero testes automatizados (vitest configurado, vazio) |
| Comercial / GTM | 20/100 | Sem pricing público, sem onboarding self-service, sem case studies, sem materiais de venda |

### Insight central

**Não falta produto. Falta polir, fechar gaps críticos (segurança + testes), criar GTM (pricing/onboarding) e empacotar por vertical.** Em 90 dias bem priorizados (não 9-12 meses), o produto está pronto para ir ao mercado.

### Investimento humano realista

- **Onda 0 (já em curso):** 1 dev (Tarcísio) — está construindo a fundação
- **Onda 1 (M0-M1):** + 1 freelancer QA 10h/sem (executa testes manuais + escreve smoke E2E) → R$ 1.500-3.000/mês
- **Onda 2 (M2-M3):** + 1 dev pleno full-time (contrata pra dar conta de polimento e mobile) → R$ 8.000-12.000/mês
- **Onda 3 (M4+):** + 1 PM/Customer Success quando 5+ integradores piloto entrarem → R$ 5.000-8.000/mês

---

## 2. Inventário REAL do produto (2026-05-03)

Esta é a tabela definitiva. Atualizar a cada release.

### 2.1 Plataforma core

| Feature | Status | Onde fica | Observação |
|---|---|---|---|
| Multi-tenant 3 níveis (SA → Int → CF) | ✅ Em produção | `prisma.schema` modelos Integrador/ClienteFinal/User | Gold standard B2B2B |
| 8 roles RBAC | ✅ Em produção | `UserRole` enum | SUPER_ADMIN/ADMIN_GLOBAL/INTEGRADOR_ADMIN/INTEGRADOR_TECNICO/CLIENTE_ADMIN/CLIENTE_SUPERVISOR/CLIENTE_OPERADOR/CLIENTE_VIEWER |
| RBAC granular por câmera/site | ✅ Em produção | `IntegradorTechnicianAccess`, `User.allowedSiteIds` | Por ACL técnico e por filial |
| Impersonation auditada | ✅ Em produção | `ImpersonationSession` | SUPER_ADMIN pode atuar como qualquer usuário |
| White-label portal cliente-final | ✅ Em produção | `ClienteFinal.portalSlug`, branding | Cores customizáveis, logo |
| Custom domains | 🟡 UI pronta, validação parcial | `CustomDomain` model + page | Falta cert SSL automático per-domain |
| Magic link cliente-final | ✅ Em produção | `PortalAccessToken` | TTL configurável |
| Audit log com diff before/after | ✅ Em produção | `AuditLog.changes` (JSON) | Diferencial real vs. competidores BR |
| LGPD data request | ✅ Schema pronto | `LgpdDataRequest` | Falta UI completa do export |
| Approval workflow | ✅ Em produção | `ApprovalRequest` | Para deletes sensíveis |
| Modularização (feature flags) | ✅ Em produção | `IntegradorModule`, `ClienteFinalModule` | Por integrador e por cliente |
| Lead funnel + CRM admin | ✅ Em produção | `Lead`, `LeadFollowUp` | Pipeline interno SUPER_ADMIN |
| Demo invites | ✅ Em produção | `DemoInvite` | Token mágico para demos |

### 2.2 Câmera + Streaming

| Feature | Status | Onde fica | Observação |
|---|---|---|---|
| Cadastro câmera multi-stream | ✅ Em produção | `Camera` (rtspMain/rtspSub/rtmpPush) | 5 wizard frontend |
| Descoberta ONVIF | 🔴 Não existe | — | Falta. Diferencial vs. cadastro manual |
| Live WHEP/WebRTC | ✅ Em produção | `live.service`, `LivePlayer.tsx` | Com fallback snapshot-poll robusto |
| Live MJPEG fallback | ✅ Em produção | `live.service` | Backoff 5→60s |
| MediaMTX SFU SRT (Etapa 1 PoP DE) | ✅ Em produção desde 2026-05-04 | docker-stack | Latência ~400-500ms |
| Edge PoP BR (Etapa 2) | 🔴 Plano em `03-PLAN-EDGE-POP-BR.md` | — | Reduz para 80-130ms; ~$12/mês |
| Cloudflare Tunnel v2 inline | ✅ Em produção | `cloudflare-tunnel.service` | Provisionado no `/activate` |
| Mosaico multi-câmera | ✅ Em produção | `LivePage` + grid | Layouts customizáveis |
| Mosaico playback sincronizado | ✅ Em produção | `PlaybackMosaicPage` | NOVO |
| Timeline com cores semânticas | 🟡 Parcial | `RecordingTimeline.tsx` | Falta indicar gravação/movimento/evento por cor |
| Frame-by-frame | 🔴 Não existe | — | Diferencial enterprise; baixo esforço |
| Speed control 0.5×-4× | ✅ Em produção | `PlaybackPlayer` | OK |
| Motion search (re-análise) | ✅ Em produção | `MotionSearchPage` | NOVO |
| Mapa de câmeras Leaflet | ✅ Em produção | `CameraMapPage` | Geolocalizado |
| Mapa sinótico (planta baixa) | ✅ Em produção | `SynopticMapPage`, `FloorPlan` model | Drag-drop câmera no plano |
| PTZ control | 🟡 Schema sim, UI mínima | `Camera` model | Falta painel PTZ visual |

### 2.3 Gravação + Evidência

| Feature | Status | Onde fica | Observação |
|---|---|---|---|
| Gravação contínua 24/7 | ✅ Em produção | `recording.service` | FFmpeg supervisor por câmera |
| Gravação por evento | 🔴 Stub | `RecordingMode.MOTION` schema | Grava 24/7 sempre. **Bug a corrigir** |
| Gravação agendada (cronograma 7×24) | ✅ Em produção | `RecordingSchedule` model + grid | Modes: ALL/MOTION/ACTIVE_OBJECTS |
| Pré-evento buffer 60-120s | 🟡 Stub | — | Falta wiring; go2rtc já tem buffer |
| Retention policies | ✅ Em produção | `EvidenceRetentionPolicy` | Por ClienteFinal |
| Storage multi-backend (S3/R2/GCS) | ✅ Em produção | `recording-storage.service` | R2 evidência + Hetzner S3 longa duração |
| Storage usage tracking | ✅ Em produção | `StorageUsage` | Por ClienteFinal/Camera |
| Bookmarks com proteção (legal hold) | 🟡 Schema sim | `Bookmark` model | Falta flag `protectedUntil` + cold storage |
| Watermark de autenticidade (HMAC) | ✅ Em produção | `MediaCertificate` | Endpoint `/certificates/verify` público |
| Export MP4/snapshot/mosaic | ✅ Em produção | `export.service`, `ExportAudit` | Com hash HMAC |
| Chain of custody report PDF | 🔴 Não existe | — | Falta apenas template PDF + endpoint |
| Compartilhamento link público temporário | 🟡 Parcial | `portal.service`, `PortalAccessToken` | Foco em portal CF; falta share rápido de evento |

### 2.4 Eventos + Alarmes

| Feature | Status | Onde fica | Observação |
|---|---|---|---|
| Catálogo de eventos | ✅ Em produção | `ReviewItem`, `AnalyticsEvent` | Severity ALERT/DETECTION/SIGNIFICANT |
| Wizard de regras | 🟡 Parcial | `ReviewRulesPage`, `TriggersPage` | Falta wizard 5-etapas |
| Acknowledgement com observação | 🟡 Parcial | `ReviewItem.notes` | Falta enforcement obrigatório por severity |
| Pop-up automático na live | 🟡 Parcial | `AlertToastProvider` | Existe toast SSE; falta abrir player no click |
| HTTP webhook custom | ✅ Em produção | Trigger actions (`WEBHOOK`) | Falta UI Testar |
| Botão pânico cliente | 🟡 Schema sim | — | Falta UI dedicada no portal |
| Procedimento operacional (SOP digital) | 🔴 Não existe | — | Mission Control-like; V2 |
| Escalation automática | 🟡 Parcial | `AlertRecipient.escalateToIntegrador` | Sem chain de fallback |
| Cooldown anti-spam | ✅ Em produção | `AlertConfig.cooldown*`, `lib/cooldown.ts` | Ótimo |
| Limites email por hour/day | ✅ Em produção | `AlertConfig.maxEmails*` | Anti-spam corporate |
| Dedup por alertKey | ✅ Em produção | `AlertDelivery.alertKey` | Evita spam por mesmo evento |

### 2.5 IA / Analytics

| Feature | Status | Pipeline | Observação |
|---|---|---|---|
| Cloud Vision (labels/logos/safe-search) | ✅ Em produção | `vision.service` | Mock em dev |
| Vertex AI Vision streaming | ✅ Em produção | `vertex.service` | Occupancy/dwell/heat/PPE |
| Vertex AI Face Detection | ✅ Em produção | `vertex-face.service` | Sentimentos (joy/sorrow/anger/surprise) |
| Face Recognition (FaceIdentity + embeddings) | ✅ Schema + service + UI | `FaceIdentity`, `FaceEmbedding`, `/faces` | Cosine similarity matching |
| LPR (License Plate Recognition) | ✅ Schema + service + UI | `LicensePlate`, `/plates` | Categorias AUTHORIZED/VIP/FLEET/BLACKLIST/VISITOR |
| Audio Detection | ✅ Schema + service | `AudioDetectionEvent` | Gunshot/scream/glass/bark/siren |
| Semantic Search (NLP em vídeo gravado) | 🟡 Schema + service + UI; pipeline parcial | `SemanticEmbedding`, `SemanticTrigger`, `/semantic` | **Faltava no `07-PLAN`. Já existe!** Validar produção |
| Semantic Triggers com ações | ✅ Em produção | `SemanticTrigger.actions` (NOTIFY/WEBHOOK/REVIEW_FLAG/RECORD/SIREN) | Excelente design |
| People counting | ✅ Em produção | `PeopleCounting` model + UI | Integra Vertex |
| Heatmap | ✅ Em produção | `HeatmapSnapshot` + `/heatmap` | Semanal, GCS |
| Demographics | ✅ Em produção | `/demographics` page | Idade/gênero |
| PPE compliance | 🟡 UI placeholder | `/ppe`, `PpeCompliance.tsx` | Página "em breve" — schema pronto |
| Object detection edge YOLO | ✅ Em produção | EdgeNode com Frigate | Pipeline EDGE_HYBRID |
| Detecção fogo/fumaça | 🔴 Não documentado | — | BeNuvem tem, gap |
| Detecção arma | 🔴 Não documentado | — | BeNuvem tem, gap |
| Re-identification (tracking entre câmeras) | 🔴 Não existe | — | Eagle Eye tem |
| Detecção Garupa/Carona (nicho BR) | 🔴 Não existe | — | BeNuvem tem; vertical |
| OCR contêiner | 🔴 Não existe | — | BeNuvem tem; vertical logístico |

### 2.6 Notificações

| Canal | Status | Implementação |
|---|---|---|
| Email | ✅ Em produção | nodemailer + SMTP, templates, cooldown, digest |
| WebPush (browser) | ✅ Em produção | VAPID, Service Worker, `usePushSubscription` hook |
| WhatsApp | ✅ Em produção | Evolution API v2, instância por ClienteFinal, QR code pairing |
| Telegram | ✅ Em produção | Bot API, link per ClienteFinal/User |
| Webhook HTTP | ✅ Em produção | Action de trigger, falta UI Testar |
| SSE alerts (UI real-time) | ✅ Em produção | `/notifications/stream`, `AlertToastProvider` |
| MQTT | ✅ Em produção | Mosquitto broker, `mqtt-publisher` | Sem TLS/auth (gap) |
| SMS | 🔴 Não existe | — | Pode adicionar via Twilio/Zenvia |
| Notificação push mobile (FCM/APNs) | 🔴 Não existe | — | Depende de mobile app nativa |

### 2.7 Edge / iacv-bridge

| Feature | Status | Observação |
|---|---|---|
| SSO Box (JWT 1h aud=box:{edgeNodeId}) | ✅ Em produção desde 2026-05-02 | POST `/auth/box-token` |
| Provisionamento end-to-end | ✅ Em produção | License key cifrada AES-256-GCM, vault R2, Cloudflare Tunnel inline em 1 request |
| Heartbeat enriquecido | ✅ Em produção | system/frigate/cameras/storage/network/tunnel/srt |
| Edge Commands (RESTART/RELOAD/etc.) | ✅ Em produção | `EdgeCommand` queue |
| Edge Connection Log | ✅ Em produção | `EdgeConnectionLog` com sanitização |
| Vault R2 escopado por integrador | ✅ Em produção | bucket `icv-int-{id}-001` |
| Cloudflare Tunnel v2 (Universal SSL grátis) | ✅ Em produção | naming `tn-{edge}.iacloud.com.br` |
| SRT publish para MediaMTX | ✅ Em produção | sidecar `iacv-go2rtc-srt` 1.9.14 |
| Hardware inventory | ✅ Schema sim | `hardwareInventory` em telemetry |
| OTA update | 🟡 Parcial | EdgeCommand existe, falta workflow completo |
| Edge AI (Frigate YOLO local) | ✅ Em produção | Pipeline EDGE_HYBRID |
| ICV-Bridge OS image (build pronta) | 🔴 Não existe | Sem repositório de firmware/Ansible |
| 3 cenários A/B/C dimensionados | 🟡 Parcial | Já existem boxes em campo; falta documentação BOM/manual |

### 2.8 Verticais / Mercado

| Vertical | Status | Página/Recurso |
|---|---|---|
| Smart City | ✅ UI pronta | `SmartCityHubPage` |
| Federation multi-site | ✅ UI pronta | `FederationPage` |
| Varejo (BI: heatmap, demographics, dwell) | ✅ Pages prontas | `/heatmap`, `/demographics`, `/analytics` |
| Indústria (PPE) | 🟡 UI placeholder | `/ppe` "em breve" |
| Condomínio | 🔴 Sem UI dedicada | — |
| Central de monitoramento | 🟡 Parcial via integrações | Falta UI Mission Control-like |
| Logística/portuário (OCR contêiner) | 🔴 Sem | — |
| Governo (Detecta/Cortex/SmartSampa) | 🔴 Sem integração documentada | — |

---

## 3. Gaps Reais (curtos)

Após inventário, os gaps que de fato pesam:

### Críticos (bloqueiam venda)
1. **P0 0/7 fechado** — 9 credenciais em git history. SEM ISSO, NÃO VENDE.
2. **Sem 2FA/MFA** no login (plano `02` pronto, falta executar)
3. **Zero testes automatizados** (não tem como evoluir com confiança)
4. **Sem CI/CD VSaaS** (build manual SSH)
5. **Backups locais sem off-site** (perda do VPS = perda de dados)
6. **`tsx` em produção sem `tsc`** (bugs de tipo só descobertos em runtime)
7. **Sem pricing público** (barreira psicológica de venda)

### Importantes (qualidade percebida)
8. **Gravação MOTION é stub** (grava 24/7 sempre — desperdiça storage)
9. **Mosquitto sem TLS/auth** (vetor de ataque aberto)
10. **ffmpeg dentro do container backend** (gargalo I/O)
11. **Sem observabilidade** (Prometheus/Grafana/Sentry/Loki)
12. **Custom domains sem SSL automático** (BeNuvem tem o mesmo problema; oportunidade)
13. **Single-node Swarm** (sem HA real)
14. **Workflows GitHub do Frigate ainda ativos** (gastam minutos atoa)
15. **PPE page placeholder** (se vamos vender indústria, precisa estar pronto)

### Diferenciadores ainda não implementados
16. **Smart Search NLP em vídeo gravado em produção** (schema existe; pipeline precisa polimento)
17. **Mobile app nativa** (PWA não cobre push profundo, ícone na tela inicial sólido)
18. **i18n** (bloqueio para venda fora do BR)
19. **Marketplace plugins/Zapier/n8n** (V2)
20. **Detecção fogo/arma/Garupa** (gap vs. BeNuvem)

---

## 4. Posicionamento de Mercado B2B2B Nacional

### 4.1 Quem é o cliente (B2B2B = 3 layers)

```
┌──────────────────────────────────────────────────────────┐
│ Layer 1 — Integrador (cliente direto da IA Cloud Vision) │
│ Empresa que vende solução de CFTV para clientes finais   │
│ Ex: SSA Tecnologia, BX Engenharia, Wiki Telecom          │
└──────────────────────┬───────────────────────────────────┘
                       │ revende para
                       ↓
┌──────────────────────────────────────────────────────────┐
│ Layer 2 — Cliente Final (do Integrador)                  │
│ Empresa/condomínio/órgão que recebe o serviço            │
│ Ex: Loja varejo, condomínio, fábrica, prefeitura         │
└──────────────────────┬───────────────────────────────────┘
                       │ atende
                       ↓
┌──────────────────────────────────────────────────────────┐
│ Layer 3 — Usuário Final (do Cliente Final)               │
│ Operador/morador/zelador/segurança que usa o app         │
│ Ex: Portaria, segurança patrimonial, gerente de loja     │
└──────────────────────────────────────────────────────────┘
```

**Implicações de design (já implementadas):**
- White-label completo: Integrador entrega com SUA marca
- 8 roles divididos por layer
- ACL granular (técnico do Integrador acessa só clientes designados)
- Portal CF separado (cliente final tem próprio domínio + branding)

### 4.2 Os 7 nichos prioritários (Brasil)

#### Nicho 1 — Centrais de Monitoramento de Alarme (CMA)
**Tamanho:** ~3.000 empresas no BR (Abese estima)
**Dor:** verificar alarme com vídeo antes de despachar viatura. Hoje usam Sigma/Moni/Commbox + integração frágil com vídeo
**Nossa proposta:** integração nativa com Sigma/Moni/Commbox/Condify (igual Monuv) + verificação visual em 1 clique + cooldown anti-spam + escalation para integrador
**Features prontas:** Multi-tenant, cooldown, alert recipients escalation, WhatsApp, webhook, audit
**Falta:** UI de "central de operações" com fila de alarmes, integração nativa com Sigma (HTTP receiver de alarme)
**Modelo comercial:** R$ 29-49/câmera/mês + setup + treinamento operadores

#### Nicho 2 — Condomínios (residencial e comercial)
**Tamanho:** ~120.000 condomínios no BR (cerca de 80% sem solução cloud)
**Dor:** portaria 24/7 cara; síndico quer ver câmeras pelo celular; LGPD assustando
**Nossa proposta:** portal cliente-final por condomínio com branding próprio, link público temporário para ata, audit log LGPD-ready, integração ONE Portaria/S-Cond/Condfy (mesmas integrações da BeNuvem)
**Features prontas:** Portal cliente-final, branding, magic link, custom domain, audit, mobile push WebPush, WhatsApp
**Falta:** UI específica de "condomínio" (síndico vs. morador), integração com sistemas de portaria
**Modelo comercial:** R$ 19-39/câmera/mês

#### Nicho 3 — Varejo (lojas físicas)
**Tamanho:** ~1.6 milhão de lojas no BR
**Dor:** prevenção de perdas, contagem de fluxo, conversão, demografia, detecção de comportamento suspeito
**Nossa proposta:** dashboard BI varejo com heatmap+demographics+dwell time + LPR de visitante + integração ERP futura
**Features prontas:** Heatmap, Demographics, People Counting, BI routes, Vertex AI streaming
**Falta:** Templates de relatório varejo (LP semanal, BI mensal), integração com ERPs comuns (Bling, Tiny, Olist)
**Modelo comercial:** R$ 49-89/câmera/mês (premium pelo BI)

#### Nicho 4 — Indústria
**Tamanho:** ~33.000 indústrias no BR (foco em alimentos, química, papel)
**Dor:** EPI obrigatório (NR-6), zona restrita, contagem em linha, segurança patrimonial
**Nossa proposta:** PPE detection always-on no edge + contagem por linha + alerta de zona restrita + integração SCADA via webhook/MQTT
**Features prontas:** Schema PPE pronto, MQTT, webhook, edge AI, zone monitoring (CameraZone com PPE_CHECK type)
**Falta:** Página PPE real (hoje é placeholder), modelos ML calibrados para EPI brasileiro (capacete, óculos, luva, bota, colete), integração SCADA Inductive
**Modelo comercial:** R$ 89-149/câmera/mês (premium por uptime + edge AI)

#### Nicho 5 — Smart City e Governo
**Tamanho:** ~5.500 municípios no BR; programas SmartSampa, Detecta-SP, Cortex-MG
**Dor:** integração Cortex/Detecta/SINESP, LPR para furto de veículo, monitoramento de vias
**Nossa proposta:** integração nativa SINESP/Cortex (igual Monuv/BeNuvem), LPR alta acurácia, dashboard de viatura, federation multi-município
**Features prontas:** LPR schema + UI, federation page, multi-tenant, audit
**Falta:** Conectores SINESP/Cortex/SmartSampa, certificações governo (LGPD pública), processo de homologação
**Modelo comercial:** licitação pública (preço por câmera ou por município)

#### Nicho 6 — Logística e Portuário
**Tamanho:** ~600 portos secos + grande operação portuária BR
**Dor:** OCR de contêiner, controle de acesso de caminhão, rastreabilidade de carga
**Nossa proposta:** OCR contêiner + LPR de cavalo mecânico + integração com TMS via webhook + audit completo
**Features prontas:** LPR, audit, webhook, multi-tenant
**Falta:** OCR de contêiner (não temos), integração com TMS comuns, modelo treinado para BR
**Modelo comercial:** sob proposta (operações grandes, R$ 200+/câmera/mês)

#### Nicho 7 — Residencial Premium e SMB (PME)
**Tamanho:** infinito (casa + comércio pequeno)
**Dor:** quer plug-and-play, app no celular, sem complicação de NVR
**Nossa proposta:** Tier Starter R$ 19/cam/mês, Cenário A (cloud direto), wizard 3 minutos, mobile PWA decente
**Features prontas:** Wizard 5 passos, mobile PWA, branding, magic link
**Falta:** Onboarding self-service (sem precisar falar com vendedor), pricing público, página landing com vídeo demo
**Modelo comercial:** R$ 19-49/câmera/mês, conversão self-service por integrador parceiro

### 4.3 Posicionamento síntese

> **"A plataforma VMS Cloud B2B2B brasileira moderna e segura para integradores que querem competir com Monuv/BeNuvem oferecendo melhor stack técnica, segurança real (2FA + audit + LGPD comprovável) e modelo white-label profissional sem consumo mínimo abusivo."**

3 frases-tagline operacionais para diferentes audiências:

- **Para integrador:** "Sua marca, nossa engenharia. Sem consumo mínimo. Self-service do primeiro até o milésimo cliente."
- **Para cliente final corporate:** "VMS cloud com 2FA, audit log auditável e LGPD comprovável. Hospedagem brasileira."
- **Para integrador de central:** "Verificação visual de alarme em 1 clique, integrado nativo com Sigma e Moni. Operadores trabalham mais em menos."

---

## 5. Roadmap de Produtização — 4 Ondas em 90 dias

Substitui o roadmap de 9-12 meses do `07-PLAN`. Mais agressivo porque o produto já existe.

### Onda 1 — Estabilização e Segurança (M0 → M1, 4 semanas)
**Lema:** "Ficar pronto pra ser auditado por integrador sério."

**Entregas hard:**

| # | Item | Esforço | Quem |
|---|---|---|---|
| 1.1 | Fechar 7 P0 do checklist (rotacionar TODAS credenciais + git-filter-repo) | 1 sem | Tarcísio |
| 1.2 | 2FA TOTP obrigatório SUPER_ADMIN, configurável outros (executar `02-PLAN`) | 1.5 sem | Tarcísio |
| 1.3 | Backup Postgres off-site (R2 ou Backblaze B2) + restore validado | 0.5 sem | Tarcísio |
| 1.4 | Substituir `tsx` por build `tsc` real em produção | 0.5 sem | Tarcísio |
| 1.5 | CI básico GitHub Actions (lint + tsc + smoke build) | 0.5 sem | Tarcísio |
| 1.6 | Mosquitto com auth (user/pass) + TLS via Caddy | 0.5 sem | Tarcísio |
| 1.7 | Desativar workflows Frigate inúteis | 0.1 sem | Tarcísio |
| 1.8 | go2rtc `webrtc.candidates` corrigido (IP público em vez de 127.0.0.1) | 0.1 sem | Tarcísio |
| 1.9 | Sentry self-hosted ou cloud free para erros backend + frontend | 0.5 sem | Tarcísio |
| 1.10 | `recording.service` move ffmpeg para container separado (descarrega backend) | 1 sem | Tarcísio |

**Adições da bridge Box (2026-05-04, ver `INTEGRATION/CHANGELOG.md` `be9c457`):**

| # | Item | Esforço | Quem |
|---|---|---|---|
| 1.11 | Validar `enforcedModules` no Zod do `/iacv-box/heartbeat` (declarar campo opcional) | 0.2 sem | Tarcísio |
| 1.12 | `POST /iacv-box/events-batch` (loop transacional sobre handler atual) — Box já tem fallback | 0.3 sem | Tarcísio |
| 1.13 | Painel "Comandos" em `FleetDetailPage.tsx`: lista 35 handlers via `/box/api/cmd/list` dinâmico + histórico `EdgeCommand` com ACK enriquecido | 1 sem | Tarcísio |

**Saída:** P0 100% ☑. Pronto para piloto interno fechado.

### Onda 2 — Polimento Comercial (M1 → M2, 4 semanas)
**Lema:** "Se vende sozinho. Tem como pagar. Demo encanta."

**Entregas hard:**

| # | Item | Esforço | Quem |
|---|---|---|---|
| 2.1 | Pricing público (`/pricing` real) — 4 tiers + comparação + FAQ | 1 sem | Tarcísio + design |
| 2.2 | Onboarding self-service para integrador (criar conta → 1ª câmera em 10 min) | 1.5 sem | Tarcísio |
| 2.3 | OpenAPI doc pública em `api.iacloud.com.br/docs` (Redoc) — gerada do código | 1 sem | Tarcísio |
| 2.4 | Custom domain com SSL automático per-tenant (ACME wildcard via Cloudflare) | 1 sem | Tarcísio |
| 2.5 | Página `/pricing` indexável SEO + landing por vertical | 1 sem | + freelancer copy |
| 2.6 | Testes E2E mínimos via QA freelancer (10 fluxos críticos via Playwright) | contínuo | freelancer 10h/sem |
| 2.7 | Wizard "criar regra de evento" em 5 passos visuais | 1 sem | Tarcísio |
| 2.8 | Webhook UI com botão "Testar" + retry policy visível | 0.5 sem | Tarcísio |
| 2.9 | Centro de notificações persistente (não só toast) | 0.5 sem | Tarcísio |
| 2.10 | Demo público em `app.iacloud.com.br/demo` (read-only com dados sintéticos) | 0.5 sem | Tarcísio |
| 2.11 | **install.sh + DNS `get.iacloud.com.br` + Cloudflare Pages** — `curl https://get.iacloud.com.br \| bash` instala ICV-Bridge OS no hardware do cliente. Repo público `iacloud-vision/box-installer` | 1.5 sem | Tarcísio |
| 2.12 | Painel admin "Provisionar Box" — form com QR code + envio de e-mail automático com `licenseKey` (template já mencionado em `iacv-box.ts`) | 1 sem | Tarcísio |
| 2.13 | Compliance check `enforcedModules`: handler `/heartbeat` compara reportado pela Box vs `IntegradorModule`/`ClienteFinalModule` resolvido. Diff → `EdgeConnectionLog { eventType: 'MODULE_DRIFT' }` + warning amber no painel | 0.5 sem | Tarcísio |

**Saída:** Primeiro integrador piloto pago entra. Pricing publicado. Demo viva. **Integrador instala Box em campo via `curl \| bash`, sem SSH manual.**

### Onda 3 — Verticais e Diferenciais (M2 → M3, 4 semanas)
**Lema:** "Tem plano para cada nicho. Tem feature que ninguém mais tem."

**Entregas hard por trilha paralela (precisa do dev pleno contratado a partir daqui):**

#### Trilha A — Verticais (1 dev novo)
| # | Item | Esforço |
|---|---|---|
| 3A.1 | PPE página real (saindo de placeholder) com modelo treinado para EPI BR | 1.5 sem |
| 3A.2 | UI "Central de Monitoramento" (fila de alarmes + verificação visual + escalation) | 1.5 sem |
| 3A.3 | Conector Sigma (HTTP receiver) + Moni + Commbox + Condfy | 1 sem |
| 3A.4 | Templates de relatório varejo (LP semanal, BI mensal) | 0.5 sem |

#### Trilha B — Diferenciadores (Tarcísio)
| # | Item | Esforço |
|---|---|---|
| 3B.1 | Smart Search NLP em vídeo gravado — pipeline produtivo (CLIP + pgvector já modelado) | 2 sem |
| 3B.2 | Bookmark com proteção (legal hold) + cold storage R2 archive | 1 sem |
| 3B.3 | Chain of custody report PDF | 0.5 sem |
| 3B.4 | Etapa 2 do Edge PoP BR (VPS SP) — execução do plano `03` | 0.5 sem |
| 3B.5 | Gravação MOTION real (parar de gravar 24/7 quando flag MOTION) | 0.5 sem |
| 3B.6 | Pré-evento buffer 60-120s real | 0.5 sem |
| 3B.7 | Painel admin "Atualizar Boxes" com rollout 10/50/100% (dispara `EdgeCommand UPDATE_FIRMWARE` — handler já existe na Box) + repository `box-compose` versionado | 1.5 sem |
| 3B.8 | Brand polish: `vsaas-frontend/public/logo.svg` definitivo + `docs/04-BRAND-GUIDE.md` (paleta CSS variables, fonte Inter/Geist) — alinha Cloud com Box que já está 100% IA Cloud Vision | 0.5 sem |
| 3B.9 | Migration leve `AnalyticsEvent.skill String?` indexado para BI per-skill rollups (LPR/face/crowd/intrusion). Hoje cabe em `rawAnnotationsJson`; coluna explícita habilita query rápida | 0.2 sem |

**Saída:** 3-5 integradores piloto pagos cobrindo verticais diferentes. Diferenciadores reais demonstráveis.

### Onda 4 — Mobile e Marketplace (M3 → M4 e adiante)
**Lema:** "Operador no celular. Integrador escolhe integração."

**Entregas hard:**

| # | Item | Esforço |
|---|---|---|
| 4.1 | Mobile nativa via Capacitor (reusa React 19, push profundo FCM/APNs, biometria login) | 4-6 sem |
| 4.2 | Marketplace de integrações (página + gestão por integrador) | 2 sem |
| 4.3 | App Zapier oficial (5 triggers + 3 actions) | 2 sem |
| 4.4 | App n8n oficial (community node) | 1 sem |
| 4.5 | i18n (en-US para começar — abre venda fora do BR) | 1.5 sem |
| 4.6 | Federation multi-tenant entre instâncias de integradores diferentes (raro mas vende) | 2 sem |
| 4.7 | Detecção fogo/arma/Garupa-Carona (modelo treinado, integra ao pipeline edge) | 3 sem |
| 4.8 | OCR contêiner (vertical logístico) | 2 sem |
| 4.9 | OTA do ICV-Bridge OS (build de imagem + update remoto) | 3 sem |

**Saída:** Produto completo. Pode escalar para 50-200 integradores e milhares de câmeras.

---

## 6. Edge Box ICV-Bridge — Estado Real e Roadmap

### 6.1 Estado real (2026-05-03)

**O que existe e funciona:**
- iacv-bridge submódulo (`INTEGRATION/`) com Frigate forkeado rodando no edge
- Frontend Box (commit e2cd7e0) consumindo backend via SSO Box
- `/activate` provisiona em 1 request: edgeToken + vault R2 escopado + Cloudflare Tunnel + lista de câmeras
- Heartbeat enriquecido (system/frigate/cameras/storage/network/tunnel/srt)
- SRT publish para MediaMTX em produção (Hikvision lab BR streamando 2026-05-04)
- Edge Commands com queue (RESTART, RELOAD_MODEL, etc.)
- License key cifrada AES-256-GCM por box

**O que precisa de polimento:**
- Documentação de manual para integrador instalar (BOM + fluxo passo-a-passo)
- 3 cenários A/B/C dimensionados oficialmente com hardware recomendado
- Imagem ICV-Bridge OS pronta para gravar em SD/SSD (atualmente ad-hoc)
- OTA workflow completo (hoje EdgeCommand existe mas falta runner)
- Repositório separado para firmware/Ansible

### 6.2 3 cenários atualizados (substitui Parte 4 do `07-PLAN`)

| Aspecto | A — Cloud direto | B — Box leve | C — Box robusto + AI |
|---|---|---|---|
| Câmeras | 1-3 | 4-8 | 8-32 |
| Hardware | Câmera com IP público OU Cloudflare Tunnel da câmera | Raspberry Pi 5 (8GB) ou mini-PC x86 (Intel N100) + SSD NVMe 256GB + Cloudflare Tunnel | Mini-PC x86 i5-12 ou superior + 16GB + NVMe 1TB + Coral TPU USB ou Jetson Orin Nano |
| Hardware cliente | R$ 0 | R$ 500-800 | R$ 1.500-3.000 |
| Buffer local | 0 | 24-72h | 7-14 dias |
| AI edge | Não | Não (cloud) | Sim (always-on) |
| Tier | Starter | Pro/Business | Business/Enterprise |
| Tempo setup | 30 min | 15 min (QR) | 30 min |
| Resiliência ISP | Baixa | Média | Alta |
| **Status atual** | ✅ Em produção | ✅ Em produção (Hikvision lab BR) | 🟡 Hardware existe; falta calibrar Edge AI |

### 6.3 Roadmap edge

- **Onda 1 (M0-M1):** documentar manual de instalação cenário B + criar repositório separado para firmware
- **Onda 2 (M1-M2):** imagem oficial ICV-Bridge OS gravável em SSD (Debian 12 + containers pré-configurados)
- **Onda 3 (M2-M3):** OTA workflow completo (Cloud envia comando → Box pull image SHA256 → restart com rollback)
- **Onda 4 (M3+):** cenário C produtivo com Coral TPU, modelos calibrados (PPE, pessoa/veículo, fogo)

---

## 7. Estratégia Comercial e Go-to-Market

### 7.1 Pricing (proposta para validar com integradores)

#### Tier Integrador (cobramos do integrador)

| Tier | Preço/câmera/mês | Retenção | IA | Edge Box | Suporte |
|---|---|---|---|---|---|
| **Starter** | R$ 19 | 7 dias eventos | Motion only | Cenário A | Email business hours |
| **Pro** | R$ 39 | 30 dias contínua | Motion + Person/Vehicle | Cenário A/B | Email 24/7 |
| **Business** | R$ 69 | 90 dias contínua | + Face + LPR + Audio | Cenário B/C | Email + WhatsApp 24/7 |
| **Enterprise** | sob proposta | até 5 anos | Suite completa + Smart Search NLP + custom | Cenário C | SLA dedicado |

**Sem consumo mínimo de receita.** Sem fee de setup. Sem mínimo de câmeras.

**Comparativo competitor (R$/cam/mês):**
- Monuv: ~R$ 60-90 (com mín R$ 900/mês)
- BeNuvem: sob proposta
- Oktopus: ~R$ 30-80 turnkey
- Eagle Eye: ~$15-50 USD = ~R$ 80-280
- Verkada: ~$200+ USD = ~R$ 1.100+

**Nossa pegada:** competitivo no Pro, premium acessível no Business, abertura SMB no Starter.

#### Tier Cliente Final (sugerido para integrador, opcional)

Oferecemos sugestão de precificação para o integrador, mas cada um ajusta. Margem alvo de 30-60% sobre nosso preço.

### 7.2 Programa Parceiro Integrador

**Tiers de parceria:**

| Tier | Critério | Benefício |
|---|---|---|
| **Bronze** | Auto-cadastro | Até 50 câmeras, suporte email, R$ 19-39/cam |
| **Silver** | 50-200 câmeras ativas + 3 meses ativo | Desconto 10%, treinamento, co-marketing |
| **Gold** | 200-1000 câmeras + case study aprovado | Desconto 20%, Mission Control beta, gerente dedicado |
| **Platinum** | 1000+ câmeras + cobertura nacional | Custom pricing, white-glove onboarding, integração custom |

### 7.3 Go-to-Market — primeiros 90 dias

**Mês 1 (M0):** estabilização interna; nenhum cliente externo. Foco em P0 + 2FA + CI.

**Mês 2 (M1):**
- Lançamento de pricing público
- 1 integrador piloto fechado (já no radar via network do Tarcísio)
- LinkedIn post sobre lançamento, ad campaign R$ 500/mês para landing /pricing
- Demo gravada (5-10 min) no YouTube

**Mês 3 (M2):**
- 3-5 integradores piloto entrando (1 por vertical: central monitoramento, condomínio, varejo)
- 1 case study publicado
- Participar de 1 evento setor (Seg Summit, ExpoSec, Encontro Abese)
- Marketplace de integrações fase 1

**Mês 4-6 (M3-M5):**
- 10-20 integradores ativos
- ARR alvo: R$ 300k-500k/ano
- 2 verticais com case study sólido
- Mobile nativa em loja Apple/Google

### 7.4 Canais de aquisição

| Canal | Esforço | ROI esperado |
|---|---|---|
| LinkedIn outreach (Tarcísio) | Alto | Alto (B2B BR) |
| SEO orgânico (blog técnico, comparativo Monuv) | Médio (4-6 meses) | Alto longo prazo |
| Anúncios Google Search "VMS cloud", "monitoramento IP nuvem" | Baixo (R$ 1k/mês) | Médio |
| Eventos setor (Abese, ExpoSec) | Alto (R$ 5-15k/evento) | Alto (B2B fechamento alto valor) |
| Indicação de integrador para integrador | Baixo | Altíssimo |
| Comunidades CFTV (Telegram, fóruns) | Baixo | Médio |
| YouTube tutorial (canal próprio) | Médio | Médio |

### 7.5 Onboarding do integrador (objetivo: 1ª câmera em 10 min)

```
1. Lead chega via /pricing → "Quero começar"
2. Cadastro em 1 form (nome, email, CNPJ, segmento)
3. Email de verificação + criação automática de tenant Integrador
4. Wizard inicial:
   a. Configurar marca (logo + cores)
   b. Configurar custom domain (opcional, depois)
   c. Adicionar 1ª câmera de teste (RTSP ou ICV-Bridge)
   d. Ver live em 30s
5. Primeiro mês grátis até 5 câmeras (trial real)
6. Cobrança automática do mês 2 em diante
```

---

## 8. Métricas Operacionais e Comerciais

### KPIs de produto (semanal)
- Câmeras ativas streamando (meta M3: 200; M6: 1.000)
- Tenants ativos integradores (meta M3: 5; M6: 20)
- Latência live P95 (meta: <500ms)
- Uptime live (meta SLA: 99.5%)
- Falhas de upload de gravação (<1%)
- Tempo médio de ativação de câmera nova (<5 min)

### KPIs comerciais (mensal)
- MRR (meta M3: R$ 5k; M6: R$ 50k; M12: R$ 200k)
- LTV/CAC (meta: >3)
- Churn mensal (meta: <5%)
- NPS dos integradores (meta: >40)
- Tempo médio de vendas (lead → fechado, meta <30 dias)

### KPIs de qualidade (quinzenal)
- Bugs reportados por integrador piloto
- MTTR de incidente (meta: <2h)
- Cobertura de testes E2E em fluxos críticos (meta M3: 50% dos 10 fluxos)
- Vulnerabilidades críticas em backlog (meta: 0)

---

## 9. Quick Wins — Próximos 30 dias

Lista priorizada do que entregar nesta primeira onda. Cada um tem impacto alto e esforço baixo.

| # | Quick Win | Impacto | Esforço |
|---|---|---|---|
| QW1 | Fechar P0 (rotação + git-filter-repo) | 🔴 Bloqueio total | 1 sem |
| QW2 | 2FA TOTP SUPER_ADMIN | 🟢 Diferencial vs. todos BR | 0.5 sem |
| QW3 | Backup Postgres off-site (R2 + cron + restore validado) | 🟢 Risco crítico | 0.5 sem |
| QW4 | Sentry + correlation IDs nos logs | 🟢 Visibilidade incidente | 0.5 sem |
| QW5 | Pricing público em `/pricing` | 🟢 Bloqueio comercial | 0.5 sem |
| QW6 | Demo read-only em `/demo` | 🟢 Gancho de venda | 0.5 sem |
| QW7 | OpenAPI Redoc em `api.iacloud.com.br/docs` | 🟢 Diferencial técnico (BeNuvem não tem) | 1 sem |
| QW8 | Mosquitto com auth + TLS | 🟢 Vetor de ataque fechado | 0.5 sem |
| QW9 | Desativar workflows Frigate | 🟢 Economia GitHub Actions | 0.1 sem |
| QW10 | Manual de instalação Cenário B do ICV-Bridge | 🟢 Vendável | 0.5 sem |

**Total estimado:** 5-6 semanas de 1 dev solo. Cabe perfeitamente na Onda 1.

---

## 10. Riscos a Monitorar

| Risco | Probabilidade | Mitigação |
|---|---|---|
| 1 dev solo não dá conta de Onda 1 + 2 | Alta | Contratar QA freelancer em M1, dev pleno em M2 |
| Hetzner cair durante demo importante | Média | Standby VPS pronta + DNS failover; backup off-site testado |
| Monuv lança 2FA antes do nosso piloto | Média | Pricing transparente + audit + LGPD compensam |
| Eagle Eye entra no BR com Bridge | Baixa | Nossa stack BR + suporte PT + integrações Sigma/Moni |
| Capacidade do VPS não suporta 5 pilotos | Alta (a partir de M3) | Migrar para Hetzner CPX31 ou CPX41 (4-8 vCPU dedicado) |
| Integrador piloto vai embora | Média | Contrato POC pago (não trial gratuito puro) |
| Gravação MOTION stub vira reclamação | Alta | Corrigir em Onda 1 (item 1.10 já contempla recording.service) |
| Mobile PWA não convence | Média | Onda 4 entrega Capacitor; vender PWA "por enquanto" |
| Custom domain SSL falha em escala | Média | ACME wildcard via Cloudflare evita per-domain cert; testar com 10+ domains antes |

---

## 11. Decisões pendentes (precisam fechar antes da Onda 2)

| # | Decisão | Default sugerido | Quem decide |
|---|---|---|---|
| 1 | Mobile: Capacitor ou React Native? | **Capacitor** (reusa React 19 do web) | Tarcísio |
| 2 | Vector DB para Smart Search: pgvector ou Qdrant? | **pgvector** (já tem Postgres) | Tarcísio |
| 3 | OTA do ICV-Bridge: container restart vs. imagem completa? | **Container restart** primeiro, imagem completa V2 | Tarcísio |
| 4 | Tunnel cloud↔box: Cloudflare ou WireGuard adicional? | **Cloudflare** já em produção, mantém | (decidido) |
| 5 | OEM hardware Box? | **BOM aberto** + manual; OEM fase 2 | Tarcísio |
| 6 | Tier Starter inclui retenção? | **7 dias eventos** (motion only) | Tarcísio |
| 7 | API: REST puro ou tRPC + REST? | **REST + OpenAPI** (universal) | Tarcísio |
| 8 | Sentry self-hosted ou cloud? | **Cloud free tier** primeiro, self-hosted V2 | Tarcísio |
| 9 | Backup off-site: R2 ou Backblaze B2? | **R2** (já temos credenciais; Backblaze fase 2) | Tarcísio |
| 10 | Quem contrata QA freelancer? | LinkedIn Brasil — perfil júnior-pleno | Tarcísio |
| 11 | Eventos setor: SegSummit ou ExpoSec primeiro? | **SegSummit** (mais B2B; outubro) | Tarcísio |
| 12 | Pricing Starter: R$ 19 firme ou variável? | **R$ 19 firme** público; cupons para parceiros | Tarcísio |

---

## 12. Como usar este plano

- **Revisão semanal (sex):** marcar QW completados; mover entre ondas se necessário
- **Antes de cada nova feature:** consultar Inventário (Parte 2) — provavelmente já existe
- **Antes de demo comercial:** revisar Posicionamento (4.3) e Pricing (7.1)
- **Antes de aceitar integrador piloto:** validar contra Onboarding (7.5)
- **Re-pesquisar competidores:** semestral (próximo: 2026-11)
- **Decisões da Parte 11:** fechar todas até final de M0

**Próxima ação concreta:** validar este plano comigo (Tarcísio) → fechar 12 decisões pendentes → executar Onda 1 (próximas 4 semanas).

---

## Apêndice A — Rastreabilidade de features vs. competidores

Para cada feature crítica, status nosso vs. competidores. Útil para apresentação de venda.

| Feature | IA Cloud Vision | Monuv | BeNuvem | Oktopus | Eagle Eye | Milestone |
|---|---|---|---|---|---|---|
| Multi-tenant nativo 3 níveis | ✅ | ⚠️ | ⚠️ | ❓ | ⚠️ | ❌ |
| 2FA/MFA login | 🟡 Onda 1 | ❌ | ❌ | ❌ | ✅ | ✅ |
| Audit log com diff | ✅ | ❓ | ❓ | ❓ | ✅ | ✅ |
| White-label completo | ✅ | ✅ | ⚠️ SSL quebrado | ❓ | ⚠️ | ❌ |
| Custom domain SSL automático | 🟡 Onda 2 | ❓ | ❌ | ❓ | ⚠️ | ❌ |
| Smart Search NLP em vídeo | 🟡 Onda 3 | ❌ | ⚠️ por evento | ❌ | ✅ | ⚠️ |
| Edge box buffer + backfill | ✅ | ❌ | ❌ | ⚠️ HVR | ✅ | ⚠️ |
| Pricing público transparente | 🟡 Onda 2 | ❌ | ❌ | ✅ | ❌ | ❌ |
| Sem consumo mínimo | 🟡 Onda 2 (R$ 19/cam) | ❌ R$ 900/mês | ❓ | ⚠️ tier | ❌ Bridge $500 | ❌ |
| Open API + Redoc | 🟡 Onda 2 | ⚠️ | ❌ | ❓ | ✅ | ✅ |
| Telegram nativo com foto | 🟡 Polir | ❓ | ✅ destaque | ❓ | ❌ | ❌ |
| WhatsApp nativo | ✅ | ❓ | ❌ | ❓ | ❌ | ❌ |
| LPR com SINESP/Cortex | 🟡 Onda 3 | ✅ | ✅ | ❓ | ❌ | ❌ |
| Integrações Sigma/Moni | 🟡 Onda 3 | ✅ nativa | ✅ homologado | ❓ | ❌ | ❌ |
| PPE detection | 🟡 Onda 3 | ❓ | ✅ | ❓ | add-on | add-on |
| Mobile nativa | 🟡 Onda 4 | ✅ | ✅ iOS 18+ | ✅ | ✅ | ✅ |

Legenda: ✅ funciona em produção, 🟡 em desenvolvimento, ⚠️ parcial/limitado, ❌ não tem, ❓ não documentado.

**Observação importante:** assim que Ondas 1-3 fecharem, a maioria dos 🟡 vira ✅, e nosso comparativo fica visivelmente superior aos 4 BR em quase todas as colunas críticas.
