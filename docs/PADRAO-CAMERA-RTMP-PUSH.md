# Padrão Operacional — Câmera RTMP/SRT Push (Cloud Direct)

> **Status:** ✅ Padrão **homologado** com Cam 2 (RTMP test) e Câmera Mobile Larix.
> Fluidez magnífica observada em produção 2026-05-20.
> Use este documento como **gabarito** para cadastrar novas câmeras.

---

## Por que este padrão funciona bem

- **Pull-side mínimo**: a câmera **empurra** o vídeo (RTMP ou SRT) pra cloud. Não precisamos abrir porta na rede do cliente.
- **MediaMTX republica** o stream em RTSP interno (porta 8556) e WebRTC (porta 8889) sem reencode.
- **AI worker** consome o RTSP republicado (mesmo nó, latência ~zero).
- **Frontend** consome WHEP do MediaMTX direto (ICE candidate-pair UDP).
- Sem transit por túneis CF, sem reencode, sem go2rtc no caminho de mídia.

Resultado: **latência live ~300-500ms estável**, sem stutter, sem reconnect loop.

---

## Configuração padrão por câmera

### 1. Endpoints públicos (clientes empurram aqui)

| Protocolo | Endpoint público | Porta | Path pattern |
|---|---|---|---|
| **RTMP** | `rtmp://app.vsaas.com.br:1935/<path>` | 1935/TCP | `live/<nome>` |
| **SRT** | `srt://app.vsaas.com.br:8890?streamid=<path>` | 8890/UDP | qualquer (`<nome-único>`) |

> SRT exige `passphrase` do secret `vsaas_srt_publish_passphrase` (backend retorna em `/iacv-box/srt-config`).

### 2. MediaMTX `paths` (`/mediamtx.yml`)

Para cada câmera **declare um path explícito**:

```yaml
paths:
  # Cam 2 (RTMP_PUSH) — device empurra rtmp://app.vsaas.com.br:1935/live/cam2/<chave>
  "live/cam2":
    source: publisher

  # Câmera Mobile (SRT_PUSH) — Larix empurra srt://app.vsaas.com.br:8890?streamid=test-larix-srt
  "test-larix-srt":
    source: publisher
```

> `source: publisher` = MediaMTX aceita push externo nesse path. Sem `source`,
> MediaMTX rejeita. Para wildcard usar `all_others` no final do arquivo.

### 3. Schema `Camera` no banco

Campos obrigatórios para uma câmera RTMP_PUSH funcionar end-to-end:

```sql
INSERT INTO "Camera" (
  id,
  name,
  active,                  -- true
  status,                  -- 'ACTIVE' (não PENDING_CONFIG)
  "deploymentMode",        -- 'CLOUD_DIRECT'
  "ingestMode",            -- 'RTMP_PUSH' | 'SRT_PUSH'
  "rtspMainUrl",           -- rtsp://mediamtx:8556/<path>      <-- onde AI/recorder puxa
  "go2rtcStreamId",        -- mesmo <path> (sem leading slash)
  "recordEnabled",         -- true
  "recordMode",            -- 'ALL' | 'MOTION'
  "recordRetainDays",      -- 7, 30, 90...
  "aiEnabled",             -- true (se IA habilitada)
  "rtmpIngestLastFrameAt"  -- atualizar via hook do MediaMTX (ver bug aberto abaixo)
)
VALUES ( ... );
```

**Valores de referência (Cam 2 funcionando):**

| Campo | Valor |
|---|---|
| `deploymentMode` | `CLOUD_DIRECT` |
| `ingestMode` | `RTMP_PUSH` |
| `rtspMainUrl` | `rtsp://mediamtx:8556/live/cam2/vsaas2026` |
| `go2rtcStreamId` | `live/cam2/vsaas2026` |
| `recordMode` | `MOTION` |
| `recordRetainDays` | 7 |
| `aiEnabled` | true |
| `status` | **deve ser** `ACTIVE` (não `PENDING_CONFIG`) |

> ⚠ Cam 2 atual está como `PENDING_CONFIG` — não bloqueia IA/live, mas o
> ideal é mover pra `ACTIVE` quando padrão estabilizar.

### 4. URL que o publisher (câmera/Larix/OBS) usa

**RTMP push:**
```
rtmp://app.vsaas.com.br:1935/live/cam2/vsaas2026
```
- Stream key = última parte do path (`vsaas2026`) ou path inteiro, conforme cliente
- Codec recomendado: **H.264 baseline/main, 30fps, GOP 60 (2s), 2-4 Mbps**

**SRT push:**
```
srt://app.vsaas.com.br:8890?streamid=publish:test-larix-srt&passphrase=<from-secret>&latency=200&pkt_size=1316
```
- Latency 200ms (bom para 4G/Wi-Fi); 50-100ms se LAN cabeada
- pkt_size 1316 = MTU UDP sem fragmentação
- Codec mesmo do RTMP

### 5. Recording cloud-direct

`cloud-direct-recorder.service.ts` puxa do `rtspMainUrl` configurado (do MediaMTX local).

**Pré-requisitos verificados no reconcile:**
- `active = true`
- `recordEnabled = true`
- `deploymentMode = CLOUD_DIRECT`
- `ingestMode IN ('RTMP_PUSH', 'SRT_PUSH')`
- `recordingPausedAt IS NULL`
- `rtmpIngestLastFrameAt > NOW() - 30s` ← **gargalo conhecido**

### 6. AI Worker

Não depende do reconcile. Faz `_open_cap` direto via OpenCV/ffmpeg em:
```
rtsp://mediamtx:8556/<path>
```
Não pode usar IP público — usa hostname interno `mediamtx` (Docker DNS overlay).

---

## ⚠ Bug aberto conhecido — `rtmpIngestLastFrameAt`

**Sintoma:** Câmera RTMP_PUSH ativa, IA roda, live funciona, **mas gravação não dispara**.

**Causa raiz:** Não há hook entre MediaMTX e backend que atualize `Camera.rtmpIngestLastFrameAt`
quando o publisher inicia. O recorder filtra esse campo e nunca encontra match.

**Workaround manual (temporário):**
```sql
UPDATE "Camera" SET "rtmpIngestLastFrameAt" = NOW()
WHERE id = '<camera-id>';
```
Cada vez que o publisher reconectar, o campo "envelhece" 30s e a gravação para de novo.

**Fix definitivo (TODO):**
- Configurar `runOnReady` no `mediamtx.yml` do path para hit `POST /internal/mediamtx/path-ready`
- Endpoint backend atualiza `rtmpIngestLastFrameAt = NOW()` periódico (a cada 10s)
- Quando `runOnNotReady` dispara → setar `rtmpIngestLastFrameAt = NULL`

---

## Checklist para cadastrar uma nova câmera RTMP_PUSH

```
[ ] Definir path único (ex: live/loja-norte/abc123)
[ ] Adicionar entrada `paths.<path>: source: publisher` em mediamtx.yml
[ ] Recriar config mediamtx + redeploy mediamtx (rolling update OK)
[ ] INSERT Camera com:
    - deploymentMode = CLOUD_DIRECT
    - ingestMode = RTMP_PUSH
    - rtspMainUrl = rtsp://mediamtx:8556/<path>
    - go2rtcStreamId = <path>
    - active = true, status = ACTIVE
    - recordEnabled, aiEnabled conforme plano
[ ] Configurar publisher (câmera/OBS/Larix) apontando para rtmp://app.vsaas.com.br:1935/<path>
[ ] (Workaround atual) UPDATE rtmpIngestLastFrameAt = NOW() até bug do hook ser resolvido
[ ] Validar: SELECT COUNT(*) FROM "RecordingSegment" WHERE cameraId = X em 2 min
[ ] Validar: chip "IA" verde aparece no LivePlayer da Cam
```

---

## Portas envolvidas (sumário)

| Origem | Destino | Porta | Protocolo | Direção |
|---|---|---|---|---|
| Câmera/publisher | MediaMTX | 1935 | TCP (RTMP) | push entrada |
| Câmera/publisher | MediaMTX | 8890 | UDP (SRT) | push entrada |
| AI worker | MediaMTX | 8556 | TCP (RTSP) | pull interno |
| Recorder cloud-direct | MediaMTX | 8556 | TCP (RTSP) | pull interno |
| Browser (WHEP) | Backend → MediaMTX | 8889 | HTTPS+ICE | live saída |

---

## Commits/arquivos relacionados

- `docker-stack.yml` — services mediamtx, go2rtc, backend, ai_worker
- `vsaas-backend/src/services/cloud-direct-recorder.service.ts` — reconcile recorder
- `vsaas-backend/src/services/recording.service.ts` — outras modalidades de recording
- `vsaas-ai-worker/camera_worker.py` — abertura RTSP pelo worker
- `vsaas-backend/src/routes/iacv-box.ts` — endpoint `/srt-config` (passphrase)

---

**Última revisão:** 2026-05-20 · validado em prod com Cam 2 RTMP + Larix SRT
