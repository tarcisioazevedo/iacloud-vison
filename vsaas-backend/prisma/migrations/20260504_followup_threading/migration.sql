-- Threading de follow-ups: parentId opcional aponta para o follow-up original.
ALTER TABLE "LeadFollowUp" ADD COLUMN "parentId" TEXT;

CREATE INDEX "LeadFollowUp_parentId_idx" ON "LeadFollowUp"("parentId");

ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "LeadFollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
