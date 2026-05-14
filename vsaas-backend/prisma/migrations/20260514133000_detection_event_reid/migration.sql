-- Re-ID Embedding em DetectionEvent — 2026-05-14
-- Owner: Tarcísio · Co-author: Claude
-- Adiciona embedding de aparência visual (Re-ID) no DetectionEvent.
-- Worker MobileNetV3-Small extrai 576-dim → zero-pad 768 → L2-normalizado.

-- 1. Coluna reidEmbedding
ALTER TABLE "DetectionEvent"
  ADD COLUMN IF NOT EXISTS "reidEmbedding" vector(768);

-- 2. HNSW index para busca cosseno
CREATE INDEX IF NOT EXISTS "DetectionEvent_reidEmbedding_hnsw_idx"
  ON "DetectionEvent"
  USING hnsw ("reidEmbedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. Index partial para busca eficiente
CREATE INDEX IF NOT EXISTS "DetectionEvent_reid_pending_idx"
  ON "DetectionEvent" ("cameraId", "startTime" DESC)
  WHERE "reidEmbedding" IS NOT NULL AND "objectType" = 'person';
