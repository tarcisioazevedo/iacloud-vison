# Cockpit Unificado de Storage & Retenção — Projeto de Redesign

**Data:** 2026-05-13
**Status:** Proposta de design (mockups HTML + arquitetura de informação)
**Autor:** Claude · Sênior SE + Analista de Dados + Key Account de canais
**Escopo:** `/admin/storage` + `/admin/retention-plans` + tudo que se ramifica deles

---

## 1. Diagnóstico — o que está errado hoje

A área de Storage e Retenção é o **coração comercial** do VSaaS — é onde o fabricante cobra
os integradores, onde os integradores formam preço para os clientes finais, e onde a
infraestrutura R2 efetivamente consome dinheiro. Apesar disso, o produto trata os dois
sistemas como ilhas:

| Sintoma observado na tela atual | Causa-raiz |
|---|---|
| "Câmeras × Plano" aparece **acima** dos KPIs, antes mesmo da filtragem | Componente foi enxertado no topo da `StoragePage` sem hierarquia |
| Filtros (search/integrador/cliente/site) ficam **abaixo** dos KPIs | KPIs vieram primeiro, filtros foram adicionados em sprint posterior |
| Integradores não são tratados como entidade visual de 1ª classe | Página é "centrada em bucket", não "centrada em tenant" |
| Custo R$ não aparece em nenhum agregado global | Dashboard usa GB; o snapshot mensal (BRL) não é puxado |
| Retenção aparece em **3 lugares**: `/storage`, `/admin/retention-plans`, `IntegradorContractCard` | Não há "página-mãe" que orquestre os 3 |
| Órfãs são descoberta passiva (clica → carrega) | Sem proatividade na home |
| Drill profundo exige cascata de 4 dropdowns | Não há painel lateral de drill |

**Veredito:** a tela atual *funciona*, mas é **operacional, não estratégica**. Quem usa fica
preso no "o quê" (quantos GB), nunca chega no "e daí" (qual integrador está com margem
quebrada, qual cliente está prestes a estourar quota, qual câmera não tem plano).

---

## 2. Princípios de design adotados

1. **Tenant-first, não bucket-first.** O integrador é a unidade econômica. O bucket é
   detalhe técnico exposto sob demanda.
2. **Money on top.** R$ aparece antes de GB. GB é métrica técnica; R$ é decisão de negócio.
3. **Drill > Cascade.** Painel lateral progressivo (Integrador → Cliente → Site → Câmera)
   substitui 4 dropdowns dependentes.
4. **Alertas proativos.** Órfãs, câmeras sem plano, margem <50%, drift de reconciliação —
   tudo vira chip no topo do cockpit, não uma aba escondida.
5. **Uma página, três personas.** Mesmo cockpit muda densidade e foco conforme role:
   Fabricante vê tudo, Integrador vê escopo próprio, Cliente Final tem versão portal-lite.
6. **Câmbio congelado em ponto de cobrança.** USD/BRL ao vivo é informativo; o que é
   cobrado vem de `StorageBillingSnapshot.usdBrlRate` (já existe no schema).

---

## 3. Arquitetura de Informação proposta

```
/admin/storage  (rota mantida, mas comportamento reformulado)
│
├─ Header  ── R2 Health · Mês corrente · USD/BRL referência · Quick search global
│
├─ ALERTAS (chips dinâmicos, escondem quando = 0)
│     ↳ Órfãs detectadas · Câmeras sem plano · Margem baixa · Reconciliação pendente
│
├─ KPIs (5 cards, refletem filtros)
│     ↳ Integradores · Buckets · Storage GB · Receita R$/mês · Margem média
│
├─ FILTROS (toolbar persistente, sempre acima da tabela principal)
│     ↳ Search · Integrador · Cliente · Site · Tipo · Status · Período
│
├─ TABELA PRINCIPAL — INTEGRADORES (tenant-first)
│     ↳ Cada linha: integrador, plano contratado, markup, GB, R$/mês, margem,
│       câmeras, sem plano, órfãs, status. Clique → abre painel drill lateral.
│
├─ PAINEL DRILL (right-side, 480-640px, stack progressivo)
│     ↳ Nível 1: Integrador  (KPIs + contrato + clientes + ações)
│     ↳ Nível 2: Cliente     (sites, retenção override, upgrade requests)
│     ↳ Nível 3: Site        (câmeras, GB por câmera)
│     ↳ Nível 4: Câmera      (plano efetivo + cascata + object browser)
│
└─ SECONDARY TABS (abaixo da tabela, contexto secundário)
      ↳ Catálogo de Planos · Billing & Reconciliação · Auditoria · Órfãs
```

`/admin/retention-plans` deixa de ser uma página solitária e vira a aba "Catálogo de
Planos" dentro do cockpit — *mas* mantém URL própria para deep-link.

---

## 4. Lógica de integração — o "como" administrar fluido

### 4.1 Fluxo Fabricante → Integrador

1. Fabricante define `RetentionPlan` (custo R2 estimado + preço cobrado em USD).
2. Margem é calculada **em tempo real** com câmbio comercial+IOF; alerta visual quando
   `<50%`. Botão "Recalcular preços" reaplica regra de margem fixa (ex.: manter 70%).
3. Integrador recebe o catálogo, escolhe um plano default, define markup %.
4. Câmeras novas do integrador herdam: `RetentionPlan custo SA × (1 + markupPct)`.
5. Cobrança real vem do `StorageBillingSnapshot` (mensal, fechado com câmbio do dia 1).

### 4.2 Fluxo Cliente Final → Integrador (upgrade)

1. CF clica "ampliar retenção" no portal. Modal mostra:
   - Preço atual (que ele paga)
   - Preço novo (que ele vai pagar)
   - Δ R$/mês (claro, em destaque)
2. Backend resolve auto-aprovação (limites do `IntegradorRetentionContract`).
3. Auto-aprovado → upgrade ocorre na mesma transação. Integrador recebe notificação
   informativa.
4. Excedeu limite → vira `PENDING_INTEGRADOR`, chip de alerta sobe no cockpit do
   integrador, email é disparado.
5. Integrador decide em 1 clique no cockpit. Decisão grava `decidedAt`, `decisionNote`.

### 4.3 Reconciliação de Storage (mensal)

1. Cron diário acumula em `StorageBillingSnapshot` (status `PRELIMINARY`).
2. Dia 1 do mês seguinte, snapshot é fechado (`CLOSED`), câmbio é congelado.
3. Fatura Cloudflare chega (~dia 5). Operador cola valor → drift calculado automaticamente.
4. Se drift `>3%`, alerta sobe no cockpit. Status vira `RECONCILED` quando aceito.
5. Cobrança ao integrador usa o snapshot fechado (não há surpresa cambial).

---

## 5. Modelos de tela (mockups entregues)

| # | Arquivo | Persona | O que mostra |
|---|---|---|---|
| 1 | `mockups/01-fabricante-cockpit.html` | Fabricante | Cockpit global completo, alerts, KPIs em R$, tabela tenant-first |
| 2 | `mockups/02-drill-down-integrador.html` | Fabricante | Painel drill lateral 4 níveis aberto no integrador |
| 3 | `mockups/03-catalogo-retencao.html` | Fabricante | Catálogo de planos redesenhado, margem dinâmica, simulador |
| 4 | `mockups/04-integrador-cockpit.html` | Integrador | Mesmo cockpit, escopo próprio + upgrade requests pendentes |
| 5 | `mockups/05-billing-reconciliacao.html` | Fabricante | Snapshots mensais, reconciliação Cloudflare, drift visual |

Abrir `mockups/index.html` para galeria navegável.

---

## 6. Decisões de UI/UX com justificativa

| Decisão | Por quê |
|---|---|
| Painel lateral drill (não rota nova) | Mantém contexto, reduz cliques, paradigma de cockpit financeiro (Stripe, Mercury) |
| KPI de **Receita R$/mês** como hero | Money on top — fabricante quer ver receita primeiro |
| **Margem média ponderada** visível | Permite ver se a recente alta do dólar está erodindo margem real |
| Tabela tenant-first com **mini-sparkline 30d** | Permite caçar integrador em crescimento vs. estagnado num glance |
| Chips de alerta colapsáveis | Quando = 0, somem; quando > 0, viram CTA de 1 clique |
| Catálogo com **simulador** | Fabricante muda preço hipotético e vê impacto em margem antes de salvar |
| Drift de reconciliação como **gauge** | Métrica % com cor, não tabela — supervisor lê em 1 segundo |
| Object Browser **dentro** do drill, não modal separado | Mantém contexto do cliente/câmera ao olhar arquivos |

---

## 7. Implementação — caminho sugerido

**Sprint 1 (3 dias):** Reestrutura `StoragePage.tsx` para tenant-first, mantém componentes
filhos. Adiciona chips de alerta. KPIs ganham coluna R$ (puxa de `StorageBillingSnapshot`).

**Sprint 2 (4 dias):** Painel drill lateral. Componente novo `<TenantDrillPanel>` com 4
níveis. Substitui o expandable atual.

**Sprint 3 (3 dias):** Catálogo de retenção redesenhado com simulador. Aba dentro do
cockpit + deep-link `/admin/retention-plans` mantém entrada.

**Sprint 4 (2 dias):** Billing & Reconciliação. Cron de snapshot já existe; só falta UI.

**Sprint 5 (2 dias):** Variante Integrador (mesmo cockpit, escopo próprio) + handoff de
upgrade requests.

**Total: ~14 dias úteis de dev solo.**

---

## 8. Métricas de sucesso pós-deploy

- Tempo para encontrar "qual integrador tem margem <60%": antes ~3 min (entrar em
  /retention-plans, ler tabela, cruzar manualmente); meta: **<10s** (KPI direto).
- Tempo para resolver upgrade request: antes ~5 min (achar email, abrir billing,
  navegar); meta: **<30s** (chip → 1 clique aprovar).
- Tempo para descobrir órfãs: antes ~indeterminado (não há alerta); meta: **0s**
  (chip aparece se >0).
- Densidade informacional: triplicar (de ~15 dados/tela para ~45 dados/tela em
  espaço similar, sem perder leitura).
