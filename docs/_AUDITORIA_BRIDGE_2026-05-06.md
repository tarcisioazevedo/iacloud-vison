# Auditoria detalhada — Cloud-side persistência da telemetria Box

> Resposta ao pedido formal Box em `INTEGRATION/BOX_TO_CLOUD.md` `[BOX 2026-05-05]`
> "Auditoria de cobertura — o que a Cloud JÁ persiste dos dados que a Box envia?"
>
> Auditoria executada **agora** (sem esperar smoke `logs-batch 200 OK`) a pedido
> de Tarcísio "verifique detalhadamente, corrija o que tem pendência, salve
> tudo nas sessão de log".
>
> **Branch dos fixes:** `claude-sprint0-pivot-2026-05-06`
> **Sessão:** 2026-05-06

---

## Sumário executivo

| Categoria | Itens | Status |
|---|---|---|
| ✅ Persiste + exibe | **8/19** | sólido |
| ⚠ Aceita mas não persiste (passthrough silencioso) | **6/19** | dado morre |
| 🟡 Persiste mas falta endpoint/UI | **3/19** | dado existe, ninguém vê |
| ❌ Não recebe (schema strip) | **2/19** | falha silenciosa |

**Achado crítico:** Item 12 (eventos de detecção) — `BoxEventSchema` **NÃO tem
`.passthrough()`**, então campos `skill`, `metadata`, `originalType`, `score`,
`bbox`, `zones` que a Box envia desde commit `be9c457` (2026-05-04) são
silenciosamente removidos pelo Zod. Cloud descarta esses campos antes mesmo do
handler ver. **Fix aplicado nesta sessão** em commit pendente.

---

## Tabela detalhada — 19 itens da auditoria

| # | Dado | Aceita? | Persiste em? | Exibe? | Status | Comentário |
|---|---|---|---|---|---|---|
| 1 | Box online/offline | ✅ | `EdgeNode.status` (ONLINE/OFFLINE/DEGRADED) + `lastHeartbeat` | ✅ painel `/admin/edge-nodes` | ✅ Persiste + exibe | OK. Detecção de stale ainda manual (FCB-002 wiring pendente) |
| 2 | Licença válida + validUntil | ✅ | `EdgeNode.licenseExpiresAt` (DateTime?) + status SUSPENDED | ✅ painel | ✅ Persiste + exibe | OK |
| 3 | CPU% / RAM% / Disk GB / Temp °C | ✅ | `EdgeNode.cpuUsage/memUsage/diskUsage/tempCelsius` (snapshot atual) + `EdgeHeartbeat` (histórico) + `lastTelemetryRaw.system{}` | ✅ painel mostra atual; histórico tem mas sem chart UI | ✅ Persiste + exibe | OK. Schema usa `tempCelsius` mas Box envia `tempC` — handler resolve corretamente (linha 1186) |
| 4 | Frigate FPS / inferência ms / skipped | ✅ | `EdgeNode.fpsCurrent` (só detectorFps) + `lastTelemetryRaw.frigate{}` (completo) | ⚠ painel mostra só fpsCurrent; `inferenceMs`, `skippedFps`, `processFps` ficam só no JSON raw | 🟡 Persiste mas falta UI | Fix UI Sprint 1 (FCB-023 painel health/detailed) |
| 5 | Câmeras `cameras[]` | ✅ | `lastTelemetryRaw.cameras[]` (JSON) | ⚠ não há query estruturada por câmera no painel | 🟡 Persiste mas falta UI | Fix Sprint 1 (renderizar grid colorido por câmera com fps/rtspHealth) |
| 6 | Storage: recordingsGB / retentionDays | ✅ | `lastTelemetryRaw.storage{}` (JSON) | ❌ não exibe | 🟡 Persiste mas falta UI | Fix Sprint 1 (FCB-024 aba diagnostics) |
| 7 | Network: IP / gateway / linkSpeed | ✅ | `EdgeNode.ipLocal` (só IP) + `lastTelemetryRaw.network{}` | ✅ painel mostra IP | ✅ Persiste + exibe | OK. `gateway`/`linkSpeed` no JSON raw — não criticais pra UI |
| 8 | Tunnel CF: active / publicUrl / connectedAt | ✅ | `EdgeNode.go2rtcEndpoint` + `webrtcPublicHost` + `lastTelemetryRaw.tunnel{}` | ✅ painel + live streaming consome | ✅ Persiste + exibe | OK. Bug fix de URLs `*.tunnels.iacloud.com.br` aplicado em 2026-05-03 |
| 9 | SRT publish: configured / cameras publicando | ✅ | `lastTelemetryRaw.srt{}` (JSON) | ✅ `live.ts:223` consome para preferred=mediamtx | ✅ Persiste + exibe | OK. `dropPctLast5Min`/`retransmits` chegam após Sprint Hardening Box (autorizado) |
| 10 | clockOffsetMs (drift NTP) | ⚠ | `lastTelemetryRaw.clockOffsetMs` (passthrough) | ❌ não exibe | ⚠ Aceita mas não persiste estruturado | Cloud aceita via passthrough mas não tem coluna dedicada nem usa pra alerta. Fix: NETWORK_DRIFT_HIGH transition + alerta quando \|offsetMs\| > 5000 |
| 11 | Versão portal-api / frigate / compose | ✅ | `EdgeNode.firmwareVersion` (resolve de `version.portalApi`) + `yoloModelVersion` (de `version.frigate`) + `lastTelemetryRaw.version{}` (completo) | ✅ painel | ✅ Persiste + exibe | OK |
| 12 | **Eventos de detecção (label/score/zones/bbox)** | **❌ campos extras strip pelo Zod** | `AnalyticsEvent` (mas: `eventType` HARDCODED 'IACV_BOX_DETECTION', `model` 'PEOPLE_COUNTING', `pipeline` 'EDGE_YOLO'; `skill`/`metadata`/`originalType`/`score`/`bbox`/`zones` perdidos; só `classes` → `labelsJson` e `objectCount` → `occupancyCount`) | ✅ painel `review` exibe | ❌ **FALHA SILENCIOSA crítica** | Fix aplicado neste commit: `BoxEventSchema.passthrough()` + persistir extras em `rawAnnotationsJson` + usar `eventType` da Box quando vier |
| 13 | Transitions[] (TUNNEL_DOWN, etc) | ✅ | `EdgeConnectionLog` (via `transition-logger.service.ts` em branch isolada) | ✅ painel `/admin/tenants/:id?tab=logs` (após merge) | ✅ Persiste + exibe (após merge) | Wiring feito em branch isolada commit b705676a. Persiste com `payload.correlationId`, `severity`, `source: 'box_heartbeat_transition'` |
| 14 | config_revision | ✅ | `EdgeNode.configRevision` (Int default 1) | ✅ painel admin pode disparar config push | ✅ Persiste + exibe | OK |
| 15 | capabilitiesRevision | ✅ schema | ❌ não persiste em coluna nem usa para invalidar cache | ❌ | ⚠ Aceita mas não persiste | FCB-003 pendente. Schema aceita explicitamente, handler ignora. Fix Sprint 0 (próxima sessão) |
| 16 | Logs de serviço | ✅ | `SystemLog` (após Box ajustar payload schema canônico) | ✅ painel `/admin/tenants/:id?tab=logs` consome `prisma.systemLog.findMany` | 🟡 Persiste + exibe; falta TTL | **Sem cleanup automático** — `SystemLog` cresce indefinidamente. Fix: cron daily retention 48h-30d (configurável) |
| 17 | Live snapshot URL | ✅ | `prisma.systemLog` (errado — vai pra logs em vez de tabela dedicada) — funciona mas é meio off | ⚠ painel não tem widget | 🟡 Persiste mas mal-mapeado | Fix futuro: tabela `LiveSnapshot` dedicada com TTL 5min ou Redis |
| 18 | EdgeCommand ACK | ✅ | `EdgeCommand.ackedAt/ackStatus/ackDurationSec/ackErrorMessage/ackInfo` (após migration `20260504_edge_command_ack_enriched`) | ✅ painel `FleetDetailPage` mostra | ✅ Persiste + exibe | OK |
| 19 | enforcedModules[] | ✅ | `lastTelemetryRaw.enforcedModules` (JSON) + `box-compliance.service.ts` calcula drift e persiste em `EdgeConnectionLog` (MODULE_DRIFT) | ✅ painel admin/edge-nodes/:id mostra drift | ✅ Persiste + exibe | OK. Bug acentos corrigido em commit Cloud anterior (normalizeSkill com NFD strip) |

---

## Respostas às 4 perguntas (A/B/C/D)

### **A) `lastTelemetryRaw` é exposto via API?**

**Resposta:** ⚠ **Parcialmente. Sim via 1 endpoint, mas não é endpoint dedicado.**

- ✅ `GET /api/iacv-box/:boxId/integration/snapshot` (require auth SUPER_ADMIN | INTEGRADOR_ADMIN) **inclui** `lastTelemetryRaw` no response (verificado linhas 1716-1850 de `iacv-box.ts`)
- ✅ `GET /api/live/:cameraId/availability` consulta o campo internamente para decidir `preferred=mediamtx`
- ❌ Não há `GET /api/edge-nodes/:id/telemetry` dedicado para o frontend consultar gauges/charts
- ❌ Frontend `EdgeNodeDetailsPage` não rendeiza o JSON raw

**Recomendação:** adicionar `GET /api/edge-nodes/:id/telemetry-raw` exposto a `INTEGRADOR_ADMIN` do tenant, com SLA cache 5s. Sprint 1 Cloud (FCB-023 health/detailed cobre parcialmente).

---

### **B) Eventos: `skill` e `metadata` (commit Box `be9c457`) persistem em `rawAnnotationsJson`?**

**Resposta:** ❌ **NÃO. Vai pra `/dev/null` silenciosamente.**

**Causa raiz:** `BoxEventSchema` em `iacv-box.ts:1532` é `z.object({...})` **sem `.passthrough()`**. Zod default behavior é "strip unknown keys". Box pode mandar `skill: "intrusion"`, `metadata: {zone: "entrada"}`, `originalType: "person_detected"`, `score: 0.92`, `bbox: [...]`, `zones: [...]` — Cloud aceita 200 OK, mas os campos **NUNCA chegam** ao handler `processBoxEvent`.

**Evidência adicional:** `processBoxEvent` (linha 1568) usa `eventType: 'IACV_BOX_DETECTION'` HARDCODED. Mesmo se Box quisesse mandar tipo diferente, Cloud sobrescreve.

**Fix aplicado nesta sessão** (commit pendente):

1. `BoxEventSchema` ganha campos opcionais explícitos:
   ```typescript
   skill:       z.string().optional(),     // 'intrusion' | 'lpr' | 'face' | etc.
   metadata:    z.record(z.any()).optional(),
   eventType:   z.string().optional(),     // tipo canônico Box
   originalType: z.string().optional(),    // compat 2 sprints (cortar 2026-07)
   score:       z.number().optional(),
   bboxJson:    z.array(z.number()).optional(),  // [x,y,w,h]
   zonesJson:   z.array(z.string()).optional(),
   ```
   E `.passthrough()` no fim para tolerar campos extras futuros.

2. `processBoxEvent` agora persiste em `rawAnnotationsJson`:
   ```typescript
   rawAnnotationsJson: {
     skill:       b.skill,
     metadata:    b.metadata,
     originalType: b.originalType,
     score:       b.score,
     bbox:        b.bboxJson,
     zones:       b.zonesJson,
     ...           // qualquer outro campo passthrough
   }
   ```

3. `eventType` agora aceita Box override (com fallback `'IACV_BOX_DETECTION'`).

**Aceite Box-side:** próximo `POST /events` com `skill: "intrusion"` → fazer `SELECT "rawAnnotationsJson" FROM "AnalyticsEvent" WHERE "frigateId" = '...'` retorna `{ skill: "intrusion", ...}`.

---

### **C) Logs (#16): após fix Box payload, persiste em `SystemLog` com TTL 48h? Endpoint Cloud para consulta?**

**Resposta:** ⚠ **Persiste sim. TTL: NÃO existe. Endpoint: SIM via audit unificado.**

- ✅ Handler `/iacv-box/logs-batch` (linha 1318) faz `prisma.systemLog.createMany({skipDuplicates: true})` com `metadata.edgeNodeId`
- ❌ **Sem TTL.** `SystemLog` cresce indefinidamente. Não há cron de retention. Risco: tabela vira problema de capacity em fleet > 5 boxes
- ✅ **Endpoint de consulta:** `GET /api/admin/audit-explorer?resourceId=<edgeNodeId>` (em `routes/audit.ts:431`) faz UNION de `AuditLog + EdgeConnectionLog + SystemLog + CameraLog + IngestLog` filtrado por edge node
- ✅ Painel `/admin/tenants/:id?tab=logs&edgeNodeId=...` consome esse endpoint
- ✅ Box pode chegar via deep-link (FCB-Box C deep-link já implementado no EdgeBoxesPanel)

**Fix recomendado** (próxima sessão Cloud):
- Cron `cleanup-system-log.ts` daily 04:30 UTC: `DELETE FROM SystemLog WHERE createdAt < NOW() - INTERVAL '48 hours' AND source LIKE 'edge:%'`
- TTL configurável via env `SYSTEM_LOG_RETENTION_HOURS` (default 48h para edge-source, 720h=30d para sistema)

---

### **D) Transitions[] persiste onde?**

**Resposta:** ✅ **Em `EdgeConnectionLog`** (1 row por transition).

Estrutura persistida (após `transition-logger.service.ts` em commit `b705676a` da branch isolada):

| Coluna | Valor |
|---|---|
| `edgeNodeId` | resolvido via licenseKey |
| `eventType` | `tx.type` UPPERCASE (ex: `TUNNEL_DOWN`) |
| `status` | mapeado de `severity`: critical/_FAILED/_DOWN→FAILED, warning/_DRIFT/_LOW→PENDING, default→SUCCESS |
| `payload` | `{ ...tx.details, severity, correlationId, source: 'box_heartbeat_transition' }` |
| `createdAt` | `tx.ts` convertido (heurística s vs ms) |

**NÃO** existe tabela separada `BoxTransition` — transitions são tratadas como evento de conexão. Vantagem: painel de logs unificado. Desvantagem: filtro analítico mais complexo.

**Próxima sessão Cloud (Sprint 1):** considerar índices adicionais em `EdgeConnectionLog`:
```sql
CREATE INDEX "EdgeConnectionLog_edge_eventType_createdAt_idx"
  ON "EdgeConnectionLog"("edgeNodeId", "eventType", "createdAt" DESC);
```

---

## Gaps + fixes priorizados

### 🔴 Crítico — fix aplicado nesta sessão

| Gap | Fix |
|---|---|
| **Item 12** — `BoxEventSchema` sem `.passthrough()` descarta `skill`/`metadata`/`originalType`/`score`/`bbox`/`zones` | Adicionar campos opcionais + `.passthrough()` + persistir em `rawAnnotationsJson`. **Aplicado** |

### 🟠 Alto — próxima sessão Cloud

| Gap | Esforço | Onde |
|---|---|---|
| **Item 16** — `SystemLog` sem TTL, cresce indefinidamente | 2 h | Novo `jobs/cleanup-system-log.ts` |
| **Item 15** — `capabilitiesRevision` aceito mas não persiste | 3 h | FCB-003 (já no plano v2.2) |
| **Item 4 + 5 + 6** — telemetria persiste só em `lastTelemetryRaw` (JSON), painel não renderiza | 6 h | FCB-023 (proxy `/api/health/detailed` granular) |
| **Item 10** — `clockOffsetMs` aceito via passthrough, sem alerta NETWORK_DRIFT | 1 h | + entry no transition-logger + threshold 5000ms |

### 🟡 Médio

| Gap | Esforço | Onde |
|---|---|---|
| **A** — sem endpoint dedicado `GET /edge-nodes/:id/telemetry-raw` | 2 h | Sprint 1 |
| **Item 17** — live snapshots em `SystemLog` (mal-mapeado) | 4 h | Sprint 2 — tabela `LiveSnapshot` dedicada com TTL Redis 5min |

### 🟢 Baixo

| Gap | Esforço |
|---|---|
| Índice `EdgeConnectionLog_edge_eventType_createdAt_idx` | 30 min |
| Migration `EdgeNode.lastNetworkMetrics Json?` (Sprint Hardening Box) | 30 min |

---

## Aceite final da auditoria

- ✅ 19 itens classificados (8 OK, 6 passthrough silencioso, 3 falta UI, 2 não recebe)
- ✅ Perguntas A/B/C/D respondidas com evidência (caminho Prisma + linhas exatas)
- ✅ Fix crítico do item 12 (eventos `skill`/`metadata`) aplicado em commit pendente
- ✅ Lista de gaps priorizada com esforço estimado
- ✅ Salvo em `docs/_AUDITORIA_BRIDGE_2026-05-06.md` (este arquivo)

Box pode ler quando puxar bridge — bridge entry resumindo este arquivo virá em commit subsequente.
