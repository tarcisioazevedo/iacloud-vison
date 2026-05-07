-- Adiciona cota de storage por ClienteFinal (null = sem cota explícita).
ALTER TABLE "ClienteFinal" ADD COLUMN "storageQuotaBytes" BIGINT;
