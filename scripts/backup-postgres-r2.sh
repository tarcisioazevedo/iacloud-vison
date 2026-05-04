#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────
# Backup PostgreSQL → Cloudflare R2 (off-site)
#
# Onda 1 / item 1.3 do docs/08-PLAN-MERCADO-NACIONAL-B2B2B.md.
# Decisão 9 do docs/08 Parte 11: R2 (já temos credenciais).
#
# Este script:
#   1. Reusa o backup local feito por backup-postgres.sh (assume rodou antes)
#   2. Sobe o último .sql.gz para R2 com retenção 30 dias (lifecycle policy)
#   3. Mantém 7 dias local + 30 dias remoto = ~37 dias de cobertura
#
# Uso:
#   ./backup-postgres-r2.sh                  # backup do mais recente
#   ./backup-postgres-r2.sh --restore-test   # baixa e tenta restaurar em DB
#                                              temporário (validação mensal)
#
# Pré-requisitos (NÃO CONFIGURADOS AINDA — checklist):
#   [ ] aws-cli instalado no host  (apt install awscli OU container)
#   [ ] /opt/iacloud-vison/secrets/r2-backup.env com:
#         R2_ACCESS_KEY_ID=...
#         R2_SECRET_ACCESS_KEY=...
#         R2_ACCOUNT_ID=...
#         R2_BACKUP_BUCKET=icv-backups-postgres
#   [ ] Bucket icv-backups-postgres criado no R2 com:
#         - Lifecycle: delete após 30 dias
#         - Object lock: opcional (compliance)
#   [ ] Cron (root): 0 3 * * * /opt/iacloud-vison/scripts/backup-postgres.sh && \
#                              /opt/iacloud-vison/scripts/backup-postgres-r2.sh
#   [ ] Validação mensal: 0 4 1 * * .../backup-postgres-r2.sh --restore-test
#
# REVERTER: comentar linha do cron + apagar bucket R2 + apagar secrets/r2-backup.env
# ──────────────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="/opt/iacloud-vison/backups"
SECRETS_FILE="/opt/iacloud-vison/secrets/r2-backup.env"
RESTORE_MODE=0

if [[ "${1:-}" == "--restore-test" ]]; then
  RESTORE_MODE=1
fi

# ── Validar pré-requisitos ───────────────────────────────────────────────
if ! command -v aws &>/dev/null; then
  echo "ERRO: aws-cli não instalado. Execute: sudo apt install awscli" >&2
  exit 1
fi

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "ERRO: $SECRETS_FILE não existe. Crie a partir do template no topo deste script." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$SECRETS_FILE"

: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID não definido em $SECRETS_FILE}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY não definido em $SECRETS_FILE}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID não definido em $SECRETS_FILE}"
: "${R2_BACKUP_BUCKET:?R2_BACKUP_BUCKET não definido em $SECRETS_FILE}"

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# AWS CLI usa env vars padrão para credenciais
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"  # R2 ignora região

# ── Modo backup (default) ────────────────────────────────────────────────
if [[ $RESTORE_MODE -eq 0 ]]; then
  LATEST=$(ls -t "${BACKUP_DIR}"/iacloudvision_*.sql.gz 2>/dev/null | head -1 || true)
  if [[ -z "$LATEST" ]]; then
    echo "ERRO: Nenhum backup local em $BACKUP_DIR. Rode backup-postgres.sh antes." >&2
    exit 1
  fi

  FILENAME=$(basename "$LATEST")
  REMOTE_PATH="s3://${R2_BACKUP_BUCKET}/postgres/${FILENAME}"

  echo "[$(date -Iseconds)] Subindo $LATEST → $REMOTE_PATH"
  aws s3 cp "$LATEST" "$REMOTE_PATH" \
    --endpoint-url "$R2_ENDPOINT" \
    --no-progress

  # Verifica integridade pós-upload (HEAD + size match)
  REMOTE_SIZE=$(aws s3api head-object \
    --bucket "$R2_BACKUP_BUCKET" \
    --key "postgres/${FILENAME}" \
    --endpoint-url "$R2_ENDPOINT" \
    --query 'ContentLength' --output text)
  LOCAL_SIZE=$(stat -c '%s' "$LATEST")

  if [[ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]]; then
    echo "ERRO: tamanho remoto ($REMOTE_SIZE) ≠ local ($LOCAL_SIZE)" >&2
    exit 1
  fi

  echo "[$(date -Iseconds)] OK — $FILENAME ($(numfmt --to=iec "$LOCAL_SIZE")) em R2"
  exit 0
fi

# ── Modo restore-test (mensal) ───────────────────────────────────────────
echo "[$(date -Iseconds)] Validação mensal: baixando último backup do R2 e tentando restaurar em DB temporário"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Achar o backup mais recente no R2
LATEST_REMOTE=$(aws s3 ls "s3://${R2_BACKUP_BUCKET}/postgres/" \
  --endpoint-url "$R2_ENDPOINT" \
  | sort -k1,2 | tail -1 | awk '{print $4}')

if [[ -z "$LATEST_REMOTE" ]]; then
  echo "ERRO: nenhum backup remoto encontrado em $R2_BACKUP_BUCKET/postgres/" >&2
  exit 1
fi

echo "Baixando: $LATEST_REMOTE"
aws s3 cp "s3://${R2_BACKUP_BUCKET}/postgres/${LATEST_REMOTE}" "$TMPDIR/$LATEST_REMOTE" \
  --endpoint-url "$R2_ENDPOINT" --no-progress

# Restore em container postgres temporário (porta alta para não conflitar)
TEST_DB="icv_restore_test_$(date +%s)"
TEST_PORT=55432
TEST_PASSWORD="restore-test-$(openssl rand -hex 8)"

echo "Subindo container postgres temporário em $TEST_PORT..."
TEST_CONTAINER=$(docker run -d --rm \
  -e POSTGRES_PASSWORD="$TEST_PASSWORD" \
  -e POSTGRES_DB="$TEST_DB" \
  -p "${TEST_PORT}:5432" \
  postgres:16-alpine)

# Espera DB ficar ready (max 30s)
for i in {1..30}; do
  if docker exec "$TEST_CONTAINER" pg_isready -U postgres &>/dev/null; then
    break
  fi
  sleep 1
done

echo "Restaurando..."
gunzip -c "$TMPDIR/$LATEST_REMOTE" \
  | docker exec -i "$TEST_CONTAINER" psql -U postgres -d "$TEST_DB" -q

# Sanity check: contar tabelas
TABLE_COUNT=$(docker exec "$TEST_CONTAINER" psql -U postgres -d "$TEST_DB" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public'")

docker stop "$TEST_CONTAINER" >/dev/null

if [[ "$TABLE_COUNT" -lt 30 ]]; then
  echo "ERRO: restore retornou só $TABLE_COUNT tabelas (esperado ~65 do schema VSaaS)" >&2
  exit 1
fi

echo "[$(date -Iseconds)] OK — restore validado: $TABLE_COUNT tabelas em $LATEST_REMOTE"
