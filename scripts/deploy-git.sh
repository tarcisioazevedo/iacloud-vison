#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ -n "$(git status --porcelain=v1)" ]]; then
  echo "ERRO: working tree precisa estar limpa para deploy." >&2
  exit 2
fi

SHA="$(git rev-parse --verify HEAD)"
TAG="$(git rev-parse --short=10 HEAD)"
RELEASE_DIR="/opt/iacloud-vison/releases/$TAG"
mkdir -p "$RELEASE_DIR"

./scripts/release-preflight.sh

docker build -t "vsaas-backend:$TAG" vsaas-backend
docker build -t "vsaas-frontend:$TAG" vsaas-frontend
docker build -t "vsaas-ai-worker:$TAG" vsaas-ai-worker

export VSAAS_BACKEND_IMAGE="vsaas-backend:$TAG"
export VSAAS_FRONTEND_IMAGE="vsaas-frontend:$TAG"
export VSAAS_AI_WORKER_IMAGE="vsaas-ai-worker:$TAG"

docker service ls --format '{{.Name}} {{.Image}} {{.Replicas}}' +  > "$RELEASE_DIR/services-before.txt"
docker stack config -c docker-stack.yml > "$RELEASE_DIR/stack-rendered.yml"
printf 'commit=%s\ntag=%s\ncreated_at=%s\n' "$SHA" "$TAG" "$(date -Is)" +  > "$RELEASE_DIR/manifest.txt"

docker stack deploy -c docker-stack.yml vsaas

for service in vsaas_backend vsaas_frontend vsaas_ai_worker; do
  ready=0
  for _ in $(seq 1 90); do
    if [[ "$(docker service ls --filter "name=$service" --format '{{.Replicas}}')" == "1/1" ]]; then
      ready=1
      break
    fi
    sleep 2
  done
  if [[ "$ready" != 1 ]]; then
    echo "ERRO: $service não convergiu; execute docker service rollback $service" >&2
    exit 3
  fi
done

curl -fsS --max-time 10 http://127.0.0.1:3000/health +  > "$RELEASE_DIR/backend-health.json"
curl -fsS --max-time 10 http://127.0.0.1:8082/ +  > /dev/null
docker service ls --format '{{.Name}} {{.Image}} {{.Replicas}}' +  > "$RELEASE_DIR/services-after.txt"

echo "Deploy concluído: $TAG ($SHA)"
