import os


def _secret(name: str) -> str:
    try:
        return open(f"/run/secrets/{name}").read().strip()
    except FileNotFoundError:
        return os.environ.get(name, "")


BACKEND_URL      = os.environ["BACKEND_URL"]
AI_WORKER_SECRET = _secret("ai_worker_secret") or os.environ.get("AI_WORKER_SECRET", "")
GO2RTC_RTSP_BASE = os.environ.get("GO2RTC_RTSP_BASE", "rtsp://go2rtc:8554")
SAMPLE_FPS       = float(os.environ.get("SAMPLE_FPS", "3"))
BATCH_INTERVAL   = float(os.environ.get("BATCH_INTERVAL", "5"))
REFRESH_SEC      = int(os.environ.get("CAMERA_REFRESH_SEC", "300"))
MODEL_NAME       = os.environ.get("YOLO_MODEL", "yolov8n.pt")

# ── Motion gate (Frigate-style) ────────────────────────────────────────────
# Pula YOLO em frames sem movimento → -70% CPU em câmera estática.
MOTION_ENABLED       = os.environ.get("MOTION_ENABLED", "true").lower() == "true"
MOTION_THRESHOLD     = int(os.environ.get("MOTION_THRESHOLD", "30"))      # uint8 delta
MOTION_CONTOUR_AREA  = int(os.environ.get("MOTION_CONTOUR_AREA", "30"))   # px² mínimo

# ── Tracking (Norfair + Kalman) ────────────────────────────────────────────
# Agrupa frames consecutivos do mesmo objeto em "events".
# Defaults ajustados pra 3fps (Frigate usa 5fps; distance_threshold escala
# automaticamente em tracker.py via sample_fps).
MIN_INITIALIZED   = int(os.environ.get("MIN_INITIALIZED", "2"))       # 3fps: 2 frames (~0.66s) confirma sem ruído single-frame
MAX_DISAPPEARED   = int(os.environ.get("MAX_DISAPPEARED", "9"))       # 9 frames @ 3fps = 3s sem detecção → encerra (era 24=8s)
CONFIRM_THRESHOLD = float(os.environ.get("CONFIRM_THRESHOLD", "0.5")) # alinha com aiConfidenceMin

# Change 1 — Median Score Confirmation (Frigate approach)
# Tamanho do histórico de scores por track. Usar 3x MIN_INITIALIZED garante
# que a mediana não seja dominada pelos primeiros frames incertos.
# Valor mínimo efetivo é 6 (3 × MIN_INITIALIZED padrão de 2).
SCORE_HISTORY_SIZE = int(os.environ.get("SCORE_HISTORY_SIZE", "9"))  # 3x MIN_INITIALIZED default

# Change 3 — Stationary Object Mode (Frigate approach)
# Evita YOLO desnecessário em objetos que pararam de mover.
# STATIONARY_THRESHOLD: frames imóveis antes de marcar como estacionário.
# STATIONARY_INTERVAL: a cada N frames, re-detecta o objeto estacionário.
# Defaults calibrados pra 3fps: 30 frames ≈ 10s parado → estacionário;
# re-detecta a cada 15 frames ≈ 5s.
STATIONARY_THRESHOLD = int(os.environ.get("STATIONARY_THRESHOLD", "30"))  # ~10s @ 3fps
STATIONARY_INTERVAL  = int(os.environ.get("STATIONARY_INTERVAL",  "15"))  # re-detect ~5s @ 3fps

# Change 2 — Lightning/Global Change Detection (Frigate approach)
# Se >LIGHTNING_THRESHOLD da tela mudar ao mesmo tempo (switch IR, flash, raio),
# reseta o background model e pula YOLO nesse frame (não há objeto real).
LIGHTNING_THRESHOLD = float(os.environ.get("LIGHTNING_THRESHOLD", "0.8"))

# ── Heartbeat ──────────────────────────────────────────────────────────────
HEARTBEAT_INTERVAL = int(os.environ.get("HEARTBEAT_INTERVAL", "30"))  # segundos

# ── Redis pub/sub para live detections (Sprint 1 IA Contador) ──────────────
# Worker publica em "icv:live-detections:{cameraId}" a cada frame com detecções.
# Backend assina e repassa via SSE para o frontend. Throttle obrigatório para
# evitar saturar Redis em câmeras de alto movimento (max 5 pub/s por câmera).
REDIS_URL                  = os.environ.get("REDIS_URL", "redis://redis:6379")
LIVE_PUB_ENABLED           = os.environ.get("LIVE_PUB_ENABLED", "true").lower() == "true"
LIVE_PUB_MIN_INTERVAL_MS   = int(os.environ.get("LIVE_PUB_MIN_INTERVAL_MS", "200"))  # 5 pub/s
# Quando true (default), o live publisher só emite bboxes associados a um
# track Norfair confirmado — elimina detecções "fantasma" de frame único.
# Custo: ~0.3s de latência extra para o bbox aparecer (MIN_INITIALIZED frames).
# Setar false para reverter ao comportamento original (publica tudo imediatamente).
LIVE_PUB_REQUIRE_TRACK     = os.environ.get("LIVE_PUB_REQUIRE_TRACK", "true").lower() == "true"

# ── Timelapse worker ───────────────────────────────────────────────────────
TIMELAPSE_ENABLED  = os.environ.get("TIMELAPSE_ENABLED", "true").lower() == "true"
TIMELAPSE_POLL_SEC = int(os.environ.get("TIMELAPSE_POLL_SEC", "60"))
TIMELAPSE_TMP_DIR  = os.environ.get("TIMELAPSE_TMP_DIR", "/tmp/timelapse")
