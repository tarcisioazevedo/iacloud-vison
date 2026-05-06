-- Onda 0 (log-audit) — auditoria HTTP automática.
-- Adiciona 4 campos opcionais ao AuditLog para que o middleware
-- `auditWrite` possa registrar toda escrita HTTP automaticamente,
-- preservando entradas manuais existentes (que ficam com esses campos null).

ALTER TABLE "AuditLog"
  ADD COLUMN "method"     TEXT,
  ADD COLUMN "path"       TEXT,
  ADD COLUMN "statusCode" INTEGER,
  ADD COLUMN "durationMs" INTEGER;

CREATE INDEX "AuditLog_method_createdAt_idx"     ON "AuditLog"("method",     "createdAt");
CREATE INDEX "AuditLog_statusCode_createdAt_idx" ON "AuditLog"("statusCode", "createdAt");
