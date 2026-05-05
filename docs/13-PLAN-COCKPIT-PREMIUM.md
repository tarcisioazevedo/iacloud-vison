# Plano de Refatoração — Cockpit Premium Full Hierárquico

**Status:** 📋 Plano consolidado · pronto para execução
**Branch alvo:** `feat/sprint0-piloto-definitivo` (continuar) → migrar para `feat/cockpit-premium`
**Janela:** 10 semanas (alinhado com `docs/08` — 90 dias para mercado)
**Autor:** Claude + Tarcísio (sessão de 05/05/2026)
**Vínculos:** `docs/01-DIAGNOSTICO.md`, `docs/05-REFERENCIA-COMPETIDORES.md`, `docs/08-PLAN-MERCADO-NACIONAL-B2B2B.md`

---

## 0. Sumário Executivo

O painel atual implementa apenas a primeira camada do modelo mental B2B2B. Existe um **TenantCockpit** monolítico (2706 linhas) com 8 tabs e algumas páginas avulsas (`ClientesFinaisPage`, `SitesPage`, `EdgeNodesPage`, `FleetPage`) que duplicam dados sem visão consolidada. A hierarquia conceitual está **bem modelada no Prisma** (`Integrador → ClienteFinal → Site → EdgeNode → Camera`) mas **não navegável visualmente**.

A solução proposta entrega **três cockpits espelhados, escopados por persona via RBAC já existente**:

```
🏭 Cockpit do Fabricante (SUPER_ADMIN)
    └─ vê todos os tenants, plataforma, módulos, billing
🤝 Cockpit do Integrador (INTEGRADOR_ADMIN/TECNICO)
    └─ vê apenas seus clientes, sites, boxes, câmeras
👤 Cockpit do Cliente Final (CLIENTE_*)
    └─ vê apenas operação ao vivo, gravações, próprios usuários
```

Resultado esperado: paridade com Defense IA / Digifort / Monuv em hierarquia visual + diferenciação em transparência LGPD e UX premium.

---

## 1. Estado atual (linha de base)

### 1.1 Hierarquia no Prisma (✅ correta)

```
Integrador (tenant)
  ↓ ClienteFinal.integradorId
ClienteFinal
  ↓ Site.clienteFinalId
Site (lat/lng/timezone)
  ↓ EdgeNode.siteId
EdgeNode
  ↓ Camera.edgeNodeId  (gerenciada via box)
  ↓ Camera.siteId      (avulsa direto no site)
```

### 1.2 RBAC e isolamento (⚠️ 90% pronto)

- `JWT` carrega `integradorId` + `clienteFinalId` (`vsaas-backend/src/middleware/auth.ts:38-39`)
- `assert-box-ownership.ts` valida posse hierárquica
- `tenant-context.ts` injeta escopo automaticamente
- `Sidebar.tsx` já tem 3 paletas distintas por persona (linhas 59-199)

**Lacuna:** alguns endpoints `/admin/*` não têm equivalente `/me/*` para integrador/cliente operarem com escopo automático.

### 1.3 Frontend (❌ desalinhado)

| Sintoma | Severidade | File:Line |
|---|---|---|
| `TenantCockpitPage.tsx` com 2706 linhas | ALTA | `vsaas-frontend/src/pages/TenantCockpitPage.tsx` |
| Deep-link `/admin/tenants/:id` redireciona para `/` | ALTA | (em investigação — Onda 0.4) |
| Páginas duplicadas (`ClientesFinaisPage` 1150L, `SitesPage` 537L, `FleetPage`+`Detail` 308+945L) | ALTA | `pages/` |
| API fragmentada (5+ chamadas paralelas para 1 view) | MÉDIA | `api/client.ts` |
| Sem drill-down hierárquico in-place | ALTA | global |
| `PortalHomePage.tsx` apenas 108 linhas (cliente final sem cockpit real) | ALTA | `pages/portal/` |
| 7 KPI cards genéricos sem contexto temporal | MÉDIA | `IntegradoresListView` |
| KPIs inconsistentes entre views | MÉDIA | counts diferentes em hooks |
| Sem breadcrumb hierárquico | MÉDIA | `App.tsx` |
| Sem Cmd+K | MÉDIA | inexistente |
| Sem health score | MÉDIA | inexistente |
| Sem mapa de presença | MÉDIA | inexistente (já existe MapLibre em `CameraMapPage`) |
| 78 arquivos modificados sem commit | ALTA | `git status` |
| Build sem versão tagueada (`:latest` apenas) | MÉDIA | `deploy.sh:121-128` |

---

## 2. Modelo mental completo — 3 cockpits + câmera avulsa

### 2.1 Diagrama hierárquico

```
┌──────────────────────────────────────────────────────────────────────────┐
│  🏭 FABRICANTE (IA Cloud Vision)                                         │
│     SUPER_ADMIN / ADMIN_GLOBAL                                           │
│     escopo: TUDO · responsabilidade: plataforma                          │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ 1:N
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  🤝 INTEGRADOR (revendedor B2B2B — ex: IACloud Tecnologia)              │
│     INTEGRADOR_ADMIN / INTEGRADOR_TECNICO                                │
│     escopo: clientes próprios + infra · responsabilidade: vendas+suporte│
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ 1:N
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  👤 CLIENTE FINAL (empresa que usa o VMS — ex: Shopping Central)        │
│     CLIENTE_ADMIN / CLIENTE_OPERADOR / CLIENTE_VIEWER                    │
│     escopo: sites próprios · responsabilidade: operação                 │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ 1:N
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  📍 SITE (local físico — ex: Loja Centro / Filial Norte)                │
│     atributos: lat, lng, timezone, endereço                              │
└────────────────┬────────────────────────────────┬────────────────────────┘
                 │ 1:N (gerenciado)               │ 1:N (avulsa)
                 ▼                                 ▼
┌──────────────────────────────┐    ┌──────────────────────────────────────┐
│  📦 EDGE BOX                 │    │  📹 CÂMERA AVULSA (cloud-direct)    │
│     hardware ICV-BOX local   │    │     ONVIF / RTSP / RTMP / P2P        │
│     IA on-device, gravação   │    │     bandwidth do cliente, sem IA    │
│     ↓ 1:N                    │    │     pesada                           │
│  📹 CÂMERA GERENCIADA        │    │                                      │
└──────────────────────────────┘    └──────────────────────────────────────┘
```

### 2.2 Capacidades por persona

| Capacidade | Fabricante | Integrador | Cliente Final |
|---|:---:|:---:|:---:|
| Criar/suspender integrador | ✅ | ❌ | ❌ |
| Definir quotas e planos | ✅ | ❌ | ❌ |
| Catálogo de módulos (oferta) | ✅ | ❌ | ❌ |
| Whitelabel global | ✅ | ❌ | ❌ |
| Saúde do cluster | ✅ | ❌ | ❌ |
| Impersonate qualquer persona | ✅ | ✅ (apenas próprios clientes) | ❌ |
| Cadastrar cliente final | ❌ | ✅ | ❌ |
| Provisionar edge box | (auditado) | ✅ | ❌ |
| Adicionar site | ❌ | ✅ | ❌ |
| Adicionar câmera (avulsa OU via box) | ❌ | ✅ | ❌ |
| Convidar usuário ao cliente | ✅ | ✅ | ✅ (apenas da própria empresa) |
| Ver ao vivo das câmeras | ✅ (com auditoria) | ✅ | ✅ (apenas próprias) |
| Reproduzir gravações | ✅ | ✅ | ✅ |
| Auditoria LGPD (quem acessou) | ✅ | ✅ | ✅ (apenas dos próprios dados) |
| Configurar notificações | ✅ (canais globais) | ✅ (canais próprios) | ✅ (canais próprios) |
| Alterar branding (whitelabel) | ✅ (global+por integrador) | ✅ (próprio) | ❌ |
| Gerenciar módulos contratados | ✅ | ✅ | ❌ |
| 2FA self-service | ✅ | ✅ | ✅ |

---

## 3. Plano de execução em 5 ondas

### Onda 0 — Higiene (1-2 dias) · BLOQUEANTE

| # | Item | Critério de aceite |
|---|---|---|
| 0.1 | Commit dos 57 modificados + 21 novos em commits temáticos na branch atual | `git status` limpo, mensagens claras por tema |
| 0.2 | Tag de versão no build: `icv_frontend:$(git rev-parse --short HEAD)` + `:latest` | `docker images icv_frontend` mostra 2 tags |
| 0.3 | `deploy.sh` gera `vsaas-frontend/public/version.json` com `{ commit, builtAt, branch }` | UI mostra versão no rodapé |
| 0.4 | Investigar e corrigir D3 (deep-link redirect) | `curl /admin/tenants/int-iacloud-001` retorna 200 + HTML SPA |
| 0.5 | Pre-commit hook que avisa se >20 arquivos não-commitados há >24h | Hook ativo em `scripts/git-hooks/` |

### Onda 1 — Arquitetura full hierárquica (1 semana)

#### 1.1 — Rotas drill-down universais

```
/admin/tenants                                                  → Fabricante: lista
/admin/tenants/:integradorId                                    → Fabricante: cockpit integrador
/admin/tenants/:integradorId/clientes/:clienteId                → drill cliente
/admin/tenants/:integradorId/clientes/:clienteId/sites/:siteId  → drill site
.../sites/:siteId/boxes/:boxId                                  → drill box
.../sites/:siteId/cameras/:cameraId                             → drill câmera

/integrador (root para INTEGRADOR_*)                            → Cockpit integrador
/integrador/clientes/:clienteId                                 → drill cliente (escopo automático)
/integrador/clientes/:clienteId/sites/:siteId                   → drill site
.../sites/:siteId/boxes/:boxId

/cliente (root para CLIENTE_*)                                  → Cockpit cliente
/cliente/sites/:siteId                                          → drill site (escopo automático)
/cliente/sites/:siteId/cameras/:cameraId                        → drill câmera
```

Todas as rotas:
- deep-linkable (refresh, copiar URL, voltar com browser-back)
- protegidas por `<RequireRole roles={...}>` wrapper
- breadcrumb hierárquico automático

#### 1.2 — Endpoints backend unificados

```typescript
// Fabricante
GET /admin/integradores/:id/tree?depth=2&counts=true

// Integrador (escopo automático via JWT)
GET /me/integrador/tree?depth=2

// Cliente Final (escopo automático via JWT)
GET /me/cliente/tree?depth=2

// Resposta padrão:
{
  node: { id, type: 'integrador'|'cliente'|'site', name, ... },
  children: [
    { id, type, name, _counts: {...}, healthScore: 0-100, children?: [...] }
  ]
}
```

Substitui ~5 chamadas paralelas por 1. SWR caching unificado.

#### 1.3 — Componentes compartilhados (DRY)

```
vsaas-frontend/src/components/hierarchy/
├── TreeView.tsx              # Acordeão recursivo Cliente→Site→Box→Cam
├── BreadcrumbBar.tsx         # Breadcrumb adaptativo por persona
├── HealthScoreBadge.tsx      # Badge ●98 colorido
├── EntityCard.tsx            # Card padrão para qualquer entidade da árvore
├── EntityKpiStrip.tsx        # 3-4 cards densos com sparkline
├── DrillDownPanel.tsx        # Drawer/panel com tabs do detalhe
└── ScopeContext.tsx          # React Context que sabe a persona ativa
```

Destes, derivam-se:
- `<ClienteCard>` = `<EntityCard type="cliente">`
- `<SiteCard>` = `<EntityCard type="site">`
- `<BoxCard>` = `<EntityCard type="box">`
- `<CameraCard>` = `<EntityCard type="camera">`

#### 1.4 — Quebrar TenantCockpitPage.tsx

```
vsaas-frontend/src/pages/cockpit/
├── FabricanteCockpitPage.tsx      # ~80 linhas (shell + tabs)
├── IntegradorCockpitPage.tsx      # ~80 linhas (NOVO)
├── ClienteCockpitPage.tsx         # ~80 linhas (NOVO, substitui PortalHomePage)
├── tabs/
│   ├── OverviewTab.tsx
│   ├── ClientsTab.tsx
│   ├── SitesTab.tsx               # NOVO
│   ├── BoxesTab.tsx
│   ├── CamerasTab.tsx
│   ├── UsersTab.tsx
│   ├── ApprovalsTab.tsx
│   ├── StorageTab.tsx
│   ├── LogsTab.tsx
│   ├── ConfigTab.tsx
│   └── BillingTab.tsx             # NOVO (apenas integrador)
└── modals/
    ├── ImpersonateModal.tsx       # NOVO (3 níveis)
    ├── AddCameraWizard.tsx        # NOVO (avulsa vs box)
    └── ProvisionBoxWizard.tsx     # NOVO
```

Cada tab importa apenas o necessário (lazy-load via `React.lazy`).

#### 1.5 — Cockpit do Integrador (NOVO)

`IntegradorCockpitPage.tsx` reaproveita 80% do `FabricanteCockpitPage.tsx`. Diferenças:

- **Hero**: "Meu Negócio" em vez de "Tenant Management"
- **KPIs**: clientes / sites / câmeras / saúde média / plano + dias restantes
- **Tabs disponíveis**: Overview, Clientes, Sites, Boxes, Câmeras, Usuários, Storage, Logs, Billing, Config
- **Sem tabs**: Aprovações de outros tenants, Catálogo, White-label global
- **Banner discreto**: "Powered by IA Cloud Vision" (whitelabel passivo)

#### 1.6 — Cockpit do Cliente Final (NOVO)

`ClienteCockpitPage.tsx` reescreve `PortalHomePage.tsx` (108 → ~400 linhas).

- **Hero**: nome do cliente + branding **do integrador** (whitelabel ativo)
- **Hero card "Ao Vivo"**: thumbnail principal das câmeras + grid se houver mais de 1
- **KPIs**: detecções 24h, eventos, gravação disponível
- **Card LGPD destacado**: "Quem acessou minhas câmeras nas últimas 24h?"
- **Tabs**: Overview, Câmeras, Gravações, Eventos, Usuários, Auditoria, Notificações
- **Sem**: Boxes, Storage, Billing, Config global

#### 1.7 — Modelar `Camera.deploymentMode`

Migration Prisma:

```prisma
enum CameraDeploymentMode {
  EDGE_BOX        // gerenciada via edge box local
  CLOUD_DIRECT    // avulsa: ONVIF/RTSP/RTMP direto na cloud
}

model Camera {
  // ... campos existentes
  deploymentMode CameraDeploymentMode @default(EDGE_BOX)
  edgeNodeId     String?              // null se CLOUD_DIRECT
  siteId         String               // sempre presente

  @@index([siteId, deploymentMode])
}
```

Endpoint `/cameras/discover-onvif?networkCidr=...` para auto-discovery (já tem suporte parcial em `EdgeBoxesPanel`).

---

### Onda 2 — UI/UX Premium (2 semanas)

| # | Item | Detalhe |
|---|---|---|
| 2.1 | Breadcrumb global hierárquico | `🏭 ICV › 🤝 IACloud › 👤 Cliente A › 📍 Site Centro › 📦 Box Z` |
| 2.2 | Command Palette (Cmd+K) com escopo automático | `cmdk` lib; index com `tree` retornado pelo backend |
| 2.3 | Hero com 4 cards densos + sparkline | Tremor/recharts; KPI temporal |
| 2.4 | Drill-down acordeão inline (TreeView) | TanStack Table v8 com `getExpandedRowModel()` |
| 2.5 | Mapa MapLibre de presença geográfica | reusa lógica de `CameraMapPage` |
| 2.6 | Health score 0-100 (server-side) | algoritmo documentado em `docs/HEALTH-SCORE.md` |
| 2.7 | "Live mode" toggle global (SSE/WebSocket) | KPIs e status em tempo real |
| 2.8 | Empty states ilustrados + CTAs | `undraw` ou custom |
| 2.9 | Tema light/dark/auto + axe AA | `prefers-color-scheme` + auditoria |
| 2.10 | Responsividade mobile-first | tabela vira cards, sidebar vira drawer |
| 2.11 | Wizard "Adicionar câmera" (avulsa/box) | escolha visual + auto-discovery |
| 2.12 | Card LGPD "Quem acessou minhas câmeras" | destaque no cockpit do cliente |
| 2.13 | Modal impersonate 3-níveis + motivo + duração | banner vermelho persistente, audit log |

---

### Onda 3 — Funcionalidades de Fabricante (3 semanas)

| # | Item |
|---|---|
| 3.1 | Painel "Saúde da Plataforma" (cross-tenant) com top problemas |
| 3.2 | Modo impersonate auditado completo (3 níveis, banner, expiração 15min) |
| 3.3 | Quota/billing visível no hero (slider, histórico, upgrade CTA) |
| 3.4 | Whitelabel preview lado-a-lado (iframe portal cliente) |
| 3.5 | Catálogo de módulos com analytics de uso e receita |
| 3.6 | Wizard onboarding novo integrador (4-step com preview) |
| 3.7 | Aba "Suporte" no cockpit (tickets + notes + Telegram OpenClaw) |

---

### Onda 4 — Verticalização Cliente Final (2 semanas) · DIFERENCIAÇÃO

| # | Item | Por quê |
|---|---|---|
| 4.1 | Mosaico ao vivo customizável (drag-drop, layouts salvos) | paridade com Defense IA Mural |
| 4.2 | App mobile (Capacitor) replicando cockpit cliente | já planejado em `docs/08` |
| 4.3 | Notificações multi-canal pelos canais do **próprio cliente** (não do integrador) | LGPD + UX |
| 4.4 | Self-service troca senha + 2FA | reduz fricção de suporte |
| 4.5 | Compartilhamento de câmera via link temporário assinado | diferencia da concorrência |
| 4.6 | UI completa de audit "quem acessou minhas câmeras" | diferencial LGPD em B2B2B BR |
| 4.7 | Onboarding interno (cliente convida primeiros usuários sozinho) | reduz custo de operação do integrador |

---

## 4. Princípios de design

1. **Coerência visual entre personas** — mesmo design system, mesmos cards, mesmas tabelas. Apenas escopo de dados e paleta de ações mudam.
2. **Vocabulário diferente por persona**:
   - Fabricante: "Tenants", "Plataforma", "MRR", "Cluster"
   - Integrador: "Meus Clientes", "Minha Infra", "Meu Plano"
   - Cliente: "Minhas Câmeras", "Minha Empresa", "Meus Eventos"
3. **Posse explícita** — cliente nunca vê branding "IA Cloud Vision"; vê branding **do integrador**. Integrador vê próprio + "powered by ICV" discreto.
4. **Confiança via transparência** — card LGPD no cockpit do cliente é diferenciador legal e moral em B2B2B brasileiro.
5. **Drill-down padrão único** — Acordeão Cliente→Site→Box→Câmera funciona idêntico nos 3 cockpits, só muda o ponto de partida.
6. **Cmd+K em tudo** — qualquer tela acessível via search com escopo automático por RBAC.
7. **Rotas espelhadas** — `/admin/tenants/:int/clientes/:c` ≡ `/integrador/clientes/:c` ≡ `/cliente/...`. URL é deep-linkable e copiável.

---

## 5. Stack & padrões técnicos

| Decisão | Escolha | Motivo |
|---|---|---|
| Component library | shadcn/ui + Tailwind + Radix | DataTable, DropdownMenu, Command prontos |
| Tabela | TanStack Table v8 | sortable, filterable, virtualizada, expandable rows |
| Gráficos | recharts + Tremor | sparkline + area zero esforço |
| Mapa | MapLibre GL + tiles OSM | gratuito, alinhado com `docs/03` |
| Animação | Framer Motion (já em uso) | manter |
| Icons | lucide-react (já em uso) | manter |
| Cmd+K | `cmdk` (vercel/cmdk) | de facto standard |
| Forms | react-hook-form + zod | validação tipo-segura |
| Tipografia | Inter Display (header) + Inter Tight (body) | distância visual |
| Design tokens | `vsaas-frontend/src/styles/tokens.css` | bloqueia whitelabel automático |
| Lazy-load | React.lazy + Suspense por tab | bundle inicial <300KB gzipped |
| Versionamento | `version.json` no build | rastreabilidade pós-deploy |

---

## 6. Cronograma

```
Sem 1     [Onda 0] [iniciar Onda 1]
Sem 2-3   [Onda 1 completa: 3 cockpits arquitetados]
Sem 4-5   [Onda 2: UI Premium uniforme nos 3 cockpits]
Sem 6-8   [Onda 3: Funcionalidades de Fabricante]
Sem 9     [Onda 4 (parcial): mosaico + audit LGPD UI]
Sem 10    [Hardening, perf budget, axe AA, smoke E2E, pre-homologação]
```

Total: **~10 semanas** = ±70 dias úteis. Compatível com janela de 90-120 dias do MVP.

---

## 7. Riscos & mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| Refator do TenantCockpit quebrar funcionalidade existente | ALTA | Quebrar em PRs pequenos, smoke E2E com Playwright (já em CI) |
| Endpoints novos `/me/*` exporem dados de outros tenants | CRÍTICA | Auditar middleware `tenant-context.ts`; testes de RBAC obrigatórios |
| Performance do drill-down com muitos sites | MÉDIA | Virtualização TanStack + paginação server-side |
| Mobile responsividade negligenciada | MÉDIA | Storybook com viewport mobile + axe; bloquear merge sem |
| Wizard câmera avulsa quebrar fluxo gerenciado existente | MÉDIA | Feature flag `CAMERA_AVULSA_ENABLED` por integrador |
| Bundle inflação | MÉDIA | Budget 300KB inicial; lazy por tab; bundle analyzer no CI |
| Whitelabel passivo vs ativo confundir clientes | BAIXA | UX writing claro; preview no admin |

---

## 8. Critérios de aceite globais

✅ Plano considerado entregue quando:

- [ ] `/admin/tenants/:id` deep-link funciona com refresh
- [ ] Os 3 cockpits (`Fabricante`, `Integrador`, `Cliente`) existem e respeitam RBAC
- [ ] Drill-down acordeão Cliente→Site→Box→Câmera funciona inline em todos
- [ ] Câmera avulsa cadastrável via wizard com `deploymentMode=CLOUD_DIRECT`
- [ ] Cmd+K busca cross-entidade com escopo automático
- [ ] Breadcrumb adaptativo em todas as páginas profundas
- [ ] Card LGPD no cockpit do cliente lista acessos do integrador/fabricante
- [ ] Impersonate exige motivo + duração + checkbox de ciência
- [ ] Bundle inicial ≤300KB gzipped
- [ ] Lighthouse score ≥90 (Performance, Accessibility, Best Practices)
- [ ] Axe AA sem violações em telas-chave
- [ ] E2E smoke cobre as 3 personas + drill-down completo
- [ ] `version.json` exposto em produção
- [ ] Documentação atualizada em `docs/13-PLAN-COCKPIT-PREMIUM.md` (este arquivo)

---

## 9. Status atual & roadmap das próximas ondas

### ✅ Concluído (5 de maio 2026 — sessão única, 5 deploys)

| Onda | SHA | Conteúdo |
|---|---|---|
| 0 | `e0e80e01` … `226f4db9` | 6 commits temáticos · 78 arquivos · script fix-caddy · routes-snapshot doc |
| 1 | `c1418df2` → `d53a108d` | TreeView · drill-down · cockpits 3 personas · `/admin/integradores/:id/tree` · `/me/integrador/tree` · `Camera.deploymentMode` (EDGE_BOX/CLOUD_DIRECT) · IntegradorCockpitPage · PortalHomePage reescrito |
| 2 | `f205179c` | Hero KPIs cards densos+sparkline · CommandPalette (Cmd+K) · AutoBreadcrumb · Sparkline component |
| 3.A | `a614d8ad` | AddCameraWizard 4-step (Edge Box vs Cloud Direct) com endpoint deploymentMode |
| 4 | `27861af2` | Sidebar/TopBar premium (gradient violet→cyan, accent glow, search Cmd+K integrado) |
| 5 | `fea1a895` | Paridade com mockup 01: tabela 8 col · agregados sites/câmeras backend · GeographicPresence · AdminDashboard 4 cards |

### 🔄 Onda 6 — Refator de páginas restantes para o estilo premium (em curso)

**Princípio:** TODAS as páginas operacionais devem usar o mesmo design system
(GlassCard com gradient + border colorido, sparkline, HealthScoreBadge,
TreeView quando hierárquico, hero personalizado, AutoBreadcrumb).

| # | Página atual | LOC | Ação |
|---|---|---|---|
| 6.A | `ClientesFinaisPage.tsx` | 1150 | Substituir tabela flat por TreeView · hero "👤 Meus Clientes" · drill-down inline |
| 6.B | `SitesPage.tsx` | 537 | Hero "📍 Meus Sites" · cards densos · TreeView de sites→boxes→câmeras |
| 6.C | `EdgeNodesPage.tsx` + `FleetPage.tsx` + `FleetDetailPage.tsx` | 50+308+945 | Unificar em "Edge Boxes" com TreeView · cards saúde · sparkline CPU/RAM/uptime |
| 6.D | `CamerasPage.tsx` + `CameraDetailPage.tsx` | ~800 | Hero "📹 Câmeras" · grid de previews ao vivo · filtros por deploymentMode |
| 6.E | `LivePage.tsx` + `PlaybackMosaicPage.tsx` | ~600 | Mosaico ao vivo customizável · drag-drop layouts |
| 6.F | `ReviewPage.tsx` (Eventos) + `FacesPage` + `PlatesPage` + `HeatmapPage` + `DemographicsPage` | ~1500 | Hero unificado · timeline com mini-thumbnails · filtros premium |
| 6.G | `RecordingsPage.tsx` | ~400 | Calendário visual · scrub timeline · seleção de range |

### 🗺 Onda 7 — MapLibre real

| # | Item |
|---|---|
| 7.1 | Substituir placeholder `GeographicPresence` por MapLibre GL com tiles OSM |
| 7.2 | Pinos por site com popover (saúde, câmeras, último evento) |
| 7.3 | Heatmap de eventos opcional (toggle) |
| 7.4 | Filtro por integrador no super-admin · por cliente no integrador |
| 7.5 | Aplicar em `/admin/tenants` (presença global), `/integrador` (sites próprios), `/portal/home` (sites cliente) |

### 🎨 Onda 8 — Theme Builder (white-label avançado)

| # | Item |
|---|---|
| 8.1 | Editor visual de paleta (primary, accent, success, danger) com preview iframe |
| 8.2 | Toggle tipografia (Inter Display / Inter Tight / Custom) |
| 8.3 | Densidade (compacto/normal/espaçado) |
| 8.4 | Border radius (suave/quadrado) |
| 8.5 | Persistência: `IntegradorTheme` model no Prisma |
| 8.6 | API `/me/integrador/theme` GET/PUT |
| 8.7 | Aplicação automática via CSS vars no portal cliente do integrador |

### 🔐 Onda 9 — Modal Impersonate auditado 3-níveis

| # | Item |
|---|---|
| 9.1 | Modal "Acessar como…" com radio: Integrador / Cliente Admin / Cliente Operador |
| 9.2 | Campo motivo obrigatório (textarea) |
| 9.3 | Duração: 15min / 1h / 4h (justificar >1h) |
| 9.4 | Checkbox de ciência (LGPD: ações ficarão visíveis ao cliente) |
| 9.5 | Banner vermelho persistente com countdown |
| 9.6 | Audit log com motivo + duração + telas tocadas |
| 9.7 | Auto-logout no fim da duração (sem prompt) |

### 🔍 Onda 10 — Cmd+K com escopo expandido + atalhos avançados

| # | Item |
|---|---|
| 10.1 | Indexação backend `/search?q=...` com fuzzy match · escopo automático por RBAC |
| 10.2 | Resultados separados: Tenants / Clientes / Sites / Câmeras / Ações / Docs |
| 10.3 | Histórico de buscas recentes |
| 10.4 | Atalhos custom por persona (super: G+T = tenants, G+C = comercial) |
| 10.5 | "Quick Actions" inline (criar cliente, provisionar box) sem sair da palette |

### 📅 Cronograma

```
Sem 1   [Onda 0+1+2+3+4+5]      ✅ FEITO em 1 sessão (excepcional)
Sem 2   [Onda 6.A → 6.G]         ⏳ refator de todas as páginas restantes
Sem 3   [Onda 7]                  ⏳ MapLibre real
Sem 4   [Onda 8]                  ⏳ Theme Builder
Sem 5   [Onda 9]                  ⏳ Impersonate auditado
Sem 6   [Onda 10]                 ⏳ Cmd+K avançado
Sem 7-8 [Hardening + axe AA + E2E + perf budget]
```

---

## 10. Histórico

| Data | Quem | Mudança |
|---|---|---|
| 2026-05-05 | Claude + Tarcísio | Plano inicial consolidado a partir do diagnóstico do painel atual |
| 2026-05-05 | Claude + Tarcísio | Ondas 0–5 + 5.1 implementadas e deployadas em produção. Plano atualizado com Ondas 6–10. |

---

**Referências cruzadas:**
- Diagnóstico raiz: `docs/01-DIAGNOSTICO.md`
- Competidores estudados: `docs/05-REFERENCIA-COMPETIDORES.md`, `docs/06-MAPA-COMPETIDORES.md`
- Plano master de mercado: `docs/08-PLAN-MERCADO-NACIONAL-B2B2B.md`
- Plano edge BR: `docs/03-PLAN-EDGE-POP-BR.md`
- Plano fortalecimento cloud-box: `docs/12-PLAN-FORTALECIMENTO-CLOUD-BOX.md`
- Pre-homologação: `docs/PRE-HOMOLOGACAO-CHECKLIST.md`
