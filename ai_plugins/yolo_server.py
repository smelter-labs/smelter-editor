"""
YOLO Search HTTP Server
=======================
Combines screens.py (YOLOv8 inference) and script.py (rectangle pipeline).

Start: uvicorn yolo_server:app --host 0.0.0.0 --port 8765
       (run from the ai_plugins directory so best.pt is found)

Endpoints:
  GET  /model-info           → { classes, model_file, num_classes }
  POST /start                → { stream_url, callback_url, class_filter?, confidence?,
                                  task_id? }
                               → { task_id }
                               Starts a background loop: grab frames from stream_url,
                               run YOLO, POST boxes to callback_url on every frame.
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
MODEL_CANDIDATES = [
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

_model = None
_model_file: Optional[str] = None


def get_model():
    global _model, _model_file
    if _model is not None:
        return _model

    try:
        from ultralytics import YOLO
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="ultralytics not installed. Run: pip install ultralytics",
        )

    for candidate in MODEL_CANDIDATES:
        if candidate.exists():
            print(f"[yolo_server] Loading model from {candidate}")
            _model = YOLO(str(candidate))
            _model_file = str(candidate)
            return _model

    raise HTTPException(
        status_code=503,
        detail=(
            f"Model file not found. Tried: {[str(c) for c in MODEL_CANDIDATES]}. "
            "Place best.pt in ai_plugins/screen_ads/ or ai_plugins/."
        ),
    )


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
    ):
        self.task_id = task_id
        self.stream_url = stream_url
        self.callback_url = callback_url
        self.class_filter = class_filter
        self.confidence = confidence
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()

    def _run(self):
        model = _model  # already loaded before task is created

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
                        http.post(self.callback_url, json=payload)
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
    task_id: Optional[str] = None  # caller may supply a stable id


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
    # Ensure model is loaded before spawning thread
    model = get_model()  # noqa: F841

    task_id = req.task_id or str(uuid.uuid4())

    with _tasks_lock:
        # Stop existing task with same id if any
        existing = _tasks.get(task_id)
        if existing:
            existing.stop()

        task = _DetectionTask(
            task_id=task_id,
            stream_url=req.stream_url,
            callback_url=req.callback_url,
            class_filter=req.class_filter,
            confidence=req.confidence,
        )
        _tasks[task_id] = task

    task.start()
    print(f"[yolo_server] Started task {task_id} for {req.stream_url}")
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
