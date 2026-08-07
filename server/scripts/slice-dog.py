#!/usr/bin/env python3
"""Slice the Duck Hunt dog "got two" pose out of the reference sprite sheet.

`workshops/duck_hunt_sprites_dog.png` is the full NES Duck Hunt sprite sheet
on a sky-blue background. The Duck Hunter game shows this dog — holding two
ducks — whenever a player bags two in a row. We cut just that pose, key out the
blue background to transparency, and (like the ducks) also emit a NEAREST-upscaled
copy so Smelter downsamples a crisp image instead of blurring a tiny one.

Writes imgs/dog/dog-catch.png and imgs/dog-hi/dog-catch.png.

Run with the same venv as scripts/upscale-ducks.py:
    src/ai-models/people-counter/.venv/bin/python scripts/slice-dog.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

# 36px ducks upscale ×16; the dog is ~40px, keep the same factor for parity.
SCALE = 16

# Bounding box of the "got two" dog (two ducks in raised paws) on the sheet,
# found by keying out the blue background — see scripts/slice-dog analysis.
# Left edge starts at the x44-47 gap between frames; starting any further left
# picks up the beak/feet of the neighboring "GOT ONE!" frame's duck.
CROP = (44, 264, 108, 304)  # left, top, right, bottom

# Sky-blue sheet background; the dog/ducks contain no blue, so keying it is safe.
BG = np.array([99, 173, 255])
BG_TOL = 60  # sum-of-abs-channel distance under which a pixel is "background"

SERVER_DIR = Path(__file__).resolve().parent.parent
SHEET = SERVER_DIR.parent / "workshops" / "duck_hunt_sprites_dog.png"
DST = SERVER_DIR / "imgs" / "dog"
DST_HI = SERVER_DIR / "imgs" / "dog-hi"


def main() -> None:
    if not SHEET.exists():
        raise SystemExit(f"sprite sheet not found: {SHEET}")
    sheet = Image.open(SHEET).convert("RGBA")
    crop = sheet.crop(CROP)

    # Key out the blue background: any near-BG pixel becomes fully transparent.
    a = np.array(crop)
    dist = np.abs(a[:, :, :3].astype(int) - BG).sum(axis=2)
    a[dist < BG_TOL, 3] = 0
    keyed = Image.fromarray(a, "RGBA")

    # Trim fully-transparent margins so the sprite is tightly framed.
    bbox = keyed.getbbox()
    if bbox:
        keyed = keyed.crop(bbox)

    DST.mkdir(parents=True, exist_ok=True)
    DST_HI.mkdir(parents=True, exist_ok=True)
    keyed.save(DST / "dog-catch.png")
    big = keyed.resize(
        (keyed.width * SCALE, keyed.height * SCALE), Image.Resampling.NEAREST
    )
    big.save(DST_HI / "dog-catch.png")
    print(f"dog-catch: {keyed.width}x{keyed.height} -> {big.width}x{big.height}")


if __name__ == "__main__":
    main()
