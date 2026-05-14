import os
import numpy as np
from ultralytics import YOLO
from config import MODEL_NAME

# Tamanho de entrada do YOLO. Default 640 é insuficiente pra câmeras
# tipo rooftop onde pessoas aparecem pequenas (50-100px) — confundem com
# carro/poste/etc. 1280 dobra o detalhe efetivo (~2× mAP em objetos pequenos).
# Custo: ~2.5× inference. yolov8n@1280 ainda fica < 50ms/frame em CPU típico.
YOLO_IMGSZ = int(os.environ.get("YOLO_IMGSZ", "1280"))

class YoloDetector:
    def __init__(self):
        self.model = YOLO(MODEL_NAME)
        self.names = self.model.names

    def detect(self, frame: np.ndarray, confidence: float = 0.50) -> list[dict]:
        results = self.model(
            frame,
            conf=confidence,
            imgsz=YOLO_IMGSZ,
            verbose=False,
        )[0]
        h, w = frame.shape[:2]
        out = []
        for box in results.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            out.append({
                "objectType": self.names[int(box.cls)],
                "confidence": round(float(box.conf), 4),
                "bboxX": round(x1 / w, 4),
                "bboxY": round(y1 / h, 4),
                "bboxW": round((x2 - x1) / w, 4),
                "bboxH": round((y2 - y1) / h, 4),
            })
        return out
