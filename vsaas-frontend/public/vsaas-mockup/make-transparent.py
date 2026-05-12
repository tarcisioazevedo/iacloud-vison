#!/usr/bin/env python3
"""
make-transparent.py — Remove fundo navy do logo VSaaS (PNG/JPG original).

Uso:
    python3 make-transparent.py <input.png> [output.png]

Lógica:
    - Lê o arquivo original
    - Converte para RGBA
    - Para cada pixel, calcula "distância" da cor de fundo (navy ~#011118 / #001017)
    - Pixels muito próximos do fundo → alpha=0 (transparente)
    - Pixels claros (logo) → mantém RGB, alpha=255
    - Borda suave (anti-aliasing): alpha proporcional à distância

Default output: <input>-transparent.png
"""
import sys, os
from PIL import Image

BG_NAVY = (1, 17, 24)         # cor de fundo VSaaS
TOLERANCE_FULL = 28           # distância <= este valor → 100% transparente
TOLERANCE_FADE = 90           # entre full e fade → alpha proporcional
LUMINANCE_MIN  = 55           # se luminância < este valor (próximo do navy), fade

def color_dist(a, b):
    return max(abs(a[0]-b[0]), abs(a[1]-b[1]), abs(a[2]-b[2]))

def main():
    if len(sys.argv) < 2:
        print("uso: make-transparent.py <input.png|jpg> [output.png]")
        sys.exit(1)

    src = sys.argv[1]
    if not os.path.exists(src):
        print(f"arquivo não encontrado: {src}")
        sys.exit(2)

    base, _ = os.path.splitext(src)
    dst = sys.argv[2] if len(sys.argv) > 2 else f"{base}-transparent.png"

    img = Image.open(src).convert("RGBA")
    px = img.load()
    w, h = img.size

    changed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            d = color_dist((r, g, b), BG_NAVY)
            lum = (r * 30 + g * 59 + b * 11) // 100

            if d <= TOLERANCE_FULL:
                # quase navy puro → transparente total
                px[x, y] = (r, g, b, 0)
                changed += 1
            elif d <= TOLERANCE_FADE and lum < LUMINANCE_MIN:
                # navy-ish mas com leve cor → fade proporcional
                alpha = int(255 * (d - TOLERANCE_FULL) / (TOLERANCE_FADE - TOLERANCE_FULL))
                px[x, y] = (r, g, b, alpha)
                changed += 1
            # senão mantém intacto (parte colorida do logo)

    img.save(dst, "PNG", optimize=True)
    print(f"✓ Gerado: {dst}")
    print(f"  Pixels com transparência aplicada: {changed:,} / {w*h:,} ({100*changed/(w*h):.1f}%)")
    print(f"  Tamanho: {w}x{h}")

if __name__ == "__main__":
    main()
