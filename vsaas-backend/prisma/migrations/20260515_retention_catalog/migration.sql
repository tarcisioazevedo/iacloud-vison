-- Sprint 2 — Catálogo de Retention Plans
-- Cria estrutura comercial completa: catálogo (RetentionPlan), contrato por
-- integrador (markup + plano default), workflow de upgrade (auto-approved hoje),
-- e FKs em Camera/ClienteFinal para atribuição em cascata.

-- 1) Enums
CREATE TYPE "PlanResolution" AS ENUM ('ANY', 'VGA', 'HD', 'FHD', 'UHD_4K');
CREATE TYPE "RetentionUpgradeStatus" AS ENUM (
  'AUTO_APPROVED', 'PENDING_INTEGRADOR', 'APPROVED', 'DENIED', 'CANCELED'
);

-- 2) Catálogo de planos (master, gerenciado pelo SUPER_ADMIN)
CREATE TABLE "RetentionPlan" (
  "id"                       TEXT NOT NULL,
  "slug"                     TEXT NOT NULL,
  "name"                     TEXT NOT NULL,
  "retainDays"               INTEGER NOT NULL,
  "resolution"               "PlanResolution" NOT NULL DEFAULT 'HD',
  "pricePerCameraMonthUsd"   DECIMAL(8,4) NOT NULL,
  "costR2EstimatedUsd"       DECIMAL(8,4),
  "description"              TEXT,
  "active"                   BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"                INTEGER NOT NULL DEFAULT 100,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetentionPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetentionPlan_slug_key" ON "RetentionPlan"("slug");
CREATE UNIQUE INDEX "RetentionPlan_resolution_retainDays_key"
  ON "RetentionPlan"("resolution", "retainDays");
CREATE INDEX "RetentionPlan_active_sortOrder_idx"
  ON "RetentionPlan"("active", "sortOrder");

-- 3) Contrato por integrador (1:1 com Integrador)
CREATE TABLE "IntegradorRetentionContract" (
  "id"             TEXT NOT NULL,
  "integradorId"   TEXT NOT NULL,
  "defaultPlanoId" TEXT NOT NULL,
  "markupPct"      DECIMAL(5,2) NOT NULL DEFAULT 30,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegradorRetentionContract_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegradorRetentionContract_integradorId_fkey"
    FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE CASCADE,
  CONSTRAINT "IntegradorRetentionContract_defaultPlanoId_fkey"
    FOREIGN KEY ("defaultPlanoId") REFERENCES "RetentionPlan"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "IntegradorRetentionContract_integradorId_key"
  ON "IntegradorRetentionContract"("integradorId");

-- 4) Workflow de upgrade (auto-approved no MVP)
CREATE TABLE "RetentionUpgradeRequest" (
  "id"             TEXT NOT NULL,
  "cameraId"       TEXT,
  "clienteFinalId" TEXT,
  "fromPlanoId"    TEXT,
  "toPlanoId"      TEXT NOT NULL,
  "status"         "RetentionUpgradeStatus" NOT NULL DEFAULT 'AUTO_APPROVED',
  "requestedById"  TEXT NOT NULL,
  "requestedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById"    TEXT,
  "decidedAt"      TIMESTAMP(3),
  "decisionNote"   TEXT,
  CONSTRAINT "RetentionUpgradeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionUpgradeRequest_cameraId_fkey"
    FOREIGN KEY ("cameraId")       REFERENCES "Camera"("id")        ON DELETE SET NULL,
  CONSTRAINT "RetentionUpgradeRequest_clienteFinalId_fkey"
    FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id")  ON DELETE SET NULL,
  CONSTRAINT "RetentionUpgradeRequest_fromPlanoId_fkey"
    FOREIGN KEY ("fromPlanoId")    REFERENCES "RetentionPlan"("id") ON DELETE SET NULL,
  CONSTRAINT "RetentionUpgradeRequest_toPlanoId_fkey"
    FOREIGN KEY ("toPlanoId")      REFERENCES "RetentionPlan"("id") ON DELETE RESTRICT,
  CONSTRAINT "RetentionUpgradeRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById")  REFERENCES "User"("id")          ON DELETE RESTRICT,
  CONSTRAINT "RetentionUpgradeRequest_decidedById_fkey"
    FOREIGN KEY ("decidedById")    REFERENCES "User"("id")          ON DELETE SET NULL
);
CREATE INDEX "RetentionUpgradeRequest_cameraId_idx"
  ON "RetentionUpgradeRequest"("cameraId");
CREATE INDEX "RetentionUpgradeRequest_clienteFinalId_idx"
  ON "RetentionUpgradeRequest"("clienteFinalId");
CREATE INDEX "RetentionUpgradeRequest_status_requestedAt_idx"
  ON "RetentionUpgradeRequest"("status", "requestedAt");

-- 5) FKs em Camera e ClienteFinal (atribuição em cascata)
ALTER TABLE "Camera"
  ADD COLUMN "retentionPlanId" TEXT,
  ADD CONSTRAINT "Camera_retentionPlanId_fkey"
    FOREIGN KEY ("retentionPlanId") REFERENCES "RetentionPlan"("id") ON DELETE SET NULL;

ALTER TABLE "ClienteFinal"
  ADD COLUMN "retentionPlanDefaultId" TEXT,
  ADD CONSTRAINT "ClienteFinal_retentionPlanDefaultId_fkey"
    FOREIGN KEY ("retentionPlanDefaultId") REFERENCES "RetentionPlan"("id") ON DELETE SET NULL;
