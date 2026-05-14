"""
Object tracker — port do Norfair tracker do Frigate (frigate/track/norfair_tracker.py).

Diferenças vs Frigate:
  - Uma instância de Tracker por câmera (não global)
  - Sem PTZ autotracking (cloud direct cam ainda não tem ONVIF)
  - Sem stationary_classifier (visual diff em YUV) — usa só IOU history
  - Score history (mediana) confirma track como real, não single-frame

Algoritmo:
  • Norfair (kalman + custom distance) agrupa detecções consecutivas
  • Distance function: bottom-center + size ratio (norfair_tracker.py:41)
  • Score median > confirm_threshold = "confirmed track"
  • track encerra após max_disappeared frames sem detecção
  • track emite event_start ao ser confirmado, event_update a cada frame,
    event_end quando encerra
"""

import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from norfair import Detection, Tracker
from norfair.filter import OptimizedKalmanFilterFactory

logger = logging.getLogger(__name__)


def _frigate_distance(detection: Detection, tracked) -> float:
    """
    Custom distance function — port direto de norfair_tracker.py:41-71.
    Combina deslocamento (bottom-center) + ratio de largura/altura,
    normalizado pelo tamanho da estimativa.
    """
    est = tracked.estimate
    det = detection.points

    est_dim = np.diff(est, axis=0).flatten()  # [w, h]
    det_dim = np.diff(det, axis=0).flatten()

    # Bottom-center: x médio, y máximo
    det_pos = np.array([np.average(det[:, 0]), np.max(det[:, 1])])
    est_pos = np.array([np.average(est[:, 0]), np.max(est[:, 1])])

    # Deltas normalizados pelo tamanho do tracked
    dxdy = (det_pos - est_pos).astype(float)
    if est_dim[0] > 0:
        dxdy[0] /= est_dim[0]
    if est_dim[1] > 0:
        dxdy[1] /= est_dim[1]

    # Ratio de tamanho (1.0 = igual)
    widths = np.sort([est_dim[0], det_dim[0]])
    heights = np.sort([est_dim[1], det_dim[1]])
    width_ratio = (widths[1] / widths[0] - 1.0) if widths[0] > 0 else 0.0
    height_ratio = (heights[1] / heights[0] - 1.0) if heights[0] > 0 else 0.0

    change = np.append(dxdy, [width_ratio, height_ratio])
    return float(np.linalg.norm(change))


# Frigate defaults por tipo (norfair_tracker.py:124-151)
_OBJECT_KALMAN = {
    "car":           {"R": 3.4, "Q": 0.03, "dist": 2.5},
    "truck":         {"R": 3.4, "Q": 0.03, "dist": 2.5},
    "motorcycle":    {"R": 3.4, "Q": 0.03, "dist": 2.5},
    "bus":           {"R": 3.4, "Q": 0.03, "dist": 2.5},
    "license_plate": {"R": 2.5, "Q": 0.05, "dist": 3.75},
    "person":        {"R": 3.4, "Q": 0.05, "dist": 2.5},
}
_DEFAULT_KALMAN = {"R": 3.4, "Q": 0.05, "dist": 2.5}


@dataclass
class TrackedObject:
    """Estado interno por track ativo — alimenta o EventMaintainer backend."""

    track_id: str                        # uuid persistido pro DB
    norfair_id: str                      # id local do Norfair
    object_type: str
    started_at: float                    # epoch
    last_seen_at: float
    frames: int = 0                      # quantos frames já bateram
    score_history: deque = field(default_factory=lambda: deque(maxlen=50))
    best_score: float = 0.0
    best_bbox: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    best_frame_idx: int = 0              # número do frame com best_score
    path: list = field(default_factory=list)  # [(epoch, bbox_norm)]
    confirmed: bool = False              # virou event "real"?
    ended_at: Optional[float] = None
    reid_embedding: Optional[list] = None  # 768-dim, preenchido por CameraWorker

    def score_median(self) -> float:
        if not self.score_history:
            return 0.0
        return float(np.median(self.score_history))


class ObjectTracker:
    def __init__(
        self,
        camera_id: str,
        min_initialized: int = 2,        # frames consecutivos pra criar track
        max_disappeared: int = 25,       # frames sem detecção = encerra
        confirm_threshold: float = 0.7,  # score median pra confirmar como real
        sample_fps: float = 5.0,         # Frigate baseline; escala distance_threshold
        max_path_points: int = 200,      # cap pra path_data não explodir
    ) -> None:
        self.camera_id = camera_id
        self.confirm_threshold = confirm_threshold
        self.max_path_points = max_path_points
        self.max_disappeared = max_disappeared

        # _OBJECT_KALMAN["dist"] foi calibrado por Frigate a 5 FPS. Em FPS menor
        # o objeto anda MAIS entre frames → distância precisa crescer linearmente
        # pra Norfair conseguir associar a detecção ao mesmo track.
        self._dist_scale = 5.0 / max(sample_fps, 0.1)

        # Um Norfair Tracker por tipo de objeto (Frigate faz isso pra usar Kalman tuneado)
        self.trackers: dict[str, Tracker] = {}
        self._init_default_tracker_args = {
            "distance_function": _frigate_distance,
            "initialization_delay": min_initialized,
            "hit_counter_max": max_disappeared,
        }

        # Estado por track ativo
        self.active: dict[str, TrackedObject] = {}   # norfair_id → TrackedObject

    def _get_tracker(self, obj_type: str) -> Tracker:
        if obj_type not in self.trackers:
            cfg = _OBJECT_KALMAN.get(obj_type, _DEFAULT_KALMAN)
            self.trackers[obj_type] = Tracker(
                distance_function=_frigate_distance,
                distance_threshold=cfg["dist"] * self._dist_scale,
                initialization_delay=self._init_default_tracker_args["initialization_delay"],
                hit_counter_max=self._init_default_tracker_args["hit_counter_max"],
                filter_factory=OptimizedKalmanFilterFactory(R=cfg["R"], Q=cfg["Q"]),
            )
        return self.trackers[obj_type]

    def update(
        self,
        detections: list[dict],
        frame_time: float,
    ) -> tuple[list[TrackedObject], list[TrackedObject], list[TrackedObject]]:
        """
        Recebe detecções do YOLO no formato:
          { objectType, confidence, bboxX, bboxY, bboxW, bboxH }  (normalizado 0-1)

        Retorna 3 listas:
          • new_confirmed: tracks que ACABARAM de virar confirmados (event_start)
          • updates: tracks que continuam ativos (event_update)
          • ended: tracks que encerraram (event_end)
        """
        # Agrupa por tipo (cada tipo tem seu Norfair Tracker)
        by_type: dict[str, list[Detection]] = {}
        for d in detections:
            ot = d["objectType"]
            # bbox normalizado → 2 pontos (top-left, bottom-right) em pixels "virtuais"
            # Norfair só precisa de pontos consistentes — usamos coordenadas
            # multiplicadas por 1000 pra ter precisão inteira sem perder semântica.
            x1 = d["bboxX"] * 1000
            y1 = d["bboxY"] * 1000
            x2 = (d["bboxX"] + d["bboxW"]) * 1000
            y2 = (d["bboxY"] + d["bboxH"]) * 1000
            points = np.array([[x1, y1], [x2, y2]])

            det = Detection(
                points=points,
                data={
                    "label": ot,
                    "score": d["confidence"],
                    "bbox": (d["bboxX"], d["bboxY"], d["bboxW"], d["bboxH"]),
                    "frame_time": frame_time,
                },
            )
            by_type.setdefault(ot, []).append(det)

        # Atualiza cada Tracker com suas detecções (e os outros com lista vazia,
        # pra que o counter de disappeared progrida)
        all_active_norfair_ids = set()
        new_confirmed: list[TrackedObject] = []
        updates: list[TrackedObject] = []

        all_types = set(by_type.keys()) | set(self.trackers.keys())
        for obj_type in all_types:
            tracker = self._get_tracker(obj_type)
            tracked_list = tracker.update(detections=by_type.get(obj_type, []))

            for t in tracked_list:
                nid = str(t.global_id)
                all_active_norfair_ids.add(nid)
                last_det = t.last_detection
                if last_det is None or last_det.data is None:
                    continue
                score = float(last_det.data["score"])
                bbox = tuple(last_det.data["bbox"])
                lt = float(last_det.data["frame_time"])

                if nid not in self.active:
                    # Track novo (Norfair já passou pelo initialization_delay)
                    to = TrackedObject(
                        track_id=str(uuid.uuid4()),
                        norfair_id=nid,
                        object_type=obj_type,
                        started_at=lt,
                        last_seen_at=lt,
                        frames=1,
                        best_score=score,
                        best_bbox=bbox,
                        best_frame_idx=0,
                    )
                    to.score_history.append(score)
                    to.path.append((lt, bbox))
                    self.active[nid] = to
                else:
                    to = self.active[nid]
                    to.frames += 1
                    to.last_seen_at = lt
                    to.score_history.append(score)
                    if score > to.best_score:
                        to.best_score = score
                        to.best_bbox = bbox
                        to.best_frame_idx = to.frames - 1
                    if len(to.path) < self.max_path_points:
                        to.path.append((lt, bbox))

                # Confirmação: score median > threshold E ainda não confirmado
                if not to.confirmed and to.score_median() >= self.confirm_threshold:
                    to.confirmed = True
                    new_confirmed.append(to)
                elif to.confirmed:
                    updates.append(to)

        # Encerra tracks que sumiram da lista do Norfair
        ended: list[TrackedObject] = []
        for nid in list(self.active.keys()):
            if nid not in all_active_norfair_ids:
                to = self.active.pop(nid)
                to.ended_at = frame_time
                # Só emite end se tinha sido confirmado (senão era ruído)
                if to.confirmed:
                    ended.append(to)

        return new_confirmed, updates, ended
