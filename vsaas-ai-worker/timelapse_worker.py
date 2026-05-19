"""
Timelapse Worker — processa TimelapseJobs criados pelo timelapse-scheduler.

Fluxo por job:
  1. GET  /timelapse/worker/jobs          → pega lista PENDING
  2. POST /timelapse/worker/jobs/:id/claim → reserva o job (PROCESSING)
  3. GET  /timelapse/worker/jobs/:id/segments → presigned URLs de segmentos + PUT URL output
  4. Download de cada segmento .ts via HTTP
  5. Concatenação + speed-up com ffmpeg
  6. Thumbnail com ffmpeg
  7. Upload do .mp4 e .jpg via HTTP PUT (presigned)
  8. POST /timelapse/worker/jobs/:id/complete ou /fail

Dependências externas:
  - ffmpeg no PATH (incluído na imagem Docker)
  - requests (já no requirements.txt)

Tolerâncias:
  - job sem segmentos → fail retryable=False (sem dados pra gerar)
  - ffmpeg erro       → fail retryable=True (tentará de novo até MAX_ATTEMPTS no backend)
  - upload PUT falha  → fail retryable=True
"""

import logging
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import requests

from config import (
    BACKEND_URL, AI_WORKER_SECRET,
    TIMELAPSE_ENABLED, TIMELAPSE_POLL_SEC, TIMELAPSE_TMP_DIR,
)

logger = logging.getLogger(__name__)

_session = requests.Session()
_session.headers.update({"Authorization": f"Bearer {AI_WORKER_SECRET}"})


# ─── API helpers ──────────────────────────────────────────────────────────────

def _api_get(path: str, **kwargs):
    return _session.get(f"{BACKEND_URL}{path}", timeout=15, **kwargs)

def _api_post(path: str, **kwargs):
    return _session.post(f"{BACKEND_URL}{path}", timeout=15, **kwargs)


def _fetch_pending_jobs() -> list[dict]:
    try:
        r = _api_get("/timelapse/worker/jobs")
        r.raise_for_status()
        return r.json().get("jobs", [])
    except Exception as e:
        logger.warning("timelapse_fetch_jobs_failed err=%s", e)
        return []


def _claim_job(job_id: str) -> bool:
    try:
        r = _api_post(f"/timelapse/worker/jobs/{job_id}/claim")
        r.raise_for_status()
        data = r.json()
        return data.get("ok", False)
    except Exception as e:
        logger.warning("timelapse_claim_failed job=%s err=%s", job_id, e)
        return False


def _get_segments(job_id: str) -> dict | None:
    try:
        r = _api_get(f"/timelapse/worker/jobs/{job_id}/segments")
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning("timelapse_segments_failed job=%s err=%s", job_id, e)
        return None


def _complete_job(job_id: str, output_key: str, thumb_key: str | None, duration_sec: float, file_size: int):
    try:
        _api_post(f"/timelapse/worker/jobs/{job_id}/complete", json={
            "outputPath":    output_key,
            "thumbnailPath": thumb_key,
            "durationSec":   duration_sec,
            "fileSizeBytes": file_size,
        }).raise_for_status()
    except Exception as e:
        logger.error("timelapse_complete_report_failed job=%s err=%s", job_id, e)


def _fail_job(job_id: str, error: str, retryable: bool = True):
    try:
        _api_post(f"/timelapse/worker/jobs/{job_id}/fail", json={
            "errorMessage": error,
            "retryable":    retryable,
        }).raise_for_status()
    except Exception as e:
        logger.error("timelapse_fail_report_failed job=%s err=%s", job_id, e)


# ─── Download helpers ─────────────────────────────────────────────────────────

def _download_segment(url: str, dest_path: str) -> bool:
    try:
        r = requests.get(url, timeout=60, stream=True)
        r.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                f.write(chunk)
        return True
    except Exception as e:
        logger.warning("timelapse_segment_download_failed err=%s", e)
        return False


def _upload_file(url: str, file_path: str, content_type: str) -> bool:
    try:
        with open(file_path, "rb") as f:
            r = requests.put(url, data=f, headers={"Content-Type": content_type}, timeout=120)
        r.raise_for_status()
        return True
    except Exception as e:
        logger.warning("timelapse_upload_failed err=%s", e)
        return False


# ─── ffmpeg pipeline ──────────────────────────────────────────────────────────

def _run_ffmpeg(args: list[str]) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error"] + args,
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode != 0:
            return False, result.stderr[:2000]
        return True, ""
    except subprocess.TimeoutExpired:
        return False, "ffmpeg timeout (>10min)"
    except FileNotFoundError:
        return False, "ffmpeg not found in PATH"


def _build_timelapse(
    segment_paths: list[str],
    output_path: str,
    speed_factor: float,
    resolution: str,
) -> tuple[bool, str]:
    """
    1. Cria concat.txt com todos os .ts
    2. Concatena com ffmpeg (sem re-encode, codec copy)
    3. Speed-up com setpts + scale
    """
    concat_file = output_path + ".concat.txt"
    raw_concat  = output_path + ".raw.mp4"
    thumb_path  = output_path.replace(".mp4", "-thumb.jpg")

    try:
        with open(concat_file, "w") as f:
            for p in segment_paths:
                f.write(f"file '{p}'\n")

        # Etapa 1: concat sem re-encode
        ok, err = _run_ffmpeg([
            "-f", "concat", "-safe", "0",
            "-i", concat_file,
            "-c", "copy",
            raw_concat,
        ])
        if not ok:
            return False, f"concat_failed: {err}"

        # Etapa 2: speed-up + scale + encode output
        pts = f"PTS/{speed_factor}"
        w, h = resolution.split("x") if "x" in resolution else ("1280", "720")
        ok, err = _run_ffmpeg([
            "-i", raw_concat,
            "-vf", f"setpts={pts},scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2",
            "-an",                          # sem áudio (RTSP .ts pode ter áudio inválido)
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "28",
            "-movflags", "+faststart",
            output_path,
        ])
        if not ok:
            return False, f"speedup_failed: {err}"

        # Etapa 3: thumbnail (frame no segundo 1)
        _run_ffmpeg([
            "-i", output_path,
            "-ss", "00:00:01",
            "-frames:v", "1",
            "-q:v", "5",
            thumb_path,
        ])

        return True, thumb_path

    finally:
        for f in [concat_file, raw_concat]:
            try: os.unlink(f)
            except Exception: pass


# ─── Job processor ────────────────────────────────────────────────────────────

def _process_job(job: dict) -> None:
    job_id      = job["id"]
    camera_name = job.get("camera", {}).get("name", job_id[:8])
    speed       = float(job.get("speedFactor") or 20)
    resolution  = job.get("resolution") or "1280x720"

    logger.info("timelapse_job_start id=%s camera=%s speed=%.0fx", job_id, camera_name, speed)

    # Claim
    if not _claim_job(job_id):
        logger.info("timelapse_job_skip_claim id=%s", job_id)
        return

    # Segmentos
    seg_data = _get_segments(job_id)
    if not seg_data:
        _fail_job(job_id, "Falha ao buscar segmentos do backend", retryable=True)
        return

    segments = seg_data.get("segments", [])
    if not segments:
        _fail_job(job_id, "Nenhum segmento de gravação encontrado para o período", retryable=False)
        logger.warning("timelapse_no_segments id=%s camera=%s", job_id, camera_name)
        return

    output_url = seg_data.get("outputUploadUrl")
    thumb_url  = seg_data.get("thumbUploadUrl")
    output_key = seg_data.get("outputKey", "")
    thumb_key  = seg_data.get("thumbKey")

    if not output_url:
        _fail_job(job_id, "R2 não disponível — presigned PUT URL não gerada", retryable=True)
        return

    # Filtra segmentos sem URL
    downloadable = [s for s in segments if s.get("url")]
    if not downloadable:
        _fail_job(job_id, "Nenhum segmento com URL de download disponível", retryable=True)
        return

    logger.info("timelapse_download_start id=%s segments=%d", job_id, len(downloadable))

    with tempfile.TemporaryDirectory(dir=TIMELAPSE_TMP_DIR, prefix=f"tlp-{job_id[:8]}-") as tmp:
        # Download segmentos
        seg_paths = []
        failed_downloads = 0
        for i, seg in enumerate(downloadable):
            dest = os.path.join(tmp, f"seg_{i:05d}.ts")
            if _download_segment(seg["url"], dest):
                seg_paths.append(dest)
            else:
                failed_downloads += 1

        if not seg_paths:
            _fail_job(job_id, f"Todos os {len(downloadable)} downloads falharam", retryable=True)
            return

        if failed_downloads > 0:
            logger.warning(
                "timelapse_partial_download id=%s ok=%d fail=%d",
                job_id, len(seg_paths), failed_downloads,
            )

        output_mp4 = os.path.join(tmp, "timelapse.mp4")

        # ffmpeg
        ok, result = _build_timelapse(seg_paths, output_mp4, speed, resolution)
        if not ok:
            _fail_job(job_id, result, retryable=True)
            logger.error("timelapse_ffmpeg_failed id=%s err=%s", job_id, result)
            return

        thumb_path = result  # _build_timelapse retorna thumb_path on success
        file_size  = os.path.getsize(output_mp4)

        # Duração real do output
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", output_mp4],
                capture_output=True, text=True, timeout=30,
            )
            duration_sec = float(probe.stdout.strip())
        except Exception:
            duration_sec = file_size / (256_000 / 8)  # estimativa grosseira

        # Upload .mp4
        if not _upload_file(output_url, output_mp4, "video/mp4"):
            _fail_job(job_id, "Upload do .mp4 para R2 falhou", retryable=True)
            return

        # Upload thumbnail (best-effort)
        thumb_uploaded = False
        if thumb_url and os.path.exists(thumb_path):
            thumb_uploaded = _upload_file(thumb_url, thumb_path, "image/jpeg")

        _complete_job(
            job_id,
            output_key=output_key,
            thumb_key=thumb_key if thumb_uploaded else None,
            duration_sec=round(duration_sec, 2),
            file_size=file_size,
        )

        logger.info(
            "timelapse_job_done id=%s camera=%s duration=%.1fs size=%dMB segs=%d",
            job_id, camera_name, duration_sec, file_size // 1_048_576, len(seg_paths),
        )


# ─── Worker thread ────────────────────────────────────────────────────────────

class TimelapseWorker(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="timelapse-worker")
        self._stop = threading.Event()

    def stop(self):
        self._stop.set()

    def run(self):
        logger.info("timelapse_worker_started poll_sec=%d tmp=%s", TIMELAPSE_POLL_SEC, TIMELAPSE_TMP_DIR)
        os.makedirs(TIMELAPSE_TMP_DIR, exist_ok=True)

        while not self._stop.is_set():
            try:
                jobs = _fetch_pending_jobs()
                if jobs:
                    logger.info("timelapse_tick pending=%d", len(jobs))
                    for job in jobs:
                        if self._stop.is_set():
                            break
                        try:
                            _process_job(job)
                        except Exception as e:
                            logger.error("timelapse_job_unhandled id=%s err=%s", job.get("id"), e, exc_info=True)
                            try:
                                _fail_job(job.get("id", "unknown"), str(e), retryable=True)
                            except Exception:
                                pass
            except Exception as e:
                logger.error("timelapse_tick_error err=%s", e, exc_info=True)

            self._stop.wait(TIMELAPSE_POLL_SEC)

        logger.info("timelapse_worker_stopped")
