-- Adiciona SRT_PUSH ao enum IngestMode.
-- SRT (Secure Reliable Transport) é um protocolo UDP-based mais robusto
-- que RTMP em redes instáveis: retransmite pacotes perdidos, latência
-- configurável (200ms-3s), e suporte AES-128/256 nativo.
--
-- Câmera/encoder empurra via:
--   srt://app.iacloud.com.br:8890?streamid=<streamKey>&latency=500
-- go2rtc registra o stream como producer SRT, e cloud-direct-recorder
-- consome via RTSP local (mesma pipeline do RTMP).
--
-- ALTER TYPE precisa rodar fora de transação no Postgres < 12.
-- A partir do 12 funciona dentro normalmente.

ALTER TYPE "IngestMode" ADD VALUE IF NOT EXISTS 'SRT_PUSH';
