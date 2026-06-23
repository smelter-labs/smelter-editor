"""Python sidecar: consumes Smelter side-channel audio from video inputs
and emits whisper transcripts back to the Node app over a WebSocket.

Smelter-demo creates WHIP inputs dynamically (one per camera/screenshare),
so this sidecar discovers audio channels in a loop and spawns one whisper
worker per input id.
"""

from __future__ import annotations

import asyncio
import faulthandler
import json
import logging
import os
import sys
import time
from collections import deque

import numpy as np
import torch
import websockets
from faster_whisper import WhisperModel
from silero_vad import VADIterator, load_silero_vad
from smelter import list_channels
from smelter.aio import subscribe_audio_channel
from smelter.errors import ConnectionClosed

faulthandler.enable()

logging.basicConfig(
    level=logging.INFO, format="[python] %(message)s", stream=sys.stderr
)
log = logging.getLogger("sidecar")

NODE_WS_URL = os.environ.get("NODE_WS_URL", "ws://127.0.0.1:8082")

# Silero VAD — see yolo-whisper-node example for rationale on these numbers.
VAD_THRESHOLD = 0.3
VAD_MIN_SILENCE_MS = 200
VAD_SAMPLE_RATE = 16000
VAD_WINDOW = 512
VAD_PREROLL_WINDOWS = 6
VAD_MAX_SEGMENT_MS = 7000
WHISPER_LANGUAGE: str | None = "en"

NANOS_PER_SAMPLE_16K = 1_000_000_000 // VAD_SAMPLE_RATE

DISCOVERY_INTERVAL_S = 1.0
_SIDE_CHANNEL_DELAY_MS = int(os.environ.get("SMELTER_SIDE_CHANNEL_DELAY_MS", "8000"))
SIDE_CHANNEL_DELAY_S = _SIDE_CHANNEL_DELAY_MS / 1000
# Fallback when Node does not send side_channel_ready (manual sidecar / SKIP_PYTHON).
_DEFAULT_WARMUP_S = SIDE_CHANNEL_DELAY_S + 10
CAPTIONS_WARMUP_S = float(os.environ.get("CAPTIONS_WARMUP_S", str(_DEFAULT_WARMUP_S)))
WORKER_RECONNECT_S = float(os.environ.get("CAPTIONS_RECONNECT_S", "5"))

DEBUG = os.environ.get("CAPTIONS_DEBUG") == "1"

events_q: asyncio.Queue[dict] = asyncio.Queue(maxsize=256)
# Set by Node WS side_channel_ready after WHIP ack; monotonic timestamp.
side_channel_ready_at: dict[str, float] = {}


def debug(msg: str, *args) -> None:
    if DEBUG:
        log.info("[debug] " + msg, *args)


def should_start_worker(
    input_id: str, now: float, channel_first_seen: dict[str, float]
) -> bool:
    """True when WHIP publisher is live (ack) or fallback warmup elapsed.

    Subscribe immediately on WHIP ack — sideChannel.delayMs on the input already
    buffers audio ahead of the composed output. Waiting longer before connecting
    lets the side-channel socket close with 0 batches (Smelter expects a live
    reader while audio is flowing).
    """
    if input_id in side_channel_ready_at:
        return True
    first_seen = channel_first_seen.get(input_id)
    if first_seen is None:
        return False
    return now - first_seen >= CAPTIONS_WARMUP_S


async def listen_node_events(ws) -> None:
    """Receive side_channel_ready/stopped from Node (WHIP ack timing)."""
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg_type = msg.get("type")
            input_id = msg.get("inputId")
            if not isinstance(input_id, str):
                continue
            if msg_type == "side_channel_ready":
                if input_id in side_channel_ready_at:
                    debug(
                        "side_channel_ready ignored for %s (timer already running)",
                        input_id,
                    )
                    continue
                side_channel_ready_at[input_id] = time.monotonic()
                log.info(
                    "side_channel_ready for %s — starting whisper worker now",
                    input_id,
                )
            elif msg_type == "side_channel_stopped":
                side_channel_ready_at.pop(input_id, None)
                log.info("side_channel_stopped for %s", input_id)
    except websockets.ConnectionClosed:
        return


async def main() -> None:
    log.info("loading Whisper + Silero VAD models…")
    whisper_model, vad_model = await asyncio.to_thread(
        lambda: (
            WhisperModel("base", device="cpu", compute_type="int8"),
            load_silero_vad(),
        )
    )

    log.info(
        "SMELTER_SIDE_CHANNEL_SOCKET_DIR=%s",
        os.environ.get("SMELTER_SIDE_CHANNEL_SOCKET_DIR", "<unset>"),
    )

    async with websockets.connect(NODE_WS_URL, ping_interval=20, max_size=None) as ws:
        log.info("connected to Node WS %s", NODE_WS_URL)
        await asyncio.gather(
            push_events(ws),
            listen_node_events(ws),
            discover_inputs(vad_model, whisper_model),
        )


async def push_events(ws) -> None:
    while True:
        event = await events_q.get()
        try:
            await ws.send(json.dumps(event))
        except websockets.ConnectionClosed:
            return


async def discover_inputs(vad_model, whisper_model: WhisperModel) -> None:
    """Poll the side-channel directory and start one long-lived whisper worker
    per audio channel. Workers reconnect internally — this loop only spawns a
    worker the first time a channel appears."""
    running: dict[str, asyncio.Task] = {}
    logged_waiting = False
    channel_first_seen: dict[str, float] = {}
    while True:
        try:
            channels = await asyncio.to_thread(list_channels)
        except Exception as err:  # noqa: BLE001
            log.warning("list_channels failed: %s", err)
            channels = []

        # Drop finished workers first so we log why they exited and avoid
        # overwriting a done task before its result is inspected.
        for input_id, task in list(running.items()):
            if not task.done():
                continue
            try:
                task.result()
            except Exception as err:  # noqa: BLE001
                log.warning("whisper worker for %s crashed: %s", input_id, err)
            else:
                log.warning(
                    "whisper worker for %s exited unexpectedly — restarting",
                    input_id,
                )
            del running[input_id]

        for c in channels:
            if c.kind.value != "audio":
                continue
            if c.input_id in running:
                continue
            now = time.monotonic()
            if c.input_id not in channel_first_seen:
                channel_first_seen[c.input_id] = now
                log.info(
                    "audio channel detected for %s — waiting for side_channel_ready",
                    c.input_id,
                )
                continue
            if not should_start_worker(c.input_id, now, channel_first_seen):
                continue
            log.info("starting whisper worker for %s", c.input_id)
            running[c.input_id] = asyncio.create_task(
                run_whisper(c.input_id, vad_model, whisper_model)
            )

        if DEBUG:
            audio_ids = [c.input_id for c in channels if c.kind.value == "audio"]
            debug(
                "list_channels: %d total, %d audio, running=%s",
                len(channels),
                len(audio_ids),
                list(running.keys()),
            )
        elif not channels and not running and not logged_waiting:
            log.info(
                "no side-channel sockets yet (waiting for whip inputs with transcription)"
            )
            logged_waiting = True

        await asyncio.sleep(DISCOVERY_INTERVAL_S)


async def stream_16k_windows(input_id: str):
    """Yield (window, window_start_pts_ms) for every 512-sample 16 kHz mono
    window from the side channel."""
    residual = np.empty(0, dtype=np.float32)
    sample_rate: int | None = None
    batch_count = 0

    log.info("[%s] subscribing to audio side channel…", input_id)
    try:
        async for batch in subscribe_audio_channel(input_id):
            batch_count += 1
            if batch_count == 1:
                log.info("[%s] first audio batch received", input_id)
            if DEBUG and batch_count % 100 == 0:
                debug("[%s] audio batches=%d", input_id, batch_count)
            if sample_rate is None:
                sample_rate = batch.sample_rate
                log.info("[%s] audio input sample_rate=%d", input_id, sample_rate)
            mono = batch.to_mono()
            if mono.size == 0:
                continue
            chunk = resample_to_16k(mono, sample_rate).astype(np.float32, copy=False)
            if chunk.size == 0:
                continue

            audio = np.concatenate([residual, chunk]) if residual.size else chunk
            audio_start_pts_nanos = (
                batch.start_pts_nanos - residual.size * NANOS_PER_SAMPLE_16K
            )
            n_windows = audio.size // VAD_WINDOW

            for i in range(n_windows):
                window = audio[i * VAD_WINDOW : (i + 1) * VAD_WINDOW].copy()
                window_pts_ms = (
                    audio_start_pts_nanos + i * VAD_WINDOW * NANOS_PER_SAMPLE_16K
                ) // 1_000_000
                yield window, window_pts_ms

            residual = audio[n_windows * VAD_WINDOW :].copy()
    except ConnectionClosed as err:
        log.warning("[%s] side channel closed: %s", input_id, err)
    finally:
        if batch_count == 0:
            log.warning(
                "[%s] no audio batches — side channel closed before any data "
                "(CaptionsPull output must render this input while WHIP streams)",
                input_id,
            )
        log.info(
            "[%s] audio stream ended after %d batches",
            input_id,
            batch_count,
        )


async def _transcribe_and_emit(
    model: WhisperModel,
    input_id: str,
    audio: np.ndarray,
    ts_ms: int,
    duration_ms: int,
) -> None:
    def _run() -> str:
        segments, _info = model.transcribe(
            audio,
            language=WHISPER_LANGUAGE,
            beam_size=1,
        )
        return " ".join(s.text.strip() for s in segments).strip()

    try:
        text = await asyncio.to_thread(_run)
    except Exception as err:  # noqa: BLE001
        log.warning("[%s] whisper failed: %s", input_id, err)
        return
    if not text:
        return
    log.info("[%s] whisper @ %d ms (%d ms): %s", input_id, ts_ms, duration_ms, text)
    await events_q.put(
        {
            "type": "transcript",
            "inputId": input_id,
            "text": text,
            "ts": ts_ms,
            "duration": duration_ms,
        }
    )


async def run_whisper(
    input_id: str, vad_model, whisper_model: WhisperModel
) -> None:
    """Stay alive for one input; reconnect when the side-channel socket closes."""
    while True:
        batch_count = 0
        vad_iter = VADIterator(
            vad_model,
            threshold=VAD_THRESHOLD,
            sampling_rate=VAD_SAMPLE_RATE,
            min_silence_duration_ms=VAD_MIN_SILENCE_MS,
            speech_pad_ms=0,
        )

        pre_buffer: deque[np.ndarray] = deque(maxlen=VAD_PREROLL_WINDOWS)
        speech_windows: list[np.ndarray] = []
        speech_start_pts_ms: int | None = None

        try:
            async for window, window_pts_ms in stream_16k_windows(input_id):
                batch_count += 1
                pre_buffer.append(window)

                match vad_iter(torch.from_numpy(window), return_seconds=True):
                    case {"start": start}:
                        speech_start_pts_ms = window_pts_ms
                        speech_windows = list(pre_buffer)
                        debug("[%s] VAD speech start @ %d ms", input_id, window_pts_ms)

                    case {"end": end} if speech_start_pts_ms is not None:
                        duration_ms = window_pts_ms - speech_start_pts_ms
                        ts_ms = speech_start_pts_ms
                        audio = np.concatenate(speech_windows)
                        speech_start_pts_ms = None
                        speech_windows = []
                        debug(
                            "[%s] VAD speech end @ %d ms, segment=%d ms, samples=%d",
                            input_id,
                            window_pts_ms,
                            duration_ms,
                            audio.size,
                        )
                        asyncio.create_task(
                            _transcribe_and_emit(
                                whisper_model, input_id, audio, ts_ms, duration_ms
                            )
                        )

                    case _ if speech_start_pts_ms is not None:
                        speech_windows.append(window)

                if (
                    speech_start_pts_ms is not None
                    and window_pts_ms - speech_start_pts_ms >= VAD_MAX_SEGMENT_MS
                ):
                    duration_ms = window_pts_ms - speech_start_pts_ms
                    ts_ms = speech_start_pts_ms
                    audio = np.concatenate(speech_windows)
                    speech_start_pts_ms = window_pts_ms
                    speech_windows = list(pre_buffer)
                    asyncio.create_task(
                        _transcribe_and_emit(
                            whisper_model, input_id, audio, ts_ms, duration_ms
                        )
                    )
        except Exception as err:  # noqa: BLE001
            log.warning("[%s] whisper loop error: %s", input_id, err)

        wait = WORKER_RECONNECT_S
        log.info(
            "[%s] reconnecting in %.0fs (had %d windows)",
            input_id,
            wait,
            batch_count,
        )
        await asyncio.sleep(wait)


def resample_to_16k(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    if sample_rate == 16000:
        return audio
    target_len = int(round(audio.shape[0] * 16000 / sample_rate))
    if target_len <= 0:
        return audio
    x_old = np.linspace(0.0, 1.0, audio.shape[0], endpoint=False)
    x_new = np.linspace(0.0, 1.0, target_len, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32, copy=False)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
