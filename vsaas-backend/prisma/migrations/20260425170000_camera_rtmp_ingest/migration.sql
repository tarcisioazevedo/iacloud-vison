-- RTMP push IN — câmera empurra pro VSaaS atravessando NAT
-- Adiciona modo de ingestão por câmera + tabela de auditoria do endpoint
-- público (acessível só por SUPER_ADMIN, já que não há segregação por
-- tenant no socket de ingest).

-- 1. Enums
CREATE TYPE "IngestMode" AS ENUM ('RTSP_PULL', 'RTMP_PUSH');

CREATE TYPE "IngestEvent" AS ENUM (
  'PUBLISH_START',
  'PUBLISH_END',
  'AUTH_OK',
  'AUTH_FAIL',
  'UNKNOWN_PATH',
  'ERROR'
);

-- 2. Camera columns
ALTER TABLE "Camera"
  ADD COLUMN "ingestMode"            "IngestMode" NOT NULL DEFAULT 'RTSP_PULL',
  ADD COLUMN "rtmpIngestKeyEnc"      TEXT,
  ADD COLUMN "rtmpIngestLastFrameAt" TIMESTAMP(3);

-- 3. IngestLog table
CREATE TABLE "IngestLog" (
  "id"          TEXT          NOT NULL,
  "ts"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "event"       "IngestEvent" NOT NULL,
  "streamPath"  TEXT          NOT NULL,
  "remoteAddr"  TEXT,
  "cameraId"    TEXT,
  "bytesIn"     BIGINT,
  "detailsJson" JSONB,

  CONSTRAINT "IngestLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IngestLog_cameraId_fkey" FOREIGN KEY ("cameraId")
    REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "IngestLog_ts_idx"             ON "IngestLog"("ts");
CREATE INDEX "IngestLog_event_ts_idx"       ON "IngestLog"("event", "ts");
CREATE INDEX "IngestLog_cameraId_ts_idx"    ON "IngestLog"("cameraId", "ts");
CREATE INDEX "IngestLog_remoteAddr_idx"     ON "IngestLog"("remoteAddr");
