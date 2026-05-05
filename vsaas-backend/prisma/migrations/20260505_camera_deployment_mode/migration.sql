-- Onda 1.A: Camera.deploymentMode (EDGE_BOX | CLOUD_DIRECT)
-- Suporta câmera avulsa cloud-direct (sem edge box no site)
-- Default: EDGE_BOX (mantém comportamento atual de todas as câmeras existentes)

CREATE TYPE "CameraDeploymentMode" AS ENUM ('EDGE_BOX', 'CLOUD_DIRECT');

ALTER TABLE "Camera"
  ADD COLUMN "deploymentMode" "CameraDeploymentMode" NOT NULL DEFAULT 'EDGE_BOX';

CREATE INDEX "Camera_siteId_deploymentMode_idx" ON "Camera"("siteId", "deploymentMode");
