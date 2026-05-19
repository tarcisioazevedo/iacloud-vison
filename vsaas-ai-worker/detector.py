"""
YoloDetector — wrapper Ultralytics com threshold POR CLASSE.

Por que threshold por classe:
  Threshold global (ex: 0.40) é compromisso ruim entre classes.
  - Faca pequena geralmente vem com conf 0.25-0.35 → perde alerta crítico
  - Carro grande geralmente vem com conf 0.85+ → pode ser 0.55 sem perda
  - Celular oclusado por mão geralmente 0.30-0.40 → perde caso comum
  Threshold por classe maximiza recall em itens críticos e mantém precisão
  em itens fáceis.

NMS IoU:
  Default Ultralytics é 0.45. Baixamos para 0.35 para aceitar objetos
  sobrepostos (celular na mão, pessoas juntas em saída de show, mochila
  sobre o corpo). Trade-off: ~2% mais boxes duplicadas, mas em vigilância
  é preferível detectar duas vezes que perder evento.

Base confidence:
  Passamos 0.20 ao Ultralytics (deixa retornar bastante) e filtramos
  client-side por classe. Sem essa abordagem, threshold global cortaria
  detecções legítimas antes de chegarmos aqui.
"""
import os
import numpy as np
from ultralytics import YOLO
from config import MODEL_NAME

# Tamanho de entrada do YOLO. Default 1280 captura objetos pequenos
# (pessoas a 15m, celular em mão, faca). Custo ~2.5x vs 640px.
YOLO_IMGSZ = int(os.environ.get("YOLO_IMGSZ", "1280"))

# NMS IoU — controla agressividade de supressão de bboxes sobrepostos.
# Default Ultralytics 0.45. Vigilância: 0.35 (aceita mais sobreposição).
YOLO_IOU = float(os.environ.get("YOLO_IOU", "0.35"))

# Confidence base (passada ao Ultralytics). Baixa porque filtramos
# manualmente por classe abaixo. Não usar 0 (gera ruído enorme).
YOLO_BASE_CONF = float(os.environ.get("YOLO_BASE_CONF", "0.20"))

# ── Threshold por classe (CONFIDENCE_PER_CLASS) ─────────────────────────
# Calibrado empiricamente para o pipeline VSaaS (1280px, COCO classes).
# Pode ser sobreposto via env var (JSON) para fine-tuning por cliente.
#
# Filosofia:
#   - Itens críticos (segurança): threshold BAIXO. Falso positivo é
#     tolerável; falso negativo (perder faca/arma) é inaceitável.
#   - Itens estruturais (carro, ônibus): threshold ALTO. Já são fáceis
#     de detectar, threshold alto elimina ruído.
#   - Itens médios (pessoa, animal): threshold meio.
DEFAULT_PER_CLASS_CONF = {
    # Segurança crítica — recall alto
    'knife':         0.25,
    'scissors':      0.25,
    'baseball bat':  0.25,
    # Pequenos e oclusos — recall alto
    'cell phone':    0.30,
    'backpack':      0.35,
    'handbag':       0.35,
    'suitcase':      0.35,
    'bottle':        0.40,
    # Pessoas — threshold baixo. Em vigilância pode aparecer corpo parcial
    # (rosto + ombro, pessoa de costas, atravessando o frame). YOLO retorna
    # 0.30-0.40 nesses casos. 0.30 permite detectar em qualquer pose.
    'person':        0.30,
    # Animais — equilíbrio
    'dog':           0.45,
    'cat':           0.45,
    'bird':          0.50,
    'horse':         0.50,
    # Veículos — fáceis, threshold alto
    'car':           0.55,
    'truck':         0.55,
    'bus':           0.55,
    'motorcycle':    0.45,  # menor que carro: silhueta mais ambígua
    'bicycle':       0.40,
    # Objetos comuns
    'laptop':        0.50,
    # Ambiente — threshold ALTO pra evitar falsos (madeira ≠ planta, etc).
    'tv':            0.70,
    'chair':         0.65,
    'couch':         0.65,
    'book':          0.60,
    'clock':         0.65,
    'potted plant':  0.70,
    'umbrella':      0.50,
}

def _load_per_class_conf() -> dict[str, float]:
    """Permite override via env var CONFIDENCE_PER_CLASS (JSON string)."""
    raw = os.environ.get("CONFIDENCE_PER_CLASS", "").strip()
    if not raw:
        return DEFAULT_PER_CLASS_CONF
    try:
        import json
        custom = json.loads(raw)
        # Merge: defaults primeiro, override depois (caller pode adicionar
        # classes novas sem perder os defaults)
        merged = {**DEFAULT_PER_CLASS_CONF, **custom}
        return merged
    except Exception as e:
        # Fail-safe: log e usa defaults
        import logging
        logging.getLogger(__name__).warning(
            "invalid_CONFIDENCE_PER_CLASS_json err=%s — usando defaults", e,
        )
        return DEFAULT_PER_CLASS_CONF

PER_CLASS_CONF = _load_per_class_conf()

# Fallback para classes sem threshold definido (ex: detecções futuras
# que não estão no catálogo). Conservador para evitar lixo.
FALLBACK_CONF = float(os.environ.get("FALLBACK_CONF", "0.50"))


class YoloDetector:
    def __init__(self):
        self.model = YOLO(MODEL_NAME)
        self.names = self.model.names
        # Pre-calcula class IDs que estão em PER_CLASS_CONF — passados ao
        # YOLO via `classes=` filtra internamente, ~10% mais rápido (sem
        # NMS em classes não-monitoradas).
        wanted_names = set(PER_CLASS_CONF.keys())
        self._class_filter = [
            i for i, name in self.names.items() if name in wanted_names
        ]
        # Warmup: primeiro inference em PyTorch é 5-10x mais lento (JIT,
        # cuDNN init, alocação de buffers). Roda um dummy 640x640 no boot
        # para custo inicial não vazar pro primeiro frame real.
        dummy = np.zeros((640, 640, 3), dtype=np.uint8)
        self.model(dummy, conf=0.5, imgsz=YOLO_IMGSZ, verbose=False)

    def detect(self, frame: np.ndarray, confidence: float | None = None) -> list[dict]:
        """Detecta objetos no frame com filtragem por classe.

        Args:
            confidence: ignorado se per-class está ativo. Mantido na
                assinatura por compat com chamadas antigas em camera_worker.

        Returns:
            Lista de detecções já filtradas pelo threshold da classe.
        """
        results = self.model(
            frame,
            conf=YOLO_BASE_CONF,     # baixo: deixa modelo retornar tudo
            iou=YOLO_IOU,            # NMS mais permissivo
            imgsz=YOLO_IMGSZ,
            classes=self._class_filter,  # ~10% speedup: filtra classes irrelevantes
            verbose=False,
        )[0]
        h, w = frame.shape[:2]
        out = []
        for box in results.boxes:
            cls_name = self.names[int(box.cls)]
            conf = float(box.conf)
            # Filtro por classe — descarta antes de calcular coordenadas
            threshold = PER_CLASS_CONF.get(cls_name, FALLBACK_CONF)
            if conf < threshold:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            out.append({
                "objectType": cls_name,
                "confidence": round(conf, 4),
                "bboxX": round(x1 / w, 4),
                "bboxY": round(y1 / h, 4),
                "bboxW": round((x2 - x1) / w, 4),
                "bboxH": round((y2 - y1) / h, 4),
            })
        return out
