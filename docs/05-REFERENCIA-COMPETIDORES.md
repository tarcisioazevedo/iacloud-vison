# Referência de Competidores — Análise de Manuais VMS

**Criado em:** 2026-05-03
**Fontes analisadas:**
- Intelbras Defense IA 3.2 (127 páginas) — VMS desktop cliente-servidor brasileiro, Windows-only
- Digifort Surveillance Client v7.3 (294 páginas) — VMS desktop brasileiro (arquivo rotulado como "RedVision" é OEM/rebrand do Digifort)

**Status:** documento de referência viva. Atualizar quando novos manuais forem absorvidos.

---

## TL;DR — o que isso muda no nosso roadmap

1. Ambos competidores **são desktop Windows-only**. Nosso bet em **web + mobile nativo** é estruturalmente correto.
2. Existe um conjunto de ~25 features que integradores brasileiros **esperam encontrar**. Mapeadas na seção "Must-have" abaixo. Faltar qualquer uma vira objeção comercial.
3. Existem ~12 **gaps óbvios** dos dois (sem 2FA, sem multi-tenant nativo, sem WhatsApp, sem mobile de operador, sem cloud storage gerenciado) que viram nossa proposta de valor.
4. ~30 cenários de erro/edge case relevantes — entram direto no checklist de QA do MVP.

---

## Parte 1 — Must-have features (esperadas pelo mercado)

Marcadas com 🟢 = já temos no roadmap, 🟡 = parcial, 🔴 = não no roadmap atual.

### Live view
- 🟢 Layouts 1/4/9/16 + custom
- 🟡 Views/mosaicos salvos (públicos vs privados)
- 🔴 Tour por views salvas com intervalo configurável (10s–10min)
- 🟡 Multi-câmera no mesmo player (hoje 1 por vez)
- 🔴 **Instant Review** (5/10/15/20s playback rápido sem sair da live) — UX ganhadora pra operador
- 🔴 PTZ via mouse (click-and-center, visual joystick), presets, lock exclusivo, privacy mode
- 🔴 Hover sobre câmera na árvore mostra **snapshot preview**
- 🔴 Right-click context menu rico em cada tile
- 🔴 Áudio listen + push-to-talk (half/full duplex)

### Playback / Timeline
- 🟢 Playback básico
- 🔴 **Timeline com barras coloridas semânticas**:
  - Verde: gravação contínua
  - Laranja: áudio
  - Vermelho (claro/escuro): movimento (intensidade)
  - Amarelo: gravação por evento
  - Roxo: metadata de analytics
- 🔴 Zoom de timeline (drill-down minutos → segundos)
- 🔴 Reverse playback, frame-by-frame, velocidades 1/64x a 64x
- 🔴 **Motion Search** (re-análise de movimento sobre vídeo gravado, key-frames only)
- 🔴 **Bookmark Search** com filtro por data fracionada (dia/mês/ano/weekday/hora independentes)
- 🔴 Thumbnails de período (intervalo fixo ou por bookmark)

### Gravação
- 🟡 Gravação contínua (já temos)
- 🔴 Modo por movimento + agendado
- 🔴 **Templates de cronograma** (integral / dias úteis / fim de semana) + customizável
- 🔴 Cronograma em **grade 7×24** com pintura de blocos verdes (clicar e arrastar)
- 🔴 **Programação de feriado** (até 4 planos × 16 dias × 4 períodos)
- 🔴 **Pré-gravação** de N segundos antes do evento (Defense: até 10s)
- 🔴 **Recuperação de gravação** ("backfill" do storage do dispositivo para cloud quando link cai)
- 🔴 **Detecção de integridade** (alerta proativo: "deveria haver 30 dias mas só tem 24")
- 🔴 **Bookmarks com proteção contra deleção** (legal hold) — comercial forte pra investigação

### Eventos e alarmes
- 🟡 Eventos básicos
- 🔴 Catálogo de tipos: motion, tampering, video loss, network loss, disk full, line crossing, intrusion, loitering, abandoned object, face, ANPR
- 🔴 **Wizard em 4-5 etapas** para criar regra (origem → atributos → ações → protocolo → notificação)
- 🔴 Ações vinculáveis: gravar (até 300s), foto, email, **HTTP webhook GET/POST/PUT/DELETE com botão Testar**, saída I/O, PTZ to preset, popup
- 🔴 **Protocolo de Alarme** (instrução exibida ao operador no acknowledgement)
- 🔴 **Acknowledgement com Observations obrigatório** — vira report "operadores responderam o quê"
- 🔴 Pop-up automático de vídeo quando alarme dispara (configurável por usuário)
- 🔴 Política de dedup/repetição de alarme

### Mapa / E-map
- 🔴 Mapa estático (planta baixa) com câmeras posicionadas via drag-and-drop
- 🔴 LED de status verde/vermelho por câmera no mapa
- 🔴 Tooltip rico em hover (snapshot, IP, espaço de disco, dias estimados)
- 🔴 Pisca quando alarme dispara
- 🔴 Mapa Google Maps (multi-site) — para integradores com vários endereços

### Usuários, RBAC
- 🟡 Login básico
- 🔴 **Granularidade**: por câmera, por organização (com herança), por feature, por horário
- 🔴 **Audit log com diff antes/depois** de qualquer mudança em config (campos binários como "altered")
- 🔴 Forçar troca de senha no 1º login
- 🔴 Intervalo de troca de senha (1–365 dias)
- 🔴 Congelamento de conta após N tentativas erradas (Defense: 5 erros → 600s)
- 🔴 Bloqueio automático do cliente por inatividade
- 🔴 **2FA/MFA** — gap dos dois competidores (já temos plano em `02-PLAN-2FA-MFA.md`)

### Dispositivos
- 🟡 Cadastro manual
- 🔴 **Descoberta automática** na rede (ONVIF Discovery)
- 🔴 Adição em lote (faixa de IP)
- 🔴 Cadastro automático (dispositivo se anuncia)
- 🟡 **Hierarquia de organizações** (sites > prédios > áreas) — começamos com tenant flat

### Relatórios e logs
- 🔴 Logs separados por categoria: operação, dispositivo, sistema, serviço
- 🔴 **Devices failure report** com tempo total de offline por device (KPI de SLA)
- 🔴 **Operators' response to events** report (compliance)
- 🔴 Export PDF, CSV, XLSX, HTML
- 🔴 Logo customizável em report (white-label)

### Backup / exportação
- 🟡 Export simples
- 🔴 Múltiplos formatos: **Native** (com player.exe embarcado + watermark), MP4 (com transcoding H.264+AAC), AVI, **JPEG timelapse** (1 frame/hora ou 1/dia — útil pra construção civil)
- 🔴 **Watermark de autenticidade** (HMAC do hash dos frames + chave do tenant) — diferencial chain-of-custody
- 🔴 **Sequence Export** (vídeo seguindo o switch de câmeras do operador — narrativa de investigação)
- 🔴 Senha opcional no export
- 🔴 Metadata de identificação obrigatória (responsável, descrição)

### Notificações
- 🟡 Push web
- 🟡 Email
- 🔴 **WhatsApp / SMS / Telegram** — Brasil exige (gap dos dois competidores)

### Análise de vídeo
- 🔴 Motion, tampering (delegado a câmera ou nosso server-side)
- 🔴 Reconhecimento facial (grupos + threshold de similaridade)
- 🔴 ANPR (banco de placas + grupos + cores de confiança ≥90/70-90/<70)
- 🔴 Contagem de pessoas (limites multidão/excesso, semáforo amarelo/vermelho)
- 🔴 Object classification (pessoa, carro, sem classificação)

### Integrações
- 🔴 I/O alarm boards (entrada/saída digital)
- 🔴 Controle de acesso (porta + cartão + face + digital)
- 🔴 LPR/ANPR (banco de placas + listas branca/negra/permitida)
- 🟡 HTTP webhook (Defense expõe muito bem isso — copiar UX do "Testar")

---

## Parte 2 — Onde podemos diferenciar (gaps dos competidores)

| Gap | Como exploramos |
|---|---|
| Cliente desktop Windows-only | **Web puro + mobile nativo** sem instalar nada |
| Sem 2FA/MFA | TOTP no MVP, WebAuthn depois (`docs/02-PLAN-2FA-MFA.md`) |
| Sem multi-tenant nativo (apenas multi-server) | Multi-tenant real B2B2B desde o dia 1 |
| Sem WhatsApp/SMS/Telegram | WhatsApp Business API, SMS via Evolution já existe |
| Sem mobile app de operador (só morador no Defense) | App de operador mobile-first |
| Sem cloud storage gerenciado | R2 já é nosso, transparente |
| Sem AI moderna nativa (dependem de engines terceiros: ARH, Neural Labs) | YOLO/embeddings nativos no edge box |
| Licenciamento opaco por feature matrix | Preço SaaS por câmera transparente |
| Backup que interrompe serviços | Point-in-time recovery transparente do Postgres managed |
| Licença vinculada à máquina (perde em VM/migration) | SaaS resolve sozinho |
| TLS 1.0 ainda discutido | Já nascemos TLS 1.3 |
| Audit log com binários como "altered" sem versioning | Audit estruturado com diff JSON por campo |
| Sem compartilhamento por link público temporário de vídeo | Diferencial UX moderno |

---

## Parte 3 — Padrões UX para importar no nosso frontend (React 19)

Curto:
- **Side bar com tree de objetos** + search box, filter "show deactivated"
- **Right-click context menu sobre tile** = hub de ações (Media Playback, PTZ, Filters, Bookmark, etc)
- **Wizard em N etapas numeradas** para fluxos compostos
- **Engrenagem inline (⚙)** em linhas de tabela
- **Grade 7×24 pintável** para cronogramas
- **Date picker dual**: data completa vs data fracionada (filtro por dia-mês-ano-weekday-hora)
- **Manage Filters drawer** com chips arrastáveis para top bar (intersecção AND)
- **Status icons distintos** por estado (recording, motion, deactivated, OOO)
- **Tooltip rico** em hover (snapshot, IP, espaço de disco, dias estimados)
- **Bookmark com cor + título + comentário**
- **Acknowledgement modal** com campo obrigatório de observação
- **Templates pré-criados** (cronograma, SMTP, modelo de email)
- **Botão "Testar"** em integrações (SMTP, webhook, AD)
- **Drag-and-drop**: câmera → tile, dispositivo → mapa
- **Disclaimer modal** no 1º acesso (LGPD/termos)
- **Limites verbosos em hints** ("5–600 segundos", "máximo 32 funções")

---

## Parte 4 — Checklist de QA derivado dos manuais

Cenários de erro/edge case mencionados nos manuais, organizados por área. Cada item vira teste no nosso suite.

### Câmera / dispositivo
- [ ] Câmera offline → ícone diferenciado + overlay de reconexão
- [ ] Câmera "out of order" (não responde mas IP up) → ícone diferenciado
- [ ] Credencial inválida → mensagem clara
- [ ] Modificação no dispositivo direto (não pela plataforma) → sync manual ou ONVIF events
- [ ] Codec não suportado pelo browser → fallback ou mensagem
- [ ] Sub-stream 2 não disponível → fallback para sub-1
- [ ] Múltiplos clientes consumindo mesmo canal → fallback de direct para forwarding
- [ ] Caracteres especiais em nomes (UTF-8, emoji, aspas)

### Gravação / playback
- [ ] Disco cheio → alerta proativo + comportamento de recycling
- [ ] Bookmark com initial==end (punctual)
- [ ] Recuperação de gravação além do limite (>7 dias)
- [ ] Detecção de integridade: dia com <24h gravado → status anormal
- [ ] Cronograma de feriado sobreposto a dia normal → qual prevalece
- [ ] Bookmark protegido vs file recycler (precisa mover para cold storage)
- [ ] MP4 export sem transcoding em codec exótico → não roda em todo player

### Eventos / alarmes
- [ ] Mesmo alarme dispara 2x com janela aberta → política dedup
- [ ] Pop-ups simultâneos > limite → auto-fecha mais antigo
- [ ] Acknowledgement sem texto obrigatório → bloqueia close
- [ ] HTTP webhook timeout → retry policy + audit do erro
- [ ] Email SMTP com TLS / OAuth moderno (Gmail) / porta não-padrão
- [ ] Pré-gravação ativada mas câmera não tem buffer → degrada gracefully

### Usuário / RBAC
- [ ] Senha forçada na 1ª troca + intervalo + expiração por data → matriz de cenários
- [ ] N tentativas erradas → congelamento por X tempo
- [ ] Permissão herdada de organização vs sobrescrita em subnó
- [ ] Multi-server: skew de relógio entre servidor e cliente
- [ ] Audit "binary fields" sem valores → handling explícito

### Multi-tenant / isolamento
- [ ] Tenant A não vê dado de tenant B (cross-tenant leak test)
- [ ] Quota de câmeras estourada → bloqueio + UX clara
- [ ] Excluir entidade em cascata (organização → câmeras filhas) → confirmação com diff

### Edge / network
- [ ] Edge box offline → backfill quando voltar
- [ ] Failover entre POPs (atual DE → futuro BR)
- [ ] Bridge/integração externa desconectada → replay ou perda silenciosa?
- [ ] Janela de sincronização restrita (Defense: 04:00–23:00) → ofuscação de timezone

### Export / chain-of-custody
- [ ] Watermark de autenticidade quebrado → indicação visual (crossed circle)
- [ ] Export com senha → player exige senha
- [ ] Export grande dividido em chunks → consistência

---

## Parte 5 — Conceitos de modelagem para considerar

Termos e estruturas que os competidores usam e podem informar nosso schema:

| Conceito | Defense IA | Digifort | Nosso schema |
|---|---|---|---|
| Site multi-tenant | "Local" | "Server" | `Tenant` (já temos) |
| Hierarquia de câmeras | "Organização" (árvore) | "Group" implícito | considerar tree |
| Stream principal vs sub | "Principal/Sub1/Sub2" | "Media Profile" | hoje 1 stream |
| Layout salvo | "Visualização" | "View / Mosaic" | falta no schema |
| Cronograma | "Modelo de Tempo" (7×24) | "Schedule" (Admin Client) | falta |
| Plano de gravação | "Plano" + canais + cronograma | implícito no Admin Client | falta granular |
| Regra de evento | "Evento" em 5 etapas | "Manual/Global Event" | parcial |
| Bookmark protegido | não tem | "Bookmark Protect Against Deletion" | falta |
| Audit log com diff | logs separados | "Audit log com diff antes/depois" | parcial |
| Failover de câmera | "M+N standby" | "Failover Server" | falta |

---

## Parte 6 — Anti-padrões observados (não copiar)

- Cliente desktop pesado (já decidido)
- Sub-servidores M+N (substituível por orquestração de pods)
- Backup `.dbk` manual com restauração que para serviço (managed Postgres resolve)
- Licenciamento offline por export+import de zip (SaaS)
- Joystick USB nativo, leitora de cartão USB
- Configuração explícita "modo NIC duplo"
- Modo de decodificação CPU vs GPU exposto ao usuário
- Plug-in instalável no browser (Digifort Web Interface ainda usa)
- Limites duros arbitrários (3 super-admins, 10 admins) — em SaaS é "ilimitado"
- Disclaimer.htm custom no install folder (config de tenant resolve)
- Centralized server registration via .ini em network share

---

## Como usar este documento

- **Antes de planejar feature nova:** consultar Parte 1 (must-have) e Parte 2 (gaps) para posicionar.
- **Antes de design de UX:** consultar Parte 3 (padrões importáveis).
- **Ao escrever testes:** copiar itens da Parte 4 que ainda não estão cobertos.
- **Ao desenhar schema:** consultar Parte 5.
- **Em revisão de PR:** se algo se parece com Parte 6, questionar.

PDFs originais salvos em `/tmp/vms-refs/` (defense.pdf 4.4MB, redvision.pdf 15MB) — efêmero. Se precisar reler, baixar de novo das fontes:
- <https://backend.intelbras.com/sites/default/files/2025-04/manual-defense-3.2_0.pdf>
- <https://www.redvisioncctv.com/assets/pdf/Surveillance-Client.en-us.pdf>

---

## Próximas absorções recomendadas

Quando tiver tempo, vale absorver também:
- Manual do **Monuv** (concorrente direto cloud BR) — se houver público
- Manual do **BeNuvem** — idem
- Manual do **Segware Sigma** — idem (se não for closed)
- Manual de **Milestone XProtect** (referência mundial enterprise)
- Manual de **Genetec Security Center** (referência mundial enterprise)
- Manual de **Eagle Eye Networks** (referência cloud nativa)
