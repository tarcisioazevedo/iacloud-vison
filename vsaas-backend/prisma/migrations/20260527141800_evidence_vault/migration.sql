-- EvidenceVault — janelas de gravação salvaguardadas manualmente
--
-- Permite cliente final / integrador marcar um intervalo (start..end) como
-- "evidência". O job tickRetention NUNCA apaga segments cuja janela intersecte
-- uma EvidenceVault ativa. Casos de uso:
--   - Incidente importante (operador quer guardar além da retenção normal)
--   - Pedido policial/judicial (cadeia de custódia)
--   - Cumprimento legal (LGPD: bloqueio temporário do art. 16)
--
-- reason é obrigatório (auditoria + LGPD).
-- expiresAt NULL = permanente; quando expiresAt < now() a entrada vira no-op.

CREATE TABLE IF NOT EXISTS "EvidenceVault" (
  "id"          TEXT PRIMARY KEY,
  "cameraId"    TEXT NOT NULL,
  "startAt"     TIMESTAMP(3) NOT NULL,
  "endAt"       TIMESTAMP(3) NOT NULL,
  "reason"      TEXT NOT NULL,
  "expiresAt"   TIMESTAMP(3),
  "tenantId"    TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvidenceVault_cameraId_fkey"
    FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE,
  CONSTRAINT "EvidenceVault_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL
);

-- Index principal — job de retention filtra por (cameraId, startAt, endAt).
CREATE INDEX IF NOT EXISTS "EvidenceVault_camera_start_end_idx"
  ON "EvidenceVault" ("cameraId", "startAt", "endAt");

-- Index pra job filtrar evidências ativas em batch (expiresAt NULL ou no futuro)
CREATE INDEX IF NOT EXISTS "EvidenceVault_expiresAt_idx"
  ON "EvidenceVault" ("expiresAt");

-- Tenant scoping em listagens
CREATE INDEX IF NOT EXISTS "EvidenceVault_tenantId_idx"
  ON "EvidenceVault" ("tenantId");
