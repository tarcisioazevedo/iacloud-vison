-- Sprite preview no hover (docs/09 item 1) — Box gera 1 sprite por hora
-- com 120 frames (1 a cada 30s) num grid 12×10. Frontend usa CSS
-- background-position pra mostrar preview instantâneo durante hover.
--
-- Padrão de storage: integrador/{integradorId}/cameras/{cameraId}/sprites/{day}/{hour}.jpg
-- Tamanho típico: ~400KB/JPG, ~10MB/cam/dia (24h × 400KB).
--
-- Índice (cameraId, day): operador hover na timeline → frontend chama
-- GET /playback/:cameraId/sprites?day=YYYY-MM-DD → 24 rows max por hit.
-- Idempotência: UNIQUE (cameraId, day, hour) — Box pode reenviar (overwrite)
-- sem duplicar.

CREATE TABLE "SpriteSheet" (
  "id"               TEXT             NOT NULL,
  "cameraId"         TEXT             NOT NULL,
  "day"              VARCHAR(10)      NOT NULL,
  "hour"             SMALLINT         NOT NULL,
  "storagePath"      TEXT             NOT NULL,
  "sizeBytes"        BIGINT           NOT NULL,
  "frameCount"       INTEGER          NOT NULL,
  "gridCols"         INTEGER          NOT NULL DEFAULT 12,
  "gridRows"         INTEGER          NOT NULL DEFAULT 10,
  "frameWidth"       INTEGER          NOT NULL DEFAULT 160,
  "frameHeight"      INTEGER          NOT NULL DEFAULT 90,
  "frameIntervalSec" INTEGER          NOT NULL DEFAULT 30,
  "firstFrameAt"     TIMESTAMP(3)     NOT NULL,
  "uploadedAt"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpriteSheet_pkey" PRIMARY KEY ("id")
);

-- Idempotência: 1 sprite por (camera, day, hour). Reenvio = overwrite.
CREATE UNIQUE INDEX "SpriteSheet_cameraId_day_hour_key"
  ON "SpriteSheet"("cameraId", "day", "hour");

-- Lookup principal: timeline pede sprites do dia inteiro.
CREATE INDEX "SpriteSheet_cameraId_day_idx"
  ON "SpriteSheet"("cameraId", "day");

-- Worker pode varrer "uploadedAt IS NULL" pra detectar uploads pendentes.
CREATE INDEX "SpriteSheet_uploadedAt_idx"
  ON "SpriteSheet"("uploadedAt");

-- FK com cascade — se câmera é apagada, sprites somem junto.
ALTER TABLE "SpriteSheet"
  ADD CONSTRAINT "SpriteSheet_cameraId_fkey"
  FOREIGN KEY ("cameraId") REFERENCES "Camera"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
