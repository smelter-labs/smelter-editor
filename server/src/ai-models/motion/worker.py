#!/usr/bin/env python3
"""Motion detection sidecar: subscribes to video side channels via smelter-sdk,
computes frame-differencing scores, reports results over WebSocket."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
import websockets
from smelter import list_channels
from smelter.aio import subscribe_video_channel

logging.basicConfig(
    level=logging.INFO,
    format="[motion-worker] %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("motion-worker")

NODE_WS_URL = os.environ.get("NODE_WS_URL", "ws://127.0.0.1:8083")
PROCESS_EVERY_N = int(os.environ.get("MOTION_FRAME_SKIP", "5"))
OUTPUT_INTERVAL_S = float(os.environ.get("MOTION_OUTPUT_INTERVAL_S", "0.15"))


@dataclass
class InputState:
    baseline: np.ndarray | None = None
    last_output_at: float = 0.0
    side_channel_ready: bool = False
    first_seen_at: float = field(default_factory=time.monotonic)


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


def compute_score(current_gray: np.ndarray, baseline: np.ndarray) -> float:
    diff = cv2.absdiff(baseline, current_gray)
    raw_score = diff.mean() / 255.0
    return round(min(float(raw_score**0.5) * 1.5, 1.0), 4)


async def send_result(input_id: str, score: float) -> None:
    global ws_connection
    if ws_connection is None:
        return
    msg = {
        "type": "result",
        "inputId": input_id,
        "data": {"score": score},
    }
    await ws_connection.send(json.dumps(msg))


SUBSCRIBE_MAX_RETRIES = 5
SUBSCRIBE_RETRY_DELAY_S = 1.0


async def run_detector(input_id: str) -> None:
    log.info("Starting motion detection for %s", input_id)
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
    log.info("Stopped motion detection for %s (exhausted retries)", input_id)


async def _run_detector_loop(input_id: str) -> int:
    """Run detection loop. Returns the number of frames processed."""
    frame_count = 0
    try:
        async for frame in subscribe_video_channel(input_id):
            if input_id not in active_inputs:
                break

            state = active_inputs[input_id]
            frame_count += 1

            if frame_count == 1:
                log.info("First frame received for %s", input_id)

            if frame_count % PROCESS_EVERY_N != 0:
                continue

            rgba = frame.rgba
            gray = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2GRAY)

            if state.baseline is None:
                state.baseline = gray
                continue

            now = time.monotonic()
            if now - state.last_output_at < OUTPUT_INTERVAL_S:
                state.baseline = gray
                continue

            score = compute_score(gray, state.baseline)
            state.baseline = gray
            state.last_output_at = now
            await send_result(input_id, score)

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
        start_detector(input_id)
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
                await ws.send(json.dumps({"type": "ready", "model": "motion"}))
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
