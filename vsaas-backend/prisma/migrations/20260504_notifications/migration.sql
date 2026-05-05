-- Notifications: preferências granulares + log de envio multi-canal
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "superAdminId" TEXT,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappPhone" TEXT,
    "quietHoursStart" INTEGER NOT NULL DEFAULT 22,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 7,
    "eventChannels" JSONB NOT NULL DEFAULT '{}',
    "dailyDigest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");
CREATE UNIQUE INDEX "NotificationPreference_superAdminId_key" ON "NotificationPreference"("superAdminId");
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");
CREATE INDEX "NotificationPreference_superAdminId_idx" ON "NotificationPreference"("superAdminId");

CREATE TABLE "NotificationDeliveryLog" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "recipientSuperAdminId" TEXT,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "payloadJson" JSONB,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDeliveryLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationDeliveryLog_recipientUserId_createdAt_idx" ON "NotificationDeliveryLog"("recipientUserId", "createdAt" DESC);
CREATE INDEX "NotificationDeliveryLog_recipientSuperAdminId_createdAt_idx" ON "NotificationDeliveryLog"("recipientSuperAdminId", "createdAt" DESC);
CREATE INDEX "NotificationDeliveryLog_event_channel_createdAt_idx" ON "NotificationDeliveryLog"("event", "channel", "createdAt" DESC);
CREATE INDEX "NotificationDeliveryLog_dedupeKey_createdAt_idx" ON "NotificationDeliveryLog"("dedupeKey", "createdAt" DESC);
