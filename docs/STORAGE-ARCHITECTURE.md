# Arquitetura de Storage — IA Cloud Vision

**Versão:** 0.1 (Sprint 0 validado)
**Data:** 2026-05-07
**Status:** Validação técnica concluída — pronto para Sprint 1

---

## 1. Decisão de plataforma

**Cloudflare R2** como storage primário de gravações VMS.

### Por quê
- Egress free → playback HLS ilimitado sem custo proporcional
- Multi-tenancy via 1 bucket por integrador (limite 1M buckets/conta)
- Lifecycle por prefixo (até 1.000 regras/bucket → ~990 câmeras com retenção customizada)
- Bucket Lock prefix-based → imutabilidade de evidência (LGPD/legal hold)
- Event Notifications → Cloudflare Queues (medição de uso em quase-real-time, sem ListObjectsV2 caro)
- API S3-compatível → ferramental existente (boto3, aws-sdk, ffmpeg) funciona sem adaptação
- Strong consistency (PUT 200 = persistido) → sem race conditions no ingest

### Limitações aceitas
- Single-region (replicação intra-região apenas) — DR cross-region fica no roadmap
- Sem região BR — uso de `locationHint=WEUR` (latência aceitável até PoP BR ser implantado)

---

## 2. Modelo de bucket

### Naming
```
icv-{env}-{integradorShortId}     onde:
  env             = prod | stg | dev
  integradorShortId = primeiros 12 chars do UUID do integrador (lowercase, sem hífen)

Exemplo: icv-prod-a3f2e1b47c89
```

### Hierarquia interna de chaves
```
icv-prod-a3f2e1b47c89/
├─ c/{clienteFinalId}/
│  ├─ {cameraId}/
│  │  ├─ rec/{YYYY}/{MM}/{DD}/{HH}/{HHMMSS}_{uuid}.ts    (gravações)
│  │  ├─ snap/{YYYY-MM-DD}/{HHMMSS}.jpg                  (thumbnails)
│  │  └─ evt/{eventId}/{seq}.ts                          (clipes IA/alarme)
│  └─ exp/{exportId}/{filename}.mp4                       (exports CF)
├─ _legal-hold/{caseId}/...                               (evidência travada)
└─ _sys/tmp/                                              (multipart em curso)
```

### Lifecycle (até 1.000 regras/bucket)

**Regras globais (5 fixas):**

| ID | Prefixo | Ação | Justificativa |
|---|---|---|---|
| G1 | `_sys/tmp/` | Abort multipart >1d | Limpa lixo de uploads abortados |
| G2 | `*/exp/` | Expire 7d | Exports são one-shot |
| G3 | `*/snap/` | Expire 90d | Thumbnails baratos |
| G4 | `*/evt/` | Expire 180d | Eventos têm valor investigativo |

**Regras dinâmicas (até 995 por bucket):**

| Tipo | Prefixo | Ação | Origem |
|---|---|---|---|
| Per-câmera | `c/{cli}/{cam}/rec/` | Expire `RetentionPlan.dias` | Sprint 2 (atribuição de plano) |
| Cancelamento | `c/{clienteCancelado}/` | Expire date `cancelDate+30d` | Sprint 3 (workflow cancelamento) |

### Bucket Lock (prefix-based)

| Cenário | Modo | Prefixo | Duração |
|---|---|---|---|
| Pós-cancelamento (LGPD graça) | Date-based | `c/{clienteCancelado}/` | 30d a partir de cancelamento |
| Evidência judicial | Indefinite | `_legal-hold/{caseId}/` | Liberado manualmente pelo super admin |
| Compliance regulado | Date-based | `c/{cli}/` (cliente premium) | 90/180d conforme contrato |

---

## 3. Credenciais e ambientes

### Tipos de credencial R2

| Tipo | Formato | Usado por | Onde fica |
|---|---|---|---|
| Cloudflare API Token | `cfat_...` (Bearer) | Backend (operações de plataforma: criar bucket, lifecycle, queues) | Secret Manager |
| R2 S3 Access Key + Secret (master) | hex 32 + hex 64 | Backend (gera presigned URLs) | Banco cifrado AES-256-GCM |
| R2 S3 Access Key + Secret (per-bucket) | idem, mas escopo limitado | Por integrador | Banco cifrado |

### Ambientes

| Recurso | Stg | Prod |
|---|---|---|
| Conta CF | mesma (até Sprint 5) → conta separada (a partir do Sprint 5) | mesma |
| Bucket prefix | `icv-stg-` | `icv-prod-` |
| `ICV_ENCRYPTION_KEY` | dedicada stg | dedicada prod, em Secret Manager |
| Postgres | separado | prod com backup diário |
| Domínio | `homol.iacloud.com.br` | `app.iacloud.com.br` |
| Sentry env | `staging` | `production` |

---

## 4. Sprint 0 — Resultados da validação técnica

Todos os testes executados em **2026-05-07** contra bucket `icv-stg-test-sprint0`.

### S0.1 — Bucket com locationHint=WEUR ✅
```json
{
  "name": "icv-stg-test-sprint0",
  "location": "WEUR",
  "storage_class": "Standard"
}
```
Evidência: `INTEGRATION/sprint0-evidences/s0.1-*.json`

### S0.2 — Lifecycle (date-based + age-based) ✅
3 regras aplicadas e confirmadas:
- Per-câmera (age-based): `c/cli-A/cam-1/` → expire 1d
- Cancelamento (date-based): `c/cli-B/` → expire 2026-06-07
- Cleanup multipart: `_sys/tmp/` → abort >1d

Evidência: `s0.2-lifecycle-applied.json`

### S0.3 — Bucket Lock ✅
- Lock date-based aplicado em `c/cli-B/` até 2026-06-07
- DELETE em objeto LOCKED → bloqueado com `ObjectLockedByBucketPolicy`
- DELETE em objeto UNLOCKED → permitido

Evidência: `s0.3-delete-attempts.json`

**Confirma:** modelo de 30d de graça pós-cancelamento via lock + lifecycle date-based é viável e seguro.

### S0.4 — Event Notifications via Queue ✅
- Queue `icv-stg-storage-events-sprint0` criada
- Subscription configurada: bucket → queue, ações `[PutObject, DeleteObject, CompleteMultipartUpload, LifecycleDeletion, CopyObject, AbortMultipartUpload]`
- HTTP pull consumer ativo
- 2 mensagens recebidas, payload JSON contendo: `{ account, bucket, eventTime, action, object: {key, size, eTag} }`

**Confirma:** Sprint 1 pode usar Event Notifications como fonte primária do `storage-usage-daily` (não precisa fallback `ListObjectsV2`).

Evidência: `s0.4-pull-messages-3.json`

### S0.5 — Public domain via CF (parcial) ⚠️
- R2 managed public domain habilitado: `pub-{bucketId}.r2.dev`
- Acesso HTTPS funcionando, tráfego pela rede CF (CF-RAY presente)
- Ressalva: `cf-cache-status` não exposto no managed domain — cache full requer **custom domain** real (`cdn-{slug}.iacloud.com.br`), que precisa configuração DNS manual no dashboard

**Decisão:** custom domain por integrador será configurado no Sprint 5 via dashboard (script wrangler ou clique manual). Não bloqueia Sprints 1-4.

Evidência: `s0.5-cache-headers.txt`

---

## 5. Decisões consolidadas pós-Sprint 0

| Item | Decisão | Razão |
|---|---|---|
| Storage class | **Só Standard** | IA penaliza padrão "lê pouco mas urgente" + cobra retrieval |
| Region/locationHint | **WEUR** | Latência ótima do upload (VPS Hetzner DE) e aceitável para BR |
| Custom domain | **Estrutural por integrador**, configurado via dashboard no Sprint 5 | Cache CF reduz Class B ops + branding |
| Event Notifications | **Fonte primária** do storage-usage-daily | Real-time, sem custo de listagem |
| Cron de reconciliação | **Semanal** (`storage-reconciliation`) | Corrige drift de event notifications via ListObjectsV2 |
| Bucket Lock | **Habilitado em pós-cancelamento + legal-hold** | LGPD compliance |
| Cross-region DR | **Não implementar no MVP** | Probabilidade baixa, custo storage 2x |
| Infrequent Access | **Mantido no roadmap como opcional** | Aguarda caso de uso real (legal hold longo) |

---

## 6. Hooks de schema decididos para Sprint 1-2

Para evitar refactor futuro, incluir já no schema:

```prisma
model Camera {
  retentionPlanId  String?    // Sprint 2
  criticality      String     @default("STANDARD")  // STANDARD | EVIDENCE | MISSION_CRITICAL
}

model ClienteFinal {
  storageQuotaBytes BigInt?  // já existe
  canceledAt        DateTime?
}

model Integrador {
  customDomain      String?  // futuro white-label
  retentionMarkupPct Decimal?
}

model RetentionPlan {  // Sprint 2
  id                 String  @id
  name               String
  retainDays         Int
  basePriceUsdGbMonth Decimal
}

model RetentionUpgradeRequest {  // Sprint 2 — workflow stub
  status RetentionUpgradeStatus  @default(AUTO_APPROVED)
  // hook para futura aprovação multi-nível
}
```

---

## 7. Próximos passos (Sprint 1)

1. Criar serviço `r2-event-consumer.service.ts` que polleia a queue HTTP a cada 30s
2. Atualizar `StorageBucket.totalBytes` e `StorageUsage` em tempo real via eventos
3. Cron `storage-reconciliation` semanal (ListObjectsV2 + corrige drift)
4. UX: corrigir mensagem "Storage S3 não configurado" para Cliente Final (mostrar contato do integrador)
5. Painel CF de consumo: GB usados / GB cota / R$ estimado

Esforço estimado: 60h (~2 semanas a 30h/sem).

---

## Referências

- [R2 Buckets — limits](https://developers.cloudflare.com/r2/platform/limits/)
- [R2 Object Lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [R2 Bucket Locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [R2 Event Notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)
- [R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- Plano comercial: `docs/17-PLAN-STORAGE-ADMIN-FIM-A-FIM.md`
- Análise concorrentes: análise da tabela Monuv em `INCREMENTOS/`
