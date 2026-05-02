-- Acesso por Site + Limite de EdgeNodes por Integrador + SSO Box

-- ─── 1. User.allowedSiteIds ──────────────────────────────────────────────────
-- Array de UUIDs de Sites que o usuário pode visualizar.
-- Vazio = acesso a todos os Sites do ClienteFinal (comportamento atual).
-- Aplicado a CLIENTE_OPERADOR e CLIENTE_VIEWER.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "allowedSiteIds" TEXT[] NOT NULL DEFAULT '{}';

-- ─── 2. Integrador.maxEdgeNodes ──────────────────────────────────────────────
-- Limite de EdgeNodes que este integrador pode ativar. null = ilimitado.
ALTER TABLE "Integrador"
  ADD COLUMN IF NOT EXISTS "maxEdgeNodes" INTEGER;

-- ─── 3. EdgeNode.integradorId (desnormalização para SSO) ─────────────────────
-- Permite que a Box identifique rapidamente o integradorId pelo activate
-- sem precisar navegar Site → ClienteFinal → Integrador.
-- Preenchido no activate e no upsert de EdgeNode.
ALTER TABLE "EdgeNode"
  ADD COLUMN IF NOT EXISTS "integradorId" TEXT;

CREATE INDEX IF NOT EXISTS "EdgeNode_integradorId_idx"
  ON "EdgeNode"("integradorId");
