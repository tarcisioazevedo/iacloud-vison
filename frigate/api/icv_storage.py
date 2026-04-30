"""
IA Cloud Vision — S3 Storage API
Endpoint para consultar status do armazenamento S3 na Hetzner.
"""

import logging
import os

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from frigate.api.auth import allow_any_authenticated
from frigate.api.defs.tags import Tags

logger = logging.getLogger(__name__)

router = APIRouter(tags=[Tags.recordings])


@router.get("/icv/storage/s3", dependencies=[Depends(allow_any_authenticated())])
def get_s3_storage_status():
    """Retorna status do armazenamento S3 (Hetzner Object Storage)."""
    from frigate.s3_sync import (
        ICV_S3_BUCKET,
        ICV_S3_ENDPOINT,
        ICV_TENANT_SLUG,
        s3_sync_service,
    )

    # Se S3 não está habilitado
    if not s3_sync_service.enabled:
        return JSONResponse(
            content={
                "enabled": False,
                "bucket": "",
                "endpoint": "",
                "tenant": ICV_TENANT_SLUG,
                "status": "disabled",
                "message": "S3 sync não configurado. Verifique ICV_S3_BUCKET, ICV_S3_ACCESS_KEY e ICV_S3_SECRET_KEY.",
            }
        )

    # Consultar uso do bucket
    try:
        client = s3_sync_service._client
        bucket = ICV_S3_BUCKET

        # Listar objetos para calcular tamanho total
        total_size = 0
        total_objects = 0
        paginator = client.get_paginator("list_objects_v2")

        for page in paginator.paginate(Bucket=bucket, Prefix=ICV_TENANT_SLUG or ""):
            for obj in page.get("Contents", []):
                total_size += obj.get("Size", 0)
                total_objects += 1

        # Converter para MB
        total_size_mb = total_size / (1024 * 1024)

        # Quota (Hetzner Object Storage planos)
        # Free: 250 GB, BX11: 1 TB, etc.
        # Usamos 250GB como default — pode ser configurado via env
        quota_gb = int(os.getenv("ICV_S3_QUOTA_GB", "250"))
        quota_mb = quota_gb * 1024
        usage_percent = (total_size_mb / quota_mb * 100) if quota_mb > 0 else 0

        return JSONResponse(
            content={
                "enabled": True,
                "bucket": bucket,
                "endpoint": ICV_S3_ENDPOINT,
                "tenant": ICV_TENANT_SLUG,
                "status": "connected",
                "storage": {
                    "used_bytes": total_size,
                    "used_mb": round(total_size_mb, 2),
                    "total_mb": quota_mb,
                    "quota_gb": quota_gb,
                    "usage_percent": round(usage_percent, 2),
                    "objects_count": total_objects,
                },
            }
        )
    except Exception as e:
        logger.error(f"Failed to get S3 storage status: {e}")
        return JSONResponse(
            content={
                "enabled": True,
                "bucket": ICV_S3_BUCKET,
                "endpoint": ICV_S3_ENDPOINT,
                "tenant": ICV_TENANT_SLUG,
                "status": "error",
                "message": f"Erro ao consultar S3: {str(e)[:200]}",
                "storage": {
                    "used_bytes": 0,
                    "used_mb": 0,
                    "total_mb": 0,
                    "quota_gb": 0,
                    "usage_percent": 0,
                    "objects_count": 0,
                },
            }
        )
