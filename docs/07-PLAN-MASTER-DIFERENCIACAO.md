# Plano Master de Diferenciação e Implementação — IA Cloud Vision

**Criado em:** 2026-05-03
**Pré-requisitos de leitura:** `docs/05-REFERENCIA-COMPETIDORES.md`, `docs/06-MAPA-COMPETIDORES.md`
**Status:** plano vivo. Sprints podem reordenar com base em feedback de piloto.

---

## Sumário Executivo (TL;DR)

Para entrar forte e ser **palpavelmente competitivo** com Monuv, BeNuvem e Oktopus, precisamos:

1. **6 features must-have** que fechem o gap básico vs concorrentes BR (operadores não vão usar sem isso).
2. **5 diferenciadores reais** que atacam fraquezas comuns dos 3 brasileiros (segurança, edge, NLP, pricing transparente, integrações modernas).
3. **Edge Box ICV-Bridge** em 3 cenários de uso bem definidos (não é "mais um NVR").
4. **Plano em 4 ondas** (MVP P0 → MVP P1 → V1 Comercial → V2 Diferencial), 9-12 meses para entrar no mercado forte.

**Investimento estimado em dev (1 dev solo + 1 contratação faseada):**
- Onda 1 (MVP P0, fechar P0 + base): 4-6 semanas
- Onda 2 (MVP P1, paridade básica): 8-10 semanas
- Onda 3 (V1 Comercial, diferenciadores): 10-12 semanas
- Onda 4 (V2 Diferencial, marketplace + AI avançada): 12+ semanas

**Custo recorrente em produção (estimativa por 100 câmeras ativas):**
- Hetzner cluster: ~€80/mês
- Cloudflare R2 (gravação 30d): ~$50/mês
- IA inferência (5% câmeras com IA always-on): ~$30/mês
- Edge box: custo do cliente (BOM ~R$ 500-1.500 por unidade)

---

## Parte 1 — Diferenciadores estratégicos (os 5 pilares)

Cada pilar tem: **descrição, justificativa de mercado, escopo técnico, métrica de sucesso**.

### Pilar 1 — Resiliência de campo via ICV-Bridge (edge box)

**Descrição:** edge box opcional que vive no LAN do cliente, descobre câmeras automaticamente, faz buffer local e backfill quando link cai, executa IA leve no edge e expõe ONVIF/RTSP transparente para o cloud.

**Justificativa:** Brasil tem ISP instável (apagão, bandwidth oscila, NAT carrier-grade). Eagle Eye criou um mercado de $1B só com isso (Bridge appliance obrigatório). No BR, Monuv e BeNuvem não documentam edge box robusta. **É o nosso "Bridge moment"**.

**3 cenários de uso (ver Parte 4 para detalhamento):**
- **Cenário A — câmera direta cloud (sem box):** câmera com IP público ou via Cloudflare Tunnel. Zero hardware extra. Para SMB simples.
- **Cenário B — box leve (até 8 câmeras):** Raspberry Pi 5 ou x86 mini-PC. Buffer 24-72h, sem AI local. Para PME.
- **Cenário C — box robusto (até 32 câmeras + AI edge):** mini-PC x86 com NVMe + Coral TPU ou Jetson. Buffer 7-14 dias, AI always-on. Para indústria/varejo.

**Métricas de sucesso:**
- Backfill funcional em 100% dos casos de queda <72h
- Latência live degrada <20% durante buffer
- Setup de novo box <10 minutos pelo integrador

### Pilar 2 — Segurança operacional B2B (ausente nos BR)

**Descrição:** 2FA obrigatório, audit log com diff campo-a-campo, evidence lock (legal hold), watermark de autenticidade, chain of custody, RBAC granular por câmera + horário.

**Justificativa:** Monuv, BeNuvem e Oktopus **não documentam 2FA em lugar nenhum**. Audit é genérico. Empresas que precisam de LGPD compliance, contrato corporate, processo jurídico — hoje vão pra Milestone (caro/complexo) ou aceitam o gap dos BR. Nós entramos exatamente nessa fenda.

**Escopo técnico:**
- 2FA TOTP no MVP (plano `02-PLAN-2FA-MFA.md` já existe), WebAuthn na V2
- Audit log: tabela `AuditEvent { entityType, entityId, action, before_json, after_json, actor, ip, ts }` com retenção 365 dias
- Evidence lock: flag em `Recording { protectedUntil }` que impede deleção pelo recycler + move para cold storage
- Watermark: HMAC-SHA256 de chunks do vídeo + chave por tenant. Player verifica e mostra "crossed circle" se quebrado
- Chain of custody: tabela `EvidenceAccess { evidenceId, accessor, accessTs, action: view|download|export, ip }` exportável como PDF
- RBAC: `Permission { role, scope: Camera|Site|Tenant, feature, hours_of_day, days_of_week }`

**Métricas de sucesso:**
- 100% das ações destrutivas em audit log
- Tempo médio para gerar relatório de chain of custody <30s
- Zero deleção acidental de vídeo com evidence lock ativo

### Pilar 3 — Smart Search com IA moderna (gap dos BR)

**Descrição:** busca por linguagem natural e filtros sobre vídeo já gravado. "Mostre todos os carros vermelhos saindo entre 14h e 16h ontem". "Pessoa com mochila perto da porta dos fundos na semana passada".

**Justificativa:** Eagle Eye e Stratocast têm. **Nenhum BR tem**. Monuv tem IA de detecção em tempo real (excelente), mas não busca semântica retroativa. É o tipo de feature que vira diferencial demonstrável em 30 segundos de demo.

**Escopo técnico:**
- Pipeline de indexação: ao gravar, extrair embeddings de pessoa/veículo via modelo CLIP ou similar (server-side ou edge)
- Storage de embeddings em pgvector ou Qdrant (decisão arquitetural a fazer)
- Atributos extraídos: classe (pessoa/veículo), cor dominante, tamanho relativo, posição
- Query: NLP → embedding → busca de similaridade + filtros estruturados (timestamp, câmera, tenant)
- UI: barra de busca natural + filtros estruturados (calendário, câmeras, classe)

**Custo estimado de inferência:**
- CLIP via OpenAI: ~$0.005/imagem. Em 100 câmeras com 1 frame/s e detecção em 5% = $50/mês. Aceitável.
- CLIP self-hosted em GPU: zero por inferência, mas custo de GPU
- Decisão: começar com CLIP API; migrar para self-hosted quando >500 câmeras ativas

**Métricas de sucesso:**
- Latência query <2s para 100k frames indexados
- Precisão recall@10 >70% em queries ambíguas
- 80% dos clientes do tier Pro+ usam Smart Search semanalmente

### Pilar 4 — Pricing transparente + degrau de entrada baixo

**Descrição:** página pública de preços. Tier Starter desde R$ 19/câmera/mês, sem consumo mínimo. Tabela completa com features por tier.

**Justificativa:** Monuv exige R$ 900 mín/mês = R$ 10.800/ano só pra começar. Bloqueia o integrador pequeno (2-3 clientes). Eagle Eye exige Bridge $500-2000 + assinatura. Oktopus tem tabela mas é turnkey (cliente final, não integrador). **Há um vazio entre "câmera de prateleira Mibo" (R$ 5/cam/mês) e "Monuv" (R$ 900/mês mín)**.

**Tiers propostos (esboço):**

| Tier | Preço/câmera/mês | Retenção | IA inclusa | Edge Box | Quem é |
|---|---|---|---|---|---|
| **Starter** | R$ 19 | 7 dias eventos | Motion only | Cenário A | Integrador iniciante, residencial |
| **Pro** | R$ 49 | 30 dias contínua | Motion + Person/Vehicle | Cenário B opcional | PME, comércio |
| **Business** | R$ 89 | 90 dias contínua | + ANPR + Face | Cenário B/C | Negócio com necessidade jurídica |
| **Enterprise** | sob proposta | até 5 anos | Suite completa + Smart Search NLP + custom | Cenário C | Corporate, governo, indústria |

**Sem consumo mínimo de receita.** Sem fee de setup. Sem "ative 10 câmeras pra começar". 1 câmera no Starter = R$ 19/mês, ponto.

**Métricas de sucesso:**
- Conversão landing → trial >3% (mercado VMS BR fica em 0.5-1% hoje)
- 60% dos novos clientes começam com 1-3 câmeras
- LTV de Starter convertido para Pro >R$ 2.000

### Pilar 5 — Integrações modernas + Open API documentada

**Descrição:** API REST completa documentada (Swagger/Redoc), webhooks com retry policy, app Zapier/Make/n8n oficial, biblioteca SDK em JS/Python na V1.

**Justificativa:** Nenhum BR oferece. Monuv tem webhook genérico. Mercado moderno (PMEs com stack no-code) compra com base em "se conecta com o que já uso". Plus de marketplace público de plugins na V2.

**Escopo técnico:**
- OpenAPI 3.1 spec gerado a partir do código (Express + ts-rest ou tRPC)
- Documentação em `api.iacloud.com.br/docs` (Redoc)
- Webhooks com retry exponencial (1m, 5m, 30m, 4h, 24h) + dead letter
- Endpoints públicos chave: `GET /cameras`, `GET /events`, `POST /events/search`, `GET /recordings/:id/url`, `POST /share/temp-link`
- Zapier/Make: criar app oficial com 5-10 triggers e 3-5 actions

**Métricas de sucesso:**
- 30% dos clientes Pro+ usam pelo menos 1 webhook
- Marketplace com 10+ integrações na V2
- Documentação API com >500 visitas/mês após 6 meses

---

## Parte 2 — Features must-have (paridade básica)

Sem essas, integradores BR descartam o produto na primeira reunião. Status atual em `docs/06-MAPA-COMPETIDORES.md`.

### MH-1 — Layouts de mosaico ricos
**O que:** layouts 1/4/9/16/25/36 + custom drag-and-drop. Mosaico salvo por usuário (público vs privado).
**Por que:** todos os concorrentes têm. Operador profissional NÃO usa câmera 1-por-vez.
**Esforço:** 1 sprint (2 sem)
**Quando:** Onda 2

### MH-2 — Timeline de playback com cores semânticas
**O que:** barra de tempo com zoom, cores diferentes para gravação contínua / movimento / evento / áudio. Drag para selecionar período de export.
**Por que:** padrão de UX dos profissionais (Milestone, Eagle Eye, Digifort, Defense). Sem isso, "parece amador".
**Esforço:** 1.5 sprint
**Quando:** Onda 2

### MH-3 — Pré-evento (buffer de N segundos antes do trigger)
**O que:** ao detectar motion/IA, gravar 60s antes + N segundos depois. BeNuvem destaca isso.
**Por que:** sem isso, evento "começa no meio". Comum em alarmes de central de monitoramento.
**Esforço:** 0.5 sprint (já temos buffer no go2rtc, falta wiring)
**Quando:** Onda 2

### MH-4 — Notificação multi-canal (Telegram + WhatsApp + Push mobile + Email)
**O que:** preferências por usuário e por evento. BeNuvem destaca Telegram com foto/vídeo. Vamos ter Telegram + WhatsApp (Evolution já temos) + Email + Push.
**Por que:** mercado BR espera Telegram. WhatsApp é diferencial. Push mobile é tabela.
**Esforço:** 2 sprints
**Quando:** Onda 2 (Telegram + email primeiro), Onda 3 (WhatsApp + push)

### MH-5 — Mobile app nativa (iOS + Android)
**O que:** Capacitor ou React Native. Live, playback básico, eventos, notification push, snapshot, share.
**Por que:** PWA já temos, mas operador profissional quer ícone na tela inicial e push funcionando offline.
**Esforço:** 4-6 sprints (decidir Capacitor vs RN antes)
**Quando:** Onda 3

### MH-6 — Right-click context menu rico no tile
**O que:** menu contextual no tile da câmera com Live, Playback rápido, Bookmark, Snapshot, PTZ, Filtros de imagem, Mute audio.
**Por que:** padrão UX universal em VMS. Já discutido em `docs/05-REFERENCIA-COMPETIDORES.md`.
**Esforço:** 1 sprint
**Quando:** Onda 2

### MH-7 — Cronograma de gravação (grade 7×24)
**O que:** grade pintável com templates (integral, dias úteis, fim de semana) + feriados. Vincula a câmeras.
**Por que:** padrão Defense IA + Digifort + todos. Sem isso, gravação é "ligado/desligado" — primitivo.
**Esforço:** 1.5 sprint
**Quando:** Onda 2

### MH-8 — Bookmark com proteção (legal hold)
**O que:** marcar trecho na timeline com cor + título + observação. Flag "proteger contra deleção" move para cold storage R2 com retenção indefinida.
**Por que:** Milestone vende isso como Evidence Lock. Diferencial em uso jurídico.
**Esforço:** 1.5 sprint
**Quando:** Onda 3

### MH-9 — Acknowledgement de alarme com observação obrigatória
**O que:** quando alarme dispara em modo crítico, operador precisa fechar com texto explicando ação tomada. Vira report "operadores responderam o quê".
**Por que:** compliance + auditoria + SLA. Padrão Defense + Milestone.
**Esforço:** 1 sprint
**Quando:** Onda 3

### MH-10 — Mapa (E-map) com câmeras posicionadas
**O que:** upload de planta baixa, drag-and-drop de câmeras, LED de status, hover com snapshot+IP+health.
**Por que:** todo VMS tem. Diferencia em apresentação comercial.
**Esforço:** 2 sprints
**Quando:** Onda 3

### MH-11 — Detecção de pessoa/veículo (IA básica)
**O que:** YOLO ou MobileNet rodando server-side ou edge. Filtra "motion" virou "pessoa" / "veículo".
**Por que:** todos têm. "Motion" cru gera 100x mais falsos positivos.
**Esforço:** 2-3 sprints (depende de pipeline)
**Quando:** Onda 3

### MH-12 — Compartilhamento por link público temporário
**O que:** gerar URL com TTL (15min, 1h, 24h, 7d) que mostra live ou trecho gravado sem login. Watermark visível com nome do tenant.
**Por que:** gap em todos. UX moderna espera. Útil para compartilhar com cliente final, polícia, perito.
**Esforço:** 1 sprint
**Quando:** Onda 2 (oportunidade rápida)

### MH-13 — Audit log com diff antes/depois
**O que:** toda mudança em config gera registro com `before_json` e `after_json`. UI mostra diff visual.
**Por que:** Milestone tem. BR não tem. Compliance LGPD.
**Esforço:** 1.5 sprint
**Quando:** Onda 2

### MH-14 — RBAC granular por câmera + horário
**O que:** permissão `view_live`, `view_playback`, `export`, `delete`, `manage_event`, escopo por câmera/site/tenant, com janela horária.
**Por que:** Defense, Milestone, Stratocast, Eagle Eye têm. BR não documenta.
**Esforço:** 2-3 sprints (refator significativo do auth atual)
**Quando:** Onda 3

### MH-15 — Webhook HTTP com Testar + Retry policy
**O que:** UI de configuração com método (GET/POST/PUT/DELETE), headers, body template, botão "Testar". Retry exponencial.
**Por que:** Defense IA + Monuv têm. Esperado pelo mercado.
**Esforço:** 1 sprint
**Quando:** Onda 2

---

## Parte 3 — Roadmap de implementação por ondas

### Onda 1 — Fechar P0 + Estabilizar (4-6 semanas)
**Objetivo:** desbloquear `docs/PRE-HOMOLOGACAO-CHECKLIST.md`. Sem isso, NADA do resto começa.
**Entregas:**
- ✅ Rotacionar 9 credenciais P0 do `docker-stack.yml`
- ✅ Limpar git history (git-filter-repo)
- ✅ Setup de secrets management (Docker secrets ou Vault)
- ✅ Etapa 1 do `03-PLAN-EDGE-POP-BR.md` (SRT + MediaMTX em DE) estável
- ✅ TLS 1.3 em produção, certificate pinning
- ✅ Backup automático Postgres validado
- ✅ Hooks pre-push instalados em todos os clones

**Saída desta onda:** podemos abrir piloto interno fechado.

### Onda 2 — MVP Paridade Básica (8-10 semanas)
**Objetivo:** ter um produto que dá pra mostrar para integrador sem vergonha. Bate Monuv/BeNuvem em features fundamentais.
**Entregas (por feature key, ver Parte 2):**
- MH-1 layouts mosaico ricos
- MH-2 timeline com cores semânticas
- MH-3 pré-evento buffer
- MH-4 notificação Telegram + Email (parte 1)
- MH-6 context menu rico no tile
- MH-7 cronograma 7×24
- MH-12 link público temporário (oportunidade rápida)
- MH-13 audit log com diff
- MH-15 webhook com testar
- **Pilar 4** — landing page de preços pública com tiers
- **Pilar 5** parte 1 — OpenAPI doc + Redoc no `api.iacloud.com.br`

**Saída desta onda:** primeiro integrador piloto pago.

### Onda 3 — V1 Comercial Diferenciada (10-12 semanas)
**Objetivo:** posicionar como alternativa séria a Monuv/BeNuvem com diferenciadores claros.
**Entregas:**
- MH-5 mobile nativa iOS+Android (Capacitor recomendado)
- MH-8 bookmark com legal hold (Evidence Lock)
- MH-9 acknowledgement com observação
- MH-10 E-map
- MH-11 detecção pessoa/veículo (IA básica)
- MH-14 RBAC granular
- MH-4 parte 2 — WhatsApp + Push mobile
- **Pilar 1** — ICV-Bridge cenário B (box leve até 8 câmeras) em produção
- **Pilar 2** — 2FA obrigatório (TOTP) + watermark de autenticidade + chain of custody report

**Saída desta onda:** 5-10 integradores piloto, NPS >40, métricas de operação 24/7 estabilizadas.

### Onda 4 — V2 Diferencial de Mercado (12+ semanas)
**Objetivo:** features que NENHUM concorrente BR tem.
**Entregas:**
- **Pilar 3** — Smart Search com NLP em vídeo gravado (CLIP + pgvector)
- **Pilar 1** — ICV-Bridge cenário C (robusto + edge AI)
- **Pilar 2** — WebAuthn (2FA forte) + SSO/SAML
- **Pilar 5** parte 2 — Zapier/Make/n8n apps oficiais + marketplace público de plugins
- IA avançada: ANPR + Face Match + Heat Map (escolher 2 dos 3 baseado em demanda piloto)
- Mission Control-like: SOPs digitais com escalation (inspirado Genetec)
- Federação multi-site enterprise (inspirado Milestone)

**Saída desta onda:** posicionamento "a alternativa cloud-nativa BR moderna ao Milestone".

---

## Parte 4 — Edge Box (ICV-Bridge): cenários e arquitetura

Aqui detalho concretamente os 3 cenários do **Pilar 1**.

### Princípios de design (independente do cenário)

1. **Stateless do ponto de vista do cloud:** o box pode ser substituído por outro idêntico em <10 minutos.
2. **Pareamento via QR code + token de ativação único** (gerado no cloud, expira em 15 min).
3. **Comunicação cloud → box via Cloudflare Tunnel ou WireGuard** — sem abrir porta no NAT do cliente.
4. **Health check a cada 30s + reconexão exponencial** se cair.
5. **Logs estruturados rotacionados localmente + envio para cloud quando online.**
6. **Update OTA via comando do cloud + verificação SHA256 + rollback automático.**
7. **Configuração 100% pelo cloud** — operador nunca precisa SSH no box.

### Cenário A — Câmera direta cloud (sem box)

**Quando usar:** câmera tem IP público OU o ISP do cliente permite Cloudflare Tunnel direto da câmera (raro).

**Arquitetura:**
```
[Câmera com firmware customizado OU câmera comum + tunnel no roteador]
   ↓ RTSP/RTMP/SRT direto
[Cloudflare Tunnel ou IP público]
   ↓
[Cloud iaCloudVision: go2rtc + MediaMTX SRT]
   ↓ WebRTC/HLS
[Browser/Mobile do cliente]
```

**Limitações:**
- Sem buffer local — se link cai, perde gravação do período
- Sem edge AI
- Setup mais técnico (configurar tunnel/port)

**Quando vender:** SMB simples, 1-3 câmeras, link 100% confiável (fibra dedicada). Tier Starter.

---

### Cenário B — Box leve (até 8 câmeras, sem AI edge)

**Quando usar:** PME com 4-8 câmeras, link doméstico/empresarial padrão, precisa de buffer e descoberta automática.

**Hardware recomendado (BOM ~R$ 500-800):**
- Raspberry Pi 5 com 8GB RAM OU mini-PC x86 (ex: Beelink Mini S, Intel N100, 8GB RAM)
- SSD NVMe 256GB
- Case ventilado
- PoE switch separado se câmeras forem PoE

**Software no box (ICV-Bridge OS):**
- Linux Debian 12 minimal
- Docker + docker-compose
- Containers:
  - `icv-agent` — pareamento, health, OTA, comandos
  - `go2rtc` — captura RTSP/ONVIF, transcode, push para cloud
  - `wireguard` — túnel persistente para cloud
  - `local-buffer` — escreve segmentos HLS de 4-10s em SSD local
  - `backfill-uploader` — quando link volta, faz upload dos segmentos pendentes

**Arquitetura:**
```
[Câmeras LAN — RTSP/ONVIF]
   ↓ ~5-10 ms
[ICV-Bridge no LAN do cliente]
   ↓ WireGuard tunnel persistente
[Cloud iaCloudVision]
   - Live: SRT push → MediaMTX → WebRTC para browser
   - Gravação: HLS segments → R2
   - Backfill: queue de segmentos pendentes do box
```

**Capacidades:**
- Buffer local: 24-72h dependendo de bitrate (bitrate médio 2 Mbps × 8 cam × 24h = 1.7TB → 72h cabe em SSD 256GB com retenção H.265)
- Descoberta automática ONVIF
- Push de configuração via cloud (mudar bitrate, FPS)
- Backfill automático de gravações quando link volta

**Quando vender:** Tier Pro / Business. PME com 4-8 câmeras.

**Custo estimado para o cliente:** hardware ~R$ 700 + opex já no plano.

---

### Cenário C — Box robusto (até 32 câmeras + AI edge)

**Quando usar:** indústria, varejo grande, condomínio, governo. Câmeras 8-32, AI always-on, link variável, requer SLA alto.

**Hardware recomendado (BOM ~R$ 1.500-3.000):**
- Mini-PC x86 com Intel i5/i7 12ª gen ou superior, 16GB RAM, NVMe 1TB
- Acelerador de IA: Google Coral TPU USB OU NVIDIA Jetson Orin Nano (decisão a fazer com base em modelos)
- UPS pequeno (manter box up durante apagão de luz)
- Switch gerenciado PoE com 8-24 portas

**Software no box (ICV-Bridge OS Pro):**
- Tudo do cenário B
- Containers adicionais:
  - `icv-edge-ai` — inferência local (motion → pessoa/veículo, opcional ANPR/face)
  - `icv-event-buffer` — eventos locais quando cloud offline
  - `icv-watchdog` — reinício automático de container travado

**Arquitetura:**
```
[Câmeras LAN — RTSP/ONVIF/PoE]
   ↓
[ICV-Bridge Pro]
   ├─ Edge AI (Coral/Jetson) — motion → person/vehicle 24/7
   ├─ Buffer local 7-14 dias
   ├─ Eventos locais quando cloud cai
   ↓ WireGuard
[Cloud iaCloudVision]
```

**Capacidades adicionais:**
- AI always-on no edge — reduz custo de cloud inference em 90%
- Buffer 7-14 dias — sobrevive a apagão prolongado de ISP
- Eventos disparados localmente continuam funcionando offline (gravando + alertando via SMS/sirene local)
- Reconciliação inteligente quando cloud volta

**Quando vender:** Tier Business / Enterprise. Indústria, varejo, condomínio.

**Custo estimado para o cliente:** hardware ~R$ 1.800 + opex no plano.

---

### Tabela comparativa dos 3 cenários

| Aspecto | A (cloud direto) | B (box leve) | C (box robusto + AI) |
|---|---|---|---|
| Câmeras | 1-3 | 4-8 | 8-32 |
| Hardware cliente | nada | R$ 500-800 | R$ 1.500-3.000 |
| Buffer local | 0 | 24-72h | 7-14 dias |
| AI edge | não | não | sim |
| Tier de plano | Starter | Pro / Business | Business / Enterprise |
| Setup | 30 min | 15 min (paro QR) | 30 min |
| Resiliência ISP | baixa | média | alta |
| Caso de uso | residencial 1-3 cam | comércio PME | indústria, varejo, condomínio |

### Roadmap do ICV-Bridge

- **Onda 2:** Cenário B em alpha (1-2 sites internos para validar)
- **Onda 3:** Cenário B em produção + manual de instalação para integrador
- **Onda 4:** Cenário C com edge AI

---

## Parte 5 — Detalhamento técnico de implementação por feature

Cada feature aqui ganha: schema mudanças, endpoints, UI components, testes.

### Implementação MH-2 — Timeline com cores semânticas

**Schema:**
```sql
ALTER TABLE recording_segment ADD COLUMN color_band varchar(16);
-- valores: 'continuous', 'motion', 'event', 'audio', 'analytics'
CREATE INDEX idx_segment_camera_ts_band ON recording_segment(camera_id, ts_start, color_band);
```

**Backend:**
- `GET /cameras/:id/timeline?from=ISO&to=ISO&granularity=minute|hour` retorna array de tuplas `[ts, color, intensity]`
- Pré-agregação em background job a cada hora para queries de range >24h

**Frontend (React 19):**
- Componente `<Timeline>` com canvas + virtualização horizontal
- Zoom keyboard `+/-`, drag para pan, drag-direito para selecionar período
- Tooltip ao hover com timestamp + tipo

**Testes:**
- Storybook com 5 cenários (1h, 24h, 7d, 30d, evento isolado)
- E2E: criar gravação → ver na timeline → exportar período
- Performance: 30 dias × 8 câmeras renderizam <200ms

---

### Implementação MH-12 — Link público temporário

**Schema:**
```sql
CREATE TABLE share_link (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  type varchar(16) NOT NULL,    -- 'live' | 'recording'
  resource_id uuid NOT NULL,    -- camera_id ou recording_id
  ts_start timestamptz,         -- só para recording
  ts_end timestamptz,           -- só para recording
  token_hash varchar(64) UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  view_count int DEFAULT 0,
  watermark_text varchar(120),
  password_hash varchar(64),    -- opcional
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_share_token ON share_link(token_hash) WHERE expires_at > now();
```

**Endpoints:**
- `POST /share/temp-link` body: `{type, resource_id, ts_start?, ts_end?, ttl_seconds, password?}` → retorna `{url, expires_at}`
- `GET /share/:token` valida + serve player simplificado com watermark
- `DELETE /share/:id` revoga antecipadamente

**UI:**
- Botão "Compartilhar" no tile e na timeline
- Modal com TTL preset (15min, 1h, 24h, 7d) + opção senha
- Mostra URL + QR code para colar/escanear

**Auditoria:**
- Cada acesso ao share registra no `EvidenceAccess` (chain of custody)

**Testes:**
- Token expirado → 410 Gone com UX clara
- Senha errada 5x → bloqueia por 10min
- Tentativa de acessar share de outro tenant → 404

---

### Implementação MH-13 — Audit log com diff

**Schema:**
```sql
CREATE TABLE audit_event (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  ts timestamptz DEFAULT now(),
  actor_id uuid,
  actor_email varchar(120),
  actor_ip inet,
  action varchar(64) NOT NULL,        -- 'create' | 'update' | 'delete' | 'login' | 'export' | etc
  entity_type varchar(64) NOT NULL,
  entity_id varchar(64) NOT NULL,
  before_json jsonb,
  after_json jsonb,
  metadata jsonb
);
CREATE INDEX idx_audit_tenant_ts ON audit_event(tenant_id, ts DESC);
CREATE INDEX idx_audit_entity ON audit_event(entity_type, entity_id, ts DESC);
```

**Middleware Express:**
- Wrapper em handlers de mutação: capturam `before` (SELECT antes) e `after` (registro pós-update)
- Diff calculado lazy na renderização (não armazenar)
- Campos sensíveis: armazenar como `"<REDACTED>"` (passwords, tokens, chaves)

**UI:**
- Página `/audit` com filtros (data, ator, entidade, ação)
- Diff visual lado a lado para `update` (jsondiffpatch ou similar)
- Export para CSV/PDF com cabeçalho de chain of custody

**Retenção:**
- 365 dias online em Postgres
- Após 365 dias → arquivo Parquet em R2 (cold storage)

---

### Implementação Pilar 3 — Smart Search NLP

**Pipeline de indexação:**
```
[Frame de gravação] 
   ↓ a cada 1s no edge OU 1 frame/30s no cloud
[Detecção YOLO] → bounding boxes de pessoa/veículo
   ↓ para cada bbox
[Crop + CLIP embedding (512-dim)]
   ↓
[pgvector ou Qdrant: insert(camera_id, ts, bbox, class, color, embedding)]
```

**Schema (pgvector):**
```sql
CREATE EXTENSION vector;
CREATE TABLE detection (
  id bigserial PRIMARY KEY,
  camera_id uuid NOT NULL,
  ts timestamptz NOT NULL,
  class varchar(16),         -- 'person' | 'vehicle' | etc
  color_dominant varchar(16),
  bbox jsonb,
  embedding vector(512),
  attributes jsonb           -- {age_range, gender, has_bag, vehicle_type, plate?, etc}
);
CREATE INDEX ON detection USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_det_camera_ts ON detection(camera_id, ts DESC);
```

**Query NLP:**
- Frontend: barra de busca + filtros estruturados (data, câmera, classe, cor)
- Backend: NLP query → Claude/GPT extrai atributos (ex: "homem camisa azul" → `{class: 'person', color: 'blue'}`)
- Combina filtros estruturados + similarity search por embedding (fallback para casos ambíguos)
- Retorna top-50 detections com thumbnail

**UI de resultado:**
- Grid de thumbnails clicáveis
- Click → playback no momento exato com bbox destacado

**Custo:**
- CLIP API: $0.005/imagem × 1 detection/30s × 100 cam × 86400s/dia = R$ 1.500/mês para 100 cam (alto)
- **Decisão:** detectar primeiro com YOLO local (zero custo), só rodar CLIP nas detecções (5-10% dos frames). Resultado: ~R$ 100-200/mês para 100 cam.

---

## Parte 6 — Anti-features (o que NÃO fazer)

Tentação a evitar:

1. **NÃO copiar Verkada com câmeras proprietárias.** Lock-in é tóxico, FTC processou em 2024. Nosso valor é "qualquer câmera ONVIF/RTSP".
2. **NÃO competir com Segware no nicho de central de monitoramento.** Eles têm 30 anos no setor. Integração com eles via webhook + import de eventos é melhor estratégia.
3. **NÃO fazer cliente desktop Windows.** Web + mobile cobre 99% dos casos, custo de manutenção 10x menor.
4. **NÃO licenciamento por feature matrix opaco.** Mantemos preço público transparente. Diferencial vs todos.
5. **NÃO consumo mínimo de receita.** Diferencial vs Monuv (R$ 900 mín).
6. **NÃO vender hardware como modelo de negócio.** Vendemos software + edge box é commodity (BOM aberto, integrador monta ou compra de terceiro). Alternativamente, fazer parceria OEM com 1 fornecedor.
7. **NÃO inventar protocolo proprietário.** Sempre ONVIF, RTSP, WebRTC, SRT, HLS. Padrões abertos.
8. **NÃO atrasar 2FA.** É barreira de venda corporate. Plano `02-PLAN-2FA-MFA.md` precisa rodar na Onda 3.
9. **NÃO fazer marketplace de plugins na Onda 1-2.** É muito esforço sem volume. V2.
10. **NÃO pagar para ser indexado em sites de comparação (G2, Capterra) cedo.** Esperar ter 50+ clientes para que reviews orgânicos venham primeiro.

---

## Parte 7 — Métricas de sucesso e governança

### KPIs comerciais (acompanhar mensal)
- MRR (monthly recurring revenue)
- ARR
- Câmeras ativas
- Clientes ativos (tenants)
- Integradores parceiros
- Conversão landing → trial
- Conversão trial → pagamento
- Churn mensal
- LTV/CAC ratio
- NPS

### KPIs técnicos (acompanhar semanal)
- Uptime do live (SLA 99.5% mínimo)
- Latência P95 do live (meta <500ms)
- % de gravações com falha de upload
- % de eventos com falsos positivos
- Tempo médio de ativação de câmera nova
- Backfill success rate (box → cloud)
- Error rate de webhooks

### KPIs de qualidade (acompanhar quinzenal)
- Bugs reportados por integrador piloto
- MTTR de incidentes
- Cobertura de testes E2E em fluxos críticos
- Vulnerabilidades críticas em backlog (alvo: 0)

### Governança
- **Sprint:** 2 semanas
- **Demo interna:** sexta-feira de cada sprint
- **Review com integrador piloto:** mensal (a partir da Onda 3)
- **Revisão deste plano:** trimestral
- **Re-pesquisa de competidores:** semestral (atualizar `06-MAPA-COMPETIDORES.md`)

---

## Parte 8 — Riscos e contingências

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| 1 dev solo não dá conta de 4 ondas em 9-12m | Alta | Alto | Contratar dev pleno na Onda 2 (ou freelancer 20h/sem) |
| Monuv lança 2FA e fecha nosso gap antes da Onda 3 | Média | Médio | Acelerar Pilar 2 para Onda 2 se sinal de mercado vier |
| Eagle Eye entra forte no Brasil com Bridge | Baixa-Média | Alto | Nosso preço em R$ + suporte local + integração com centrais BR são moats |
| ICV-Bridge tem problema de hardware no campo | Alta (típico de hardware) | Alto | Cenário A always-available como fallback. Box é opcional |
| WhatsApp Web não-oficial banido | Alta | Médio | Rodar via Evolution API isolada + migrar para WhatsApp Business API oficial quando volume justificar |
| Custo de CLIP API explode com escala | Média | Médio | Migrar para self-hosted GPU quando >500 cam |
| Cliente exige LGPD audit completo na demo | Alta | Alto | Pilar 2 precisa estar pronto cedo. Já planejado |
| Integrador piloto sai e não paga | Média | Médio | Contrato claro de POC pago, não gratuito |

---

## Parte 9 — Próximos passos imediatos (próximas 2 semanas)

Não me proponho fazer todo plano agora. Próximos passos concretos para destravar:

1. **Validar este plano com você.** Discordâncias, prioridades diferentes, timing.
2. **Fechar P0 do checklist.** Sem isso nada começa.
3. **Decidir tier de pricing público.** Validar com 3-5 integradores informais antes de publicar.
4. **Comprar 1 mini-PC + 1 Raspberry Pi 5 para começar protótipo do ICV-Bridge cenário B.**
5. **Setup do `api.iacloud.com.br` com Redoc** apontando para spec OpenAPI gerada do código atual (rascunho).
6. **Estimar prazo realista da Onda 2 baseado em capacidade real.**

---

## Apêndice A — Checklist de feature por status atual

| Feature | Status | Onda alvo | Esforço (sprints) |
|---|---|---|---|
| MH-1 layouts mosaico | 🔴 não | 2 | 2 |
| MH-2 timeline cores | 🔴 não | 2 | 1.5 |
| MH-3 pré-evento buffer | 🔴 não | 2 | 0.5 |
| MH-4 notif Telegram+Email | 🟡 email só | 2 | 2 |
| MH-4 WhatsApp+Push | 🔴 não | 3 | 2 |
| MH-5 mobile nativa | 🔴 não | 3 | 4-6 |
| MH-6 context menu | 🔴 não | 2 | 1 |
| MH-7 cronograma 7×24 | 🔴 não | 2 | 1.5 |
| MH-8 bookmark legal hold | 🔴 não | 3 | 1.5 |
| MH-9 ack com observação | 🔴 não | 3 | 1 |
| MH-10 E-map | 🔴 não | 3 | 2 |
| MH-11 detecção pessoa/veículo | 🔴 não | 3 | 2-3 |
| MH-12 link público temp | 🔴 não | 2 | 1 |
| MH-13 audit log diff | 🔴 não | 2 | 1.5 |
| MH-14 RBAC granular | 🔴 não | 3 | 2-3 |
| MH-15 webhook + Testar | 🟡 parcial | 2 | 1 |
| Pilar 1 — ICV-Bridge B | 🔴 não | 3 | 4-5 |
| Pilar 1 — ICV-Bridge C | 🔴 não | 4 | 6-8 |
| Pilar 2 — 2FA TOTP | 🔴 plano em 02-PLAN | 3 | 2 |
| Pilar 2 — Watermark + Chain of custody | 🔴 não | 3 | 2 |
| Pilar 2 — WebAuthn/SSO | 🔴 não | 4 | 3-4 |
| Pilar 3 — Smart Search NLP | 🔴 não | 4 | 5-6 |
| Pilar 4 — Pricing público | 🔴 não | 2 | 1 |
| Pilar 5 — OpenAPI doc | 🔴 não | 2 | 1.5 |
| Pilar 5 — Zapier/Make/n8n | 🔴 não | 4 | 2-3 |

**Total estimado das ondas 2-4:** ~50-60 sprints (100-120 semanas se 1 dev solo). Com 2 devs alinhados, cabe em 12-14 meses.

---

## Apêndice B — Decisões pendentes

Antes de começar Onda 2, precisamos decidir:

| # | Decisão | Default sugerido | Quem decide |
|---|---|---|---|
| 1 | Mobile: Capacitor ou React Native? | Capacitor (reusa código React 19) | Tarcísio |
| 2 | Vector DB: pgvector ou Qdrant? | pgvector (já temos Postgres, simplicidade) | Tarcísio |
| 3 | Edge AI: Coral TPU ou Jetson? | Coral USB (custo menor, mais simples) | Tarcísio + 1 PoC |
| 4 | Tunnel cloud↔box: Cloudflare ou WireGuard? | WireGuard (não depende de CF, sem TOS) | Tarcísio |
| 5 | OEM de hardware ou BOM aberto? | BOM aberto + manual; OEM como add-on | Tarcísio |
| 6 | Tier Starter inclui retenção? | 7 dias de eventos (motion only) | Tarcísio |
| 7 | API: REST puro ou tRPC interno + REST externo? | REST puro com OpenAPI (mais universal) | Tarcísio |
| 8 | Marketplace plugins na V2: estilo Milestone ou Eagle Eye? | Estilo Eagle Eye (open API + integration directory) | Tarcísio |

---

## Como usar este documento

- **Revisão mensal:** marcar features completadas, mover entre ondas se necessário.
- **Novas features sugeridas:** adicionar a Parte 2, classificar em onda, estimar esforço.
- **Antes de aceitar feature do cliente:** consultar Pilar 1-5 — se não cabe, é candidato a "anti-feature" (Parte 6).
- **Antes de demo comercial:** revisar Pilares 1-5 e features completadas — esses são os argumentos de venda.

**Próxima ação concreta:** discutir Apêndice B (decisões pendentes) e ajustar timing das ondas com base na sua capacidade real.

---

## Apêndice C — Achados específicos da pesquisa profunda em BeNuvem

A análise profunda de BeNuvem (LMC Serviços em Tecnologia LTDA, BH/MG, fundada 2017) revelou pontos táticos importantes:

### Confirmações de gaps assumidos (agora documentados)
- **Sem 2FA/MFA:** tela de login só email+senha, sem TOTP. Confirma o Pilar 2 como diferencial real.
- **Sem API pública self-service:** endpoints `/api`, `/api/v1`, `/swagger`, `/api/docs` retornam 404. Integrações são ad-hoc pelo time deles. Confirma o Pilar 5 como diferencial real.
- **Sem PWA:** `/manifest.json` retorna 404. Confirma valor de PWA bem feita.
- **Stack frontend obsoleta:** jQuery 3.4.1 + Bootstrap + Laravel Blade server-rendered. Não é SPA moderna. Nossa React 19 + Vite é vantagem técnica concreta.

### Achados estruturais de BeNuvem
- **Hospedagem da app em DigitalOcean US (174.138.116.90, NYC/NJ).** Site institucional em HostGator BR. Tráfego de live faz round-trip BR → US → BR. Confirma valor do PoP BR (`docs/03-PLAN-EDGE-POP-BR.md`).
- **White-label real, mas mal configurado:** cert SSL do domínio do parceiro `app.vmscloud.com.br` está quebrado (erro de subject name). Browser moderno mostra alerta. **Oportunidade:** nosso white-label precisa ter SSL automático via ACME wildcard + custom domain validation.
- **Snapshot via FTP:** depende do FTP de câmeras Hikvision/Intelbras como mecanismo de evento. Acoplamento frágil + FTP é inseguro. **Oportunidade:** ONVIF Events nativo + push API moderno.
- **App iOS exige iOS 18+** — exclui boa parte dos usuários (mercado portaria/condomínio tem muitos dispositivos antigos). Nosso app deve cobrir iOS 16+.
- **Compliance theater:** BeNuvem exibe ícones de PCI DSS, SOC 2, SOC 3, CSA sem links de auditoria pública. Como microempresa do Simples Nacional com R$ 100k de capital, é improvável ter essas certificações. **Lição:** não fazemos isso. Quando atingirmos ARR para custear, faremos SOC 2 Tipo 1 real e publicaremos relatório.

### Features nicho BR descobertas que valem investigar
- **Detecção de Carona pedestre** (intrusão disfarçada em portarias).
- **Detecção de Garupa em motos** (motoboy / antifurto).
- **Tempo de retenção de filas** (varejo).
- **OCR de contêiner** (logística portuária).
- **Detecção de uso correto de EPI** (indústria).

Algumas dessas (Garupa, Carona) são especificamente brasileiras — Eagle Eye/Verkada não cobrem. Vale como diferencial vertical específico (segurança patrimonial residencial e indústria) na Onda 4.

### Adições sugeridas ao plano

| # | Nova ação | Onda | Motivação |
|---|---|---|---|
| Add-1 | SSL automático per-tenant via ACME wildcard + domain validation | 2 | BeNuvem tem white-label quebrado; nossa qualidade de detalhe vira diferencial |
| Add-2 | ONVIF Events nativos (não FTP) | 3 | Substituir o "FTP de câmera" que BeNuvem ainda usa |
| Add-3 | App iOS suporta iOS 16+, Android 10+ | 3 | Captura mercado que BeNuvem (iOS 18+ only) exclui |
| Add-4 | Detecção Garupa + Carona (analíticos nicho BR) | 4 | Diferencial vertical residencial/portaria; copia BeNuvem |
| Add-5 | Documentação de compliance honesta (LGPD audit trail real, sem ícones falsos de SOC/PCI) | 2 | Posicionamento ético + diferencial vs BeNuvem que faz "compliance theater" |
| Add-6 | Integração com Smart Sampa documentada | 4 | BeNuvem fechou em fev/2025; oportunidade pública |

---

## Apêndice D — Ranking de competidores por ameaça real ao nosso GTM

| Rank | Competidor | Ameaça | Por quê |
|---|---|---|---|
| 1 | **Monuv** | Alta | Marca conhecida no setor, integração nativa com Sigma/Moni, IA para SmartSampa. Mas barreira R$ 900/mês mín nos abre o mercado SMB |
| 2 | **BeNuvem** | Média-Alta | Catálogo de IA muito amplo (vantagem), mas stack tech obsoleta + sem 2FA + sem API + hosted US — ataque viável por modernidade técnica |
| 3 | **Oktopus** | Média | Tier turnkey SMB com tabela pública. Foco residencial/PME. Não compete em B2B2B integrador. Convivemos |
| 4 | **Segware** | Baixa (em VMS) | Domina ERP de central. Em VMS puro é módulo secundário. Convivemos via integração webhook |
| 5 | **Eagle Eye** | Baixa-Média | Não tem entrada forte no BR (preço USD, suporte EN). Se entrar, é com Bridge — diferencial caro. Atacamos com BR-first + R$ |
| 6 | **Genetec/Milestone** | Baixa | Enterprise on-prem caro. Não competem em SMB/PME BR. Convivemos no enterprise (não nosso foco V1-V2) |
| 7 | **Verkada** | Baixíssima | Lock-in proprietário, FTC processou em 2024, custo absurdo no BR. Anti-modelo |
