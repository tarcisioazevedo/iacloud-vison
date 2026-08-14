"""
detector.py — factory pattern com fallback automático.

Backend selecionado via env var YOLO_BACKEND:
  • "roboflow"   — Roboflow Inference Server sidecar (Apache 2.0, YOLO-NAS) [PADRÃO]
  • "ultralytics" — YOLOv8 local (AGPL-3.0) — BLOQUEADO sem ICV_ALLOW_AGPL=1

LICENÇA (auditoria 2026-06-24):
  Ultralytics/YOLOv8 é AGPL-3.0 e INCOMPATÍVEL com SaaS comercial fechado
  (copyleft de rede). Por isso o default agora é "roboflow" e o fallback para
  Ultralytics SÓ ocorre se ICV_ALLOW_AGPL=1 for setado explicitamente. Sem a
  flag, qualquer caminho que levaria ao Ultralytics FALHA ALTO (fail-closed)
  em vez de rodar código AGPL por engano e criar passivo jurídico.

Interface .detect() é idêntica entre backends — camera_worker.py não muda.

Por que Roboflow sidecar é preferível em produção:
  • Apache 2.0 — sem royalties em revenda comercial
  • +27% mAP (YOLO-NAS-S vs YOLOv8n)
  • Permite múltiplos modelos (Weapon, LPR, PPE) sem reload do worker
  • Foundation models inclusos (CLIP, SAM, GroundingDINO)
  • Isolamento de falhas: crash de modelo não derruba worker

Change 4 — Aspect Ratio Filters (Frigate approach):
  filter_by_ratio() remove detecções com proporção fisicamente impossível.
  Exemplos: pessoa em bbox 20:1 horizontal; carro em bbox 1:5 vertical.
  Essas detecções desperdiçam recursos do tracker e geram alertas falsos.
"""
import os
import logging

logger = logging.getLogger(__name__)

# Change 4 — Aspect Ratio Filters (Frigate approach).
# Faixas de aspect ratio (largura/altura) por classe de objeto.
# Objetos fora da faixa são fisicamente impossíveis → descartados antes do tracker.
# Justificativa das faixas:
#   • person  (0.2–1.2): pessoas são mais altas que largas (pé vs cabeça vertical)
#   • car     (1.0–5.0): carros são muito mais largos que altos
#   • truck   (0.8–5.0): caminhões podem aparecer de frente (quase quadrado) ou lateral
#   • bus     (0.8–5.0): idem caminhão
#   • motorcycle (0.4–2.5): moto de perfil é larga; de frente é quase quadrada
#   • bicycle (0.4–2.5): bicicleta similar a moto
#   • default (0.1–10.0): muito permissivo pra não descartar classes desconhecidas
_RATIO_FILTERS: dict[str, tuple[float, float]] = {
    "person":     (0.2, 1.2),
    "car":        (1.0, 5.0),
    "truck":      (0.8, 5.0),
    "bus":        (0.8, 5.0),
    "motorcycle": (0.4, 2.5),
    "bicycle":    (0.4, 2.5),
}
_RATIO_DEFAULT = (0.1, 10.0)


def filter_by_ratio(detections: list[dict]) -> list[dict]:
    """
    Filtra detecções com aspect ratio (w/h) fora da faixa esperada para a classe.

    Change 4 — Aspect Ratio Filters (Frigate approach):
    YOLO ocasionalmente produz bboxes fisicamente impossíveis (pessoa 20:1,
    carro 1:5). Esses são artefatos de NMS mal configurado ou inferência em
    bordas de frame. Descartá-los antes do tracker reduz ruído e CPU.

    Args:
        detections: lista de dicts com bboxW, bboxH, objectType.

    Returns:
        Lista filtrada (sem alterar os dicts originais).
    """
    filtered = []
    for det in detections:
        w = det.get("bboxW", 0.0)
        h = det.get("bboxH", 0.0)
        if h < 0.001:
            # Evita divisão por zero; bbox degenerado → descarta
            logger.debug(
                "ratio_filter_skip objectType=%s reason=degenerate_height h=%.4f",
                det.get("objectType"), h,
            )
            continue
        ratio = w / h
        min_r, max_r = _RATIO_FILTERS.get(det.get("objectType", ""), _RATIO_DEFAULT)
        if min_r <= ratio <= max_r:
            filtered.append(det)
        else:
            logger.debug(
                "ratio_filter_removed objectType=%s ratio=%.2f expected=[%.1f, %.1f]",
                det.get("objectType"), ratio, min_r, max_r,
            )
    return filtered

# Default = roboflow (Apache-2.0). Ver nota de LICENÇA no topo do arquivo.
YOLO_BACKEND = os.environ.get("YOLO_BACKEND", "roboflow").lower().strip()
_ALLOW_AGPL = os.environ.get("ICV_ALLOW_AGPL", "").strip().lower() in ("1", "true", "yes")


def _ultralytics_or_fail(context: str):
    """Retorna o detector Ultralytics SÓ se ICV_ALLOW_AGPL estiver setado.
    Caso contrário, FALHA ALTO (fail-closed) em vez de rodar código AGPL-3.0."""
    if not _ALLOW_AGPL:
        raise RuntimeError(
            "Backend Ultralytics/YOLOv8 e AGPL-3.0 e esta BLOQUEADO "
            f"(contexto={context}). Suba YOLO_BACKEND=roboflow com o sidecar no ar, "
            "ou, se tem licenca/aceita o AGPL, exporte ICV_ALLOW_AGPL=1."
        )
    logger.warning(
        "detector_active=ultralytics AGPL-3.0 habilitado via ICV_ALLOW_AGPL "
        "(context=%s) — garanta conformidade de licenca para uso comercial.", context,
    )
    from yolov8_detector import Yolov8Detector
    return Yolov8Detector()


def _create_detector():
    """Factory — primário Roboflow (Apache-2.0); Ultralytics só com flag AGPL."""

    # Ultralytics explícito: só roda com ICV_ALLOW_AGPL.
    if YOLO_BACKEND in ("ultralytics", "yolov8"):
        logger.info("detector_backend=ultralytics (YOLOv8 local, AGPL)")
        return _ultralytics_or_fail("explicit")

    # default / "roboflow" / valor desconhecido → tenta Roboflow primeiro.
    if YOLO_BACKEND not in ("roboflow", ""):
        logger.warning("detector_backend_unknown value=%s — tentando roboflow", YOLO_BACKEND)
    logger.info("detector_backend=roboflow (tentando sidecar Roboflow Inference)")
    try:
        from roboflow_detector import RoboflowDetector
        instance = RoboflowDetector()
        if instance.available:
            logger.info("detector_active=roboflow")
            return instance
        logger.warning("detector_roboflow_unavailable — avaliando fallback (gated por ICV_ALLOW_AGPL)")
    except Exception as e:
        logger.warning("detector_roboflow_init_failed err=%s — avaliando fallback (gated)", e)

    return _ultralytics_or_fail("roboflow_fallback")


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
