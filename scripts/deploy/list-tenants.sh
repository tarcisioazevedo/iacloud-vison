#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# list-tenants.sh
# Lista tenants do Swarm IACV conforme filtro de categoria.
#
# Convenção (configurável via /etc/iacv/tenants.conf):
#   canary     = tenants internos/demo (sempre primeiros)
#   batch      = ~10% do total, escolhidos por estabilidade
#   remaining  = todos exceto os já em canary+batch
#   all        = todos
#   <nome>     = filtro literal por slug
#   staging    = só staging (ambiente separado)
#
# Saída: um tenant por linha.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

CONFIG_FILE="${IACV_TENANTS_CONFIG:-/etc/iacv/tenants.conf}"
FILTER="${TENANT_FILTER:-all}"

# Listas customizáveis (sobrescrever no /etc/iacv/tenants.conf)
CANARY_TENANTS=("demo")
BATCH_TENANTS=("tenant_a" "tenant_b" "tenant_c")

# Carrega config local se existir
if [[ -f "${CONFIG_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
fi

# Tenants existentes no Swarm (auto-discovery)
mapfile -t ALL_SWARM_TENANTS < <(
  docker stack ls --format '{{.Name}}' 2>/dev/null \
    | grep '^vision-' \
    | sed 's/^vision-//' \
    | sort -u
)

case "${FILTER}" in
  canary)
    for t in "${CANARY_TENANTS[@]}"; do echo "$t"; done
    ;;

  batch)
    for t in "${BATCH_TENANTS[@]}"; do echo "$t"; done
    ;;

  remaining)
    # Todos do Swarm que não são canary nem batch
    EXCLUDE=("${CANARY_TENANTS[@]}" "${BATCH_TENANTS[@]}")
    for t in "${ALL_SWARM_TENANTS[@]}"; do
      skip=0
      for e in "${EXCLUDE[@]}"; do
        [[ "$t" == "$e" ]] && skip=1 && break
      done
      [[ $skip -eq 0 ]] && echo "$t"
    done
    ;;

  all)
    for t in "${ALL_SWARM_TENANTS[@]}"; do echo "$t"; done
    ;;

  staging)
    # Em staging só existe um stack: iacv-staging
    echo "staging"
    ;;

  *)
    # Filtro literal: tenant específico
    echo "${FILTER}"
    ;;
esac
