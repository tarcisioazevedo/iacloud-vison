-- Sprint Comercial Hub: SalesUser, SalesGoal, SalesActivity, SalesAsset,
-- LeadScore, SalesOpportunity, LeadAssignment + enums
-- Data: 2026-05-04

CREATE TYPE "SalesRole" AS ENUM ('SDR', 'AE', 'CS', 'MANAGER', 'DIRECTOR');
CREATE TYPE "GoalMetric" AS ENUM ('CALLS', 'QUALIFIED_LEADS', 'DEMOS_SENT', 'DEALS_CLOSED', 'CLOSED_MRR', 'REVENUE');
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'EMAIL', 'WHATSAPP', 'MEETING', 'NOTE', 'TASK', 'PROPOSAL_SENT', 'DEMO_DONE');
CREATE TYPE "AssetType" AS ENUM ('SCRIPT', 'DECK', 'VIDEO', 'PDF', 'TEMPLATE', 'CASE_STUDY');
CREATE TYPE "OpportunityType" AS ENUM ('NEW_LEAD', 'CROSS_SELL', 'UPSELL', 'RENEWAL');
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'STALLED');

CREATE TABLE "SalesUser" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "SalesRole" NOT NULL,
    "avatar" TEXT,
    "hireDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesUser_userId_key" ON "SalesUser"("userId");
CREATE UNIQUE INDEX "SalesUser_email_key" ON "SalesUser"("email");
CREATE INDEX "SalesUser_role_active_idx" ON "SalesUser"("role", "active");

CREATE TABLE "SalesGoal" (
    "id" TEXT NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "metric" "GoalMetric" NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "actual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesGoal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesGoal_salesUserId_period_metric_key" ON "SalesGoal"("salesUserId", "period", "metric");
CREATE INDEX "SalesGoal_period_idx" ON "SalesGoal"("period");
ALTER TABLE "SalesGoal" ADD CONSTRAINT "SalesGoal_salesUserId_fkey" FOREIGN KEY ("salesUserId") REFERENCES "SalesUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SalesActivity" (
    "id" TEXT NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "leadId" TEXT,
    "integradorId" TEXT,
    "opportunityId" TEXT,
    "type" "ActivityType" NOT NULL,
    "durationSec" INTEGER,
    "outcome" TEXT,
    "notes" TEXT,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesActivity_salesUserId_createdAt_idx" ON "SalesActivity"("salesUserId", "createdAt" DESC);
CREATE INDEX "SalesActivity_leadId_idx" ON "SalesActivity"("leadId");
CREATE INDEX "SalesActivity_integradorId_idx" ON "SalesActivity"("integradorId");
CREATE INDEX "SalesActivity_opportunityId_idx" ON "SalesActivity"("opportunityId");
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_salesUserId_fkey" FOREIGN KEY ("salesUserId") REFERENCES "SalesUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SalesAsset" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "funnelStage" TEXT,
    "url" TEXT,
    "body" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesAsset_type_active_idx" ON "SalesAsset"("type", "active");

CREATE TABLE "LeadScore" (
    "leadId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasonsJson" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("leadId")
);
CREATE INDEX "LeadScore_score_idx" ON "LeadScore"("score");

CREATE TABLE "SalesOpportunity" (
    "id" TEXT NOT NULL,
    "type" "OpportunityType" NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "leadId" TEXT,
    "integradorId" TEXT,
    "ownerId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "modulesProposed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimatedMrr" DOUBLE PRECISION,
    "probability" INTEGER,
    "reasonAi" TEXT,
    "closeDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesOpportunity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesOpportunity_status_type_idx" ON "SalesOpportunity"("status", "type");
CREATE INDEX "SalesOpportunity_integradorId_idx" ON "SalesOpportunity"("integradorId");
CREATE INDEX "SalesOpportunity_leadId_idx" ON "SalesOpportunity"("leadId");
CREATE INDEX "SalesOpportunity_ownerId_idx" ON "SalesOpportunity"("ownerId");
ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "SalesUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeadAssignment_leadId_active_idx" ON "LeadAssignment"("leadId", "active");
CREATE INDEX "LeadAssignment_salesUserId_active_idx" ON "LeadAssignment"("salesUserId", "active");
