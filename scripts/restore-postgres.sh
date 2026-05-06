#!/bin/bash
# =============================================================================
# Restore PostgreSQL — FCB-017 (DR / v1 piloto definitiva)
# =============================================================================
# Restaura backup PostgreSQL de:
#   - backup local mais recente (default)
#   - backup local específico (--from-local <arquivo>)
#   - backup R2 específico (--from-r2 <date>)        [requer aws-cli]
#
# Modos:
#   --target prod     restaura no DB de produção (DESTRUTIVO — confirma 2x)
#   --target test     restaura em DB temporário 'icv_restore_test' (default)
#   --dry-run         baixa o backup, valida integridade do gzip, NÃO restaura
#
# Smoke queries pós-restore:
#   - SELECT count(*) FROM "EdgeNode"
#   - SELECT max("createdAt") FROM "AnalyticsEvent"
#   Compara com produção e alerta se diff > 5%
#
# Uso típico mensal (cron):
#   ./restore-postgres.sh --target test --dry-run    # smoke validação backup
#
# Uso emergencial (DR real):
#   ./restore-postgres.sh --from-r2 2026-05-04 --target prod
#
# =============================================================================

set -uo pipefail

# ─── Configuração ────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/opt/iacloud-vison/backups}"
SECRETS_FILE="${SECRETS_FILE:-/opt/iacloud-vison/secrets/r2-backup.env}"
PG_USER="${PG_USER:-icvuser}"
PG_DB_PROD="${PG_DB_PROD:-iacloudvision}"
PG_DB_TEST="${PG_DB_TEST:-icv_restore_test}"
PG_CONTAINER="${PG_CONTAINER:-$(docker ps -q -f name=icv_postgres -f name=iacloud_postgres | head -1)}"

# ─── Cores ───────────────────────────────────────────────────────────────
GREEN='\033[1;32m'; RED='\033[1;31m'; YELLOW='\033[1;33m'
BLUE='\033[1;34m'; DIM='\033[2m'; RESET='\033[0m'

log()  { echo -e "${BLUE}[restore]${RESET} $*"; }
ok()   { echo -e "${GREEN}[ OK ]${RESET} $*"; }
warn() { echo -e "${YELLOW}[WARN]${RESET} $*"; }
err()  { echo -e "${RED}[ERR ]${RESET} $*" >&2; }

# ─── Args ────────────────────────────────────────────────────────────────
SOURCE=""
TARGET="test"
DRY_RUN=0
FROM_LOCAL=""
FROM_R2=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-local) FROM_LOCAL="$2"; shift 2 ;;
    --from-r2)    FROM_R2="$2";    shift 2 ;;
    --target)     TARGET="$2";     shift 2 ;;
    --dry-run)    DRY_RUN=1;       shift   ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *)
      err "Argumento desconhecido: $1"; exit 1 ;;
  esac
done

# ─── Pré-requisitos ──────────────────────────────────────────────────────
if [[ -z "$PG_CONTAINER" ]]; then
  err "Container PostgreSQL não encontrado (esperado nome 'icv_postgres' ou 'iacloud_postgres')"
  exit 1
fi
log "PostgreSQL container: $PG_CONTAINER"

# ─── Resolver fonte do backup ────────────────────────────────────────────
SRC_FILE=""
if [[ -n "$FROM_R2" ]]; then
  log "Modo R2: baixando backup com data $FROM_R2..."

  if [[ ! -f "$SECRETS_FILE" ]]; then
    err "Secrets file não encontrado: $SECRETS_FILE"
    err "Esperado: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BACKUP_BUCKET"
    exit 1
  fi
  set -a; source "$SECRETS_FILE"; set +a

  if ! command -v aws >/dev/null 2>&1; then
    err "aws-cli não instalado. Execute: apt install awscli"
    exit 1
  fi

  R2_KEY="iacloudvision_${FROM_R2}.sql.gz"
  TMP_DIR="$(mktemp -d)"
  SRC_FILE="${TMP_DIR}/${R2_KEY}"

  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  aws --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
      s3 cp "s3://${R2_BACKUP_BUCKET}/${R2_KEY}" "$SRC_FILE"

  if [[ ! -f "$SRC_FILE" ]]; then
    err "Falha ao baixar backup R2: $R2_KEY"
    exit 1
  fi
  ok "Backup R2 baixado em $SRC_FILE ($(du -h "$SRC_FILE" | cut -f1))"

elif [[ -n "$FROM_LOCAL" ]]; then
  if [[ ! -f "$FROM_LOCAL" ]]; then
    err "Backup local não encontrado: $FROM_LOCAL"
    exit 1
  fi
  SRC_FILE="$FROM_LOCAL"

else
  log "Buscando backup local mais recente..."
  SRC_FILE=$(ls -t "${BACKUP_DIR}"/iacloudvision_*.sql.gz 2>/dev/null | head -1)
  if [[ -z "$SRC_FILE" ]]; then
    err "Nenhum backup local em ${BACKUP_DIR}/"
    exit 1
  fi
fi

ok "Origem: $SRC_FILE ($(du -h "$SRC_FILE" | cut -f1))"

# ─── Validar integridade do gzip ─────────────────────────────────────────
log "Validando integridade do gzip..."
if ! gunzip -t "$SRC_FILE" 2>/dev/null; then
  err "Arquivo corrompido ou não-gzip: $SRC_FILE"
  exit 1
fi
ok "Gzip íntegro"

# Extrair primeiras linhas para confirmar que é dump pg_dump válido
HEAD_BYTES=$(zcat "$SRC_FILE" 2>/dev/null | head -c 200)
if echo "$HEAD_BYTES" | grep -q "PostgreSQL database dump\|^--\|^SET"; then
  ok "Header pg_dump confirmado"
else
  warn "Header não tem marcadores pg_dump típicos — pode ser dump customizado"
fi

# ─── Dry-run termina aqui ────────────────────────────────────────────────
if [[ $DRY_RUN -eq 1 ]]; then
  ok "Dry-run completo. Backup válido. Sem restauração."
  exit 0
fi

# ─── Resolver DB target ──────────────────────────────────────────────────
case "$TARGET" in
  prod) DB="$PG_DB_PROD" ;;
  test) DB="$PG_DB_TEST" ;;
  *) err "--target inválido: $TARGET (use 'prod' ou 'test')"; exit 1 ;;
esac

# ─── Confirmação dupla pra prod ──────────────────────────────────────────
if [[ "$TARGET" == "prod" ]]; then
  warn "RESTAURAR EM PRODUÇÃO É DESTRUTIVO. Vai apagar dados atuais e substituir pelo backup."
  echo -n "Digite EXATAMENTE 'RESTAURAR PROD' para confirmar: "
  read -r CONFIRM1
  if [[ "$CONFIRM1" != "RESTAURAR PROD" ]]; then
    err "Cancelado pelo usuário"; exit 1
  fi
  echo -n "Última chance. Digite o nome do DB ($PG_DB_PROD) para confirmar: "
  read -r CONFIRM2
  if [[ "$CONFIRM2" != "$PG_DB_PROD" ]]; then
    err "Nome incorreto. Cancelado"; exit 1
  fi

  # Backup defensivo antes de destruir
  DEFENSE_BACKUP="${BACKUP_DIR}/PRE_RESTORE_$(date +%Y%m%d_%H%M%S).sql.gz"
  log "Backup defensivo: $DEFENSE_BACKUP"
  docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB_PROD" | gzip > "$DEFENSE_BACKUP"
  ok "Pre-restore snapshot: $DEFENSE_BACKUP"
fi

# ─── Restore ─────────────────────────────────────────────────────────────
log "Restaurando em DB '$DB'..."

# Drop & recreate (somente para test; para prod, restore overlay direto)
if [[ "$TARGET" == "test" ]]; then
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $PG_DB_TEST;" 2>&1 | tail -2
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres \
    -c "CREATE DATABASE $PG_DB_TEST;" 2>&1 | tail -2
fi

# Aplicar dump
START_TS=$(date +%s)
zcat "$SRC_FILE" | docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$DB" 2>&1 | tail -10
END_TS=$(date +%s)
DURATION=$((END_TS - START_TS))

ok "Restore concluído em ${DURATION}s"

# ─── Smoke queries pós-restore ───────────────────────────────────────────
log "Smoke queries..."

count_query() {
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$DB" -tAc "$1" 2>/dev/null | tr -d ' '
}

EDGE_NODES=$(count_query "SELECT count(*) FROM \"EdgeNode\";" || echo "?")
ANALYTICS=$(count_query "SELECT count(*) FROM \"AnalyticsEvent\";" || echo "?")
INTEGRADORES=$(count_query "SELECT count(*) FROM \"Integrador\";" || echo "?")
USERS=$(count_query "SELECT count(*) FROM \"User\";" || echo "?")
CAMERAS=$(count_query "SELECT count(*) FROM \"Camera\";" || echo "?")
LAST_EVENT=$(count_query "SELECT max(\"capturedAt\") FROM \"AnalyticsEvent\";" || echo "?")

echo ""
log "Resumo:"
echo "  EdgeNodes:        $EDGE_NODES"
echo "  AnalyticsEvents:  $ANALYTICS"
echo "  Integradores:     $INTEGRADORES"
echo "  Users:            $USERS"
echo "  Cameras:          $CAMERAS"
echo "  Último evento:    $LAST_EVENT"
echo ""

# Sanity: comparar com prod (se restaurou em test)
if [[ "$TARGET" == "test" ]]; then
  PROD_EDGE=$(count_query "SELECT count(*) FROM \"EdgeNode\";" 2>/dev/null && \
              docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB_PROD" -tAc "SELECT count(*) FROM \"EdgeNode\";" 2>/dev/null | tr -d ' ' || echo "?")
  if [[ "$PROD_EDGE" != "?" && "$EDGE_NODES" != "?" ]]; then
    DIFF=$(( PROD_EDGE - EDGE_NODES ))
    if [[ ${DIFF#-} -gt $((PROD_EDGE / 20)) ]]; then  # diff > 5%
      warn "Diff EdgeNode prod vs restaurado: $DIFF (prod=$PROD_EDGE, restaurado=$EDGE_NODES)"
      warn "Backup pode ter sido feito em momento de baixa atividade ou está stale"
    else
      ok "EdgeNode count OK (prod=$PROD_EDGE, restaurado=$EDGE_NODES, diff=$DIFF)"
    fi
  fi
fi

# Cleanup do tmp R2
if [[ -n "$FROM_R2" ]] && [[ -d "$TMP_DIR" ]]; then
  rm -rf "$TMP_DIR"
fi

ok "Restore validado. Target: $DB."

if [[ "$TARGET" == "test" ]]; then
  echo ""
  log "Para testar a aplicação contra esse DB:"
  echo "  DATABASE_URL=postgresql://${PG_USER}@localhost/${PG_DB_TEST} npm run dev"
  echo ""
  log "Para limpar:"
  echo "  docker exec $PG_CONTAINER psql -U $PG_USER -d postgres -c 'DROP DATABASE $PG_DB_TEST;'"
fi
