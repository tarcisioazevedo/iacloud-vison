-- G22 (2026-05-09): coluna storageTier em RecordingSegment para futuro
-- lifecycle hot→cold (R2 IA / Glacier-equivalente). Hoje todos segments
-- nascem HOT; ciclo de migração será job separado (não nesta migration).

DO $$ BEGIN
  CREATE TYPE "StorageTier" AS ENUM ('HOT', 'COLD');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "RecordingSegment"
  ADD COLUMN IF NOT EXISTS "storageTier" "StorageTier" NOT NULL DEFAULT 'HOT';

CREATE INDEX IF NOT EXISTS "RecordingSegment_storageTier_endedAt_idx"
  ON "RecordingSegment"("storageTier", "endedAt");
