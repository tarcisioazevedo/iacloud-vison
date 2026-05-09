#!/bin/bash
# update-go2rtc-config.sh
# Sincroniza go2rtc YAML config com câmeras CLOUD_DIRECT RTMP_PUSH do banco.
# Uso: bash update-go2rtc-config.sh [--dry-run]
# Agendar no cron após criar câmera ou usar diretamente.

set -euo pipefail

DRY_RUN="${1:-}"

# Localiza container postgres
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i 'iacloud_postgres' | head -1)
if [[ -z "$POSTGRES_CONTAINER" ]]; then
  echo "ERROR: container postgres não encontrado"
  exit 1
fi

# Obtém versão atual do config
CURRENT_VERSION=$(docker config ls --format '{{.Name}}' | grep '^go2rtc_config_v' | sort -t v -k 2 -n | tail -1)
if [[ -z "$CURRENT_VERSION" ]]; then
  echo "ERROR: nenhum go2rtc_config_v* encontrado"
  exit 1
fi

CURRENT_NUM=$(echo "$CURRENT_VERSION" | grep -o '[0-9]*$')
NEXT_NUM=$((CURRENT_NUM + 1))
NEXT_NAME="go2rtc_config_v${NEXT_NUM}"

echo "Config atual: $CURRENT_VERSION → próxima: $NEXT_NAME"

# Lê YAML atual do config Docker
CURRENT_YAML=$(docker config inspect "$CURRENT_VERSION" --format '{{json .Spec.Data}}' | \
  python3 -c "import sys,base64; print(base64.b64decode(sys.stdin.read().strip().strip('\"')).decode())")

# Obtém stream keys de câmeras CLOUD_DIRECT RTMP_PUSH do banco
KEYS=$(docker exec "$POSTGRES_CONTAINER" \
  psql -U icvuser -d iacloudvision -t -A \
  -c 'SELECT "go2rtcStreamId" FROM "Camera" WHERE "ingestMode" IN ('"'"'RTMP_PUSH'"'"','"'"'SRT_PUSH'"'"') AND "deploymentMode" = '"'"'CLOUD_DIRECT'"'"' AND active = true AND "go2rtcStreamId" IS NOT NULL' 2>/dev/null || true)

if [[ -z "$KEYS" ]]; then
  echo "Nenhuma câmera RTMP_PUSH ativa encontrada"
  exit 0
fi

echo "Câmeras a registrar:"
echo "$KEYS" | sed 's/^/  /'

# Gera novo YAML substituindo seção streams via Python inline
NEW_YAML=$(echo "$CURRENT_YAML" | python3 -c "
import sys
content = sys.stdin.read()
lines = content.split('\n')
new_lines = []
in_streams = False
for line in lines:
    if line.startswith('streams:'):
        in_streams = True
        continue
    if in_streams:
        if line and not line.startswith(' ') and not line.startswith('#'):
            in_streams = False
            new_lines.append(line)
        continue
    new_lines.append(line)
print('\n'.join(new_lines).rstrip())
")

# Adiciona bloco streams com todas as câmeras.
# Estratégia: array com NULL como único producer pré-registra o nome no
# go2rtc sem bloquear consumers. Quando push real (RTMP/SRT) chegar, vira
# producer índice 1 e MJPEG/WebRTC pegam ele.
#
# Não pode ser source vazio (`cam:`) — go2rtc rejeita.
# Não pode ser placeholder URL (RTSP/exec) — bloqueia consumers no 1.9.x.
# A sintaxe array `cam: [null]` é a workaround conhecida.
STREAMS_BLOCK="streams:"$'\n  # Auto-gerenciado por update-go2rtc-config.sh'
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  STREAMS_BLOCK+=$'\n  '"${key}"': "exec:false"'
done <<< "$KEYS"

# Nota: NÃO adicionamos seção `srt:` aqui — go2rtc 1.9.x não suporta
# SRT nativo. Push SRT vai pro iacloud_mediamtx (porta 8890/UDP) que
# tem implementação SRT robusta + auth via passphrase.
FULL_YAML="${NEW_YAML}

${STREAMS_BLOCK}"

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo ""
  echo "=== DRY RUN — YAML gerado ==="
  echo "$FULL_YAML"
  exit 0
fi

# Cria novo Docker Config
echo "$FULL_YAML" | docker config create "$NEXT_NAME" -
echo "Docker Config criado: $NEXT_NAME"

# Atualiza serviço go2rtc para usar novo config (causa restart ~5s)
docker service update \
  --config-rm "$CURRENT_VERSION" \
  --config-add "source=${NEXT_NAME},target=/config/go2rtc.yaml" \
  iacloud_go2rtc 2>&1 | tail -3

echo "go2rtc atualizado — streams registrados permanentemente"
