-- Trial Flow — campos de trial no Integrador.
-- Cron diário (services/trial-expiration.service.ts) expira/notifica.

ALTER TABLE "Integrador"
  ADD COLUMN IF NOT EXISTS "trialEndsAt"             TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trialActivatedAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trialMaxCameras"         INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "trialNotificationsSent"  JSONB;

-- Índice pra cron rodar rápido (todos os trials ativos)
CREATE INDEX IF NOT EXISTS "Integrador_trialEndsAt_idx"
  ON "Integrador"("trialEndsAt") WHERE "trialEndsAt" IS NOT NULL;
