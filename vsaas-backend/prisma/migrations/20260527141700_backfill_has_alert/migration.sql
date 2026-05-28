-- Backfill hasAlert para review items históricos (severity = ALERT)
--
-- Contexto: a coluna hasAlert foi adicionada em 20260527141600 com default
-- false. Segments criados depois passam a ser marcados via markSegmentMotion
-- (kind='alert'), mas os SEGMENTS ANTIGOS continuam com hasAlert=false mesmo
-- quando há um ReviewItem severity=ALERT cobrindo a janela deles.
--
-- Sem backfill, alertas críticos antigos seriam retidos só pelos 30d do
-- recordAlertRetainDays (via hasEvent) — perdendo o ganho de 90d do tier
-- recordCriticalRetainDays.
--
-- Estratégia: UPDATE incremental respeitando pre/post-buffer da câmera.
-- Idempotente: se rodar 2x, segunda execução é no-op (já está true).
-- Performance: usa o index novo cameraId+hasAlert+startedAt pra escapar
-- full-scan.

-- ── Marca segments cuja janela é coberta por ReviewItem severity=ALERT ───────
-- Pre/post-buffer aplicado: [startAt - preCaptureSec, endAt + postCaptureSec].
-- endAt pode ser NULL — nesse caso usa startAt + 60s como aproximação
-- (mesma convenção do markSegmentMotion).

UPDATE "RecordingSegment" rs
SET "hasAlert" = true
FROM "ReviewItem" ri
JOIN "Camera" c ON c.id = ri."cameraId"
WHERE rs."cameraId" = ri."cameraId"
  AND ri.severity = 'ALERT'
  AND rs."hasAlert" = false
  AND rs."startedAt" <= (COALESCE(ri."endAt", ri."startAt" + interval '60 seconds')
                          + (c."recordPostCaptureSec" || ' seconds')::interval)
  AND rs."endedAt"   >= (ri."startAt"
                          - (c."recordPreCaptureSec" || ' seconds')::interval);

-- Métrica final: quantos segments ficaram com hasAlert=true após backfill.
-- (Apenas informativo nos logs do prisma migrate deploy.)
DO $$
DECLARE total_alert INT;
BEGIN
  SELECT COUNT(*) INTO total_alert FROM "RecordingSegment" WHERE "hasAlert" = true;
  RAISE NOTICE 'Backfill hasAlert concluído: % segments marcados como alerta crítico', total_alert;
END$$;
