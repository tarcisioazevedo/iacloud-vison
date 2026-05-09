-- Asaas billing provisionado (kill-switch BILLING_ENABLED=false ativa)
-- Doc: docs/16-PLAN-WHITELABEL-PRICING-MULTITENANT.md (Sprint P0.4)
--
-- Cria estruturas pra:
--   - Customer Asaas (1:1 com Integrador)
--   - Subscription recorrente (integrador paga ao fabricante)
--   - WebhookEvent (idempotência + replay)
--   - Estende Invoice com campos Asaas (paymentId, NFe, billingType)
--
-- Nada disso é ATIVADO até BILLING_ENABLED=true no env. Service responde 501 quando off.

-- 1) Extender Invoice com campos Asaas
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "asaasPaymentId"   TEXT,
  ADD COLUMN IF NOT EXISTS "asaasPaymentUrl"  TEXT,
  ADD COLUMN IF NOT EXISTS "billingType"      TEXT,
  ADD COLUMN IF NOT EXISTS "asaasInvoiceNfId" TEXT,
  ADD COLUMN IF NOT EXISTS "asaasNfStatus"    TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_asaasPaymentId_key" ON "Invoice"("asaasPaymentId") WHERE "asaasPaymentId" IS NOT NULL;

-- 2) AsaasCustomer
CREATE TABLE IF NOT EXISTS "AsaasCustomer" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "integradorId"    TEXT NOT NULL,
  "asaasCustomerId" TEXT NOT NULL,
  "cpfCnpj"         TEXT,
  "email"           TEXT,
  "phone"           TEXT,
  "syncedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "AsaasCustomer_integradorId_key" ON "AsaasCustomer"("integradorId");
CREATE UNIQUE INDEX IF NOT EXISTS "AsaasCustomer_asaasCustomerId_key" ON "AsaasCustomer"("asaasCustomerId");

DO $$ BEGIN
  ALTER TABLE "AsaasCustomer"
    ADD CONSTRAINT "AsaasCustomer_integradorId_fkey"
    FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) AsaasSubscription
CREATE TABLE IF NOT EXISTS "AsaasSubscription" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "integradorId"        TEXT NOT NULL,
  "asaasSubscriptionId" TEXT NOT NULL,
  "planSlug"            TEXT NOT NULL,
  "cycle"               TEXT NOT NULL DEFAULT 'MONTHLY',
  "value"               DECIMAL(10, 2) NOT NULL,
  "nextDueDate"         TIMESTAMP(3) NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'ACTIVE',
  "billingType"         TEXT,
  "externalReference"   TEXT,
  "startedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt"         TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "AsaasSubscription_asaasSubscriptionId_key" ON "AsaasSubscription"("asaasSubscriptionId");
CREATE INDEX IF NOT EXISTS "AsaasSubscription_integradorId_status_idx" ON "AsaasSubscription"("integradorId", "status");
CREATE INDEX IF NOT EXISTS "AsaasSubscription_nextDueDate_idx" ON "AsaasSubscription"("nextDueDate");

DO $$ BEGIN
  ALTER TABLE "AsaasSubscription"
    ADD CONSTRAINT "AsaasSubscription_integradorId_fkey"
    FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) AsaasWebhookEvent
CREATE TABLE IF NOT EXISTS "AsaasWebhookEvent" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "eventId"      TEXT NOT NULL,
  "eventName"    TEXT NOT NULL,
  "payloadJson"  JSONB NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT,
  "receivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"  TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "AsaasWebhookEvent_eventId_key" ON "AsaasWebhookEvent"("eventId");
CREATE INDEX IF NOT EXISTS "AsaasWebhookEvent_status_receivedAt_idx" ON "AsaasWebhookEvent"("status", "receivedAt");
CREATE INDEX IF NOT EXISTS "AsaasWebhookEvent_eventName_idx" ON "AsaasWebhookEvent"("eventName");
