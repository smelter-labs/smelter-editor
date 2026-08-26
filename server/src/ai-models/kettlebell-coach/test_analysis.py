"""Synthetic-sequence tests for analysis.py (stdlib only — no torch/numpy).

Run with any python3:  python3 test_analysis.py
Skeletons are keyframed side-view poses (bottom hinge / top of swing) lerped
with a cosine so hand height moves like a real swing cycle.
"""

from __future__ import annotations

import math

from analysis import (
    DEFAULT_PARAMS,
    MAX_ANALYSIS_INTERVAL_S,
    KettlebellTracker,
    TechniqueAnalyzer,
    analysis_interval_s,
    angle_deg,
)

FPS = 12
CONF = 0.9

# Keypoint layout used by make_pose: (nose, ear, shoulder, elbow, wrist, hip,
# knee, ankle) — left and right joints get identical coords (side view) unless
# the arm is overridden per side (one-hand lifts: wrist_r/elbow_r).


def make_pose(
    nose, ear, shoulder, elbow, wrist, hip, knee, ankle,
    wrist_r=None, elbow_r=None, shoulder_r=None,
):
    kpts = [[0.0, 0.0, 0.0] for _ in range(17)]
    kpts[0] = [*nose, CONF]
    for left, pt in ((3, ear), (5, shoulder), (7, elbow), (9, wrist), (11, hip), (13, knee), (15, ankle)):
        kpts[left] = [*pt, CONF]
        kpts[left + 1] = [*pt, CONF]
    if shoulder_r is not None:
        kpts[6] = [*shoulder_r, CONF]
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
TOP_LOW = make_pose(  # bell stalls below the shoulder/hip midpoint — shallow
    nose=(0.50, 0.20), ear=(0.50, 0.22), shoulder=(0.50, 0.30),
    elbow=(0.47, 0.38), wrist=(0.44, 0.46),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
)
TOP_SHALLOW = make_pose(  # hand barely clears the hips — a fidget, not a rep
    nose=(0.40, 0.28), ear=(0.41, 0.27), shoulder=(0.45, 0.34),
    elbow=(0.45, 0.42), wrist=(0.45, 0.50),
    hip=(0.50, 0.51), knee=(0.48, 0.66), ankle=(0.50, 0.80),
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
TOP_CLEAN_1H = make_pose(  # left hand racked at the shoulder, elbow folded
    nose=(0.50, 0.20), ear=(0.50, 0.22), shoulder=(0.50, 0.30),
    elbow=(0.44, 0.38), wrist=(0.47, 0.28),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
    elbow_r=(0.54, 0.42), wrist_r=(0.56, 0.52),
)
TOP_SNATCH_1H_SOFT = make_pose(  # left elbow still bent at the catch (~128°)
    nose=(0.50, 0.20), ear=(0.50, 0.22), shoulder=(0.50, 0.30),
    elbow=(0.46, 0.24), wrist=(0.50, 0.12),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
    elbow_r=(0.54, 0.42), wrist_r=(0.56, 0.52),
)
# Shallow backswing: the working hand turns around at hip + 0.018 — inside
# the absolute bottom zone's dead band (needs hip + 0.05, EMA-effectively
# ~+0.055). Real high-rep one-hand snatch sets sit exactly here. The free
# hand is kept clearly apart so the hands-together midpoint doesn't engage.
BOTTOM_1H_SHALLOW = make_pose(
    nose=(0.34, 0.34), ear=(0.35, 0.33), shoulder=(0.40, 0.39),
    elbow=(0.42, 0.465), wrist=(0.44, 0.538),
    hip=(0.50, 0.52), knee=(0.48, 0.67), ankle=(0.50, 0.80),
    elbow_r=(0.47, 0.44), wrist_r=(0.52, 0.50),
)
# Two-hand variant of the shallow turnaround (both wrists together).
BOTTOM_SHALLOW_2H = make_pose(
    nose=(0.34, 0.34), ear=(0.35, 0.33), shoulder=(0.40, 0.39),
    elbow=(0.42, 0.465), wrist=(0.44, 0.538),
    hip=(0.50, 0.52), knee=(0.48, 0.67), ankle=(0.50, 0.80),
)

# FRONT-facing camera (the tournament setup: phone propped up facing the
# athlete). Shoulders are laterally separated; at the swing top the arms point
# AT the camera, so the projected wrists land next to the shoulders and the
# foreshortened elbows sit off the shoulder-wrist line — the projected elbow
# angle reads folded (~78 deg) even though the arms are straight.
FRONT_BOTTOM = make_pose(
    nose=(0.50, 0.34), ear=(0.52, 0.33),
    shoulder=(0.42, 0.40), shoulder_r=(0.58, 0.40),
    elbow=(0.45, 0.50), elbow_r=(0.55, 0.50),
    wrist=(0.49, 0.60), wrist_r=(0.51, 0.60),
    hip=(0.50, 0.52), knee=(0.50, 0.68), ankle=(0.50, 0.80),
)
FRONT_TOP = make_pose(
    nose=(0.50, 0.20), ear=(0.52, 0.21),
    shoulder=(0.42, 0.30), shoulder_r=(0.58, 0.30),
    elbow=(0.44, 0.36), elbow_r=(0.56, 0.36),
    wrist=(0.49, 0.33), wrist_r=(0.51, 0.33),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
)
# Front-view one-hand clean: LEFT hand racked at the shoulder with a vertical
# forearm (elbow well below the wrist), right arm hanging.
FRONT_BOTTOM_1H = make_pose(
    nose=(0.50, 0.34), ear=(0.52, 0.33),
    shoulder=(0.42, 0.40), shoulder_r=(0.58, 0.40),
    elbow=(0.45, 0.50), elbow_r=(0.60, 0.44),
    wrist=(0.49, 0.60), wrist_r=(0.63, 0.50),
    hip=(0.50, 0.52), knee=(0.50, 0.68), ankle=(0.50, 0.80),
)
FRONT_TOP_CLEAN = make_pose(
    nose=(0.50, 0.20), ear=(0.52, 0.21),
    shoulder=(0.42, 0.30), shoulder_r=(0.58, 0.30),
    elbow=(0.44, 0.41), elbow_r=(0.60, 0.42),
    wrist=(0.45, 0.31), wrist_r=(0.63, 0.52),
    hip=(0.50, 0.50), knee=(0.50, 0.65), ankle=(0.50, 0.80),
)


def run_swing(
    bottom, top, reps=10, period_s=2.0, params=None, fps=FPS,
    kb_offset=None, mutate=None,
):
    """Drive a TechniqueAnalyzer through `reps` cosine swing cycles.

    `mutate` post-processes each interpolated pose (confidence knockouts);
    `kb_offset=(dx, dy)` feeds a tracked-bell position derived from the
    lifting (left) wrist — the production hand signal, otherwise untested
    through the analyzer.
    """
    analyzer = TechniqueAnalyzer(params=params)
    events = []
    snapshot = {}
    # Settling margin, not a whole extra cycle: at period_s=0.5 a fixed 0.5s
    # tail is one more rep, which made a 3-rep run report 4.
    steps = int((reps * period_s + min(0.5, period_s * 0.25)) * fps)
    for i in range(steps):
        t = i / fps
        u = 0.5 - 0.5 * math.cos(2 * math.pi * t / period_s)
        pose = lerp_pose(bottom, top, u)
        kb_pos = None
        if kb_offset is not None:
            kb_pos = (pose[9][0] + kb_offset[0], pose[9][1] + kb_offset[1])
        if mutate is not None:
            pose = mutate(pose)
        snapshot = analyzer.update(t, pose, kb_pos)
        events.extend(snapshot["events"])
    return analyzer, events, snapshot


def drop_conf(*indices):
    """Pose mutator: zero the confidence of the given keypoint indices."""
    def apply(pose):
        out = [list(k) for k in pose]
        for i in indices:
            out[i] = [out[i][0], out[i][1], 0.0]
        return out
    return apply


def clip_above(y_min):
    """Pose mutator: keypoints higher than y_min fall out of the frame."""
    def apply(pose):
        out = [list(k) for k in pose]
        for i, k in enumerate(out):
            if k[1] < y_min:
                out[i] = [k[0], k[1], 0.0]
        return out
    return apply


def run_profile(bottom, top, us, params=None, fps=FPS):
    """Drive a TechniqueAnalyzer through an explicit 0..1 interpolation path."""
    analyzer = TechniqueAnalyzer(params=params)
    events = []
    snapshot = {}
    for i, u in enumerate(us):
        snapshot = analyzer.update(i / fps, lerp_pose(bottom, top, u), None)
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


def test_rep_event_carries_apex_time():
    # `topT` feeds the worker's rep-screenshot lookup: each rep event must name
    # a plausible apex PTS — inside the run, and near the cosine cycle's crest
    # (odd multiples of period/2, here 1.0s, 3.0s, …).
    _, events, _ = run_swing(BOTTOM, TOP, reps=3)
    reps = rep_events(events)
    assert len(reps) == 3
    period_s = 2.0
    for i, r in enumerate(reps):
        top_t = r["topT"]
        assert isinstance(top_t, float)
        expected_apex = period_s / 2 + i * period_s
        assert abs(top_t - expected_apex) < period_s / 4, (
            f"rep {i}: topT={top_t}, expected ≈{expected_apex}"
        )


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


def test_tracker_carries_late_detection_forward():
    # The YOLO-World pass is detached and lands a frame or two late. Gating and
    # translation both use the wrist snapshot from the frame it RAN on, so the
    # box arrives at the hand's current position instead of its old one.
    tracker = KettlebellTracker()
    wrists_then = {0: (0.5, 0.60), 1: (0.5, 0.60)}
    tracker.observe_pose(0.0, wrists_then)
    tracker.observe_pose(0.1, {0: (0.5, 0.40), 1: (0.5, 0.40)})  # hands rose
    tracker.observe_detections(
        0.0,
        [{"x": 0.46, "y": 0.56, "w": 0.08, "h": 0.08, "conf": 0.4}],
        wrists_at=wrists_then,
    )
    box = tracker.current()
    assert abs(box["y"] - (0.56 - 0.20)) < 1e-6, "box must land on the hand now"
    assert abs(box["x"] - 0.46) < 1e-6

    # Without the snapshot the same stale detection would be gated against the
    # CURRENT wrists — far enough away here that it is rejected outright.
    stale = KettlebellTracker()
    stale.observe_pose(0.0, wrists_then)
    stale.observe_pose(0.1, {0: (0.5, 0.1), 1: (0.5, 0.1)})
    stale.observe_detections(
        0.0, [{"x": 0.46, "y": 0.56, "w": 0.08, "h": 0.08, "conf": 0.4}]
    )
    assert stale.current() is None


def test_too_low_rule():
    _, events, _ = run_swing(BOTTOM, TOP_LOW)
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all("too_low" in r["issues"] for r in reps), [r["issues"] for r in reps]

    # 'overhead-ok' only relaxes the ceiling, so a shallow swing still counts.
    _, events_ok, _ = run_swing(
        BOTTOM, TOP_LOW, params={"swingTopRule": "overhead-ok"}
    )
    reps_ok = rep_events(events_ok)
    assert reps_ok and all("too_low" in r["issues"] for r in reps_ok)

    # 'off' skips the height check entirely, as the manifest promises.
    _, events_off, _ = run_swing(BOTTOM, TOP_LOW, params={"swingTopRule": "off"})
    reps_off = rep_events(events_off)
    assert reps_off and all("too_low" not in r["issues"] for r in reps_off), [
        r["issues"] for r in reps_off
    ]


def test_overhead_ok_allows_american_height():
    _, events, _ = run_swing(
        BOTTOM, TOP_HIGH, params={"swingTopRule": "overhead-ok"}
    )
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all("too_high" not in r["issues"] for r in reps), [
        r["issues"] for r in reps
    ]


def test_fidget_is_not_a_rep():
    """Hand leaves the bottom zone but travels less than repSensitivity."""
    analyzer, events, _ = run_swing(BOTTOM, TOP_SHALLOW)
    assert not rep_events(events)
    assert analyzer.rep_count == 0


def test_slow_rep_counted_while_classifier_idle():
    """A rep slower than the classifier window used to be dropped twice over:
    once by the 5s duration gate, once because the sliding window had already
    fallen back to idle by the time the hand came back down."""
    analyzer, events, _ = run_swing(BOTTOM, TOP, reps=1, period_s=8.0)
    assert analyzer.classifier.effective() == "idle", (
        "fixture must exercise the idle path"
    )
    reps = rep_events(events)
    assert len(reps) == 1, f"expected 1 rep, got {len(reps)}"
    assert reps[0]["exercise"] == "swing"
    assert analyzer.rep_count == 1


def test_fast_rep_counted():
    """Reps quicker than the old 0.6s floor still count."""
    analyzer, events, _ = run_swing(BOTTOM, TOP, reps=3, period_s=0.5, fps=30)
    reps = rep_events(events)
    assert len(reps) == 3, f"expected 3 reps, got {len(reps)}"
    assert all(r["duration"] < 0.6 for r in reps), [r["duration"] for r in reps]
    assert analyzer.rep_count == 3


def test_snatch_not_judged_by_swing_rules():
    """The headline report: a clean snatch collecting swing faults."""
    _, events, _ = run_swing(BOTTOM_1H, TOP_SNATCH_1H)
    reps = rep_events(events)
    assert reps, "no reps segmented"
    for rep in reps:
        assert not ({"too_low", "too_high", "bent_arms"} & set(rep["issues"])), rep


def test_clean_is_counted_without_a_verdict():
    _, events, _ = run_swing(BOTTOM_1H, TOP_CLEAN_1H)
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all(r["exercise"] == "clean" for r in reps), [r["exercise"] for r in reps]
    assert all(r["verdict"] == "correct" and not r["issues"] for r in reps)


def test_front_view_swing_is_not_a_clean():
    """Tournament regression: filmed from the FRONT, the swing top projects the
    wrists next to the shoulders with a folded-looking elbow angle, which used
    to score nearly every swing as a clean (rack geometry on projection alone).
    The elbow-below-wrist rack gate keeps these as swings."""
    _, events, _ = run_swing(FRONT_BOTTOM, FRONT_TOP)
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all(r["exercise"] == "swing" for r in reps), [r["exercise"] for r in reps]


def test_front_view_clean_still_detected():
    """The rack gate must not lose a real front-view clean: vertical forearm,
    elbow hanging well below the racked wrist."""
    _, events, _ = run_swing(FRONT_BOTTOM_1H, FRONT_TOP_CLEAN)
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all(r["exercise"] == "clean" for r in reps), [r["exercise"] for r in reps]


def test_overhead_hold_completes_the_rep():
    """Holding the bell locked out keeps the phase on 'up' — the rep lands on
    the way down, however long the hold. No duration ceiling brings it back."""
    hold = [i / 20 for i in range(21)] + [1.0] * 120
    _, events, mid = run_profile(BOTTOM_1H, TOP_SNATCH_1H, hold)
    assert mid["phase"] == "up", mid["phase"]
    assert not rep_events(events)

    _, events, _ = run_profile(
        BOTTOM_1H, TOP_SNATCH_1H, hold + [1.0 - i / 20 for i in range(21)]
    )
    reps = rep_events(events)
    assert len(reps) == 1, f"expected 1 rep, got {len(reps)}"
    assert reps[0]["exercise"] == "snatch"


def test_pose_blackout_does_not_emit_a_rep():
    """Without a duration ceiling, a rep must not be stitched across a pose
    dropout — the apex frozen mid-pull would score a bogus fault."""
    analyzer = TechniqueAnalyzer()
    events = []
    for i, u in enumerate(i / 20 for i in range(15)):  # rise, then vanish
        events.extend(
            analyzer.update(i / FPS, lerp_pose(BOTTOM_1H, TOP_SNATCH_1H, u), None)[
                "events"
            ]
        )
    for i in range(15, 15 + 5 * FPS):  # 5s with no pose at all
        events.extend(analyzer.update(i / FPS, None, None)["events"])
    for j in range(FPS):  # back at the bottom
        events.extend(
            analyzer.update(
                (15 + 5 * FPS + j) / FPS, lerp_pose(BOTTOM_1H, TOP_SNATCH_1H, 0.0), None
            )["events"]
        )
    assert not rep_events(events), rep_events(events)
    assert analyzer.rep_count == 0


# A lift that stalls mid-pull: the hand stops rising (and dips a touch) around
# half height before punching through to the top. Real lifts do this — a snatch
# floats at the turnaround — and at <= 16Hz one flat sample is all it takes.
MIDPULL_STALL = (
    [i / 20 for i in range(10)]  # 0.00 .. 0.45, the pull
    + [0.45] * 4  # the float — hand hangs at half height
    + [0.42, 0.42]  # and settles back a touch before the punch
    + [0.5 + i / 20 for i in range(11)]  # 0.50 .. 1.00, punch to the top
    + [1.0 - i / 20 for i in range(21)]  # back down to the bottom
)


def test_apex_survives_midpull_stall():
    """The reported fault: taking the FIRST non-rising sample as the top froze
    it at half height, which then scored a full-height swing as shallow."""
    _, events, _ = run_profile(BOTTOM, TOP, MIDPULL_STALL)
    reps = rep_events(events)
    assert len(reps) == 1, f"expected 1 rep, got {len(reps)}"
    assert "too_low" not in reps[0]["issues"], reps[0]["issues"]
    assert reps[0]["verdict"] == "correct", reps[0]["issues"]


def test_apex_survives_midpull_stall_snatch():
    """Same stall on a one-hand snatch: the rep must still read as a snatch,
    which is what keeps the swing-only faults off a clean lockout."""
    _, events, _ = run_profile(BOTTOM_1H, TOP_SNATCH_1H, MIDPULL_STALL)
    reps = rep_events(events)
    assert len(reps) == 1, f"expected 1 rep, got {len(reps)}"
    assert reps[0]["exercise"] == "snatch", reps[0]
    assert reps[0]["verdict"] == "correct", reps[0]["issues"]


def test_analysis_interval_s():
    default = 1 / 16
    assert abs(analysis_interval_s({"analysisFps": 16}, default) - 0.0625) < 1e-9
    assert abs(analysis_interval_s({"analysisFps": 2}, default) - 0.5) < 1e-9
    # Sliders hand us strings on some transports; floats must work too.
    assert abs(analysis_interval_s({"analysisFps": "4"}, default) - 0.25) < 1e-9
    assert abs(analysis_interval_s({"analysisFps": 2.5}, default) - 0.4) < 1e-9

    # Absent or nonsense falls back to the worker's env baseline.
    for params in ({}, {"analysisFps": None}, {"analysisFps": "fast"},
                   {"analysisFps": 0}, {"analysisFps": -3}):
        assert analysis_interval_s(params, default) == default, params

    # A hand-edited config can slow the model down, never stall it.
    assert (
        analysis_interval_s({"analysisFps": 0.001}, default)
        == MAX_ANALYSIS_INTERVAL_S
    )


def test_analysis_rate_floor_still_counts_every_rep():
    """Guards the `analysisFps` slider's lower bound (8). Everything in the
    slider's range must count EVERY rep at a realistic cadence — a rate that
    silently drops reps is the exact fault this coach was just fixed for, so
    the floor is set by measurement, not by taste. Measured: at 6-7 fps a
    1.2s one-hand snatch loses a third of its reps, which is why 8 is the
    floor rather than something lower and cheaper."""
    for fps in (8, 10, 12, 16):
        for period_s in (1.2, 1.5, 2.0):
            for bottom, top in ((BOTTOM, TOP), (BOTTOM_1H, TOP_SNATCH_1H)):
                analyzer, events, _ = run_swing(
                    bottom, top, reps=6, period_s=period_s, fps=fps
                )
                got = len(rep_events(events))
                assert got == 6, f"{fps}fps / {period_s}s reps: counted {got}/6"
                assert analyzer.rep_count == got


def test_smoothing_is_time_based_not_sample_based():
    """The hand-height EMA must lag by a fixed TIME, not a fixed number of
    samples, or the analysis-rate slider would change how the phase machine
    behaves. Same movement at two rates must reach the same verdict."""
    verdicts = []
    for fps in (8, 16):
        _, events, _ = run_swing(BOTTOM, TOP, reps=4, period_s=1.5, fps=fps)
        reps = rep_events(events)
        assert len(reps) == 4, f"{fps}fps counted {len(reps)}/4"
        verdicts.append([(r["exercise"], r["verdict"]) for r in reps])
    assert verdicts[0] == verdicts[1], verdicts


def test_params_update_applies():
    analyzer = TechniqueAnalyzer()
    analyzer.set_params({"repSensitivity": 0.4, "hingeKneeMin": 90})
    assert analyzer.segmenter.rep_sensitivity == 0.4
    assert analyzer.params["hingeKneeMin"] == 90
    assert analyzer.params["swingTopRule"] == DEFAULT_PARAMS["swingTopRule"]
    assert analyzer.params["cameraView"] == "side"
    analyzer.set_params({"cameraView": "front"})
    assert analyzer.params["cameraView"] == "front"


def test_front_mode_suppresses_side_only_verdicts():
    """cameraView='front': knee/elbow/back angles are depth-axis projections,
    so squatting / bent_arms / rounded_back must not fire — reps still count."""
    for bottom, top in (
        (BOTTOM_SQUAT, TOP),
        (BOTTOM, TOP_BENT_ARMS),
        (BOTTOM_ROUNDED, TOP),
    ):
        _, events, _ = run_swing(bottom, top, params={"cameraView": "front"})
        reps = rep_events(events)
        assert reps, "no reps segmented"
        assert all(r["verdict"] == "correct" for r in reps), [
            r["issues"] for r in reps
        ]


def test_front_mode_keeps_height_checks():
    """Pure-height checks are view-independent and must survive front mode."""
    _, events, _ = run_swing(BOTTOM, TOP_HIGH, params={"cameraView": "front"})
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all("too_high" in r["issues"] for r in reps), [r["issues"] for r in reps]


def test_front_mode_keeps_soft_lockout():
    """The snatch's only verdict reads the elbow at overhead lockout, where the
    arm extends in the image plane in either view — front mode keeps it."""
    _, events, _ = run_swing(
        BOTTOM_1H, TOP_SNATCH_1H_SOFT, params={"cameraView": "front"},
    )
    reps = rep_events(events)
    assert reps, "no reps segmented"
    assert all("soft_lockout" in r["issues"] for r in reps), [
        r["issues"] for r in reps
    ]


def test_reps_survive_missing_dominant_ankle():
    """Feet half out of frame (the dominant-side ankle below confidence): the
    segmenter used to silently no-op via body_height() and zero whole sets."""
    _, events, _ = run_swing(
        BOTTOM_1H, TOP_SNATCH_1H, reps=6, mutate=drop_conf(15),
    )
    reps = rep_events(events)
    assert len(reps) == 6, f"got {len(reps)}"
    assert all(r["exercise"] == "snatch" for r in reps), [r["exercise"] for r in reps]


def test_reps_survive_missing_both_ankles():
    """Feet fully out of frame: the knee-derived scale keeps counting, and the
    fullBody flag flips so the phone can tell the athlete to back up."""
    _, events, snapshot = run_swing(
        BOTTOM_1H, TOP_SNATCH_1H, reps=6, mutate=drop_conf(15, 16),
    )
    reps = rep_events(events)
    assert len(reps) == 6, f"got {len(reps)}"
    assert snapshot["fullBody"] is False


def test_reps_survive_missing_nose():
    """Head cropped/turned away: the ear keeps the body scale and the
    shoulder-margin rescue keeps the reps classed as snatches."""
    _, events, _ = run_swing(
        BOTTOM_1H, TOP_SNATCH_1H, reps=6, mutate=drop_conf(0),
    )
    reps = rep_events(events)
    assert len(reps) == 6, f"got {len(reps)}"
    assert all(r["exercise"] == "snatch" for r in reps), [r["exercise"] for r in reps]


def test_full_body_flag_on_clean_fixture():
    _, _, snapshot = run_swing(BOTTOM_1H, TOP_SNATCH_1H, reps=2)
    assert snapshot["fullBody"] is True


def test_shallow_backswing_snatch_counts():
    """One-hand snatch turning around at hip+0.018 — the old absolute bottom
    zone never fires, so the machine used to sit at 0 through whole sets.
    The confirmed-local-minimum arm/complete paths must count every rep."""
    _, events, _ = run_swing(BOTTOM_1H_SHALLOW, TOP_SNATCH_1H, reps=6)
    reps = rep_events(events)
    assert len(reps) == 6, f"got {len(reps)}"
    assert all(r["exercise"] == "snatch" for r in reps), [r["exercise"] for r in reps]


def test_shallow_backswing_swing_counts():
    """Two-hand swing with the same shallow turnaround still counts."""
    _, events, _ = run_swing(BOTTOM_SHALLOW_2H, TOP, reps=6)
    reps = rep_events(events)
    assert len(reps) == 6, f"got {len(reps)}"


def test_chest_height_dip_does_not_arm():
    """Oscillation entirely above the hip line must never arm a rep — the
    local-minimum arm keeps the swing floor at the hip."""
    us = [0.62 + 0.18 * math.sin(i / 3.0) for i in range(60)]
    _, events, _ = run_profile(BOTTOM, TOP, us)
    assert rep_events(events) == [], rep_events(events)


def test_kb_box_floating_above_hand_is_rejected():
    """A drifted bell box riding above the gripping hand must not drive the
    phase machine — a constant +0.06 offset used to zero whole sets."""
    _, events, _ = run_swing(
        BOTTOM_1H, TOP_SNATCH_1H, reps=6, kb_offset=(0.0, -0.06),
    )
    reps = rep_events(events)
    assert len(reps) == 6, f"got {len(reps)}"


def test_kb_box_hanging_below_hand_still_tracks():
    """Normal geometry (bell just below the wrist) keeps the kb-driven path
    live end-to-end — previously untested through TechniqueAnalyzer."""
    _, events, _ = run_swing(
        BOTTOM_1H, TOP_SNATCH_1H, reps=6, kb_offset=(0.0, 0.04),
    )
    reps = rep_events(events)
    assert len(reps) == 6, f"got {len(reps)}"
    assert all(r["exercise"] == "snatch" for r in reps), [r["exercise"] for r in reps]


def test_clipped_overhead_still_scores_snatch():
    """Frame cut just above the shoulders: the lockout arm (and head) drop
    out at the apex, which used to stamp reps swing + too_high. The smoothed
    apex height vs the shoulder line rescues the classification."""
    _, events, _ = run_swing(
        BOTTOM_1H, TOP_SNATCH_1H, reps=6, mutate=clip_above(0.22),
    )
    reps = rep_events(events)
    assert len(reps) == 6, f"got {len(reps)}"
    assert all(r["exercise"] == "snatch" for r in reps), [
        (r["exercise"], r["issues"]) for r in reps
    ]
    assert all("too_high" not in r["issues"] for r in reps)


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
