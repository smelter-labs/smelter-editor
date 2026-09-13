#!/usr/bin/env python3
"""Basketball-scorer sidecar: subscribes to a video side channel via
smelter-sdk, finds the ball (YOLO COCO "sports ball", with a rim-centred crop
pass and an orange-blob HSV fallback) and the people (COCO "person"), runs
analysis.ShotDetector over the calibrated rim ellipse and, on a make, walks a
ring buffer of recent frames back to the release to classify the shooter's
jersey colour against the two team colours.

Output keeps the standard `{count, boxes, frameW, frameH, procMs}` shape
(count = makes, boxes = ball + persons so drawBoxes debug works untouched) and
adds `ball`, `zone`, `state`, `attempts`, `makes`, `session` and discrete
`shot_made` / `shot_attempt` events.

Structure follows the kettlebell coach worker: a reader task drains the side
channel into a short bounded queue (the socket must never back up; a frame is
dropped only when FRAME_QUEUE are already waiting), the analysis loop paces
itself to `analysisFps` while it keeps up and drains the backlog otherwise,
all heavy backends load lazily so a missing torch/ultralytics only disables
YOLO (HSV keeps working)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field

import numpy as np
import websockets

try:
    import cv2
except Exception:  # noqa: BLE001
    cv2 = None
else:
    cv2.setNumThreads(1)
from smelter import list_channels
from smelter.aio import subscribe_video_channel

from analysis import (
    REPLAY_AFTER_S,
    REPLAY_OUT_FPS,
    ShotDetector,
    analysis_interval_s,
    classify_team,
    hex_to_rgb,
    median_color,
    replay_frame_plan,
    rim_crop_box,
    rim_from_params,
    torso_region,
)

logging.basicConfig(
    level=logging.INFO,
    format="[basketball-scorer-worker] %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("basketball-scorer-worker")

NODE_WS_URL = os.environ.get("NODE_WS_URL", "ws://127.0.0.1:8092")
ANALYSIS_FPS = float(os.environ.get("BASKETBALL_ANALYSIS_FPS", "20"))
MIN_ANALYSIS_INTERVAL_S = 1.0 / ANALYSIS_FPS if ANALYSIS_FPS > 0 else 0.05
IMGSZ = int(os.environ.get("BASKETBALL_IMGSZ", "640"))
BALL_CONF = float(os.environ.get("BASKETBALL_BALL_CONF", "0.2"))
PERSON_CONF = 0.3
# Full-frame person pass every Nth analysed frame (the ball pass runs on every
# frame); persons only feed the release lookup, so stale boxes are fine.
PERSON_EVERY = max(1, int(os.environ.get("BASKETBALL_PERSON_EVERY", "3")))
# Full-frame ball fallback (ball away from the rim crop) every Nth frame.
FALLBACK_EVERY = max(1, int(os.environ.get("BASKETBALL_FALLBACK_EVERY", "3")))
# Frames buffered between the side-channel reader and the analysis loop: a
# frame is only dropped when this many are already waiting (was: keep the
# newest only, i.e. every slow frame cost the next one — at the net that is
# the difference between a make and a miss).
FRAME_QUEUE = max(1, int(os.environ.get("BASKETBALL_FRAME_QUEUE", "6")))
WEIGHTS_ENV = os.environ.get("BASKETBALL_YOLO_WEIGHTS", "").strip()
PERSON_CLASS = 0
BALL_CLASS = 32  # COCO "sports ball"
# Sanity: a ball box larger than this fraction of the frame is not a ball.
BALL_MAX_FRAC = 0.25

# HSV orange band in OpenCV units (hue 0..179).
HSV_HUE_LO = int(os.environ.get("BASKETBALL_HSV_HUE_LO", "5"))
HSV_HUE_HI = int(os.environ.get("BASKETBALL_HSV_HUE_HI", "25"))
HSV_SAT_MIN = int(os.environ.get("BASKETBALL_HSV_SAT_MIN", "120"))
HSV_VAL_MIN = int(os.environ.get("BASKETBALL_HSV_VAL_MIN", "70"))

# Debug: dump every Nth analysed frame (as seen by the detector, with the rim
# crop and the ball box drawn) into this directory — `BASKETBALL_DUMP_FRAMES=/tmp/bb-dump`,
# `BASKETBALL_DUMP_EVERY=50`.
DUMP_DIR = os.environ.get("BASKETBALL_DUMP_FRAMES", "")
DUMP_EVERY = max(1, int(os.environ.get("BASKETBALL_DUMP_EVERY", "50")))
DUMP_MAX = 200

# ── Frame ring buffer (release lookup + stills + instant replay) ─────────────
FRAME_DIR = os.environ.get("BASKETBALL_FRAME_DIR", "")
# 640 px wide: the replay window on air is 1280×720, so the clip upscales 2×
# (400 px looked soft). RGB: 160 × 640×360×3 ≈ 110 MB — one hoop cam only.
FRAME_MAX_W = 640
FRAME_BUF_LEN = 160  # ≥5 s at 30 analysis fps; the replay needs 4 s + slack
FRAME_JPEG_QUALITY = 80
FRAME_MATCH_TOL_S = 0.6
FRAME_MAX_WRITES = 2000

# ── Instant replay (clip cut from the ring buffer on Node's `replay` cmd) ────
# Where clips land; Node registers them as engine inputs for the REPLAY
# window and deletes them once the window closed.
REPLAY_DIR = os.environ.get("BASKETBALL_REPLAY_DIR", "")
# The make is reported before the post-make frames exist — wait this long
# for the buffer to reach `t + REPLAY_AFTER_S` before cutting.
REPLAY_WAIT_S = 1.5
REPLAY_MIN_FRAMES = REPLAY_OUT_FPS  # < 1 s of clip is not a replay
REPLAY_MAX_WRITES = 200
REPLAY_ENCODE_TIMEOUT_S = 30


def _flag(params: dict, key: str) -> bool:
    return str(params.get(key, "0")).strip().lower() in ("1", "true", "on")


@dataclass
class InputState:
    side_channel_ready: bool = False
    first_seen_at: float = field(default_factory=time.monotonic)
    params: dict = field(default_factory=dict)
    detector: ShotDetector = field(default_factory=ShotDetector)
    session: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    analyzed_frames: int = 0
    pending_events: list = field(default_factory=list)
    # (pts, downscaled RGB) — always fed; the release finder samples jersey
    # colour from it and stills are cut from it when captureShotFrames is on.
    frame_buf: deque = field(default_factory=lambda: deque(maxlen=FRAME_BUF_LEN))
    frames_written: int = 0
    replays_written: int = 0
    prev_ball_center: tuple[float, float] | None = None
    yolo_misses: int = 0
    ball_hits: int = 0
    # Person boxes from the last full-frame pass (reused on skipped frames).
    last_persons: list = field(default_factory=list)
    proc_ms_sum: float = 0.0


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

_backend_lock = threading.Lock()
_backend_failed = False
_models: dict[str, object] = {}
_device: str | None = None
_torch_threads_capped = False


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
    _device = dev
    log.info("Inference device: %s", dev)
    return dev


def _cap_torch_threads() -> None:
    global _torch_threads_capped
    if _torch_threads_capped:
        return
    _torch_threads_capped = True
    try:
        import torch

        torch.set_num_threads(int(os.environ.get("TORCH_NUM_THREADS", "4")))
    except Exception:  # noqa: BLE001
        pass


_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COCO_WEIGHTS = ("yolo11n.pt", "yolo11s.pt", "yolo11m.pt")
# Fine-tuned single-class ball detectors (scripts/bb-ball/train.py --install);
# they live next to this file, gitignored, and fall back to COCO when absent.
CUSTOM_WEIGHTS = ("bb-ball.pt",)
_missing_custom_warned: set[str] = set()


def _default_weights() -> str:
    if WEIGHTS_ENV:
        return WEIGHTS_ENV
    return "yolo11s.pt" if _select_device().startswith("cuda") else "yolo11n.pt"


def _resolve_weights(params: dict) -> str:
    w = str(params.get("yoloWeights", "auto")).strip()
    if w in COCO_WEIGHTS:
        return w
    if w in CUSTOM_WEIGHTS:
        path = os.path.join(_SCRIPT_DIR, w)
        if os.path.exists(path):
            return path
        # Never hand a missing custom name to ultralytics: a failed download
        # would mark the backend broken and drop the worker to HSV for good.
        if w not in _missing_custom_warned:
            _missing_custom_warned.add(w)
            log.warning("yoloWeights=%s not found at %s — using %s", w, path, _default_weights())
    return _default_weights()


def _ball_class(model) -> int:
    """COCO 'sports ball', or class 0 of a single-class fine-tune."""
    names = getattr(model, "names", None) or {}
    return 0 if len(names) == 1 else BALL_CLASS


def _person_model(ball_model):
    """Persons come from a COCO model; a single-class ball model has none."""
    if _ball_class(ball_model) == BALL_CLASS:
        return ball_model
    return _get_model(_default_weights())


def _get_model(weights: str):
    global _backend_failed
    if _backend_failed:
        return None
    cached = _models.get(weights)
    if cached is not None:
        return cached
    with _backend_lock:
        cached = _models.get(weights)
        if cached is not None or _backend_failed:
            return cached
        try:
            from ultralytics import YOLO

            _cap_torch_threads()
            log.info("Loading detection model: %s", weights)
            model = YOLO(weights)
            _models[weights] = model
            return model
        except Exception as err:  # noqa: BLE001
            log.warning(
                "YOLO backend failed to load (%s) — falling back to HSV ball "
                "tracking only. Install ultralytics>=8.3 to enable it.",
                err,
            )
            _backend_failed = True
            return None


def _predict(model, rgb, imgsz: int, conf: float, classes: list[int]):
    """One YOLO pass over an RGB array; a failing MPS backend drops to CPU once.

    ultralytics treats numpy input as BGR (cv2 convention) — the side channel
    delivers RGB, so the channels are swapped here; feeding RGB straight in
    turns an orange ball blue and the fine-tuned ball model finds nothing."""
    global _device
    img = np.ascontiguousarray(rgb[:, :, ::-1])
    try:
        return model.predict(
            img, imgsz=imgsz, conf=conf, classes=classes, verbose=False, device=_select_device()
        )
    except Exception as err:  # noqa: BLE001
        if _device and _device != "cpu":
            log.warning("Inference on %s failed (%s) — switching to CPU", _device, err)
            _device = "cpu"
            return model.predict(img, imgsz=imgsz, conf=conf, classes=classes, verbose=False, device="cpu")
        raise


def _boxes_from(result, ox: int, oy: int, frame_w: int, frame_h: int, ball_cls: int = BALL_CLASS):
    """Split one result into normalized person / ball boxes (offset back into
    the full frame when the pass ran on a crop)."""
    persons: list[dict] = []
    balls: list[dict] = []
    b = getattr(result, "boxes", None)
    if b is None or b.xyxy is None:
        return persons, balls
    for i in range(len(b.xyxy)):
        x1, y1, x2, y2 = (float(v) for v in b.xyxy[i])
        cls = int(b.cls[i]) if b.cls is not None else -1
        conf = float(b.conf[i]) if b.conf is not None else 0.0
        box = {
            "x": round((x1 + ox) / frame_w, 4),
            "y": round((y1 + oy) / frame_h, 4),
            "w": round((x2 - x1) / frame_w, 4),
            "h": round((y2 - y1) / frame_h, 4),
            "conf": round(conf, 3),
        }
        if cls == ball_cls:
            balls.append(box)
        elif cls == PERSON_CLASS:
            persons.append(box)
    return persons, balls


# Crop pass resolution: the rim crop (analysis.rim_crop_box, 480–~700 px on
# the cameras seen so far) is letterboxed up to this so a ~30 px ball keeps
# its size or grows; the training crops go through the same resize.
CROP_IMGSZ = 640


def detect_yolo(rgb, params: dict, rim, want_persons: bool = True, want_fallback: bool = True) -> dict | None:
    """Ball + persons for one frame. With a rim calibrated the ball is looked
    for first in the rim crop at native resolution (that is where makes are
    decided), then in the full frame at `imgsz`; persons come from the
    full-frame pass of a COCO model — only when `want_persons` (the loop asks
    every PERSON_EVERY frames and reuses the last boxes in between: persons
    only serve the release lookup, while the ball pass must not miss a frame
    at the net). Returns None when the backend is unavailable; `persons` is
    None when the pass was skipped."""
    ball_model = _get_model(_resolve_weights(params))
    if ball_model is None:
        return None
    h, w = rgb.shape[:2]
    imgsz = int(float(params.get("imgsz", IMGSZ)))
    ball_conf = float(params.get("ballConf", BALL_CONF))
    ball_cls = _ball_class(ball_model)
    rim_crop = rim is not None and (_flag(params, "rimCrop") if "rimCrop" in params else True)

    balls: list[dict] = []
    crop_used = False
    if rim_crop:
        x0, y0, side = rim_crop_box(rim, w, h)
        crop = np.ascontiguousarray(rgb[y0 : y0 + side, x0 : x0 + side])
        cres = _predict(ball_model, crop, CROP_IMGSZ, ball_conf, [ball_cls])
        if cres:
            _, balls = _boxes_from(cres[0], x0, y0, w, h, ball_cls)
            balls = [b for b in balls if b["conf"] >= ball_conf]
            crop_used = bool(balls)

    person_model = _person_model(ball_model)
    persons: list[dict] | None = None
    coco_is_ball = person_model is ball_model
    if person_model is not None and (want_persons or (coco_is_ball and not balls)):
        # One COCO pass covers persons and (when it is the ball model too) the ball.
        classes = [PERSON_CLASS] + ([BALL_CLASS] if coco_is_ball else [])
        results = _predict(person_model, rgb, imgsz, min(ball_conf, PERSON_CONF), classes)
        persons = []
        if results:
            fp, fb = _boxes_from(results[0], 0, 0, w, h)
            persons = [p for p in fp if p["conf"] >= PERSON_CONF]
            if not balls:
                balls = [b for b in fb if b["conf"] >= ball_conf]
    if not balls and not coco_is_ball and want_fallback:
        # Custom ball model: full-frame fallback for a ball away from the rim
        # (every other frame — the rim crop, which decides makes, runs on all).
        results = _predict(ball_model, rgb, imgsz, ball_conf, [ball_cls])
        if results:
            _, fb = _boxes_from(results[0], 0, 0, w, h, ball_cls)
            balls = [b for b in fb if b["conf"] >= ball_conf]
    return {"persons": persons, "balls": balls, "crop": crop_used}


def pick_ball(balls: list[dict], prev_center, frame_aspect: float) -> dict | None:
    """One ball: the candidate nearest the previous position when close
    enough (track continuity), else the most confident. Oversized boxes
    (a whole player, an orange hoodie) are dropped."""
    cands = [b for b in balls if b["w"] <= BALL_MAX_FRAC and b["h"] <= BALL_MAX_FRAC]
    if not cands:
        return None
    if prev_center is not None:
        px, py = prev_center

        def dist(b):
            return math.hypot((b["x"] + b["w"] / 2 - px) * frame_aspect, b["y"] + b["h"] / 2 - py)

        near = min(cands, key=dist)
        if dist(near) <= 0.25:
            return near
    return max(cands, key=lambda b: b["conf"])


# ── HSV fallback ─────────────────────────────────────────────────────────────


def _hsv(rgb):
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)


def detect_hsv_ball(rgb, params: dict, rim) -> dict | None:
    """Orange blob with a roughly round footprint, sized like a ball relative
    to the rim when one is calibrated."""
    if cv2 is None:
        return None
    h, w = rgb.shape[:2]
    hsv = _hsv(rgb)
    mask = cv2.inRange(hsv, (HSV_HUE_LO, HSV_SAT_MIN, HSV_VAL_MIN), (HSV_HUE_HI, 255, 255))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if rim is not None:
        exp_d = 0.55 * 2 * rim.rx * w
        exp_area = math.pi * (exp_d / 2) ** 2
        min_area, max_area = 0.2 * exp_area, 3.0 * exp_area
    else:
        min_area, max_area = 30.0, 0.02 * w * h
    best = None
    best_score = 0.0
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area < min_area or area > max_area or bw == 0 or bh == 0:
            continue
        ar = bw / bh
        if ar < 0.5 or ar > 2.0:
            continue
        fill = area / float(bw * bh)
        if fill < 0.45:
            continue
        score = fill * min(1.0, area / max(1.0, min_area * 2))
        if score > best_score:
            best_score = score
            # Plain floats: numpy scalars are not JSON-serializable.
            best = {
                "x": round(float(x) / w, 4),
                "y": round(float(y) / h, 4),
                "w": round(float(bw) / w, 4),
                "h": round(float(bh) / h, 4),
                "conf": round(0.4 + 0.5 * float(fill), 3),
            }
    return best


def detect_hsv_persons(rgb, params: dict) -> list[dict]:
    """Large blobs in each team colour — jerseys for the release finder when
    YOLO is unavailable (and for synthetic test clips)."""
    if cv2 is None:
        return []
    h, w = rgb.shape[:2]
    hsv = _hsv(rgb)
    out: list[dict] = []
    for key in ("teamColorA", "teamColorB"):
        rgb_c = hex_to_rgb(params.get(key, ""))
        if rgb_c is None:
            continue
        hh, ss, vv = cv2.cvtColor(np.uint8([[list(rgb_c)]]), cv2.COLOR_RGB2HSV)[0][0]
        if ss < 60:
            # White/black bibs: key on value instead of hue.
            lo = (0, 0, 200) if vv > 128 else (0, 0, 0)
            hi = (179, 60, 255) if vv > 128 else (179, 255, 50)
            mask = cv2.inRange(hsv, lo, hi)
        else:
            lo_h, hi_h = int(hh) - 10, int(hh) + 10
            if lo_h < 0:
                mask = cv2.inRange(hsv, (0, 80, 50), (hi_h, 255, 255)) | cv2.inRange(
                    hsv, (180 + lo_h, 80, 50), (179, 255, 255)
                )
            elif hi_h > 179:
                mask = cv2.inRange(hsv, (lo_h, 80, 50), (179, 255, 255)) | cv2.inRange(
                    hsv, (0, 80, 50), (hi_h - 180, 255, 255)
                )
            else:
                mask = cv2.inRange(hsv, (lo_h, 80, 50), (hi_h, 255, 255))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for i in range(1, n):
            x, y, bw, bh, area = stats[i]
            if area < 0.003 * w * h:
                continue
            out.append(
                {
                    "x": round(float(x) / w, 4),
                    "y": round(float(y) / h, 4),
                    "w": round(float(bw) / w, 4),
                    "h": round(float(bh) / h, 4),
                    "conf": 0.5,
                }
            )
    return out


def detect(
    rgb, params: dict, rim, prev_center, want_persons: bool = True, want_fallback: bool = True
) -> dict:
    """Ball + persons for one frame (runs in a thread). `persons` is None when
    the person pass was skipped this frame (caller reuses the last boxes)."""
    h, w = rgb.shape[:2]
    aspect = w / h if h else 16 / 9
    mode = str(params.get("ballDetector", "auto")).strip().lower()
    persons: list[dict] | None = []
    ball = None
    src = None
    yolo_ok = False
    if mode != "hsv":
        r = detect_yolo(rgb, params, rim, want_persons, want_fallback)
        if r is not None:
            yolo_ok = True
            persons = r["persons"]
            ball = pick_ball(r["balls"], prev_center, aspect)
            if ball is not None:
                src = "crop" if r["crop"] else "yolo"
    if ball is None and mode != "yolo":
        ball = detect_hsv_ball(rgb, params, rim)
        if ball is not None:
            src = "hsv"
    if mode == "hsv" or (not yolo_ok and mode == "auto"):
        persons = detect_hsv_persons(rgb, params)
    return {"ball": ball, "persons": persons, "src": src}


_dump_count = 0


def _dump_frame(input_id: str, state: "InputState", rgb, rim, ball, t: float) -> None:
    """Write the analysed frame (RGB as received → BGR file) with the rim
    crop and the ball box drawn; a sanity check for channel order, crop
    placement and resolution of what the side channel delivers."""
    global _dump_count
    if _dump_count >= DUMP_MAX:
        return
    try:
        os.makedirs(DUMP_DIR, exist_ok=True)
        h, w = rgb.shape[:2]
        img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        if rim is not None:
            x0, y0, side = rim_crop_box(rim, w, h)
            cv2.rectangle(img, (x0, y0), (x0 + side, y0 + side), (255, 200, 0), 2)
            cv2.ellipse(
                img,
                (int(rim.cx * w), int(rim.cy * h)),
                (max(1, int(rim.rx * w)), max(1, int(rim.ry * h))),
                0,
                0,
                360,
                (0, 0, 255),
                2,
            )
        if ball is not None:
            x1, y1 = int(ball["x"] * w), int(ball["y"] * h)
            cv2.rectangle(img, (x1, y1), (x1 + int(ball["w"] * w), y1 + int(ball["h"] * h)), (0, 255, 0), 2)
        name = f"{input_id[-12:]}-{state.analyzed_frames:06d}-t{t:08.2f}-{'ball' if ball else 'none'}.jpg"
        cv2.imwrite(os.path.join(DUMP_DIR, name), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        _dump_count += 1
    except Exception as err:  # noqa: BLE001
        log.warning("frame dump failed: %s", err)


# ── Frames: ring buffer, jersey colour, stills ───────────────────────────────


def _buffer_frame(state: InputState, t: float, rgb) -> None:
    if cv2 is None:
        return
    h, w = rgb.shape[:2]
    if w > FRAME_MAX_W:
        small = cv2.resize(
            rgb, (FRAME_MAX_W, max(1, round(h * FRAME_MAX_W / w))), interpolation=cv2.INTER_AREA
        )
    else:
        small = rgb.copy()
    state.frame_buf.append((t, small))


def _nearest_frame(state: InputState, t: float):
    if not state.frame_buf:
        return None
    pts, rgb = min(state.frame_buf, key=lambda p: abs(p[0] - t))
    if abs(pts - t) > FRAME_MATCH_TOL_S:
        return None
    return pts, rgb


def _sample_jersey(state: InputState, release: dict) -> tuple[int, int, int] | None:
    found = _nearest_frame(state, float(release["t"]))
    if found is None:
        return None
    _, small = found
    h, w = small.shape[:2]
    x0, y0, x1, y1 = torso_region(release["person"])
    px0, px1 = max(0, int(x0 * w)), min(w, int(math.ceil(x1 * w)))
    py0, py1 = max(0, int(y0 * h)), min(h, int(math.ceil(y1 * h)))
    if px1 <= px0 or py1 <= py0:
        return None
    patch = small[py0:py1, px0:px1].reshape(-1, 3)
    stride = max(1, patch.shape[0] // 1500)
    pixels = [tuple(int(c) for c in p) for p in patch[::stride]]
    return median_color(pixels)


def _attribute(state: InputState, event: dict, params: dict) -> None:
    """Replace the raw `release` dict with the shooter's team guess."""
    release = event.pop("release", None)
    team = None
    conf = 0.0
    sample_hex = None
    if release:
        sample = _sample_jersey(state, release)
        if sample is not None:
            team, conf = classify_team(
                sample, {"A": params.get("teamColorA", ""), "B": params.get("teamColorB", "")}
            )
            sample_hex = "#%02x%02x%02x" % sample
        event["shooterBox"] = release.get("person")
        event["releaseT"] = round(float(release["t"]), 3)
    event["team"] = team
    event["teamConfidence"] = round(conf, 3)
    event["colorSample"] = sample_hex


def _encode_frame(path: str, rgb) -> bool:
    bgr = np.ascontiguousarray(rgb[:, :, ::-1])
    ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), FRAME_JPEG_QUALITY])
    if not ok:
        return False
    os.makedirs(FRAME_DIR, exist_ok=True)
    with open(path, "wb") as f:
        f.write(buf.tobytes())
    return True


async def _attach_stills(input_id: str, state: InputState, events: list) -> None:
    """Save the make frame + the release frame for each shot_made."""
    for event in events:
        if event.get("type") != "shot_made":
            continue
        if state.frames_written >= FRAME_MAX_WRITES:
            continue
        safe_input = re.sub(r"[^A-Za-z0-9_-]", "_", input_id)
        base = f"{safe_input}-{state.session}-s{int(event.get('index', 0)):04d}"
        for key, t_key, suffix in (
            ("frameFile", "rimT", "make"),
            ("releaseFrameFile", "releaseT", "release"),
        ):
            t = event.get(t_key)
            if not isinstance(t, (int, float)):
                continue
            found = _nearest_frame(state, float(t))
            if found is None:
                continue
            name = f"{base}-{suffix}.jpg"
            try:
                ok = await asyncio.to_thread(_encode_frame, os.path.join(FRAME_DIR, name), found[1])
            except Exception as err:  # noqa: BLE001
                log.warning("Still write failed for %s: %s", input_id, err)
                continue
            if ok:
                state.frames_written += 1
                event[key] = name


# ── Instant replay ───────────────────────────────────────────────────────────


def _encode_replay(path: str, frames: list, out_fps: int) -> bool:
    """Pipe RGB frames (all the buffer's size) through ffmpeg into an H.264
    mp4 at `out_fps`. Sync — run it in a thread."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        log.warning("Replay skipped: ffmpeg not on PATH")
        return False
    h, w = frames[0].shape[:2]
    same = [f for f in frames if f.shape[:2] == (h, w)]
    raw = b"".join(np.ascontiguousarray(f).tobytes() for f in same)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cmd = [
        ffmpeg,
        "-loglevel", "error",
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{w}x{h}",
        "-framerate", str(out_fps),
        "-i", "-",
        # yuv420p needs even dimensions.
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        # ultrafast: the clip must be on air ~4 s after the make while YOLO
        # keeps the CPU busy (veryfast measured 2.7 s for an 8 s clip).
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        path,
    ]
    try:
        res = subprocess.run(cmd, input=raw, capture_output=True, timeout=REPLAY_ENCODE_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as err:
        log.warning("Replay encode failed: %s", err)
        return False
    if res.returncode != 0:
        log.warning("Replay encode failed (%d): %s", res.returncode, res.stderr.decode(errors="replace")[-400:])
        return False
    return True


async def _dump_replay(input_id: str, state: InputState, shot_id: str, t: float | None) -> None:
    """Cut the slow-motion clip around `t` (default: the newest buffered
    frame) and queue a `replay_ready` event — or `replay_failed`, so Node
    stops waiting for it."""
    def fail(reason: str) -> None:
        log.info("Replay for %s (%s) skipped: %s", input_id[-12:], shot_id, reason)
        state.pending_events.append({"type": "replay_failed", "shotId": shot_id, "reason": reason})

    if not REPLAY_DIR or cv2 is None:
        fail("replay dir / cv2 unavailable")
        return
    if state.replays_written >= REPLAY_MAX_WRITES:
        fail("write cap")
        return
    if t is None:
        t = state.frame_buf[-1][0] if state.frame_buf else None
    if t is None:
        fail("empty buffer")
        return
    # The make is reported while the ball is still in the net — the frames
    # after it arrive over the next second.
    deadline = time.monotonic() + REPLAY_WAIT_S
    while time.monotonic() < deadline:
        if state.frame_buf and state.frame_buf[-1][0] >= t + REPLAY_AFTER_S:
            break
        await asyncio.sleep(0.05)
    if active_inputs.get(input_id) is not state:
        return  # unsubscribed / restarted meanwhile
    plan, duration_ms = replay_frame_plan(list(state.frame_buf), t)
    if len(plan) < REPLAY_MIN_FRAMES:
        fail(f"buffer covers only {len(plan)} frames")
        return
    safe_input = re.sub(r"[^A-Za-z0-9_-]", "_", input_id)
    safe_shot = re.sub(r"[^A-Za-z0-9_-]", "_", shot_id)
    name = f"{safe_input}-{state.session}-{safe_shot}.mp4"
    started = time.monotonic()
    try:
        ok = await asyncio.to_thread(_encode_replay, os.path.join(REPLAY_DIR, name), plan, REPLAY_OUT_FPS)
    except Exception as err:  # noqa: BLE001
        log.warning("Replay write failed for %s: %s", input_id, err)
        ok = False
    if not ok:
        fail("encode failed")
        return
    state.replays_written += 1
    log.info(
        "Replay for %s (%s): %d frames, %d ms clip, encoded in %.0f ms",
        input_id[-12:], shot_id, len(plan), duration_ms, (time.monotonic() - started) * 1000,
    )
    state.pending_events.append(
        {
            "type": "replay_ready",
            "shotId": shot_id,
            "file": name,
            "durationMs": duration_ms,
            "t": round(t, 3),
        }
    )


# ── Node link ────────────────────────────────────────────────────────────────


async def send_result(input_id: str, data: dict) -> None:
    if ws_connection is None:
        return
    await ws_connection.send(json.dumps({"type": "result", "inputId": input_id, "data": data}))


SUBSCRIBE_MAX_RETRIES = 5
SUBSCRIBE_RETRY_DELAY_S = 1.0


async def run_detector(input_id: str) -> None:
    log.info("Starting basketball analysis for %s", input_id)
    if input_id not in active_inputs:
        return
    wait_start = time.monotonic()
    while input_id in active_inputs and not active_inputs[input_id].side_channel_ready:
        await asyncio.sleep(0.05)
        if time.monotonic() - wait_start > 30.0:
            log.warning("Timed out waiting for side_channel_ready: %s", input_id)
            return
    if input_id not in active_inputs:
        return
    log.info("side_channel_ready for %s (waited %.2fs), subscribing", input_id, time.monotonic() - wait_start)

    for attempt in range(1, SUBSCRIBE_MAX_RETRIES + 1):
        if input_id not in active_inputs:
            return
        try:
            channels = await asyncio.to_thread(list_channels)
            matching = [c for c in channels if c.kind.value == "video" and c.input_id == input_id]
            log.info(
                "attempt %d/%d for %s: %d channels, %d matching",
                attempt, SUBSCRIBE_MAX_RETRIES, input_id, len(channels), len(matching),
            )
            frame_count = await _run_detector_loop(input_id)
            if frame_count > 0:
                return
            if attempt < SUBSCRIBE_MAX_RETRIES:
                delay = SUBSCRIBE_RETRY_DELAY_S * attempt
                log.warning("0 frames for %s (attempt %d) — retrying in %.1fs", input_id, attempt, delay)
                await asyncio.sleep(delay)
            else:
                log.error("0 frames for %s after %d attempts — giving up", input_id, SUBSCRIBE_MAX_RETRIES)
        except asyncio.CancelledError:
            return
        except Exception as err:  # noqa: BLE001
            if attempt < SUBSCRIBE_MAX_RETRIES:
                delay = SUBSCRIBE_RETRY_DELAY_S * attempt
                log.warning("Detector for %s failed (attempt %d): %s — retrying in %.1fs", input_id, attempt, err, delay)
                await asyncio.sleep(delay)
            else:
                log.error("Detector for %s failed after %d attempts: %s", input_id, SUBSCRIBE_MAX_RETRIES, err)
    running_tasks.pop(input_id, None)
    log.info("Stopped basketball analysis for %s (exhausted retries)", input_id)


async def _run_detector_loop(input_id: str) -> int:
    frame_count = 0
    queue: deque = deque(maxlen=FRAME_QUEUE)
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
                # Bounded queue: bursts of slow frames no longer drop the
                # next ones (the deque evicts the oldest when it overflows).
                queue.append((time.monotonic(), frame))
                frame_ready.set()
        finally:
            reader_done.set()
            frame_ready.set()

    reader = asyncio.create_task(read_frames())
    last_analysis_at = 0.0
    try:
        while input_id in active_inputs and not (reader_done.is_set() and not queue):
            await frame_ready.wait()
            frame_ready.clear()
            if not queue:
                continue
            pending = active_inputs.get(input_id)
            if pending is None:
                break
            pause_s = analysis_interval_s(pending.params, MIN_ANALYSIS_INTERVAL_S) - (
                time.monotonic() - last_analysis_at
            )
            # Pace to analysisFps only while keeping up; with a backlog, drain.
            if pause_s > 0 and len(queue) <= 1:
                await asyncio.sleep(pause_s)
            if not queue:
                continue
            received_at, frame = queue.popleft()
            if queue:
                frame_ready.set()
            last_analysis_at = time.monotonic()

            state = active_inputs.get(input_id)
            if state is None:
                break
            rgba = frame.rgba
            frame_h, frame_w = rgba.shape[:2]
            params = state.params
            state.analyzed_frames += 1
            rgb = np.ascontiguousarray(rgba[:, :, :3])
            t = frame.pts_seconds
            _buffer_frame(state, t, rgb)

            rim = rim_from_params(params)
            want_persons = state.analyzed_frames % PERSON_EVERY == 1 or PERSON_EVERY == 1
            want_fallback = FALLBACK_EVERY == 1 or state.analyzed_frames % FALLBACK_EVERY == 0
            t_det = time.monotonic()
            det = await asyncio.to_thread(
                detect, rgb, params, rim, state.prev_ball_center, want_persons, want_fallback
            )
            state.proc_ms_sum += (time.monotonic() - t_det) * 1000.0
            ball = det["ball"]
            if det["persons"] is None:
                persons = state.last_persons
            else:
                persons = det["persons"]
                state.last_persons = persons
            if ball is not None:
                state.prev_ball_center = (ball["x"] + ball["w"] / 2, ball["y"] + ball["h"] / 2)
                state.yolo_misses = 0
                state.ball_hits += 1
            else:
                state.yolo_misses += 1
                if state.yolo_misses > 20:
                    state.prev_ball_center = None

            detector = state.detector
            detector.set_params(params)
            detector.set_aspect(frame_w / frame_h if frame_h else 16 / 9)
            events = detector.observe(t, ball, persons)
            if DUMP_DIR and cv2 is not None and state.analyzed_frames % DUMP_EVERY == 0:
                _dump_frame(input_id, state, rgb, rim, ball, t)
            if state.analyzed_frames == 1 or state.analyzed_frames % 200 == 0:
                log.info(
                    "%s: %dx%d frames, %d analysed (%.0f ms/frame detect), ball in %d (%s), t=%.2f zone=%s state=%s makes=%d attempts=%d",
                    input_id[-12:],
                    frame_w,
                    frame_h,
                    state.analyzed_frames,
                    state.proc_ms_sum / max(1, state.analyzed_frames),
                    state.ball_hits,
                    det["src"] or "-",
                    t,
                    detector.zone,
                    detector.state,
                    detector.made_count,
                    detector.attempt_count,
                )
            for ev in events:
                if ev.get("type") in ("shot_made", "shot_attempt"):
                    _attribute(state, ev, params)
            if events and cv2 is not None and FRAME_DIR and _flag(params, "captureShotFrames"):
                await _attach_stills(input_id, state, events)
            state.pending_events.extend(events)

            if ws_connection is None:
                continue
            proc_ms = (time.monotonic() - received_at) * 1000.0
            out_events = state.pending_events
            state.pending_events = []
            boxes = []
            if ball is not None:
                boxes.append({**ball, "src": "ball"})
            boxes.extend({**p, "src": "person"} for p in persons[:8])
            await send_result(
                input_id,
                {
                    "count": detector.made_count,
                    "boxes": boxes,
                    "frameW": frame_w,
                    "frameH": frame_h,
                    "procMs": round(proc_ms, 1),
                    "ball": {**ball, "src": det["src"]} if ball is not None else None,
                    "zone": detector.zone,
                    "state": detector.state,
                    "attempts": detector.attempt_count,
                    "makes": detector.made_count,
                    "rimSet": rim is not None,
                    "session": state.session,
                    "events": out_events,
                },
            )
    except asyncio.CancelledError:
        raise
    except Exception as err:  # noqa: BLE001
        log.exception("Detector loop error for %s (got %d frames): %s", input_id, frame_count, err)
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


def pause_detector(input_id: str) -> None:
    """side_channel_stopped: keep the subscription, restart the analysis with
    a fresh detector + session (the restarted stream's PTS may begin at 0)."""
    task = running_tasks.pop(input_id, None)
    if task and not task.done():
        task.cancel()
    state = active_inputs.get(input_id)
    if state is None:
        return
    state.side_channel_ready = False
    state.detector = ShotDetector(state.params or None)
    state.analyzed_frames = 0
    state.pending_events = []
    state.frame_buf.clear()
    state.frames_written = 0
    state.replays_written = 0
    state.prev_ball_center = None
    state.session = uuid.uuid4().hex[:12]


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
            active_inputs[input_id].detector.set_params(params)
        start_detector(input_id)
    elif cmd == "configure":
        params = msg.get("params")
        if input_id in active_inputs and isinstance(params, dict):
            active_inputs[input_id].params = params
            active_inputs[input_id].detector.set_params(params)
            log.info("configure %s params=%s", input_id, params)
    elif cmd == "unsubscribe":
        stop_detector(input_id)
    elif cmd == "replay":
        # Instant replay for one ledger entry: `t` is the make's frame time
        # (AI shots); without it the clip ends at the newest buffered frame
        # (manual / ground-truth makes, which fire when the ball just dropped).
        state = active_inputs.get(input_id)
        shot_id = msg.get("shotId")
        if state is not None and isinstance(shot_id, str):
            t = msg.get("t")
            t_val = float(t) if isinstance(t, (int, float)) else None
            asyncio.create_task(_dump_replay(input_id, state, shot_id, t_val))
    elif cmd == "side_channel_ready":
        if input_id in active_inputs:
            active_inputs[input_id].side_channel_ready = True
            task = running_tasks.get(input_id)
            if task is None or task.done():
                start_detector(input_id)
    elif cmd == "side_channel_stopped":
        pause_detector(input_id)
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
    log.info("Connecting to Node at %s (weights=%s)", NODE_WS_URL, WEIGHTS_ENV or "auto")
    while not _shutting_down:
        try:
            async with websockets.connect(NODE_WS_URL) as ws:
                ws_connection = ws
                await ws.send(json.dumps({"type": "ready", "model": "basketball-scorer"}))
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
