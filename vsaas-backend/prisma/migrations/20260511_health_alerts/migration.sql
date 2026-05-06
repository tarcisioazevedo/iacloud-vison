-- HealthAlert — alertas proativos de saúde dos clientes finais.
-- Cron diário (services/health-alert.service.ts) emite quando score cai pra
-- critical/bad por > 24h. Idempotente por (clienteFinalId, dia).

CREATE TABLE IF NOT EXISTS "HealthAlert" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "clienteFinalId"  TEXT NOT NULL,
  "integradorId"    TEXT NOT NULL,
  "level"           TEXT NOT NULL,             -- 'critical' | 'bad'
  "score"           INTEGER NOT NULL,
  "signalsJson"     JSONB,
  "suggestion"      TEXT,
  "sentAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt"  TIMESTAMP(3),
  "acknowledgedBy"  TEXT,
  "resolvedAt"      TIMESTAMP(3),
  "channelsSent"    JSONB
);

CREATE INDEX IF NOT EXISTS "HealthAlert_integradorId_sentAt_idx" ON "HealthAlert"("integradorId", "sentAt");
CREATE INDEX IF NOT EXISTS "HealthAlert_clienteFinalId_sentAt_idx" ON "HealthAlert"("clienteFinalId", "sentAt");
CREATE INDEX IF NOT EXISTS "HealthAlert_acknowledgedAt_idx" ON "HealthAlert"("acknowledgedAt");

DO $$ BEGIN
  ALTER TABLE "HealthAlert"
    ADD CONSTRAINT "HealthAlert_clienteFinalId_fkey"
    FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
