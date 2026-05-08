# Storage — Runbook Operacional

**Versão:** 1.0 (pós-Sprint 5)
**Data:** 2026-05-07
**Audiência:** Tarcísio (e qualquer dev solo no futuro)

Guia de operação dia-a-dia do subsistema de Storage da IACloud Vision. Para
arquitetura conceitual, ver `docs/STORAGE-ARCHITECTURE.md`.

---

## 1. Visão geral dos componentes

```
┌─────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE R2                                                   │
│   ├─ icv-{integradorId}              (gravações HLS contínuas)   │
│   └─ iacv-vault-{integradorId}       (clips Frigate de evento)   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │ Event Notifications (Sprint 1)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE QUEUE  icv-storage-events-{env}                      │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP pull (30s)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND vsaas-backend (Hetzner CCX23)                           │
│                                                                  │
│  Cron 1: r2-event-consumer            (30s)                      │
│  Cron 2: storage-reconciliation       (7d, ListObjectsV2)        │
│  Cron 3: storage-billing-snapshot-daily   (24h)                  │
│  Cron 4: storage-billing-finalize-monthly (24h, dia 1-2)         │
│  Cron 5: storage-billing-reconciliation   (24h, GraphQL CF)      │
│  Cron 6: storage-health-summary       (24h)                      │
│  Cron 7: recording.tickRetention      (1h, apaga antigos)        │
│  Cron 8: recording.tickReconcile      (30s, ffmpeg supervisor)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Endpoints administrativos (SUPER_ADMIN)

| Endpoint | O que faz |
|---|---|
| `GET /billing/platform` | KPIs globais + lista integradores do mês |
| `GET /billing/integrador/:id` | Drill-down integrador |
| `GET /billing/snapshots/:id/items` | LineItems do snapshot |
| `GET /billing/health-summary` | Dashboard de saúde 24h |
| `POST /billing/run-daily` | Força tick imediato do snapshot diário |
| `POST /billing/run-reconciliation` | Força reconciliação CF |
| `POST /billing/run-health-summary` | Força tick do health summary |
| `GET /retention/upgrade-requests` | Pedidos pendentes (todos tenants) |
| `POST /retention/upgrade-requests/:id/decide` | Aprovar/Negar pedido |
| `POST /storage/test` | Testa conexão R2 do integrador |
| `GET /storage/orphans` | Lista gravações órfãs (segmento sem registro DB) |
| `GET /me/whitelabel` | Status do custom domain |

---

## 3. Cenários do dia-a-dia

### 3.1 — "Quero ver minha receita do mês corrente"

```
Acesse: https://app.iacloud.com.br/billing
```

Se KPIs estão zerados (mês recém-começado), clique em **"Rodar snapshot diário agora"**. Aguarde ~10s e a tabela popula.

### 3.2 — "Cliente reportou que abriu /recordings e tá em branco"

Sequência de diagnóstico:

```sql
-- 1. Câmera tem RecordingSegment recente?
SELECT COUNT(*), MAX("startedAt")
FROM "RecordingSegment"
WHERE "cameraId" = '<id-da-camera>' AND "startedAt" > NOW() - INTERVAL '1 hour';

-- 2. Se 0, câmera tem clips Frigate (vault)?
SELECT COUNT(*), MAX("capturedAt")
FROM "AnalyticsEvent"
WHERE "cameraId" = '<id-da-camera>'
  AND ("vaultClipKey" IS NOT NULL OR "vaultSnapshotKey" IS NOT NULL)
  AND "capturedAt" > NOW() - INTERVAL '1 hour';

-- 3. Box online?
SELECT en.status, en."lastHeartbeatAt", en."serialNumber"
FROM "EdgeNode" en
JOIN "Camera" c ON c."edgeNodeId" = en.id
WHERE c.id = '<id-da-camera>';
```

**Veredictos:**
- (1) > 0 → HLS rolando, problema é UI/cache. Cliente faz `Ctrl+Shift+R`.
- (1) = 0 e (2) > 0 → fallback `VaultClipsFallback` deveria aparecer. Se não, problema no frontend.
- (1) = 0 e (2) = 0 e box ONLINE → uploader da box parou. Investigar logs.
- Box OFFLINE → problema de rede/box. Não é storage.

### 3.3 — "Drift Cloudflare > 5% no painel"

Significa que nossa medição interna divergiu da fatura real. Possíveis causas:

1. **Event Notifications perdeu mensagens** — entre data X e Y, queue overflow ou consumer parou
2. **Cron `storage-reconciliation` ainda não rodou** (corrige drift via ListObjectsV2)
3. **Bucket de teste poluindo soma** — verificar se `icv-stg-test-*` está incluído

**Ação:**
```
POST /billing/run-reconciliation     # força tick GraphQL
```

Se persistir, rodar query GraphQL manual e comparar com `costTotalUsd` do snapshot. Diff por `actionType` mostra quais ops faltaram.

### 3.4 — "Cliente cancelou. Como ativo o período de graça?"

Sprint 5 implementação parcial — campos `canceledAt` e `cancelGraceUntil`
existem mas **workflow automatizado de bucket lock + lifecycle de cancelamento não foi implementado** (entra em Sprint 6 ou ad-hoc).

Workaround manual (~5 min):

```sql
UPDATE "ClienteFinal"
SET "canceledAt" = NOW(),
    "cancelGraceUntil" = NOW() + INTERVAL '30 days'
WHERE id = '<cf-id>';
```

```bash
# Aplicar bucket lock + lifecycle date-based no R2 (manual via CF dashboard ou API)
# Ver INTEGRATION/sprint0-evidences/s0.3-apply-lock.json para template
```

### 3.5 — "Quero atribuir plano HD-30d a uma câmera específica"

3 caminhos:

**A) UI:** abre /recordings → aba "Configuração" → seleciona "HD · 30 dias" no dropdown → Save.

**B) API:**
```bash
curl -X POST https://app.iacloud.com.br/retention/cameras/<cam-id>/plan \
  -H "Authorization: Bearer <token-int-admin>" \
  -H "Content-Type: application/json" \
  -d '{"retentionPlanId":"<plano-id>"}'
```

**C) SQL direto (não recomendado, sem auditoria):**
```sql
UPDATE "Camera" SET "retentionPlanId" = '<plano-id>' WHERE id = '<cam-id>';
```

### 3.6 — "Câmera 'recepção' está consumindo mais que o esperado"

O painel `/billing/snapshots/:id/items?scope=CAMERA` mostra `isOutlier=true` quando:

- Volume real > `RetentionPlan.gbIncludedSoftLimit` (fair use)
- OU custo R2 real > preço atacado IACloud (margem negativa)

**Ações possíveis:**

1. **Falar com integrador:** sugerir ajustar threshold de motion na box
2. **Trocar plano da câmera:** HD-30d → FHD-30d (preço maior cobre custo)
3. **Aceitar exceção:** registrar nota no plano (cliente premium, vale absorver)

Se prejuízo persistir > 30 dias na mesma câmera, considerar política de
"câmeras abusivas" (cláusula contratual).

### 3.7 — "Como configuro custom domain do integrador X?"

```bash
# 1. Integrador faz request via UI ou API
curl -X PUT https://app.iacloud.com.br/me/whitelabel \
  -H "Authorization: Bearer <token-int-admin>" \
  -H "Content-Type: application/json" \
  -d '{"customDomain":"cdn.acmevigilancia.com.br"}'

# Resposta inclui:
# - status: pending no Cloudflare
# - nextSteps: instruções de CNAME
```

```
# 2. Integrador cria CNAME no provedor DNS dele:
cdn.acmevigilancia.com.br  CNAME  pub-{bucketId}.r2.dev

# 3. Aguarda 5-30 min Cloudflare validar SSL
# 4. Acompanha status:
GET /me/whitelabel
# → cfStatus: { status: "active" }
```

### 3.8 — "Backend reiniciou e crons não estão logando"

Verificar logs de boot:

```bash
docker service logs iacloud_backend --since 5m | grep -iE 'starting|disabled'
```

Esperado:
```
recording_service_starting    {segmentSec:6, reconcileMs:30000}
r2_event_consumer_*           (running OU noop_missing_config)
storage_reconcile_starting    {tickMs:604800000, alertPct:5}
storage_billing_starting      {dailyMs:86400000, markupPct:50, usdBrl:5.30}
storage_billing_reconcile_*   (running OU noop_missing_config)
storage_health_summary_starting {tickMs:86400000}
```

Se algum aparece como `*_disabled`, verificar variável de env `*_DISABLED=true`.

---

## 4. Forçar ticks manualmente (debug)

Todos os crons têm gatilhos manuais via API. Útil pra:
- Validar que estão funcionando
- Acelerar testes
- Recuperar de falha (ticks perdidos)

```bash
# Snapshot diário (acumula uso, cria StorageBillingSnapshot)
POST /billing/run-daily

# Reconciliação CF (puxa GraphQL e atualiza drift)
POST /billing/run-reconciliation

# Health summary (atualiza dashboard de saúde)
POST /billing/run-health-summary
```

---

## 5. Variáveis de ambiente importantes

```bash
# R2 (operações de plataforma)
R2_API_TOKEN=                          # Cloudflare API token (cfat_...)
                                       # Escopos: Workers R2 Storage + Queues +
                                       # DNS View + SSL Certificates + Account Analytics:Read

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=                      # S3 credentials (uso de objetos)
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_BUCKET_PREFIX=icv

# Event Notifications (Sprint 1) — sem isso, consumer fica em no-op
R2_QUEUE_ID=                           # ID da queue criada no dashboard CF
R2_EVENT_CONSUMER_INTERVAL_MS=30000

# Reconciliation (Sprint 1)
STORAGE_RECONCILIATION_INTERVAL_MS=604800000  # 7 dias

# Billing (Sprint 4)
STORAGE_BILLING_DAILY_INTERVAL_MS=86400000    # 24h
STORAGE_BILLING_RECONCILE_INTERVAL_MS=86400000
STORAGE_BILLING_DRIFT_ALERT_PCT=5
IACLOUD_MARKUP_PCT=50
USD_BRL_RATE=5.30                      # câmbio congelado mensal

# Health summary (Sprint 5)
STORAGE_HEALTH_SUMMARY_INTERVAL_MS=86400000

# Recording supervisor (CLOUD_DIRECT)
RECORDING_ENABLED=true
RECORDING_SEGMENT_SECONDS=6
RECORDING_RECONCILE_MS=30000
RECORDING_RETENTION_MS=3600000

# Storage local
RECORDINGS_BASE_PATH=/recordings
RECORDING_DELETE_LOCAL_AFTER_S3=true   # IMPORTANTE: true em prod, senão disco estoura
```

Disable flags (modo no-op):
```bash
STORAGE_BILLING_DISABLED=true
STORAGE_BILLING_RECONCILE_DISABLED=true
STORAGE_HEALTH_SUMMARY_DISABLED=true
R2_EVENT_CONSUMER_DISABLED=true
RECORDING_ENABLED=false
```

---

## 6. Checklist de saúde mensal (1× por mês)

No dia 5 do mês (após reconciliação CF rodar pelo menos 1 vez):

- [ ] `GET /billing/platform?period=YYYY-MM-anterior` mostra todos os snapshots como `RECONCILED`
- [ ] Drift médio < 5% em todos os buckets
- [ ] Margem IACloud > 30% no mês fechado
- [ ] `GET /billing/health-summary` mostra `crons.eventConsumerHealthy=true`, `reconciliationHealthy=true`, `billingHealthy=true`
- [ ] Sem outliers persistentes (mesma câmera por 3+ meses): contato comercial
- [ ] Gerar CSV de billing pra contabilidade (export futuro)

---

## 7. Migrations de schema relacionadas

```
20260507_cliente_storage_quota          # ClienteFinal.storageQuotaBytes
20260514_storage_visibility_hooks       # StorageBucket telemetry + 3 hooks
20260515_retention_catalog              # Sprint 2 plans + contract + upgrades
20260516_billing_snapshots              # Sprint 4 BillingSnapshot + LineItem
```

---

## 8. Quando algo dá errado — ordem de investigação

```
1. Backend health 200?
   curl https://app.iacloud.com.br/health

2. Logs do backend nos últimos 5 min:
   docker service logs iacloud_backend --since 5m | grep -i error

3. Containers em Running?
   docker service ps iacloud_backend

4. Postgres acessível?
   docker exec iacloud_postgres.1.* pg_isready -U icvuser

5. R2 acessível?
   curl -H "Authorization: Bearer $R2_API_TOKEN" \
     https://api.cloudflare.com/client/v4/accounts/$R2_ACCOUNT_ID/r2/buckets

6. Cron está rodando?
   GET /billing/run-health-summary  # mostra status de todos os crons
```

---

## 9. Contatos / referências

- **Dev solo:** Tarcísio (`falecomtarcisio@gmail.com`)
- **Bridge Cloud↔Box:** `INTEGRATION/CHANGELOG.md` + `BOX_TO_CLOUD.md` + `CLOUD_TO_BOX.md`
- **Arquitetura:** `docs/STORAGE-ARCHITECTURE.md`
- **Pré-homologação:** `docs/PRE-HOMOLOGACAO-CHECKLIST.md`
- **Spec da Box:** `INTEGRATION/HLS_RECORDING_INTEGRATION.md`
- **Plano comercial:** `docs/17-PLAN-STORAGE-ADMIN-FIM-A-FIM.md`
