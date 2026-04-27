#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# verify-versions.sh
# Verifica que TODOS os tenants estão na versão esperada.
# Falha (exit 1) se algum tenant estiver em versão diferente.
#
# Variáveis:
#   EXPECTED_VERSION  ex: v1.2.3
#   BASE_DOMAIN       ex: iacv.example.com (default)
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

: "${EXPECTED_VERSION:?EXPECTED_VERSION é obrigatório}"
: "${BASE_DOMAIN:=iacv.example.com}"

mapfile -t TENANTS < <(
  docker stack ls --format '{{.Name}}' \
    | grep '^vision-' \
    | sed 's/^vision-//'
)

echo "▶ Verificando versão em ${#TENANTS[@]} tenant(s) (esperado: ${EXPECTED_VERSION})"

OK=0
WRONG=()
DOWN=()

for TENANT in "${TENANTS[@]}"; do
  URL="https://vision.${TENANT}.${BASE_DOMAIN}/version"
  GOT=$(curl -sf --max-time 10 "${URL}" 2>/dev/null || echo "DOWN")

  if [[ "${GOT}" == "DOWN" ]]; then
    echo "  ✗ ${TENANT}: DOWN"
    DOWN+=("${TENANT}")
  elif [[ "${GOT}" == *"${EXPECTED_VERSION}"* ]]; then
    echo "  ✓ ${TENANT}: ${GOT}"
    OK=$((OK + 1))
  else
    echo "  ✗ ${TENANT}: ${GOT} (esperado ${EXPECTED_VERSION})"
    WRONG+=("${TENANT}")
  fi
done

echo "──────────────────────────────────────"
echo "Resultado: ${OK} OK / ${#WRONG[@]} versão errada / ${#DOWN[@]} DOWN"

if [[ ${#WRONG[@]} -gt 0 ]] || [[ ${#DOWN[@]} -gt 0 ]]; then
  exit 1
fi

echo "✓ Todos os tenants em ${EXPECTED_VERSION}"
