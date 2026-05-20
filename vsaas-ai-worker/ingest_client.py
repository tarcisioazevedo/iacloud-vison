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
    except requests.HTTPError as e:
        body = e.response.text[:500] if e.response is not None else "?"
        sample = frames[0] if frames else {}
        logger.warning(
            "ingest_failed camera=%s err=%s body=%s sample=%s",
            camera_id, e, body, sample,
        )
        return False
    except Exception as e:
        logger.warning("ingest_failed camera=%s err=%s", camera_id, e)
        return False


def post_event(camera_id: str, phase: str, payload: dict) -> bool:
    """Envia DetectionEvent start/update/end pro backend.

    phase: "start" | "update" | "end"
    payload: serialização do TrackedObject (ver camera_worker._track_to_event_payload)
    """
    try:
        r = _session.post(
            f"{BACKEND_URL}/detections/event",
            json={"cameraId": camera_id, "phase": phase, **payload},
            timeout=10,
        )
        r.raise_for_status()
        return True
    except requests.HTTPError as e:
        body = e.response.text[:500] if e.response is not None else "?"
        logger.warning(
            "event_post_failed camera=%s phase=%s err=%s body=%s",
            camera_id, phase, e, body,
        )
        return False
    except Exception as e:
        logger.warning("event_post_failed camera=%s phase=%s err=%s", camera_id, phase, e)
        return False


def post_specialist_event(camera_id: str, event: dict) -> bool:
    """Envia SpecialistDetection (weapon/lpr/ppe/etc) ao backend.

    event shape:
        { modelType, confidence, payload, trackId, bbox }
    """
    try:
        r = _session.post(
            f"{BACKEND_URL}/detections/specialist-event",
            json={"cameraId": camera_id, **event},
            timeout=10,
        )
        r.raise_for_status()
        return True
    except requests.HTTPError as e:
        body = e.response.text[:300] if e.response is not None else "?"
        logger.warning(
            "specialist_post_failed camera=%s type=%s status=%s body=%s",
            camera_id, event.get("modelType"), getattr(e.response, "status_code", "?"), body,
        )
        return False
    except Exception as e:
        logger.warning("specialist_post_failed camera=%s err=%s", camera_id, e)
        return False
