import os

def _secret(name: str) -> str:
    try:
        return open(f"/run/secrets/{name}").read().strip()
    except FileNotFoundError:
        return os.environ.get(name, "")

BACKEND_URL      = os.environ["BACKEND_URL"]
AI_WORKER_SECRET = _secret("ai_worker_secret") or os.environ.get("AI_WORKER_SECRET", "")
GO2RTC_RTSP_BASE = os.environ.get("GO2RTC_RTSP_BASE", "rtsp://go2rtc:8554")
SAMPLE_FPS       = float(os.environ.get("SAMPLE_FPS", "1"))
BATCH_INTERVAL   = float(os.environ.get("BATCH_INTERVAL", "5"))
REFRESH_SEC      = int(os.environ.get("CAMERA_REFRESH_SEC", "300"))
MODEL_NAME       = os.environ.get("YOLO_MODEL", "yolov8n.pt")
