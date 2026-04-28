-- CreateEnum
CREATE TYPE "SemanticTriggerSourceType" AS ENUM ('IMAGE', 'TEXT', 'THUMBNAIL_REF');

-- CreateEnum
CREATE TYPE "SemanticTriggerActionType" AS ENUM ('WEBHOOK', 'NOTIFY', 'RECORD', 'SIREN', 'REVIEW_FLAG');

-- AlterTable
ALTER TABLE "Camera" ADD COLUMN     "cleanSnapshotEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notificationCooldownSec" INTEGER DEFAULT 60;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "superAdminId" TEXT,
    "integradorId" TEXT,
    "userId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "authKey" TEXT NOT NULL,
    "userAgent" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMsg" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticTrigger" (
    "id" TEXT NOT NULL,
    "clienteFinalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cameraIdsJson" JSONB,
    "sourceType" "SemanticTriggerSourceType" NOT NULL,
    "sourceImageUrl" TEXT,
    "sourceText" TEXT,
    "embeddingProvider" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingVector" JSONB NOT NULL,
    "embeddingDim" INTEGER NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.78,
    "cooldownSec" INTEGER NOT NULL DEFAULT 120,
    "actionsJson" JSONB NOT NULL,
    "scheduleJson" JSONB,
    "hitsCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "SemanticTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticTriggerHit" (
    "id" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "reviewItemId" TEXT,
    "semanticEmbeddingId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "snapshotKey" TEXT,
    "actionsRunJson" JSONB,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SemanticTriggerHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushSubscription_superAdminId_idx" ON "PushSubscription"("superAdminId");

-- CreateIndex
CREATE INDEX "PushSubscription_integradorId_idx" ON "PushSubscription"("integradorId");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "PushSubscription_active_idx" ON "PushSubscription"("active");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_p256dh_key" ON "PushSubscription"("p256dh");

-- CreateIndex
CREATE INDEX "SemanticTrigger_clienteFinalId_enabled_idx" ON "SemanticTrigger"("clienteFinalId", "enabled");

-- CreateIndex
CREATE INDEX "SemanticTrigger_enabled_lastHitAt_idx" ON "SemanticTrigger"("enabled", "lastHitAt");

-- CreateIndex
CREATE INDEX "SemanticTriggerHit_triggerId_capturedAt_idx" ON "SemanticTriggerHit"("triggerId", "capturedAt");

-- CreateIndex
CREATE INDEX "SemanticTriggerHit_cameraId_capturedAt_idx" ON "SemanticTriggerHit"("cameraId", "capturedAt");

-- AddForeignKey
ALTER TABLE "SemanticTriggerHit" ADD CONSTRAINT "SemanticTriggerHit_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "SemanticTrigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
