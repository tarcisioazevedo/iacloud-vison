"""
Motion detector — port simplificado do improved_motion.py do Frigate.

Gate barato (~1ms/frame) que pula a inferência YOLO (~80ms) quando não há
movimento. Em câmera estática (banheiro, depósito noite), reduz ~70% do
custo computacional.

Algoritmo:
  1. Grayscale + resize pra altura menor (default 180px)
  2. Improve contrast (percentile 4/96 com rolling 50 frames) — opcional
  3. cv2.absdiff(frame, avg_frame) onde avg_frame é running weighted average
  4. cv2.threshold binário (default 30)
  5. cv2.dilate + findContours
  6. Aceita motion box se contour_area > MOTION_CONTOUR_AREA (default 30)

Anti-falso-positivo:
  - lightning_threshold (0.80): >80% da tela = recalibra (IR switch, raio)
    Change 2 (Frigate): agora faz hard-reset do avg_frame e retorna
    is_lightning=True pra camera_worker.py pular YOLO neste frame.
  - MIN_MOTION_FRAMES (10): exige 10 frames consecutivos com motion box
    antes de "confiar" — elimina pixel noise transitório.
"""

import logging
import time
from collections import deque

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class MotionDetector:
    def __init__(
        self,
        frame_shape: tuple[int, int],          # (H, W) do frame original
        target_height: int = 180,              # altura de trabalho (reduz custo)
        threshold: int = 30,                    # uint8 pixel-delta mínimo
        contour_area: int = 30,                 # px² mínimo de contorno (resized!)
        lightning_threshold: float = 0.80,      # pct tela = recalibra
        frame_alpha: float = 0.01,              # velocidade running avg (normal)
        frame_alpha_calibrating: float = 0.2,   # mais rápido quando calibrando
        min_motion_frames: int = 10,            # frames consecutivos com motion
        improve_contrast: bool = True,
        contrast_history: int = 50,
    ) -> None:
        h, w = frame_shape[:2]
        self.frame_shape = (h, w)
        self.target_h = target_height
        self.target_w = target_height * w // h
        self.resize_factor = h / target_height

        self.threshold = threshold
        self.contour_area = contour_area
        self.lightning_threshold = lightning_threshold
        self.frame_alpha = frame_alpha
        self.frame_alpha_calibrating = frame_alpha_calibrating
        self.min_motion_frames = min_motion_frames

        self.avg_frame = np.zeros((self.target_h, self.target_w), np.float32)
        self.calibrating = True
        self.motion_frame_count = 0

        self.improve_contrast = improve_contrast
        self.contrast_history = np.zeros((contrast_history, 2), np.uint8)
        self.contrast_history[:, 1:2] = 255
        self.contrast_idx = 0

        # Heartbeat — só pra log
        self.frames_seen = 0
        self.frames_with_motion = 0
        self.frames_skipped = 0

    def detect(self, frame_bgr: np.ndarray) -> tuple[bool, list[tuple[int, int, int, int]], bool]:
        """
        Retorna (has_motion, motion_boxes_normalized, is_lightning).

        has_motion=True só quando >=min_motion_frames consecutivos. Antes disso,
        retorna False mesmo com motion — evita ruído transitório.

        motion_boxes em coordenadas do frame original (0-1 normalizadas).

        Change 2 — Lightning/Global Change Detection (Frigate approach):
        is_lightning=True quando >lightning_threshold (80%) dos pixels mudam
        ao mesmo tempo (IR switch, raio, flash). Nesse caso:
          • avg_frame é substituído pelo frame atual (hard reset)
          • motion_boxes é vazio (não há objeto real pra detectar)
          • caller deve pular YOLO neste frame (falso positivo garantido)
        """
        self.frames_seen += 1

        # 1. Grayscale (se vier BGR) + resize
        if len(frame_bgr.shape) == 3:
            gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        else:
            gray = frame_bgr
        resized = cv2.resize(
            gray,
            (self.target_w, self.target_h),
            interpolation=cv2.INTER_NEAREST,
        )

        # 2. Improve contrast (Frigate trick) — usa percentile 4/96 rolling
        if self.improve_contrast:
            min_v = np.percentile(resized, 4).astype(np.uint8)
            max_v = np.percentile(resized, 96).astype(np.uint8)
            if min_v < max_v:
                self.contrast_history[self.contrast_idx] = [min_v, max_v]
                self.contrast_idx = (self.contrast_idx + 1) % len(self.contrast_history)
                avg_min, avg_max = np.mean(self.contrast_history, axis=0)
                resized = np.clip(resized, avg_min, avg_max)
                if avg_max > avg_min:
                    resized = (((resized - avg_min) / (avg_max - avg_min)) * 255).astype(np.uint8)

        # 3. Blur leve (reduz noise) — só 3x3, mais barato que gaussian_filter
        resized = cv2.GaussianBlur(resized, (3, 3), 1)

        # 4. Frame delta vs running average
        frame_delta = cv2.absdiff(resized, cv2.convertScaleAbs(self.avg_frame))
        thresh = cv2.threshold(frame_delta, self.threshold, 255, cv2.THRESH_BINARY)[1]
        thresh = cv2.dilate(thresh, None, iterations=1)

        # 5. Contornos
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        motion_boxes: list[tuple[int, int, int, int]] = []
        total_contour_area = 0.0
        for c in contours:
            area = cv2.contourArea(c)
            total_contour_area += area
            if area > self.contour_area:
                x, y, w, h = cv2.boundingRect(c)
                # Converte pra coordenadas do frame original (normalizadas 0-1)
                motion_boxes.append((
                    x / self.target_w,
                    y / self.target_h,
                    (x + w) / self.target_w,
                    (y + h) / self.target_h,
                ))

        # Usa contagem real de pixels ativos (não área de contornos) para
        # lightning detection — mais preciso que total_contour_area.
        nonzero_pixels  = float(cv2.countNonZero(thresh))
        total_pixels    = float(self.target_h * self.target_w)
        changed_ratio   = nonzero_pixels / total_pixels

        pct_motion = total_contour_area / total_pixels

        # 6. Change 2 — Lightning/Global Change Detection (Frigate approach):
        # Se >lightning_threshold (80%) dos pixels mudaram em um único frame,
        # é uma mudança global de iluminação (IR switch, raio, luz acendendo),
        # não um objeto real. Faz hard-reset do background model e retorna
        # is_lightning=True pra camera_worker.py pular YOLO neste frame.
        if changed_ratio > self.lightning_threshold:
            logger.debug(
                "lightning_detected changed_ratio=%.2f — resetting avg_frame",
                changed_ratio,
            )
            # Hard reset: substitui avg_frame pelo frame atual em vez de blend
            # incremental. Isso reconverge muito mais rápido após IR switch.
            self.avg_frame = resized.astype(np.float32)
            self.calibrating = True
            self.motion_frame_count = 0
            self.frames_skipped += 1
            return False, [], True  # has_motion=False, boxes=[], is_lightning=True

        # 7. Recalibra se estava em calibração e ficou estável
        if pct_motion > self.lightning_threshold:
            self.calibrating = True
        if pct_motion < 0.05 and len(motion_boxes) <= 4 and self.calibrating:
            self.calibrating = False

        # 8. Confirmação por frames consecutivos
        if len(motion_boxes) > 0:
            self.motion_frame_count += 1
            confirmed = self.motion_frame_count >= self.min_motion_frames
        else:
            self.motion_frame_count = 0
            confirmed = False

        # 9. Atualiza running average — alpha maior quando calibrando
        alpha = self.frame_alpha_calibrating if self.calibrating else self.frame_alpha
        cv2.accumulateWeighted(resized, self.avg_frame, alpha)

        if confirmed:
            self.frames_with_motion += 1
        else:
            self.frames_skipped += 1

        return confirmed, motion_boxes, False  # is_lightning=False (normal)

    def stats(self) -> dict:
        return {
            "seen": self.frames_seen,
            "with_motion": self.frames_with_motion,
            "skipped": self.frames_skipped,
            "calibrating": self.calibrating,
            "skip_pct": round(100 * self.frames_skipped / max(self.frames_seen, 1), 1),
        }
