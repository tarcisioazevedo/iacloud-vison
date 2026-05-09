#!/bin/bash
# Instala systemd timer pra sincronizar go2rtc.yaml a cada 10min.
# Roda 1x (com sudo). Idempotente — pode rodar várias vezes sem efeito.
#
# O que esse cron resolve:
#   - go2rtc 1.9.x não persiste streams adicionados via API (memória volátil)
#   - quando se cria câmera CLOUD_DIRECT pelo wizard, backend tenta registrar
#     mas pode perder no próximo restart
#   - esse cron roda update-go2rtc-config.sh que regenera o yaml a partir
#     do banco e atualiza o Docker Config (persistente)
#
# Uso: sudo bash scripts/install-go2rtc-sync-cron.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: este script precisa ser rodado com sudo (escreve em /etc/systemd/system/)"
  echo "  sudo bash $0"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMER="$REPO_DIR/scripts/icv-go2rtc-sync.timer"
SERVICE="$REPO_DIR/scripts/icv-go2rtc-sync.service"
SCRIPT="$REPO_DIR/scripts/update-go2rtc-config.sh"

for f in "$TIMER" "$SERVICE" "$SCRIPT"; do
  [[ -f "$f" ]] || { echo "ERROR: $f não encontrado"; exit 1; }
done

# Garante que update-go2rtc-config.sh tem +x
chmod +x "$SCRIPT"

# Copia unit files (cria links simbólicos pra ficar fácil atualizar via git)
ln -sf "$TIMER"   /etc/systemd/system/icv-go2rtc-sync.timer
ln -sf "$SERVICE" /etc/systemd/system/icv-go2rtc-sync.service

systemctl daemon-reload
systemctl enable --now icv-go2rtc-sync.timer

echo ""
echo "✓ Timer instalado e ativo. Próxima execução:"
systemctl list-timers icv-go2rtc-sync.timer --no-pager | tail -3

echo ""
echo "Para acompanhar logs em tempo real:"
echo "  journalctl -f -u icv-go2rtc-sync.service"
echo ""
echo "Para forçar execução agora:"
echo "  sudo systemctl start icv-go2rtc-sync.service"
