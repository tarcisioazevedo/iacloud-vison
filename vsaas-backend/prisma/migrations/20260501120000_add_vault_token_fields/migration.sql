-- Add R2 vault token tracking fields to EdgeNode
ALTER TABLE "EdgeNode" ADD COLUMN "vaultTokenId" TEXT;
ALTER TABLE "EdgeNode" ADD COLUMN "vaultExpiresAt" TIMESTAMP(3);
