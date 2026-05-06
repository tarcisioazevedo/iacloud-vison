-- Deal Registration — proteção de canal: primeiro a registrar CNPJ
-- ganha 30d de exclusividade. Outros integradores recebem 409 ao tentar
-- cadastrar lead com o mesmo CNPJ.

DO $$ BEGIN
  CREATE TYPE "DealRegistrationStatus" AS ENUM (
    'PENDING', 'APPROVED', 'REJECTED', 'WON', 'LOST', 'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DealRegistration" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "integradorId"     TEXT NOT NULL,
  "cnpj"             TEXT NOT NULL,
  "companyName"      TEXT NOT NULL,
  "companyTradeName" TEXT,
  "contactName"      TEXT NOT NULL,
  "contactEmail"     TEXT,
  "contactPhone"     TEXT,
  "estimatedMrrBrl"  DECIMAL(10, 2),
  "notes"            TEXT,
  "status"           "DealRegistrationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt"        TIMESTAMP(3),
  "lastActivityAt"   TIMESTAMP(3),
  "approvedBy"       TEXT,
  "approvedAt"       TIMESTAMP(3),
  "rejectedBy"       TEXT,
  "rejectedAt"       TIMESTAMP(3),
  "rejectionReason"  TEXT,
  "convertedLeadId"  TEXT,
  "wonAt"            TIMESTAMP(3),
  "lostAt"           TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "DealRegistration_integradorId_status_idx"
  ON "DealRegistration"("integradorId", "status");
CREATE INDEX IF NOT EXISTS "DealRegistration_cnpj_status_idx"
  ON "DealRegistration"("cnpj", "status");
CREATE INDEX IF NOT EXISTS "DealRegistration_expiresAt_idx"
  ON "DealRegistration"("expiresAt") WHERE "expiresAt" IS NOT NULL;

-- Constraint parcial: apenas 1 deal APPROVED por CNPJ ativo (proteção de exclusividade)
CREATE UNIQUE INDEX IF NOT EXISTS "DealRegistration_cnpj_approved_unique"
  ON "DealRegistration"("cnpj") WHERE "status" = 'APPROVED';

DO $$ BEGIN
  ALTER TABLE "DealRegistration"
    ADD CONSTRAINT "DealRegistration_integradorId_fkey"
    FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
