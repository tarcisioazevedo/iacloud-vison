FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# pré-baixar weights YOLOv8n (~6MB) para não depender de rede no boot
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

COPY . .

CMD ["python", "-u", "main.py"]
