#!/bin/sh
set -eu

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [ -n "$(git status --porcelain=v1)" ]; then
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

docker service ls --format '{{.Name}} {{.Image}} {{.Replicas}}' > "$RELEASE_DIR/services-before.txt"
docker stack config -c docker-stack.yml > "$RELEASE_DIR/stack-rendered.yml"
printf 'commit=%s\ntag=%s\ncreated_at=%s\n' "$SHA" "$TAG" "$(date -Is)" > "$RELEASE_DIR/manifest.txt"

docker stack deploy -c docker-stack.yml vsaas

wait_for_service() {
  service="$1"
  expected_image="$2"
  ready=0

  for _ in $(seq 1 120); do
    actual_image="$(docker service inspect "$service" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true)"
    replicas="$(docker service ls --filter "name=$service" --format '{{.Replicas}}')"
    update_state="$(docker service inspect "$service" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{else}}none{{end}}' 2>/dev/null || true)"

    case "$update_state" in
      paused|rollback_started|rollback_paused)
        echo "ERRO: $service entrou no estado $update_state; iniciando rollback." >&2
        docker service rollback "$service" >/dev/null 2>&1 || true
        return 1
        ;;
    esac

    if [ "$actual_image" = "$expected_image" ] && [ "$replicas" = "1/1" ] && { [ "$update_state" = "completed" ] || [ "$update_state" = "none" ]; }; then
      ready=1
      break
    fi
    sleep 2
  done

  if [ "$ready" != 1 ]; then
    echo "ERRO: $service não convergiu para $expected_image; iniciando rollback." >&2
    docker service rollback "$service" >/dev/null 2>&1 || true
    return 1
  fi
}

wait_for_service vsaas_backend "$VSAAS_BACKEND_IMAGE"
wait_for_service vsaas_frontend "$VSAAS_FRONTEND_IMAGE"
wait_for_service vsaas_ai_worker "$VSAAS_AI_WORKER_IMAGE"
wait_for_service vsaas_roboflow_inference "roboflow/roboflow-inference-server-cpu:0.44.0"

curl -fsS --max-time 10 http://127.0.0.1:3000/health > "$RELEASE_DIR/backend-health.json"
curl -fsS --max-time 10 http://127.0.0.1:8082/ > /dev/null
docker service ls --format '{{.Name}} {{.Image}} {{.Replicas}}' > "$RELEASE_DIR/services-after.txt"

echo "Deploy concluído: $TAG ($SHA)"
