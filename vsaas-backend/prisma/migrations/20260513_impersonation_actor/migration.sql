-- ImpersonationSession — generaliza ator (SUPER_ADMIN OU INTEGRADOR_ADMIN).
-- Antes: superAdminId (string, sem FK) + role implícito.
-- Agora: actorId + actorRole, mantendo retrocompatibilidade (todas as
-- sessões antigas viram actorRole='SUPER_ADMIN').

-- 1) Adiciona actorRole com default temporário p/ as linhas existentes.
ALTER TABLE "ImpersonationSession"
  ADD COLUMN IF NOT EXISTS "actorRole" TEXT NOT NULL DEFAULT 'SUPER_ADMIN';

-- 2) Renomeia coluna superAdminId → actorId (preserva dados).
ALTER TABLE "ImpersonationSession"
  RENAME COLUMN "superAdminId" TO "actorId";

-- 3) Tira o default — quem inserir depois precisa ser explícito.
ALTER TABLE "ImpersonationSession"
  ALTER COLUMN "actorRole" DROP DEFAULT;

-- 4) Atualiza índice antigo (se existir com nome antigo) para o novo nome.
DROP INDEX IF EXISTS "ImpersonationSession_superAdminId_startedAt_idx";
CREATE INDEX IF NOT EXISTS "ImpersonationSession_actorId_startedAt_idx"
  ON "ImpersonationSession"("actorId", "startedAt");
