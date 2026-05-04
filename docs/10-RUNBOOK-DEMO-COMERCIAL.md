# Runbook Comercial — Liberação de Demo para Lead

**Item 2.10 do `docs/08-PLAN-MERCADO-NACIONAL-B2B2B.md`** — substitui a abordagem de "demo público auto-serve" por **demo gerenciada pelo time comercial**, conforme decisão de 2026-05-04.

**Audiência:** time comercial / pessoa que aprova demo (hoje: Tarcísio).

---

## Premissa do modelo

Demo NÃO é página pública auto-serve. É processo gerenciado:

1. Lead chega via funil público (`POST /leads`) ou contato direto
2. Comercial qualifica o lead (perfil: residencial / condomínio / varejo / indústria / central / governo)
3. Comercial **provisiona ambiente personalizado** com módulos liberados pelo perfil
4. Cliente recebe **magic-link com TTL** para acessar
5. Após X dias, link expira automaticamente. Conversão vira tenant pago; sem conversão, ambiente é arquivado.

**Vantagens vs demo auto-serve:**
- Cada demo tem dados/módulos relevantes ao perfil (não genéricos)
- Comercial controla quem entra, quanto tempo, quais features
- Sem risco de spam/abuse
- Métricas de conversão lead→demo→pago são claras

---

## Fluxo passo a passo

### 1. Lead entra no funil
- **Origem:** form público no site (`POST /leads`), LinkedIn outreach, indicação, SegSummit
- **Captura mínima:** nome, email, empresa, vertical, fonte
- **Onde fica:** `/admin/leads` (painel SUPER_ADMIN), CRM unificado

### 2. Qualificar o lead
- Abrir `/admin/leads/:id`
- Marcar follow-ups (`POST /leads/:id/follow-ups`) durante conversa
- Mudar `status`: INTERESTED → QUALIFIED quando vale demo
- Anotar **perfil** (residencial / condomínio / varejo / indústria / central / governo / smart-city / logístico)

### 3. Provisionar ambiente de demo

Há 2 caminhos:

#### Caminho A — Demo "leve" (lead vê dashboard, não toca config)
1. `POST /leads/:id/invite` cria `DemoInvite`
2. Sistema gera token mágico, envia por email
3. Lead clica → `GET /demo/:token` → vê dashboard read-only de tenant pré-preparado
4. TTL padrão: 7 dias

**Quando usar:** lead pequeno, primeira conversa, "só quero ver"

#### Caminho B — Demo "completa" (lead vira ClienteFinal de teste)
1. `POST /leads/:id/convert` cria Integrador OU ClienteFinal de teste
2. Comercial entra em `/admin/integradores/:id/modules` e habilita módulos pertinentes ao perfil:
   - **Residencial:** motion + face_recognition (reconhecer moradores)
   - **Condomínio:** + LPR (placas autorizadas) + people_counting (passeio)
   - **Varejo:** + heat_map + demographics + crowd_density + dwell_time
   - **Indústria:** + PPE_DETECTION + zone_monitoring
   - **Central monitoramento:** + audio_detection + alert_escalation + WhatsApp
   - **Governo/Smart-city:** + LPR (Cortex/SINESP) + face_recognition (lista negra)
   - **Logístico:** + LPR + OCR contêiner (quando disponível)
3. Comercial cria tenant ClienteFinal sob esse Integrador (ou usa tenant pré-existente "demos")
4. Cria User com role `CLIENTE_VIEWER` ou `CLIENTE_OPERADOR` (depende do perfil de demo)
5. Configura branding white-label do portal (`portalSlug`, `primaryColor`, `secondaryColor`)
6. Gera `PortalAccessToken` (`POST /clientes-finais/:id/portal-token`) com TTL configurável (3-30 dias)
7. Envia link `https://app.iacloud.com.br/portal/:slug?token=:token` por email/WhatsApp

**Quando usar:** lead qualificado, decisor envolvido, vai testar de verdade

### 4. Onboarding manual (opcional, se demo é alta prioridade)
- Criar 2-5 câmeras mock no tenant de demo (RTSP de câmera de teste interno OU vídeos pré-gravados)
- Forjar alguns eventos de IA recentes para popular timeline e gráficos BI
- Sugerir agenda de "guided demo" (15 min de call mostrando)

### 5. Acompanhamento
- Painel `/admin/integradores/:id/overview` mostra:
  - Câmeras ativas
  - Quotas consumidas
  - Último login
  - Eventos gerados
- Comercial reabre `/admin/leads/:id` periodicamente para registrar progresso

### 6. Conversão ou expiração
- **Convertido:** mudar tenant de "demo" para "production". Cobrar Stripe / boleto. Manter dados (zero migração)
- **Não convertido:**
  - Magic-link expira automático (TTL)
  - Tenant fica em status `inactive` 30 dias (recuperável)
  - Após 30 dias inativos, dados anonimizados via `LgpdDataRequest` (DELETION)

---

## Templates de email (ainda a criar)

Sugeridos para o sistema de email já existente (`config/email/templates`):

| Nome | Trigger | Destinatário |
|---|---|---|
| `demo_invite` | `POST /leads/:id/invite` | Lead |
| `demo_followup_3d` | 3 dias após `demo_invite` se sem login | Lead + comercial |
| `demo_expiring_24h` | TTL - 24h | Lead |
| `demo_expired` | Após TTL | Lead + comercial |
| `demo_converted` | Conversão para tenant pago | Cliente novo + comercial |

Usar `email-config.ts` existente para criar/editar.

---

## Política operacional

| Pergunta | Resposta |
|---|---|
| TTL padrão da demo? | 7 dias (pode estender pra 14-30 sob solicitação) |
| Quantas câmeras mock por demo? | 2-5 (suficiente pra mostrar mosaico, eventos, BI) |
| Demos simultâneas? | Sem limite duro — limitado por capacidade da VPS (atual ~10-15 tenants) |
| Comercial pode liberar feature paga em demo? | SIM — tudo é flag, ativa/desativa em segundos |
| Lead pode "puxar" demo via form? | NÃO — form só captura lead, comercial decide ativação |
| Demo pode ser white-label? | SIM — comercial configura `portalSlug` + cores |
| Cliente final na demo recebe push/email/WhatsApp? | Configurável; padrão = OFF para evitar spam |

---

## Métricas a acompanhar (semanal)

- Leads novos/semana
- Leads → demo (taxa de qualificação)
- Demo → ativação (login do lead)
- Demo → conversão (lead pagou)
- Tempo médio lead → conversão
- Top vertical em conversão

Painel: `/admin/leads/metrics` (já existe — `GET /leads/metrics`).

---

## Pendentes para o produto suportar isso bem

Itens que ajudariam o fluxo mas NÃO são bloqueio:

1. **Templates de email** acima (1 dia para criar todos)
2. **Botão "Provisionar demo completa"** em 1 clique no `/admin/leads/:id` (hoje é manual, ~10 min)
3. **Seed de eventos sintéticos** acionável via botão (popular timeline em 30s)
4. **Dashboard "Funil de demos"** mostrando leads por stage
5. **Integração CRM externo** (HubSpot/Pipedrive) — futuro

Cada um vira card no Onda 2/3 conforme prioridade comercial dita.

---

## Fluxo resumido em 1 linha

> Lead → qualificar → `convert` → ligar módulos do perfil → magic-link com TTL → cliente acessa portal branded → comercial acompanha métricas → converte ou expira.
