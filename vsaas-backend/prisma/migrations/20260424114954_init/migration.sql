-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'CLIENTE_ADMIN', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER');

-- CreateEnum
CREATE TYPE "MarketVertical" AS ENUM ('RETAIL', 'SHOPPING_MALL', 'CONDOMINIUM', 'INDUSTRIAL', 'OFFICE', 'ENTERPRISE', 'SCHOOL', 'HEALTHCARE', 'HOSPITALITY', 'LOGISTICS', 'PARKING', 'BANK', 'OTHER');

-- CreateEnum
CREATE TYPE "CameraTier" AS ENUM ('STATIC_VISION', 'STREAMING_ANALYTICS');

-- CreateEnum
CREATE TYPE "PipelineType" AS ENUM ('EDGE_HYBRID', 'VERTEX_STREAMING');

-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('COUNTING_LINE', 'POLYGON_ZONE', 'HEAT_MAP', 'PPE_CHECK', 'QUEUE_MONITOR', 'DWELL_TIME', 'PARKING_SPOT', 'RESTRICTED_AREA', 'CHECKOUT_LINE', 'DISPLAY_ZONE');

-- CreateEnum
CREATE TYPE "AnalyticsModel" AS ENUM ('FACE_ANNOTATION', 'LABEL_DETECTION', 'LOGO_DETECTION', 'OBJECT_LOCALIZATION', 'SAFE_SEARCH', 'OCCUPANCY_ANALYTICS', 'PPE_DETECTION', 'PEOPLE_COUNTING', 'VEHICLE_DETECTION', 'CROWD_DENSITY', 'QUEUE_LENGTH');

-- CreateEnum
CREATE TYPE "EdgeNodeStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE', 'PROVISIONING');

-- CreateEnum
CREATE TYPE "CameraStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR', 'MAINTENANCE', 'PENDING_CONFIG');

-- CreateEnum
CREATE TYPE "EventSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "QuotaBlockPolicy" AS ENUM ('HARD_BLOCK', 'SOFT_WARN', 'AUTO_UPGRADE');

-- CreateTable
CREATE TABLE "SuperAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integrador" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tradeName" TEXT,
    "cnpj" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "gcpProjectId" TEXT,
    "gcpServiceAccountJson" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integrador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClienteFinal" (
    "id" TEXT NOT NULL,
    "integradorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tradeName" TEXT,
    "cnpj" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "vertical" "MarketVertical" NOT NULL,
    "logoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "notifyEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClienteFinal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "integradorId" TEXT,
    "clienteFinalId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "clienteFinalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EdgeNode" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "model" TEXT,
    "accelerator" TEXT,
    "ipLocal" TEXT,
    "macAddress" TEXT,
    "apiToken" TEXT NOT NULL,
    "status" "EdgeNodeStatus" NOT NULL DEFAULT 'PROVISIONING',
    "lastHeartbeat" TIMESTAMP(3),
    "firmwareVersion" TEXT,
    "yoloModelVersion" TEXT,
    "cpuUsage" DOUBLE PRECISION,
    "memUsage" DOUBLE PRECISION,
    "diskUsage" DOUBLE PRECISION,
    "tempCelsius" DOUBLE PRECISION,
    "uptimeSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EdgeNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EdgeHeartbeat" (
    "id" TEXT NOT NULL,
    "edgeNodeId" TEXT NOT NULL,
    "cpuUsage" DOUBLE PRECISION NOT NULL,
    "memUsage" DOUBLE PRECISION NOT NULL,
    "diskUsage" DOUBLE PRECISION NOT NULL,
    "tempCelsius" DOUBLE PRECISION,
    "networkInBps" DOUBLE PRECISION,
    "networkOutBps" DOUBLE PRECISION,
    "fpsCurrent" DOUBLE PRECISION,
    "apiCallsSent" INTEGER,
    "framesSkipped" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EdgeHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "edgeNodeId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "rtspMainUrl" TEXT NOT NULL,
    "rtspSubUrl" TEXT,
    "rtmpPushUrl" TEXT,
    "status" "CameraStatus" NOT NULL DEFAULT 'PENDING_CONFIG',
    "tier" "CameraTier" NOT NULL,
    "pipeline" "PipelineType" NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "resolution" TEXT,
    "fps" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "vertexStreamId" TEXT,
    "vertexAppId" TEXT,
    "vertexProcessId" TEXT,
    "bqDatasetId" TEXT,
    "bqTableId" TEXT,
    "visionWarehouseId" TEXT,
    "lastSnapshotUrl" TEXT,
    "lastSnapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraZone" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ZoneType" NOT NULL,
    "coordinates" JSONB NOT NULL,
    "direction" TEXT,
    "alertOnViolation" BOOLEAN NOT NULL DEFAULT false,
    "maxOccupancy" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CameraZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraModel" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "model" "AnalyticsModel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraSubscription" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "tier" "CameraTier" NOT NULL,
    "monthlyApiLimit" INTEGER,
    "monthlyStreamHoursLimit" DOUBLE PRECISION,
    "priceMonthlyBrl" DECIMAL(10,2) NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "renewDate" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CameraSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiQuota" (
    "id" TEXT NOT NULL,
    "integradorId" TEXT NOT NULL,
    "staticVisionMonthlyLimit" INTEGER NOT NULL DEFAULT 50000,
    "staticVisionUsedThisMonth" INTEGER NOT NULL DEFAULT 0,
    "streamingMinutesLimit" DOUBLE PRECISION NOT NULL DEFAULT 6000,
    "streamingMinutesUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blockPolicy" "QuotaBlockPolicy" NOT NULL DEFAULT 'HARD_BLOCK',
    "warningThreshold" INTEGER NOT NULL DEFAULT 80,
    "hardLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsageLog" (
    "id" TEXT NOT NULL,
    "integradorId" TEXT NOT NULL,
    "cameraId" TEXT,
    "edgeNodeId" TEXT,
    "visionApiCalls" INTEGER NOT NULL DEFAULT 0,
    "visionFeaturesJson" JSONB,
    "visionCostUsd" DECIMAL(12,6),
    "vertexStreamMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vertexCostUsd" DECIMAL(12,6),
    "gcsObjectsStored" INTEGER NOT NULL DEFAULT 0,
    "gcsSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "gcsCostUsd" DECIMAL(12,6),
    "framesSkipped" INTEGER NOT NULL DEFAULT 0,
    "framesUploaded" INTEGER NOT NULL DEFAULT 0,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "integradorId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalCamerasStatic" INTEGER NOT NULL DEFAULT 0,
    "totalCamerasStreaming" INTEGER NOT NULL DEFAULT 0,
    "visionApiCalls" INTEGER NOT NULL DEFAULT 0,
    "vertexStreamMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gcsTotalGb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmountBrl" DECIMAL(10,2) NOT NULL,
    "gcpCostUsd" DECIMAL(10,4) NOT NULL,
    "marginPercent" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "zoneId" TEXT,
    "model" "AnalyticsModel" NOT NULL,
    "pipeline" "PipelineType" NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" "EventSeverity" NOT NULL DEFAULT 'INFO',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dwellTimeSec" DOUBLE PRECISION,
    "ageRange" TEXT,
    "gender" TEXT,
    "emotionJoy" DOUBLE PRECISION,
    "emotionSorrow" DOUBLE PRECISION,
    "emotionAnger" DOUBLE PRECISION,
    "emotionSurprise" DOUBLE PRECISION,
    "emotionNeutral" DOUBLE PRECISION,
    "dominantEmotion" TEXT,
    "hasHat" BOOLEAN,
    "hasGlasses" BOOLEAN,
    "hasFaceMask" BOOLEAN,
    "headwearScore" DOUBLE PRECISION,
    "labelsJson" JSONB,
    "logosJson" JSONB,
    "personCount" INTEGER,
    "vehicleCount" INTEGER,
    "ppeCompliant" BOOLEAN,
    "ppeMissingJson" JSONB,
    "occupancyCount" INTEGER,
    "avgDwellSec" DOUBLE PRECISION,
    "detectedObjectsJson" JSONB,
    "evidenceGcsBucket" TEXT,
    "evidenceGcsKey" TEXT,
    "evidenceExpiry" TIMESTAMP(3),
    "bqSyncedAt" TIMESTAMP(3),
    "bqInsertId" TEXT,
    "rawAnnotationsJson" JSONB,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeatmapSnapshot" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "zoneId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "gridData" JSONB NOT NULL,
    "maxDensity" DOUBLE PRECISION NOT NULL,
    "minDensity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeatmapSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeopleCounting" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "zoneId" TEXT,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "exitCount" INTEGER NOT NULL DEFAULT 0,
    "netFlow" INTEGER NOT NULL DEFAULT 0,
    "peakCount" INTEGER,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeopleCounting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "superAdminId" TEXT,
    "integradorId" TEXT,
    "clienteFinalId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadataJson" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LgpdDataRequest" (
    "id" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "requestorEmail" TEXT NOT NULL,
    "clienteFinalId" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "responseNotes" TEXT,
    "handledBy" TEXT,

    CONSTRAINT "LgpdDataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRetentionPolicy" (
    "id" TEXT NOT NULL,
    "integradorId" TEXT,
    "gcsBucket" TEXT NOT NULL,
    "ttlHours" INTEGER NOT NULL DEFAULT 72,
    "lifecycleRule" JSONB NOT NULL,
    "lastAppliedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_email_key" ON "SuperAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Integrador_cnpj_key" ON "Integrador"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Integrador_email_key" ON "Integrador"("email");

-- CreateIndex
CREATE INDEX "Integrador_gcpProjectId_idx" ON "Integrador"("gcpProjectId");

-- CreateIndex
CREATE INDEX "ClienteFinal_integradorId_idx" ON "ClienteFinal"("integradorId");

-- CreateIndex
CREATE INDEX "ClienteFinal_vertical_idx" ON "ClienteFinal"("vertical");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_integradorId_idx" ON "User"("integradorId");

-- CreateIndex
CREATE INDEX "User_clienteFinalId_idx" ON "User"("clienteFinalId");

-- CreateIndex
CREATE INDEX "Site_clienteFinalId_idx" ON "Site"("clienteFinalId");

-- CreateIndex
CREATE UNIQUE INDEX "EdgeNode_serialNumber_key" ON "EdgeNode"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EdgeNode_macAddress_key" ON "EdgeNode"("macAddress");

-- CreateIndex
CREATE UNIQUE INDEX "EdgeNode_apiToken_key" ON "EdgeNode"("apiToken");

-- CreateIndex
CREATE INDEX "EdgeNode_siteId_idx" ON "EdgeNode"("siteId");

-- CreateIndex
CREATE INDEX "EdgeNode_status_idx" ON "EdgeNode"("status");

-- CreateIndex
CREATE INDEX "EdgeHeartbeat_edgeNodeId_recordedAt_idx" ON "EdgeHeartbeat"("edgeNodeId", "recordedAt");

-- CreateIndex
CREATE INDEX "Camera_siteId_idx" ON "Camera"("siteId");

-- CreateIndex
CREATE INDEX "Camera_edgeNodeId_idx" ON "Camera"("edgeNodeId");

-- CreateIndex
CREATE INDEX "Camera_tier_pipeline_idx" ON "Camera"("tier", "pipeline");

-- CreateIndex
CREATE INDEX "Camera_status_idx" ON "Camera"("status");

-- CreateIndex
CREATE INDEX "CameraZone_cameraId_idx" ON "CameraZone"("cameraId");

-- CreateIndex
CREATE INDEX "CameraModel_cameraId_idx" ON "CameraModel"("cameraId");

-- CreateIndex
CREATE UNIQUE INDEX "CameraModel_cameraId_model_key" ON "CameraModel"("cameraId", "model");

-- CreateIndex
CREATE UNIQUE INDEX "CameraSubscription_cameraId_key" ON "CameraSubscription"("cameraId");

-- CreateIndex
CREATE INDEX "ApiQuota_integradorId_idx" ON "ApiQuota"("integradorId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiQuota_integradorId_periodStart_key" ON "ApiQuota"("integradorId", "periodStart");

-- CreateIndex
CREATE INDEX "ApiUsageLog_integradorId_periodDate_idx" ON "ApiUsageLog"("integradorId", "periodDate");

-- CreateIndex
CREATE INDEX "ApiUsageLog_cameraId_recordedAt_idx" ON "ApiUsageLog"("cameraId", "recordedAt");

-- CreateIndex
CREATE INDEX "ApiUsageLog_edgeNodeId_recordedAt_idx" ON "ApiUsageLog"("edgeNodeId", "recordedAt");

-- CreateIndex
CREATE INDEX "Invoice_integradorId_periodStart_idx" ON "Invoice"("integradorId", "periodStart");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_cameraId_capturedAt_idx" ON "AnalyticsEvent"("cameraId", "capturedAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_zoneId_capturedAt_idx" ON "AnalyticsEvent"("zoneId", "capturedAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_model_capturedAt_idx" ON "AnalyticsEvent"("model", "capturedAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventType_capturedAt_idx" ON "AnalyticsEvent"("eventType", "capturedAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_evidenceExpiry_idx" ON "AnalyticsEvent"("evidenceExpiry");

-- CreateIndex
CREATE INDEX "HeatmapSnapshot_cameraId_date_period_idx" ON "HeatmapSnapshot"("cameraId", "date", "period");

-- CreateIndex
CREATE INDEX "PeopleCounting_cameraId_windowStart_granularity_idx" ON "PeopleCounting"("cameraId", "windowStart", "granularity");

-- CreateIndex
CREATE INDEX "PeopleCounting_zoneId_windowStart_idx" ON "PeopleCounting"("zoneId", "windowStart");

-- CreateIndex
CREATE INDEX "AuditLog_integradorId_createdAt_idx" ON "AuditLog"("integradorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_clienteFinalId_createdAt_idx" ON "AuditLog"("clienteFinalId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_idx" ON "AuditLog"("resource", "resourceId");

-- AddForeignKey
ALTER TABLE "ClienteFinal" ADD CONSTRAINT "ClienteFinal_integradorId_fkey" FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_integradorId_fkey" FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clienteFinalId_fkey" FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_clienteFinalId_fkey" FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeNode" ADD CONSTRAINT "EdgeNode_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeHeartbeat" ADD CONSTRAINT "EdgeHeartbeat_edgeNodeId_fkey" FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_edgeNodeId_fkey" FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraZone" ADD CONSTRAINT "CameraZone_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraModel" ADD CONSTRAINT "CameraModel_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraSubscription" ADD CONSTRAINT "CameraSubscription_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiQuota" ADD CONSTRAINT "ApiQuota_integradorId_fkey" FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiUsageLog" ADD CONSTRAINT "ApiUsageLog_integradorId_fkey" FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiUsageLog" ADD CONSTRAINT "ApiUsageLog_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiUsageLog" ADD CONSTRAINT "ApiUsageLog_edgeNodeId_fkey" FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_integradorId_fkey" FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "CameraZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatmapSnapshot" ADD CONSTRAINT "HeatmapSnapshot_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeopleCounting" ADD CONSTRAINT "PeopleCounting_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeopleCounting" ADD CONSTRAINT "PeopleCounting_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "CameraZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_integradorId_fkey" FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clienteFinalId_fkey" FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
