-- CreateEnum
CREATE TYPE "LeadKind" AS ENUM ('INTEGRADOR', 'CLIENTE_FINAL');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'DEMO_SENT', 'CONVERTED', 'LOST');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "kind" "LeadKind" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "contactRole" TEXT,
    "companyName" TEXT,
    "companyTradeName" TEXT,
    "cnpj" TEXT,
    "city" TEXT,
    "state" TEXT,
    "alarmCentral" TEXT,
    "cameraVolume" TEXT,
    "projectStage" TEXT,
    "message" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'login_cta',
    "assignedToUserId" TEXT,
    "contactedAt" TIMESTAMP(3),
    "demoSentAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "convertedIntegradorId" TEXT,
    "convertedClienteFinalId" TEXT,
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_kind_status_idx" ON "Lead"("kind", "status");

-- CreateIndex
CREATE INDEX "Lead_cnpj_idx" ON "Lead"("cnpj");

-- CreateIndex
CREATE INDEX "Lead_contactEmail_idx" ON "Lead"("contactEmail");

-- RenameIndex
ALTER INDEX "AnalyticsEvent_camera_idempotency" RENAME TO "AnalyticsEvent_cameraId_idempotencyKey_key";

-- RenameIndex
ALTER INDEX "Camera_siteId_name_unique" RENAME TO "Camera_siteId_name_key";
