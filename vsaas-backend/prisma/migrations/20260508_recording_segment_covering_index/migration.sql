-- Hardening Iteração 2 — perf: índice covering para queries de manifest VOD.
--
-- Padrão de query observado em playback.service.ts:buildManifest e
-- dayTimelineV2:
--   WHERE "cameraId" = $1
--     AND "startedAt" <= $2
--     AND "endedAt"   >= $3
--   ORDER BY "startedAt" ASC
--
-- Os índices existentes (cameraId,startedAt) e (endedAt) cobrem parcialmente,
-- mas o planner faz Index Scan + filter no endedAt. Composto (cameraId,
-- startedAt, endedAt) permite filtro pelos 3 campos em uma só passagem.
--
-- Risco baixíssimo:
--   - Hoje a tabela tem ~3k linhas (validado em 2026-05-08); CREATE INDEX
--     bloqueia ms — imperceptível.
--   - IF NOT EXISTS torna re-execução segura (idempotente).
--   - Sem alteração de schema lógico.
--   - Postgres pode usar ou não conforme estatísticas (ANALYZE) — qualquer
--     regressão é o planner voltando ao plano antigo.
--
-- Quando a tabela crescer (>1M linhas), recriar com CONCURRENTLY:
--   DROP INDEX "RecordingSegment_camera_started_ended_idx";
--   CREATE INDEX CONCURRENTLY "RecordingSegment_camera_started_ended_idx"
--     ON "RecordingSegment" ("cameraId", "startedAt", "endedAt");
-- (CONCURRENTLY exige fora de transação — não roda via prisma migrate deploy.)

CREATE INDEX IF NOT EXISTS "RecordingSegment_camera_started_ended_idx"
  ON "RecordingSegment" ("cameraId", "startedAt", "endedAt");
