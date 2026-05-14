-- Semantic Search Foundation (PR1) — 2026-05-14
-- Owner: Tarcísio · Co-author: Claude
-- See docs/semantic-search/ for architecture rationale.

-- =============================================================================
-- 1. EXTENSÃO pgvector
-- =============================================================================
-- Requer pgvector >= 0.5.0 (HNSW). Postgres 16+ recomendado.
-- Verificar no container: SELECT * FROM pg_available_extensions WHERE name='vector';
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- 2. COLUNAS DENORMALIZADAS em DetectionFrame
-- =============================================================================
-- Por que denormalizar integradorId/clienteFinalId/siteId:
--   Search semântica precisa filtrar por tenant em <50ms p95.
--   JOIN Camera→Site→ClienteFinal→Integrador custa 3 joins por linha.
--   Coluna direta + index composto = 1 ordem de magnitude mais rápido.
--
-- Trigger abaixo mantém sincronizado em INSERT/UPDATE.

ALTER TABLE "DetectionFrame"
  ADD COLUMN IF NOT EXISTS "integradorId"   TEXT,
  ADD COLUMN IF NOT EXISTS "clienteFinalId" TEXT,
  ADD COLUMN IF NOT EXISTS "siteId"         TEXT;

-- =============================================================================
-- 3. COLUNAS DE SEMANTIC SEARCH em DetectionFrame
-- =============================================================================
ALTER TABLE "DetectionFrame"
  ADD COLUMN IF NOT EXISTS "thumbnailKey"     TEXT,           -- R2 object key: "ai-thumbs/{cameraId}/{frameId}.jpg"
  ADD COLUMN IF NOT EXISTS "captionText"      TEXT,           -- descrição gerada por Gemini Flash
  ADD COLUMN IF NOT EXISTS "captionEmbedding" vector(768),    -- gemini-embedding-001 truncated to 768d
  ADD COLUMN IF NOT EXISTS "imageEmbedding"   vector(768),    -- opcional: multimodal (visão direta)
  ADD COLUMN IF NOT EXISTS "embeddingModel"   TEXT,           -- 'gemini-embedding-001' | future
  ADD COLUMN IF NOT EXISTS "embeddingVersion" INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "captionedAt"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "captionError"     TEXT;

-- =============================================================================
-- 4. BACKFILL — preencher campos denormalizados em registros existentes
-- =============================================================================
UPDATE "DetectionFrame" df
SET
  "siteId"         = c."siteId",
  "clienteFinalId" = s."clienteFinalId",
  "integradorId"   = cf."integradorId"
FROM "Camera" c
JOIN "Site" s ON s.id = c."siteId"
JOIN "ClienteFinal" cf ON cf.id = s."clienteFinalId"
WHERE df."cameraId" = c.id
  AND df."integradorId" IS NULL;

-- =============================================================================
-- 5. NOT NULL constraints após backfill
-- =============================================================================
-- Defer NOT NULL para depois da migration validar — em prod faríamos VALIDATE separado.
-- Aqui assumimos tabela pequena (early-stage).
ALTER TABLE "DetectionFrame"
  ALTER COLUMN "integradorId"   SET NOT NULL,
  ALTER COLUMN "clienteFinalId" SET NOT NULL,
  ALTER COLUMN "siteId"         SET NOT NULL;

-- =============================================================================
-- 6. TRIGGER de manutenção dos campos denormalizados
-- =============================================================================
-- Em INSERT/UPDATE de DetectionFrame, popula integradorId/clienteFinalId/siteId
-- lendo da hierarquia Camera→Site→ClienteFinal. Idempotente.

CREATE OR REPLACE FUNCTION detection_frame_denormalize_tenant() RETURNS TRIGGER AS $$
BEGIN
  -- Só recalcula se cameraId mudou ou se os campos estão vazios
  IF (TG_OP = 'INSERT')
     OR (NEW."cameraId" IS DISTINCT FROM OLD."cameraId")
     OR (NEW."integradorId" IS NULL)
     OR (NEW."clienteFinalId" IS NULL)
     OR (NEW."siteId" IS NULL)
  THEN
    SELECT s.id, s."clienteFinalId", cf."integradorId"
    INTO NEW."siteId", NEW."clienteFinalId", NEW."integradorId"
    FROM "Camera" c
    JOIN "Site" s ON s.id = c."siteId"
    JOIN "ClienteFinal" cf ON cf.id = s."clienteFinalId"
    WHERE c.id = NEW."cameraId";

    IF NEW."integradorId" IS NULL THEN
      RAISE EXCEPTION 'Cannot resolve tenant chain for camera %', NEW."cameraId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS detection_frame_denormalize_tenant_trg ON "DetectionFrame";
CREATE TRIGGER detection_frame_denormalize_tenant_trg
  BEFORE INSERT OR UPDATE ON "DetectionFrame"
  FOR EACH ROW
  EXECUTE FUNCTION detection_frame_denormalize_tenant();

-- =============================================================================
-- 7. ÍNDICES — performance e isolamento
-- =============================================================================
-- Index composto para queries tenant-scoped por janela temporal.
-- Cobre 90% das queries: "frames do integrador X entre data Y e Z".
CREATE INDEX IF NOT EXISTS "DetectionFrame_integradorId_timestamp_idx"
  ON "DetectionFrame" ("integradorId", "timestamp" DESC);

CREATE INDEX IF NOT EXISTS "DetectionFrame_clienteFinalId_timestamp_idx"
  ON "DetectionFrame" ("clienteFinalId", "timestamp" DESC);

-- Index para worker pegar frames pendentes de captioning.
-- WHERE captionedAt IS NULL AND captionEmbedding IS NULL (partial index).
CREATE INDEX IF NOT EXISTS "DetectionFrame_pending_caption_idx"
  ON "DetectionFrame" ("createdAt")
  WHERE "captionedAt" IS NULL AND "thumbnailKey" IS NOT NULL;

-- =============================================================================
-- 8. ÍNDICES HNSW para busca por similaridade cosseno
-- =============================================================================
-- m=16, ef_construction=64: defaults razoáveis para 768d, ajustar com volume.
-- maintenance_work_mem é crítico para build do HNSW — setar antes em prod:
--   SET maintenance_work_mem = '2GB';
--
-- Custo de RAM: ~1.2 KB por vetor 768d no índice HNSW.
-- 100k frames = 120 MB. 1M = 1.2 GB. 10M = 12 GB (não cabe em VPS 8GB).

CREATE INDEX IF NOT EXISTS "DetectionFrame_captionEmbedding_hnsw_idx"
  ON "DetectionFrame"
  USING hnsw ("captionEmbedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS "DetectionFrame_imageEmbedding_hnsw_idx"
  ON "DetectionFrame"
  USING hnsw ("imageEmbedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- =============================================================================
-- 9. SEARCH STATS (z-score normalization por integrador)
-- =============================================================================
-- Evita o problema do Frigate de stats globais que vazam entre tenants.
-- Welch online algorithm: mean/variance atualizados a cada query multimodal.

CREATE TABLE IF NOT EXISTS "SearchStats" (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "integradorId"  TEXT        NOT NULL,
  modality        TEXT        NOT NULL CHECK (modality IN ('caption', 'image')),
  mean            DOUBLE PRECISION NOT NULL DEFAULT 0,
  variance        DOUBLE PRECISION NOT NULL DEFAULT 1,
  n               INTEGER     NOT NULL DEFAULT 0,
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT search_stats_integrador_modality_unique UNIQUE ("integradorId", modality)
);

CREATE INDEX IF NOT EXISTS "SearchStats_integradorId_idx" ON "SearchStats" ("integradorId");

-- =============================================================================
-- 10. AUDIT — adiciona novas StorageAccessAction enum values
-- =============================================================================
-- StorageAccessLog já existe. Adicionamos ações novas para semantic search.
-- Verificar enum atual (StorageAccessAction) e adicionar valores se necessário.
-- Como o enum é Prisma-managed, o Prisma migrate cuida disso ao regenerar.
-- Aqui só documentamos intent:
--
--   action: SEMANTIC_SEARCH    -- toda query de busca
--   action: SEMANTIC_REINDEX   -- reindex disparado
--   action: SEMANTIC_BACKFILL  -- backfill de captioning histórico
--   action: SEMANTIC_DELETE    -- exclusão por tenant (LGPD)
--
-- Os valores do enum são aplicados via schema.prisma + db push.

-- =============================================================================
-- VALIDAÇÃO PÓS-MIGRATION
-- =============================================================================
-- Rodar manualmente para validar:
--   SELECT COUNT(*) FROM "DetectionFrame" WHERE "integradorId" IS NULL; -- 0
--   SELECT pg_size_pretty(pg_relation_size('DetectionFrame_captionEmbedding_hnsw_idx'));
--   EXPLAIN ANALYZE SELECT id FROM "DetectionFrame"
--     WHERE "integradorId" = 'X'
--     ORDER BY "captionEmbedding" <=> '[...]'::vector LIMIT 25;
