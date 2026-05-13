#!/usr/bin/env bash
# =============================================================================
# run-baseline.sh — captura métricas do VPS sob carga conhecida
#
# Sprint γ-Day2. Executa CG01-CG05 e gera saída pra alimentar
# docs/CAPACITY-MODEL.md.
#
# Uso:
#   bash qa/capacity/run-baseline.sh > qa/capacity/baseline-$(date +%F).log
# =============================================================================
set -euo pipefail

PG=$(docker ps --format '{{.Names}}' | grep -m1 '^iacloud_postgres')

snapshot() {
  local label="$1"
  echo ""
  echo "─── $label ──────────────────────────────────"
  echo "── docker stats (sample 5s) ──"
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}' \
    | grep -E 'iacloud_|portainer_' | head -15

  echo ""
  echo "── disco ──"
  df -h / | tail -1

  echo ""
  echo "── DB: tabela RecordingSegment (count + tamanho) ──"
  docker exec "$PG" psql -U icvuser -d iacloudvision -tA <<'SQL' 2>/dev/null || echo "(DB error)"
SELECT
  (SELECT count(*) FROM "RecordingSegment") AS total_segments,
  (SELECT count(*) FROM "RecordingSegment" WHERE "createdAt" > now() - interval '1 minute') AS segs_last_1min,
  pg_size_pretty(pg_total_relation_size('"RecordingSegment"')) AS table_size_seg,
  pg_size_pretty(pg_total_relation_size('"AuditLog"')) AS table_size_audit,
  pg_size_pretty(pg_database_size('iacloudvision')) AS db_total_size;
SQL

  echo ""
  echo "── DB: top câmeras gravando ──"
  docker exec "$PG" psql -U icvuser -d iacloudvision -tA -c "
    SELECT name, status, \"deploymentMode\", \"ingestMode\",
           (SELECT count(*) FROM \"RecordingSegment\" rs WHERE rs.\"cameraId\" = c.id AND rs.\"createdAt\" > now() - interval '1 minute') AS segs_1min
    FROM \"Camera\" c
    WHERE \"recordEnabled\" = true AND status = 'ACTIVE'
    ORDER BY segs_1min DESC LIMIT 5;
  " 2>/dev/null || echo "(DB error)"
}

echo "=== CAPACITY BASELINE — $(date -Iseconds) ==="
echo ""
echo "VPS specs:"
echo "  $(nproc) vCPU"
free -h | awk '/^Mem:/ {print "  " $2 " RAM total"}'
df -h / | awk 'NR==2 {print "  " $2 " disk total, " $4 " livre"}'
echo ""
echo "Backend image: $(docker service inspect iacloud_backend --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | head -c 80)"
echo "Backend uptime: $(docker ps --filter name=iacloud_backend --format '{{.Status}}' | head -1)"

# CG01: idle baseline
snapshot "CG01 — Estado atual (idle/baseline)"

# Take 3 samples 10s apart pra média
sleep 10
snapshot "CG02 — Sample +10s"

sleep 10
snapshot "CG02 — Sample +20s"

echo ""
echo "─── Resumo final ──────────────────────────────"
echo ""
echo "CG01-CG02 capturados. Próximos passos:"
echo "  - CG03 (latência push→playback): manual com câmera real"
echo "  - CG10 (50 câmeras): bash qa/capacity/run-stress.sh 50"
echo ""
echo "Atualizar CAPACITY-MODEL.md com os números acima."
