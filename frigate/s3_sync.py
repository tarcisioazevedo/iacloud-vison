"""
IA Cloud Vision — S3 Sync Service
Sincroniza gravações /media/frigate/recordings → Hetzner Object Storage S3.
Roda como daemon thread a cada ICV_SYNC_INTERVAL segundos (default 300s / 5min).
Reporta resultados ao Portal via POST /api/vision/events/sync.
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

# Portal reporting
ICV_PORTAL_URL = os.getenv("ICV_PORTAL_URL", "")
ICV_LICENSE_KEY = os.getenv("ICV_LICENSE_KEY", "")

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
            import urllib.parse
            from botocore.config import Config as BotoConfig

            parsed_url = urllib.parse.urlparse(ICV_S3_ENDPOINT)
            hostname = parsed_url.hostname if parsed_url.hostname else ICV_S3_ENDPOINT
            dynamic_region = hostname.split('.')[0] if hostname else "hel1"

            self._client = boto3.client(
                "s3",
                endpoint_url=ICV_S3_ENDPOINT,
                aws_access_key_id=ICV_S3_ACCESS_KEY,
                aws_secret_access_key=ICV_S3_SECRET_KEY,
                region_name=dynamic_region,
                config=BotoConfig(signature_version="s3v4"),
            )
            logger.info(
                f"S3 client initialized — bucket={ICV_S3_BUCKET}, endpoint={ICV_S3_ENDPOINT}, region={dynamic_region}"
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

    def _get_file_size_mb(self, filepath: str) -> float:
        """Retorna tamanho do arquivo em MB."""
        try:
            return os.path.getsize(filepath) / (1024 * 1024)
        except OSError:
            return 0.0

    def _report_to_portal(self, event_data: dict):
        """Reporta resultado do sync ao Portal via API."""
        if not ICV_PORTAL_URL or not ICV_LICENSE_KEY:
            return

        try:
            import requests
            url = f"{ICV_PORTAL_URL}/api/vision/events/sync"
            headers = {
                "Authorization": f"Bearer {ICV_LICENSE_KEY}",
                "Content-Type": "application/json",
            }
            resp = requests.post(url, json=event_data, headers=headers, timeout=10)
            if resp.status_code == 201:
                logger.debug("Sync event reported to portal")
            else:
                logger.warning(f"Portal report failed: {resp.status_code} {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"Failed to report sync event to portal: {e}")

    def sync_once(self):
        """Executa uma rodada de sync: escaneia /media/frigate/recordings e faz upload."""
        if not self.enabled:
            return

        if not os.path.isdir(RECORDINGS_DIR):
            logger.debug(f"Recordings dir not found: {RECORDINGS_DIR}")
            return

        start_time = time.time()
        now = start_time
        uploaded = 0
        skipped = 0
        failed = 0
        bytes_uploaded = 0.0
        errors = []

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
                file_size = self._get_file_size_mb(filepath)
                try:
                    self._client.upload_file(
                        filepath,
                        ICV_S3_BUCKET,
                        s3_key,
                        ExtraArgs={"ContentType": "video/mp4"},
                    )
                    uploaded += 1
                    bytes_uploaded += file_size
                    logger.debug(f"Uploaded: {s3_key} ({file_size:.1f} MB)")
                except Exception as e:
                    failed += 1
                    errors.append(f"{filename}: {str(e)[:100]}")
                    logger.error(f"Upload failed for {filepath}: {e}")

        duration_ms = int((time.time() - start_time) * 1000)

        # Loga resultado
        if uploaded > 0 or skipped > 0 or failed > 0:
            logger.info(
                f"S3 sync: {uploaded} uploaded ({bytes_uploaded:.1f} MB), "
                f"{skipped} already exist, {failed} failed — {duration_ms}ms"
            )

        # Reporta ao portal
        if uploaded > 0 or failed > 0:
            event_type = "SYNC_ERROR" if failed > 0 and uploaded == 0 else "SYNC_OK"
            
            if failed > 0 and uploaded > 0:
                message = f"Sync parcial: {uploaded} enviados, {failed} falharam"
            elif failed > 0:
                message = f"Sync falhou: {failed} arquivos com erro"
            else:
                message = f"Backup sincronizado: {uploaded} gravações ({bytes_uploaded:.1f} MB)"

            self._report_to_portal({
                "type": event_type,
                "message": message,
                "files_uploaded": uploaded,
                "files_skipped": skipped,
                "files_failed": failed,
                "bytes_uploaded": round(bytes_uploaded, 2),
                "duration_ms": duration_ms,
                "metadata": {"errors": errors[:5]} if errors else None,
            })
        elif skipped > 0:
            # Reporta que está tudo em dia (a cada 6 ciclos = ~30min)
            if not hasattr(self, '_idle_counter'):
                self._idle_counter = 0
            self._idle_counter += 1
            if self._idle_counter >= 6:
                self._idle_counter = 0
                self._report_to_portal({
                    "type": "SYNC_OK",
                    "message": f"Backup em dia: {skipped} gravações já sincronizadas",
                    "files_uploaded": 0,
                    "files_skipped": skipped,
                    "files_failed": 0,
                    "bytes_uploaded": 0,
                    "duration_ms": duration_ms,
                })

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
                # Reporta erros de sistema ao portal
                self._report_to_portal({
                    "type": "SYSTEM_ERROR",
                    "message": f"Erro no ciclo de sync: {str(e)[:200]}",
                    "files_uploaded": 0,
                    "files_skipped": 0,
                    "files_failed": 0,
                    "bytes_uploaded": 0,
                    "duration_ms": 0,
                    "metadata": {"error": str(e)},
                })

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
