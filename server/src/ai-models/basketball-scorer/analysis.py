"""Pure shot-detection logic for the basketball-scorer worker.

Everything here is dependency-free (stdlib math only) so it can be unit-tested
on synthetic ball trajectories without torch/numpy/opencv (see
test_analysis.py) — the same split as the kettlebell coach's analysis.py.

Coordinates are normalized to the frame (0..1, y grows DOWNWARD). Because the
frame is not square, physical distances mix x and y differently: `aspect`
(= frame width / height) converts a horizontal normalized distance into the
same unit as a vertical one. Every "radius" used for zones is the rim's
horizontal radius `rx`, and `rx * aspect` is that same length measured in y
units.

The detector is a small state machine over the calibrated rim ellipse:

    idle ──(ball in the ABOVE band)──▶ flight ──(inside the ellipse, descending)──▶ rim
    rim ──(in the NET band below)──▶ net ──(dwell + deceleration)──▶ MAKE ▶ cooldown

A ball flying PAST the rim (in front of or behind it) also projects onto the
ellipse from an elevated camera, so entering the ellipse is never enough: a
make needs the ball to slow down inside the net band (the net catches it) or
to hang there, whereas a pass-by falls straight through the band at free-fall
speed. A ball that vanishes inside the net (mesh occlusion, a player under the
hoop) is still counted, with weaker evidence.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from typing import Any, Optional

DEFAULT_PARAMS: dict[str, Any] = {
    "rimSet": 0,
    "rimCx": 0.5,
    "rimCy": 0.35,
    "rimRx": 0.06,
    "rimRy": 0.02,
    "netZoneMs": 700,
    "cooldownMs": 1500,
    "analysisFps": 20,
    "teamColorA": "#ff6a1f",
    "teamColorB": "#1f7bff",
}

# Analysis-rate clamps (the worker paces itself on slow machines anyway).
MIN_ANALYSIS_INTERVAL_S = 1.0 / 30.0
MAX_ANALYSIS_INTERVAL_S = 1.0 / 8.0

# ── Zone geometry, in rim horizontal radii (rx) ─────────────────────────────
ABOVE_HALF_WIDTH = 2.5  # |dx| within this many rx counts as "over the rim"
ABOVE_DEPTH = 5.0  # this many rx (in y units) above the rim top
RIM_TOLERANCE = 1.15  # ellipse scaled up a little for detection jitter
NET_HALF_WIDTH = 1.4
NET_DEPTH = 2.0  # the net hangs about one rim diameter below the rim
ATTEMPT_DIST = 2.2  # a miss counts as an attempt when it got this close

# ── Timing / evidence rules ─────────────────────────────────────────────────
NET_MIN_SAMPLES = 2
NET_MIN_DWELL_S = 0.10
NET_SLOW_RATIO = 0.7  # net speed ≤ 70 % of the rim-entry speed = "caught"
NET_LONG_DWELL_S = 0.25  # hanging in the net this long is a make regardless
NET_EXIT_SLOW_RATIO = 0.8
# A ball that drops through the ellipse and the net band with its centre
# within this many rx of the rim centre, on ≥ 2 net samples, without any slow-
# down or occlusion: a clean swish or a pass-by exactly through the middle —
# reported as a WEAK make (evidence "net_pass") for the moderator to confirm.
NET_PASS_HALF_WIDTH = 0.5
NET_PASS_MIN_SAMPLES = 2
# Flight → the ball vanishes over the rim (descending, within the rim span)
# → reappears under the net bottom, on the hoop axis, within this long:
# it went through rim and net while the mesh hid it. A pass-by in front of
# the net stays visible; a rim-out comes back up; an air ball never gets here.
# Reported as a WEAK make ("net_hidden") — same as "net_pass".
NET_HIDDEN_MAX_S = 0.8
NET_HIDDEN_HALF_WIDTH = 1.0
LOST_IN_NET_MAX_S = 1.2
RIM_MAX_S = 1.5  # rolling around the rim before we give up on it
FLIGHT_LOST_S = 0.6
FLIGHT_AWAY_S = 0.5
SKIPPED_RIM_MAX_S = 0.35  # above → below with no rim sample in between
TRACK_GAP_S = 0.35  # max spacing for a velocity estimate
HISTORY_S = 4.0
RELEASE_LOOKBACK_S = 3.0
ATTEMPT_DEBOUNCE_S = 1.0


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def analysis_interval_s(params: dict, default: float) -> float:
    """Seconds between analysed frames from the live `analysisFps` param."""
    try:
        fps = float(params.get("analysisFps"))
    except (TypeError, ValueError):
        return default
    if not math.isfinite(fps) or fps <= 0:
        return default
    return clamp(1.0 / fps, MIN_ANALYSIS_INTERVAL_S, MAX_ANALYSIS_INTERVAL_S)


# ── Colour helpers (mirror editor/lib/arcade/color.ts) ───────────────────────


def hex_to_rgb(value: Any) -> Optional[tuple[int, int, int]]:
    v = str(value).strip().lower()
    if v.startswith("#"):
        v = v[1:]
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6 or any(c not in "0123456789abcdef" for c in v):
        return None
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def rgb_to_hsv(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    """RGB 0..255 → (hue degrees 0..360, saturation 0..1, value 0..1)."""
    r, g, b = (c / 255.0 for c in rgb)
    mx = max(r, g, b)
    mn = min(r, g, b)
    d = mx - mn
    h = 0.0
    if d > 0:
        if mx == r:
            h = ((g - b) / d) % 6
        elif mx == g:
            h = (b - r) / d + 2
        else:
            h = (r - g) / d + 4
        h *= 60
        if h < 0:
            h += 360
    return h, (0.0 if mx == 0 else d / mx), mx


def hue_distance(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return 360 - d if d > 180 else d


def hsv_distance(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    """Perceptual-ish distance 0..1: hue dominates for saturated colours,
    saturation/value differences carry whites/greys/blacks."""
    sat_weight = min(a[1], b[1])
    hue = (hue_distance(a[0], b[0]) / 180.0) * sat_weight
    sat = abs(a[1] - b[1]) * 0.5
    val = abs(a[2] - b[2]) * 0.5
    return min(1.0, math.sqrt(hue * hue + sat * sat + val * val))


TEAM_MAX_DISTANCE = 0.5  # farther than this from both colours = nobody
TEAM_MARGIN_FULL_CONF = 0.3  # this much closer to one colour = confidence 1


def classify_team(
    rgb: tuple[float, float, float], team_colors: dict[str, Any]
) -> tuple[Optional[str], float]:
    """Nearest team colour to a sampled jersey colour, with a confidence
    derived from the margin over the runner-up (0 when ambiguous)."""
    scored: list[tuple[float, str]] = []
    sample = rgb_to_hsv(rgb)
    for team, value in team_colors.items():
        parsed = hex_to_rgb(value)
        if parsed is None:
            continue
        scored.append((hsv_distance(sample, rgb_to_hsv(parsed)), team))
    if not scored:
        return None, 0.0
    scored.sort()
    best_d, best = scored[0]
    if best_d > TEAM_MAX_DISTANCE:
        return None, 0.0
    second_d = scored[1][0] if len(scored) > 1 else 1.0
    conf = clamp((second_d - best_d) / TEAM_MARGIN_FULL_CONF, 0.0, 1.0)
    return (best if conf > 0 else None), conf


def torso_region(box: dict) -> tuple[float, float, float, float]:
    """The jersey band of a person box (x, y, w, h normalized): rows 20-55 %,
    columns 25-75 % — below the face, above the shorts, inside the arms."""
    x0 = box["x"] + box["w"] * 0.25
    x1 = box["x"] + box["w"] * 0.75
    y0 = box["y"] + box["h"] * 0.20
    y1 = box["y"] + box["h"] * 0.55
    return x0, y0, x1, y1


def median_color(
    pixels: list[tuple[float, float, float]],
    min_sat: float = 0.25,
    min_val: float = 0.15,
) -> Optional[tuple[int, int, int]]:
    """Per-channel median, preferring saturated pixels (a coloured bib over
    skin/asphalt) when at least a fifth of the patch is saturated."""
    if not pixels:
        return None
    vivid = [p for p in pixels if (lambda h: h[1] >= min_sat and h[2] >= min_val)(rgb_to_hsv(p))]
    pool = vivid if len(vivid) >= max(1, len(pixels) // 5) else pixels

    def med(i: int) -> int:
        vals = sorted(p[i] for p in pool)
        return int(round(vals[len(vals) // 2]))

    return med(0), med(1), med(2)


# ── Rim + zones ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Rim:
    cx: float
    cy: float
    rx: float
    ry: float

    def norm_dist(self, x: float, y: float) -> float:
        """1.0 exactly on the ellipse, < 1 inside."""
        return math.hypot((x - self.cx) / self.rx, (y - self.cy) / self.ry)

    def dist_in_radii(self, x: float, y: float, aspect: float) -> float:
        """Euclidean distance from the rim centre in units of rx."""
        dx = (x - self.cx) / self.rx
        dy = (y - self.cy) / (self.rx * aspect)
        return math.hypot(dx, dy)

    def net_bottom(self, aspect: float) -> float:
        return self.cy + self.ry + NET_DEPTH * self.rx * aspect


# Square crop the ball pass runs on: wide enough for the approach band above
# the rim (ABOVE_DEPTH) and the net band below it, at native resolution (the
# detector letterboxes it up to its imgsz when smaller). One rule for training
# data (scripts/bb-ball/build_dataset.py) and inference (worker.detect_yolo).
CROP_RADII = 16.0  # crop side in rim radii (rx, in px)
CROP_MIN_SIDE = 480


def rim_crop_box(rim: Rim, w: int, h: int) -> tuple[int, int, int]:
    """(x0, y0, side) of the rim crop in frame pixels: side is CROP_RADII·rx
    rounded to 32, at least CROP_MIN_SIDE, never larger than the frame, and
    the square is shifted to stay inside the frame."""
    side = int(round(CROP_RADII * rim.rx * w / 32.0)) * 32
    side = max(CROP_MIN_SIDE, side)
    side = min(side, w, h)
    cx = int(rim.cx * w)
    cy = int(rim.cy * h)
    x0 = max(0, min(w - side, cx - side // 2))
    y0 = max(0, min(h - side, cy - side // 2))
    return x0, y0, side


def rim_from_params(params: dict) -> Optional[Rim]:
    if str(params.get("rimSet", "0")).strip().lower() not in ("1", "true", "on"):
        return None
    try:
        rim = Rim(
            float(params.get("rimCx", 0.5)),
            float(params.get("rimCy", 0.35)),
            float(params.get("rimRx", 0.06)),
            float(params.get("rimRy", 0.02)),
        )
    except (TypeError, ValueError):
        return None
    if not (0 <= rim.cx <= 1 and 0 <= rim.cy <= 1 and rim.rx > 0 and rim.ry > 0):
        return None
    return rim


def zone_of(x: float, y: float, rim: Rim, aspect: float) -> str:
    """'rim' inside the (tolerant) ellipse, 'above' in the approach band over
    it, 'below' in the net band under it, else 'none'."""
    if rim.norm_dist(x, y) <= RIM_TOLERANCE:
        return "rim"
    rxy = rim.rx * aspect
    dx = abs(x - rim.cx)
    if y < rim.cy:
        if dx <= ABOVE_HALF_WIDTH * rim.rx and (rim.cy - y) <= ABOVE_DEPTH * rxy:
            return "above"
        return "none"
    if dx <= NET_HALF_WIDTH * rim.rx and (y - rim.cy - rim.ry) <= NET_DEPTH * rxy:
        return "below"
    return "none"


# ── Ball track ───────────────────────────────────────────────────────────────


@dataclass
class Sample:
    t: float
    x: float  # centre
    y: float
    w: float
    h: float
    conf: float


def box_center(box: dict) -> tuple[float, float]:
    return box["x"] + box["w"] / 2.0, box["y"] + box["h"] / 2.0


class BallTrack:
    """Recent ball samples + a velocity estimate in frame-heights per second."""

    def __init__(self, history_s: float = HISTORY_S) -> None:
        self.history_s = history_s
        self.samples: deque[Sample] = deque()

    def observe(self, t: float, det: Optional[dict]) -> Optional[Sample]:
        if det is not None:
            cx, cy = box_center(det)
            s = Sample(t, cx, cy, det["w"], det["h"], float(det.get("conf", 1.0)))
            self.samples.append(s)
        while self.samples and t - self.samples[0].t > self.history_s:
            self.samples.popleft()
        return self.samples[-1] if det is not None and self.samples else None

    def last(self) -> Optional[Sample]:
        return self.samples[-1] if self.samples else None

    def last_t(self) -> Optional[float]:
        return self.samples[-1].t if self.samples else None

    def velocity(self, aspect: float) -> Optional[tuple[float, float]]:
        if len(self.samples) < 2:
            return None
        b = self.samples[-1]
        a = self.samples[-2]
        dt = b.t - a.t
        if dt <= 0 or dt > TRACK_GAP_S:
            return None
        return ((b.x - a.x) * aspect / dt, (b.y - a.y) / dt)

    def speed(self, aspect: float) -> Optional[float]:
        v = self.velocity(aspect)
        return None if v is None else math.hypot(v[0], v[1])

    def reset(self) -> None:
        self.samples.clear()


# ── Release finder ───────────────────────────────────────────────────────────


def ball_in_hands(ball: dict, person: dict) -> bool:
    """The ball box sits on/over a person box (expanded: arms reach above the
    head and out to the sides at release)."""
    bx, by = box_center(ball)
    px0 = person["x"] - person["w"] * 0.25
    px1 = person["x"] + person["w"] * 1.25
    py0 = person["y"] - person["h"] * 0.35
    py1 = person["y"] + person["h"] * 1.0
    if px0 <= bx <= px1 and py0 <= by <= py1:
        return True
    # Any overlap of the two boxes also counts.
    ix = min(ball["x"] + ball["w"], person["x"] + person["w"]) - max(ball["x"], person["x"])
    iy = min(ball["y"] + ball["h"], person["y"] + person["h"]) - max(ball["y"], person["y"])
    return ix > 0 and iy > 0


# ── Shot detector ────────────────────────────────────────────────────────────


class ShotDetector:
    """Feed one (t, ball, persons) observation per analysed frame; get back
    discrete `shot_made` / `shot_attempt` events."""

    def __init__(self, params: Optional[dict] = None, aspect: float = 16 / 9) -> None:
        self.aspect = aspect
        self.rim: Optional[Rim] = None
        self.net_zone_s = DEFAULT_PARAMS["netZoneMs"] / 1000.0
        self.cooldown_s = DEFAULT_PARAMS["cooldownMs"] / 1000.0
        self.track = BallTrack()
        self.frames: deque[tuple[float, Optional[dict], list]] = deque(maxlen=200)
        self.state = "idle"
        self.zone = "none"
        self.made_count = 0
        self.attempt_count = 0
        self.last_attempt_t: Optional[float] = None
        self._reset_flight()
        self.cooldown_since = -1e9
        self.set_params(params or DEFAULT_PARAMS)

    def set_params(self, params: dict) -> None:
        self.rim = rim_from_params(params)
        try:
            self.net_zone_s = clamp(float(params.get("netZoneMs", 700)) / 1000.0, 0.2, 2.0)
        except (TypeError, ValueError):
            pass
        try:
            self.cooldown_s = clamp(float(params.get("cooldownMs", 1500)) / 1000.0, 0.3, 5.0)
        except (TypeError, ValueError):
            pass

    def set_aspect(self, aspect: float) -> None:
        if aspect > 0:
            self.aspect = aspect

    def _reset_flight(self) -> None:
        self.min_dist = math.inf
        self.rim_t: Optional[float] = None
        self.entry_speed: Optional[float] = None
        self.net_since: Optional[float] = None
        self.net_samples = 0
        self.net_lost = 0
        self.net_centred = 0
        self.net_min_speed = math.inf
        self.last_above_t: Optional[float] = None
        self.last_above_xy: Optional[tuple[float, float]] = None
        self.last_above_desc = False
        self.flight_lost = 0
        self.lost_in_rim = False
        self.touched_rim = False

    # ── observation ──

    def observe(self, t: float, ball: Optional[dict], persons: Optional[list] = None) -> list[dict]:
        persons = list(persons or [])
        self.frames.append((t, ball, persons))
        self.track.observe(t, ball)
        rim = self.rim
        if rim is None:
            self.zone = "none"
            return []

        zone: Optional[str] = None
        dist: Optional[float] = None
        cx = cy = None
        if ball is not None:
            cx, cy = box_center(ball)
            zone = zone_of(cx, cy, rim, self.aspect)
            dist = rim.dist_in_radii(cx, cy, self.aspect)
        self.zone = zone or "none"
        vel = self.track.velocity(self.aspect)
        vy = vel[1] if vel else None
        speed = None if vel is None else math.hypot(vel[0], vel[1])

        events: list[dict] = []
        if self.state == "cooldown":
            if t - self.cooldown_since < self.cooldown_s:
                return events
            self.state = "idle"

        if self.state == "idle":
            if zone == "above":
                self._enter_flight(t, dist)
            elif zone == "rim" and (vy is None or vy > 0):
                self._enter_flight(t, dist)
                self._enter_rim(t, speed)
            return events

        if dist is not None:
            self.min_dist = min(self.min_dist, dist)

        if self.state == "flight":
            if ball is not None and zone != "none":
                self.flight_lost = 0
            if zone == "rim":
                if vy is None or vy >= 0:
                    self._enter_rim(t, speed)
            elif zone == "above":
                self.last_above_t = t
                self.last_above_xy = (cx, cy) if cx is not None and cy is not None else None
                self.last_above_desc = vy is not None and vy > 0
            elif (
                zone == "below"
                and self.last_above_t is not None
                and t - self.last_above_t <= SKIPPED_RIM_MAX_S
                and cx is not None
                and abs(cx - rim.cx) <= rim.rx
            ):
                # Fast ball: no sample landed inside the ellipse, but it went
                # from over the rim to under it within the rim's span.
                self._enter_rim(self.last_above_t, speed)
                self._enter_net(t, speed)
                self.net_samples = 1
                if speed is not None:
                    self.net_min_speed = speed
            elif ball is None:
                self.flight_lost += 1
                last_t = self.track.last_t()
                if last_t is None or t - last_t > FLIGHT_LOST_S:
                    events += self._finish(t, made=False, reason="flight_lost")
            elif (
                self.flight_lost >= 1
                and self.last_above_t is not None
                and t - self.last_above_t <= NET_HIDDEN_MAX_S
                and self.last_above_xy is not None
                and self.last_above_desc
                and abs(self.last_above_xy[0] - rim.cx) <= rim.rx
                and cx is not None
                and cy is not None
                and abs(cx - rim.cx) <= NET_HIDDEN_HALF_WIDTH * rim.rx
                and cy > rim.net_bottom(self.aspect)
            ):
                # Hidden by the mesh from over the rim to under the net — a
                # WEAK make ("net_hidden"): a ball dropped through the hoop by
                # hand after a whistle looks the same, so the ref confirms.
                self._enter_rim(self.last_above_t, speed)
                self._enter_net(self.last_above_t, speed)
                self.net_lost = self.flight_lost
                events += self._finish(t, made=True, evidence="net_hidden")
            else:  # 'none' — flew away from the hoop
                ref = self.last_above_t if self.last_above_t is not None else t
                if t - ref > FLIGHT_AWAY_S:
                    events += self._finish(t, made=False, reason="flight_away")
            return events

        if self.state == "rim":
            assert self.rim_t is not None
            if zone == "below":
                self._enter_net(t, speed)
                self.net_samples = 1
                if speed is not None:
                    self.net_min_speed = speed
            elif zone == "above":
                if vy is not None and vy < 0:
                    # Bounced up off the iron — may still drop in later.
                    self.touched_rim = True
                    self.state = "flight"
                    self.last_above_t = t
            elif zone == "rim":
                if t - self.rim_t > RIM_MAX_S:
                    events += self._finish(t, made=False, reason="rim_timeout")
            elif ball is None:
                # Lost right after entering the ellipse: descending means it
                # is probably inside the net mesh — keep watching from 'net'.
                last_vel = self._last_velocity_before_loss()
                if last_vel is None or last_vel[1] >= 0:
                    self.lost_in_rim = True
                    self._enter_net(t, speed)
                elif t - self.rim_t > self.net_zone_s:
                    events += self._finish(t, made=False, reason="rim_lost_up")
            else:  # 'none'
                if t - self.rim_t > self.net_zone_s:
                    events += self._finish(t, made=False, reason="rim_exit")
            return events

        if self.state == "net":
            assert self.net_since is not None
            dwell = t - self.net_since
            if zone == "below":
                self.net_samples += 1
                if cx is not None and abs(cx - rim.cx) <= NET_PASS_HALF_WIDTH * rim.rx:
                    self.net_centred += 1
                if speed is not None:
                    self.net_min_speed = min(self.net_min_speed, speed)
                if self._net_make_ok(dwell):
                    events += self._finish(
                        t, made=True, evidence="decel" if self._slow() else "net_dwell"
                    )
            elif zone == "rim":
                pass  # still around the rim plane
            elif zone == "above":
                if vy is not None and vy < 0:
                    self.touched_rim = True
                    self.state = "flight"
                    self.last_above_t = t
            elif ball is None:
                # The net hides the ball for a frame or two on a clean make
                # (side views, 20-25 fps) — remembered as evidence below.
                self.net_lost += 1
                if dwell > LOST_IN_NET_MAX_S:
                    if self.net_samples >= 1 or self.lost_in_rim:
                        events += self._finish(t, made=True, evidence="lost_in_net")
                    else:
                        events += self._finish(t, made=False, reason="net_lost_empty")
            else:  # 'none': left the net band
                assert cy is not None
                below_bottom = cy > rim.net_bottom(self.aspect)
                exit_slow = (
                    speed is not None
                    and self.entry_speed is not None
                    and self.entry_speed > 0
                    and speed <= NET_EXIT_SLOW_RATIO * self.entry_speed
                )
                # Seen in the net, lost inside it, out under the bottom: the
                # mesh occluded the ball — a pass-by in front of the net never
                # loses it, and a rim-out leaves upwards.
                occluded = self.net_lost >= 1 and self.net_samples >= 1
                # Straight down the middle of the net band on several samples
                # with no other evidence: weak make (the ref confirms).
                passed = (
                    self.net_samples >= NET_PASS_MIN_SAMPLES
                    and self.net_centred >= NET_PASS_MIN_SAMPLES
                )
                if below_bottom and (
                    self._net_make_ok(dwell)
                    or exit_slow
                    or occluded
                    or passed
                    or (self.lost_in_rim and self.net_samples == 0 and speed is None)
                ):
                    evidence = (
                        "exit_slow"
                        if exit_slow
                        else "net_dwell"
                        if self._net_make_ok(dwell)
                        else "net_occluded"
                        if occluded
                        else "net_pass"
                        if passed
                        else "net_dwell"
                    )
                    events += self._finish(t, made=True, evidence=evidence)
                else:
                    events += self._finish(
                        t,
                        made=False,
                        reason="net_exit_no_evidence",
                        extra={
                            "belowBottom": below_bottom,
                            "exitSlow": exit_slow,
                            "occluded": occluded,
                            "passed": passed,
                        },
                    )
            return events

        return events

    # ── transitions ──

    def _enter_flight(self, t: float, dist: Optional[float]) -> None:
        self._reset_flight()
        self.state = "flight"
        self.last_above_t = t
        if dist is not None:
            self.min_dist = dist

    def _enter_rim(self, t: float, speed: Optional[float]) -> None:
        self.state = "rim"
        self.rim_t = t
        self.entry_speed = speed

    def _enter_net(self, t: float, speed: Optional[float]) -> None:
        self.state = "net"
        self.net_since = t
        self.net_samples = 0
        self.net_lost = 0
        self.net_centred = 0
        self.net_min_speed = math.inf
        if self.entry_speed is None:
            self.entry_speed = speed

    def _slow(self) -> bool:
        return (
            self.entry_speed is not None
            and self.entry_speed > 0
            and self.net_min_speed <= NET_SLOW_RATIO * self.entry_speed
        )

    def _net_make_ok(self, dwell: float) -> bool:
        if dwell >= NET_LONG_DWELL_S:
            return True
        return self.net_samples >= NET_MIN_SAMPLES and dwell >= NET_MIN_DWELL_S and self._slow()

    def _last_velocity_before_loss(self) -> Optional[tuple[float, float]]:
        return self.track.velocity(self.aspect)

    def _metrics(self, t: float) -> dict:
        """The measurements behind a verdict, for the AI log (before reset)."""

        def fin(v: Optional[float]) -> Optional[float]:
            return round(v, 3) if v is not None and math.isfinite(v) else None

        return {
            "minDist": fin(self.min_dist),
            "entrySpeed": fin(self.entry_speed),
            "netMinSpeed": fin(self.net_min_speed),
            "netSamples": self.net_samples,
            "netCentred": self.net_centred,
            "netLost": self.net_lost,
            "dwell": fin(t - self.net_since) if self.net_since is not None else None,
            "touchedRim": self.touched_rim,
            "lostInRim": self.lost_in_rim,
            "rimT": fin(self.rim_t),
            "state": self.state,
            "zone": self.zone,
        }

    def _finish(
        self,
        t: float,
        made: bool,
        evidence: Optional[str] = None,
        reason: Optional[str] = None,
        extra: Optional[dict] = None,
    ) -> list[dict]:
        """Close the current candidate. Always emits `candidate_end` (why the
        ball was or was not counted); `shot_attempt` / `shot_made` as before."""
        events: list[dict] = []
        metrics = self._metrics(t)
        if extra:
            metrics.update(extra)
        rim_t = self.rim_t if self.rim_t is not None else t
        release = self.find_release(rim_t)
        attempted = made or self.min_dist <= ATTEMPT_DIST
        debounced = False
        if attempted and not made:
            if self.last_attempt_t is not None and t - self.last_attempt_t < ATTEMPT_DEBOUNCE_S:
                attempted = False
                debounced = True
        if attempted:
            self.attempt_count += 1
            self.last_attempt_t = t
            events.append(
                {
                    "type": "shot_attempt",
                    "index": self.attempt_count,
                    "t": round(t, 3),
                    "result": "made" if made else "miss",
                    "release": release,
                }
            )
        if made:
            self.made_count += 1
            events.append(
                {
                    "type": "shot_made",
                    "index": self.made_count,
                    "t": round(t, 3),
                    "rimT": round(rim_t, 3),
                    "releaseT": round(release["t"], 3) if release else None,
                    "release": release,
                    "evidence": evidence,
                }
            )
            self.state = "cooldown"
            self.cooldown_since = t
        else:
            self.state = "idle"
        events.append(
            {
                "type": "candidate_end",
                "t": round(t, 3),
                "made": made,
                "reason": (evidence if made else reason) or ("make" if made else "unknown"),
                "attempted": attempted,
                "debounced": debounced,
                "metrics": metrics,
            }
        )
        self._reset_flight()
        return events

    def find_release(self, t_ref: float) -> Optional[dict]:
        """Walk the recent frames back from the rim entry to the last moment
        the ball was in somebody's hands; that somebody is the shooter."""
        lookback = t_ref - RELEASE_LOOKBACK_S
        for t, ball, persons in reversed(self.frames):
            if t > t_ref + 1e-6:
                continue
            if t < lookback:
                break
            if ball is None or not persons:
                continue
            for person in persons:
                if ball_in_hands(ball, person):
                    return {"t": t, "person": dict(person), "ball": dict(ball)}
        return None


# ── Instant replay: which buffered frames make the clip ──────────────────────

# Source seconds before / after the make in the replay clip.
REPLAY_BEFORE_S = 3.0
REPLAY_AFTER_S = 1.0
# Playback slow-down (2 = half speed) and the clip's frame rate.
REPLAY_SLOW = 2
REPLAY_OUT_FPS = 30


def replay_frame_plan(
    frames: "list[tuple[float, Any]]",
    t: float,
    before: float = REPLAY_BEFORE_S,
    after: float = REPLAY_AFTER_S,
    slow: int = REPLAY_SLOW,
    out_fps: int = REPLAY_OUT_FPS,
) -> tuple[list, int]:
    """Pick the buffered frames for a slow-motion clip around source time `t`.

    `frames` are `(pts, payload)` in pts order (the worker's ring buffer).
    Source time `t - before .. t + after` (clipped to what the buffer holds)
    is sampled every `1 / (out_fps * slow)` seconds; each sample takes the
    nearest buffered frame, so a 20 fps analysis feed becomes a 30 fps clip
    that plays `slow`× slower (frames repeat, nothing is interpolated).
    Returns the payloads in output order and the clip length in ms; empty
    when the buffer does not cover the window at all."""
    if not frames or out_fps <= 0 or slow <= 0:
        return [], 0
    pts = [p for p, _ in frames]
    start = max(t - before, pts[0])
    end = min(t + after, pts[-1])
    if end <= start:
        return [], 0
    step = 1.0 / (out_fps * slow)
    n = int(math.floor((end - start) / step + 1e-9)) + 1
    out = []
    j = 0
    for i in range(n):
        ts = start + i * step
        while j + 1 < len(pts) and abs(pts[j + 1] - ts) <= abs(pts[j] - ts):
            j += 1
        out.append(frames[j][1])
    return out, round(len(out) * 1000 / out_fps)
