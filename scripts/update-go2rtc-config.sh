#!/usr/bin/env bash
# =============================================================================
# update-go2rtc-config.sh
#
# Sincroniza o go2rtc YAML config com as câmeras CLOUD_DIRECT RTMP_PUSH /
# SRT_PUSH ativas no banco. Cria um novo Docker Config (versão incrementada),
# remove o anterior, e atualiza o service iacloud_go2rtc.
#
# Por que é necessário: go2rtc 1.9.x rejeita push RTMP com `stream not found`
# se o stream key não estiver pré-declarado em `streams:` no YAML. Streams
# adicionadas via PUT /api/streams são evictadas quando o source falha.
# Apenas entradas via Docker Config sobrevivem indefinidamente.
#
# Uso:
#   bash scripts/update-go2rtc-config.sh           # aplica
#   bash scripts/update-go2rtc-config.sh --dry-run # mostra o YAML novo
#
# 2026-05-12: reescrito do zero — versão anterior tinha corrupção
# `s/un/exec:false/g` em todo o arquivo.
# =============================================================================
set -euo pipefail

DRY_RUN="${1:-}"

# --- Localiza container postgres ---------------------------------------------
PG=$(docker ps --format '{{.Names}}' | grep -m1 '^iacloud_postgres' || true)
if [[ -z "$PG" ]]; then
  echo "ERROR: container iacloud_postgres não encontrado" >&2
  exit 1
fi

# --- Versão atual e próxima do Docker Config ---------------------------------
CURRENT=$(docker config ls --format '{{.Name}}' | grep '^go2rtc_config_v' | sort -V | tail -1)
if [[ -z "$CURRENT" ]]; then
  echo "ERROR: nenhum go2rtc_config_v* encontrado" >&2
  exit 1
fi
NEXT_NUM=$(date +%s)
NEXT_NAME="go2rtc_config_v${NEXT_NUM}"
echo "Config atual: $CURRENT → próxima: $NEXT_NAME"

# --- YAML atual --------------------------------------------------------------
CURRENT_YAML=$(docker config inspect "$CURRENT" --format '{{json .Spec.Data}}' \
  | python3 -c "import sys,base64,json; print(base64.b64decode(json.loads(sys.stdin.read())).decode())")

# --- Stream keys ativas no DB ------------------------------------------------
# go2rtcStreamId é o nome do path RTMP. cloud-direct usa ele para resolver
# ingest → cameraId. Filtramos por modo PUSH ativo com key configurada.
KEYS=$(docker exec "$PG" psql -U icvuser -d iacloudvision -t -A \
  -c 'SELECT "go2rtcStreamId" FROM "Camera" WHERE "ingestMode" IN ('"'"'RTMP_PUSH'"'"','"'"'SRT_PUSH'"'"') AND "deploymentMode" = '"'"'CLOUD_DIRECT'"'"' AND active = true AND "go2rtcStreamId" IS NOT NULL' \
  2>/dev/null || true)

if [[ -z "$KEYS" ]]; then
  echo "Nenhuma câmera RTMP_PUSH/SRT_PUSH ativa encontrada"
  STREAMS_BLOCK="streams: {}"
else
  echo "Câmeras a registrar:"
  echo "$KEYS" | sed 's/^/  /'
  STREAMS_BLOCK=$(printf 'streams:\n'; while IFS= read -r k; do
    [[ -z "$k" ]] && continue
    printf '  %s:\n' "$k"
  done <<< "$KEYS")
fi

# --- Substitui bloco streams: ------------------------------------------------
NEW_YAML=$(echo "$CURRENT_YAML" | python3 -c "
import sys, re
content = sys.stdin.read()
block = '''$STREAMS_BLOCK'''
# Remove streams: e tudo depois (assume que streams é a última seção)
new = re.sub(r'^streams:.*\$', '', content, flags=re.MULTILINE | re.DOTALL).rstrip()
print(new + '\n\n' + block + '\n')
")

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "===== Dry run — YAML que seria criado ====="
  echo "$NEW_YAML"
  exit 0
fi

# --- Cria nova Docker Config -------------------------------------------------
echo "$NEW_YAML" | docker config create "$NEXT_NAME" - > /dev/null

# --- Atualiza service: troca config antiga pela nova -------------------------
echo "Atualizando service iacloud_go2rtc..."
docker service update \
  --config-rm "$CURRENT" \
  --config-add "source=$NEXT_NAME,target=/config/go2rtc.yaml" \
  iacloud_go2rtc > /dev/null

echo "OK — $NEXT_NAME aplicado. go2rtc reload em ~10s."
