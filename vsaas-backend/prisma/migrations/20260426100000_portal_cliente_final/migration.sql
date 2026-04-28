-- Sprint CF.4 — Portal Cliente-Final (B2B2B white-label).
--
-- 1) Adiciona campos de branding e portalSlug ao ClienteFinal.
-- 2) Cria tabela PortalAccessToken para magic-links emitidos pelo integrador.

-- ── ClienteFinal: branding + slug ──────────────────────────────────────────
ALTER TABLE "ClienteFinal" ADD COLUMN "portalSlug"     TEXT;
ALTER TABLE "ClienteFinal" ADD COLUMN "primaryColor"   TEXT;
ALTER TABLE "ClienteFinal" ADD COLUMN "secondaryColor" TEXT;

CREATE UNIQUE INDEX "ClienteFinal_portalSlug_key" ON "ClienteFinal"("portalSlug");

-- ── PortalAccessToken ──────────────────────────────────────────────────────
CREATE TABLE "PortalAccessToken" (
    "id"             TEXT         NOT NULL,
    "clienteFinalId" TEXT         NOT NULL,
    "tokenHash"      TEXT         NOT NULL,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "lastUsedAt"     TIMESTAMP(3),
    "singleUse"      BOOLEAN      NOT NULL DEFAULT false,
    "revoked"        BOOLEAN      NOT NULL DEFAULT false,
    "createdBy"      TEXT         NOT NULL,
    "label"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortalAccessToken_tokenHash_key" ON "PortalAccessToken"("tokenHash");
CREATE INDEX "PortalAccessToken_clienteFinalId_idx" ON "PortalAccessToken"("clienteFinalId");
CREATE INDEX "PortalAccessToken_expiresAt_idx" ON "PortalAccessToken"("expiresAt");

ALTER TABLE "PortalAccessToken"
  ADD CONSTRAINT "PortalAccessToken_clienteFinalId_fkey"
  FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
