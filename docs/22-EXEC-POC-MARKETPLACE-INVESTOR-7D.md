# 22 — EXEC POC Marketplace Investidor (7 dias completos)

> **Data:** 2026-05-09 · **Status:** Plano de execução aprovado para iniciar
> **Autor:** Tarcísio (drafted by Claude — staff engineer)
> **Executa:** `docs/18-PLAN-MARKETPLACE-3-NIVEIS-PREMIUM.md` + `docs/21-PLAN-GOOGLE-VIDEO-AI-B2B2B.md`
> **Base:** `docs/16-PLAN-WHITELABEL-PRICING-MULTITENANT.md` (capability + wholesale floor já em prod)
> **Modo Asaas:** scaffold completo, ativação por flag `ASAAS_DEMO_MODE` quando tokens chegarem.
> **Objetivo:** rodar pitch matador para investidor em 7 dias úteis solo (Tarcísio + Claude).

---

## 0. Tese do pitch (1 frase)

> "Compramos IA da Google em USD; vendemos em BRL para integradores via marketplace self-service; integradores configuram markup e revendem ao cliente final; o admin enxerga em tempo real custo Google × receita × margem por integrador, e bloqueia/ativa SKU com 1 clique."

## 1. Princípios de execução

1. **Reusar antes de escrever.** PlatformPlan + AIAddonPlan + AsaasCustomer + multi-tenant pricing já existem. Estender, não duplicar.
2. **Asaas em scaffold.** Services e routes prontos, mas com guard `if (process.env.ASAAS_DEMO_MODE === '1') return mock()`. Ativação = trocar 1 env var quando tokens chegarem.
3. **Mock realista por padrão.** Vertex/Vision/Gemini/Asaas todos com mock determinístico que **parece real no pitch**. Se houver creds GCP de demo, ligar em D7 (não bloquear D1-D6).
4. **UI demonstrável > UI bonita.** Glass + Tailwind do tema atual. Sem refactor de design system — só extensão de `<GlassCard>` existente.
5. **Demo flow > coverage de testes.** Smoke-test do happy path. Edge cases viram backlog.
6. **Commits pequenos e legíveis.** 1 commit por feature. PRs separados por dia.
7. **Documento vivo.** Cada dia atualiza este doc com o que ficou pendente — vai virar handoff para sprint pós-pitch.

## 2. Stack mínima usada

- Backend: Express + Prisma 5 + PostgreSQL 16 (já existente)
- Frontend: React 19 + Vite + Tailwind + Framer Motion + shadcn-style components (já existente)
- IA: `vertex.service.ts`, `vertex-face.service.ts`, `vision.service.ts` (já existentes; modo mock por default)
- Cobrança: Asaas (scaffold) — flag `ASAAS_DEMO_MODE`
- Demo: 1 câmera real RTSP (preferência) ou loop de vídeo (fallback)

## 3. Cronograma — 7 dias úteis

| Dia | Tema | Demonstrável? | Tempo |
|---|---|---|---|
| **D1** | Schema + migration + seed 11 SKUs `ai-*` | não | 6h |
| **D2** | Services backend (product, cart, order, subscription, usage-meter, order-provisioner, asaas-scaffold) | não | 8h |
| **D3** | Routes backend (marketplace, cart, orders, me-marketplace, portal-marketplace, admin-marketplace, usage) | API testável Postman | 6h |
| **D4** | Vitrine integrador (`/me/marketplace`) — cards + drawer + ROI calc + carrinho | ✅ "comprando LPR" | 7h |
| **D5** | Mix revenda (`/me/marketplace/sell`) + Vitrine CF (`/portal/marketplace`) + aprovação cascateada | ✅ "integrador colocando markup" | 8h |
| **D6** | Painel SA (`/admin/marketplace/insights`) + custo Google × receita × margem por integrador + bloqueio/ativação | ✅ "admin vendo P&L" | 7h |
| **D7** | Demo de IA viva (1 câmera + LPR/Face funcionando) + polimento + roteiro pitch | ✅ pitch completo | 6h |

**Total: ~48h.** Com folga e debug, **7 dias corridos**. Buffer 1 dia para imprevistos.

---

## 4. D1 — Schema + Migration + Seed

### Goal

Banco com Product, Order, Cart, Subscription, UsageMeter, OrderProvision, ProductTenantOverride. Seed de 11 SKUs `ai-*` com `providerCostModel` real do `docs/21`.

### Files

```
vsaas-backend/prisma/schema.prisma                              ← edit
vsaas-backend/prisma/migrations/20260510_marketplace_poc/       ← new
vsaas-backend/prisma/seed-marketplace.ts                        ← new
vsaas-backend/package.json                                      ← add npm script
```

### Tasks

- [ ] **T1.1** Adicionar enums em `schema.prisma`:
  - `BillingMode { FLAT, METERED, HYBRID }`
  - `OrderStatus { DRAFT, PENDING_INTEGRATOR, PENDING_SUPER_ADMIN, APPROVED, ACTIVATED, REJECTED, CANCELED, TEARDOWN_PENDING }`
  - `SubscriptionStatus { ACTIVE, PAUSED, CANCELED, OVERDUE }`
  - `ProvisionStatus { PROVISIONED, DEPLOYED, TEARDOWN_PENDING, TEARDOWN_DONE, FAILED }`
- [ ] **T1.2** Adicionar models (ver §13 no `docs/21` e §0 deste doc): `Product`, `ProductTenantOverride`, `Cart`, `CartItem`, `Order`, `OrderItem`, `OrderProvision`, `Subscription`, `UsageMeter`, `BillingReconciliation`. **Reutiliza** `Integrador`, `ClienteFinal`, `Camera`, `User`, `AsaasCustomer` existentes.
- [ ] **T1.3** Indexes críticos: `Product[category, active]`, `Order[integradorId, status, createdAt]`, `UsageMeter[integradorId, bucket]`, `OrderProvision[cameraId, status]`.
- [ ] **T1.4** `prisma migrate dev --name marketplace_poc` em ambiente local. Validar schema gerado.
- [ ] **T1.5** Seed `seed-marketplace.ts`:
  - 11 SKUs `ai-*` (LPR, PPE, FACE, SEMANTIC_SEARCH, SUSPECT, MOTION, ABSENCE, AUDIO, PEOPLE_COUNTING, PRESENCE, TIMELAPSE)
  - Cada um com `priceMonthlyB2b`, `wholesaleFloorB2b`, `providerCostModel` (JSON do `docs/21 §3`), `competitorPriceMonuv` (do `reference_monuv_pricing_2026_05_06`), `badges`, `dependencies`.
  - 4 SKUs storage (15d/30d/60d HD/FHD) puxando de `VMSStoragePrice` existente.
  - 4 bundles (Kit Shopping Pro, Kit Condo Smart, Kit Indústria, Kit Varejo).
- [ ] **T1.6** `npm run seed:marketplace` no `package.json`. Tornar idempotente (`upsert` por `sku`).
- [ ] **T1.7** Smoke test manual: `psql` listando os 19 produtos seed.

### Definition of Done D1

- [ ] `prisma generate` sem erro
- [ ] Migration aplicada em local
- [ ] `SELECT count(*) FROM "Product"` = 19
- [ ] `SELECT sku, "priceMonthlyB2b", "providerCostModel"->>'service' FROM "Product" WHERE category='ai'` retorna 11 linhas com modelos preenchidos
- [ ] Commit: `feat(marketplace-poc): schema + seed 19 SKUs base`

### Riscos D1

- **Constraint `slug @unique` em PlatformPlan já é composto** (vide `docs/16 §3.2`). Marketplace usa `Product.sku @unique` simples — sem conflito.
- **Migration em prod**: NÃO rodar em prod. Só local + staging. Drop & recreate em staging se quebrar.

---

## 5. D2 — Services backend

### Goal

Lógica de negócio testável via unit + Postman. Asaas em scaffold (mock).

### Files

```
vsaas-backend/src/services/product.service.ts          ← new
vsaas-backend/src/services/cart.service.ts             ← new
vsaas-backend/src/services/order.service.ts            ← new (state machine)
vsaas-backend/src/services/subscription.service.ts     ← new
vsaas-backend/src/services/usage-meter.service.ts      ← new
vsaas-backend/src/services/order-provisioner.service.ts← new (liga Order ACTIVATED → vertex.service)
vsaas-backend/src/services/asaas-scaffold.service.ts   ← new (mock + skeleton)
vsaas-backend/src/services/cost-calculator.service.ts  ← new (USD→BRL, custo Google estimado)
vsaas-backend/src/lib/wholesale-floor.ts               ← new (validação reutilizável)
```

### Tasks

- [ ] **T2.1 — `product.service.ts`**:
  - `listForIntegrador(integradorId)`: master + ProductTenantOverride aplicado
  - `listForClienteFinal(clienteFinalId)`: mix do integrador do CF
  - `getBySku(sku)`: detalhe completo com `providerCostModel` e `competitorPriceMonuv`
  - `setOverride(integradorId, sku, retailPrice)`: valida wholesale floor
  - `removeOverride(integradorId, sku)`: volta a herdar
- [ ] **T2.2 — `cart.service.ts`**:
  - `getOrCreate(ownerType, ownerId)`: cart sticky por dono
  - `addItem(cartId, sku, cameraIds)`: dedup, valida dependências (`dependencies[]`)
  - `removeItem(cartItemId)`
  - `clear(cartId)`
  - `summary(cartId)`: subtotal, bundles aplicados, total
- [ ] **T2.3 — `order.service.ts` (state machine)**:
  - `create(buyerType, buyerId, cartId)`: snapshot preços, calcula `costGoogleUsd`, status `DRAFT`
  - `submit(orderId)`: DRAFT → PENDING_INTEGRATOR (se buyer=CF) ou APPROVED (se buyer=INT comprando IA Cloud)
  - `approve(orderId, approverUserId)`: PENDING → APPROVED → trigger ACTIVATED via order-provisioner
  - `reject(orderId, reason)`
  - `cancel(orderId)`: ACTIVATED → TEARDOWN_PENDING → trigger teardown
  - `escalate(orderId)`: PENDING_INTEGRATOR → PENDING_SUPER_ADMIN se estourou quota integrador
  - Eventos emitidos via `EventBus` simples (Postgres LISTEN/NOTIFY ou nada — mock pra POC).
- [ ] **T2.4 — `subscription.service.ts`**:
  - Conversão Order ACTIVATED → Subscription ACTIVE (1 sub por SKU+camera)
  - `pause(subscriptionId)`, `resume`, `cancel`
  - `monthlyBill(integradorId)`: agrega subs ativas × precos vigentes
- [ ] **T2.5 — `usage-meter.service.ts`**:
  - `record(meta)`: insere UsageMeter
  - `quotaCheck(integradorId, sku, units)`: bloqueia se FLAT estourou; retorna ok se METERED/HYBRID
  - `monthlyAggregate(integradorId, month)`: para o painel SA
- [ ] **T2.6 — `order-provisioner.service.ts`**:
  - `activate(orderItem)`: chama `vertexService.provisionCamera()` se SKU map p/ Vertex; cria `OrderProvision`
  - `teardown(orderItem)`: chama `vertexService.undeployApplication()`; status TEARDOWN_DONE
  - `bulkActivate(orderId)`: paraleliza por OrderItem
  - **Idempotente** (re-run não re-provisiona)
- [ ] **T2.7 — `asaas-scaffold.service.ts`**:
  - `createInvoice({integradorId, totalBrl, dueDate})`: se DEMO_MODE → retorna `{id: 'mock-asaas-...', status: 'PENDING', barCode: '00190.00009...'}`. Em real, chama `asaas.service` existente.
  - `webhookProcessor(payload)`: scaffold (decodifica + atualiza Order). Em DEMO, expor `POST /demo/asaas/simulate-paid` que aciona o caminho.
- [ ] **T2.8 — `cost-calculator.service.ts`**:
  - `estimateOrderCostUsd(orderItems)`: lê `providerCostModel` de cada item, multiplica por `qty` e mês
  - `usdToBrl(usd, buffer = 0.08)`: usa env `EXCHANGE_RATE_USD` (default 5.40) + buffer 8%
- [ ] **T2.9 — `wholesale-floor.ts`**:
  - `assertFloor(sku, retailPrice)`: lê `Product.wholesaleFloorB2b`, throw 400 se abaixo
  - Helper UI: `getFloor(sku)` para mostrar piso na tela do integrador
- [ ] **T2.10** Smoke test: `npm run test -- product.service` (jest mínimo, 1 teste por service crítico).

### Definition of Done D2

- [ ] Todos os 9 services compilam sem erro TS
- [ ] Order state machine aceita `DRAFT → PENDING_INTEGRATOR → APPROVED → ACTIVATED → TEARDOWN_PENDING → TEARDOWN_DONE` em teste de integração local
- [ ] Wholesale floor bloqueia override < piso (teste explícito)
- [ ] Mock Asaas retorna fatura "fake" quando `ASAAS_DEMO_MODE=1`
- [ ] Order-provisioner cria stream de demo (mock OK)
- [ ] Commit: `feat(marketplace-poc): services + asaas scaffold`

---

## 6. D3 — Routes backend

### Goal

Endpoints REST testáveis via Postman/curl, prontos para frontend consumir.

### Files

```
vsaas-backend/src/routes/marketplace.ts                ← new (público para integrador)
vsaas-backend/src/routes/me-marketplace.ts             ← new (sell mix + markup)
vsaas-backend/src/routes/portal-marketplace.ts         ← new (CF compra)
vsaas-backend/src/routes/admin-marketplace.ts          ← new (SA insights + bloqueio)
vsaas-backend/src/routes/cart.ts                       ← new
vsaas-backend/src/routes/orders.ts                     ← new
vsaas-backend/src/routes/subscriptions.ts              ← new
vsaas-backend/src/routes/usage.ts                      ← new
vsaas-backend/src/routes/demo.ts                       ← new (simula pagamento, força evento)
vsaas-backend/src/app.ts                               ← edit (mount routers)
```

### Endpoints

**`/marketplace`** (auth = INTEGRADOR_ADMIN ou SUPER_ADMIN):
- `GET /marketplace/products` — lista catálogo IA Cloud
- `GET /marketplace/products/:sku` — detalhe + ROI vs Monuv
- `GET /marketplace/categories` — categorias

**`/me/marketplace`** (auth = INTEGRADOR_ADMIN):
- `GET /me/marketplace/catalog` — produtos vendidos por mim ao CF (mix)
- `POST /me/marketplace/catalog/:sku/override` — define `retailPrice` + valida floor
- `DELETE /me/marketplace/catalog/:sku/override` — volta a herdar
- `PATCH /me/marketplace/catalog/:sku/visibility` — esconde/mostra no portal CF
- `GET /me/marketplace/orders/incoming` — pedidos CF aguardando aprovação
- `POST /me/marketplace/orders/:id/approve`
- `POST /me/marketplace/orders/:id/reject`

**`/portal/marketplace`** (auth = CLIENTE_*):
- `GET /portal/marketplace/products` — mix do meu integrador (visíveis)
- `GET /portal/marketplace/products/:sku`

**`/cart`** (auth = INT ou CF):
- `GET /cart` — carrinho atual
- `POST /cart/items` — body: `{sku, cameraIds[]}`
- `DELETE /cart/items/:itemId`
- `DELETE /cart` — clear
- `POST /cart/checkout` — cria Order DRAFT → submit

**`/orders`** (auth varia):
- `GET /orders` — lista do escopo (INT vê seus + filhos; SA vê tudo)
- `GET /orders/:id`
- `POST /orders/:id/cancel` (owner only)

**`/subscriptions`**:
- `GET /subscriptions` — assinaturas ativas no escopo
- `POST /subscriptions/:id/pause`
- `POST /subscriptions/:id/resume`
- `POST /subscriptions/:id/cancel`

**`/usage`**:
- `GET /usage/me?from=&to=` — agregado do tenant logado
- `GET /usage/by-camera/:cameraId?from=&to=` — granular

**`/admin/marketplace`** (auth = SUPER_ADMIN):
- `GET /admin/marketplace/insights` — GMV, MRR, AOV, top integradores
- `GET /admin/marketplace/integradores/:id/pnl` — custo Google × receita × margem do integrador
- `POST /admin/marketplace/integradores/:id/block` — bloqueia novas Orders
- `POST /admin/marketplace/integradores/:id/unblock`
- `POST /admin/marketplace/products/:sku/toggle-active` — desativa SKU global
- `GET /admin/marketplace/usage/google-cost` — custo Google somado mensal

**`/demo`** (auth = SUPER_ADMIN; só ativo se `DEMO_ROUTES=1`):
- `POST /demo/asaas/simulate-paid/:invoiceId` — simula webhook Asaas pago
- `POST /demo/usage/seed?integradorId=&days=` — seed UsageMeter realista para painel ficar populado no pitch
- `POST /demo/order/skip-approval/:orderId` — pula state machine para acelerar pitch

### Tasks

- [ ] **T3.1** Cada router em arquivo próprio. Auth via middleware existente (`requireRole`, `requireWhitelabelCapability`).
- [ ] **T3.2** Validação Zod em payloads críticos (cart add, override pricing).
- [ ] **T3.3** Mount em `app.ts`. Smoke via curl: cada endpoint retorna 200/201/400/403 esperado.
- [ ] **T3.4** OpenAPI/Swagger? Skip para POC. Documentar em `README-MARKETPLACE.md` curto.

### Definition of Done D3

- [ ] Postman collection com 25 requests funcionando
- [ ] Fluxo end-to-end via curl: `cart add → checkout → order approve → subscription active → usage record → admin pnl` retorna dados consistentes
- [ ] Mock Asaas dispara via `/demo/asaas/simulate-paid` e Order vai para ACTIVATED
- [ ] Commit: `feat(marketplace-poc): routes + asaas mock`

---

## 7. D4 — Vitrine Integrador

### Goal

Tela onde o integrador compra IA Cloud — central do pitch. Já demonstrável.

### Files

```
vsaas-frontend/src/pages/MeMarketplacePage.tsx                  ← new (vitrine compra)
vsaas-frontend/src/components/marketplace/ProductGrid.tsx       ← new
vsaas-frontend/src/components/marketplace/ProductCard.tsx       ← new (4 estados: NORMAL/OWNED/TRIAL/LOCKED)
vsaas-frontend/src/components/marketplace/ProductDrawer.tsx     ← new (detalhe + ROI calc)
vsaas-frontend/src/components/marketplace/CartDrawer.tsx        ← new
vsaas-frontend/src/components/marketplace/RoiCalculator.tsx     ← new
vsaas-frontend/src/components/marketplace/CategoryFilter.tsx    ← new
vsaas-frontend/src/components/marketplace/PriceDisplay.tsx      ← new (R$ X / cam / mês com badge "Powered by Google")
vsaas-frontend/src/api/marketplace.ts                           ← new (client API)
vsaas-frontend/src/App.tsx                                      ← edit (rota)
```

### UX

**Layout (recap do `docs/18 §3.3`):**
- Sidebar esquerda: filtros (categoria, faixa preço, vertical, status)
- Centro: grid 3-cols cards densos
- Top: oferta destacada (1 bundle por mês)
- Direita: carrinho slide-in
- Cmd+K busca SKU

**ProductCard** — 4 estados:
- NORMAL: `[+ Adicionar]`
- OWNED: contador `Ativo · X cams`, `[Gerenciar]`
- TRIAL: timer `+ N dias`, `[Converter agora]`
- LOCKED (dependência): badge 🔒, requisitos, `[Ver requisitos]`

**ProductDrawer** (slide direito 480px):
- Preço grande
- ROI calc inline: input "câmeras" → output "custo/mês × Monuv = economia"
- Requisitos (`dependencies[]`)
- Combina com (recomendação simples — combinar manualmente, não ML)
- CTAs: `[Trial 14d]` `[Adicionar — R$ X]`

**RoiCalculator**: cálculo client-side com `competitorPriceMonuv` × qty. Mostra "Você economiza vs Monuv: R$ X/mês".

### Tasks

- [ ] **T4.1** `marketplace.ts` API client (TanStack Query).
- [ ] **T4.2** `ProductGrid` busca `/marketplace/products`, agrupa por categoria.
- [ ] **T4.3** `ProductCard` com Framer Motion `whileHover` + `layoutId` para morph card→drawer.
- [ ] **T4.4** `ProductDrawer` com `RoiCalculator` (input qty, output economia).
- [ ] **T4.5** `CartDrawer` com sticky cart no estado global (Zustand ou Context).
- [ ] **T4.6** Página `/me/marketplace` — header + grid + drawer + cart.
- [ ] **T4.7** Cmd+K via `cmdk` ou similar (opcional D4, pode ir D7).
- [ ] **T4.8** Adicionar entry na sidebar `/me/marketplace` (junto com `/me/whitelabel`).

### Definition of Done D4

- [ ] Em `/me/marketplace` consigo: ver 11 SKUs IA + 4 storage + 4 bundles, filtrar por categoria, abrir drawer de qualquer card, calcular ROI, adicionar ao carrinho, ver carrinho, dar "checkout" → cria Order DRAFT → submit.
- [ ] Visualmente premium (glass + Tailwind), comparável ao mockup do `docs/18`.
- [ ] Demonstrável: gravar 30s adicionando LPR ao carrinho como teste.
- [ ] Commit: `feat(marketplace-poc): vitrine integrador + carrinho + ROI`

---

## 8. D5 — Mix Revenda + Vitrine CF + Aprovação

### Goal

Integrador define markup. CF compra do integrador. Aprovação flui. **Esse dia mostra o B2B2B real.**

### Files

```
vsaas-frontend/src/pages/MeMarketplaceSellPage.tsx              ← new (mix revenda)
vsaas-frontend/src/components/marketplace/MarkupEditor.tsx      ← new (slider markup + preview)
vsaas-frontend/src/components/marketplace/SellCatalogTable.tsx  ← new
vsaas-frontend/src/pages/portal/PortalMarketplacePage.tsx       ← new
vsaas-frontend/src/pages/portal/PortalCartPage.tsx              ← new
vsaas-frontend/src/pages/portal/PortalSubscriptionsPage.tsx     ← new
vsaas-frontend/src/pages/MeMarketplaceOrdersPage.tsx            ← new (incoming approvals)
vsaas-frontend/src/components/marketplace/OrderApprovalCard.tsx ← new
vsaas-frontend/src/components/marketplace/ApprovalActions.tsx   ← new
```

### UX

**`/me/marketplace/sell`** (Integrador):
- Tabela: SKU | Preço B2B (R$ X) | Floor (R$ Y) | **Meu preço CF** [editável] | Markup % | Margem absoluta | Visível [toggle]
- Clicar em "Meu preço CF" abre `MarkupEditor` (slider de markup OU input direto, sincronizados)
- Botão "Aplicar a todos" para markup global
- Salva → POST `/me/marketplace/catalog/:sku/override`
- Validação client-side antes do server (mostra floor)

**`/portal/marketplace`** (Cliente Final):
- Mesma estrutura visual de `/me/marketplace` mas com preço do **integrador** (não IA Cloud)
- Sem coluna "custo" — CF não vê
- Adiciona ao carrinho → checkout → cria Order PENDING_INTEGRATOR
- Mensagem: "Pedido enviado ao seu integrador. Aprovação típica < 4h."

**`/me/marketplace/orders/incoming`** (Integrador):
- Lista cards de Orders PENDING_INTEGRATOR
- Cada card: CF nome, total, items resumidos, **custo IA Cloud** (o que ele vai pagar) × **receita** (o que vai cobrar) × **margem**
- Botões `[Aprovar]` `[Rejeitar com motivo]`
- Aprovar → POST → trigger order-provisioner → status ACTIVATED → notifica CF

### Tasks

- [ ] **T5.1** `MeMarketplaceSellPage` com tabela + edição inline de markup.
- [ ] **T5.2** `MarkupEditor` com slider 10%-200% + preview "Você cobra R$ Y, lucra R$ Z".
- [ ] **T5.3** Validação wholesale floor server + client. Mensagem clara: "Mínimo R$ X por regra do fabricante."
- [ ] **T5.4** `PortalMarketplacePage` — herda layout de `MeMarketplacePage` mas com escopo CF (api `/portal/marketplace/*`).
- [ ] **T5.5** `PortalCartPage` + checkout → Order PENDING_INTEGRATOR.
- [ ] **T5.6** `PortalSubscriptionsPage` — minhas assinaturas, status, próximo billing.
- [ ] **T5.7** `MeMarketplaceOrdersPage` (incoming) com cards + Approve/Reject.
- [ ] **T5.8** Toast de notificação real-time (Polling 10s ou WebSocket existente — verificar).
- [ ] **T5.9** Aprovação dispara `order-provisioner.activate()` em background; UI mostra "Provisionando..." → "Ativo".

### Definition of Done D5

- [ ] Demo flow completo:
  1. Login como Integrador → `/me/marketplace/sell` → coloca markup 35% no LPR → salva
  2. Logout, login como CF → `/portal/marketplace` → vê LPR a R$ X (preço CF) → adiciona 5 cams → checkout
  3. Login como Integrador → `/me/marketplace/orders/incoming` → vê pedido com custo×receita×margem → aprova
  4. CF vê assinatura ativa em `/portal/subscriptions`
- [ ] Commit: `feat(marketplace-poc): mix revenda + vitrine CF + aprovação`

---

## 9. D6 — Painel SA + Bloqueio/Ativação + Custos

### Goal

Admin (Tarcísio no pitch) abre `/admin/marketplace/insights` e mostra ao investidor: GMV crescendo, custo Google sob controle, margem por integrador, capacidade de bloquear/ativar com 1 clique.

### Files

```
vsaas-frontend/src/pages/admin/AdminMarketplaceInsightsPage.tsx ← new (dashboard GMV)
vsaas-frontend/src/pages/admin/AdminMarketplaceCostPage.tsx     ← new (custo Google × receita)
vsaas-frontend/src/pages/admin/AdminMarketplaceIntegradoresPage.tsx ← new (P&L por integrador + bloqueio)
vsaas-frontend/src/pages/admin/AdminMarketplaceProductsPage.tsx ← new (toggle SKU ativo)
vsaas-frontend/src/components/admin/PnlIntegradorCard.tsx       ← new
vsaas-frontend/src/components/admin/MarginChart.tsx             ← new (Recharts)
vsaas-frontend/src/components/admin/GoogleCostBreakdown.tsx     ← new
vsaas-frontend/src/components/admin/BlockIntegradorDialog.tsx   ← new
vsaas-frontend/src/components/admin/ToggleSkuDialog.tsx         ← new
```

### UX

**`/admin/marketplace/insights`** (dashboard SA):
- 4 KPIs no topo: GMV mês, MRR ativo, Margem cadeia (%), Custo Google mês (USD/BRL)
- Gráfico linha: receita × custo Google últimos 6 meses
- Top 5 integradores por receita
- Top 5 SKUs vendidos
- Top 5 SKUs por margem absoluta

**`/admin/marketplace/cost`**:
- Breakdown por service (vertex_ai_vision, cloud_vision, vertex_generative, video_intelligence)
- Gráfico stacked-bar mensal
- Card "Drift recon": diferença entre `UsageMeter.sum` (interno) × Cloud Billing Export (Google) — em POC mostra valor mock realista
- Card "Câmbio aplicado": rate atual + buffer 8%

**`/admin/marketplace/integradores`**:
- Tabela com cada integrador: nome | qtd CFs | qtd câmeras | receita mês | custo Google atribuído | margem absoluta | margem % | status (ATIVO/BLOQUEADO)
- Hover/click → drawer P&L detalhado
- Dropdown: `[Bloquear novas vendas]` `[Suspender por inadimplência]` `[Desbloquear]`
- Bloqueio aciona POST `/admin/marketplace/integradores/:id/block` → flag em `Integrador.salesBlocked` → middleware bloqueia novos checkouts

**`/admin/marketplace/products`**:
- Tabela todos SKUs: ativo? | preço | nº subscriptions | revenue mês | custo Google mês
- Toggle "Ativo" para desativar SKU global (esconde do catálogo, não impacta subs ativas)

### Tasks

- [ ] **T6.1** `/admin/marketplace/insights` com Recharts (já no projeto). Queries via `usageMeter.monthlyAggregate` + `subscription.monthlyBill`.
- [ ] **T6.2** `/admin/marketplace/cost` com breakdown por service.
- [ ] **T6.3** `/admin/marketplace/integradores` com bloqueio/desbloqueio funcional.
- [ ] **T6.4** Middleware `requireIntegradorNotBlocked` em rotas de checkout — bloqueio real.
- [ ] **T6.5** `/admin/marketplace/products` com toggle SKU ativo.
- [ ] **T6.6** **Seed de dados de demo realistas** via `/demo/usage/seed`: 3 integradores com 5/12/30 CFs, ~150 câmeras totais, 60 dias de UsageMeter, distribuição realista (LPR mais usado, PPE em 1 integrador industrial, Face em 1 só).
- [ ] **T6.7** Adicionar entries na sidebar SA (junto a `/admin/billing` existente).

### Definition of Done D6

- [ ] `/admin/marketplace/insights` carrega em <2s e mostra 4 KPIs + gráficos preenchidos
- [ ] Bloquear integrador no painel SA → CF dele tenta checkout → recebe erro 403 com mensagem clara
- [ ] Toggle SKU "ai-people-counting" para inativo → some do catálogo, mas subscriptions ativas continuam
- [ ] Seed de demo deixa o painel "rico" para o pitch
- [ ] Commit: `feat(marketplace-poc): painel SA + bloqueio + custos`

---

## 10. D7 — Demo IA Viva + Polimento + Pitch

### Goal

Câmera real exibindo LPR/Face em tempo real durante o pitch. Polimento de bordas. Roteiro final.

### Files

```
vsaas-frontend/src/pages/admin/AdminLiveDemoPage.tsx            ← new (palco do pitch)
vsaas-frontend/src/components/demo/LiveCameraTile.tsx           ← new (câmera + overlay LPR)
vsaas-frontend/src/components/demo/InstantProvisionDemo.tsx     ← new (botão "Ativar LPR" → 30s countdown → live)
vsaas-frontend/src/components/demo/MarginTickerLive.tsx         ← new (contador margem ao vivo)
vsaas-frontend/scripts/demo-mode-toggle.sh                      ← new (1-comando para ligar tudo de demo)
docs/22-PITCH-SCRIPT.md                                         ← new (roteiro 10 min)
```

### Demo flow do pitch

1. **(00:00)** "Hoje a Monuv cobra R$ 102 por câmera por LPR. Vou te mostrar como vendemos com 38% de margem nossa, 30% pro integrador, e ainda 24% mais barato pro CF."
2. **(01:00)** Abre `/me/marketplace` (papel integrador). Mostra catálogo, abre LPR, ROI calc: "12 câmeras × R$ 79 = R$ 948 que pago. Vendo a R$ 102,70 = R$ 1.232. Lucro R$ 284/mês."
3. **(02:00)** Adiciona LPR ao carrinho. Checkout. **Câmera real na parede** começa a piscar overlay "Provisionando..."
4. **(02:30)** Após 30s, overlay fica verde: "LPR ativo." Faz uma placa passar (ou frame estático com placa). Bbox + texto da placa aparece em tempo real.
5. **(03:30)** Troca para `/admin/marketplace/insights`. "Esse provisionamento gerou R$ 0,06 de custo Google. Esse integrador acabou de adicionar R$ 948 de MRR. Margem cadeia: 53%."
6. **(05:00)** Mostra `/admin/marketplace/integradores`. "Se esse integrador atrasar pagamento, eu bloqueio em 1 clique." Clica → integrador bloqueado.
7. **(06:00)** Login como CF do integrador bloqueado. Tenta comprar. Erro: "Seu integrador está com pagamento pendente."
8. **(07:00)** Volta SA, desbloqueia. Mostra dashboard com 60 dias de demo data: GMV crescendo, custo Google sob controle.
9. **(08:30)** "Tudo isso roda em US$ 12/mês de hosting. Cada câmera adicional traz 38% de margem. CAC é zero porque integrador é distribuição."
10. **(10:00)** "Próximos 90 dias: 30 integradores, 1.500 câmeras, R$ 100k MRR. Quanto investimento e quanto da empresa quer?"

### Tasks

- [ ] **T7.1** `LiveCameraTile`:
  - Se houver câmera RTSP real: usa `<HlsPlayer>` existente
  - Fallback: vídeo `/public/demo-cam.mp4` em loop (gravar com placa real passando)
  - Overlay: bbox via canvas + texto LPR via call `/marketplace/demo/run-lpr`
- [ ] **T7.2** `InstantProvisionDemo`: botão grande "Ativar LPR ao vivo" → 30s countdown → chama `vertexService.provisionCamera` (mock OK, mostra log) → muda overlay
- [ ] **T7.3** `MarginTickerLive`: contador animado mostrando margem acumulada do dia
- [ ] **T7.4** `AdminLiveDemoPage`: tudo num só `/admin/live-demo` para apresentar
- [ ] **T7.5** **Polimento UI:** review de bordas mais visíveis no pitch (loading states, empty states, micro-animações morph card→drawer)
- [ ] **T7.6** **Cmd+K** se não foi feito no D4
- [ ] **T7.7** **Verifica em mobile?** Skip para POC. Demo é desktop só.
- [ ] **T7.8** Roteiro `docs/22-PITCH-SCRIPT.md` com timing e fallbacks (e.g., se câmera real cair, alterna pra vídeo).
- [ ] **T7.9** **Dry run** completo do pitch 2× antes do dia oficial. Cronometrar. Cortar gordura.
- [ ] **T7.10** Backup: gravar vídeo de 3 min do walkthrough e ter no celular do Tarcísio caso a internet do investidor caia.

### Definition of Done D7

- [ ] `/admin/live-demo` tudo funcional, câmera viva mostrando overlay LPR
- [ ] Pitch script revisado, cronometrado em 10 min
- [ ] Vídeo backup gravado e salvo
- [ ] Stack reiniciada do zero funciona em <30s
- [ ] Commit: `feat(marketplace-poc): demo IA viva + pitch ready`

---

## 11. Asaas — modo scaffold

### Estado D1-D7

- Schema: usar `AsaasCustomer` e `AsaasSubscription` existentes. Adicionar `AsaasInvoice` se não existir.
- Service: `asaas-scaffold.service.ts` com flag `ASAAS_DEMO_MODE`.
- Routes: `/billing/invoices`, `/billing/webhook` existentes, mas em DEMO retorna mock.
- Frontend: páginas Billing existentes funcionam com dados mock.

### Como ativar (pós-tokens)

```bash
# .env de produção
ASAAS_DEMO_MODE=0
ASAAS_API_KEY=$prod_key
ASAAS_WEBHOOK_TOKEN=$webhook_secret
```

E rodar 1 migration de teste:
1. Criar `AsaasCustomer` para o primeiro integrador real
2. Criar `AsaasSubscription` recorrente
3. Disparar webhook de teste (Asaas tem sandbox)
4. Verificar `Invoice` populada

**Tempo de ativação real**: 2-4h após tokens chegarem. Não bloqueia POC.

---

## 12. Roteiro do pitch — versão curta (1 frase por slide)

(detalhe completo em `docs/22-PITCH-SCRIPT.md` quando D7 for executado)

1. **Problema**: VMS BR é caro, fechado, sem self-service.
2. **Solução**: marketplace 3 níveis com IA Google revendida.
3. **Demo viva**: provisionamento LPR em 30s, câmera lendo placa.
4. **Cadeia**: Google R$ 48 → IA Cloud R$ 79 → Integrador R$ 102. 53% margem cadeia.
5. **Operação**: admin SA controla tudo (bloqueio, ativação, P&L).
6. **Diferenciação**: Monuv não tem PPE, Face, Semantic Search, marketplace self-service.
7. **Tração planejada**: 30 integradores em 90 dias, R$ 100k MRR.
8. **Custo**: hosting US$ 12/mês + Google variável (margem positiva sempre).
9. **Time**: 1 dev (Tarcísio) + Claude. Pós-funding: 2-3 devs + comercial.
10. **Ask**: $X por Y%.

---

## 13. Riscos + mitigações

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Migration corrompe local | média | médio | Branch separada, dev DB descartável |
| R2 | Vertex AI Vision quota request demora | baixa | alto (D7) | Mock-first; ligar real só em pré-produção |
| R3 | Asaas tokens chegam atrasados | alta | nulo | Scaffold preparado; ativação 4h |
| R4 | Câmera RTSP real cair no dia | média | alto (pitch) | Vídeo backup pré-gravado |
| R5 | Designer diz "feio" | baixa | baixo | Pitch vende lógica + viabilidade, não pixel-perfect |
| R6 | Investidor pede números reais de tração | alta | médio | Slide separado: "0 vendas hoje, infra pronta para 100" — ser honesto |
| R7 | Cmd+K trava no Safari | baixa | baixo | Pitch em Chrome, ponto |
| R8 | Vertex AI Vision bills $$$$$ por bug | baixa | catastrófico | Cap diário em projeto GCP de demo, alarme em $50/dia |

---

## 14. Backlog imediato pós-pitch (não no escopo dos 7 dias)

- LGPD/DPIA upload obrigatório para `ai-face-recognition`
- Cloud Billing Export → BQ + recon real
- Faturamento Asaas ligado em produção (depende tokens)
- Bundles com lógica de desconto automático (hoje só preço fixo)
- Trial 14d com dunning
- Notificação WhatsApp em aprovação (depende Evolution API)
- Métrica de conversão funnel marketplace
- A/B test de pricing
- Mobile portal CF
- Multi-currency (USD para integradores grandes)

---

## 15. Checklist pré-pitch (3h antes)

- [ ] Stack rebooted from scratch (`docker stack deploy`) e funcionando
- [ ] Câmera RTSP confirmada online
- [ ] Vídeo backup acessível offline
- [ ] Browser: 3 abas pré-abertas (Integrador / CF / Admin)
- [ ] Tab "Integrador": já em `/me/marketplace`
- [ ] Tab "CF": já logado em `/portal/marketplace`
- [ ] Tab "Admin": em `/admin/marketplace/insights`
- [ ] Mouse e teclado de demo separados (não usar trackpad)
- [ ] Notebook em modo "Não perturbe" + Slack/email fechado
- [ ] Wifi de backup (4G tethering) testado
- [ ] Garrafa de água
- [ ] Slide deck (Keynote/PDF) aberto em segunda tela
- [ ] Telefone em silencioso

---

## 16. Definition of Done — POC completa

- [ ] Stack roda do zero em <30s
- [ ] Login como SA, INT, CF — todos funcionam
- [ ] Fluxo end-to-end pitchável em <10 min
- [ ] Câmera real lendo placa em tempo real
- [ ] Painel SA mostra GMV/MRR/margem por integrador
- [ ] Bloqueio/ativação funciona com 1 clique
- [ ] Asaas em modo scaffold pronto para tokens
- [ ] Documentação handoff (`README-MARKETPLACE.md`) escrita
- [ ] Pitch script em `docs/22-PITCH-SCRIPT.md`
- [ ] Vídeo backup gravado
- [ ] 1 dry run completo executado

---

## 17. Próximo passo agora

**Aguardar GO do Tarcísio** para iniciar **D1**. Confirmar 2 detalhes operacionais que ainda não foram respondidos:

1. **Câmera demo D7**: você tem RTSP fixo acessível, ou pré-gravo loop de placa real?
2. **GCP creds demo**: posso usar real em projeto separado, ou rodo tudo em mock realista até o pitch?

Independente das respostas, **D1-D6 não dependem disso** — pode dar GO para D1 agora.
