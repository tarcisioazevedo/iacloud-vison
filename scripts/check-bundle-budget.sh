#!/usr/bin/env bash
# Hardening Iteração 1 (docs/13 §10) — perf budget guard.
#
# Roda APÓS `npm run build` no vsaas-frontend e falha (exit 1) se:
#   - Total bundle (todos os JS minified) > BUDGET_TOTAL_KB
#   - Qualquer chunk individual > BUDGET_CHUNK_KB
#   - Total CSS minified > BUDGET_CSS_KB
#
# Default budgets (pode override via env):
#   BUDGET_TOTAL_KB  = 3500   (3.5 MB minified — reasonable para um VMS multi-feature)
#   BUDGET_CHUNK_KB  = 1000   (1 MB por chunk — força code-splitting saudável)
#   BUDGET_CSS_KB    = 250
#
# Uso:
#   cd vsaas-frontend && npm run build
#   bash ../scripts/check-bundle-budget.sh

set -euo pipefail

DIST_DIR="${DIST_DIR:-/opt/iacloud-vison/vsaas-frontend/dist}"
# Budgets calibrados pela linha de base atual (2026-05-06). Ajustar para baixo
# após cada onda de code-split/tree-shake. Subir aqui exige justificativa.
BUDGET_TOTAL_KB="${BUDGET_TOTAL_KB:-3500}"   # base atual: ~3106 kB
BUDGET_CHUNK_KB="${BUDGET_CHUNK_KB:-2700}"   # base atual: ~2467 kB (index principal)
BUDGET_CSS_KB="${BUDGET_CSS_KB:-250}"        # base atual: ~166 kB

if [ ! -d "$DIST_DIR" ]; then
  echo "❌ Diretório dist/ não encontrado: $DIST_DIR"
  echo "   Rode 'npm run build' primeiro."
  exit 2
fi

# Soma JS minified (incluindo assets/ e raiz)
total_js_kb=$(find "$DIST_DIR" -type f -name '*.js' -printf '%s\n' | awk '{ s += $1 } END { printf "%d", s/1024 }')
total_css_kb=$(find "$DIST_DIR" -type f -name '*.css' -printf '%s\n' | awk '{ s += $1 } END { printf "%d", s/1024 }')

# Maior chunk individual JS
max_chunk_kb=$(find "$DIST_DIR" -type f -name '*.js' -printf '%s %p\n' | sort -n | tail -1 | awk '{ printf "%d", $1/1024 }')
max_chunk_path=$(find "$DIST_DIR" -type f -name '*.js' -printf '%s %p\n' | sort -n | tail -1 | awk '{ print $2 }')

echo "── Bundle budget check ──────────────────────────────────────"
printf '  Total JS  : %5d kB  (budget %d kB)\n' "$total_js_kb" "$BUDGET_TOTAL_KB"
printf '  Total CSS : %5d kB  (budget %d kB)\n' "$total_css_kb" "$BUDGET_CSS_KB"
printf '  Max chunk : %5d kB  (budget %d kB) — %s\n' "$max_chunk_kb" "$BUDGET_CHUNK_KB" "$(basename "$max_chunk_path")"

failed=0
if [ "$total_js_kb" -gt "$BUDGET_TOTAL_KB" ]; then
  echo "❌ Total JS excede budget"
  failed=1
fi
if [ "$total_css_kb" -gt "$BUDGET_CSS_KB" ]; then
  echo "❌ Total CSS excede budget"
  failed=1
fi
if [ "$max_chunk_kb" -gt "$BUDGET_CHUNK_KB" ]; then
  echo "❌ Chunk individual excede budget — code-split sugerido"
  failed=1
fi

if [ "$failed" = "1" ]; then
  echo "─────────────────────────────────────────────────────────────"
  echo "Para overridar conscientemente:"
  echo "  BUDGET_TOTAL_KB=4000 BUDGET_CHUNK_KB=1200 bash $0"
  exit 1
fi

echo "✅ Bundle dentro do budget"
