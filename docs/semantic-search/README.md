# Semantic Search — Arquitetura

**Status:** PR1 (Foundation) entregue · 2026-05-14
**Stack:** pgvector + Gemini Embedding 001 + StorageAccessLog para audit
**Branch:** dev

Permite buscas como **"carro azul perto da garagem"** sobre os DetectionFrames já indexados pelo `vsaas-ai-worker`. Inspirado no [Frigate Semantic Search](https://docs.frigate.video/configuration/semantic_search/), mas:

- **Multi-tenant nativo** (Frigate é single-tenant)
- **pgvector + HNSW** (Frigate usa sqlite-vec, ANN limitado)
- **Gemini API** (Frigate usa Jina CLIP local)
- **Audit LGPD** em toda query (Frigate não tem)
- **`IVectorStore` abstrato** — swap pra Qdrant quando crescer

## Documentos relacionados

- [qdrant-vs-pgvector.md](qdrant-vs-pgvector.md) — decisão e plano de fuga
- [isolation-strategy.md](isolation-strategy.md) — 5 camadas de isolamento
- [audit-strategy.md](audit-strategy.md) — *a criar no PR2*
- [api-reference.md](api-reference.md) — *a criar no PR3 com os endpoints*

## Camadas (de baixo pra cima)

```
┌────────────────────────────────────────────────────────────────────┐
│  HTTP routes (PR3)                                                 │
│    POST /search/semantic · POST /search/similar · DELETE /search   │
│      ↑ middleware: requireAuth + requireRole                        │
│      ↑ applyTenantScope() construído do JWT                         │
└─────┬──────────────────────────────────────────────────────────────┘
      │
┌─────▼──────────────────────────────────────────────────────────────┐
│  Service layer (PR1 — este)                                         │
│    GeminiEmbeddingService → embed query                             │
│    PgVectorStore.search() → ANN + tenant filter                     │
│    SearchAuditService.recordQuery() → StorageAccessLog              │
└─────┬──────────────────────────────────────────────────────────────┘
      │
┌─────▼──────────────────────────────────────────────────────────────┐
│  Storage                                                            │
│    Postgres + pgvector(HNSW)                                        │
│      DetectionFrame.captionEmbedding vector(768)                    │
│      DetectionFrame.imageEmbedding   vector(768) [opt]              │
│    External: Gemini Embedding API (gemini-embedding-001)            │
└────────────────────────────────────────────────────────────────────┘
```

## O que está entregue no PR1

### Migration
- [`prisma/migrations/20260514_pgvector_semantic_search/migration.sql`](../../vsaas-backend/prisma/migrations/20260514_pgvector_semantic_search/migration.sql)
  - `CREATE EXTENSION vector`
  - Colunas em DetectionFrame: `captionEmbedding`, `imageEmbedding`, `captionText`, `thumbnailKey`, `embeddingModel`, `embeddingVersion`, `captionedAt`, `captionError`
  - Colunas denormalizadas: `integradorId`, `clienteFinalId`, `siteId` (com backfill + trigger automático)
  - Tabela `SearchStats` (z-score por integrador)
  - Indexes HNSW cosseno
  - Indexes B-tree compostos para pré-filtro (`integradorId, timestamp DESC`)
  - Partial index para worker pegar pendentes

### Services
- [`semantic-search/types.ts`](../../vsaas-backend/src/services/semantic-search/types.ts) — interfaces compartilhadas
- [`vector-store.interface.ts`](../../vsaas-backend/src/services/semantic-search/vector-store.interface.ts) — `IVectorStore`
- [`pgvector-store.ts`](../../vsaas-backend/src/services/semantic-search/pgvector-store.ts) — impl pgvector
- [`pgvector-store-helpers.ts`](../../vsaas-backend/src/services/semantic-search/pgvector-store-helpers.ts) — funções puras (testáveis sem DB)
- [`gemini-embedding.service.ts`](../../vsaas-backend/src/services/semantic-search/gemini-embedding.service.ts) — wrapper Gemini
- [`tenant-scope.ts`](../../vsaas-backend/src/services/semantic-search/tenant-scope.ts) — `applyTenantScope()`
- [`search-audit.service.ts`](../../vsaas-backend/src/services/semantic-search/search-audit.service.ts) — `SearchAuditService`

### Tests (TDD)
58 testes unitários cobrindo:
- [`pgvector-store.test.ts`](../../vsaas-backend/src/services/semantic-search/__tests__/pgvector-store.test.ts) — 16 testes (serialização, distância, merge z-score, SQL builder)
- [`gemini-embedding.test.ts`](../../vsaas-backend/src/services/semantic-search/__tests__/gemini-embedding.test.ts) — 17 testes (L2, Matryoshka, cache, retry)
- [`tenant-scope.test.ts`](../../vsaas-backend/src/services/semantic-search/__tests__/tenant-scope.test.ts) — 14 testes (RBAC por role + edge cases)
- [`search-audit.test.ts`](../../vsaas-backend/src/services/semantic-search/__tests__/search-audit.test.ts) — 11 testes (queryHash privacy, cross-tenant flag, best-effort)

Rodar: `npx vitest run src/services/semantic-search/`

## O que vem depois

| PR | Conteúdo | Estimativa |
|---|---|---|
| **PR2** | Caption worker (Node loop) + visual embedding worker (opcional) | 2 dias |
| **PR3** | Endpoints HTTP: `/search/semantic`, `/search/similar/:id`, `/search/health` | 2 dias |
| **PR4** | Frontend integrado ao Cockpit existente — aba "Buscar em gravações" | 2 dias |
| **PR5** | Reindex incremental por integradorId + UI de progresso SSE | 1 dia |
| **PR6** | Backfill histórico (reprocessar gravações antigas, cobrado) | 2 dias |

## Como usar (depois do PR3)

```typescript
// dentro de um endpoint /search/semantic
import {
  applyTenantScope,
  PgVectorStore,
  getGeminiEmbeddingService,
  getSearchAuditService,
} from '../services/semantic-search'

router.post('/semantic', requireAuth, async (req, res) => {
  const t0 = Date.now()
  const { query, cameraIds, fromDate, toDate, modality = 'caption' } = req.body

  // 1) Constrói scope a partir do JWT (defesa em profundidade)
  const scope = applyTenantScope(req.jwtPayload!, {
    integradorId: req.query.integradorId as string | undefined,
    cameraIds,
  })

  // 2) Embed da query
  const embed = getGeminiEmbeddingService()
  const queryVec = await embed.embed(query)

  // 3) Search
  const store = new PgVectorStore()
  const hits = await store.search(queryVec, {
    modality,
    tenantScope: scope,
    fromDate: fromDate ? new Date(fromDate) : undefined,
    toDate:   toDate   ? new Date(toDate)   : undefined,
    limit: 25,
  })

  // 4) Audit (sempre, mesmo em falha)
  const audit = getSearchAuditService()
  await audit.recordQuery({
    actor: { type: 'INTEGRADOR', id: req.jwtPayload!.sub, email: req.jwtPayload!.email },
    tenantScope: scope,
    query, modality, cameraIds, fromDate, toDate,
    resultsCount: hits.length,
    latencyMs: Date.now() - t0,
    success: true,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  res.json({ hits, queryMs: Date.now() - t0 })
})
```

## Princípios de design

1. **Isolamento por construção** — `IVectorStore.search()` exige `TenantScope`. Não há sobrecarga sem scope. Compile-time + runtime check.
2. **Audit obrigatório** — `SearchAuditService` envolve toda operação. Falha de log é best-effort (não derruba query), mas sucesso é registrado.
3. **Sem texto da query persistido** — apenas hash SHA-256(16-hex). Privacidade LGPD.
4. **Cache LRU em embedding** — query repetida não regenera embedding ($$). 1k entradas, ~5MB.
5. **Z-score por tenant** — não global como Frigate, evita vazamento estatístico.
6. **Swap-friendly** — `IVectorStore` permite trocar pgvector ↔ Qdrant em 1 linha de DI.
7. **TDD** — toda lógica determinística tem teste antes da impl.

## Critérios de aceitação (PR1)

- [x] Migration aplicável (rodar `prisma migrate dev` em dev)
- [x] 58 testes unitários verdes
- [x] Sem dependência nova (`@google/generative-ai` já existia)
- [x] Sem novos secrets além do `GEMINI_API_KEY` que já está no rodízio
- [x] Linter limpo (`npx tsc --noEmit`)
- [x] Documentação arquitetural completa
- [ ] PR3 fecha o ciclo expondo via HTTP

## Observabilidade

Logs estruturados via Pino (já existe):
- `gemini_embed_failed` — tentativa falhou (retry conta)
- `search_audit_log_failed` — best-effort warning
- `deleteByIntegrador completed` — info quando admin chama LGPD delete

Métricas a adicionar no PR3:
- `semantic_search_latency_ms` (histograma, label: modality, tenant)
- `semantic_search_results` (histograma, label: modality)
- `gemini_embedding_cache_hit_rate`
- `pgvector_hnsw_index_size_mb`
