-- RTMP push out (Sprint live-RTMP)
-- Adiciona suporte a transmissão de saída via RTMP em cada câmera. O backend
-- adiciona um producer secundário no go2rtc apontando para o destino RTMP
-- quando rtmpPushEnabled=true. URL cifrada porque pode conter stream key.

ALTER TABLE "Camera"
  ADD COLUMN "rtmpPushUrlEnc"  TEXT,
  ADD COLUMN "rtmpPushEnabled" BOOLEAN NOT NULL DEFAULT false;
