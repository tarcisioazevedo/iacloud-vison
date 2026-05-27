-- Renomeia valores do enum RecordingMode (ALL → CONTINUOUS, ACTIVE_OBJECTS → EVENT)
-- e adiciona suporte ao tier "ALERTA CRÍTICO" em RecordingSegment + Camera.
--
-- Por que renomear: nomenclatura ALL/ACTIVE_OBJECTS confunde operador. Padronizamos
-- em CONTINUOUS/MOTION/EVENT/DISABLED — alinha com terminologia de mercado (Frigate,
-- Hikvision, Milestone) e fica auto-explicável na UI.
--
-- ALTER TYPE ... RENAME VALUE é atômico no Postgres 10+ — sem necessidade de
-- migrar dados (rotules apenas). Idempotente via DO BLOCK que checa existência.
--
-- Sobre o hasAlert: hoje só temos hasMotion + hasEvent. Tudo que dispara review
-- vira hasEvent=true, então recordAlertRetainDays cobre detecções rotineiras + alertas
-- HIGH severity igual. Separamos: hasAlert distingue review item severity=ALERT
-- (operador deve revisar) de hasEvent (detecção classificada qualquer). Isto permite
-- política "alerta crítico fica 90d, detecção comum 30d".

-- ── 1. Renomeia valores do enum RecordingMode ─────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'RecordingMode' AND e.enumlabel = 'ALL'
  ) THEN
    ALTER TYPE "RecordingMode" RENAME VALUE 'ALL' TO 'CONTINUOUS';
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'RecordingMode' AND e.enumlabel = 'ACTIVE_OBJECTS'
  ) THEN
    ALTER TYPE "RecordingMode" RENAME VALUE 'ACTIVE_OBJECTS' TO 'EVENT';
  END IF;
END$$;

-- ── 2. Adiciona hasAlert em RecordingSegment + índice de retention ────────────

ALTER TABLE "RecordingSegment"
  ADD COLUMN IF NOT EXISTS "hasAlert" BOOLEAN NOT NULL DEFAULT false;

-- Index pra acelerar o job de retention que filtra por hasAlert/hasEvent/hasMotion
CREATE INDEX IF NOT EXISTS "RecordingSegment_camera_hasAlert_started_idx"
  ON "RecordingSegment" ("cameraId", "hasAlert", "startedAt");

-- ── 3. Adiciona recordCriticalRetainDays em Camera ────────────────────────────

ALTER TABLE "Camera"
  ADD COLUMN IF NOT EXISTS "recordCriticalRetainDays" INTEGER NOT NULL DEFAULT 90;
