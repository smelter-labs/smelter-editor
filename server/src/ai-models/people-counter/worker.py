#!/usr/bin/env python3
"""People-counter sidecar: subscribes to video side channels via smelter-sdk,
counts the number of people/faces per frame, reports results over WebSocket.

Three swappable detection backends, selected via PEOPLE_COUNTER_BACKEND:
  - yolo:      ultralytics YOLOv8 (counts `person` boxes)
  - mediapipe: MediaPipe FaceDetection (counts faces)
  - haar:      OpenCV Haar cascade faces (default — no heavy deps)

Backends are loaded lazily on first use, so a missing heavy package (torch /
mediapipe) only disables that backend rather than crashing the worker — Haar
always works because it ships with opencv."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import threading
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
import websockets
from smelter import list_channels
from smelter.aio import subscribe_video_channel

logging.basicConfig(
    level=logging.INFO,
    format="[people-counter-worker] %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("people-counter-worker")

NODE_WS_URL = os.environ.get("NODE_WS_URL", "ws://127.0.0.1:8084")
PROCESS_EVERY_N = int(os.environ.get("PEOPLE_COUNTER_FRAME_SKIP", "5"))
OUTPUT_INTERVAL_S = float(os.environ.get("PEOPLE_COUNTER_OUTPUT_INTERVAL_S", "0.15"))
BACKEND = os.environ.get("PEOPLE_COUNTER_BACKEND", "haar").strip().lower()
# YOLO tuning — see notes in count_people(). Lower CONF + higher IMGSZ catch
# smaller / more distant people (at the cost of more false positives / CPU).
YOLO_CONF = float(os.environ.get("PEOPLE_COUNTER_YOLO_CONF", "0.35"))
YOLO_IMGSZ = int(os.environ.get("PEOPLE_COUNTER_YOLO_IMGSZ", "640"))
YOLO_WEIGHTS = os.environ.get("PEOPLE_COUNTER_YOLO_WEIGHTS", "yolov8n.pt")
# COCO class ids to detect (comma-separated). Default 0 = person; the bird
# backend overrides this to 14 = bird via PEOPLE_COUNTER_YOLO_CLASSES.
YOLO_CLASSES = [
    int(c) for c in os.environ.get("PEOPLE_COUNTER_YOLO_CLASSES", "0").split(",") if c.strip()
]


@dataclass
class InputState:
    last_output_at: float = 0.0
    side_channel_ready: bool = False
    first_seen_at: float = field(default_factory=time.monotonic)
    # Per-input tunables pushed from Node (keys: 'confidence', 'imgsz').
    params: dict = field(default_factory=dict)


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


# ── Detection backends ───────────────────────────────────────────────────────

_backend_loaded = False
_backend_kind: str | None = None
_yolo_model = None
# Which weights file _yolo_model currently holds, so we only reload on change.
_yolo_weights_loaded: str | None = None
# Guards the (re)load so two detection threads can't swap the model mid-flight.
_yolo_lock = threading.Lock()
_mediapipe_detector = None
_haar_cascade = None


def _get_yolo_model(weights: str):
    """Load (and cache) the YOLO model for ``weights``, reloading when the
    requested weights change. This lets the UI swap nano/small/medium live via
    the 'weights' param without restarting the worker. The load may auto-download
    the weights and take a few seconds; it happens under a lock on the detection
    thread, blocking only that one frame."""
    global _yolo_model, _yolo_weights_loaded
    if _yolo_model is not None and _yolo_weights_loaded == weights:
        return _yolo_model
    with _yolo_lock:
        if _yolo_model is None or _yolo_weights_loaded != weights:
            from ultralytics import YOLO  # lazy — pulls torch

            log.info("Loading YOLO weights: %s", weights)
            _yolo_model = YOLO(weights)  # auto-downloads if missing
            _yolo_weights_loaded = weights
    return _yolo_model


def _load_backend() -> str:
    """Load the configured backend once (singleton). Falls back to haar on
    failure so one bad backend can't take the worker down. Returns the kind
    that was actually loaded."""
    global _backend_loaded, _backend_kind
    global _yolo_model, _mediapipe_detector, _haar_cascade
    if _backend_loaded:
        return _backend_kind  # type: ignore[return-value]

    requested = BACKEND if BACKEND in ("yolo", "mediapipe", "haar") else "haar"
    try:
        if requested == "yolo":
            # Loads the default weights (and validates that torch/ultralytics
            # import); a failure here falls through to the haar fallback below.
            _get_yolo_model(YOLO_WEIGHTS)
            _backend_kind = "yolo"
            log.info("Loaded YOLO backend (%s)", YOLO_WEIGHTS)
        elif requested == "mediapipe":
            import mediapipe as mp  # lazy

            _mediapipe_detector = mp.solutions.face_detection.FaceDetection(
                model_selection=1, min_detection_confidence=0.5
            )
            _backend_kind = "mediapipe"
            log.info("Loaded MediaPipe FaceDetection backend")
        else:
            raise RuntimeError("haar requested")
    except Exception as err:  # noqa: BLE001
        if requested != "haar":
            log.warning(
                "Backend '%s' failed to load (%s) — falling back to haar",
                requested,
                err,
            )
        _haar_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        _backend_kind = "haar"
        log.info("Loaded Haar cascade backend (faces)")

    _backend_loaded = True
    return _backend_kind  # type: ignore[return-value]


def detect(rgba: np.ndarray, params: dict | None = None) -> tuple[int, list[dict]]:
    """Detect people/faces in an RGBA frame. Returns (count, boxes) where boxes
    is a list of {x, y, w, h} normalized to 0..1 (only the YOLO backend emits
    boxes; face backends return an empty list). ``params`` carries per-input
    tunables (confidence, imgsz) with env values as fallback."""
    params = params or {}
    kind = _load_backend()
    rgb = rgba[:, :, :3]
    h, w = rgb.shape[:2]

    if kind == "yolo":
        # imgsz drives detection of small/distant people: 640 (default) is fast
        # but misses far figures; 1280 catches much more (slower on CPU).
        conf = float(params.get("confidence", YOLO_CONF))
        imgsz = int(params.get("imgsz", YOLO_IMGSZ))
        classes = params.get("classes") or YOLO_CLASSES
        # 'weights' lets the UI switch model size (nano/s/m) live.
        weights = str(params.get("weights") or YOLO_WEIGHTS)
        model = _get_yolo_model(weights)
        results = model.predict(
            rgb, conf=conf, imgsz=imgsz, classes=classes, verbose=False
        )
        boxes: list[dict] = []
        for r in results:
            if r.boxes is None:
                continue
            for x1, y1, x2, y2 in r.boxes.xyxy.tolist():
                boxes.append(
                    {
                        "x": round(max(0.0, x1 / w), 4),
                        "y": round(max(0.0, y1 / h), 4),
                        "w": round(max(0.0, (x2 - x1) / w), 4),
                        "h": round(max(0.0, (y2 - y1) / h), 4),
                    }
                )
        return len(boxes), boxes

    if kind == "mediapipe":
        result = _mediapipe_detector.process(rgb)
        return (len(result.detections) if result.detections else 0), []

    # haar
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    faces = _haar_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
    return int(len(faces)), []


async def send_result(
    input_id: str,
    count: int,
    boxes: list[dict],
    frame_w: int,
    frame_h: int,
    proc_ms: float,
) -> None:
    global ws_connection
    if ws_connection is None:
        return
    msg = {
        "type": "result",
        "inputId": input_id,
        "data": {
            "count": count,
            "backend": _backend_kind or BACKEND,
            "boxes": boxes,
            # Frame dimensions so the renderer can map normalized boxes through
            # the same cover/crop transform the video uses.
            "frameW": frame_w,
            "frameH": frame_h,
            # How long this frame took from delivery to result, so Node can hold
            # the overlay until the frame is actually presented on the output.
            "procMs": round(proc_ms, 1),
        },
    }
    await ws_connection.send(json.dumps(msg))


SUBSCRIBE_MAX_RETRIES = 5
SUBSCRIBE_RETRY_DELAY_S = 1.0


async def run_detector(input_id: str) -> None:
    log.info("Starting people counting for %s", input_id)
    state = active_inputs.get(input_id)
    if state is None:
        return

    # Wait for side_channel_ready before subscribing to the socket
    wait_start = time.monotonic()
    while input_id in active_inputs and not active_inputs[input_id].side_channel_ready:
        await asyncio.sleep(0.05)
        if time.monotonic() - wait_start > 30.0:
            log.warning("Timed out waiting for side_channel_ready: %s", input_id)
            return
    if input_id not in active_inputs:
        log.info("Input removed while waiting for side_channel_ready: %s", input_id)
        return

    elapsed_wait = time.monotonic() - wait_start
    log.info(
        "side_channel_ready received for %s (waited %.2fs), subscribing to video channel",
        input_id,
        elapsed_wait,
    )

    for attempt in range(1, SUBSCRIBE_MAX_RETRIES + 1):
        if input_id not in active_inputs:
            return
        try:
            channels = await asyncio.to_thread(list_channels)
            video_channels = [
                c for c in channels if c.kind.value == "video"
            ]
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
            if matching:
                log.info("  matching channel: input_id=%s kind=%s", matching[0].input_id, matching[0].kind.value)

            frame_count = await _run_detector_loop(input_id)
            if frame_count > 0:
                return
            # Iterator ended cleanly but produced no frames — socket not ready yet
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
    log.info("Stopped people counting for %s (exhausted retries)", input_id)


async def _run_detector_loop(input_id: str) -> int:
    """Run detection loop. Returns the number of frames processed."""
    frame_count = 0
    try:
        async for frame in subscribe_video_channel(input_id):
            if input_id not in active_inputs:
                break

            # Wall time the frame was delivered to us (the side channel hands it
            # over ~delay_ms before the output presents it).
            delivered_at = time.monotonic()
            state = active_inputs[input_id]
            frame_count += 1

            if frame_count == 1:
                log.info("First frame received for %s", input_id)

            if frame_count % PROCESS_EVERY_N != 0:
                continue

            if delivered_at - state.last_output_at < OUTPUT_INTERVAL_S:
                continue

            rgba = frame.rgba
            frame_h, frame_w = rgba.shape[:2]
            count, boxes = await asyncio.to_thread(detect, rgba, state.params)
            proc_ms = (time.monotonic() - delivered_at) * 1000.0
            state.last_output_at = time.monotonic()
            await send_result(
                input_id, count, boxes, frame_w, frame_h, proc_ms
            )

    except asyncio.CancelledError:
        raise
    except Exception as err:  # noqa: BLE001
        log.exception("Detector loop error for %s (got %d frames): %s", input_id, frame_count, err)
        raise
    finally:
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
    log.info("Connecting to Node at %s (backend=%s)", NODE_WS_URL, BACKEND)

    while not _shutting_down:
        try:
            async with websockets.connect(NODE_WS_URL) as ws:
                ws_connection = ws
                await ws.send(json.dumps({"type": "ready", "model": "people-counter"}))
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
