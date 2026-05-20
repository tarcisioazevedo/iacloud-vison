# Plano — Settings > IA & GenAI

**Status:** Pendente  
**Estimativa:** 1.5 dia  
**Prioridade:** P1 (bloqueio operacional: sem painel, Tarcísio tem que entrar em cada câmera)

---

## Diagnóstico atual

| Onde está hoje | Gap |
|---|---|
| `genaiEnabled` / `genaiProvider` / `genaiModel` / `genaiPromptGlobal` — por câmera em `CameraDetailPage` | Sem visão consolidada — para ligar Gemini em 10 câmeras é preciso entrar 10 vezes |
| Daily Briefing — roda às 7h BRT automático | Sem UI para ver histórico, forçar geração, ou mudar hora |
| `aiEnabled` por câmera | Sem lista centralizada de quais câmeras têm YOLO ativo |
| Quota Vertex AI no `StorageSection` | Apenas número de chamadas — sem custo estimado nem gráfico de tendência |
| `/ai-agent/stats` (callsToday) | Consumido só pelo `AIAgentDrawer`, não exposto em settings |
| `semanticSearchEnabled` por câmera | Sem visão de quais câmeras têm busca semântica ativa |

**Conclusão:** Não existe seção "IA & GenAI" no `SettingsPage`. A configuração está fragmentada em 3 lugares diferentes sem nenhuma visão unificada.

---

## O que criar

### Nova seção no SECTIONS array

```ts
{ id: 'ia', label: 'IA & GenAI', icon: Sparkles, desc: 'Gemini, YOLO e busca semântica' }
```

Visibilidade: `INTEGRADOR_ADMIN` + `INTEGRADOR_TECNICO` + `SUPER_ADMIN`. Não aparece para `CLIENTE_FINAL` nem `CLIENTE_TECNICO`.

---

### Sub-seções da `IASection`

#### 1. Status da API (header card)
- Badge verde/vermelho — Gemini key ativa ou não (via `/ai-agent/stats`)
- Modelo em uso: `gemini-1.5-flash` (padrão do env)
- Chamadas hoje: `callsToday` — do endpoint existente
- Custo estimado hoje: `callsToday × R$0.000375` (Flash input price)

#### 2. Daily Briefing
- Toggle enable/disable — `PATCH /integrador/settings` (campo `briefingEnabled`)
- Hora de envio: select 5h–10h BRT — `PATCH /integrador/settings` (campo `briefingHourBRT`)
- Botão "Gerar agora" — `POST /ai-agent/briefing/generate` (novo endpoint)
- Lista dos últimos 5 briefings — `GET /ai-agent/briefings` (já existe)
- Preview expansível do texto gerado

#### 3. Câmeras com IA (tabela)
- Lista todas câmeras do tenant: nome, site, status YOLO (`aiEnabled`), status GenAI (`genaiEnabled`), status Semântica (`semanticSearchEnabled`)
- Toggle inline `genaiEnabled` — `PATCH /cameras/:id` (já existe)
- Toggle inline `aiEnabled` — `PATCH /cameras/:id` (já existe)
- Link "→ Configurar" vai para `CameraDetailPage` para config avançada (modelo, prompt)

#### 4. Prompt Padrão Global
- Textarea com `genaiPromptGlobal` (2000 chars max)
- Descrição: "Aplicado a todas as câmeras sem prompt próprio"
- Salva em `PATCH /integrador/settings` (campo `genaiPromptDefault`)
- Variáveis disponíveis: `{camera_name}`, `{site_name}`, `{timestamp}`

#### 5. Quota & Custo
- Barras de progresso: chamadas hoje / cap diário, chamadas no ciclo / cap mensal
- Tabela: custo por feature (GenAI Events, Daily Briefing, Cockpit Describe, AI Agent)
- Link para rotacionar API key (abre modal com instrução manual — chave fica no Docker secret)

---

## Arquivos a modificar

| Arquivo | Mudança |
|---|---|
| `vsaas-frontend/src/pages/SettingsPage.tsx` | Adicionar `IASection` component + entrada no SECTIONS array |
| `vsaas-frontend/src/api/client.ts` | Adicionar `useAISettings()`, `patchIntegradorAISettings()`, `forceBriefing()` |
| `vsaas-backend/src/routes/ai-agent.ts` | `POST /ai-agent/briefing/generate` (força geração imediata) |
| `vsaas-backend/src/routes/integrador.ts` | `PATCH /integrador/settings` — campos `briefingEnabled`, `briefingHourBRT`, `genaiPromptDefault` |
| `vsaas-backend/prisma/schema.prisma` | Adicionar `briefingEnabled Boolean @default(true)`, `briefingHourBRT Int @default(7)`, `genaiPromptDefault String?` em `Integrador` |

---

## Mockup

Ver `docs/mockup-settings-ai.html` — abre no browser, dark mode completo.

---

## Dependências

- Nenhuma infra nova — Gemini já está ativo
- Não bloqueia homologação — é feature de conforto operacional
- Pode ser entregue em paralelo com outros P0

---

## Ordem de implementação

1. Prisma migration (`briefingEnabled`, `briefingHourBRT`, `genaiPromptDefault`)
2. Backend: `PATCH /integrador/settings` + `POST /ai-agent/briefing/generate`
3. Frontend: `IASection` no SettingsPage (câmeras table + briefing + quota)
4. Teste: ativar `genaiEnabled=true` numa câmera pelo novo painel e verificar `event_genai_tick_start`
