-- Motion-gating (G3 fix — 2026-05-09):
-- Adiciona coluna deleteAfterReviewAt em RecordingSegment para o
-- motion-gate-cleaner job. Câmeras em modo MOTION/ACTIVE_OBJECTS gravam
-- 24/7 mas segments com deleteAfterReviewAt < now() sem hasMotion/hasEvent
-- são apagados pelo cleaner.

ALTER TABLE "RecordingSegment"
  ADD COLUMN IF NOT EXISTS "deleteAfterReviewAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "RecordingSegment_deleteAfterReviewAt_idx"
  ON "RecordingSegment"("deleteAfterReviewAt");
