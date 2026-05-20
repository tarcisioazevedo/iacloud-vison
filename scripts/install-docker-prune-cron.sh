#!/usr/bin/env bash
# Instala cron semanal de prune Docker (build cache + imagens >7d).
# Roda domingo 04:00 UTC = 01:00 BRT. Output em /var/log/docker-prune.log.
#
# Uso: sudo bash scripts/install-docker-prune-cron.sh
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "ERRO: precisa rodar como root (sudo)" >&2
  exit 1
fi

cat > /etc/cron.d/docker-prune <<'EOF'
# Limpa build cache + imagens nao usadas ha >7d, semanalmente.
# Janela de baixo trafego (01:00 BRT). Output em /var/log/docker-prune.log.
0 4 * * 0 root /usr/bin/docker builder prune -af --filter "until=168h" >> /var/log/docker-prune.log 2>&1; /usr/bin/docker image prune -af --filter "until=168h" >> /var/log/docker-prune.log 2>&1; /usr/bin/df -h / >> /var/log/docker-prune.log 2>&1; echo "--- $(date -u) prune done ---" >> /var/log/docker-prune.log
EOF

chmod 644 /etc/cron.d/docker-prune
systemctl reload cron || systemctl restart cron

echo "OK: cron instalado em /etc/cron.d/docker-prune"
echo "Log: /var/log/docker-prune.log"
