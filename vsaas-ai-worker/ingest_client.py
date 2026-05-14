import logging
import requests
from config import BACKEND_URL, AI_WORKER_SECRET

logger = logging.getLogger(__name__)
_session = requests.Session()
_session.headers.update({"Authorization": f"Bearer {AI_WORKER_SECRET}"})

def post_frames(camera_id: str, frames: list[dict]) -> bool:
    if not frames:
        return True
    try:
        r = _session.post(
            f"{BACKEND_URL}/detections/ingest",
            json={"cameraId": camera_id, "frames": frames},
            timeout=10,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        logger.warning("ingest_failed camera=%s err=%s", camera_id, e)
        return False
