-- AnalyticsEvent: idempotência para POST /edge/ingest.
--
-- Edges em redes instáveis fazem retry quando o servidor demora a responder.
-- Sem idempotência, isso gera dupla cobrança na Cloud Vision API
-- (e double-counting em todos os relatórios). O edge agora envia um
-- header `Idempotency-Key` (ou body.idempotencyKey) e o servidor busca
-- evento existente com (cameraId, idempotencyKey) antes de reprocessar.
--
-- O índice é UNIQUE simples — em Postgres, múltiplos NULLs são tratados
-- como distintos, então eventos sem idempotencyKey (legados, ou pipeline 2)
-- continuam aceitando inserts normalmente.

ALTER TABLE "AnalyticsEvent" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "AnalyticsEvent_camera_idempotency"
  ON "AnalyticsEvent"("cameraId", "idempotencyKey");
