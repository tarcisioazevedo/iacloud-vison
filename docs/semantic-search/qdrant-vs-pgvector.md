# Qdrant vs pgvector — decisão para o VSaaS

**Data:** 2026-05-14
**Status:** Decidido — **pgvector** para a fase atual, com abstração `IVectorStore` que permite trocar para Qdrant sem refatorar callers.

---

## TL;DR

| Critério | pgvector | Qdrant | Vence |
|---|---|---|---|
| Operação (já temos Postgres) | ✅ zero novo serviço | ❌ +1 container, +backup, +secret | **pgvector** |
| Isolamento multi-tenant | RLS Postgres + coluna `integradorId` indexada | `is_tenant: true` payload index + JWT RBAC | empate |
| Filtros + ANN @ 100k–1M vetores | HNSW + WHERE pré-filtro funciona | Pre-filtering nativo, ligeiramente melhor | empate aceitável |
| Filtros + ANN @ 10M+ | Lento se filtros muito seletivos | Vence | **Qdrant** |
| JOIN com tabelas relacionais (Camera, Site, AlertEvent) | nativo | precisa hidratar via Postgres depois | **pgvector** |
| Audit log nativo | pg_stat_statements + triggers + StorageAccessLog | ❌ não tem | **pgvector** |
| Snapshots/backups | `pg_dump` único | snapshot separado por collection | **pgvector** |
| Transação atômica `INSERT DetectionFrame + INSERT embedding` | ✅ ACID | ❌ 2-phase commit frágil | **pgvector** |
| Inference (embed inside DB) | ❌ chama Gemini fora | ✅ Cloud-only, self-host não | **Qdrant Cloud** |
| Custo de migração futura | Baixo (abstração `IVectorStore` já preparada) | — | empate |

**Veredito:** pgvector ganha 6×3 nas dimensões que importam pro VSaaS hoje. Os pontos onde Qdrant ganha (escala 10M+, inference Cloud) **não se aplicam ao estágio atual** (11 integradores, ~100k frames/mês estimados, self-hosted Hetzner).

---

## Quando reavaliar (gatilhos objetivos)

- **Volume:** total de `DetectionFrame` com embedding > **5M** registros
- **Performance:** p95 de busca semântica filtrada por `integradorId` > **200 ms** no pgvector
- **Cliente piloto grande:** primeiro integrador com > 50 clientes finais ou > 500k frames/mês
- **Necessidade de quantization agressiva:** RAM do Postgres saturando por causa do índice HNSW
- **Multi-modal pesado:** queries paralelas com CLIP visual + texto em mesma resposta

Quando 1+ gatilho disparar → executar plano em [migration-path.md](migration-path.md) (a criar).

---

## Por que Qdrant **não** agora

1. **Operação solo (Tarcísio).** +1 serviço no swarm = +1 backup + alerting + sync logic. A sync `DetectionFrame ↔ Qdrant` é o tipo de gambiarra que vai morder em 6 meses (eventual consistency, retries, dead-letter).
2. **9 segredos em git history** pendentes (P0 do `docs/PRE-HOMOLOGACAO-CHECKLIST.md`). Adicionar Qdrant agora = +1 segredo (API key/JWT master) que precisa entrar no rodízio de rotação antes do P0 fechar.
3. **JOIN é o pão da semantic search no VSaaS.** Todo resultado de busca precisa hidratar com `Camera.name`, `Site.name`, `ClienteFinal.name`, signed URL do thumbnail. Manter no Postgres elimina round-trip cross-store.
4. **Audit é requisito LGPD.** `StorageAccessLog` já existe, já tem `integradorId`, já tem auditoria de quem viu/baixou objeto. Adicionar `SEMANTIC_SEARCH` como `action` é 1 linha. Qdrant precisa proxy externo logando antes de cada query.
5. **Inference API do Qdrant é Cloud-only.** Self-hosted continua chamando Gemini fora — perde o argumento principal.
6. **Volume real está abaixo do break-even.** Tigerdata, pgvector.dev e a própria Qdrant publicam benchmarks: até **~1M vetores 768d com filtros seletivos**, pgvector + HNSW empata ou ganha em latência por causa do pré-filtro relacional eficiente. Acima de 5M, Qdrant ganha decisivamente.

---

## Estratégia de isolamento (vale para pgvector E Qdrant)

### Modelo de dados

`DetectionFrame` ganha **3 campos denormalizados** para evitar JOIN em cada query semântica e habilitar **Row-Level Security** futura:

```prisma
model DetectionFrame {
  // ... campos existentes ...
  integradorId    String     // denormalizado de camera→site→clienteFinal→integrador
  clienteFinalId  String     // denormalizado de camera→site→clienteFinal
  siteId          String     // denormalizado de camera→site

  // semantic search
  thumbnailKey       String?
  captionText        String?  @db.Text
  captionEmbedding   Unsupported("vector(768)")?
  imageEmbedding     Unsupported("vector(768)")?
  embeddingModel     String?
  embeddingVersion   Int      @default(1)
  captionedAt        DateTime?
  captionError       String?
}
```

Denormalização justificada: `Camera.siteId → Site.clienteFinalId → ClienteFinal.integradorId` é uma cascata de 3 JOINs. Para busca semântica de baixa latência (<100 ms p95), o pré-filtro precisa estar num único `WHERE` indexado.

**Trigger Postgres** mantém os campos sincronizados em INSERT/UPDATE de DetectionFrame, lendo da Camera (ver `migration.sql`).

### RBAC por role

| Role | Filtro obrigatório no WHERE |
|---|---|
| `SUPER_ADMIN` / `ADMIN_GLOBAL` | nenhum (acesso total, mas todo query é logado em StorageAccessLog) |
| `INTEGRADOR_ADMIN` / `INTEGRADOR_TECNICO` | `integradorId = jwt.integradorId` (forçado server-side) |
| `CLIENTE_ADMIN` / `CLIENTE_OPERADOR` | `clienteFinalId = jwt.clienteFinalId` |
| `CLIENTE_VIEWER` / `CLIENTE_AUDITOR` | `clienteFinalId = jwt.clienteFinalId` AND `cameraId IN (jwt.allowedCameras)` |

Validação dupla:
- **Frontend:** filtros de UI scoped pela role (não confiamos só nisso)
- **Backend:** middleware `requireAuth` injeta `jwtPayload` em `req`; endpoint `/search/semantic` chama helper `applyTenantScope(where, jwtPayload)` antes de executar SQL — **não há query sem scope**

### Row-Level Security (futuro, opt-in)

Postgres RLS pode ser ativado em produção quando atingirmos N tenants ou primeiro audit externo:

```sql
ALTER TABLE "DetectionFrame" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "DetectionFrame"
  USING (
    current_setting('app.role') = 'SUPER_ADMIN'
    OR integrador_id = current_setting('app.integrador_id')::uuid
  );
```

Connection pool seta `app.role` e `app.integrador_id` por sessão via `SET LOCAL`. Defesa-em-profundidade: mesmo se um endpoint esquecer o WHERE, o Postgres recusa as linhas.

### Z-score stats por tenant

Frigate persiste stats globais em `.search_stats.json`. Para multi-tenant **isso é vazamento estatístico** — um tenant grande "calibra" o ranking dos pequenos. Nossa implementação:

```prisma
model SearchStats {
  id              String   @id @default(uuid())
  integradorId    String
  modality        String   // 'caption' | 'image'
  mean            Float    @default(0)
  variance        Float    @default(1)
  n               Int      @default(0)
  updatedAt       DateTime @updatedAt
  @@unique([integradorId, modality])
}
```

Atualização via Welch online (mesmo algoritmo do Frigate). 100% isolado por integrador.

---

## A abstração `IVectorStore`

Para garantir que **a decisão de hoje não vire dívida amanhã**, todo código que toca embedding passa por uma interface única:

```typescript
interface IVectorStore {
  /** Insere/atualiza embedding de uma DetectionFrame */
  upsert(frameId: string, embeddings: {
    caption?: Float32Array
    image?: Float32Array
  }, metadata: TenantScope): Promise<void>

  /** Busca semântica com isolamento obrigatório */
  search(query: Float32Array, opts: {
    modality: 'caption' | 'image' | 'merge'
    tenantScope: TenantScope            // ← isolamento mandatório
    cameraIds?: string[]
    fromDate?: Date
    toDate?: Date
    limit: number
  }): Promise<SearchHit[]>

  /** Exclusão por tenant (LGPD) */
  deleteByTenant(integradorId: string): Promise<number>
}
```

Implementações:
- `PgVectorStore` (atual)
- `QdrantStore` (futura, plug-and-play)

Todos os endpoints (`/search/semantic`, `/search/similar/:id`) consomem via DI. Trocar de pgvector pra Qdrant = trocar 1 linha no container.

---

## Audit obrigatório

Toda chamada a `IVectorStore.search()` é envolvida por `SearchAuditService.recordQuery()`:

```typescript
await searchAudit.recordQuery({
  actorType: 'INTEGRADOR' | 'USER' | 'SUPER_ADMIN',
  actorId: jwt.sub,
  actorEmail: jwt.email,
  integradorId: jwt.integradorId,
  clienteFinalId: jwt.clienteFinalId,
  action: 'SEMANTIC_SEARCH',
  metadata: {
    queryHash: sha256(query),
    queryLength: query.length,
    modality, cameraIds, fromDate, toDate, limit,
    resultsCount: hits.length,
    latencyMs,
    estimatedCostUsd,
  },
  success: true,
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
})
```

Persiste em `StorageAccessLog`. Permite:
- Rastreabilidade LGPD ("quem buscou dados meus?")
- Detecção de uso abusivo (rate limit por tenant)
- Cost accounting (embedding API custa por query)
- Compliance audit ("liste todas as buscas de X em Y")

---

## Resumo executivo

- **Decidido:** pgvector via `IVectorStore` abstrato
- **Isolamento:** denormalização + RBAC server-side + RLS futuro
- **Audit:** `StorageAccessLog.action = SEMANTIC_SEARCH` em toda query
- **Plano de fuga:** quando volume/latência justificar, swap para Qdrant via DI sem refatorar callers
