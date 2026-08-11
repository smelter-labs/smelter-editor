#!/usr/bin/env python3
"""Offline probe for the marker source: run it on the exported mp4 and see what
the detector sees, without a server, a room or a side channel in the way.

    .venv/bin/python3 marker_probe.py /path/to/clip.mp4
    .venv/bin/python3 marker_probe.py clip.mp4 --tolerance 0.35 --color green
    .venv/bin/python3 marker_probe.py clip.mp4 --dump-frame 120 --out /tmp/f.png

It calls the very same _marker_detect() the worker calls, so a clip that probes
clean and still shows nothing on the output is a wiring problem, not a keying
one — which is exactly the split that is impossible to make from the overlay.
"""

from __future__ import annotations

import argparse
import sys

import cv2
import numpy as np

import worker


def probe(path: str, params: dict, every: int, limit: int) -> int:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        print(f"Cannot open {path}", file=sys.stderr)
        return 2

    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    print(f"{path}: {w}x{h}, {fps:.2f} fps, {total} frames")
    print(f"params: {params}\n")

    idx = 0
    checked = 0
    hits: list[tuple[int, int]] = []
    peak_overall = 0
    peak_dominance = _peak_probe(params)

    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        if idx % every == 0:
            rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)
            n, boxes = worker._marker_detect(rgba, params, None)
            peak = peak_dominance(rgba)
            peak_overall = max(peak_overall, peak)
            checked += 1
            if n:
                hits.append((idx, n))
                t = idx / fps if fps else 0.0
                coords = " ".join(
                    f"[{b['x']:.3f},{b['y']:.3f} {b['w']:.3f}x{b['h']:.3f}]"
                    for b in boxes[:6]
                )
                print(f"  frame {idx:6d}  t={t:7.2f}s  {n} marker(s)  {coords}")
        idx += 1
        if limit and idx >= limit:
            break
    cap.release()

    print(f"\nchecked {checked} frame(s); {len(hits)} had markers")
    if hits:
        counts = [n for _, n in hits]
        gaps = [b[0] - a[0] for a, b in zip(hits, hits[1:])]
        print(f"  markers per hit: min {min(counts)}, max {max(counts)}")
        if gaps and fps:
            worst = max(gaps) / fps
            print(f"  largest gap between marked frames: {worst:.2f}s")
            print(
                f"  -> set 'Marker hold' to at least {worst + 0.3:.1f}s "
                "so the boxes survive between them"
            )
        return 0

    print(f"  peak colour dominance across the clip: {peak_overall}")
    thresh = worker._marker_threshold(float(params.get("tolerance", 0.22)))
    print(f"  current threshold: {thresh}")
    if peak_overall <= thresh:
        need = worker._marker_tolerance_for(peak_overall)
        print(
            "  -> the marker colour was NOT found. Either 'Marker color' is "
            f"wrong, or raise 'Colour tolerance' to about {need:.2f} "
            "(and check the rectangles are pure, unblended, full opacity)."
        )
    else:
        print(
            "  -> the colour IS present but every shape was rejected. Check "
            "'Min/Max marker size', and that the rectangles are not crossing "
            "each other or clipped by the frame edge."
        )
    return 1


def _peak_probe(params: dict):
    """Peak colour-match score for a frame, via the detector's own scoring."""

    def run(rgba: np.ndarray) -> int:
        return int(
            worker._marker_score(
                rgba,
                str(params.get("markerColor", "#ff0000")),
                float(params.get("tolerance", 0.22)),
            ).max()
        )

    return run


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video")
    ap.add_argument(
        "--color",
        default="#ff0000",
        help="marker colour: a hex like #ff0000, or a name (red/green/blue/...)",
    )
    ap.add_argument("--tolerance", type=float, default=0.22)
    ap.add_argument("--min-size", type=float, default=0.01)
    ap.add_argument("--max-size", type=float, default=0.5)
    ap.add_argument("--pad", type=float, default=0.0)
    ap.add_argument("--every", type=int, default=1, help="probe every Nth frame")
    ap.add_argument("--limit", type=int, default=0, help="stop after N frames")
    ap.add_argument("--dump-frame", type=int, default=-1, help="write this frame")
    ap.add_argument("--out", default="marker_probe.png")
    ap.add_argument(
        "--explain",
        type=int,
        default=-1,
        help="print every candidate shape on this frame and why it was kept",
    )
    args = ap.parse_args()

    params = {
        "source": "markers",
        "markerColor": args.color,
        "tolerance": args.tolerance,
        "minSize": args.min_size,
        "maxSize": args.max_size,
        "pad": args.pad,
    }

    if args.explain >= 0:
        return explain(args.video, params, args.explain)
    if args.dump_frame >= 0:
        return dump(args.video, params, args.dump_frame, args.out)
    return probe(args.video, params, max(1, args.every), max(0, args.limit))


def explain(path: str, params: dict, frame_no: int) -> int:
    """Per-shape verdicts for one frame — why a marker was or wasn't taken."""
    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
    ok, bgr = cap.read()
    cap.release()
    if not ok:
        print(f"Cannot read frame {frame_no}", file=sys.stderr)
        return 2
    rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)
    n, _ = worker._marker_detect(rgba, params, None)
    h, w = bgr.shape[:2]
    print(f"frame {frame_no} ({w}x{h}): {n} marker(s) accepted")
    print(f"colour threshold: {worker._marker_threshold(params['tolerance'])}, "
          f"peak in frame: {_peak_probe(params)(rgba)}")
    print(f"size gate: {params['minSize']}..{params['maxSize']} "
          f"of the frame = {params['minSize'] * w:.0f}..{params['maxSize'] * w:.0f} px wide\n")
    if worker._marker_merged:
        print(f"WARNING: {worker._marker_merged} group(s) of markers merged in "
              "the mask — their boxes come out fragmented or oversized.\n"
              "  Leave a gap between rectangles, or lower 'Colour tolerance'.\n")
    if not worker._marker_report:
        print("  no candidate shapes at all — nothing matched the colour")
    for r in worker._marker_report:
        px = r.pop("px", None)
        verdict = r.pop("verdict", "?")
        kind = r.pop("kind", "?")
        extra = " ".join(f"{k}={v}" for k, v in r.items())
        flag = "  " if verdict == "ACCEPTED" else "x "
        print(f"  {flag}{kind:5} {px[0]:4}x{px[1]:<4} px  {verdict:28} {extra}")
    return 0 if n else 1


def dump(path: str, params: dict, frame_no: int, out: str) -> int:
    """Write one frame with the detector's mask and boxes drawn on it."""
    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
    ok, bgr = cap.read()
    cap.release()
    if not ok:
        print(f"Cannot read frame {frame_no}", file=sys.stderr)
        return 2
    rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)
    n, boxes = worker._marker_detect(rgba, params, None)
    h, w = bgr.shape[:2]
    for b in boxes:
        cv2.rectangle(
            bgr,
            (int(b["x"] * w), int(b["y"] * h)),
            (int((b["x"] + b["w"]) * w), int((b["y"] + b["h"]) * h)),
            (0, 255, 0),
            3,
        )
    cv2.imwrite(out, bgr)
    print(f"frame {frame_no}: {n} marker(s) -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
