#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# pre-deploy-backup.sh
# Backup do volume config.db de tenants ANTES de qualquer deploy.
# Falha em qualquer backup ABORTA o deploy (exit 1).
#
# Variáveis de entrada:
#   TENANT_FILTER  canary | batch | remaining | all (default: all)
#   BACKUP_DIR     local dos tarballs (default: /backups/predeploy)
#   S3_BUCKET      (opcional) ex: s3://iacv-backups/predeploy
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

: "${TENANT_FILTER:=all}"
: "${BACKUP_DIR:=/backups/predeploy}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "${BACKUP_DIR}"
TS=$(date +%Y%m%d-%H%M%S)

mapfile -t TENANTS < <(
  TENANT_FILTER="${TENANT_FILTER}" \
  bash "${SCRIPT_DIR}/list-tenants.sh"
)

if [[ ${#TENANTS[@]} -eq 0 ]]; then
  echo "⚠ Nenhum tenant para backup (filtro: ${TENANT_FILTER}). OK."
  exit 0
fi

echo "▶ Backup pré-deploy de ${#TENANTS[@]} tenant(s) em ${BACKUP_DIR}"

FAILED=()
for TENANT in "${TENANTS[@]}"; do
  VOLUME="vision-${TENANT}_config"
  OUT="${BACKUP_DIR}/${TENANT}-${TS}.tar.gz"

  if ! docker volume inspect "${VOLUME}" >/dev/null 2>&1; then
    echo "  ⚠ ${VOLUME} não existe. Pulando."
    continue
  fi

  echo -n "  ${TENANT}... "
  if docker run --rm \
       -v "${VOLUME}":/data:ro \
       -v "${BACKUP_DIR}":/backup \
       alpine tar czf "/backup/$(basename "${OUT}")" /data 2>/dev/null; then

    # Validar integridade
    if tar tzf "${OUT}" >/dev/null 2>&1; then
      SIZE=$(du -h "${OUT}" | cut -f1)
      echo "OK (${SIZE})"
    else
      echo "FALHA - tarball corrompido"
      FAILED+=("${TENANT}")
    fi
  else
    echo "FALHA - tar"
    FAILED+=("${TENANT}")
  fi
done

# Upload S3 (opcional)
if [[ -n "${S3_BUCKET:-}" ]]; then
  echo "▶ Enviando para ${S3_BUCKET}/${TS}/"
  aws s3 sync "${BACKUP_DIR}/" "${S3_BUCKET}/${TS}/" \
    --exclude "*" --include "*-${TS}.tar.gz" --quiet
fi

# Limpeza local: manter últimos 7 dias
find "${BACKUP_DIR}" -name "*.tar.gz" -mtime +7 -delete 2>/dev/null || true

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "✗ Backup falhou em: ${FAILED[*]}"
  echo "✗ Deploy NÃO deve prosseguir."
  exit 1
fi

echo "✓ Backup completo: ${#TENANTS[@]} tenants em ${BACKUP_DIR}"
