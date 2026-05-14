"""
Re-ID Extractor — extrai embedding de aparência de um crop de pessoa.

Modelo: MobileNetV3-Small (torchvision, já presente nas deps do ultralytics).
  • 576-dim features → zero-padded para 768 (match pgvector column).
  • L2-normalizado: distância cosseno = 1 - dot product.
  • ~2ms por crop em CPU (Intel Xeon E-2136 @ 3.3 GHz).
  • Sem GPU necessária — o tracker roda 3 fps, embedding é por track (1x).

Uso:
  extractor = ReidExtractor()
  emb = extractor.extract(frame_bgr, (bx, by, bw, bh))  # bbox norm 0-1
  # emb: list[float] com 768 elementos, None se crop muito pequeno
"""

import logging
from typing import Optional

import cv2
import numpy as np
import torch
import torch.nn as nn
import torchvision.transforms as T
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

logger = logging.getLogger(__name__)

# Dimensão final — deve bater com vector(768) do pgvector
EMBED_DIM = 768
# MobileNetV3-Small features dim (antes do classificador)
_BACKBONE_DIM = 576

# Tamanho padrão Re-ID (H x W) — 2:1 ratio captura corpo inteiro
_REID_H = 256
_REID_W = 128

# Crop mínimo viável (pixels absolutos) — menor que isso é ruído
_MIN_CROP_PX = 16


class ReidExtractor:
    """
    Extrai embedding de aparência de crops de pessoa.

    Thread-safety: uma instância por processo (torch + numpy são thread-safe
    em inferência). Não compartilhar instâncias entre processos.
    """

    def __init__(self) -> None:
        weights = MobileNet_V3_Small_Weights.IMAGENET1K_V1
        base = mobilenet_v3_small(weights=weights)

        # Remove classificador; mantém features + global average pool
        self._model: nn.Module = nn.Sequential(
            base.features,
            base.avgpool,
            nn.Flatten(1),  # → (batch, 576)
        )
        self._model.eval()

        # Mesmas normalização do ImageNet que o backbone usou no treino
        self._transform = T.Compose([
            T.ToTensor(),
            T.Resize((_REID_H, _REID_W), antialias=True),
            T.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ])

        logger.info(
            "reid_extractor_ready backbone=mobilenet_v3_small embed_dim=%d",
            EMBED_DIM,
        )

    def extract(
        self,
        frame: np.ndarray,
        bbox_norm: tuple,
    ) -> Optional[list]:
        """
        Extrai embedding L2-normalizado de um crop de pessoa.

        Args:
            frame: BGR frame completo (np.ndarray HxWx3).
            bbox_norm: (x, y, w, h) normalizados 0-1.

        Returns:
            list[float] com EMBED_DIM elementos ou None se crop inválido.
        """
        try:
            crop = self._crop(frame, bbox_norm)
            if crop is None:
                return None

            # BGR → RGB para torchvision
            crop_rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
            tensor = self._transform(crop_rgb).unsqueeze(0)  # [1, C, H, W]

            with torch.no_grad():
                feat = self._model(tensor)  # [1, 576]

            feat_np = feat[0].cpu().numpy().astype(np.float32)  # (576,)

            # Zero-pad para EMBED_DIM (576 → 768)
            padded = np.zeros(EMBED_DIM, dtype=np.float32)
            padded[:_BACKBONE_DIM] = feat_np

            # L2 normalize — distância cosseno = 1 - dot product
            norm = float(np.linalg.norm(padded))
            if norm > 1e-8:
                padded /= norm

            return padded.tolist()

        except Exception as exc:
            logger.warning("reid_extract_failed err=%s", exc)
            return None

    def _crop(
        self,
        frame: np.ndarray,
        bbox_norm: tuple,
    ) -> Optional[np.ndarray]:
        """Recorta e valida crop. None = crop inválido."""
        h, w = frame.shape[:2]
        bx, by, bw, bh = bbox_norm

        x1 = max(0, int(bx * w))
        y1 = max(0, int(by * h))
        x2 = min(w, int((bx + bw) * w))
        y2 = min(h, int((by + bh) * h))

        if (x2 - x1) < _MIN_CROP_PX or (y2 - y1) < _MIN_CROP_PX:
            return None

        return frame[y1:y2, x1:x2]
