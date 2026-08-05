#!/usr/bin/env python3
"""Car-ads sidecar: subscribes to video side channels via smelter-sdk, detects
vehicles (YOLOv8 — COCO weights at street level, VisDrone weights for aerial
footage), finds the two visible wheels inside each vehicle box (Hough circles
on the lower band) and derives the door-panel quad between the wheel arches. The Node side maps an ad image onto that quad with
the corner-pin homography shader, so the ad sits on the car side in correct
perspective.

Wheel-based perspective: the two wheel centers define the bottom line of the
car's side plane, and each wheel's radius is a local scale reference — the quad
edge at a wheel is sized in *that wheel's* radii, so the near end of the car
renders taller than the far end and the quad converges like the car does.

Result shape mirrors the people-counter YOLO backend ({count, frameW, frameH,
procMs}) plus `cars`: one entry per vehicle with its box, the ad quad (or null
when the side isn't visible) and the wheels used, all normalized to 0..1."""

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
    format="[car-ads-worker] %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("car-ads-worker")

NODE_WS_URL = os.environ.get("NODE_WS_URL", "ws://127.0.0.1:8089")
PROCESS_EVERY_N = int(os.environ.get("CAR_ADS_FRAME_SKIP", "5"))
OUTPUT_INTERVAL_S = float(os.environ.get("CAR_ADS_OUTPUT_INTERVAL_S", "0.15"))
# 'side' finds wheels + the door-panel ad quad; 'topdown' is plain vehicle
# boxes for bird's-eye footage (no visible car side → no wheels, no quad).
MODE = os.environ.get("CAR_ADS_MODE", "side").strip().lower()
YOLO_CONF = float(os.environ.get("CAR_ADS_YOLO_CONF", "0.4"))
YOLO_IMGSZ = int(os.environ.get("CAR_ADS_YOLO_IMGSZ", "640"))
YOLO_WEIGHTS = os.environ.get("CAR_ADS_YOLO_WEIGHTS", "yolov8n.pt")
# Vehicle classes are selected by *name* from the loaded model's class map, so
# any weights work: COCO (car=2, bus=5, truck=7) and VisDrone (car=3, van=4,
# truck=5, bus=8) both resolve without configuration.
VEHICLE_CLASS_NAMES = {"car", "van", "truck", "bus"}
# COCO YOLO barely detects vehicles in true nadir (bird's-eye) footage — the
# topdown backend defaults to these VisDrone-trained weights instead. They are
# a custom file (not an ultralytics asset), so the worker fetches them itself
# when missing.
VISDRONE_WEIGHTS = "yolov8s-visdrone.pt"
VISDRONE_URL = (
    "https://huggingface.co/mshamrai/yolov8s-visdrone/resolve/main/best.pt"
)

# ── Ad-quad geometry, in units of the local wheel radius ─────────────────────
# The door band of a typical car, measured from the wheel center: the rocker
# sits roughly at wheel-center height and the beltline (bottom of the windows)
# ~2 radii above it. Horizontal inset keeps the ad off the wheel arches.
AD_SIDE_MARGIN_R = 1.15  # inset from each wheel center toward the door
AD_TOP_R = 2.05  # top edge this many radii above the wheel center (UI: adHeight)
AD_BOTTOM_R = 0.25  # bottom edge this many radii below the wheel center
# Reject quads narrower than this fraction of the vehicle box (side not visible
# enough — car seen head-on / rear-on, or a single wheel arch matched twice).
MIN_QUAD_W_FRAC = 0.22

# ── Wheel detection (Hough) tuning ───────────────────────────────────────────
# The lower band of the vehicle box is resized to this height before Hough so
# the circle-radius bounds hold for any car size on screen.
WHEEL_BAND_TOP = 0.45  # wheels live in the bottom 55% of the box
WHEEL_BAND_H = 160
WHEEL_MIN_R_FRAC = 0.14  # of band height
WHEEL_MAX_R_FRAC = 0.52
WHEEL_MAX_DY_FRAC = 0.35  # wheel pair must sit at a similar height
WHEEL_MAX_R_RATIO = 2.2  # and have comparable radii (perspective allows some)
WHEEL_MIN_SEP_FRAC = 0.35  # of band width — else it's one wheel seen twice


@dataclass
class InputState:
    last_output_at: float = 0.0
    side_channel_ready: bool = False
    first_seen_at: float = field(default_factory=time.monotonic)
    # Per-input tunables pushed from Node ('confidence', 'imgsz', 'adHeight').
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


# ── YOLO backend ─────────────────────────────────────────────────────────────

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Where bare weight filenames are looked up: next to the env-configured
# weights, this worker's dir, then the people-counter dir (the de-facto shared
# cache of the COCO n/s/m downloads). First dir is also the download target.
_WEIGHTS_DIRS = [
    d
    for d in (
        os.path.dirname(YOLO_WEIGHTS),
        _SCRIPT_DIR,
        os.path.join(os.path.dirname(_SCRIPT_DIR), "people-counter"),
    )
    if d
]

_yolo_model = None
# Which weights file _yolo_model currently holds, so we only reload on change.
_yolo_weights_loaded: str | None = None
# Vehicle class ids for the loaded model, derived from its class-name map.
_yolo_classes: list[int] = []
_yolo_lock = threading.Lock()


def _resolve_weights(weights: str) -> str:
    """Resolve a bare filename from the UI 'weights' param against the known
    weight directories, so every backend shares one download per file."""
    if os.path.isabs(weights):
        return weights
    for d in _WEIGHTS_DIRS:
        candidate = os.path.join(d, weights)
        if os.path.exists(candidate):
            return candidate
    return os.path.join(_WEIGHTS_DIRS[0], weights)


def _ensure_visdrone_weights(path: str) -> None:
    """Fetch the VisDrone weights from HF when missing — ultralytics only
    auto-downloads its own assets, not custom files."""
    if os.path.exists(path):
        return
    import urllib.request

    log.info("Downloading VisDrone weights to %s ...", path)
    tmp = path + ".part"
    urllib.request.urlretrieve(VISDRONE_URL, tmp)
    os.replace(tmp, path)
    log.info("VisDrone weights downloaded (%d bytes)", os.path.getsize(path))


def _get_yolo_model(weights: str = None):
    """Load (and cache) the YOLO model, reloading when the requested weights
    change — lets the UI swap model sizes live without a restart. Also derives
    the vehicle class ids for the loaded weights (by class name)."""
    global _yolo_model, _yolo_weights_loaded, _yolo_classes
    weights = _resolve_weights(weights or YOLO_WEIGHTS)
    if _yolo_model is not None and _yolo_weights_loaded == weights:
        return _yolo_model
    with _yolo_lock:
        if _yolo_model is None or _yolo_weights_loaded != weights:
            from ultralytics import YOLO  # lazy — pulls torch

            if os.path.basename(weights) == VISDRONE_WEIGHTS:
                _ensure_visdrone_weights(weights)
            log.info("Loading YOLO weights: %s", weights)
            _yolo_model = YOLO(weights)  # auto-downloads ultralytics assets
            _yolo_weights_loaded = weights
            _yolo_classes = [
                i
                for i, name in _yolo_model.names.items()
                if str(name).lower() in VEHICLE_CLASS_NAMES
            ]
            log.info(
                "Vehicle classes for these weights: %s",
                {i: _yolo_model.names[i] for i in _yolo_classes},
            )
    return _yolo_model


# ── Wheel + quad estimation ──────────────────────────────────────────────────


def _refine_wheel_radius(band: np.ndarray, cx: float, cy: float, r0: float) -> float:
    """Hough often locks onto the rim (strongest circular edge) rather than the
    tire, which would understate the wheel's true size — and the radius is the
    quad's local perspective scale. Refine by scanning the column below the
    center for the tire→road transition (strongest dark→bright step) and take
    that distance when it's plausibly larger than the Hough radius."""
    h, w = band.shape[:2]
    x1, x2 = max(0, int(cx) - 2), min(w, int(cx) + 3)
    if x2 <= x1:
        return r0
    strip = band[:, x1:x2].mean(axis=1)
    lo = int(cy + r0 * 0.6)
    hi = min(h - 1, int(cy + r0 * 2.6))
    if hi - lo < 3:
        return r0
    grad = np.diff(strip[lo : hi + 1])
    step = int(np.argmax(grad))
    if grad[step] < 8.0:  # no clear tire→road edge below — keep Hough's radius
        return r0
    return float(min(max((lo + step) - cy, r0), r0 * 2.6))


def _find_wheels(gray: np.ndarray, box_px: tuple[int, int, int, int]):
    """Find the two wheels inside a vehicle box. Returns [(cx, cy, r), (cx, cy, r)]
    in full-frame pixels (left wheel first), or None when no acceptable pair.

    Works on the lower band of the box, resized to a fixed height so the Hough
    radius bounds are size-independent."""
    x1, y1, x2, y2 = box_px
    bw, bh = x2 - x1, y2 - y1
    if bw < 40 or bh < 30:
        return None

    band_y1 = y1 + int(bh * WHEEL_BAND_TOP)
    band = gray[band_y1:y2, x1:x2]
    if band.size == 0:
        return None

    scale = WHEEL_BAND_H / band.shape[0]
    band_w = max(1, int(round(band.shape[1] * scale)))
    band = cv2.resize(band, (band_w, WHEEL_BAND_H), interpolation=cv2.INTER_AREA)
    band = cv2.medianBlur(band, 5)

    circles = cv2.HoughCircles(
        band,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=band_w * 0.25,
        param1=110,
        param2=28,
        minRadius=int(WHEEL_BAND_H * WHEEL_MIN_R_FRAC),
        maxRadius=int(WHEEL_BAND_H * WHEEL_MAX_R_FRAC),
    )
    if circles is None:
        return None
    cands = circles[0]
    if len(cands) < 2:
        return None

    # Pick the farthest-apart acceptable pair: similar height, comparable radius.
    # HoughCircles returns accumulator-sorted candidates, so cap the search.
    best = None
    best_sep = 0.0
    for i in range(min(len(cands), 6)):
        for j in range(i + 1, min(len(cands), 6)):
            (ax, ay, ar), (bx, by, br) = cands[i], cands[j]
            if abs(ay - by) > WHEEL_BAND_H * WHEEL_MAX_DY_FRAC:
                continue
            lo, hi = min(ar, br), max(ar, br)
            if lo <= 0 or hi / lo > WHEEL_MAX_R_RATIO:
                continue
            sep = abs(ax - bx)
            if sep < band_w * WHEEL_MIN_SEP_FRAC:
                continue
            if sep > best_sep:
                best_sep = sep
                best = ((ax, ay, ar), (bx, by, br))
    if best is None:
        return None

    # Map band coords back to full-frame pixels, left wheel first. Cast to
    # plain floats — np.float32 would blow up json.dumps on send.
    wheels = []
    for cx, cy, r in sorted(best, key=lambda c: c[0]):
        r = _refine_wheel_radius(band, cx, cy, r)
        wheels.append(
            (float(x1 + cx / scale), float(band_y1 + cy / scale), float(r / scale)),
        )
    return wheels


def _quad_from_wheels(wheels, box_px, ad_top_r: float):
    """Door-panel quad [tl, tr, br, bl] in frame pixels from a wheel pair, or
    None when the span between the arches is too narrow to place an ad."""
    (x1w, y1w, r1), (x2w, y2w, r2) = wheels
    lx = x1w + AD_SIDE_MARGIN_R * r1
    rx = x2w - AD_SIDE_MARGIN_R * r2
    bx1, _, bx2, _ = box_px
    if rx - lx < max((bx2 - bx1) * MIN_QUAD_W_FRAC, 8.0):
        return None
    # Each end is sized in its own wheel's radii — the perspective convergence
    # of the car body falls out of the r1/r2 difference.
    return [
        (lx, y1w - ad_top_r * r1),  # tl
        (rx, y2w - ad_top_r * r2),  # tr
        (rx, y2w + AD_BOTTOM_R * r2),  # br
        (lx, y1w + AD_BOTTOM_R * r1),  # bl
    ]


def detect(rgba: np.ndarray, params: dict | None = None) -> tuple[int, list[dict]]:
    """Detect vehicles and their ad quads in an RGBA frame. Returns
    (count, cars) with all coordinates normalized to 0..1 of the frame."""
    params = params or {}
    rgb = rgba[:, :, :3]
    h, w = rgb.shape[:2]

    conf = float(params.get("confidence", YOLO_CONF))
    imgsz = int(params.get("imgsz", YOLO_IMGSZ))
    ad_top_r = float(params.get("adHeight", AD_TOP_R))
    # 'weights' lets the UI switch models (COCO n/s/m, VisDrone aerial) live.
    model = _get_yolo_model(str(params.get("weights") or "") or None)
    results = model.predict(
        rgb, conf=conf, imgsz=imgsz, classes=_yolo_classes, verbose=False
    )

    # Top-down footage has no visible car side — boxes only, no wheel search.
    gray = None if MODE == "topdown" else cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    cars: list[dict] = []
    for r in results:
        if r.boxes is None:
            continue
        for x1, y1, x2, y2 in r.boxes.xyxy.tolist():
            box_px = (
                max(0, int(x1)),
                max(0, int(y1)),
                min(w, int(x2)),
                min(h, int(y2)),
            )
            wheels = _find_wheels(gray, box_px) if gray is not None else None
            quad = _quad_from_wheels(wheels, box_px, ad_top_r) if wheels else None
            cars.append(
                {
                    "box": {
                        "x": round(max(0.0, x1 / w), 4),
                        "y": round(max(0.0, y1 / h), 4),
                        "w": round(max(0.0, (x2 - x1) / w), 4),
                        "h": round(max(0.0, (y2 - y1) / h), 4),
                    },
                    "quad": [
                        {"x": round(px / w, 4), "y": round(py / h, 4)}
                        for px, py in quad
                    ]
                    if quad
                    else None,
                    "wheels": [
                        {
                            "x": round(cx / w, 4),
                            "y": round(cy / h, 4),
                            "r": round(rr / w, 4),
                        }
                        for cx, cy, rr in wheels
                    ]
                    if wheels
                    else None,
                }
            )
    return len(cars), cars


async def send_result(
    input_id: str,
    count: int,
    cars: list[dict],
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
            "cars": cars,
            # Frame dimensions so the renderer can map normalized coords through
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
    log.info("Starting car-ads detection for %s", input_id)
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

    log.info(
        "side_channel_ready received for %s (waited %.2fs), subscribing",
        input_id,
        time.monotonic() - wait_start,
    )

    for attempt in range(1, SUBSCRIBE_MAX_RETRIES + 1):
        if input_id not in active_inputs:
            return
        try:
            channels = await asyncio.to_thread(list_channels)
            matching = [
                c
                for c in channels
                if c.kind.value == "video" and c.input_id == input_id
            ]
            log.info(
                "attempt %d/%d for %s: %d matching video channels",
                attempt,
                SUBSCRIBE_MAX_RETRIES,
                input_id,
                len(matching),
            )

            frame_count = await _run_detector_loop(input_id)
            if frame_count > 0:
                return
            # Iterator ended cleanly but produced no frames — socket not ready yet
            if attempt < SUBSCRIBE_MAX_RETRIES:
                delay = SUBSCRIBE_RETRY_DELAY_S * attempt
                log.warning(
                    "0 frames for %s (attempt %d/%d) — retrying in %.1fs",
                    input_id,
                    attempt,
                    SUBSCRIBE_MAX_RETRIES,
                    delay,
                )
                await asyncio.sleep(delay)
            else:
                log.error(
                    "0 frames for %s after %d attempts — giving up",
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
    log.info("Stopped car-ads detection for %s (exhausted retries)", input_id)


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
            count, cars = await asyncio.to_thread(detect, rgba, state.params)
            proc_ms = (time.monotonic() - delivered_at) * 1000.0
            state.last_output_at = time.monotonic()
            await send_result(input_id, count, cars, frame_w, frame_h, proc_ms)

    except asyncio.CancelledError:
        raise
    except Exception as err:  # noqa: BLE001
        log.exception(
            "Detector loop error for %s (got %d frames): %s",
            input_id,
            frame_count,
            err,
        )
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
            # The ready signal repeats (WHIP keepalive acks re-notify). If the
            # detector already exhausted its retry budget and gave up (stream
            # started delivering frames later than the budget allowed), restart
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
    log.info("Connecting to Node at %s", NODE_WS_URL)

    while not _shutting_down:
        try:
            async with websockets.connect(NODE_WS_URL) as ws:
                ws_connection = ws
                await ws.send(json.dumps({"type": "ready", "model": "car-ads"}))
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
