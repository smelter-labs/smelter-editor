"""Synthetic tests for analysis.py (stdlib only — no numpy/torch).

Run with any python3:  python3 test_analysis.py
"""

from __future__ import annotations

import math

from analysis import (
    DB_FLOOR,
    GestureGate,
    HopAggregator,
    OnsetDetector,
    SpeechGate,
    classify_gesture,
    dbfs_from_mean_square,
    motion_score,
    normalise_bands,
    pace_factor,
    param_flag,
    param_float,
    rms_dbfs,
    spectral_flux,
)

WINDOW_MS = 32.0  # 512 samples at 16 kHz

passed = 0
failed = 0


def check(name: str, ok: bool, extra: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'} {name}{' — ' + extra if extra else ''}")


# ── loudness ─────────────────────────────────────────────────────────────────
sine = [math.sin(2 * math.pi * 440 * i / 16000) for i in range(1600)]
check("rms: full-scale sine ≈ −3 dBFS", abs(rms_dbfs(sine) - (-3.01)) < 0.1, f"{rms_dbfs(sine):.2f}")
check("rms: half-scale square = −6 dBFS", abs(rms_dbfs([0.5, -0.5] * 100) - (-6.02)) < 0.05)
check("rms: silence is floored", rms_dbfs([0.0] * 100) == DB_FLOOR and rms_dbfs([]) == DB_FLOOR)
check("rms: mean square 0.01 = −20 dBFS", abs(dbfs_from_mean_square(0.01) + 20) < 1e-9)
check("bands: normalised to fractions", normalise_bands([1, 1, 2, 0]) == [0.25, 0.25, 0.5, 0.0])
check("bands: silence stays zero", normalise_bands([0, 0, 0, 0]) == [0.0, 0.0, 0.0, 0.0])
check("flux: only increases count", abs(spectral_flux([0.5, 0.5], [0.8, 0.2]) - 0.3) < 1e-9)
check("flux: first window has none", spectral_flux(None, [1.0]) == 0.0)

# ── speech gate ──────────────────────────────────────────────────────────────


def gate_run(probs, gate=None):
    gate = gate or SpeechGate()
    return [gate.update(p, i * WINDOW_MS) for i, p in enumerate(probs)]


out = gate_run([0.9, 0.2, 0.9, 0.2, 0.9])
check("gate: isolated windows above 'on' never open it", not any(out), str(out))
out = gate_run([0.1, 0.9, 0.9, 0.9])
check("gate: opens on the 2nd consecutive window", out == [False, False, True, True], str(out))
# Speech, then windows at 0.4 (between off and on) keep it open.
out = gate_run([0.9, 0.9] + [0.4] * 20)
check("gate: holds between the thresholds", all(out[1:]), str(out))
# Off needs ≥ 300 ms below 'off': 9 windows = 288 ms stays on, the 10th closes.
out = gate_run([0.9, 0.9] + [0.1] * 12)
first_off = out.index(False, 2) if False in out[2:] else -1
closed_at_ms = (first_off - 2) * WINDOW_MS
check("gate: closes after 300 ms below 'off'", 288 <= closed_at_ms <= 320, f"closed {closed_at_ms} ms after silence began")
out = gate_run([0.9, 0.9] + [0.1] * 5 + [0.6] + [0.1] * 5)
check("gate: a short dip below 'off' does not close it", all(out[1:]), str(out))
g = SpeechGate()
g.set_thresholds(0.7, 0.9)
check("gate: off is clamped to on", g.off == 0.7)

# ── onsets ───────────────────────────────────────────────────────────────────


def onset_run(levels, det=None, flux=None):
    det = det or OnsetDetector()
    return [
        det.update(i * WINDOW_MS, lvl, None if flux is None else flux[i])
        for i, lvl in enumerate(levels)
    ]


steady = [-40.0] * 40
check("onset: steady level never fires", not any(onset_run(steady)))
step = [-40.0] * 40 + [-32.0] * 60  # +8 dB, held 2 s
out = onset_run(step)
check("onset: fires once on a +8 dB step", sum(out) == 1 and out[40], f"at {[i for i, o in enumerate(out) if o]}")
check("onset: +4 dB is below the 6 dB threshold", not any(onset_run([-40.0] * 40 + [-36.0] * 20)))
check("onset: nothing below the floor", not any(onset_run([-80.0] * 40 + [-70.0] * 10)))
# Two jumps 64 ms apart: the second is inside the 150 ms refractory period.
det = OnsetDetector(ema_ms=100000.0)
levels = [-40.0] * 20 + [-30.0] + [-40.0] + [-30.0] + [-40.0] * 10
out = onset_run(levels, det)
check("onset: refractory swallows a second hit 64 ms later", sum(out) == 1, str([i for i, o in enumerate(out) if o]))
# A drum pattern: +10 dB hits every 500 ms (16 windows) over a quiet bed.
pattern = []
for i in range(160):
    pattern.append(-30.0 if i % 16 == 0 and i > 0 else -42.0)
out = onset_run(pattern)
hits = [i for i, o in enumerate(out) if o]
check("onset: one onset per drum hit", len(hits) == 9 and hits[0] == 16, str(hits))
gaps = {b - a for a, b in zip(hits, hits[1:])}
check("onset: hits 500 ms apart", gaps == {16}, str(gaps))
# Flux alone (equal loudness, spectrum jumps).
flux = [0.02] * 40 + [0.6] + [0.02] * 10
out = onset_run([-30.0] * 51, flux=flux)
check("onset: spectral flux spike fires without a level jump", sum(out) == 1 and out[40], str([i for i, o in enumerate(out) if o]))

# ── hop aggregator ───────────────────────────────────────────────────────────
agg = HopAggregator(hop_ms=100.0)
hops = []
t0 = 5000.0
for i in range(100):  # 3.2 s of windows
    t = t0 + i * WINDOW_MS
    hops += agg.push(t, 0.01, 0.8 if i == 10 else 0.1, i >= 50, i == 20, [0.1, 0.5, 0.3, 0.1])
check("hop: one sample per 100 ms", len(hops) == 31, str(len(hops)))
check("hop: stamped with the hop end", hops[0].end_ms == t0 + 100 and hops[1].end_ms == t0 + 200)
check("hop: hops are 100 ms apart", all(abs(b.end_ms - a.end_ms - 100) < 1e-9 for a, b in zip(hops, hops[1:])))
check("hop: level is the mean square → −20 dBFS", all(abs(h.rms_db + 20) < 1e-9 for h in hops))
hop_of = lambda i: int((i * WINDOW_MS) // 100)  # noqa: E731
check("hop: speech prob is the max over the hop", hops[hop_of(10)].speech_prob == 0.8 and hops[0].speech_prob == 0.1)
check("hop: onset flag survives aggregation", hops[hop_of(20)].onset and sum(h.onset for h in hops) == 1)
check("hop: speech is the gate state at the hop end", not hops[hop_of(49)].speech and hops[hop_of(52)].speech)
check("hop: bands are averaged", hops[3].bands == [0.1, 0.5, 0.3, 0.1])
agg = HopAggregator(hop_ms=100.0)
gap_hops = agg.push(0.0, 0.01, 0.0, False, False, [0, 0, 0, 0]) + agg.push(1000.0, 0.01, 0.0, False, False, [0, 0, 0, 0])
check("hop: a gap in the stream emits no empty hops", len(gap_hops) == 1 and gap_hops[0].end_ms == 100.0, str([h.end_ms for h in gap_hops]))

# ── motion ───────────────────────────────────────────────────────────────────
check("motion: still picture scores 0", motion_score([0.0] * 16) == (0.0, False))
corner = [1.0] * 4 + [0.0] * 12
score, glob = motion_score(corner)
check("motion: a busy quarter scores ≈1", score > 0.99 and not glob, f"{score:.2f}")
score, glob = motion_score([0.2] * 4 + [0.0] * 12)
check("motion: light local motion scales", abs(score - 0.4) < 1e-9 and not glob, f"{score:.2f}")
score, glob = motion_score([0.8] * 14 + [0.0] * 2)
check("motion: a pan (most cells changed) is skipped", score == 0.0 and glob)
score, glob = motion_score([0.8] * 8 + [0.0] * 8)
check("motion: half the picture moving is still scene motion", score == 1.0 and not glob)
check("motion: no cells → 0", motion_score([]) == (0.0, False))

# ── pacing ───────────────────────────────────────────────────────────────────
check("pace: under budget keeps full rate", pace_factor(0.5) == 1.0)
check("pace: 1.2 s/s halves the rate", pace_factor(1.2) == 0.5)
check("pace: 3 s/s quarters it", pace_factor(3.0) == 0.25)
check("pace: floor at ⅛", pace_factor(100.0) == 0.125)

# ── params ───────────────────────────────────────────────────────────────────
check("params: flags accept '1'/'0' and numbers", param_flag({"a": "1"}, "a", False) and not param_flag({"a": 0}, "a", True))
check("params: missing flag uses the default", param_flag({}, "a", True))
check("params: floats are clamped", param_float({"x": "900"}, "x", 1.0, 0.0, 10.0) == 10.0)
check("params: junk falls back", param_float({"x": "abc"}, "x", 2.5) == 2.5)


# ── hand gestures ────────────────────────────────────────────────────────────
def make_hand(fingers: list[bool], thumb: str = "curl") -> list[tuple[float, float]]:
    """Synthetic MediaPipe-style landmarks (x right, y DOWN, wrist at the
    bottom). `fingers` = extended flags for index/middle/ring/pinky; `thumb`
    is 'curl', 'up' (clearly above the hand) or 'side' (extended sideways)."""
    pts: list[tuple[float, float] | None] = [None] * 21
    pts[0] = (0.5, 0.9)  # wrist
    thumb_tip = {"curl": (0.4, 0.72), "up": (0.3, 0.45), "side": (0.15, 0.75)}[thumb]
    pts[1], pts[2], pts[3], pts[4] = (0.4, 0.8), (0.35, 0.75), (0.33, 0.7), thumb_tip
    for i, extended in enumerate(fingers):
        x = 0.35 + i * 0.1
        base = 5 + i * 4
        pts[base] = (x, 0.6)  # mcp
        pts[base + 1] = (x, 0.5)  # pip
        pts[base + 2] = (x, 0.45)  # dip
        pts[base + 3] = (x, 0.3) if extended else (x, 0.55)  # tip
    return pts  # type: ignore[return-value]


check("gesture: open palm", classify_gesture(make_hand([True] * 4, "side")) == "open_palm")
check("gesture: fist", classify_gesture(make_hand([False] * 4, "curl")) == "fist")
check("gesture: thumbs up", classify_gesture(make_hand([False] * 4, "up")) == "thumbs_up")
check("gesture: peace", classify_gesture(make_hand([True, True, False, False], "curl")) == "peace")
check("gesture: thumb sideways alone is ambiguous", classify_gesture(make_hand([False] * 4, "side")) is None)
check("gesture: peace with thumb out is ambiguous", classify_gesture(make_hand([True, True, False, False], "side")) is None)
check("gesture: three fingers is ambiguous", classify_gesture(make_hand([True, True, True, False], "curl")) is None)
check("gesture: too few landmarks", classify_gesture([(0.5, 0.5)] * 10) is None and classify_gesture(None) is None)

gate = GestureGate(hold_s=0.5, cooldown_s=2.0)
check("gate: nothing before the hold", gate.update("open_palm", 0.0) is None and gate.update("open_palm", 0.3) is None)
check("gate: fires after the hold", gate.update("open_palm", 0.6) == "open_palm")
check("gate: a held gesture fires once", gate.update("open_palm", 0.9) is None and gate.update("open_palm", 3.5) is None)
check("gate: release resets", gate.update(None, 3.6) is None)
check("gate: flicker restarts the hold", gate.update("fist", 3.7) is None and gate.update(None, 3.8) is None and gate.update("fist", 3.9) is None and gate.update("fist", 4.2) is None)
check("gate: refires after release + hold", gate.update("fist", 4.5) == "fist")
check("gate: cooldown blocks the next gesture", gate.update("peace", 4.6) is None and gate.update("peace", 5.2) is None)
check("gate: fires once the cooldown passes", gate.update("peace", 6.6) == "peace")

print(f"\n{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
