#!/usr/bin/env python3
"""Gera assets/ambient.png — a camada de luz de fundo dos slides.

O fundo é rasterizado aqui, e não com radial-gradient em CSS, porque o
exportador de PDF do Chrome reposiciona, reescala e recorta gradientes CSS/SVG
de elementos que sangram fora da página. Uma imagem exporta sempre igual.

Gera em 2× (2560×1440) para ~192 ppi no PDF 16:9 — texto e UI ficam nítidos
em projetor / tela retina.

Sem dependências externas: escreve o PNG direto com zlib + struct.
"""

import math
import os
import struct
import zlib

# Resolução lógica do slide × fator de qualidade
SCALE = 2
W, H = 1280 * SCALE, 720 * SCALE

BASE = (0x06, 0x07, 0x0C)

# Coordenadas no espaço lógico 1280×720; escaladas abaixo
GLOWS = [
    (40, -40, 520, (0x6B, 0x3A, 0xD4), 0.42),
    (1180, 780, 380, (0x2C, 0xC4, 0xCB), 0.20),
    (640, 360, 700, (0x1A, 0x1E, 0x32), 0.18),
    (980, 80, 260, (0x9F, 0x7B, 0xFF), 0.10),
]

BAND_Y = 210
BAND_H = 280
BAND_COLOR = (0x12, 0x14, 0x22)
BAND_PEAK = 0.22

GRID_STEP = 80
GRID_ALPHA = 0.035
GRID_FADE_X, GRID_FADE_Y = 0.88, 0.78


def falloff(t: float) -> float:
    """Queda suave (smootherstep invertido) — evita anel visível na borda."""
    if t >= 1.0:
        return 0.0
    if t <= 0.0:
        return 1.0
    s = 1.0 - t
    return s * s * s * (s * (s * 6 - 15) + 10)


def grid_mask(x: int, y: int) -> float:
    # x,y já em pixels de alta resolução
    dx = (x / W - 0.5) / (GRID_FADE_X / 2)
    dy = (y / H - 0.5) / (GRID_FADE_Y / 2)
    d = math.hypot(dx, dy)
    if d >= 1.0:
        return 0.0
    return 1.0 - d * d


def build() -> bytes:
    s = float(SCALE)
    band_y = BAND_Y * s
    band_h = BAND_H * s
    grid_step = max(1, int(GRID_STEP * s))
    glows = [(cx * s, cy * s, r * s, c, a) for cx, cy, r, c, a in GLOWS]

    rows = []
    for y in range(H):
        row = bytearray()
        row.append(0)  # filtro "none"
        on_grid_y = (y % grid_step) == 0
        by = abs(y - band_y) / band_h
        band_a = BAND_PEAK * falloff(by) if by < 1.0 else 0.0
        for x in range(W):
            r, g, b = float(BASE[0]), float(BASE[1]), float(BASE[2])

            if band_a > 0.0:
                edge = falloff(abs(x - W / 2) / (W * 0.55))
                a = band_a * edge
                r += (BAND_COLOR[0] - r) * a
                g += (BAND_COLOR[1] - g) * a
                b += (BAND_COLOR[2] - b) * a

            for cx, cy, radius, (gr, gg, gb), peak in glows:
                d = math.hypot(x - cx, y - cy)
                if d >= radius:
                    continue
                a = peak * falloff(d / radius)
                if a <= 0.0:
                    continue
                r += (gr - r) * a
                g += (gg - g) * a
                b += (gb - b) * a

            if on_grid_y or (x % grid_step) == 0:
                a = GRID_ALPHA * grid_mask(x, y)
                if a > 0.0:
                    if on_grid_y and (x % grid_step) == 0:
                        a *= 1.6
                    r += (255 - r) * a
                    g += (255 - g) * a
                    b += (255 - b) * a

            # Dither ordenado 4x4: quebra o banding de 8 bits nos degradês.
            t = (((x & 3) * 4 + ((y & 3) ^ ((x & 3) * 2))) & 15) / 16.0 - 0.5
            row += bytes(
                (
                    max(0, min(255, int(r + t + 0.5))),
                    max(0, min(255, int(g + t + 0.5))),
                    max(0, min(255, int(b + t + 0.5))),
                )
            )
        rows.append(bytes(row))
    return b"".join(rows)


def chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "assets")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "ambient.png")

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(build(), 9))
    png += chunk(b"IEND", b"")

    with open(out, "wb") as fh:
        fh.write(png)
    print(f"OK  {out}  ({len(png) / 1024:.0f} KB)  {W}×{H}")


if __name__ == "__main__":
    main()
