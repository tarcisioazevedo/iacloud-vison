-- Migration: 20260502230000_floor_plans
-- Mapa Sinótico: tabelas FloorPlan e FloorPlanCamera

CREATE TABLE "FloorPlan" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "siteId"      TEXT,
  "name"        TEXT NOT NULL,
  "imageUrl"    TEXT NOT NULL,
  "imageWidth"  INTEGER,
  "imageHeight" INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FloorPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FloorPlanCamera" (
  "id"          TEXT NOT NULL,
  "floorPlanId" TEXT NOT NULL,
  "cameraId"    TEXT NOT NULL,
  "xPct"        DOUBLE PRECISION NOT NULL,
  "yPct"        DOUBLE PRECISION NOT NULL,
  "label"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FloorPlanCamera_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FloorPlan"
  ADD CONSTRAINT "FloorPlan_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FloorPlanCamera"
  ADD CONSTRAINT "FloorPlanCamera_floorPlanId_fkey"
  FOREIGN KEY ("floorPlanId") REFERENCES "FloorPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FloorPlanCamera"
  ADD CONSTRAINT "FloorPlanCamera_cameraId_fkey"
  FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "FloorPlanCamera_floorPlanId_cameraId_key"
  ON "FloorPlanCamera"("floorPlanId", "cameraId");

CREATE INDEX "FloorPlan_tenantId_idx" ON "FloorPlan"("tenantId");
CREATE INDEX "FloorPlan_siteId_idx"   ON "FloorPlan"("siteId");
CREATE INDEX "FloorPlanCamera_floorPlanId_idx" ON "FloorPlanCamera"("floorPlanId");
CREATE INDEX "FloorPlanCamera_cameraId_idx"    ON "FloorPlanCamera"("cameraId");
