#!/usr/bin/env bash
# =============================================================================
# VSaaS — Instalador dos git hooks versionados
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
chmod +x "${HOOKS_PATH}/pre-push"   2>/dev/null || true
chmod +x "${HOOKS_PATH}/pre-commit" 2>/dev/null || true
chmod +x "${HOOKS_PATH}/install.sh" 2>/dev/null || true

# Aponta core.hooksPath para o diretório versionado
git config core.hooksPath "$HOOKS_PATH"

CURRENT="$(git config --get core.hooksPath)"

echo -e "${GREEN}✓${NC} Git hooks ativados."
echo "  core.hooksPath = ${CURRENT}"
echo ""
echo "  Hooks instalados:"
echo -e "    ${YELLOW}pre-commit${NC} → roda gitleaks no diff staged (bloqueia se detectar segredo)"
echo -e "    ${YELLOW}pre-push${NC}   → bloqueia push para main/master se P0 do checklist pendente"
echo ""

# Garante binário gitleaks no caminho conhecido (pre-commit precisa dele)
if [[ ! -x "${REPO_ROOT}/scripts/bin/gitleaks" ]]; then
  echo -e "${YELLOW}⚠${NC} gitleaks não encontrado em scripts/bin/gitleaks"
  echo "  O pre-commit vai tentar gitleaks do PATH; se não existir, pula scan."
  echo "  Para instalar (Linux x64):"
  echo "    mkdir -p scripts/bin"
  echo "    curl -fsSL https://github.com/gitleaks/gitleaks/releases/download/v8.18.4/gitleaks_8.18.4_linux_x64.tar.gz | tar xz -C scripts/bin/ gitleaks"
  echo "    chmod +x scripts/bin/gitleaks"
  echo ""
fi

echo "  Para desativar: git config --unset core.hooksPath"
