-- Camera: impede dois nomes idênticos no mesmo site (mesmo tenant).
--
-- Antes desta constraint era possível criar duas câmeras "Entrada Principal"
-- no mesmo site — a listagem mostrava duas linhas iguais (sem ID exposto)
-- e o operador não conseguia diferenciar.
--
-- Pre-flight: se a sua base já tiver duplicatas, esta migration vai falhar.
-- Para resolver, RENOMEIE manualmente as duplicatas antes de aplicar:
--
--   UPDATE "Camera" c1
--   SET    name = c1.name || ' (' || substr(c1.id, 1, 4) || ')'
--   WHERE  EXISTS (
--     SELECT 1 FROM "Camera" c2
--     WHERE c2."siteId" = c1."siteId" AND c2.name = c1.name AND c2.id < c1.id
--   );

CREATE UNIQUE INDEX "Camera_siteId_name_unique" ON "Camera"("siteId", "name");
