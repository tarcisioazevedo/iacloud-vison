-- AlterTable
ALTER TABLE "User" ADD COLUMN     "telegramChatId" TEXT;

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "integradorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'evolution',
    "instanceName" TEXT NOT NULL,
    "instanceId" TEXT,
    "connectionState" TEXT NOT NULL DEFAULT 'close',
    "phoneNumber" TEXT,
    "profileName" TEXT,
    "pairingCode" TEXT,
    "qrCodePayload" TEXT,
    "lastQrAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "lastDisconnectedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_integradorId_key" ON "NotificationChannel"("integradorId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_instanceName_key" ON "NotificationChannel"("instanceName");

-- CreateIndex
CREATE INDEX "NotificationChannel_connectionState_idx" ON "NotificationChannel"("connectionState");

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_integradorId_fkey" FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE CASCADE ON UPDATE CASCADE;
