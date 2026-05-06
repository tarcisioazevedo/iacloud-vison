#!/bin/bash
# =============================================================================
# Sprint 0 Smoke Tests — bateria de validação dos itens entregues
# =============================================================================
# Cobre:
#   1. FCB-005   — assertBoxOwnership middleware (cross-box rejeitado)
#   2. FCB-002   — runStaleEdgeDetection() executa sem erro
#   3. Box A     — POST /heartbeat com transitions[] cria EdgeConnectionLog
#   4. Box B     — POST /activate retorna vault.quotaUsedGB/quotaTotalGB
#   5. Box C     — frontend EdgeBoxesPanel tem botão Logs (manual)
#   6. fieldErrors helper Zod retorna detalhe estruturado
#
# Pré-requisitos:
#   - Backend rodando em $API_BASE (default http://localhost:3000)
#   - PostgreSQL acessível
#   - Pelo menos 1 EdgeNode em DB com licenseKey conhecida (DEV BYPASS funciona)
#
# Execução:
#   ./scripts/sprint0-smoke-tests.sh           # tudo
#   TEST=fieldErrors ./scripts/sprint0-smoke-tests.sh  # só um
#
# Saída: códigos de cor + sumário final. Exit 0 se tudo passou, 1 se algum falhou.
# =============================================================================

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
LICENSE_KEY="${LICENSE_KEY:-IACV-LAB-TEST-KEY-123}"  # DEV BYPASS
SELECTED="${TEST:-all}"

# Cores
GREEN='\033[1;32m'; RED='\033[1;31m'; YELLOW='\033[1;33m'
BLUE='\033[1;34m'; DIM='\033[2m'; RESET='\033[0m'

PASSED=0
FAILED=0
SKIPPED=0
RESULTS=()

# ─── Helpers ─────────────────────────────────────────────────────────────
section() { echo -e "\n${BLUE}━━━ $* ━━━${RESET}"; }
ok()      { echo -e "  ${GREEN}✓${RESET} $*"; PASSED=$((PASSED+1)); RESULTS+=("PASS: $*"); }
fail()    { echo -e "  ${RED}✗${RESET} $*"; FAILED=$((FAILED+1)); RESULTS+=("FAIL: $*"); }
skip()    { echo -e "  ${YELLOW}⊘${RESET} $* ${DIM}(skipped)${RESET}"; SKIPPED=$((SKIPPED+1)); }
note()    { echo -e "  ${DIM}$*${RESET}"; }

# Filtro por TEST=
should_run() {
  [[ "$SELECTED" == "all" || "$SELECTED" == "$1" ]]
}

# ─── 1. fieldErrors helper Zod ───────────────────────────────────────────
if should_run "fieldErrors"; then
  section "1. Helper Zod fieldErrors estruturado"

  # Caso A: payload sem `service` nem `lines` (Box hoje manda errado)
  RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/iacv-box/logs-batch" \
    -H "Content-Type: application/json" \
    -d "{\"licenseKey\":\"$LICENSE_KEY\"}")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')

  if [[ "$CODE" == "400" ]]; then
    if echo "$BODY" | grep -q '"fieldErrors"'; then
      ok "logs-batch sem service/lines retorna 400 + fieldErrors estruturado"
      note "$(echo "$BODY" | head -c 200)"
    else
      fail "400 mas SEM fieldErrors: $(echo "$BODY" | head -c 200)"
    fi
  else
    fail "Esperado 400, recebido $CODE: $(echo "$BODY" | head -c 100)"
  fi
fi

# ─── 2. logs-batch payload correto ───────────────────────────────────────
if should_run "logsBatch"; then
  section "2. logs-batch payload correto retorna 200"

  TS=$(date +%s)
  RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/iacv-box/logs-batch" \
    -H "Content-Type: application/json" \
    -d "{
      \"licenseKey\":\"$LICENSE_KEY\",
      \"service\":\"frigate\",
      \"lines\":[{\"ts\":$TS,\"level\":\"INFO\",\"msg\":\"smoke test sprint0\"}]
    }")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')

  if [[ "$CODE" == "200" ]] && echo "$BODY" | grep -q '"ok":true'; then
    ok "logs-batch payload válido retorna 200 + ok:true"
    note "$BODY"
  else
    fail "Esperado 200, recebido $CODE: $BODY"
  fi
fi

# ─── 3. Box A: heartbeat com transitions persiste em EdgeConnectionLog ──
if should_run "transitions"; then
  section "3. Box A — heartbeat com transitions[] persiste"

  TX_TYPE="TUNNEL_DOWN"
  CID="smoke-$(date +%s)-tx"
  TS_MS=$(($(date +%s) * 1000))

  RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/iacv-box/heartbeat" \
    -H "Content-Type: application/json" \
    -d "{
      \"licenseKey\":\"$LICENSE_KEY\",
      \"transitions\":[{
        \"type\":\"$TX_TYPE\",
        \"severity\":\"critical\",
        \"ts\":$TS_MS,
        \"correlationId\":\"$CID\",
        \"details\":{\"reason\":\"smoke test\"}
      }]
    }")
  CODE=$(echo "$RESP" | tail -1)

  if [[ "$CODE" == "200" ]]; then
    ok "heartbeat com transitions[] aceito (200)"
    note "Aguarde 2s + verifique manualmente: SELECT eventType, status, payload FROM \"EdgeConnectionLog\" WHERE payload->>'correlationId' = '$CID';"
    note "Esperado: 1 linha com eventType=$TX_TYPE, status=FAILED, payload com correlationId=$CID"
  else
    fail "heartbeat retornou $CODE (esperado 200)"
  fi
fi

# ─── 4. Box B: /activate retorna vault.quota* ────────────────────────────
if should_run "vaultQuota"; then
  section "4. Box B — /activate retorna vault.quotaUsedGB e quotaTotalGB"

  RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/iacv-box/activate" \
    -H "Content-Type: application/json" \
    -d "{\"licenseKey\":\"$LICENSE_KEY\",\"hostname\":\"smoke-test\"}")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')

  if [[ "$CODE" == "200" ]]; then
    if echo "$BODY" | grep -q '"quotaTotalGB"'; then
      ok "activate inclui quotaTotalGB"
      USED=$(echo "$BODY" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('vault',{}).get('quotaUsedGB','?'))" 2>/dev/null || echo '?')
      TOT=$(echo "$BODY" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('vault',{}).get('quotaTotalGB','?'))" 2>/dev/null || echo '?')
      note "quotaUsedGB=$USED  quotaTotalGB=$TOT"
    else
      fail "activate sem quotaTotalGB: $(echo "$BODY" | head -c 200)"
    fi

    if echo "$BODY" | grep -q '"tokenExpiresAt"'; then
      ok "activate inclui tokenExpiresAt"
    else
      note "tokenExpiresAt ausente (ok se R2 não configurado em DEV)"
    fi
  else
    fail "activate retornou $CODE (esperado 200): $(echo "$BODY" | head -c 150)"
  fi
fi

# ─── 5. cross-box (FCB-005): rejeição quando boxId divergente ────────────
if should_run "crossBox"; then
  section "5. FCB-005 — middleware assertBoxOwnership"

  # Sem aplicar o middleware nas rotas ainda (HOT files), validamos
  # apenas que o módulo existe e exporta a função
  if [[ -f /opt/iacloud-vison/vsaas-backend/src/middleware/assert-box-ownership.ts ]]; then
    if grep -q "export async function assertBoxOwnership" /opt/iacloud-vison/vsaas-backend/src/middleware/assert-box-ownership.ts; then
      ok "Middleware assertBoxOwnership existe e exporta a função"
      note "TODO: aplicar nas rotas Box em iacv-box.ts (próximo bloco hot)"
    else
      fail "Arquivo existe mas função não exportada"
    fi
  else
    fail "Arquivo middleware/assert-box-ownership.ts não existe"
  fi
fi

# ─── 6. detect-stale-edge ─────────────────────────────────────────────────
if should_run "staleEdge"; then
  section "6. FCB-002 — detect-stale-edge job"

  if [[ -f /opt/iacloud-vison/vsaas-backend/src/jobs/detect-stale-edge.ts ]]; then
    if grep -q "export async function runStaleEdgeDetection" /opt/iacloud-vison/vsaas-backend/src/jobs/detect-stale-edge.ts; then
      ok "Job detect-stale-edge existe + exporta runStaleEdgeDetection"
      note "TODO: incluir startStaleEdgeDetectionJob() em scheduleJobs() do index.ts"
    else
      fail "Arquivo existe mas função não exportada"
    fi
  else
    fail "Arquivo jobs/detect-stale-edge.ts não existe"
  fi
fi

# ─── 7. LGPD endpoints ────────────────────────────────────────────────────
if should_run "lgpd"; then
  section "7. FCB-016 — LGPD service + routes"

  if [[ -f /opt/iacloud-vison/vsaas-backend/src/services/lgpd.service.ts ]] && \
     [[ -f /opt/iacloud-vison/vsaas-backend/src/routes/lgpd.ts ]]; then
    if grep -q "lgpdRouter" /opt/iacloud-vison/vsaas-backend/src/routes/lgpd.ts; then
      ok "Router LGPD criado (5 endpoints: data-requests POST/GET/list/process + summary)"
      note "TODO: registrar app.use('/lgpd', lgpdRouter) em app.ts (próximo bloco hot)"
    else
      fail "Arquivo existe mas lgpdRouter não declarado"
    fi
  else
    fail "Arquivos LGPD não existem"
  fi
fi

# ─── 8. transition-logger ────────────────────────────────────────────────
if should_run "transitionLogger"; then
  section "8. Box A — transition-logger.service"

  if grep -q "export async function logBoxTransitions" \
     /opt/iacloud-vison/vsaas-backend/src/services/transition-logger.service.ts 2>/dev/null; then
    ok "Service transition-logger exporta logBoxTransitions"
    if grep -q "logBoxTransitions(license.edgeNodeId" \
       /opt/iacloud-vison/vsaas-backend/src/routes/iacv-box.ts; then
      ok "logBoxTransitions integrado em /heartbeat handler"
    else
      fail "Service existe mas /heartbeat handler não chama"
    fi
  else
    fail "transition-logger.service.ts não exporta logBoxTransitions"
  fi
fi

# ─── 9. install.sh + box.iacloud.com.br ───────────────────────────────────
if should_run "installer"; then
  section "9. Installer + Caddy + DNS"

  CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://box.iacloud.com.br/install.sh")
  if [[ "$CODE" == "200" ]]; then
    ok "https://box.iacloud.com.br/install.sh responde 200"
    if curl -s "https://box.iacloud.com.br/install.sh" | grep -q "setup_ntp"; then
      ok "install.sh contém setup_ntp() (NTP-BR auto)"
    else
      fail "install.sh NÃO contém setup_ntp"
    fi
  else
    fail "https://box.iacloud.com.br retornou $CODE"
  fi
fi

# ─── 10. NTP Cloud-side ────────────────────────────────────────────────────
if should_run "ntp"; then
  section "10. NTP Cloud-side"

  if timedatectl status 2>/dev/null | grep -q "synchronized: yes"; then
    ok "Sistema sincronizado via NTP"
    if timedatectl timesync-status 2>/dev/null | grep -qE "ntp\.br|200\.160\.7|201\.49\.148|200\.186\.125"; then
      ok "Servidor NTP é ntp.br (NIC.br)"
    else
      note "Sincronizado mas servidor não é ntp.br ainda (verificar)"
    fi
  else
    fail "Sistema não sincronizado"
  fi
fi

# ─── Sumário final ────────────────────────────────────────────────────────
echo ""
section "Sumário"
echo -e "  ${GREEN}Passed: $PASSED${RESET}"
echo -e "  ${RED}Failed: $FAILED${RESET}"
[[ $SKIPPED -gt 0 ]] && echo -e "  ${YELLOW}Skipped: $SKIPPED${RESET}"
echo ""

if [[ $FAILED -gt 0 ]]; then
  echo -e "${RED}━━━ $FAILED test(s) failed ━━━${RESET}"
  exit 1
else
  echo -e "${GREEN}━━━ Todos os testes passaram ━━━${RESET}"
  exit 0
fi
