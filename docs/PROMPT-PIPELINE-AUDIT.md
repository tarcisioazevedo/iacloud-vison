# Prompt — Auditoria de Runtime do Pipeline de Gravação

Use este prompt para investigar discrepâncias entre o que o código mostra e o que está
rodando em produção. Cole-o diretamente no Claude Code.

---

## PROMPT

```
Faça uma auditoria completa do pipeline de gravação deste projeto.

Objetivo: encontrar discrepâncias entre o que o CÓDIGO mostra e o que está
REALMENTE configurado/rodando. Não invente — leia os arquivos e mostre
evidências exatas (arquivo:linha).

---

### BLOCO 1 — Variáveis de ambiente críticas

Para cada variável abaixo, informe:
  A) O default no código (arquivo:linha)
  B) O valor em docker-stack.yml (linha)
  C) Se há divergência entre A e B
  D) Se o valor não está no stack (rodará com default de código)

Variáveis a checar (todas em vsaas-backend):

PIPELINE DE GRAVAÇÃO:
  RECORDING_SEGMENT_SECONDS  (default 6 no código)
  RECORDING_RECONCILE_MS     (default 30000)
  RECORDING_POLL_MS          (default 4000)
  RECORDING_ENABLED          (default true)
  RECORDING_RETENTION_MS     (default 3600000)
  RECORDING_MAX_UPLOAD_ATTEMPTS
  RECORDING_RETRY_MS
  RECORDING_RETRY_BATCH
  RECORDING_DELETE_LOCAL_AFTER_S3
  RECORDINGS_BASE_PATH       (default /recordings)
  MOTION_GATE_ENABLED
  MOTION_GATE_GRACE_MS       (default 300000 = 5min)
  MOTION_GATE_TICK_MS
  MOTION_GATE_BATCH_SIZE

FFMPEG:
  FFMPEG_BIN                 (default 'ffmpeg')
  FFPROBE_BIN
  FFPROBE_TIMEOUT_MS
  FFPROBE_CACHE_TTL_MS

GO2RTC / INGEST:
  GO2RTC_RTSP_URL            (default rtsp://go2rtc:8554)
  GO2RTC_API_URL
  GO2RTC_YAML_SYNC
  RTMP_INGEST_HOST
  RTMP_INGEST_PORT
  RTMP_INGEST_SYNC_MS

TMPFS / STORAGE:
  TMPFS_WATCHDOG_ENABLED
  TMPFS_WARN_PCT
  TMPFS_PAUSE_PCT
  TMPFS_RESUME_PCT
  TMPFS_WATCHDOG_TICK_MS
  RECORDINGS_BASE_PATH

JOBS / BACKGROUNDS:
  BACKGROUND_JOBS_ENABLED
  STALE_EDGE_CHECK_INTERVAL_SEC
  STALE_EDGE_DEGRADE_AFTER_MIN
  STALE_EDGE_OFFLINE_AFTER_MIN
  SPRITE_BACKFILL_ENABLED
  SPRITE_BACKFILL_INTERVAL_SEC
  SPRITE_BACKFILL_SINCE_DAYS
  STORAGE_TIER_TAGGER_ENABLED
  STORAGE_BILLING_DISABLED
  STORAGE_RECONCILIATION_DISABLED

---

### BLOCO 2 — Bugs estruturais conhecidos

Verifique e confirme (PRESENTE / CORRIGIDO / NÃO ENCONTRADO):

2.1 MIDNIGHT CRASH (recording.service.ts)
  Pergunta: `ensureDir` é chamado apenas com a data de hoje no momento do spawn?
  Se sim: ffmpeg colapsa à meia-noite UTC quando o diretório do dia seguinte não existe.
  Arquivo: vsaas-backend/src/services/recording.service.ts
  Procure por: ensureDir + new Date().toISOString()
  Fix esperado: criar também o diretório de amanhã, ou agendar re-criação antes de 00:00 UTC.

2.2 hasMotion NUNCA TRUE (cloud cameras)
  Pergunta: `hasMotion` é sempre inicializado como false no CREATE do RecordingSegment?
  Existe algum worker/job automático que detecte motion e chame markSegmentMotion()?
  Arquivo: vsaas-backend/src/services/recording.service.ts e cloud-direct-recorder.service.ts
  Procure por: inferredMotion, hasMotion, markSegmentMotion

2.3 RETROACTIVE SNAPPING ativo?
  Pergunta: o bloco de snapping que ajusta endedAt do segmento anterior existe nos dois serviços?
  Arquivo: recording.service.ts e cloud-direct-recorder.service.ts
  Procure por: gapMs, snapPrev, endedAt: startedAt

2.4 DOUBLE UPLOAD (cloud-direct)
  Pergunta: o mesmo arquivo .ts pode ser processado tanto pelo handler CSV (stdout)
  quanto pelo pollSegments() timer?
  Se sim: há deduplicação? (fs.rename protege? storagePath único?)
  Arquivo: cloud-direct-recorder.service.ts

2.5 CRASH LOOP BACKOFF
  Pergunta: qual é o CRASH_THRESHOLD_MS e o backoff máximo?
  Uma câmera que crasha toda meia-noite acumula backoff entre reinicializações?
  O backoff é resetado quando a câmera volta ao normal?
  Arquivo: recording.service.ts e cloud-direct-recorder.service.ts

2.6 SEGMENT CSV vs POLL — durationSec
  Pergunta: quando o pollSegments() faz upload do último segmento (flush final ao sair),
  ele passa durationSecOverride? Ou usa SEGMENT_SEC como fallback?
  Se fallback: o último segmento de cada sessão tem durationSec errado no DB?

2.7 TIMEZONE DO ensureDir
  Pergunta: o ensureDir de cloud-direct-recorder usa data local ou UTC para o diretório?
  Pode haver divergência entre o path do arquivo e o storagePath no DB à meia-noite?

---

### BLOCO 3 — Consistência do manifest HLS

3.1 EXT-X-PROGRAM-DATE-TIME
  Pergunta: o manifest HLS gerado em /playback/:id/hls inclui a tag
  #EXT-X-PROGRAM-DATE-TIME para cada segmento?
  Sem ela, o player não consegue ancorar o vídeo ao wall-clock real.
  Arquivo: vsaas-backend/src/services/playback.service.ts ou routes/playback.ts

3.2 EXT-X-DISCONTINUITY
  Pergunta: existe inserção de #EXT-X-DISCONTINUITY entre segmentos com gap > threshold?
  Sem ela, o player pode travar ao cruzar um gap real.

3.3 TARGETDURATION
  Pergunta: #EXT-X-TARGETDURATION é calculado como max(durationSec) dos segmentos?
  Se for hardcoded em SEGMENT_SECONDS, pode estar defasado quando o CSV mede duração real.

3.4 reset_timestamps
  Pergunta: o ffmpeg usa `-reset_timestamps 1` nos argumentos?
  Sem ele, os PTS dos segmentos são contínuos (não reiniciam em 0), o que pode
  causar seek incorreto em alguns players HLS.
  Arquivo: recording.service.ts e cloud-direct-recorder.service.ts args list

---

### BLOCO 4 — Estado do DB vs código

4.1 SCHEMA MIGRATION PENDENTE
  Rode: npx prisma migrate status (ou leia saída do último deploy)
  Há migrations não aplicadas que adicionem campos usados no código?

4.2 CAMPOS USADOS NO CÓDIGO MAS NÃO NO SCHEMA
  Procure por campos acessados via `(cam as any)?.` ou cast forçado que sugira
  campo não tipado no schema.

4.3 ÍNDICES CRÍTICOS PARA O PIPELINE
  O RecordingSegment tem índice em (cameraId, startedAt)?
  Sem ele, a query de retroactive snapping (findFirst orderBy startedAt desc) é full scan.
  Arquivo: prisma/schema.prisma

---

### BLOCO 5 — Serviços dependentes

5.1 go2rtc acessível?
  O backend consegue alcançar GO2RTC_API_URL e GO2RTC_RTSP_URL?
  Há health check no startup?

5.2 R2/S3 configurado?
  RECORDING_DELETE_LOCAL_AFTER_S3 está ativo?
  Se sim e o upload falhar, o arquivo local é deletado mesmo assim?
  Arquivo: recording.service.ts e cloud-direct-recorder.service.ts — seção de upload

5.3 TMPFS cheio = gravação para
  TMPFS_WATCHDOG_ENABLED está ativo no stack?
  Se não: tmpfs pode encher sem alertar e matar gravação silenciosamente.

---

### OUTPUT ESPERADO

Para cada item: STATUS + arquivo:linha + evidência textual do código.
Não resuma sem evidência. Se não encontrar, diga explicitamente "não encontrado".
Ao final: tabela resumo com todos os STATUS em ordem de severidade.
```
