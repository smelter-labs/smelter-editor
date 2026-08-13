#!/usr/bin/env python3
"""Kettlebell-coach sidecar: subscribes to video side channels via smelter-sdk,
tracks the athlete's pose (YOLO11-pose) and the kettlebell (YOLO-World,
zero-shot text class "kettlebell"), classifies the lift and judges swing reps.

Output keeps the standard `{count, boxes, frameW, frameH, procMs}` shape
(count = reps, boxes = the bell box, so drawBoxes debug works untouched) and
adds pose keypoints, exercise/phase, per-rep verdicts and discrete events —
extra keys pass through the sidecar's `data` untouched.

A reader task drains the side channel as fast as frames arrive and keeps only
the NEWEST one; the analysis loop always works on that freshest frame. This
matters for overlay sync: the socket never builds a backlog when inference is
slower than the frame rate, so the frame's receive time (which Node's overlay
hold is computed from) stays honest and the skeleton doesn't trail the video.
Pose runs on every analyzed frame; the (heavier) YOLO-World pass only every
`kbEveryN` analyzed frames, with analysis.KettlebellTracker holding the box
via the wrist delta in between. All heavy backends load lazily so a missing
torch/ultralytics only disables detection instead of crashing the worker."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import sys
import threading
import time
from dataclasses import dataclass, field

import websockets
from smelter import list_channels
from smelter.aio import subscribe_video_channel

from analysis import KettlebellTracker, PoseFrame, TechniqueAnalyzer

logging.basicConfig(
    level=logging.INFO,
    format="[kettlebell-coach-worker] %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("kettlebell-coach-worker")

NODE_WS_URL = os.environ.get("NODE_WS_URL", "ws://127.0.0.1:8091")
# Ceiling on the analysis rate (fast machines): at most one pass per this many
# seconds (~16 Hz). Slow machines pace themselves — the loop simply analyzes
# the newest frame whenever the previous pass finishes. Every analyzed frame
# is emitted; there is no separate output throttle to add staleness.
MIN_ANALYSIS_INTERVAL_S = float(
    os.environ.get("KETTLEBELL_MIN_ANALYSIS_INTERVAL_S", "0.06")
)

POSE_WEIGHTS = os.environ.get("KETTLEBELL_POSE_WEIGHTS", "yolo11n-pose.pt")
WORLD_WEIGHTS = os.environ.get("KETTLEBELL_WORLD_WEIGHTS", "yolov8s-worldv2.pt")
KB_CONF = float(os.environ.get("KETTLEBELL_KB_CONF", "0.15"))
KB_EVERY_N = int(os.environ.get("KETTLEBELL_KB_EVERY_N", "5"))
IMGSZ = int(os.environ.get("KETTLEBELL_IMGSZ", "640"))

# Minimum keypoint confidence for the reported pose (mirrors the overlay's own
# per-joint threshold; keypoints below it are still sent with their conf).
POSE_CONF = 0.25


@dataclass
class InputState:
    side_channel_ready: bool = False
    first_seen_at: float = field(default_factory=time.monotonic)
    # Per-input tunables pushed from Node (manifest param keys + delayMs).
    params: dict = field(default_factory=dict)
    analyzer: TechniqueAnalyzer = field(default_factory=TechniqueAnalyzer)
    tracker: KettlebellTracker = field(default_factory=KettlebellTracker)
    analyzed_frames: int = 0
    # Discrete events held while the Node WS is down, flushed with the next
    # successful emission so none are lost.
    pending_events: list = field(default_factory=list)


active_inputs: dict[str, InputState] = {}
running_tasks: dict[str, asyncio.Task] = {}
ws_connection: websockets.WebSocketClientProtocol | None = None
_shutting_down = False


def request_shutdown() -> None:
    global _shutting_down
    if _shutting_down:
        return
    _shutting_down = True
    for iid in list(active_inputs.keys()):
        stop_detector(iid)
    log.info("Shutting down")


# ── YOLO backends (pose + zero-shot kettlebell) ──────────────────────────────

_backend_lock = threading.Lock()
_backend_failed = False
_pose_models: dict[str, object] = {}
_world_model = None


def _get_pose_model(weights: str):
    """Load (and cache) a YOLO pose model. Returns None if the backend is
    unusable — the worker keeps running and reports no pose."""
    global _backend_failed
    if _backend_failed:
        return None
    cached = _pose_models.get(weights)
    if cached is not None:
        return cached
    with _backend_lock:
        cached = _pose_models.get(weights)
        if cached is not None or _backend_failed:
            return cached
        try:
            from ultralytics import YOLO

            log.info("Loading pose model: %s", weights)
            model = YOLO(weights)
            _pose_models[weights] = model
            return model
        except Exception as err:  # noqa: BLE001
            log.warning(
                "Pose backend failed to load (%s) — no analysis possible. "
                "Install ultralytics>=8.3 to enable the kettlebell coach.",
                err,
            )
            _backend_failed = True
            return None


def _get_world_model():
    """Load YOLO-World once and pin its vocabulary to "kettlebell". Returns
    None on failure (missing CLIP/ftfy, download error) — bell tracking then
    falls back to the wrist midpoint."""
    global _world_model
    if _world_model is False:
        return None
    if _world_model is not None:
        return _world_model
    with _backend_lock:
        if _world_model is not None:
            return _world_model or None
        try:
            from ultralytics import YOLOWorld

            log.info("Loading YOLO-World model: %s", WORLD_WEIGHTS)
            model = YOLOWorld(WORLD_WEIGHTS)
            model.set_classes(["kettlebell"])
            _world_model = model
            return model
        except Exception as err:  # noqa: BLE001
            log.warning(
                "YOLO-World backend failed to load (%s) — falling back to "
                "wrist-only bell tracking. Install CLIP + ftfy to enable it.",
                err,
            )
            _world_model = False
            return None


def _best_pose(result) -> list[list[float]] | None:
    """Pick the largest detected person and return 17 normalized [x,y,conf]."""
    kp = getattr(result, "keypoints", None)
    boxes = getattr(result, "boxes", None)
    if kp is None or kp.xyn is None or len(kp.xyn) == 0:
        return None
    best = 0
    if boxes is not None and len(boxes) > 1:
        areas = [(float(b[2] - b[0]) * float(b[3] - b[1])) for b in boxes.xyxy]
        best = max(range(len(areas)), key=areas.__getitem__)
    xyn = kp.xyn[best]
    conf = kp.conf[best] if kp.conf is not None else None
    kpts = []
    for i in range(len(xyn)):
        c = float(conf[i]) if conf is not None else 1.0
        kpts.append([float(xyn[i][0]), float(xyn[i][1]), c])
    return kpts if len(kpts) == 17 else None


def detect(rgba, params: dict, run_world: bool) -> tuple[list | None, list | None]:
    """Heavy inference for one frame (runs in a thread).

    Returns (pose_kpts, world_boxes): pose_kpts is 17 normalized [x,y,conf] or
    None; world_boxes is a list of normalized {x,y,w,h,conf} kettlebell
    candidates, or None when the world pass was skipped this frame."""
    imgsz = int(float(params.get("imgsz", IMGSZ)))
    rgb = rgba[:, :, :3]

    pose_kpts = None
    pose_model = _get_pose_model(str(params.get("poseModel", POSE_WEIGHTS)))
    if pose_model is not None:
        results = pose_model.predict(rgb, imgsz=imgsz, conf=POSE_CONF, verbose=False)
        if results:
            pose_kpts = _best_pose(results[0])

    world_boxes = None
    if run_world:
        world_model = _get_world_model()
        if world_model is not None:
            kb_conf = float(params.get("kbConfidence", KB_CONF))
            results = world_model.predict(
                rgb, imgsz=imgsz, conf=kb_conf, verbose=False
            )
            world_boxes = []
            if results:
                b = results[0].boxes
                if b is not None and b.xyxyn is not None:
                    for i in range(len(b.xyxyn)):
                        x1, y1, x2, y2 = (float(v) for v in b.xyxyn[i])
                        world_boxes.append(
                            {
                                "x": round(x1, 4),
                                "y": round(y1, 4),
                                "w": round(x2 - x1, 4),
                                "h": round(y2 - y1, 4),
                                "conf": round(float(b.conf[i]), 3),
                            }
                        )
    return pose_kpts, world_boxes


async def send_result(input_id: str, data: dict) -> None:
    global ws_connection
    if ws_connection is None:
        return
    await ws_connection.send(
        json.dumps({"type": "result", "inputId": input_id, "data": data})
    )


SUBSCRIBE_MAX_RETRIES = 5
SUBSCRIBE_RETRY_DELAY_S = 1.0


async def run_detector(input_id: str) -> None:
    log.info("Starting kettlebell analysis for %s", input_id)
    state = active_inputs.get(input_id)
    if state is None:
        return

    # Wait for side_channel_ready before subscribing to the socket.
    wait_start = time.monotonic()
    while input_id in active_inputs and not active_inputs[input_id].side_channel_ready:
        await asyncio.sleep(0.05)
        if time.monotonic() - wait_start > 30.0:
            log.warning("Timed out waiting for side_channel_ready: %s", input_id)
            return
    if input_id not in active_inputs:
        log.info("Input removed while waiting for side_channel_ready: %s", input_id)
        return

    log.info(
        "side_channel_ready received for %s (waited %.2fs), subscribing to video channel",
        input_id,
        time.monotonic() - wait_start,
    )

    for attempt in range(1, SUBSCRIBE_MAX_RETRIES + 1):
        if input_id not in active_inputs:
            return
        try:
            channels = await asyncio.to_thread(list_channels)
            video_channels = [c for c in channels if c.kind.value == "video"]
            matching = [c for c in video_channels if c.input_id == input_id]
            log.info(
                "attempt %d/%d for %s: list_channels found %d total, %d video, %d matching input_id",
                attempt,
                SUBSCRIBE_MAX_RETRIES,
                input_id,
                len(channels),
                len(video_channels),
                len(matching),
            )

            frame_count = await _run_detector_loop(input_id)
            if frame_count > 0:
                return
            if attempt < SUBSCRIBE_MAX_RETRIES:
                delay = SUBSCRIBE_RETRY_DELAY_S * attempt
                log.warning(
                    "subscribe_video_channel for %s returned 0 frames (attempt %d/%d) — retrying in %.1fs",
                    input_id,
                    attempt,
                    SUBSCRIBE_MAX_RETRIES,
                    delay,
                )
                await asyncio.sleep(delay)
            else:
                log.error(
                    "subscribe_video_channel for %s returned 0 frames after %d attempts — giving up",
                    input_id,
                    SUBSCRIBE_MAX_RETRIES,
                )
        except asyncio.CancelledError:
            return
        except Exception as err:  # noqa: BLE001
            if attempt < SUBSCRIBE_MAX_RETRIES:
                delay = SUBSCRIBE_RETRY_DELAY_S * attempt
                log.warning(
                    "Detector for %s failed (attempt %d/%d): %s — retrying in %.1fs",
                    input_id,
                    attempt,
                    SUBSCRIBE_MAX_RETRIES,
                    err,
                    delay,
                )
                await asyncio.sleep(delay)
            else:
                log.error(
                    "Detector for %s failed after %d attempts: %s",
                    input_id,
                    SUBSCRIBE_MAX_RETRIES,
                    err,
                )
    running_tasks.pop(input_id, None)
    log.info("Stopped kettlebell analysis for %s (exhausted retries)", input_id)


async def _run_detector_loop(input_id: str) -> int:
    """Run the analysis loop. Returns the number of frames received.

    A reader task drains the socket continuously (even while inference runs in
    its thread) and keeps only the newest frame, so `received_at` is the true
    frame time and Node's `delayMs - procMs` hold lands the overlay on the
    frame it belongs to."""
    frame_count = 0
    latest: list = []  # at most one (received_at, frame) — the newest
    frame_ready = asyncio.Event()
    reader_done = asyncio.Event()

    async def read_frames() -> None:
        nonlocal frame_count
        try:
            async for frame in subscribe_video_channel(input_id):
                if input_id not in active_inputs:
                    break
                frame_count += 1
                if frame_count == 1:
                    log.info("First frame received for %s", input_id)
                latest[:] = [(time.monotonic(), frame)]
                frame_ready.set()
        finally:
            reader_done.set()
            frame_ready.set()  # wake the analysis loop so it can exit

    reader = asyncio.create_task(read_frames())
    last_analysis_at = 0.0
    try:
        while input_id in active_inputs and not (
            reader_done.is_set() and not latest
        ):
            await frame_ready.wait()
            frame_ready.clear()
            if not latest:
                continue

            # Cap the analysis rate on fast machines; a newer frame arriving
            # during the pause supersedes the one we woke up for.
            pause_s = MIN_ANALYSIS_INTERVAL_S - (
                time.monotonic() - last_analysis_at
            )
            if pause_s > 0:
                await asyncio.sleep(pause_s)
            if not latest:
                continue
            received_at, frame = latest.pop()
            last_analysis_at = time.monotonic()

            state = active_inputs.get(input_id)
            if state is None:
                break
            rgba = frame.rgba
            frame_h, frame_w = rgba.shape[:2]
            params = state.params
            state.analyzed_frames += 1

            kb_source = str(params.get("kbSource", "auto"))
            kb_every_n = max(1, int(float(params.get("kbEveryN", KB_EVERY_N))))
            run_world = (
                kb_source != "wrist-only"
                and state.analyzed_frames % kb_every_n == 0
            )

            pose_kpts, world_boxes = await asyncio.to_thread(
                detect, rgba, params, run_world
            )

            # Analysis is cheap — run it on the loop, per analyzed frame. Time
            # base is the frame's PTS: true source spacing, immune to
            # processing jitter (rep durations / dwell windows stay honest).
            t = frame.pts_seconds
            state.analyzer.set_params(params)
            wrists = PoseFrame(pose_kpts).wrists() if pose_kpts else {}
            state.tracker.observe_pose(t, wrists)
            if world_boxes is not None:
                state.tracker.observe_detections(t, world_boxes)
            kb_box = state.tracker.current()
            # Only a genuinely tracked bell is passed as kb position — the
            # analyzer's own active-hand picking is the wrist fallback (the
            # midpoint would hide one-hand lifts like the snatch).
            kb_center = (
                (kb_box["x"] + kb_box["w"] / 2, kb_box["y"] + kb_box["h"] / 2)
                if kb_box
                else None
            )
            snapshot = state.analyzer.update(t, pose_kpts, kb_center)
            state.pending_events.extend(snapshot["events"])

            if ws_connection is None:
                continue  # keep events pending until Node is back
            proc_ms = (time.monotonic() - received_at) * 1000.0
            events = state.pending_events
            state.pending_events = []
            await send_result(
                input_id,
                {
                    "count": snapshot["repCount"],
                    "boxes": [kb_box] if kb_box else [],
                    "frameW": frame_w,
                    "frameH": frame_h,
                    # From frame receipt to result, so Node can hold the
                    # overlay until this frame is presented on the output.
                    "procMs": round(proc_ms, 1),
                    "pose": {"kpts": [[round(v, 4) for v in k] for k in pose_kpts]}
                    if pose_kpts
                    else None,
                    "kb": {**kb_box, "tracked": True} if kb_box else None,
                    "exercise": snapshot["exercise"],
                    "phase": snapshot["phase"],
                    "repCount": snapshot["repCount"],
                    "lastRep": snapshot["lastRep"],
                    "events": events,
                },
            )

    except asyncio.CancelledError:
        raise
    except Exception as err:  # noqa: BLE001
        log.exception(
            "Detector loop error for %s (got %d frames): %s", input_id, frame_count, err
        )
        raise
    finally:
        reader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reader
        log.info("Detector loop ended for %s after %d frames", input_id, frame_count)

    return frame_count


def start_detector(input_id: str) -> None:
    if input_id in running_tasks and not running_tasks[input_id].done():
        return
    running_tasks[input_id] = asyncio.create_task(run_detector(input_id))


def stop_detector(input_id: str) -> None:
    task = running_tasks.pop(input_id, None)
    if task and not task.done():
        task.cancel()
    active_inputs.pop(input_id, None)


async def handle_command(msg: dict) -> None:
    cmd = msg.get("cmd")
    input_id = msg.get("inputId")
    if not isinstance(input_id, str):
        return

    if cmd == "subscribe":
        if input_id not in active_inputs:
            active_inputs[input_id] = InputState()
        params = msg.get("params")
        if isinstance(params, dict):
            active_inputs[input_id].params = params
        start_detector(input_id)
    elif cmd == "configure":
        params = msg.get("params")
        if input_id in active_inputs and isinstance(params, dict):
            active_inputs[input_id].params = params
            log.info("configure %s params=%s", input_id, params)
    elif cmd == "unsubscribe":
        stop_detector(input_id)
    elif cmd == "side_channel_ready":
        if input_id in active_inputs:
            active_inputs[input_id].side_channel_ready = True
            log.info("side_channel_ready for %s", input_id)
            # The ready signal repeats (WHIP keepalive acks re-notify). If the
            # detector already exhausted its retry budget and gave up, restart
            # it — start_detector is a no-op while a task is still running.
            task = running_tasks.get(input_id)
            if task is None or task.done():
                log.info("detector for %s not running — restarting", input_id)
                start_detector(input_id)
    elif cmd == "side_channel_stopped":
        stop_detector(input_id)
    elif cmd == "shutdown":
        request_shutdown()


async def listen_commands(ws: websockets.WebSocketClientProtocol) -> None:
    try:
        async for raw in ws:
            if _shutting_down:
                break
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            await handle_command(msg)
    except asyncio.CancelledError:
        request_shutdown()


async def main() -> None:
    global ws_connection
    log.info(
        "Connecting to Node at %s (pose=%s world=%s)",
        NODE_WS_URL,
        POSE_WEIGHTS,
        WORLD_WEIGHTS,
    )

    while not _shutting_down:
        try:
            async with websockets.connect(NODE_WS_URL) as ws:
                ws_connection = ws
                await ws.send(
                    json.dumps({"type": "ready", "model": "kettlebell-coach"})
                )
                log.info("Connected to Node")
                await listen_commands(ws)
                if _shutting_down:
                    break
        except asyncio.CancelledError:
            request_shutdown()
            break
        except websockets.ConnectionClosed:
            if _shutting_down:
                break
            log.warning("Node connection closed, reconnecting in 2s...")
        except Exception as err:  # noqa: BLE001
            if _shutting_down:
                break
            log.warning("Connection error: %s, reconnecting in 2s...", err)
        finally:
            ws_connection = None
        if _shutting_down:
            break
        await asyncio.sleep(2)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
