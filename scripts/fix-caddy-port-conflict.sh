#!/usr/bin/env bash
# fix-caddy-port-conflict.sh
#
# Causa: nginx do sistema (default debian) também está habilitado e ganha a porta 80
# antes do Caddy subir, derrubando o Caddy permanentemente.
# Stack do projeto usa Caddy (ver /etc/caddy/Caddyfile), nginx é leftover.
#
# Diagnóstico em 2026-05-05:
#   nginx: master process /usr/sbin/nginx (PID 937, listen :80)
#   caddy.service: failed (Result: exit-code) — "listen tcp :80: bind: address already in use"
#
# Esta correção é idempotente — pode rodar quantas vezes quiser.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Precisa rodar como root: sudo $0"
  exit 1
fi

echo "==> Parando e desabilitando nginx..."
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true
systemctl mask nginx 2>/dev/null || true   # garante que ninguém reabilite por engano

echo "==> Garantindo que Caddy esteja habilitado..."
systemctl enable caddy

echo "==> Subindo Caddy..."
systemctl start caddy

echo "==> Status:"
systemctl is-active caddy && echo "caddy: OK" || { echo "caddy: FALHOU"; systemctl status caddy --no-pager; exit 1; }
echo "nginx: $(systemctl is-active nginx 2>&1) ($(systemctl is-enabled nginx 2>&1))"

echo
echo "==> Validação (espere ~5s para Caddy pegar certificado se necessário)..."
sleep 3
ss -tln '( sport = :80 or sport = :443 )' || true
echo
curl -sk -o /dev/null -w "https://app.iacloud.com.br/health → HTTP %{http_code}\n" https://app.iacloud.com.br/health || true

echo
echo "Pronto. Após reboot, Caddy sobe e nginx fica masked."
