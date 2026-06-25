-- B-6 / LGPD Art. 11: TTL em embeddings faciais (categoria especial)
--
-- Adiciona expiresAt nullable em FaceEmbedding + índice pra cron de purga.
-- Default NULL = permanente (cadastrado com base legal). Novos embeddings
-- candidatos (gerados em processamento) devem setar 90 dias.

ALTER TABLE "FaceEmbedding"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "FaceEmbedding_expiresAt_idx"
  ON "FaceEmbedding" ("expiresAt");
