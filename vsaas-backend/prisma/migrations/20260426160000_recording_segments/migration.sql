-- HLS Playback — gravação contínua em segmentos .ts
-- Cada ffmpeg de gravação fecha 1 segmento ~4-10s e insere uma linha aqui.
-- Endpoint /playback/:id/manifest.m3u8 lê com range query e monta HLS dinâmico.

CREATE TABLE "RecordingSegment" (
  "id"          TEXT          NOT NULL,
  "cameraId"    TEXT          NOT NULL,
  "startedAt"   TIMESTAMP(3)  NOT NULL,
  "endedAt"     TIMESTAMP(3)  NOT NULL,
  "durationSec" DOUBLE PRECISION NOT NULL,
  "sizeBytes"   BIGINT        NOT NULL,
  "storagePath" TEXT          NOT NULL,
  "codec"       TEXT          NOT NULL DEFAULT 'h264',
  "width"       INTEGER,
  "height"      INTEGER,

  CONSTRAINT "RecordingSegment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecordingSegment_cameraId_fkey"
    FOREIGN KEY ("cameraId") REFERENCES "Camera"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Range queries por câmera+tempo (caso 99% — manifest.m3u8)
CREATE INDEX "RecordingSegment_cameraId_startedAt_idx"
  ON "RecordingSegment"("cameraId", "startedAt");

-- Retention job (DELETE WHERE endedAt < cutoff)
CREATE INDEX "RecordingSegment_endedAt_idx"
  ON "RecordingSegment"("endedAt");
