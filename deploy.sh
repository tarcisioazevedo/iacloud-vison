#!/bin/bash
# =============================================================================
# IA Cloud Vision — Deploy Docker Swarm
# Uso: bash deploy.sh [init|update|status|logs]
# =============================================================================
set -e

STACK_NAME="icv"
STACK_FILE="docker-stack.yml"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[ICV]${NC} $1"; }
warn() { echo -e "${YELLOW}[ICV]${NC} $1"; }
err()  { echo -e "${RED}[ICV]${NC} $1"; exit 1; }

# ─── Argumentos ───────────────────────────────────────────────────────────────
ACTION=${1:-init}

case $ACTION in
  status)
    docker stack ps $STACK_NAME --no-trunc
    exit 0 ;;
  logs)
    SERVICE=${2:-backend}
    docker service logs ${STACK_NAME}_${SERVICE} -f --tail 100
    exit 0 ;;
  rm|remove)
    warn "Removendo stack $STACK_NAME..."
    docker stack rm $STACK_NAME
    exit 0 ;;
esac

# ─── 1. Swarm init ────────────────────────────────────────────────────────────
log "Verificando Docker Swarm..."
if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
  log "Inicializando Swarm..."
  docker swarm init
else
  log "Swarm já ativo."
fi

# ─── 2. Secrets ───────────────────────────────────────────────────────────────
log "Criando secrets..."
mkdir -p secrets

# JWT Secret
if ! docker secret inspect jwt_secret &>/dev/null; then
  if [ ! -f secrets/jwt_secret.txt ]; then
    openssl rand -base64 48 > secrets/jwt_secret.txt
    warn "JWT secret gerado em secrets/jwt_secret.txt"
  fi
  docker secret create jwt_secret secrets/jwt_secret.txt
  log "Secret jwt_secret criado."
else
  log "Secret jwt_secret já existe."
fi

# SMTP Password
if ! docker secret inspect smtp_pass &>/dev/null; then
  if [ ! -f secrets/smtp_pass.txt ]; then
    err "Crie secrets/smtp_pass.txt com a senha SMTP antes de continuar."
  fi
  docker secret create smtp_pass secrets/smtp_pass.txt
  log "Secret smtp_pass criado."
else
  log "Secret smtp_pass já existe."
fi

# DB Password
if ! docker secret inspect db_password &>/dev/null; then
  if [ ! -f secrets/db_password.txt ]; then
    echo "icvpass" > secrets/db_password.txt
    warn "DB password padrão em secrets/db_password.txt — altere em produção!"
  fi
  docker secret create db_password secrets/db_password.txt
  log "Secret db_password criado."
else
  log "Secret db_password já existe."
fi

# ─── 3. Configs (mosquitto) ───────────────────────────────────────────────────
log "Criando configs..."
mkdir -p vsaas-backend/mosquitto
if [ ! -f vsaas-backend/mosquitto/mosquitto.conf ]; then
  cat > vsaas-backend/mosquitto/mosquitto.conf << 'MQTTEOF'
listener 1883
allow_anonymous true
persistence true
persistence_location /mosquitto/data/
log_dest file /mosquitto/log/mosquitto.log
MQTTEOF
  log "mosquitto.conf criado."
fi

# Recriar config se mudou (swarm configs são imutáveis — precisa versionar)
CONFIG_EXISTS=$(docker config ls --format '{{.Name}}' | grep -c "^mosquitto_conf$" || true)
if [ "$CONFIG_EXISTS" -eq 0 ]; then
  docker config create mosquitto_conf vsaas-backend/mosquitto/mosquitto.conf
  log "Config mosquitto_conf criado."
else
  log "Config mosquitto_conf já existe."
fi

# ─── 4. GCP placeholder ───────────────────────────────────────────────────────
if [ ! -f vsaas-backend/gcp-service-account.json ]; then
  echo '{}' > vsaas-backend/gcp-service-account.json
  warn "GCP service account vazio. Substitua vsaas-backend/gcp-service-account.json para usar GCP."
fi

# ─── 4b. Hetzner S3 (Object Storage) ──────────────────────────────────────────
if [ -f secrets/s3.env ]; then
  log "Carregando configuração S3 de secrets/s3.env..."
  export $(grep -v '^#' secrets/s3.env | xargs)
else
  warn "secrets/s3.env não encontrado. Gravações ficarão apenas no disco local."
  warn "Copie secrets/s3.env.example para secrets/s3.env e configure o Hetzner S3."
fi

# ─── 5. Build das imagens ─────────────────────────────────────────────────────
log "Buildando imagem backend (target: production)..."
docker build \
  --target production \
  -t icv_backend:latest \
  vsaas-backend/

log "Buildando imagem frontend..."
docker build \
  -t icv_frontend:latest \
  vsaas-frontend/

# ─── 6. Deploy do stack ───────────────────────────────────────────────────────
log "Fazendo deploy do stack '$STACK_NAME'..."
docker stack deploy -c $STACK_FILE $STACK_NAME

# ─── 7. Aguardar postgres e rodar migrations ──────────────────────────────────
log "Aguardando postgres ficar healthy (máx 120s)..."
ELAPSED=0
until docker exec $(docker ps -q -f name=${STACK_NAME}_postgres) \
      pg_isready -U icvuser -d iacloudvision 2>/dev/null; do
  sleep 5; ELAPSED=$((ELAPSED+5))
  [ $ELAPSED -ge 120 ] && err "Postgres não ficou healthy em 120s."
  warn "Aguardando... ${ELAPSED}s"
done

log "Rodando Prisma migrations..."
BACKEND_CONTAINER=$(docker ps -q -f name=${STACK_NAME}_backend)
if [ -n "$BACKEND_CONTAINER" ]; then
  docker exec $BACKEND_CONTAINER npx prisma migrate deploy
  log "Migrations aplicadas."
else
  warn "Backend ainda subindo. Rode manualmente:"
  warn "  docker exec \$(docker ps -q -f name=${STACK_NAME}_backend) npx prisma migrate deploy"
fi

# ─── 8. Status final ──────────────────────────────────────────────────────────
log "Stack deployado. Status:"
docker stack ps $STACK_NAME --format "table {{.Name}}\t{{.CurrentState}}\t{{.Error}}"

echo ""
log "Endpoints:"
echo "  Backend  → http://$(hostname -I | awk '{print $1}'):3000"
echo "  Frontend → http://$(hostname -I | awk '{print $1}'):5173"
echo ""
log "Comandos úteis:"
echo "  bash deploy.sh logs backend   → logs do backend"
echo "  bash deploy.sh status         → estado dos serviços"
echo "  bash deploy.sh update         → rebuild + redeploy"
echo "  docker service ls             → todos os serviços"
