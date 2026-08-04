#!/usr/bin/env bash
# =============================================================================
# VSaaS — Backup automatizado PostgreSQL
#
# pg_dump dentro do container postgres do swarm, gzip in-process, retenção
# local de 7 dias. Roda via cron (root):
#   30 3 * * *  /opt/iacloud-vison/scripts/backup-postgres.sh >> /opt/iacloud-vison/logs/icv-backup.log 2>&1
#
# P1 do PRE-HOMOLOGACAO-CHECKLIST.md.
#
# Histórico:
#   2026-05-12: filtro corrigido (era `icv_postgres`, agora `iacloud_postgres`).
#   2026-06-18: corrigido pra `vsaas_postgres` + DB `vsaas` (rename do stack).
#   2026-08-04: retenção agora roda mesmo se o backup do dia falhar. Antes só
#     rodava dentro do `if` de sucesso — quando o pg_dump começou a falhar
#     (14/07, banco em recovery mode), a limpeza de backups >7d parou junto,
#     o diretório cresceu até encher o disco (100%) e travar o Postgres num
#     crash-loop por falta de espaço pra escrever o checkpoint.
# =============================================================================
set -uo pipefail

BACKUP_DIR="/opt/iacloud-vison/backups"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/vsaas_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Container postgres ativo (task do swarm — hash muda a cada redeploy).
# Filtro `vsaas_postgres` pega o nome do serviço independente do hash.
POSTGRES_CONTAINER=$(docker ps --filter "name=vsaas_postgres" --format "{{.Names}}" | head -1)

if [[ -z "$POSTGRES_CONTAINER" ]]; then
  echo "[$(date -Iseconds)] ERRO: container vsaas_postgres não está rodando" >&2
  exit 1
fi

echo "[$(date -Iseconds)] Iniciando backup → $BACKUP_FILE (container: $POSTGRES_CONTAINER)"

docker exec "$POSTGRES_CONTAINER" pg_dump \
  -U icvuser \
  -d vsaas \
  --no-owner \
  --no-acl \
  --quote-all-identifiers \
  | gzip -9 > "$BACKUP_FILE"
BACKUP_STATUS=$?

BACKUP_OK=0
if [[ $BACKUP_STATUS -eq 0 && -s "$BACKUP_FILE" ]]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[$(date -Iseconds)] Backup OK: $BACKUP_FILE ($SIZE)"
  BACKUP_OK=1
else
  echo "[$(date -Iseconds)] ERRO: falha no backup ou arquivo vazio (status=$BACKUP_STATUS)" >&2
  rm -f "$BACKUP_FILE"
fi

# Retenção: apaga backups com mais de N dias (mais resiliente que tail -n +N).
# Cobre tanto o prefixo atual (vsaas_) quanto o legado (iacloudvision_).
# Roda SEMPRE — sucesso ou falha do backup de hoje — pra nunca mais deixar o
# diretório crescer sem controle quando um dia falhar.
DELETED=$(find "$BACKUP_DIR" \( -name "vsaas_*.sql.gz" -o -name "iacloudvision_*.sql.gz" \) -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [[ "$DELETED" -gt 0 ]]; then
  echo "[$(date -Iseconds)] Retenção: $DELETED backup(s) > ${RETENTION_DAYS}d removidos"
fi

echo "[$(date -Iseconds)] Backups atuais:"
ls -lh "${BACKUP_DIR}"/vsaas_*.sql.gz 2>/dev/null | tail -10

# TODO (P1+): upload para R2 (rclone) — protege contra perda total da VPS.
# Hoje só local: defende contra corrupção de volume, NÃO contra perda da máquina.
# Habilitar quando R2_ACCESS_KEY estiver rotacionado E rclone configurado.

[[ "$BACKUP_OK" -eq 1 ]] || exit 1
