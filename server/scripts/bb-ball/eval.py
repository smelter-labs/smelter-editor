#!/usr/bin/env python3
"""Fast offline evaluation of a ball detector against the APIDIS ground truth
(seconds to a minute — the full-pipeline benchmark, scripts/basketball-bench.mjs,
takes the length of the clip).

  V=src/ai-models/people-counter/.venv/bin/python
  $V scripts/bb-ball/eval.py --weights yolo11n.pt --mode worker --cams 7,5,3,6,1      # COCO baseline
  $V scripts/bb-ball/eval.py --weights bb-ball.pt --mode crops --conf 0.1,0.2,0.3     # sweep on the val images
  $V scripts/bb-ball/eval.py --weights bb-ball.pt --mode worker --cams 7 --ball-conf 0.15

crops   batch-predicts the dataset's val images (rim / ball / full crops from
        build_dataset.py) and scores every --conf at once: recall (labelled
        images where a detection lands on the ball), precision (detections
        away from the ball, incl. on negatives), centre error.
worker  decodes val frames from the source AVIs and runs the real
        worker.detect() path (rim crop first, full frame, HSV fallback as
        configured) with the camera's calibrated rim: recall / precision per
        camera, zone recall (frames where the ball is in the above / rim /
        net zones the shot state machine needs), detections by source, ms/frame.

Weights: a name in the scorer dir (yolo11n.pt, bb-ball.pt, …) or a path.
Results go to stdout and --json (default data/bb-train/eval/<weights>-<mode>.json).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.abspath(os.path.join(HERE, "..", ".."))
SCORER = os.path.join(SERVER, "src", "ai-models", "basketball-scorer")
sys.path.insert(0, HERE)
sys.path.insert(0, SCORER)

import apidis  # noqa: E402

COCO_BALL = 32


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--weights", default="bb-ball.pt")
    p.add_argument("--mode", choices=("crops", "worker", "trace"), default="crops")
    p.add_argument("--data", default=os.path.join(SERVER, "data", "bb-train", "apidis"))
    p.add_argument("--data-dir", default=os.path.join(SERVER, "data"))
    p.add_argument("--archive", default=os.environ.get("APIDIS_DIR"), help="worker mode: APIDIS archive root")
    p.add_argument("--cams", default="7,5,3,6,1")
    p.add_argument("--split", default="val")
    p.add_argument("--kinds", default="rim,ball,full", help="crops mode: image kinds")
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--conf", default="0.1,0.2,0.3", help="crops mode: confidences to report")
    p.add_argument("--ball-conf", type=float, default=0.2, help="worker mode: ballConf param")
    p.add_argument("--detector", default="yolo", help="worker mode: ballDetector param (auto|yolo|hsv)")
    p.add_argument("--from-s", type=float, default=200.0, help="worker mode: media window start (val = 200 s)")
    p.add_argument("--to-s", type=float, default=240.0)
    p.add_argument("--every", type=int, default=2, help="worker mode: frame stride")
    p.add_argument("--channels", choices=("rgb", "bgr"), default="rgb", help="worker mode: channel order handed to worker.detect (the side channel delivers RGB)")
    p.add_argument("--rim", default=None, help="worker/trace: override the sidecar rim as cx,cy,rx,ry (normalised)")
    p.add_argument("--mp4", default=None, help="trace: read frames from this clip under data/mp4s instead of the APIDIS AVIs (media time = clip time; no ground truth)")
    p.add_argument("--radius", type=float, default=0.6, help="hit radius in ball-box widths (min 20 px)")
    p.add_argument("--device", default=None)
    p.add_argument("--json", default=None)
    p.add_argument("--limit", type=int, default=0, help="debug: max images / frames per cam")
    return p.parse_args()


def resolve_weights(name: str) -> str:
    return name if os.path.exists(name) else os.path.join(SCORER, name)


def pick_device(explicit):
    if explicit:
        return explicit
    import torch

    if torch.cuda.is_available():
        return "cuda:0"
    return "mps" if torch.backends.mps.is_available() else "cpu"


def hit_radius(box_w: float, radius_boxes: float) -> float:
    return max(20.0, radius_boxes * box_w)


def rim_for(a, cam: int):
    """Sidecar rim of the camera, or the --rim override."""
    from analysis import Rim  # noqa: E402

    if a.rim:
        cx, cy, rx, ry = (float(v) for v in a.rim.split(","))
        return Rim(cx, cy, rx, ry)
    d = apidis.load_sidecar(a.data_dir, cam)["rim"]
    return Rim(d["cx"], d["cy"], d["rx"], d["ry"])


# ── crops mode ───────────────────────────────────────────────────────────────


def eval_crops(a, weights: str, cams: list[int], out: dict) -> None:
    from ultralytics import YOLO

    device = pick_device(a.device)
    model = YOLO(weights)
    ball_cls = 0 if len(model.names) == 1 else COCO_BALL
    confs = sorted(float(c) for c in a.conf.split(","))
    kinds = set(a.kinds.split(","))
    rows = [json.loads(l) for l in open(os.path.join(a.data, "meta.jsonl"), encoding="utf8")]
    rows = [r for r in rows if r["split"] == a.split and r["cam"] in cams and r["kind"] in kinds]
    if a.limit:
        per: Counter = Counter()
        keep = []
        for r in rows:
            if per[r["cam"]] < a.limit:
                keep.append(r)
                per[r["cam"]] += 1
        rows = keep
    stats = json.load(open(os.path.join(a.data, "stats.json"), encoding="utf8"))
    ball_w = {int(c): v["ball_size"][0] for c, v in stats["cams"].items()}
    print(f"crops: {len(rows)} {a.split} images, cams {cams}, kinds {sorted(kinds)}, device {device}, ball class {ball_cls}")

    # per (cam, kind, conf): tp, fn, fp, errors
    agg: dict = defaultdict(lambda: {"tp": 0, "fn": 0, "fp": 0, "err": []})
    t0 = time.time()
    n_pred = 0
    B = 32
    for i in range(0, len(rows), B):
        batch = rows[i : i + B]
        paths = [os.path.join(a.data, r["file"]) for r in batch]
        results = model.predict(paths, imgsz=a.imgsz, conf=confs[0], classes=[ball_cls], verbose=False, device=device)
        n_pred += len(batch)
        for r, res in zip(batch, results):
            dets = []
            b = getattr(res, "boxes", None)
            if b is not None and b.xyxy is not None:
                for k in range(len(b.xyxy)):
                    x1, y1, x2, y2 = (float(v) for v in b.xyxy[k])
                    dets.append(((x1 + x2) / 2, (y1 + y2) / 2, float(b.conf[k])))
            gt = None
            if r["labelled"]:
                gt = ((r["gt_px"][0] - r["x0"]) * r["scale"], (r["gt_px"][1] - r["y0"]) * r["scale"])
            rad = hit_radius(ball_w[r["cam"]] * r["scale"], a.radius)
            for c in confs:
                d = [x for x in dets if x[2] >= c]
                key = (r["cam"], r["kind"], c)
                if gt is None:
                    agg[key]["fp"] += len(d)
                    continue
                near = [(math.hypot(x[0] - gt[0], x[1] - gt[1]), x) for x in d]
                near.sort()
                if near and near[0][0] <= rad:
                    agg[key]["tp"] += 1
                    agg[key]["err"].append(near[0][0] / r["scale"])
                    agg[key]["fp"] += len(near) - 1
                else:
                    agg[key]["fn"] += 1
                    agg[key]["fp"] += len(near)
    dt = time.time() - t0
    print(f"{n_pred} images in {dt:.1f} s ({1000 * dt / max(1, n_pred):.1f} ms/img)\n")
    print(f"{'cam':>4} {'kind':>5} {'conf':>5} {'n':>5} {'recall':>7} {'prec':>6} {'fp':>5} {'err px':>7}")
    table = []
    for cam in cams:
        for kind in sorted(kinds):
            for c in confs:
                s = agg.get((cam, kind, c))
                if not s:
                    continue
                n = s["tp"] + s["fn"]
                rec = s["tp"] / n if n else 0.0
                prec = s["tp"] / (s["tp"] + s["fp"]) if (s["tp"] + s["fp"]) else 0.0
                err = sum(s["err"]) / len(s["err"]) if s["err"] else 0.0
                print(f"{cam:>4} {kind:>5} {c:>5.2f} {n:>5} {rec:>7.3f} {prec:>6.3f} {s['fp']:>5} {err:>7.1f}")
                table.append({"cam": cam, "kind": kind, "conf": c, "n": n, "recall": round(rec, 3), "precision": round(prec, 3), "fp": s["fp"], "err_px": round(err, 1)})
    # totals per conf
    print()
    for c in confs:
        tp = sum(s["tp"] for k, s in agg.items() if k[2] == c)
        fn = sum(s["fn"] for k, s in agg.items() if k[2] == c)
        fp = sum(s["fp"] for k, s in agg.items() if k[2] == c)
        rec = tp / (tp + fn) if tp + fn else 0.0
        prec = tp / (tp + fp) if tp + fp else 0.0
        print(f"ALL conf {c:.2f}: recall {rec:.3f} precision {prec:.3f} (tp {tp} fn {fn} fp {fp})")
        table.append({"cam": "all", "kind": "all", "conf": c, "n": tp + fn, "recall": round(rec, 3), "precision": round(prec, 3), "fp": fp})
    out["rows"] = table
    out["ms_per_image"] = round(1000 * dt / max(1, n_pred), 1)


# ── worker mode ──────────────────────────────────────────────────────────────


def eval_worker(a, weights: str, cams: list[int], out: dict) -> None:
    if not a.archive:
        raise SystemExit("--archive (or APIDIS_DIR) is required in worker mode")
    name = os.path.basename(weights)
    # The worker resolves bare COCO names against its cwd (the scorer dir in
    # production) — mirror that so nothing gets downloaded next to the repo;
    # names outside its allowlist reach it through the env override.
    os.chdir(SCORER)
    os.environ["BASKETBALL_YOLO_WEIGHTS"] = weights
    import numpy as np

    import worker  # noqa: E402  (the scorer's real detection path)
    from analysis import Rim, zone_of  # noqa: E402

    if a.device:
        worker._device = a.device
    stats = json.load(open(os.path.join(a.data, "stats.json"), encoding="utf8"))
    ball_w = {int(c): v["ball_size"][0] for c, v in stats["cams"].items()}
    print(f"worker: weights {name} imgsz {a.imgsz} ballConf {a.ball_conf} detector {a.detector}, media {a.from_s}-{a.to_s} s every {a.every}")
    print(f"{'cam':>4} {'frames':>6} {'gt':>5} {'recall':>7} {'prec':>6} {'zone':>5} {'zrec':>6} {'src':>22} {'ms':>6}")
    rows = []
    for cam in cams:
        rim = rim_for(a, cam)
        params = {
            "ballDetector": a.detector,
            "yoloWeights": name,
            "imgsz": a.imgsz,
            "ballConf": a.ball_conf,
            "rimSet": 1,
            "rimCx": rim.cx,
            "rimCy": rim.cy,
            "rimRx": rim.rx,
            "rimRy": rim.ry,
            "teamColorA": "#62611e",
            "teamColorB": "#151711",
        }
        refs = apidis.frame_refs(a.archive, cam)
        times = [r.utc for r in refs]
        labels, _ = apidis.match_labels(times, apidis.load_centres(a.archive, cam))
        W, H = apidis.FRAME_W, apidis.FRAME_H
        aspect = W / H
        rad = hit_radius(ball_w.get(cam, 32), a.radius)
        prev = None
        misses = 0
        n = gt_n = tp = fp = zone_n = zone_tp = 0
        src: Counter = Counter()
        errs = []
        t_sum = 0.0
        for idx, utc, bgr in apidis.iter_frames(a.archive, cam):
            m = apidis.media_s(utc)
            if m < a.from_s or idx % a.every:
                continue
            if m > a.to_s or (a.limit and n >= a.limit):
                break
            rgb = np.ascontiguousarray(bgr[:, :, ::-1]) if a.channels == "rgb" else bgr
            t0 = time.time()
            det = worker.detect(rgb, params, rim, prev)
            t_sum += time.time() - t0
            n += 1
            ball = det["ball"]
            if ball is not None:
                prev = (ball["x"] + ball["w"] / 2, ball["y"] + ball["h"] / 2)
                misses = 0
                src[det["src"] or "?"] += 1
            else:
                misses += 1
                if misses > 20:
                    prev = None
            gt = labels.get(idx)
            if gt is None:
                if ball is not None:
                    fp += 1
                continue
            gt_n += 1
            in_zone = zone_of(gt[0] / W, gt[1] / H, rim, aspect) != "none"
            zone_n += in_zone
            if ball is not None:
                bx = (ball["x"] + ball["w"] / 2) * W
                by = (ball["y"] + ball["h"] / 2) * H
                d = math.hypot(bx - gt[0], by - gt[1])
                if d <= rad:
                    tp += 1
                    zone_tp += in_zone
                    errs.append(d)
                else:
                    fp += 1
        rec = tp / gt_n if gt_n else 0.0
        prec = tp / (tp + fp) if tp + fp else 0.0
        zrec = zone_tp / zone_n if zone_n else 0.0
        ms = 1000 * t_sum / max(1, n)
        srcs = ",".join(f"{k}={v}" for k, v in src.most_common())
        print(f"{cam:>4} {n:>6} {gt_n:>5} {rec:>7.3f} {prec:>6.3f} {zone_n:>5} {zrec:>6.3f} {srcs:>22} {ms:>6.1f}")
        rows.append({"cam": cam, "frames": n, "gt": gt_n, "tp": tp, "fp": fp, "recall": round(rec, 3), "precision": round(prec, 3), "zone_frames": zone_n, "zone_recall": round(zrec, 3), "src": dict(src), "ms_per_frame": round(ms, 1), "err_px": round(sum(errs) / len(errs), 1) if errs else None})
    tp = sum(r["tp"] for r in rows)
    gt_n = sum(r["gt"] for r in rows)
    fp = sum(r["fp"] for r in rows)
    zn = sum(r["zone_frames"] for r in rows)
    ztp = sum(round(r["zone_recall"] * r["zone_frames"]) for r in rows)
    print(f"ALL: recall {tp / gt_n if gt_n else 0:.3f} precision {tp / (tp + fp) if tp + fp else 0:.3f} zone-recall {ztp / zn if zn else 0:.3f} (gt {gt_n}, zone {zn})")
    out["rows"] = rows


def eval_trace(a, weights: str, cams: list[int], out: dict) -> None:
    """Frame-by-frame: worker.detect → ShotDetector over a media window, next
    to the ground-truth ball centre when the window is inside the labelled
    minutes. Shows why a make does or does not fire."""
    if not a.archive:
        raise SystemExit("--archive (or APIDIS_DIR) is required in trace mode")
    name = os.path.basename(weights)
    os.chdir(SCORER)
    os.environ["BASKETBALL_YOLO_WEIGHTS"] = weights
    import numpy as np

    import worker  # noqa: E402
    from analysis import Rim, ShotDetector, zone_of  # noqa: E402

    W, H = apidis.FRAME_W, apidis.FRAME_H
    aspect = W / H
    cam = cams[0]
    rim = rim_for(a, cam)
    params = {
        "ballDetector": a.detector,
        "yoloWeights": name,
        "imgsz": a.imgsz,
        "ballConf": a.ball_conf,
        "rimSet": 1,
        "rimCx": rim.cx,
        "rimCy": rim.cy,
        "rimRx": rim.rx,
        "rimRy": rim.ry,
        "analysisFps": 25,
        "teamColorA": "#62611e",
        "teamColorB": "#151711",
    }
    if a.mp4:
        import cv2

        def frames_from_mp4():
            cap = cv2.VideoCapture(os.path.join(a.data_dir, "mp4s", a.mp4))
            fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            i = 0
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                yield i, apidis.T0_UTC + i / fps, bgr
                i += 1
            cap.release()

        frame_iter = frames_from_mp4()
        labels = {}
        minutes = (a.mp4,)
    else:
        minutes = apidis.minutes_for(a.from_s, a.to_s)
        refs = apidis.frame_refs(a.archive, cam, minutes)
        times = [r.utc for r in refs]
        try:
            labels, _ = apidis.match_labels(times, apidis.load_centres(a.archive, cam))
        except FileNotFoundError:
            labels = {}
        frame_iter = apidis.iter_frames(a.archive, cam, minutes)
    det = ShotDetector(params, aspect=aspect)
    prev = None
    misses = 0
    rows = []
    print(f"trace cam{cam} {name} media {a.from_s}-{a.to_s} s (minutes {','.join(minutes)}), rim {rim}")
    print(f"{'t':>8} {'det x,y':>13} {'conf':>5} {'src':>4} {'gt x,y':>13} {'zone':>5} {'gtzn':>5} {'state':>8}  events")
    for idx, utc, bgr in frame_iter:
        m = apidis.media_s(utc)
        if m < a.from_s:
            continue
        if m > a.to_s:
            break
        rgb = np.ascontiguousarray(bgr[:, :, ::-1])
        r = worker.detect(rgb, params, rim, prev)
        ball = r["ball"]
        if ball is not None:
            prev = (ball["x"] + ball["w"] / 2, ball["y"] + ball["h"] / 2)
            misses = 0
        else:
            misses += 1
            if misses > 20:
                prev = None
        events = det.observe(m, ball, r["persons"])
        gt = labels.get(idx)
        dx = f"{prev[0]:.3f},{prev[1]:.3f}" if ball is not None else "-"
        gx = f"{gt[0] / W:.3f},{gt[1] / H:.3f}" if gt else "-"
        gz = zone_of(gt[0] / W, gt[1] / H, rim, aspect) if gt else "-"
        ev = " ".join(f"{e['type'].upper()}#{e.get('index')}({e.get('evidence', e.get('result', ''))})" for e in events)
        line = f"{m:8.2f} {dx:>13} {ball['conf'] if ball else 0:5.2f} {(r['src'] or '-'):>4} {gx:>13} {det.zone:>5} {gz:>5} {det.state:>8}  {ev}"
        print(line)
        rows.append({"t": round(m, 3), "ball": ball, "src": r["src"], "gt": gt, "zone": det.zone, "gt_zone": gz, "state": det.state, "events": events})
    out["rows"] = rows


def main() -> int:
    a = parse_args()
    weights = resolve_weights(a.weights)
    if not os.path.exists(weights):
        print(f"weights not found: {weights}", file=sys.stderr)
        return 2
    cams = [int(c) for c in a.cams.split(",") if c.strip()]
    out = {"weights": weights, "mode": a.mode, "args": vars(a)}
    # Resolve before the worker modes chdir into the scorer dir.
    path = os.path.abspath(a.json) if a.json else os.path.join(SERVER, "data", "bb-train", "eval", f"{os.path.basename(weights).replace('.pt', '')}-{a.mode}.json")
    if a.mode == "crops":
        eval_crops(a, weights, cams, out)
    elif a.mode == "trace":
        eval_trace(a, weights, cams, out)
    else:
        eval_worker(a, weights, cams, out)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        json.dump(out, f, indent=1)
    print(f"json: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
