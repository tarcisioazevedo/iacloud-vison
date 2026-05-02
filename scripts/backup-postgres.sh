#!/bin/bash
# Backup PostgreSQL — executa diariamente via cron
# Retém últimos 7 backups

BACKUP_DIR="/opt/iacloud-vison/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/iacloudvision_${TIMESTAMP}.sql.gz"

# Encontra o container do postgres
POSTGRES_CONTAINER=$(docker ps -q -f name=icv_postgres)

if [ -z "$POSTGRES_CONTAINER" ]; then
  echo "ERRO: Container postgres não encontrado"
  exit 1
fi

# Executa pg_dump e comprime
docker exec "$POSTGRES_CONTAINER" pg_dump -U icvuser iacloudvision | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "Backup criado: $BACKUP_FILE"

  # Remove backups antigos (mantém últimos 7)
  ls -t ${BACKUP_DIR}/iacloudvision_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm

  echo "Backups atuais:"
  ls -lh ${BACKUP_DIR}/iacloudvision_*.sql.gz
else
  echo "ERRO: Falha no backup"
  exit 1
fi
