-- ============================================================================
-- Migration: Sistema de Gravação Avançado
-- - Bookmark: marcação de eventos no vídeo
-- - RecordingSchedule: agendamento por dia/hora/modo
-- - DetectionFrame: bounding boxes para motion search por zona (Alt 3)
-- - ExportAudit: auditoria de exportações
-- - MediaCertificate: assinatura digital HMAC para autenticidade
-- - RecordingSegment: campos hasMotion/hasEvent + spriteUrl
-- ============================================================================

-- ── Extensões em RecordingSegment ──────────────────────────────────────────
ALTER TABLE "RecordingSegment"
  ADD COLUMN IF NOT EXISTS "hasMotion" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "hasEvent"  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "fps"       INTEGER,
  ADD COLUMN IF NOT EXISTS "spriteUrl" TEXT;

CREATE INDEX IF NOT EXISTS "RecordingSegment_cameraId_hasMotion_idx"
  ON "RecordingSegment"("cameraId", "hasMotion", "startedAt");

-- ── BookmarkAutoType enum ─────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "BookmarkAutoType" AS ENUM ('MOTION', 'EVENT', 'DOWNLOAD', 'EXPORT', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Bookmark ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Bookmark" (
  "id"          TEXT NOT NULL,
  "cameraId"    TEXT NOT NULL,
  "segmentId"   TEXT,
  "tenantId"    TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "color"       TEXT NOT NULL DEFAULT '#F59E0B',
  "startAt"     TIMESTAMP(3) NOT NULL,
  "endAt"       TIMESTAMP(3),
  "notes"       TEXT,
  "autoType"    "BookmarkAutoType" NOT NULL DEFAULT 'MANUAL',
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Bookmark"
  ADD CONSTRAINT "Bookmark_cameraId_fkey"
  FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Bookmark"
  ADD CONSTRAINT "Bookmark_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "RecordingSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Bookmark_cameraId_startAt_idx" ON "Bookmark"("cameraId", "startAt");
CREATE INDEX "Bookmark_tenantId_idx" ON "Bookmark"("tenantId");
CREATE INDEX "Bookmark_autoType_idx" ON "Bookmark"("autoType");

-- ── RecordingScheduleMode enum ────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "RecordingScheduleMode" AS ENUM ('ALWAYS', 'MOTION', 'EVENT', 'MOTION_AND_EVENT', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── RecordingSchedule ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RecordingSchedule" (
  "id"        TEXT NOT NULL,
  "cameraId"  TEXT NOT NULL,
  -- 0=Dom, 1=Seg, ..., 6=Sab, 7=Todos os dias
  "dayOfWeek" INTEGER NOT NULL,
  -- Hora de início (0-23)
  "hourStart" INTEGER NOT NULL,
  -- Hora de fim (1-24, exclusivo)
  "hourEnd"   INTEGER NOT NULL,
  "mode"      "RecordingScheduleMode" NOT NULL DEFAULT 'ALWAYS',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecordingSchedule_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RecordingSchedule"
  ADD CONSTRAINT "RecordingSchedule_cameraId_fkey"
  FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "RecordingSchedule_cameraId_dayOfWeek_hourStart_key"
  ON "RecordingSchedule"("cameraId", "dayOfWeek", "hourStart");

CREATE INDEX "RecordingSchedule_cameraId_idx" ON "RecordingSchedule"("cameraId");

-- ── DetectionFrame ────────────────────────────────────────────────────────
-- Bounding boxes de cada detecção do edge (YOLO/Frigate) para motion search por zona.
CREATE TABLE IF NOT EXISTS "DetectionFrame" (
  "id"         TEXT NOT NULL,
  "cameraId"   TEXT NOT NULL,
  "segmentId"  TEXT,
  "timestamp"  TIMESTAMP(3) NOT NULL,
  "objectType" TEXT NOT NULL,
  -- Coordenadas normalizadas (0-1) relativas à imagem da câmera
  "bboxX"      DOUBLE PRECISION NOT NULL,
  "bboxY"      DOUBLE PRECISION NOT NULL,
  "bboxW"      DOUBLE PRECISION NOT NULL,
  "bboxH"      DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION,
  "trackId"    TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DetectionFrame_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DetectionFrame"
  ADD CONSTRAINT "DetectionFrame_cameraId_fkey"
  FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DetectionFrame"
  ADD CONSTRAINT "DetectionFrame_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "RecordingSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DetectionFrame_cameraId_timestamp_idx" ON "DetectionFrame"("cameraId", "timestamp");
CREATE INDEX "DetectionFrame_cameraId_objectType_timestamp_idx"
  ON "DetectionFrame"("cameraId", "objectType", "timestamp");

-- ── ExportAuditType enum ──────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ExportAuditType" AS ENUM ('SNAPSHOT', 'RECORDING', 'BULK', 'MOSAIC', 'PRINT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ExportAudit ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ExportAudit" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "userId"        TEXT,
  "userEmail"     TEXT,
  "cameraIds"     TEXT[] NOT NULL DEFAULT '{}',
  "fromAt"        TIMESTAMP(3),
  "toAt"          TIMESTAMP(3),
  "exportType"    "ExportAuditType" NOT NULL,
  "fileSizeBytes" BIGINT,
  "fileCount"     INTEGER NOT NULL DEFAULT 1,
  "destination"   TEXT,
  "certificateId" TEXT,
  "ipAddress"     TEXT,
  "userAgent"     TEXT,
  "metadata"      JSONB,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExportAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExportAudit_tenantId_createdAt_idx" ON "ExportAudit"("tenantId", "createdAt" DESC);
CREATE INDEX "ExportAudit_userId_idx" ON "ExportAudit"("userId");
CREATE INDEX "ExportAudit_exportType_idx" ON "ExportAudit"("exportType");

-- ── MediaCertificateType enum ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "MediaCertificateType" AS ENUM ('SNAPSHOT', 'RECORDING', 'PRINT', 'MOSAIC_EXPORT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── MediaCertificate ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MediaCertificate" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "cameraId"    TEXT,
  "type"        "MediaCertificateType" NOT NULL,
  "capturedAt"  TIMESTAMP(3),
  "exportedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exportedBy"  TEXT,
  -- SHA-256 do arquivo original (hex)
  "sha256"      TEXT NOT NULL,
  -- HMAC-SHA256 do canonical JSON (hex)
  "signature"   TEXT NOT NULL,
  "fileSize"    BIGINT,
  "fileName"    TEXT,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaCertificate_signature_idx" ON "MediaCertificate"("signature");
CREATE INDEX "MediaCertificate_tenantId_createdAt_idx"
  ON "MediaCertificate"("tenantId", "createdAt" DESC);
CREATE INDEX "MediaCertificate_cameraId_idx" ON "MediaCertificate"("cameraId");
