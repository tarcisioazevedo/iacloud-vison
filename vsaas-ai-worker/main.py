import logging
import time

import requests

from camera_worker import CameraWorker
from config import AI_WORKER_SECRET, BACKEND_URL, REFRESH_SEC
from detector import YoloDetector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
)
logger = logging.getLogger("main")

_session = requests.Session()
_session.headers.update({"Authorization": f"Bearer {AI_WORKER_SECRET}"})


def fetch_cameras() -> list[dict]:
    try:
        r = _session.get(f"{BACKEND_URL}/detections/ai-cameras", timeout=10)
        r.raise_for_status()
        return r.json().get("cameras", [])
    except Exception as e:
        logger.error("fetch_cameras_failed err=%s", e)
        return []


def main():
    logger.info("vsaas-ai-worker starting backend=%s", BACKEND_URL)
    detector = YoloDetector()
    logger.info("yolo_ready classes=%d", len(detector.names))

    workers: dict[str, CameraWorker] = {}

    while True:
        cameras  = fetch_cameras()
        live_ids = {c["id"] for c in cameras}

        for cid in list(workers):
            if cid not in live_ids:
                logger.info("removing_worker camera=%s", cid)
                workers.pop(cid).stop()

        for cam in cameras:
            if cam["id"] not in workers:
                w = CameraWorker(cam, detector)
                workers[cam["id"]] = w
                w.start()
                logger.info("added_worker camera=%s", cam["name"])

        logger.info("pool_status active=%d", len(workers))
        time.sleep(REFRESH_SEC)


if __name__ == "__main__":
    main()
