"""Synthetic-trajectory tests for analysis.py (stdlib only — no torch/numpy).

Run with any python3:  python3 test_analysis.py
Balls fly along piecewise-linear paths through the rim zones at 20 fps; the
detector must count swishes, ignore rim-outs, air balls and balls flying past
the rim, and pin makes on the right jersey.
"""

from __future__ import annotations

from analysis import (
    ABOVE_DEPTH,
    ABOVE_HALF_WIDTH,
    ATTEMPT_DIST,
    CROP_MIN_SIDE,
    NET_DEPTH,
    BallTrack,
    Rim,
    ShotDetector,
    analysis_interval_s,
    ball_in_hands,
    classify_team,
    median_color,
    replay_frame_plan,
    rim_crop_box,
    rim_from_params,
    torso_region,
    zone_of,
)

FPS = 20
DT = 1.0 / FPS
ASPECT = 16 / 9
RIM = Rim(cx=0.5, cy=0.35, rx=0.06, ry=0.02)
RXY = RIM.rx * ASPECT  # rim x-radius in y units
PARAMS = {
    "rimSet": 1,
    "rimCx": RIM.cx,
    "rimCy": RIM.cy,
    "rimRx": RIM.rx,
    "rimRy": RIM.ry,
    "netZoneMs": 700,
    "cooldownMs": 1500,
}
BALL_W = 0.03
BALL_H = BALL_W * ASPECT

TEAM_A = {"x": 0.10, "y": 0.45, "w": 0.08, "h": 0.40}  # left player
TEAM_B = {"x": 0.80, "y": 0.45, "w": 0.08, "h": 0.40}  # right player
PERSONS = [TEAM_A, TEAM_B]

passed = 0
failed = 0


def check(name: str, ok: bool, extra: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'} {name}{' — ' + extra if extra else ''}")


def ball_at(cx: float, cy: float) -> dict:
    return {"x": cx - BALL_W / 2, "y": cy - BALL_H / 2, "w": BALL_W, "h": BALL_H, "conf": 0.8}


def segment(x0, y0, x1, y1, seconds, t0):
    """Samples along a straight line, DT apart, starting at t0 (exclusive of
    the start point so segments chain without duplicates)."""
    n = max(1, int(round(seconds * FPS)))
    out = []
    for i in range(1, n + 1):
        u = i / n
        out.append((t0 + i * DT, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u))
    return out


def swish(t0: float, x: float = RIM.cx, x_from: float | None = None, y_from: float = 0.7, entry_v: float = 1.2, net_v: float = 0.5):
    """Release from (x_from, y_from), arc over the rim, drop in and slow in the net.
    The shooter stands off to the side, so the rise never crosses the net band."""
    x_from = 0.3 if x_from is None else x_from
    pts = []
    apex_y = RIM.cy - 4.0 * RXY
    # rise from the hands to the apex above the rim (0.5 s)
    pts += segment(x_from, y_from, x, apex_y, 0.5, t0)
    t = pts[-1][0]
    # descend through the above band into the rim at entry_v (heights/s)
    pts += segment(x, apex_y, x, RIM.cy, (RIM.cy - apex_y) / entry_v, t)
    t = pts[-1][0]
    # net: slow descent over the net band
    net_bottom = RIM.cy + RIM.ry + NET_DEPTH * RXY
    pts += segment(x, RIM.cy, x, net_bottom + 0.005, (net_bottom - RIM.cy) / net_v, t)
    t = pts[-1][0]
    # exits the net, falls to the floor
    pts += segment(x, net_bottom + 0.005, x + 0.03, net_bottom + 0.3, 0.3, t)
    return pts


def pass_by(t0: float, v: float = 1.4, dx: float = 0.0):
    """Straight through the projected ellipse at constant speed (a ball in
    front of or behind the rim): no deceleration, no dwell. `dx` in rx off
    the rim centre."""
    pts = []
    x = RIM.cx + dx * RIM.rx
    y0 = RIM.cy - 3.0 * RXY
    y1 = RIM.cy + RIM.ry + NET_DEPTH * RXY + 0.25
    pts += segment(x, y0, x, y1, (y1 - y0) / v, t0)
    return pts


def rim_out(t0: float):
    pts = []
    y_apex = RIM.cy - 3.0 * RXY
    pts += segment(0.3, 0.7, RIM.cx - RIM.rx * 0.9, y_apex, 0.5, t0)
    t = pts[-1][0]
    # descend onto the front iron
    pts += segment(RIM.cx - RIM.rx * 0.9, y_apex, RIM.cx - RIM.rx * 0.9, RIM.cy - RIM.ry * 0.5, 0.25, t)
    t = pts[-1][0]
    # bounce up and away to the left
    pts += segment(RIM.cx - RIM.rx * 0.9, RIM.cy - RIM.ry * 0.5, RIM.cx - 0.25, RIM.cy - 0.12, 0.4, t)
    t = pts[-1][0]
    pts += segment(RIM.cx - 0.25, RIM.cy - 0.12, RIM.cx - 0.3, 0.8, 0.5, t)
    return pts


def air_ball(t0: float):
    """Passes through the above band off to the side, never reaches the rim."""
    pts = []
    x = RIM.cx + 1.6 * RIM.rx
    pts += segment(0.8, 0.7, x, RIM.cy - 3.0 * RXY, 0.5, t0)
    t = pts[-1][0]
    pts += segment(x, RIM.cy - 3.0 * RXY, x + 0.02, 0.85, 0.6, t)
    return pts


def run(points, persons=PERSONS, detector: ShotDetector | None = None, drop=None, hold_start=None):
    """Feed points; `drop` = set of sample indices to report as ball=None
    (occlusion); `hold_start` = (person, n) keeps the ball in that person's
    hands for n frames before the flight (release attribution)."""
    det = detector or ShotDetector(PARAMS, aspect=ASPECT)
    events = []
    t = points[0][0] - DT
    if hold_start:
        person, n = hold_start
        hx = person["x"] + person["w"] / 2
        hy = person["y"] + person["h"] * 0.1
        for i in range(n):
            th = t - (n - i) * DT
            events += det.observe(th, ball_at(hx, hy), persons)
    for i, (t, x, y) in enumerate(points):
        ball = None if (drop and i in drop) else ball_at(x, y)
        events += det.observe(t, ball, persons)
    # a little idle tail so lost/away timeouts fire
    for i in range(int(2.0 * FPS)):
        events += det.observe(t + (i + 1) * DT, None, persons)
    return det, events


def first_zone_after_apex(points, zone_name):
    """Index of the first sample in `zone_name` on the way DOWN (after the apex)."""
    apex = min(range(len(points)), key=lambda i: points[i][2])
    return next(i for i in range(apex, len(points)) if zone_of(points[i][1], points[i][2], RIM, ASPECT) == zone_name)


def makes(events):
    return [e for e in events if e["type"] == "shot_made"]


def attempts(events):
    return [e for e in events if e["type"] == "shot_attempt"]


# ── zones ────────────────────────────────────────────────────────────────────
check("zone: rim centre", zone_of(RIM.cx, RIM.cy, RIM, ASPECT) == "rim")
check("zone: just above the rim", zone_of(RIM.cx, RIM.cy - 2 * RXY, RIM, ASPECT) == "above")
check("zone: in the net", zone_of(RIM.cx, RIM.cy + RIM.ry + RXY, RIM, ASPECT) == "below")
check("zone: far left", zone_of(0.1, RIM.cy, RIM, ASPECT) == "none")
check("zone: far below the net", zone_of(RIM.cx, RIM.cy + 0.5, RIM, ASPECT) == "none")
check("rim_from_params off", rim_from_params({"rimSet": 0}) is None)
check("rim_from_params on", rim_from_params(PARAMS) == RIM)
check("interval clamps", analysis_interval_s({"analysisFps": 99}, 0.05) == 1 / 30 and analysis_interval_s({"analysisFps": 2}, 0.05) == 1 / 8 and analysis_interval_s({}, 0.05) == 0.05)

# ── rim crop (shared by training data + the worker's ball pass) ──────────────
APIDIS_CAM7 = Rim(cx=0.1812, cy=0.1765, rx=0.0232, ry=0.0081)  # 1600x1200, rim near the top-left
x0, y0, side = rim_crop_box(APIDIS_CAM7, 1600, 1200)
check("rim crop: side is 16 rx rounded to 32", side == 608, str(side))
check("rim crop: shifted to stay inside the frame", x0 == 0 and y0 == 0, f"{x0},{y0}")
rx_px = APIDIS_CAM7.rx * 1600
above_top = APIDIS_CAM7.cy * 1200 - ABOVE_DEPTH * rx_px
net_bottom = (APIDIS_CAM7.cy + APIDIS_CAM7.ry) * 1200 + NET_DEPTH * rx_px
band_left = APIDIS_CAM7.cx * 1600 - ABOVE_HALF_WIDTH * rx_px
band_right = APIDIS_CAM7.cx * 1600 + ABOVE_HALF_WIDTH * rx_px
check(
    "rim crop: covers the approach band and the net bottom",
    y0 <= above_top and net_bottom <= y0 + side and x0 <= band_left and band_right <= x0 + side,
    f"crop {x0},{y0}+{side} vs y {above_top:.0f}..{net_bottom:.0f} x {band_left:.0f}..{band_right:.0f}",
)
x0, y0, side = rim_crop_box(RIM, 1280, 720)
check("rim crop: never larger than the frame", side == 720 and x0 == 280 and y0 == 0, f"{x0},{y0}+{side}")
x0, y0, side = rim_crop_box(Rim(0.5, 0.5, 0.005, 0.002), 1600, 1200)
check("rim crop: minimum side for a tiny rim", side == CROP_MIN_SIDE and x0 == 560 and y0 == 360, f"{x0},{y0}+{side}")

# ── track ────────────────────────────────────────────────────────────────────
tr = BallTrack()
tr.observe(0.0, ball_at(0.5, 0.2))
tr.observe(0.05, ball_at(0.5, 0.26))
v = tr.velocity(ASPECT)
check("track velocity in heights/s", v is not None and abs(v[1] - 1.2) < 1e-6 and abs(v[0]) < 1e-9, str(v))
tr.observe(1.0, ball_at(0.5, 0.3))
check("track velocity needs close samples", tr.velocity(ASPECT) is None)

# ── swish ────────────────────────────────────────────────────────────────────
det, ev = run(swish(1.0))
check("swish → 1 make, 1 attempt (made)", len(makes(ev)) == 1 and len(attempts(ev)) == 1 and attempts(ev)[0]["result"] == "made", str([(e["type"], e.get("evidence")) for e in ev]))
check("swish evidence is deceleration", makes(ev) and makes(ev)[0]["evidence"] in ("decel", "net_dwell", "exit_slow"), str(makes(ev)[0].get("evidence") if makes(ev) else None))
check("swish make index 1", makes(ev) and makes(ev)[0]["index"] == 1)

# ── pass-by (in front of / behind the rim) ───────────────────────────────────
det, ev = run(pass_by(1.0, dx=0.8))
check("pass-by at constant speed off the rim centre → 0 makes", len(makes(ev)) == 0, str(ev))
check("pass-by still counts as an attempt", len(attempts(ev)) == 1 and attempts(ev)[0]["result"] == "miss")
det, ev = run(pass_by(1.0))
check("straight down the middle of the net at constant speed → weak make (net_pass)", len(makes(ev)) == 1 and makes(ev)[0]["evidence"] == "net_pass", str([(e["type"], e.get("evidence")) for e in ev]))

# ── rim-out / air ball ───────────────────────────────────────────────────────
det, ev = run(rim_out(1.0))
check("rim-out → 0 makes, 1 miss", len(makes(ev)) == 0 and len(attempts(ev)) == 1, str(ev))
det, ev = run(air_ball(1.0))
check("air ball → 0 makes", len(makes(ev)) == 0, str(ev))
check("air ball within reach counts as an attempt", len(attempts(ev)) == 1, str(det.min_dist))

# ── two makes ────────────────────────────────────────────────────────────────
det, ev = run(swish(1.0) + swish(6.0))
check("two swishes 5 s apart → 2 makes", len(makes(ev)) == 2 and [m["index"] for m in makes(ev)] == [1, 2])
det, ev = run(swish(1.0) + swish(2.2, x_from=0.55, y_from=0.62))
check("second swish inside the cooldown is ignored", len(makes(ev)) == 1, str(len(makes(ev))))

# ── occlusion in the net ─────────────────────────────────────────────────────
pts = swish(1.0)
# drop a few samples right where the ball enters the rim on the way down
rim_idx = first_zone_after_apex(pts, "rim")
det, ev = run(pts, drop=set(range(rim_idx, rim_idx + 4)))
check("swish with 4 lost frames at the rim still counts", len(makes(ev)) == 1, str([(e["type"], e.get("evidence")) for e in ev]))

pts = swish(1.0)
below_idx = first_zone_after_apex(pts, "below")
det, ev = run(pts, drop=set(range(below_idx, len(pts))))
check("ball vanishing inside the net → make with weak evidence", len(makes(ev)) == 1 and makes(ev)[0]["evidence"] == "lost_in_net", str([(e["type"], e.get("evidence")) for e in ev]))

# ── net occlusion: constant-speed drop, but the mesh hid the ball ────────────
pts = pass_by(1.0)
below = [i for i, p in enumerate(pts) if zone_of(p[1], p[2], RIM, ASPECT) == "below"]
det, ev = run(pts, drop=set(below[1:3]))
check("ball seen in the net, hidden by the mesh, out under it → make", len(makes(ev)) == 1 and makes(ev)[0]["evidence"] == "net_occluded", str([(e["type"], e.get("evidence")) for e in ev]))
det, ev = run(pts, drop=set(below[:1]))
check("a drop before any net sample is not occlusion evidence", len(makes(ev)) == 0, str([(e["type"], e.get("evidence")) for e in ev]))

# ── hidden from the rim to under the net (the mesh hides a clean drop) ────────
pts = swish(1.0)
rim_idx = first_zone_after_apex(pts, "rim")
under_idx = next(i for i in range(rim_idx, len(pts)) if pts[i][2] > RIM.net_bottom(ASPECT))
det, ev = run(pts, drop=set(range(rim_idx, under_idx)))
check("ball vanishing over the rim and reappearing under the net → weak make (net_hidden)", len(makes(ev)) == 1 and makes(ev)[0]["evidence"] == "net_hidden", str([(e["type"], e.get("evidence")) for e in ev]))
pts = air_ball(1.0)
det, ev = run(pts, drop=set(range(len(pts) // 2, len(pts) // 2 + 6)))
check("air ball hidden for a moment is still no make", len(makes(ev)) == 0, str([(e["type"], e.get("evidence")) for e in ev]))
pts = rim_out(1.0)
det, ev = run(pts, drop=set(range(len(pts) // 2, len(pts) // 2 + 4)))
check("rim-out hidden for a moment is still no make", len(makes(ev)) == 0, str([(e["type"], e.get("evidence")) for e in ev]))

# ── fast ball skipping the rim sample ────────────────────────────────────────
pts = swish(1.0, entry_v=3.0)
pts = [p for p in pts if zone_of(p[1], p[2], RIM, ASPECT) != "rim"]
det, ev = run(pts)
check("no sample inside the ellipse but above→below within the span → make", len(makes(ev)) == 1, str([(e["type"], e.get("evidence")) for e in ev]))

# ── release attribution ──────────────────────────────────────────────────────
pts = swish(1.0, x_from=TEAM_A["x"] + TEAM_A["w"] / 2, y_from=TEAM_A["y"] + 0.04)
det, ev = run(pts, hold_start=(TEAM_A, 5))
rel = makes(ev)[0]["release"] if makes(ev) else None
check("release found on team A's player", rel is not None and rel["person"] == TEAM_A, str(rel))
check("releaseT precedes the rim time", makes(ev) and makes(ev)[0]["releaseT"] is not None and makes(ev)[0]["releaseT"] < makes(ev)[0]["rimT"])
check("ball_in_hands: ball above the head still counts", ball_in_hands(ball_at(0.14, TEAM_A["y"] - 0.05), TEAM_A))
check("ball_in_hands: ball far away does not", not ball_in_hands(ball_at(0.5, 0.2), TEAM_A))

# ── team colour classification ───────────────────────────────────────────────
colors = {"A": "#ff6a1f", "B": "#1f7bff"}
team, conf = classify_team((250, 110, 40), colors)
check("orange jersey → A with high confidence", team == "A" and conf >= 0.8, f"{team} {conf:.2f}")
team, conf = classify_team((40, 120, 250), colors)
check("blue jersey → B", team == "B" and conf >= 0.8, f"{team} {conf:.2f}")
team, conf = classify_team((128, 128, 128), colors)
check("grey → nobody", team is None and conf == 0.0, f"{team} {conf:.2f}")
team, conf = classify_team((250, 110, 40), {"A": "#ff6a1f", "B": "#ff8a3f"})
check("two near-identical team colours → low confidence", conf < 0.5, f"{team} {conf:.2f}")
team, conf = classify_team((240, 240, 240), {"A": "#f4efe6", "B": "#141416"})
check("white vs black bibs work on value alone", team == "A" and conf >= 0.8, f"{team} {conf:.2f}")
x0, y0, x1, y1 = torso_region({"x": 0.1, "y": 0.2, "w": 0.2, "h": 0.6})
check("torso region sits in the upper middle of the box", abs(x0 - 0.15) < 1e-9 and abs(x1 - 0.25) < 1e-9 and abs(y0 - 0.32) < 1e-9 and abs(y1 - 0.53) < 1e-9)
med = median_color([(120, 120, 120)] * 6 + [(250, 100, 30)] * 4)
check("median prefers the saturated bib pixels over grey", med == (250, 100, 30), str(med))
check("median falls back to everything when nothing is saturated", median_color([(120, 120, 120)] * 3) == (120, 120, 120))

# ── no rim calibrated ────────────────────────────────────────────────────────
det, ev = run(swish(1.0), detector=ShotDetector({"rimSet": 0}, aspect=ASPECT))
check("without a rim nothing is counted", len(ev) == 0 and det.state == "idle")

# ── live re-configuration ────────────────────────────────────────────────────
det = ShotDetector({"rimSet": 0}, aspect=ASPECT)
det.set_params(PARAMS)
_, ev = run(swish(1.0), detector=det)
check("set_params enables the rim on a running detector", len(makes(ev)) == 1)

# ── instant replay frame plan ────────────────────────────────────────────────
buf = [(i / 20, i) for i in range(100)]  # 5 s at 20 fps, payload = index
plan, dur = replay_frame_plan(buf, 4.0)
check("replay: 4 s of source at 0.5× → ~8 s at 30 fps", 236 <= len(plan) <= 241 and 7800 <= dur <= 8100, f"{len(plan)} frames, {dur} ms")
check("replay: starts 3 s before the make (frame 20)", plan[0] == 20, str(plan[:3]))
check("replay: ends at the newest frame covering t+1 s", plan[-1] == 99, str(plan[-3:]))
check("replay: frames repeat, never skip", all(0 <= b - a <= 1 for a, b in zip(plan, plan[1:])))
irregular = [(0.0, 0), (0.3, 1), (0.31, 2), (1.0, 3), (2.4, 4), (2.5, 5)]
plan, dur = replay_frame_plan(irregular, 2.0, before=1.0, after=0.5)
check("replay: irregular pts pick the nearest frame per sample", plan[0] == 3 and plan[-1] == 5 and len(plan) == 91, f"{len(plan)} {plan[:2]} {plan[-2:]}")
check("replay: window clipped to the buffer", replay_frame_plan(buf, 0.5)[1] < 4000 and replay_frame_plan(buf, 0.5)[0][0] == 0)
check("replay: empty buffer → empty plan", replay_frame_plan([], 1.0) == ([], 0))
check("replay: make outside the buffer → empty plan", replay_frame_plan(buf, 30.0) == ([], 0))

print(f"\n{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
