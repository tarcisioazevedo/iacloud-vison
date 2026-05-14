# Caption Worker — Operacional

**Status:** PR2 entregue · 2026-05-14
**Service:** [`vsaas-backend/src/services/semantic-search/caption-worker.service.ts`](../../vsaas-backend/src/services/semantic-search/caption-worker.service.ts)
**Bootstrap:** [`caption-worker.bootstrap.ts`](../../vsaas-backend/src/services/semantic-search/caption-worker.bootstrap.ts)
**Tests:** [`__tests__/caption-worker.test.ts`](../../vsaas-backend/src/services/semantic-search/__tests__/caption-worker.test.ts) (13 testes)

Preenche `captionText` + `captionEmbedding` em `DetectionFrames` que o `vsaas-ai-worker` criou mas ainda não foram processados pelo pipeline semântico.

## Pipeline por frame

```
DetectionFrame (criado pelo ai-worker)
       │
       │  captionedAt IS NULL ∧ thumbnailKey IS NOT NULL
       ▼
[ 1. Download thumbnail JPEG do R2 ]   ── via r2Storage.getBuffer(integradorId, key)
       │
       ▼
[ 2. Gemini Flash → caption (PT-BR, ~25 palavras) ]   ── genai.captionFrame(jpeg)
       │
       ▼
[ 3. Gemini Embedding 001 → vector(768) L2-normalized ]   ── via GeminiEmbeddingService
       │
       ▼
[ 4. PgVectorStore.upsert → captionText + captionEmbedding + embeddingModel ]
       │
       ▼
   DetectionFrame.captionedAt = NOW()
```

## Ativação (opt-in)

```bash
# docker-stack.yml ou .env do backend
SEMANTIC_CAPTION_ENABLED=true              # default: false
SEMANTIC_CAPTION_BATCH_SIZE=10             # frames por rodada
SEMANTIC_CAPTION_POLL_MS=30000             # intervalo entre rodadas (30s)
SEMANTIC_CAPTION_CONCURRENCY=3             # threads paralelas dentro do batch
SEMANTIC_CAPTION_MODEL=gemini-embedding-001 # gravado em DetectionFrame.embeddingModel
```

**Pré-requisitos** (verifica e abort silencioso se faltar):
- `GEMINI_API_KEY` ou `/run/secrets/gemini_api_key`
- pgvector instalado (migration `20260514_pgvector_semantic_search` aplicada)
- Tabela `DetectionFrame` com colunas novas (PR1)

## Resiliência — política de erros

| Cenário | Ação | Retentado? |
|---|---|---|
| `thumbnailKey IS NULL` | `captionError = 'thumbnail_key_missing'`, `captionedAt = NOW()` | ❌ permanente |
| R2 retorna 404 (thumbnail deletado) | `captionError = 'thumbnail_missing_in_r2'`, `captionedAt = NOW()` | ❌ permanente |
| Gemini caption retorna `null` (filtro) | `captionError = 'caption_unavailable'`, `captionedAt` NULL | ✅ na próxima rodada |
| Gemini caption throw (429/500) | `captionError = 'caption_error: ...'`, `captionedAt` NULL | ✅ |
| Embedding throw | `captionError = 'embed_error: ...'`, `captionedAt` NULL | ✅ |
| pgvector upsert throw | `captionError = 'persist_error: ...'`, `captionedAt` NULL | ✅ |
| Falha de UM frame | Outros frames do mesmo batch continuam | ✅ batch resilient |
| Tick em andamento quando timer dispara | Tick novo é skipped | ✅ no overlap |

**Backoff implícito:** worker dorme `pollIntervalMs` entre rodadas. Erros transientes não geram backoff exponencial por frame — apenas reentram na fila e são retentados na próxima rodada (~30s depois por default).

## Custo estimado (Gemini, maio 2026)

| Volume | Caption (Flash) | Embedding (001) | Total |
|---|---|---|---|
| 1k frames/dia | $0.50 | $0.001 | **~$15/mês** |
| 10k frames/dia | $5.00 | $0.01 | **~$150/mês** |
| 100k frames/dia | $50 | $0.10 | **~$1.5k/mês** |

Preço Caption inclui ~258 tokens visão + ~50 tokens prompt + ~80 tokens output a $0.30/1M in + $2.50/1M out.

**Cache LRU embutido** no `GeminiEmbeddingService` corta custo de embedding para 0 quando o mesmo texto vem 2× (caption text raramente repete, mas helps em queries de busca).

## Observabilidade

### Logs estruturados (Pino)

```
{ "msg": "caption_worker_started",
  "batchSize": 10, "pollMs": 30000 }

{ "msg": "caption_worker_batch_done",
  "processed": 8, "failed": 2, "totalProcessed": 1247, "durationMs": 5320 }

{ "msg": "caption_worker_frame_failed",
  "frameId": "abc-123", "err": "Server error" }
```

### Métricas in-memory (acessível via stats())

```typescript
import { getCaptionWorker } from '../services/semantic-search'
const stats = getCaptionWorker().stats()
// {
//   running: true,
//   busy: false,
//   totalProcessed: 1247,
//   totalFailed: 23,
//   totalSkipped: 0,
//   lastRunAt: 2026-05-14T10:30:00Z,
//   lastError: null,
// }
```

Endpoint `/search/health` (PR3) expõe esses números para monitoramento.

## Multi-tenant

Sem scoping explícito no worker — `DetectionFrame` já tem `integradorId` denormalizado (trigger PR1) e o R2 download usa `r2Storage.getBuffer(integradorId, key)` que escopa por bucket. Worker é **shared infrastructure**, custo Gemini é global (não por tenant).

Para cost accounting por tenant: adicionar log com `integradorId` em cada operação bem-sucedida. PR2.1 (opcional) pode criar `ApiUsageLog` por frame processado, mas adia até cliente real pedir granularidade.

## Operações comuns

### Iniciar manualmente (sem reboot)

```bash
# docker exec do container backend
docker exec -it vsaas_backend_xxx node -e "
const { getCaptionWorker } = require('./dist/services/semantic-search');
getCaptionWorker().start();
"
```

### Processar um batch on-demand (debug)

```typescript
import { getCaptionWorker } from '../services/semantic-search'
const result = await getCaptionWorker().processBatch()
console.log(result) // { processed, failed, durationMs }
```

### Forçar retry de frames com erro

```sql
-- Limpa erros transientes (mantém permanentes — captionedAt IS NOT NULL)
UPDATE "DetectionFrame"
SET "captionError" = NULL
WHERE "captionedAt" IS NULL
  AND "captionError" IS NOT NULL;
```

### Backfill histórico (todo o catálogo)

Não automatizado neste PR — vai pro PR6 (`POST /search/reprocess` com aprovação de custo). Por enquanto, manual via SQL:

```sql
-- Adiciona thumbnailKey faltante (se ai-worker já gerou no R2):
UPDATE "DetectionFrame"
SET "thumbnailKey" = 'ai-thumbs/' || "cameraId" || '/' || id || '.jpg'
WHERE "thumbnailKey" IS NULL;

-- Limpa captionedAt para reprocessar:
UPDATE "DetectionFrame" SET "captionedAt" = NULL, "captionError" = NULL;
```

Cuidado: 10k frames = $150 Gemini. Faça por janela.

## Testes (TDD)

13 testes cobrem:
- Happy path (download + caption + embed + upsert)
- Sem frames pendentes (no-op)
- Thumbnail sumiu (erro permanente)
- Caption null (erro transiente)
- Embed throw (erro transiente)
- Falha de UM frame não afeta batch
- Respeita batchSize
- Filtro WHERE correto
- Métricas acumulam entre batches
- Upsert recebe payload completo
- Frames com erro anterior são retentados
- start/stop lifecycle
- start 2× é no-op

Rodar:
```bash
cd vsaas-backend
npx vitest run src/services/semantic-search/__tests__/caption-worker.test.ts
```

## Próximos PRs relacionados

| PR | Conteúdo |
|---|---|
| **PR3** | Endpoints `/search/semantic`, `/search/similar/:id`, `/search/health` (consome este worker indiretamente) |
| **PR5** | Reindex incremental por integrador — UI dispara batch+SSE progress |
| **PR6** | Backfill histórico cobrado — POST `/search/reprocess` com aprovação |

## Critérios de aceitação PR2

- [x] `captionFrame()` adicionado ao `genai.service.ts` com prompt focado em retrieval
- [x] `CaptionWorker` implementado com pipeline 4-passos + resiliência
- [x] Bootstrap gated por `SEMANTIC_CAPTION_ENABLED` env
- [x] Integrado ao `app.ts` (import dinâmico)
- [x] 13 testes verdes (mock prisma + r2 + gemini)
- [x] Sem nova dependência (@google/generative-ai e @aws-sdk/client-s3 já existem)
- [x] Documentação operacional completa
- [ ] PR3 expõe via HTTP (próximo)
