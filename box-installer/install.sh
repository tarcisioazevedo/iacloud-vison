#!/usr/bin/env bash
# =============================================================================
# IA Cloud Vision — Box Installer
# =============================================================================
# Uso:
#   curl -fsSL <URL>/IACV-BOX | sudo bash
#
# Ou para desenvolvimento:
#   sudo INSTALLER_BRANCH=dev curl -fsSL <URL>/IACV-BOX | sudo bash
#
# O que faz:
#   1. Verifica pré-requisitos (root, kernel, arch, RAM)
#   2. Configura sincronia de hora com NIC.br (a/b/c.ntp.br) — pré-requisito
#      invisível para audit, replay-protection, ordering de eventos
#   3. Instala Docker Engine + Compose plugin (se não presente)
#   4. Cria estrutura /opt/iacv-box/ com docker-compose.yml versionado
#   5. Sobe a stack (box-backend, frigate, mosquitto, web UI)
#   6. Imprime URL do first-boot wizard (http://<IP_LAN>:8080)
#
# Idempotência: pode rodar várias vezes sem efeito colateral. Apenas atualiza
# o compose se houver versão mais nova.
#
# Variáveis de ambiente (override):
#   INSTALL_DIR=/opt/iacv-box  destino dos arquivos
#   INSTALLER_SKIP_NTP=1       não toca em NTP (DC corporativo com NTP próprio)
#   INSTALLER_BRANCH=dev       baixa compose de branch dev em vez de stable
# =============================================================================

set -euo pipefail

VERSION="0.1.1-alpha"
INSTALL_DIR="${INSTALL_DIR:-/opt/iacv-box}"
COMPOSE_URL="${COMPOSE_URL:-https://box.iacloud.com.br/box-compose.yml}"
ENV_TEMPLATE_URL="${ENV_TEMPLATE_URL:-https://box.iacloud.com.br/box.env.template}"
BRANCH="${INSTALLER_BRANCH:-stable}"

# Opt-outs (override via env):
#   INSTALLER_SKIP_NTP=1     pula configuração NTP brasileira (data-center corporativo
#                            que já tem servidor NTP próprio)
#   INSTALLER_SKIP_DOCKER=1  pula instalação do Docker (já presente)
INSTALLER_SKIP_NTP="${INSTALLER_SKIP_NTP:-0}"

# ─── Cores ──────────────────────────────────────────────────────────────────
C_RESET='\033[0m'; C_BLUE='\033[1;34m'; C_GREEN='\033[1;32m'
C_YELLOW='\033[1;33m'; C_RED='\033[1;31m'; C_DIM='\033[2m'

log()  { echo -e "${C_BLUE}[IACV-BOX]${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}[ OK ]${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_RESET} $*"; }
err()  { echo -e "${C_RED}[ERR ]${C_RESET} $*" >&2; }

banner() {
  cat <<'EOF'

  ╔══════════════════════════════════════════════════════╗
  ║         IA Cloud Vision — Box Installer              ║
  ║         A Inteligência que faltava no seu CFTV       ║
  ╚══════════════════════════════════════════════════════╝

EOF
}

# ─── Pré-requisitos ─────────────────────────────────────────────────────────
require_root() {
  if [[ $EUID -ne 0 ]]; then
    err "Execute como root (use sudo)."
    exit 1
  fi
}

detect_os() {
  if [[ ! -f /etc/os-release ]]; then
    err "Não consegui detectar o SO (sem /etc/os-release)."; exit 1
  fi
  . /etc/os-release
  OS_ID="${ID,,}"; OS_VER="${VERSION_ID:-unknown}"
  log "SO detectado: ${PRETTY_NAME}"
  case "$OS_ID" in
    ubuntu|debian) ;;
    *) warn "SO não testado: $OS_ID. Continuando por sua conta e risco." ;;
  esac
}

check_resources() {
  local cores ram_gb arch
  cores=$(nproc)
  ram_gb=$(awk '/MemTotal/ {printf "%.1f", $2/1024/1024}' /proc/meminfo)
  arch=$(uname -m)
  log "Hardware: ${cores} cores, ${ram_gb} GB RAM, arch ${arch}"
  if (( $(echo "$ram_gb < 3.5" | bc -l 2>/dev/null || echo 0) )); then
    warn "RAM < 4 GB. Recomendado 8 GB para 8+ câmeras."
  fi
  case "$arch" in
    x86_64|aarch64) ok "Arquitetura suportada." ;;
    *) err "Arquitetura $arch não suportada (precisa x86_64 ou aarch64)."; exit 1 ;;
  esac
}

# ─── NTP (Hora oficial brasileira NIC.br) ───────────────────────────────────
# Por que: Box e Cloud trocam timestamps em heartbeat, eventos, ACKs e auditoria.
# Drift > 5min quebra replay-protection (planejado). Drift > 30s atrapalha
# correlação de logs Cloud↔Box. NIC.br opera 3 stratum-1 públicos com peering
# interno BR (latência ~10ms vs ~200ms para pool.ntp.org genérico).
#
# Servidores oficiais (ntp.br):
#   a, b, c — Stratum 1 GPS/atomic, SLA 99.9%
# Hora legal brasileira (Observatório Nacional / BR-UTC).
setup_ntp() {
  if [[ "${INSTALLER_SKIP_NTP}" == "1" ]]; then
    warn "Pulando configuração NTP (INSTALLER_SKIP_NTP=1)."
    return
  fi

  log "Configurando sincronia de hora — servidores ntp.br (NIC.br)..."

  # Detecta gerenciador NTP. Default Ubuntu 22+: systemd-timesyncd.
  # Edge-cases possíveis: chrony pré-instalado, ntpd legado.
  local ntp_mgr=""
  if systemctl is-active --quiet systemd-timesyncd 2>/dev/null; then
    ntp_mgr="timesyncd"
  elif systemctl is-active --quiet chrony 2>/dev/null || systemctl is-active --quiet chronyd 2>/dev/null; then
    ntp_mgr="chrony"
  elif systemctl is-active --quiet ntp 2>/dev/null; then
    ntp_mgr="ntpd"
  fi

  case "$ntp_mgr" in
    timesyncd)
      # Substitui /etc/systemd/timesyncd.conf de forma idempotente
      cat > /etc/systemd/timesyncd.conf <<'NTP_EOF'
[Time]
NTP=a.ntp.br b.ntp.br c.ntp.br
FallbackNTP=pool.ntp.org
NTP_EOF
      systemctl restart systemd-timesyncd
      sleep 5
      if timedatectl status | grep -q "synchronized: yes"; then
        ok "NTP sincronizado via systemd-timesyncd → ntp.br"
      else
        warn "NTP ainda não sincronizou (pode levar até 1 min). Verifique: timedatectl timesync-status"
      fi
      ;;
    chrony)
      # Adiciona drop-in sources file (não sobrescreve chrony.conf principal)
      mkdir -p /etc/chrony/sources.d
      cat > /etc/chrony/sources.d/ntp-br.sources <<'NTP_EOF'
server a.ntp.br iburst
server b.ntp.br iburst
server c.ntp.br iburst
NTP_EOF
      # Comenta pools default genéricos pra evitar mistura de strata
      sed -i 's/^pool /# pool /' /etc/chrony/chrony.conf 2>/dev/null || true
      systemctl restart chrony 2>/dev/null || systemctl restart chronyd
      sleep 5
      if chronyc tracking 2>/dev/null | grep -q "^Reference ID"; then
        ok "NTP sincronizado via chrony → ntp.br"
      else
        warn "Chrony reiniciou mas ainda sem reference. Verifique: chronyc sources -v"
      fi
      ;;
    ntpd)
      warn "ntpd legado detectado — recomendamos migrar para systemd-timesyncd ou chrony."
      warn "Configuração NTP-BR não aplicada automaticamente para ntpd. Configure manualmente em /etc/ntp.conf."
      ;;
    *)
      warn "Nenhum serviço NTP ativo detectado. Instalando systemd-timesyncd..."
      apt-get install -y systemd-timesyncd 2>&1 | tail -3
      cat > /etc/systemd/timesyncd.conf <<'NTP_EOF'
[Time]
NTP=a.ntp.br b.ntp.br c.ntp.br
FallbackNTP=pool.ntp.org
NTP_EOF
      systemctl enable --now systemd-timesyncd
      ok "systemd-timesyncd instalado e configurado para ntp.br"
      ;;
  esac
}

# ─── Docker ─────────────────────────────────────────────────────────────────
install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker + Compose já presentes ($(docker --version | head -c 50))"
    return
  fi
  log "Instalando Docker Engine + Compose plugin..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  ok "Docker instalado."
}

# ─── Estrutura ──────────────────────────────────────────────────────────────
create_dirs() {
  log "Criando estrutura em ${INSTALL_DIR}..."
  mkdir -p "${INSTALL_DIR}"/{data,logs,recordings,config,secrets}
  chmod 700 "${INSTALL_DIR}/secrets"
  ok "Diretórios criados."
}

# ─── Download compose ──────────────────────────────────────────────────────
fetch_compose() {
  log "Baixando docker-compose.yml (branch=${BRANCH})..."
  if ! curl -fsSL "${COMPOSE_URL}" -o "${INSTALL_DIR}/docker-compose.yml"; then
    err "Falha ao baixar ${COMPOSE_URL}"
    err "Sem conexão com iacloud.com.br ou URL inválida."
    exit 1
  fi
  ok "Compose baixado ($(wc -l < "${INSTALL_DIR}/docker-compose.yml") linhas)."

  if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    log "Baixando template de .env..."
    curl -fsSL "${ENV_TEMPLATE_URL}" -o "${INSTALL_DIR}/.env" || warn "Sem template, criando .env vazio."
    : > "${INSTALL_DIR}/.env" 2>/dev/null || true
  else
    ok ".env existente preservado."
  fi
}

# ─── Fingerprint da máquina ────────────────────────────────────────────────
generate_machine_fingerprint() {
  local fp_file="${INSTALL_DIR}/data/.machine-id"
  if [[ -f "$fp_file" ]]; then return; fi
  local mac cpu
  mac=$(ip link 2>/dev/null | awk '/ether/ {print $2; exit}')
  cpu=$(grep -m1 'Serial' /proc/cpuinfo 2>/dev/null | awk '{print $3}' || echo "unknown")
  echo "${mac}-${cpu}-$(date +%s)" | sha256sum | head -c 32 > "$fp_file"
  ok "Fingerprint gerado: $(cat "$fp_file")"
}

# ─── Subir stack ────────────────────────────────────────────────────────────
start_stack() {
  log "Subindo stack Docker..."
  cd "${INSTALL_DIR}"
  docker compose pull --quiet 2>&1 | tail -5
  docker compose up -d
  sleep 3
  if docker compose ps --status running | grep -q box-backend; then
    ok "Stack rodando."
  else
    warn "Stack subiu parcialmente. Verifique: cd ${INSTALL_DIR} && docker compose logs"
  fi
}

# ─── Pós-instalação ────────────────────────────────────────────────────────
print_next_steps() {
  local lan_ip
  lan_ip=$(hostname -I | awk '{print $1}')
  cat <<EOF

${C_GREEN}══════════════════════════════════════════════════════════════${C_RESET}
${C_GREEN}  ✓ Box instalada com sucesso${C_RESET}
${C_GREEN}══════════════════════════════════════════════════════════════${C_RESET}

  ${C_BLUE}Próximo passo:${C_RESET} abrir o painel de ativação na rede local

      ${C_GREEN}http://${lan_ip}:8080${C_RESET}

  Você vai precisar da ${C_YELLOW}licenseKey${C_RESET} (formato IACV-XXXX-XXXX-XXXX-XXXX)
  que recebeu por e-mail ao provisionar a Box.

  ${C_DIM}Logs:    cd ${INSTALL_DIR} && docker compose logs -f${C_RESET}
  ${C_DIM}Status:  cd ${INSTALL_DIR} && docker compose ps${C_RESET}
  ${C_DIM}Suporte: suporte@iacloud.com.br${C_RESET}

EOF
}

# ─── Main ───────────────────────────────────────────────────────────────────
main() {
  banner
  log "Versão do instalador: ${VERSION}"
  require_root
  detect_os
  check_resources
  setup_ntp                # antes de instalar Docker — alguns Docker images
                           # quebram pull se relógio do host estiver muito errado
                           # (cert validation falha)
  install_docker
  create_dirs
  fetch_compose
  generate_machine_fingerprint
  start_stack
  print_next_steps
}

main "$@"
