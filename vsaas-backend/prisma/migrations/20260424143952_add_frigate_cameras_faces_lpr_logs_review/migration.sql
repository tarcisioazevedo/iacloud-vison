-- CreateEnum
CREATE TYPE "CameraLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- CreateEnum
CREATE TYPE "CameraLogSource" AS ENUM ('FFMPEG', 'DETECTOR', 'MOTION', 'RECORDER', 'SNAPSHOT', 'ZONE', 'ONVIF', 'PTZ', 'AUDIO', 'FACE', 'LPR', 'GENAI', 'SEMANTIC', 'SYSTEM', 'EDGE_AGENT', 'VERTEX', 'CLOUD_VISION', 'GCS', 'AUTH', 'API');

-- CreateEnum
CREATE TYPE "ReviewSeverity" AS ENUM ('ALERT', 'DETECTION', 'SIGNIFICANT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FaceMatchStatus" AS ENUM ('MATCHED', 'UNKNOWN', 'LOW_CONFIDENCE', 'MULTIPLE_MATCHES');

-- CreateEnum
CREATE TYPE "PlateCategory" AS ENUM ('AUTHORIZED', 'VIP', 'FLEET', 'SERVICE', 'BLACKLIST', 'VISITOR');

-- CreateEnum
CREATE TYPE "FfmpegHwAccel" AS ENUM ('NONE', 'VAAPI', 'NVIDIA_NVDEC', 'INTEL_QSV_H264', 'INTEL_QSV_H265', 'RPI_V4L2_H264', 'RPI_V4L2_H265', 'ROCKCHIP_RKMPP', 'AMD_ROCM');

-- CreateEnum
CREATE TYPE "DetectorType" AS ENUM ('CPU', 'CORAL_USB', 'CORAL_PCI', 'OPENVINO_CPU', 'OPENVINO_GPU', 'TENSORRT', 'ONNX', 'HAILO8', 'HAILO8L', 'RKNN', 'ROCM', 'VERTEX_AI');

-- CreateEnum
CREATE TYPE "RecordingMode" AS ENUM ('ALL', 'MOTION', 'ACTIVE_OBJECTS', 'DISABLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AnalyticsModel" ADD VALUE 'FACE_RECOGNITION';
ALTER TYPE "AnalyticsModel" ADD VALUE 'LICENSE_PLATE_RECOGNITION';
ALTER TYPE "AnalyticsModel" ADD VALUE 'AUDIO_DETECTION';
ALTER TYPE "AnalyticsModel" ADD VALUE 'SEMANTIC_SEARCH';
ALTER TYPE "AnalyticsModel" ADD VALUE 'GENAI_DESCRIPTION';
ALTER TYPE "AnalyticsModel" ADD VALUE 'MOTION_DETECTION';
ALTER TYPE "AnalyticsModel" ADD VALUE 'OBJECT_TRACKING';
ALTER TYPE "AnalyticsModel" ADD VALUE 'BIRDSEYE_VIEW';
ALTER TYPE "AnalyticsModel" ADD VALUE 'PTZ_AUTOTRACKING';

-- DropForeignKey
ALTER TABLE "CameraZone" DROP CONSTRAINT "CameraZone_cameraId_fkey";

-- AlterTable
ALTER TABLE "Camera" ADD COLUMN     "audioEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "audioFiltersJson" JSONB,
ADD COLUMN     "audioListenJson" JSONB,
ADD COLUMN     "audioMaxNotHeard" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "audioMinVolume" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "birdseyeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "birdseyeMode" TEXT NOT NULL DEFAULT 'objects',
ADD COLUMN     "birdseyeOrder" INTEGER,
ADD COLUMN     "codec" TEXT,
ADD COLUMN     "detectStationaryInterval" INTEGER DEFAULT 50,
ADD COLUMN     "detectStationaryThreshold" INTEGER DEFAULT 50,
ADD COLUMN     "detectorEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "detectorFps" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "detectorHeight" INTEGER NOT NULL DEFAULT 720,
ADD COLUMN     "detectorModelPath" TEXT,
ADD COLUMN     "detectorModelType" TEXT,
ADD COLUMN     "detectorType" "DetectorType" NOT NULL DEFAULT 'CPU',
ADD COLUMN     "detectorWidth" INTEGER NOT NULL DEFAULT 1280,
ADD COLUMN     "faceBlurFilter" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "faceDetectionThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.70,
ADD COLUMN     "faceMinCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "faceMinScore" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
ADD COLUMN     "faceRecognitionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "faceSaveAttempts" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "faceUnknownScore" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
ADD COLUMN     "ffmpegGlobalArgs" TEXT,
ADD COLUMN     "ffmpegInputArgs" TEXT,
ADD COLUMN     "ffmpegOutputArgs" TEXT,
ADD COLUMN     "firmwareVersion" TEXT,
ADD COLUMN     "genaiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "genaiModel" TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
ADD COLUMN     "genaiPromptGlobal" TEXT,
ADD COLUMN     "genaiPromptsByObjectJson" JSONB,
ADD COLUMN     "genaiProvider" TEXT NOT NULL DEFAULT 'gemini',
ADD COLUMN     "genaiUseSnapshot" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "healthScore" DOUBLE PRECISION,
ADD COLUMN     "hwAccel" "FfmpegHwAccel" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "lastOnlineAt" TIMESTAMP(3),
ADD COLUMN     "lprEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lprEnhancement" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lprFormatRegex" TEXT DEFAULT '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$',
ADD COLUMN     "lprMatchDistance" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lprMinArea" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "lprMinPlateLength" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "lprThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.70,
ADD COLUMN     "macAddress" TEXT,
ADD COLUMN     "motionContourArea" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "motionEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "motionFrameAlpha" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
ADD COLUMN     "motionImproveContrast" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "motionLightningThresh" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
ADD COLUMN     "motionMaskJson" JSONB,
ADD COLUMN     "motionThreshold" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "objectsFiltersJson" JSONB,
ADD COLUMN     "objectsTrackJson" JSONB,
ADD COLUMN     "onvifHost" TEXT,
ADD COLUMN     "onvifPasswordEnc" TEXT,
ADD COLUMN     "onvifPort" INTEGER DEFAULT 8000,
ADD COLUMN     "onvifUsername" TEXT,
ADD COLUMN     "ptzAutotrackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ptzEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ptzReturnPreset" TEXT,
ADD COLUMN     "ptzTimeoutSec" INTEGER DEFAULT 10,
ADD COLUMN     "ptzTrackObjectsJson" JSONB,
ADD COLUMN     "ptzZoomFactor" DOUBLE PRECISION DEFAULT 0.3,
ADD COLUMN     "recordAlertRetainDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "recordDetectionRetainDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "recordEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recordMode" "RecordingMode" NOT NULL DEFAULT 'MOTION',
ADD COLUMN     "recordPostCaptureSec" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "recordPreCaptureSec" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "recordRetainDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "reviewAlertLabelsJson" JSONB,
ADD COLUMN     "reviewDetectionLabelsJson" JSONB,
ADD COLUMN     "reviewRequiredZonesJson" JSONB,
ADD COLUMN     "rtspPasswordEnc" TEXT,
ADD COLUMN     "rtspUsername" TEXT,
ADD COLUMN     "semanticModelSize" TEXT NOT NULL DEFAULT 'small',
ADD COLUMN     "semanticReindex" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "semanticSearchEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serialNumber" TEXT,
ADD COLUMN     "snapshotBoundingBox" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "snapshotCrop" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "snapshotHeight" INTEGER NOT NULL DEFAULT 720,
ADD COLUMN     "snapshotQuality" INTEGER NOT NULL DEFAULT 85,
ADD COLUMN     "snapshotRetainDays" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "snapshotTimestamp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "snapshotsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "webrtcIceServers" JSONB;

-- AlterTable
ALTER TABLE "CameraZone" ADD COLUMN     "color" TEXT DEFAULT '#06b6d4',
ADD COLUMN     "distancesJson" JSONB,
ADD COLUMN     "filtersJson" JSONB,
ADD COLUMN     "inertia" INTEGER DEFAULT 3,
ADD COLUMN     "loiteringTimeSec" INTEGER DEFAULT 0,
ADD COLUMN     "objectsJson" JSONB,
ADD COLUMN     "requiredForAlert" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CameraLog" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "level" "CameraLogLevel" NOT NULL,
    "source" "CameraLogSource" NOT NULL,
    "message" TEXT NOT NULL,
    "detailsJson" JSONB,
    "correlationId" TEXT,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "stackTrace" TEXT,
    "eventId" TEXT,
    "zoneId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "level" "CameraLogLevel" NOT NULL,
    "source" "CameraLogSource" NOT NULL,
    "message" TEXT NOT NULL,
    "detailsJson" JSONB,
    "integradorId" TEXT,
    "clienteFinalId" TEXT,
    "siteId" TEXT,
    "edgeNodeId" TEXT,
    "userId" TEXT,
    "correlationId" TEXT,
    "requestId" TEXT,
    "method" TEXT,
    "path" TEXT,
    "statusCode" INTEGER,
    "durationMs" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "errorCode" TEXT,
    "stackTrace" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraStreamTest" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "stage" TEXT NOT NULL,
    "resolution" TEXT,
    "fps" DOUBLE PRECISION,
    "codec" TEXT,
    "bitrateKbps" INTEGER,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "rawOutput" TEXT,
    "testedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraStreamTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceIdentity" (
    "id" TEXT NOT NULL,
    "clienteFinalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "role" TEXT,
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "thumbnailUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "alertOnMatch" BOOLEAN NOT NULL DEFAULT false,
    "alertOnMissing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceEmbedding" (
    "id" TEXT NOT NULL,
    "faceIdentityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "vectorJson" JSONB NOT NULL,
    "vectorDim" INTEGER NOT NULL,
    "sourceImageUrl" TEXT,
    "quality" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceRecognitionEvent" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "faceIdentityId" TEXT,
    "status" "FaceMatchStatus" NOT NULL,
    "matchScore" DOUBLE PRECISION,
    "unknownScore" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bboxJson" JSONB,
    "cropGcsKey" TEXT,
    "frameGcsKey" TEXT,
    "gender" TEXT,
    "ageRange" TEXT,
    "emotion" TEXT,
    "quality" DOUBLE PRECISION,
    "pose" JSONB,
    "reviewItemId" TEXT,

    CONSTRAINT "FaceRecognitionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicensePlate" (
    "id" TEXT NOT NULL,
    "clienteFinalId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "label" TEXT,
    "category" "PlateCategory" NOT NULL DEFAULT 'AUTHORIZED',
    "vehicleModel" TEXT,
    "vehicleColor" TEXT,
    "vehicleType" TEXT,
    "ownerName" TEXT,
    "ownerDocument" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "alertOnMatch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicensePlate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicensePlateEvent" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "licensePlateId" TEXT,
    "detectedPlate" TEXT NOT NULL,
    "matchDistance" INTEGER,
    "ocrScore" DOUBLE PRECISION NOT NULL,
    "vehicleType" TEXT,
    "vehicleColor" TEXT,
    "direction" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bboxJson" JSONB,
    "cropGcsKey" TEXT,
    "frameGcsKey" TEXT,
    "reviewItemId" TEXT,

    CONSTRAINT "LicensePlateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioDetectionEvent" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "volumeDb" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER,
    "reviewItemId" TEXT,
    "clipGcsKey" TEXT,

    CONSTRAINT "AudioDetectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "severity" "ReviewSeverity" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "objectsJson" JSONB,
    "zonesJson" JSONB,
    "thumbnailGcsKey" TEXT,
    "clipGcsKey" TEXT,
    "genaiSummary" TEXT,
    "genaiProvider" TEXT,
    "genaiModel" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraAlertRule" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerType" TEXT NOT NULL,
    "conditionsJson" JSONB NOT NULL,
    "scheduleJson" JSONB,
    "cooldownSec" INTEGER DEFAULT 60,
    "severity" "ReviewSeverity" NOT NULL DEFAULT 'ALERT',
    "notifyEmail" TEXT,
    "notifyWebhookUrl" TEXT,
    "notifyPushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifyMqttTopic" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CameraAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticEmbedding" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "eventId" TEXT,
    "reviewItemId" TEXT,
    "thumbnailGcsKey" TEXT,
    "caption" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "vectorJson" JSONB NOT NULL,
    "vectorDim" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SemanticEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CameraLog_cameraId_recordedAt_idx" ON "CameraLog"("cameraId", "recordedAt");

-- CreateIndex
CREATE INDEX "CameraLog_level_recordedAt_idx" ON "CameraLog"("level", "recordedAt");

-- CreateIndex
CREATE INDEX "CameraLog_source_recordedAt_idx" ON "CameraLog"("source", "recordedAt");

-- CreateIndex
CREATE INDEX "CameraLog_errorCode_idx" ON "CameraLog"("errorCode");

-- CreateIndex
CREATE INDEX "SystemLog_level_recordedAt_idx" ON "SystemLog"("level", "recordedAt");

-- CreateIndex
CREATE INDEX "SystemLog_source_recordedAt_idx" ON "SystemLog"("source", "recordedAt");

-- CreateIndex
CREATE INDEX "SystemLog_integradorId_recordedAt_idx" ON "SystemLog"("integradorId", "recordedAt");

-- CreateIndex
CREATE INDEX "SystemLog_clienteFinalId_recordedAt_idx" ON "SystemLog"("clienteFinalId", "recordedAt");

-- CreateIndex
CREATE INDEX "SystemLog_errorCode_idx" ON "SystemLog"("errorCode");

-- CreateIndex
CREATE INDEX "SystemLog_correlationId_idx" ON "SystemLog"("correlationId");

-- CreateIndex
CREATE INDEX "CameraStreamTest_cameraId_testedAt_idx" ON "CameraStreamTest"("cameraId", "testedAt");

-- CreateIndex
CREATE INDEX "FaceIdentity_clienteFinalId_active_idx" ON "FaceIdentity"("clienteFinalId", "active");

-- CreateIndex
CREATE INDEX "FaceIdentity_externalId_idx" ON "FaceIdentity"("externalId");

-- CreateIndex
CREATE INDEX "FaceIdentity_role_idx" ON "FaceIdentity"("role");

-- CreateIndex
CREATE INDEX "FaceEmbedding_faceIdentityId_idx" ON "FaceEmbedding"("faceIdentityId");

-- CreateIndex
CREATE INDEX "FaceEmbedding_provider_modelVersion_idx" ON "FaceEmbedding"("provider", "modelVersion");

-- CreateIndex
CREATE INDEX "FaceRecognitionEvent_cameraId_capturedAt_idx" ON "FaceRecognitionEvent"("cameraId", "capturedAt");

-- CreateIndex
CREATE INDEX "FaceRecognitionEvent_faceIdentityId_capturedAt_idx" ON "FaceRecognitionEvent"("faceIdentityId", "capturedAt");

-- CreateIndex
CREATE INDEX "FaceRecognitionEvent_status_capturedAt_idx" ON "FaceRecognitionEvent"("status", "capturedAt");

-- CreateIndex
CREATE INDEX "LicensePlate_clienteFinalId_active_idx" ON "LicensePlate"("clienteFinalId", "active");

-- CreateIndex
CREATE INDEX "LicensePlate_category_idx" ON "LicensePlate"("category");

-- CreateIndex
CREATE INDEX "LicensePlate_plate_idx" ON "LicensePlate"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "LicensePlate_clienteFinalId_plate_key" ON "LicensePlate"("clienteFinalId", "plate");

-- CreateIndex
CREATE INDEX "LicensePlateEvent_cameraId_capturedAt_idx" ON "LicensePlateEvent"("cameraId", "capturedAt");

-- CreateIndex
CREATE INDEX "LicensePlateEvent_detectedPlate_idx" ON "LicensePlateEvent"("detectedPlate");

-- CreateIndex
CREATE INDEX "LicensePlateEvent_licensePlateId_capturedAt_idx" ON "LicensePlateEvent"("licensePlateId", "capturedAt");

-- CreateIndex
CREATE INDEX "AudioDetectionEvent_cameraId_capturedAt_idx" ON "AudioDetectionEvent"("cameraId", "capturedAt");

-- CreateIndex
CREATE INDEX "AudioDetectionEvent_label_capturedAt_idx" ON "AudioDetectionEvent"("label", "capturedAt");

-- CreateIndex
CREATE INDEX "ReviewItem_cameraId_startAt_idx" ON "ReviewItem"("cameraId", "startAt");

-- CreateIndex
CREATE INDEX "ReviewItem_status_startAt_idx" ON "ReviewItem"("status", "startAt");

-- CreateIndex
CREATE INDEX "ReviewItem_severity_startAt_idx" ON "ReviewItem"("severity", "startAt");

-- CreateIndex
CREATE INDEX "CameraAlertRule_cameraId_enabled_idx" ON "CameraAlertRule"("cameraId", "enabled");

-- CreateIndex
CREATE INDEX "CameraAlertRule_triggerType_idx" ON "CameraAlertRule"("triggerType");

-- CreateIndex
CREATE INDEX "SemanticEmbedding_cameraId_capturedAt_idx" ON "SemanticEmbedding"("cameraId", "capturedAt");

-- CreateIndex
CREATE INDEX "SemanticEmbedding_provider_modelVersion_idx" ON "SemanticEmbedding"("provider", "modelVersion");

-- CreateIndex
CREATE INDEX "Camera_active_status_idx" ON "Camera"("active", "status");

-- AddForeignKey
ALTER TABLE "CameraZone" ADD CONSTRAINT "CameraZone_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraLog" ADD CONSTRAINT "CameraLog_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraStreamTest" ADD CONSTRAINT "CameraStreamTest_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_faceIdentityId_fkey" FOREIGN KEY ("faceIdentityId") REFERENCES "FaceIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceRecognitionEvent" ADD CONSTRAINT "FaceRecognitionEvent_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceRecognitionEvent" ADD CONSTRAINT "FaceRecognitionEvent_faceIdentityId_fkey" FOREIGN KEY ("faceIdentityId") REFERENCES "FaceIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceRecognitionEvent" ADD CONSTRAINT "FaceRecognitionEvent_reviewItemId_fkey" FOREIGN KEY ("reviewItemId") REFERENCES "ReviewItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicensePlateEvent" ADD CONSTRAINT "LicensePlateEvent_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicensePlateEvent" ADD CONSTRAINT "LicensePlateEvent_licensePlateId_fkey" FOREIGN KEY ("licensePlateId") REFERENCES "LicensePlate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicensePlateEvent" ADD CONSTRAINT "LicensePlateEvent_reviewItemId_fkey" FOREIGN KEY ("reviewItemId") REFERENCES "ReviewItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioDetectionEvent" ADD CONSTRAINT "AudioDetectionEvent_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioDetectionEvent" ADD CONSTRAINT "AudioDetectionEvent_reviewItemId_fkey" FOREIGN KEY ("reviewItemId") REFERENCES "ReviewItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraAlertRule" ADD CONSTRAINT "CameraAlertRule_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticEmbedding" ADD CONSTRAINT "SemanticEmbedding_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
