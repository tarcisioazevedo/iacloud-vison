-- EdgeNode: licenseKeyEnc (chave cifrada para recuperação INTEGRADOR_ADMIN)
-- EdgeNode: technicianEmail (e-mail do técnico que recebeu a chave)
ALTER TABLE "EdgeNode"
  ADD COLUMN IF NOT EXISTS "licenseKeyEnc"    TEXT,
  ADD COLUMN IF NOT EXISTS "technicianEmail"  TEXT;
