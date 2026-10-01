#!/usr/bin/env python3
"""OB Van signal worker: one process for every room and camera. Per input it
runs up to two loops on the Smelter side channel and reports compact samples
over the Node WebSocket:

- audio (10 Hz): side-channel audio → 16 kHz mono 512-sample windows →
  Silero VAD (one stateful model per input), RMS dBFS, four band energies,
  energy / spectral-flux onsets → one sample per 100 ms hop
  `{kind:'audio', rms, speechProb, speech, onset, bands, procMs}`
- video (~5 Hz): latest-frame reader → YOLO persons (+ COCO "sports ball"
  when `ball=1`) and a frame-difference motion score →
  `{kind:'video', frameW, frameH, persons, ball, motion, procMs}`

Every result carries `ptsNanos` (the side channel's presentation timestamp),
which Node turns into the air time of the analysed audio / frame. The side
channel runs `delayMs` ahead of the output, so the auto pilot sees ~3 s into
the future.

Per-camera params (subscribe / configure): video, audio, ball ('0'/'1'),
videoHz, imgsz, confidence, onsetDb, speechOn, speechOff (+ delayMs from
Node). Heavy backends load lazily: without torch/ultralytics the video loop
still reports motion; without Silero the audio loop falls back to an energy
voice detector.

`python3 worker.py --selftest [--media file.mp4]` runs both pipelines on a
synthetic signal (or the file's audio + frames, decoded with ffmpeg / cv2)
without Node or a side channel, and prints the samples and timings."""

from __future__ import annotations

import argparse
import asyncio
import base64
import contextlib
import importlib.util
import json
import logging
import os
import subprocess
import sys
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import AsyncIterator, Awaitable, Callable

import numpy as np

try:
    import cv2
except Exception:  # noqa: BLE001
    cv2 = None
else:
    cv2.setNumThreads(1)

from analysis import (
    BAND_EDGES_HZ,
    HopAggregator,
    OnsetDetector,
    SpeechGate,
    dbfs_from_mean_square,
    ema,
    motion_score,
    normalise_bands,
    pace_factor,
    param_flag,
    param_float,
    spectral_flux,
)

logging.basicConfig(level=logging.INFO, format="[ob-van-worker] %(message)s", stream=sys.stderr)
log = logging.getLogger("ob-van-worker")

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
NODE_WS_URL = os.environ.get("NODE_WS_URL", "ws://127.0.0.1:8093")
YOLO_WEIGHTS = os.environ.get(
    "OB_VAN_YOLO_WEIGHTS", os.path.join(_SCRIPT_DIR, "..", "people-counter", "yolov8n.pt")
)
DEFAULT_VIDEO_HZ = float(os.environ.get("OB_VAN_VIDEO_HZ", "5"))
AUDIO_HZ = float(os.environ.get("OB_VAN_AUDIO_HZ", "10"))
HOP_MS = 1000.0 / max(1.0, AUDIO_HZ)
DEFAULT_IMGSZ = int(os.environ.get("OB_VAN_IMGSZ", "480"))
FRAME_QUEUE = max(1, int(os.environ.get("OB_VAN_FRAME_QUEUE", "2")))
DEFAULT_CONFIDENCE = 0.35
# Seconds of inference per second all video loops together may use before
# every loop is slowed down (see analysis.pace_factor).
LOAD_BUDGET_S = float(os.environ.get("OB_VAN_LOAD_BUDGET_S", "0.8"))

PERSON_CLASS = 0
BALL_CLASS = 32  # COCO "sports ball"
BALL_MAX_FRAC = 0.2  # a "ball" wider than this share of the frame is not one
MAX_PERSONS = 12

VAD_RATE = 16000
VAD_WINDOW = 512
NANOS_PER_SAMPLE = 1_000_000_000 // VAD_RATE
WINDOW_MS = VAD_WINDOW * 1000.0 / VAD_RATE

MOTION_W = 480
MOTION_GRID = (4, 4)  # cols, rows
MOTION_DIFF_THRESH = 18
MOTION_MAX_GAP_S = 1.5
PROC_EMA_ALPHA = 0.2
SNAPSHOT_MAX_W = 640
SNAPSHOT_JPEG_QUALITY = 80

SUBSCRIBE_MAX_RETRIES = 5
SUBSCRIBE_RETRY_DELAY_S = 1.0
SUBSCRIBE_GIVEUP_RETRY_S = 5.0
RECONNECT_DELAY_S = 0.2
FIRST_ITEM_TIMEOUT_S = 15.0
READY_TIMEOUT_S = 30.0
NO_AUDIO_WARN_S = 5.0


def _param_hz(params: dict) -> float:
    return param_float(params, "videoHz", DEFAULT_VIDEO_HZ, 0.5, 15.0)


# ── Per-input state ──────────────────────────────────────────────────────────


@dataclass
class InputState:
    params: dict = field(default_factory=dict)
    side_channel_ready: bool = False
    task: asyncio.Task | None = None
    # Inference cost per analysed frame (EMA, seconds) — feeds the pacer.
    proc_ema_s: float | None = None
    audio_samples: int = 0
    video_samples: int = 0
    # Latest analysed frame, for `capture` snapshots: (pts_nanos, RGB ≤640 px).
    last_frame: tuple[int, np.ndarray] | None = None

    def wants(self, kind: str) -> bool:
        return param_flag(self.params, kind, True)


active_inputs: dict[str, InputState] = {}
ws_connection = None
_shutting_down = False


def request_shutdown() -> None:
    global _shutting_down
    if _shutting_down:
        return
    _shutting_down = True
    for iid in list(active_inputs.keys()):
        stop_input(iid)
    log.info("Shutting down")


# ── Silero VAD ───────────────────────────────────────────────────────────────

_vad_path: str | None = None
_vad_unavailable = False
_torch_threads_capped = False


def _silero_jit_path() -> str | None:
    """The TorchScript file bundled with the `silero-vad` package, located
    without importing the package (its __init__ pulls torchaudio, which the
    shared YOLO venv does not need)."""
    spec = importlib.util.find_spec("silero_vad")
    if spec is None or not spec.submodule_search_locations:
        return None
    for root in spec.submodule_search_locations:
        candidate = os.path.join(root, "data", "silero_vad.jit")
        if os.path.exists(candidate):
            return candidate
    return None


def _cap_torch_threads(torch) -> None:
    global _torch_threads_capped
    if not _torch_threads_capped:
        _torch_threads_capped = True
        torch.set_num_threads(int(os.environ.get("TORCH_NUM_THREADS", "4")))


def load_vad():
    """A fresh Silero model (stateful — one per input), or None when Silero /
    torch is missing (the energy fallback takes over)."""
    global _vad_path, _vad_unavailable
    if _vad_unavailable:
        return None
    try:
        import torch

        _cap_torch_threads(torch)
        if _vad_path is None:
            _vad_path = _silero_jit_path()
            if _vad_path is None:
                raise RuntimeError("silero-vad package not installed")
            log.info("Silero VAD: %s", _vad_path)
        model = torch.jit.load(_vad_path, map_location="cpu")
        model.eval()
        return model
    except Exception as err:  # noqa: BLE001
        _vad_unavailable = True
        log.warning("Silero VAD unavailable (%s) — using the energy voice detector", err)
        return None


def _energy_voice_prob(level_db: float, bands: list[float]) -> float:
    """Fallback voice probability: loud enough and most energy in the voice
    band (300 Hz – 2 kHz). Crude, but keeps speech-driven rules alive."""
    loud = 1.0 / (1.0 + np.exp(-(level_db + 42.0) / 3.0))
    voice = bands[1] if len(bands) > 1 else 0.0
    return float(loud * min(1.0, voice / 0.5))


# ── Audio ────────────────────────────────────────────────────────────────────


def _band_edges_bins() -> list[tuple[int, int]]:
    freqs = np.fft.rfftfreq(VAD_WINDOW, 1.0 / VAD_RATE)
    return [
        (int(np.searchsorted(freqs, lo)), int(np.searchsorted(freqs, hi)))
        for lo, hi in zip(BAND_EDGES_HZ, BAND_EDGES_HZ[1:])
    ]


_BAND_BINS = _band_edges_bins()
_HANN = np.hanning(VAD_WINDOW).astype(np.float32)


class AudioAnalyzer:
    """One input's audio chain: window features → speech gate / onsets →
    100 ms hops. `process` returns the finished hop samples (Node payload)."""

    def __init__(self, params: dict):
        self.vad = load_vad()
        self.gate = SpeechGate()
        self.onsets = OnsetDetector()
        self.hops = HopAggregator(HOP_MS)
        self.prev_bands: list[float] | None = None
        self.configure(params)

    def configure(self, params: dict) -> None:
        self.gate.set_thresholds(
            param_float(params, "speechOn", 0.5, 0.05, 0.99),
            param_float(params, "speechOff", 0.3, 0.01, 0.95),
        )
        self.onsets.db = param_float(params, "onsetDb", 6.0, 2.0, 24.0)

    def _speech_prob(self, window: np.ndarray, level_db: float, bands: list[float]) -> float:
        if self.vad is None:
            return _energy_voice_prob(level_db, bands)
        import torch

        with torch.no_grad():
            return float(self.vad(torch.from_numpy(window), VAD_RATE).item())

    def process(self, window: np.ndarray, pts_nanos: int) -> list[dict]:
        t_ms = pts_nanos / 1e6
        mean_square = float(np.mean(window * window))
        level_db = dbfs_from_mean_square(mean_square)
        spectrum = np.abs(np.fft.rfft(window * _HANN)) ** 2
        bands = normalise_bands([float(spectrum[a:b].sum()) for a, b in _BAND_BINS])
        prob = self._speech_prob(window, level_db, bands)
        speech = self.gate.update(prob, t_ms)
        flux = spectral_flux(self.prev_bands, bands) if level_db > -60 else 0.0
        self.prev_bands = bands
        onset = self.onsets.update(t_ms, level_db, flux)
        return [
            {
                "ptsNanos": int(h.end_ms * 1e6),
                "rms": round(h.rms_db, 1),
                "speechProb": round(h.speech_prob, 3),
                "speech": h.speech,
                "onset": h.onset,
                "bands": h.bands,
            }
            for h in self.hops.push(t_ms, mean_square, prob, speech, onset, bands)
        ]


def resample_to_16k(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    if sample_rate == VAD_RATE:
        return audio
    target_len = int(round(audio.shape[0] * VAD_RATE / sample_rate))
    if target_len <= 0:
        return audio
    x_old = np.linspace(0.0, 1.0, audio.shape[0], endpoint=False)
    x_new = np.linspace(0.0, 1.0, target_len, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32, copy=False)


async def stream_16k_windows(batches: AsyncIterator) -> AsyncIterator[tuple[np.ndarray, int, float]]:
    """(window, window_start_pts_nanos, received_at) for every 512-sample
    16 kHz mono window of an audio side channel (after captions/sidecar.py)."""
    residual = np.empty(0, dtype=np.float32)
    async for batch in batches:
        received_at = time.monotonic()
        mono = batch.to_mono()
        if mono.size == 0:
            continue
        chunk = resample_to_16k(mono, batch.sample_rate).astype(np.float32, copy=False)
        if chunk.size == 0:
            continue
        audio = np.concatenate([residual, chunk]) if residual.size else chunk
        start_pts = batch.start_pts_nanos - residual.size * NANOS_PER_SAMPLE
        n_windows = audio.size // VAD_WINDOW
        for i in range(n_windows):
            window = audio[i * VAD_WINDOW : (i + 1) * VAD_WINDOW].copy()
            yield window, start_pts + i * VAD_WINDOW * NANOS_PER_SAMPLE, received_at
        residual = audio[n_windows * VAD_WINDOW :].copy()


async def run_audio_once(input_id: str) -> int:
    """One subscription of the audio side channel; returns hops sent."""
    from smelter.aio import subscribe_audio_channel

    state = active_inputs.get(input_id)
    if state is None:
        return 0
    analyzer = AudioAnalyzer(state.params)
    sent = 0
    configured = state.params
    async for window, pts, received_at in stream_16k_windows(subscribe_audio_channel(input_id)):
        state = active_inputs.get(input_id)
        if state is None:
            break
        if state.params is not configured:
            configured = state.params
            analyzer.configure(configured)
        for hop in analyzer.process(window, pts):
            pts_nanos = hop.pop("ptsNanos")
            hop["procMs"] = round((time.monotonic() - received_at) * 1000.0, 1)
            await send_result(input_id, pts_nanos, {"kind": "audio", **hop})
            sent += 1
            state.audio_samples += 1
    return sent


# ── Video ────────────────────────────────────────────────────────────────────

_yolo_model = None
_yolo_failed = False
_yolo_lock = threading.Lock()
_device: str | None = None
# One inference thread for every camera: ultralytics predictors are not safe
# to call concurrently, and serialising is what the pacer budgets for anyway.
_INFER = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ob-van-yolo")


def _select_device() -> str:
    global _device
    if _device is not None:
        return _device
    dev = "cpu"
    try:
        import torch

        if torch.cuda.is_available():
            dev = "cuda:0"
        elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
            dev = "mps"
    except Exception:  # noqa: BLE001
        pass
    _device = os.environ.get("OB_VAN_DEVICE", dev)
    log.info("Inference device: %s", _device)
    return _device


def _get_yolo():
    global _yolo_model, _yolo_failed
    if _yolo_model is not None or _yolo_failed:
        return _yolo_model
    with _yolo_lock:
        if _yolo_model is not None or _yolo_failed:
            return _yolo_model
        try:
            import torch
            from ultralytics import YOLO

            _cap_torch_threads(torch)
            log.info("Loading YOLO weights: %s", YOLO_WEIGHTS)
            _yolo_model = YOLO(YOLO_WEIGHTS)
        except Exception as err:  # noqa: BLE001
            _yolo_failed = True
            log.warning("YOLO unavailable (%s) — video reports motion only", err)
    return _yolo_model


def _predict(model, rgb: np.ndarray, imgsz: int, conf: float, classes: list[int]):
    """ultralytics treats numpy input as BGR (cv2 convention); the side
    channel delivers RGB — swap, or colours are wrong (after basketball)."""
    global _device
    img = np.ascontiguousarray(rgb[:, :, ::-1])
    try:
        return model.predict(img, imgsz=imgsz, conf=conf, classes=classes, verbose=False, device=_select_device())
    except Exception as err:  # noqa: BLE001
        if _device and _device != "cpu":
            log.warning("Inference on %s failed (%s) — switching to CPU", _device, err)
            _device = "cpu"
            return model.predict(img, imgsz=imgsz, conf=conf, classes=classes, verbose=False, device="cpu")
        raise


def _norm_box(xyxy, conf: float, w: int, h: int) -> dict:
    x1, y1, x2, y2 = (float(v) for v in xyxy)
    return {
        "x": round(max(0.0, x1 / w), 4),
        "y": round(max(0.0, y1 / h), 4),
        "w": round(max(0.0, (x2 - x1) / w), 4),
        "h": round(max(0.0, (y2 - y1) / h), 4),
        "conf": round(conf, 3),
    }


def detect_objects(rgb: np.ndarray, params: dict) -> tuple[list[dict], dict | None]:
    """Persons (largest first) and the most confident plausible ball."""
    model = _get_yolo()
    if model is None:
        return [], None
    want_ball = param_flag(params, "ball", False)
    imgsz = int(param_float(params, "imgsz", DEFAULT_IMGSZ, 160, 1280))
    conf = param_float(params, "confidence", DEFAULT_CONFIDENCE, 0.05, 0.95)
    classes = [PERSON_CLASS, BALL_CLASS] if want_ball else [PERSON_CLASS]
    # Balls are small and scored low; let them through and filter persons below.
    result = _predict(model, rgb, imgsz, min(conf, 0.2) if want_ball else conf, classes)[0]
    h, w = rgb.shape[:2]
    persons: list[dict] = []
    ball: dict | None = None
    if result.boxes is None or len(result.boxes) == 0:
        return persons, ball
    for xyxy, c, cls in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist(), result.boxes.cls.tolist()):
        box = _norm_box(xyxy, c, w, h)
        if int(cls) == BALL_CLASS:
            if box["w"] <= BALL_MAX_FRAC and (ball is None or c > ball["conf"]):
                ball = box
        elif c >= conf:
            persons.append(box)
    persons.sort(key=lambda b: b["w"] * b["h"], reverse=True)
    return persons[:MAX_PERSONS], ball


class MotionMeter:
    """Frame differencing on a 480 px gray copy, scored per grid cell so a
    pan / source cut (everything changed) is rejected (analysis.motion_score)."""

    def __init__(self):
        self.prev: np.ndarray | None = None
        self.prev_at = 0.0

    def measure(self, rgb: np.ndarray, now: float) -> float:
        if cv2 is None:
            return 0.0
        h, w = rgb.shape[:2]
        scale = MOTION_W / float(w) if w > MOTION_W else 1.0
        small = cv2.resize(rgb, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
        gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_RGB2GRAY), (5, 5), 0)
        prev, stale = self.prev, now - self.prev_at > MOTION_MAX_GAP_S
        self.prev, self.prev_at = gray, now
        if prev is None or stale or prev.shape != gray.shape:
            return 0.0
        changed = cv2.absdiff(gray, prev) > MOTION_DIFF_THRESH
        cols, rows = MOTION_GRID
        gh, gw = changed.shape
        cells = [
            float(changed[r * gh // rows : (r + 1) * gh // rows, c * gw // cols : (c + 1) * gw // cols].mean())
            for r in range(rows)
            for c in range(cols)
        ]
        return round(motion_score(cells)[0], 3)


def analyse_frame(rgb: np.ndarray, params: dict, meter: MotionMeter, now: float) -> dict:
    motion = meter.measure(rgb, now)
    persons, ball = detect_objects(rgb, params)
    h, w = rgb.shape[:2]
    return {"frameW": w, "frameH": h, "persons": persons, "ball": ball, "motion": motion}


def _video_load_s() -> float:
    """Seconds of inference per second all video loops currently ask for."""
    return sum(
        (s.proc_ema_s or 0.0) * _param_hz(s.params)
        for s in active_inputs.values()
        if s.wants("video")
    )


async def run_video_once(input_id: str) -> int:
    """One subscription of the video side channel; returns samples sent.

    A reader coroutine drains the socket into a short bounded queue (Smelter
    drops a side channel whose socket backs up), the consumer paces itself to
    `videoHz` × the global pace factor and always analyses the newest frame
    (after people-counter / basketball-scorer)."""
    from smelter.aio import subscribe_video_channel

    queue: deque = deque(maxlen=FRAME_QUEUE)
    frame_ready = asyncio.Event()
    reader_done = asyncio.Event()
    meter = MotionMeter()
    loop = asyncio.get_running_loop()
    sent = 0

    async def read_frames() -> None:
        try:
            async for frame in subscribe_video_channel(input_id):
                if input_id not in active_inputs:
                    break
                queue.append((time.monotonic(), frame))
                frame_ready.set()
        finally:
            reader_done.set()
            frame_ready.set()

    reader = asyncio.create_task(read_frames())
    last_at = 0.0
    try:
        while input_id in active_inputs and not (reader_done.is_set() and not queue):
            await frame_ready.wait()
            frame_ready.clear()
            state = active_inputs.get(input_id)
            if state is None:
                break
            interval = 1.0 / (_param_hz(state.params) * pace_factor(_video_load_s(), LOAD_BUDGET_S))
            pause = interval - (time.monotonic() - last_at)
            if pause > 0:
                await asyncio.sleep(pause)
            if not queue:
                continue
            received_at, frame = queue.pop()
            queue.clear()
            last_at = time.monotonic()
            rgb = np.ascontiguousarray(frame.rgba[:, :, :3])
            state.last_frame = (int(frame.pts_nanos), snapshot_copy(rgb))
            t0 = time.monotonic()
            data = await loop.run_in_executor(_INFER, analyse_frame, rgb, state.params, meter, t0)
            if sent > 0:  # the first frame pays for the model load — not a pace sample
                state.proc_ema_s = ema(state.proc_ema_s, time.monotonic() - t0, PROC_EMA_ALPHA)
            data["procMs"] = round((time.monotonic() - received_at) * 1000.0, 1)
            await send_result(input_id, frame.pts_nanos, {"kind": "video", **data})
            sent += 1
            state.video_samples += 1
    finally:
        reader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reader
    return sent


# ── Subscription ladder (after people-counter's _detect_until_stopped) ──────


async def _with_first_item_timeout(input_id: str, kind: str, run_once: Callable[[str], Awaitable[int]]) -> int:
    """Abort an attempt that never delivers (a socket that accepts but never
    writes would otherwise park the reader forever)."""
    state = active_inputs.get(input_id)
    before = _counter(state, kind)
    task = asyncio.ensure_future(run_once(input_id))
    deadline = time.monotonic() + FIRST_ITEM_TIMEOUT_S
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=1.0)
            if task.done() or input_id not in active_inputs:
                break
            if _counter(active_inputs.get(input_id), kind) == before and time.monotonic() > deadline:
                log.warning("no %s from %s within %.0fs — aborting this attempt", kind, input_id, FIRST_ITEM_TIMEOUT_S)
                break
    finally:
        # Also runs when the whole input task is cancelled (unsubscribe).
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    return task.result() if not task.cancelled() else 0


def _counter(state: InputState | None, kind: str) -> int:
    if state is None:
        return 0
    return state.audio_samples if kind == "audio" else state.video_samples


async def keep_streaming(input_id: str, kind: str, run_once: Callable[[str], Awaitable[int]]) -> None:
    """Subscribe and stay subscribed: fast retries while the socket is not
    up, a slow retry forever after that, and a quick reconnect when a live
    stream drops mid-way (Smelter can close a side channel under load)."""
    while input_id in active_inputs:
        streamed = False
        for attempt in range(1, SUBSCRIBE_MAX_RETRIES + 1):
            if input_id not in active_inputs:
                return
            try:
                if await _with_first_item_timeout(input_id, kind, run_once) > 0:
                    streamed = True
                    break
                log.warning("%s: 0 %s samples (attempt %d/%d)", input_id, kind, attempt, SUBSCRIBE_MAX_RETRIES)
            except asyncio.CancelledError:
                raise
            except Exception as err:  # noqa: BLE001
                log.warning("%s: %s loop failed (attempt %d/%d): %s", input_id, kind, attempt, SUBSCRIBE_MAX_RETRIES, err)
            await asyncio.sleep(SUBSCRIBE_RETRY_DELAY_S * attempt)
        if not streamed:
            log.warning("%s: no %s after %d attempts — retrying every %.0fs", input_id, kind, SUBSCRIBE_MAX_RETRIES, SUBSCRIBE_GIVEUP_RETRY_S)
            await asyncio.sleep(SUBSCRIBE_GIVEUP_RETRY_S)
            continue
        if input_id in active_inputs:
            log.info("%s: %s side channel dropped mid-stream — reconnecting", input_id, kind)
            await asyncio.sleep(RECONNECT_DELAY_S)


async def _warn_if_no_audio(input_id: str) -> None:
    await asyncio.sleep(NO_AUDIO_WARN_S)
    state = active_inputs.get(input_id)
    if state is not None and state.audio_samples == 0:
        log.warning(
            "%s: no audio %.0fs after side_channel_ready — is the input in an output? (audio decodes only then)",
            input_id,
            NO_AUDIO_WARN_S,
        )


async def run_input(input_id: str) -> None:
    state = active_inputs.get(input_id)
    if state is None:
        return
    started = time.monotonic()
    while input_id in active_inputs and not active_inputs[input_id].side_channel_ready:
        if time.monotonic() - started > READY_TIMEOUT_S:
            log.warning("Timed out waiting for side_channel_ready: %s", input_id)
            return
        await asyncio.sleep(0.05)
    state = active_inputs.get(input_id)
    if state is None:
        return
    loops = []
    if state.wants("audio"):
        loops.append(keep_streaming(input_id, "audio", run_audio_once))
        loops.append(_warn_if_no_audio(input_id))
    if state.wants("video"):
        loops.append(keep_streaming(input_id, "video", run_video_once))
    log.info(
        "%s: analysing audio=%s video=%s ball=%s",
        input_id,
        state.wants("audio"),
        state.wants("video"),
        param_flag(state.params, "ball", False),
    )
    try:
        await asyncio.gather(*loops)
    finally:
        log.info("%s: analysis stopped", input_id)


def start_input(input_id: str) -> None:
    state = active_inputs.get(input_id)
    if state is None or (state.task is not None and not state.task.done()):
        return
    state.task = asyncio.create_task(run_input(input_id))


def stop_task(state: InputState) -> None:
    if state.task is not None and not state.task.done():
        state.task.cancel()
    state.task = None


def stop_input(input_id: str) -> None:
    state = active_inputs.pop(input_id, None)
    if state is not None:
        stop_task(state)


def _loops_changed(old: dict, new: dict) -> bool:
    return any(param_flag(old, k, True) != param_flag(new, k, True) for k in ("audio", "video"))


# ── Node link ────────────────────────────────────────────────────────────────


async def send_result(input_id: str, pts_nanos: int, data: dict) -> None:
    if ws_connection is None:
        return
    await ws_connection.send(
        json.dumps({"type": "result", "inputId": input_id, "ptsNanos": int(pts_nanos), "data": data})
    )


# ── Snapshots (the `capture` command) ────────────────────────────────────────


def snapshot_copy(rgb: np.ndarray) -> np.ndarray:
    """A ≤640 px wide copy of the analysed frame, kept per input for
    `capture` (the full-size frame must not be retained)."""
    h, w = rgb.shape[:2]
    if w <= SNAPSHOT_MAX_W:
        return rgb.copy()
    if cv2 is None:
        step = max(1, round(w / SNAPSHOT_MAX_W))
        return np.ascontiguousarray(rgb[::step, ::step])
    scale = SNAPSHOT_MAX_W / w
    size = (SNAPSHOT_MAX_W, max(1, round(h * scale)))
    return cv2.resize(rgb, size, interpolation=cv2.INTER_AREA)


def encode_snapshot_jpeg(rgb: np.ndarray) -> bytes | None:
    if cv2 is None:
        return None
    bgr = np.ascontiguousarray(rgb[:, :, ::-1])
    ok, buf = cv2.imencode(
        ".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), SNAPSHOT_JPEG_QUALITY]
    )
    return buf.tobytes() if ok else None


async def send_snapshot(input_id: str, request_id) -> None:
    rid = request_id if isinstance(request_id, str) else ""
    state = active_inputs.get(input_id)
    if state is None or state.last_frame is None:
        await send_result(input_id, 0, {"kind": "snapshot", "requestId": rid, "error": "no_frame"})
        return
    pts_nanos, rgb = state.last_frame
    data = await asyncio.get_running_loop().run_in_executor(None, encode_snapshot_jpeg, rgb)
    if data is None:
        await send_result(input_id, pts_nanos, {"kind": "snapshot", "requestId": rid, "error": "encode_failed"})
        return
    h, w = rgb.shape[:2]
    await send_result(
        input_id,
        pts_nanos,
        {
            "kind": "snapshot",
            "requestId": rid,
            "w": int(w),
            "h": int(h),
            "jpegB64": base64.b64encode(data).decode("ascii"),
        },
    )


def handle_command(msg: dict) -> None:
    cmd = msg.get("cmd")
    if cmd == "shutdown":
        request_shutdown()
        return
    input_id = msg.get("inputId")
    if not isinstance(input_id, str):
        return
    params = msg.get("params") if isinstance(msg.get("params"), dict) else None
    state = active_inputs.get(input_id)
    if cmd == "subscribe":
        if state is None:
            state = active_inputs[input_id] = InputState()
        if params is not None:
            restart = _loops_changed(state.params, params)
            state.params = params
            if restart:
                stop_task(state)
        start_input(input_id)
    elif cmd == "configure" and state is not None and params is not None:
        restart = _loops_changed(state.params, params)
        state.params = params
        log.info("configure %s params=%s", input_id, params)
        if restart:
            stop_task(state)
            start_input(input_id)
    elif cmd == "unsubscribe":
        stop_input(input_id)
    elif cmd == "capture":
        asyncio.create_task(send_snapshot(input_id, msg.get("requestId")))
    elif cmd == "side_channel_ready" and state is not None:
        state.side_channel_ready = True
        start_input(input_id)  # no-op while running; revives a finished task
    elif cmd == "side_channel_stopped" and state is not None:
        state.side_channel_ready = False
        stop_task(state)


async def main() -> None:
    import websockets

    global ws_connection
    log.info("Connecting to Node at %s (video %.0f Hz, audio hop %.0f ms)", NODE_WS_URL, DEFAULT_VIDEO_HZ, HOP_MS)
    while not _shutting_down:
        try:
            async with websockets.connect(NODE_WS_URL, max_size=None) as ws:
                ws_connection = ws
                await ws.send(json.dumps({"type": "ready", "model": "ob-van"}))
                log.info("Connected to Node")
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(msg, dict):
                        handle_command(msg)
                    if _shutting_down:
                        break
        except asyncio.CancelledError:
            request_shutdown()
            break
        except Exception as err:  # noqa: BLE001
            if _shutting_down:
                break
            log.warning("Node connection lost (%s) — reconnecting in 2s", err)
        finally:
            ws_connection = None
        if not _shutting_down:
            await asyncio.sleep(2)


# ── Self test (no Node, no side channel) ─────────────────────────────────────


def _decode_audio(path: str, start: float, seconds: float) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(start), "-i", path, "-t", str(seconds), "-ac", "1", "-ar", str(VAD_RATE), "-f", "f32le", "-"],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def _synthetic_audio(seconds: float) -> np.ndarray:
    """Silence, then noise bursts every 500 ms, then a steady tone."""
    rng = np.random.default_rng(7)
    n = int(seconds * VAD_RATE)
    audio = rng.normal(0, 0.001, n).astype(np.float32)
    third = n // 3
    for start in range(third, 2 * third, VAD_RATE // 2):
        audio[start : start + 1600] += rng.normal(0, 0.3, 1600).astype(np.float32)
    t = np.arange(n - 2 * third) / VAD_RATE
    audio[2 * third :] += (0.2 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    return audio


def _selftest_audio(media: str | None, start: float, seconds: float) -> dict:
    audio = _decode_audio(media, start, seconds) if media else _synthetic_audio(seconds)
    analyzer = AudioAnalyzer({})
    hops: list[dict] = []
    t0 = time.perf_counter()
    for i in range(audio.size // VAD_WINDOW):
        window = audio[i * VAD_WINDOW : (i + 1) * VAD_WINDOW]
        hops += analyzer.process(window, i * VAD_WINDOW * NANOS_PER_SAMPLE)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    onsets = [round(h["ptsNanos"] / 1e9, 2) for h in hops if h["onset"]]
    return {
        "source": media or "synthetic",
        "vad": "silero" if analyzer.vad is not None else "energy",
        "hops": len(hops),
        "speechShare": round(sum(h["speech"] for h in hops) / max(1, len(hops)), 2),
        "maxSpeechProb": max((h["speechProb"] for h in hops), default=0.0),
        "onsets": len(onsets),
        "firstOnsetsS": onsets[:12],
        "rmsRangeDb": [min(h["rms"] for h in hops), max(h["rms"] for h in hops)] if hops else None,
        "cpuMsPerSecondOfAudio": round(elapsed_ms / (audio.size / VAD_RATE), 2),
        "sample": {k: v for k, v in hops[len(hops) // 2].items()} if hops else None,
    }


def _media_frames(path: str, start: float, count: int, hz: float) -> list[np.ndarray]:
    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000.0)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(fps / hz)))
    frames: list[np.ndarray] = []
    index = 0
    while len(frames) < count:
        ok, bgr = cap.read()
        if not ok:
            break
        if index % step == 0:
            frames.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        index += 1
    cap.release()
    return frames


def _synthetic_frames(count: int) -> list[np.ndarray]:
    frames = []
    for i in range(count):
        frame = np.full((720, 1280, 3), 40, dtype=np.uint8)
        x = 100 + i * 40
        frame[200:400, x : x + 120] = 220  # a moving block
        frames.append(frame)
    return frames


def _selftest_video(media: str | None, start: float, count: int, params: dict) -> dict:
    if cv2 is None:
        return {"error": "opencv missing"}
    frames = _media_frames(media, start, count, DEFAULT_VIDEO_HZ) if media else _synthetic_frames(count)
    meter = MotionMeter()
    samples = []
    timings = []
    for i, rgb in enumerate(frames):
        t0 = time.perf_counter()
        data = analyse_frame(rgb, params, meter, i / DEFAULT_VIDEO_HZ)
        timings.append((time.perf_counter() - t0) * 1000.0)
        samples.append(data)
    warm = timings[1:] or timings
    return {
        "source": media or "synthetic",
        "device": _device,
        "yolo": _yolo_model is not None,
        "frames": len(samples),
        "frameSize": [samples[0]["frameW"], samples[0]["frameH"]] if samples else None,
        "persons": [len(s["persons"]) for s in samples],
        "balls": sum(1 for s in samples if s["ball"]),
        "motion": [s["motion"] for s in samples],
        "firstMs": round(timings[0], 1) if timings else None,
        "meanMs": round(sum(warm) / len(warm), 1) if warm else None,
        "sample": samples[len(samples) // 2] if samples else None,
    }


def selftest(media: str | None, start: float, seconds: float, frames: int, ball: bool) -> None:
    report = {
        "audio": _selftest_audio(media, start, seconds),
        "video": _selftest_video(media, start, frames, {"ball": "1" if ball else "0"}),
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--media", default=None, help="selftest: decode this file instead of synthetic input")
    parser.add_argument("--start", type=float, default=0.0, help="selftest: seek into the media (s)")
    parser.add_argument("--seconds", type=float, default=20.0)
    parser.add_argument("--frames", type=int, default=12)
    parser.add_argument("--ball", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest(args.media, args.start, args.seconds, args.frames, args.ball)
    else:
        try:
            asyncio.run(main())
        except KeyboardInterrupt:
            pass
