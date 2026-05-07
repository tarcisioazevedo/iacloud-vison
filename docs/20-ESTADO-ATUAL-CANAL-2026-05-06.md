# Estado atual da plataforma — visão de canal · 2026-05-06

> **Objetivo:** snapshot consolidado do que está em produção, do que foi adiado
> e do roadmap das próximas ondas. Lê em 5 minutos. Atualizar a cada
> entrega significativa.

---

## 1. TL;DR — operação de canal hoje

A plataforma tem **operação completa de canal B2B2B em dev** rodando em
`https://app.iacloud.com.br`, faltando apenas:

- 💳 **Asaas** (provisionado mas com kill-switch OFF — ativável em 1h)
- 📜 **Documenso** (Quote-to-Cash, adiado)
- 🔁 **Renewal automation** (T-30/T-7/T-1, depende de Asaas ON)

Sem esses três, o ciclo de venda termina **manualmente** (admin emite cobrança
fora da plataforma e marca contratos como ativos).

---

## 2. Personas + capacidades atuais

### 🏭 SUPER_ADMIN (fabricante)

| Capacidade | URL | Endpoint |
|---|---|---|
| Dashboard global | `/` | `/admin/integradores/stats` |
| Lista integradores | `/admin/tenants` + `/admin/whitelabel/tiers` | `/admin/integradores`, `/admin/whitelabel` |
| Editar tier WL (NONE/BASIC/PRO/ENTERPRISE) | `/admin/whitelabel/tiers` | `PUT /admin/whitelabel/:id/tier` |
| Override capabilities granular (5 flags) | idem | `PATCH /admin/whitelabel/:id/capabilities` |
| Pricing CMS master + wholesale floor | `/admin/pricing` | `/admin/pricing/*` |
| Health Score de TODOS clientes | `/health-scores` | `/admin/health-scores` |
| Health Alerts (alertas pendentes) | `/health-scores` | `/admin/health-alerts` |
| Trial: criar/extender/converter/cancelar | `/admin/trials` | `/admin/trials/*` |
| Deal Registration: aprovar/rejeitar/won | `/admin/deal-registration` | `/admin/deal-registration/*` |
| Billing Asaas (status provisionado) | `/admin/billing` | `/admin/billing/status` |
| Audit log unificado (10 fontes) | `/log-audit` | `/audit/timeline` |

### 🛒 INTEGRADOR (revendedor)

| Capacidade | URL | Capability gate |
|---|---|---|
| Cockpit (banner trial + alertas + KPIs) | `/integrador` | sempre |
| Hub white-label (Branding+Domínio+Pricing+Email) | `/me/whitelabel` | tier ≥ BASIC |
| Pricing override (com floor enforcement) | `/me/whitelabel` aba Pricing | `pricing` cap |
| Saúde dos meus clientes | `/health-scores` | sempre |
| Sales kit white-labeled (decks+ROI+verticais) | `/me/sales-kit` | sempre |
| Deal Registration (registrar prospects) | `/me/deal-registration` | sempre |
| Trial status + countdown | banner | quando em trial |

### 🏢 CLIENTE FINAL

| Capacidade | URL |
|---|---|
| Portal white-labeled (logo + cor do integrador) | `/portal/...` |
| Câmeras / live / gravações | `/cameras`, `/live`, `/recordings` |
| Personalização própria (Modelo D) | ⏳ não implementado |

---

## 3. Inventário do que foi entregue (sessão 2026-05-06)

### Backend (services + endpoints)

| Sprint | Files | Migration |
|---|---|---|
| White-label tier+caps | `whitelabel.service.ts` + middleware + `admin-whitelabel.ts` | `20260508_whitelabel_tier_pricing_multitenant` |
| Pricing CMS multi-tenant | `pricing.ts` + `admin-pricing.ts` + `me-pricing.ts` | `20260507_pricing_cms` |
| Asaas billing provisionado | `asaas.service.ts` + `admin-billing.ts` + `webhooks-asaas.ts` | `20260509_asaas_billing_provisioned` |
| Health Score | `health-score.service.ts` + `health-scores.ts` (routes) | (sem nova) |
| Health Alerts | `health-alert.service.ts` + cron + `health-alerts.ts` | `20260511_health_alerts` |
| Trial Flow | `trial.service.ts` + cron + `trials.ts` + `trial-camera-limit.ts` middleware | `20260510_trial_flow` |
| Deal Registration | `deal-registration.service.ts` + cron + `deal-registration.ts` | `20260512_deal_registration` |

### Frontend (páginas)

| Página | URL | Persona |
|---|---|---|
| AdminWhitelabelTiersPage v2 | `/admin/whitelabel/tiers` | SUPER_ADMIN |
| AdminPricingPage | `/admin/pricing` | SUPER_ADMIN |
| AdminBillingPage | `/admin/billing` | SUPER_ADMIN |
| AdminTrialsPage | `/admin/trials` | SUPER_ADMIN |
| AdminDealRegistrationPage | `/admin/deal-registration` | SUPER_ADMIN |
| HealthScoresPage | `/health-scores` | dual (admin + integ) |
| MeWhitelabelPage | `/me/whitelabel` | INTEGRADOR |
| MeDealRegistrationPage | `/me/deal-registration` | INTEGRADOR |
| MeSalesKitPage | `/me/sales-kit` | INTEGRADOR |
| SalesKitPreviewPage | `/sales-kit/preview/:type` | INTEGRADOR |
| SalesKitROIPage | `/me/sales-kit/roi` | INTEGRADOR |

### Componentes reutilizáveis

- `<TrialBanner />` no Layout (no-op se não trial)
- `<HealthActionRequired />` embebível (no-op se 0 alertas)
- `HealthScoreBadge` (já existia, plugado em mais lugares)

### Crons em background

| Job | Intervalo | Desligável via env |
|---|---|---|
| trial-expiration | 6h | `TRIAL_EXPIRATION_DISABLED=true` |
| health-alert | 6h | `HEALTH_ALERT_DISABLED=true` |
| deal-registration | 24h | `DEAL_REGISTRATION_DISABLED=true` |

---

## 4. Adiados explicitamente (com motivo)

| Item | Motivo de adiar | Gatilho pra retomar |
|---|---|---|
| **Documenso** Quote-to-Cash | Sem primeiro pagante na fila | Primeiro contrato fechado |
| **Asaas ON** (env keys + flag) | Sem cobrança real ainda | Decisão de cobrar de verdade |
| **Renewal automation** (T-30/T-7/T-1) | Depende de Asaas ON | Antes da 1ª renovação |
| **Self-serve signup** | Não é gargalo com 2 integradores | 5+ leads/semana de "quero revender" |
| **Cascade Modelo D Cliente Final** | Modelo é "integrador vende nosso negócio" | Pivô futuro |
| **Multi-moeda + multi-idioma LATAM** | Foco BR primeiro | Expansão geográfica |

---

## 5. Pendências P0 (antes de homologação)

Conforme `PRE-HOMOLOGACAO-CHECKLIST.md`:

- 🚨 **9 credenciais de produção em git history** (commits `b122d871` e `6aaa945b`)
  - PostgreSQL password
  - ICV_ENCRYPTION_KEY (cifra senhas RTSP/ONVIF/RTMP)
  - R2 access keys
  - VAPID private key
  - Evolution API key
  - SMTP password
- 🚨 **2FA/MFA** não implementado (plano em `docs/02-PLAN-2FA-MFA.md`)
- 🚨 **Push pra main bloqueado** automaticamente por hook enquanto P0 abertos

**Hook ativo:** `scripts/git-hooks/pre-push` — push para `main`/`master`
bloqueia se houver `☐` em P0 de `PRE-HOMOLOGACAO-CHECKLIST.md`. Push para
`dev` (atual) passa livre.

---

## 6. Backlog priorizado (próximas 4 ondas)

### 🔴 Onda 2 — Apoio comercial sem billing (10 dias úteis)

| Item | Esforço | ROI |
|---|---|---|
| Webhooks genéricos (subscription/camera events) | 3d | ⭐⭐⭐ |
| Self-serve signup (`/register-lead` + flag integrador) | 1d | ⭐⭐⭐ |

### 🟡 Onda 3 — Compliance enterprise (15 dias úteis)

| Item | Esforço | Bloqueia |
|---|---|---|
| **2FA/MFA TOTP** | 4-5d | Homologação |
| **LGPD Compliance hub** (DSAR self-serve UI + RoPA) | 1 sem | Venda enterprise |
| **Status page pública** (`status.iacloud.com.br`) | 3d | Credibilidade |
| **PRE-HOMOLOGACAO-CHECKLIST P0 fechado** | 1d (rotação) | Push pra main |

### 🟢 Onda 4 — Escalar canal (30+ dias úteis)

- Partner Tier Program (Bronze/Silver/Gold + volume discount)
- Customer Success playbooks (QBR + NPS automatizado)
- Knowledge Base white-labeled
- API pública + portal `/docs`
- Marketplace de módulos
- Mobile app branded
- Anti-fraud ML

### 🔵 Quando primeiro pagante fechar

1. Ativar Asaas (1h)
2. Documenso (4-5d)
3. Renewal automation (2-3d)

---

## 7. Métricas e telemetria

Endpoints úteis pra acompanhar:

- `/admin/integradores/stats` — counts globais
- `/admin/health-scores` — saúde de todos os clientes
- `/admin/trials` — pipeline de trials ativos
- `/admin/deal-registration` — pipeline de deals + conversão
- `/audit/timeline?days=7` — todas as ações na semana
- `/admin/billing/status` — status Asaas (ON/OFF)

---

## 8. Riscos operacionais conhecidos

| Risco | Mitigação atual | Próxima ação |
|---|---|---|
| Linter automático apaga arquivos novos | Commit imediato após cada feature | Investigar trigger do linter |
| Erros TS pré-existentes em `cameras.ts` (~10) | tsx em prod ignora, não bloqueia | Sprint dedicado de cleanup |
| `INTEGRATION` submodule pointer dirty | Cosmético, não afeta build | Atualizar submodule |
| Migrations fora de ordem alfabética em fresh deploys | DB atual OK; clones novos podem falhar | Rename `20260507_pricing_cms` ANTES do `20260508_whitelabel_*` em fresh deploy ou marcar `--applied` |
| 9 secrets em git history | Listados em PRE-HOMOLOGACAO | Rotacionar antes de prod externa |
| Sem 2FA | Acesso por email/senha apenas | Bloqueador enterprise |

---

## 9. Como demonstrar a plataforma hoje (script)

**SUPER_ADMIN** (`admin@iacloudvision.com.br` / `Admin@123`):

1. `/admin/whitelabel/tiers` — mostra cockpit de canal: filtros, KPIs por tier, drill-down
2. Clica num integrador → modal com edição inline + atalhos (cockpit, audit, health)
3. `/admin/pricing` — edita preço/wholesale de plano. Troca tagline → vai em `/pricing` e mostra atualizado em <1s
4. `/admin/trials` — cria trial 5d num integrador → mostra cron run gerando notificações
5. `/admin/deal-registration` — aprova um deal → CNPJ trava 30d
6. `/log-audit` — mostra todas as ações registradas

**INTEGRADOR** (`integrador@visaocorp.com.br` / `Integrador@123`):

7. `/integrador` — banner trial amarelo + card de cliente em atenção
8. `/me/whitelabel` — 4 sub-tabs (Branding+Domínio+Pricing+Email)
9. Aba Pricing → "Personalizar" Starter → tenta R$ 100 → erro "abaixo do floor R$ 900"; coloca R$ 1.500 → salva
10. `/me/deal-registration` — registra prospect com check de CNPJ em tempo real
11. `/me/sales-kit` → click em "Apresentação Institucional" → preview com **logo VisionCorp** automático → "Imprimir/Salvar PDF"

**Tempo total:** ~10 minutos.

---

## 10. Estatísticas da entrega

- **Período:** sessão única 2026-05-06
- **Commits no `dev`:** 11 (todos pushados pra `origin/dev`)
- **Migrations aplicadas:** 5 novas (whitelabel, pricing CMS, asaas, trial, health-alerts, deal-reg)
- **Models novos:** 11 (`HealthAlert`, `DealRegistration`, `AsaasCustomer/Subscription/WebhookEvent`, `PlatformPlan`, `AIAddonPlan`, `VMSStoragePrice`, `PricingHero`, `PricingSettings`, `CompetitorComparison`)
- **Endpoints novos:** ~50
- **Páginas frontend novas:** 11
- **E2E em produção:** **57/57 testes passando** (validação 2026-05-06 22h)
- **Audit log cobertura:** 12/12 actions críticas registradas

---

## 11. Próximas decisões esperadas

1. **Ativar Asaas?** Quando? Depende de primeiro pagante.
2. **2FA agora ou esperar?** Bloqueia homologação enterprise mas pode esperar dev avançar.
3. **Push pra main?** Bloqueado até P0 fechado — quando rotacionar secrets?
4. **Doc 17 (storage admin)** mencionado mas não revisado nesta sessão — relevante?

---

## Anexos

- `docs/16-PLAN-WHITELABEL-PRICING-MULTITENANT.md` — plano original WL
- `docs/PRE-HOMOLOGACAO-CHECKLIST.md` — gate de produção
- `docs/02-PLAN-2FA-MFA.md` — plano 2FA aguardando execução
- `docs/19-PLANO-EXECUCAO-90D.md` — roadmap macro

**Última atualização:** 2026-05-06 23:00 BRT
