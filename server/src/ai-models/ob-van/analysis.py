"""OB Van signal logic — pure stdlib, no numpy/torch, so it is unit-testable
with any python3 (`python3 test_analysis.py`).

The worker (worker.py) does the heavy lifting (resampling, Silero VAD, FFT,
YOLO, frame differencing) and feeds the scalars into the small state machines
here:

- `SpeechGate`      hysteresis over per-window VAD probabilities
- `OnsetDetector`   loudness jump above a slow EMA (+ spectral flux), with a
                    refractory period and re-arming
- `HopAggregator`   32 ms VAD windows → one audio sample per hop (100 ms)
- `motion_score`    per-cell changed-pixel fractions → 0..1, rejecting a pan
                    or a hard cut (everything changed at once)
- `pace_factor`     adaptive video pacing when inference cannot keep up
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

DB_FLOOR = -90.0
# Four band energies reported per hop (Hz): lows, voice body, presence, air.
BAND_EDGES_HZ = (0.0, 300.0, 2000.0, 6000.0, 8000.0)


# ── Loudness ──────────────────────────────────────────────────────────────


def dbfs_from_mean_square(mean_square: float) -> float:
    """dBFS of a signal with this mean square (full scale sine = −3 dBFS,
    full scale square = 0 dBFS), floored at DB_FLOOR."""
    if mean_square <= 0.0:
        return DB_FLOOR
    return max(DB_FLOOR, 10.0 * math.log10(mean_square))


def rms_dbfs(samples) -> float:
    """RMS level of float samples in [-1, 1], in dBFS."""
    n = 0
    acc = 0.0
    for s in samples:
        acc += s * s
        n += 1
    return dbfs_from_mean_square(acc / n) if n else DB_FLOOR


def spectral_flux(prev_bands, bands) -> float:
    """Half-wave rectified increase of band energies (onset evidence)."""
    if prev_bands is None or len(prev_bands) != len(bands):
        return 0.0
    return sum(max(0.0, b - a) for a, b in zip(prev_bands, bands))


def normalise_bands(energies) -> list[float]:
    """Band energies → fractions of the total (sum 1), zeros when silent."""
    total = sum(energies)
    if total <= 0.0:
        return [0.0 for _ in energies]
    return [e / total for e in energies]


# ── Speech gate ───────────────────────────────────────────────────────────


class SpeechGate:
    """Hysteresis over VAD probabilities: speech turns ON after `on_windows`
    consecutive windows at or above `on`, and OFF once the probability stayed
    below `off` for `off_ms` (so the gaps between words do not flicker)."""

    def __init__(self, on: float = 0.5, off: float = 0.3, on_windows: int = 2, off_ms: float = 300.0):
        self.on = on
        self.off = off
        self.on_windows = on_windows
        self.off_ms = off_ms
        self.speech = False
        self._above = 0
        self._below_since: float | None = None

    def set_thresholds(self, on: float, off: float) -> None:
        self.on = on
        self.off = min(off, on)

    def update(self, prob: float, t_ms: float) -> bool:
        if not self.speech:
            self._above = self._above + 1 if prob >= self.on else 0
            if self._above >= self.on_windows:
                self.speech = True
                self._below_since = None
            return self.speech
        if prob < self.off:
            if self._below_since is None:
                self._below_since = t_ms
            if t_ms - self._below_since >= self.off_ms:
                self.speech = False
                self._above = 0
                self._below_since = None
        else:
            self._below_since = None
        return self.speech


# ── Onsets ────────────────────────────────────────────────────────────────


class OnsetDetector:
    """Energy onsets: the window level jumps `db` above a slow EMA of the
    level (or the spectral flux spikes `flux_ratio` × its own EMA), the level
    is above `floor_db`, the refractory period has passed and the detector is
    armed. It re-arms once the level falls back to within `db / 2` of the EMA,
    so one loud step fires exactly once instead of every refractory period."""

    def __init__(
        self,
        db: float = 6.0,
        refractory_ms: float = 150.0,
        ema_ms: float = 1000.0,
        floor_db: float = -55.0,
        flux_ratio: float = 2.5,
        flux_min: float = 0.15,
    ):
        self.db = db
        self.refractory_ms = refractory_ms
        self.ema_ms = ema_ms
        self.floor_db = floor_db
        self.flux_ratio = flux_ratio
        self.flux_min = flux_min
        self._ema: float | None = None
        self._flux_ema = 0.0
        self._last_t: float | None = None
        self._last_onset: float | None = None
        self._armed = True

    def _alpha(self, dt_ms: float) -> float:
        return 1.0 - math.exp(-max(0.0, dt_ms) / self.ema_ms)

    def update(self, t_ms: float, level_db: float, flux: float | None = None) -> bool:
        if self._ema is None:
            self._ema = level_db
            self._last_t = t_ms
            return False
        dt = t_ms - (self._last_t if self._last_t is not None else t_ms)
        self._last_t = t_ms
        jump = level_db - self._ema
        flux_hit = (
            flux is not None
            and flux >= self.flux_min
            and flux >= self.flux_ratio * max(self._flux_ema, 1e-6)
        )
        if not self._armed and jump < self.db / 2:
            self._armed = True
        refractory = self._last_onset is not None and t_ms - self._last_onset < self.refractory_ms
        onset = (
            self._armed
            and not refractory
            and level_db > self.floor_db
            and (jump >= self.db or flux_hit)
        )
        if onset:
            self._last_onset = t_ms
            self._armed = False
        a = self._alpha(dt)
        self._ema += a * (level_db - self._ema)
        if flux is not None:
            self._flux_ema += a * (flux - self._flux_ema)
        return onset


# ── Hop aggregation ───────────────────────────────────────────────────────


@dataclass
class Hop:
    """One audio sample for Node: `end_ms` is the stream time of the hop end."""

    end_ms: float
    rms_db: float
    speech_prob: float
    speech: bool
    onset: bool
    bands: list[float]
    windows: int


@dataclass
class _HopAcc:
    start_ms: float
    mean_square_sum: float = 0.0
    prob_max: float = 0.0
    onset: bool = False
    speech: bool = False
    bands_sum: list[float] = field(default_factory=list)
    windows: int = 0


class HopAggregator:
    """Collects per-window features (32 ms VAD windows) into fixed hops of
    `hop_ms` on the stream clock. A hop is emitted once a window starts at or
    past its end, so exactly one sample per hop comes out, stamped with the
    hop END (the air time the analysed audio has fully played)."""

    def __init__(self, hop_ms: float = 100.0):
        self.hop_ms = hop_ms
        self._acc: _HopAcc | None = None

    def reset(self) -> None:
        self._acc = None

    def push(
        self,
        t_ms: float,
        mean_square: float,
        prob: float,
        speech: bool,
        onset: bool,
        bands: list[float],
    ) -> list[Hop]:
        out: list[Hop] = []
        if self._acc is None:
            self._acc = _HopAcc(start_ms=t_ms)
        while t_ms >= self._acc.start_ms + self.hop_ms:
            if self._acc.windows:
                out.append(self._emit(self._acc))
            self._acc = _HopAcc(start_ms=self._acc.start_ms + self.hop_ms)
        acc = self._acc
        acc.mean_square_sum += mean_square
        acc.prob_max = max(acc.prob_max, prob)
        acc.onset = acc.onset or onset
        acc.speech = speech
        if not acc.bands_sum:
            acc.bands_sum = [0.0] * len(bands)
        for i, b in enumerate(bands[: len(acc.bands_sum)]):
            acc.bands_sum[i] += b
        acc.windows += 1
        return out

    def _emit(self, acc: _HopAcc) -> Hop:
        n = acc.windows
        return Hop(
            end_ms=acc.start_ms + self.hop_ms,
            rms_db=dbfs_from_mean_square(acc.mean_square_sum / n),
            speech_prob=acc.prob_max,
            speech=acc.speech,
            onset=acc.onset,
            bands=[round(b / n, 3) for b in acc.bands_sum],
            windows=n,
        )


# ── Motion ────────────────────────────────────────────────────────────────

# A cell counts as "active" when this fraction of its pixels changed.
MOTION_CELL_ACTIVE = 0.3
# This fraction of active cells = the whole picture moved: a pan, a zoom or
# a hard cut in the source — not motion inside the scene.
MOTION_PAN_FRACTION = 0.7
MOTION_GAIN = 2.0


def motion_score(
    cell_fractions,
    pan_fraction: float = MOTION_PAN_FRACTION,
    gain: float = MOTION_GAIN,
) -> tuple[float, bool]:
    """(score 0..1, global) from per-cell changed-pixel fractions. The score
    is the mean of the busiest quarter of the cells × gain (a person moving in
    a corner scores as much as a crowd); `global` is True — and the score 0 —
    when most cells changed at once (camera pan / source cut)."""
    cells = [max(0.0, min(1.0, float(c))) for c in cell_fractions]
    if not cells:
        return 0.0, False
    active = sum(1 for c in cells if c >= MOTION_CELL_ACTIVE)
    if active >= pan_fraction * len(cells):
        return 0.0, True
    k = max(1, len(cells) // 4)
    top = sorted(cells, reverse=True)[:k]
    return min(1.0, gain * sum(top) / k), False


# ── Hand gestures (MediaPipe landmarks → named static gestures) ──────────
#
# The worker runs MediaPipe Hands only on the confirmed host's camera and
# feeds the 21 landmarks here. Coordinates are MediaPipe-normalised: x right,
# y DOWN, so "above" means a smaller y.

# Landmark indices (MediaPipe Hands).
_WRIST = 0
_THUMB_IP, _THUMB_TIP = 3, 4
_FINGERS = (  # (pip, tip) per finger: index, middle, ring, pinky
    (6, 8),
    (10, 12),
    (14, 16),
    (18, 20),
)
# A finger is extended when its tip is this much farther from the wrist
# than its PIP joint (scale-free, works at any hand size).
_EXTENDED_RATIO = 1.25

GESTURE_NAMES = ("open_palm", "fist", "thumbs_up", "peace")


def _dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _extended_fingers(landmarks) -> list[bool]:
    wrist = landmarks[_WRIST]
    return [
        _dist(landmarks[tip], wrist) > _EXTENDED_RATIO * _dist(landmarks[pip], wrist)
        for pip, tip in _FINGERS
    ]


def _thumb_extended(landmarks) -> bool:
    wrist = landmarks[_WRIST]
    return _dist(landmarks[_THUMB_TIP], wrist) > 1.1 * _dist(landmarks[_THUMB_IP], wrist)


def classify_gesture(landmarks) -> str | None:
    """One of GESTURE_NAMES from 21 (x, y[, z]) landmarks, or None when the
    pose is ambiguous. Deliberately strict — a missed gesture costs a retry,
    a false positive fires an effect on air."""
    if landmarks is None or len(landmarks) < 21:
        return None
    fingers = _extended_fingers(landmarks)  # index, middle, ring, pinky
    thumb = _thumb_extended(landmarks)
    count = sum(fingers)
    if count == 4:
        return "open_palm"
    if count == 0:
        if not thumb:
            return "fist"
        # Thumb only: thumbs-up when it clearly points up (y grows downward).
        tip = landmarks[_THUMB_TIP]
        wrist = landmarks[_WRIST]
        index_pip = landmarks[_FINGERS[0][0]]
        if tip[1] < wrist[1] and tip[1] < index_pip[1]:
            return "thumbs_up"
        return None
    if count == 2 and fingers[0] and fingers[1] and not thumb:
        return "peace"
    return None


@dataclass
class GestureGate:
    """Fire a gesture only after it is held steadily, then cool down.

    `update(name, t)` returns the gesture name exactly once per firing:
    `name` must stay the same for `hold_s` of consecutive updates, nothing
    fires for `cooldown_s` after a fire, and a held gesture fires only once —
    it must be released (None / another name) before it can fire again. A
    None / different name resets the hold."""

    hold_s: float = 0.5
    cooldown_s: float = 2.0
    _candidate: str | None = None
    _candidate_since: float = 0.0
    _blocked_until: float = 0.0
    _fired: bool = False

    def update(self, name: str | None, t: float) -> str | None:
        if name != self._candidate:
            self._candidate = name
            self._candidate_since = t
            self._fired = False
            return None
        if name is None or self._fired or t < self._blocked_until:
            return None
        if t - self._candidate_since < self.hold_s:
            return None
        self._blocked_until = t + self.cooldown_s
        self._fired = True
        return name


# ── Adaptive pacing ───────────────────────────────────────────────────────


def pace_factor(load_s_per_s: float, budget_s_per_s: float = 0.8, min_factor: float = 0.125) -> float:
    """Rate multiplier for every video loop: 1, ½, ¼, ⅛ — the largest one that
    keeps the summed inference load (Σ proc_ema × hz, seconds of inference per
    second) within the budget."""
    factor = 1.0
    while load_s_per_s * factor > budget_s_per_s and factor > min_factor:
        factor /= 2.0
    return factor


def ema(prev: float | None, value: float, alpha: float) -> float:
    return value if prev is None else prev + alpha * (value - prev)


# ── Params ────────────────────────────────────────────────────────────────


def param_flag(params: dict, key: str, default: bool) -> bool:
    raw = params.get(key)
    if raw is None:
        return default
    return str(raw).strip().lower() in ("1", "true", "on", "yes")


def param_float(params: dict, key: str, default: float, lo: float | None = None, hi: float | None = None) -> float:
    try:
        value = float(params.get(key, default))
    except (TypeError, ValueError):
        value = default
    if not math.isfinite(value):
        value = default
    if lo is not None:
        value = max(lo, value)
    if hi is not None:
        value = min(hi, value)
    return value
