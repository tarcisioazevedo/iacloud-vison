# Plano de Implementação — OpenClaw como camada de Operações & Suporte

**Status:** 📦 **DEFERIDO** — implementar somente após P0 do `docs/PRE-HOMOLOGACAO-CHECKLIST.md` estar fechado
**Criado em:** 2026-05-03
**Pré-requisito hard:** todas as credenciais P0 rotacionadas (PostgreSQL, ICV_ENCRYPTION_KEY, R2, VAPID, Evolution, SMTP)
**Trigger natural para retomar:** primeiro integrador piloto entrando OR primeira semana real de "1 dev, 1 produto em produção parcial" gerando fadiga de operação noturna

---

## O que é OpenClaw (1 parágrafo)

Gateway self-hosted MIT, Node 24, que pluga apps de mensageria (WhatsApp, Telegram, Discord, Signal, iMessage, Teams, Slack, Matrix, Zalo…) num agente de código (Claude Code, GPT, Ollama…) rodando na própria infra do usuário. Suporta multi-agente com sessões isoladas por sender/workspace, automação de browser via CDP, plugin SDK, nodes mobile iOS/Android com câmera/voz, cron/standing orders, e 60+ provedores de modelo. Docs: <https://docs.openclaw.ai>.

---

## Por que faz sentido para IA Cloud Vision (e não é só "ferramenta nova brilhante")

O perfil do projeto bate com o sweet-spot do OpenClaw:

1. **1 dev solo + produto 24/7.** VMS Cloud que cai às 23h precisa de ação imediata. Hoje exige laptop. Com OpenClaw, vira mensagem no Telegram do celular.
2. **Já existe stack observável.** Prometheus, logs estruturados, Swarm — toda a malha de sinais existe; falta o canal de **ação** com loop fechado.
3. **Self-hosted casa com a postura de privacidade do produto** (VMS = imagens de câmera, dado sensível). Não introduz SaaS terceiro no caminho crítico de operação.
4. **Multi-agent routing com sessão por sender** mapeia naturalmente para o modelo multi-tenant: cada integrador piloto vira um workspace isolado.

---

## Casos de uso priorizados (ordem de valor)

### Tier 1 — Operação interna (alto valor, baixo risco)

| # | Caso de uso | Ganho | Esforço |
|---|---|---|---|
| 1 | Bot Telegram pessoal do Tarcísio para query de status do Swarm, logs, restart de serviço | Acabar com "preciso abrir laptop às 23h" | 1-2 dias |
| 2 | Pipe Prometheus/Alertmanager → Telegram com botões de ação ("investigar", "reiniciar X", "silenciar 1h") | Loop fechado de incidente em 1 canal | 1-2 dias |
| 3 | Cron diário: smoke-test do dashboard React via browser automation; report no Telegram | E2E grátis sem montar Playwright | 0.5 dia |

### Tier 1.5 — QA assistido (alto valor, baixo-médio risco)

OpenClaw cobre ≈ 50-60% do trabalho de um QA pleno. Não substitui julgamento humano de UX nem teste exploratório criativo, mas elimina o trabalho braçal repetitivo. No contexto atual (1 dev solo, sem QA, sem usuário-piloto), é a alternativa realista a "contratar QA" no curto prazo.

| # | Caso de uso | Ganho | Esforço |
|---|---|---|---|
| Q1 | **Smoke E2E diário** via browser automation: login → criar câmera → ver live → exportar gravação → excluir. Screenshot no Telegram só em falha. | Captura regressão básica todo dia 6h sem intervenção | 1 dia |
| Q2 | **Geração + execução de testes E2E** a partir de descrição em linguagem natural ("ao deletar EdgeNode, câmeras filhas viram `orphan`"). Persistidos em `tests/e2e-generated/`. | Cobertura cresce sem dev escrever Playwright | 1-2 dias |
| Q3 | **Triagem automática de bug report** no Discord/Telegram: cliente manda print, agente lê (vision), correlaciona com logs do `vsaas-backend` no timestamp, propõe causa, abre rascunho de issue no GitHub | Reduz tempo de triagem de 30min → 2min | 1 dia |
| Q4 | **Cobertura de contrato de API** em `/iacv-box/*`, `/cameras`, `/live`: schema, status codes, edge cases, payloads malformados | Pega quebra de contrato antes do frontend | 1 dia |
| Q5 | **Carga leve / fuzzing** controlado: 200 câmeras simultâneas, mata 50 EdgeNodes random, observa o que quebra. Rodado semanalmente. | Encontra race conditions e leaks antes do piloto | 1 dia |
| Q6 | **Visual regression do dashboard** com screenshot baseline + diff por página. Alerta no Telegram quando diff >2%. | Detecta quebra de CSS/layout sem QA manual | 0.5 dia |
| Q7 | **Documentação automática de defeito**: ao reproduzir bug, agente grava passos + DOM + payload + logs num único arquivo Markdown anexável à issue | Acelera handoff para fix em 70% | incluído em Q3 |

**Total Tier 1.5:** ~5-6 dias de implementação, depois roda sozinho.

#### O que QA assistido NÃO cobre (e exige humano eventualmente)

- **Julgamento de UX/produto.** "Esse fluxo confunde o integrador" — agente não tem essa empatia.
- **Teste exploratório criativo.** Bom QA quebra coisas que ninguém pediu; LLM segue o roteiro.
- **Validação contra LGPD/contrato.** Conformidade exige leitura humana.
- **Testes com hardware real.** Hikvision física em rede ISP brasileira com perda de pacote.
- **Pressão sobre prioridades.** Bom QA briga por qualidade contra prazo. Agente não briga.

#### Quando contratar QA humano (mesmo com Tier 1.5 ativo)

- A partir de 2-3 integradores piloto pagando OR
- Após primeiro incidente em produção que um humano teria pego em 5min de uso real OR
- Quando dogfooding diário do Tarcísio cair abaixo de 30min/dia (sinal de que o produto não está mais sendo "usado de verdade" por ninguém)

Modelo recomendado nesse momento: **QA freelancer 10h/semana** decidindo *o que* testar e fazendo exploratório, com agente fazendo o braçal. Custo R$ 1.5-3k/mês contra R$ 6-10k de QA pleno full-time.

---

### Tier 2 — Suporte a piloto (médio valor, médio risco)

| # | Caso de uso | Ganho | Esforço |
|---|---|---|---|
| 4 | Canal Telegram/Discord por integrador piloto, agente faz triagem L1 (heartbeat de EdgeNode, último frame no R2, status ICVCommand) | Reduz interrupção do dev em 60-70% | 2-3 dias |
| 5 | Agente lê ticket/log → propõe diff → pede aprovação no chat antes de aplicar | "PR via WhatsApp" para fixes triviais | 2 dias |

### Tier 3 — Experimental (baixa prioridade)

| # | Caso de uso | Por que adiar |
|---|---|---|
| 6 | Mobile node iOS/Android como câmera ONVIF/RTSP de teste | Útil em QA, mas não bloqueador |
| 7 | Canal WhatsApp para clientes finais | Integração WhatsApp Web não-oficial é frágil; só com WhatsApp Business API oficial |

---

## Arquitetura proposta

```
┌─ Hetzner DE (mesma VPS OU VPS dedicada $5-10/mês) ─────────────┐
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  OpenClaw Gateway (Node 24)                             │    │
│  │   ├── Channel: Telegram (bot pessoal)                   │    │
│  │   ├── Channel: Discord (servidor de piloto, futuro)     │    │
│  │   ├── Plugin: Prometheus webhook receiver               │    │
│  │   ├── Plugin: Swarm CLI tools (docker stack ps, logs)   │    │
│  │   └── Plugin: Prisma/PostgreSQL read-only query         │    │
│  └────────────┬────────────────────────────────────────────┘    │
│               │                                                 │
│               ↓                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Claude Code (sandbox policy = restrict)                │    │
│  │   - Lê: /opt/iacloud-vison, logs, métricas              │    │
│  │   - Escreve: SOMENTE com aprovação no chat              │    │
│  │   - Sem acesso a .env produção (usa secrets do gateway) │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                ↑                              ↑
                │                              │
        Telegram Bot API              Prometheus Alertmanager
                │                              │
                ↓                              ↓
        📱 Tarcísio (celular)          📊 Stack vsaas-backend
```

**Princípio:** OpenClaw é **canal + agente**, nunca componente do plano de dados do VMS. Se cair, produto continua funcionando — só perde o "chat-ops".

---

## Componentes

### Infra

- **Opção A (recomendada):** VPS dedicada (Hetzner CX22, ~€4/mês). Isola memória/CPU do stack principal. Não compete com go2rtc/ffmpeg pelos 8 GB.
- **Opção B (econômica):** mesmo VPS Hetzner do stack VMS. Vai disputar RAM com Postgres+ffmpeg+go2rtc. Aceitável para Tier 1 only, em modo passivo.

### Software

- OpenClaw Gateway (Node 24, MIT)
- Claude Code (já licenciado)
- Plugins customizados (escrever):
  - `swarm-tools` — wrappers shell para `docker stack ps`, `docker service logs`, `docker service update --force`
  - `prom-webhook` — recebe alerta do Alertmanager, vira mensagem estruturada no canal
  - `prisma-readonly` — query SELECT no schema do VMS para diagnóstico (camera offline, último heartbeat de EdgeNode)

### Configuração de canais

- **Telegram bot** (pessoal): `@iacv_ops_bot` — só Tarcísio whitelistado por user_id.
- **Discord** (futuro, piloto): 1 canal por integrador, com bot acessando só aquele canal.
- **WhatsApp:** **adiar** até ter WhatsApp Business API oficial (Meta) ou Twilio. Web API não-oficial = quebra recorrente.

### Segurança

- Sandbox policy: `restrict` (sem acesso ao `.env` de produção; segredos vivem só no Gateway via Secrets CLI).
- Allowlist de comandos shell permitidos (não dar `bash` livre).
- Operações destrutivas (`docker service rm`, `prisma migrate reset`, `rm`): exigem **aprovação explícita** no chat com timeout 60s.
- Audit log de toda interação no Postgres (tabela `OpsAuditLog`, separada do schema do VMS).
- Token Telegram + chave Anthropic: rotacionados a cada 90 dias (entram no checklist de rotação geral).

---

## Implementação em fases

### Fase 0 — Pré-requisito (BLOQUEIO HARD)
- [ ] Todos P0 do `docs/PRE-HOMOLOGACAO-CHECKLIST.md` ☑
- [ ] Sem este checkpoint, não começar Fase 1

### Fase 1 — Gateway mínimo + bot pessoal Telegram (1 dia)
- [ ] Provisionar VPS dedicada (CX22) OU validar headroom da VPS atual
- [ ] `npx openclaw init` + autenticar Telegram bot
- [ ] Whitelist somente user_id do Tarcísio
- [ ] Smoke-test: `/status` retorna `docker stack ps vsaas` formatado

### Fase 2 — Plugin swarm-tools + prisma-readonly (1-2 dias)
- [ ] Wrappers para 5 comandos shell mais usados (status, logs, restart service, ps, df)
- [ ] Plugin Prisma read-only com 5 queries pré-definidas (camera por status, EdgeNode offline >5min, último evento por tenant, fila ICVCommand pendente, jobs de gravação travados)
- [ ] Audit log persistido

### Fase 3 — Pipe Alertmanager → Telegram com ações (1-2 dias)
- [ ] Webhook receiver no Gateway recebendo alertas Prometheus
- [ ] Mensagem rica com botões inline ("Investigar", "Silenciar 1h", "Reiniciar serviço")
- [ ] "Investigar" dispara agente que: lê últimos 200 logs do serviço, sumariza causa provável, sugere ação
- [ ] Aprovação no chat antes de qualquer ação destrutiva

### Fase 4 — Smoke-test diário do dashboard (0.5 dia)
- [ ] Cron 6h da manhã: browser automation faz login → cria câmera dummy → vê live → exclui
- [ ] Falha → mensagem com screenshot no Telegram
- [ ] Sucesso → silencioso

**Total Fase 1-4:** ~4-5.5 dias.

### Fase 5 (depois do piloto começar) — Discord por integrador (2-3 dias)
- [ ] Servidor Discord IA Cloud Vision
- [ ] Bot adicionado, 1 canal por integrador piloto
- [ ] Multi-agent routing: cada canal = workspace isolado
- [ ] Triagem L1: heartbeat, último frame, status ICVCommand, fila de gravação
- [ ] Escalation rule: se confiança <70% ou ação destrutiva, marca @Tarcisio

---

## Decisões pendentes (preencher quando retomar)

| # | Decisão | Default sugerido |
|---|---|---|
| 1 | VPS dedicada OU mesma VPS? | Dedicada (CX22, €4/mês) — isolamento de memória vale o preço |
| 2 | Canal de operação interna | Telegram (estável, Bot API oficial, gratuito) |
| 3 | Modelo LLM padrão | Claude Sonnet 4.6 (custo/qualidade) com failover para Haiku 4.5 |
| 4 | Aprovação de ação destrutiva | Botão inline + timeout 60s + audit log obrigatório |
| 5 | WhatsApp para clientes | Adiar até WhatsApp Business API oficial (Meta/Twilio) |
| 6 | Audit log: schema próprio ou no Postgres do VMS? | Schema próprio `ops` no mesmo cluster, isolado |

---

## Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Mais um serviço self-hosted = mais superfície de credencial | Alta | Bloqueio hard até P0 fechado; rotação 90d junto do ciclo geral |
| WhatsApp Web não-oficial quebra/bane número | Alta (se usado) | NÃO usar WhatsApp via OpenClaw. Telegram/Discord only |
| Agente executa ação destrutiva indevida | Média | Sandbox `restrict` + allowlist + aprovação manual + audit |
| Custo de tokens LLM escala com volume de alertas | Média | Filtros: só dispara agente em alertas SEV2+; SEV3 vira só notificação |
| Disputa de RAM com stack VMS | Média (se opção B) | Opção A (VPS dedicada) elimina; opção B = monitorar e migrar se >70% RAM |
| Dependência do uptime do gateway para operação | Baixa | Gateway cair NÃO afeta produto. Só perde chat-ops. Fallback = SSH manual |

---

## Quando NÃO implementar (ainda)

- ❌ Enquanto P0 do checklist tiver qualquer ☐
- ❌ Antes de Etapa 1 do plano `03-PLAN-EDGE-POP-BR.md` (SRT+MediaMTX) estar estável — operação atual ainda é simples o suficiente para SSH
- ❌ Se nas próximas 4-6 semanas o foco for feature do produto (gravação, billing, multi-tenant)
- ❌ Sem pelo menos 1 incidente noturno real registrado que justifique o ROI

---

## Quando justificar implementar

Triggers naturais:
- ✅ P0 do checklist 100% fechado
- ✅ Primeiro integrador piloto agendado (semana definida)
- ✅ 2+ incidentes noturnos no último mês que precisaram de SSH manual
- ✅ Tarcísio ativo em viagem/mobilidade onde laptop não está sempre acessível

Trigger comercial (futuro):
- ✅ Demo onde "operação por chat" é diferencial vs Monuv/BeNuvem (eles não têm)

---

## Custos consolidados

| Item | Mensal | Anual |
|---|---|---|
| VPS dedicada Hetzner CX22 (opção A) | €4 (~$4.50) | ~$54 |
| Tokens Claude Sonnet (estimado 50-100 interações/dia) | $5-15 | $60-180 |
| Telegram Bot API | $0 | $0 |
| Discord Bot | $0 | $0 |
| **Total opção A** | **~$10-20/mês** | **~$120-240/ano** |
| **Total opção B (sem VPS extra)** | **~$5-15/mês** | **~$60-180/ano** |

**ROI estimado:** se evita 2 acordadas noturnas/mês a R$ 100 cada (custo de oportunidade conservador), paga-se sozinho.

---

## Como retomar (checklist rápido)

1. Confirmar P0 do `docs/PRE-HOMOLOGACAO-CHECKLIST.md` 100% ☑
2. Ler este doc inteiro (5 min)
3. Decidir VPS dedicada vs compartilhada (recomendo dedicada)
4. Provisionar VPS + Node 24 + `npx openclaw init`
5. Criar bot Telegram via @BotFather, whitelist user_id
6. Implementar Fase 1-2 (2-3 dias)
7. Implementar Fase 3 (pipe Alertmanager) só depois das Fases 1-2 estarem rodando 1 semana estável
8. Documentar plugins custom em `docs/INTEGRATIONS/openclaw/`
9. Adicionar ao `MEMORY.md` index quando ativo

---

## Por que NÃO implementar agora (resumo executivo)

1. **Status do projeto:** 🟢 desenvolvimento, sem cliente externo. Operação 24/7 ainda é teórica — não há incidente noturno real para resolver.
2. **P0 aberto:** 9 credenciais expostas em git history. Adicionar mais um serviço com tokens é piorar a superfície antes de fechar a existente.
3. **Atenção do dev solo:** 4-5 dias de OpenClaw é 4-5 dias que não são gravação contínua, billing, ou multi-tenant — features que de fato bloqueiam comercializar.
4. **OpenClaw é alavanca de operação, não de produto.** Faz sentido **depois** que o produto exista e estiver em produção parcial gerando dor operacional real.

**Resumo:** plano pronto, gatilho claro, executar em ~5 dias quando o momento chegar. Por enquanto, fica em prateleira.
