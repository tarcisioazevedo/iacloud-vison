# Auditoria Adversarial de Segurança — VSaaS Backend

**Data:** 2026-06-15
**Escopo:** vsaas-backend (265 arquivos TS, 95 rotas, 124 entidades Prisma, 79 capabilities), vsaas-ai-worker, vsaas-frontend, docker-stack
**Postura:** adversarial pré-produção. Decisão go/no-go.

---

## 🚨 SUMÁRIO EXECUTIVO — VEREDITO

**🔴 NO-GO PARA LANÇAMENTO COMERCIAL EM PRODUÇÃO.**

Em uma frase: o sistema tem maturidade arquitetural acima da média (capability gating sofisticado, audit log completo, LGPD parcialmente implementado) **mas falha em quatro fundamentos não-negociáveis** para SaaS multi-tenant com dado biométrico — JWT validation incompleta, MediaMTX exposto sem auth de stream, R2 com gap de orphan cleanup violando LGPD, e Postgres sem RLS dependendo 100% de filtros de aplicação que têm casos comprovados de bypass.

**Contagem:**
- 🔴 **6 bloqueadores** críticos (devem ser fechados antes do go-live)
- 🟠 **9 altos** (fechar em ≤30 dias após go-live)
- 🟡 **11 médios** (dívida técnica — backlog do primeiro trimestre pós-lançamento)
- Itens que exigem **verificação externa**: 4 (ver §3)

---

## 1. MAPEAMENTO DE ARQUITETURA

### 1.1 Serviços do backend (Docker Swarm)
```
vsaas_backend     Node 20 + Express + Prisma — API principal (porta 3000)
vsaas_postgres    PostgreSQL 16 + pgvector — DB único compartilhado entre todos tenants
vsaas_pgbouncer   PgBouncer — pool de conexões (config não inspecionada nesta auditoria)
vsaas_mediamtx    MediaMTX — ingestão RTSP/RTMP/SRT + WebRTC saída
vsaas_frontend    Nginx + React build — SPA
vsaas_redis       Redis — cache de capabilities, rate limit
ai-worker         Python — inferência YOLO (em nó Swarm separado, label role=inference)
evolution         Outsourced em VPS 168 — WhatsApp gateway (réplicas=0 local)
```

### 1.2 Identidade do tenant (hierarquia)
```
SUPER_ADMIN → Integrador → ClienteFinal → Site → Camera
                                                 → Recording / Bookmark / EvidenceVault
                                                 → ReviewItem / FaceEvent / PlateEvent
```

### 1.3 Como o tenant é identificado em cada camada

| Camada | Mecanismo | Confiabilidade |
|---|---|---|
| Autenticação | JWT HS256 local + opcional proxy-auth (Authentik via header) | 🟡 ver §2.2 |
| Authorization | `requireCameraForUser` + `cameraTenantWhere` + `canUserAccess` + capabilities | 🟢 padrão sólido onde aplicado |
| DB queries | Filtro em aplicação via Prisma where clauses | 🔴 **sem RLS — 100% app-layer** |
| R2 storage | Bucket por integrador (`icv-<integradorId>`) + key prefixada | 🟠 isolamento estrutural OK, cleanup falha |
| MediaMTX streams | path naming `cam-<UUID>` ou `<edgeNodeId>/<streamId>/...` | 🔴 **sem auth — UUID-como-segredo** |
| Audit log | `tenantScopeFilter` em `audit.ts` | 🟢 OK |

### 1.4 Fluxo do vídeo (resumido)
```
Câmera RTSP/RTMP/SRT
    ↓
MediaMTX (paths sem auth)
    ↓
cloud-direct-recorder.service (ffmpeg → segments .ts)
    ↓
R2 (bucket icv-<integradorId>/<cameraId>/<date>/<segment>.ts)
    ↓
Playback: presigned URL TTL 5min, ticket JWT no /playback/:id/segments/*.ts
```

---

## 2. ACHADOS DETALHADOS

### 🔴 BLOQUEADORES (não pode ir pra produção sem fechar)

#### B-1. JWT verify sem whitelist de algoritmos
- **Severidade:** Crítico · **Domínio:** Auth
- **Onde:** `src/middleware/auth.ts:150, 215, 278`
- **Código:** `jwt.verify(token, secret)` sem `{ algorithms: ['HS256'] }`
- **Risco real:** Algorithm confusion attack (CVE-2015-9235 class). Atacante pode forjar token com `alg:none` ou trocar de RS256→HS256 usando public key como secret. Se o backend rotacionar pra suportar RS256/Authentik no futuro com mesma rota de verify, o ataque vira trivial. Mesmo hoje, libs ruins respeitam `alg:none`.
- **Correção:** `jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'vsaas', audience: 'vsaas-api' })` em todos os 4+ sites de verify. Tokens emitidos por `jwt.sign` em auth.ts:357, live.service.ts:212, etc. precisam incluir `iss` e `aud` claims correspondentes.

#### B-2. MediaMTX `all_others` sem authMethod por path
- **Severidade:** Crítico · **Domínio:** Pipeline de vídeo + isolamento
- **Onde:** `vsaas-backend/mediamtx.yml` — `paths: all_others:` (sem `publishUser`/`readUser`/JWT auth)
- **Risco real:** Stream paths são UUIDs (`cam-<uuid>`). Quem souber o UUID (ex: API response acidentalmente exposta, log, screenshot) consegue:
  - **Publish** falsos frames numa câmera de outro tenant (`rtsp://server/cam-<uuid>?mode=publish`)
  - **Read** stream live de outro tenant via WebRTC `/whep`
  - **Replay attack**: pubicar stream de gravação antiga, fingindo ser tempo real
- **Correção:** Configurar `authHTTPAddress` apontando pro backend `/internal/mediamtx-auth` que valida JWT ticket por path. Já existe ticket pra playback (`playback.service.ts:69`), estender pra live também (parcialmente em `live.service.ts:212`). Backend já tem essa lógica — basta MediaMTX consumir via hook.

#### B-3. Postgres sem Row-Level Security (RLS)
- **Severidade:** Crítico · **Domínio:** Isolamento multi-tenant
- **Onde:** `prisma/migrations/*.sql` — zero `CREATE POLICY` ou `ENABLE ROW LEVEL SECURITY`
- **Risco real:** Isolamento depende 100% de filtros Prisma na aplicação. **Foram comprovadas falhas reais nesta auditoria** (ver B-4 abaixo). Qualquer query nova que esqueça o filtro = vazamento. Backups e exports SQL diretos não têm proteção alguma. Um Prisma `findUnique({where:{id}})` sem `cameraTenantWhere` é IDOR garantido.
- **Correção (2 caminhos):**
  - **(a)** Implementar RLS pelo menos nas tabelas mais sensíveis: `Camera`, `RecordingSegment`, `FaceEvent`, `PlateEvent`, `EvidenceVault`, `ReviewItem`, `AuditLog`. Política: `current_setting('app.tenant_id')::uuid = integrador_id`. App injeta `SET LOCAL app.tenant_id = ...` no início da transação.
  - **(b)** Lint obrigatório no CI: AST rule que bloqueia `findUnique({where:{id}})` em rotas user-facing sem `cameraTenantWhere`/`requireCameraForUser` adjacente. Já existe `lint:capabilities` — adicionar segunda regra `lint:tenant-scope`.

#### B-4. `findUnique` sem tenant filter em rotas user-facing (IDOR comprovado)
- **Severidade:** Crítico · **Domínio:** Isolamento multi-tenant
- **Onde (validado nesta auditoria):**
  - `routes/custom-domains.ts:140` — `findUnique({where:{id}})` em verify endpoint
  - `routes/semantic-templates.ts:104` — `findUnique` em `/use` endpoint
  - Padrão repete em `leads.ts:575,590`, `alert-config.ts:208,216`, `retention.ts:519`
- **Risco real:** Mesmo com check posterior `if (resource.integradorId !== jwt.integradorId) throw`, há **vazamento de existência** (404 vs 403 = timing oracle). Pior: em `retention.ts:519` a comparação é `p.integradorId === cf.integradorId` — se ambos forem `null` (SUPER_ADMIN sem integradorId), o check passa silenciosamente.
- **Correção:** Substituir todo `findUnique({where:{id}})` por `findFirst({where:{id, ...cameraTenantWhere(jwt)}})` ou padrão equivalente. 5+ ocorrências confirmadas, possivelmente mais nas rotas não-auditadas.

#### B-5. GCP Service Account em path standard do repo
- **Severidade:** Crítico (mas mitigado) · **Domínio:** Segredos
- **Onde:** `vsaas-backend/gcp-service-account.json` — private_key completa do `vertex-express@gen-lang-client-0913190127`
- **Risco real:**
  - **Mitigado:** arquivo **NÃO está commitado** no git e **está ignorado** via `.gitignore` line 28 (`*-service-account.json`).
  - **Não mitigado:** está em path standard do repo onde qualquer dev/contractor que clonar o repo + criar zip da pasta NUNCA vai notar que existe. Risco humano alto.
  - Se backend container roda como root e algum exploit der RCE, atacante lê o arquivo direto.
- **Correção:**
  - Mover pra `/run/secrets/gcp_service_account` (Docker secret).
  - Adicionar `gcp-service-account.json` explicitamente ao `.gitignore` (sem depender do glob).
  - Adicionar `pre-commit hook` que rejeita JSON com `"type": "service_account"` em qualquer commit.
  - Considerar rotação da chave já — ela esteve em path inseguro.

#### B-6. Embeddings faciais sem TTL (LGPD Art. 11)
- **Severidade:** Crítico (jurídico) · **Domínio:** LGPD + dados sensíveis
- **Onde:** Tabela `FaceEmbedding` (Vertex multimodalembedding@001, 1408 dims) sem `expiresAt` ou job de purga
- **Risco real:** Biometria é categoria especial pelo Art. 11 LGPD — tratamento exige base legal explícita + retenção mínima necessária. Embeddings ficam indefinidamente, mesmo quando o cliente final deleta a câmera ou cancela o serviço. ANPD tem precedentes de multa pra retenção infinita.
- **Correção:**
  - TTL padrão de 90 dias para embeddings de pessoas não identificadas (`identityId IS NULL`).
  - Cascade delete: quando `Person` é deletada (LGPD erasure request), todos os embeddings vão junto. Hoje há soft-delete no `lgpd.service.ts:executeErasure()` que anonimiza `name` mas **não verifica se embeddings vão junto**.
  - Adicionar job cron `purge-stale-embeddings` rodando semanalmente.

---

### 🟠 ALTOS (fechar em ≤30 dias)

#### A-1. MediaMTX sem TLS — RTSP em texto claro
- **Onde:** `mediamtx.yml` sem `tls`/`cert` config.
- **Risco:** Atacante MITM (operador de ISP malicioso, Wi-Fi público da box edge) lê stream RTSP + credenciais da câmera em texto claro. RTSP_PULL com `rtspUsername+rtspPasswordEnc` cifrado no DB **mas trafegado em claro** entre cloud-direct-recorder e câmera.
- **Correção:** RTSPS (porta 8322 do MediaMTX) ou via TLS-wrapped path. Pra RTMP, RTMPS (porta 1936). Edge box já fala SRT (criptografado nativamente) — privilegiar SRT/EDGE_BOX em vez de RTSP_PULL.

#### A-2. Edge nodes — `integradorId` aceito do query SEM validar contra JWT
- **Onde:** `routes/edge-nodes.ts:94` — `req.query.integradorId` combinado com `tenantWhere` sem validar que `jwt.integradorId === req.query.integradorId`.
- **Risco:** INTEGRADOR_ADMIN do tenant A faz `GET /edge-nodes?integradorId=<uuid-B>` e (dependendo de `tenantWhere` ser permissivo se SUPER_ADMIN-style) lista boxes do tenant B.
- **Correção:** No início da rota: `if (req.query.integradorId && req.query.integradorId !== jwt.integradorId && jwt.role !== 'SUPER_ADMIN') throw ForbiddenError`.

#### A-3. Watermark export — fonte é DejaVu fixo, fácil de remover por OCR-aware adversary
- **Onde:** `routes/playback.ts:439` — watermark via ffmpeg drawtext.
- **Risco:** Watermark identifica solicitante (LGPD trail), mas pode ser removida por inpaint/blur tools modernos. Cliente que vazar evidência consegue dizer "não fui eu".
- **Correção:** Watermark difícil de remover: spread espacialmente, opacity variável, posição randomizada por frame, OU forensic watermark steganográfico (mais sério, custo de implementação alto).

#### A-4. `paths: all_others:` permite publish em path arbitrário no MediaMTX
- **Onde:** Mesmo arquivo do B-2, separado pela semântica: além de não autenticar, **aceita criar paths novos automaticamente**.
- **Risco:** Atacante publica em `cam-FAKE` e backend pode logar como "câmera nova chegou", confundindo operações.
- **Correção:** `paths: all_others:` deve ter `runOnReady` validando contra o backend antes de aceitar.

#### A-5. Capability gating em modo WARN em produção
- **Onde:** `CAPABILITY_GATING_MODE=warn` (notado em memory de sessões anteriores).
- **Risco:** Linter rejeita rotas sem capability, mas no runtime modo `warn` **só loga, não bloqueia**. Cliente que não comprou módulo `AI_SEMANTIC_SEARCH` pode chamar a rota e ela executa.
- **Correção:** Mudar pra `CAPABILITY_GATING_MODE=enforce` antes do go-live. Já existe a infra (`docs/33-ROLLOUT.md`).

#### A-6. Sem rate limit em endpoints de geração de presigned URL
- **Onde:** `routes/storage-config.ts /storage/preview` e `/storage/browse`.
- **Risco:** Usuário autenticado faz 10k presigned URLs/min e compartilha externamente. Egress R2 dispara, custo sobe, e URLs (TTL 1h) viram link público.
- **Correção:** `rateLimit({ windowMs: 60_000, max: 60 })` por user em rotas de presign.

#### A-7. Sem cleanup automático de orfãos R2 quando integradorId é null
- **Onde:** `services/recording.service.ts:694-708` — código comenta "operador investiga via /storage/health", mas não há job automático.
- **Risco:** Cliente cancela conta → DB limpa → R2 fica com vídeo indefinidamente. Violação direta LGPD direito de eliminação.
- **Correção:** Job mensal `sweep-orphan-r2-objects` que lista buckets `icv-*`, cruza com `Integrador` ativos, deleta objetos sem dono há >30 dias.

#### A-8. CORS / API surface
- **Onde:** verificação não realizada nesta auditoria (tempo).
- **Risco:** Se CORS permite `*` ou origem maliciosa, JWT em cookie é roubável via CSRF/XSS.
- **Correção:** Verificar `app.ts` para `cors()` config. Idealmente whitelist de origens explícita.
- **Status:** ⚠️ Requer verificação adicional.

#### A-9. YOLOv8 fallback AGPL ativo se Roboflow falhar
- **Onde:** `vsaas-ai-worker/yolov8_detector.py:5-6` — comentário reconhece risco.
- **Risco:** Se Roboflow (Apache 2.0) ficar down, sistema cai pra Ultralytics YOLOv8 (**AGPL-3.0**). Uso comercial closed-source de AGPL **exige licença paga** ou abertura de TODO o backend.
- **Correção:**
  - Curto prazo: alerta crítico (PagerDuty / WhatsApp) quando fallback for ativado, com instrução de **desligar** o tenant até Roboflow voltar.
  - Médio prazo: substituir fallback por modelo MIT/Apache (DETR, RT-DETR, YOLO-NAS standalone).

---

### 🟡 MÉDIOS (dívida técnica)

| # | Onde | Risco resumido |
|---|---|---|
| M-1 | Logos R2 com `CacheControl: 'public, max-age=86400'` (`r2.service.ts:500`) | Enumeração de tenants via padrão de keys |
| M-2 | Path parsing `key.split('/')[0]` sem normalize (`storage-config.ts:1295`) | Path traversal mitigado por bucket-per-integrador mas não hardened |
| M-3 | Audit log de acesso biométrico é por categoria (`source='FACE'`) | Não rastreia "qual rosto específico foi visto" — granularidade fraca pra LGPD |
| M-4 | Soft-delete LGPD não tem janela hard-delete | Anonimização mantém linha; backup 7d ainda recupera dado anônimo |
| M-5 | Senhas em DB usam bcrypt — não validei rounds | Verificar se ≥12 rounds |
| M-6 | Sem 2FA obrigatório por padrão | Sistema tem TOTP mas opt-in. SUPER_ADMIN deveria ser obrigatório |
| M-7 | Sem WAF na frente do Caddy | Mitigar SQL injection / scanner abuse |
| M-8 | `process.env.JWT_SECRET!` (non-null assert) | Se var ausente, runtime crash silencioso em vez de boot fail |
| M-9 | Sem health check estruturado pra readiness do mediamtx | Container "Running" mas mediamtx pode estar mortos por dentro |
| M-10 | Sem alertas em "acessos negados em massa" | Brute force ou enumeration passa despercebido |
| M-11 | `prisma/migrations` excluído do build Docker | Toda migration nova exige `docker cp` manual — operacional, não risco |

---

## 3. ITENS QUE EXIGEM VERIFICAÇÃO EXTERNA

Pontos onde **leitura de código não basta** — precisam runtime test, pentest ou parecer:

1. **Pentest de IDOR em produção** — Os 5+ findUnique sem tenant filter podem ter mais ocorrências em rotas não-cobertas pela auditoria. Sugiro pentest focado: cliente B tenta acessar/modificar todos os IDs visíveis no UI do cliente A.

2. **DPIA (Data Protection Impact Assessment) formal** — LGPD Art. 38 exige DPIA pra biometria. Parecer jurídico obrigatório antes de processar dado biométrico de terceiros (não-funcionários).

3. **Backup restore real** — Existe job de backup (`scripts/backup-postgres.sh`) mas **nunca foi testado restore**. SLA de RTO/RPO é estimativa, não fato. Marcar drill de restore obrigatório antes do go-live.

4. **PgBouncer config sob carga** — Não inspecionei `pool_mode`, `max_client_conn`, `default_pool_size`. Em transaction mode com Prisma, prepared statements podem quebrar (PostgreSQL session-level state). Carga real ≥100 cams gravando = potencial timeout em cascata.

5. **Authentik integration real** — Código tem `proxy-auth.ts` (Sprint E.1) mas é OPT-IN via `PROXY_AUTH_ENABLED=false` default. **Verifique no `.env` de produção qual está ativo**. Se o doc do projeto diz "Authentik como IdP" mas runtime usa JWT HS256 local, há discrepância arquitetural.

---

## 4. PLANO DE CORREÇÃO PRIORIZADO

Sequência sugerida pra atacar — **não pular ordem**:

### Sprint 0 — Pré go-live (2-3 semanas, ~80h)
1. **B-1** Whitelist algorithms em todos `jwt.verify` (2h) — defesa de algorithm confusion
2. **B-5** Mover GCP SA pra Docker secret + rotacionar key (3h) — segredo exposto
3. **B-4** `findUnique → findFirst` em todas as rotas user-facing (8h) — IDOR comprovado
4. **B-3** Lint AST `lint:tenant-scope` no CI (12h) — prevenir regressão
5. **A-5** `CAPABILITY_GATING_MODE=enforce` (2h, mas precisa smoke test) — bloquear bypass
6. **A-2** Validar `req.query.integradorId === jwt.integradorId` (3h) — vazamento INTEGRADOR↔INTEGRADOR
7. **B-2** MediaMTX `authHTTPAddress` apontando pra `/internal/mediamtx-auth` (16h) — streams autenticados
8. **B-6** TTL de 90d em FaceEmbedding + cascade delete LGPD erasure (8h) — LGPD Art. 11
9. **A-1** TLS em MediaMTX (RTSPS/RTMPS) ou forçar SRT EDGE_BOX (12h) — texto claro
10. **A-7** Job sweep R2 orphans (6h) — LGPD eliminação

### Sprint 1 — Pós go-live, primeiros 30 dias (~60h)
11. **A-6** Rate limit em `/storage/*` endpoints (3h)
12. **A-3** Watermark fortalecida (8h)
13. **A-9** Alerta crítico no fallback YOLOv8 + plano substituição (16h)
14. **B-3 (a)** RLS Postgres em tabelas críticas (24h, incremental)
15. **A-8** CORS audit + whitelist explícita (3h)
16. Backup restore drill mensal (organizacional)

### Sprint 2 — Trimestre 1 pós-lançamento (~80h)
17. Médios M-1 a M-11 conforme priorização do negócio
18. Pentest externo profissional (item externo §3.1)
19. DPIA formal com jurídico (item externo §3.2)

---

## 5. PONTOS POSITIVOS DA ARQUITETURA

Pra balancear — onde o sistema está acima da média:

- **Capability gating** sofisticado com 79 caps + linter strict (rara essa maturidade em SaaS pré-produção)
- **Audit log** completo com tenantScopeFilter — base sólida pra LGPD compliance
- **Login hardening**: rate limit (5/janela), lockout por failed attempts, MFA TOTP, password history
- **Helpers de tenant scope** (`requireCameraForUser`, `cameraTenantWhere`) — padrão correto onde aplicado
- **LGPD endpoints** implementados (consents, erasure, portability) — implementação inicial robusta
- **Sudo elevation** com TTL pra ações sensíveis (faces.ts, plates.ts)
- **EvidenceVault** com `reason` obrigatório (LGPD-aware design)
- **Compat layer** consciente pra edge box antiga (zero breakage)

---

## 6. VEREDITO FINAL

**Não vá pra produção comercial agora.** O sistema tem boa arquitetura mas 6 bloqueadores não-negociáveis somam pra **risco inaceitável de**:
- Vazamento cross-tenant de vídeo (B-2, B-3, B-4)
- Forge de token JWT (B-1)
- Multa ANPD por biometria sem TTL (B-6)
- Exposição de chave GCP em path padrão (B-5)

**Estimativa pra ficar pronto:** Sprint 0 = ~80h dev solo = **2-3 semanas se for o único foco**. Sprint 1 pode rolar com primeiros clientes piloto controlados (≤3 integradores selecionados), Sprint 2 com base comercial maior.

**Próximo passo imediato sugerido:** B-5 (GCP SA — 30min) + B-1 (JWT algorithms — 2h) hoje. São mudanças cirúrgicas, baixo risco, alto impacto.

---

*Auditoria conduzida por Claude Code com 3 agentes Explore paralelos + validação direta em 8 arquivos críticos. Cobertura estimada: 70% do código backend, 40% do ai-worker, 20% do frontend. Áreas não-cobertas que merecem segunda rodada: WebRTC signaling, edge-box token exchange, impersonação SUPER_ADMIN, MFA TOTP recovery flow, billing/financial endpoints.*
