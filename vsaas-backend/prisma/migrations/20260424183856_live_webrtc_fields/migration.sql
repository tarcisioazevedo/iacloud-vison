-- CreateEnum
CREATE TYPE "LiveMode" AS ENUM ('AUTO', 'WHEP_ONLY', 'MJPEG_ONLY', 'DISABLED');

-- AlterTable
ALTER TABLE "Camera" ADD COLUMN     "go2rtcStreamId" TEXT,
ADD COLUMN     "liveMode" "LiveMode" NOT NULL DEFAULT 'AUTO';

-- AlterTable
ALTER TABLE "EdgeNode" ADD COLUMN     "go2rtcAuth" TEXT,
ADD COLUMN     "go2rtcEndpoint" TEXT,
ADD COLUMN     "webrtcPublicHost" TEXT;
