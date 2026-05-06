-- Migração definitiva: troca IDs legacy (slugs `int-*`, `cf-*`, `site-*`,
-- `en-*`, `usr-*`) por UUIDs gerados pelo Postgres. Todas as ~40 FKs
-- têm `ON UPDATE CASCADE`, então um UPDATE no registro raiz cascateia
-- automaticamente em todas as tabelas filhas.
--
-- Execução: psql idempotente em transação BEGIN/COMMIT.
-- Aceita re-rodar (no-op se IDs já estiverem em UUID).
--
-- Backup obrigatório antes de rodar:
--   docker exec iacloud_postgres pg_dump -U icvuser -Fc iacloudvision > backup.dump
--
-- Restore (se algo der errado):
--   docker exec -i iacloud_postgres pg_restore -U icvuser -d iacloudvision --clean --if-exists < backup.dump
--
-- Pós-migração: rotacionar JWT_SECRET (ou aceitar que sessions ativas vão
-- falhar 401 e usuários precisarão relogar — login funciona por email,
-- não por id).

\set ON_ERROR_STOP on

\echo '==========================================='
\echo 'Migração legacy ID → UUID — INICIANDO'
\echo '==========================================='

-- Garante extensão pgcrypto (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

\echo ''
\echo '── Counts ANTES da migração ──'
SELECT 'Integrador'   as tabela, count(*) FROM "Integrador"
UNION ALL SELECT 'ClienteFinal', count(*) FROM "ClienteFinal"
UNION ALL SELECT 'Site',         count(*) FROM "Site"
UNION ALL SELECT 'EdgeNode',     count(*) FROM "EdgeNode"
UNION ALL SELECT 'Camera',       count(*) FROM "Camera"
UNION ALL SELECT 'User',         count(*) FROM "User"
UNION ALL SELECT 'AuditLog',     count(*) FROM "AuditLog"
UNION ALL SELECT 'Site→ClienteFinal',     count(*) FROM "Site" s WHERE EXISTS (SELECT 1 FROM "ClienteFinal" c WHERE c.id=s."clienteFinalId")
UNION ALL SELECT 'EdgeNode→Site',         count(*) FROM "EdgeNode" e WHERE EXISTS (SELECT 1 FROM "Site" s WHERE s.id=e."siteId");

\echo ''
\echo '── IDs legacy a serem migrados ──'
SELECT 'Integrador' as t, id FROM "Integrador" WHERE id !~ '^[0-9a-f]{8}-'
UNION ALL SELECT 'ClienteFinal', id FROM "ClienteFinal" WHERE id !~ '^[0-9a-f]{8}-'
UNION ALL SELECT 'Site',         id FROM "Site"         WHERE id !~ '^[0-9a-f]{8}-'
UNION ALL SELECT 'EdgeNode',     id FROM "EdgeNode"     WHERE id !~ '^[0-9a-f]{8}-'
UNION ALL SELECT 'User',         id FROM "User"         WHERE id !~ '^[0-9a-f]{8}-'
ORDER BY 1, 2;

BEGIN;

-- Ordem de UPDATE: do mais raiz (Integrador) para o mais leaf, embora
-- com CASCADE a ordem técnica não importa. Mantemos para legibilidade.
-- Cada linha legacy ganha um UUID gerado em runtime; FKs cascateiam
-- automaticamente para tabelas filhas.

\echo ''
\echo '── Migrando Integrador ──'
UPDATE "Integrador"
   SET id = gen_random_uuid()::text
 WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

\echo '── Migrando ClienteFinal ──'
UPDATE "ClienteFinal"
   SET id = gen_random_uuid()::text
 WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

\echo '── Migrando Site ──'
UPDATE "Site"
   SET id = gen_random_uuid()::text
 WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

\echo '── Migrando EdgeNode ──'
UPDATE "EdgeNode"
   SET id = gen_random_uuid()::text
 WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

\echo '── Migrando User ──'
UPDATE "User"
   SET id = gen_random_uuid()::text
 WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Camera não tem registros legacy hoje, mas defensive update garante:
\echo '── Migrando Camera (defensive) ──'
UPDATE "Camera"
   SET id = gen_random_uuid()::text
 WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

COMMIT;

\echo ''
\echo '==========================================='
\echo 'Migração CONCLUÍDA — validação pós:'
\echo '==========================================='

\echo ''
\echo '── Counts DEPOIS da migração (devem bater) ──'
SELECT 'Integrador'   as tabela, count(*) FROM "Integrador"
UNION ALL SELECT 'ClienteFinal', count(*) FROM "ClienteFinal"
UNION ALL SELECT 'Site',         count(*) FROM "Site"
UNION ALL SELECT 'EdgeNode',     count(*) FROM "EdgeNode"
UNION ALL SELECT 'Camera',       count(*) FROM "Camera"
UNION ALL SELECT 'User',         count(*) FROM "User"
UNION ALL SELECT 'AuditLog',     count(*) FROM "AuditLog"
UNION ALL SELECT 'Site→ClienteFinal',     count(*) FROM "Site" s WHERE EXISTS (SELECT 1 FROM "ClienteFinal" c WHERE c.id=s."clienteFinalId")
UNION ALL SELECT 'EdgeNode→Site',         count(*) FROM "EdgeNode" e WHERE EXISTS (SELECT 1 FROM "Site" s WHERE s.id=e."siteId");

\echo ''
\echo '── Verificando que NENHUM ID legacy sobrou ──'
SELECT 'Integrador' as t, id FROM "Integrador" WHERE id !~ '^[0-9a-f]{8}-'
UNION ALL SELECT 'ClienteFinal', id FROM "ClienteFinal" WHERE id !~ '^[0-9a-f]{8}-'
UNION ALL SELECT 'Site',         id FROM "Site"         WHERE id !~ '^[0-9a-f]{8}-'
UNION ALL SELECT 'EdgeNode',     id FROM "EdgeNode"     WHERE id !~ '^[0-9a-f]{8}-'
UNION ALL SELECT 'User',         id FROM "User"         WHERE id !~ '^[0-9a-f]{8}-'
UNION ALL SELECT 'Camera',       id FROM "Camera"       WHERE id !~ '^[0-9a-f]{8}-';
-- Resultado esperado: 0 linhas

\echo ''
\echo '── Verificando integridade FK (FKs órfãs) ──'
-- Se aparecer alguma linha aqui, é bug do CASCADE
SELECT 'Site sem ClienteFinal' as orfao, count(*) FROM "Site" s WHERE NOT EXISTS (SELECT 1 FROM "ClienteFinal" c WHERE c.id = s."clienteFinalId")
UNION ALL SELECT 'EdgeNode sem Site',         count(*) FROM "EdgeNode" e WHERE NOT EXISTS (SELECT 1 FROM "Site" s WHERE s.id = e."siteId")
UNION ALL SELECT 'ClienteFinal sem Integrador', count(*) FROM "ClienteFinal" c WHERE NOT EXISTS (SELECT 1 FROM "Integrador" i WHERE i.id = c."integradorId")
UNION ALL SELECT 'Camera sem Site',             count(*) FROM "Camera" cam WHERE cam."siteId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Site" s WHERE s.id = cam."siteId");
-- Resultado esperado: todos zero
