-- Sprint 4 — Billing Snapshots + extensões de auto-aprovação
-- Cria tabelas StorageBillingSnapshot/LineItem para painel de margem do
-- super admin e estende RetentionPlan + IntegradorRetentionContract com
-- limites de auto-aprovação híbrida (decisão consolidada 2026-05-07).

-- 1) Enums
CREATE TYPE "StorageBillingScope" AS ENUM ('CLIENTE_FINAL', 'SITE', 'CAMERA');
CREATE TYPE "StorageBillingStatus" AS ENUM ('PRELIMINARY', 'CLOSED', 'RECONCILED', 'INVOICED');

-- 2) RetentionPlan — gbIncludedSoftLimit (fair use indicativo)
ALTER TABLE "RetentionPlan"
  ADD COLUMN "gbIncludedSoftLimit" DECIMAL(8,2);

-- 3) IntegradorRetentionContract — auto-aprovação híbrida
ALTER TABLE "IntegradorRetentionContract"
  ADD COLUMN "autoApproveUpgradeLimitBrl" DECIMAL(8,2) DEFAULT 100,
  ADD COLUMN "autoApproveResolutionMax" "PlanResolution" DEFAULT 'FHD',
  ADD COLUMN "autoApproveRetainDaysMax" INTEGER DEFAULT 90,
  ADD COLUMN "notifyAllChanges" BOOLEAN NOT NULL DEFAULT true;

-- 4) StorageBillingSnapshot — 1 linha por (bucket, mês)
CREATE TABLE "StorageBillingSnapshot" (
  "id"                     TEXT NOT NULL,
  "bucketId"               TEXT NOT NULL,
  "integradorId"           TEXT NOT NULL,
  "periodYearMonth"        TEXT NOT NULL,
  "periodStart"            TIMESTAMP(3) NOT NULL,
  "periodEnd"              TIMESTAMP(3) NOT NULL,

  "avgStorageBytes"        BIGINT       NOT NULL DEFAULT 0,
  "classAOpsTotal"         BIGINT       NOT NULL DEFAULT 0,
  "classBOpsTotal"         BIGINT       NOT NULL DEFAULT 0,
  "bytesIngestedTotal"     BIGINT       NOT NULL DEFAULT 0,
  "bytesDeletedTotal"      BIGINT       NOT NULL DEFAULT 0,

  "costStorageUsd"         DECIMAL(12,4) NOT NULL DEFAULT 0,
  "costClassAUsd"          DECIMAL(12,4) NOT NULL DEFAULT 0,
  "costClassBUsd"          DECIMAL(12,4) NOT NULL DEFAULT 0,
  "costTotalUsd"           DECIMAL(12,4) NOT NULL DEFAULT 0,

  "usdBrlRate"             DECIMAL(8,4)  NOT NULL DEFAULT 5.30,
  "costTotalBrl"           DECIMAL(12,2) NOT NULL DEFAULT 0,
  "priceToIntegradorBrl"   DECIMAL(12,2) NOT NULL DEFAULT 0,
  "marginIACloudBrl"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  "marginIACloudPct"       DECIMAL(5,2)  NOT NULL DEFAULT 0,

  "cloudflareInvoiceUsd"   DECIMAL(12,4),
  "reconciliationDriftPct" DECIMAL(5,2),
  "reconciledAt"           TIMESTAMP(3),

  "status"                 "StorageBillingStatus" NOT NULL DEFAULT 'PRELIMINARY',
  "generatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedAt"            TIMESTAMP(3),

  CONSTRAINT "StorageBillingSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StorageBillingSnapshot_bucketId_fkey"
    FOREIGN KEY ("bucketId") REFERENCES "StorageBucket"("id") ON DELETE CASCADE,
  CONSTRAINT "StorageBillingSnapshot_integradorId_fkey"
    FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "StorageBillingSnapshot_bucketId_periodYearMonth_key"
  ON "StorageBillingSnapshot"("bucketId", "periodYearMonth");
CREATE INDEX "StorageBillingSnapshot_integradorId_periodYearMonth_idx"
  ON "StorageBillingSnapshot"("integradorId", "periodYearMonth");
CREATE INDEX "StorageBillingSnapshot_status_idx"
  ON "StorageBillingSnapshot"("status");

-- 5) StorageBillingLineItem — drill-down (cliente, site, câmera)
CREATE TABLE "StorageBillingLineItem" (
  "id"                     TEXT NOT NULL,
  "snapshotId"             TEXT NOT NULL,
  "scope"                  "StorageBillingScope" NOT NULL,
  "scopeId"                TEXT NOT NULL,
  "parentScopeId"          TEXT,

  "avgStorageBytes"        BIGINT NOT NULL DEFAULT 0,
  "classAOps"              BIGINT NOT NULL DEFAULT 0,
  "classBOps"              BIGINT NOT NULL DEFAULT 0,

  "costR2Brl"              DECIMAL(12,2) NOT NULL DEFAULT 0,
  "vpsCostBrl"             DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalCostBrl"           DECIMAL(12,2) NOT NULL DEFAULT 0,

  "priceToIntegradorBrl"   DECIMAL(12,2) NOT NULL DEFAULT 0,
  "priceToClienteFinalBrl" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "marginIACloudBrl"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  "marginIntegradorBrl"    DECIMAL(12,2) NOT NULL DEFAULT 0,

  "captureMode"            TEXT,
  "resolution"             TEXT,
  "retentionDays"          INTEGER,
  "cameraCount"            INTEGER,

  "isOutlier"              BOOLEAN NOT NULL DEFAULT false,
  "outlierReason"          TEXT,

  CONSTRAINT "StorageBillingLineItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StorageBillingLineItem_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "StorageBillingSnapshot"("id") ON DELETE CASCADE
);

CREATE INDEX "StorageBillingLineItem_snapshotId_scope_scopeId_idx"
  ON "StorageBillingLineItem"("snapshotId", "scope", "scopeId");
CREATE INDEX "StorageBillingLineItem_snapshotId_parentScopeId_idx"
  ON "StorageBillingLineItem"("snapshotId", "parentScopeId");
CREATE INDEX "StorageBillingLineItem_snapshotId_isOutlier_idx"
  ON "StorageBillingLineItem"("snapshotId", "isOutlier");
