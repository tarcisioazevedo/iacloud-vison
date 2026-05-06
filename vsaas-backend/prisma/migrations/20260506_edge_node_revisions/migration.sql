-- Sprint 0 wiring 2026-05-06 (FCB-003/004): persistir capabilitiesRevision e
-- brandingRevision no EdgeNode pra Cloud invalidar cache do painel quando muda.
--
-- Box já envia ambos no heartbeat (passthrough). Antes este commit, ficavam
-- silenciosamente em lastTelemetryRaw (JSON). Agora colunas dedicadas
-- permitem query rápida e WHERE em painel admin.

ALTER TABLE "EdgeNode"
  ADD COLUMN IF NOT EXISTS "capabilitiesRevision" TEXT,
  ADD COLUMN IF NOT EXISTS "brandingRevision"     TEXT,
  ADD COLUMN IF NOT EXISTS "lastCapabilitiesAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastBrandingChangeAt" TIMESTAMP(3);
