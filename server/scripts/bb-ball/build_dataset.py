#!/usr/bin/env python3
"""Export the APIDIS ball labels as a single-class YOLO dataset for the
basketball-scorer fine-tune (scripts/bb-ball/train.py).

Three kinds of training images per camera, all cut from the SOURCE AVIs (the
converted 25 fps mp4s duplicate frames, which would slip labels by up to a
frame):
  rim   the worker's rim crop (analysis.rim_crop_box — same rule at inference),
        labelled when the ball is inside it, otherwise an empty label
        (negative: net, backboard, hands, no ball);
  ball  a crop of the same side centred near the ball (jittered), anywhere on
        the court — general ball appearance at native scale;
  full  the whole frame downscaled to --full-width (the worker's full-frame
        pass at imgsz 640 sees the ball at ~15 px).
Box size = the modal ball box of that camera in objects.xml (the centre comes
from the 3-minute ground truth). Split by media time: val = ≥ --val-from-s,
train = ≤ val-from − gap; the benchmark uses ≥ 240 s, outside both.

  V=src/ai-models/people-counter/.venv/bin/python
  $V scripts/bb-ball/build_dataset.py --archive ~/…/pzpn/archive --cams 7,5,3,6,1 \
       --out data/bb-train/apidis --preview 20

Writes images/{train,val}/cam7_f001234_rim.jpg + labels/…txt, data.yaml,
meta.jsonl (one line per image: crop origin/scale + ground truth in source px)
and stats.json. Dataset licence: non-commercial research only.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.abspath(os.path.join(HERE, "..", ".."))
SCORER = os.path.join(SERVER, "src", "ai-models", "basketball-scorer")
sys.path.insert(0, HERE)
sys.path.insert(0, SCORER)

import apidis  # noqa: E402
from analysis import Rim, rim_crop_box  # noqa: E402


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--archive", default=os.environ.get("APIDIS_DIR"), help="APIDIS archive root")
    p.add_argument("--cams", default="7,5,3,6,1")
    p.add_argument("--out", default=os.path.join(SERVER, "data", "bb-train", "apidis"))
    p.add_argument("--data-dir", default=os.path.join(SERVER, "data"), help="server/data (sidecars)")
    p.add_argument("--val-from-s", type=float, default=200.0, help="media time from which frames are val")
    p.add_argument("--val-gap-s", type=float, default=2.0, help="frames within this gap before val are dropped")
    p.add_argument("--val-cam", type=int, default=None, help="hold out a whole camera as val instead")
    p.add_argument("--rim-stride", type=int, default=1)
    p.add_argument("--ball-stride", type=int, default=2)
    p.add_argument("--full-stride", type=int, default=4)
    p.add_argument("--neg-ratio", type=float, default=1.0, help="rim negatives per rim positive")
    p.add_argument("--drop-occluded-cams", default="3,5", help="drop centres inside a player box (propagated labels)")
    p.add_argument("--full-width", type=int, default=1280)
    p.add_argument("--jpeg-quality", type=int, default=92)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--preview", type=int, default=0, help="draw N random labelled images into out/preview")
    p.add_argument("--limit-frames", type=int, default=0, help="debug: stop after N source frames per cam")
    p.add_argument(
        "--enhance",
        default=None,
        help="apply a look to every frame before cropping, as ffmpeg-eq-style 'gamma=1.25:contrast=1.2:saturation=1.25' "
        "(build a second dataset with the look the demo clips get, so the detector learns both)",
    )
    return p.parse_args()


def parse_enhance(spec: str) -> dict:
    out = {"gamma": 1.0, "contrast": 1.0, "brightness": 0.0, "saturation": 1.0}
    for part in spec.split(":"):
        if not part.strip():
            continue
        k, v = part.split("=")
        out[k.strip()] = float(v)
    return out


def enhance_frame(bgr, e: dict):
    """ffmpeg `eq` in its own space: contrast / brightness / gamma on luma,
    chroma scaled by saturation (BT.601, limited-range luma like libavfilter).
    Verified against `ffmpeg -vf eq=…` at ~1 level mean difference."""
    import cv2
    import numpy as np

    yuv = cv2.cvtColor(bgr, cv2.COLOR_BGR2YUV).astype(np.float32)
    y = yuv[:, :, 0] / 255.0
    # libavfilter eq: luma LUT = pow(clip((v - 0.5) * contrast + 0.5 + brightness), 1 / gamma)
    y = (y - 0.5) * e["contrast"] + 0.5 + e["brightness"]
    y = np.clip(y, 0.0, 1.0)
    if e["gamma"] != 1.0:
        y = np.power(y, 1.0 / e["gamma"])
    yuv[:, :, 0] = y * 255.0
    if e["saturation"] != 1.0:
        yuv[:, :, 1:] = (yuv[:, :, 1:] - 128.0) * e["saturation"] + 128.0
    return cv2.cvtColor(np.clip(yuv, 0, 255).astype(np.uint8), cv2.COLOR_YUV2BGR)


def split_of(media: float, cam: int, a) -> str | None:
    if a.val_cam is not None:
        return "val" if cam == a.val_cam else "train"
    if media >= a.val_from_s:
        return "val"
    if media <= a.val_from_s - a.val_gap_s:
        return "train"
    return None


def yolo_line(cx: float, cy: float, w: float, h: float, side_w: float, side_h: float) -> str:
    return f"0 {cx / side_w:.6f} {cy / side_h:.6f} {w / side_w:.6f} {h / side_h:.6f}\n"


def main() -> int:
    a = parse_args()
    if not a.archive:
        print("--archive (or APIDIS_DIR) is required", file=sys.stderr)
        return 2
    import cv2

    rng = random.Random(a.seed)
    cams = [int(c) for c in a.cams.split(",") if c.strip()]
    drop_occluded = {int(c) for c in a.drop_occluded_cams.split(",") if c.strip()}
    for split in ("train", "val"):
        os.makedirs(os.path.join(a.out, "images", split), exist_ok=True)
        os.makedirs(os.path.join(a.out, "labels", split), exist_ok=True)
    meta_path = os.path.join(a.out, "meta.jsonl")
    meta = open(meta_path, "w", encoding="utf8")
    stats: dict = {"cams": {}, "images": Counter(), "args": vars(a)}
    W, H = apidis.FRAME_W, apidis.FRAME_H
    t_start = time.time()

    for cam in cams:
        refs = apidis.frame_refs(a.archive, cam)
        times = [r.utc for r in refs]
        centres = apidis.load_centres(a.archive, cam)
        labels, unmatched = apidis.match_labels(times, centres)
        objs = apidis.load_objects(a.archive, cam)
        bw, bh = objs.ball_size
        side_rim = apidis.load_sidecar(a.data_dir, cam)["rim"]
        rim = Rim(side_rim["cx"], side_rim["cy"], side_rim["rx"], side_rim["ry"])
        x0, y0, side = rim_crop_box(rim, W, H)

        dropped = 0
        if cam in drop_occluded:
            for idx in list(labels):
                t_xml = apidis.nearest_time(objs.times, times[idx], 0.002)
                if t_xml is None:
                    continue
                x, y = labels[idx]
                if any(apidis.inside(b, x, y) for b in objs.frames[t_xml].get("player", [])):
                    del labels[idx]
                    dropped += 1

        # ── decide which frames become which images (labels only, no decoding)
        plan: dict[int, list[tuple[str, str]]] = defaultdict(list)  # idx → [(kind, split)]
        rim_pos: dict[str, list[int]] = defaultdict(list)
        rim_neg: dict[str, list[int]] = defaultdict(list)
        counts: Counter = Counter()
        for idx, ref in enumerate(refs):
            if a.limit_frames and idx >= a.limit_frames:
                break
            split = split_of(apidis.media_s(ref.utc), cam, a)
            if split is None:
                continue
            lab = labels.get(idx)
            in_crop = (
                lab is not None
                and x0 + bw * 0.4 <= lab[0] <= x0 + side - bw * 0.4
                and y0 + bh * 0.4 <= lab[1] <= y0 + side - bh * 0.4
            )
            if idx % a.rim_stride == 0:
                (rim_pos if in_crop else rim_neg)[split].append(idx)
            if lab is not None:
                if idx % a.ball_stride == 0:
                    plan[idx].append(("ball", split))
                if idx % a.full_stride == 0:
                    plan[idx].append(("full", split))
        for split in ("train", "val"):
            for idx in rim_pos[split]:
                plan[idx].append(("rim", split))
            negs = rim_neg[split]
            keep = min(len(negs), int(round(a.neg_ratio * len(rim_pos[split]))))
            for idx in rng.sample(negs, keep):
                plan[idx].append(("rim", split))

        # ── decode + write
        written = 0
        enh = parse_enhance(a.enhance) if a.enhance else None
        for idx, utc, bgr in apidis.iter_frames(a.archive, cam):
            if a.limit_frames and idx >= a.limit_frames:
                break
            jobs = plan.get(idx)
            if not jobs:
                continue
            if enh:
                bgr = enhance_frame(bgr, enh)
            lab = labels.get(idx)
            for kind, split in jobs:
                name = f"cam{cam}_f{idx:06d}_{kind}"
                if kind == "rim":
                    cx0, cy0, s = x0, y0, side
                    img = bgr[cy0 : cy0 + s, cx0 : cx0 + s]
                    scale = 1.0
                elif kind == "ball":
                    s = side
                    jx = rng.uniform(-0.4, 0.4) * s
                    jy = rng.uniform(-0.4, 0.4) * s
                    cx0 = int(max(0, min(W - s, lab[0] + jx - s / 2)))
                    cy0 = int(max(0, min(H - s, lab[1] + jy - s / 2)))
                    img = bgr[cy0 : cy0 + s, cx0 : cx0 + s]
                    scale = 1.0
                else:  # full
                    cx0, cy0 = 0, 0
                    scale = a.full_width / W
                    img = cv2.resize(bgr, (a.full_width, int(round(H * scale))), interpolation=cv2.INTER_AREA)
                    s = None
                ih, iw = img.shape[:2]
                line = ""
                if lab is not None:
                    lx = (lab[0] - cx0) * scale
                    ly = (lab[1] - cy0) * scale
                    lw, lh = bw * scale, bh * scale
                    # keep the label when at least ~60 % of the box is inside the image
                    if -lw * 0.4 <= lx - lw / 2 and lx + lw / 2 <= iw + lw * 0.4 and -lh * 0.4 <= ly - lh / 2 and ly + lh / 2 <= ih + lh * 0.4:
                        lx = min(max(lx, lw / 2), iw - lw / 2)
                        ly = min(max(ly, lh / 2), ih - lh / 2)
                        line = yolo_line(lx, ly, lw, lh, iw, ih)
                cv2.imwrite(
                    os.path.join(a.out, "images", split, name + ".jpg"),
                    img,
                    [cv2.IMWRITE_JPEG_QUALITY, a.jpeg_quality],
                )
                with open(os.path.join(a.out, "labels", split, name + ".txt"), "w", encoding="utf8") as f:
                    f.write(line)
                meta.write(
                    json.dumps(
                        {
                            "file": f"images/{split}/{name}.jpg",
                            "cam": cam,
                            "frame": idx,
                            "utc": round(utc, 3),
                            "media_s": round(apidis.media_s(utc), 3),
                            "kind": kind,
                            "split": split,
                            "x0": cx0,
                            "y0": cy0,
                            "scale": scale,
                            "w": iw,
                            "h": ih,
                            "gt_px": [round(lab[0], 1), round(lab[1], 1)] if lab else None,
                            "labelled": bool(line),
                        }
                    )
                    + "\n"
                )
                counts[(kind, split, "pos" if line else "neg")] += 1
                stats["images"][f"{kind}/{split}/{'pos' if line else 'neg'}"] += 1
                written += 1
        stats["cams"][cam] = {
            "frames": len(refs),
            "centres": len(centres),
            "matched": len(labels) + dropped,
            "unmatched": unmatched,
            "dropped_occluded": dropped,
            "ball_size": [bw, bh],
            "rim": side_rim,
            "crop": {"x0": x0, "y0": y0, "side": side},
            "images": {f"{k}/{s}/{p}": n for (k, s, p), n in sorted(counts.items())},
        }
        print(
            f"cam{cam}: {len(refs)} frames, {len(centres)} centres ({unmatched} unmatched, {dropped} occluded dropped), "
            f"ball {bw}x{bh}, crop {x0},{y0}+{side} → {written} images "
            f"[{time.time() - t_start:.0f} s]",
            flush=True,
        )

    meta.close()
    with open(os.path.join(a.out, "data.yaml"), "w", encoding="utf8") as f:
        f.write(
            f"path: {os.path.abspath(a.out)}\ntrain: images/train\nval: images/val\nnames:\n  0: ball\n"
        )
    stats["images"] = dict(stats["images"])
    stats["seconds"] = round(time.time() - t_start, 1)
    with open(os.path.join(a.out, "stats.json"), "w", encoding="utf8") as f:
        json.dump(stats, f, indent=2)
    print(json.dumps(stats["images"], indent=1))

    if a.preview:
        pdir = os.path.join(a.out, "preview")
        os.makedirs(pdir, exist_ok=True)
        rows = [json.loads(l) for l in open(meta_path, encoding="utf8")]
        rows = [r for r in rows if r["labelled"]]
        for r in rng.sample(rows, min(a.preview, len(rows))):
            img = cv2.imread(os.path.join(a.out, r["file"]))
            lab = os.path.join(a.out, r["file"].replace("images/", "labels/").replace(".jpg", ".txt"))
            for line in open(lab, encoding="utf8"):
                _, cx, cy, w, h = (float(v) for v in line.split())
                ih, iw = img.shape[:2]
                cv2.rectangle(
                    img,
                    (int((cx - w / 2) * iw), int((cy - h / 2) * ih)),
                    (int((cx + w / 2) * iw), int((cy + h / 2) * ih)),
                    (0, 255, 0),
                    2,
                )
            cv2.imwrite(os.path.join(pdir, os.path.basename(r["file"])), img)
        print(f"preview: {pdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
