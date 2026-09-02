#!/usr/bin/env python3
"""Slice the Duck Hunt dog poses out of the reference sprite sheet.

`workshops/duck_hunt_sprites_dog.png` is the full NES Duck Hunt sprite sheet on
a sky-blue background. We cut the poses the game uses, key out the blue to
transparency, and (like the ducks) also emit a NEAREST-upscaled copy so Smelter
downsamples a crisp image instead of blurring a tiny one.

Poses:
  dog-catch        the "got two" celebration (two ducks in raised paws)
  dog-laugh-0/1    the laugh, from the "LMFAO" row — the shootable taunt
  dog-yelp         front-on open mouth, the instant the taunt dog is shot
  dog-shot         head back, legs dangling — the falling pose
  dog-tally        head-only crop of the laugh, the scoreboard tally icon

Writes imgs/dog/<name>.png and imgs/dog-hi/<name>.png.

Run with the same venv as scripts/upscale-ducks.py:
    src/ai-models/people-counter/.venv/bin/python scripts/slice-dog.py
Pass --preview to also write a contact sheet to /tmp for eyeballing the crops.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

# 36px ducks upscale ×16; the dog is ~40px, keep the same factor for parity.
SCALE = 16

# Frame crops, found by keying out the blue background and scanning for runs of
# fully transparent rows/columns (the frames are NOT on a uniform grid).
#
# Two traps this table encodes:
#  * Neighbouring frames nearly touch — the "got two" crop starts in the x44-47
#    gap because any further left picks up the beak/feet of "GOT ONE!".
#  * The sheet's caption text is BLACK, so the chroma key does not remove it.
#    Every crop must stop short of the next caption: the laugh sprites end at
#    row 359 and "THE DAY DOGS FLEW" starts at row 361, so the bottom is 360,
#    not the 362 a naive read of the row band would give.
#
# (name, (left, top, right, bottom), upscale factor)
FRAMES: list[tuple[str, tuple[int, int, int, int], int]] = [
    ("dog-catch", (44, 264, 108, 304), SCALE),
    ("dog-laugh-0", (2, 318, 31, 360), SCALE),
    ("dog-laugh-1", (33, 318, 63, 360), SCALE),
    ("dog-yelp", (93, 370, 115, 415), SCALE),
    ("dog-shot", (0, 370, 20, 415), SCALE),
    # The tally icon is the only sprite drawn SMALLER than its source (~26px in
    # the scoreboard), so a ×16 copy would just alias on the way back down. A
    # modest ×4 keeps a usable hi copy without pretending it will be magnified;
    # smelter.tsx deliberately registers this one from the 1× directory.
    ("dog-tally", (2, 318, 31, 348), 4),
]

# Sky-blue sheet background; the dog/ducks contain no blue, so keying it is safe.
BG = np.array([99, 173, 255])
BG_TOL = 60  # sum-of-abs-channel distance under which a pixel is "background"

SERVER_DIR = Path(__file__).resolve().parent.parent
SHEET = SERVER_DIR.parent / "workshops" / "duck_hunt_sprites_dog.png"
DST = SERVER_DIR / "imgs" / "dog"
DST_HI = SERVER_DIR / "imgs" / "dog-hi"


def slice_frame(sheet: Image.Image, crop: tuple[int, int, int, int]) -> Image.Image:
    """Crop, key the blue background to transparent, and trim empty margins."""
    a = np.array(sheet.crop(crop))
    dist = np.abs(a[:, :, :3].astype(int) - BG).sum(axis=2)
    a[dist < BG_TOL, 3] = 0
    keyed = Image.fromarray(a, "RGBA")
    bbox = keyed.getbbox()
    return keyed.crop(bbox) if bbox else keyed


def main() -> None:
    if not SHEET.exists():
        raise SystemExit(f"sprite sheet not found: {SHEET}")
    sheet = Image.open(SHEET).convert("RGBA")
    DST.mkdir(parents=True, exist_ok=True)
    DST_HI.mkdir(parents=True, exist_ok=True)

    cut: list[tuple[str, Image.Image]] = []
    for name, crop, scale in FRAMES:
        frame = slice_frame(sheet, crop)
        frame.save(DST / f"{name}.png")
        big = frame.resize(
            (frame.width * scale, frame.height * scale), Image.Resampling.NEAREST
        )
        big.save(DST_HI / f"{name}.png")
        cut.append((name, frame))
        # The sprite dimensions are the source of DOG_POSE_ASPECT in dogTaunt.ts.
        print(f"{name}: {frame.width}x{frame.height} -> {big.width}x{big.height}")

    if "--preview" in sys.argv:
        pad, zoom = 12, 6
        cells = [
            f.resize((f.width * zoom, f.height * zoom), Image.Resampling.NEAREST)
            for _, f in cut
        ]
        sheet_w = sum(c.width + pad for c in cells) + pad
        sheet_h = max(c.height for c in cells) + pad * 2
        contact = Image.new("RGBA", (sheet_w, sheet_h), (11, 17, 28, 255))
        x = pad
        for c in cells:
            contact.paste(c, (x, pad), c)
            x += c.width + pad
        out = Path("/tmp/dog-frames.png")
        contact.save(out)
        print(f"preview: {out}")


if __name__ == "__main__":
    main()
