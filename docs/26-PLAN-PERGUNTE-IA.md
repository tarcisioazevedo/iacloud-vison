# 26 · Plano: Pergunte à IA — Assistente Conversacional

> **Data:** 2026-05-19
> **Status:** Pendente aprovação · plano consolidado e reservado
> **Esforço total estimado:** 24 dias úteis (6 fases independentes)
> **Pré-requisitos:** chave Gemini configurada · arquitetura BYOK hierárquica

---

## 1. Resumo executivo

O agente "Pergunte à IA" tem **4 tools no backend** já implementadas (`search_events`, `get_review_segments`, `describe_event`, `compare_events`) mas falta:

1. **Chave Gemini configurada** em produção
2. **Settings hierárquico** (Fabricante → Integrador → Cliente Final) com BYOK
3. **6 fases de expansão** de capacidades (visual, semântica, compliance, ações, proativo, onboarding)

Este plano consolida tudo discutido em 2026-05-19, organizado por valor de negócio e ordem de execução.

---

## 2. Estado atual

### 2.1 Backend implementado

Arquivo: `vsaas-backend/src/services/ai-agent.service.ts`

| Tool | Status | O que faz |
|---|---|---|
| `search_events` | ✅ Funcional | Busca DetectionEvents por câmera/período/tipo |
| `get_review_segments` | ✅ Funcional | Agrupamentos por severidade |
| `describe_event` | ⚠ Esqueleto | Descrição GenAI (precisa Gemini key) |
| `compare_events` | ⚠ Esqueleto | Compara 2 eventos (mesma pessoa?) |

Arquivo: `vsaas-backend/src/services/genai.service.ts` — wrapper Gemini (já existe)

Frontend: `vsaas-frontend/src/components/ai/AIAgentDrawer.tsx` — UI drawer pronto, agora arrastável (commit `0f9bec92`).

### 2.2 Limitações atuais

- Mensagem "IA não configurada — admin deve configurar GEMINI_API_KEY"
- Sem acesso a snapshots/frames
- Read-only (sem ações)
- Sem hierarquia BYOK (chave única global)

---

## 3. Configuração hierárquica — BYOK em cadeia

### 3.1 Modelo conceitual

Três níveis, cada um decide **de quem é a chave** e **quem pode usar abaixo**:

```
FABRICANTE (VSaaS)
  • Chave global Gemini + Claude
  • Quota gratuita por integrador (default 50/dia)
  • Cobra sobre uso adicional (R$ 0,50/call)
  • Liga/desliga IA por integrador
       │
       ▼
INTEGRADOR
  ESCOLHE: 
    ◯ Usar chave do Fabricante (paga por call)
    ◯ Trazer minha própria chave (zero custo VSaaS)
  • Decide quais Clientes Finais podem usar
  • Aloca quota diária por cliente
  • Permite ou não que cliente traga própria chave
       │
       ▼
CLIENTE FINAL
  ESCOLHE (se integrador permitir):
    ◯ Usar quota do integrador
    ◯ Trazer minha própria chave
  • Vê quota restante, alertas 80%/100%
```

### 3.2 Algoritmo de resolução de chave

Quando alguém faz pergunta:

```
1. ClienteFinal.aiUseOwnKey ?
   → SIM: usa ClienteFinal.aiKeyGeminiEnc
2. Integrador.aiUseOwnKey AND ClienteFinal.aiEnabled ?
   → SIM: usa Integrador.aiKeyGeminiEnc
3. PlatformAiConfig.globalGeminiKeyEnc AND Integrador.aiEnabled AND quota disponível ?
   → SIM: usa global (cobra do integrador por call extra)
4. Senão: "IA indisponível, fale com seu integrador"
```

Registrado em `AiUsageLog.keyOwner` (FABRICANTE/INTEGRADOR/CLIENTE_FINAL) para billing.

### 3.3 Schema (Prisma)

```prisma
model PlatformAiConfig {
  id                 String   @id @default("singleton")
  globalGeminiKeyEnc String?
  globalClaudeKeyEnc String?
  defaultQuotaDaily  Int      @default(50)
  pricePerCallBrl    Float    @default(0.50)
  globallyEnabled    Boolean  @default(true)
  updatedAt          DateTime @updatedAt
  updatedBy          String?
}

model Integrador {
  // ... existentes
  aiUseOwnKey         Boolean @default(false)
  aiKeyGeminiEnc      String?
  aiKeyClaudeEnc      String?
  aiAllowClientes     Boolean @default(false)
  aiAllowClienteBYOK  Boolean @default(false)
  aiQuotaDaily        Int     @default(50)
  aiEnabled           Boolean @default(true)
}

model ClienteFinal {
  // ... existentes
  aiUseOwnKey         Boolean @default(false)
  aiKeyGeminiEnc      String?
  aiEnabled           Boolean @default(false)
  aiQuotaDaily        Int     @default(20)
}

model AiUsageLog {
  id              String   @id @default(uuid())
  occurredAt      DateTime @default(now()) @db.Timestamptz(3)
  integradorId    String?
  clienteFinalId  String?
  userId          String
  provider        String
  model           String
  inputTokens     Int
  outputTokens    Int
  imagesCount     Int      @default(0)
  durationMs      Int
  costUsdCents    Int
  keyOwner        String
  billable        Boolean  @default(true)
  question        String?  @db.Text
  reply           String?  @db.Text
  toolsCalled     String[] @default([])

  @@index([integradorId, occurredAt])
  @@index([clienteFinalId, occurredAt])
}
```

### 3.4 3 Telas de Settings

| Persona | Rota | Conteúdo |
|---|---|---|
| **SuperAdmin** | `/admin/ai-config` | Master keys + quota default + pricing + tabela por integrador |
| **Integrador** | `/integrador/ai-config` | Radio "chave plataforma/própria" + BYOK + tabela ClienteFinais + permissões |
| **ClienteFinal** | `/settings/ai` | Radio "quota integrador/própria chave" + uso atual + estatísticas |

Mockups detalhados em conversa anterior — implementar quando aprovado.

---

## 4. Capacidades — 7 categorias por valor de negócio

### Categoria 1 · Consultas históricas (HOJE)

**Tools usadas:** `search_events`, `get_review_segments`

**Exemplos:**
- *"Quantas pessoas entraram entre 14h e 16h?"*
- *"Resuma o que aconteceu hoje na entrada"*
- *"Tem carro placa ABC1D23 hoje?"*

**Custo Gemini Flash:** ~R$ 0,01/pergunta

---

### Categoria 2 · Resumo de período (HOJE)

**Tools usadas:** `get_review_segments` + `describe_event`

**Exemplos:**
- *"Briefing do dia"* → resume eventos 24h
- *"Compare hoje vs semana passada"*
- *"Pico de fluxo essa semana?"*

---

### Categoria 3 · Análise visual em tempo real (FASE 2)

**Tools novas:**
- `get_current_frame(camera_id)` — snapshot ao vivo
- `analyze_frame(frame, question)` — Claude/Gemini Vision
- `get_recent_clip(camera_id, duration_sec)`

**Exemplos:**
- *"Tem alguém no provador agora?"*
- *"O zelador está varrendo a área?"*
- *"A fila no caixa tá grande?"*

**Custo:** R$ 0,05/pergunta (Gemini Flash + 1 imagem)

---

### Categoria 4 · Busca semântica em vídeo (FASE 3)

**Tools novas:**
- `semantic_video_search(query, time_range)` — CLIP/Claude
- `find_object_in_history(description, time_range)`

**Exemplos:**
- *"Furtaram um perfume. Homem de jaqueta preta. 14h-15h."*
- *"Mostre todas as motos vermelhas hoje"*
- *"Pessoas correndo nas últimas 24h"*

**Custo:** R$ 0,20/busca (5 imagens × Claude)

---

### Categoria 5 · Análise comportamental (FASE 4)

**Tools novas:**
- `track_person_journey(person_id)` — usa ReID (Sprint 4 do plano 25)
- `detect_anomaly(camera_id, period)`
- `compare_traffic_patterns(day_a, day_b)`

**Exemplos:**
- *"Por que minha taxa de retorno caiu hoje?"*
- *"Esse cliente é recorrente?"*
- *"Comportamento incomum nas últimas 2h"*

---

### Categoria 6 · Compliance e relatórios (FASE 4)

**Tools novas:**
- `generate_compliance_report(type, period)` — NR-6, LGPD
- `audit_zone(zone, period)`

**Exemplos:**
- *"Gere relatório NR-6 da semana"*
- *"Quem entrou na cobertura sem capacete hoje?"*
- *"PDF de incidentes para o seguro"*

**Output:** PDF estruturado profissional (puppeteer)

---

### Categoria 7 · Ações automáticas (FASE 5)

**Tools novas:**
- `send_whatsapp(to, message, photo)`
- `lock_unlock_gate(gate_id, action)` (integração futura)
- `mark_event_reviewed(event_id, status)`

**Exemplos:**
- *"Libera o portão pro entregador iFood"* (verifica visualmente antes)
- *"Marca todos os eventos de hoje como revisados"*
- *"Avisa o gerente sobre essa pessoa suspeita"*

---

### Categoria 8 · Alertas proativos (FASE 5)

**Mecânica:** cron job + Claude analisa cenas periodicamente

**Exemplos:**
- Loja desatendida >5min → WhatsApp gerente
- Pessoa parada >30min em zona crítica
- Aglomeração não esperada em horário

---

### Categoria 9 · Onboarding inteligente (FASE 6)

**Tools novas:**
- RAG com documentação do produto
- `open_screen(deep_link)`

**Exemplos:**
- *"Como criar linha de contagem?"*
- *"Onde mudo a senha do operador?"*
- *"Por que minha câmera ficou offline?"*

---

## 5. Cenários reais com valores

| Cenário | Vertical | Custo/uso | Revenda | ROI cliente |
|---|---|---|---|---|
| Loja remota check | Varejo | R$ 0,01 | R$ 80/cam/mês | Tempo 30min→3min/dia |
| Investigação furto | Farmácia | R$ 0,05 | R$ 30 avulso | Evita R$ 80+/furto |
| Análise comportamento | Restaurante | R$ 0,30 | R$ 150/mês | Substitui consultor R$ 5k |
| Relatório NR-6 | Indústria | R$ 0,50 | R$ 200/cam/mês | Economiza 1 dia/sem SESMT |
| Portaria virtual | Condomínio | R$ 0,03 | R$ 100/cam/mês | Economiza porteiro R$ 5k/mês |
| Alerta proativo | Joalheria | R$ 0,20/h | R$ 250/cam/mês | Previne perdas grandes |
| Onboarding | Qualquer | R$ 0,01 | incluso | -60% tickets suporte |

**ARPU médio com Pergunte à IA:** +R$ 80-200 por câmera/mês.

---

## 6. Roadmap de implementação

### Fase 0 · Configuração hierárquica · 5,5 dias

- Schema + migration (0.5 dia)
- Backend: key resolver + storage encrypted (1 dia)
- Backend: rotas CRUD + validação (1 dia)
- Frontend: Tela SuperAdmin `/admin/ai-config` (0.5 dia)
- Frontend: Tela Integrador `/integrador/ai-config` (1 dia)
- Frontend: Tela ClienteFinal `/settings/ai` (0.5 dia)
- Refator AIAgentDrawer com contexto de quota (0.5 dia)
- Telemetria + alertas 80%/100% (0.5 dia)

**Entrega:** sistema configurável por todas as personas, chaves seguras, billing rastreado.

---

### Fase 1 · Histórico (Categorias 1 + 2) · 1 dia

- Configurar `GEMINI_API_KEY` em secret Docker
- Refinar prompts em PT-BR
- Validar `search_events` e `get_review_segments` com dataset real

**Entrega:** IA responde sobre eventos históricos.

---

### Fase 2 · Visual ao vivo (Categoria 3) · 3 dias

- Tool `get_current_frame(camera_id)` — snapshot
- Tool `analyze_frame(image, question)` — Gemini Vision OU Claude Vision
- Pipeline: receber frame → resize → enviar → resposta
- Cache de 5s pra evitar inferência repetida

**Entrega:** "Tem alguém no provador?" funcional.

---

### Fase 3 · Busca semântica (Categoria 4) · 5 dias

- Embeddings de DetectionEvents (schema `SemanticEmbedding` já existe)
- Indexação noturna de eventos novos
- Tool `semantic_video_search(query)` — pgvector cosine
- Tool `find_object_in_history(description)`
- Ranking + thumbnails na resposta

**Entrega:** investigação forense via texto livre.

---

### Fase 4 · Comportamento + Compliance (Categorias 5 + 6) · 7 dias

- Tool `compare_traffic_patterns` — agregações temporais
- Tool `audit_zone` — analytics por região
- Tool `detect_anomaly` — Claude classifica
- Tool `generate_compliance_report(type)` → PDF
- Geração de PDF via puppeteer (template HTML)

**Entrega:** insights de negócio + relatórios NR-6/LGPD.

---

### Fase 5 · Ações + Proativo (Categorias 7 + 8) · 5 dias

- Tools de ação: `send_whatsapp`, `mark_event_reviewed`
- (Futuro) `lock_unlock_gate` — integração ONVIF
- Cron `proactive_check` rodando 5/5min
- Editor de regras em linguagem natural (UI)
- Whitelist de ações por persona (audit obrigatório)

**Entrega:** automação supervisionada + assistente vigilante.

---

### Fase 6 · Onboarding (Categoria 9) · 3 dias

- Indexar manual do produto (Docusaurus → embeddings)
- Tool `lookup_docs(query)` — RAG
- Tool `open_screen(deep_link)` — navega o app
- Tutorial interativo guiado

**Entrega:** suporte automatizado, -60% tickets.

---

### Total: 29,5 dias úteis

Ordem sugerida:

```
Fase 0 (config)       → 5.5d   [bloqueante: tudo depende]
   ↓
Fase 1 (histórico)    → 1d     [já 95% pronto]
Fase 2 (visual)       → 3d     [maior wow factor]
   ↓ ←── demo investidor pronta aqui ──→
Fase 3 (semântica)    → 5d     [diferencial vs concorrência]
Fase 4 (compliance)   → 7d     [abre vertical industrial]
Fase 5 (ações)        → 5d     [escala para automação]
Fase 6 (onboarding)   → 3d     [reduz suporte]
```

**Demo investidor pronta ao final de Fase 2** (~10 dias após início).

---

## 7. Decisões pendentes

Antes de implementar, definir:

1. **Modelo IA:** Gemini Flash (barato) ou Claude Haiku (melhor PT)?
   - Recomendação: **Gemini Flash pra histórico/resumo · Claude Haiku pra análise visual complexa**

2. **Profundidade de histórico:** quanto a IA pode "lembrar"?
   - Recomendação: **30 dias por default, 90 dias em tier premium**

3. **Ações automáticas:** IA pode agir ou só sugere?
   - Recomendação: **só sugere por padrão, ação requer "modo autônomo" opt-in**

4. **Validação de chave BYOK:** chama API pra testar?
   - Recomendação: **sim, valida com 1 call de R$ 0,001 antes de marcar como ativa**

5. **Quota: diária ou mensal?**
   - Recomendação: **diária com soft-cap mensal (alerta)**

6. **Limite de tokens por chamada?**
   - Recomendação: **hard limit 4000 tokens · evita pergunta gigante consumir 5x**

7. **LGPD: salvar texto completo de pergunta/resposta?**
   - Recomendação: **truncado (500 chars pergunta, 2000 chars resposta), opt-in para completo**

8. **Caso de uso prioritário:** varejo, condomínio, indústria ou healthcare?
   - Recomendação: **varejo (maior mercado BR · ARPU acessível R$80-200)**

---

## 8. Aspectos de segurança e compliance

| Tema | Implementação |
|---|---|
| Chaves em plaintext | Encrypted via `ICV_ENCRYPTION_KEY` (já existe `lib/crypto.ts`) |
| Logs LGPD | Truncar pergunta/resposta · não logar imagens raw |
| Hard quota | `429 Too Many Requests` ao atingir quota |
| Audit trail | Toda mudança em `AuditLog` |
| Ações automáticas | Sempre confirmação humana opt-out por persona |
| Modelo escolhido | Documentar provider + região (Gemini Brasil-Sul · Claude US) |
| Retenção | 90 dias `AiUsageLog` por default · 30 dias em quota baixa |

---

## 9. Critérios de aceite por fase

| Fase | Critério |
|---|---|
| **0** | Integrador troca pra BYOK e a próxima call usa a chave dele · log mostra `keyOwner=INTEGRADOR` |
| **1** | "Quantas pessoas hoje?" responde com número correto vs SQL direto |
| **2** | "Tem alguém na entrada?" responde em <3s com base no frame atual |
| **3** | "Pessoa de jaqueta preta 14h-15h" retorna 3-5 clipes ranqueados |
| **4** | Relatório NR-6 PDF gerado em <10s · aceito por compliance officer |
| **5** | Regra "avise se loja vazia >5min" funciona por 48h sem falso positivo grave |
| **6** | "Como criar tripwire?" retorna passo-a-passo + abre tela correta |

---

## 10. Custos operacionais estimados

| Persona | Calls/mês média | Custo Gemini Flash | Revenda | Margem |
|---|---|---|---|---|
| Cliente Final padrão | 200 | R$ 2,00 | R$ 80 | 97% |
| Cliente Final ativo | 1000 | R$ 10,00 | R$ 80 | 87% |
| Cliente Final premium (visual) | 500 | R$ 25,00 | R$ 250 | 90% |
| Integrador 20 clientes (média) | 4000 | R$ 40,00 | R$ 80 × 20 = R$ 1600 | 97% |

**Conclusão:** mesmo em uso intensivo, margem 87%+. Modelo escalável.

---

## 11. Referências cruzadas

- `docs/25-PLAN-IA-CONTADOR-REID.md` — pipeline IA base (Sprint 1 entregue, 2-4 pendentes)
- `docs/mockups/06-11` — telas Roboflow especialistas
- `vsaas-backend/src/services/ai-agent.service.ts` — backend atual
- `vsaas-backend/src/services/genai.service.ts` — wrapper Gemini
- `vsaas-frontend/src/components/ai/AIAgentDrawer.tsx` — UI drawer
- Commit `0f9bec92` — botão Pergunte à IA arrastável

---

**Documento criado em: 2026-05-19**
**Próxima revisão após: Fase 0 implementada (configuração hierárquica)**
**Responsável: Tarcísio (dev solo) + Claude (assistente)**
