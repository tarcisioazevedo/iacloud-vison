"""
IA Cloud Vision — License Validator (Heartbeat)
Faz heartbeat a cada 1h para o IA Cloud Portal validar a licença.
Se o portal estiver offline, mantém o estado anterior (tolerante a falha).
"""

import logging
import os
import threading

import requests

logger = logging.getLogger(__name__)

# ─── Configuration via env vars ───────────────────────────
ICV_PORTAL_URL = os.getenv("ICV_PORTAL_URL", "")
ICV_LICENSE_KEY = os.getenv("ICV_LICENSE_KEY", "")
ICV_TENANT_SLUG = os.getenv("ICV_TENANT_SLUG", "")

HEARTBEAT_INTERVAL = 3600  # 1 hora


class LicenseValidator:
    """Valida licença via heartbeat periódico ao IA Cloud Portal."""

    def __init__(self):
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self.valid = False

        if not ICV_PORTAL_URL or not ICV_LICENSE_KEY or not ICV_TENANT_SLUG:
            logger.info(
                "License validation disabled: ICV_PORTAL_URL / ICV_LICENSE_KEY / ICV_TENANT_SLUG not set"
            )
            return

    def _check(self):
        """Faz POST para o portal validando a licença."""
        if not ICV_PORTAL_URL or not ICV_LICENSE_KEY:
            return

        url = f"{ICV_PORTAL_URL}/api/vision/license/heartbeat"

        try:
            response = requests.post(
                url,
                json={"tenant": ICV_TENANT_SLUG},
                headers={
                    "Authorization": f"Bearer {ICV_LICENSE_KEY}",
                    "Content-Type": "application/json",
                },
                timeout=30,
            )

            if response.status_code == 200:
                self.valid = True
                logger.info("License heartbeat OK — valid")
            else:
                self.valid = False
                logger.warning(
                    f"License heartbeat failed — HTTP {response.status_code}: "
                    f"{response.text[:200]}"
                )

        except requests.exceptions.Timeout:
            # Tolerante a falha temporária — mantém estado anterior
            logger.warning("License heartbeat timeout — keeping previous state")

        except requests.exceptions.ConnectionError:
            # Tolerante a falha de rede — mantém estado anterior
            logger.warning("License heartbeat connection error — keeping previous state")

        except Exception as e:
            logger.error(f"License heartbeat exception: {e}")

    def start(self):
        """Inicia o daemon thread de heartbeat."""
        if not ICV_PORTAL_URL or not ICV_LICENSE_KEY:
            logger.info("License validator not configured — skipping start")
            return

        self._thread = threading.Thread(
            target=self._run, daemon=True, name="icv-license"
        )
        self._thread.start()
        logger.info("License heartbeat daemon started")

    def _run(self):
        """Loop: check imediato + a cada HEARTBEAT_INTERVAL."""
        self._check()

        while not self._stop_event.is_set():
            self._stop_event.wait(timeout=HEARTBEAT_INTERVAL)
            if not self._stop_event.is_set():
                self._check()

        logger.info("License heartbeat daemon stopped")

    def stop(self):
        """Para o daemon."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)


# ─── Singleton ────────────────────────────────────────────
license_validator = LicenseValidator()
