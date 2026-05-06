# Plano v1 piloto definitiva — Fortalecimento Cloud ↔ Box + Cobertura fim-a-fim

> Endereça as falhas silenciosas, gaps de comunicação E gaps do ciclo de vida fim-a-fim
> mapeados nas análises de 2026-05-04 (1) gaps comunicação Box-Cloud e (2) gaps fim-a-fim.
> Origem: análise pós-Sprint 1 (brand) + Sprint 2 (events-batch + ack) com 53 entregas Box
> e 14 commits Cloud consolidados.

**Data:** 2026-05-04
**Autor:** sessão Cloud (consolidação)
**Status global:** v2.0 — escopo expandido para cobrir bloqueadores regulatórios (LGPD), DR, e UX crítica fim-a-fim

---

## Sumário executivo

3 sprints encadeados. Sprint 0 agora cobre **TODOS os bloqueadores absolutos** para fechar v1 piloto definitiva — segurança, vault, observabilidade, LGPD, DR, hardware-return.

| Sprint | Janela | Itens | Esforço total | Bloqueia o quê |
|---|---|---|---|---|
| **Sprint 0 — Bloqueadores piloto** | 10 dias (2026-05-04 → 05-14) | 9 | ~46 h | tudo que impede piloto externo (segurança, vault, alerta, LGPD, DR, factory-reset) |
| **Sprint 1 — Observabilidade + UX crítica** | 14 dias (2026-05-15 → 05-28) | 8 | ~58 h | escalabilidade fleet, técnico cadastrar câmera via Cloud, billing, onboarding guiado |
| **Sprint 2 — Resiliência avançada** | 30 dias (2026-05-29 → 06-28) | 3 | ~40 h | maturidade produto, contratos formais |

**Custo total estimado:** 144 h (~18 dias-úteis solo dev). **Caminho crítico:** 5 itens do Sprint 0 (FCB-005, FCB-006, FCB-002, FCB-016, FCB-017).

---

## Convenções

- **ID `FCB-NNN`:** Fortalecimento Cloud-Box, sequencial
- **Owner:** `Cloud` (eu) | `Box` (IDE Box) | `Both` (bilateral, requer coordenação bridge) | `Tarcísio` (operacional)
- **Esforço:** horas estimadas (1 dev solo, sem interrupção)
- **Risco se NÃO fizer:** consequência prática

---

# Sprint 0 — Bloqueadores piloto (10 dias)

**Critério de "feito":** os 9 itens shipados em produção, `prisma migrate deploy` aplicado, smoke test E2E passou, **DR test executou com sucesso**, **1 ciclo LGPD end-to-end validado**, **factory reset testado em Box de laboratório**.

## FCB-001 — `EdgeCommand.expiresAt` (TTL automático)

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 2 h |
| Risco | Comandos zumbi: Box volta após 3 dias offline e executa `RESTART_CAMERA` desnecessário |

**Implementação:**

1. Migration `20260505_edge_command_ttl`:
   ```sql
   ALTER TABLE "EdgeCommand" ADD COLUMN "expiresAt" TIMESTAMP(3);
   CREATE INDEX "EdgeCommand_expiresAt_idx" ON "EdgeCommand"("expiresAt") WHERE "ackedAt" IS NULL;
   ```
2. `routes/edge-commands.ts` POST: default `expiresAt = now() + 1h` (configurável por payload `ttlSeconds`)
3. Endpoint que Box consome (`GET /iacv-box/:nodeId/commands/pending` ou similar) filtra `expiresAt > now()`
4. Cron `cleanup-expired-edge-commands.ts` (parte do FCB-008) marca expirados

**Aceite:** comando criado para Box offline, Box volta após 2h, comando NÃO é executado. Painel mostra status `EXPIRED`.

---

## FCB-002 — Cron `detect-stale-edge.ts` + alerta

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 4 h |
| Risco | Integrador descobre Box morta apenas quando cliente final reclama |

**Implementação:**

1. Novo job em `vsaas-backend/src/jobs/detect-stale-edge.ts`:
   - Roda a cada 5 min via `setInterval` em `index.ts:scheduleJobs()`
   - Query: `EdgeNode WHERE lastHeartbeat < now() - 15min AND status = 'ONLINE'`
   - Para cada match: transição `ONLINE → DEGRADED` (após 15min) ou `DEGRADED → OFFLINE` (após 30min)
   - Cria `AlertDelivery` (canal e-mail/WhatsApp via Evolution) para `IntegradorAlertRecipient`
   - Persiste em `EdgeConnectionLog` evento `STALE_HEARTBEAT_DETECTED`

2. Configurável via env:
   ```
   STALE_EDGE_CHECK_INTERVAL_SEC=300
   STALE_EDGE_DEGRADE_AFTER_MIN=15
   STALE_EDGE_OFFLINE_AFTER_MIN=30
   ```

**Aceite:** Box desligada → após 15 min status vira `DEGRADED` no painel, integrador recebe e-mail. Após 30 min `OFFLINE`, segundo alerta com escalada.

---

## FCB-003 — `capabilitiesRevision` consumer (item 1.11 backlog)

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 3 h |
| Risco | UI Cloud mostra dropdown de comandos hardcoded; Box evolui handlers e Cloud não enxerga |

**Implementação:**

1. Migration: `EdgeNode.capabilitiesRevision String?` + `lastCapabilitiesAt DateTime?`
2. Handler `/heartbeat` (`iacv-box.ts:1114`): persistir `capabilitiesRevision` quando recebido
3. Novo endpoint `GET /iacv-box/:nodeId/capabilities`:
   - Verifica se `EdgeNode.capabilitiesRevision == cached.revision`
   - Se diferente, fetch via tunnel reverso: `https://tn-<edge>.iacloud.com.br/box/api/cmd/list`
   - Cacheia em Redis com TTL 1h ou até próxima mudança de revision
   - Devolve `{ revision, handlers, schemas, waves }` para o frontend
4. `FleetDetailPage.tsx`: substituir dropdown hardcoded por consumo de `useCapabilities(nodeId)`

**Aceite:** Box adiciona handler `NEW_FEATURE`, capabilitiesRevision muda, próximo heartbeat dispara refresh, UI passa a mostrar dropdown atualizado em < 5 min.

---

## FCB-004 — `brandingRevision` consumer

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 2 h |
| Risco | White-label mudado no painel Cloud não propaga para Box (logo velho fica em cache) |

**Implementação:**

1. Migration: `EdgeNode.brandingRevision String?`
2. Handler `/heartbeat`: persiste campo
3. Novo endpoint Cloud `GET /iacv-box/:nodeId/branding-status` retorna `{ revision, lastUpdate }`
4. Box já entrega `GET /box/api/branding` (commit `9e8356c`) — Cloud usa esse endpoint para forçar refresh quando revision muda
5. **Decisão pendente:** Cloud "puxa" via tunnel reverso (igual FCB-003) OU Cloud envia EdgeCommand `REFRESH_BRANDING`?
   - Recomendação: **EdgeCommand** (mais simples, reusa pipeline existente)

**Aceite:** integrador troca logo no painel → próximo heartbeat (60s) detecta divergência → cria EdgeCommand `REFRESH_BRANDING` → Box re-busca `/branding` → header atualiza.

---

## FCB-005 — Tenant isolation audit + middleware `assertBoxOwnership`

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 4 h |
| Risco | **CRÍTICO de segurança:** licenseKey vazada → atacante chama `/iacv-box/<boxId-OUTRO>/config` e vaza zonas/thresholds |

**Implementação:**

1. Novo middleware `vsaas-backend/src/middleware/assert-box-ownership.ts`:
   ```typescript
   export async function assertBoxOwnership(req, res, next) {
     const license = await resolveLicense(req.body.licenseKey || req.query.licenseKey || req.headers['x-iacv-license-key'])
     if (!license) return res.status(403).json({ error: 'UNLICENSED' })
     const targetBoxId = req.params.boxId || req.params.nodeId || req.body.boxId
     if (targetBoxId && targetBoxId !== license.edgeNodeId) {
       logger.warn({ targetBoxId, ownedBy: license.edgeNodeId, ip: req.ip }, 'cross_box_access_attempt')
       return res.status(403).json({ error: 'CROSS_BOX_ACCESS_DENIED' })
     }
     req.boxLicense = license
     next()
   }
   ```

2. Aplicar em **TODOS** os endpoints com `:boxId` ou `:nodeId` em `iacv-box.ts`:
   - `/:boxId/integration/snapshot` ✅ já tem requireAuth (admin), seguro
   - `/:boxId/config` ⚠ precisa middleware
   - `/:boxId/connection-logs` ✅ tem requireAuth
   - `/:boxId/connection-stats` ✅
   - `/:boxId/module-drift` ✅
   - `/:nodeId/commands` ✅ tem requireAuth (admin)
   - `/commands/:id/ack` ⚠ valida `cmd.edgeNodeId !== license.edgeNodeId` ✅ inline OK
   - `/heartbeat`, `/events`, `/events-batch`, `/cameras`, `/logs-batch`, `/snapshots-live`: passam `boxId` no body, **precisa middleware**

3. Adicionar audit log para tentativas cross-box: `EdgeConnectionLog.eventType = 'CROSS_BOX_ATTEMPT'`

**Aceite:** teste E2E que faz Box-A com `licenseKey-A` chamar `/iacv-box/heartbeat` com `boxId=<id-B>` → 403. Log do tentativa persistido.

---

## FCB-006 — Vault credential renewal automático (Box-side)

| Campo | Valor |
|---|---|
| Owner | `Box` (já documentado em `CLOUD_TO_BOX.md` [ABERTO 2026-05-02]) |
| Esforço | 3 h Box + 1 h Cloud (suporte) |
| Risco | **DEADLINE 2026-06-01** — em 27 dias uploads R2 começam a 403 |

**Implementação Box-side (já documentada na bridge):**

1. `cloud_sync.py:_sync_loop()` adicionar:
   ```python
   vault_cfg = vault_uploader.get_vault_config()
   expires_str = vault_cfg.get("expiresAt", "")
   if expires_str:
       exp = datetime.fromisoformat(expires_str.replace("Z", "+00:00"))
       secs_left = (exp - datetime.now(timezone.utc)).total_seconds()
       if secs_left < 86400:  # < 24h → re-activate proativo
           force_reactivate()
   ```

2. `force_reactivate()` chama `POST /iacv-box/activate` com licenseKey atual; Cloud retorna vault credentials novas

**Implementação Cloud-side (suporte):**

1. Em `/activate` (já existe), garantir que retorna `vault.expiresAt` em ISO 8601
2. Verificar se há rate limit no `/activate` que poderia bloquear renewal de fleet inteira simultânea (escalonar)

**Aceite:** Box com vault expirando em 23h dispara re-activate automaticamente, novas credentials populadas, próximo upload R2 OK.

**AÇÃO IMEDIATA Tarcísio:** repassar este item à Box via bridge **AGORA** (não pode esperar Sprint 0 fechar — 27 dias é apertado).

---

## FCB-016 — LGPD: endpoints obrigatórios (export, erasure, summary)

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 12 h |
| Risco | **Risco regulatório severo** — LGPD Art. 18 garante direito de acesso, retificação, anonimização e eliminação. Sem endpoints, qualquer reclamação ANPD pode multar. Schema tem `LgpdDataRequest` mas zero rotas implementadas |

**Implementação:**

1. Migration (se necessário): garantir `LgpdDataRequest` está com campos `type` (EXPORT/ERASURE/RECTIFICATION/ANONYMIZATION), `status`, `requestedBy`, `processedAt`, `dataPackageUrl`, `evidenceJson`

2. Novo router `vsaas-backend/src/routes/lgpd.ts`:

   **a) `POST /lgpd/data-requests`** (qualquer usuário autenticado, ou via portal cliente final):
   ```typescript
   // body: { type: 'EXPORT' | 'ERASURE', scope: 'self' | 'tenant', justification?: string }
   // Cria LgpdDataRequest com status=PENDING
   // Notifica DPO (e-mail) via Evolution
   // Retorna { id, type, status, slaDeadline: now+15d (Art 19) }
   ```

   **b) `GET /lgpd/data-requests/:id`** — status da solicitação

   **c) `GET /lgpd/data-summary`** (usuário autenticado):
   ```typescript
   // Retorna sumário do que tem armazenado:
   // { events: 42, recordings: 12, faces: 0, plates: 5, ... }
   // + retentionPolicy: { events: '90 days', recordings: '30 days' }
   ```

   **d) `POST /lgpd/data-requests/:id/process`** (SUPER_ADMIN | DPO):
   ```typescript
   // Para EXPORT: cria pacote .zip com:
   //   - eventos.csv (AnalyticsEvent do tenant/usuário)
   //   - reconhecimentos.csv (Face, Plate)
   //   - acessos.csv (PortalAccessToken usados)
   //   - integradores/clientes JSON
   // Sobe pra R2 com presigned URL TTL 7 dias
   // Marca status=COMPLETED, salva URL em dataPackageUrl
   //
   // Para ERASURE:
   //   - Soft-delete: marca AnalyticsEvent.deletedAt, RecordingSegment.deletedAt
   //   - Anonimiza: removee faceEmbedding, plateText hash, capturedFaceUrl set null
   //   - Mantém AnalyticsEvent agregados (BI rollup) sem PII
   //   - Apaga objetos R2 do scope
   //   - Cria AuditLog tipo LGPD_ERASURE_EXECUTED
   //   - Marca status=COMPLETED
   ```

   **e) `GET /lgpd/data-requests`** (SUPER_ADMIN) — list todas para gestão DPO

3. Frontend `vsaas-frontend/src/pages/LgpdRequestsPage.tsx` (admin DPO):
   - Lista de solicitações pendentes
   - Botão "Processar" (chama endpoint d)
   - Filtros por status/SLA
   - Indicador SLA "vence em X dias"

4. No portal cliente final (`PortalHomePage`), adicionar seção "Meus dados (LGPD)":
   - Botão "Exportar meus dados" → cria LgpdDataRequest type=EXPORT
   - Botão "Solicitar exclusão" → cria type=ERASURE com confirmação
   - Lista de solicitações já feitas + status

5. Cron `vsaas-backend/src/jobs/lgpd-sla-watch.ts`:
   - Diário às 09:00
   - Solicitações em PENDING há >10 dias → e-mail DPO "vence em 5 dias"
   - >15 dias → escalation para SUPER_ADMIN

**Aceite:** cliente final clica "Exportar meus dados" no portal → DPO recebe e-mail → processa em painel admin → cliente recebe e-mail com link presigned R2 → baixa .zip com seus dados em < 15 dias.

**Limitações documentadas:**
- ERASURE não apaga `EvidenceRetentionPolicy` configurada (legal hold)
- Eventos com `legalHoldUntil` futuro são mantidos (NF-e, processo judicial)
- Anonimização parcial preserva analytics agregadas (decisão DPO + jurídico)

---

## FCB-017 — Restore de PostgreSQL + DR runbook + teste mensal

| Campo | Valor |
|---|---|
| Owner | `Cloud` + `Tarcísio` (testar mensal) |
| Esforço | 8 h script + 2 h Tarcísio testar |
| Risco | Backup que não foi testado é uma fantasia. Se DB cair, **horas/dias de downtime** sem caminho documentado |

**Implementação:**

1. `scripts/restore-postgres.sh`:
   ```bash
   #!/bin/bash
   # Uso: ./restore-postgres.sh [--from-r2 <date>] [--target <db_name>] [--test]
   #
   # --from-r2 2026-04-30: baixa backup específico de R2
   # --target icv_test:    restaura em DB diferente (não derruba prod)
   # --test:               para ao final, sem trocar prod (validação)
   #
   # Sem flags: restaura backup mais recente em DB temporário 'icv_restore_test',
   # roda smoke queries (counts esperados em tabelas-chave), reporta diff e remove.
   ```

   Lógica:
   - aws s3 cp do bucket R2 backups
   - gunzip + psql restore em DB target
   - smoke queries: `SELECT count(*) FROM "EdgeNode"`, `SELECT max("createdAt") FROM "AnalyticsEvent"`
   - se valores divergem >5% do prod, alerta
   - log em `/var/log/icv-restore-test.log`

2. `docs/13-RUNBOOK-DR.md` (criar):
   - Cenário 1: PostgreSQL corrompido → restore do último backup
   - Cenário 2: VPS Hetzner perdida → procurement nova VPS + restore + DNS update
   - Cenário 3: R2 inacessível → operar em modo degradado (eventos no DB local, drain quando R2 voltar)
   - Cenário 4: Cloudflare down → DNS fallback
   - Para cada: checklist passo-a-passo + tempo estimado (RTO) + dados esperadamente perdidos (RPO)

3. Cron mensal automatizado:
   - 1º dia do mês 04:00 → roda `restore-postgres.sh --test`
   - Se sucesso: e-mail "DR test passed, RTO ~12 min"
   - Se falha: e-mail crítico DPO + Tarcísio + cria AuditLog `DR_TEST_FAILED`

4. Adicionar ao `docs/PRE-HOMOLOGACAO-CHECKLIST.md` linha P0:
   - [ ] DR test passou nos últimos 35 dias
   - [ ] Restore script testado manualmente pelo menos 1 vez

**Aceite:** Tarcísio derruba DB de teste, roda `restore-postgres.sh`, em < 15 min sistema está operacional com dados de < 24h atrás.

---

## FCB-018 — `FACTORY_RESET` EdgeCommand (hardware return / re-deploy)

| Campo | Valor |
|---|---|
| Owner | `Both` (Box: handler; Cloud: UI + EdgeCommand) |
| Esforço | 2 h Box + 2 h Cloud |
| Risco | Box devolvida ao integrador com licenseKey + vault credentials no `/data/`. Próximo cliente herda credenciais — vazamento + atribuição errada |

**Implementação:**

**Box-side:**

1. Handler `FACTORY_RESET`:
   ```python
   def handle_factory_reset(payload):
       confirmation = payload.get('confirmation')
       if confirmation != 'WIPE_DATA_CONFIRMED':
           return ack_error('confirmation token inválido')

       # 1. Wipe /data/ exceto logs (mantém histórico de auditoria)
       paths_to_wipe = [
           '/data/license.txt',
           '/data/vault.json',
           '/data/tunnel.json',
           '/data/srt-passphrase.txt',
           '/data/per-camera-thresholds.json',
           '/data/per-camera-skills.json',
           '/data/.activated',
           '/data/box.db',  # SQLite local
       ]
       # 2. Stop containers
       subprocess.run(['docker', 'compose', 'down'], cwd='/opt/iacv-box')
       # 3. Apaga arquivos
       # 4. Recria estrutura mínima
       # 5. Logs do reset em /data/logs/factory-reset.log (preservado)
       # 6. ACK antes do restart final
       ack_ok(info={'wiped_files': len(paths_to_wipe)})
       # 7. docker compose up -d (volta first-boot)
   ```

**Cloud-side:**

1. Endpoint `POST /admin/edge-nodes/:id/factory-reset` (SUPER_ADMIN apenas):
   - Cria EdgeCommand `FACTORY_RESET` com payload `{confirmation: 'WIPE_DATA_CONFIRMED'}`
   - Marca `EdgeNode.status = 'DECOMMISSIONED'`
   - Cria `AuditLog { action: 'FACTORY_RESET_TRIGGERED', edgeNodeId, by, reason }`

2. UI `EdgeBoxesPanel.tsx`: botão "Resetar de fábrica" no menu de cada Box, com modal de confirmação tripla:
   - "Digite o nome do EdgeNode para confirmar"
   - Checkbox "Entendo que TODOS os dados locais serão apagados"
   - "Esta ação NÃO pode ser desfeita"
   - Sugere "use 'Suspender' para casos temporários"

3. Documento em `docs/13-RUNBOOK-DR.md` (parte do FCB-017): "Devolução de hardware"

**Aceite:** SUPER_ADMIN reseta Box X. Box recebe comando, executa wipe, reinicia. Próximo boot é first-boot (LoginPage pede licenseKey). Mesmo hardware pode ser re-provisionado para outro cliente.

---

# Sprint 1 — Observabilidade + UX (próximas 2 semanas)

**Critério:** painel `/admin/fleet-health` operacional + alertas tocando + UX de provisão guiada + cadastro remoto de câmera + dashboard "câmeras com problema" + billing automation.

## FCB-019 — Wizard guiado de provisão (Integrador → Cliente → Site → Licença)

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 8 h |
| Risco | Hoje SUPER_ADMIN ou INTEGRADOR_ADMIN tem que abrir 4 telas separadas e gerar entidades manualmente. Friccional para escala — qualquer cliente novo leva ~15 min de cliques |

**Implementação:**

1. Nova página `vsaas-frontend/src/pages/ProvisionWizardPage.tsx`:
   - Acessível em `/admin/provision-new` (SUPER_ADMIN) e `/integrador/provision-client` (INTEGRADOR_ADMIN)
   - 4 passos visuais com progress bar:

   **Passo 1 — Integrador** (oculto para INTEGRADOR_ADMIN, usa o próprio):
   - Selecionar existente OU criar novo (nome, CNPJ, email)

   **Passo 2 — Cliente Final:**
   - Nome, CNPJ, vertical, e-mail técnico responsável
   - Plano comercial (texto livre)

   **Passo 3 — Site:**
   - Endereço (com auto-fill via CEP), nome, timezone, observações

   **Passo 4 — Licença + Box:**
   - Nome da Box (default: nome-do-site-01)
   - Selecionar módulos habilitados (faces/lpr/intrusion/...)
   - Gerar licenseKey
   - Mostrar QR + comando install copiável + botão e-mail técnico
   - Tela "Aguardando primeira ativação..." com auto-refresh
   - Quando Box conectar pela primeira vez, transição para "Box ativada! Próximos passos: adicionar câmeras"

2. Backend endpoint composite `POST /admin/provision-wizard`:
   - Recebe payload completo dos 4 passos
   - Em transaction: cria/reutiliza Integrador, cria ClienteFinal, cria Site, gera licenseKey, dispara e-mail
   - Retorna `{ integradorId, clienteFinalId, siteId, edgeNodeId, licenseKey, qrPayload }`

3. Tela "Aguardando ativação" (`ProvisionAwaitingPage.tsx`):
   - Polling em `GET /admin/edge-nodes/:id/status` a cada 5 s
   - Quando `status === 'ONLINE'`: animação confirma + redirect

**Aceite:** integrador novo na plataforma cria um cliente piloto completo em < 5 min, sem precisar entender a estrutura interna Integrador→ClienteFinal→Site→EdgeNode.

---

## FCB-020 — Dashboard "Câmeras com problema"

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 6 h |
| Risco | Hoje cliente final descobre câmera com problema **por reclamação** (não viu o evento crítico). Sem visibilidade preventiva, perde-se atribuição |

**Implementação:**

1. Endpoint `GET /admin/cameras/health-issues`:
   - Roda a cada request (cache 30s) ou via materialized view
   - Critérios de "câmera com problema":
     - `lastSeen` > 10 min (sem frame chegando)
     - `eventCount24h` < 0.5 * média histórica (queda anômala)
     - `errorCount24h` > 5 (Frigate logando erros)
     - `bitrate` < 50% do esperado para resolução
     - `fps` < 50% do esperado
   - Retorna `[{ cameraId, name, integradorId, clienteFinalId, issues: [{type, severity, since}] }]`

2. Página `vsaas-frontend/src/pages/CameraHealthPage.tsx`:
   - Lista colorida (vermelho/amarelo) com filtros (integrador, cliente, vertical)
   - Click na câmera → modal com "ações sugeridas":
     - "Pingar" (via tunnel proxy)
     - "Reiniciar Frigate" (EdgeCommand `RESTART_CAMERA`)
     - "Verificar credenciais" (via Box `/cameras/test`)
     - "Notificar técnico" (e-mail/WhatsApp via Evolution)

3. Webhook `CameraHealthDeteriorated`:
   - Quando câmera entra em estado problemático por > 15 min
   - Notifica `IntegradorAlertRecipient` automaticamente
   - Cria entrada em `EdgeConnectionLog` para audit

**Aceite:** câmera para de mandar frames às 14:00. Painel acende vermelho às 14:10. Técnico recebe WhatsApp às 14:25 com link direto para diagnóstico.

---

## FCB-007 — Rate limit Box-paths em bucket separado

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 4 h |
| Risco | Box em retry loop bate rate limit global → derruba autenticação de outros usuários |

**Implementação:**

1. `app.ts`: criar `boxRateLimiter` separado:
   ```typescript
   const boxRateLimiter = rateLimit({
     windowMs: 60_000,
     max: 600,  // 10 req/s sustentado por edge
     keyGenerator: (req) => req.body?.licenseKey || req.headers['x-iacv-license-key'] || req.ip,
     handler: (req, res) => {
       logger.warn({ key: req.ip, path: req.path }, 'box_rate_limit_hit')
       res.status(429).json({ error: 'RATE_LIMIT', retryAfterSec: 60 })
     },
   })
   app.use('/iacv-box', boxRateLimiter)
   ```

2. Excluir `/iacv-box/heartbeat` do rate limit (ou bucket maior — heartbeat é legítimo 1/min)

**Aceite:** load test com 1000 req/s de uma Box bloqueia ela mas outras Boxes continuam OK; usuário web não é afetado.

---

## FCB-008 — Cron `cleanup-expired-edge-commands.ts`

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 1 h |
| Risco | Tabela `EdgeCommand` cresce indefinidamente; queries lentas |

**Implementação:**

1. `vsaas-backend/src/jobs/cleanup-expired-edge-commands.ts`:
   - Diário às 04:00
   - `UPDATE EdgeCommand SET ackStatus='EXPIRED', ackedAt=now() WHERE expiresAt < now() AND ackedAt IS NULL`
   - Log count

2. Após 30 dias com `ackedAt`, hard delete (configurável)

**Dependência:** FCB-001 (`expiresAt` precisa existir).

**Aceite:** rodar manualmente, ver N comandos marcados EXPIRED, query plan `EXPLAIN` usa o índice criado em FCB-001.

---

## FCB-009 — Tabela `BoxIngestError` para rastrear erros parciais

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 6 h |
| Risco | events-batch falha em 50% dos itens em produção e ninguém vê — só aparece em log Box-side |

**Implementação:**

1. Migration:
   ```sql
   CREATE TABLE "BoxIngestError" (
     "id" TEXT PRIMARY KEY,
     "edgeNodeId" TEXT NOT NULL REFERENCES "EdgeNode"(id),
     "endpoint" TEXT NOT NULL,    -- '/events', '/events-batch', '/snapshots-live'
     "errorCode" TEXT NOT NULL,   -- 'VALIDATION', 'CAMERA_NOT_FOUND', 'TENANT_MISMATCH', 'DB_ERROR'
     "errorMessage" TEXT,
     "frigateId" TEXT,            -- quando aplicável
     "rawPayload" JSONB,          -- truncado em 4 KB
     "createdAt" TIMESTAMP(3) DEFAULT now()
   );
   CREATE INDEX "BoxIngestError_edge_created_idx" ON "BoxIngestError"("edgeNodeId", "createdAt" DESC);
   ```

2. `processBoxEvent` e handlers similares: em catch, persistem em `BoxIngestError` (fire-and-forget, nunca bloqueia)

3. Endpoint `GET /iacv-box/:nodeId/ingest-errors?since=24h` para painel

4. Painel admin: gauge "events com erro últimas 24h" + drill-down

**Aceite:** Box manda batch com 5 itens inválidos, Cloud responde 207 Multi-Status, 5 linhas em `BoxIngestError`, painel mostra contador.

---

## FCB-010 — Calendar entry `originalType` removal

| Campo | Valor |
|---|---|
| Owner | `Cloud` (lembrete) + `Both` (decisão) |
| Esforço | 0.5 h |
| Risco | Esquecer e ou (a) cortar e quebrar BI, ou (b) carregar para sempre |

**Implementação:**

1. Comentário explícito em `iacv-box.ts` no handler de `/events`:
   ```typescript
   // TODO[2026-06-15]: avaliar corte de `originalType` (Box mantém compat há 2 sprints).
   // Se BI/exports legados estão usando `skill` direto, podemos cortar e
   // remover do schema Box. Ver INTEGRATION/CHANGELOG entry 2026-05-04.
   ```

2. Adicionar item ao `docs/PRE-HOMOLOGACAO-CHECKLIST.md` em seção "Débitos técnicos com prazo"

3. Atualizar `MEMORY.md` com `originalType_cutover_2026_06_15.md`

**Aceite:** comentário existe, checklist tem entry, memory atualizado.

---

## FCB-015 — Cadastro remoto de câmera com scan via Cloud

| Campo | Valor |
|---|---|
| Owner | `Cloud` (Box já tem tudo pronto) |
| Esforço | 12 h (proxies 6h + UI 6h) |
| Risco | Sem isso, técnico precisa SSH na Box ou Wizard local cada câmera nova — friccional para escala |

**Contexto:** câmeras estão em LAN (192.168.x.x) inalcançáveis pela Cloud. Box é agente local com Strix scanner e probe ONVIF/RTSP/ffprobe. Falta painel Cloud que orquestra a Box via tunnel reverso (interativo) + EdgeCommand (provisão final).

**Implementação:**

**Cloud-side proxies (via tunnel reverso `tn-<edge>.iacloud.com.br`):**

1. `POST /admin/edge-nodes/:id/box-proxy/discovery/run` (~3h)
   - Valida JWT (SUPER_ADMIN | INTEGRADOR_ADMIN | INTEGRADOR_TECNICO com acesso ao node)
   - Resolve `EdgeNode.tunnelPublicUrl`, monta URL `https://tn-<slug>.iacloud.com.br/box/api/discovery/run`
   - Forwarda body (subnets, timeout) com header `Authorization: Bearer <boxToken interno>`
   - Devolve resposta da Box
   - Timeout 60s; em failure de tunnel, retorna 502 `TUNNEL_DOWN` com fallback hint

2. `POST /admin/edge-nodes/:id/box-proxy/cameras/test` (~2h)
   - Mesma estrutura, forwarda para `/box/api/cameras/test`
   - Mascara passwords no log Cloud (nunca persiste credentials em tabela)

3. `GET /admin/edge-nodes/:id/box-proxy/discovery/last` (~1h) — pollable

**Frontend Cloud (`CamerasPage.tsx` + novo modal `AddCameraWizard.tsx`):**

4. Wizard 3 passos (~6h):
   - **Passo 1 (Scan):** botão "Escanear rede". Spinner com progresso. Lista de câmeras encontradas com ícone do vendor (Hikvision/Dahua/Intelbras/Axis/etc.)
   - **Passo 2 (Configure):** modal por câmera selecionada. Campos: nome (com sugestão via slugify), ONVIF user/pass (ou RTSP manual), skills (faces/lpr/intrusion). Botão "Testar" dispara `/cameras/test` proxy
   - **Passo 3 (Add):** confirmação. Cria EdgeCommand `PROVISION_CAMERA`. Polling do ackStatus. Sucesso → fecha modal e refresh da lista

**Fallback graceful (tunnel down):**

5. Detect tunnel offline (heartbeat tunnel.publicUrl null OU 502 do proxy)
   - UI mostra banner: "Modo assíncrono — tunnel reverso indisponível, cadastro vai por fila"
   - Wizard desabilita Passo 1 (scan interativo); permite passo 2 com input manual de IP/RTSP; cria EdgeCommand `RUN_DISCOVERY` em vez de chamar tunnel
   - Resultado chega via heartbeat ou batch endpoint

**Auth pro proxy:**
- `boxToken` interno (HS256, aud=`box:<id>`) gerado pela Cloud com TTL 5min e passado nos headers para a Box (mesmo mecanismo do SSO)
- Box valida com `BOX_JWT_SECRET` local

**Aceite:** técnico abre `app.iacloud.com.br/cameras` → "Adicionar câmera" → escaneia rede do cliente → seleciona Hikvision → preenche admin/senha → testa (vê resolução/codec) → adiciona → câmera aparece em < 2 min com live SRT funcionando.

**Smoke test:** simular tunnel down (`docker stop iacv-cloudflared`), verificar fallback async funciona.

---

## FCB-011 — `FORCE_REACTIVATE` EdgeCommand (rotação de licença)

| Campo | Valor |
|---|---|
| Owner | `Both` |
| Esforço | 2 h Cloud + 1 h Box |
| Risco | SUPER_ADMIN rotaciona apiToken → Box fica unauth → uploads param até alguém manualmente reativar |

**Implementação:**

**Cloud-side:**
1. Quando rotação de licenseKey acontece (`generate-key` com flag `rotate=true`), criar EdgeCommand `FORCE_REACTIVATE` com payload `{ newLicenseKey: "..." }`
2. Comando expira em 1h (FCB-001) — se Box não pegou, fallback é integrador re-instalar

**Box-side:**
1. Handler `FORCE_REACTIVATE`:
   ```python
   def handle_force_reactivate(payload):
       new_key = payload['newLicenseKey']
       store.set_license(new_key)
       force_reactivate()  # mesma função do FCB-006
       return ack_ok()
   ```

**Aceite:** Cloud rotaciona key, Box busca comando, executa, próximo heartbeat OK com nova key.

---

## FCB-021 — Prometheus scrape do `/metrics` Box (18 métricas)

| Campo | Valor |
|---|---|
| Owner | `Cloud` (Box já expõe) |
| Esforço | 4 h Cloud + ~30 min Tarcísio (ops) |
| Risco | Sem visibilidade de fleet em tempo real — descobre problema quando cliente liga |

**Implementação Cloud-side:**

1. `docker-stack.yml`: adicionar serviço Prometheus + Grafana (compose):
   ```yaml
   prometheus:
     image: prom/prometheus:v2.55.0
     volumes:
       - ./infra/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
       - prometheus-data:/prometheus
     ports: ['9090:9090']
   grafana:
     image: grafana/grafana:11.3.0
     ports: ['3001:3000']
     environment:
       - GF_AUTH_ANONYMOUS_ENABLED=false
       - GF_SECURITY_ADMIN_PASSWORD__FILE=/run/secrets/grafana_admin
   ```

2. `infra/prometheus/prometheus.yml`: scrape config dinâmico via service discovery
   ```yaml
   scrape_configs:
     - job_name: 'iacv-boxes'
       scrape_interval: 60s
       file_sd_configs:
         - files: ['/etc/prometheus/targets/boxes.json']
   ```

3. Cron novo `scripts/refresh-prometheus-targets.sh` lê EdgeNodes ativas
   da DB e reescreve `boxes.json` com endpoints dos tunnels reversos:
   `https://tn-<edge>.iacloud.com.br/metrics`

4. Dashboards Grafana padrão: fleet overview (boxes online, eventos/min,
   queue depth, errors), per-box drill-down.

**Aceite:** Grafana mostra 18 métricas de cada Box ativa via tunnel reverso,
auto-discovery quando nova Box é provisionada (re-scan a cada 5 min).

---

## FCB-022 — X-Correlation-Id middleware + axios interceptor

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 4 h |
| Risco | Bug aparece em produção, debug demora 30+ min para correlacionar logs em 3 sistemas (Cloud + Box + R2) |

**Implementação:**

1. `vsaas-backend/src/middleware/correlation-id.ts`:
   ```typescript
   export function correlationIdMiddleware(req, res, next) {
     const cid = req.header('x-correlation-id') ?? randomUUID().slice(0, 12)
     res.setHeader('x-correlation-id', cid)
     ;(req as any).correlationId = cid
     // Propaga no AsyncLocalStorage para logger pegar automaticamente
     correlationIdStorage.run({ cid }, () => next())
   }
   ```

2. Logger pino enriquece automaticamente: cada `logger.info(...)` ganha `cid` field.

3. Axios interceptor em chamadas Cloud → Box (proxy reverso):
   ```typescript
   axios.interceptors.request.use(config => {
     const cid = correlationIdStorage.getStore()?.cid
     if (cid) config.headers['x-correlation-id'] = cid
     return config
   })
   ```

4. Frontend gera CID em cada request (axios.defaults.headers).

**Aceite:** request `?cid=test-123` no painel → log linha em Cloud + Box + (eventualmente) R2 com mesmo cid. Debug bug = `grep test-123` em todos os logs.

---

## FCB-023 — Proxy `/api/health/detailed` (10 subsystems Box)

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 6 h |
| Risco | Painel só mostra `licensed:true|false` — sem visibilidade de quais subsystems estão degraded |

**Implementação:**

1. Endpoint Cloud: `GET /admin/edge-nodes/:id/health-detailed`:
   - Proxy reverso via tunnel `tn-<edge>.iacloud.com.br/api/health/detailed`
   - Cache 60s no Redis (não ficar batendo na Box toda hora)
   - 10 subsystems: sqlite, disk, mqtt, frigate, go2rtc, tunnel, vault,
     cloud (do ponto de vista da Box), srt, ota

2. Painel `vsaas-frontend/src/pages/EdgeNodeHealthPage.tsx`:
   - Grid 2x5 com cards coloridos por subsystem
   - Verde / amarelo (degraded) / vermelho (fail)
   - Drill-down: latencyMs, último erro, últimos 5 events em EdgeConnectionLog

3. Webhook automático: quando `>2 subsystems degraded` por > 15min,
   dispara alerta WhatsApp via Evolution.

**Aceite:** Box com Frigate offline → painel acende vermelho em 60s, integrador recebe WhatsApp em 15min se persistir.

---

## FCB-024 — Painel diagnostics (DR / LGPD / Disk / Certs)

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 8 h |
| Risco | Box já expõe esses dados, painel não consome — suporte continua precisando SSH |

**Implementação:**

1. 4 abas novas em `EdgeBoxDetailsPage.tsx`:
   - **DR**: lista backups (proxy `/api/dr/list`), botão "trigger backup" (proxy `/api/dr/upload`),
     download de backup específico (proxy `/api/dr/download/:id` stream)
   - **LGPD**: política configurada (proxy `/api/lgpd/policy`), histórico exports/erasures
     locais da Box
   - **Disk**: gráfico de uso (proxy `/api/disk/status`), partições, alertas configurados
   - **Certs**: lista certificados (proxy `/api/certs/status`) com vencimentos

2. Endpoints Cloud (proxies via tunnel):
   ```
   GET /admin/edge-nodes/:id/dr/backups         → tunnel /api/dr/list
   POST /admin/edge-nodes/:id/dr/trigger        → tunnel /api/dr/upload
   GET /admin/edge-nodes/:id/lgpd/policy        → tunnel /api/lgpd/policy
   GET /admin/edge-nodes/:id/disk               → tunnel /api/disk/status
   GET /admin/edge-nodes/:id/certs              → tunnel /api/certs/status
   ```

3. Auth: SUPER_ADMIN ou INTEGRADOR_ADMIN com acesso ao node.

**Aceite:** suporte resolve 70% dos chamados via painel admin sem SSH na Box.

---

# Sprint 2 — Resiliência avançada (próximo mês)

## FCB-012 — Contrato OpenAPI versionado + tests E2E

| Campo | Valor |
|---|---|
| Owner | `Both` |
| Esforço | 16 h |
| Risco | Box ou Cloud quebra contrato silenciosamente; descobre em produção |

**Implementação:**

1. Bumpar `openapi-box.json` e `openapi-cloud.json` para semver: `0.1.0`, `0.2.0`...
2. `INTEGRATION/CONTRACT.md` documentando regras: sempre aditivo, deprecate por 2 sprints, `breaking` requer bump major
3. CI workflow `bridge-contract-check.yml`: roda em PR mexendo em rotas `/iacv-box/*`, valida diff do OpenAPI gerado
4. Tests E2E em `tests/e2e/contract/` com fixtures reais (Box mock + Cloud real, Cloud mock + Box real)

**Aceite:** PR que adiciona endpoint sem bump da versão é rejeitado pelo CI.

---

## FCB-013 — Replay protection no heartbeat

| Campo | Valor |
|---|---|
| Owner | `Both` |
| Esforço | 8 h |
| Risco | Atacante captura heartbeat e replica para falsificar uptime / esconder Box morta |

**Implementação:**

1. Box adiciona em cada heartbeat:
   - `X-IACV-Timestamp: <unix-ms>` (header)
   - `X-IACV-Signature: HMAC-SHA256(licenseKey, body+timestamp)` (header)

2. Cloud middleware:
   - Rejeita se `|now - timestamp| > 5min`
   - Rejeita se signature inválida
   - Cache de timestamps recentes (Redis, TTL 5min) para detectar replay exato

**Aceite:** capturar request real e re-enviar 1 min depois → 403 com `REPLAY_DETECTED`.

---

## FCB-014 — Health Score por Box (gauge composto)

| Campo | Valor |
|---|---|
| Owner | `Cloud` |
| Esforço | 16 h |
| Risco | Sem visibilidade de "qual Box está deteriorando" — descobre quando já caiu |

**Implementação:**

1. Função `computeBoxHealthScore(edgeNodeId)` retorna 0-100:
   - heartbeat freshness (peso 30): age < 2min = 30, age > 15min = 0
   - sync queue depth Box-reportada (peso 20): 0 itens = 20, > 100 = 0
   - tunnel up (peso 15): bool
   - SRT publishing (peso 15): bool, ao menos 1 câmera ativa
   - eventos rejeitados últimas 24h (peso 10): 0% = 10, > 5% = 0
   - module drift (peso 10): nenhum extra/missing = 10

2. Cron: recalcular a cada 5 min, persistir em `EdgeNode.healthScore`
3. Painel: lista colorida (verde > 80, amarelo 60-80, vermelho < 60)
4. Webhook quando score cai abaixo de 60 por 2 ciclos consecutivos

**Aceite:** Box com SRT caído mas heartbeat OK mostra score 70 (amarelo), drill-down explica componente.

---

# Tabela mestre — sequenciamento

| ID | Sprint | Owner | Esforço | Depende de | Sprint pode começar quando |
|---|---|---|---|---|---|
| FCB-005 | 0 | Cloud | 4h | nenhum | imediato (segurança) |
| FCB-006 | 0 | Box | 3h Box+1h Cloud | nenhum | imediato (deadline 27d) |
| FCB-001 | 0 | Cloud | 2h | nenhum | imediato |
| FCB-002 | 0 | Cloud | 4h | nenhum | imediato |
| FCB-003 | 0 | Cloud | 3h | EdgeNode schema | imediato |
| FCB-004 | 0 | Cloud | 2h | EdgeNode schema | imediato |
| **FCB-016** | **0** | **Cloud** | **12h** | **nenhum (regulatório)** | **imediato — bloqueador LGPD** |
| **FCB-017** | **0** | **Cloud + Tarcísio** | **8h + 2h test** | **scripts/backup-postgres-r2.sh ativo** | **imediato — bloqueador DR** |
| **FCB-018** | **0** | **Both** | **2h Box + 2h Cloud** | **nenhum** | **imediato — bloqueador hardware-return** |
| FCB-019 | 1 | Cloud | 8h | nenhum | sprint 0 fechado |
| FCB-020 | 1 | Cloud | 6h | nenhum | sprint 0 fechado |
| FCB-007 | 1 | Cloud | 4h | nenhum | sprint 0 fechado |
| FCB-008 | 1 | Cloud | 1h | FCB-001 | FCB-001 mergeado |
| FCB-009 | 1 | Cloud | 6h | nenhum | sprint 0 fechado |
| FCB-010 | 1 | Both | 0.5h | nenhum | imediato |
| FCB-011 | 1 | Both | 3h | FCB-001 | FCB-001 mergeado |
| FCB-015 | 1 | Cloud | 12h | tunnel reverso operacional | imediato |
| FCB-012 | 2 | Both | 16h | sprint 0+1 | sprint 1 fechado |
| FCB-013 | 2 | Both | 8h | nenhum | sprint 1 fechado |
| FCB-014 | 2 | Cloud | 16h | FCB-002, FCB-009 | sprint 1 fechado |

---

# Caminho crítico

```
HOJE                                          2026-06-01 (vault expira)
  │                                                    │
  ├─ FCB-006 (Box)   ←  AÇÃO IMEDIATA TARCÍSIO         │
  ├─ FCB-005 (Cloud) ←  segurança multi-tenant         │
  ├─ FCB-002 (Cloud) ←  visibilidade box stale         │
  ├─ FCB-016 (Cloud) ←  LGPD regulatório (Art. 18)     │
  ├─ FCB-017 (Cloud) ←  DR + restore testado           │
  ├─ FCB-018 (Both)  ←  factory reset hardware return  │
  └─ FCB-001 + FCB-003 + FCB-004                       │
                                                       ▼
                                          v1 piloto externa DEFINITIVA
```

**6 itens bloqueiam v1 piloto definitiva:**
- FCB-005 (segurança multi-tenant)
- FCB-006 (vault renewal — deadline 27d)
- FCB-002 (alerta box stale)
- FCB-016 (LGPD endpoints — risco regulatório severo)
- FCB-017 (DR/restore — backup sem restore = fantasia)
- FCB-018 (factory reset — vazamento credentials hardware-return)

Os demais 3 do Sprint 0 (FCB-001, FCB-003, FCB-004) aceleram operação mas não bloqueiam piloto.

**Sem 1 desses 6, NÃO PROMOVER PRA PILOTO EXTERNO.**

---

# Próximas ações operacionais

1. **Tarcísio:** aprovar plano (responder via chat com OK ou ajustes)
2. **Tarcísio:** repassar FCB-006 à Box via bridge agora (mais alta prioridade temporal)
3. **Cloud (eu):** abrir PR/branch `feat/sprint0-fortalecimento` com FCB-001, FCB-002, FCB-003, FCB-004, FCB-005
4. **Box:** confirmar disponibilidade para FCB-006 (3h) + FCB-011 (1h) — se OK, agendar nas próximas 2 semanas
5. **Bridge:** atualizar `CHANGELOG.md` com referência a este plano após aprovação

---

# Risco residual após Sprint 0

Mesmo com Sprint 0 completo, **3 dívidas continuam abertas:**

- `originalType` cutover (FCB-010 — sprint 1)
- Rate limit segregado (FCB-007 — sprint 1) — risco baixo até > 5 Boxes em produção
- Eventos órfãos por câmera deletada — não está mapeado em nenhum FCB ainda; **adicionar em revisão Sprint 1**
- FCB-015 depende de tunnel reverso estar up; em redes corporativas paranoicas que bloqueiam tunnel, fallback async funciona mas perde UX interativa (documentado no item)

---

# Métricas de sucesso (medir após Sprint 0)

- 0 incidentes de "Box parou e ninguém viu" (FCB-002)
- 100% dos endpoints `:boxId` cobertos pelo middleware (FCB-005)
- 0 ocorrências de `vault_403` em logs (FCB-006)
- Cobertura `capabilitiesRevision` em 100% dos heartbeats (FCB-003)
- `EdgeCommand.expiresAt` populado em 100% dos novos comandos (FCB-001)
- ≥ 1 LGPD request processada com sucesso end-to-end (FCB-016)
- DR test mensal executando + último resultado < 35 dias (FCB-017)
- ≥ 1 ciclo `provision → use → factory-reset → re-provision` validado (FCB-018)

# Critérios de "v1 piloto definitiva pronta"

Marcar como ☑ quando todos os 8 critérios abaixo passarem:

- [ ] **Segurança:** middleware `assertBoxOwnership` em produção, sem 1 endpoint cross-box vulnerável
- [ ] **Vault:** Box renova credentials automático, validado em laboratório
- [ ] **Observabilidade:** alerta Box stale → e-mail integrador funciona em smoke test
- [ ] **LGPD:** 1 ciclo end-to-end (request → process → entrega) executado em ambiente de teste
- [ ] **DR:** restore-postgres.sh executou com sucesso em DB de teste, RTO < 15 min
- [ ] **Hardware return:** EdgeCommand `FACTORY_RESET` executado em Box de lab, dados wiped, re-provisionada para outro tenant sem vazamento
- [ ] **Operacional Tarcísio:** DNS box.iacloud.com.br ativo, Caddy aplicado, install.sh resolvendo
- [ ] **Documentação:** `docs/13-RUNBOOK-DR.md` + `docs/PRE-HOMOLOGACAO-CHECKLIST.md` atualizados, todos os P0 ☑

---

**Versionamento deste plano:**
- v1.0 — 2026-05-04 — versão inicial pós-análise gaps comunicação Cloud-Box
- v1.1 — 2026-05-04 — adicionado FCB-015 (cadastro remoto de câmera com scan via Cloud)
- v2.0 — 2026-05-04 — escopo expandido para "v1 piloto definitiva" pós-análise fim-a-fim:
  - Sprint 0: +FCB-016 (LGPD), +FCB-017 (DR/restore), +FCB-018 (factory reset)
  - Sprint 1: +FCB-019 (wizard provisão), +FCB-020 (dashboard câmeras com problema)
  - Caminho crítico passa de 3 → 6 bloqueadores absolutos
  - Critérios de aceite "v1 piloto definitiva" formalizados
- v2.1 — 2026-05-06 — aceitas 4 ofertas da Box (Sprint A.2 batch 2 commit Box 84d402f)
  como itens Sprint 1 Cloud:
  - +FCB-021 (Prometheus scrape /metrics — 18 séries Box)
  - +FCB-022 (X-Correlation-Id middleware Cloud + axios interceptor)
  - +FCB-023 (proxy /api/health/detailed para painel granular)
  - +FCB-024 (proxy /api/dr/list, /lgpd/policy, /disk/status, /certs/status)
- v2.2 — 2026-05-06 — Box A/B/C entregues (commit Cloud b705676a):
  - Box A — transition-logger Box → EdgeConnectionLog
  - Box B — vault.quotaUsedGB/quotaTotalGB/tokenExpiresAt no /activate
  - Box C — deep-link Logs no EdgeBoxesPanel
  - FCB-005/002/016 com SERVICES criados, AGUARDANDO WIRING (próxima sessão sem paralelas)
