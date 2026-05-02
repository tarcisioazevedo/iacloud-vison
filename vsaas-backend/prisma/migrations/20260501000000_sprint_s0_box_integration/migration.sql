-- Sprint S0 — Box↔Cloud Integration Contract
-- Aplicado em 2026-05-01 via psql direto + migration file para clone perfeito.
-- Referência: INTEGRATION/CLOUD_RESPONSE.md, INTEGRATION/BOX_DATA_CONTRACT.md

-- ─── 1. EdgeNode: telemetria enriquecida + vault ──────────────────────────────
-- lastTelemetryRaw: snapshot completo do último heartbeat enriquecido
--   (system, frigate, cameras[], storage, network). Renderizado como gauges/sparklines.
-- hardwareInventory: inventário de hardware via POST /iacv-box/hardware-inventory (boot).
-- vaultBucket / vaultPrefix: referência ao bucket Cloudflare R2 deste node.
ALTER TABLE "EdgeNode"
  ADD COLUMN IF NOT EXISTS "lastTelemetryRaw" JSONB,
  ADD COLUMN IF NOT EXISTS "hardwareInventory" JSONB,
  ADD COLUMN IF NOT EXISTS "vaultBucket"       TEXT,
  ADD COLUMN IF NOT EXISTS "vaultPrefix"       TEXT;

-- ─── 2. Camera: frigateName explícito ────────────────────────────────────────
-- Nome interno que o Frigate usa para este stream (ex: "camera1").
-- A Box envia este valor em cameraId de POST /iacv-box/events.
-- Resolve a FK violation quando o Frigate manda "camera1" e o DB esperava UUID.
ALTER TABLE "Camera"
  ADD COLUMN IF NOT EXISTS "frigateName" TEXT;

-- ─── 3. AnalyticsEvent: idempotência Box-side + vault keys ───────────────────
-- edgeNodeId: Box que gerou o evento (além do cameraId já existente).
-- frigateId:  ID interno do Frigate — chave de idempotência store-and-forward.
-- vault*Key:  chaves R2 para os arquivos de mídia do evento (snapshot, clip, face, plate).
-- vaultUploadedAt: quando a Box confirmou upload para o vault.
ALTER TABLE "AnalyticsEvent"
  ADD COLUMN IF NOT EXISTS "edgeNodeId"       TEXT,
  ADD COLUMN IF NOT EXISTS "frigateId"        TEXT,
  ADD COLUMN IF NOT EXISTS "vaultSnapshotKey" TEXT,
  ADD COLUMN IF NOT EXISTS "vaultClipKey"     TEXT,
  ADD COLUMN IF NOT EXISTS "vaultFaceKey"     TEXT,
  ADD COLUMN IF NOT EXISTS "vaultPlateKey"    TEXT,
  ADD COLUMN IF NOT EXISTS "vaultUploadedAt"  TIMESTAMP(3);

-- ─── 4. EdgeCommand: criação + expiresAt ─────────────────────────────────────
-- Tabela não estava em nenhuma migration anterior (foi criada via prisma push no banco legado).
-- Criamos aqui com IF NOT EXISTS para idempotência; depois adicionamos expiresAt.
CREATE TABLE IF NOT EXISTS "EdgeCommand" (
  "id"          TEXT NOT NULL,
  "edgeNodeId"  TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "payload"     JSONB NOT NULL DEFAULT '{}',
  "createdById" TEXT,
  "issuedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ackedAt"     TIMESTAMP(3),
  "expiresAt"   TIMESTAMP(3),
  CONSTRAINT "EdgeCommand_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EdgeCommand_edgeNodeId_ackedAt_idx"
  ON "EdgeCommand"("edgeNodeId", "ackedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EdgeCommand_edgeNodeId_fkey'
  ) THEN
    ALTER TABLE "EdgeCommand"
      ADD CONSTRAINT "EdgeCommand_edgeNodeId_fkey"
      FOREIGN KEY ("edgeNodeId")
      REFERENCES "EdgeNode"("id")
      ON DELETE CASCADE;
  END IF;
END $$;

-- Box não executa comandos após expiresAt. null = sem expiração.
ALTER TABLE "EdgeCommand"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

-- ─── 5. Índice parcial: idempotência (edgeNodeId, frigateId) ─────────────────
-- WHERE clause exclui NULLs — dois eventos sem frigateId não colidem.
-- Garante que a Box nunca insere duplicata mesmo após retry de store-and-forward.
CREATE UNIQUE INDEX IF NOT EXISTS "AnalyticsEvent_node_frigate_key"
  ON "AnalyticsEvent"("edgeNodeId", "frigateId")
  WHERE "edgeNodeId" IS NOT NULL AND "frigateId" IS NOT NULL;

-- ─── 6. Índice auxiliar: queries de fleet por edgeNodeId ─────────────────────
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_edgeNodeId_capturedAt_idx"
  ON "AnalyticsEvent"("edgeNodeId", "capturedAt");
