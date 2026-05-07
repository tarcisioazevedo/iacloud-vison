# IA Cloud Vision — Estado do Canal & Roadmap (2026-05-06)

> Snapshot do que está em produção, o que ficou pendente e a sequência
> recomendada para os próximos 30/60/90 dias.

---

## 1. TL;DR — onde estamos

**Plataforma comercial pronta para fechar 1° integrador piloto.** Falta apenas
billing real (Asaas ON) e contrato digital (Documenso) — gatilhos comerciais.

| Camada | Status |
|---|---|
| Multi-tenant (3 níveis: Fabricante / Integrador / Cliente Final) | ✅ |
| White-label tier+capabilities + Pricing CMS multi-tenant | ✅ |
| Saúde do canal (Health Score + Alertas proativos) | ✅ |
| Pré-venda (Trial Flow + Sales Kit white-labeled) | ✅ |
| Proteção de canal (Deal Registration 30d) | ✅ |
| **Billing/cobrança** | 🟡 provisionado, kill-switch off |
| **Contrato digital (Quote-to-Cash)** | ⏳ adiado |
| **Renewal automation** | ⏳ depende de billing ON |
| **2FA/MFA** | ❌ bloqueador homologação enterprise |

**E2E validado:** 57/57 testes passaram em 2026-05-06.

---

## 2. Inventário — o que está EM PRODUÇÃO

### 2.1 White-label

| Recurso | URL | Endpoints |
|---|---|---|
| Tiers & Capabilities (SUPER_ADMIN) | `/admin/whitelabel/tiers` | `GET/PUT/PATCH/DELETE /admin/whitelabel/:id/*` |
| Hub do integrador (4 sub-tabs) | `/me/whitelabel` | `GET /me/integrador/whitelabel` |

**4 tiers:** NONE / BASIC / PRO / ENTERPRISE
**5 capabilities:** branding · domain · pricing · email · clientCustomization
Defaults por tier resolvíveis em `services/whitelabel.service.ts` com cache 60s.
Override granular permite ligar/desligar capability sem mudar tier.

### 2.2 Pricing CMS

| Recurso | URL |
|---|---|
| Editor master (SUPER_ADMIN) | `/admin/pricing` (6 sub-tabs) |
| Override por tenant (INTEGRADOR ≥ PRO) | `/me/whitelabel` aba Pricing |
| Página pública (multi-tenant) | `/pricing` (detecta `X-ICV-Tenant`) |

**6 entidades:** PlatformPlan · AIAddonPlan · VMSStoragePrice · PricingHero · CompetitorComparison · PricingSettings.
Floor de preço (`wholesalePriceMonthly`) protege margem do fabricante.
Cache 60s in-memory por tenant; invalidação automática em mutações.

### 2.3 Billing (Asaas) — provisionado

| Recurso | URL |
|---|---|
| Status | `/admin/billing` |
| Webhook | `POST /webhooks/asaas` (kill-switch off → 503) |

Schema completo + service + 4 endpoints + cron pronto.
**Para ativar:** setar `ASAAS_API_KEY` + `ASAAS_WEBHOOK_SECRET` + `BILLING_ENABLED=true`.

### 2.4 Saúde dos clientes

| Recurso | URL | Cron |
|---|---|---|
| Health Score (semáforo 0-100, 5 sinais) | `/health-scores` | — |
| Health Alerts (proativos, 24h cooldown) | inline em `/integrador` cockpit | a cada 6h |

5 sinais ponderados:
- Câmeras ativas (30%)
- Edge boxes ONLINE (25%)
- Atividade 24h (20%)
- Quota Vertex (15%)
- Última atividade (10%)

Tiers: optimal · good · warn · bad · critical.
Alert auto-resolvido quando score volta a warn+.

### 2.5 Trial Flow

| Recurso | URL | Cron |
|---|---|---|
| Cockpit do canal (SUPER_ADMIN) | `/admin/trials` | a cada 6h |
| Banner do integrador | global no Layout | — |

Defaults: 14 dias / 5 câmeras.
Lembretes T-7/T-3/T-1/T-0 (idempotentes).
Auto-suspend ao expirar.
Camera limit middleware bloqueia 6ª câmera.

### 2.6 Deal Registration

| Recurso | URL | Cron |
|---|---|---|
| Cockpit (SUPER_ADMIN) | `/admin/deal-registration` | 1×/dia |
| Pipeline integrador | `/me/deal-registration` | — |

Exclusividade 30d por CNPJ (UNIQUE INDEX parcial protege em DB).
Atividade comercial estende +15d.
Estados: PENDING · APPROVED · REJECTED · WON · LOST · EXPIRED.

### 2.7 Sales Kit white-labeled

| Recurso | URL |
|---|---|
| Hub do integrador | `/me/sales-kit` |
| ROI Calculator | `/me/sales-kit/roi` |
| Decks PDF (print-friendly) | `/sales-kit/preview/{institutional,technical}` |
| 6 verticais | `/sales-kit/preview/vertical/{slug}` |

Verticais: Varejo · Condomínio · Indústria · Smart City · Saúde · Educação.
3 templates de email copiáveis.
Logo + cores do integrador injetados automaticamente.
Sem dependência de Puppeteer (browser native print).

### 2.8 Health Score (cockpit)

Card "Ações Necessárias" embebido em `/integrador` e `/health-scores`.
Acknowledge inline. Sugestões automáticas em pt-BR baseadas no signal pior.

---

## 3. Stack técnico

| Camada | Tecnologia | Notas |
|---|---|---|
| Backend | Node 20 + Express + Prisma 5 + tsx | sem build em prod |
| DB | PostgreSQL 16 | Hetzner VPS |
| Frontend | React 19 + Vite + Tailwind + SWR | bundle ~250kb gz |
| Deploy | Docker Swarm (1 node) | Caddy proxy + Let's Encrypt |
| Storage | Cloudflare R2 + Hetzner S3 | multi-backend |
| Cron | setInterval in-process | trial · health-alerts · deal-registration · sales |

**Migrations recentes:**
- `20260507_pricing_cms` (CMS 6 tables)
- `20260508_whitelabel_tier_pricing_multitenant`
- `20260509_asaas_billing_provisioned`
- `20260510_trial_flow`
- `20260511_health_alerts`
- `20260512_deal_registration`

---

## 4. Cobertura E2E (2026-05-06)

```
57 testes · 57 passou · 0 falhou

✅ Auth (SUPER_ADMIN + INTEGRADOR)
✅ White-label (5 transições + override + reset + validação)
✅ Pricing CMS (7 endpoints + cache invalidation)
✅ Health Scores + Alerts (admin + integrador + cron)
✅ Trial Flow (criar + cron + estender + converter)
✅ Deal Registration (anti-dup + aprovar + atividade + won)
✅ Billing (status provisionado + webhook 503)
✅ Integrador endpoints (6 GETs)
✅ Pricing público (com 4 planos)
✅ Audit log (12/12 actions registradas)
✅ Frontend (12 URLs)
```

---

## 5. Pendente

### 5.1 P0 adiados (gatilho comercial)

| # | Item | Esforço | Quando |
|---|---|---|---|
| 1 | Documenso self-host (Quote-to-Cash) | 4-5d | 1° integrador na fila pra contrato |
| 2 | Ativar Asaas (env keys + flag) | 1h | Decisão de cobrar |
| 3 | Renewal automation (T-30/T-7/T-1 + dunning) | 2-3d | Antes da 1ª renovação |

### 5.2 P1 — segurança/compliance (bloqueadores enterprise)

| # | Item | Esforço | Bloqueia |
|---|---|---|---|
| 4 | 2FA/MFA (TOTP + WebAuthn) | 4-5d | Homologação · SOC2/LGPD |
| 5 | LGPD Compliance hub (DSAR self-serve, RoPA) | 1 sem | Venda enterprise |
| 6 | Rotacionar 9 secrets em git history | 1d | **Push pra main bloqueado** |
| 7 | Status page pública | 3d | Credibilidade |

### 5.3 P2 — apoio comercial

| # | Item | Esforço | Quando |
|---|---|---|---|
| 8 | Self-serve signup integrador (em `/register-lead`) | 1d | 5+ leads/semana de "quero revender" |
| 9 | Webhooks genéricos (camera.online, subscription.created, ...) | 3d | Integrador pedir |
| 10 | Knowledge Base white-labeled | 1 sem | 3+ integradores ativos |

### 5.4 P3 — escala (após 5+ integradores)

- Partner Tier Program (Bronze/Silver/Gold + volume discount)
- Customer Success playbooks (QBR + NPS automation)
- API pública + portal `/docs` formal
- Marketplace de módulos
- Mobile app branded
- Anti-fraud ML
- Cascade Modelo D (Cliente Final customiza) — descartado pelo Tarcísio

---

## 6. Riscos / débitos técnicos

| Item | Severidade | Mitigação |
|---|---|---|
| 9 secrets de prod no git history (`b122d871`, `6aaa945b`) | 🔴 | `docs/PRE-HOMOLOGACAO-CHECKLIST.md` bloqueia push pra main |
| 2FA não implementado | 🟠 | Pra venda enterprise — endereçar antes de homologação |
| TypeScript errors pré-existentes em `cameras.ts` (~10) | 🟡 | Não bloqueia tsx; débito de qualidade |
| Linter agressivo apagando arquivos novos (observado nesta sessão) | 🟡 | Commitar a cada step; ter â ncora git |
| Crons in-process (não distribuído) | 🟡 | Funciona com 1 node Swarm; precisa repensar com cluster |
| Migration `20260507` aplicada antes de `20260508` (out of name order) | 🟢 | Renomeada; fresh deploys OK |

---

## 7. Roadmap próximas 12 semanas

### Sem 1-3 (Onda imediata)
- 2FA/MFA TOTP (P1) — bloqueador removido pra enterprise
- (opcional) Rotacionar 9 secrets pra liberar push pra main

### Sem 4-6 (Quando 1° contrato fechar)
- Ativar Asaas (1h)
- Documenso self-host (4-5d)
- Renewal automation (2-3d)

### Sem 7-9 (Após primeiros pagantes)
- Self-serve signup integrador
- Webhooks genéricos
- LGPD Compliance hub

### Sem 10-12 (Escala)
- Status page pública
- Knowledge Base white-labeled
- Partner Tier Program

---

## 8. Personas e suas URLs principais

### SUPER_ADMIN (`admin@iacloudvision.com.br`)
```
/                              Dashboard global
/admin/tenants                 Lista de integradores (drill cockpit)
/admin/whitelabel/tiers        WL tiers + capabilities
/admin/pricing                 Pricing CMS (master + wholesale)
/admin/billing                 Status Asaas
/admin/trials                  Trials ativos
/admin/deal-registration       Pipeline deal registration
/admin/comercial               Pipeline comercial
/health-scores                 Saúde de todos os clientes
/audit                         Auditoria global
```

### INTEGRADOR (`integrador@visaocorp.com.br`)
```
/                              Cockpit "Meu Negócio" (com card Ações Necessárias)
/me/whitelabel                 Hub WL (Branding+Domínio+Pricing+Email)
/me/sales-kit                  Material de venda white-labeled
/me/sales-kit/roi              ROI Calculator
/me/deal-registration          Meus deals registrados
/health-scores                 Saúde dos meus clientes
/clientes-finais               CRUD clientes
/cameras /sites /live /recordings
/integrador                    Cockpit detalhado
```

### CLIENTE_FINAL (via portal)
```
/portal                        Entry com magic-link
/portal/home                   Dashboard cliente
```

---

## 9. Credenciais dev / homologação

```
SuperAdmin:  admin@iacloudvision.com.br      / Admin@123
Integrador:  integrador@visaocorp.com.br     / Integrador@123
Operador:    operador@shoppingboavista.com.br / Operador@123
```

Branch atual: `dev` · Último commit: `6ad230b4` · Sincronizado com `origin/dev`.

---

## 10. Métricas alvo (para acompanhar)

| Métrica | Hoje | Alvo 30d | Alvo 90d |
|---|---|---|---|
| Integradores ativos | 2 (1 piloto) | 3 | 8 |
| Health Score médio | 50 | 70 | 80 |
| Deals registrados (APPROVED) | 1 | 5 | 20 |
| Deals WON (conversão) | 0 | 2 | 8 |
| Trials ativos | 1 | 5 | 15 |
| Receita mensal | R$ 0 | R$ 5k | R$ 30k |

---

> Documento mantido por Claude (Anthropic) em colaboração com Tarcísio.
> Atualizar quando novo bloco entregue ou roadmap reordenado.
