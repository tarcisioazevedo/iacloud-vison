import numpy as np
from ultralytics import YOLO
from config import MODEL_NAME

class YoloDetector:
    def __init__(self):
        self.model = YOLO(MODEL_NAME)
        self.names = self.model.names

    def detect(self, frame: np.ndarray, confidence: float = 0.50) -> list[dict]:
        results = self.model(frame, conf=confidence, verbose=False)[0]
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
