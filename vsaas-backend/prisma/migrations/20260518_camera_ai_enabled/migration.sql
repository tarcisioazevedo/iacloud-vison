-- Camera: cloud AI worker fields
-- aiEnabled: habilita inferência YOLO server-side via vsaas-ai-worker
-- aiConfidenceMin: threshold mínimo de confiança para gravar DetectionFrame
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS "aiEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS "aiConfidenceMin" DOUBLE PRECISION NOT NULL DEFAULT 0.50;
