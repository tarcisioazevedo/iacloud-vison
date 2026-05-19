"""
Camera worker — pipeline completo de captura → motion gate → YOLO → tracking → ingest.

Fluxo por frame (1fps default):
  1. cv2.VideoCapture.read()
  2. MotionDetector.detect() — gate barato. Sem motion → pula tudo.
  3. YoloDetector.detect() — só roda se houve motion.
  4. ObjectTracker.update() — agrupa frames consecutivos em tracks.
  5. Eventos emitidos:
     • DetectionFrame (compat com schema atual — flat list por frame)
     • Event start/update/end (novo — agrupado por track)

Otimizações:
  • Motion gate reduz ~70% das inferências YOLO em câmera estática
  • Tracking transforma 314 frames em ~5 events confirmados
  • Score median (não single-frame) elimina falsos positivos
  • Bottom-center tracking (estável pra objetos no chão)
"""

import logging
import os
import threading
import time
from datetime import datetime, timezone

import cv2

# go2rtc rejects UDP RTSP (461 Unsupported transport) — force TCP globally
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

from config import (
    BATCH_INTERVAL, GO2RTC_RTSP_BASE, SAMPLE_FPS,
    MOTION_ENABLED, MOTION_THRESHOLD, MOTION_CONTOUR_AREA,
    MIN_INITIALIZED, MAX_DISAPPEARED, CONFIRM_THRESHOLD,
    HEARTBEAT_INTERVAL,
)
from detector import YoloDetector
from motion_detector import MotionDetector
from tracker import ObjectTracker, TrackedObject
from ingest_client import post_frames, post_event

logger = logging.getLogger(__name__)


def _utc_z() -> str:
    """Zod .datetime() exige sufixo Z, não offset +00:00."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def _epoch_to_z(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def _track_to_event_payload(t: TrackedObject) -> dict:
    """Serializa TrackedObject pra payload do backend EventMaintainer."""
    bx, by, bw, bh = t.best_bbox
    return {
        "trackId":       t.track_id,
        "objectType":    t.object_type,
        "startedAt":     _epoch_to_z(t.started_at),
        "lastSeenAt":    _epoch_to_z(t.last_seen_at),
        "endedAt":       _epoch_to_z(t.ended_at) if t.ended_at else None,
        "frames":        t.frames,
        "topScore":      round(t.best_score, 4),
        "medianScore":   round(t.score_median(), 4),
        "bestBbox": {
            "x": round(bx, 4), "y": round(by, 4),
            "w": round(bw, 4), "h": round(bh, 4),
        },
        "pathData": [
            {"t": _epoch_to_z(ft), "b": [round(b[0], 4), round(b[1], 4), round(b[2], 4), round(b[3], 4)]}
            for ft, b in t.path
        ],
    }


class CameraWorker(threading.Thread):
    def __init__(self, camera: dict, detector: YoloDetector):
        super().__init__(daemon=True, name=f"cam-{camera['id'][:8]}")
        self.camera   = camera
        self.detector = detector
        self._stop    = threading.Event()

    def stop(self):
        self._stop.set()

    def _candidate_urls(self) -> list[str]:
        """Priority order: go2rtc relay → rtspSubUrl → rtspMainUrl."""
        urls = []
        sid = self.camera.get("streamId")
        if sid:
            urls.append(f"{GO2RTC_RTSP_BASE}/{sid}")
        sub  = self.camera.get("rtspSubUrl")
        main = self.camera.get("rtspMainUrl")
        if sub:
            urls.append(sub)
        if main and main != sub:
            urls.append(main)
        return urls

    def _open_cap(self, urls: list[str]):
        for url in urls:
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
            if cap.isOpened():
                return cap, url
            cap.release()
        return None, None

    def run(self):
        cam_id   = self.camera["id"]
        cam_name = self.camera["name"]
        conf     = float(self.camera.get("aiConfidenceMin", 0.50))
        candidates = self._candidate_urls()
        interval = 1.0 / max(SAMPLE_FPS, 0.1)

        # Retry de conexão inicial com backoff exponencial.
        cap, url = None, None
        attempt = 0
        while not self._stop.is_set() and cap is None:
            cap, url = self._open_cap(candidates)
            if cap is None:
                attempt += 1
                wait = min(30, 5 * attempt)
                logger.warning(
                    "rtsp_open_retry name=%s attempt=%d wait=%ds tried=%s",
                    cam_name, attempt, wait, candidates,
                )
                time.sleep(wait)

        if cap is None:
            return

        logger.info(
            "worker_start name=%s url=%s conf=%.2f motion_gate=%s fps=%.1f",
            cam_name, url, conf, MOTION_ENABLED, SAMPLE_FPS,
        )

        # Lazy init — precisa do frame_shape real
        motion: MotionDetector | None = None
        tracker = ObjectTracker(
            camera_id=cam_id,
            min_initialized=MIN_INITIALIZED,
            max_disappeared=MAX_DISAPPEARED,
            confirm_threshold=CONFIRM_THRESHOLD,
            sample_fps=SAMPLE_FPS,
        )

        batch: list[dict] = []
        last_flush     = time.monotonic()
        last_heartbeat = time.monotonic()
        frames_read    = 0
        frames_yolo    = 0
        detections_tot = 0
        events_total   = 0

        try:
            while not self._stop.is_set():
                t0 = time.monotonic()
                ret, frame = cap.read()

                if not ret:
                    logger.warning("rtsp_read_failed name=%s — reconectando", cam_name)
                    # cap.release() em None crashava a thread inteira; guarda.
                    if cap is not None:
                        try: cap.release()
                        except Exception: pass
                    cap = None
                    # Retry FOREVER com backoff — não derrubar a thread.
                    # Source RTSP (go2rtc) pode ficar momentaneamente sem producer
                    # ativo (RTMP push da câmera intermitente); voltar quando voltar.
                    rc_attempt = 0
                    while not self._stop.is_set() and cap is None:
                        rc_attempt += 1
                        wait = min(30, 3 * rc_attempt)
                        time.sleep(wait)
                        cap, url = self._open_cap(candidates)
                        if cap is None:
                            logger.warning(
                                "rtsp_reconnect_retry name=%s attempt=%d wait=%ds",
                                cam_name, rc_attempt, wait,
                            )
                    if cap is None:
                        # Saiu do while por stop event — encerra graciosamente.
                        break
                    logger.info("rtsp_reconnected name=%s url=%s", cam_name, url)
                    continue

                frames_read += 1
                frame_time  = time.time()

                # ---- 1. MOTION GATE -------------------------------------------------
                run_yolo = True
                if MOTION_ENABLED:
                    if motion is None:
                        motion = MotionDetector(
                            frame_shape=frame.shape[:2],
                            threshold=MOTION_THRESHOLD,
                            contour_area=MOTION_CONTOUR_AREA,
                        )
                    has_motion, _motion_boxes = motion.detect(frame)
                    run_yolo = has_motion

                dets: list[dict] = []
                if run_yolo:
                    frames_yolo += 1
                    # ---- 2. YOLO ----------------------------------------------------
                    dets = self.detector.detect(frame, confidence=conf)
                    detections_tot += len(dets)

                # ---- 3. TRACKING — rodar SEMPRE (mesmo sem dets, pra disappeared progredir) ----
                new_conf, _upd, ended = tracker.update(dets, frame_time)

                # ---- 4. DetectionFrame batch com trackId/score quando disponível ----
                # Mapeia bbox → track_id usando a lista de tracks ativos retornados
                if run_yolo and dets:
                    ts = _utc_z()
                    # mapa bbox-aproximado → track_id
                    bbox_to_track = {}
                    for t in (new_conf + _upd):
                        bx, by, bw, bh = t.best_bbox
                        bbox_to_track[(round(bx, 3), round(by, 3))] = t.track_id
                    for d in dets:
                        key = (round(d["bboxX"], 3), round(d["bboxY"], 3))
                        # Procura match aproximado (±0.01)
                        track_id = bbox_to_track.get(key)
                        if track_id is None:
                            for (kx, ky), tid in bbox_to_track.items():
                                if abs(kx - d["bboxX"]) < 0.05 and abs(ky - d["bboxY"]) < 0.05:
                                    track_id = tid
                                    break
                        frame_row = {"timestamp": ts, **d}
                        if track_id:
                            frame_row["trackId"] = track_id
                        batch.append(frame_row)

                # ---- 5. EMITIR EVENTOS -----------------------------------------------
                for t in new_conf:
                    events_total += 1
                    post_event(cam_id, "start", _track_to_event_payload(t))
                for t in ended:
                    post_event(cam_id, "end", _track_to_event_payload(t))

                # ---- 6. FLUSH DetectionFrames -------------------------------------------
                now = time.monotonic()
                if now - last_flush >= BATCH_INTERVAL and batch:
                    post_frames(cam_id, batch)
                    logger.info("flushed n=%d camera=%s", len(batch), cam_name)
                    batch = []
                    last_flush = now

                # ---- 7. HEARTBEAT ----------------------------------------------------
                if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                    mstats = motion.stats() if motion else {}
                    active_tracks = len(tracker.active)
                    confirmed = sum(1 for t in tracker.active.values() if t.confirmed)
                    logger.info(
                        "heartbeat name=%s frames=%d yolo=%d (%.0f%% gated) dets=%d events=%d active_tracks=%d confirmed=%d",
                        cam_name, frames_read, frames_yolo,
                        100 - (100 * frames_yolo / max(frames_read, 1)),
                        detections_tot, events_total, active_tracks, confirmed,
                    )
                    if mstats:
                        logger.info("motion_stats name=%s %s", cam_name, mstats)
                    last_heartbeat = now

                time.sleep(max(0.0, interval - (time.monotonic() - t0)))

        finally:
            if batch:
                post_frames(cam_id, batch)
            cap.release()
            logger.info("worker_stop name=%s", cam_name)
