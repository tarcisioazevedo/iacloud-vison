"""
detector.py — factory pattern com fallback automático.

Backend selecionado via env var YOLO_BACKEND:
  • "roboflow"   — Roboflow Inference Server sidecar (Apache 2.0, YOLO-NAS) [PADRÃO]
  • "ultralytics" — YOLOv8 local (AGPL-3.0, fallback)

Fallback automático:
  Quando "roboflow" é configurado mas o sidecar não está disponível, o
  detector cai automaticamente para "ultralytics" sem interromper o worker.
  Isso garante que crash/restart do sidecar Roboflow não derrube a IA.

Interface .detect() é idêntica entre backends — camera_worker.py não muda.

Por que Roboflow sidecar é preferível em produção:
  • Apache 2.0 — sem royalties em revenda comercial
  • +27% mAP (YOLO-NAS-S vs YOLOv8n)
  • Permite múltiplos modelos (Weapon, LPR, PPE) sem reload do worker
  • Foundation models inclusos (CLIP, SAM, GroundingDINO)
  • Isolamento de falhas: crash de modelo não derruba worker
"""
import os
import logging

logger = logging.getLogger(__name__)

YOLO_BACKEND = os.environ.get("YOLO_BACKEND", "ultralytics").lower().strip()


def _create_detector():
    """Factory — instancia detector primário com fallback automático."""

    if YOLO_BACKEND == "roboflow":
        logger.info("detector_backend=roboflow (tentando sidecar Roboflow Inference)")
        try:
            from roboflow_detector import RoboflowDetector
            instance = RoboflowDetector()
            if instance.available:
                logger.info("detector_active=roboflow")
                return instance
            else:
                logger.warning(
                    "detector_roboflow_unavailable — fallback para ultralytics"
                )
        except Exception as e:
            logger.warning("detector_roboflow_init_failed err=%s — fallback", e)

        # Fallback automático para Ultralytics
        from yolov8_detector import Yolov8Detector
        logger.info("detector_active=ultralytics (fallback)")
        return Yolov8Detector()

    elif YOLO_BACKEND in ("ultralytics", "yolov8", ""):
        logger.info("detector_backend=ultralytics (YOLOv8 local)")
        from yolov8_detector import Yolov8Detector
        return Yolov8Detector()

    else:
        logger.warning(
            "detector_backend_unknown value=%s — fallback ultralytics", YOLO_BACKEND,
        )
        from yolov8_detector import Yolov8Detector
        return Yolov8Detector()


# YoloDetector é o alias usado por camera_worker.py (zero refator lá)
class YoloDetector:
    """Wrapper que delega para o backend configurado."""

    def __init__(self):
        self._impl = _create_detector()
        # Expõe atributos esperados pelo camera_worker
        self.model = getattr(self._impl, "model", None)
        self.names = getattr(self._impl, "names", {})

    def detect(self, frame, confidence=None):
        return self._impl.detect(frame, confidence)
