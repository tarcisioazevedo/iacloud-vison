-- 1. Drop foreign keys referencing RecordingSegment
ALTER TABLE "Bookmark" DROP CONSTRAINT "Bookmark_segmentId_fkey";
ALTER TABLE "DetectionFrame" DROP CONSTRAINT "DetectionFrame_segmentId_fkey";

-- 2. Add segmentStartedAt to those tables
ALTER TABLE "Bookmark" ADD COLUMN "segmentStartedAt" TIMESTAMP(3);
ALTER TABLE "DetectionFrame" ADD COLUMN "segmentStartedAt" TIMESTAMP(3);

-- 3. Create the new partitioned table with a temporary name
CREATE TABLE "RecordingSegment_new" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "codec" TEXT NOT NULL DEFAULT 'h264',
    "width" INTEGER,
    "height" INTEGER,
    "fps" INTEGER,
    "hasMotion" BOOLEAN NOT NULL DEFAULT false,
    "hasEvent" BOOLEAN NOT NULL DEFAULT false,
    "spriteUrl" TEXT,
    "deleteAfterReviewAt" TIMESTAMP(3),
    "storageTier" "StorageTier" NOT NULL DEFAULT 'HOT',
    "uploadStatus" "RecordingUploadStatus" NOT NULL DEFAULT 'PENDING',
    "uploadAttempts" INTEGER NOT NULL DEFAULT 0,
    "uploadError" TEXT,
    "uploadBucket" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
) PARTITION BY RANGE ("startedAt");

-- 4. Create initial partitions
CREATE TABLE "RecordingSegment_y2026m04" PARTITION OF "RecordingSegment_new" FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE "RecordingSegment_y2026m05" PARTITION OF "RecordingSegment_new" FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE "RecordingSegment_y2026m06" PARTITION OF "RecordingSegment_new" FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE "RecordingSegment_y2026m07" PARTITION OF "RecordingSegment_new" FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "RecordingSegment_y2026m08" PARTITION OF "RecordingSegment_new" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- 5. Move existing data to the new partitioned table
INSERT INTO "RecordingSegment_new" SELECT * FROM "RecordingSegment";

-- 6. Drop the old table (This deletes all old indexes, constraints, and the table itself)
DROP TABLE "RecordingSegment";

-- 7. Rename the new table to the original name
ALTER TABLE "RecordingSegment_new" RENAME TO "RecordingSegment";

-- 8. Add Primary Key to the partitioned table
ALTER TABLE "RecordingSegment" ADD CONSTRAINT "RecordingSegment_pkey" PRIMARY KEY ("id", "startedAt");

-- 9. Create necessary indexes exactly as Prisma expects them
CREATE UNIQUE INDEX "uq_segment_camera_started" ON "RecordingSegment"("cameraId", "startedAt");
CREATE INDEX "RecordingSegment_cameraId_startedAt_idx" ON "RecordingSegment"("cameraId", "startedAt");
CREATE INDEX "RecordingSegment_endedAt_idx" ON "RecordingSegment"("endedAt");
CREATE INDEX "RecordingSegment_cameraId_hasMotion_startedAt_idx" ON "RecordingSegment"("cameraId", "hasMotion", "startedAt");
CREATE INDEX "RecordingSegment_camera_started_ended_idx" ON "RecordingSegment"("cameraId", "startedAt", "endedAt");
CREATE INDEX "RecordingSegment_uploadStatus_uploadAttempts_idx" ON "RecordingSegment"("uploadStatus", "uploadAttempts");
CREATE INDEX "RecordingSegment_deleteAfterReviewAt_idx" ON "RecordingSegment"("deleteAfterReviewAt");
CREATE INDEX "RecordingSegment_storageTier_endedAt_idx" ON "RecordingSegment"("storageTier", "endedAt");

-- 10. Add foreign keys back with the new composite key
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_segmentId_segmentStartedAt_fkey" FOREIGN KEY ("segmentId", "segmentStartedAt") REFERENCES "RecordingSegment"("id", "startedAt") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DetectionFrame" ADD CONSTRAINT "DetectionFrame_segmentId_segmentStartedAt_fkey" FOREIGN KEY ("segmentId", "segmentStartedAt") REFERENCES "RecordingSegment"("id", "startedAt") ON DELETE SET NULL ON UPDATE CASCADE;
