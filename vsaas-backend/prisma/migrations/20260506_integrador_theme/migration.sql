-- Onda 8 (docs/13 — cockpit premium): tema white-label do portal cliente do integrador.
-- Relação 1:1 opcional com Integrador. Quando ausente, o portal renderiza com defaults do app.

CREATE TABLE "IntegradorTheme" (
  "id"            TEXT      NOT NULL,
  "integradorId"  TEXT      NOT NULL,
  "primaryColor"  TEXT      NOT NULL DEFAULT '#06b6d4',
  "accentColor"   TEXT      NOT NULL DEFAULT '#8b5cf6',
  "successColor"  TEXT      NOT NULL DEFAULT '#10b981',
  "dangerColor"   TEXT      NOT NULL DEFAULT '#f43f5e',
  "fontFamily"    TEXT      NOT NULL DEFAULT 'inter',
  "density"       TEXT      NOT NULL DEFAULT 'normal',
  "radius"        TEXT      NOT NULL DEFAULT 'soft',
  "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP NOT NULL,

  CONSTRAINT "IntegradorTheme_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegradorTheme_integradorId_key"
  ON "IntegradorTheme"("integradorId");

ALTER TABLE "IntegradorTheme"
  ADD CONSTRAINT "IntegradorTheme_integradorId_fkey"
  FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
