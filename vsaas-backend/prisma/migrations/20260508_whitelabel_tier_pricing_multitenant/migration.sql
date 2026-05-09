-- White-label tier + Pricing multi-tenant
-- Doc: docs/16-PLAN-WHITELABEL-PRICING-MULTITENANT.md
--
-- Adiciona:
--   1) enum WhitelabelTier
--   2) Integrador.whitelabelTier + .whitelabelCapabilities
--   3) PlatformPlan.tenantId, .isOverride, .wholesalePriceMonthly
--   4) Substitui constraint slug @unique por @@unique([tenantId, slug])
--   5) Índices auxiliares

-- 1) Enum
DO $$ BEGIN
  CREATE TYPE "WhitelabelTier" AS ENUM ('NONE', 'BASIC', 'PRO', 'ENTERPRISE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Integrador — tier + capabilities
ALTER TABLE "Integrador"
  ADD COLUMN IF NOT EXISTS "whitelabelTier" "WhitelabelTier" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "whitelabelCapabilities" JSONB;

-- 3) PlatformPlan — tenant scoping + wholesale floor
ALTER TABLE "PlatformPlan"
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT,
  ADD COLUMN IF NOT EXISTS "isOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "wholesalePriceMonthly" DECIMAL(10, 2);

-- 4) Constraint composta
-- Drop antigo (silencioso se não existir, ex.: re-run)
DO $$ BEGIN
  ALTER TABLE "PlatformPlan" DROP CONSTRAINT IF EXISTS "PlatformPlan_slug_key";
END $$;

-- Drop índice unique se existir com nome legacy
DROP INDEX IF EXISTS "PlatformPlan_slug_key";

-- Constraint nova
DO $$ BEGIN
  ALTER TABLE "PlatformPlan"
    ADD CONSTRAINT "PlatformPlan_tenantId_slug_key" UNIQUE ("tenantId", "slug");
EXCEPTION WHEN duplicate_object THEN NULL;
WHEN duplicate_table THEN NULL;
END $$;

-- 5) Índices
CREATE INDEX IF NOT EXISTS "PlatformPlan_tenantId_idx" ON "PlatformPlan"("tenantId");

-- FK opcional pro Integrador (CASCADE on delete da tabela Integrador
-- pra limpar overrides automaticamente). Não usamos no Prisma model
-- (mantém o relacionamento "soft" — buscamos por tenantId manualmente),
-- mas a FK no DB protege integridade.
DO $$ BEGIN
  ALTER TABLE "PlatformPlan"
    ADD CONSTRAINT "PlatformPlan_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Integrador"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
