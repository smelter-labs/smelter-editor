"""
  src/ai-models/people-counter/.venv/bin/python -m pytest scripts/test_fb_away_lib.py
  (or plain `python scripts/test_fb_away_lib.py` — numpy is the only dependency)
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fb_away_lib as lib  # noqa: E402

CAM = {"cx": 49.4317, "d": 20.8906, "hc": 9.3719, "f": 1627.9296,
       "x0": 2311.8238, "y0": 1029.6642, "tilt": 0.3848, "roll": -0.0161}
RED, BLACK, YELLOW = (200, 40, 50), (25, 25, 30), (230, 210, 40)


def test_unproject_round_trips():
    p = lib.camera_params(CAM)
    un = lib.Unprojector(p)
    for X, Y in ((0, 0), (52.5, 34), (105, 68), (20, 60), (90, 5)):
        x, y = un(*lib.project(p, X, Y))
        assert math.hypot(x - X, y - Y) < 0.05


def test_pitch_band_covers_both_touchlines():
    p = lib.camera_params(CAM)
    y1, y2 = lib.pitch_band(p, 4450, 2000)
    far = lib.project(p, 52.5, 0)[1]
    near = lib.project(p, 52.5, 68)[1]
    assert y1 < far < near < y2


def test_jersey_color_ignores_grass():
    patch = np.zeros((10, 10, 3), dtype=np.uint8)
    patch[:, :] = (40, 160, 50)  # grass
    patch[2:8, 3:7] = BLACK
    assert lib.jersey_color(patch) == BLACK
    patch[:, :] = (40, 160, 50)
    assert lib.jersey_color(patch) is None


def test_dominant_color_and_classification():
    rest = [BLACK] * 40 + [YELLOW] * 6 + [(30, 28, 35)] * 10
    b = lib.dominant_color(rest)
    assert lib.hsv_distance(lib.rgb_to_hsv(b), lib.rgb_to_hsv(BLACK)) < 0.05
    assert lib.classify(RED, RED, b) == "A"
    assert lib.classify((20, 22, 28), RED, b) == "B"
    assert lib.classify(YELLOW, RED, b) == "O"
    assert lib.classify(None, RED, b) == "O"


def test_tracker_keeps_colours_apart_when_players_cross():
    tr = lib.MetricTracker()
    for i in range(30):
        t = i * 200.0
        a = lib.Det(t, 40 + i * 0.5, 30, cls="A")
        b = lib.Det(t, 55 - i * 0.5, 30.5, cls="B")
        tr.update([a, b], t)
    tracks = tr.finish()
    assert len(tracks) == 2
    assert sorted(t.label() for t in tracks) == ["A", "B"]
    assert all(max(t.votes().values()) == 30 for t in tracks)


def test_select_away_picks_b_tracks_and_the_goalkeeper():
    def run(cls, x, y, n=20):
        return lib.Track(0, [lib.Det(i * 200.0, x, y, cls=cls) for i in range(n)])

    home_at = lambda t: [(50.0, 30.0), (5.0, 34.0)]
    tracks = [
        run("B", 60, 20),            # away outfield
        run("A", 50, 30),            # home
        run("O", 100, 34),           # away keeper: own kit, own box, no tag nearby
        run("O", 5, 34),             # home keeper in another kit: on his ZXY tag
        run("O", 52, 10),            # referee
        run("B", 70, 40, n=3),       # too short
    ]
    for i, t in enumerate(tracks):
        t.id = i + 1
    assert [t.id for t in lib.select_away(tracks, home_at)] == [1, 3]


def test_resample_interpolates_short_gaps_only():
    dets = [lib.Det(0, 10, 10), lib.Det(400, 14, 10), lib.Det(2400, 30, 10), lib.Det(2600, 30, 10)]
    xs, ys = lib.resample(lib.Track(1, dets), 10, 30, ema=1.0)
    assert xs[0] == 10 and xs[2] == 12 and xs[4] == 14
    assert xs[10] is None and xs[23] is None  # 2 s gap is not bridged
    assert xs[24] == 30 and xs[26] == 30 and xs[27] is None


def test_cap_per_sample_drops_the_shortest():
    xy = [([1.0, 1.0], [1.0, 1.0]), ([2.0, None], [2.0, None]), ([3.0, 3.0], [3.0, 3.0])]
    lib.cap_per_sample(xy, [10, 50, 30], cap=2)
    assert xy[0][0] == [None, 1.0] and xy[1][0][0] == 2.0 and xy[2][0] == [3.0, 3.0]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
