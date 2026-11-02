"""Tests for worker.py's plumbing (needs numpy — run with the AI venv python).

Run:  <venv>/bin/python test_worker.py
`smelter` / `websockets` are stubbed when absent; no model is ever loaded —
inference and the frame source are faked.
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
import time
import types

try:
    import numpy as np
except ImportError:  # same runner contract as test_analysis.py: exit 0/1
    print("SKIP test_worker.py: numpy not installed")
    raise SystemExit(0)

try:
    import smelter  # noqa: F401
    import smelter.aio  # noqa: F401
except ImportError:
    _pkg = types.ModuleType("smelter")
    _pkg.list_channels = lambda: []
    _aio = types.ModuleType("smelter.aio")
    _aio.subscribe_video_channel = None
    sys.modules["smelter"] = _pkg
    sys.modules["smelter.aio"] = _aio

try:
    import websockets
except ImportError:
    websockets = types.ModuleType("websockets")

    class _Closed(Exception):
        pass

    websockets.ConnectionClosed = _Closed
    websockets.WebSocketClientProtocol = object
    sys.modules["websockets"] = websockets

import worker  # noqa: E402


def _closed() -> Exception:
    try:
        return websockets.ConnectionClosed(None, None)
    except TypeError:  # the stub takes no args
        return websockets.ConnectionClosed()


class FakeFrame:
    def __init__(self, pts: float) -> None:
        self.pts_seconds = pts
        # R=10, G=20, B=30 — lets the BGR test tell the channels apart.
        self.rgba = np.zeros((4, 4, 4), dtype=np.uint8)
        self.rgba[:, :, 0] = 10
        self.rgba[:, :, 1] = 20
        self.rgba[:, :, 2] = 30
        self.rgba[:, :, 3] = 255


class FakeAnalyzer:
    """Emits one rep_completed on the first frame, nothing afterwards."""

    def __init__(self) -> None:
        self.calls = 0

    def set_params(self, params) -> None:
        pass

    def update(self, t, kpts, kb_center):
        self.calls += 1
        events = [{"type": "rep_completed", "index": 1}] if self.calls == 1 else []
        return {
            "events": events,
            "repCount": 1,
            "exercise": "swing",
            "phase": "idle",
            "lastRep": None,
            "fullBody": True,
        }


class FlakySocket:
    """The first `failures` sends raise ConnectionClosed, later ones record."""

    def __init__(self, failures: int) -> None:
        self.failures = failures
        self.sent: list[str] = []

    async def send(self, raw: str) -> None:
        if self.failures > 0:
            self.failures -= 1
            raise _closed()
        self.sent.append(raw)


def _run_loop(frames: int, socket: FlakySocket, seen_inputs: list | None = None):
    async def fake_channel(input_id):
        for i in range(frames):
            yield FakeFrame(i / 10)
            # Let the analysis loop consume each frame (newest-frame-wins
            # would otherwise collapse them into one pass).
            await asyncio.sleep(0.02)

    def fake_pose(bgr, params):
        if seen_inputs is not None:
            seen_inputs.append(bgr.copy())
        return None

    async def go():
        state = worker.InputState()
        state.analyzer = FakeAnalyzer()
        state.params = {"kbSource": "wrist-only"}
        worker.active_inputs["in1"] = state
        worker.ws_connection = socket
        old = (
            worker.subscribe_video_channel,
            worker.detect_pose,
            worker.analysis_interval_s,
        )
        worker.subscribe_video_channel = fake_channel
        worker.detect_pose = fake_pose
        worker.analysis_interval_s = lambda params, floor: 0.0
        try:
            await worker._run_detector_loop("in1")
        finally:
            (
                worker.subscribe_video_channel,
                worker.detect_pose,
                worker.analysis_interval_s,
            ) = old
            worker.active_inputs.pop("in1", None)
            worker.ws_connection = None
        return state

    state = asyncio.run(go())
    payloads = [json.loads(raw)["data"] for raw in socket.sent]
    return state, payloads


def test_rep_event_survives_a_failed_send():
    sock = FlakySocket(failures=1)
    state, payloads = _run_loop(frames=4, socket=sock)
    delivered = [e for p in payloads for e in p["events"]]
    assert delivered == [{"type": "rep_completed", "index": 1}], delivered
    assert state.pending_events == [], state.pending_events


def test_rep_event_is_not_duplicated_on_healthy_sends():
    sock = FlakySocket(failures=0)
    _, payloads = _run_loop(frames=4, socket=sock)
    delivered = [e for p in payloads for e in p["events"]]
    assert len(delivered) == 1, delivered
    assert len(payloads) >= 2, f"expected several result payloads, got {len(payloads)}"


def test_send_result_reports_delivery():
    async def go():
        worker.ws_connection = None
        assert await worker.send_result("x", {}) is False
        worker.ws_connection = FlakySocket(failures=1)
        assert await worker.send_result("x", {}) is False
        assert await worker.send_result("x", {}) is True
        worker.ws_connection = None

    asyncio.run(go())


def test_inference_receives_contiguous_bgr():
    seen: list = []
    _run_loop(frames=2, socket=FlakySocket(failures=0), seen_inputs=seen)
    assert seen, "pose pass never ran"
    b, g, r = (int(v) for v in seen[0][0, 0])
    assert (b, g, r) == (30, 20, 10), (b, g, r)


def test_predict_is_serialized_per_model():
    class SlowModel:
        def __init__(self) -> None:
            self.inside = 0
            self.peak = 0
            self.guard = threading.Lock()

        def predict(self, img, **kw):
            with self.guard:
                self.inside += 1
                self.peak = max(self.peak, self.inside)
            time.sleep(0.02)
            with self.guard:
                self.inside -= 1
            return []

    shared, other = SlowModel(), SlowModel()
    threads = [
        threading.Thread(target=worker._predict, args=(m, None, 640, 0.25))
        for m in (shared, shared, shared, shared, other)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert shared.peak == 1, f"concurrent predict() on one model: {shared.peak}"
    assert other.peak == 1


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
