-- Pricing CMS — 6 tabelas para SUPER_ADMIN editar planos sem deploy.
-- Doc: docs/16-PLAN-WHITELABEL-PRICING-MULTITENANT.md (este arquivo precede o WL)
--
-- ATENÇÃO: o constraint slug @unique de PlatformPlan é substituído por
-- @@unique([tenantId, slug]) na migration seguinte (20260506_whitelabel_*).
-- Esta migration cria com slug @unique apenas; a próxima ajusta.

-- 1) PlatformPlan
CREATE TABLE IF NOT EXISTS "PlatformPlan" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "slug"            TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "tagline"         TEXT NOT NULL,
  "priceMonthly"    DECIMAL(10, 2),
  "priceMonuv"      DECIMAL(10, 2),
  "connections"     TEXT NOT NULL,
  "retention"       TEXT NOT NULL,
  "totalAIs"        TEXT NOT NULL,
  "ctaLabel"        TEXT NOT NULL,
  "ctaKind"         TEXT NOT NULL,
  "ctaUrl"          TEXT,
  "highlights"      TEXT[] DEFAULT ARRAY[]::TEXT[],
  "recommended"     BOOLEAN NOT NULL DEFAULT false,
  "accent"          TEXT NOT NULL DEFAULT 'cyan',
  "maxCameras"      INTEGER,
  "retentionDays"   INTEGER,
  "modulesIncluded" "AnalyticsModel"[] DEFAULT ARRAY[]::"AnalyticsModel"[],
  "edgeBoxScenario" TEXT,
  "displayOrder"    INTEGER NOT NULL DEFAULT 0,
  "publicVisible"   BOOLEAN NOT NULL DEFAULT true,
  "archived"        BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "updatedBy"       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformPlan_slug_key" ON "PlatformPlan"("slug");
CREATE INDEX IF NOT EXISTS "PlatformPlan_displayOrder_idx" ON "PlatformPlan"("displayOrder");
CREATE INDEX IF NOT EXISTS "PlatformPlan_archived_publicVisible_idx" ON "PlatformPlan"("archived", "publicVisible");

-- 2) AIAddonPlan
CREATE TABLE IF NOT EXISTS "AIAddonPlan" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "slug"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "iconKey"        TEXT NOT NULL,
  "priceIACV"      DECIMAL(10, 2),
  "priceMonuv"     DECIMAL(10, 2),
  "exclusive"      BOOLEAN NOT NULL DEFAULT false,
  "color"          TEXT NOT NULL DEFAULT 'text-cyan-400',
  "description"    TEXT,
  "analyticsModel" "AnalyticsModel",
  "displayOrder"   INTEGER NOT NULL DEFAULT 0,
  "publicVisible"  BOOLEAN NOT NULL DEFAULT true,
  "archived"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "updatedBy"      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "AIAddonPlan_slug_key" ON "AIAddonPlan"("slug");
CREATE INDEX IF NOT EXISTS "AIAddonPlan_displayOrder_idx" ON "AIAddonPlan"("displayOrder");
CREATE INDEX IF NOT EXISTS "AIAddonPlan_archived_publicVisible_idx" ON "AIAddonPlan"("archived", "publicVisible");

-- 3) VMSStoragePrice
CREATE TABLE IF NOT EXISTS "VMSStoragePrice" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "resolution"  TEXT NOT NULL,
  "days"        INTEGER NOT NULL,
  "priceIACV"   DECIMAL(10, 2) NOT NULL,
  "priceMonuv"  DECIMAL(10, 2),
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "updatedBy"   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "VMSStoragePrice_resolution_days_key" ON "VMSStoragePrice"("resolution", "days");
CREATE INDEX IF NOT EXISTS "VMSStoragePrice_resolution_idx" ON "VMSStoragePrice"("resolution");

-- 4) PricingHero (singleton)
CREATE TABLE IF NOT EXISTS "PricingHero" (
  "id"                 TEXT NOT NULL PRIMARY KEY,
  "tagline"            TEXT NOT NULL,
  "headline"           TEXT NOT NULL,
  "headlineHighlights" JSONB,
  "subtitle"           TEXT NOT NULL,
  "ctaLoginText"       TEXT NOT NULL DEFAULT 'Entrar',
  "ctaLoginUrl"        TEXT NOT NULL DEFAULT '/login',
  "ctaConsultantText"  TEXT NOT NULL DEFAULT 'Falar com consultor',
  "ctaConsultantUrl"   TEXT,
  "active"             BOOLEAN NOT NULL DEFAULT true,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  "updatedBy"          TEXT
);

-- 5) CompetitorComparison
CREATE TABLE IF NOT EXISTS "CompetitorComparison" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "iconKey"       TEXT NOT NULL,
  "label"         TEXT NOT NULL,
  "ourValue"      TEXT NOT NULL,
  "ourValueColor" TEXT NOT NULL DEFAULT 'text-cyan-400',
  "theirValue"    TEXT,
  "description"   TEXT,
  "displayOrder"  INTEGER NOT NULL DEFAULT 0,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "updatedBy"     TEXT
);
CREATE INDEX IF NOT EXISTS "CompetitorComparison_displayOrder_active_idx" ON "CompetitorComparison"("displayOrder", "active");

-- 6) PricingSettings (singleton)
CREATE TABLE IF NOT EXISTS "PricingSettings" (
  "id"                    TEXT NOT NULL PRIMARY KEY,
  "showAnnualToggle"      BOOLEAN NOT NULL DEFAULT true,
  "annualDiscountPct"     INTEGER NOT NULL DEFAULT 20,
  "showTabPlans"          BOOLEAN NOT NULL DEFAULT true,
  "showTabAIs"            BOOLEAN NOT NULL DEFAULT true,
  "showTabVMS"            BOOLEAN NOT NULL DEFAULT true,
  "showCompetitorSection" BOOLEAN NOT NULL DEFAULT true,
  "defaultCurrency"       TEXT NOT NULL DEFAULT 'BRL',
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  "updatedBy"             TEXT
);
