"""
YOLO Side-Channel HTTP Server
=============================
Subscribes to Smelter side-channel video sockets (per input) and runs YOLO
inference on every frame, POSTing detected boxes to a callback URL provided
by the editor server.

Start:
    SMELTER_SIDE_CHANNEL_SOCKET_DIR=/tmp/smelter-sidechan-XXXX \
        uvicorn yolo_server:app --host 0.0.0.0 --port 8765

Model files (.pt) are loaded from ./models/. Place YOLOv8 weights there.

Endpoints:
  GET  /models               → { models: ["foo.pt", ...] }
  GET  /model-info           → { classes, model_file, num_classes }   (default model)
  GET  /channels             → list visible Smelter side-channel sockets
  POST /start                → { input_id, callback_url, class_filter?, confidence?,
                                  task_id?, model_name?, socket_dir? }
                             → { task_id }
  POST /stop                 → { task_id } → { status: "stopped" }
  GET  /health
"""

from __future__ import annotations

import asyncio
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Smelter SDK — sync API is the easiest fit here. Each task gets its own thread
# that blocks on conn.recv() inside subscribe_video_channel.
from smelter import (
    Context,
    SideChannelKind,
    list_channels,
    subscribe_video_channel,
)

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
MODELS_DIR = SCRIPT_DIR / "models"

app = FastAPI(title="YOLO Side-Channel Server", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache: model path string → loaded YOLO instance
_model_cache: dict[str, "YOLO"] = {}
_model_cache_lock = threading.Lock()

_default_model = None
_default_model_file: Optional[str] = None


def _load_yolo(path: Path) -> "YOLO":
    key = str(path)
    with _model_cache_lock:
        cached = _model_cache.get(key)
    if cached is not None:
        return cached
    try:
        from ultralytics import YOLO
    except ImportError as err:
        raise HTTPException(
            status_code=503,
            detail="ultralytics not installed. Run: pip install ultralytics",
        ) from err
    print(f"[yolo_server] Loading model from {path}")
    model = YOLO(key)
    with _model_cache_lock:
        _model_cache[key] = model
    return model


def get_model(model_name: Optional[str] = None):
    if model_name:
        candidate = MODELS_DIR / model_name
        if not candidate.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Model '{model_name}' not found in {MODELS_DIR}",
            )
        return _load_yolo(candidate)

    global _default_model, _default_model_file
    if _default_model is not None:
        return _default_model

    if MODELS_DIR.exists():
        for candidate in sorted(MODELS_DIR.glob("*.pt")):
            _default_model = _load_yolo(candidate)
            _default_model_file = str(candidate)
            return _default_model

    raise HTTPException(
        status_code=503,
        detail=f"No model found. Place a .pt file in {MODELS_DIR}.",
    )


def list_models() -> list[str]:
    if not MODELS_DIR.exists():
        return []
    return sorted(p.name for p in MODELS_DIR.glob("*.pt"))


# ---------------------------------------------------------------------------
# Detection task — one Smelter input subscription
# ---------------------------------------------------------------------------


class _DetectionTask:
    """Subscribes to one Smelter video side channel, runs YOLO per frame,
    POSTs results to the editor server's callback URL."""

    def __init__(
        self,
        task_id: str,
        input_id: str,
        callback_url: str,
        class_filter: Optional[str],
        confidence: float,
        model_name: Optional[str],
        socket_dir: Optional[str],
    ):
        self.task_id = task_id
        self.input_id = input_id
        self.callback_url = callback_url
        self.class_filter = class_filter
        self.confidence = confidence
        self.model_name = model_name
        # Per-task ctx — each request may live in a separate socket dir
        # (mostly useful in dev when running against multiple Smelter servers).
        self.ctx = Context(socket_dir=socket_dir) if socket_dir else Context()
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _run(self) -> None:
        model = get_model(self.model_name)
        log = lambda msg: print(f"[yolo_server][{self.task_id}] {msg}", flush=True)
        log(
            f"socket_dir={self.ctx.socket_dir} input_id={self.input_id} model={self.model_name or 'default'}"
        )

        # Wait for the socket to appear (Smelter creates it lazily when the
        # input is registered). Re-checked every 0.5s; bail out cleanly if the
        # task is stopped before it ever appears.
        info = None
        log(f"waiting for video side channel input_id={self.input_id!r}")
        wait_started = time.time()
        last_diag = 0.0
        while not self._stop_event.is_set():
            try:
                info = wait_for_channel(
                    ctx=self.ctx,
                    kind=SideChannelKind.VIDEO,
                    input_id=self.input_id,
                    timeout=1.0,
                )
                break
            except Exception:
                # Diagnostic: every ~2s, dump the channels Smelter currently
                # exposes. If the list is empty (or doesn't contain our
                # input_id), Smelter hasn't created the side-channel socket
                # yet — usually because the WHIP publisher isn't streaming or
                # the `sideChannel: { video: true }` option wasn't honored.
                now = time.time()
                if now - last_diag >= 2.0:
                    last_diag = now
                    try:
                        available = list_channels(ctx=self.ctx)
                        if not available:
                            log(
                                f"still waiting (+{now - wait_started:.1f}s): "
                                f"no side channels exist yet under {self.ctx.socket_dir}"
                            )
                        else:
                            summary = ", ".join(
                                f"{c.kind.value}:{c.input_id}" for c in available
                            )
                            log(
                                f"still waiting (+{now - wait_started:.1f}s): "
                                f"available channels = [{summary}]"
                            )
                    except Exception as diag_err:
                        log(f"diag list_channels error: {diag_err}")
                continue
        if info is None:
            log("stopped before side channel appeared")
            return

        log(f"connected to {info.path}")

        frame_count = 0
        detect_count = 0
        last_log_t = time.time()
        try:
            with httpx.Client(timeout=5.0) as http:
                while not self._stop_event.is_set():
                    try:
                        for frame in subscribe_video_channel(
                            self.input_id,
                            ctx=self.ctx,
                            timeout=2.0,
                        ):
                            if self._stop_event.is_set():
                                break

                            frame_count += 1
                            h, w = frame.height, frame.width
                            # smelter delivers RGBA; ultralytics is fine with RGB.
                            rgb = np.ascontiguousarray(frame.rgba[:, :, :3])
                            try:
                                results = model.predict(
                                    rgb,
                                    conf=self.confidence,
                                    verbose=False,
                                )
                            except Exception as err:
                                log(f"YOLO predict error: {err}")
                                continue

                            boxes = []
                            for result in results:
                                if result.boxes is None:
                                    continue
                                for det in result.boxes:
                                    cls_id = int(det.cls[0])
                                    cls_name = model.names.get(cls_id, str(cls_id))
                                    if self.class_filter and cls_name != self.class_filter:
                                        continue
                                    x1, y1, x2, y2 = det.xyxy[0].tolist()
                                    boxes.append({
                                        "x": x1,
                                        "y": y1,
                                        "width": x2 - x1,
                                        "height": y2 - y1,
                                        "class_name": cls_name,
                                        "class_id": cls_id,
                                        "confidence": float(det.conf[0]),
                                    })

                            payload = {
                                "task_id": self.task_id,
                                "input_id": self.input_id,
                                "boxes": boxes,
                                "frame_width": w,
                                "frame_height": h,
                                "pts_nanos": frame.pts_nanos,
                            }
                            if boxes:
                                detect_count += 1
                            try:
                                resp = http.post(self.callback_url, json=payload)
                                if resp.status_code not in (200, 204):
                                    log(
                                        f"callback returned {resp.status_code} body={resp.text[:200]!r}, stopping"
                                    )
                                    break
                            except Exception as err:
                                log(f"callback error: {err}")
                                # Don't bail — transient network glitches shouldn't kill
                                # the detection loop. Slow callbacks just throttle us.
                                time.sleep(0.1)

                            now = time.time()
                            if now - last_log_t >= 2.0:
                                log(
                                    f"stats: {frame_count} frames, {detect_count} frames with detections "
                                    f"(last: {len(boxes)} boxes, frame={w}x{h}) callback={self.callback_url}"
                                )
                                frame_count = 0
                                detect_count = 0
                                last_log_t = now
                        break
                    except TimeoutError:
                        continue
                    except Exception as err:
                        log(f"recv error: {err}")
                        break
        finally:
            log("task ended")


def wait_for_channel(
    *,
    ctx: Context,
    kind: SideChannelKind,
    input_id: str,
    timeout: float = 1.0,
):
    """Poll side-channel sockets until the desired input_id appears.

    This mirrors smelter-sdk's newer wait_for_channel helper.
    """
    deadline = time.time() + timeout
    while True:
        channels = list_channels(ctx=ctx)
        for channel in channels:
            if channel.kind == kind and channel.input_id == input_id:
                return channel
        if time.time() >= deadline:
            available = ", ".join(
                f"{c.kind.value}:{c.input_id}" for c in channels
            )
            raise TimeoutError(
                f"side channel not available (available: {available or 'none'})"
            )
        time.sleep(0.1)


# Active tasks: task_id → _DetectionTask
_tasks: dict[str, _DetectionTask] = {}
_tasks_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class StartRequest(BaseModel):
    # The Smelter input_id whose side channel we should subscribe to.
    input_id: str
    callback_url: str
    class_filter: Optional[str] = None
    confidence: float = 0.25
    task_id: Optional[str] = None
    model_name: Optional[str] = None
    # Override SMELTER_SIDE_CHANNEL_SOCKET_DIR for this task only. When unset,
    # the server-process env var is used.
    socket_dir: Optional[str] = None


class StartResponse(BaseModel):
    task_id: str


class StopRequest(BaseModel):
    task_id: str


class ModelInfoResponse(BaseModel):
    classes: list[str]
    model_file: str
    num_classes: int


class ChannelInfo(BaseModel):
    kind: str
    input_id: str
    path: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/models")
def models_list():
    return {"models": list_models()}


@app.get("/model-info", response_model=ModelInfoResponse)
def model_info(model_name: Optional[str] = None):
    model = get_model(model_name)
    class_names = list(model.names.values()) if hasattr(model, "names") else []
    model_file = (
        str(MODELS_DIR / model_name) if model_name else (_default_model_file or "unknown")
    )
    return ModelInfoResponse(
        classes=class_names,
        model_file=model_file,
        num_classes=len(class_names),
    )


@app.get("/channels")
def channels(socket_dir: Optional[str] = None) -> dict:
    ctx = Context(socket_dir=socket_dir) if socket_dir else Context()
    found = list_channels(ctx=ctx)
    return {
        "socket_dir": str(ctx.socket_dir),
        "channels": [
            ChannelInfo(kind=c.kind.value, input_id=c.input_id, path=str(c.path)).model_dump()
            for c in found
        ],
    }


@app.post("/start", response_model=StartResponse)
def start_detection(req: StartRequest):
    # Force-load the model in the request thread so configuration errors surface
    # synchronously instead of failing silently inside the detection thread.
    get_model(req.model_name)

    task_id = req.task_id or str(uuid.uuid4())

    with _tasks_lock:
        existing = _tasks.pop(task_id, None)
    if existing is not None:
        # Stop AND wait for the old thread to finish before subscribing a new
        # task to the same input_id. Two concurrent subscriptions on the same
        # side-channel input trigger "Cannot switch mode while request queue
        # is not empty" — joining here avoids that race when the user flips
        # the model or class in the UI.
        existing.stop()
        existing._thread.join(timeout=3.0)
        if existing._thread.is_alive():
            print(
                f"[yolo_server] WARN: old task {task_id} did not exit within 3s; "
                f"new task may collide on side channel."
            )
    with _tasks_lock:
        task = _DetectionTask(
            task_id=task_id,
            input_id=req.input_id,
            callback_url=req.callback_url,
            class_filter=req.class_filter,
            confidence=req.confidence,
            model_name=req.model_name,
            socket_dir=req.socket_dir,
        )
        _tasks[task_id] = task

    task.start()
    print(
        f"[yolo_server] Started task {task_id} input={req.input_id} "
        f"model={req.model_name or 'default'} class={req.class_filter or '*'}"
    )
    return StartResponse(task_id=task_id)


@app.post("/stop")
def stop_detection(req: StopRequest):
    with _tasks_lock:
        task = _tasks.pop(req.task_id, None)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task {req.task_id!r} not found")
    task.stop()
    print(f"[yolo_server] Stopped task {req.task_id}")
    return {"status": "stopped", "task_id": req.task_id}


@app.get("/health")
def health():
    channels = list_channels()
    with _tasks_lock:
        active = list(_tasks.keys())
    return {
        "status": "ok",
        "active_tasks": active,
        "socket_dir": os.environ.get("SMELTER_SIDE_CHANNEL_SOCKET_DIR", "<unset>"),
        "channel_count": len(channels),
        "channels": [
            {"kind": c.kind.value, "input_id": c.input_id, "path": str(c.path)}
            for c in channels
        ],
    }
