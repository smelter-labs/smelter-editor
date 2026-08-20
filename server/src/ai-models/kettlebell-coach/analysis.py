"""Pure exercise-analysis logic for the kettlebell-coach worker.

Everything here is deliberately dependency-free (stdlib math only) so it can be
unit-tested on synthetic keypoint sequences without torch/ultralytics and later
swapped for an ML classifier behind the same TechniqueAnalyzer interface.

Coordinates are normalized to the frame (0..1, y grows DOWNWARD — smaller y is
physically higher). Keypoints follow the 17-point COCO order YOLO-pose emits.
All heuristics assume a roughly side-on camera; that limitation is surfaced in
the manifest param descriptions.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Any, Optional

# COCO keypoint indices (YOLO-pose order).
NOSE = 0
L_EAR, R_EAR = 3, 4
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW = 7, 8
L_WRIST, R_WRIST = 9, 10
L_HIP, R_HIP = 11, 12
L_KNEE, R_KNEE = 13, 14
L_ANKLE, R_ANKLE = 15, 16

# Minimum keypoint confidence before a joint participates in any heuristic.
KPT_CONF_MIN = 0.3

# Below this hand travel (fraction of body height) a window counts as idle.
IDLE_TRAVEL_MIN = 0.15

# Top-of-cycle geometry thresholds, shared by the window classifier and the
# per-rep judge (see classify_top).
SNATCH_ELBOW_MIN = 120.0
CLEAN_ELBOW_MAX = 100.0
CLEAN_RACK_DIST = 0.2
# In a rack the forearm is near-vertical, so the elbow hangs well BELOW the
# wrist (fraction of body height). A swing top has the elbow at wrist height in
# ANY view — which is what a front-facing camera needs: foreshortened arms put
# the wrist next to the shoulder and fold the projected elbow angle, so without
# this gate almost every front-view swing reads as a clean.
CLEAN_ELBOW_BELOW = 0.08

DEFAULT_PARAMS: dict[str, Any] = {
    "repSensitivity": 0.25,
    "swingTopRule": "hardstyle",
    "hingeKneeMin": 110.0,
    "armStraightMin": 150.0,
    "backAlignMin": 140.0,
}

# Longest gap the pacing param is allowed to ask for. A hand-edited config
# should slow the model down, never stall it into looking dead.
MAX_ANALYSIS_INTERVAL_S = 2.0


def analysis_interval_s(params: dict[str, Any], default_s: float) -> float:
    """Seconds between analysis passes for one input.

    `analysisFps` is the user-facing knob (frames per second the model
    inspects); `default_s` is the worker's env baseline, used whenever the
    param is absent or nonsense. Lives here rather than in the worker so it is
    covered by the dependency-free unit tests.
    """
    fps = params.get("analysisFps")
    if fps is None:
        return default_s
    try:
        value = float(fps)
    except (TypeError, ValueError):
        return default_s
    if value <= 0:
        return default_s
    return min(1.0 / value, MAX_ANALYSIS_INTERVAL_S)


def angle_deg(
    a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]
) -> Optional[float]:
    """Angle at vertex b between rays b->a and b->c, in degrees."""
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    n1 = math.hypot(*v1)
    n2 = math.hypot(*v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


class PoseFrame:
    """One frame of 17 [x, y, conf] keypoints with side-aware joint access.

    The DOMINANT side (higher mean confidence — with a side-on camera the far
    side is mostly occluded) backs the leg/torso angles. Arm joints also come
    in explicit per-side variants because one-hand lifts (snatch/clean) make
    the lifting arm and the dominant side two different things.
    """

    def __init__(self, kpts: list[list[float]]):
        self.kpts = kpts
        left = [kpts[i][2] for i in (L_SHOULDER, L_ELBOW, L_WRIST, L_HIP, L_KNEE)]
        right = [kpts[i][2] for i in (R_SHOULDER, R_ELBOW, R_WRIST, R_HIP, R_KNEE)]
        self.side_offset = 0 if sum(left) >= sum(right) else 1

    def point(self, left_index: int) -> Optional[tuple[float, float]]:
        """Dominant-side keypoint (pass the LEFT index; offset picks the side)."""
        return self.point_side(left_index, self.side_offset)

    def point_side(
        self, left_index: int, side: int
    ) -> Optional[tuple[float, float]]:
        """Keypoint on an explicit side: 0 = left, 1 = right."""
        kpt = self.kpts[left_index + side]
        if kpt[2] < KPT_CONF_MIN:
            return None
        return (kpt[0], kpt[1])

    def point_any(self, left_index: int) -> Optional[tuple[float, float]]:
        """Dominant-side keypoint, falling back to the other side when the
        dominant one is below confidence. For scale/height geometry either
        side serves; angle heuristics stay side-consistent via point()."""
        p = self.point_side(left_index, self.side_offset)
        if p is not None:
            return p
        return self.point_side(left_index, 1 - self.side_offset)

    def y(self, left_index: int) -> Optional[float]:
        p = self.point(left_index)
        return p[1] if p else None

    def wrist(self, side: int) -> Optional[tuple[float, float]]:
        return self.point_side(L_WRIST, side)

    def wrists(self) -> dict[int, tuple[float, float]]:
        """Visible wrists keyed by side (0 = left, 1 = right)."""
        out: dict[int, tuple[float, float]] = {}
        for side in (0, 1):
            w = self.wrist(side)
            if w is not None:
                out[side] = w
        return out

    def wrist_mid(self) -> Optional[tuple[float, float]]:
        """Midpoint of the visible wrists (both hands hold the bell in a swing)."""
        pts = list(self.wrists().values())
        if not pts:
            return None
        return (
            sum(p[0] for p in pts) / len(pts),
            sum(p[1] for p in pts) / len(pts),
        )

    def body_height(self) -> Optional[float]:
        """Vertical scale of the athlete, with fallbacks so a clipped frame
        degrades instead of silently disabling every downstream heuristic —
        the rep segmenter used to no-op whenever the nose or the dominant-side
        ankle dropped below confidence, zeroing whole sets filmed head-to-knee.

        Chain: nose (else either ear) as the head reference; an ankle on
        either side; with no ankle, a knee-derived estimate (nose→knee is
        ~0.75 of nose→ankle on a standing adult)."""
        nose = self.kpts[NOSE]
        head_y: Optional[float] = None
        if nose[2] >= KPT_CONF_MIN:
            head_y = nose[1]
        else:
            ear = self.point_any(L_EAR)
            if ear is not None:
                head_y = ear[1]
        if head_y is None:
            return None
        ankle = self.point_any(L_ANKLE)
        if ankle is not None:
            return abs(ankle[1] - head_y)
        knee = self.point_any(L_KNEE)
        if knee is not None and knee[1] > head_y:
            return (knee[1] - head_y) / 0.75
        return None

    def full_body_visible(self) -> bool:
        """Head reference AND at least one confident ankle. Deliberately
        stricter than what body_height() can recover from: this drives the
        'step back, whole body in frame' hint, not any math."""
        nose = self.kpts[NOSE]
        has_head = nose[2] >= KPT_CONF_MIN or self.point_any(L_EAR) is not None
        has_ankle = (
            self.point_side(L_ANKLE, 0) is not None
            or self.point_side(L_ANKLE, 1) is not None
        )
        return has_head and has_ankle

    def elbow_angle(self, side: Optional[int] = None) -> Optional[float]:
        """Elbow angle on `side` (0/1), or the dominant side when None."""
        offset = self.side_offset if side is None else side
        s = self.point_side(L_SHOULDER, offset)
        e = self.point_side(L_ELBOW, offset)
        w = self.point_side(L_WRIST, offset)
        if s is None or e is None or w is None:
            return None
        return angle_deg(s, e, w)

    def knee_angle(self) -> Optional[float]:
        h, k, a = self.point(L_HIP), self.point(L_KNEE), self.point(L_ANKLE)
        if h is None or k is None or a is None:
            return None
        return angle_deg(h, k, a)

    def hip_angle(self) -> Optional[float]:
        s, h, k = self.point(L_SHOULDER), self.point(L_HIP), self.point(L_KNEE)
        if s is None or h is None or k is None:
            return None
        return angle_deg(s, h, k)

    def back_angle(self) -> Optional[float]:
        """Ear-shoulder-hip angle: ~180 = neutral spine, small = rounded (2D proxy)."""
        e, s, h = self.point(L_EAR), self.point(L_SHOULDER), self.point(L_HIP)
        if e is None or s is None or h is None:
            return None
        return angle_deg(e, s, h)


def _iou(a: dict[str, float], b: dict[str, float]) -> float:
    ax2, ay2 = a["x"] + a["w"], a["y"] + a["h"]
    bx2, by2 = b["x"] + b["w"], b["y"] + b["h"]
    iw = min(ax2, bx2) - max(a["x"], b["x"])
    ih = min(ay2, by2) - max(a["y"], b["y"])
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union > 0 else 0.0


class KettlebellTracker:
    """Tracks the bell between sparse YOLO-World detections.

    The bell is in one (or both) of the athlete's hands for all three lifts,
    so between detections the last box is translated by the delta of the wrist
    NEAREST the box — per side, not the midpoint, so a one-hand snatch tracks
    at full speed while the idle arm hangs still. A box that hasn't been
    re-acquired for `lost_after_s` is dropped and callers fall back to the
    wrists.
    """

    # Candidate must be within this normalized distance of some visible wrist.
    WRIST_GATE = 0.25

    def __init__(self, lost_after_s: float = 1.5, trajectory_s: float = 5.0):
        self.lost_after_s = lost_after_s
        self.trajectory_s = trajectory_s
        self.box: Optional[dict[str, float]] = None
        self.last_detection_t: Optional[float] = None
        # side (0 = left, 1 = right) → last seen wrist position.
        self.last_wrists: dict[int, tuple[float, float]] = {}
        self.trajectory: deque[tuple[float, float, float]] = deque()

    def observe_pose(
        self, t: float, wrists: Optional[dict[int, tuple[float, float]]]
    ) -> None:
        """Advance the held box by the nearest wrist's delta; expire stale tracks."""
        wrists = wrists or {}
        if wrists and self.box is not None and self.last_wrists:
            cx = self.box["x"] + self.box["w"] / 2
            cy = self.box["y"] + self.box["h"] / 2
            carriers = [s for s in wrists if s in self.last_wrists]
            if carriers:
                side = min(
                    carriers,
                    key=lambda s: math.hypot(
                        self.last_wrists[s][0] - cx, self.last_wrists[s][1] - cy
                    ),
                )
                self.box["x"] += wrists[side][0] - self.last_wrists[side][0]
                self.box["y"] += wrists[side][1] - self.last_wrists[side][1]
        self.last_wrists.update(wrists)
        if (
            self.box is not None
            and self.last_detection_t is not None
            and t - self.last_detection_t > self.lost_after_s
        ):
            self.box = None
        self._record(t)

    def observe_detections(
        self,
        t: float,
        boxes: list[dict[str, float]],
        wrists_at: Optional[dict[int, tuple[float, float]]] = None,
    ) -> None:
        """Fold in a YOLO-World detection pass (may be empty).

        `wrists_at` is the wrist snapshot from the frame the detector actually
        ran on. The pass is slow enough to land a frame or two late, so it gates
        candidates against the hands as they were THEN, and translates the
        accepted box by the wrist travel since — without it a late detection
        drags the bell back to where it was when the pass started.
        """
        gate_wrists = wrists_at if wrists_at else self.last_wrists
        best = None
        if self.box is not None:
            best = max(boxes, key=lambda b: _iou(b, self.box), default=None)
            if best is not None and _iou(best, self.box) <= 0.05:
                best = None
        if best is None and gate_wrists:
            near = [
                b
                for b in boxes
                if any(
                    math.hypot(
                        b["x"] + b["w"] / 2 - w[0], b["y"] + b["h"] / 2 - w[1]
                    )
                    < self.WRIST_GATE
                    for w in gate_wrists.values()
                )
            ]
            best = max(near, key=lambda b: b["conf"], default=None)
        if best is not None:
            box = dict(best)
            if wrists_at:
                carriers = [s for s in wrists_at if s in self.last_wrists]
                if carriers:
                    cx = box["x"] + box["w"] / 2
                    cy = box["y"] + box["h"] / 2
                    side = min(
                        carriers,
                        key=lambda s: math.hypot(
                            wrists_at[s][0] - cx, wrists_at[s][1] - cy
                        ),
                    )
                    box["x"] += self.last_wrists[side][0] - wrists_at[side][0]
                    box["y"] += self.last_wrists[side][1] - wrists_at[side][1]
            self.box = box
            self.last_detection_t = t
            self._record(t)

    def current(self) -> Optional[dict[str, float]]:
        return dict(self.box) if self.box is not None else None

    def position(self) -> Optional[tuple[float, float]]:
        """Best bell-position estimate: tracked box center, else wrist midpoint."""
        if self.box is not None:
            return (self.box["x"] + self.box["w"] / 2, self.box["y"] + self.box["h"] / 2)
        if self.last_wrists:
            pts = list(self.last_wrists.values())
            return (
                sum(p[0] for p in pts) / len(pts),
                sum(p[1] for p in pts) / len(pts),
            )
        return None

    def _record(self, t: float) -> None:
        pos = self.position()
        if pos is None:
            return
        self.trajectory.append((t, pos[0], pos[1]))
        while self.trajectory and t - self.trajectory[0][0] > self.trajectory_s:
            self.trajectory.popleft()


def lifting_side(
    side: Optional[int], wrists: dict[int, tuple[float, float]]
) -> Optional[int]:
    """The arm doing the work: the active side when visible, else the HIGHEST
    visible wrist — a snatch is one-handed, so the wrist midpoint would sit at
    chest height and never read as overhead. Shared so the window classifier
    and the per-rep apex snapshot can't drift apart."""
    if side is not None and wrists.get(side) is not None:
        return side
    return min(wrists, key=lambda s: wrists[s][1]) if wrists else None


def classify_top(
    wrist: Optional[tuple[float, float]],
    elbow: Optional[float],
    shoulder: Optional[tuple[float, float]],
    nose_y: Optional[float],
    body_h: float,
    elbow_pt: Optional[tuple[float, float]] = None,
) -> str:
    """swing | clean | snatch from ONE top-of-cycle sample.

    Shared by the sliding-window classifier (which drives the displayed label)
    and by classify_rep() (which decides how a completed rep is scored), so the
    two can never disagree about what counts as overhead or racked.
    """
    # Overhead lockout → snatch. The elbow gate is loose on purpose: a
    # pressed-out (soft) lockout is still a snatch — judged, not reclassed.
    if (
        wrist is not None
        and nose_y is not None
        and wrist[1] < nose_y
        and (elbow is None or elbow > SNATCH_ELBOW_MIN)
    ):
        return "snatch"
    # Bell parked at the shoulder with a folded arm AND the elbow hanging
    # below the wrist → clean (rack position). All three legs are needed:
    # facing the camera, a swing top passes the first two on projection alone.
    if (
        elbow is not None
        and elbow < CLEAN_ELBOW_MAX
        and wrist is not None
        and shoulder is not None
        and math.hypot(wrist[0] - shoulder[0], wrist[1] - shoulder[1])
        < CLEAN_RACK_DIST * body_h
        and elbow_pt is not None
        and elbow_pt[1] - wrist[1] > CLEAN_ELBOW_BELOW * body_h
    ):
        return "clean"
    return "swing"


def classify_rep(rep: dict[str, Any]) -> str:
    """The lift a completed rep actually was, read off its own apex sample.

    Judging from the rep's own top rather than from the sliding-window class is
    what keeps a clean snatch off the swing rules: the window is often still
    settling (or already back on idle) by the time the hand returns to the
    bottom, and a snatch scored as a swing collects a bogus `too_low`.
    """
    result = classify_top(
        rep.get("top_wrist"),
        rep.get("top_elbow"),
        rep.get("top_shoulder"),
        rep.get("top_nose_y"),
        rep.get("top_body_h") or rep.get("body_h") or 0.5,
        rep.get("top_elbow_pt"),
    )
    if result != "swing":
        return result
    # Clipped-lockout rescue: an overhead frame routinely cuts the working
    # wrist out of the top of the picture, so `top_wrist` silently becomes
    # the FREE hand (lifting_side falls back to the highest visible wrist)
    # and the rep reads as a swing — then hardstyle flags the very lockout
    # that defines the lift as `too_high`. The smoothed apex height is
    # keypoint-independent: genuinely above the nose (or well above the
    # shoulder line when the head is clipped too) means snatch.
    top_y = rep.get("top_y")
    if top_y is not None:
        nose_y = rep.get("top_nose_y")
        if nose_y is not None:
            if top_y < nose_y:
                return "snatch"
        else:
            shoulder_y = rep.get("top_shoulder_y")
            body_h = rep.get("top_body_h") or rep.get("body_h") or 0.5
            if shoulder_y is not None and shoulder_y - top_y > 0.10 * body_h:
                return "snatch"
    return "swing"


class ExerciseClassifier:
    """Heuristic swing/clean/snatch/idle classifier on a sliding pose window.

    Raw class is re-evaluated every sample over the last `window_s` seconds;
    the OFFICIAL class only flips after the same raw class has persisted for
    `dwell_s` (in-worker hysteresis — RoomState adds its own on top). Designed
    to be swapped for an ML sequence model behind the same update() interface.
    """

    def __init__(self, window_s: float = 3.0, dwell_s: float = 1.5):
        self.window_s = window_s
        self.dwell_s = dwell_s
        self.samples: deque[dict[str, Any]] = deque()
        self.current = "idle"
        self._pending: Optional[str] = None
        self._pending_since = 0.0

    def update(
        self,
        t: float,
        frame: PoseFrame,
        hand_y: float,
        active_side: Optional[int] = None,
    ) -> Optional[str]:
        """Feed one sample; returns the new class when the official one flips."""
        self.samples.append(
            {
                "t": t,
                "hand_y": hand_y,
                "side": active_side,
                "wrists": frame.wrists(),
                "elbows": {s: frame.elbow_angle(s) for s in (0, 1)},
                "elbow_pts": {s: frame.point_side(L_ELBOW, s) for s in (0, 1)},
                "shoulders": {s: frame.point_side(L_SHOULDER, s) for s in (0, 1)},
                "nose_y": frame.kpts[NOSE][1] if frame.kpts[NOSE][2] >= KPT_CONF_MIN else None,
                "hip_y": frame.y(L_HIP),
                "body_h": frame.body_height(),
            }
        )
        while self.samples and t - self.samples[0]["t"] > self.window_s:
            self.samples.popleft()

        raw = self._classify_window()
        if raw == self.current:
            self._pending = None
        elif raw != self._pending:
            self._pending = raw
            self._pending_since = t
        elif t - self._pending_since >= self.dwell_s:
            self.current = raw
            self._pending = None
            return raw
        return None

    def effective(self) -> str:
        """Best current guess (pending candidate wins) — gates rep counting so
        the first swing rep isn't lost to the dwell window."""
        return self._pending or self.current

    def _classify_window(self) -> str:
        if len(self.samples) < 4:
            return "idle"
        ys = [s["hand_y"] for s in self.samples]
        heights = [s["body_h"] for s in self.samples if s["body_h"]]
        body_h = sorted(heights)[len(heights) // 2] if heights else 0.5
        if max(ys) - min(ys) < IDLE_TRAVEL_MIN * body_h:
            return "idle"

        # Cyclicity: physical up-moves cross the window mean going to smaller y.
        mean_y = sum(ys) / len(ys)
        crossings = sum(
            1
            for prev, cur in zip(ys, list(ys)[1:])
            if prev > mean_y >= cur
        )
        if crossings == 0:
            return "idle"

        top = min(self.samples, key=lambda s: s["hand_y"])
        # Judge the LIFTING arm at the top of the cycle.
        wrists: dict[int, tuple[float, float]] = top["wrists"]
        side = lifting_side(top["side"], wrists)
        wrist = wrists.get(side) if side is not None else None
        elbow = top["elbows"].get(side) if side is not None else None
        elbow_pt = top["elbow_pts"].get(side) if side is not None else None
        shoulder = top["shoulders"].get(side) if side is not None else None
        nose_y = top["nose_y"]
        body_top = top["body_h"] or body_h

        return classify_top(wrist, elbow, shoulder, nose_y, body_top, elbow_pt)


class SwingRepSegmenter:
    """Phase machine (bottom → up → top → down) on the hand/bell height.

    Segments swing reps and collects the per-rep stats judge_swing_rep() needs.
    Rep boundaries — not frames — are the atomic verdict unit, which is what
    keeps downstream events from flickering.
    """

    # Hand this far below the hip line (fraction of body height) = bottom zone.
    BOTTOM_MARGIN = 0.05
    # How far (fraction of body height) the hand must come back DOWN before the
    # running apex counts as the top. A snatch floats at the turnaround and
    # analysis runs at <= 16Hz through an alpha-0.5 EMA, so a single flat
    # sample must not be allowed to freeze the top at chest height — that is
    # what used to score a clean snatch as a shallow swing. 0.05 tolerates a
    # mid-pull dip of ~12% of the lift's range; every synthetic fixture is
    # bit-identical anywhere in 0.02..0.12, so the headroom is free.
    TOP_MARGIN = 0.05
    # A gap longer than this is a lost athlete, not a slow rep. Duration no
    # longer filters reps (every full cycle counts), so this is what stops a
    # rep being stitched across a pose blackout: the EMA and the in-flight
    # apex are both stale by then, so the machine starts clean instead.
    STALE_GAP_S = 1.5
    # Hand-height smoothing as a TIME constant, not a per-sample weight. The
    # analysis rate is user-tunable, so a fixed alpha would mean a fixed lag in
    # SAMPLES: at 6Hz the old alpha of 0.5 was a third of a second of lag over
    # a swing that lasts one, and the phase machine stopped seeing the
    # turnarounds at all. 0.08s is about what that alpha worked out to at the
    # default 16Hz, and it holds across the whole slider range — measured, the
    # band 0.05-0.10 segments every fixture from 0.5s to 2s reps.
    SMOOTH_TAU_S = 0.08
    # Rebound (fraction of body height) that confirms a local minimum — the
    # same proven band as TOP_MARGIN, applied at the other turnaround. This is
    # what lets a SHALLOW backswing arm/complete a cycle: a one-hand snatch
    # often turns around at upper-thigh height, above the absolute bottom
    # zone, and the machine used to sit in 'bottom' (or jam in 'down')
    # through whole sets. The absolute zone stays as the fast path.
    BOTTOM_CONFIRM_MARGIN = 0.05
    # A descent counts as returned once it has covered this fraction of the
    # rep's own bottom→top span (rep-relative, like the classifier's travel
    # logic — absolute geometry is exactly what failed for shallow sets).
    RETURN_FRAC = 0.75

    def __init__(self, rep_sensitivity: float = 0.25):
        self.rep_sensitivity = rep_sensitivity
        self.phase: Optional[str] = None  # None until a person is seen
        self._y: Optional[float] = None
        self._prev: Optional[tuple[float, float]] = None  # (t, smoothed y)
        self._rep: dict[str, Any] = {}
        # Last directly-measured (t, hip_y, body_h) — substituted while the
        # hip/scale is momentarily clipped so a set doesn't silently stall.
        self._geom: Optional[tuple[float, float, float]] = None
        # Lowest point (max y, smoothed) + frame stats since entering
        # 'bottom' — arms a shallow backswing on a confirmed local minimum.
        self._hang: Optional[dict[str, Any]] = None
        # Lowest point of the current descent ('down') — completes a shallow
        # return on a confirmed local minimum within the rep's own span.
        self._descend: Optional[dict[str, Any]] = None

    def update(
        self,
        t: float,
        frame: PoseFrame,
        hand_y: float,
        active_side: Optional[int] = None,
    ) -> Optional[dict[str, Any]]:
        """Feed one sample; returns raw rep stats when a rep completes."""
        if self._prev is not None and t - self._prev[0] > self.STALE_GAP_S:
            self.phase = None
            self._y = None
            self._prev = None
            self._rep = {}
            self._geom = None
            self._hang = None
            self._descend = None

        hip_p = frame.point_any(L_HIP)
        hip_y = hip_p[1] if hip_p is not None else None
        body_h = frame.body_height()
        if hip_y is not None and body_h is not None:
            self._geom = (t, hip_y, body_h)
        else:
            # Mirror _classify_window's fallback in spirit, scoped to the
            # stale gap: reuse the last measured geometry rather than no-op —
            # a momentarily clipped hip/scale must not stall a live set.
            if self._geom is None or t - self._geom[0] > self.STALE_GAP_S:
                return None
            if hip_y is None:
                hip_y = self._geom[1]
            if body_h is None:
                body_h = self._geom[2]

        dt = t - self._prev[0] if self._prev is not None else 0.0
        if self._y is None or dt <= 0:
            self._y = hand_y
        else:
            alpha = 1.0 - math.exp(-dt / self.SMOOTH_TAU_S)
            self._y = alpha * hand_y + (1 - alpha) * self._y
        y = self._y
        vy = 0.0
        if self._prev is not None and t > self._prev[0]:
            vy = (y - self._prev[1]) / (t - self._prev[0])
        self._prev = (t, y)

        in_bottom = y > hip_y + self.BOTTOM_MARGIN * body_h

        if self.phase in (None, "bottom"):
            self.phase = "bottom"
            # Track the hang low regardless of the absolute zone — the arm
            # for shallow backswings that never dip below hip + margin.
            if self._hang is None or y >= self._hang["y"]:
                self._hang = {
                    "y": y,
                    "t": t,
                    "knee": frame.knee_angle(),
                    "hip": frame.hip_angle(),
                    "back": frame.back_angle(),
                }
            if in_bottom:
                # Keep refreshing the bottom-most stats until the swing starts.
                if not self._rep or y >= self._rep["bottom_y"]:
                    self._rep = {
                        "bottom_y": y,
                        "bottom_knee": frame.knee_angle(),
                        "bottom_hip": frame.hip_angle(),
                        "bottom_back": frame.back_angle(),
                        "start_t": t,
                        "min_elbow": None,
                        "body_h": body_h,
                    }
                else:
                    self._rep["start_t"] = t
            elif (
                not self._rep
                and self._hang["y"] > hip_y
                and self._hang["y"] - y
                >= self.BOTTOM_CONFIRM_MARGIN * body_h
            ):
                # Confirmed local minimum below the hip line: arm the rep
                # from the hang-low snapshot (the absolute zone never fired).
                self._rep = {
                    "bottom_y": self._hang["y"],
                    "bottom_knee": self._hang["knee"],
                    "bottom_hip": self._hang["hip"],
                    "bottom_back": self._hang["back"],
                    "start_t": self._hang["t"],
                    "min_elbow": None,
                    "body_h": body_h,
                }
            if self.phase == "bottom" and self._rep and not in_bottom and vy < 0:
                self.phase = "up"
                self._hang = None
        if self.phase == "up":
            # Arm checks follow the LIFTING arm (one-hand lifts), falling back
            # to the dominant side for two-hand swings.
            elbow = frame.elbow_angle(active_side)
            if elbow is not None:
                cur = self._rep.get("min_elbow")
                self._rep["min_elbow"] = elbow if cur is None else min(cur, elbow)
            top_y = self._rep.get("top_y")
            if top_y is None or y < top_y:
                self._record_top(t, frame, y, active_side)
                top_y = y
            # The apex is confirmed once the hand has come back down past
            # TOP_MARGIN — or the moment it is back in the bottom zone, which
            # also covers a lift whose descent we only see in one sample.
            if in_bottom or y - top_y >= self.TOP_MARGIN * self._rep["body_h"]:
                travel = self._rep["bottom_y"] - top_y
                if travel < self.rep_sensitivity * self._rep["body_h"]:
                    self.phase = "bottom"  # fidget, not a rep
                    self._rep = {}
                    self._hang = None
                else:
                    self.phase = "down"
                    self._descend = None
        if self.phase == "down":
            if in_bottom:
                self.phase = "bottom"
                self._hang = None
                self._descend = None
                rep = self._rep
                self._rep = {}
                # Every full cycle counts, however fast or slow — a rep held
                # overhead or snapped off quickly is still a rep. Duration is
                # kept for diagnostics, it no longer gates.
                rep["duration"] = t - rep["start_t"]
                return rep
            # Shallow return: the descent turned around below the hip line
            # but above the absolute zone. Complete on a confirmed local
            # minimum once the hand has covered RETURN_FRAC of this rep's own
            # span — and seed the next cycle from that low, so back-to-back
            # shallow reps chain without ever touching the absolute zone.
            if self._descend is None or y >= self._descend["y"]:
                self._descend = {
                    "y": y,
                    "t": t,
                    "knee": frame.knee_angle(),
                    "hip": frame.hip_angle(),
                    "back": frame.back_angle(),
                }
            span = self._rep["bottom_y"] - self._rep["top_y"]
            if (
                self._descend["y"] > hip_y
                and self._descend["y"] - self._rep["top_y"]
                >= self.RETURN_FRAC * span
                and self._descend["y"] - y
                >= self.BOTTOM_CONFIRM_MARGIN * body_h
            ):
                rep = self._rep
                rep["duration"] = t - rep["start_t"]
                self._rep = {
                    "bottom_y": self._descend["y"],
                    "bottom_knee": self._descend["knee"],
                    "bottom_hip": self._descend["hip"],
                    "bottom_back": self._descend["back"],
                    "start_t": self._descend["t"],
                    "min_elbow": None,
                    "body_h": body_h,
                }
                self._hang = None
                self._descend = None
                self.phase = "bottom"
                return rep
        return None

    def _record_top(
        self,
        t: float,
        frame: PoseFrame,
        y: float,
        active_side: Optional[int],
    ) -> None:
        """Snapshot the running apex: everything the judges and classify_rep()
        read about the top of the lift.

        Arm-side selection matches the window classifier's (see lifting_side).
        """
        wrists = frame.wrists()
        side = lifting_side(active_side, wrists)
        self._rep.update(
            {
                "top_y": y,
                "top_t": t,
                "top_elbow": frame.elbow_angle(side),
                "top_elbow_pt": (
                    frame.point_side(L_ELBOW, side) if side is not None else None
                ),
                "top_shoulder_y": frame.y(L_SHOULDER),
                "top_hip_y": frame.y(L_HIP),
                "top_wrist": wrists.get(side) if side is not None else None,
                "top_shoulder": (
                    frame.point_side(L_SHOULDER, side)
                    if side is not None
                    else frame.point(L_SHOULDER)
                ),
                "top_nose_y": (
                    frame.kpts[NOSE][1]
                    if frame.kpts[NOSE][2] >= KPT_CONF_MIN
                    else None
                ),
                "top_body_h": frame.body_height(),
            }
        )


def judge_swing_rep(
    rep: dict[str, Any], params: dict[str, Any]
) -> tuple[str, list[str]]:
    """Score one segmented swing rep → ('correct'|'incorrect', issue codes)."""
    issues: list[str] = []

    knee = rep.get("bottom_knee")
    if knee is not None and knee < float(params["hingeKneeMin"]):
        issues.append("squatting")

    min_elbow = rep.get("min_elbow")
    if min_elbow is not None and min_elbow < float(params["armStraightMin"]):
        issues.append("bent_arms")

    # 'hardstyle' polices both ends of the arc, 'overhead-ok' allows American
    # swings but still wants the bell up there, 'off' skips the height check
    # entirely (as the manifest promises).
    top_y = rep.get("top_y")
    shoulder_y = rep.get("top_shoulder_y")
    hip_y = rep.get("top_hip_y")
    rule = str(params["swingTopRule"])
    if rule != "off" and top_y is not None and shoulder_y is not None:
        if rule == "hardstyle" and top_y < shoulder_y:
            issues.append("too_high")
        if hip_y is not None and top_y > (shoulder_y + hip_y) / 2:
            issues.append("too_low")

    back = rep.get("bottom_back")
    if back is not None and back < float(params["backAlignMin"]):
        issues.append("rounded_back")

    return ("incorrect" if issues else "correct", issues)


def judge_snatch_rep(
    rep: dict[str, Any], params: dict[str, Any]
) -> tuple[str, list[str]]:
    """Score one snatch rep: a bent elbow at the overhead catch is a press-out
    (soft lockout). Arm bend DURING the pull is normal for a snatch, so unlike
    the swing only the top sample is judged."""
    issues: list[str] = []
    top_elbow = rep.get("top_elbow")
    if top_elbow is not None and top_elbow < float(params["armStraightMin"]):
        issues.append("soft_lockout")
    return ("incorrect" if issues else "correct", issues)


class TechniqueAnalyzer:
    """Drives classifier + segmenter for one input; the worker's single entry point.

    update() per processed frame returns the fields the worker merges into its
    result payload: exercise, phase, repCount, lastRep and any discrete events.
    """

    # How long the per-side wrist history used for active-hand picking spans.
    HAND_WINDOW_S = 3.0
    # The other hand must move this much more (peak-to-peak) to take over.
    HAND_SWITCH_RATIO = 1.2
    # Wrists closer than this (normalized) count as "together" (two-hand grip).
    HANDS_TOGETHER_DIST = 0.05
    # A tracked bell riding more than this (normalized) ABOVE the nearest
    # wrist is physically impossible for a hanging bell mid-arc — the box has
    # drifted (it is carried by wrist deltas after a loose acquisition gate).
    # Such a box must not drive the phase machine: a constant +0.06 offset
    # was measured to zero whole sets. Below the wrist is normal geometry.
    KB_ABOVE_WRIST_MAX = 0.05
    # Keep steering with the ACTIVE hand's last seen position for this long
    # after it clips out of frame (overhead lockout, below-frame backswing).
    # Without it the idle hand hijacks the height signal and V-blips the
    # phase machine into phantom reps at the apex.
    HAND_HOLD_S = 0.5
    # How long after a rep the reported label keeps naming that lift once the
    # window classifier has fallen back to idle (see _snapshot).
    LAST_REP_LABEL_HOLD_S = 10.0

    def __init__(self, params: Optional[dict[str, Any]] = None):
        self.params = dict(DEFAULT_PARAMS)
        if params:
            self.set_params(params)
        self.classifier = ExerciseClassifier()
        self.segmenter = SwingRepSegmenter(
            rep_sensitivity=float(self.params["repSensitivity"])
        )
        self.rep_count = 0
        self.last_rep: Optional[dict[str, Any]] = None
        self._last_rep_t = 0.0
        self._wrist_hist: deque[tuple[float, dict[int, float]]] = deque()
        self._active_side: Optional[int] = None
        self._full_body = False
        # (t, pos, side) of the last returned hand — coasting source while
        # the active hand is momentarily out of frame (HAND_HOLD_S).
        self._last_hand: Optional[
            tuple[float, tuple[float, float], Optional[int]]
        ] = None

    def set_params(self, params: dict[str, Any]) -> None:
        for key in DEFAULT_PARAMS:
            if key in params:
                self.params[key] = params[key]
        if hasattr(self, "segmenter"):
            self.segmenter.rep_sensitivity = float(self.params["repSensitivity"])

    def _pick_hand(
        self, t: float, frame: PoseFrame, kb_pos: Optional[tuple[float, float]]
    ) -> tuple[Optional[tuple[float, float]], Optional[int]]:
        """The bell-carrying hand: position + side (None side = both/unknown).

        The bell position wins when tracked (side = nearest wrist). Otherwise
        the ACTIVE side is the wrist with the larger vertical travel over the
        recent window, with hysteresis — a one-hand snatch keeps its lifting
        arm even though the idle arm is sometimes higher (e.g. at the bottom).
        """
        wrists = frame.wrists()
        self._wrist_hist.append((t, {s: w[1] for s, w in wrists.items()}))
        while self._wrist_hist and t - self._wrist_hist[0][0] > self.HAND_WINDOW_S:
            self._wrist_hist.popleft()

        if kb_pos is not None and wrists:
            nearest = min(
                wrists,
                key=lambda s: math.hypot(
                    wrists[s][0] - kb_pos[0], wrists[s][1] - kb_pos[1]
                ),
            )
            if wrists[nearest][1] - kb_pos[1] > self.KB_ABOVE_WRIST_MAX:
                # Box floats above the gripping hand — drifted track. Fall
                # through to the wrist logic instead of poisoning the cycle.
                kb_pos = None
            else:
                self._active_side = nearest
        if kb_pos is not None:
            self._last_hand = (t, kb_pos, self._active_side)
            return kb_pos, self._active_side
        if not wrists:
            if (
                self._last_hand is not None
                and t - self._last_hand[0] <= self.HAND_HOLD_S
            ):
                return self._last_hand[1], self._last_hand[2]
            return None, None

        # The active hand clipped out of frame (overhead lockout, below-frame
        # backswing): coast on its last seen position BEFORE the travel vote —
        # otherwise the idle hand, being the only one visible, would win the
        # vote outright and V-blip the height signal into phantom reps.
        if (
            self._active_side is not None
            and self._active_side not in wrists
            and self._last_hand is not None
            and self._last_hand[2] == self._active_side
            and t - self._last_hand[0] <= self.HAND_HOLD_S
        ):
            return self._last_hand[1], self._active_side

        travel: dict[int, float] = {}
        for side in wrists:
            ys = [h[side] for _, h in self._wrist_hist if side in h]
            if len(ys) >= 2:
                travel[side] = max(ys) - min(ys)
        if travel:
            best = max(travel, key=lambda s: travel[s])
            if (
                self._active_side in travel
                and travel[best]
                < self.HAND_SWITCH_RATIO * travel[self._active_side]
            ):
                best = self._active_side
            self._active_side = best

        if len(wrists) == 2:
            (wl, wr) = wrists[0], wrists[1]
            if math.hypot(wl[0] - wr[0], wl[1] - wr[1]) < self.HANDS_TOGETHER_DIST:
                mid = ((wl[0] + wr[0]) / 2, (wl[1] + wr[1]) / 2)
                self._last_hand = (t, mid, self._active_side)
                return mid, self._active_side
        if self._active_side in wrists:
            pos = wrists[self._active_side]
            self._last_hand = (t, pos, self._active_side)
            return pos, self._active_side
        if (
            self._active_side is not None
            and self._last_hand is not None
            and self._last_hand[2] == self._active_side
            and t - self._last_hand[0] <= self.HAND_HOLD_S
        ):
            # The active hand clipped out of frame: coast on its last seen
            # position instead of letting the idle hand hijack the signal.
            return self._last_hand[1], self._active_side
        # No usable history yet: the bell hand hangs LOWEST at rest/bottom.
        side = max(wrists, key=lambda s: wrists[s][1])
        self._last_hand = (t, wrists[side], side)
        return wrists[side], side

    def update(
        self,
        t: float,
        kpts: Optional[list[list[float]]],
        kb_pos: Optional[tuple[float, float]],
    ) -> dict[str, Any]:
        events: list[dict[str, Any]] = []
        if kpts is None:
            self._full_body = False
            return self._snapshot(t, events)

        frame = PoseFrame(kpts)
        self._full_body = frame.full_body_visible()
        pos, active_side = self._pick_hand(t, frame, kb_pos)
        if pos is None:
            return self._snapshot(t, events)
        hand_y = pos[1]

        prev_exercise = self.classifier.current
        changed = self.classifier.update(t, frame, hand_y, active_side)
        if changed is not None:
            events.append(
                {"type": "exercise_changed", "exercise": changed, "prev": prev_exercise}
            )

        rep = self.segmenter.update(t, frame, hand_y, active_side)
        # EVERY full cycle the segmenter emits is counted — a bad rep is a rep,
        # and gating on the classifier used to drop reps outright whenever the
        # sliding window had fallen back to idle. The rep is judged as the lift
        # its OWN apex says it was: swings get the full technique judge,
        # snatches the lockout check, cleans are counted without a verdict.
        if rep is not None:
            exercise = classify_rep(rep)
            if exercise == "snatch":
                verdict, issues = judge_snatch_rep(rep, self.params)
            elif exercise == "clean":
                verdict, issues = ("correct", [])
            else:
                verdict, issues = judge_swing_rep(rep, self.params)
            self.rep_count += 1
            self._last_rep_t = t
            duration = round(float(rep.get("duration", 0.0)), 3)
            self.last_rep = {
                "index": self.rep_count,
                "verdict": verdict,
                "issues": issues,
                "exercise": exercise,
                "duration": duration,
            }
            events.append(
                {
                    "type": "rep_completed",
                    "index": self.rep_count,
                    "verdict": verdict,
                    "issues": issues,
                    "exercise": exercise,
                    "duration": duration,
                }
            )
        return self._snapshot(t, events)

    def _snapshot(self, t: float, events: list[dict[str, Any]]) -> dict[str, Any]:
        # Between reps the window classifier drops back to idle within a second
        # or two, which reads as "Idle" next to a live rep count. Keep showing
        # what was just lifted for a while so the badge and the panel agree.
        exercise = self.classifier.current
        if (
            exercise == "idle"
            and self.last_rep is not None
            and t - self._last_rep_t <= self.LAST_REP_LABEL_HOLD_S
        ):
            exercise = self.last_rep["exercise"]
        return {
            "exercise": exercise,
            "phase": self.segmenter.phase,
            "repCount": self.rep_count,
            "lastRep": self.last_rep,
            # Framing hint (head + an ankle in frame) — the phone's
            # 'BACK UP' cue; counting itself survives worse via fallbacks.
            "fullBody": self._full_body,
            "events": events,
        }
