#!/usr/bin/env python3
"""Nearest-neighbor upscale the Duck Hunt sprites.

Smelter only bilinear-scales registered images (no nearest/pixelated sampler),
so a 36px sprite drawn at ~200px comes out blurry. Pre-scaling each sprite up by
a large integer factor means Smelter *down*-samples a crisp image on screen
instead of up-sampling a tiny one, which keeps the pixels sharp.

Reads imgs/ducks/duck-*.png and writes NEAREST-upscaled copies (same filenames)
to imgs/ducks-hi/. Aspect ratio is preserved (integer scale on both axes).

Re-run after regenerating the source sprites:
    src/ai-models/people-counter/.venv/bin/python scripts/upscale-ducks.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

# 36px -> 576px: comfortably larger than any on-screen duck, so Smelter always
# downscales (sharp) rather than upscales (blurry).
SCALE = 16

SERVER_DIR = Path(__file__).resolve().parent.parent
SRC = SERVER_DIR / "imgs" / "ducks"
DST = SERVER_DIR / "imgs" / "ducks-hi"


def main() -> None:
    pngs = sorted(SRC.glob("duck-*.png"))
    if not pngs:
        raise SystemExit(f"no duck sprites found in {SRC}")
    DST.mkdir(parents=True, exist_ok=True)
    for src in pngs:
        img = Image.open(src).convert("RGBA")
        big = img.resize(
            (img.width * SCALE, img.height * SCALE), Image.Resampling.NEAREST
        )
        big.save(DST / src.name)
        print(f"{src.name}: {img.width}x{img.height} -> {big.width}x{big.height}")
    print(f"wrote {len(pngs)} sprites to {DST}")


if __name__ == "__main__":
    main()
