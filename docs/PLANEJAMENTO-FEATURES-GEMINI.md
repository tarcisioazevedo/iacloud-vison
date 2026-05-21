# Plano Integrado — Features IA Comerciais

> **Data:** 2026-05-21
> **Princípio condutor:** **não duplicar nada**. Cada feature nova é wire/expansão de página/service/route existente.
> **Esforço total revisado:** 15-19 semanas (vs 22-30 originais) — **30% de economia por reuso**.

---

## Mapa de Reuso (o que já está construído e será aproveitado)

### Serviços GenAI prontos no backend (`genai.service.ts`)
| Função | Onde já é chamada | Será usada por |
|---|---|---|
| `describeEvent(images)` | `event-genai-job` (auto-descrição) | AI Triage |
| `describeLiveScene(jpeg)` | endpoint `/ai-agent/describe-live` | "Pergunte à IA" no live · Alertas Semânticos |
| `captionFrame(jpeg)` | `caption-worker` (semantic-search) | Busca Semântica · Heatmap context |
| `chatWithTools(messages, tools)` | `/ai-agent/chat` (já em uso) | AI Assistant — só faltam tools novos |
| `summarizePeriod(prompt)` | `daily-briefing.service` | Briefing WhatsApp · Relatório PDF |
| **`readPlate(jpeg)`** | nenhum (wire pendente) | **LPR Inteligente** |
| **`compareSubjects(a, b)`** | nenhum (wire pendente) | **Reconhecimento Facial** |
| **`classifyFalsePositive(jpeg)`** | nenhum (wire pendente) | **AI Triage · anti-ghost** |
| **`pointToObject(jpeg, q)`** | endpoint `/ai-agent/point` | **LGPD blur automático** |

### Páginas frontend que serão **expandidas** (não recriadas)
| Página atual | Estado | O que ganha |
|---|---|---|
| `LivePage` + `LivePlayer` | wired | Botão IA fala/escreve · chip LPR/FR · alertas inline |
| `PlatesPage` | **stub vazio** | UI completa LPR + watchlist |
| `FacesPage` | **stub vazio** | UI completa FR + pessoas + matches |
| `SemanticSearchPage` | parcial | Filtro temporal + cluster + thumbs |
| `MotionSearchPage` | parcial | Mescla com semantic |
| `HeatmapPage` | esqueleto | Overlay + funil + comparativo |
| `FrigateReviewsPage` | parcial | AI Triage (rotina/suspeito/crítico) |
| `ReviewRulesPage` | tem regras YOLO | Alertas semânticos em linguagem natural |
| `TriggersPage` | wired | Ação automática por evento IA (portão, sirene) |
| `LgpdRequestsPage` | wired | Auto-blur antes do export |
| `AlertsPage` + `AlertConfigPage` | wired | Novo tipo de alerta: semântico |
| `ClienteCockpitPage` | wired | Cards de features IA + insights |
| `IntegradorCockpitPage` | wired | KPIs de uso IA por cliente |
| `IntegradorMarketplacePage` | wired | Bundles com features IA |
| `FabricanteMarketplacePage` | wired | CRUD do marketplace IA |
| `MinhasAssinaturasPage` | wired | Add-ons IA exibidos |
| `DemographicsPage` | wired | Plug-in pra FR (idade/gênero estimado) |
| `AnalyticsPage` | wired | Métrica de uso IA |
| `DashboardPage` | wired | Briefing IA |
| `SettingsPage` | wired | Config Gemini por integrador |

### Routes existentes a serem completadas
| Route | Estado | Endpoints novos |
|---|---|---|
| `plates.ts` | vazio | `POST /plates/read` · `GET /plates/watchlist` · `POST /plates/event` |
| `faces.ts` | vazio | `POST /faces/enroll` · `GET /faces/matches` · `POST /faces/search` |
| `lgpd.ts` | parcial | `POST /lgpd/auto-blur` (chama pointToObject) |
| `triggers.ts` | wired | Adiciona `eventType: "lpr.match"`, `"face.match"`, `"semantic.fire"` |
| `alert-config.ts` | wired | Tipo `SEMANTIC_RULE` (chama Gemini periódico) |
| `review.ts` | wired | Adiciona AI Triage workflow |
| `detections.ts` | wired | Hook `classifyFalsePositive` antes de criar evento crítico |
| `daily-briefing.service` | wired | Adiciona envio Evolution (WhatsApp) |

### Infra que **já está pronta** e será reaproveitada
- ✅ **pgvector** instalado (FR embeddings)
- ✅ **Norfair tracking** com Kalman (Heatmap usa posições)
- ✅ **MarketplaceProduct** + admin/integrador/me — pricing flow completo
- ✅ **NotificationChannel + AlertRecipients** — entrega multi-canal
- ✅ **Trigger** — automação por evento (acionar portão MQTT)
- ✅ **Evolution API** (WhatsApp) — briefing + alertas
- ✅ **Asaas + webhooks** — cobrança add-ons
- ✅ **AuditLog** — todo evento IA já vai pra audit por padrão
- ✅ **specialist_router.py** no worker (já configurado pra EPI/PPE/Weapon)
- ✅ **caption-worker** (gera embeddings de cenas pra busca semântica)
- ✅ **MediaMTX ingest** (ingest.service + srt-ingest com RTMP/SRT/RTSP)

---

## Onda 1 — 4-5 semanas (vs 6-8 originais)

### 🚗 LPR Inteligente · 2 semanas

**Wire/expansão:**
- `vsaas-ai-worker/camera_worker.py`: ao detectar `car/truck/motorcycle` com bbox > 8% do frame e track confirmado, chama backend `POST /plates/read` enviando crop JPEG.
- `vsaas-backend/src/routes/plates.ts`: implementar endpoints (read, watchlist CRUD, listagem com filtros).
- `vsaas-backend/src/services/genai.service.ts`: já tem `readPlate(jpeg)` — apenas chamar.
- **Frontend `PlatesPage.tsx`**: lista de leituras com thumbnail, filtro câmera/data/placa, sub-tab Watchlist (CRUD).
- **Frontend `LivePlayer.tsx`**: adicionar painel lateral lendo `last_plate_read` via SSE quando carro for detectado.
- **Frontend `TriggersPage.tsx`**: novo tipo de trigger "LPR match → MQTT publish (abrir portão)".
- **Schema novo:** `LicensePlateRead`, `LprWatchlist` (2 tabelas).

**Esforço:** 2 sem (era 3 sem isolado).

### 🎯 Alertas Semânticos · 1.5 semanas

**Wire/expansão:**
- Novo cron `semantic-rule.service.ts`: tick 30s, busca regras enabled, chama `genai.describeLiveScene` + compara com prompt usando Gemini função "matches?".
- `vsaas-backend/src/routes/alert-config.ts`: adicionar `type: SEMANTIC_RULE` no schema atual.
- **Frontend `ReviewRulesPage.tsx`**: adicionar aba "Regras Semânticas" reaproveitando UI de regras YOLO existente.
- Reusa: `NotificationChannel`, `AlertRecipients`, `Trigger`.
- **Schema novo:** `SemanticRule` (1 tabela; ou JSON dentro de `AlertConfig`).

**Esforço:** 1.5 sem (era 4).

### 🏭 EPI Compliance · 1 semana

**Wire/expansão:**
- `vsaas-ai-worker/specialist_router.py`: já tem PPE (`construction-safety-gsnvb/1`) configurado — apenas ativar para câmeras industriais.
- `vsaas-backend/src/routes/detections.ts`: adicionar handler pra evento tipo `EPI_VIOLATION`.
- **Frontend `HealthScoresPage.tsx`**: novo card "EPI Compliance Score" por câmera/turno (`% trabalhadores com EPI completo`).
- **Frontend `ExportsPage.tsx`** ou novo botão: exportar PDF auditoria SSMA mensal (usa `summarizePeriod`).
- **Schema novo:** `EpiViolation` (1 tabela).

**Esforço:** 1 sem (era 3).

---

## Onda 2 — 5-6 semanas

### 👤 Reconhecimento Facial · 2 semanas

**Wire/expansão:**
- Worker: ao detectar `person` com bbox grande + face visível, extrai crop → backend chama `genai.captionFrame` ou específico de FR → gera embedding → grava em pgvector.
- `vsaas-backend/src/routes/faces.ts`: enroll (3-5 fotos), search top-K cosine.
- `vsaas-backend/src/services/genai.service.ts`: `compareSubjects` já existe pra match confirm.
- **Frontend `FacesPage.tsx`**: lista pessoas, enroll modal, matches recentes.
- **Frontend `LivePlayer.tsx`**: chip de match no bbox da pessoa.
- **Frontend `DemographicsPage.tsx`**: integração — usa FR pra estimar demografia.
- **Schema novo:** `Person`, `FaceEmbedding` (vector(512) pgvector).
- **LGPD:** opt-in obrigatório no cadastro do cliente; audit log de cada match.

**Esforço:** 2 sem (era 4).

### 📊 Heatmap Retail · 1.5 semanas

**Wire/expansão:**
- Worker: tracker Norfair já mantém posições — agregar centróides em grid 32x18 por minuto e enviar batch.
- `vsaas-backend/src/routes/bi.ts`: endpoint agregação `GET /bi/heatmap?cameraId&from&to&bucket`.
- **Frontend `HeatmapPage.tsx`** (esqueleto existe): overlay canvas + slider hora + comparativo dia vs semana.
- **Frontend `AnalyticsPage.tsx`**: adiciona seção "Fluxo & Heatmap" linkando.
- **Schema novo:** `HeatmapBucket` (1 tabela).

**Esforço:** 1.5 sem (era 3).

### 🔍 Busca Semântica em Vídeo · 1.5 semanas

**Wire/expansão:**
- `caption-worker.service.ts` **já caption** a cada 30s — só precisa rodar pra mais câmeras.
- `semantic-search.ts` existe — adicionar filtros temporal/câmera/cluster.
- **Frontend `SemanticSearchPage.tsx`** (existe parcial): adicionar timeline com clusters, mini-player inline.
- **Frontend `MotionSearchPage.tsx`** + nova: link bidirecional (motion → semantic re-query).

**Esforço:** 1.5 sem (era 3).

---

## Onda 3 — 6-8 semanas

### 🚨 AI Triage 24/7 · 3 semanas

**Wire/expansão:**
- Hook em `detections.ts`: quando evento crítico (weapon, person noturna em zona restrita) é criado, chama `classifyFalsePositive(jpeg)` → se confirmado, escala via `NotificationChannel` para WhatsApp dono + SMS porteiro.
- `notify-detection.service` (cron existente) ganha lógica de triagem.
- **Frontend `FrigateReviewsPage.tsx`**: nova aba "Triagem IA" com fila por nível (rotina/suspeito/crítico).
- **Frontend `ReviewPage.tsx`**: botão "Pedir 2ª opinião IA" usa `describeEvent`.
- Nenhum schema novo (reusa `DetectionEvent.metadata`).

**Esforço:** 3 sem.

### 🛡️ LGPD Compliance · 2 semanas

**Wire/expansão:**
- Pipeline `export.service.ts`: antes de gerar mp4 de export, chama `pointToObject(jpeg, "face,license_plate")` → ffmpeg aplica blur com `boxblur`.
- `vsaas-backend/src/routes/lgpd.ts` (já parcial): adicionar `auto_blur_enabled`.
- **Frontend `LgpdRequestsPage.tsx`**: adicionar toggle "Blur automático nesta solicitação".
- Audit detalhado: quem viu o quê.

**Esforço:** 2 sem.

### 🤝 AI Assistant Avançado · 3 semanas

**Wire/expansão:**
- **TUDO base já existe**: `ai-agent.service`, `chatWithTools`, `/ai-agent/chat`, `/describe-live`, `/point`, `/analyze-timeline`.
- Adicionar **novos tools** ao function calling:
  - `searchPlates(query, period)` → consulta `LicensePlateRead`
  - `searchFaces(query)` → consulta `FaceEmbedding`
  - `compareDays(cam, day1, day2)` → análise comparativa
  - `whatHappenedBetween(cam, ts1, ts2)` → captioning sequencial
- **Frontend**: melhorar UX do "Pergunte à IA" — abrir como drawer (não modal), com histórico, voice input opcional.
- **Frontend `IntegradorCockpitPage`**: AI Assistant embutido pro integrador ("compare meus 3 maiores clientes").

**Esforço:** 3 sem.

### 📱 Daily Briefing via WhatsApp · 1 semana (extra)

**Wire/expansão:**
- `daily-briefing.service` (existe) → adicionar canal WhatsApp via `evolution.service` (existe).
- **Frontend `SettingsPage.tsx`**: opt-in toggle + horário + telefone.

**Esforço:** 1 sem.

---

## Schemas novos (apenas o que precisa)

```prisma
// = Onda 1 =

model LicensePlateRead {
  id              String   @id @default(uuid())
  cameraId        String
  plate           String
  confidence      Float
  vehicleType     String?
  bboxX           Float
  bboxY           Float
  bboxW           Float
  bboxH           Float
  watchlistHit    String?  // labelIn match
  triggeredAction String?  // "open_gate" se trigger acionou
  ts              DateTime @default(now())
  camera          Camera   @relation(fields: [cameraId], references: [id])
  @@index([cameraId, ts])
  @@index([plate])
}

model LprWatchlist {
  id             String   @id @default(uuid())
  clienteFinalId String
  plate          String
  label          String
  action         String   // "allow" | "alert" | "block"
  enabled        Boolean  @default(true)
  createdAt      DateTime @default(now())
  clienteFinal   ClienteFinal @relation(fields: [clienteFinalId], references: [id])
  @@unique([clienteFinalId, plate])
}

model SemanticRule {
  id              String   @id @default(uuid())
  cameraId        String
  prompt          String   @db.Text
  intervalSec     Int      @default(30)
  enabled         Boolean  @default(true)
  lastFiredAt     DateTime?
  fireCount       Int      @default(0)
  notifyChannels  String[]
  alertConfigId   String?  // FK pra AlertConfig se usar canal compartilhado
  camera          Camera   @relation(fields: [cameraId], references: [id])
}

model EpiViolation {
  id          String   @id @default(uuid())
  cameraId    String
  missingEpi  String[] // ["helmet", "vest", "gloves", "mask"]
  workerBbox  Json
  snapshotKey String?  // R2
  ts          DateTime @default(now())
  @@index([cameraId, ts])
}

// = Onda 2 =

model Person {
  id             String   @id @default(uuid())
  clienteFinalId String
  name           String
  category       String   // "morador" | "funcionario" | "visitante" | "blacklist"
  lgpdConsentAt  DateTime
  active         Boolean  @default(true)
  embeddings     FaceEmbedding[]
  @@index([clienteFinalId, category])
}

model FaceEmbedding {
  id        String   @id @default(uuid())
  personId  String
  vector    Unsupported("vector(512)") // pgvector ja instalado
  source    String   // 'enroll' | 'live'
  ts        DateTime @default(now())
  person    Person   @relation(fields: [personId], references: [id])
}

model HeatmapBucket {
  id        String   @id @default(uuid())
  cameraId  String
  tsBucket  DateTime
  gridX     Int      // 0-31
  gridY     Int      // 0-17
  count     Int      @default(1)
  @@unique([cameraId, tsBucket, gridX, gridY])
}
```

---

## Cronograma (semanas reais)

```
W1-2   ████ LPR (wire plates.ts + UI + watchlist + triggers)
W3     ███  Alertas Semânticos (cron + ReviewRulesPage tab)
W4     ███  EPI Compliance (HealthScoresPage + PDF SSMA)
W5     ██   Onda 1 polish + marketing

W6-7   ████ FR (faces.ts + pgvector + LivePlayer chip)
W8-9   ████ Heatmap (HeatmapPage + bi.ts)
W10-11 ████ Busca Semântica full (SemanticSearchPage)
W12    ██   Onda 2 polish

W13-15 ████ AI Triage (FrigateReviewsPage + classifyFalsePositive)
W16-17 ████ LGPD blur (pipeline export + pointToObject)
W18-20 ████ AI Assistant tools + UX drawer + voice
W21    ██   Daily Briefing WhatsApp

W22+   Marketing onda 3 + lançamento Enterprise
```

**Total:** 19-21 semanas (em vez de 27-30 isolado) — economia real de **8-10 semanas** por integração.

---

## Mockup integrado

Ver `docs/mockup-features-gemini.html` — agora cada feature aparece **dentro** das telas existentes (LivePage, PlatesPage, FacesPage, HeatmapPage, ReviewRulesPage etc.), com badges indicando o que reusa.
