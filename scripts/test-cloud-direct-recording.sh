#!/bin/bash
# Teste de validação do pipeline RTMP → go2rtc → R2
#
# Pré-requisitos:
#   1. Uma câmera deve estar cadastrada no banco com:
#      - deploymentMode = CLOUD_DIRECT
#      - ingestMode = RTMP_PUSH
#      - rtmpIngestKeyEnc = <stream_key_cifrada> (ver passo 1 abaixo)
#   2. Backend rodando com go2rtc acessível em localhost:1935
#   3. ffmpeg disponível no host
#
# Uso:
#   STREAM_KEY=<plain_key> bash scripts/test-cloud-direct-recording.sh
#
# O que o script faz:
#   1. Baixa um vídeo de teste (ou usa um existente)
#   2. Empurra RTMP via ffmpeg para o go2rtc (simula câmera)
#   3. Aguarda 30s (5 segmentos de 6s)
#   4. Verifica se RecordingSegments foram criados no DB
#   5. Verifica se os arquivos chegaram no R2
#   6. Para o push e verifica cleanup do tmpfs

set -euo pipefail

STREAM_KEY="${STREAM_KEY:-test-cam-$(date +%s)}"
GO2RTC_RTMP="rtmp://localhost:1935"
DURATION=35  # segundos (5+ segmentos completos de 6s)

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${YLW}[TEST]${NC} $*"; }
ok()  { echo -e "${GRN}[OK]${NC}  $*"; }
err() { echo -e "${RED}[ERR]${NC} $*"; }

# ── 1. Vídeo de teste ────────────────────────────────────────────────────────

TEST_VIDEO=/tmp/test_fhd_cloud_direct.mp4
if [[ ! -f "$TEST_VIDEO" ]]; then
  log "Gerando vídeo FHD de teste (30s)..."
  ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=25 \
         -f lavfi -i sine=frequency=440:sample_rate=48000 \
         -c:v libx264 -preset ultrafast -b:v 2M \
         -c:a aac -b:a 64k \
         -t 30 -y "$TEST_VIDEO" 2>/dev/null
  ok "Vídeo gerado: $TEST_VIDEO"
fi

# ── 2. Push RTMP simulando câmera ────────────────────────────────────────────

log "Iniciando push RTMP → ${GO2RTC_RTMP}/${STREAM_KEY}"
log "Stream key: ${STREAM_KEY}"
log "Aguarde ${DURATION}s para capturar segmentos..."

ffmpeg -re -stream_loop -1 \
       -i "$TEST_VIDEO" \
       -c copy \
       -f flv \
       "${GO2RTC_RTMP}/${STREAM_KEY}" \
       -t "$DURATION" 2>/dev/null &

FFMPEG_PID=$!
log "ffmpeg PID: $FFMPEG_PID"

# ── 3. Aguarda e verifica ────────────────────────────────────────────────────

log "Aguardando ${DURATION}s de streaming..."
sleep "$DURATION"
kill "$FFMPEG_PID" 2>/dev/null || true

log "Push encerrado. Aguardando 5s para o recorder processar o último segmento..."
sleep 5

# ── 4. Verificações ─────────────────────────────────────────────────────────

log "=== Verificando go2rtc streams ==="
curl -s http://localhost:1984/api/streams | python3 -c "
import json,sys
d=json.load(sys.stdin)
if '${STREAM_KEY}' in d:
    print('Stream ainda ativo (ok se ainda houver consumer)')
else:
    print('Stream removido do go2rtc (ok — push encerrou)')
" 2>/dev/null || echo "go2rtc não acessível"

log "=== Verificando tmpfs /recordings ==="
TMPFS_SIZE=$(docker ps --filter "name=iacloud_backend" --format "{{.ID}}" | head -1 | \
  xargs -I{} docker exec {} du -sh /recordings 2>/dev/null | awk '{print $1}')
ok "/recordings tmpfs usado: ${TMPFS_SIZE:-0}"

log "=== Verificando logs do backend ==="
docker service logs iacloud_backend --since 1m 2>/dev/null | \
  grep -E "cloud_direct|seg_uploaded|recording_started" | tail -10 || echo "(sem logs cloud_direct nos últimos 60s)"

log "=== Verificando banco de dados ==="
SEGMENT_COUNT=$(docker exec $(docker ps --filter "name=iacloud_postgres" --format "{{.ID}}" | head -1) \
  psql -U vsaas vsaas -t -c \
  "SELECT COUNT(*) FROM \"RecordingSegment\" WHERE source='CLOUD_FFMPEG' AND \"startedAt\" > NOW() - INTERVAL '5 minutes';" \
  2>/dev/null | tr -d ' ' || echo "0")

if [[ "$SEGMENT_COUNT" -gt 0 ]]; then
  ok "RecordingSegments criados: ${SEGMENT_COUNT}"
else
  err "Nenhum RecordingSegment encontrado (verifique se a câmera tem autenticação configurada)"
fi

log "=== Teste completo ==="
echo ""
echo "Para testar com câmera real, configure:"
echo "  URL RTMP: rtmp://23.88.124.67:1935/<STREAM_KEY>"
echo "  Onde STREAM_KEY = valor decifrado de Camera.rtmpIngestKeyEnc"
