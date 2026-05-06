-- Camera↔EdgeNode tenant invariant
--
-- Regra principal do sistema (multi-tenant B2B2B): toda câmera vinculada a um
-- EdgeNode deve estar no MESMO Site (e portanto no mesmo Cliente Final/Integrador)
-- que o EdgeNode. Sem isso, mover um EdgeNode entre sites/tenants vaza câmeras
-- entre clientes — incidente real observado em 2026-05-06 (cam-demo-001 ficou
-- vinculada a en-lab-001 após o edge ser movido de site-demo-001 → site-lab-001).
--
-- Antes desta migration:
--   - PATCH /cameras valida edge.siteId == camera.siteId, mas
--   - POST /cameras NÃO valida, e
--   - mover EdgeNode entre sites não invalida câmeras pré-existentes, e
--   - SQL ad-hoc / Prisma direto / seeds antigos podem violar livremente.
--
-- Esta migration impõe a invariante no PostgreSQL via composite FK, fechando
-- todos os caminhos de uma vez. Antes, limpa órfãos existentes (1 esperado).

-- 1) Limpa órfãos: câmera com edge de outro site fica SEM edge (preserva a
--    câmera no tenant original; operador pode reapontar manualmente para um
--    edge do site correto).
UPDATE "Camera" c
SET "edgeNodeId" = NULL
FROM "EdgeNode" e
WHERE c."edgeNodeId" = e.id
  AND c."siteId"     <> e."siteId";

-- 2) Composite UNIQUE em EdgeNode(siteId, id). Permite que o composite FK
--    abaixo referencie o par. (id já é PK, mas FK composta exige UNIQUE
--    explícito sobre as colunas referenciadas.)
CREATE UNIQUE INDEX "EdgeNode_siteId_id_key" ON "EdgeNode"("siteId", "id");

-- 3) Substitui o FK simples por composite FK. Mantém ON UPDATE CASCADE
--    + ON DELETE SET NULL (mesmo comportamento de antes).
ALTER TABLE "Camera" DROP CONSTRAINT "Camera_edgeNodeId_fkey";

ALTER TABLE "Camera"
  ADD CONSTRAINT "Camera_siteId_edgeNodeId_fkey"
  FOREIGN KEY ("siteId", "edgeNodeId")
  REFERENCES  "EdgeNode"("siteId", "id")
  ON UPDATE CASCADE
  ON DELETE   SET NULL;
