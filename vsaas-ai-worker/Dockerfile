FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pré-baixar weights YOLOv8 (Tier 1-LITE: yolov8s default, mantém yolov8n
# como fallback caso variável seja sobrescrita em runtime).
# yolov8n.pt ~6MB · yolov8s.pt ~22MB · yolov8m.pt ~52MB (não baixado)
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt'); YOLO('yolov8s.pt')"

COPY . .

CMD ["python", "-u", "main.py"]
