#!/usr/bin/env python3
"""Building-detector sidecar (Ghost City): subscribes to video side channels via
smelter-sdk, segments buildings per frame with an ADE20K SegFormer model, and
reports the bounding boxes of the building regions over WebSocket.

YOLO/COCO has no "building" class, so detection here is semantic segmentation:
the model labels every pixel, we keep the building-like classes (building /
house / skyscraper), then reduce the mask to a handful of bounding boxes via
connected components. Output shape matches the people-counter YOLO backend
({count, boxes, frameW, frameH, procMs}) so the renderer can reuse the same
normalized-box → cover-transform mapping and feed the haunted-city shader.

The heavy backend (torch / transformers) is loaded lazily on first use, so a
missing package only disables detection (empty boxes) instead of crashing."""

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
    format="[building-detector-worker] %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("building-detector-worker")

NODE_WS_URL = os.environ.get("NODE_WS_URL", "ws://127.0.0.1:8088")
PROCESS_EVERY_N = int(os.environ.get("BUILDING_DETECTOR_FRAME_SKIP", "5"))
OUTPUT_INTERVAL_S = float(os.environ.get("BUILDING_DETECTOR_OUTPUT_INTERVAL_S", "0.3"))
SEG_MODEL = os.environ.get(
    "BUILDING_DETECTOR_MODEL", "nvidia/segformer-b0-finetuned-ade-512-512"
)
# Smallest connected building region to report, as a fraction of frame area.
MIN_AREA = float(os.environ.get("BUILDING_DETECTOR_MIN_AREA", "0.02"))
# At most this many building boxes (must match MAX_BOXES in the shader/wrapper).
MAX_BOXES = 16

# ADE20K (0-indexed) class ids that read as "building" for the ghost-town look.
#   1 = building, 25 = house, 48 = skyscraper
BUILDING_CLASS_IDS = {1, 25, 48}


@dataclass
class InputState:
    last_output_at: float = 0.0
    side_channel_ready: bool = False
    first_seen_at: float = field(default_factory=time.monotonic)
    # Per-input tunables pushed from Node (keys: 'min_area').
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


# ── Segmentation backend ─────────────────────────────────────────────────────

_backend_loaded = False
_seg_model = None
_seg_processor = None
_seg_ok = False
# Guards the (one-time) model load so two detection threads can't race it.
_seg_lock = threading.Lock()


def _load_backend() -> bool:
    """Load the SegFormer segmentation model once. Returns True if usable.
    On any failure (missing torch/transformers, download error) we log once and
    return False so the worker keeps running and simply reports no boxes."""
    global _backend_loaded, _seg_model, _seg_processor, _seg_ok
    if _backend_loaded:
        return _seg_ok
    with _seg_lock:
        if _backend_loaded:
            return _seg_ok
        try:
            import torch  # noqa: F401 — validate torch import
            from transformers import (
                SegformerForSemanticSegmentation,
                SegformerImageProcessor,
            )

            log.info("Loading segmentation model: %s", SEG_MODEL)
            _seg_processor = SegformerImageProcessor.from_pretrained(SEG_MODEL)
            _seg_model = SegformerForSemanticSegmentation.from_pretrained(SEG_MODEL)
            _seg_model.eval()
            _seg_ok = True
            log.info("Loaded SegFormer building backend")
        except Exception as err:  # noqa: BLE001
            log.warning(
                "Segmentation backend failed to load (%s) — no buildings will "
                "be detected. Install torch + transformers to enable Ghost City.",
                err,
            )
            _seg_ok = False
        _backend_loaded = True
    return _seg_ok


def _building_mask(rgb: np.ndarray) -> np.ndarray:
    """Run SegFormer and return a uint8 mask (model output resolution) that is 1
    where the predicted class is a building. Kept at the model's native low
    resolution — connected components run there, boxes are normalized after."""
    import torch

    inputs = _seg_processor(images=rgb, return_tensors="pt")
    with torch.no_grad():
        logits = _seg_model(**inputs).logits  # (1, C, h, w), h/w ~ input/4
    pred = logits.argmax(dim=1)[0].cpu().numpy()  # (h, w) class ids
    mask = np.isin(pred, list(BUILDING_CLASS_IDS)).astype(np.uint8)
    return mask


def detect(rgba: np.ndarray, params: dict | None = None) -> tuple[int, list[dict]]:
    """Segment buildings in an RGBA frame. Returns (count, boxes) where boxes is
    a list of {x, y, w, h} normalized to 0..1, one per building region (capped
    at MAX_BOXES, largest first). Returns (0, []) if the backend is unavailable.
    ``params`` carries per-input tunables ('min_area') with env value fallback."""
    params = params or {}
    if not _load_backend():
        return 0, []

    rgb = rgba[:, :, :3]
    mask = _building_mask(rgb)
    mh, mw = mask.shape[:2]
    if mh == 0 or mw == 0:
        return 0, []

    # Close small gaps so a facade split by windows/occluders reads as one box.
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    min_area_frac = float(params.get("min_area", MIN_AREA))
    min_area_px = max(1.0, min_area_frac * mh * mw)

    num, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    boxes: list[dict] = []
    # label 0 is background — skip it.
    for i in range(1, num):
        x, y, w, h, area = stats[i]
        if area < min_area_px:
            continue
        boxes.append(
            {
                "x": round(max(0.0, x / mw), 4),
                "y": round(max(0.0, y / mh), 4),
                "w": round(max(0.0, w / mw), 4),
                "h": round(max(0.0, h / mh), 4),
                "area": float(area),
            }
        )

    # Largest buildings first, then drop the area helper and cap the count.
    boxes.sort(key=lambda b: b["area"], reverse=True)
    boxes = boxes[:MAX_BOXES]
    for b in boxes:
        del b["area"]
    return len(boxes), boxes


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
    log.info("Starting building detection for %s", input_id)
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
    log.info("Stopped building detection for %s (exhausted retries)", input_id)


async def _run_detector_loop(input_id: str) -> int:
    """Run detection loop. Returns the number of frames processed."""
    frame_count = 0
    try:
        async for frame in subscribe_video_channel(input_id):
            if input_id not in active_inputs:
                break

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
            await send_result(input_id, count, boxes, frame_w, frame_h, proc_ms)

    except asyncio.CancelledError:
        raise
    except Exception as err:  # noqa: BLE001
        log.exception(
            "Detector loop error for %s (got %d frames): %s", input_id, frame_count, err
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
    log.info("Connecting to Node at %s (model=%s)", NODE_WS_URL, SEG_MODEL)

    while not _shutting_down:
        try:
            async with websockets.connect(NODE_WS_URL) as ws:
                ws_connection = ws
                await ws.send(
                    json.dumps({"type": "ready", "model": "building-detector"})
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
