# B-3b — Plano de Ativação de RLS em PostgreSQL

**Status:** PLANEJADO · não executar em produção sem leitura completa.
**Bloqueador resolvido por este plano:** Auditoria 2026-06-15, item B-3 (Postgres sem RLS — isolamento 100% na aplicação).

---

## Por que executar incrementalmente

RLS (Row-Level Security) ativado de uma vez em todas as tabelas tenant-scoped pode:

1. **Quebrar queries existentes** que assumem ver tudo (jobs cron, exports admin, migrations futuras).
2. **Falhar silenciosamente** se o middleware Prisma não setar `app.tenant_id` numa transação — query retorna `[]` sem erro.
3. **Conflitar com PgBouncer** em modo `transaction` se `SET LOCAL` não for honrado entre commands.

Por isso o plano abaixo é **5 fases progressivas**, cada uma reversível.

---

## Pré-requisitos (verificar antes de Fase 1)

```bash
# 1. PgBouncer está em qual modo?
docker exec vsaas_pgbouncer cat /etc/pgbouncer/pgbouncer.ini | grep pool_mode
#    Se for "transaction" → SET LOCAL funciona dentro de transação Prisma OK
#    Se for "statement"   → NÃO funciona, precisa ir pra "session" ou "transaction"
#    Se for "session"     → funciona mas reduz throughput

# 2. Existe usuário Postgres dedicado para a app (sem SUPERUSER)?
# RLS é bypassed por SUPERUSER. Se a app conecta como icvuser e icvuser
# é SUPERUSER, RLS não vai filtrar nada.
docker exec vsaas_postgres psql -U icvuser -d vsaas -c \
  "SELECT rolname, rolsuper FROM pg_roles WHERE rolname='icvuser'"
#    Se rolsuper=t → criar usuário icvapp não-super e migrar conexões pra ele
```

---

## Fase 1 — Infraestrutura (15min, zero impacto)

Cria função helper + GUC config. Não habilita RLS ainda.

```sql
-- prisma/migrations/20260625170000_rls_phase1_helpers/migration.sql

-- Função que lê o tenant_id da sessão (settable via SET LOCAL app.tenant_id)
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
DECLARE
  v_id TEXT;
BEGIN
  v_id := current_setting('app.tenant_id', true);  -- true = NULL se não setado
  IF v_id IS NULL OR v_id = '' THEN
    RETURN NULL;
  END IF;
  RETURN v_id::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION current_tenant_id() IS
  'B-3b RLS: lê app.tenant_id da sessão. App deve fazer SET LOCAL app.tenant_id antes de cada transação. NULL = sem scope (rejeita queries em modo enforce).';

-- Função para identificar SUPER_ADMIN (bypass de RLS quando setado)
CREATE OR REPLACE FUNCTION current_is_super_admin() RETURNS BOOLEAN AS $$
BEGIN
  RETURN current_setting('app.is_super_admin', true) = 'true';
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;
```

Validação Fase 1:
```sql
-- Sem SET LOCAL → NULL
SELECT current_tenant_id();   -- esperado: NULL

-- Com SET LOCAL → valor
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
SELECT current_tenant_id();   -- esperado: 00000000-0000-0000-0000-000000000001
COMMIT;
```

---

## Fase 2 — Prisma middleware "shadow mode" (1h)

Adiciona em `src/lib/prisma.ts` middleware que, em cada `$transaction`, faz `SET LOCAL app.tenant_id`. Modo "shadow": só seta a var, sem habilitar policy ainda. Permite observar via log se algum lugar não passa tenant.

```ts
// Pseudo-código — incluir em prisma.ts após o $extends existente

const RLS_MODE = (process.env.RLS_MODE ?? 'off').toLowerCase()  // off | shadow | enforce

if (RLS_MODE !== 'off') {
  const original$transaction = basePrisma.$transaction.bind(basePrisma)
  basePrisma.$transaction = async (arg: any, opts: any) => {
    // Pega tenant do AsyncLocalStorage (precisa middleware Express que seta)
    const tenant = require('./tenant-context').getCurrentTenantId()
    return original$transaction(async (tx: any) => {
      if (tenant) {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenant}'`)
      } else if (RLS_MODE === 'enforce') {
        throw new Error('RLS enforce mode: transação sem tenant_id')
      }
      return typeof arg === 'function' ? arg(tx) : Promise.all(arg.map((p: any) => p))
    }, opts)
  }
}
```

Para queries fora de `$transaction` (a maioria), precisa wrap implícito. Alternativa: usar Prisma client extension que injeta `$executeRaw` antes de cada query — mais complexo.

**Decisão arquitetural a tomar nesta fase:** topa exigir que toda query passe por `$transaction({ tenantId })`? Se sim → refactor de algumas centenas de chamadas. Se não → middleware no nível HTTP usando AsyncLocalStorage (Node.js) pra atrelar tenant à request inteira.

Recomendação: AsyncLocalStorage no middleware `requireAuth`. Setar `als.run({ tenantId: jwt.integradorId }, ...)` envolvendo o handler.

---

## Fase 3 — RLS em 1 tabela isolada (POC) — `EvidenceVault` (30min)

`EvidenceVault` é nova, baixo volume, fácil de testar.

```sql
-- prisma/migrations/20260625170100_rls_phase3_evidence_vault/migration.sql

ALTER TABLE "EvidenceVault" ENABLE ROW LEVEL SECURITY;

-- Policy: tenant pode ver apenas as próprias evidências.
-- tenantId em EvidenceVault é clienteFinalId OU integradorId (depende do JWT).
-- Aqui usamos o campo `tenantId` que já existe no schema.
CREATE POLICY evidence_vault_tenant_isolation ON "EvidenceVault"
  USING (
    current_is_super_admin()
    OR tenantId = current_tenant_id()::TEXT
  )
  WITH CHECK (
    current_is_super_admin()
    OR tenantId = current_tenant_id()::TEXT
  );
```

Validação Fase 3:
```sql
-- Set tenant A → vê só do A
BEGIN;
SET LOCAL app.tenant_id = '<uuid-tenant-A>';
SELECT count(*) FROM "EvidenceVault";  -- só do A
COMMIT;

-- Set tenant B → vê só do B
BEGIN;
SET LOCAL app.tenant_id = '<uuid-tenant-B>';
SELECT count(*) FROM "EvidenceVault";  -- só do B
COMMIT;

-- Sem set → vê 0
SELECT count(*) FROM "EvidenceVault";  -- 0 (current_tenant_id=NULL)

-- Super admin
BEGIN;
SET LOCAL app.is_super_admin = 'true';
SELECT count(*) FROM "EvidenceVault";  -- tudo
COMMIT;
```

Rollback Fase 3 (se quebrar):
```sql
ALTER TABLE "EvidenceVault" DISABLE ROW LEVEL SECURITY;
DROP POLICY evidence_vault_tenant_isolation ON "EvidenceVault";
```

---

## Fase 4 — Expandir gradualmente (1 tabela por dia)

Ordem sugerida (do mais isolado pro mais cross-tenant):

| Dia | Tabela | Coluna tenant | Risco |
|---|---|---|---|
| D+1 | `EvidenceVault` | tenantId | Baixo (POC já feito) |
| D+2 | `Bookmark` | tenantId | Baixo |
| D+3 | `ReviewItem` | via camera.site.clienteFinal | Médio (join) |
| D+4 | `FaceEvent` / `PlateEvent` | clienteFinalId | Médio |
| D+5 | `RecordingSegment` | via camera.site.clienteFinal | **Alto** (volume + jobs) |
| D+6 | `Camera` | via site.clienteFinal | **Alto** (admin views) |
| D+7 | `Site` | clienteFinalId | Médio |
| D+8 | `ClienteFinal` | integradorId | Médio |
| D+9 | `User` | integradorId OR clienteFinalId | Alto (auth flows) |
| D+10 | `AuditLog` | tenantScopeFilter já cobre — RLS é defense-in-depth | Baixo |

Para tabelas onde tenant está via JOIN (Camera → Site → ClienteFinal → Integrador), policy precisa de subquery:

```sql
CREATE POLICY camera_tenant_isolation ON "Camera"
  USING (
    current_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM "Site" s
      JOIN "ClienteFinal" cf ON cf.id = s."clienteFinalId"
      WHERE s.id = "Camera"."siteId"
        AND cf."integradorId" = current_tenant_id()
    )
  );
```

⚠ Subqueries em policy podem degradar performance em queries grandes. Profile antes de produção.

---

## Fase 5 — Enforce mode (1 semana após Fase 4 terminar limpa)

```bash
# .env
RLS_MODE=enforce
```

Agora qualquer transação sem `SET LOCAL app.tenant_id` falha. Pega bugs do tipo "job esqueceu de setar tenant" antes de virar vazamento.

---

## Resumo executivo

- **Esforço real:** ~24-30h spread em 2-3 semanas (incremental, com observação entre fases)
- **Risco se rolar errado:** queries retornando vazio → operação para
- **Mitigação:** modo `shadow` antes de `enforce`, rollback por tabela é trivial
- **Defense-in-depth:** mesmo com RLS, manter `cameraTenantWhere` na aplicação. RLS é cinto E suspensórios

## Quando começar

Recomendação: após B-4 (findUnique IDOR) estar 100% (lint:tenant-scope strict no CI bloqueando). Aí o app já está consistentemente passando tenant filter, e RLS vira proteção complementar contra novos commits descuidados.

**Não iniciar Fase 3 sem fazer Fases 1+2 e validar em STAGING idêntico a produção primeiro.**
