-- =============================================================================
-- GenAI description + attributes + tsvector pra busca full-text PT-BR
-- =============================================================================

ALTER TABLE "DetectionEvent"
  ADD COLUMN IF NOT EXISTS "description"            text,
  ADD COLUMN IF NOT EXISTS "descriptionAttributes"  jsonb,
  ADD COLUMN IF NOT EXISTS "descriptionGeneratedAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "fpCheckedAt"            timestamp(3),
  ADD COLUMN IF NOT EXISTS "fpReason"               text;

-- Coluna tsvector gerada automaticamente (immutable: portuguese stem só).
-- O stemmer portuguese já cobre plurais e flexões; unaccent precisa de trigger
-- pra ser indexável (não-imutável) — adiar pra v2 se necessário.
ALTER TABLE "DetectionEvent"
  ADD COLUMN IF NOT EXISTS "descriptionTsv" tsvector
    GENERATED ALWAYS AS (
      to_tsvector('portuguese', coalesce("description", ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS "DetectionEvent_descriptionTsv_idx"
  ON "DetectionEvent" USING GIN ("descriptionTsv");

CREATE INDEX IF NOT EXISTS "DetectionEvent_descriptionGeneratedAt_idx"
  ON "DetectionEvent" ("descriptionGeneratedAt")
  WHERE "descriptionGeneratedAt" IS NOT NULL;
