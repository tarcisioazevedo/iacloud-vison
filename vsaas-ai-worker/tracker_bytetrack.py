"""
Object tracker — ByteTrack INLINE (sem dep externa pesada).

Por que inline em vez de boxmot/bytetracker do PyPI:
  Esses pacotes puxam torch + nvidia-cu11 (~2 GB de dependências CUDA),
  inviável no nosso container CPU-only (python:3.11-slim base, ~600MB).
  Implementação inline usa só numpy + scipy.optimize.linear_sum_assignment
  (Hungarian), que já são deps do worker. Equivalente algorítmico ao
  ByteTrack original (Zhang et al. 2021, arxiv:2110.06864, MIT license).

Características do ByteTrack vs SORT/Norfair simples:
  - 2-pass BYTE association: detecções HIGH-conf (>track_thresh) batem com
    tracks ATIVOS primeiro; detecções LOW-conf (0.1 < c < track_thresh)
    batem com tracks NÃO matched no passo 1. Essa segunda passagem
    "ressuscita" tracks parcialmente ocluídos / borrados que normalmente
    seriam perdidos.
  - Hungarian matching matemático (linear_sum_assignment) em vez de greedy
    NN: garante atribuição globalmente ótima, reduz ID switches em
    cruzamentos.
  - Kalman filter constant-velocity simples (xc, yc, w, h, vxc, vyc, vw, vh).

Mantém TODAS as melhorias de cima (Median Score Confirmation, Stationary
Object Mode) — são lógica nossa, independente do tracker.

Implementação intencionalmente compacta (~250 LOC) pra ser auditável e
modificável sem dependência externa.
"""
import logging
import uuid

import numpy as np
from scipy.optimize import linear_sum_assignment

logger = logging.getLogger(__name__)

# Reaproveita TrackedObject + STATIONARY_THRESHOLD do tracker.py (mesma interface
# pública pro camera_worker.py — não importa qual backend).
from tracker import TrackedObject, STATIONARY_THRESHOLD


# ─────────────────────────────────────────────────────────────────────────────
# Kalman filter compacto: state = [xc, yc, w, h, vxc, vyc, vw, vh] (8-dim)
# Constant velocity model, suficiente pra pedestrian/vehicle tracking em
# câmeras estáticas. Sem aprendizado de matriz Q/R por classe (simplicidade).
# ─────────────────────────────────────────────────────────────────────────────
class _Kalman:
    """Kalman filter manual (sem filterpy) — 8 estados, 4 medidas (cx, cy, w, h)."""
    __slots__ = ('x', 'P', 'F', 'H', 'Q', 'R', '_I')

    def __init__(self, bbox: np.ndarray):
        # x = [cx, cy, w, h, vcx, vcy, vw, vh]
        self.x = np.zeros(8, dtype=np.float32)
        self.x[:4] = bbox
        # Matriz de transição: constant velocity
        self.F = np.eye(8, dtype=np.float32)
        for i in range(4):
            self.F[i, i + 4] = 1.0
        # Observação: pegamos só cx, cy, w, h (não velocidades)
        self.H = np.zeros((4, 8), dtype=np.float32)
        for i in range(4):
            self.H[i, i] = 1.0
        # Covariância inicial — alta incerteza nas velocidades
        self.P = np.eye(8, dtype=np.float32) * 10
        self.P[4:, 4:] *= 100
        # Process noise (Q): pequeno em posição, maior em velocidade
        self.Q = np.eye(8, dtype=np.float32) * 0.01
        self.Q[4:, 4:] *= 0.5
        # Measurement noise (R): YOLO bbox tem ~5px de jitter
        self.R = np.eye(4, dtype=np.float32) * 1.0
        self._I = np.eye(8, dtype=np.float32)

    def predict(self) -> np.ndarray:
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q
        return self.x[:4].copy()

    def update(self, z: np.ndarray) -> None:
        y = z - self.H @ self.x                 # inovação
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)
        self.x = self.x + K @ y
        self.P = (self._I - K @ self.H) @ self.P


# ─────────────────────────────────────────────────────────────────────────────
# STrack: track individual com Kalman + estado de ciclo de vida
# ─────────────────────────────────────────────────────────────────────────────
class _STrack:
    __slots__ = ('track_id', 'kf', 'bbox', 'score', 'cls', 'state',
                 'lost_frames', 'hits', 'last_det_ind')
    _id_counter = 0

    STATE_NEW      = 'new'        # criado neste frame, ainda não confirmado
    STATE_TRACKED  = 'tracked'    # ativo
    STATE_LOST     = 'lost'       # não matched nesse frame, em buffer
    STATE_REMOVED  = 'removed'    # buffer expirou

    def __init__(self, bbox: np.ndarray, score: float, cls: int, det_ind: int):
        _STrack._id_counter += 1
        self.track_id = _STrack._id_counter
        self.kf = _Kalman(bbox)
        self.bbox = bbox.copy()
        self.score = score
        self.cls = cls
        self.state = _STrack.STATE_NEW
        self.lost_frames = 0
        self.hits = 1
        self.last_det_ind = det_ind  # índice da detecção que originou no frame atual

    def predict(self) -> np.ndarray:
        return self.kf.predict()

    def update(self, bbox: np.ndarray, score: float, det_ind: int) -> None:
        self.kf.update(bbox)
        self.bbox = self.kf.x[:4].copy()
        self.score = score
        self.hits += 1
        self.lost_frames = 0
        self.state = _STrack.STATE_TRACKED
        self.last_det_ind = det_ind

    def mark_lost(self) -> None:
        self.state = _STrack.STATE_LOST
        self.lost_frames += 1
        self.last_det_ind = -1


# ─────────────────────────────────────────────────────────────────────────────
# IoU vetorizado entre N tracks predict bboxes (cxcywh) e M detecções (cxcywh)
# Retorna matriz NxM de cost (= 1 - IoU). Hungarian minimiza cost.
# ─────────────────────────────────────────────────────────────────────────────
def _iou_cost_matrix(tracks_bboxes: np.ndarray, dets_bboxes: np.ndarray) -> np.ndarray:
    if len(tracks_bboxes) == 0 or len(dets_bboxes) == 0:
        return np.zeros((len(tracks_bboxes), len(dets_bboxes)), dtype=np.float32)

    # Converte cxcywh → xyxy pra cálculo
    def to_xyxy(b):
        x1 = b[:, 0] - b[:, 2] / 2
        y1 = b[:, 1] - b[:, 3] / 2
        x2 = b[:, 0] + b[:, 2] / 2
        y2 = b[:, 1] + b[:, 3] / 2
        return x1, y1, x2, y2

    tx1, ty1, tx2, ty2 = to_xyxy(tracks_bboxes)
    dx1, dy1, dx2, dy2 = to_xyxy(dets_bboxes)

    # Pairwise intersection
    xi1 = np.maximum(tx1[:, None], dx1[None, :])
    yi1 = np.maximum(ty1[:, None], dy1[None, :])
    xi2 = np.minimum(tx2[:, None], dx2[None, :])
    yi2 = np.minimum(ty2[:, None], dy2[None, :])
    iw = np.clip(xi2 - xi1, 0, None)
    ih = np.clip(yi2 - yi1, 0, None)
    inter = iw * ih

    t_area = (tx2 - tx1) * (ty2 - ty1)
    d_area = (dx2 - dx1) * (dy2 - dy1)
    union = t_area[:, None] + d_area[None, :] - inter
    iou = np.where(union > 0, inter / union, 0.0)
    return 1.0 - iou  # cost = 1 - IoU


# ─────────────────────────────────────────────────────────────────────────────
# Hungarian matching com threshold de IoU (cost <= 1 - iou_thresh)
# Retorna 3 listas de índices: matches [(track_i, det_j)], unmatched_tracks, unmatched_dets
# ─────────────────────────────────────────────────────────────────────────────
def _linear_assignment(cost: np.ndarray, max_cost: float):
    if cost.size == 0:
        return [], list(range(cost.shape[0])), list(range(cost.shape[1]))
    row_ind, col_ind = linear_sum_assignment(cost)
    matches = []
    used_t, used_d = set(), set()
    for r, c in zip(row_ind, col_ind):
        if cost[r, c] <= max_cost:
            matches.append((int(r), int(c)))
            used_t.add(int(r)); used_d.add(int(c))
    unmatched_tracks = [i for i in range(cost.shape[0]) if i not in used_t]
    unmatched_dets   = [j for j in range(cost.shape[1]) if j not in used_d]
    return matches, unmatched_tracks, unmatched_dets


# ─────────────────────────────────────────────────────────────────────────────
# ByteTracker core: 2-pass BYTE association
# ─────────────────────────────────────────────────────────────────────────────
class _ByteTrackerCore:
    def __init__(self, track_thresh: float = 0.45, match_thresh: float = 0.80,
                 track_buffer: int = 30, min_hits: int = 1):
        self.track_thresh = track_thresh      # divisor high/low conf
        self.match_thresh = match_thresh      # IoU mínimo pra match (cost ≤ 1-match_thresh)
        self.track_buffer = track_buffer      # frames lost antes de remover
        self.min_hits = min_hits              # hits pra promover NEW → TRACKED (publicado)
        self.tracked: list[_STrack] = []      # ativos
        self.lost: list[_STrack] = []         # em buffer, esperando rematch

    def update(self, dets_xywh: np.ndarray, scores: np.ndarray, classes: np.ndarray):
        """
        Args:
            dets_xywh: (M, 4) array cxcywh
            scores:    (M,) array confidences
            classes:   (M,) array class ids (não usado pra matching, repassado pro track)
        Returns:
            list de tuplas (track, det_ind_or_-1) — det_ind é índice em dets_xywh
            ou -1 se o track foi atualizado por extrapolação Kalman (lost rematched).
        """
        if len(dets_xywh) > 0:
            high_mask = scores >= self.track_thresh
            low_mask = (scores >= 0.10) & ~high_mask
        else:
            high_mask = np.zeros(0, dtype=bool)
            low_mask = np.zeros(0, dtype=bool)

        high_dets = dets_xywh[high_mask]
        high_scores = scores[high_mask]
        high_classes = classes[high_mask]
        high_orig_ind = np.where(high_mask)[0]

        low_dets = dets_xywh[low_mask]
        low_scores = scores[low_mask]
        low_classes = classes[low_mask]
        low_orig_ind = np.where(low_mask)[0]

        # Predict de todos os tracks ativos + lost
        all_pool = self.tracked + self.lost
        for t in all_pool:
            t.predict()

        # ── Passo 1: tracks ATIVOS × detecções HIGH-conf ──────────────────────
        tracked_bboxes = np.array([t.bbox for t in self.tracked], dtype=np.float32) \
            if self.tracked else np.zeros((0, 4), dtype=np.float32)
        cost_1 = _iou_cost_matrix(tracked_bboxes, high_dets)
        m1, ut1, ud1 = _linear_assignment(cost_1, 1.0 - self.match_thresh)

        results: list[tuple[_STrack, int]] = []
        for ti, di in m1:
            t = self.tracked[ti]
            t.update(high_dets[di], float(high_scores[di]), int(high_orig_ind[di]))
            results.append((t, int(high_orig_ind[di])))

        # ── Passo 2: tracks (ATIVOS não matched + LOST) × detecções LOW-conf ──
        # Esta é a chave do ByteTrack: tracks que não foram associados no
        # passo 1 (provavelmente porque a detecção alta dele falhou nesse frame)
        # têm uma 2ª chance contra detecções fracas. Isso recupera pessoa
        # borrada/parcialmente ocluída sem aumentar falsos positivos.
        unmatched_active = [self.tracked[i] for i in ut1]
        rematch_pool = unmatched_active + self.lost
        pool_bboxes = np.array([t.bbox for t in rematch_pool], dtype=np.float32) \
            if rematch_pool else np.zeros((0, 4), dtype=np.float32)
        # Para low-conf usamos threshold IoU MAIS relaxado (0.5) — a detecção
        # já é fraca, exigir IoU 0.8 mata o propósito do BYTE.
        cost_2 = _iou_cost_matrix(pool_bboxes, low_dets)
        m2, ut2, _ud2 = _linear_assignment(cost_2, 0.5)

        for ti, di in m2:
            t = rematch_pool[ti]
            t.update(low_dets[di], float(low_scores[di]), int(low_orig_ind[di]))
            results.append((t, int(low_orig_ind[di])))

        # ── Tracks não matched em ambos os passos → marca como LOST ───────────
        still_unmatched_active = [rematch_pool[i] for i in ut2 if i < len(unmatched_active)]
        still_unmatched_lost   = [rematch_pool[i] for i in ut2 if i >= len(unmatched_active)]
        for t in still_unmatched_active:
            t.mark_lost()
        for t in still_unmatched_lost:
            t.lost_frames += 1

        # ── Detecções HIGH não matched → criam tracks NOVOS ───────────────────
        for di in ud1:
            new_t = _STrack(
                bbox=high_dets[di],
                score=float(high_scores[di]),
                cls=int(high_classes[di]),
                det_ind=int(high_orig_ind[di]),
            )
            results.append((new_t, int(high_orig_ind[di])))

        # ── Atualiza pools ────────────────────────────────────────────────────
        # tracked = tracks que estavam ativos OU foram rematched OU novos
        new_tracked: list[_STrack] = []
        new_lost: list[_STrack] = []
        for t, _di in results:
            new_tracked.append(t)
        # Mantém tracks que continuam lost mas dentro do buffer
        for t in still_unmatched_active:
            new_lost.append(t)
        for t in self.lost:
            if t not in [r[0] for r in results]:
                if t.lost_frames < self.track_buffer:
                    new_lost.append(t)
                # else: removido (não vai pra lugar nenhum, GC)

        self.tracked = new_tracked
        self.lost = new_lost

        return results


# ─────────────────────────────────────────────────────────────────────────────
# ObjectTrackerByteTrack: wrapper público mantendo API de tracker.ObjectTracker
# ─────────────────────────────────────────────────────────────────────────────
class ObjectTrackerByteTrack:
    """ByteTrack-based tracker com a MESMA API de ObjectTracker (Norfair)."""

    def __init__(
        self,
        camera_id: str,
        min_initialized: int = 3,
        max_disappeared: int = 30,
        confirm_threshold: float = 0.5,
        sample_fps: float = 5.0,
        max_path_points: int = 200,
    ) -> None:
        self.camera_id = camera_id
        self.confirm_threshold = confirm_threshold
        self.max_path_points = max_path_points
        self.max_disappeared = max_disappeared
        self.min_initialized = min_initialized

        # track_thresh = divisor high/low conf. 0.45 = aproveita detecções
        # 0.10-0.45 no 2º passo BYTE pra recuperar pessoa borrada.
        # match_thresh = IoU mínimo pra match no passo 1 (high conf).
        # track_buffer = frames sem detecção antes de remover (= max_disappeared).
        self._tracker = _ByteTrackerCore(
            track_thresh=0.45,
            match_thresh=0.80,
            track_buffer=max_disappeared,
            min_hits=min_initialized,
        )

        # Mapeamento label string → int (Core usa cls inteiro)
        self._label_to_int: dict[str, int] = {}
        self._int_to_label: dict[int, str] = {}
        self._next_cls_id = 0

        # Estado por bytetrack track_id → TrackedObject (nossa abstração)
        self.active: dict[str, TrackedObject] = {}

    def _label_id(self, label: str) -> int:
        if label not in self._label_to_int:
            i = self._next_cls_id
            self._label_to_int[label] = i
            self._int_to_label[i] = label
            self._next_cls_id += 1
        return self._label_to_int[label]

    def update(
        self,
        detections: list[dict],
        frame_time: float,
    ):
        """
        Recebe detecções do YOLO no formato:
          { objectType, confidence, bboxX, bboxY, bboxW, bboxH }  (normalizado 0-1)

        Retorna 3 listas (mesma assinatura de tracker.ObjectTracker):
          • new_confirmed: tracks que ACABARAM de virar confirmados (event_start)
          • updates:        tracks que continuam ativos (event_update)
          • ended:          tracks que encerraram (event_end)
        """
        # ── 1. Converte detecções → arrays numpy (cxcywh em pixels x1000) ──────
        # x1000 pra precisão sem ponto flutuante perder dígito significativo
        if detections:
            n = len(detections)
            dets_xywh = np.empty((n, 4), dtype=np.float32)
            scores = np.empty(n, dtype=np.float32)
            classes = np.empty(n, dtype=np.int32)
            for i, d in enumerate(detections):
                bx, by, bw, bh = d["bboxX"], d["bboxY"], d["bboxW"], d["bboxH"]
                dets_xywh[i, 0] = (bx + bw / 2) * 1000   # cx
                dets_xywh[i, 1] = (by + bh / 2) * 1000   # cy
                dets_xywh[i, 2] = bw * 1000              # w
                dets_xywh[i, 3] = bh * 1000              # h
                scores[i] = d["confidence"]
                classes[i] = self._label_id(d["objectType"])
        else:
            dets_xywh = np.zeros((0, 4), dtype=np.float32)
            scores = np.zeros(0, dtype=np.float32)
            classes = np.zeros(0, dtype=np.int32)

        # Map índice de detecção → bbox normalizada original (mais limpo que
        # converter de volta após Kalman smoothing)
        det_bbox_norm = {
            i: (d["bboxX"], d["bboxY"], d["bboxW"], d["bboxH"])
            for i, d in enumerate(detections)
        }
        det_conf_orig = {i: float(d["confidence"]) for i, d in enumerate(detections)}

        # ── 2. Roda ByteTrack core ────────────────────────────────────────────
        try:
            results = self._tracker.update(dets_xywh, scores, classes)
        except Exception as e:
            logger.warning("bytetrack_core_update_failed err=%s", e)
            results = []

        # ── 3. Reconcilia com TrackedObject (mesma lógica do Norfair path) ────
        all_active_ids: set[str] = set()
        new_confirmed: list[TrackedObject] = []
        updates: list[TrackedObject] = []

        for strack, det_ind in results:
            track_id_str = str(strack.track_id)
            all_active_ids.add(track_id_str)

            cls_int = strack.cls
            label = self._int_to_label.get(cls_int, "object")
            if det_ind >= 0 and det_ind in det_bbox_norm:
                bbox = det_bbox_norm[det_ind]
                score = det_conf_orig[det_ind]
            else:
                # Kalman extrapolation (track rematched sem detecção fresca)
                cx, cy, w, h = strack.bbox
                bbox = (
                    (cx - w / 2) / 1000,
                    (cy - h / 2) / 1000,
                    w / 1000,
                    h / 1000,
                )
                score = strack.score

            if track_id_str not in self.active:
                to = TrackedObject(
                    track_id=str(uuid.uuid4()),
                    norfair_id=track_id_str,    # campo legado, agora carrega bytetrack id
                    object_type=label,
                    started_at=frame_time,
                    last_seen_at=frame_time,
                    frames=1,
                    best_score=score,
                    best_bbox=bbox,
                    current_bbox=bbox,
                    best_frame_idx=0,
                )
                to.score_history.append(score)
                to.path.append((frame_time, bbox))
                self.active[track_id_str] = to
            else:
                to = self.active[track_id_str]
                to.frames += 1
                to.last_seen_at = frame_time
                to.score_history.append(score)
                if score > to.best_score:
                    to.best_score = score
                    to.best_bbox = bbox
                    to.best_frame_idx = to.frames - 1
                if len(to.path) < self.max_path_points:
                    to.path.append((frame_time, bbox))

                # Change 3 — Stationary Object Mode (mesma lógica do Norfair)
                prev_bx, prev_by, prev_bw, prev_bh = to.current_bbox
                new_bx, new_by, new_bw, new_bh = bbox
                prev_cx = prev_bx + prev_bw / 2
                prev_cy = prev_by + prev_bh / 2
                new_cx  = new_bx  + new_bw  / 2
                new_cy  = new_by  + new_bh  / 2
                move_threshold = 0.05 * max(new_bw, new_bh, 0.01)
                moved = (
                    abs(new_cx - prev_cx) > move_threshold or
                    abs(new_cy - prev_cy) > move_threshold
                )
                if moved:
                    to.frames_without_movement = 0
                    to.is_stationary = False
                    to._stationary_skip_count = 0
                else:
                    to.frames_without_movement += 1
                    if to.frames_without_movement >= STATIONARY_THRESHOLD:
                        to.is_stationary = True
                to.current_bbox = bbox

            # Change 1 — Median Score Confirmation (mesma lógica do Norfair)
            history_ok = len(to.score_history) >= self.min_initialized
            if not to.confirmed and history_ok and to.score_median() >= self.confirm_threshold:
                to.confirmed = True
                new_confirmed.append(to)
            elif to.confirmed:
                updates.append(to)

        # ── 4. Encerra tracks que sumiram da lista do ByteTrack ──────────────
        ended: list[TrackedObject] = []
        for tid in list(self.active.keys()):
            if tid not in all_active_ids:
                to = self.active.pop(tid)
                to.ended_at = frame_time
                if to.confirmed:
                    ended.append(to)

        return new_confirmed, updates, ended
