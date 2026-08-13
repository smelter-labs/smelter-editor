"""Synthetic-sequence tests for analysis.py (stdlib only — no torch/numpy).

Run with any python3:  python3 test_analysis.py
Skeletons are keyframed side-view poses (bottom hinge / top of swing) lerped
with a cosine so hand height moves like a real swing cycle.
"""

from __future__ import annotations

import math

from analysis import (
    DEFAULT_PARAMS,
    KettlebellTracker,
    TechniqueAnalyzer,
    angle_deg,
)

FPS = 12
CONF = 0.9

# Keypoint layout used by make_pose: (nose, ear, shoulder, elbow, wrist, hip,
# knee, ankle) — left and right joints get identical coords (side view) unless
# the arm is overridden per side (one-hand lifts: wrist_r/elbow_r).


def make_pose(
    nose, ear, shoulder, elbow, wrist, hip, knee, ankle,
    wrist_r=None, elbow_r=None,
):
    kpts = [[0.0, 0.0, 0.0] for _ in range(17)]
    kpts[0] = [*nose, CONF]
    for left, pt in ((3, ear), (5, shoulder), (7, elbow), (9, wrist), (11, hip), (13, knee), (15, ankle)):
        kpts[left] = [*pt, CONF]
        kpts[left + 1] = [*pt, CONF]
    if elbow_r is not None:
        kpts[8] = [*elbow_r, CONF]
    if wrist_r is not None:
        kpts[10] = [*wrist_r, CONF]
    return kpts


def lerp_pose(a, b, u):
    return [
        [a[i][0] + (b[i][0] - a[i][0]) * u, a[i][1] + (b[i][1] - a[i][1]) * u, a[i][2]]
        for i in range(17)
    ]


# Neutral hip-hinge bottom: straight back (ear-shoulder-hip collinear), open
# knees (~155 deg), straight arm hanging between the knees.
BOTTOM = make_pose(
    nose=(0.32, 0.33), ear=(0.33, 0.32), shoulder=(0.38, 0.38),
    elbow=(0.41, 0.49), wrist=(0.44, 0.60),
    hip=(0.50, 0.52), knee=(0.47, 0.68), ankle=(0.50, 0.80),
)

# Hardstyle top: standing tall, straight horizontal arm, bell at chest height.
TOP = make_pose(
    nose=(0.50, 0.20), ear=(0.50, 0.22), shoulder=(0.50, 0.30),
    elbow=(0.42, 0.31), wrist=(0.34, 0.32),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
)

# Fault variants — one deviation each, everything else neutral.
BOTTOM_SQUAT = make_pose(  # deep knee bend (~96 deg), back still straight
    nose=(0.35, 0.35), ear=(0.36, 0.34), shoulder=(0.40, 0.40),
    elbow=(0.42, 0.51), wrist=(0.44, 0.62),
    hip=(0.50, 0.55), knee=(0.40, 0.62), ankle=(0.50, 0.80),
)
BOTTOM_ROUNDED = make_pose(  # ear collapsed forward (~117 deg back angle)
    nose=(0.29, 0.41), ear=(0.30, 0.40), shoulder=(0.38, 0.38),
    elbow=(0.41, 0.49), wrist=(0.44, 0.60),
    hip=(0.50, 0.52), knee=(0.47, 0.68), ankle=(0.50, 0.80),
)
TOP_BENT_ARMS = make_pose(  # elbow folded to ~126 deg at the top
    nose=(0.50, 0.20), ear=(0.50, 0.22), shoulder=(0.50, 0.30),
    elbow=(0.44, 0.35), wrist=(0.36, 0.33),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
)
TOP_HIGH = make_pose(  # bell above the shoulder line (American-style height)
    nose=(0.50, 0.20), ear=(0.50, 0.22), shoulder=(0.50, 0.30),
    elbow=(0.49, 0.27), wrist=(0.48, 0.24),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
)
TOP_SNATCH = make_pose(  # straight-arm overhead lockout (wrist above nose)
    nose=(0.50, 0.20), ear=(0.50, 0.22), shoulder=(0.50, 0.30),
    elbow=(0.50, 0.21), wrist=(0.50, 0.12),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
)

# One-hand snatch: LEFT arm lifts, RIGHT arm hangs at the side throughout.
BOTTOM_1H = make_pose(
    nose=(0.32, 0.33), ear=(0.33, 0.32), shoulder=(0.38, 0.38),
    elbow=(0.41, 0.49), wrist=(0.44, 0.60),
    hip=(0.50, 0.52), knee=(0.47, 0.68), ankle=(0.50, 0.80),
    elbow_r=(0.43, 0.47), wrist_r=(0.47, 0.54),
)
TOP_SNATCH_1H = make_pose(  # left-arm overhead lockout, straight
    nose=(0.50, 0.20), ear=(0.50, 0.22), shoulder=(0.50, 0.30),
    elbow=(0.50, 0.21), wrist=(0.50, 0.12),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
    elbow_r=(0.54, 0.42), wrist_r=(0.56, 0.52),
)
TOP_SNATCH_1H_SOFT = make_pose(  # left elbow still bent at the catch (~128°)
    nose=(0.50, 0.20), ear=(0.50, 0.22), shoulder=(0.50, 0.30),
    elbow=(0.46, 0.24), wrist=(0.50, 0.12),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
    elbow_r=(0.54, 0.42), wrist_r=(0.56, 0.52),
)


def run_swing(bottom, top, reps=10, period_s=2.0, params=None):
    """Drive a TechniqueAnalyzer through `reps` cosine swing cycles."""
    analyzer = TechniqueAnalyzer(params=params)
    events = []
    snapshot = {}
    steps = int((reps * period_s + 0.5) * FPS)
    for i in range(steps):
        t = i / FPS
        u = 0.5 - 0.5 * math.cos(2 * math.pi * t / period_s)
        snapshot = analyzer.update(t, lerp_pose(bottom, top, u), None)
        events.extend(snapshot["events"])
    return analyzer, events, snapshot


def rep_events(events):
    return [e for e in events if e["type"] == "rep_completed"]


def test_angle_deg():
    assert abs(angle_deg((0, 1), (0, 0), (1, 0)) - 90) < 1e-6
    assert abs(angle_deg((0, 1), (0, 0), (0, -1)) - 180) < 1e-6


def test_ideal_swing():
    analyzer, events, snapshot = run_swing(BOTTOM, TOP)
    reps = rep_events(events)
    assert len(reps) == 10, f"expected 10 reps, got {len(reps)}"
    assert all(r["verdict"] == "correct" for r in reps), [r["issues"] for r in reps]
    assert snapshot["exercise"] == "swing"
    assert any(e["type"] == "exercise_changed" and e["exercise"] == "swing" for e in events)
    assert snapshot["repCount"] == 10


def test_squatting():
    _, events, _ = run_swing(BOTTOM_SQUAT, TOP)
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all("squatting" in r["issues"] for r in reps), [r["issues"] for r in reps]
    assert all(r["verdict"] == "incorrect" for r in reps)


def test_bent_arms():
    _, events, _ = run_swing(BOTTOM, TOP_BENT_ARMS)
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all("bent_arms" in r["issues"] for r in reps), [r["issues"] for r in reps]


def test_rounded_back():
    _, events, _ = run_swing(BOTTOM_ROUNDED, TOP)
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all("rounded_back" in r["issues"] for r in reps), [r["issues"] for r in reps]


def test_too_high_rule():
    _, events, _ = run_swing(BOTTOM, TOP_HIGH)
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all("too_high" in r["issues"] for r in reps), [r["issues"] for r in reps]

    # Same movement is fine once the hardstyle height rule is off.
    _, events_off, _ = run_swing(BOTTOM, TOP_HIGH, params={"swingTopRule": "off"})
    reps_off = rep_events(events_off)
    assert reps_off and all("too_high" not in r["issues"] for r in reps_off)


def test_snatch_classification():
    _, events, snapshot = run_swing(BOTTOM, TOP_SNATCH)
    assert snapshot["exercise"] == "snatch"
    reps = rep_events(events)
    assert len(reps) == 10, f"expected 10 snatch reps, got {len(reps)}"
    assert all(r["exercise"] == "snatch" for r in reps)
    assert all(r["verdict"] == "correct" for r in reps), [r["issues"] for r in reps]
    assert not any("too_high" in r["issues"] for r in reps), (
        "overhead lockout is not a swing fault"
    )


def test_one_hand_snatch():
    _, events, snapshot = run_swing(BOTTOM_1H, TOP_SNATCH_1H)
    assert snapshot["exercise"] == "snatch"
    assert any(
        e["type"] == "exercise_changed" and e["exercise"] == "snatch"
        for e in events
    )
    reps = rep_events(events)
    assert len(reps) == 10, f"expected 10 snatch reps, got {len(reps)}"
    assert all(r["exercise"] == "snatch" for r in reps)
    assert all(r["verdict"] == "correct" for r in reps), [r["issues"] for r in reps]


def test_one_hand_snatch_soft_lockout():
    _, events, snapshot = run_swing(BOTTOM_1H, TOP_SNATCH_1H_SOFT)
    assert snapshot["exercise"] == "snatch"
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all("soft_lockout" in r["issues"] for r in reps), [
        r["issues"] for r in reps
    ]
    assert all(r["verdict"] == "incorrect" for r in reps)


def test_idle():
    analyzer = TechniqueAnalyzer()
    snapshot = {}
    for i in range(8 * FPS):
        t = i / FPS
        pose = [list(k) for k in TOP]
        pose[9][1] += 0.02 * math.sin(t)  # tiny wrist bob
        pose[10][1] += 0.02 * math.sin(t)
        snapshot = analyzer.update(t, pose, None)
    assert snapshot["exercise"] == "idle"
    assert snapshot["repCount"] == 0


def test_missing_pose_is_safe():
    analyzer = TechniqueAnalyzer()
    snapshot = analyzer.update(0.0, None, None)
    assert snapshot["repCount"] == 0 and snapshot["events"] == []


def test_tracker_follows_wrist_and_expires():
    tracker = KettlebellTracker()
    tracker.observe_pose(0.0, {0: (0.5, 0.5), 1: (0.5, 0.5)})
    tracker.observe_detections(0.0, [{"x": 0.45, "y": 0.45, "w": 0.1, "h": 0.1, "conf": 0.3}])
    assert tracker.current() is not None

    # Wrists move +0.1/+0.1 — the held box must translate with them.
    tracker.observe_pose(0.2, {0: (0.6, 0.6), 1: (0.6, 0.6)})
    box = tracker.current()
    assert abs(box["x"] - 0.55) < 1e-6 and abs(box["y"] - 0.55) < 1e-6

    # Detections far from every wrist are rejected.
    tracker2 = KettlebellTracker()
    tracker2.observe_pose(0.0, {0: (0.5, 0.5), 1: (0.5, 0.5)})
    tracker2.observe_detections(0.0, [{"x": 0.02, "y": 0.02, "w": 0.05, "h": 0.05, "conf": 0.9}])
    assert tracker2.current() is None

    # A track not re-acquired for >1.5s expires; position falls back to wrists.
    tracker.observe_pose(2.0, {0: (0.6, 0.6), 1: (0.6, 0.6)})
    assert tracker.current() is None
    assert tracker.position() == (0.6, 0.6)


def test_tracker_one_hand_translation():
    # Only the bell hand moves — the box must follow ITS delta, not the
    # midpoint of both wrists (which would halve the tracked motion).
    tracker = KettlebellTracker()
    tracker.observe_pose(0.0, {0: (0.5, 0.55), 1: (0.6, 0.5)})
    tracker.observe_detections(0.0, [{"x": 0.46, "y": 0.53, "w": 0.08, "h": 0.08, "conf": 0.3}])
    tracker.observe_pose(0.1, {0: (0.5, 0.35), 1: (0.6, 0.5)})  # left lifts
    box = tracker.current()
    assert abs(box["y"] - (0.53 - 0.20)) < 1e-6, "box must ride the lifting hand"
    assert abs(box["x"] - 0.46) < 1e-6


def test_params_update_applies():
    analyzer = TechniqueAnalyzer()
    analyzer.set_params({"repSensitivity": 0.4, "hingeKneeMin": 90})
    assert analyzer.segmenter.rep_sensitivity == 0.4
    assert analyzer.params["hingeKneeMin"] == 90
    assert analyzer.params["swingTopRule"] == DEFAULT_PARAMS["swingTopRule"]


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as err:
                failures += 1
                print(f"FAIL {name}: {err}")
    raise SystemExit(1 if failures else 0)
