# Manual do Hub Comercial — IACloud Vision

> Versão 1.0 · Maio 2026
> Público-alvo: equipe comercial (SDR, AE, CS, gerente, diretor)

---

## 📋 Sumário

1. [Visão geral](#visão-geral)
2. [Mental model dos 3 tenants](#mental-model)
3. [Como acessar](#como-acessar)
4. [Roteiro do dia a dia por persona](#roteiro)
5. [Tabs do Hub Comercial](#tabs)
6. [Hooks automáticos](#hooks)
7. [Cenário end-to-end completo](#cenário)
8. [Métricas e indicadores](#métricas)
9. [FAQ e troubleshooting](#faq)

---

## 🎯 Visão geral <a id="visão-geral"></a>

O **Hub Comercial** (`/admin/comercial`) é o centro de operação de vendas da plataforma. Concentra:

- **CRM** de leads (novos prospects)
- **Pipeline visual** kanban com drag-and-drop
- **Demos** (pendentes, ativas, histórico)
- **Oportunidades** de cross-sell/upsell na base instalada
- **Atividades** (calls, emails, WhatsApp, reuniões)
- **Equipe & Metas** com ranking
- **Materiais** comerciais (scripts, decks, vídeos)
- **Pricing**, **Faturamento** (em construção), **BI Contratado×Utilizado**

A maioria das ações são **automatizadas via hooks** — você foca em conversar com o cliente, o sistema atualiza score, goals, opportunities e atividades em background.

---

## 🧠 Mental Model <a id="mental-model"></a>

### Pirâmide de tenants

```
FABRICANTE (nós)  →  INTEGRADORES (revendedores)  →  CLIENTES FINAIS
                                                     (loja, indústria, condomínio)
```

A equipe comercial vende:
- **Para integradores** (canal B2B reseller) — leads com `kind=INTEGRADOR`
- **Para clientes finais diretos** (modelo direto) — leads com `kind=CLIENTE_FINAL`

E faz **cross-sell/upsell** de módulos de IA na base instalada (integradores existentes).

### Funil

```
LEAD CAPTURE (público)  →  QUALIFICAÇÃO (SDR)  →  DEMO (AE)  →  FECHAMENTO  →  EXPANSÃO (CS)
       /register-lead        Pipeline NEW         DEMO_SENT     CONVERTED       cross-sell/upsell
```

---

## 🔑 Como acessar <a id="como-acessar"></a>

1. Login em `https://app.iacloud.com.br` com role `SUPER_ADMIN` ou `ADMIN_GLOBAL`
2. Sidebar → **🎯 Comando** → **💼 Comercial**
3. URL direta: `https://app.iacloud.com.br/admin/comercial`

Deep-links por tab:
- `?tab=executive` — Visão Executiva (CCO/Diretor)
- `?tab=pipeline` — Kanban
- `?tab=demos` — Hub de Demos (sub-abas Pendentes/Ativas/Histórico)
- `?tab=opportunities` — Oportunidades cross-sell/upsell
- `?tab=team` — Equipe & Metas
- `?tab=activities` — Feed de atividades
- `?tab=materials` — Biblioteca

---

## 🎬 Roteiro do dia a dia por persona <a id="roteiro"></a>

### 📞 SDR (Sales Development Rep) — Maria

**8h30 — Início do dia**
1. Abre `Pipeline` → vê leads NEW (com score visível: 30-100)
2. Prioriza por score: ≥75 (vermelho) primeiro

**Durante o dia**
3. Hover no card de lead → clica 📞 Phone → modal abre
4. Faz a ligação no app externo (em paralelo)
5. Registra no modal: duração, resultado (positivo/neutro/negativo), notas
6. Sistema cria `SalesActivity{type:CALL}` e bump goal `CALLS`
7. Se positivo, arrasta o card para coluna `CONTACTED`
8. Sistema atualiza Lead + cria Activity NOTE de transição automaticamente

**Quando consegue agendar demo**
9. Vai em `Demos > Pendentes` → encontra o lead
10. Clica **Aprovar Demo** → sistema:
    - Gera magic link 14 dias
    - Envia email rico ao lead com link + tutorial
    - Lead vai para coluna `DEMO_SENT`
    - Bump goal `DEMOS_SENT`
    - Cria Activity DEMO_DONE

### 🎯 AE (Account Executive) — João

**Recebe lead qualificado**
1. Lead aparece em `Pipeline > DEMO_SENT`
2. Conduz demo via Zoom/Meet (em paralelo)
3. Após demo, registra atividade no modal: outcome positivo
4. Envia proposta:
   - Vai em `Atividades` → "+ Registrar"
   - Tipo: PROPOSAL_SENT
   - Notas: "Proposta R$ 5k MRR enviada por email"

**Quando fecha**
5. PATCH /leads/:id {status: CONVERTED, convertedIntegradorId: ...}
6. Sistema **automaticamente**:
   - Marca SalesOpportunity NEW_LEAD como **WON**
   - Bump goals `DEALS_CLOSED` e `CLOSED_MRR`
   - Cria Activity NOTE "🎉 Lead convertido"
   - Atribui CS ao novo Integrador (round-robin)

### 🤝 CS (Customer Success) — Carla

**Recebe atribuição automática**
1. Tab `Atividades` → vê task auto-criada "Novo tenant atribuído. Iniciar onboarding."
2. Liga para fazer onboarding
3. Registra Activity {type: MEETING, notes: "Onboarding sucesso"}

**Cross-sell mensal**
4. Tab `Oportunidades` → clica **Auto-detectar**
5. Sistema analisa todos os tenants e sugere:
   - Cliente em PARKING sem LPR → "Adicionar Placas"
   - Cliente em INDUSTRIAL sem PPE → "Adicionar EPI"
   - Quota Vertex > 80% → "Upgrade plano"
   - Etc.
6. Carla revisa lista, liga para o integrador apresentando a oportunidade
7. Quando integrador aceita e contrata o módulo:
   - Super_admin habilita módulo via cockpit do tenant
   - Sistema **automaticamente** marca Opportunity WON
   - Bump goal CLOSED_MRR de Carla

### 👔 Gerente Comercial — Pedro

**Segunda 9h**
1. Abre `Visão Executiva` → vê:
   - MRR fechado mês: R$ X
   - Pipeline value: R$ Y
   - Win rate, ticket médio, conversão
   - Funil do mês
   - Top 5 oportunidades abertas
   - **Ranking de performers** (ordenado por MRR mês)
2. Identifica quem está abaixo da meta
3. Abre `Equipe & Metas` → ajusta metas individuais

### 🏆 Diretor / CCO — Tarcísio

**Sexta 17h**
1. Abre `Visão Executiva`
2. Captura screenshot dos KPIs
3. Manda para conselho com 1 frase: "MRR cresceu X% mês, Y deals fechados"

---

## 📑 Tabs do Hub Comercial <a id="tabs"></a>

### 🏠 Visão Executiva
**Quem usa:** CCO, Diretor, Gerente
**O que tem:** 5 KPIs grandes (MRR, Pipeline, Win Rate, Ticket Médio, Conversão), funil mensal, top oportunidades abertas, ranking do time.

### 🎯 Pipeline (Kanban)
**Quem usa:** SDR, AE
**O que tem:** 5 colunas (Novos, Contatados, Demo enviada, Convertidos, Perdidos) + seção "Expansão de Base" (cross-sell/upsell). Cards arrastáveis. Hover mostra atalhos call/email/WhatsApp que abrem modal de registrar atividade.

### 👥 Leads (CRM)
**Quem usa:** SDR
**O que tem:** Versão completa da `LeadsPage` com filtros, busca, follow-ups, conversão.

### 🎬 Demos
**Quem usa:** SDR, AE
**Sub-tabs internas:**
- **Pendentes** — leads NEW aguardando aprovação (SLA 1d útil), botões Aprovar/Rejeitar
- **Ativas** — DemoInvites válidos com tracking
- **Histórico** — convertidas + perdidas

### 💎 Oportunidades
**Quem usa:** AE, CS, gerente
**O que tem:** 2 seções:
- **Expansão de base** (cross-sell/upsell por tenant existente)
- **Novas vendas** (NEW_LEAD em negociação)
Botão **Auto-detectar** roda heurísticas que sugerem oportunidades.

### 📞 Atividades
**Quem usa:** todos
**O que tem:** Feed cronológico de calls, emails, WhatsApp, meetings, notas. Filtros por tipo e vendedor. Agrupado por dia.

### 🏆 Equipe & Metas
**Quem usa:** Gerente, Diretor
**O que tem:** Lista da equipe (SDR/AE/CS/MANAGER/DIRECTOR). Ranking mensal por MRR/deals/demos/calls. Botão "Adicionar Vendedor".

### 📋 Materiais
**Quem usa:** todos
**O que tem:** Biblioteca de scripts, decks, vídeos, PDFs, templates de email, case studies.

### 💰 Pricing · 💵 Faturamento · 📈 BI
Tabs futuras (placeholders ricos para evolução M3+).

---

## ⚙️ Hooks Automáticos <a id="hooks"></a>

O sistema executa **8 hooks** que conectam ações operacionais ao Hub Comercial. **Você não precisa configurar nada** — eles rodam transparentemente.

| # | Quando dispara | O que faz |
|---|---------------|-----------|
| **H1** | Lead se cadastra (`POST /leads`) | • Calcula LeadScore<br>• Cria Opportunity NEW_LEAD<br>• Round-robin: atribui SDR com menor carga<br>• Cria Activity NOTE inicial |
| **H2** | Demo aprovada (`POST /leads/:id/invite`) | • Cria Activity DEMO_DONE<br>• Bump goal DEMOS_SENT<br>• Atualiza Opportunity probability=50 |
| **H3** | Status do lead muda (`PATCH /leads/:id`) | • Cria Activity NOTE descrevendo transição<br>• Se CONTACTED, bump goal QUALIFIED_LEADS |
| **H4** | Lead convertido em Integrador | • Marca Opportunity NEW_LEAD como WON<br>• Bump goals DEALS_CLOSED + CLOSED_MRR<br>• Atribui CS ao novo tenant<br>• Cria Activity de comemoração |
| **H5** | Módulo adicionado a Integrador | • Verifica Opportunities CROSS_SELL/UPSELL abertas<br>• Se módulos batem, marca WON<br>• Bump goal CLOSED_MRR do owner |
| **H6** | SalesActivity criada | • Bump goal CALLS ou DEMOS_SENT |
| **H7** | Cron diário 02:00 BRT | • Recompute LeadScores de leads ativos<br>• Auto-detect oportunidades cross-sell/upsell<br>• Recalcula goals.actual a partir das atividades do mês |
| **H8** | Round-robin auto sempre ativo | • Lead novo → SDR menos carregado<br>• Tenant convertido → CS menos carregado |

### Heurísticas do Auto-Detect (H7)

| Sinal | Sugestão | MRR estimado |
|-------|----------|--------------|
| Cliente em vertical PARKING sem LPR | LICENSE_PLATE_RECOGNITION | R$ 50/câmera |
| Cliente em vertical INDUSTRIAL sem PPE | PPE_DETECTION | R$ 80/câmera |
| Cliente em RETAIL/SHOPPING_MALL sem analytics | DEMOGRAPHICS + HEATMAP | R$ 60/câmera |
| Quota Vertex > 80% | QUOTA_UPGRADE | R$ 500 |
| Integrador com 5+ clientes sem White-label | WHITE_LABEL | R$ 2.000 |

---

## 🎬 Cenário end-to-end completo <a id="cenário"></a>

### Setup (uma vez)

1. Cadastre vendedores em **Equipe & Metas**:
   - Maria (SDR), João (AE), Carla (CS)
2. Defina metas mensais (via API ou UI futura):
   - Maria: 200 calls / mês
   - João: R$ 25.000 MRR fechado / mês

### Lead chega

1. Cliente acessa `https://app.iacloud.com.br/register-lead`
2. Preenche: Pedro Carvalho, SegPlus Tec, CNPJ, Diretor, 50_500 câmeras
3. Submete

### Sistema reage automaticamente (H1)

- ✉️ Pedro recebe email "Recebemos seu cadastro" + SLA 1 dia útil
- ✉️ Super_admins recebem notificação
- 📊 LeadScore calculado: ex. 85 (decisor + CNPJ + volume bom)
- 💎 Opportunity NEW_LEAD criada (R$ 8.000 MRR estimado, prob 20%)
- 👤 Maria é atribuída (SDR menos carregada via round-robin)
- 📝 Activity "Lead recebido" criada

### Maria contata (manhã seguinte)

1. Vê SegPlus em `Pipeline > Novos` com score 85 (vermelho)
2. Hover → clica 📞 Phone
3. Modal abre. Liga em paralelo. Registra: 8min, positivo, "Cliente quer demo dia 10"
4. Sistema: Activity CALL + bump goal CALLS de Maria
5. Maria arrasta card para `Contatados`
6. Sistema: Activity NOTE "Status NEW → CONTACTED" + bump goal QUALIFIED_LEADS

### Aprovação de demo

1. Vai em `Demos > Pendentes` → SegPlus aparece
2. Clica **Aprovar Demo**
3. Sistema (H2):
   - Gera magic link 14 dias
   - Envia email rico para Pedro
   - Lead vai para `DEMO_SENT`
   - Activity DEMO_DONE + bump goal DEMOS_SENT
   - Opportunity probability vira 50

### João conduz demo, fecha

1. SegPlus aparece em `Pipeline > Demo enviada`
2. João conduz demo, manda proposta
3. Cliente aceita. João converte: PATCH /leads/:id {status: CONVERTED, convertedIntegradorId}
4. Sistema (H4):
   - Cria Integrador "SegPlus Tec"
   - Opportunity NEW_LEAD vira WON, R$ 8k registrados
   - Bump goals João: DEALS_CLOSED +1, CLOSED_MRR +R$ 8k
   - Carla recebe atribuição automática como CS
   - Activity "🎉 Lead convertido"

### 30 dias depois — cross-sell

1. Cron H7 roda às 02:00 e detecta:
   - SegPlus tem cliente final em vertical INDUSTRIAL
   - Não tem módulo PPE
   - Cria Opportunity {type: CROSS_SELL, modulesProposed: ['PPE_DETECTION'], MRR R$ 800, prob 70%}
2. Carla vê em `Oportunidades`, liga para SegPlus, apresenta
3. SegPlus aprova
4. Super_admin habilita módulo PPE via cockpit do tenant
5. Sistema (H5):
   - Detecta match com Opportunity aberta
   - Marca como WON
   - Bump goal CLOSED_MRR de Carla +R$ 800

### Resultado nos indicadores

`Visão Executiva` mostra:
- MRR fechado mês: R$ 8.800 (R$ 8k João + R$ 800 Carla)
- Win rate: 100% (2/2)
- Top performers: João (R$ 8k) > Carla (R$ 800)

---

## 📊 Métricas e Indicadores <a id="métricas"></a>

### Por papel

| Papel | Métricas principais |
|-------|---------------------|
| SDR | CALLS, QUALIFIED_LEADS, DEMOS_SENT |
| AE | DEALS_CLOSED, CLOSED_MRR, win rate |
| CS | NRR (expansão na base), churn evitado |
| Gerente | Performance da equipe, distribuição de carga |
| Diretor | MRR total, pipeline value, conversão lead→cliente |

### KPIs no Dashboard Executivo

- **MRR fechado** (mês) — soma de Opportunity.estimatedMrr WON no mês
- **Pipeline value** — soma de Opportunity.estimatedMrr OPEN
- **Win rate** — WON / (WON + LOST) do mês
- **Ticket médio** — CLOSED_MRR / DEALS_CLOSED
- **Conversão** — leads CONVERTED / leads totais
- **Funil mensal** — novos / contatados / demos / negociação / convertidos

---

## ❓ FAQ e Troubleshooting <a id="faq"></a>

### "O score do meu lead está em 50 mesmo com dados completos"
O hook H1 calcula score na criação. Para recalcular tudo: rode `POST /sales/score/recompute-all` (ou aguarde o cron de 02:00).

### "Auto-detect não cria nenhuma oportunidade"
Verifica:
- O integrador tem clientes finais cadastrados com `vertical` preenchido?
- Os módulos sugeridos já estão contratados? (não duplica)
- Já existe Opportunity OPEN para o mesmo módulo? (não duplica)

### "Activity não aparece no feed de Atividades"
O feed mostra somente atividades com `salesUserId` válido. Se o lead foi atribuído a um User normal (não SalesUser), o hook H1 não cria activity. Solução: cadastre o user como SalesUser em `Equipe & Metas`.

### "Goal.actual está zerado"
- O cron H7 recalcula às 02:00 BRT — pode levar até 24h
- Trigger manual: rode o auto-detect que também recalcula goals
- Verifica se o vendedor tem SalesGoal cadastrado para o mês corrente

### "Demo aprovada não enviou email"
- SMTP precisa estar configurado em `Plataforma > Integrações`
- Template `lead_demo_approved` deve existir (já criado por padrão)

### "Round-robin não atribui ninguém"
- Precisa ter pelo menos 1 SalesUser ativo com role=SDR
- Cadastre em `Equipe & Metas > Adicionar Vendedor`

### "Cross-sell não fechou WON quando habilitei módulo"
O hook H5 só dispara se TODOS os módulos propostos da oportunidade forem ativados. Se a Opp tem `['PPE_DETECTION', 'DEMOGRAPHICS']` e você só ativou PPE, não fecha.

---

## 📞 Suporte

- Documentação técnica: `docs/`
- Issues: contato@iacloud.com.br
- Slack interno: #comercial-hub

---

*Manual gerado pela equipe de produto · IACloud Vision · v1.0*
