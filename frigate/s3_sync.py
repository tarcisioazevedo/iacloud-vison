"""
IA Cloud Vision — S3 Sync Service
Sincroniza gravações /media/frigate/recordings → Hetzner Object Storage S3.
Roda como daemon thread a cada ICV_SYNC_INTERVAL segundos (default 300s / 5min).
"""

import logging
import os
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# ─── Configuration via env vars ───────────────────────────
ICV_S3_BUCKET = os.getenv("ICV_S3_BUCKET", "")
ICV_S3_ENDPOINT = os.getenv("ICV_S3_ENDPOINT", "https://hel1.your-objectstorage.com")
ICV_S3_ACCESS_KEY = os.getenv("ICV_S3_ACCESS_KEY", "")
ICV_S3_SECRET_KEY = os.getenv("ICV_S3_SECRET_KEY", "")
ICV_SYNC_INTERVAL = int(os.getenv("ICV_SYNC_INTERVAL", "300"))  # 5 min default

MEDIA_DIR = "/media/frigate"
RECORDINGS_DIR = os.path.join(MEDIA_DIR, "recordings")
MIN_FILE_AGE_SECONDS = 300  # só faz upload de .mp4 com +5min (já fechados)


class S3SyncService:
    """Serviço daemon que sincroniza gravações locais para Hetzner S3."""

    def __init__(self):
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

        # Verifica se as credenciais estão configuradas
        if not ICV_S3_BUCKET or not ICV_S3_ACCESS_KEY or not ICV_S3_SECRET_KEY:
            self.enabled = False
            logger.info(
                "S3 Sync disabled: ICV_S3_BUCKET / ICV_S3_ACCESS_KEY / ICV_S3_SECRET_KEY not set"
            )
            return

        self.enabled = True
        self._init_client()

    def _init_client(self):
        """Inicializa o client boto3 para Hetzner S3."""
        try:
            import boto3
            from botocore.config import Config as BotoConfig

            self._client = boto3.client(
                "s3",
                endpoint_url=ICV_S3_ENDPOINT,
                aws_access_key_id=ICV_S3_ACCESS_KEY,
                aws_secret_access_key=ICV_S3_SECRET_KEY,
                region_name="hel1",
                config=BotoConfig(signature_version="s3v4"),
            )
            logger.info(
                f"S3 client initialized — bucket={ICV_S3_BUCKET}, endpoint={ICV_S3_ENDPOINT}"
            )
        except ImportError:
            logger.error("boto3 not installed — S3 sync disabled")
            self.enabled = False
        except Exception as e:
            logger.error(f"Failed to init S3 client: {e}")
            self.enabled = False

    def _object_exists(self, key: str) -> bool:
        """Verifica se o objeto já existe no S3 via head_object."""
        try:
            self._client.head_object(Bucket=ICV_S3_BUCKET, Key=key)
            return True
        except self._client.exceptions.ClientError:
            return False
        except Exception:
            return False

    def sync_once(self):
        """Executa uma rodada de sync: escaneia /media/frigate/recordings e faz upload."""
        if not self.enabled:
            return

        if not os.path.isdir(RECORDINGS_DIR):
            logger.debug(f"Recordings dir not found: {RECORDINGS_DIR}")
            return

        now = time.time()
        uploaded = 0
        skipped = 0

        for root, _dirs, files in os.walk(RECORDINGS_DIR):
            for filename in files:
                if not filename.endswith(".mp4"):
                    continue

                filepath = os.path.join(root, filename)

                # Só faz upload de arquivos com mais de 300s de idade (já fechados)
                try:
                    file_age = now - os.path.getmtime(filepath)
                    if file_age < MIN_FILE_AGE_SECONDS:
                        continue
                except OSError:
                    continue

                # S3 key: recordings/{path relativo ao MEDIA_DIR}
                rel_path = os.path.relpath(filepath, MEDIA_DIR)
                s3_key = f"recordings/{rel_path}".replace("\\", "/")

                # Skip se já existe no S3
                if self._object_exists(s3_key):
                    skipped += 1
                    continue

                # Upload
                try:
                    self._client.upload_file(
                        filepath,
                        ICV_S3_BUCKET,
                        s3_key,
                        ExtraArgs={"ContentType": "video/mp4"},
                    )
                    uploaded += 1
                    logger.debug(f"Uploaded: {s3_key}")
                except Exception as e:
                    logger.error(f"Upload failed for {filepath}: {e}")

        if uploaded > 0 or skipped > 0:
            logger.info(f"S3 sync: {uploaded} uploaded, {skipped} already exist")

    def run(self):
        """Loop principal do daemon: sync_once a cada ICV_SYNC_INTERVAL."""
        logger.info(
            f"S3 sync daemon started — interval={ICV_SYNC_INTERVAL}s, bucket={ICV_S3_BUCKET}"
        )

        while not self._stop_event.is_set():
            try:
                self.sync_once()
            except Exception as e:
                logger.error(f"S3 sync cycle error: {e}")

            self._stop_event.wait(timeout=ICV_SYNC_INTERVAL)

        logger.info("S3 sync daemon stopped")

    def start(self):
        """Inicia o daemon thread."""
        if not self.enabled:
            logger.info("S3 sync not enabled — skipping start")
            return

        self._thread = threading.Thread(target=self.run, daemon=True, name="icv-s3-sync")
        self._thread.start()

    def stop(self):
        """Para o daemon."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)


# ─── Singleton ────────────────────────────────────────────
s3_sync_service = S3SyncService()
