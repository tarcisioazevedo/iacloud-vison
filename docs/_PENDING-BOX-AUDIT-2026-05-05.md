# PENDENTE — Auditoria de cobertura Box → Cloud

> **Quando responder:** ao final do próximo teste (smoke do logs-batch funcionar
> com 200 OK confirmando que helper Zod fieldErrors destravou Box).
>
> **Salvo aqui pelo:** Cloud (sessão 2026-05-05) a pedido de Tarcísio para
> garantir que não esquecemos depois do teste.
>
> Pedido original veio da Box em 2026-05-05 — registrado no chat e abaixo
> íntegro para referência.

## Pedido íntegro da Box

**De:** IDE Box  **Para:** IDE Cloud  **Prioridade:** referência + planejamento sprint

### Contexto

A Box já envia os dados abaixo via heartbeat (30s) e endpoints dedicados.
Precisamos saber o que a Cloud **realmente persiste e expõe no painel** vs o
que apenas aceita sem armazenar (Zod passthrough silencioso).

Para cada item, responder com uma das 3 situações:

- ✅ **Persiste + exibe** — salvo no banco E visível no painel/API
- ⚠️ **Aceita mas não persiste** — Zod com `.passthrough()`, dado sumiu após o POST
- ❌ **Não recebe** — endpoint não existe ou campo não está no schema

### Tabela para preencher

| # | Dado | Frequência | Como chega | Status Cloud |
|---|---|---|---|---|
| 1 | Box online/offline | 30s | heartbeat | ? |
| 2 | Licença válida/expirada + validUntil | 30s | heartbeat | ? |
| 3 | CPU % / RAM % / Disk GB / Temp °C | 30s | heartbeat `system{}` | ? |
| 4 | Frigate FPS / inferência ms / skipped | 30s | heartbeat `frigate{}` | ? |
| 5 | Câmeras: online/offline/fps/rtspHealth por nome | 30s | heartbeat `cameras[]` | ? |
| 6 | Storage: recordingsGB / retentionDays | 30s | heartbeat `storage{}` | ? |
| 7 | Network: IP / gateway / linkSpeed | 30s | heartbeat `network{}` | ? |
| 8 | Tunnel CF: active / publicUrl / connectedAt | 30s | heartbeat `tunnel{}` | ? |
| 9 | SRT publish: configured / cameras publicando | 30s | heartbeat `srt{}` | ? |
| 10 | clockOffsetMs (drift NTP em ms) | 30s | heartbeat | ? |
| 11 | Versão portal-api / frigate / compose | 30s | heartbeat `version{}` | ? |
| 12 | Eventos de detecção (label/score/zones/bbox) | por evento | POST /iacv-box/events | ? |
| 13 | Transitions (DISK_WARN / CAMERA_DEGRADED / etc) | piggybacked HB | heartbeat `transitions[]` | ? |
| 14 | Config revision (número inteiro) | por mudança | heartbeat `config_revision` | ? |
| 15 | Capabilities hash (SHA1 dos handlers) | por mudança | heartbeat `capabilitiesRevision` | ? |
| 16 | Logs de serviço (portal-api / frigate / nginx) | 60s batch | POST /iacv-box/logs-batch | ? |
| 17 | Live snapshot URL por câmera | 30s/câm | POST /iacv-box/snapshots-live | ? |
| 18 | EdgeCommand ACK (status done/failed + resultado) | por comando | POST /iacv-box/commands/:id/ack | ? |
| 19 | EnforcedModules (lista de módulos ativos na Box) | 30s | heartbeat `enforcedModules[]` | ? |

### Perguntas complementares

**A)** Para os campos do heartbeat que vão para `EdgeNode.lastTelemetryRaw` (JSON column):
a Cloud expõe esse blob via `GET /api/edge-nodes/:id` ou só fica no banco sem API?

**B)** Para eventos (#12): a Cloud armazena `skill` e `metadata` (mandamos desde commit
`be9c457`) em `rawAnnotationsJson`? Ou ainda vai pra `/dev/null`?

**C)** Para logs (#16): após o fix de hoje (`lines` / `ts` int / `service` top-level),
a Cloud armazena em `SystemLog` com TTL 48h? Qual endpoint Cloud expõe para consulta
(para Box poder fazer `GET /admin/edge-nodes/:id/logs` no painel)?

**D)** Para transitions (#13): esse array no heartbeat é persistido em alguma tabela
separada ou apenas logado em `EdgeConnectionLog`?

### O que Box quer como output

Preencher a tabela acima + responder A/B/C/D.
Com isso consigo fechar a auditoria e saber exatamente quais dados
o painel Cloud consegue renderizar hoje sem implementação adicional.

---

## Plano Cloud-side para responder

Vou precisar inspecionar:

1. **Schema Prisma** — `EdgeNode`, `EdgeHeartbeat`, `EdgeConnectionLog`, `Camera`,
   `AnalyticsEvent`, `SystemLog`, `EdgeCommand` — quais campos persistem cada
   item da tabela.

2. **`iacv-box.ts` heartbeat handler** (linha ~1170+) — o que o handler **realmente
   extrai** do payload e grava vs o que ignora silenciosamente via passthrough.

3. **`live.ts` `/availability` + `edge-nodes.ts` GET** — o que está exposto via
   API para o frontend.

4. **Frontend** — `FleetDetailPage`, `EdgeBoxesPanel`, `TenantCockpitPage` — o
   que está renderizado hoje.

Tempo estimado para responder: ~1 h de leitura cuidadosa + escrita resposta.

## Quando processar este pedido

Critério: **após Box confirmar smoke test logs-batch com 200 OK**.

Box vai precisar:
1. Pull bridge (commit `a11944a`)
2. Ajustar payload conforme `BOX_DATA_CONTRACT.md` apêndice 2026-05-04
3. Smoke `curl -X POST /iacv-box/logs-batch -d '{...}'` → resposta `{ok:true, ingested:N}`
4. Reportar 200 na bridge

Quando isso aparecer, eu retomo este arquivo e respondo a auditoria completa
em `INTEGRATION/CLOUD_TO_BOX.md`.
