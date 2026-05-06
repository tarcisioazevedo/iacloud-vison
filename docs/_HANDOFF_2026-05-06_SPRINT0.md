# Handoff Sprint 0 — sessão 2026-05-06

> **Para a próxima sessão Cloud (sem paralelas Claude vivas).**
>
> Lê este arquivo primeiro pra retomar do ponto exato onde parou.

## Estado atual (2026-05-06 04:00 UTC)

### ✅ Entregue + pushed em branch isolada

**Branch:** `claude-sprint0-pivot-2026-05-06`
**Commit:** `b705676a`
**SHA remoto verificado:** `b705676a751353b46d44feea550155fd793308a7`

| Item | Arquivo | Status |
|---|---|---|
| Box A — `transition-logger.service` | `vsaas-backend/src/services/transition-logger.service.ts` (NEW 144 linhas) | ✅ integrado em `/heartbeat` |
| Box B — vault quota fields | `vsaas-backend/src/routes/iacv-box.ts` (49 linhas modif) | ✅ |
| Box C — deep-link Logs | `vsaas-frontend/src/components/edge/EdgeBoxesPanel.tsx` (34 linhas) | ✅ |
| FCB-005 middleware | `vsaas-backend/src/middleware/assert-box-ownership.ts` | ✅ existe (criado pela paralela, conteúdo idêntico) |
| FCB-002 cron | `vsaas-backend/src/jobs/detect-stale-edge.ts` | ✅ existe (idem) |
| FCB-016 LGPD service+routes | `vsaas-backend/src/services/lgpd.service.ts` + `routes/lgpd.ts` | ✅ compila limpo |
| FCB-017 DR script | `scripts/restore-postgres.sh` + `docs/13-RUNBOOK-DR.md` | ✅ entregue nesta sessão |
| FCB-016 UI | `vsaas-frontend/src/pages/LgpdRequestsPage.tsx` | ✅ entregue nesta sessão |
| Smoke tests | `scripts/sprint0-smoke-tests.sh` (275 linhas) | ✅ 9/9 offline OK |
| Plan v2.2 | `docs/12-PLAN-FORTALECIMENTO-CLOUD-BOX.md` | ✅ atualizado com FCB-021..024 |
| Bridge update | `INTEGRATION/CLOUD_TO_BOX.md` + `CHANGELOG.md` (commit `4e352c2`) | ✅ Box notificada de A/B/C |

### ⚠ NÃO wirado (próximo bloco — exige edição em arquivos quentes)

| Item | Onde | Esforço |
|---|---|---|
| FCB-005 — aplicar middleware | `iacvBoxRouter.use(assertBoxOwnership)` em rotas Box do `iacv-box.ts` | 30 min |
| FCB-002 — schedule job | `startStaleEdgeDetectionJob()` em `index.ts:scheduleJobs()` | 15 min |
| FCB-016 — register router | `app.use('/lgpd', lgpdRouter)` em `app.ts` + import | 15 min |
| FCB-001 — migration TTL | `EdgeCommand.expiresAt` em `prisma/schema.prisma` + migration | 1 h |
| FCB-003/004 — capabilities/branding revision | Adicionar campos em `EdgeNode` + persistir no `/heartbeat` handler | 2 h |
| FCB-018 — handler FACTORY_RESET | Novo case no dispatcher EdgeCommand de `iacv-box.ts` | 1 h |
| Cron `lgpd-sla-watch` | `jobs/lgpd-sla-watch.ts` + alerta DPO | 2 h |
| Smoke tests **online** | Backend rodando estável (Docker stack) | 1 h |
| Push monorepo | Merge `claude-sprint0-pivot-2026-05-06` em `dev` | 30 min |

**Total restante Sprint 0:** ~8 h.

## ⚠️ ATENÇÃO — iniciar próxima sessão

**Antes de começar, VERIFIQUE que não há sessões Claude paralelas ativas:**

```bash
ps aux | grep "ccd-cli\|/claude\b" | grep -v grep | grep -v "$(echo $$)"
# Esperado: vazio (só sshd, server bridge, systemd-user)
```

**Se houver outras sessões ativas, MATE TODAS antes de começar:**
```bash
sudo kill -9 <PIDs das outras sessões>
```

**Por quê:** durante a sessão 2026-05-06 perdi ~30% do tempo brigando com paralelas que sobrescreviam branches remotas e modificavam arquivos quentes (`schema.prisma`, `package.json`, `iacv-box.ts`). Branch `feat/sprint0-piloto-definitivo` foi sobrescrita pela paralela em < 30s. Salvei tudo em `claude-sprint0-pivot-2026-05-06` por isso.

## Roteiro de retomada

### Passo 1 — Validar o que está pushed
```bash
cd /opt/iacloud-vison
git fetch origin
git log origin/claude-sprint0-pivot-2026-05-06 -1 --format="%h %s"
# Esperado: b705676a feat(sprint0): pivot Box A/B/C + transition-logger + LGPD fixes + smoke tests
```

### Passo 2 — Checkout
```bash
git checkout -b feat/sprint0-final origin/claude-sprint0-pivot-2026-05-06
```

### Passo 3 — Wirar nas seguintes ordens (cada bloco = 1 commit)

**Bloco 1 — Wiring básico (1 h):**
1. Edit `vsaas-backend/src/app.ts`:
   ```typescript
   import { lgpdRouter } from './routes/lgpd'
   import { correlationIdMiddleware } from './middleware/correlation-id' // FCB-022 quando feito
   app.use('/lgpd', lgpdRouter)
   ```

2. Edit `vsaas-backend/src/index.ts`:
   ```typescript
   import { startStaleEdgeDetectionJob } from './jobs/detect-stale-edge'
   function scheduleJobs() {
     // ... existentes
     startStaleEdgeDetectionJob()
   }
   ```

3. Edit `vsaas-backend/src/routes/iacv-box.ts`:
   - Aplicar `assertBoxOwnership` middleware em rotas que recebem `:boxId` ou `:nodeId`:
     - `/heartbeat`, `/cameras`, `/events`, `/events-batch`, `/logs-batch`,
       `/snapshots-live`, `/:boxId/config`, `/commands/:id/ack`
   - **NÃO** aplicar em `/activate` (Box ainda não tem licença resolvida)

**Smoke test após Bloco 1:**
```bash
cd vsaas-backend && npm run build && npm run dev &
TEST=fieldErrors  bash ../scripts/sprint0-smoke-tests.sh
TEST=logsBatch    bash ../scripts/sprint0-smoke-tests.sh
TEST=transitions  bash ../scripts/sprint0-smoke-tests.sh
TEST=vaultQuota   bash ../scripts/sprint0-smoke-tests.sh
```

**Bloco 2 — Migration EdgeCommand TTL (1 h):**
```bash
# Em prisma/schema.prisma, adicionar:
#   expiresAt DateTime?
#   @@index([edgeNodeId, expiresAt]) onde ackedAt IS NULL
npx prisma migrate dev --name sprint0_edge_command_ttl
```

Edit handler em `iacv-box.ts` que cria EdgeCommand: default `expiresAt = now + 1h`.

Filtrar fetch de comandos pendentes pra excluir expirados.

**Bloco 3 — capabilitiesRevision + brandingRevision consumers (2 h):**
- Migration `EdgeNode.capabilitiesRevision String?` + `brandingRevision String?`
- Persistir no handler `/heartbeat` quando recebido
- Endpoint `GET /admin/edge-nodes/:id/capabilities` que faz proxy a `tn-<edge>.iacloud.com.br/box/api/cmd/list` quando revision muda
- Cache Redis 1h ou até próxima mudança

**Bloco 4 — FACTORY_RESET handler (1 h):**
- `services/factory-reset.service.ts` (NOVO) com função que cria EdgeCommand
- Endpoint `POST /admin/edge-nodes/:id/factory-reset` (SUPER_ADMIN, modal de confirmação tripla)
- Audit log `FACTORY_RESET_TRIGGERED`

**Bloco 5 — Cron lgpd-sla-watch (1 h):**
- `jobs/lgpd-sla-watch.ts` que roda diário às 09:00
- Solicitações em PENDING há > 10 dias → e-mail DPO "vence em 5 dias"
- > 15 dias → escalation para SUPER_ADMIN

**Bloco 6 — smoke tests online completos + merge (30 min):**
```bash
TEST=all bash scripts/sprint0-smoke-tests.sh
# Esperado: 10/10 testes passam

git checkout dev
git merge feat/sprint0-final
git push origin dev
```

## Bridge — pendências para continuar acompanhando

**Box espera ack quando:**
- Smoke test do logs-batch der 200 OK (gatilho da auditoria 19+4 itens em `_PENDING-BOX-AUDIT-2026-05-05.md`)
- Box validar Item A com smoke `TUNNEL_DOWN` chegando em EdgeConnectionLog

**Cloud pendente para Box:**
- Quando wiring estiver completo, atualizar bridge dizendo "Sprint 0 100% fechado"

## Decisões já tomadas (não revisitar)

- **DNS install.sh**: opção B (`box.iacloud.com.br` via Caddy + monorepo) — não vamos criar repo público IACV-BOX agora
- **NTP**: ambos lados usam `a/b/c.ntp.br` (NIC.br). Cloud aplicado, install.sh aplica em Box automaticamente
- **Repo público box-installer**: adiar até primeiro cliente externo entrar
- **LGPD ZIP**: v1.1 — v1 piloto aceita JSON estruturado (LGPD Art. 18 V "formato de fácil acesso" inclui JSON)
- **R2 quota**: v1 usa env `R2_QUOTA_DEFAULT_GB` (default 100 GB). Quando schema ganhar `Integrador.storageQuotaGB`, ler dali

## Backups e rollback

- `/tmp/iacloud-pre-sprint0-20260505-011107.tar.gz` (37 MB) — snapshot pré-Sprint 0
- `/tmp/iacloud-snapshot-20260504-032033.tar.gz` (46 MB) — snapshot pré-pivot
- Branch `claude-sprint0-pivot-2026-05-06` — estado entregável atual
- Branch `dev` — estado pré-Sprint 0 (só commits da paralela)

Rollback total: `tar -xzf <snapshot> -C /opt/iacloud-vison/ && git checkout dev`

---

**Próxima sessão:** começa rodando o smoke offline pra confirmar estado, depois Bloco 1 → 6 sequencial.

Tempo estimado pra fechar: **8 h efetivos** sem paralelas.
