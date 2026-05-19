"""
Live detection publisher — Redis pub/sub para overlay ao vivo no frontend.

Worker publica detecções em tempo real em "icv:live-detections:{cameraId}".
Backend assina o canal e repassa via SSE para clientes conectados ao LivePlayer.

Throttle obrigatório:
  Mesmo em câmeras com motion contínuo, limitamos a 5 publicações por segundo
  (LIVE_PUB_MIN_INTERVAL_MS=200). 5 fps é suficiente para UI suave e evita
  saturar Redis quando há 50+ câmeras simultâneas.

Fail-soft:
  Erro de publicação NÃO interrompe o pipeline principal. Logamos warn e
  seguimos. O HTTP ingest continua normalmente para persistência.
"""
import json
import logging
import time
from typing import Optional

import redis

from config import REDIS_URL, LIVE_PUB_ENABLED, LIVE_PUB_MIN_INTERVAL_MS

logger = logging.getLogger(__name__)

# Singleton — uma conexão por processo, thread-safe (redis-py é thread-safe
# em modo connection-pool default).
_client: Optional[redis.Redis] = None
_last_pub_ms: dict[str, float] = {}  # cameraId → epoch_ms da última publicação


def _get_client() -> Optional[redis.Redis]:
    global _client
    if not LIVE_PUB_ENABLED:
        return None
    if _client is None:
        try:
            _client = redis.Redis.from_url(
                REDIS_URL,
                socket_timeout=1.0,
                socket_connect_timeout=1.0,
                decode_responses=False,
            )
            _client.ping()
            logger.info("live_publisher_connected url=%s", REDIS_URL)
        except Exception as e:
            logger.warning("live_publisher_connect_failed url=%s err=%s", REDIS_URL, e)
            _client = None
    return _client


def publish_detections(
    camera_id: str,
    frame_width: int,
    frame_height: int,
    detections: list[dict],
    tracks_by_bbox_key: dict[tuple, str] | None = None,
) -> None:
    """Publica detecções do frame atual no canal live.

    Args:
        camera_id: UUID da câmera
        frame_width: largura do frame em px (info para client renderizar bbox)
        frame_height: altura do frame em px
        detections: lista de dicts com keys bboxX/Y/W/H (normalizado 0-1),
                    objectType, confidence
        tracks_by_bbox_key: mapa opcional (bbox arredondado) → trackId pra
                            associar bbox a tracks Norfair.

    Throttle:
        Se a última publicação dessa câmera foi há menos de
        LIVE_PUB_MIN_INTERVAL_MS, descarta silenciosamente.
    """
    client = _get_client()
    if client is None:
        return

    now_ms = time.monotonic() * 1000
    last = _last_pub_ms.get(camera_id, 0)
    if now_ms - last < LIVE_PUB_MIN_INTERVAL_MS:
        return
    _last_pub_ms[camera_id] = now_ms

    # Monta payload enxuto (só o necessário para renderizar bbox)
    items = []
    for d in detections:
        bx = round(float(d["bboxX"]), 4)
        by = round(float(d["bboxY"]), 4)
        bw = round(float(d["bboxW"]), 4)
        bh = round(float(d["bboxH"]), 4)
        item = {
            "t": d.get("objectType", "object"),     # type
            "c": round(float(d.get("confidence", 0)), 3),  # confidence
            "b": [bx, by, bw, bh],                  # bbox normalizado
        }
        # trackId é opcional — só se Norfair conseguiu associar
        if tracks_by_bbox_key is not None:
            key = (bx, by)
            tid = tracks_by_bbox_key.get(key)
            if tid is None:
                # busca aproximada ±0.05
                for (kx, ky), v in tracks_by_bbox_key.items():
                    if abs(kx - bx) < 0.05 and abs(ky - by) < 0.05:
                        tid = v
                        break
            if tid:
                item["i"] = tid  # track id
        items.append(item)

    payload = {
        "ts": int(time.time() * 1000),
        "w":  frame_width,
        "h":  frame_height,
        "d":  items,
    }

    channel = f"icv:live-detections:{camera_id}"
    try:
        client.publish(channel, json.dumps(payload, separators=(",", ":")))
    except Exception as e:
        # Marca cliente como inválido para reconectar no próximo call
        logger.warning("live_publish_failed camera=%s err=%s", camera_id, e)
        global _client
        try:
            client.close()
        except Exception:
            pass
        _client = None
