#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# smoke-tests.sh
# 8 testes obrigatórios após qualquer deploy.
# Falha em QUALQUER teste aborta o pipeline.
#
# Variáveis de entrada:
#   BASE_URL          ex: https://staging.iacv.example.com
#   AUTH_USER         usuário admin
#   AUTH_PASS         senha
#   EXPECTED_VERSION  versão esperada no /version (ex: v1.2.3)
#   TIMEOUT           timeout HTTP em segundos (default: 10)
#   CAMERA_TEST       (opcional) nome de uma câmera de teste
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

: "${BASE_URL:?BASE_URL é obrigatório}"
: "${AUTH_USER:?AUTH_USER é obrigatório}"
: "${AUTH_PASS:?AUTH_PASS é obrigatório}"
: "${EXPECTED_VERSION:?EXPECTED_VERSION é obrigatório}"
: "${TIMEOUT:=10}"
: "${CAMERA_TEST:=camera_test}"

PASS=0
FAIL=0
RESULTS=()

run_test() {
  local name="$1"
  shift
  local cmd=("$@")

  if "${cmd[@]}" >/dev/null 2>&1; then
    echo "  ✓ ${name}"
    RESULTS+=("PASS: ${name}")
    PASS=$((PASS + 1))
  else
    echo "  ✗ ${name}"
    RESULTS+=("FAIL: ${name}")
    FAIL=$((FAIL + 1))
  fi
}

echo "▶ Smoke tests: ${BASE_URL} (esperado v${EXPECTED_VERSION})"
echo "──────────────────────────────────────"

# 1. /version retorna a tag esperada
test_version() {
  local got
  got=$(curl -sf --max-time "${TIMEOUT}" "${BASE_URL}/version")
  [[ "${got}" == *"${EXPECTED_VERSION}"* ]]
}
run_test "1. /version contém ${EXPECTED_VERSION}" test_version

# 2. /api/version OK em < TIMEOUTs
run_test "2. /api/version 200 OK" \
  curl -sf --max-time "${TIMEOUT}" -o /dev/null "${BASE_URL}/api/version"

# 3. Login retorna cookie
test_login() {
  local resp
  resp=$(curl -sf --max-time "${TIMEOUT}" -c /tmp/iacv-cookie.txt \
    -X POST "${BASE_URL}/api/login" \
    -H 'Content-Type: application/json' \
    -d "{\"user\":\"${AUTH_USER}\",\"password\":\"${AUTH_PASS}\"}")
  [[ -s /tmp/iacv-cookie.txt ]]
}
run_test "3. POST /api/login retorna cookie" test_login

# 4. /api/config tem cameras
test_config() {
  local resp
  resp=$(curl -sf --max-time "${TIMEOUT}" -b /tmp/iacv-cookie.txt \
    "${BASE_URL}/api/config")
  echo "${resp}" | python3 -c "import sys, json; c=json.load(sys.stdin); assert 'cameras' in c"
}
run_test "4. /api/config tem cameras" test_config

# 5. Snapshot retorna JPEG
test_snapshot() {
  local tmpf
  tmpf=$(mktemp --suffix=.jpg)
  trap "rm -f ${tmpf}" RETURN
  curl -sf --max-time "${TIMEOUT}" -b /tmp/iacv-cookie.txt \
    -o "${tmpf}" \
    "${BASE_URL}/api/${CAMERA_TEST}/snapshot.jpg"
  # Confirma que é JPEG (magic bytes)
  [[ "$(head -c 3 "${tmpf}" | xxd -p)" == "ffd8ff" ]]
}
run_test "5. Snapshot da câmera é JPEG válido" test_snapshot

# 6. /api/events retorna array
test_events() {
  curl -sf --max-time "${TIMEOUT}" -b /tmp/iacv-cookie.txt \
    "${BASE_URL}/api/events?limit=5" \
    | python3 -c "import sys, json; e=json.load(sys.stdin); assert isinstance(e, list)"
}
run_test "6. /api/events retorna lista" test_events

# 7. /api/stats tem cpu e mem
test_stats() {
  curl -sf --max-time "${TIMEOUT}" -b /tmp/iacv-cookie.txt \
    "${BASE_URL}/api/stats" \
    | python3 -c "import sys, json; s=json.load(sys.stdin); assert 'cpu_usages' in s or 'cpu' in s"
}
run_test "7. /api/stats tem CPU" test_stats

# 8. WebSocket handshake
test_ws() {
  local ws_url="${BASE_URL/https:/wss:}/ws"
  ws_url="${ws_url/http:/ws:}"
  # Heurística: HEAD request com Upgrade — se servidor suporta, retorna 426 ou 101
  curl -sf --max-time 5 \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
    -o /dev/null \
    "${BASE_URL}/ws" 2>&1 | grep -qE '101|426' \
    || curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${BASE_URL}/ws" \
       | grep -qE '101|426|400'
}
run_test "8. WS /ws aceita Upgrade" test_ws

# Limpeza
rm -f /tmp/iacv-cookie.txt

echo "──────────────────────────────────────"
echo "Resultado: ${PASS} OK / ${FAIL} falhas"

if [[ ${FAIL} -gt 0 ]]; then
  echo
  echo "Detalhes dos resultados:"
  printf '  %s\n' "${RESULTS[@]}"
  exit 1
fi

echo "✓ Todos os smoke tests passaram"
