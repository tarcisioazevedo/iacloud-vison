-- =============================================================================
-- DetectionEvent + ReviewSegment — port do schema do Frigate
-- Reaproveita o enum ReviewSeverity existente (ALERT|DETECTION|SIGNIFICANT).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "ReviewSegment" (
  "id"           text PRIMARY KEY,
  "cameraId"    text NOT NULL,
  "severity"    "ReviewSeverity" NOT NULL,
  "startTime"   timestamp(3) NOT NULL,
  "endTime"     timestamp(3),
  "labels"      text[] NOT NULL DEFAULT ARRAY[]::text[],
  "zones"       text[] NOT NULL DEFAULT ARRAY[]::text[],
  "thumbnailKey" text,
  "fullFrameKey" text,
  "reviewed"    boolean NOT NULL DEFAULT false,
  "reviewedAt"  timestamp(3),
  "reviewedBy"  text,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewSegment_cameraId_fkey"
    FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ReviewSegment_cameraId_startTime_idx"
  ON "ReviewSegment" ("cameraId", "startTime" DESC);
CREATE INDEX IF NOT EXISTS "ReviewSegment_cameraId_severity_reviewed_startTime_idx"
  ON "ReviewSegment" ("cameraId", "severity", "reviewed", "startTime" DESC);


CREATE TABLE IF NOT EXISTS "DetectionEvent" (
  "id"             text PRIMARY KEY,
  "cameraId"       text NOT NULL,
  "trackId"        text NOT NULL,
  "objectType"     text NOT NULL,
  "subLabel"       text,
  "subLabelScore"  double precision,

  "startTime"      timestamp(3) NOT NULL,
  "endTime"        timestamp(3),
  "durationSec"    double precision,

  "frameCount"     integer NOT NULL,
  "topScore"       double precision NOT NULL,
  "medianScore"    double precision NOT NULL,

  "bestFrameIdx"   integer NOT NULL,
  "bestBboxX"      double precision NOT NULL,
  "bestBboxY"      double precision NOT NULL,
  "bestBboxW"      double precision NOT NULL,
  "bestBboxH"      double precision NOT NULL,

  "pathData"       jsonb,
  "enteredZones"   text[] NOT NULL DEFAULT ARRAY[]::text[],

  "thumbnailKey"   text,
  "cleanThumbKey"  text,
  "hasClip"        boolean NOT NULL DEFAULT false,
  "clipM3u8Url"    text,

  "attributes"     jsonb,
  "averageSpeed"   double precision,
  "velocityAngle"  double precision,

  "modelHash"      text,
  "modelType"      text,
  "detectorType"   text,

  "confirmed"      boolean NOT NULL DEFAULT true,
  "falsePositive"  boolean NOT NULL DEFAULT false,
  "reviewSegmentId" text,

  "createdAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DetectionEvent_cameraId_fkey"
    FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE,
  CONSTRAINT "DetectionEvent_reviewSegmentId_fkey"
    FOREIGN KEY ("reviewSegmentId") REFERENCES "ReviewSegment"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "DetectionEvent_cameraId_startTime_idx"
  ON "DetectionEvent" ("cameraId", "startTime" DESC);
CREATE INDEX IF NOT EXISTS "DetectionEvent_cameraId_objectType_startTime_idx"
  ON "DetectionEvent" ("cameraId", "objectType", "startTime" DESC);
CREATE INDEX IF NOT EXISTS "DetectionEvent_reviewSegmentId_idx"
  ON "DetectionEvent" ("reviewSegmentId");
CREATE INDEX IF NOT EXISTS "DetectionEvent_trackId_idx"
  ON "DetectionEvent" ("trackId");
