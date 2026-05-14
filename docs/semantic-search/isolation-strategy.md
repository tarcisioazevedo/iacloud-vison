# Estratégia de isolamento — Semantic Search

**Princípio:** **defesa em profundidade**. Cinco camadas independentes, cada uma sozinha bloqueia vazamento entre tenants.

```
┌─ Camada 1: JWT scope                                              ─┐
│  requireAuth middleware injeta { sub, role, integradorId,          │
│                                  clienteFinalId, allowedCameras }  │
├─ Camada 2: Endpoint role check                                    ─┤
│  /search/semantic: requireRole(SUPER|INTEGRADOR|CLIENTE)           │
├─ Camada 3: applyTenantScope() helper                              ─┤
│  monta WHERE { integradorId } | { clienteFinalId } | TRUE          │
│  com base no role do JWT — NUNCA aceita override do request        │
├─ Camada 4: IVectorStore                                           ─┤
│  TenantScope é parâmetro obrigatório, type-check força            │
│  presença em runtime + compile-time                                │
├─ Camada 5: Postgres RLS (futuro, opt-in)                          ─┤
│  policy USING (integrador_id = current_setting('app.tenant'))      │
└────────────────────────────────────────────────────────────────────┘
```

## Camada 1 — JWT scope

O `requireAuth` middleware (já existe em `middleware/auth.ts`) decodifica o JWT e injeta:

```typescript
req.jwtPayload = {
  sub: 'user-uuid',
  role: 'INTEGRADOR_ADMIN' | 'CLIENTE_ADMIN' | ...,
  integradorId?: 'uuid' | null,        // null = SUPER_ADMIN
  clienteFinalId?: 'uuid' | null,
  allowedCameras?: string[],           // só CLIENTE_VIEWER/AUDITOR
  email?: string,
  iat: number,
  exp: number,
}
```

Token é assinado HS256 com `JWT_SECRET` server-side. Cliente não consegue forjar.

## Camada 2 — Endpoint role check

```typescript
searchRouter.post(
  '/semantic',
  requireAuth,
  requireRole('SUPER_ADMIN', 'INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO',
              'CLIENTE_ADMIN', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER'),
  asyncHandler(handler)
)
```

Roles não-autorizadas recebem `403 Forbidden` antes do handler executar.

## Camada 3 — `applyTenantScope` helper

```typescript
/**
 * Resolve scope do JWT para um filtro de busca semântica.
 * Garante que NENHUMA query vaze entre tenants.
 *
 * Regras:
 * - SUPER_ADMIN: pode passar ?integradorId=X explícito (auditoria registra).
 *                Sem parâmetro = busca todos os tenants.
 * - INTEGRADOR_*: FORÇADO ao próprio integradorId. Ignora qualquer override.
 * - CLIENTE_*: FORÇADO ao próprio clienteFinalId. Ignora override.
 * - CLIENTE_VIEWER/AUDITOR: + intersect com allowedCameras.
 */
export function applyTenantScope(
  jwt: JwtPayload,
  requestedIntegradorId?: string,
  requestedCameraIds?: string[],
): TenantScope {
  const isSuper = jwt.role === 'SUPER_ADMIN' || jwt.role === 'ADMIN_GLOBAL'
  const isInteg = jwt.role.startsWith('INTEGRADOR_')
  const isClient = jwt.role.startsWith('CLIENTE_')

  if (isSuper) {
    return {
      integradorId: requestedIntegradorId ?? null,   // opcional
      clienteFinalId: null,
      cameraIds: requestedCameraIds ?? null,
    }
  }

  if (isInteg) {
    if (!jwt.integradorId) throw new ForbiddenError('JWT sem integradorId')
    return {
      integradorId: jwt.integradorId,                // FORÇADO
      clienteFinalId: null,
      cameraIds: requestedCameraIds ?? null,
    }
  }

  if (isClient) {
    if (!jwt.clienteFinalId) throw new ForbiddenError('JWT sem clienteFinalId')
    let cameraIds = requestedCameraIds ?? null
    if (jwt.role === 'CLIENTE_VIEWER' || jwt.role === 'CLIENTE_AUDITOR') {
      // Intersect com allowedCameras — não confia em requestedCameraIds
      cameraIds = (cameraIds ?? jwt.allowedCameras ?? [])
        .filter(id => (jwt.allowedCameras ?? []).includes(id))
    }
    return {
      integradorId: null,
      clienteFinalId: jwt.clienteFinalId,             // FORÇADO
      cameraIds,
    }
  }

  throw new ForbiddenError(`Role não autorizada para semantic search: ${jwt.role}`)
}
```

Testes obrigatórios (em `__tests__/tenant-scope.test.ts`):
- ✅ INTEGRADOR_ADMIN tentando passar `integradorId=X` (de outro tenant) → ignorado, scope = próprio
- ✅ CLIENTE_VIEWER passando `cameraIds=[a, b]` onde `b` não está em `allowedCameras` → b filtrado fora
- ✅ SUPER_ADMIN sem `integradorId` → scope `{ integradorId: null }` (busca global)
- ✅ Role inválida → ForbiddenError

## Camada 4 — `IVectorStore` type-safe

```typescript
export interface TenantScope {
  integradorId: string | null    // null só permitido para SUPER_ADMIN
  clienteFinalId: string | null
  cameraIds: string[] | null
}

export interface IVectorStore {
  search(query: Float32Array, opts: {
    modality: 'caption' | 'image' | 'merge'
    tenantScope: TenantScope    // ← obrigatório, parâmetro nomeado
    fromDate?: Date
    toDate?: Date
    limit: number
  }): Promise<SearchHit[]>
}
```

A implementação `PgVectorStore.search()` constrói o WHERE assim:

```sql
WHERE
  -- camada de isolamento ── nunca opcional
  (
    -- SUPER_ADMIN
    ${tenantScope.integradorId === null AND tenantScope.clienteFinalId === null ? 'TRUE' : 'FALSE'}
    OR integrador_id = ${tenantScope.integradorId}
    OR cliente_final_id = ${tenantScope.clienteFinalId}
  )
  -- camera scoping (se CLIENTE_VIEWER/AUDITOR)
  AND (
    ${tenantScope.cameraIds === null ? 'TRUE' : `camera_id = ANY(${tenantScope.cameraIds})`}
  )
  -- filtros temporais
  AND ${fromDate ? `recorded_at >= ${fromDate}` : 'TRUE'}
  AND ${toDate ? `recorded_at <= ${toDate}` : 'TRUE'}
```

Tipo `TenantScope` impede passar `null` em ambos sem ser SUPER_ADMIN (compile-time check via discriminated union).

## Camada 5 — Postgres RLS (futuro)

Opt-in via env var `ENABLE_RLS=true`. Quando ativado, connection pool executa em cada request:

```sql
SET LOCAL app.role = 'INTEGRADOR_ADMIN';
SET LOCAL app.integrador_id = '<uuid>';
SET LOCAL app.cliente_final_id = '<uuid-or-null>';
```

E policies:

```sql
CREATE POLICY df_tenant_isolation ON "DetectionFrame"
  USING (
    current_setting('app.role', true) IN ('SUPER_ADMIN', 'ADMIN_GLOBAL')
    OR integrador_id::text = current_setting('app.integrador_id', true)
    OR cliente_final_id::text = current_setting('app.cliente_final_id', true)
  );
```

Mesmo se um endpoint **esquecer** o WHERE, o Postgres recusa as linhas. **Não ativar agora** — exige rebuild de todo o pool com cuidado. Documento de migração futura: `rls-rollout.md` (a criar).

## Caso especial — SUPER_ADMIN cross-tenant

Super admin precisa de busca global ("achar carro azul em qualquer tenant") para suporte, mas isso é **sensível**. Mitigações:

1. **Audit obrigatório:** toda query com `tenantScope.integradorId === null` registra metadata `cross_tenant: true` no `StorageAccessLog`.
2. **Banner UX:** frontend mostra avisa "🌐 Buscando em todos os tenants" em vermelho quando search global.
3. **Rate limit reforçado:** 10 queries cross-tenant/hora vs 100 queries por-tenant/hora.
4. **2FA step-up:** futuro — exigir 2FA recente (< 5min) para queries cross-tenant.

## Caso especial — Cliente Final compartilhado entre integradores

Hoje não existe (1 ClienteFinal pertence a 1 Integrador), mas se virar requisito:

```typescript
// jwt.allowedClientes = ['cf-uuid-1', 'cf-uuid-2'] (multi-integrador)
applyTenantScope() {
  if (isClient && jwt.allowedClientes) {
    return { clienteFinalId: null, integradorId: null,
             clienteFinalIds: jwt.allowedClientes, cameraIds }
  }
}
```

`IVectorStore` ganharia overload: `clienteFinalIds: string[]` no `TenantScope`. Pequena mudança, não invalida arquitetura.

## Resumo de testes obrigatórios

Em `__tests__/tenant-isolation.test.ts`:

| # | Cenário | Esperado |
|---|---|---|
| 1 | INTEGRADOR A busca, vetores de INTEGRADOR B no DB | 0 hits |
| 2 | CLIENTE C1 busca, vetores de C2 (mesmo integrador) | 0 hits |
| 3 | CLIENTE_VIEWER busca câmera fora de `allowedCameras` | 0 hits para essa câmera |
| 4 | INTEGRADOR tenta override `?integradorId=B` na query | scope cai pro próprio, request loga warning |
| 5 | SUPER_ADMIN sem filtro | retorna mix de tenants, audit `cross_tenant: true` |
| 6 | SUPER_ADMIN com `?integradorId=X` | só tenant X, audit registra |
| 7 | JWT expirado | 401 antes do handler |
| 8 | JWT sem `integradorId` mas role INTEGRADOR | 403 ForbiddenError |
| 9 | RLS ativado, endpoint esquece WHERE | Postgres retorna 0 linhas (defesa-em-profundidade) |
| 10 | Concurrent queries de tenants diferentes | conexões isoladas, sem leak via session vars |
