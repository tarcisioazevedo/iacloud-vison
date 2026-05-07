#!/usr/bin/env bash
# fix-caddy-port-conflict.sh
#
# Causa: nginx do sistema (default debian) também está habilitado e ganha
# a porta 80 antes do Caddy subir, derrubando o Caddy permanentemente.
# Stack do projeto usa Caddy (ver /etc/caddy/Caddyfile), nginx é leftover.
#
# Diagnóstico em 2026-05-05:
#   nginx: master process /usr/sbin/nginx (PID 937, listen :80)
#   caddy.service: failed (Result: exit-code) — "listen tcp :80: bind: address already in use"
#
# Esta correção é idempotente — pode rodar quantas vezes quiser.
# Também aplica /opt/iacloud-vison/scripts/Caddyfile.proposed (que adiciona
# a rota /preview/* servindo mockups direto do disco) se o Caddyfile ainda
# não tiver essa rota.
set -euo pipefail

PROJECT_DIR="/opt/iacloud-vison"
PROPOSED_CADDYFILE="${PROJECT_DIR}/scripts/Caddyfile.proposed"
LIVE_CADDYFILE="/etc/caddy/Caddyfile"
BACKUP_CADDYFILE="/etc/caddy/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)"

if [[ $EUID -ne 0 ]]; then
  echo "Precisa rodar como root: sudo $0"
  exit 1
fi

# ─── 1) nginx fora do caminho ────────────────────────────────────────────────
echo "==> Parando e mascarando nginx (libera porta 80 pro Caddy)..."
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true
systemctl mask nginx 2>/dev/null || true

# ─── 2) Aplicar Caddyfile com rota /preview/* (idempotente) ──────────────────
if [[ -f "$PROPOSED_CADDYFILE" ]]; then
  if ! grep -q 'handle /preview/\*' "$LIVE_CADDYFILE" 2>/dev/null; then
    echo "==> Aplicando Caddyfile com rota /preview/* (backup em $BACKUP_CADDYFILE)..."
    cp "$LIVE_CADDYFILE" "$BACKUP_CADDYFILE"
    cp "$PROPOSED_CADDYFILE" "$LIVE_CADDYFILE"
    chown root:root "$LIVE_CADDYFILE"
    chmod 644 "$LIVE_CADDYFILE"
  else
    echo "==> Caddyfile já tem rota /preview/* — sem mudanças."
  fi

  echo "==> Validando syntax do Caddyfile..."
  if ! caddy validate --config "$LIVE_CADDYFILE" >/dev/null 2>&1; then
    echo "ERRO: Caddyfile inválido. Restaurando backup..."
    if [[ -f "$BACKUP_CADDYFILE" ]]; then
      cp "$BACKUP_CADDYFILE" "$LIVE_CADDYFILE"
    fi
    caddy validate --config "$LIVE_CADDYFILE"
    exit 1
  fi
else
  echo "==> $PROPOSED_CADDYFILE não encontrado — pulando atualização do Caddyfile."
fi

# ─── 3) Habilitar e subir Caddy ──────────────────────────────────────────────
echo "==> Habilitando e iniciando Caddy..."
systemctl enable caddy
systemctl restart caddy

# ─── 4) Validação ────────────────────────────────────────────────────────────
sleep 2
echo
echo "==> Status:"
if systemctl is-active --quiet caddy; then
  echo "caddy: ATIVO ✓"
else
  echo "caddy: FALHOU ✗"
  systemctl status caddy --no-pager
  exit 1
fi
echo "nginx: $(systemctl is-active nginx 2>&1) ($(systemctl is-enabled nginx 2>&1))"

echo
echo "==> Listeners:"
ss -tln '( sport = :80 or sport = :443 )' || true

echo
echo "==> Health check (espere ~5s pra Caddy resolver TLS se for primeira vez):"
sleep 5
curl -sk -o /dev/null -w "https://app.iacloud.com.br/health → HTTP %{http_code}\n" https://app.iacloud.com.br/health || true
curl -sk -o /dev/null -w "https://app.iacloud.com.br/preview/marketplace/00-index.html → HTTP %{http_code}\n" https://app.iacloud.com.br/preview/marketplace/00-index.html || true

echo
echo "================================================================"
echo "Pronto. Acesse os mockups em:"
echo "  https://app.iacloud.com.br/preview/00-index.html  (índice geral)"
echo "  https://app.iacloud.com.br/preview/marketplace/00-index.html  (marketplace)"
echo "================================================================"
echo
echo "Após reboot, Caddy sobe sozinho e nginx fica masked permanentemente."
