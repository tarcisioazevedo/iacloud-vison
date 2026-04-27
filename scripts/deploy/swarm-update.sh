#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# swarm-update.sh
# Atualiza serviços Docker Swarm de tenants IACV usando rolling
# update com start-first + auto-rollback em falha de healthcheck.
#
# Variáveis de entrada (export antes de chamar):
#   IMAGE_TAG      ex: v1.2.3 ou dev-abc1234
#   REGISTRY       ghcr.io
#   IMAGE_NAME     tarcisioazevedo/iacloud-vison
#   TENANT_FILTER  canary | batch | remaining | all | <tenant>
#   STACK_NAME     (opcional) sobrescreve filtro p/ stack único
#
# Exemplo:
#   IMAGE_TAG=v1.2.3 TENANT_FILTER=canary bash swarm-update.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG é obrigatório}"
: "${REGISTRY:=ghcr.io}"
: "${IMAGE_NAME:=tarcisioazevedo/iacloud-vison}"
: "${TENANT_FILTER:=all}"

FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "▶ Deploy: ${FULL_IMAGE}"
echo "▶ Filtro: ${TENANT_FILTER}"

# Lista de tenants conforme filtro
mapfile -t TENANTS < <(
  TENANT_FILTER="${TENANT_FILTER}" \
  bash "${SCRIPT_DIR}/list-tenants.sh"
)

if [[ ${#TENANTS[@]} -eq 0 ]]; then
  echo "⚠ Nenhum tenant para o filtro '${TENANT_FILTER}'. Saindo."
  exit 0
fi

echo "▶ Tenants alvo (${#TENANTS[@]}): ${TENANTS[*]}"

# Pull da imagem (failure rápido se a tag não existe)
docker pull "${FULL_IMAGE}" >/dev/null

# Loop de atualização
FAILED=()
for TENANT in "${TENANTS[@]}"; do
  SERVICE="vision-${TENANT}_vision"
  echo "──────────────────────────────────────"
  echo "▶ Atualizando ${SERVICE} para ${IMAGE_TAG}"

  if ! docker service inspect "${SERVICE}" >/dev/null 2>&1; then
    echo "⚠ ${SERVICE} não existe. Pulando."
    continue
  fi

  # Versão atual (para log)
  CURRENT=$(docker service inspect "${SERVICE}" \
    --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | awk -F: '{print $NF}')
  echo "  versão atual: ${CURRENT}"

  if [[ "${CURRENT}" == "${IMAGE_TAG}" ]]; then
    echo "  já está em ${IMAGE_TAG}, pulando."
    continue
  fi

  # Update com auto-rollback
  if docker service update \
       --image "${FULL_IMAGE}" \
       --update-order start-first \
       --update-failure-action rollback \
       --update-monitor 60s \
       --update-parallelism 1 \
       --with-registry-auth \
       "${SERVICE}"; then
    echo "  ✓ ${SERVICE} atualizado"
  else
    echo "  ✗ FALHA em ${SERVICE} - Swarm fará rollback automático"
    FAILED+=("${TENANT}")
    continue
  fi

  # Pequena pausa entre tenants (evita pico de carga)
  sleep 10
done

echo "──────────────────────────────────────"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "✗ ${#FAILED[@]} tenant(s) falharam: ${FAILED[*]}"
  exit 1
fi

echo "✓ Todos os tenants atualizados para ${IMAGE_TAG}"
