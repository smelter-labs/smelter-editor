#!/usr/bin/env python3
"""
Away-team positions for the football minimap → `away.json`.

Only the home side wears ZXY tags in the Alfheim dataset, so the away side is
read off the panorama: tiled person detection over the pitch band → foot
point unprojected to pitch metres (camera model from the folder's zones.json)
→ jersey colour → tracks in metres → the tracks wearing the away colour.

Kit colours are calibrated from the clip itself: detections standing on a
ZXY tag are the home side (colour A); the dominant colour of everyone else is
the away side (colour B). Referees / ball boys fall out as "other"; an
"other" track that lives in a penalty area away from every home tag is kept
as the away goalkeeper.

  V=src/ai-models/people-counter/.venv/bin/python
  $V scripts/fb-away-detect.py --clip data/mp4s/fb-demo/pano-anzhi-goal/pano.mp4 \
      [--hz 5] [--weights src/ai-models/basketball-scorer/yolo11m.pt] \
      [--dets-cache /tmp/dets.json] [--debug-overlay /tmp/away.mp4]

Writes <clip folder>/away.json on the clip's media clock (same grid as
zxy.json: sample i ↔ i·1000/hz ms). Pano clips only — tricam has no camera
model. `--dets-cache` keeps the raw detections so colour / tracker knobs can
be re-run without the model.
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fb_away_lib as lib  # noqa: E402

TILE_OVERLAP = 0.2
NMS_IOU = 0.45
OUT_HZ = 10


def load_home(zxy: dict):
    """zxy.json → home_at(t_ms) -> [(x, y), …]."""
    hz = zxy.get("hz", 10)
    tags = zxy.get("tags", [])

    def home_at(t_ms: float):
        i = int(round(t_ms / (1000.0 / hz)))
        out = []
        for tag in tags:
            xs, ys = tag.get("x", []), tag.get("y", [])
            if 0 <= i < len(xs) and xs[i] is not None and ys[i] is not None:
                if lib.on_pitch(xs[i], ys[i], 1):
                    out.append((xs[i], ys[i]))
        return out

    return home_at


def detect(args, p, pano_w, pano_h, fps):
    """Raw detections per sampled frame: [{t, boxes: [[x1,y1,x2,y2,conf,r,g,b]…]}]."""
    import cv2
    from ultralytics import YOLO
    import torch

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    model = YOLO(args.weights)
    cap = cv2.VideoCapture(args.clip)
    if not cap.isOpened():
        sys.exit(f"cannot open {args.clip}")
    sx = cap.get(cv2.CAP_PROP_FRAME_WIDTH) / pano_w  # clip may be a downscale of the pano
    y1, y2 = lib.pitch_band(p, pano_w, pano_h)
    by1, by2 = int(y1 * sx), int(y2 * sx)
    band_h = by2 - by1
    band_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    cols = max(1, math.ceil(band_w / (band_h * 1.3 * (1 - TILE_OVERLAP))))
    tiles = list(lib.iter_tiles(band_w, band_h, cols, 1, TILE_OVERLAP))
    stride = max(1, round(fps / args.hz))
    print(f"[away] {device} · band y {y1}..{y2} · {cols} tiles {tiles[0][2]-tiles[0][0]}x{band_h} · every {stride} frames")

    frames = []
    idx = -1
    t0 = time.time()
    while True:
        ok = cap.grab()
        if not ok:
            break
        idx += 1
        if idx % stride:
            continue
        ok, frame = cap.retrieve()
        if not ok:
            break
        band = frame[by1:by2]
        crops = [band[ty1:ty2, tx1:tx2] for tx1, ty1, tx2, ty2 in tiles]
        results = model.predict(crops, imgsz=args.imgsz, conf=args.conf, classes=[0], device=device, verbose=False)
        rows = []
        for (tx1, ty1, _, _), r in zip(tiles, results):
            if r.boxes is None or len(r.boxes) == 0:
                continue
            xyxy = np.asarray(r.boxes.xyxy.tolist(), dtype=np.float32)
            conf = np.asarray(r.boxes.conf.tolist(), dtype=np.float32)
            xyxy[:, [0, 2]] += tx1
            xyxy[:, [1, 3]] += ty1 + by1
            rows.append(np.concatenate([xyxy, conf[:, None]], axis=1))
        boxes = []
        if rows:
            all_ = np.concatenate(rows)
            for k in lib.nms(all_[:, :4], all_[:, 4], NMS_IOU):
                x1b, y1b, x2b, y2b, c = (float(v) for v in all_[k])
                w, h = x2b - x1b, y2b - y1b
                # jersey band: rows 20-55 %, columns 25-75 % of the person box
                px1, px2 = int(x1b + w * 0.25), int(math.ceil(x1b + w * 0.75))
                py1, py2 = int(y1b + h * 0.20), int(math.ceil(y1b + h * 0.55))
                patch = frame[max(0, py1):py2, max(0, px1):px2, ::-1]
                rgb = lib.jersey_color(patch) if patch.size else None
                boxes.append([round(x1b / sx, 1), round(y1b / sx, 1), round(x2b / sx, 1), round(y2b / sx, 1),
                              round(c, 3), *(rgb or (-1, -1, -1))])
        frames.append({"t": round(idx * 1000.0 / fps, 1), "boxes": boxes})
        if len(frames) % 50 == 0:
            print(f"[away] {len(frames)} frames · {frames[-1]['t']/1000:.0f}s · {time.time()-t0:.0f}s elapsed", flush=True)
    cap.release()
    return frames


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", required=True)
    ap.add_argument("--hz", type=float, default=5, help="detection rate (frames per second of clip)")
    ap.add_argument("--weights", default="src/ai-models/basketball-scorer/yolo11m.pt")
    ap.add_argument("--imgsz", type=int, default=960)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--tag-radius", type=float, default=2.5, help="metres: detection on a ZXY tag = home")
    ap.add_argument("--color-max", type=float, default=0.25, help="hsv distance beyond which a jersey is 'other'")
    ap.add_argument("--max-box-h", type=float, default=260, help="pano px: taller boxes are crowd / staff close to the camera")
    ap.add_argument("--dets-cache")
    ap.add_argument("--debug-overlay")
    ap.add_argument("--out")
    args = ap.parse_args()

    folder = os.path.dirname(os.path.abspath(args.clip))
    base = os.path.splitext(args.clip)[0]
    zones = json.load(open(os.path.join(folder, "zones.json")))
    if not zones.get("camera"):
        sys.exit("zones.json has no camera model (tricam?) — away detection needs a panorama")
    meta = json.load(open(base + ".alfheim.json")) if os.path.exists(base + ".alfheim.json") else {}
    zxy_path = os.path.join(folder, "zxy.json")
    zxy = json.load(open(zxy_path)) if os.path.exists(zxy_path) else {"tags": []}
    home_at = load_home(zxy)
    p = lib.camera_params(zones["camera"])
    pano_w, pano_h = zones["pano"]["w"], zones["pano"]["h"]
    fps = float(meta.get("fps") or 25)

    if args.dets_cache and os.path.exists(args.dets_cache):
        frames = json.load(open(args.dets_cache))
        print(f"[away] {len(frames)} frames from {args.dets_cache}")
    else:
        frames = detect(args, p, pano_w, pano_h, fps)
        if args.dets_cache:
            json.dump(frames, open(args.dets_cache, "w"))

    # 1. foot point → metres
    unproject = lib.Unprojector(p)
    band_bottom = lib.pitch_band(p, pano_w, pano_h)[1]
    per_frame: list[list[lib.Det]] = []
    for fr in frames:
        dets = []
        for x1, y1, x2, y2, conf, r, g, b in fr["boxes"]:
            # a box cut by the band's bottom edge is a spectator's head, not feet on grass
            if y2 - y1 > args.max_box_h or y2 >= band_bottom - 8:
                continue
            X, Y = unproject((x1 + x2) / 2, y2)
            if not lib.on_pitch(X, Y, 1):
                continue
            dets.append(lib.Det(fr["t"], X, Y, rgb=None if r < 0 else (r, g, b), box=(x1, y1, x2, y2)))
        per_frame.append(dets)

    # 2. kit colours from the clip: on a ZXY tag = home, the rest's dominant colour = away
    home_rgb, rest_rgb, home_dist = [], [], []
    for dets in per_frame:
        if not dets:
            continue
        tags = home_at(dets[0].t)
        for d in dets:
            if d.rgb is None:
                continue
            near = min((math.hypot(d.x - hx, d.y - hy) for hx, hy in tags), default=99.0)
            if near <= args.tag_radius:
                home_rgb.append(d.rgb)
                home_dist.append(near)
            elif near > args.tag_radius * 2:
                rest_rgb.append(d.rgb)
    color_a = lib.dominant_color(home_rgb)
    if color_a:
        ha = lib.rgb_to_hsv(color_a)
        rest_rgb = [c for c in rest_rgb if lib.hsv_distance(lib.rgb_to_hsv(c), ha) > 0.2]
    color_b = lib.dominant_color(rest_rgb)
    if not color_b:
        sys.exit("no away-coloured detections — nothing to write")
    print(f"[away] kit A {lib.to_hex(color_a) if color_a else '—'} ({len(home_rgb)} samples, "
          f"median {np.median(home_dist) if home_dist else float('nan'):.2f} m to the ZXY tag) · "
          f"kit B {lib.to_hex(color_b)} ({len(rest_rgb)} samples)")

    # 3. classify + track
    tracker = lib.MetricTracker()
    for fr, dets in zip(frames, per_frame):
        for d in dets:
            d.cls = lib.classify(d.rgb, color_a, color_b, args.color_max)
        tracker.update(dets, fr["t"])
    tracks = tracker.finish()
    away = lib.select_away(tracks, home_at)
    labels = {"A": 0, "B": 0, "O": 0}
    for tr in tracks:
        labels[tr.label()] += 1
    print(f"[away] tracks {len(tracks)} (A {labels['A']} · B {labels['B']} · other {labels['O']}) → away {len(away)}")

    # 4. resample → away.json
    duration_ms = float(zxy.get("durationMs") or (frames[-1]["t"] if frames else 0))
    n = math.ceil(duration_ms / (1000 / OUT_HZ)) + 1
    xy = [lib.resample(tr, OUT_HZ, n) for tr in away]
    lib.cap_per_sample(xy, [len(tr.dets) for tr in away], 11)
    out_tracks = []
    for tr, (xs, ys) in zip(away, xy):
        fix = [i for i, v in enumerate(xs) if v is not None]
        if not fix:
            continue
        out_tracks.append({"id": len(out_tracks) + 1, "firstMs": fix[0] * 1000 // OUT_HZ,
                           "lastMs": fix[-1] * 1000 // OUT_HZ, "x": xs, "y": ys})
    counts = [sum(1 for t in out_tracks if t["x"][i] is not None) for i in range(n)]
    print(f"[away] away players per sample: mean {np.mean(counts):.1f} · min {min(counts)} · max {max(counts)}")
    out = {
        "t0Utc": zxy.get("t0Utc", meta.get("t0Utc")),
        "hz": OUT_HZ,
        "durationMs": duration_ms,
        "team": meta.get("awayTeam") or "AWAY",
        "pitch": {"length": lib.PITCH_L, "width": lib.PITCH_W},
        "frame": "pano",
        "source": f"{os.path.basename(args.weights)}+jersey",
        "colors": {"A": lib.to_hex(color_a) if color_a else None, "B": lib.to_hex(color_b)},
        "tracks": out_tracks,
    }
    out_path = args.out or os.path.join(folder, "away.json")
    json.dump(out, open(out_path, "w"), separators=(",", ":"))
    print(f"[away] → {out_path} ({len(out_tracks)} tracks, {os.path.getsize(out_path)//1024} KB)")

    if args.debug_overlay:
        write_overlay(args, frames, per_frame, {id(d) for tr in away for d in tr.dets}, pano_w, p, pano_h)


def write_overlay(args, frames, per_frame, away_ids, pano_w, p, pano_h):
    """Half-size video of the pitch band: A red, B blue (thick = published as away), other grey."""
    import cv2

    cap = cv2.VideoCapture(args.clip)
    sx = cap.get(cv2.CAP_PROP_FRAME_WIDTH) / pano_w
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    y1, y2 = lib.pitch_band(p, pano_w, pano_h)
    by1, by2 = int(y1 * sx), int(y2 * sx)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) // 2
    h = (by2 - by1) // 2
    vw = cv2.VideoWriter(args.debug_overlay, cv2.VideoWriter_fourcc(*"mp4v"), args.hz, (w, h))
    colors = {"A": (60, 60, 255), "B": (255, 140, 0), "O": (160, 160, 160)}
    by_t = {fr["t"]: dets for fr, dets in zip(frames, per_frame)}
    idx = -1
    while True:
        ok = cap.grab()
        if not ok:
            break
        idx += 1
        t = round(idx * 1000.0 / fps, 1)
        if t not in by_t:
            continue
        ok, frame = cap.retrieve()
        if not ok:
            break
        for d in by_t[t]:
            x1, yy1, x2, yy2 = (int(v * sx) for v in d.box)
            thick = 4 if id(d) in away_ids else 1
            cv2.rectangle(frame, (x1, yy1), (x2, yy2), colors[d.cls], thick)
        vw.write(cv2.resize(frame[by1:by2], (w, h)))
    vw.release()
    cap.release()
    print(f"[away] overlay → {args.debug_overlay}")


if __name__ == "__main__":
    main()
