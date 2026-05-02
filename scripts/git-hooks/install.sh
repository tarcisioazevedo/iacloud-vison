#!/usr/bin/env bash
# =============================================================================
# IA Cloud Vision — Instalador dos git hooks versionados
#
# Configura o git para usar `scripts/git-hooks/` em vez do default `.git/hooks/`,
# para que os hooks sejam compartilhados via repositório.
#
# Uso (1x por clone, em qualquer máquina):
#   bash scripts/git-hooks/install.sh
#
# Para desativar:
#   git config --unset core.hooksPath
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Resolve raiz do repo (script pode ser chamado de qualquer subdir)
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Erro: não está dentro de um repositório git."
  exit 1
}

cd "$REPO_ROOT"

HOOKS_PATH="scripts/git-hooks"

# Garante que os hooks são executáveis (alguns OS perdem o bit em clone)
chmod +x "${HOOKS_PATH}/pre-push" 2>/dev/null || true
chmod +x "${HOOKS_PATH}/install.sh" 2>/dev/null || true

# Aponta core.hooksPath para o diretório versionado
git config core.hooksPath "$HOOKS_PATH"

CURRENT="$(git config --get core.hooksPath)"

echo -e "${GREEN}✓${NC} Git hooks ativados."
echo "  core.hooksPath = ${CURRENT}"
echo ""
echo "  Hooks instalados:"
echo -e "    ${YELLOW}pre-push${NC} → bloqueia push para main/master se P0 do checklist pendente"
echo ""
echo "  Para desativar: git config --unset core.hooksPath"
