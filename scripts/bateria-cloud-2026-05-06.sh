#!/bin/bash
# =============================================================================
# Bateria Cloud-side 2026-05-06 — alinha com Box via INTEGRATION/BATERIA_TESTES_2026-05-06.md
# =============================================================================
# Uso:
#   bash scripts/bateria-cloud-2026-05-06.sh                    # roda tudo
#   TEST=T01 bash scripts/bateria-cloud-2026-05-06.sh           # só um teste
#
# Pré:
#   - API_BASE (default https://app.iacloud.com.br/api)
#   - LICENSE (default IACV-LAB-TEST-KEY-123 — DEV BYPASS)
#   - PSQL=docker exec icv_postgres psql -U icvuser iacloudvision  (override se outro container)
#
# Saída: cores + sumário. Exit 0 se tudo PASS, 1 se algum FAIL.
# =============================================================================

set -uo pipefail

API_BASE="${API_BASE:-https://app.iacloud.com.br/api}"
LICENSE="${LICENSE:-IACV-LAB-TEST-KEY-123}"
PSQL_CMD="${PSQL_CMD:-docker exec icv_postgres psql -U icvuser iacloudvision -tAc}"
SELECTED="${TEST:-all}"

GREEN='\033[1;32m'; RED='\033[1;31m'; YELLOW='\033[1;33m'
BLUE='\033[1;34m'; DIM='\033[2m'; RESET='\033[0m'

PASS=0; FAIL=0; PEND=0
RESULTS=()

run() { [[ "$SELECTED" == "all" || "$SELECTED" == "$1" ]]; }
section() { echo -e "\n${BLUE}━━━ $* ━━━${RESET}"; }
ok()   { echo -e "  ${GREEN}✓${RESET} $*"; PASS=$((PASS+1)); RESULTS+=("PASS $*"); }
fail() { echo -e "  ${RED}✗${RESET} $*"; FAIL=$((FAIL+1)); RESULTS+=("FAIL $*"); }
pend() { echo -e "  ${YELLOW}⊘${RESET} $* ${DIM}(pending merge)${RESET}"; PEND=$((PEND+1)); RESULTS+=("PEND $*"); }
note() { echo -e "  ${DIM}$*${RESET}"; }

# T02 — fieldErrors (já está em produção, deve passar SEMPRE)
if run T02; then
  section "T02 — fieldErrors estruturado em payload errado"
  RESP=$(curl -s -X POST "$API_BASE/iacv-box/logs-batch" \
    -H "Content-Type: application/json" \
    -d "{\"licenseKey\":\"$LICENSE\"}")
  if echo "$RESP" | grep -q '"fieldErrors"'; then
    if echo "$RESP" | grep -q '"service"' && echo "$RESP" | grep -q '"lines"'; then
      ok "fieldErrors retorna service+lines com Required"
      note "$(echo "$RESP" | head -c 150)"
    else
      fail "fieldErrors presente mas sem campos service/lines"
    fi
  else
    fail "Sem fieldErrors: $(echo "$RESP" | head -c 200)"
  fi
fi

# T03 — logs-batch payload correto
if run T03; then
  section "T03 — logs-batch payload correto retorna 200"
  TS=$(date +%s)
  MSG="bateria T03 smoke $TS"
  CODE_BODY=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/iacv-box/logs-batch" \
    -H "Content-Type: application/json" \
    -d "{
      \"licenseKey\":\"$LICENSE\",
      \"service\":\"frigate\",
      \"lines\":[{\"ts\":$TS,\"level\":\"INFO\",\"msg\":\"$MSG\"}]
    }")
  CODE=$(echo "$CODE_BODY" | tail -1)
  BODY=$(echo "$CODE_BODY" | sed '$d')
  if [[ "$CODE" == "200" ]] && echo "$BODY" | grep -q '"ok":true'; then
    ok "logs-batch payload válido → 200 ok:true"
    note "$BODY"
    sleep 1
    # Verifica persistência
    SAVED=$($PSQL_CMD "SELECT 1 FROM \"SystemLog\" WHERE source='edge:frigate' AND message LIKE '%T03 smoke $TS%' LIMIT 1;" 2>/dev/null | tr -d ' ')
    if [[ "$SAVED" == "1" ]]; then
      ok "Mensagem persistida em SystemLog"
    else
      fail "Mensagem NÃO encontrada em SystemLog após 1s"
    fi
  else
    fail "Esperado 200, recebido $CODE: $BODY"
  fi
fi

# T04 — events básico
if run T04; then
  section "T04 — events básico (legado, sem skill)"
  TS=$(date +%s)
  FID="bateria-T04-$TS"
  RESP=$(curl -s -X POST "$API_BASE/iacv-box/events" \
    -H "Content-Type: application/json" \
    -d "{
      \"licenseKey\":\"$LICENSE\",
      \"timestamp\":$TS,
      \"objectCount\":2,
      \"classes\":[\"person\",\"backpack\"],
      \"frigateId\":\"$FID\"
    }")
  if echo "$RESP" | grep -q '"eventId"'; then
    ok "events legado aceito"
    sleep 1
    # Verifica
    EVT=$($PSQL_CMD "SELECT \"eventType\", \"occupancyCount\" FROM \"AnalyticsEvent\" WHERE \"frigateId\" = '$FID';" 2>/dev/null)
    if echo "$EVT" | grep -q "IACV_BOX_DETECTION|2"; then
      ok "AnalyticsEvent persistido com eventType=IACV_BOX_DETECTION e occupancyCount=2"
    else
      fail "Evento não encontrado no DB ou shape errado: $EVT"
    fi
  else
    fail "events não retornou eventId: $(echo "$RESP" | head -c 200)"
  fi
fi

# T05 — events ENRIQUECIDO (skill/metadata) — só passa após merge
if run T05; then
  section "T05 — events enriquecido (skill/metadata/eventType — fix item 12)"
  TS=$(date +%s)
  FID="bateria-T05-$TS"
  RESP=$(curl -s -X POST "$API_BASE/iacv-box/events" \
    -H "Content-Type: application/json" \
    -d "{
      \"licenseKey\":\"$LICENSE\",
      \"timestamp\":$TS,
      \"objectCount\":1,
      \"classes\":[\"person\"],
      \"frigateId\":\"$FID\",
      \"skill\":\"intrusion\",
      \"metadata\":{\"zone\":\"entrada\",\"alertLevel\":2},
      \"eventType\":\"INTRUSION_DETECTED\",
      \"score\":0.92,
      \"bboxJson\":[120,240,80,160],
      \"zonesJson\":[\"entrada\"]
    }")
  if echo "$RESP" | grep -q '"eventId"'; then
    sleep 1
    EVT_TYPE=$($PSQL_CMD "SELECT \"eventType\" FROM \"AnalyticsEvent\" WHERE \"frigateId\" = '$FID';" 2>/dev/null | tr -d ' ')
    RAW=$($PSQL_CMD "SELECT \"rawAnnotationsJson\"::text FROM \"AnalyticsEvent\" WHERE \"frigateId\" = '$FID';" 2>/dev/null)

    if [[ "$EVT_TYPE" == "INTRUSION_DETECTED" ]]; then
      ok "eventType respeitou Box override (INTRUSION_DETECTED)"
    else
      pend "eventType ainda hardcoded: '$EVT_TYPE' — produção sem fix item 12 (precisa merge branch isolada)"
    fi

    if [[ -n "$RAW" && "$RAW" != "" && "$RAW" != "<NULL>" ]]; then
      if echo "$RAW" | grep -q '"skill"' && echo "$RAW" | grep -q '"metadata"'; then
        ok "rawAnnotationsJson tem skill+metadata"
        note "$RAW"
      else
        pend "rawAnnotationsJson presente mas SEM skill/metadata: $RAW"
      fi
    else
      pend "rawAnnotationsJson NULL — campos extras descartados (sem fix item 12)"
    fi
  else
    fail "events enriquecido não retornou eventId: $(echo "$RESP" | head -c 200)"
  fi
fi

# T06 — events-batch (idempotência via duplicate frigateId)
if run T06; then
  section "T06 — events-batch idempotência (duplicate frigateId → 200/207)"
  TS=$(date +%s)
  RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/iacv-box/events-batch" \
    -H "Content-Type: application/json" \
    -d "{
      \"licenseKey\":\"$LICENSE\",
      \"events\":[
        {\"timestamp\":$TS,\"objectCount\":1,\"classes\":[\"person\"],\"frigateId\":\"T06-ok-$TS\"},
        {\"timestamp\":$TS,\"objectCount\":1,\"classes\":[\"person\"],\"frigateId\":\"T06-ok-$TS\"}
      ]
    }")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  if [[ "$CODE" == "200" ]] || [[ "$CODE" == "207" ]]; then
    if echo "$BODY" | grep -q '"duplicates":1'; then
      ok "events-batch detectou duplicate (idempotência por frigateId)"
      note "$BODY"
    else
      fail "events-batch sem duplicates: $BODY"
    fi
  else
    fail "events-batch CODE=$CODE: $BODY"
  fi
fi

# T06b — events-batch 207 Multi-Status com per-item validation (fix handoff 2026-05-06)
if run T06b; then
  section "T06b — events-batch 207 com 1 item inválido entre válidos"
  TS=$(date +%s)
  RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/iacv-box/events-batch" \
    -H "Content-Type: application/json" \
    -d "{
      \"licenseKey\":\"$LICENSE\",
      \"events\":[
        {\"timestamp\":$TS,\"objectCount\":1,\"classes\":[\"person\"],\"frigateId\":\"T06b-ok-$TS\"},
        {\"timestamp\":\"INVALID_NOT_NUMBER\",\"objectCount\":1,\"classes\":[\"person\"]},
        {\"timestamp\":$TS,\"objectCount\":2,\"classes\":[\"car\"],\"frigateId\":\"T06b-ok2-$TS\"}
      ]
    }")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  if [[ "$CODE" == "207" ]]; then
    if echo "$BODY" | grep -q '"accepted":2' && echo "$BODY" | grep -q '"errors"'; then
      ok "207 Multi-Status: 2 aceitos + 1 erro (per-item validation OK)"
      note "$BODY"
    else
      fail "207 mas accepted/errors errado: $BODY"
    fi
  elif [[ "$CODE" == "400" ]]; then
    pend "Recebeu 400 ALL-OR-NOTHING — fix T06 do handoff ainda não em produção (precisa merge branch isolada)"
    note "$BODY"
  else
    fail "events-batch mixed CODE=$CODE: $BODY"
  fi
fi

# T10 — transitions persistidas (após merge)
if run T10; then
  section "T10 — transitions persistidas em EdgeConnectionLog"
  TS=$(date +%s)
  CID="bateria-T10-$TS"
  curl -s -X POST "$API_BASE/iacv-box/heartbeat" \
    -H "Content-Type: application/json" \
    -d "{
      \"licenseKey\":\"$LICENSE\",
      \"transitions\":[{
        \"type\":\"TUNNEL_DOWN\",
        \"severity\":\"critical\",
        \"ts\":$((TS*1000)),
        \"correlationId\":\"$CID\",
        \"details\":{\"reason\":\"bateria T10 smoke\"}
      }]
    }" >/dev/null
  sleep 2
  COUNT=$($PSQL_CMD "SELECT count(*) FROM \"EdgeConnectionLog\" WHERE payload->>'correlationId' = '$CID';" 2>/dev/null | tr -d ' ')
  if [[ "$COUNT" == "1" ]]; then
    ok "Transition TUNNEL_DOWN persistida com correlationId=$CID"
  else
    pend "Transition NÃO persistida (count=$COUNT) — produção sem fix item A (precisa merge branch isolada)"
  fi
fi

# T11 — vault quota no /activate (após merge)
if run T11; then
  section "T11 — vault.quotaUsedGB + quotaTotalGB + tokenExpiresAt"
  RESP=$(curl -s -X POST "$API_BASE/iacv-box/activate" \
    -H "Content-Type: application/json" \
    -d "{\"licenseKey\":\"$LICENSE\",\"hostname\":\"smoke-T11\"}")
  if echo "$RESP" | grep -q '"quotaTotalGB"'; then
    ok "/activate retorna vault.quotaTotalGB"
    if echo "$RESP" | grep -q '"quotaUsedGB"'; then
      ok "/activate retorna vault.quotaUsedGB"
    fi
    if echo "$RESP" | grep -q '"tokenExpiresAt"'; then
      ok "/activate retorna vault.tokenExpiresAt"
    fi
  else
    pend "/activate sem quotaTotalGB — produção sem fix item B (precisa merge branch isolada)"
    note "$(echo "$RESP" | jq '.vault' 2>/dev/null | head -c 300)"
  fi
fi

# T14 — Painel Logs (verificação de existência do endpoint)
if run T14; then
  section "T14 — Painel logs unificado endpoint disponível"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/admin/audit-explorer?limit=1")
  if [[ "$CODE" == "401" ]]; then
    ok "Endpoint audit-explorer existe (retornou 401 — esperado sem JWT)"
  elif [[ "$CODE" == "404" ]]; then
    fail "Endpoint audit-explorer NÃO existe (404)"
  else
    note "audit-explorer retornou $CODE"
  fi
fi

# Sumário
echo ""
section "Sumário"
echo -e "  ${GREEN}PASS:${RESET} $PASS"
echo -e "  ${RED}FAIL:${RESET} $FAIL"
echo -e "  ${YELLOW}PEND merge:${RESET} $PEND"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}━━━ $FAIL teste(s) falhou ━━━${RESET}"
  exit 1
elif [[ $PEND -gt 0 ]]; then
  echo -e "${YELLOW}━━━ $PEND teste(s) pendente — esperando merge da branch claude-sprint0-pivot-2026-05-06 ━━━${RESET}"
  exit 0
else
  echo -e "${GREEN}━━━ Todos os testes passaram ━━━${RESET}"
  exit 0
fi
