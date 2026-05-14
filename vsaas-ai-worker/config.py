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
MAX_DISAPPEARED   = int(os.environ.get("MAX_DISAPPEARED", "24"))      # 24 frames @ 3fps = 8s sem detecção → encerra
CONFIRM_THRESHOLD = float(os.environ.get("CONFIRM_THRESHOLD", "0.5")) # alinha com aiConfidenceMin
