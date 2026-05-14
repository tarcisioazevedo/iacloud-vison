CREATE TABLE IF NOT EXISTS "DetectionDailyBriefing" (
  "id"           text PRIMARY KEY,
  "integradorId" text NOT NULL,
  "date"         date NOT NULL,
  "generatedAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "summary"      text NOT NULL,
  "highlights"   jsonb,
  "cost"         double precision
);

CREATE UNIQUE INDEX IF NOT EXISTS "DetectionDailyBriefing_integradorId_date_key"
  ON "DetectionDailyBriefing" ("integradorId", "date");
CREATE INDEX IF NOT EXISTS "DetectionDailyBriefing_integradorId_date_idx"
  ON "DetectionDailyBriefing" ("integradorId", "date" DESC);
