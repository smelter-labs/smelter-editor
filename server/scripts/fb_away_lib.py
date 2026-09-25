"""
Pure logic behind scripts/fb-away-detect.py (no torch / opencv — numpy only,
so test_fb_away_lib.py runs anywhere): the tilted-cylinder camera, jersey
colour calibration + classification, a metric tracker and the resampler that
turns tracks into the `away.json` sidecar arrays.

Pitch frame (metres) is the one of zxy.json / telemetry.ts: X 0..105 left →
right goal line as seen in the panorama, Y 0..68 far → near touchline.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

PITCH_L, PITCH_W = 105.0, 68.0
CAMERA_KEYS = ["cx", "d", "hc", "f", "x0", "y0", "tilt", "roll"]


# ── camera (twin of projectPitch / unprojectPitch in telemetry.ts) ───────────

def camera_params(camera: dict) -> tuple:
    return tuple(float(camera.get(k, 0.0) or 0.0) for k in CAMERA_KEYS)


def project(p, X, Y):
    """Pitch metres → panorama pixels."""
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


class Unprojector:
    """Panorama pixels → pitch metres: coarse grid seed + Newton refinement."""

    def __init__(self, p):
        self.p = p
        xs = np.arange(-15, 121, 1.0)
        ys = np.arange(-15, 84, 1.0)
        self.grid = np.array(
            [(X, Y, *project(p, X, Y)) for X in xs for Y in ys], dtype=float
        )

    def __call__(self, px: float, py: float) -> tuple[float, float]:
        g = self.grid
        i = int(np.argmin((g[:, 2] - px) ** 2 + (g[:, 3] - py) ** 2))
        X, Y = float(g[i, 0]), float(g[i, 1])
        for _ in range(6):
            x, y = project(self.p, X, Y)
            ex, ey = px - x, py - y
            if abs(ex) < 0.05 and abs(ey) < 0.05:
                break
            h = 0.05
            xa, ya = project(self.p, X + h, Y)
            xb, yb = project(self.p, X, Y + h)
            a, b, c, dd = (xa - x) / h, (xb - x) / h, (ya - y) / h, (yb - y) / h
            det = a * dd - b * c
            if abs(det) < 1e-9:
                break
            X += max(-5.0, min(5.0, (dd * ex - b * ey) / det))
            Y += max(-5.0, min(5.0, (-c * ex + a * ey) / det))
        return X, Y


def on_pitch(x: float, y: float, margin: float = 1.0) -> bool:
    return -margin <= x <= PITCH_L + margin and -margin <= y <= PITCH_W + margin


def pitch_band(p, pano_w: int, pano_h: int, head_pad: int = 110, foot_pad: int = 30):
    """Pixel rows that can hold a player standing on the pitch."""
    ys = []
    for i in range(41):
        f = i / 40
        for X, Y in ((f * PITCH_L, 0), (f * PITCH_L, PITCH_W), (0, f * PITCH_W), (PITCH_L, f * PITCH_W)):
            u, v = project(p, X, Y)
            if 0 <= u <= pano_w:
                ys.append(v)
    y1 = max(0, int(min(ys)) - head_pad)
    y2 = min(pano_h, int(max(ys)) + foot_pad)
    return y1, y2


# ── tiles + NMS (as in ai-models/people-counter/worker.py) ───────────────────

def iter_tiles(w: int, h: int, cols: int, rows: int, overlap: float):
    tile_w = int(np.ceil(w / (cols - (cols - 1) * overlap)))
    tile_h = int(np.ceil(h / (rows - (rows - 1) * overlap)))
    step_x = max(1, int(tile_w * (1 - overlap)))
    step_y = max(1, int(tile_h * (1 - overlap)))
    for r in range(rows):
        y1 = min(r * step_y, max(0, h - tile_h))
        for c in range(cols):
            x1 = min(c * step_x, max(0, w - tile_w))
            yield x1, y1, min(x1 + tile_w, w), min(y1 + tile_h, h)


def nms(boxes: np.ndarray, scores: np.ndarray, iou_thr: float) -> list[int]:
    order = np.argsort(scores)[::-1]
    keep: list[int] = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        rest = order[1:]
        if not rest.size:
            break
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_r = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        iou = inter / np.maximum(area_i + area_r - inter, 1e-9)
        order = rest[iou <= iou_thr]
    return keep


# ── jersey colour ────────────────────────────────────────────────────────────

def rgb_to_hsv(rgb) -> tuple[float, float, float]:
    r, g, b = (c / 255.0 for c in rgb)
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d == 0:
        h = 0.0
    elif mx == r:
        h = (60 * ((g - b) / d) + 360) % 360
    elif mx == g:
        h = 60 * ((b - r) / d) + 120
    else:
        h = 60 * ((r - g) / d) + 240
    return h, (0.0 if mx == 0 else d / mx), mx


def hsv_distance(a, b) -> float:
    """Same metric as basketball-scorer/analysis.py: hue counts only as far as
    both colours are saturated; saturation / value carry white, grey, black."""
    dh = abs(a[0] - b[0]) % 360
    dh = 360 - dh if dh > 180 else dh
    hue = (dh / 180.0) * min(a[1], b[1])
    sat = abs(a[1] - b[1]) * 0.5
    val = abs(a[2] - b[2]) * 0.5
    return min(1.0, math.sqrt(hue * hue + sat * sat + val * val))


def jersey_color(patch_rgb: np.ndarray):
    """Median colour of a torso patch ([h,w,3] uint8 RGB) with the grass
    behind the player masked out; None when nothing but grass is left."""
    px = patch_rgb.reshape(-1, 3).astype(np.int32)
    if len(px) == 0:
        return None
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    grass = (g > r * 1.15) & (g > b * 1.15) & (g > 60)
    keep = px[~grass]
    if len(keep) < max(4, len(px) // 10):
        return None
    return tuple(int(v) for v in np.median(keep, axis=0))


def to_hex(rgb) -> str:
    return "#%02x%02x%02x" % tuple(int(max(0, min(255, c))) for c in rgb)


def dominant_color(colors: list, radius: float = 0.22, iters: int = 4):
    """Centre of the densest colour cluster: start at the per-channel median,
    then repeatedly re-centre on the samples within `radius` of it."""
    if not colors:
        return None
    arr = np.array(colors, dtype=float)
    centre = tuple(np.median(arr, axis=0))
    for _ in range(iters):
        ch = rgb_to_hsv(centre)
        near = [c for c in colors if hsv_distance(rgb_to_hsv(c), ch) <= radius]
        if len(near) < 3:
            break
        centre = tuple(np.median(np.array(near, dtype=float), axis=0))
    return tuple(int(round(v)) for v in centre)


def classify(rgb, color_a, color_b, max_dist: float = 0.25) -> str:
    """'A' | 'B' | 'O' (other: referee, goalkeeper, ball boy, no sample)."""
    if rgb is None:
        return "O"
    s = rgb_to_hsv(rgb)
    da = hsv_distance(s, rgb_to_hsv(color_a)) if color_a else 9.0
    db = hsv_distance(s, rgb_to_hsv(color_b)) if color_b else 9.0
    if min(da, db) > max_dist:
        return "O"
    return "A" if da <= db else "B"


# ── tracking in metres ───────────────────────────────────────────────────────

@dataclass
class Det:
    t: float  # media ms
    x: float
    y: float
    cls: str = "O"
    rgb: tuple | None = None
    box: tuple | None = None


@dataclass
class Track:
    id: int
    dets: list = field(default_factory=list)
    misses: int = 0
    vx: float = 0.0
    vy: float = 0.0

    @property
    def last(self) -> Det:
        return self.dets[-1]

    def votes(self) -> dict:
        out = {"A": 0, "B": 0, "O": 0}
        for d in self.dets:
            out[d.cls] += 1
        return out

    def label(self) -> str:
        v = self.votes()
        return max(v, key=lambda k: v[k])


class MetricTracker:
    """Greedy nearest-neighbour association in pitch metres. The gate is what
    a player can cover since the track was last seen (`max_speed`) plus the
    projection noise (`slack`); a jersey-class mismatch costs `cls_penalty`
    metres, so two players crossing keep their own colour."""

    def __init__(self, max_speed=9.0, slack=1.5, max_miss_ms=1000.0, cls_penalty=2.0):
        self.max_speed = max_speed
        self.slack = slack
        self.max_miss_ms = max_miss_ms
        self.cls_penalty = cls_penalty
        self.active: list[Track] = []
        self.done: list[Track] = []
        self._next = 1

    def update(self, dets: list[Det], t_ms: float) -> None:
        pairs = []
        for ti, tr in enumerate(self.active):
            dt = max(1e-3, (t_ms - tr.last.t) / 1000.0)
            px = tr.last.x + tr.vx * min(dt, 0.5)
            py = tr.last.y + tr.vy * min(dt, 0.5)
            gate = self.max_speed * dt + self.slack
            for di, d in enumerate(dets):
                dist = math.hypot(d.x - px, d.y - py)
                if dist > gate:
                    continue
                known = tr.label()
                mismatch = d.cls != known and "O" not in (d.cls, known)
                pairs.append((dist + (self.cls_penalty if mismatch else 0.0), ti, di))
        pairs.sort()
        used_t, used_d = set(), set()
        for _, ti, di in pairs:
            if ti in used_t or di in used_d:
                continue
            used_t.add(ti)
            used_d.add(di)
            tr, d = self.active[ti], dets[di]
            dt = max(1e-3, (d.t - tr.last.t) / 1000.0)
            vx, vy = (d.x - tr.last.x) / dt, (d.y - tr.last.y) / dt
            tr.vx = 0.6 * tr.vx + 0.4 * vx
            tr.vy = 0.6 * tr.vy + 0.4 * vy
            tr.dets.append(d)
        keep = []
        for ti, tr in enumerate(self.active):
            if ti in used_t or t_ms - tr.last.t <= self.max_miss_ms:
                keep.append(tr)
            else:
                self.done.append(tr)
        self.active = keep
        for di, d in enumerate(dets):
            if di not in used_d:
                self.active.append(Track(self._next, [d]))
                self._next += 1

    def finish(self) -> list[Track]:
        self.done += self.active
        self.active = []
        return sorted(self.done, key=lambda t: t.id)


def in_penalty_area(x: float, y: float) -> bool:
    return (x <= 16.5 or x >= PITCH_L - 16.5) and abs(y - PITCH_W / 2) <= 20.16


def select_away(tracks: list[Track], home_at, min_ms=1500.0, tag_radius=3.0) -> list[Track]:
    """Tracks to publish as the away side: jersey-class 'B' by majority, plus
    an 'other'-coloured track that lives in a penalty area away from every
    home tag (the away goalkeeper wears his own kit). `home_at(t_ms)` returns
    the home tags' [(x, y), …] at a media time."""
    out = []
    for tr in tracks:
        if tr.last.t - tr.dets[0].t < min_ms:
            continue
        label = tr.label()
        xs = sorted(d.x for d in tr.dets)
        ys = sorted(d.y for d in tr.dets)
        # someone who lives behind a line is staff / a ball boy, not a player
        if not on_pitch(xs[len(xs) // 2], ys[len(ys) // 2], 0):
            continue
        if label == "B":
            out.append(tr)
            continue
        if label != "O":
            continue
        if not in_penalty_area(xs[len(xs) // 2], ys[len(ys) // 2]):
            continue
        near = 0
        for d in tr.dets:
            if any(math.hypot(d.x - hx, d.y - hy) <= tag_radius for hx, hy in home_at(d.t)):
                near += 1
        if near / len(tr.dets) < 0.3:
            out.append(tr)
    return out


def resample(track: Track, hz: float, n: int, max_gap_ms=1000.0, ema=0.5):
    """Track → (x[n], y[n]) on the i·1000/hz grid: linear interpolation across
    gaps ≤ `max_gap_ms`, then an EMA; None where the track has no fix."""
    step = 1000.0 / hz
    ts = [d.t for d in track.dets]
    xs: list = [None] * n
    ys: list = [None] * n
    j = 0
    sx = sy = None
    i0 = max(0, math.ceil(ts[0] / step))
    i1 = min(n - 1, math.floor(ts[-1] / step))
    for i in range(i0, i1 + 1):
        t = i * step
        while j + 1 < len(ts) and ts[j + 1] <= t:
            j += 1
        a = track.dets[j]
        if j + 1 < len(ts):
            b = track.dets[j + 1]
            if b.t - a.t > max_gap_ms:
                if t - a.t > step / 2:
                    sx = sy = None
                    continue
                x, y = a.x, a.y
            else:
                f = (t - a.t) / (b.t - a.t) if b.t > a.t else 0.0
                x, y = a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f
        else:
            x, y = a.x, a.y
        sx = x if sx is None else sx + ema * (x - sx)
        sy = y if sy is None else sy + ema * (y - sy)
        xs[i], ys[i] = round(sx, 2), round(sy, 2)
    return xs, ys


def cap_per_sample(tracks_xy: list, lengths: list, cap: int = 11) -> None:
    """At most `cap` fixes per sample — the shortest tracks give way."""
    if not tracks_xy:
        return
    n = len(tracks_xy[0][0])
    order = sorted(range(len(tracks_xy)), key=lambda k: -lengths[k])
    for i in range(n):
        seen = 0
        for k in order:
            if tracks_xy[k][0][i] is None:
                continue
            seen += 1
            if seen > cap:
                tracks_xy[k][0][i] = None
                tracks_xy[k][1][i] = None
