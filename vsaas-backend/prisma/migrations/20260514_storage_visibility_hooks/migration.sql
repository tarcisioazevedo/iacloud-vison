-- Sprint 1 — Storage Visibility hooks
-- Adiciona campos de timestamping para o event consumer + reconciliation cron,
-- e os 3 hooks decididos (criticality, customDomain, cancelamento) para evitar
-- migrations futuras quando os recursos correspondentes forem implementados.

-- 1) StorageBucket: timestamps de telemetria do event consumer + reconciliation
ALTER TABLE "StorageBucket"
  ADD COLUMN "lastEventTime"   TIMESTAMP(3),
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

-- 2) Integrador: hook white-label (custom domain por integrador)
ALTER TABLE "Integrador" ADD COLUMN "customDomain" TEXT;

-- 3) ClienteFinal: hooks de cancelamento (LGPD 30d de graça)
ALTER TABLE "ClienteFinal"
  ADD COLUMN "canceledAt"        TIMESTAMP(3),
  ADD COLUMN "cancelGraceUntil" TIMESTAMP(3);

-- 4) CameraCriticality enum + Camera.criticality (hook DR seletivo)
CREATE TYPE "CameraCriticality" AS ENUM ('STANDARD', 'EVIDENCE', 'MISSION_CRITICAL');
ALTER TABLE "Camera"
  ADD COLUMN "criticality" "CameraCriticality" NOT NULL DEFAULT 'STANDARD';
