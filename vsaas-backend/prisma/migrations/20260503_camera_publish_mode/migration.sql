-- Camera.publishMode: política de SRT publish para Box → MediaMTX
DO $$ BEGIN
  CREATE TYPE "CameraPublishMode" AS ENUM ('AUTO', 'ALWAYS', 'ON_DEMAND', 'SUB_ONLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Camera"
  ADD COLUMN IF NOT EXISTS "publishMode" "CameraPublishMode" NOT NULL DEFAULT 'AUTO';
