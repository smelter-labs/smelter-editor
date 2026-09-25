#!/usr/bin/env python3
"""
Fit the tilted-cylinder panorama camera model used by the football game
(`projectPitch` in scripts/lib/alfheim.mjs / server/src/football/telemetry.ts)
to hand-read pitch landmarks, and draw the fitted pitch over a still so the
result can be checked by eye.

  motion/.venv/bin/python scripts/fb-fit-camera.py \
      --landmarks scripts/fb-zones/pano-2013-11-07.landmarks.json \
      [--seed scripts/fb-zones/pano-2013-11-28.json] \
      [--still data/mp4s/fb-demo/pano-anzhi-goal/pano.jpg --overlay /tmp/fit.jpg]

Landmarks file: { "points": [[Xm, Ym, px, py], …] } in the pitch frame of the
zones files (X 0..105 left→right goal line in the panorama, Y 0..68 far→near
touchline). Prints the `camera` block for a zones json plus per-point
residuals. `roll` (camera roll about the optical axis, optional in the zones
files, 0 for 2013-11-28) is fitted too; pass --no-roll to pin it to 0. Needs numpy; the overlay also needs opencv (both are in
server/motion/.venv).
"""
import argparse
import json
import math

import numpy as np

PITCH_L, PITCH_W = 105.0, 68.0
KEYS = ["cx", "d", "hc", "f", "x0", "y0", "tilt", "roll"]
DEFAULT_SEED = {
    "cx": 56.6, "d": 7.5, "hc": 9.3, "f": 1594.0,
    "x0": 2239.0, "y0": 1068.0, "tilt": 0.4357, "roll": 0.0,
}


def project(p, X, Y):
    cx, d, hc, f, x0, y0, tilt, roll = p
    dx = X - cx
    dz = PITCH_W + d - Y
    theta = math.atan2(dx, dz)
    r = math.hypot(dx, dz)
    phi = math.atan2(-hc, r)
    ct, st, cp = math.cos(tilt), math.sin(tilt), math.cos(phi)
    ry = math.sin(phi) * ct + math.cos(theta) * cp * st
    rz = -math.sin(phi) * st + math.cos(theta) * cp * ct
    rx = math.sin(theta) * cp
    cr, sr = math.cos(roll), math.sin(roll)
    rx, ry = rx * cr - ry * sr, rx * sr + ry * cr
    return x0 + f * math.atan2(rx, rz), y0 - (f * ry) / math.hypot(rx, rz)


def residuals(p, pts):
    out = []
    for X, Y, px, py in pts:
        u, v = project(p, X, Y)
        out += [u - px, v - py]
    return np.array(out)


def fit(pts, seed, iters=400, free=None):
    """Levenberg–Marquardt with a numerical Jacobian."""
    p = np.array(seed, dtype=float)
    lam = 1e-2
    r = residuals(p, pts)
    cost = r @ r
    for _ in range(iters):
        J = np.zeros((len(r), len(p)))
        for k in range(len(p)):
            if free is not None and not free[k]:
                continue
            h = 1e-5 * max(1.0, abs(p[k]))
            q = p.copy()
            q[k] += h
            J[:, k] = (residuals(q, pts) - r) / h
        A = J.T @ J
        g = J.T @ r
        step = np.linalg.solve(A + lam * np.diag(np.diag(A)) + 1e-9 * np.eye(len(p)), -g)
        q = p + step
        rq = residuals(q, pts)
        cq = rq @ rq
        if cq < cost:
            p, r, cost, lam = q, rq, cq, max(lam / 3, 1e-9)
            if np.linalg.norm(step) < 1e-7:
                break
        else:
            lam = min(lam * 4, 1e9)
    return p


def pitch_lines():
    """Polylines of the pitch markings in metres."""
    def seg(a, b, n=40):
        return [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1)]

    def arc(cx, cy, r, a0, a1, n=60):
        return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]

    L, W, m = PITCH_L, PITCH_W, PITCH_W / 2
    lines = [
        seg((0, 0), (L, 0)), seg((L, 0), (L, W)), seg((L, W), (0, W)), seg((0, W), (0, 0)),
        seg((L / 2, 0), (L / 2, W)),
        arc(L / 2, m, 9.15, 0, 2 * math.pi),
    ]
    a = math.acos(5.5 / 9.15)
    for gx, s in ((0, 1), (L, -1)):
        lines += [
            seg((gx, m - 20.16), (gx + s * 16.5, m - 20.16)),
            seg((gx + s * 16.5, m - 20.16), (gx + s * 16.5, m + 20.16)),
            seg((gx + s * 16.5, m + 20.16), (gx, m + 20.16)),
            seg((gx, m - 9.16), (gx + s * 5.5, m - 9.16)),
            seg((gx + s * 5.5, m - 9.16), (gx + s * 5.5, m + 9.16)),
            seg((gx + s * 5.5, m + 9.16), (gx, m + 9.16)),
            arc(gx + s * 11, m, 9.15, -a, a) if s == 1 else arc(gx + s * 11, m, 9.15, math.pi - a, math.pi + a),
        ]
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--landmarks", required=True)
    ap.add_argument("--seed")
    ap.add_argument("--still")
    ap.add_argument("--overlay")
    ap.add_argument("--no-roll", action="store_true")
    args = ap.parse_args()

    pts = json.load(open(args.landmarks))["points"]
    seed = dict(DEFAULT_SEED)
    if args.seed:
        seed.update({k: v for k, v in json.load(open(args.seed))["camera"].items() if k in KEYS})
    free = [not (args.no_roll and k == "roll") for k in KEYS]
    p = fit(pts, [seed[k] for k in KEYS], free=free)

    r = residuals(p, pts).reshape(-1, 2)
    print("point residuals (px):")
    for (X, Y, px, py), (du, dv) in zip(pts, r):
        print(f"  ({X:6.2f},{Y:6.2f}) -> ({px:6.0f},{py:6.0f})  err {du:+7.1f} {dv:+7.1f}  |{math.hypot(du, dv):5.1f}|")
    print(f"rms {math.sqrt((r ** 2).sum() / len(r)):.1f} px, max {np.hypot(r[:, 0], r[:, 1]).max():.1f} px")
    camera = {"model": "tilted-cylinder", **{k: round(float(v), 4) for k, v in zip(KEYS, p)}}
    print(json.dumps({"camera": camera}, indent=2))

    if args.still and args.overlay:
        import cv2

        img = cv2.imread(args.still)
        for line in pitch_lines():
            px = np.array([project(p, X, Y) for X, Y in line], dtype=np.int32)
            cv2.polylines(img, [px], False, (0, 0, 255), 3)
        for X, Y, u, v in pts:
            cv2.circle(img, (int(u), int(v)), 12, (255, 255, 0), 3)
        cv2.imwrite(args.overlay, img)
        print(f"overlay → {args.overlay}")


if __name__ == "__main__":
    main()
