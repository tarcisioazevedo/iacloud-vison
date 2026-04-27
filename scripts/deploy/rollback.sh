#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# rollback.sh
# Rollback rápido (caminho A do Runbook 02).
# NÃO restaura banco de dados — para isso use restore-db.sh.
#
# Variáveis:
#   TENANT_FILTER  canary | batch | remaining | all | <tenant>
#   TARGET_VERSION (opcional) tag específica. Se vazio, usa rollback do Swarm.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

: "${TENANT_FILTER:=all}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_NAME="${IMAGE_NAME:-tarcisioazevedo/iacloud-vison}"

mapfile -t TENANTS < <(
  TENANT_FILTER="${TENANT_FILTER}" \
  bash "${SCRIPT_DIR}/list-tenants.sh"
)

echo "▶ Rollback de ${#TENANTS[@]} tenant(s)"
[[ -n "${TARGET_VERSION:-}" ]] && echo "▶ Versão alvo: ${TARGET_VERSION}"

FAILED=()
for TENANT in "${TENANTS[@]}"; do
  SERVICE="vision-${TENANT}_vision"

  if ! docker service inspect "${SERVICE}" >/dev/null 2>&1; then
    echo "  ⚠ ${SERVICE} não existe, pulando"
    continue
  fi

  echo "  ${SERVICE}..."

  if [[ -n "${TARGET_VERSION:-}" ]]; then
    # Forçar versão específica
    docker service update \
      --image "${REGISTRY}/${IMAGE_NAME}:${TARGET_VERSION}" \
      --update-order start-first \
      --with-registry-auth \
      "${SERVICE}" \
      || FAILED+=("${TENANT}")
  else
    # Rollback automático para versão anterior do Swarm
    docker service rollback "${SERVICE}" \
      || FAILED+=("${TENANT}")
  fi
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "✗ Falha em ${#FAILED[@]} tenant(s): ${FAILED[*]}"
  exit 1
fi

echo "✓ Rollback completo"
