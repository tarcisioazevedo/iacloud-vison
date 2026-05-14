-- Cross-cam re-identification — link entre events da mesma pessoa em câmeras diferentes
ALTER TABLE "DetectionEvent"
  ADD COLUMN IF NOT EXISTS "correlatedEventId"    text,
  ADD COLUMN IF NOT EXISTS "correlatedConfidence" double precision,
  ADD COLUMN IF NOT EXISTS "correlatedReason"     text;

CREATE INDEX IF NOT EXISTS "DetectionEvent_correlatedEventId_idx"
  ON "DetectionEvent" ("correlatedEventId")
  WHERE "correlatedEventId" IS NOT NULL;
