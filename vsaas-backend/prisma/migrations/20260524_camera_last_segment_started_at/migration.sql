-- Camera.lastSegmentStartedAt — timestamp do startedAt do RecordingSegment
-- mais recente. Diferente de lastOnlineAt (heartbeat genérico): só sobe
-- quando o recorder de fato cria um segmento. Habilita dashboard de saúde
-- real (push ativo vs segmentação real vs upload R2).

ALTER TABLE "Camera"
  ADD COLUMN IF NOT EXISTS "lastSegmentStartedAt" timestamp(3);

-- Índice parcial pra queries do tipo "câmeras com gap > X" — só recordEnabled.
-- Cardinalidade alta no campo (cada câmera com timestamp distinto), filtro
-- recordEnabled corta câmeras desativadas.
CREATE INDEX IF NOT EXISTS "Camera_lastSegmentStartedAt_idx"
  ON "Camera" ("lastSegmentStartedAt" DESC)
  WHERE "recordEnabled" = true;
