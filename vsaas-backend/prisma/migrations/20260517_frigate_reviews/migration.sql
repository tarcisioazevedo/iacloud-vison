-- PEDIDO-1 da Bridge (BOX 2026-05-08): FrigateReview
-- Recebe alertas Frigate (severity + objects + zones + GenAI metadata) via
-- POST /iacv-box/review-segments. Box já tem review_sync.py rodando em
-- DRY-RUN com 12 reviews acumulados aguardando o endpoint.

-- 1) Enum severity
CREATE TYPE "FrigateReviewSeverity" AS ENUM ('ALERT', 'DETECTION');

-- 2) Tabela
CREATE TABLE "FrigateReview" (
  "id"                          TEXT NOT NULL,
  "edgeNodeId"                  TEXT NOT NULL,
  "cameraId"                    TEXT NOT NULL,
  "frigateReviewId"             TEXT NOT NULL,
  "cameraFrigateName"           TEXT,
  "startedAt"                   TIMESTAMP(3) NOT NULL,
  "endedAt"                     TIMESTAMP(3),
  "severity"                    "FrigateReviewSeverity" NOT NULL,
  "hasBeenReviewed"             BOOLEAN NOT NULL DEFAULT false,
  "objects"                     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "zones"                       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "thumbPath"                   TEXT,

  -- GenAI metadata
  "genaiTitle"                  TEXT,
  "genaiShortSummary"           TEXT,
  "genaiConfidence"             DECIMAL(4, 3),
  "genaiPotentialThreatLevel"   INTEGER,

  "receivedAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cloudReviewedAt"             TIMESTAMP(3),
  "cloudReviewedById"           TEXT,

  CONSTRAINT "FrigateReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FrigateReview_edgeNodeId_fkey"
    FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id") ON DELETE CASCADE,
  CONSTRAINT "FrigateReview_cameraId_fkey"
    FOREIGN KEY ("cameraId")   REFERENCES "Camera"("id")   ON DELETE CASCADE
);

-- 3) Idempotência: (edgeNodeId, frigateReviewId)
CREATE UNIQUE INDEX "FrigateReview_edgeNodeId_frigateReviewId_key"
  ON "FrigateReview"("edgeNodeId", "frigateReviewId");

-- 4) Índices de consulta
CREATE INDEX "FrigateReview_cameraId_startedAt_idx"
  ON "FrigateReview"("cameraId", "startedAt");
CREATE INDEX "FrigateReview_severity_hasBeenReviewed_idx"
  ON "FrigateReview"("severity", "hasBeenReviewed");
CREATE INDEX "FrigateReview_receivedAt_idx"
  ON "FrigateReview"("receivedAt");
