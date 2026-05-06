# Plano — White-label + Pricing Multi-tenant

> **Data:** 2026-05-06 · **Status:** Em construção (Sprint D em andamento)
> **Contexto:** o Pricing CMS global do fabricante (`/admin/pricing`) já está
> entregue. Este documento define como Pricing vira uma **capability** do
> White-label, com cascade SUPER_ADMIN → INTEGRADOR → CLIENTE_FINAL (Modelo D).

---

## 1. Decisões fechadas (2026-05-06)

| # | Decisão | Resposta |
|---|---------|----------|
| 1 | `AdminPricingPage` é polimórfico ou novo escopo paralelo? | **Polimórfico** — mesmo componente; integrador vê o herdado do master e pode dar override. |
| 2 | Modelo de override por integrador | **Mistura** — herda do master, pode "destacar" um plano e editar livre. **Restrição:** `priceMonthly` do override **NUNCA** pode ser menor que o `wholesalePriceMonthly` do master correspondente. |
| 3 | Capability "pricing" default por tier | **NONE** ❌ · **BASIC** ❌ (só com flag explícita do admin) · **PRO** ✅ · **ENTERPRISE** ✅ + `clientCustomization` |

---

## 2. Modelo conceitual

```
SUPER_ADMIN (fabricante)
  ├─ /admin/pricing                      ← edita /pricing master de app.iacloud.com.br
  └─ /admin/whitelabel/:integradorId
      ├─ tier:        NONE | BASIC | PRO | ENTERPRISE
      └─ capabilities: { pricing, branding, domain, email, clientCustomization }

INTEGRADOR (capability "pricing" liberada)
  └─ /me/whitelabel  ← hub único
      ├─ Branding   (logo, cores, nome)
      ├─ Domínio    (CustomDomain)
      ├─ Pricing    (override do master, com floor = wholesale)  ← NOVO
      └─ E-mail SMTP (Fase 2 — placeholder)

CLIENTE FINAL (cascade do integrador autorizando)
  └─ /minha-empresa/branding  ← Modelo D — só capabilities que integrador
                                permitiu, dentro das que SUPER_ADMIN liberou
                                pra ele
```

---

## 3. Schema (Prisma) — alterações

### 3.1 `Integrador` ganha tier + capabilities

```prisma
enum WhitelabelTier {
  NONE        // sem white-label — usa marca IA Cloud Vision
  BASIC       // só logo + cores
  PRO         // + domínio próprio + pricing
  ENTERPRISE  // + cliente final pode customizar (cascade Modelo D)
}

model Integrador {
  // ...existente...
  whitelabelTier         WhitelabelTier @default(NONE)
  /// JSON com flags. null → defaults do tier (ver service). Permite override
  /// granular: { pricing: false } num PRO força desligar mesmo com tier alto.
  whitelabelCapabilities Json?
}
```

### 3.2 `PlatformPlan` ganha escopo + floor

```prisma
model PlatformPlan {
  // ...existente...
  /// null = master (do fabricante); uuid = override de um integrador
  tenantId            String?
  /// Quando isOverride=true, este registro herda do master de mesmo `slug`
  /// e modifica só os campos preenchidos (price/highlights/etc).
  isOverride          Boolean @default(false)
  /// Custo de atacado: o que o integrador paga AO FABRICANTE pelo plano.
  /// Define o piso de `priceMonthly` em qualquer override (validação server).
  /// Só preenchido em planos master (tenantId=null).
  wholesalePriceMonthly Decimal? @db.Decimal(10, 2)

  // antes: @@unique([slug])
  // agora: composto (master + 1 override por slug por integrador)
  @@unique([tenantId, slug])
  @@index([tenantId, archived, publicVisible])
}
```

**Migration:**
1. `ALTER TABLE` adicionando colunas (com defaults seguros)
2. `DROP CONSTRAINT "PlatformPlan_slug_key"; ADD CONSTRAINT "PlatformPlan_tenantId_slug_key" UNIQUE (tenantId, slug)`

### 3.3 Capabilities default por tier (service-level, não DB)

```ts
const TIER_DEFAULTS: Record<WhitelabelTier, Capabilities> = {
  NONE:       { branding: false, domain: false, pricing: false, email: false, clientCustomization: false },
  BASIC:      { branding: true,  domain: false, pricing: false, email: false, clientCustomization: false },
  PRO:        { branding: true,  domain: true,  pricing: true,  email: true,  clientCustomization: false },
  ENTERPRISE: { branding: true,  domain: true,  pricing: true,  email: true,  clientCustomization: true  },
}
```

`getWhitelabelCapabilities(integradorId)`:
1. Lê `tier` + `whitelabelCapabilities` do integrador
2. Aplica `{ ...TIER_DEFAULTS[tier], ...overrides }`
3. Retorna struct unificada

---

## 4. Backend — endpoints

### 4.1 SUPER_ADMIN (já existem ou novos)

| Endpoint | Status | Descrição |
|---|---|---|
| `GET /admin/pricing/full` | ✅ feito | Master snapshot (CMS global) |
| `PATCH /admin/pricing/plans/:slug` | ✅ feito | Edita master; **passa a aceitar `wholesalePriceMonthly`** |
| `PUT /admin/whitelabel/:integradorId/tier` | 🆕 | Muda tier; só SUPER_ADMIN |
| `PATCH /admin/whitelabel/:integradorId/capabilities` | 🆕 | Override granular |
| `GET /admin/whitelabel/:integradorId` | 🆕 | Mostra tier + capabilities resolvidas |

### 4.2 INTEGRADOR (novos, gated por capability)

Todos protegidos por `requireWhitelabelCapability('pricing')`:

| Endpoint | Descrição |
|---|---|
| `GET /me/integrador/pricing/full` | Master + overrides do tenant logado, mergeados |
| `POST /me/integrador/pricing/plans/:slug/override` | Cria override; valida `priceMonthly >= wholesalePriceMonthly` (master) |
| `PATCH /me/integrador/pricing/plans/:slug` | Edita override existente; mesma validação |
| `DELETE /me/integrador/pricing/plans/:slug/override` | Remove override → volta a herdar master |

**Resolver de pricing público (Cloudflare Worker / backend):**
- Request em `<slug>.iacloud.com.br/pricing`
- Worker injeta `X-ICV-Tenant: <integradorId>` (já existe — `tenantContext` middleware)
- Backend serve **mergeado**: planos master, exceto onde houver override do tenant
- Se tenant não tem capability `pricing`, retorna só master (mesmo conteúdo do `app.iacloud.com.br`)

### 4.3 Validação de floor (server-side)

```ts
async function assertFloor(masterSlug: string, newPrice: number) {
  const master = await prisma.platformPlan.findUnique({
    where: { tenantId_slug: { tenantId: null, slug: masterSlug } }
  })
  if (!master?.wholesalePriceMonthly) return // sem floor configurado
  const floor = Number(master.wholesalePriceMonthly)
  if (newPrice < floor) {
    throw httpError(400, 'price_below_wholesale_floor', { floor })
  }
}
```

UI mostra o floor pra UX boa (não deixa o integrador chegar a tentar abaixar pra descobrir só no save).

---

## 5. Frontend — refactor

### 5.1 `AdminPricingPage` polimórfico

```tsx
<PricingCMS scope="global" />                // SUPER_ADMIN, edita master
<PricingCMS scope="tenant" tenantId={...} /> // INTEGRADOR, edita overrides
```

Diferenças por scope:
- **global**: edita tudo. Mostra campo `wholesalePriceMonthly`.
- **tenant**: vê master read-only com botão "Personalizar"; ao destacar, abre form com floor visível e validação client-side. Botão "Voltar ao master" remove override.

### 5.2 Hub `/me/whitelabel` (novo)

Layout: header com `WhitelabelTierBadge` (NONE/BASIC/PRO/ENTERPRISE) + capabilities ativas.
Sub-tabs filtradas por capability:
- **Branding** (sempre que `branding=true`) — herda `IntegradorThemePage` existente
- **Domínio** (`domain=true`) — herda `CustomDomainsPage`
- **Pricing** (`pricing=true`) — `<PricingCMS scope="tenant" />` 🆕
- **E-mail** (`email=true`) — placeholder Fase 2

Se nenhuma capability ativa → tela "Faça upgrade pra liberar white-label" com CTA pro consultor.

### 5.3 Sidebar — reorg

**SUPER_ADMIN (Plataforma):**
- ✂️ Remove `💰 Pricing CMS` solto (foi adicionado no Sprint C, agora vira sub-tab do White-label)
- Mantém `🎨 White-label` (passa a ser hub: lista integradores + edição de tier/caps + acesso ao master pricing)

**INTEGRADOR (Minha Empresa):**
- ✂️ Remove `🎨 Theme Builder` + `🌐 Meu Domínio` separados
- Adiciona único `🎨 White-label` (hub `/me/whitelabel`)

**CLIENTE FINAL (Configuração):**
- 🆕 `🎨 Personalização` (visível só se integrador autorizar via Modelo D — capability `clientCustomization`)

---

## 6. Cascade — Modelo D (cliente final)

Reservada pra **Fase 2** desta refatoração. Premissa:

```
fabricante.WhitelabelTier=ENTERPRISE
   AND fabricante.capabilities.clientCustomization=true
   ↓
integrador.allowClientCustomization=true (toggle por cliente)
   ↓
ClienteFinalBranding (nova model) — limitado a {logo, primaryColor}
                                   só nos campos que integrador autorizou
```

Não vou implementar essa parte agora (escopo do Sprint G é só hub do integrador). Documentado pra a próxima onda.

---

## 7. Sprints

| Sprint | Escopo | Estimativa |
|---|---|---|
| **D** | Schema (tier, caps, tenantId, wholesale) + migration + service `resolveCapabilities` + middleware `requireWhitelabelCapability` | 4-5h |
| **E** | Endpoints `/me/integrador/pricing/*` com merge + floor validation | 3h |
| **F** | Endpoints `/admin/whitelabel/:id/*` + campo `wholesalePriceMonthly` no master | 2h |
| **G** | Frontend: `<PricingCMS scope/>`, hub `/me/whitelabel`, sub-tabs filtradas | 4-6h |
| **H** | Sidebar reorg + remove entradas duplicadas + nav guards por capability | 1-2h |

**Total: ~15-18h** spread. Cada sprint é independente — pode parar entre eles.

---

## 8. Riscos / pontos sensíveis

1. **Constraint `slug @unique` → composto**: PostgreSQL bloqueia a operação se houver duplicatas. Hoje master é o único, então OK, mas migração precisa ser feita ANTES de qualquer override existir.
2. **Floor wholesale**: integrador pode reclamar. UX precisa explicar com clareza que é margem mínima do fabricante (não "é seu lucro mínimo").
3. **Sub-tabs do hub**: capabilities resolvidas no client + server. Se cliente bypassa, server bloqueia (defesa em profundidade).
4. **Cache do `/pricing` público**: já tem invalidação por edits do master. Adicionar invalidação **por tenantId** quando override mudar (cache keyed por tenant).
5. **Sidebar `Pricing CMS` solto** (entregue ontem): vai ser removido. Não causa quebra — todos URLs continuam válidos via white-label hub.

---

## 9. O que NÃO está no escopo (mais tarde)

- Modelo D do cliente final (Sprint I+)
- E-mail SMTP por integrador (Fase 2)
- Pricing por moeda múltipla (`PricingSettings.defaultCurrency` já existe; sem multi-currency real ainda)
- Marketplace de templates de branding (futurissimo)
