# 21 — Google Video AI B2B2B (Vertex Vision + Gemini + Video Intelligence + Cloud Vision)

> **Data:** 2026-05-09 · **Status:** Plano (não implementar sem decisão das §13 perguntas)
> **Autor:** Tarcísio (drafted by Claude — staff engineer)
> **Estende:** `docs/16-PLAN-WHITELABEL-PRICING-MULTITENANT.md` (capability pricing + wholesale floor),
> `docs/18-PLAN-MARKETPLACE-3-NIVEIS-PREMIUM.md` (catálogo SKU + Order state machine),
> `docs/17-PLAN-STORAGE-ADMIN-FIM-A-FIM.md` (medição/recon),
> `docs/09-PLAN-PLAYBACK-AVANCADO.md` (busca semântica deferida).
> **Não duplica** schema, marketplace UX nem cascade de pricing — preenche o que falta para virar real.

---

## 0. Sumário executivo (TL;DR)

A IACloud já tem o cano técnico montado: `vertex.service.ts` provisiona Stream/Application com BigQuery sink, `vertex-face.service.ts` gera embedding multimodal de 1408 dims via `multimodalembedding@001`, `vision.service.ts` envelopa Cloud Vision (FACE/LABEL/LOGO/OBJECT/SAFE_SEARCH), e `routes/semantic-search.ts` + `routes/faces.ts` já roteiam consumidores. O `docs/18` já desenhou os SKUs comerciais (`ai-lpr` R$ 79, `ai-ppe` R$ 89, `ai-face-recognition` R$ 129, `ai-semantic-search` R$ 49 etc.) com markup integrador 30%.

**O que falta — e este plano cobre:**

1. **Mapping** do que cada SKU consome no Google (qual API, modo, free tier, preço unitário) com **margem real calculada** — alguns SKUs precisam ajuste senão IA Cloud paga pra trabalhar.
2. **Pipeline de medição** (meter) que registra consumo Google por câmera/integrador/CF em granularidade fina (minute/image/token) e emite eventos para 3 destinos: cobrança Google (auditoria), fatura IA Cloud→Integrador, fatura Integrador→CF.
3. **Cadeia de faturamento B2B2B** com 4 momentos do dinheiro distintos — quem fatura quem, quando, com qual margem, e como reconciliar quando Google cobra a IA Cloud em USD e o Integrador paga em BRL.
4. **Quotas pré-contratadas** vs **pay-as-you-go**: dois modos de cobrança coexistindo no mesmo SKU.
5. **Mapeamento Vertex AI → Gemini Enterprise Agent Platform**: a Google está migrando o branding; o REST endpoint segue funcionando, mas há decisão de modelo (Gemini 2.5 Flash vs 3.1 Flash-Lite vs 3 Pro) com impacto direto na margem.
6. **Provisionamento dinâmico** integrado a Order: quando CF aprova LPR no marketplace, o sistema dispara `vertexService.provisionCamera()` automaticamente, e quando cancela, faz undeploy/teardown.
7. **Compliance LGPD** específica de IA: face = dado biométrico sensível (LGPD art. 11) — consentimento explícito + retenção configurável + direito de exclusão real.

**Tese central:** existe uma janela de margem confortável (35–60% bruta) em todos os SKUs **se** indexarmos só keyframes/eventos (não vídeo contínuo) e usarmos Gemini Flash-Lite como motor padrão de busca semântica. Os SKUs que não cabem nessa margem (`ai-semantic-search` em vídeo bruto, `ai-face-recognition` se rodar 24/7) precisam ou aumentar preço de varejo, ou virar consumo medido (PAYG).

---

## 1. Estado atual — o que já está pronto

### 1.1 Código (vsaas-backend/src)

| Arquivo | Função | Maturidade |
|---|---|---|
| `services/vertex.service.ts` | `createStream`, `createApplication`, `deployApplication`, `provisionCamera(cameraId, integradorId, models[])`. Built-ins suportados: `OCCUPANCY_ANALYTICS`, `PPE_DETECTION`. Cria BigQuery dataset/table por integrador. | Pronto pra prod (precisa creds reais GCP) |
| `services/vertex-face.service.ts` | `embed()` via `multimodalembedding@001` (1408 dims, L2-norm), `detectFaces()` via Cloud Vision FACE_DETECTION, `cosineSim`, `topK`. Mock determinístico SHA-256 para DEV. | Pronto |
| `services/vision.service.ts` | `annotate(imageB64, features[])` com FACE/LABEL/LOGO/OBJECT/SAFE_SEARCH. Mock realista para DEV. | Pronto |
| `routes/semantic-search.ts` | Endpoint de busca semântica (precisa auditar pricing — pode estar a custo zero hoje no mock) | Existe — verificar |
| `routes/faces.ts` | CRUD de FaceIdentity + FaceEmbedding + match | Existe |
| `services/quota.service.ts` + `jobs/quota-reset.ts` | Framework de quota mensal por tenant | Existe |
| `lib/embedding.ts` | Helper de embedding | Existe |

### 1.2 Documentação relevante

- **`docs/16` — White-label Pricing**: `PlatformPlan.wholesalePriceMonthly` define piso server-side validado em qualquer override de integrador. Capability `pricing` derivada do tier (NONE/BASIC/PRO/ENTERPRISE). **Reaproveitar**: estende esse mecanismo para qualquer `Product` (não só `PlatformPlan`).
- **`docs/17` — Storage Admin**: padrão de medição/recon entre custo R2 e faturado. **Reaproveitar**: o mesmo padrão (`UsageMeter`, `BillingReconciliation`) serve para IA.
- **`docs/18` — Marketplace 3 Níveis**: SKUs `ai-*` já desenhados com preço B2B IA Cloud → Integrador e markup 30% sugerido CF. State machine de `Order` (rascunho → aprovação → ativação). **Reaproveitar inteiro** — este plano só preenche o que cada SKU custa e como medir.
- **`docs/09` — Playback Avançado**: busca semântica deferida com nota "GPU 18d+". **Substituir** parcialmente: Gemini Flash-Lite resolve sem GPU local (mas cobra por token).

---

## 2. Inventário Google Cloud — capacidades + pricing real

> Pricing levantado 2026-05-09 (Cloud Vision, Video Intelligence, Vertex AI Vision, Vertex Generative AI). Câmbio assumido R$ 5,40/USD para os exemplos. **Confirmar todas as tabelas no console GCP antes de fechar contrato com integrador** — Google muda preço sem aviso (vide depreciação Celebrity Recognition em 2025-09-16).

### 2.1 Cloud Vision API (imagens — snapshot a snapshot)

| Feature | Free tier | 1k–5M unidades/mês | 5M+ unidades/mês |
|---|---|---|---|
| Label / Text / Face / Logo / Landmark / ImageProps | 1.000/mês | **$1,50 / 1.000 = $0,0015/img** | $0,60 / 1.000 = $0,0006/img |
| Object Localization | 1.000/mês | **$2,25 / 1.000 = $0,00225/img** | $1,50 / 1.000 = $0,0015/img |
| Web Detection | 1.000/mês | $3,50 / 1.000 = $0,0035/img | sob consulta |
| SafeSearch | grátis com Label | grátis com Label | grátis com Label |
| Crop Hints | grátis com ImageProps | grátis com ImageProps | grátis com ImageProps |

**Use cases CCTV**: snapshot em evento (motion-trigger), OCR de placa pontual, detecção de face em foto de visita, blur LGPD.

### 2.2 Video Intelligence API (vídeo gravado/streaming)

| Feature | Stored (após 1k min/mês) | Streaming (após 1k min/mês) |
|---|---|---|
| Label Detection | $0,10/min | $0,12/min |
| Explicit Content | $0,10/min | $0,12/min |
| Face Detection (sem ID) | $0,10/min | — |
| Person Detection | $0,10/min | — |
| Object Tracking | $0,15/min | $0,17/min |
| Text Detection (OCR vídeo) | $0,15/min | — |
| Logo Detection | $0,15/min | — |
| Speech Transcription | $0,048/min (en-US) | — |
| Image Detection | $0,05/min ou grátis com Label | $0,07/min |
| Shot Change | listada mas sem preço público | — |

**Use case CCTV**: análise de gravação histórica (audit forense, indexação retroativa).

### 2.3 Vertex AI Vision (streaming managed — o que `vertex.service.ts` usa)

| Item | Preço | Modelo de cobrança |
|---|---|---|
| Stream ingress | $0,0085/GB | volume |
| Stream egress | $0,0085/GB | volume |
| Built-in models (Person/Vehicle, PPE, Object, Face Blur) | **$0,10/min OU $10/stream/mês** | escolha mensal vs PAYG |
| AutoML custom (Detection) | $0,20/min OU $20/stream/mês | escolha |
| Occupancy Analytics Suite | **$20/stream/mês** (só mensal) | flat |
| Visual Inspection AI (Anomaly/Assembly/Cosmetic) | $100/câmera/mês cada | flat |
| Visual Inspection training | $2/node-hour | sob demanda |
| Data Warehouse video storage | $0,020/GB-mês | volume |
| Data Warehouse index | $3/node-hour | sob demanda |
| BigQuery / Pub/Sub sinks | sem cobrança extra (paga BQ/PubSub padrão) | — |

**Use case CCTV**: análise contínua 24/7 (LPR sempre ligado, PPE em fábrica, contagem de fluxo em loja). É o coração do `Pipeline 2`.

**Decisão crítica de margem**: $0,10/min × 60 × 24 × 30 = **$4.320/cam/mês PAYG** — irrealista. **Sempre escolher mensal $10/stream/mês** = R$ 54/cam/mês. SKU IA Cloud `ai-ppe` R$ 89 → margem **R$ 35 (39% bruta)**. OK.

### 2.4 Vertex AI Generative — Gemini multimodal (motor de busca semântica + descrição de cena)

> Vertex AI está sendo migrada para "Gemini Enterprise Agent Platform" (rebranding). REST endpoints continuam (`{location}-aiplatform.googleapis.com`). Não há quebra de API.

| Modelo | Input (text/image/video) | Input (audio) | Output | Batch (50% off) |
|---|---|---|---|---|
| Gemini 2.5 Flash | $0,30/1M tok | $1,00/1M | $2,50/1M | $0,15/$0,50/$1,25 |
| **Gemini 3.1 Flash-Lite** ⭐ | **$0,25/1M tok** | $0,50/1M | $1,50/1M | $0,125/$0,25/$0,75 |
| Gemini 3 Flash Preview | $0,50/1M | $1,00/1M | $3,00/1M | $0,25/$0,50/$1,50 |
| Gemini 2.5 Pro (≤200K) | $1,25/1M | $1,25/1M | $10/1M | $0,625/-/$5 |
| Gemini 3.1 Pro Preview (≤200K) | $2,00/1M | $2,00/1M | $12/1M | $1/-/$6 |

**Equivalência multimodal:**
- 1 imagem 1024×1024 ≈ **1.290 tokens**
- 1 segundo de vídeo (1 fps) ≈ **258 tokens**
- 1 segundo de áudio sem timestamp ≈ 25 tokens

**Multimodal embedding** (`multimodalembedding@001`, usado em `vertex-face.service.ts`):
- Cobrado como prediction Vertex AI — **confirmar tabela** (em torno de $0,0001/predição em 2025; pode ter mudado).
- 1408 dims já implementado — não trocar sem migrar `pgvector` index.

**Decisão de motor padrão para SKUs:** **Gemini 3.1 Flash-Lite** (melhor ratio preço/qualidade para CCTV em 2026-05). Pro só sob demanda em SKU enterprise.

### 2.5 Resumo: o que cada SKU do `docs/18` consome

| SKU | Mapeamento Google | Modo | Custo Google estimado | SKU B2B IA Cloud | Margem bruta IA Cloud | Margem CF (markup 30%) |
|---|---|---|---|---|---|---|
| `ai-motion` | edge (não Google) | edge | ~R$ 0 | R$ 9,90 | ~100% | R$ 12,87 |
| `ai-presence` | Vertex Vision Person/Vehicle mensal | $10/cam/mês | R$ 54 | R$ 38,00 | **NEGATIVO** ⚠️ | R$ 49,40 |
| `ai-absence` | edge motion-zero | edge | ~R$ 0 | R$ 79 | ~100% | R$ 102,70 |
| `ai-suspect` | Gemini 3.1 Flash-Lite (descrição de keyframe) | snapshot 1/min × 4h ativas/dia | $1,15/cam/mês ≈ R$ 6,21 | R$ 59 | R$ 53 (90%) | R$ 76,70 |
| `ai-lpr` | Cloud Vision OCR snapshot motion-triggered | ~200 snapshots/cam/dia × $0,0015 | $9/cam/mês ≈ R$ 48,60 | R$ 79 | R$ 30 (38%) | R$ 102,70 |
| `ai-ppe` | Vertex Vision PPE mensal | $10/cam/mês | R$ 54 | R$ 89 | R$ 35 (39%) | R$ 115,70 |
| `ai-people-counting` | Vertex Vision Occupancy Suite | $20/cam/mês | R$ 108 | R$ 199 | R$ 91 (46%) | R$ 258,70 |
| `ai-face-recognition` | Vision FACE_DETECTION + Vertex multimodal embedding | snapshot motion + 1 embed/face | $4–7/cam/mês ≈ R$ 32 | R$ 129 | R$ 97 (75%) | R$ 167,70 |
| `ai-audio` | Speech Transcription só em alerta, não 24/7 | $0,048/min × 30min/dia × 30 = R$ 234 ⚠️ | edge VAD + Speech só em pico | (recomeça abaixo) | (recomeça abaixo) | (recomeça abaixo) |
| `ai-semantic-search` | Gemini 3.1 Flash-Lite indexação keyframe | 1 frame/min movimento × 8h × 30d | R$ 24 | R$ 49 | R$ 25 (51%) | R$ 63,70 |
| `ai-timelapse` | derived motion sampling | edge | ~R$ 0 | R$ 79 | ~100% | R$ 102,70 |

**Achados importantes:**

1. **`ai-presence` está com preço B2B abaixo do custo Google** se rodar com Vertex Vision mensal (R$ 38 < R$ 54). 3 saídas:
   - **(a)** Subir B2B para R$ 79 mínimo (alinha com `ai-lpr` e `ai-ppe`).
   - **(b)** Trocar implementação para edge (`go2rtc` + modelo local YOLO) e remover dependência Google neste SKU.
   - **(c)** Revender só junto com bundle (kit varejo), nunca avulso.
   - **Recomendação Tarcísio**: combinar (a) + (b) — edge default, Vertex como upsell premium.
2. **`ai-audio`** com Speech Transcription contínua quebra a margem. Implementação correta: **VAD edge** (Voice Activity Detection local) + Speech só em janelas de 30s gatilhadas. Custo cai para ~R$ 5/cam/mês.
3. **`ai-lpr` com OCR vídeo é pior** que com snapshot — usar o pipeline que já existe (motion-trigger + Cloud Vision) e **não** ligar Video Intelligence Text Detection ($0,15/min).
4. **`ai-face-recognition`** roda bem porque embedding só dispara em frame com face detectada (não 24/7). A margem 75% sobrevive a 10× volume.
5. **`ai-semantic-search`** funciona com Flash-Lite + sampling 1 fr/min movimento. Na primeira tentativa de indexar 1 fps contínuo, vira **prejuízo de R$ 40+/cam/mês**.

---

## 3. Modelo de SKU enriquecido — `Product.providerCostModel`

O `docs/18` define `Product` com `priceMonthly` (B2B IA Cloud) e markup integrador. Faltam 4 campos para o billing B2B2B funcionar com a Google:

```prisma
model Product {
  // ... campos do docs/18 ...

  /// JSON estruturado descrevendo CUSTO no fornecedor upstream (Google) por
  /// unidade de consumo. Permite reconciliar fatura GCP → SKU vendido.
  providerCostModel    Json?      // ver shape abaixo

  /// USD por unidade no momento da venda (snapshot). Recalculado mensalmente
  /// pelo recon job. Decimal pra evitar float drift.
  providerUnitCostUsd  Decimal?   @db.Decimal(10, 6)

  /// Modo de cobrança: FLAT (mensal fixo), METERED (paga por uso), HYBRID
  /// (flat + overage). Default FLAT.
  billingMode          BillingMode  @default(FLAT)

  /// Quota incluída no flat (só relevante se billingMode != FLAT).
  /// Ex.: { unit: "minute", included: 43200, overagePriceUsd: 0.0001 }
  quotaIncluded        Json?
}

enum BillingMode {
  FLAT      // R$ X/cam/mês ilimitado dentro de quota técnica
  METERED   // R$ X por unidade (img/min/token); fatura no fim do mês
  HYBRID    // FLAT até quota; OVERAGE PAYG depois
}
```

**Shape de `providerCostModel`:**

```jsonc
{
  "provider": "google_cloud",
  "service": "vertex_ai_vision",        // ou "cloud_vision" / "video_intelligence" / "vertex_generative"
  "feature": "PPE_DETECTION",
  "billingUnit": "stream-month",         // minute | image | gb | token-input | token-output | stream-month
  "unitCostUsd": 10.00,                  // por unidade
  "freeMonthly": 0,                      // unidades grátis Google (free tier antes de cobrar)
  "minimumCommit": null,                 // se for SKU mensal flat, valor mínimo
  "linkedFeatures": ["BIGQUERY_SINK"],   // dependências cobradas separadas
  "notes": "Subscription monthly is 4× cheaper than PAYG. Always pick monthly for PPE."
}
```

**Campos seed ilustrativos** (para os 11 SKUs IA do `docs/18`) — completar em PR.

---

## 4. Pipeline de medição (Meter)

### 4.1 Diagrama

```
[câmera ingere stream] ────► Vertex AI Vision App
                              │
                              ├─► Built-in processor (PPE/Occupancy/...)
                              │      │
                              │      ▼
                              │   BigQuery sink (eventos por câmera)
                              │
                              └─► Pub/Sub topic   (signal real-time)
                                    │
                                    ▼
                              [meter-worker]   ◄──── Cloud Vision events
                              [meter-worker]   ◄──── Gemini events
                                    │
                                    ▼
                              UsageMeter (Postgres)
                                    │
                                    ├─► Quota guard (real-time block se estourou)
                                    ├─► Daily aggregator (cron 0 1 * * *)
                                    └─► Monthly billing closer (cron 0 2 1 * *)
                                              │
                                              ├─► Google billing reconciler
                                              │      (compara Postgres × GCP Billing API)
                                              ├─► Integrador invoice (Asaas)
                                              └─► CF invoice (Asaas)
```

### 4.2 Schema novo

```prisma
model UsageMeter {
  id              String   @id @default(uuid())
  /// Granularidade fina — 1 row por evento ou agregado horário
  bucket          DateTime  // truncado em hour para agregar
  cameraId        String
  integradorId    String
  clienteFinalId  String?
  productSku      String   // ex.: "ai-lpr"
  provider        String   // "google_cloud"
  service         String   // "cloud_vision" / "vertex_ai_vision" / "vertex_generative" / "video_intelligence"
  feature         String   // "OCR" / "PPE_DETECTION" / "GEMINI_3_1_FLASH_LITE_INPUT"
  billingUnit     String   // "image" / "minute" / "token-input"
  units           Decimal  @db.Decimal(20, 6)
  costUsd         Decimal  @db.Decimal(20, 6)
  /// Origem do evento — usado para reconciliar com fatura Google
  rawEventId      String?
  /// Status no faturamento downstream
  invoicedToIntegrador  Boolean @default(false)
  invoicedToClienteFinal Boolean @default(false)

  @@index([integradorId, bucket])
  @@index([cameraId, productSku, bucket])
  @@index([invoicedToIntegrador])
}

model BillingReconciliation {
  id                   String   @id @default(uuid())
  month                DateTime  // primeiro dia do mês
  provider             String   // "google_cloud"
  /// Total do GCP Billing API (Cloud Billing Export → BQ)
  providerInvoiceUsd   Decimal  @db.Decimal(14, 4)
  /// Soma das UsageMeter do mês
  meteredUsd           Decimal  @db.Decimal(14, 4)
  /// Diferença em %; alarme acima de 5%
  driftPercent         Decimal  @db.Decimal(6, 3)
  /// Detalhamento JSON por service/feature
  breakdown            Json
  status               String   // "OK" / "DRIFT_WARN" / "DRIFT_ERROR"
  reconciledAt         DateTime @default(now())

  @@unique([month, provider])
}

model OrderProvision {
  /// Quando uma Order vira "ACTIVATED" para um SKU que requer Google,
  /// criamos um registro deste para rastrear o recurso provisionado.
  id              String   @id @default(uuid())
  orderItemId     String   // referência ao Order do docs/18
  cameraId        String
  productSku      String
  provider        String   // "google_cloud"
  /// Resource path do GCP (ex.: projects/x/locations/y/streams/z)
  providerResourceId  String
  /// Se for Vertex Vision Application, guarda appId
  providerSubResourceId String?
  status          String   // "PROVISIONED" / "DEPLOYED" / "TEARDOWN_PENDING" / "TEARDOWN_DONE"
  provisionedAt   DateTime @default(now())
  deployedAt      DateTime?
  teardownAt      DateTime?

  @@index([cameraId, status])
}
```

### 4.3 Workers/jobs

| Worker | Trigger | Função |
|---|---|---|
| `meter-vertex-vision-worker` | BigQuery streaming insert listener (Pub/Sub) | Lê eventos VAI Vision → cria/agrega UsageMeter |
| `meter-cloud-vision-worker` | Inline na chamada `visionService.annotate()` | Antes de retornar, registra UsageMeter |
| `meter-gemini-worker` | Inline na chamada Gemini | Mesma coisa |
| `meter-video-intel-worker` | Job pós annotate | Idem |
| `quota-guard-middleware` | Antes de cada chamada Google | Lê `Subscription.quotaIncluded` e bloqueia se estourou |
| `daily-aggregator` | Cron `0 1 * * *` | Agrega UsageMeter horário em diário (compactação) |
| `monthly-recon` | Cron `0 2 1 * *` | Compara `UsageMeter.sum` vs `gcp_billing_export.invoice` no BQ → grava `BillingReconciliation`. Alarma se drift > 5%. |
| `monthly-invoice-integrador` | Cron `0 4 1 * *` | Para cada integrador: soma UsageMeter do mês × tabela B2B IA Cloud → fatura Asaas |
| `monthly-invoice-cf` | Cron `0 6 1 * *` | Para cada CF: soma × tabela markup integrador → fatura Asaas (cobrança no integrador, repassada) |

### 4.4 Cobrança Google: reconciliação auditável

A Google envia fatura única em USD para a IA Cloud. Para auditar:

1. **Habilitar Cloud Billing Export para BigQuery** (linkado em projeto GCP).
2. Job lê tabela `gcp_billing_export_v1_*` filtrando por `invoice.month`.
3. Soma `cost` agrupado por `service.description` + `sku.description`.
4. Compara com `SUM(UsageMeter.costUsd)` da IA Cloud no mesmo mês.
5. **Drift aceitável: ≤ 3%** (taxas, impostos, conversão de moeda intra-Google).
6. **Drift > 5%**: alarme Sentry + bloqueio de fechamento de fatura integrador até investigação.
7. **Drift > 10%**: notificação Telegram (ver `docs/04-PLAN-OPENCLAW-OPS.md`).

---

## 5. Cadeia de faturamento — 4 momentos do dinheiro

```
T0 [CF abre marketplace, vê SKU "LPR — R$ 102,70/cam/mês — preço do Integrador X"]
T1 [CF aprova carrinho com 12 câmeras LPR]
   → cria Order(status=PENDING_INTEGRATOR)
T2 [Integrador aprova Order]
   → Order.status = ACTIVATED
   → meter-worker dispara provisionCamera() para cada câmera
   → IF requer Vertex AI Vision: cria Stream + Application + Deploy
   → grava OrderProvision para teardown futuro
T3 [Mês inteiro: câmeras processam vídeo]
   → cada minuto/imagem/token gera linha UsageMeter
   → quota-guard verifica antes de cada chamada
T4 [Dia 1 do mês seguinte, 02:00 UTC]
   → BillingReconciliation roda
   → drift OK → gera invoice IA Cloud → Integrador (em BRL)
T5 [Dia 1, 06:00 UTC]
   → Para cada CF do integrador: gera invoice (em BRL)
   → cobrada no integrador (intermediação) OU no CF direto (se integrador optou)
T6 [Dia 5–10: Google fatura IA Cloud em USD]
   → IA Cloud paga (cartão internacional ou nota de débito)
   → recon final: GCP invoice $X = soma UsageMeter ± 3%
```

### 5.1 Quem fatura quem (matriz)

| De → Para | Moeda | Frequência | Quem emite | Quando | Cobra | Doc fiscal |
|---|---|---|---|---|---|---|
| **Google → IA Cloud** | USD | mensal | Google Cloud | dia 1–5 mês seguinte | cartão internacional / nota de débito | invoice GCP (sem NF brasileira) |
| **IA Cloud → Integrador** | BRL | mensal | IA Cloud (Asaas) | dia 1 mês seguinte | boleto/Pix/cartão | NF de serviço (item: "Plataforma SaaS — uso medido") |
| **Integrador → CF** | BRL | mensal | Integrador (Asaas próprio ou white-label) | dia 1 mês seguinte (configurável) | boleto/Pix/cartão | NF do integrador (CNPJ próprio) |
| **(opcional) Integrador → CF via IA Cloud** | BRL | mensal | IA Cloud em nome do Integrador | dia 1 | boleto/Pix com taxa intermediação | NF emitida pelo Integrador (split via API) |

### 5.2 Margem em camadas — exemplo `ai-lpr` 12 câmeras

| Camada | Receita | Custo upstream | Margem absoluta | Margem % |
|---|---|---|---|---|
| **CF** paga ao Integrador | R$ 102,70 × 12 = R$ 1.232,40 | R$ 79,00 × 12 = R$ 948,00 (compra IA Cloud) | R$ 284,40 | 23% sobre receita / 30% sobre custo |
| **Integrador** paga IA Cloud | R$ 948,00 | R$ 583,20 (estimativa, $9/cam × 12 × 5,4) | R$ 364,80 | 38% sobre receita |
| **IA Cloud** paga Google | R$ 583,20 | R$ 583,20 | R$ 0 (passthrough) | 0% (custo) |
| **TOTAL na cadeia** | R$ 1.232,40 | R$ 583,20 | R$ 649,20 | **53% margem total cadeia** |

**Regras de operação:**
1. Cada camada conhece **só** o preço da camada acima (transparência limitada — integrador não vê o custo Google direto).
2. Wholesale floor (`docs/16` §4.3) garante: integrador NÃO pode revender CF abaixo do preço B2B IA Cloud × 1,1 (10% mínimo). Default 30% (configurável por SKU).
3. Override Enterprise-tier libera markup negativo para promo (ex.: revender LPR a custo zero como gancho de venda). Audita em log.

### 5.3 PAYG vs Quota Pré-paga (mesmo SKU, dois planos)

Cada SKU `ai-*` admite 2 sub-planos comerciais:

**Plano Flat** (default, billingMode=FLAT):
- Preço fixo por câmera/mês.
- Quota técnica embutida (ex.: LPR — 500 placas/dia/câmera).
- Estourou quota → throttle (não cobra extra).

**Plano Metered** (billingMode=METERED, opt-in):
- R$ Y por unidade (placa lida / pessoa contada / busca semântica executada).
- Sem floor mensal.
- Cobra ao fim do mês.

**Plano Híbrido** (billingMode=HYBRID, enterprise):
- Flat até quota X.
- Overage PAYG depois.
- Reconciliação detalhada em `Subscription.usageBreakdown`.

**Default Onda 1**: só FLAT. Metered/Hybrid esperam fechamento de marketplace e podem virar Onda 3.

---

## 6. Provisionamento dinâmico — Order → Google

### 6.1 Fluxo de ativação

```ts
// pseudocode — pertence a services/order-provisioner.service.ts (NOVO)

async function activateOrderItem(orderItem: OrderItem) {
  const product = await getProduct(orderItem.productSku)
  const cm = product.providerCostModel as CostModel | null

  if (!cm || cm.provider !== 'google_cloud') return  // SKU edge — nada a provisionar

  switch (cm.service) {
    case 'vertex_ai_vision':
      // PPE / Occupancy / People-Vehicle Count
      const result = await vertexService.provisionCamera(
        orderItem.cameraId,
        orderItem.integradorId,
        [cm.feature as 'PPE_DETECTION' | 'OCCUPANCY_ANALYTICS'],
      )
      await prisma.orderProvision.create({
        data: {
          orderItemId: orderItem.id,
          cameraId: orderItem.cameraId,
          productSku: orderItem.productSku,
          provider: 'google_cloud',
          providerResourceId: result.streamId,
          providerSubResourceId: result.appId,
          status: 'DEPLOYED',
          deployedAt: new Date(),
        },
      })
      break

    case 'cloud_vision':
      // LPR / face detection — não provisiona; só registra que está autorizado
      await prisma.cameraFeatureFlag.upsert({
        where: { cameraId_feature: { cameraId, feature: cm.feature } },
        create: { cameraId, feature: cm.feature, enabled: true },
        update: { enabled: true },
      })
      break

    case 'vertex_generative':
      // semantic-search / suspect description — só feature flag
      // worker de indexação consulta flag antes de chamar Gemini
      break
  }
}
```

### 6.2 Teardown ao cancelar

```ts
async function teardownOrderItem(orderItem: OrderItem) {
  const provision = await prisma.orderProvision.findFirst({
    where: { orderItemId: orderItem.id, status: 'DEPLOYED' },
  })
  if (!provision) return

  if (provision.providerSubResourceId) {
    await vertexService.undeployApplication(provision.providerSubResourceId)
  }
  // Stream pode ficar deployed se outras Apps consomem; tracking refcount.
  await prisma.orderProvision.update({
    where: { id: provision.id },
    data: { status: 'TEARDOWN_DONE', teardownAt: new Date() },
  })
}
```

### 6.3 Quota guard pré-chamada

```ts
// middleware antes de qualquer chamada GCP
async function quotaGuard(integradorId: string, productSku: string, units: number) {
  const sub = await prisma.subscription.findFirst({
    where: { integradorId, productSku, status: 'ACTIVE' },
  })
  if (!sub) throw forbidden('subscription_inactive')

  const used = await prisma.usageMeter.aggregate({
    where: { integradorId, productSku, bucket: { gte: startOfMonth() } },
    _sum: { units: true },
  })
  const usedTotal = Number(used._sum.units ?? 0)
  const quota = sub.quotaIncluded ?? Infinity

  if (sub.billingMode === 'FLAT' && usedTotal + units > quota) {
    throw paymentRequired('quota_exceeded', { used: usedTotal, quota })
  }
  if (sub.billingMode === 'METERED' || sub.billingMode === 'HYBRID') {
    // Sem bloqueio; só registra (overage cobra no fim do mês)
  }
}
```

---

## 7. UX marketplace — extensões mínimas ao `docs/18`

O `docs/18` já desenhou a vitrine. Este plano adiciona:

### 7.1 Card do SKU — novos badges

```
┌─────────────────────────────┐
│ 🚗 LPR / ALPR  [Powered by Google]  │
│                                     │
│ /câmera/mês                         │
│  R$ 79,00                           │
│                                     │
│ ⚙ Quota: 500 placas/dia/câm        │
│ 🌎 Processado em US (Iowa)          │  ← LGPD
│ 🔒 Sem armazenamento Google         │
│                                     │
│ [+ Adicionar ao carrinho]           │
└─────────────────────────────┘
```

Badges novos: `[Powered by X]`, `[Processado em <região>]`, `[Sem armazenamento]` ou `[Armazenado <região>]`.

### 7.2 Drawer de detalhe — bloco "Como cobramos"

```
Como cobramos:
┌──────────────────────────────────────────┐
│ Modelo: FLAT — R$ 79,00/câmera/mês       │
│ Quota inclusa: 500 leituras/dia/câmera   │
│ Estourou: throttling (não cobra extra)   │
│                                           │
│ Quer plano metered?                       │
│ [Solicitar cotação enterprise]            │
└──────────────────────────────────────────┘
```

### 7.3 Página `/portal/marketplace/usage` — granularidade nova

Já planejada no `docs/18 §3.2`. Este plano define o **conteúdo**:

- Tabela por câmera × SKU × dia.
- Gráfico de consumo (linha) e estimativa de gasto restante.
- Alerta visual quando uso > 80% da quota mensal técnica.
- Link para "Histórico forense" → tabela UsageMeter da câmera (auditoria CF).

---

## 8. LGPD + compliance específica de IA

### 8.1 Bases legais (LGPD art. 7)

| SKU | Base legal default | Justificativa |
|---|---|---|
| `ai-motion`, `ai-presence`, `ai-absence`, `ai-suspect`, `ai-people-counting` | Legítimo interesse (II) ou Cumprimento obrigação (II) | Segurança patrimonial; sem identificação biométrica |
| `ai-lpr` | Legítimo interesse | Placa é dado pessoal mas não sensível |
| `ai-ppe` | Cumprimento obrigação trabalhista | NR-6, NR-12 |
| `ai-face-recognition` | **Consentimento explícito + DPIA** | Dado biométrico (art. 11) |
| `ai-audio` (Speech) | Consentimento explícito | Conversação privada |
| `ai-semantic-search` | Mesma base do conteúdo indexado | Não cria nova categoria |

### 8.2 Controles obrigatórios

- **Banner consentimento facial**: na ativação de `ai-face-recognition` para um site, o sistema **exige** que o CF carregue um PDF assinado de DPIA + lista de funcionários cientificados. Sem isso, ativação fica em status `DEPLOYED_PENDING_LGPD` e o feature flag não é enabled.
- **Direito de exclusão**: endpoint `DELETE /portal/lgpd/face-identity/:identityId` apaga FaceIdentity + todos os FaceEmbedding + log de matches em até 15 dias (LGPD prazo). Cron diário aplica retentions.
- **Audit log de acesso**: cada match (`vertex-face.service.ts:topK()`) grava em `FaceMatchLog` com `who`, `when`, `cameraId`, `score`, `humanReviewed`. Acessível ao DPO via `/portal/lgpd/face-audit`.
- **Região de processamento**: configurar `VERTEX_LOCATION=southamerica-east1` (São Paulo) por padrão. Falback US se modelo não disponível em SP — declara explicitamente em ToS.
- **Não armazena no Google**: confirmar que `multimodalembedding@001` em modo **predict** (não training) não retém input. Já é o caso por contrato GCP, mas precisa documentar.

### 8.3 Decisão regional

Vertex AI Vision **não estava** disponível em `southamerica-east1` em 2026-04 (verificar 2026-05). Se ainda não, opções:
- **(a)** Rodar em `us-central1` e declarar TIA (Transferência Internacional Autorizada) na PoP via cláusulas-padrão.
- **(b)** Bloquear `ai-face-recognition` até GCP disponibilizar SP.
- **(c)** Usar modelo on-prem (DeepStack/Insightface no Box) só para face — não usa Google.
- **Recomendação**: (a) com cláusula clara, mas só se DPIA aceitar; senão (c).

---

## 9. Riscos / pontos sensíveis

1. **Drift de pricing Google**: Google muda preço sem aviso (Celebrity Recognition deprecada 2025-09). **Mitigação**: cron mensal `gcp-pricing-snapshotter` puxa SKU API e cria diff Slack/Telegram. Bloqueia ativação de novos contratos se SKU mudou >10%.
2. **Cota quotidiana Google** (rate limits): 4.000 req/min Cloud Vision por projeto. Com 1k câmeras × 200 snapshots/dia = 200k/dia ~= 140/min. OK até 28k câmeras simultâneas. Acima disso, **multi-projeto GCP por região**.
3. **Reconciliação USD↔BRL**: variação cambial entre T3 (consumo) e T6 (fatura Google) pode comer margem. **Mitigação**: cobrar em `INVOICE_DATE_RATE + 5%` buffer de câmbio, ou ofertar plano fixo em USD para integradores grandes.
4. **Inadimplência integrador**: IA Cloud já paga Google em T6 mesmo se integrador atrasar T4. **Mitigação**: D+30 negativa via SCPC (já no `docs/16` ou roadmap), e suspende novos provisionamentos automaticamente após 2 faturas vencidas.
5. **Quota Vertex AI Vision** (nº de Streams ativos por projeto): default 1k streams. Acima disso, request de aumento. Planejar com 30 dias de antecedência.
6. **Lock-in Google**: se Google triplicar preço, IA Cloud quebra. **Mitigação**: arquitetura permite trocar provider (`Product.providerCostModel.provider`). Plano B: Roboflow + AWS Rekognition mapeados em planilha (sem implementação).
7. **Mock fica em prod por engano**: `VERTEX_FACE_MODE=mock` em prod gera 0 cobrança Google e 0 utilidade — silencioso. **Mitigação**: assert em boot de prod, alarmar se mode=mock.

---

## 10. Fases de implementação

| Fase | Escopo | Estimativa | Dependências |
|---|---|---|---|
| **F1** | Schema: `Product.providerCostModel` + `Product.billingMode` + `Product.quotaIncluded` + migration. Seed dos 11 SKUs `ai-*` com cost models confirmados. | 4-6h | `docs/18` Sprint Foundation |
| **F2** | `UsageMeter` + `OrderProvision` schema. Inline meters em `vision.service.ts` + `vertex-face.service.ts` + futuro `gemini.service.ts`. | 6-8h | F1 |
| **F3** | `quota-guard-middleware` + bloqueio real em FLAT plans. | 3h | F2 |
| **F4** | `order-provisioner.service.ts` (activate + teardown). Hook em Order state machine do `docs/18`. | 4-5h | F2, `docs/18` Sprint 2 |
| **F5** | Cloud Billing Export → BQ + `monthly-recon` job + `BillingReconciliation` UI no `/admin/marketplace/recon`. | 6h | F2, GCP setup |
| **F6** | `monthly-invoice-integrador` + `monthly-invoice-cf` jobs gerando boletos Asaas reais. | 6-8h | F5, `docs/18` Sprint Billing |
| **F7** | Marketplace UX: badges "Powered by Google", bloco "Como cobramos", `/portal/marketplace/usage` com dados reais. | 3-4h | F2, F6, `docs/18` Sprint G |
| **F8** | LGPD: DPIA upload, FaceMatchLog, `/portal/lgpd/face-audit`. | 5-6h | F4 |
| **F9** | `gcp-pricing-snapshotter` + alarmes drift + dashboard SA `/admin/marketplace/google-cost`. | 3-4h | F5 |
| **F10** | Migrar SKUs negativos (`ai-presence` R$ 38) → edge-only OU subir preço B2B → atualizar `docs/18 §1.3`. | 1-2h decisão + 4-6h impl | decisão Tarcísio |

**Total**: ~45-58h. Rodar em paralelo com `docs/18` Sprints (não bloqueia, complementa). **Pré-requisito hard**: P0 do `PRE-HOMOLOGACAO-CHECKLIST.md` (credenciais GCP rotacionadas).

---

## 11. Defaults sugeridos (em ordem de implementação)

1. **Modelo Gemini padrão**: `gemini-3-1-flash-lite` (preview) com fallback `gemini-2-5-flash` se preview ficar instável. Configurável via env `GEMINI_DEFAULT_MODEL`.
2. **Vertex Vision modelo de cobrança**: sempre **mensal $10/stream** (nunca PAYG $0,10/min) — economia 4× para uso 24/7.
3. **Sampling de keyframe semantic search**: 1 frame/min apenas em janelas de movimento (edge VAD/motion). Cap absoluto 10k frames/cam/mês.
4. **Região GCP padrão**: `us-central1` (mais barato, mais features). Migrar para `southamerica-east1` quando Vertex Vision aterrissar lá.
5. **Buffer cambial**: 8% sobre câmbio do dia da venda (cobre variação D+30).
6. **Alarme drift recon**: 3% warn, 5% block, 10% page.
7. **Markup integrador floor**: 10% (acima do wholesale). Default sugerido 30%.
8. **Free tier Google**: alocar pro fabricante (consumido por demos/onboarding), não passar pro integrador. Reduz risco de gameabilidade.

---

## 12. Não está no escopo (por enquanto)

- **Multi-cloud** (AWS Rekognition / Azure Cognitive). Plano B documentado, sem código.
- **Custom model training** (AutoML/Visual Inspection). Onda 3+, só sob demanda enterprise.
- **Faturamento direto IA Cloud → CF** (bypass integrador). Onda 3 — exige resolver split fiscal.
- **Currency multi**: planos em USD para integradores grandes. Junto com `docs/16 §9 Pricing por moeda múltipla`.
- **Modelo vídeo on-device** (FaceNet/YOLO no Box) como alternativa a Vertex Vision. Documentar como tier "edge-only" no `docs/22` futuro.
- **Webhooks de evento Google→IACloud**: hoje uso Pub/Sub pull. Push direto via Eventarc → ingest endpoint pode reduzir latência.
- **Trial gratuito cobrado pela IA Cloud**: hoje free tier Google é 1k unidades. Se IA Cloud quiser dar 14d trial, custo sai do bolso. Calcular pool de free credits.

---

## 13. Decisões pendentes — antes de F1

> **NÃO começar F1 sem fechar estas 7 decisões.**

1. **Q1 — Modelo Gemini default**: `3.1 Flash-Lite` (Preview, mais barato, sujeito a mudança) ou `2.5 Flash` (GA, estável, 20% mais caro)?
2. **Q2 — `ai-presence` reposicionamento**: subir preço B2B (R$ 38 → R$ 79), virar edge-only, ou só revender em bundle? (Hoje está negativo).
3. **Q3 — Região processamento facial**: `us-central1` com TIA, esperar `southamerica-east1`, ou face on-prem (Box)?
4. **Q4 — Modelo de cobrança CF**: integrador fatura CF direto (CNPJ próprio), ou IA Cloud fatura em nome do integrador via split? (Tem implicação fiscal grande.)
5. **Q5 — Buffer cambial**: 5%, 8%, 10%, ou repassar variação real (auditoria mensal)?
6. **Q6 — PAYG/Metered MVP**: lançar só FLAT (mais simples) ou já oferecer Metered no MVP (mais complexo, melhor para enterprise)?
7. **Q7 — Free tier Google quem aproveita**: pool fabricante, distribuído por integrador (proporcional), ou repassar 1:1 ao primeiro CF que ligar?

Quando essas estiverem fechadas, converter este doc em `docs/21-EXEC-...` com sprints datados e iniciar F1.

---

## 14. Atualizações em outros docs (depois de fechar Q1-Q7)

- `docs/18-PLAN-MARKETPLACE-3-NIVEIS-PREMIUM.md §1.3`: ajustar preço B2B do `ai-presence` (Q2) e adicionar coluna `providerCostModel`.
- `docs/16-PLAN-WHITELABEL-PRICING-MULTITENANT.md §3.2`: estender `wholesalePriceMonthly` para `Product` (não só `PlatformPlan`).
- `docs/09-PLAN-PLAYBACK-AVANCADO.md`: marcar busca semântica como **viabilizada via Gemini Flash-Lite** (não mais GPU local).
- `docs/PRE-HOMOLOGACAO-CHECKLIST.md`: adicionar P0 "configurar Cloud Billing Export para BQ + alarmes drift" e P1 "rotacionar service account GCP usado em prod".
- `docs/04-PLAN-OPENCLAW-OPS.md`: adicionar comando `/google-cost` que mostra fatura GCP atual + drift recon.

---

## 15. Apêndice — Cheat-sheet de pricing (USD, 2026-05-09)

```
Cloud Vision (imagem):
  Label/Text/Face/Logo/ImageProps   $1.50/1k (até 5M) | $0.60/1k (>5M)
  Object Localization                $2.25/1k (até 5M) | $1.50/1k (>5M)
  Web Detection                      $3.50/1k
  SafeSearch + Crop Hints            grátis com Label/ImageProps
  Free tier                          1k/mês cada

Video Intelligence (minuto, após 1k min/mês):
  Stored Label/Person/Face/Explicit  $0.10/min
  Stored Object/Text/Logo            $0.15/min
  Stored Speech (en-US)              $0.048/min
  Streaming Label                    $0.12/min
  Streaming Object                   $0.17/min
  Streaming Image                    $0.07/min

Vertex AI Vision (managed streaming):
  Stream ingress/egress              $0.0085/GB cada
  Built-in (PPE/Object/Face Blur)    $0.10/min OU $10/stream/mês ⭐
  AutoML                             $0.20/min OU $20/stream/mês
  Occupancy Suite                    $20/stream/mês
  Visual Inspection                  $100/cam/mês
  DW storage                         $0.020/GB-mês
  DW index                           $3/node-h

Vertex Generative (Gemini):
  3.1 Flash-Lite ⭐                  in $0.25/1M | out $1.50/1M
  2.5 Flash                          in $0.30/1M | out $2.50/1M
  3 Flash Preview                    in $0.50/1M | out $3.00/1M
  2.5 Pro (≤200K)                    in $1.25/1M | out $10/1M
  3.1 Pro Preview (≤200K)            in $2.00/1M | out $12/1M
  Batch (50% off)                    aplica em todos
  Equivalência:
    1 imagem 1024×1024  ≈ 1.290 tokens
    1 segundo vídeo 1fps ≈ 258 tokens
    1 segundo áudio     ≈ 25 tokens

Multimodal Embedding (multimodalembedding@001):
  1408 dims · ~$0.0001/predição (CONFIRMAR no console GCP)
  já usado em vertex-face.service.ts

Câmbio assumido: R$ 5,40/USD (atualizar mensal)
```
