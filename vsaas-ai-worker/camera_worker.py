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
    HEARTBEAT_INTERVAL, STATIONARY_INTERVAL,
    ADAPTIVE_FPS_ENABLED, SAMPLE_FPS_IDLE, IDLE_AFTER_SEC,
)
from detector import YoloDetector, filter_by_ratio
from motion_detector import MotionDetector
from tracker import ObjectTracker, TrackedObject, create_tracker
from ingest_client import post_frames, post_event, post_specialist_event
from live_publisher import publish_detections
from specialist_router import SpecialistRouter

logger = logging.getLogger(__name__)


def _utc_z() -> str:
    """Zod .datetime() exige sufixo Z, não offset +00:00."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def _epoch_to_z(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


import base64 as _b64

# Resize máximo no maior eixo. Gemini Vision aceita até 3072×3072; 1024 dá
# qualidade boa pra describe e mantém payload HTTP < 100KB por evento.
_SNAPSHOT_MAX_DIM = 1024
_SNAPSHOT_JPEG_Q  = 78


def _encode_snapshot(frame) -> str | None:
    """Encode frame (numpy BGR) → JPEG base64, redimensionado.

    Retorna string base64 (sem prefixo data:) ou None se falhar.
    Tamanho típico: 30-80KB base64 para frame 1080p reescalado pra 1024px.
    """
    if frame is None:
        return None
    try:
        h, w = frame.shape[:2]
        if max(h, w) > _SNAPSHOT_MAX_DIM:
            scale = _SNAPSHOT_MAX_DIM / max(h, w)
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)),
                               interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), _SNAPSHOT_JPEG_Q])
        if not ok:
            return None
        return _b64.b64encode(buf.tobytes()).decode("ascii")
    except Exception:
        return None


def _track_to_event_payload(t: TrackedObject, frame=None) -> dict:
    """Serializa TrackedObject pra payload do backend EventMaintainer.

    Se `frame` for fornecido, anexa snapshot JPEG base64 — o backend persiste
    no R2 e usa pra alimentar o describe semântico (Gemini Vision). Sem isso,
    96-99% dos eventos ficam sem description porque o frame não está mais
    disponível no go2rtc quando o job processa.
    """
    bx, by, bw, bh = t.best_bbox
    payload = {
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
    snap = _encode_snapshot(frame)
    if snap:
        payload["snapshotJpegB64"] = snap
    return payload


class CameraWorker(threading.Thread):
    def __init__(self, camera: dict, detector: YoloDetector | None = None):
        super().__init__(daemon=True, name=f"cam-{camera['id'][:8]}")
        self.camera   = camera
        # Detector PRÓPRIO desta thread (multithread inference).
        # Se um detector for passado (modo legado/teste), usa o compartilhado.
        # Caso contrário, instancia próprio — cada câmera roda em paralelo.
        if detector is None:
            t0 = time.monotonic()
            self.detector = YoloDetector()
            logger.info(
                "detector_init name=%s elapsed=%.2fs",
                camera.get("name", "?"), time.monotonic() - t0,
            )
        else:
            self.detector = detector

        # Specialist Router — modelos cascading Roboflow Universe (Sprints 1-6).
        # Lê configuração da câmera: aiSpecialistModels é lista JSON.
        specialist_models = camera.get("aiSpecialistModels") or []
        if isinstance(specialist_models, str):
            import json as _json
            try:
                specialist_models = _json.loads(specialist_models)
            except Exception:
                specialist_models = []
        self.specialist_router = SpecialistRouter(
            enabled_models=specialist_models or [],
            ppe_zone=camera.get("ppeZoneJson"),
            lpr_watchlist=camera.get("lprWatchlist") or [],
        )

        self._stop = threading.Event()

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
        # Factory escolhe Norfair (legado) ou ByteTrack (boxmot) via env
        # TRACKER_BACKEND. Ambos retornam mesma interface (.update()).
        tracker = create_tracker(
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

        # Adaptive polling state — começa em ACTIVE pra detectar movimento já
        # nos primeiros segundos. Cai pra IDLE depois de IDLE_AFTER_SEC sem motion.
        # Em IDLE, intervalo de sleep aumenta (reduz fps), mas o motion gate continua
        # rodando — basta motion pra bumpar pra ACTIVE imediatamente.
        adaptive_mode = "ACTIVE"  # "ACTIVE" | "IDLE"
        last_motion_at = time.monotonic()
        idle_transitions = 0
        active_transitions = 0

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
                _motion_boxes: list = []
                if MOTION_ENABLED:
                    if motion is None:
                        motion = MotionDetector(
                            frame_shape=frame.shape[:2],
                            threshold=MOTION_THRESHOLD,
                            contour_area=MOTION_CONTOUR_AREA,
                        )
                    # Change 2 — Lightning/Global Change Detection (Frigate approach):
                    # detect() agora retorna 3 valores: has_motion, boxes, is_lightning.
                    # Se is_lightning=True, mudança global de iluminação (IR switch,
                    # raio, luz acendendo) — não há objeto real. Pular YOLO evita
                    # CPU spike + falsos alertas. avg_frame já foi resetado internamente.
                    has_motion, _motion_boxes, is_lightning = motion.detect(frame)
                    if is_lightning:
                        logger.info(
                            "lightning_skip name=%s — global illumination change, skipping YOLO",
                            cam_name,
                        )
                        run_yolo = False
                    else:
                        run_yolo = has_motion

                    # Adaptive FPS: atualiza estado baseado em motion.
                    # ACTIVE = ByteTrack precisa de frames densos pra associar IDs.
                    # IDLE = só motion gate; bumpa pra ACTIVE no primeiro motion.
                    if ADAPTIVE_FPS_ENABLED:
                        if has_motion:
                            last_motion_at = time.monotonic()
                            if adaptive_mode == "IDLE":
                                adaptive_mode = "ACTIVE"
                                active_transitions += 1
                                logger.info("adaptive_active name=%s — motion detected", cam_name)
                        else:
                            idle_for = time.monotonic() - last_motion_at
                            if adaptive_mode == "ACTIVE" and idle_for > IDLE_AFTER_SEC:
                                adaptive_mode = "IDLE"
                                idle_transitions += 1
                                logger.info("adaptive_idle name=%s — %.0fs sem motion, caindo pra %.1ffps",
                                            cam_name, idle_for, SAMPLE_FPS_IDLE)

                # Change 3 — Stationary Object Mode (Frigate approach):
                # Determina quais tracks estacionários precisam de re-detecção
                # neste frame (rotaciona via _stationary_skip_count mod STATIONARY_INTERVAL).
                # Tracks estacionários que NÃO precisam de re-detecção são excluídos
                # da comparação pós-YOLO, mas o tracker ainda recebe lista vazia
                # pra que o hit_counter progrida normalmente.
                # Nota: reset pra active ocorre em tracker.update() quando YOLO
                # detecta movimento próximo — centroide muda > 5% do bbox.
                stationary_redetect_due = set()
                if run_yolo:
                    for nid, to in tracker.active.items():
                        if to.is_stationary:
                            to._stationary_skip_count += 1
                            if to._stationary_skip_count >= STATIONARY_INTERVAL:
                                # Hora de re-detectar este objeto estacionário
                                to._stationary_skip_count = 0
                                stationary_redetect_due.add(nid)
                            # else: pula YOLO pra este track neste frame
                        else:
                            # Track ativo sempre re-detecta
                            stationary_redetect_due.add(nid)

                    # Se TODOS os tracks ativos são estacionários e nenhum
                    # precisa de re-detecção, ainda há motion_boxes → rodamos
                    # YOLO normalmente (pode haver objeto novo entrando na cena).
                    # Só pulamos se não há motion boxes indicando objeto novo.
                    all_stationary = (
                        len(tracker.active) > 0 and
                        all(t.is_stationary for t in tracker.active.values()) and
                        not stationary_redetect_due and
                        not _motion_boxes
                    )
                    if all_stationary:
                        logger.debug(
                            "stationary_skip name=%s — all tracks stationary, no new motion",
                            cam_name,
                        )
                        run_yolo = False

                dets: list[dict] = []
                if run_yolo:
                    frames_yolo += 1
                    # ---- 2. YOLO ----------------------------------------------------
                    dets = self.detector.detect(frame, confidence=conf)
                    # Change 4 — Aspect Ratio Filters (Frigate approach):
                    # Remove detecções com proporção w/h fisicamente impossível
                    # (ex: pessoa em bbox 20:1, carro em bbox 1:5).
                    # Reduz ruído no tracker e evita alertas falsos.
                    dets = filter_by_ratio(dets)
                    detections_tot += len(dets)

                # ---- 3. TRACKING — rodar SEMPRE (mesmo sem dets, pra disappeared progredir) ----
                new_conf, _upd, ended = tracker.update(dets, frame_time)

                # Change 3 — Stationary reset via motion boxes (Frigate approach):
                # Se há motion boxes sobrepostas a um track estacionário, significa
                # que o objeto voltou a mover (ou novo objeto entrou na região).
                # Reseta is_stationary pra que YOLO volte a rodar em cada frame.
                if _motion_boxes and tracker.active:
                    for to in tracker.active.values():
                        if not to.is_stationary:
                            continue
                        bx, by, bw, bh = to.current_bbox
                        for (mx1, my1, mx2, my2) in _motion_boxes:
                            # Verifica sobreposição bbox↔motion box (IoU simples)
                            ix1 = max(bx, mx1)
                            iy1 = max(by, my1)
                            ix2 = min(bx + bw, mx2)
                            iy2 = min(by + bh, my2)
                            if ix2 > ix1 and iy2 > iy1:
                                to.is_stationary = False
                                to.frames_without_movement = 0
                                to._stationary_skip_count = 0
                                logger.debug(
                                    "stationary_reset track_id=%s — motion box overlap",
                                    to.track_id,
                                )
                                break

                # ---- 4. DetectionFrame batch com trackId/score quando disponível ----
                # Mapeia bbox → track_id usando a lista de tracks ativos retornados
                bbox_to_track: dict[tuple, str] = {}
                if run_yolo and dets:
                    ts = _utc_z()
                    # mapa bbox-aproximado → track_id
                    # Usa current_bbox (posição deste frame) e não best_bbox
                    # (posição histórica) para garantir match correto com objetos
                    # em movimento — evita perda de track no live overlay.
                    for t in (new_conf + _upd):
                        bx, by, bw, bh = t.current_bbox
                        bbox_to_track[(round(bx, 4), round(by, 4))] = t.track_id
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

                # ---- 4b. LIVE PUB — Redis pub/sub para overlay no LivePlayer ----
                # Publica em "icv:live-detections:{cameraId}" com throttle de 5/s.
                # IMPORTANTE: publicamos MESMO sem detecções quando YOLO rodou.
                # Isso permite ao frontend limpar o canvas imediatamente quando
                # o objeto sai do frame (caso contrário ficaria fantasma até
                # maxStaleMs expirar). Quando motion_gate filtra (sem movimento),
                # NÃO publicamos — o último bbox vivo continua visível por ~1.5s.
                if run_yolo:
                    h, w = frame.shape[:2]
                    publish_detections(
                        camera_id=cam_id,
                        frame_width=int(w),
                        frame_height=int(h),
                        detections=dets,  # lista vazia = limpa canvas
                        tracks_by_bbox_key=bbox_to_track,
                    )

                # ---- 4c. SPECIALIST ROUTER (Sprint 1-6) -----------------------
                # Cascading: dispara modelos especialistas conforme contexto.
                # Person → weapon/ppe/fall · Car → lpr · Motorcycle → helmet
                # Throttle interno por (trackId, modelType).
                # Cada câmera tem sua própria configuração (aiSpecialistModels).
                if run_yolo and dets and self.specialist_router.enabled:
                    # Enriquecer dets com trackId pra cooldown funcionar
                    enriched_dets = []
                    for d in dets:
                        d_copy = dict(d)
                        key = (round(d["bboxX"], 4), round(d["bboxY"], 4))
                        d_copy["trackId"] = bbox_to_track.get(key, "anon")
                        enriched_dets.append(d_copy)
                    specialist_events = self.specialist_router.process(frame, enriched_dets)
                    for evt in specialist_events:
                        try:
                            post_specialist_event(cam_id, evt)
                        except Exception as e:
                            logger.warning("specialist_post_failed err=%s", e)

                # ---- 5. EMITIR EVENTOS -----------------------------------------------
                # Anexa snapshot apenas no "start" — backend usa pra describe semântico.
                # No "end" o frame seria de outro instante e só ocupa banda extra.
                for t in new_conf:
                    events_total += 1
                    post_event(cam_id, "start", _track_to_event_payload(t, frame=frame))
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
                        "heartbeat name=%s frames=%d yolo=%d (%.0f%% gated) dets=%d events=%d active_tracks=%d confirmed=%d mode=%s adaptive(idle→%d, active→%d)",
                        cam_name, frames_read, frames_yolo,
                        100 - (100 * frames_yolo / max(frames_read, 1)),
                        detections_tot, events_total, active_tracks, confirmed,
                        adaptive_mode if ADAPTIVE_FPS_ENABLED else "FIXED",
                        idle_transitions, active_transitions,
                    )
                    if mstats:
                        logger.info("motion_stats name=%s %s", cam_name, mstats)
                    last_heartbeat = now

                # Adaptive interval — em IDLE dorme mais entre frames; em ACTIVE
                # usa o interval base (compatível com ByteTrack pra associação IoU).
                effective_interval = interval
                if ADAPTIVE_FPS_ENABLED and adaptive_mode == "IDLE":
                    effective_interval = 1.0 / max(SAMPLE_FPS_IDLE, 0.05)
                time.sleep(max(0.0, effective_interval - (time.monotonic() - t0)))

        finally:
            if batch:
                post_frames(cam_id, batch)
            cap.release()
            logger.info("worker_stop name=%s", cam_name)
