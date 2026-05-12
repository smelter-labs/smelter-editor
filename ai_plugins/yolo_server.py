"""
YOLO Search HTTP Server
=======================
Start: uvicorn yolo_server:app --host 0.0.0.0 --port 8765
       (run from the ai_plugins directory)

Model files (.pt) are loaded from ./models/.
The built-in fallback is screen_ads/best.pt.

Endpoints:
  GET  /models               → { models: ["foo.pt", ...] }  — list ./models/*.pt
  GET  /model-info           → { classes, model_file, num_classes }  (default model)
  POST /start                → { stream_url, callback_url, class_filter?, confidence?,
                                  task_id?, model_name? }
                               → { task_id }
  POST /stop                 → { task_id }  →  { status: "stopped" }
  GET  /health
"""

import os
import threading
import uuid
import time
import cv2
import numpy as np
import httpx
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
MODELS_DIR = SCRIPT_DIR / "models"
DEFAULT_MODEL_CANDIDATES = [
    SCRIPT_DIR / "screen_ads" / "best.pt",
    SCRIPT_DIR / "best.pt",
]

app = FastAPI(title="YOLO Search Server", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache: model path string → loaded YOLO instance
_model_cache: dict[str, "YOLO"] = {}
_model_cache_lock = threading.Lock()

# Default model (lazy-loaded)
_default_model = None
_default_model_file: Optional[str] = None


def _load_yolo(path: Path) -> "YOLO":
    key = str(path)
    with _model_cache_lock:
        if key in _model_cache:
            return _model_cache[key]
    try:
        from ultralytics import YOLO
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="ultralytics not installed. Run: pip install ultralytics",
        )
    print(f"[yolo_server] Loading model from {path}")
    model = YOLO(key)
    with _model_cache_lock:
        _model_cache[key] = model
    return model


def get_model(model_name: Optional[str] = None):
    """Return a loaded YOLO model. If model_name is given, load from ./models/."""
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

    for candidate in DEFAULT_MODEL_CANDIDATES:
        if candidate.exists():
            _default_model = _load_yolo(candidate)
            _default_model_file = str(candidate)
            return _default_model

    raise HTTPException(
        status_code=503,
        detail=(
            f"No default model found. Tried: {[str(c) for c in DEFAULT_MODEL_CANDIDATES]}. "
            "Place a .pt file in ai_plugins/models/ or ai_plugins/screen_ads/."
        ),
    )


def list_models() -> list[str]:
    """Return .pt filenames available in ./models/."""
    if not MODELS_DIR.exists():
        return []
    return sorted(p.name for p in MODELS_DIR.glob("*.pt"))


# ---------------------------------------------------------------------------
# Background task manager
# ---------------------------------------------------------------------------

class _DetectionTask:
    def __init__(
        self,
        task_id: str,
        stream_url: str,
        callback_url: str,
        class_filter: Optional[str],
        confidence: float,
        model_name: Optional[str],
    ):
        self.task_id = task_id
        self.stream_url = stream_url
        self.callback_url = callback_url
        self.class_filter = class_filter
        self.confidence = confidence
        self.model_name = model_name
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()

    def _run(self):
        model = get_model(self.model_name)

        # Resolve source
        source = self.stream_url
        if source.startswith("file://"):
            source = source[7:]
        # "0" means webcam
        if source == "0":
            source = 0

        print(f"[yolo_server][{self.task_id}] Opening stream: {self.stream_url}")
        cap = cv2.VideoCapture(source)

        if not cap.isOpened():
            print(f"[yolo_server][{self.task_id}] Cannot open stream, aborting")
            return

        try:
            with httpx.Client(timeout=5.0) as http:
                while not self._stop_event.is_set():
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        # For live streams a temporary failure is normal; wait briefly
                        time.sleep(0.1)
                        continue

                    h, w = frame.shape[:2]

                    results = model(frame, conf=self.confidence, verbose=False)

                    boxes = []
                    for result in results:
                        if result.boxes is None:
                            continue
                        for box in result.boxes:
                            cls_id = int(box.cls[0])
                            cls_name = model.names.get(cls_id, str(cls_id))

                            if self.class_filter and cls_name != self.class_filter:
                                continue

                            x1, y1, x2, y2 = box.xyxy[0].tolist()
                            boxes.append({
                                "x": x1,
                                "y": y1,
                                "width": x2 - x1,
                                "height": y2 - y1,
                                "class_name": cls_name,
                                "class_id": cls_id,
                                "confidence": float(box.conf[0]),
                            })

                    payload = {
                        "task_id": self.task_id,
                        "boxes": boxes,
                        "frame_width": w,
                        "frame_height": h,
                    }

                    try:
                        resp = http.post(self.callback_url, json=payload)
                        if resp.status_code not in (200, 204):
                            print(f"[yolo_server][{self.task_id}] Callback returned {resp.status_code}, stopping")
                            break
                    except Exception as e:
                        print(f"[yolo_server][{self.task_id}] Callback error: {e}")
        finally:
            cap.release()
            print(f"[yolo_server][{self.task_id}] Stream closed")


# Active tasks: task_id → _DetectionTask
_tasks: dict[str, _DetectionTask] = {}
_tasks_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class StartRequest(BaseModel):
    stream_url: str
    callback_url: str
    class_filter: Optional[str] = None
    confidence: float = 0.25
    task_id: Optional[str] = None
    model_name: Optional[str] = None


class StartResponse(BaseModel):
    task_id: str


class StopRequest(BaseModel):
    task_id: str


class ModelInfoResponse(BaseModel):
    classes: list[str]
    model_file: str
    num_classes: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/models")
def models_list():
    return {"models": list_models()}


@app.get("/model-info", response_model=ModelInfoResponse)
def model_info():
    model = get_model()
    class_names = list(model.names.values()) if hasattr(model, "names") else []
    return ModelInfoResponse(
        classes=class_names,
        model_file=_model_file or "unknown",
        num_classes=len(class_names),
    )


@app.post("/start", response_model=StartResponse)
def start_detection(req: StartRequest):
    # Ensure model is loaded (and cached) before spawning the thread
    get_model(req.model_name)

    task_id = req.task_id or str(uuid.uuid4())

    with _tasks_lock:
        existing = _tasks.get(task_id)
        if existing:
            existing.stop()

        task = _DetectionTask(
            task_id=task_id,
            stream_url=req.stream_url,
            callback_url=req.callback_url,
            class_filter=req.class_filter,
            confidence=req.confidence,
            model_name=req.model_name,
        )
        _tasks[task_id] = task

    task.start()
    print(f"[yolo_server] Started task {task_id} for {req.stream_url} (model={req.model_name or 'default'})")
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
    active = list(_tasks.keys())
    return {"status": "ok", "active_tasks": active}
