"""
SpecialistRouter — cascading detection com modelos Roboflow Universe.

Filosofia:
  YOLO geral (coco/3) é barato e detecta contexto. Especialistas são caros
  e só rodam quando YOLO encontra trigger relevante.

  Exemplo:
    YOLO detectou "person" → roda Weapon, PPE, Fall sobre o crop
    YOLO detectou "car"    → roda LPR sobre o crop
    YOLO detectou "motorcycle" → roda Helmet sobre o crop

Throttle/cooldown:
  • Cooldown por (trackId, modelType) — evita rodar PPE 30x na mesma pessoa
  • Específico por tipo: weapon=10s (verifica frequente), ppe=30s (pessoa estável)

Modelos Roboflow Universe usados:
  weapon: "weapons-detection-1xnia/2"
  lpr:    "license-plate-recognition-rxg4e/4"
  ppe:    "construction-site-safety/2"  (ou ppe-detection-4ckpd/8)
  helmet: "motorcycle-helmet-1obcw/2"
  fall:   "human-fall-detection-czmaz/3"
  crowd:  "crowd-density-detection/1"

IMPORTANTE: model_ids são placeholders e devem ser validados via
Roboflow Universe antes de uso em produção. Trocar por modelos que
existem e funcionam no nosso workspace.
"""
import os
import time
import base64
import logging
from typing import Optional

import cv2
import numpy as np
import requests

logger = logging.getLogger(__name__)

# Catálogo de modelos especialistas e endpoints Roboflow.
# Cada entry: { "model_id": ..., "trigger_classes": [...], "cooldown_s": N }
# Catálogo de modelos especialistas — IDs validados no Roboflow Universe 2026-05-20.
#
# Tipos de endpoint:
#   "object_detection" — Roboflow Universe trained models (precisam de api_key)
#   "grounding_dino"   — Foundation model zero-shot via texto (sem modelo treinado)
MODELS = {
    "weapon": {
        # Não existe modelo público de armas no Universe (provavelmente removidos
        # por política da plataforma). Usamos GroundingDINO zero-shot via texto.
        # text_prompt como lista de strings (GroundingDINO API).
        "endpoint": "grounding_dino",
        "text_prompt": ["gun", "pistol", "rifle", "knife", "blade", "weapon"],
        "trigger_classes": ["person"],
        "cooldown_s": 10,
        "crop_padding": 0.05,
    },
    "lpr": {
        "endpoint": "object_detection",
        "model_id": "vehicle-registration-plates-trudk/2",
        "trigger_classes": ["car", "truck", "bus"],
        "cooldown_s": 60,
        "crop_padding": 0.10,
    },
    "ppe": {
        "endpoint": "object_detection",
        "model_id": "construction-safety-gsnvb/1",
        "trigger_classes": ["person"],
        "cooldown_s": 30,
        "crop_padding": 0.10,
    },
    "helmet": {
        "endpoint": "object_detection",
        "model_id": "helmet-detection-project/9",
        "trigger_classes": ["motorcycle"],
        "cooldown_s": 15,
        "crop_padding": 0.20,
    },
    "fall": {
        "endpoint": "object_detection",
        "model_id": "fall-detection-ca3o8/4",
        "trigger_classes": ["person"],
        "cooldown_s": 5,
        "crop_padding": 0.15,
    },
    "crowd": {
        "endpoint": "object_detection",
        "model_id": "people-detection-general/5",
        "trigger_classes": [],  # global
        "cooldown_s": 30,
        "crop_padding": 0.0,
    },
}

ROBOFLOW_URL = os.environ.get(
    "ROBOFLOW_INFERENCE_URL", "http://roboflow_inference:9001"
)
ROBOFLOW_TIMEOUT_S = float(os.environ.get("ROBOFLOW_SPECIALIST_TIMEOUT_S", "8"))


def _load_api_key() -> str:
    file_path = os.environ.get("ROBOFLOW_API_KEY_FILE", "/run/secrets/roboflow_api_key")
    if file_path and os.path.exists(file_path):
        try:
            return open(file_path).read().strip()
        except Exception:
            pass
    return os.environ.get("ROBOFLOW_API_KEY", "").strip()


ROBOFLOW_API_KEY = _load_api_key()


class SpecialistRouter:
    """Roteador de modelos especialistas com cascading e cooldown."""

    def __init__(self, enabled_models: list[str], ppe_zone: Optional[dict] = None,
                 lpr_watchlist: Optional[list[str]] = None):
        """
        Args:
            enabled_models: lista de modelos ativados (subset de MODELS.keys())
            ppe_zone: polígono normalizado para zona PPE (opcional)
            lpr_watchlist: lista de placas em watchlist (opcional)
        """
        self.enabled = set(m for m in enabled_models if m in MODELS)
        self.ppe_zone = ppe_zone
        self.lpr_watchlist = set([p.upper().replace(" ", "").replace("-", "")
                                  for p in (lpr_watchlist or [])])

        # Cooldown por (trackId|"global", model_name) → epoch_seconds
        self._cooldowns: dict[tuple[str, str], float] = {}

        # HTTP session reutilizada
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})

        # Disponibilidade do sidecar
        self.available = self._health_check()
        if not self.available:
            logger.warning("specialist_router_unavailable url=%s", ROBOFLOW_URL)
        elif self.enabled:
            logger.info(
                "specialist_router_ready enabled=%s url=%s",
                sorted(self.enabled), ROBOFLOW_URL,
            )

    def _health_check(self) -> bool:
        try:
            r = self.session.get(f"{ROBOFLOW_URL}/", timeout=3)
            return r.status_code == 200
        except Exception:
            return False

    def process(self, frame: np.ndarray, yolo_detections: list[dict]) -> list[dict]:
        """
        Args:
            frame: imagem completa (BGR numpy)
            yolo_detections: lista de detecções YOLO no formato do detector.py
                cada item: {objectType, confidence, bboxX, bboxY, bboxW, bboxH, trackId?}

        Returns:
            Lista de detecções especialistas: [{
                "modelType": "weapon",
                "confidence": 0.87,
                "payload": {...},
                "trackId": "...",
                "bbox": [x,y,w,h] no frame original,
            }]
        """
        if not self.enabled or not self.available:
            return []

        h, w = frame.shape[:2]
        results: list[dict] = []
        now = time.monotonic()

        # Crowd density: roda 1x se enabled, sobre o frame inteiro
        if "crowd" in self.enabled:
            if self._check_cooldown(now, "global", "crowd"):
                self._set_cooldown(now, "global", "crowd")
                crowd_res = self._infer(frame, "crowd")
                if crowd_res:
                    person_count = sum(1 for p in crowd_res
                                       if p.get("class", "").lower() == "person")
                    results.append({
                        "modelType": "crowd",
                        "confidence": 1.0,
                        "payload": {
                            "count": person_count,
                            "details": crowd_res,
                        },
                        "trackId": None,
                        "bbox": None,
                    })

        # Detecção por bbox individual
        for det in yolo_detections:
            obj_type = det.get("objectType", "")
            track_id = det.get("trackId", "anon")

            # Lista de modelos triggados por essa classe
            for model_name, cfg in MODELS.items():
                if model_name not in self.enabled:
                    continue
                if model_name == "crowd":
                    continue
                if obj_type not in cfg["trigger_classes"]:
                    continue

                # Cooldown por (track, model)
                if not self._check_cooldown(now, track_id, model_name):
                    continue

                # PPE só roda se a detecção está dentro da zona configurada
                if model_name == "ppe" and self.ppe_zone:
                    if not self._point_in_zone(det, self.ppe_zone):
                        continue

                # Crop com padding
                pad = cfg["crop_padding"]
                bx = max(0.0, det["bboxX"] - pad)
                by = max(0.0, det["bboxY"] - pad)
                bw = min(1.0 - bx, det["bboxW"] + 2 * pad)
                bh = min(1.0 - by, det["bboxH"] + 2 * pad)

                # Pixel coords
                x1 = int(bx * w)
                y1 = int(by * h)
                x2 = int((bx + bw) * w)
                y2 = int((by + bh) * h)
                crop = frame[y1:y2, x1:x2]
                if crop.size == 0:
                    continue

                self._set_cooldown(now, track_id, model_name)
                preds = self._infer(crop, model_name)
                if not preds:
                    continue

                # Process per-model logic. Para LPR, anexa crop b64 para o
                # backend chamar genai.readPlate (OCR Gemini Flash).
                crop_b64 = None
                if model_name == "lpr":
                    try:
                        ok2, buf2 = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
                        if ok2:
                            crop_b64 = base64.b64encode(buf2.tobytes()).decode("ascii")
                    except Exception:
                        pass
                evt = self._process_predictions(model_name, preds, track_id, det, crop_b64)
                if evt:
                    results.append(evt)

        return results

    # ─────────────────────────────────────────────────────────────────────

    def _check_cooldown(self, now: float, track_id: str, model_name: str) -> bool:
        """True se pode rodar (não em cooldown)."""
        key = (track_id, model_name)
        last = self._cooldowns.get(key, 0)
        cooldown = MODELS[model_name]["cooldown_s"]
        return (now - last) >= cooldown

    def _set_cooldown(self, now: float, track_id: str, model_name: str) -> None:
        self._cooldowns[(track_id, model_name)] = now

    def _point_in_zone(self, det: dict, zone: dict) -> bool:
        """Verifica se o centro do bbox está dentro do polígono PPE."""
        try:
            cx = det["bboxX"] + det["bboxW"] / 2
            cy = det["bboxY"] + det["bboxH"] / 2
            polygon = zone.get("points", [])
            if len(polygon) < 3:
                return True  # zona inválida → não restringe
            # Ray casting algorithm
            inside = False
            j = len(polygon) - 1
            for i in range(len(polygon)):
                xi, yi = polygon[i]
                xj, yj = polygon[j]
                if ((yi > cy) != (yj > cy)) and \
                   (cx < (xj - xi) * (cy - yi) / (yj - yi + 1e-9) + xi):
                    inside = not inside
                j = i
            return inside
        except Exception:
            return True

    def _infer(self, image: np.ndarray, model_name: str) -> list[dict]:
        """Chama Roboflow Inference Server. Retorna lista de predictions."""
        cfg = MODELS[model_name]
        ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            return []
        img_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

        endpoint_type = cfg.get("endpoint", "object_detection")

        # ── GroundingDINO (foundation model zero-shot) ─────────────────
        if endpoint_type == "grounding_dino":
            payload = {
                "image": {"type": "base64", "value": img_b64},
                "text": cfg["text_prompt"],
                "box_threshold": 0.35,
                "text_threshold": 0.25,
            }
            if ROBOFLOW_API_KEY:
                payload["api_key"] = ROBOFLOW_API_KEY
            try:
                r = self.session.post(
                    f"{ROBOFLOW_URL}/grounding_dino/infer",
                    json=payload,
                    timeout=ROBOFLOW_TIMEOUT_S,
                )
                if r.status_code != 200:
                    logger.warning(
                        "grounding_dino_http_error name=%s status=%d body=%s",
                        model_name, r.status_code, r.text[:200],
                    )
                    return []
                data = r.json()
                return data.get("predictions") or []
            except Exception as e:
                logger.warning("grounding_dino_failed name=%s err=%s", model_name, e)
                return []

        # ── Object detection (Universe trained models) ─────────────────
        payload = {
            "model_id": cfg["model_id"],
            "image": {"type": "base64", "value": img_b64},
            "confidence": 0.30,
            "iou_threshold": 0.45,
        }
        if ROBOFLOW_API_KEY:
            payload["api_key"] = ROBOFLOW_API_KEY

        try:
            r = self.session.post(
                f"{ROBOFLOW_URL}/infer/object_detection",
                json=payload,
                timeout=ROBOFLOW_TIMEOUT_S,
            )
            if r.status_code == 404:
                logger.warning(
                    "specialist_model_not_found name=%s model_id=%s — desabilitando",
                    model_name, cfg["model_id"],
                )
                self.enabled.discard(model_name)
                return []
            if r.status_code != 200:
                logger.warning(
                    "specialist_infer_http_error name=%s status=%d body=%s",
                    model_name, r.status_code, r.text[:200],
                )
                return []
            data = r.json()
            return data.get("predictions") or []
        except Exception as e:
            logger.warning("specialist_infer_failed name=%s err=%s", model_name, e)
            return []

    def _process_predictions(
        self, model_name: str, preds: list[dict],
        track_id: str, det: dict,
        crop_b64: Optional[str] = None,
    ) -> Optional[dict]:
        """Constrói o evento específico por modelo."""
        if not preds:
            return None

        # Pega a predição mais confiante
        top = max(preds, key=lambda p: p.get("confidence", 0))
        conf = float(top.get("confidence", 0))
        cls = top.get("class", "unknown")

        # weapon — qualquer arma detectada já é evento crítico
        if model_name == "weapon":
            return {
                "modelType": "weapon",
                "confidence": conf,
                "payload": {"weapon_type": cls, "all_predictions": preds},
                "trackId": track_id,
                "bbox": [det["bboxX"], det["bboxY"], det["bboxW"], det["bboxH"]],
            }

        # lpr — extrair texto da placa. Geralmente o modelo retorna OCR
        # no campo `class` ou `text`. Pode precisar de OCR secundário.
        if model_name == "lpr":
            # Roboflow LPR só localiza bbox da placa. O OCR de fato (texto)
            # vem do Gemini.readPlate, executado no backend ao receber este
            # specialist-event com cropB64 anexado.
            plate_text = (top.get("text") or top.get("class", "")).upper()
            plate_normalized = plate_text.replace(" ", "").replace("-", "")
            in_watchlist = plate_normalized in self.lpr_watchlist
            evt = {
                "modelType": "lpr",
                "confidence": conf,
                "payload": {
                    "plate": plate_text,        # palpite do Roboflow (pode ser vazio)
                    "in_watchlist": in_watchlist,
                    "vehicleType": det.get("objectType"),
                },
                "trackId": track_id,
                "bbox": [det["bboxX"], det["bboxY"], det["bboxW"], det["bboxH"]],
            }
            if crop_b64:
                evt["cropB64"] = crop_b64
            return evt

        # ppe — lista de EPIs ausentes
        if model_name == "ppe":
            present = set()
            for p in preds:
                c = p.get("class", "").lower()
                if c in ("helmet", "hardhat"):
                    present.add("helmet")
                elif c in ("vest", "safety_vest"):
                    present.add("vest")
                elif c in ("mask", "face_mask"):
                    present.add("mask")
                elif c in ("gloves",):
                    present.add("gloves")
            required = {"helmet", "vest"}  # configurável por câmera futuramente
            missing = list(required - present)
            if not missing:
                return None  # tudo OK, não emite evento
            return {
                "modelType": "ppe",
                "confidence": conf,
                "payload": {
                    "missing": missing,
                    "present": list(present),
                },
                "trackId": track_id,
                "bbox": [det["bboxX"], det["bboxY"], det["bboxW"], det["bboxH"]],
            }

        # helmet motoqueiro — verifica se está usando
        if model_name == "helmet":
            wearing = "helmet" in cls.lower() and "no" not in cls.lower()
            if wearing:
                return None  # OK, não emite alerta
            return {
                "modelType": "helmet",
                "confidence": conf,
                "payload": {"wearing": False, "label": cls},
                "trackId": track_id,
                "bbox": [det["bboxX"], det["bboxY"], det["bboxW"], det["bboxH"]],
            }

        # fall — emite só se state indica queda
        if model_name == "fall":
            cls_lower = cls.lower()
            if "fall" not in cls_lower and "lying" not in cls_lower:
                return None
            return {
                "modelType": "fall",
                "confidence": conf,
                "payload": {"state": cls},
                "trackId": track_id,
                "bbox": [det["bboxX"], det["bboxY"], det["bboxW"], det["bboxH"]],
            }

        return None
