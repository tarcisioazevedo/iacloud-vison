-- CreateEnum
CREATE TYPE "DemoInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('CREATE_INTEGRADOR', 'DELETE_INTEGRADOR', 'CONVERT_LEAD', 'DELETE_CLIENTE_FINAL', 'DELETE_USER', 'CHANGE_BILLING', 'RESET_USER_PASSWORD');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CustomDomainStatus" AS ENUM ('PENDING_DNS', 'PENDING_VERIFICATION', 'ACTIVE', 'ERROR', 'DISABLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'ADMIN_GLOBAL';
ALTER TYPE "UserRole" ADD VALUE 'CLIENTE_SUPERVISOR';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DemoInvite" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "DemoInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "suggestedPlan" TEXT,
    "targetKind" "LeadKind" NOT NULL,
    "hostIntegradorId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "emailSentAt" TIMESTAMP(3),
    "whatsappSent" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "resultJson" JSONB,
    "reason" TEXT,
    "rejectedReason" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegradorTechnicianAccess" (
    "id" TEXT NOT NULL,
    "technicianUserId" TEXT NOT NULL,
    "integradorId" TEXT NOT NULL,
    "clienteFinalId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'FULL',
    "grantedByUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegradorTechnicianAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomDomain" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "CustomDomainStatus" NOT NULL DEFAULT 'PENDING_DNS',
    "integradorId" TEXT,
    "clienteFinalId" TEXT,
    "verifyToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "cfHostnameId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "superAdminId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "jwtJti" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoInvite_tokenHash_key" ON "DemoInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "DemoInvite_leadId_idx" ON "DemoInvite"("leadId");

-- CreateIndex
CREATE INDEX "DemoInvite_status_expiresAt_idx" ON "DemoInvite"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_expiresAt_idx" ON "ApprovalRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_action_status_idx" ON "ApprovalRequest"("action", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedByUserId_idx" ON "ApprovalRequest"("requestedByUserId");

-- CreateIndex
CREATE INDEX "IntegradorTechnicianAccess_integradorId_idx" ON "IntegradorTechnicianAccess"("integradorId");

-- CreateIndex
CREATE INDEX "IntegradorTechnicianAccess_clienteFinalId_idx" ON "IntegradorTechnicianAccess"("clienteFinalId");

-- CreateIndex
CREATE INDEX "IntegradorTechnicianAccess_technicianUserId_idx" ON "IntegradorTechnicianAccess"("technicianUserId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegradorTechnicianAccess_technicianUserId_clienteFinalId_key" ON "IntegradorTechnicianAccess"("technicianUserId", "clienteFinalId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomDomain_hostname_key" ON "CustomDomain"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "CustomDomain_verifyToken_key" ON "CustomDomain"("verifyToken");

-- CreateIndex
CREATE INDEX "CustomDomain_status_idx" ON "CustomDomain"("status");

-- CreateIndex
CREATE INDEX "CustomDomain_integradorId_idx" ON "CustomDomain"("integradorId");

-- CreateIndex
CREATE INDEX "CustomDomain_clienteFinalId_idx" ON "CustomDomain"("clienteFinalId");

-- CreateIndex
CREATE UNIQUE INDEX "ImpersonationSession_jwtJti_key" ON "ImpersonationSession"("jwtJti");

-- CreateIndex
CREATE INDEX "ImpersonationSession_superAdminId_startedAt_idx" ON "ImpersonationSession"("superAdminId", "startedAt");

-- CreateIndex
CREATE INDEX "ImpersonationSession_targetUserId_startedAt_idx" ON "ImpersonationSession"("targetUserId", "startedAt");

-- AddForeignKey
ALTER TABLE "DemoInvite" ADD CONSTRAINT "DemoInvite_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegradorTechnicianAccess" ADD CONSTRAINT "IntegradorTechnicianAccess_technicianUserId_fkey" FOREIGN KEY ("technicianUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegradorTechnicianAccess" ADD CONSTRAINT "IntegradorTechnicianAccess_integradorId_fkey" FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegradorTechnicianAccess" ADD CONSTRAINT "IntegradorTechnicianAccess_clienteFinalId_fkey" FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_integradorId_fkey" FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_clienteFinalId_fkey" FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
