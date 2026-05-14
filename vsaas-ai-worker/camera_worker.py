import logging
import threading
import time
from datetime import datetime, timezone

import cv2

from config import BATCH_INTERVAL, GO2RTC_RTSP_BASE, SAMPLE_FPS
from detector import YoloDetector
from ingest_client import post_frames

logger = logging.getLogger(__name__)


class CameraWorker(threading.Thread):
    def __init__(self, camera: dict, detector: YoloDetector):
        super().__init__(daemon=True, name=f"cam-{camera['id'][:8]}")
        self.camera   = camera
        self.detector = detector
        self._stop    = threading.Event()

    def stop(self):
        self._stop.set()

    def _rtsp_url(self) -> str:
        sid = self.camera.get("go2rtcStreamId")
        if sid:
            return f"{GO2RTC_RTSP_BASE}/{sid}"
        return self.camera.get("rtspSubUrl") or self.camera["rtspMainUrl"]

    def run(self):
        cam_id   = self.camera["id"]
        cam_name = self.camera["name"]
        conf     = float(self.camera.get("aiConfidenceMin", 0.50))
        url      = self._rtsp_url()
        interval = 1.0 / max(SAMPLE_FPS, 0.1)

        logger.info("worker_start name=%s url=%s conf=%.2f", cam_name, url, conf)

        cap = cv2.VideoCapture(url)
        if not cap.isOpened():
            logger.error("rtsp_open_failed name=%s url=%s", cam_name, url)
            return

        batch: list[dict] = []
        last_flush = time.monotonic()

        try:
            while not self._stop.is_set():
                t0 = time.monotonic()
                ret, frame = cap.read()

                if not ret:
                    logger.warning("rtsp_read_failed name=%s — reconectando em 5s", cam_name)
                    cap.release()
                    time.sleep(5)
                    cap = cv2.VideoCapture(url)
                    continue

                ts   = datetime.now(timezone.utc).isoformat()
                dets = self.detector.detect(frame, confidence=conf)
                for d in dets:
                    batch.append({"timestamp": ts, **d})

                now = time.monotonic()
                if now - last_flush >= BATCH_INTERVAL and batch:
                    post_frames(cam_id, batch)
                    logger.debug("flushed n=%d camera=%s", len(batch), cam_name)
                    batch = []
                    last_flush = now

                time.sleep(max(0.0, interval - (time.monotonic() - t0)))

        finally:
            if batch:
                post_frames(cam_id, batch)
            cap.release()
            logger.info("worker_stop name=%s", cam_name)
