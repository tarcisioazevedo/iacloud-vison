# 19 — Plano de Execução 90 Dias (Índice Executável)

> **Data:** 2026-05-06 · **Status:** Master de execução
> **Substitui:** nada. **Cruza:** `08` (mercado), `17` (storage), `PRE-HOMOLOGACAO-CHECKLIST.md`.
> **Princípio:** uma fase de cada vez. Critério de saída duro. Não começa fase N+1 com débito da fase N.

---

## 0. Estado real (1 parágrafo)

Score MVP **68/100**. Multi-tenant B2B2B 3-níveis pronto, 8 roles RBAC, live WHEP+fallback,
playback HLS, gravação, Face/LPR/Audio/Semantic, edge box em produção, notificações 4 canais,
audit com diff, **77 páginas, 80 modelos Prisma, 67 rotas, 47 services**.
**Não falta produto — falta saída de fábrica:** P0 0/7, zero testes, sem CI/CD VSaaS,
sem 2FA, sem pricing público, sem onboarding self-service, sem fatura R2 automática,
gravação MOTION é stub que grava 24/7.

---

## 1. Os 6 módulos (eixos perpendiculares — atravessam todas as fases)

| # | Módulo | Score atual | Fonte de verdade |
|---|---|---|---|
| **M1** | Trust & Safety (P0, 2FA, hardening, backup, observabilidade) | 30/100 🔴 | `PRE-HOMOLOGACAO-CHECKLIST.md` |
| **M2** | Quality & Release (E2E + unit + CI/CD + smoke API) | 5/100 🔴 | — |
| **M3** | Core VMS Polish (MOTION real, timeline, PPE, mosaico dinâmico, brand) | 80/100 🟡 | `08` §5 ondas 1-3 |
| **M4** | Operações Storage / Retenção (RetentionPlan, fatura R2, dashboard margem) | 40/100 🟡 | `17` §6 fases A-D |
| **M5** | Onboarding & GTM (pricing público, wizard self-service, trial 14d, mobile push) | 20/100 🔴 | `08` §7 |

---

## 2. Fases (90 dias)

### 🔵 Fase 0 — Fundação (M0, dias 1-30) — **NADA externo entra antes disto**

**Foco:** M1 + M2. Zero feature nova. Saída obrigatória pra abrir piloto.

| # | Entrega | Módulo | Critério de aceite | Esforço |
|---|---|---|---|---|
| 0.1 | P0 1-7 do checklist (rotação completa + git filter-repo) | M1 | `PRE-HOMOLOGACAO-CHECKLIST.md` 7/7 ☑ | 3-5 d |
| 0.2 | 2FA TOTP no login (executar plano `02`) | M1 | SUPER_ADMIN exige 2FA | 2 d |
| 0.3 | Backup pg + R2 off-site automatizado (cron + restore validado) | M1 | Restore em VM limpa funciona | 1 d |
| 0.4 | Sentry/Loki ligados (runbook 11) | M1 | Primeira alerta de erro recebida | 1 d |
| 0.5 | Mosquitto MQTT com TLS + auth | M1 | `allow_anonymous false` | 0.5 d |
| 0.6 | GitHub Actions: typecheck + lint + e2e Playwright + bundle budget | M2 | PR vermelho bloqueia merge | 2 d |
| 0.7 | 5 unit suites backend (recording, r2, ingest, live, auth) | M2 | ≥80% nos paths críticos | 3 d |
| 0.8 | 5 specs E2E novas: F1 onboarding, F2 box-provision, F4 motion-real, F6 export-forense, F7 billing | M2 | Verde no CI | 3 d |
| 0.9 | MOTION real (parar de gravar 24/7 com `recordMode=MOTION`) — item 3B.5 do `08` | M3 | Câmera MOTION só grava ao detectar | 0.5 sem |
| 0.10 | Bug `prisma.recording.count` em `routes/integradores.ts:1006` | M3 | Removido + testado | 0.2 d |
| 0.11 | Voltar a usar `tsc` em prod (corrigir TS6059) | M1 | Container roda compilado | 1 d |
| 0.12 | `RECORDING_DELETE_LOCAL_AFTER_S3=true` | M1 | Disco VPS não enche | 0.1 d |

**Saída da Fase 0:** posso convidar 1 integrador conhecido sem queimar marca. **Não posso ainda escalar.**

---

### 🟢 Fase 1 — Vendabilidade (dias 31-60)

**Foco:** M3 polish + M4 storage comercial + M6 onboarding básico. Objetivo: **3 integradores piloto pagando**.

| # | Entrega | Módulo | Critério de aceite | Esforço |
|---|---|---|---|---|
| 1.1 | Pricing público em `/pricing` (4 tiers do `08` §7.1) | M6 | Página viva, comparativo Monuv | 2 d |
| 1.2 | Onboarding self-service integrador (wizard 4 passos: branding → domínio → 1ª câmera → trial 30d) | M6 | 1 lead = 1 tenant sem call | 1 sem |
| 1.3 | Asaas `BILLING_ENABLED=true` + fatura mensal automática integrador | M4 | 1ª fatura emitida em staging | 3 d |
| 1.4 | `17` Fase A: `RetentionPlan` SKU + atribuição por câmera + lifecycle por prefix + cálculo R2 → linha de fatura | M4 | Câmera tem plano, fatura tem linha R2 | 1.5 sem |
| 1.5 | `ApprovalAction.STORAGE_RETENTION_UPGRADE` + UI cascateada CF→INT→SA | M4 | Upgrade aprovado em <4h | 3 d |
| 1.6 | TenantCockpit StorageTab: GB → R$ + plano contratado + botão upgrade | M4/M6 | Cliente vê o que paga e paga sozinho | 2 d |
| 1.7 | Brand polish (3B.8): paleta CSS variables aplicada nas 77 páginas + Inter/Geist | M3 | `04-BRAND-GUIDE.md` aplicado | 1 sem |
| 1.8 | Timeline cores semânticas + frame-by-frame | M3 | Cores motion/event/cont separadas | 3 d |
| 1.9 | Mosaico dinâmico em alarme (3X.1 do `08`) | M3 | Toast clica → câmera abre destacada | 3 d |
| 1.10 | PPE page real (schema pronto) | M3 | Dashboard com eventos PPE reais | 1 sem |
| 1.11 | Custom domains com SSL automático | M3/M6 | 1 domínio CF com cert válido | 3 d |

**Saída da Fase 1:** 3 integradores piloto pagos (1 CMA, 1 condomínio, 1 varejo). MRR R$ 5-10k. Marca polida. Storage vira receita.

---

### 🟣 Fase 2 — Diferenciação & escala (dias 61-90+)

**Foco:** o que sobra do M3 + M5 + diferenciadores do `08` §5 (Onda 4). **Selecionar 4-5 por valor real, não fazer tudo.**

Candidatos priorizados:

| # | Item | Por que | Esforço |
|---|---|---|---|
| 3.1 | Smart Search NLP em vídeo gravado em produção (3B.1) | Pipeline existe, falta polimento | 2 sem |
| 3.2 | **Visual Assistant LLM (4X.1) — diferencial REAL nenhum competidor BR tem** | Cliente descreve em PT, vira `SemanticTrigger` | 2-3 sem |
| 3.3 | Mobile nativa Capacitor + push profundo FCM/APNs (4.1) | Operador no celular, push verdadeiro | 4-6 sem |
| 3.4 | Detecção fogo/arma (4X.3) | Gap vs. BeNuvem | 2 sem |
| 3.5 | Chain of custody PDF (3B.3) | Venda governo/condomínio | 0.5 sem |
| 3.6 | Edge PoP BR (3B.4 / `03`) | Latência 400→130ms; ~$12/mês | 0.5 sem |
| 3.7 | Bookmark legal hold + cold storage R2 | Compliance vertical | 1 sem |
| 3.8 | i18n en-US (+ es-ES) | Mercosul | 1.5 sem |

**Saída da Fase 2:** 10-20 integradores ativos. MRR R$ 50k+. Posicionamento claro vs. Monuv/BeNuvem/Verkada.

---

## 3. Visão de QA Sr. — fluxos críticos a cobrir

| F | Fluxo | Risco hoje | Cobre em |
|---|---|---|---|
| F1 | Onboarding integrador (lead → trial → 1ª câmera) | 🔴 Sem self-service | Fase 1.2 |
| F2 | Provisionar Box (QR → install → heartbeat) | 🟡 Falta repo público + DNS `get.iacloud.com.br` | Fase 0 (P1 do checklist) |
| F3 | Live + Playback | 🟢 OK | E2E já existe |
| F4 | Gravação contínua + retenção + MOTION | 🟡 MOTION é stub | Fase 0.9 |
| F5 | Evento → notificação → ack | 🟢 OK | E2E já existe |
| F6 | Export forense (MP4 + HMAC + chain of custody PDF) | 🟡 PDF não existe | Fase 3.5 |
| F7 | Billing + quota + upgrade retenção | 🔴 Asaas inativo | Fases 1.3-1.6 |

---

## 4. Visão UX/UI Sr. — top 10 furos

| # | Onde | Sintoma | Fase |
|---|---|---|---|
| U1 | Timeline gravação | Sem cor semântica | 1.8 |
| U2 | Mosaico em alarme | Toast aparece, mosaico não reage | 1.9 |
| U3 | PPE page | Placeholder | 1.10 |
| U4 | StorageTab cockpit | Mostra GB, não converte R$ | 1.6 |
| U5 | Storage matriz | 40 cards estáticos como Monuv | 1.6 |
| U6 | Forms longos (camera, edge) | Sem validação inline progressiva | Fase 2 polish |
| U8 | Onboarding integrador | Não existe wizard self-service | 1.2 |
| U9 | Mobile portal CF | Sem panic button + biometria | Fase 2 mobile |
| U10 | Custom domains | UI pronta, SSL não automático | 1.11 |

---

## 5. Comercial — checklist do que integrador precisa pra vender

| # | Item | Estado | Fase |
|---|---|---|---|
| C1 | Pricing público | 🔴 | 1.1 |
| C2 | Onboarding self-service | 🔴 | 1.2 |
| C3 | Fatura automática Asaas + R2 passthrough | 🔴 | 1.3-1.4 |
| C4 | Sales kit (decks/ROI/landing/case) | ✅ commit `86e18af5` | — |
| C5 | Deal Registration | ✅ commit `b16b60ec` | — |
| C6 | Aprovação cascateada CF→INT→SA (storage) | 🟡 modelo existe, sem ações storage | 1.5 |
| C7 | Trial 14d sem cartão | 🔴 | 1.2 |
| C8 | Painel margem do integrador | 🔴 | 1.4 |

---

## 6. Investimento humano

| Apoio | Quando entra | Custo |
|---|---|---|
| Tarcísio (dev solo) | Sempre | — |
| Freelancer QA 10h/sem | Fase 0 | R$ 1.5-3k/mês |
| Dev pleno full-time | Fase 1+ | R$ 8-12k/mês |
| PM/CS part-time | Fase 2 quando 5+ integradores | R$ 5-8k/mês |

---

## 7. Próximas 5 ações (esta semana)

1. **Rotacionar P0 #1 (DB password) e #2 (ICV_ENCRYPTION_KEY com dual-key)** — bloqueia tudo
2. **Asaas: ligar `BILLING_ENABLED=true` em staging** + emitir 1 fatura de teste
3. **Subir GitHub Actions com Playwright + typecheck + lint** — sem isto M2 não anda
4. **Congelar `04-BRAND-GUIDE.md`** (paleta + tipografia) e aplicar em `/login` + `/dashboard` como prova de conceito

---

## 8. Riscos a monitorar

| Risco | Mitigação |
|---|---|
| Tentação de pular Fase 0 pra "ganhar tempo" | Pre-push hook já bloqueia push p/ main com P0 aberto |
| Storage R2 sangrar com MOTION stub (24/7) | Fase 0.9 obrigatória antes de 1º piloto |
| Sentry/Loki só dão alerta depois que cliente reclama | Fase 0.4 + dashboards básicos já no dia 1 do piloto |
| Dev pleno entra antes de CI funcionar → caos | CI antes de hire (ordem 0.6 → freelancer/contratação) |

---

## 9. Como usar este documento

- **Toda segunda:** revisar status da fase atual (entregas X/Y, % verde)
- **Não pular fases.** Saída duro = passa de fase.
- **Ao receber pedido novo do mercado** (cliente, integrador, conferência): só entra se substituir item de menor prioridade na fase atual.
- **Atualizar score de cada módulo** ao final de cada fase.
- **Quando Fase 0 fechar:** marcar `PRE-HOMOLOGACAO-CHECKLIST.md` 7/7 ☑ e abrir piloto formal.

---

**Resumo de 1 frase:** 30 dias pra ter saída de fábrica, 30 dias pra vender, 30 dias pra diferenciar. Tudo o resto é opcional, escolhido por dado de mercado.
