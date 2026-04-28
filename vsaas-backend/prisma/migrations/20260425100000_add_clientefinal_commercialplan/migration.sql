-- Add commercialPlan textual field to ClienteFinal.
-- Texto livre observado pelo integrador no cadastro do cliente final.
ALTER TABLE "ClienteFinal" ADD COLUMN "commercialPlan" TEXT;
