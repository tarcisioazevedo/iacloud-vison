#!/usr/bin/env bash
# =============================================================================
# gen-fleet.sh — gera docker-compose.fleet.yml com N pushers RTMP.
#
# Sprint γ-Day2. Cada pusher é um ffmpeg empurrando vídeo de teste pra uma
# stream key distinta. Use pra rodar testes CG10 (50 cams) ou CG11 (200 cams).
#
# Uso:
#   ./gen-fleet.sh <N> <keys-file> [output-file]
#
# keys-file:   1 stream key por linha (output do seed-fake ou criação manual)
# output:      docker-compose.fleet.yml (default)
#
# Exemplo:
#   ./gen-fleet.sh 50 keys.txt
#   docker compose -f docker-compose.fleet.yml up -d
# =============================================================================
set -euo pipefail

N="${1:-}"
KEYS_FILE="${2:-keys.txt}"
OUTPUT="${3:-docker-compose.fleet.yml}"
# Host/porta do ingest — padrão local, override via env
INGEST_HOST="${INGEST_HOST:-localhost}"
INGEST_PORT="${INGEST_PORT:-1935}"

if [[ -z "$N" ]] || [[ ! -f "$KEYS_FILE" ]]; then
  echo "Uso: $0 <N> <keys-file> [output-file]" >&2
  exit 1
fi

mapfile -t KEYS < "$KEYS_FILE"
if [[ "${#KEYS[@]}" -lt "$N" ]]; then
  echo "ERROR: $KEYS_FILE tem ${#KEYS[@]} keys, solicitado $N" >&2
  exit 1
fi

cat > "$OUTPUT" <<HEAD
# Gerado automaticamente por gen-fleet.sh — não editar à mão.
# Ingest: rtmp://${INGEST_HOST}:${INGEST_PORT}/
# Empurra N streams RTMP pra simular câmeras reais.

services:
HEAD

for ((i = 0; i < N; i++)); do
  KEY="${KEYS[$i]}"
  cat >> "$OUTPUT" <<SERVICE
  pusher-$i:
    image: jrottenberg/ffmpeg:7.1-alpine
    restart: unless-stopped
    network_mode: host
    container_name: obs-pusher-$i
    command: >
      -re -stream_loop -1 -f lavfi -i "testsrc2=size=1280x720:rate=15"
      -c:v libx264 -preset veryfast -tune zerolatency
      -profile:v baseline -level 3.1
      -b:v 1200k -maxrate 1200k -bufsize 2M
      -g 30 -keyint_min 30
      -f flv rtmp://${INGEST_HOST}:${INGEST_PORT}/$KEY
SERVICE
done

echo "✓ $OUTPUT gerado com $N pushers"
echo "  Subir:    docker compose -f $OUTPUT up -d"
echo "  Logs:     docker compose -f $OUTPUT logs -f pusher-0"
echo "  Parar:    docker compose -f $OUTPUT down"
