-- Item 1.13 do docs/08 — ACK enriquecido do EdgeCommand
-- Box (bridge commit be9c457) envia agora {status, durationSec, errorMessage, info}
-- no POST /iacv-box/commands/:id/ack. Persistir para histórico no painel
-- "Comandos" do FleetDetailPage.

ALTER TABLE "EdgeCommand"
  ADD COLUMN "ackStatus"       TEXT,
  ADD COLUMN "ackDurationSec"  DOUBLE PRECISION,
  ADD COLUMN "ackErrorMessage" TEXT,
  ADD COLUMN "ackInfo"         JSONB;
