-- Singleton de canal WhatsApp do fabricante (super-admin) — recebe alertas
-- comerciais (leads/demos) e do sistema (P0/P1) sem precisar atrelar a um
-- ClienteFinal. ID fixo "system".

CREATE TABLE "SystemNotificationChannel" (
  "id"                  TEXT      NOT NULL DEFAULT 'system',
  "provider"            TEXT      NOT NULL DEFAULT 'evolution',
  "instanceName"        TEXT      NOT NULL,
  "instanceId"          TEXT,
  "connectionState"     TEXT      NOT NULL DEFAULT 'close',
  "phoneNumber"         TEXT,
  "profileName"         TEXT,
  "pairingCode"         TEXT,
  "qrCodePayload"       TEXT,
  "lastQrAt"            TIMESTAMP,
  "lastConnectedAt"     TIMESTAMP,
  "lastDisconnectedAt"  TIMESTAMP,
  "lastSyncAt"          TIMESTAMP,
  "lastError"           TEXT,
  "isActive"            BOOLEAN   NOT NULL DEFAULT true,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP NOT NULL,
  "recipients"          TEXT[]    NOT NULL DEFAULT ARRAY[]::TEXT[],

  CONSTRAINT "SystemNotificationChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemNotificationChannel_instanceName_key"
  ON "SystemNotificationChannel"("instanceName");

CREATE INDEX "SystemNotificationChannel_connectionState_idx"
  ON "SystemNotificationChannel"("connectionState");
