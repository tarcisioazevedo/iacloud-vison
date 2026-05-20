FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pré-baixar weights YOLOv8 (fallback caso Roboflow Inference Server caia).
# Sprint A 2026-05-19: Inferência principal agora via sidecar Roboflow
# (YOLO-NAS Apache 2.0). YOLOv8 fica como fallback local.
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt'); YOLO('yolov8s.pt')"

COPY . .

CMD ["python", "-u", "main.py"]
