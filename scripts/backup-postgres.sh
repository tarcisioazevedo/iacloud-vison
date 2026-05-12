#!/usr/bin/env bash
# =============================================================================
# VSaaS — Backup automatizado PostgreSQL
#
# pg_dump dentro do container `iacloud_postgres`, gzip in-process, retenção
# local de 7 dias. Roda via cron sugerido (root):
#   30 3 * * *  /opt/iacloud-vison/scripts/backup-postgres.sh >> /var/log/icv-backup.log 2>&1
#
# P1 do PRE-HOMOLOGACAO-CHECKLIST.md.
#
# 2026-05-12: filtro corrigido (era `icv_postgres`, agora `iacloud_postgres` —
# nome real do service no swarm).
# =============================================================================
set -euo pipefail

BACKUP_DIR="/opt/iacloud-vison/backups"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/iacloudvision_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Localiza o container postgres ativo. Filtro `iacloud_postgres` pega o task
# do swarm independente do hash da task (que muda a cada redeploy).
POSTGRES_CONTAINER=$(docker ps --filter "name=iacloud_postgres" --format "{{.Names}}" | head -1)

if [[ -z "$POSTGRES_CONTAINER" ]]; then
  echo "[$(date -Iseconds)] ERRO: container iacloud_postgres não está rodando" >&2
  exit 1
fi

echo "[$(date -Iseconds)] Iniciando backup → $BACKUP_FILE (container: $POSTGRES_CONTAINER)"

docker exec "$POSTGRES_CONTAINER" pg_dump \
  -U icvuser \
  -d iacloudvision \
  --no-owner \
  --no-acl \
  --quote-all-identifiers \
  | gzip -9 > "$BACKUP_FILE"

if [[ $? -eq 0 && -s "$BACKUP_FILE" ]]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[$(date -Iseconds)] Backup OK: $BACKUP_FILE ($SIZE)"

  # Retenção: apaga backups com mais de N dias (mais resiliente que tail -n +N)
  DELETED=$(find "$BACKUP_DIR" -name "iacloudvision_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
  if [[ "$DELETED" -gt 0 ]]; then
    echo "[$(date -Iseconds)] Retenção: $DELETED backup(s) > ${RETENTION_DAYS}d removidos"
  fi

  echo "[$(date -Iseconds)] Backups atuais:"
  ls -lh "${BACKUP_DIR}"/iacloudvision_*.sql.gz 2>/dev/null | tail -10
else
  echo "[$(date -Iseconds)] ERRO: falha no backup ou arquivo vazio" >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

# TODO (P1+): upload para R2 (rclone) — protege contra perda total da VPS.
# Hoje só local: defende contra corrupção de volume, NÃO contra perda da máquina.
# Habilitar quando R2_ACCESS_KEY estiver rotacionado E rclone configurado.
