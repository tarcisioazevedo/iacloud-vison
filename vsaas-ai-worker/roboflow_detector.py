"""
RoboflowDetector — wrapper para Roboflow Inference Server (sidecar).

Por que sidecar Roboflow em vez de modelo no mesmo processo:
  • Apache 2.0 — licença comercial limpa
  • +27% mAP (YOLO-NAS-S vs yolov8n)
  • Sem dependency hell de super_gradients
  • Permite múltiplos modelos (especialistas Weapon/LPR/PPE) sem reload
  • Foundation models inclusos (CLIP, SAM, GroundingDINO)

Comunicação:
  Worker → HTTP POST http://roboflow_inference:9001/infer/object_detection
         → JSON com bboxes
  Latência adicional vs in-process: 5-10ms (negligível)

Fallback automático:
  Se Roboflow sidecar não responder (timeout ou erro), o detector
  cai para o YOLOv8 local. Resiliência crítica em produção.
"""
import os
import logging
import time
from typing import Optional

import numpy as np
import cv2
import requests

logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────
ROBOFLOW_URL = os.environ.get(
    "ROBOFLOW_INFERENCE_URL", "http://roboflow_inference:9001"
)
# Modelo padrão. Outros options:
#   - "yolo_nas_s" (default, COCO 80 classes, 47.5 mAP)
#   - "yolov8n-640" (fallback rápido)
#   - "coco/3" (Roboflow Universe)
ROBOFLOW_MODEL_ID = os.environ.get("ROBOFLOW_MODEL_ID", "yolo_nas_s")
ROBOFLOW_TIMEOUT_S = float(os.environ.get("ROBOFLOW_TIMEOUT_S", "5"))


def _load_api_key() -> str:
    """Carrega API key via secret file ou env var."""
    file_path = os.environ.get("ROBOFLOW_API_KEY_FILE", "/run/secrets/roboflow_api_key")
    if file_path and os.path.exists(file_path):
        try:
            return open(file_path).read().strip()
        except Exception:
            pass
    return os.environ.get("ROBOFLOW_API_KEY", "").strip()


ROBOFLOW_API_KEY = _load_api_key()

# Configs gerais (mesmas do detector original)
YOLO_BASE_CONF = float(os.environ.get("YOLO_BASE_CONF", "0.20"))
YOLO_IOU = float(os.environ.get("YOLO_IOU", "0.35"))
FALLBACK_CONF = float(os.environ.get("FALLBACK_CONF", "0.50"))

# ── Threshold por classe (mesmo do yolov8_detector pra calibração consistente) ──
DEFAULT_PER_CLASS_CONF = {
    'knife':         0.25,
    'scissors':      0.25,
    'baseball bat':  0.25,
    'cell phone':    0.30,
    'backpack':      0.35,
    'handbag':       0.35,
    'suitcase':      0.35,
    'bottle':        0.40,
    'person':        0.30,
    'dog':           0.45,
    'cat':           0.45,
    'bird':          0.50,
    'horse':         0.50,
    'car':           0.55,
    'truck':         0.55,
    'bus':           0.55,
    'motorcycle':    0.45,
    'bicycle':       0.40,
    'laptop':        0.50,
    'tv':            0.70,
    'chair':         0.65,
    'couch':         0.65,
    'book':          0.60,
    'clock':         0.65,
    'potted plant':  0.70,
    'umbrella':      0.50,
}


def _load_per_class_conf() -> dict[str, float]:
    raw = os.environ.get("CONFIDENCE_PER_CLASS", "").strip()
    if not raw:
        return DEFAULT_PER_CLASS_CONF
    try:
        import json
        custom = json.loads(raw)
        return {**DEFAULT_PER_CLASS_CONF, **custom}
    except Exception as e:
        logger.warning("invalid_CONFIDENCE_PER_CLASS_json err=%s", e)
        return DEFAULT_PER_CLASS_CONF


PER_CLASS_CONF = _load_per_class_conf()


class RoboflowDetector:
    """Detector via sidecar Roboflow Inference Server."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})

        # Tenta conectar para health check (não bloqueante)
        self.available = self._health_check()
        if not self.available:
            logger.warning(
                "roboflow_sidecar_unavailable url=%s — detector vai cair pra fallback",
                ROBOFLOW_URL,
            )
        else:
            logger.info(
                "roboflow_sidecar_connected url=%s model=%s",
                ROBOFLOW_URL, ROBOFLOW_MODEL_ID,
            )

        # Carrega COCO class names (Roboflow returna names mas é mais leve
        # ter dict local para mapeamento rápido)
        self.names = {i: name for i, name in enumerate(_COCO_NAMES)}

        # Warmup: roda 1 inferência num dummy. Se der 403/401, marca
        # como NÃO available para o factory cair pro fallback Ultralytics.
        if self.available:
            dummy = np.zeros((640, 640, 3), dtype=np.uint8)
            try:
                # Detect retorna [] em qualquer erro, mas marca self.available
                # como False em erros de auth (403/401). Verifica antes:
                before = self.available
                self.detect(dummy)
                if not self.available:
                    logger.warning("roboflow_warmup_marked_unavailable (auth?)")
                else:
                    logger.info("roboflow_warmup_ok")
            except Exception as e:
                logger.warning("roboflow_warmup_failed err=%s", e)
                self.available = False

    def _health_check(self) -> bool:
        try:
            r = self.session.get(f"{ROBOFLOW_URL}/", timeout=3)
            return r.status_code == 200
        except Exception:
            return False

    def detect(self, frame: np.ndarray, confidence: Optional[float] = None) -> list[dict]:
        """Detecta objetos via Roboflow Inference Server.

        Endpoint: POST /infer/object_detection
        Body: { image: { type, value }, confidence, iou_threshold, model_id }
        Resp: { predictions: [{ class, confidence, x, y, width, height }] }
        """
        h, w = frame.shape[:2]
        out: list[dict] = []

        if not self.available:
            return out

        # Encode frame como JPEG base64 (mais leve que raw bytes)
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            logger.warning("roboflow_encode_failed")
            return out
        import base64
        img_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

        payload = {
            "model_id": ROBOFLOW_MODEL_ID,
            "image": {"type": "base64", "value": img_b64},
            "confidence": YOLO_BASE_CONF,
            "iou_threshold": YOLO_IOU,
        }
        if ROBOFLOW_API_KEY:
            payload["api_key"] = ROBOFLOW_API_KEY

        try:
            t0 = time.monotonic()
            r = self.session.post(
                f"{ROBOFLOW_URL}/infer/object_detection",
                json=payload,
                timeout=ROBOFLOW_TIMEOUT_S,
            )
            elapsed_ms = (time.monotonic() - t0) * 1000
            if r.status_code != 200:
                logger.warning(
                    "roboflow_infer_http_error status=%d body=%s",
                    r.status_code, r.text[:200],
                )
                # 401/403 → marca como unavailable para factory cair pra fallback
                if r.status_code in (401, 403):
                    self.available = False
                return out
            data = r.json()
        except requests.Timeout:
            logger.warning("roboflow_timeout after %.1fs", ROBOFLOW_TIMEOUT_S)
            self.available = self._health_check()
            return out
        except Exception as e:
            logger.warning("roboflow_request_failed err=%s", e)
            return out

        # Resposta: { "predictions": [{ "class": "person", "confidence": 0.87,
        #                                "x": 123, "y": 234, "width": 100, "height": 200 }] }
        predictions = data.get("predictions") or []
        for pred in predictions:
            cls_name = pred.get("class", "unknown")
            conf = float(pred.get("confidence", 0))
            threshold = PER_CLASS_CONF.get(cls_name, FALLBACK_CONF)
            if conf < threshold:
                continue

            # Roboflow retorna center (x, y) + width/height em pixels
            cx, cy = float(pred["x"]), float(pred["y"])
            bw, bh = float(pred["width"]), float(pred["height"])
            x1 = cx - bw / 2
            y1 = cy - bh / 2

            out.append({
                "objectType": cls_name,
                "confidence": round(conf, 4),
                "bboxX": round(x1 / w, 4),
                "bboxY": round(y1 / h, 4),
                "bboxW": round(bw / w, 4),
                "bboxH": round(bh / h, 4),
            })

        return out


# COCO 80 classes (ordem standard)
_COCO_NAMES = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
    'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
    'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
    'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
    'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
    'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
    'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
    'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
    'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
    'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
    'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
    'toothbrush',
]
